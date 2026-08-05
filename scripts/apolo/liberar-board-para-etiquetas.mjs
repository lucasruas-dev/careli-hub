// LIBERA O BOARD INTEIRO PARA A ETIQUETA — backfill do dia do evento (01/08, Vale do Ouro).
//
// Regra do Lucas, com o lançamento já rodando: "hoje tudo liberado, entrou no board vai para
// etiquetas". Até hoje só quem chegava em `etapa = 'credenciado'` entrava em
// `prometeu_credenciados`, e a tela de etiquetas lê SÓ de lá — então quem estava em validação,
// revisão, pré-venda ou correção simplesmente não existia para a impressão, mesmo estando no
// salão. Este script pega quem já está no Board (QUALQUER etapa) e coloca na fila do evento.
//
// O gancho daqui pra frente foi ampliado em `lib/apolo/esteira.ts`. Este script resolve o passado.
//
// Uso (da raiz do repo):
//   node scripts/apolo/liberar-board-para-etiquetas.mjs               # ENSAIO (não grava nada)
//   node scripts/apolo/liberar-board-para-etiquetas.mjs --aplicar     # grava de verdade
//
// Flags opcionais:
//   --exceto=indeferido,correcao       não sobe estas etapas (o ensaio mostra a quebra por etapa)
//   --empreendimento=Vale do Ouro      só as fichas cujo `empreendimento` casa com este texto
//
// IDEMPOTENTE: quem já está no evento é pulado. Rodar duas vezes não duplica ninguém — além da
// checagem em memória, o índice único (evento_id, origem, origem_ref) da 0053 é a última trava.
//
// Só escreve em `prometeu_credenciados`, e só com `--aplicar`. NÃO toca no C2X (read-only).
import fs from "node:fs";
import path from "node:path";

const raizApp = path.resolve(process.cwd(), "apps/hub");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(raizApp, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY em apps/hub/.env.local");
  process.exit(1);
}

