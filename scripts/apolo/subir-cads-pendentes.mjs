// Sobe para o C2X as CADs que ainda NÃO estão lá.
//
// Uso (da raiz do repo, com `npm --prefix apps/hub run dev` no ar):
//   node scripts/apolo/subir-cads-pendentes.mjs                  -> ENSAIO: quem sobe, quem trava e por quê
//   node scripts/apolo/subir-cads-pendentes.mjs --enviar --n=5   -> envia 5 de verdade, uma a uma
//   node scripts/apolo/subir-cads-pendentes.mjs --enviar         -> envia todas as PRONTAS
//   node scripts/apolo/subir-cads-pendentes.mjs --app=https://c2x.app.br   -> aponta para outro app
//
// ── AS TRÊS DECISÕES DE DESENHO, E O PORQUÊ ───────────────────────────────────────────────────
//
// 1. QUEM DECIDE QUEM ESTÁ PRONTA É O SERVIDOR, NUNCA ESTE ARQUIVO.
//    A separação PRONTA/BLOQUEADA sai de POST /api/apolo/c2x-sync/lote com `dryRun`, que é a mesma
//    chamada que o botão do card e o envio automático ao credenciar usam por baixo. Reimplementar
//    aqui a lista de obrigatórios criaria uma segunda regra de negócio, que um dia mudaria de um
//    lado só — e o lado errado subiria ficha incompleta para o sistema de CONTRATOS.
//    O que este script faz sozinho é só LEITURA de estado (quem tem id no C2X, quem tem linha na
//    fila), para o raio-x que a rota não devolve.
//
// 2. O ENSAIO É O PADRÃO, E O DESTINO APARECE ANTES DE QUALQUER ENVIO.
//    Criar cliente no C2X não tem desfazer: o endpoint é o genérico `POST /api/v1/users`, que CRIA
//    DE NOVO a cada chamada. Em 28/jul e 01/08 a env `C2X_WRITE_API_URL` apontava para
//    `teste.careli.adm.br` e 8 cadastros "subiram com sucesso" para o lugar errado — é daí que vêm
//    os casos de "a API respondeu sucesso, mas o usuário não foi encontrado no banco do C2X".
//    Por isso o host vem da RESPOSTA do servidor (o valor que ele realmente vai usar, não um chute
//    do script), aparece em banner, e o envio real ABORTA se ele não for o de produção.
//
// 3. A CONFERÊNCIA É NO BANCO, NÃO NA RESPOSTA DA API.
//    A API dizer "criei" não é prova de que criou. Depois do envio o script lê o MySQL de PRODUÇÃO
//    do C2X (read-only, pelo CPF) e conta quantos dos enviados existem lá de verdade. É a única
//    checagem que teria pego o incidente acima no mesmo dia.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// ── argumentos ────────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const enviarDeVerdade = args.includes("--enviar");
const viaLote = args.includes("--via-lote");
const forcarDestino = args.includes("--forcar-destino");
const semBanco = args.includes("--sem-banco");
const argN = args.find((a) => a.startsWith("--n="));
const maxEnvios = argN ? Number(argN.slice(4)) : undefined;

if (argN && (!Number.isFinite(maxEnvios) || maxEnvios <= 0)) {
  console.error(`ERRO: --n= precisa ser um número maior que zero. Recebi "${argN.slice(4)}".`);
  process.exit(1);
}

// O APP do hub (quem tem a regra e as envs), não o C2X. Padrão: o dev local.
const APP = (args.find((a) => a.startsWith("--app="))?.slice(6) || "http://127.0.0.1:3001").replace(/\/+$/, "");

// O host do C2X de PRODUÇÃO, escrito por extenso. Serve de gabarito: o script compara o que o
// servidor diz que vai usar contra isto aqui, e recusa o envio quando os dois não batem.
const C2X_PRODUCAO = "sistema.careli.adm.br";

// ── env ───────────────────────────────────────────────────────────────────────────────────────
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
const SECRET = env.CRON_SECRET;
for (const [nome, valor] of [
  ["NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY],
  ["CRON_SECRET", SECRET],
]) {
  if (!valor) {
    console.error(`ERRO: falta ${nome} em apps/hub/.env.local.`);
    process.exit(1);
  }
}

// ── leitura do Apolo (Supabase REST, service role) ─────────────────────────────────────────────
async function ler(tabela, query) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${query}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!resp.ok) throw new Error(`${tabela}: ${resp.status} ${(await resp.text()).slice(0, 200)}`);
  return resp.json();
}