const args = process.argv.slice(2);
const APLICAR = args.includes("--aplicar");
const flag = (nome) => {
  const achado = args.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.slice(nome.length + 3).trim() : null;
};
const EXCETO = new Set(
  (flag("exceto") ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);
const EMPREENDIMENTO = flag("empreendimento");

const cabecalhos = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

const ler = async (tabela, query) => {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${query}`, { headers: cabecalhos });
  if (!resp.ok) throw new Error(`${tabela}: ${resp.status} ${await resp.text()}`);
  return resp.json();
};

// O PostgREST corta em 1.000 linhas por padrão e o Board tem milhares de fichas. Sem paginar, o
// script diria "só existem 1.000" e o backfill sairia pela metade sem ninguém perceber.
// `ordem` = lista de colunas separadas por vírgula. TEM QUE SER ÚNICA: a paginação é por
// offset, e com ordem ambígua o banco pode devolver a mesma linha em duas páginas (ou pular uma).
// Foi por isso que `apolo_esteira` passou a ordenar por "entity_id,enterprise_id": desde a
// migration 0080 `entity_id` sozinho NÃO é mais único (uma CAD por pessoa por empreendimento).
const lerTudo = async (tabela, query, ordem) => {
  const PAGINA = 1000;
  const ordenacao = ordem
    .split(",")
    .map((coluna) => `${coluna.trim()}.asc`)
    .join(",");
  const out = [];
  for (let offset = 0; ; offset += PAGINA) {
    const bloco = await ler(
      tabela,
      `${query}&order=${ordenacao}&limit=${PAGINA}&offset=${offset}`,
    );
    out.push(...bloco);
    if (bloco.length < PAGINA) return out;
  }
};

// -------------------------------------------------------------- evento do dia

// MESMA LÓGICA de `eventoOperavelId` (lib/prometeu/data.ts): prioriza `em_andamento` (evento
// aberto) e só cai para `ativo` (preparo). Procurar apenas por `ativo` já causou 3 bugs hoje —
// das 9h em diante o evento vira `em_andamento` e a busca não achava mais nada.
const eventos = await ler(
  "prometeu_eventos",
  "select=id,nome,status,enterprise_code&status=in.(em_andamento,ativo)&limit=5",
);
const evento = eventos.find((e) => e.status === "em_andamento") ?? eventos[0] ?? null;
if (!evento) {
  console.error("Nenhum evento em andamento (nem ativo). Nada a fazer.");
  process.exit(1);
}

console.log(`Evento: ${evento.nome} · status ${evento.status} · ${evento.enterprise_code ?? "sem sigla"}`);
console.log(APLICAR ? "MODO: APLICAR (vai gravar)\n" : "MODO: ENSAIO (não grava nada)\n");

// ------------------------------------------------------------------ leitura

console.log("Lendo o Board (apolo_esteira, todas as etapas)...");
let esteira = await lerTudo(
  "apolo_esteira",
  "select=entity_id,enterprise_id,etapa,imobiliaria,corretor,empreendimento",
  "entity_id,enterprise_id",
);
esteira = esteira.filter((e) => e.entity_id);

const total = esteira.length;
if (EMPREENDIMENTO) {
  const alvo = EMPREENDIMENTO.toLowerCase();
  esteira = esteira.filter((e) => String(e.empreendimento ?? "").toLowerCase().includes(alvo));
  console.log(`Filtro de empreendimento "${EMPREENDIMENTO}": ${esteira.length} de ${total} fichas`);
}
if (EXCETO.size > 0) {
  const antes = esteira.length;
  esteira = esteira.filter((e) => !EXCETO.has(String(e.etapa ?? "").toLowerCase()));
  console.log(`Etapas excluídas (${[...EXCETO].join(", ")}): -${antes - esteira.length} fichas`);
}
console.log(`Fichas no Board consideradas: ${esteira.length}`);

console.log("Lendo quem já está na fila do evento...");
const jaNaFila = new Set(
  (await lerTudo("prometeu_credenciados", `select=id,entity_id&evento_id=eq.${evento.id}`, "id"))
    .map((c) => c.entity_id)
    .filter(Boolean),
);
console.log(`Já na fila: ${jaNaFila.size}`);

// A fila do Prometeu é por PESSOA (uma etiqueta, um check-in), então quem tem CAD em dois
// empreendimentos entra UMA vez — a primeira linha lida. Sem este dedup, a mesma pessoa entraria
// duas vezes na fila do evento.
const vistos = new Set();
const faltando = esteira.filter((e) => {
  if (jaNaFila.has(e.entity_id) || vistos.has(e.entity_id)) return false;
  vistos.add(e.entity_id);
  return true;
});
const ids = faltando.map((e) => e.entity_id);

// Em blocos de 100: `in` com centenas de uuids estoura a URL do PostgREST.
const entidades = [];
for (let i = 0; i < ids.length; i += 100) {
  entidades.push(
    ...(await ler(
      "apolo_entities",
      `select=id,display_name,legal_name,document_masked&id=in.(${ids.slice(i, i + 100).join(",")})`,
    )),
  );
}
const porId = new Map(entidades.map((e) => [e.id, e]));

// -------------------------------------------------------------- montagem

const AGORA = new Date().toISOString();

// MESMOS CAMPOS e MESMO FORMATO de `garantirNaFilaDoLancamento` + `adicionarCredenciado`:
// nome em MAIÚSCULAS vindo de legal_name/display_name, documento do `document_masked`,
// imobiliária/corretor da esteira, etapa `recepcao`, origem `prevenda` e `origem_ref` = entityId
// (é essa dupla que o índice único usa para não deixar entrar duas vezes).
//
// `pago_em`/`ordem_fila` ficam nulos: aqui ninguém sabe a hora do pagamento, e inventar uma
// colocaria quem não pagou na frente de quem pagou. Sem chave de ordenação a pessoa entra no fim
// da fila — que é exatamente onde ela deve entrar.
const paraInserir = [];
const semNome = [];
for (const linha of faltando) {
  const ent = porId.get(linha.entity_id);
  const nome = (ent?.legal_name || ent?.display_name || "").trim();
  const etapa = linha.etapa ?? "(sem etapa)";
  if (!nome) {
    semNome.push({ entityId: linha.entity_id, etapa });
    continue;
  }
  paraInserir.push({
    etapaEsteira: etapa,
    registro: {
      corretor: linha.corretor ?? null,
      documento: ent?.document_masked ?? null,
      entity_id: linha.entity_id,
      etapa: "recepcao",
      evento_id: evento.id,
      imobiliaria: linha.imobiliaria ?? null,
      // Rastro de PORQUE esta pessoa está na fila sem ter chegado por credenciamento: se amanhã
      // alguém estranhar um nome aqui, o metadata conta a história (dia do evento, etapa de origem).
      metadata: {
        backfill: "liberar-board-para-etiquetas",
        backfillEm: AGORA,
        etapaEsteira: etapa,
        regra: "01/08 — entrou no Board vai para etiquetas",
      },
      nome: nome.toUpperCase(),
      ordem_fila: null,
      origem: "prevenda",
      origem_ref: linha.entity_id,
      pago_em: null,
    },
  });
}

const contarPorEtapa = (lista, campo) => {
  const mapa = {};
  for (const item of lista) {
    const k = campo(item);
    mapa[k] = (mapa[k] ?? 0) + 1;
  }
  return Object.entries(mapa).sort((a, b) => b[1] - a[1]);
};

console.log(`\n${"=".repeat(58)}`);
console.log("A INSERIR, por etapa do Board:");
for (const [etapa, n] of contarPorEtapa(paraInserir, (i) => i.etapaEsteira)) {
  console.log(`  ${String(n).padStart(4)} · ${etapa}`);
}
console.log("-".repeat(58));
console.log(`  ${String(paraInserir.length).padStart(4)} · TOTAL a inserir`);
console.log(`  ${String(esteira.length - faltando.length).padStart(4)} · já estavam na fila`);
console.log(`  ${String(semNome.length).padStart(4)} · sem nome na entidade (não dá para etiquetar)`);
console.log("=".repeat(58));

if (semNome.length > 0) {
  console.log("\nSEM NOME (ficam de fora — precisa arrumar a ficha):");
  for (const s of semNome.slice(0, 15)) console.log(`  ${s.entityId} · ${s.etapa}`);
  if (semNome.length > 15) console.log(`  ... e mais ${semNome.length - 15}`);
}

if (!APLICAR) {
  console.log("\nENSAIO: nada foi gravado.");
  console.log("Para aplicar: node scripts/apolo/liberar-board-para-etiquetas.mjs --aplicar");
  process.exit(0);
}

// ------------------------------------------------------------------ gravação

// Em lotes para não fazer centenas de requisições no meio do evento; se um lote falhar, ele é
// refeito item a item — assim um único registro problemático não derruba os outros 49 e o resumo
// diz exatamente quem ficou de fora e por quê.
const inserir = async (registros) => {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/prometeu_credenciados`, {
    body: JSON.stringify(registros),
    headers: { ...cabecalhos, "Content-Type": "application/json", Prefer: "return=minimal" },
    method: "POST",
  });
  if (resp.ok) return null;
  return `${resp.status} ${(await resp.text()).slice(0, 200)}`;
};