// O PostgREST corta em 1000 linhas por resposta; sem paginar, uma tabela de 651 CADs hoje vira
// silêncio no dia em que passar de mil.
async function lerTudo(tabela, query) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const bloco = await ler(tabela, `${query}&limit=1000&offset=${offset}`);
    out.push(...bloco);
    if (bloco.length < 1000) return out;
  }
}

// `.in()` com centenas de uuids estoura o tamanho da URL do PostgREST e volta 400. Blocos de 100.
async function lerPorIds(tabela, query, ids, coluna = "entity_id") {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const bloco = ids.slice(i, i + 100);
    out.push(...(await ler(tabela, `${query}&${coluna}=in.(${bloco.join(",")})`)));
  }
  return out;
}

// ── a rota que tem a regra ─────────────────────────────────────────────────────────────────────
async function chamarApp(caminho, corpo) {
  let resp;
  try {
    resp = await fetch(`${APP}${caminho}`, {
      body: JSON.stringify(corpo),
      headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
      method: "POST",
    });
  } catch (erro) {
    console.error(`ERRO: não consegui falar com ${APP} (${erro.message}).`);
    console.error(`      O servidor está no ar? (npm --prefix apps/hub run dev)`);
    process.exit(1);
  }
  const texto = await resp.text();
  if (!resp.ok) {
    console.error(`ERRO HTTP ${resp.status} em ${caminho}: ${texto.slice(0, 300)}`);
    process.exit(1);
  }
  const json = JSON.parse(texto);
  return json.data ?? json;
}

const soDigitos = (v) => String(v ?? "").replace(/\D+/g, "");
const corta = (v, n) => (String(v ?? "").length > n ? `${String(v).slice(0, n - 1)}…` : String(v ?? ""));

// ── o banco de PRODUÇÃO do C2X (read-only) ────────────────────────────────────────────────────
// Quais destes documentos JÁ existem como usuário no C2X. É a única fonte que não mente: a fila
// `apolo_c2x_sync` só tem linha para quem passou por um envio nosso, e a resposta da API dizer
// "criei" não prova que criou. Mesma comparação do servidor (`lerIdC2xPorDocumento`): só dígitos
// dos dois lados, porque no C2X o cpf/cnpj pode estar com ou sem máscara.
// Devolve `null` quando não deu para consultar — quem chama distingue "não achei" de "não perguntei".
async function documentosNoC2x(documentos) {
  const limpos = [...new Set(documentos.map(soDigitos).filter(Boolean))];
  if (limpos.length === 0) return new Set();
  try {
    const requireDoRepo = createRequire(path.join(raizApp, "package.json"));
    const mysql = requireDoRepo("mysql2/promise");
    const conexao = await mysql.createConnection({
      database: env.GUARDIAN_DB_NAME,
      dateStrings: true,
      host: env.GUARDIAN_DB_HOST,
      password: env.GUARDIAN_DB_PASSWORD,
      port: Number(env.GUARDIAN_DB_PORT || 3306),
      user: env.GUARDIAN_DB_USER,
    });
    const semMascara = (col) =>
      `REPLACE(REPLACE(REPLACE(REPLACE(${col},'.',''),'-',''),'/',''),' ','')`;
    const achados = new Set();
    // Em blocos: um IN com centenas de valores é pesado, e o legado é de produção.
    for (let i = 0; i < limpos.length; i += 200) {
      const bloco = limpos.slice(i, i + 200);
      const marcadores = bloco.map(() => "?").join(",");
      const [linhas] = await conexao.query(
        `SELECT ${semMascara("cpf")} AS doc FROM users WHERE ${semMascara("cpf")} IN (${marcadores})
         UNION SELECT ${semMascara("cnpj")} AS doc FROM users WHERE ${semMascara("cnpj")} IN (${marcadores})`,
        [...bloco, ...bloco],
      );
      for (const l of linhas) achados.add(String(l.doc));
    }
    await conexao.end();
    return achados;
  } catch (erro) {
    console.log(`(Não deu para consultar o banco do C2X: ${erro.message})`);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 1. RAIO-X: quem está fora do C2X
// ══════════════════════════════════════════════════════════════════════════════════════════════
console.log("Lendo o Apolo...");

const cads = await lerTudo("apolo_esteira", "select=entity_id,empreendimento,etapa,atualizado_em");
const fila = await lerTudo("apolo_c2x_sync", "select=entity_id,status,c2x_user_id,erro,enviado_em");

// Uma pessoa pode ter mais de uma CAD (uma por empreendimento), e o envio ao C2X é por PESSOA.
// Por isso o raio-x conta os dois: CADs (o que o time vê no Board) e entidades (o que sobe).
const entityIds = [...new Set(cads.map((c) => c.entity_id).filter(Boolean))];

const filaPorEntidade = new Map(fila.map((f) => [f.entity_id, f]));
// "Está no C2X" = tem id de usuário lá. Status "resolvido" sem id NÃO conta: é exatamente o
// sintoma do envio para o ambiente errado.
const temIdNoC2x = new Set(fila.filter((f) => f.c2x_user_id != null).map((f) => f.entity_id));

// Só os campos escalares do metadata: o `metadata` inteiro carrega a ficha de cadastro completa de
// 651 pessoas, e nada aqui precisa dela.
const entidades = await lerPorIds(
  "apolo_entities",
  "select=id,display_name,document_masked,entity_kind," +
    "origem:metadata->>source,sincronizada:metadata->>c2xSynced," +
    "confirmada:metadata->>c2xConfirmado,papel:metadata->>bornRole",
  entityIds,
  "id",
);
const porEntidade = new Map(entidades.map((e) => [e.id, e]));

// Sem id na nossa fila. Cuidado: isto NÃO quer dizer "não está no C2X". A fila só ganha linha
// quando NÓS enviamos; quem nasceu no próprio C2X e veio para o Apolo pelo sync está lá desde
// sempre e nunca teve linha aqui. Confundir os dois inflava a conta de pendentes em mais de 100
// pessoas — e mandaria o time caçar cadastro que já existe.
const semIdNaFila = entityIds.filter((id) => !temIdNoC2x.has(id));

// A prova vem do banco de produção do C2X, pelo documento. `null` = não deu para perguntar.
const documentosDeCandidatos = semIdNaFila.map((id) => porEntidade.get(id)?.document_masked);
const achadosNoC2x = semBanco ? null : await documentosNoC2x(documentosDeCandidatos);

const estaNoC2x = (id) => {
  if (temIdNoC2x.has(id)) return true;
  if (!achadosNoC2x) return false;
  const doc = soDigitos(porEntidade.get(id)?.document_masked);
  return Boolean(doc) && achadosNoC2x.has(doc);
};

const foraDoC2x = semIdNaFila.filter((id) => !estaNoC2x(id));
const laSemRastro = semIdNaFila.filter((id) => estaNoC2x(id));
const conjuntoFora = new Set(foraDoC2x);
const cadsForaDoC2x = cads.filter((c) => conjuntoFora.has(c.entity_id));

console.log(`\nCADs na esteira: ${cads.length} · pessoas distintas: ${entityIds.length}`);
console.log(`Já no C2X: ${entityIds.length - foraDoC2x.length}`);
console.log(`  com id gravado na nossa fila ......... ${temIdNoC2x.size}`);
console.log(
  `  achadas no banco do C2X pelo documento ${String(laSemRastro.length).padStart(3)} ` +
    `(nunca passaram pela nossa fila${achadosNoC2x ? "" : " — NÃO CONFERIDO, banco indisponível"})`,
);
console.log(`FORA do C2X: ${foraDoC2x.length} pessoas (${cadsForaDoC2x.length} CADs)`);

const nuncaTentadas = foraDoC2x.filter((id) => !filaPorEntidade.has(id));
const recusadas = foraDoC2x.filter((id) => filaPorEntidade.get(id)?.status === "erro");
// O caso perigoso: carimbada como enviada, sem id no C2X. Reenviar por fora criaria DUPLICADO —
// o desbloqueio é manual, com o dono junto.
const semConfirmacao = foraDoC2x.filter((id) => {
  const linha = filaPorEntidade.get(id);
  const ent = porEntidade.get(id);
  return linha?.status === "sem_confirmacao" || ent?.confirmada === "false";
});
console.log(
  `  nunca tentadas: ${nuncaTentadas.length} · recusadas pela API: ${recusadas.length}` +
    ` · enviadas sem confirmação: ${semConfirmacao.length}`,
);

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 2. A REGRA DO SERVIDOR: prontas x bloqueadas
// ══════════════════════════════════════════════════════════════════════════════════════════════
const ensaio = await chamarApp("/api/apolo/c2x-sync/lote", { dryRun: true });
const resumo = ensaio.resumo ?? {};
const itens = ensaio.itens ?? [];

const destinoOk = ensaio.hostDestino === C2X_PRODUCAO;
console.log(`\n╔══════════════════════════════════════════════════════════`);
console.log(`║  DESTINO DA ESCRITA: ${ensaio.hostDestino}`);
console.log(`║  ${destinoOk ? `É o C2X de PRODUÇÃO (${C2X_PRODUCAO}).` : `ATENÇÃO: NÃO é o C2X de produção (${C2X_PRODUCAO})!`}`);
console.log(`║  (valor lido do servidor em ${APP}, não do .env deste script)`);
console.log(`╚══════════════════════════════════════════════════════════`);

// O lote parte de `apolo_entities`, não da esteira: pode haver candidata sem CAD, que o raio-x
// não leu. Sem completar o mapa, essa ficha ficaria sem documento e escaparia da checagem abaixo.
const semNoMapa = itens.map((i) => i.entityId).filter((id) => !porEntidade.has(id));
if (semNoMapa.length > 0) {
  const extras = await lerPorIds(
    "apolo_entities",
    "select=id,display_name,document_masked,entity_kind," +
      "origem:metadata->>source,sincronizada:metadata->>c2xSynced," +
      "confirmada:metadata->>c2xConfirmado,papel:metadata->>bornRole",
    semNoMapa,
    "id",
  );
  for (const e of extras) porEntidade.set(e.id, e);
  // Sem esta linha o relatório não fecha: a conta de "fora do C2X" é feita sobre quem tem CAD na
  // esteira, e a fila de envio parte das entidades. Quem existe de um lado e não do outro tem que
  // aparecer, senão a diferença vira desconfiança no número.
  console.log(`(${extras.length} candidatas do servidor não têm CAD na esteira — entram na fila do mesmo jeito.)`);
}

const faltando = itens.filter((i) => i.status === "faltando");
const conferir = itens.filter((i) => i.status === "conferir");
const bloqueadas = [...faltando, ...conferir];

// ⚠️ A TERCEIRA TRAVA, E ELA NÃO EXISTE NO SERVIDOR.
//
// O lote considera candidata toda ficha com `metadata.c2xSynced !== true`. Esse carimbo só é
// escrito por um envio NOSSO — quem já existe no C2X por outro caminho (nasceu lá, ou foi criado à
// mão) não tem carimbo nenhum e entra na fila como se fosse nova. O endpoint de escrita é o
// genérico `POST /api/v1/users`, que CRIA DE NOVO a cada chamada: mandar essa ficha é criar um
// cliente DUPLICADO em produção, sem desfazer.
// Por isso, antes de qualquer envio, o documento de cada PRONTA é procurado no banco do C2X. Quem
// já está lá sai da lista e aparece nomeada, para alguém decidir o que fazer — não some.
const prontasBrutas = itens.filter((i) => i.status === "pronta");
const docDaPronta = (i) => soDigitos(porEntidade.get(i.entityId)?.document_masked);
const jaExistemNoC2x = semBanco ? null : await documentosNoC2x(prontasBrutas.map(docDaPronta));
const prontasQueJaEstaoLa = jaExistemNoC2x
  ? prontasBrutas.filter((i) => jaExistemNoC2x.has(docDaPronta(i)))
  : [];
const prontas = prontasBrutas.filter((i) => !prontasQueJaEstaoLa.includes(i));

console.log(`\nO servidor olhou ${resumo.total ?? itens.length} fichas candidatas e disse:`);
console.log(`  PRONTAS pela regra do servidor ....... ${prontasBrutas.length}`);
console.log(`  BLOQUEADAS por campo faltando ........ ${faltando.length}`);
console.log(`  BLOQUEADAS para conferir identidade .. ${conferir.length}`);
if (prontasQueJaEstaoLa.length > 0) {
  console.log(
    `\nDESTAS PRONTAS, ${prontasQueJaEstaoLa.length} JÁ EXISTEM no C2X (achadas pelo documento) e foram` +
      `\nTIRADAS da lista: reenviar criaria cliente duplicado, que não tem desfazer.`,
  );
  for (const i of prontasQueJaEstaoLa) {
    const e = porEntidade.get(i.entityId) ?? {};
    console.log(`  · ${corta(i.nome || e.display_name, 42).padEnd(42)} ${e.document_masked ?? ""}`);
  }
}
console.log(`\n  SOBEM DE VERDADE ..................... ${prontas.length}`);

// As que estão fora do C2X e o servidor NEM LISTOU como candidatas. Sem isto elas somem da conta:
// não estão no C2X e também não aparecem em lugar nenhum do relatório.
const listadas = new Set(itens.map((i) => i.entityId));
const foraDaFila = foraDoC2x.filter((id) => !listadas.has(id));
if (foraDaFila.length > 0) {
  console.log(`  FORA DA FILA (o servidor não as considera) ... ${foraDaFila.length}`);
  const motivos = new Map();
  for (const id of foraDaFila) {
    const e = porEntidade.get(id) ?? {};
    const motivo =
      e.confirmada === "false" || filaPorEntidade.get(id)?.status === "sem_confirmacao"
        ? "carimbada como enviada, mas sem id no C2X (reenvio manual: repetir criaria duplicado)"
        : e.sincronizada === "true"
          ? "carimbada como sincronizada (metadata.c2xSynced)"
          : e.origem !== "apolo"
            ? `ficha com source "${e.origem ?? "vazio"}" (não nasceu no Apolo): a fila de envio não a considera`
            : `papel "${e.papel ?? "sem papel"}" não sobe pela fila de cliente, ou ficha sem cadastro`;
    motivos.set(motivo, (motivos.get(motivo) ?? 0) + 1);
  }
  for (const [motivo, qtd] of [...motivos].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(qtd).padStart(3)} × ${motivo}`);
  }
}

// ── o que trava as bloqueadas, agrupado por campo ─────────────────────────────────────────────
const porCampo = new Map();
for (const i of faltando) for (const f of i.faltantes ?? []) porCampo.set(f, (porCampo.get(f) ?? 0) + 1);
if (porCampo.size > 0) {
  console.log(`\nO que falta nas ${faltando.length} bloqueadas — a lista de trabalho do time:`);
  for (const [campo, qtd] of [...porCampo].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(qtd).padStart(3)} × ${campo}`);
  }
}
if (conferir.length > 0) {
  const porDivergencia = new Map();
  for (const i of conferir) {
    for (const d of i.divergencias ?? []) porDivergencia.set(d, (porDivergencia.get(d) ?? 0) + 1);
  }
  console.log(`\nAs ${conferir.length} de "conferir" (importação e ficha discordam sobre a pessoa):`);
  for (const [d, qtd] of [...porDivergencia].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(qtd).padStart(3)} × ${corta(d, 90)}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 3. EXEMPLO DO CORPO QUE SAIRIA
// ══════════════════════════════════════════════════════════════════════════════════════════════
// A montagem do payload mora no servidor (lib/apolo/c2x-write.ts) e não é exposta por nenhuma
// rota; refazê-la aqui seria a segunda regra que o item 1 do cabeçalho proíbe. Então o exemplo sai
// do rastro REAL: `apolo_c2x_sync.requisicao` é o corpo gravado imediatamente antes do POST (já
// sem senha, é o `payloadParaAuditoria`). Preferimos o de uma ficha que está PRONTA agora — é
// literalmente o corpo que ela mandou da última vez.
const idsComRastro = prontas.map((p) => p.entityId);
let exemplo = null;
if (idsComRastro.length > 0) {
  const rastros = await lerPorIds(
    "apolo_c2x_sync",
    "select=entity_id,requisicao,atualizado_em&requisicao=not.is.null",
    idsComRastro,
  );
  const escolhido = rastros.sort((a, b) => String(b.atualizado_em).localeCompare(String(a.atualizado_em)))[0];
  if (escolhido) {
    exemplo = {
      corpo: escolhido.requisicao,
      nome: porEntidade.get(escolhido.entity_id)?.display_name ?? "",
      quando: escolhido.atualizado_em,
    };
  }
}

// CPF, e-mail e telefone saem MASCARADOS: o exemplo existe para conferir a FORMA do corpo (quais
// campos vão, quais ids), e esta saída vai para relatório e para grupo de trabalho.
function mascarar(valor, chave) {
  const k = chave.toLowerCase();
  const s = String(valor);
  // `identification_number` é o CPF/CNPJ do signatário — o campo mais fácil de esquecer, porque não
  // se chama cpf. `documentoId` fica de fora de propósito: é uuid do nosso Storage, não documento.
  if (/^(cpf|cnpj|documento)$/.test(k) || /identification_number/.test(k)) {
    return s.replace(/\d(?=\d{2})/g, "•");
  }
  if (/mail/.test(k)) return s.replace(/^[^@]*/, (u) => `${u.slice(0, 2)}${"•".repeat(Math.max(0, u.length - 2))}`);
  if (/(phone|cell|telefone)/.test(k)) return s.replace(/\d(?=\d{4})/g, "•");
  if (/(password|senha|token)/.test(k)) return "•••";
  return s;
}
function limpar(v, chave = "") {
  if (Array.isArray(v)) return v.map((x) => limpar(x, chave));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, limpar(val, k)]));
  }
  return typeof v === "string" ? mascarar(v, chave) : v;
}