const inseridos = [];
const falhas = [];
const LOTE = 50;
for (let i = 0; i < paraInserir.length; i += LOTE) {
  const lote = paraInserir.slice(i, i + LOTE);
  const erro = await inserir(lote.map((l) => l.registro));
  if (!erro) {
    inseridos.push(...lote);
  } else {
    for (const item of lote) {
      const e = await inserir([item.registro]);
      if (e) falhas.push({ erro: e, item });
      else inseridos.push(item);
    }
  }
  process.stdout.write(`\r  gravando... ${Math.min(i + LOTE, paraInserir.length)}/${paraInserir.length}`);
}
console.log("");

console.log(`\n${"=".repeat(58)}`);
console.log("RESULTADO");
console.log("-".repeat(58));
console.log("Inseridos, por etapa do Board:");
for (const [etapa, n] of contarPorEtapa(inseridos, (i) => i.etapaEsteira)) {
  console.log(`  ${String(n).padStart(4)} · ${etapa}`);
}
console.log("-".repeat(58));
console.log(`  ${String(inseridos.length).padStart(4)} · inseridos`);
console.log(`  ${String(esteira.length - faltando.length).padStart(4)} · já estavam na fila`);
console.log(`  ${String(semNome.length).padStart(4)} · sem nome (fora)`);
console.log(`  ${String(falhas.length).padStart(4)} · falharam`);
console.log("=".repeat(58));

if (falhas.length > 0) {
  console.log("\nFALHAS:");
  for (const [motivo, n] of contarPorEtapa(falhas, (f) => f.erro)) {
    console.log(`  ${String(n).padStart(4)} · ${motivo}`);
  }
  console.log("\nPrimeiras fichas que falharam:");
  for (const f of falhas.slice(0, 10)) {
    console.log(`  ${f.item.registro.entity_id} · ${f.item.etapaEsteira}`);
  }
}