if (exemplo) {
  console.log(`\nExemplo do corpo que sai (última requisição gravada de "${corta(exemplo.nome, 40)}",`);
  console.log(`de ${exemplo.quando} — CPF, e-mail e telefone mascarados aqui, não no envio):`);
  console.log(JSON.stringify(limpar(exemplo.corpo), null, 2));
} else {
  console.log(`\n(Nenhuma das prontas tem requisição gravada em apolo_c2x_sync — todas são primeira tentativa.)`);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 4. ENSAIO TERMINA AQUI
// ══════════════════════════════════════════════════════════════════════════════════════════════
if (!enviarDeVerdade) {
  console.log(`\n── ENSAIO: NADA FOI ENVIADO ──`);
  console.log(
    `Iriam agora: ${prontas.length} · ficariam para trás: ${bloqueadas.length} bloqueadas` +
      ` + ${prontasQueJaEstaoLa.length} que já existem no C2X`,
  );
  for (const p of prontas.slice(0, 10)) {
    const e = porEntidade.get(p.entityId) ?? {};
    console.log(`  · ${corta(p.nome || e.display_name, 42).padEnd(42)} ${e.document_masked ?? ""}`);
  }
  if (prontas.length > 10) console.log(`  · ... e mais ${prontas.length - 10}`);
  console.log(`\nPara enviar de verdade, comece por um punhado:`);
  console.log(`  node scripts/apolo/subir-cads-pendentes.mjs --enviar --n=5`);
  process.exit(0);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 5. ENVIO — só as PRONTAS, uma a uma
// ══════════════════════════════════════════════════════════════════════════════════════════════
// A trava que faltava no incidente: destino errado não passa. `--forcar-destino` existe para o dia
// em que o host de produção mudar de nome, e é uma decisão consciente de quem digita.
if (!destinoOk && !forcarDestino) {
  console.error(`\nABORTADO: o servidor mandaria para "${ensaio.hostDestino}", que não é ${C2X_PRODUCAO}.`);
  console.error(`Corrija C2X_WRITE_API_URL no ambiente do app (${APP}) antes de enviar.`);
  console.error(`Foi exatamente assim que 8 cadastros foram parar no ambiente de teste.`);
  process.exit(1);
}

// A lista de envio sai EXCLUSIVAMENTE dos itens que o servidor marcou como "pronta". Bloqueada
// nunca entra — e mesmo se entrasse, a rota roda o diagnóstico de novo por ficha e a recusaria.
const lote = prontas.slice(0, maxEnvios ?? prontas.length);
console.log(`\nEnviando ${lote.length} de ${prontas.length} prontas para ${ensaio.hostDestino}...\n`);

const enviadas = [];
const falhas = [];

if (viaLote) {
  // Caminho alternativo: a rota de LOTE, que não passa pela trava `C2X_ENVIO_CARD_LIBERADO` do
  // botão do card. Serve para disparar a carga sem liberar o botão para todos os operadores.
  const r = await chamarApp("/api/apolo/c2x-sync/lote", { dryRun: false, maxEnvios: lote.length });
  for (const i of r.itens ?? []) {
    if (i.status === "enviada" || i.status === "duplicada") enviadas.push(i);
    else if (i.status === "erro" || i.status === "sem_confirmacao") falhas.push(i);
  }
  for (const i of [...enviadas, ...falhas]) {
    const marca = i.status === "enviada" ? "[ok]  " : i.status === "duplicada" ? "[dup] " : "[ERRO]";
    console.log(`  ${marca} ${corta(i.nome, 40).padEnd(40)} ${corta(i.erro ?? "", 70)}`);
  }
} else {
  // Caminho normal: a MESMA rota do botão do card, uma ficha por chamada. Log por CAD, e o host de
  // destino volta em cada resposta.
  for (const [n, p] of lote.entries()) {
    const e = porEntidade.get(p.entityId) ?? {};
    const nome = corta(p.nome || e.display_name, 40).padEnd(40);
    const r = await chamarApp("/api/apolo/c2x-sync/enviar", { entityId: p.entityId });

    if (r.ensaio) {
      console.log(`  [ensaio] ${nome} nada foi enviado.`);
      console.error(
        `\nPAREI NA PRIMEIRA. O servidor está com o envio TRAVADO em ensaio:` +
          `\n  a env C2X_ENVIO_CARD_LIBERADO não está como "true" em ${APP}.` +
          `\nOu liga essa env (com o dono), ou roda por fora do botão:` +
          `\n  node scripts/apolo/subir-cads-pendentes.mjs --enviar --n=5 --via-lote`,
      );
      process.exit(1);
    }

    if (r.status === "enviada" || r.status === "duplicada") {
      enviadas.push({ ...r, nome: p.nome });
      console.log(
        `  [${r.status === "duplicada" ? "dup" : "ok"}] ${String(n + 1).padStart(3)}/${lote.length} ` +
          `${nome} ${r.hostDestino}${r.erro ? ` · ${corta(r.erro, 60)}` : ""}`,
      );
    } else {
      falhas.push({ ...r, nome: p.nome });
      console.log(`  [ERRO] ${String(n + 1).padStart(3)}/${lote.length} ${nome} ${corta(r.erro, 80)}`);
    }
  }
}

console.log(`\nAceitas pela API: ${enviadas.length} · falhas: ${falhas.length}`);

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 6. CONFERÊNCIA NO BANCO — a API dizer "criei" não é prova
// ══════════════════════════════════════════════════════════════════════════════════════════════
if (enviadas.length > 0 && !semBanco) {
  const documentos = enviadas
    .map((i) => soDigitos(porEntidade.get(i.entityId)?.document_masked))
    .filter(Boolean);

  const achados = await documentosNoC2x(documentos);
  if (achados) {
    const sumidos = documentos.filter((d) => !achados.has(d));
    console.log(
      `\nConferência no banco de PRODUÇÃO do C2X: ${documentos.length - sumidos.length} de ${documentos.length} enviados existem lá.`,
    );
    if (sumidos.length > 0) {
      console.log(
        `ATENÇÃO: ${sumidos.length} a API aceitou e o banco não tem. É o sintoma de escrita no` +
          `\nambiente errado. PARE a carga e confira C2X_WRITE_API_URL antes de mandar o resto.`,
      );
    }
  }
}

// E o próprio diagnóstico de novo: quantas prontas sobraram.
const depois = await chamarApp("/api/apolo/c2x-sync/lote", { dryRun: true });
console.log(
  `Sobraram ${(depois.itens ?? []).filter((i) => i.status === "pronta").length} prontas` +
    ` (antes do envio eram ${prontas.length}).`,
);
