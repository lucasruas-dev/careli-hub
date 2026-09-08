// CARGA DA CARTEIRA DO VALE DO OURO - 2 — do espelho do LSoft para a tela de emissão.
//
//   node scripts/boletos/carregar-vale-do-ouro-2.mjs 2026-09            # ensaio, não grava
//   node scripts/boletos/carregar-vale-do-ouro-2.mjs 2026-09 --gravar
//
// ⚠️ IMPORTAR PARA `lsoft_parcelas` NÃO PÕE NADA NA TELA, e foi o passo que faltou em 08/09/2026.
// A tela de Boletos lê `boletos_parcelas` — uma tabela PRÓPRIA, alimentada por carga, uma linha por
// unidade e competência. As 619 parcelas do Vale do Ouro entraram no espelho do LSoft e a carteira
// de setembro nunca foi gerada: por isso a aba abriu com "A EMITIR R$ 0,00" enquanto o dado estava
// no banco o tempo todo. É o mesmo desenho do Garden e do Vale do Sol, que já têm as suas.
//
// ⚠️ A UNIDADE É A CHAVE DA COBRANÇA (unique de workspace + empreendimento + unidade + competência
// + SEQUÊNCIA, desde a 0146), e aqui ela mora em TEXTO LIVRE: a coluna `quadra` do espelho está
// NULA em 6 das 11 parcelas de setembro porque o importador não reconheceu a grafia. A quadra sai
// de `observacoes`.
//
// ⚠️ DUAS PARCELAS NA MESMA UNIDADE AGORA CABEM, E CONTINUAM SENDO UM FATO A CONFERIR. O LUCAS
// AGUIAR SOARES (Q10 L03) tem a mensal de R$ 1.666,67 no dia 10 e a ENTRADA de R$ 8.750,00 no dia
// 20, as duas em setembro/2026 — pedido do Lucas (08/09/2026): *"Cria duas linhas vou verificar,
// ae se for o caso fazemos emissão separado"*. Elas entram com sequências 1 e 2 e SAEM LISTADAS na
// tela do script: duas cobranças para a mesma pessoa no mesmo mês é coisa que alguém precisa ver.
//
// ⚠️ "QUADRA P10" É A QUADRA 10, e isto foi CONFERIDO, não deduzido: cruzando as dez unidades desta
// carteira com a planilha de lotes do Vitor, as dez batem uma a uma (LUCAS AGUIAR Q10-L3, RAMON
// Q10-L1, FERNANDO Q10-L4, LUCAS FRANCO Q10-L5, LIBERIO Q5-L7, THIAGO Q10-L2, AMANDA Q5-L8,
// FABRICIO Q5-L11, JOÃO PAULO Q10-L36, JONAS Q10-L37). O "P" é prefixo do LSoft, não outra quadra.
//
// ⚠️ E O QUE NÃO CASAR NÃO É ADIVINHADO: a linha sai marcada `unidade_incerta`, que é o que a tela
// usa para pedir conferência humana antes de emitir.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const RAIZ = path.resolve(process.cwd());
const req = createRequire(path.resolve(RAIZ, "apps/hub/package.json"));
const { createClient } = req("@supabase/supabase-js");

const competencia = process.argv[2];
const gravar = process.argv.includes("--gravar");

if (!/^\d{4}-\d{2}$/.test(String(competencia))) {
  throw new Error("informe a competência no formato AAAA-MM (ex.: 2026-09)");
}

const EMPREENDIMENTO = "vale-do-ouro-2"; // slug em lib/apolo/boletos/empreendimentos.ts
const CHAVE_LSOFT = "Vale do Ouro - 2"; // lsoft_parcelas.empreendimento
const WORKSPACE = "careli";

const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(RAIZ, "apps/hub/.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const sb = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } },
);

const [ano, mes] = competencia.split("-").map(Number);
const inicio = `${competencia}-01`;
const fim = new Date(Date.UTC(ano, mes, 1)).toISOString().slice(0, 10);

const { data: parcelas, error: erroParcelas } = await sb
  .from("lsoft_parcelas")
  .select("cliente_codigo, parcela_numero, parcela_total, vencimento, valor, paga, observacoes, lote, quadra")
  .eq("empreendimento", CHAVE_LSOFT)
  .gte("vencimento", inicio)
  .lt("vencimento", fim)
  .order("cliente_codigo");

if (erroParcelas) throw new Error(`lsoft_parcelas: ${erroParcelas.message}`);

const codigos = [...new Set((parcelas ?? []).map((p) => p.cliente_codigo))];
const { data: clientes, error: erroClientes } = await sb
  .from("lsoft_clientes")
  .select("codigo, nome, cpf_formatado, celular, telefone")
  .in("codigo", codigos);

if (erroClientes) throw new Error(`lsoft_clientes: ${erroClientes.message}`);
const porCodigo = new Map((clientes ?? []).map((c) => [c.codigo, c]));

/**
 * A quadra, do campo próprio ou do texto livre.
 *
 * ⚠️ O PREFIXO DE LETRA CAI FORA. "QUADRA P10" e "QUADRA: 10" são a mesma quadra — conferido contra
 * a planilha de lotes, dez de dez. Sem isto, seis das onze unidades sairiam sem quadra e duas
 * quadras diferentes com o mesmo lote colidiriam na chave da cobrança.
 */
function quadraDaLinha(p) {
  const doCampo = String(p.quadra ?? "").trim();
  if (doCampo) return doCampo.replace(/^[A-Za-z]+/, "").trim() || doCampo;

  const m = /QUADRA\s*:?\s*([A-Za-z]?\d+)/i.exec(String(p.observacoes ?? ""));
  if (!m) return "";
  return String(m[1]).replace(/^[A-Za-z]+/, "").trim();
}

function loteDaLinha(p) {
  const doCampo = String(p.lote ?? "").trim();
  if (doCampo) return doCampo;
  const m = /LOTE\s*:?\s*(\d+)/i.exec(String(p.observacoes ?? ""));
  return m ? String(m[1]).trim() : "";
}

const linhas = [];
/** unidade -> as parcelas dela nesta competência. Mais de uma = duas cobranças no mesmo mês. */
const porUnidade = new Map();

for (const p of parcelas ?? []) {
  const cliente = porCodigo.get(p.cliente_codigo);
  const quadra = quadraDaLinha(p);
  const lote = loteDaLinha(p);
  // O formato de unidade das carteiras de loteamento: "Q10 L03".
  const unidade = quadra && lote ? `Q${quadra.padStart(2, "0")} L${lote.padStart(2, "0")}` : "";

  const linha = {
    bloqueio: p.paga ? "parcela já paga no LSoft" : null,
    clienteCodigo: p.cliente_codigo,
    competencia,
    contato: String(cliente?.celular ?? cliente?.telefone ?? "").trim() || null,
    documento: String(cliente?.cpf_formatado ?? "").replace(/\D/g, ""),
    empreendimento: EMPREENDIMENTO,
    nome: String(cliente?.nome ?? "").trim(),
    observacoes: String(p.observacoes ?? "").trim(),
    parcelaAtual: p.parcela_numero,
    totalParcelas: p.parcela_total,
    unidade,
    unidadeIncerta: !unidade,
    valor: Number(p.valor),
    vencimentoDia: Number(String(p.vencimento).slice(8, 10)),
    workspace: WORKSPACE,
  };

  const chave = `${linha.unidade}`;
  if (!porUnidade.has(chave)) porUnidade.set(chave, []);
  porUnidade.get(chave).push(linha);
  linhas.push(linha);
}

/**
 * O rótulo que a tela mostra ao lado da unidade quando há mais de uma cobrança no mês.
 *
 * ⚠️ SAI DO TEXTO LIVRE DO LSOFT, e é a única fonte que existe. `observacoes` traz "LOTE: 3 QUADRA
 * P10 VALE DO OURO ENTRADA" na parcela de R$ 8.750,00 e "... 60X 1666,67" na mensal. Deduzir da
 * contagem seria adivinhar: "3 de 4" não diz por si que é entrada.
 *
 * ⚠️ NULO QUANDO A UNIDADE TEM UMA SÓ. Rótulo em linha que não disputa nada é ruído, e ruído em
 * tela de cobrança é o que faz o operador parar de ler os avisos.
 */
function rotuloDaLinha(linha, quantasNaUnidade) {
  if (quantasNaUnidade < 2) return null;
  const obs = linha.observacoes.toUpperCase();
  if (/\bENTRADA\b/.test(obs)) return "Entrada";
  if (/\bSINAL\b/.test(obs)) return "Sinal";
  if (/\bINTERCALADA\b/.test(obs)) return "Intercalada";
  if (/\bANUAL\b/.test(obs)) return "Anual";
  return "Mensal";
}

// ⚠️ A SEQUÊNCIA NASCE AQUI, E A ORDEM É A DO VENCIMENTO. Ela é o discriminador da chave única: a
// mensal do dia 10 fica com 1 e a entrada do dia 20 com 2. Ordenar por vencimento (e por valor
// quando o dia empata) faz a mesma carga rodada duas vezes atribuir as MESMAS sequências — sem
// isso, a segunda rodada trocaria as duas de lugar e o upsert escreveria o valor de uma na outra.
for (const [, doGrupo] of porUnidade) {
  doGrupo.sort((a, b) => a.vencimentoDia - b.vencimentoDia || a.valor - b.valor);
  doGrupo.forEach((linha, i) => {
    linha.sequencia = i + 1;
    linha.rotulo = rotuloDaLinha(linha, doGrupo.length);
  });
}

console.log(`\nCARTEIRA ${EMPREENDIMENTO} · competência ${competencia}`);
console.log(`${linhas.length} parcelas, ${codigos.length} clientes.\n`);

console.log("UNIDADE     CLIENTE                          VALOR         VENC  PARC     CPF");
for (const l of linhas.sort(
  (a, b) => a.unidade.localeCompare(b.unidade) || a.sequencia - b.sequencia,
)) {
  console.log(
    `${(l.unidade || "(SEM UNIDADE)").padEnd(11)} ${l.nome.slice(0, 30).padEnd(32)} ` +
      `${("R$ " + l.valor.toFixed(2)).padStart(12)}  dia ${String(l.vencimentoDia).padStart(2)}  ` +
      `${String(l.parcelaAtual).padStart(3)}/${String(l.totalParcelas).padEnd(3)} ` +
      `${l.documento ? l.documento.length === 11 ? "CPF ok" : "CNPJ" : "SEM DOC"}` +
      `${l.contato ? "" : "  SEM CONTATO"}` +
      `${l.rotulo ? `  [${l.rotulo} · seq ${l.sequencia}]` : ""}`,
  );
}

// ⚠️ AS DUAS ENTRAM, E CONTINUAM SENDO UM FATO VISÍVEL. A chave única ganhou `sequencia` na 0146,
// então a mensal e a entrada da mesma unidade cabem — mas duas cobranças para a mesma pessoa no
// mesmo mês é exatamente o que a trava existe para NÃO acontecer por acidente. Gravar em silêncio
// seria trocar um erro barulhento por um erro calado.
const duplicadas = [...porUnidade.entries()].filter(([, v]) => v.length > 1);
if (duplicadas.length > 0) {
  console.log("\n⚠️ MAIS DE UMA COBRANÇA NA MESMA UNIDADE — as duas entram, CONFIRA se é isso:");
  for (const [unidade, itens] of duplicadas) {
    console.log(`  ${unidade} · ${itens[0].nome}`);
    for (const i of itens) {
      console.log(
        `     seq ${i.sequencia} · ${String(i.rotulo ?? "—").padEnd(11)} · ` +
          `R$ ${i.valor.toFixed(2)} · vence dia ${i.vencimentoDia} · ${i.observacoes}`,
      );
    }
  }
}

const semUnidade = linhas.filter((l) => !l.unidade);
if (semUnidade.length > 0) {
  console.log(`\n⚠️ ${semUnidade.length} sem unidade resolvida (entram marcadas para conferência).`);
}

if (!gravar) {
  console.log("\nENSAIO — nada foi gravado. Rode de novo com --gravar.");
  process.exit(0);
}

// ⚠️ `--pular-conflitos` VIROU ESCAPE, E NÃO O CAMINHO NORMAL. Antes da 0146 a segunda parcela não
// cabia na tabela e a flag era o que deixava as nove unidades limpas entrarem enquanto a disputada
// esperava decisão humana. Agora as duas entram; a flag continua existindo para quem quiser gravar
// só o incontroverso — e, se usada, diz em voz alta o que ficou de fora.
const pularConflitos = process.argv.includes("--pular-conflitos");
const unidadesEmConflito = new Set(
  pularConflitos ? duplicadas.map(([unidade]) => unidade) : [],
);

const aGravar = linhas.filter((l) => !unidadesEmConflito.has(l.unidade));

if (unidadesEmConflito.size > 0) {
  console.log(
    `\n--pular-conflitos: deixando de fora ${unidadesEmConflito.size} unidade(s) com mais de uma ` +
      `cobrança: ${[...unidadesEmConflito].join(", ")}`,
  );
} else if (duplicadas.length > 0) {
  console.log(
    `\nGravando as ${duplicadas.reduce((a, [, v]) => a + v.length, 0)} cobranças das ` +
      `${duplicadas.length} unidade(s) acima — cada uma com a sua sequência.`,
  );
}

const paraParcelas = aGravar.map((l) => ({
  bloqueio: l.bloqueio,
  competencia: l.competencia,
  empreendimento: l.empreendimento,
  nome: l.nome,
  origem: "lsoft",
  parcela_atual: l.parcelaAtual,
  rotulo: l.rotulo,
  sequencia: l.sequencia,
  total_parcelas: l.totalParcelas,
  unidade: l.unidade,
  unidade_incerta: l.unidadeIncerta,
  valor: l.valor,
  vencimento_dia: l.vencimentoDia,
  workspace_id: l.workspace,
}));

// ⚠️ O `onConflict` PRECISA SER A CHAVE ÚNICA INTEIRA. Com a lista antiga (sem `sequencia`) o
// PostgREST não acha o índice e devolve erro; pior seria se achasse um índice parcial, porque aí a
// segunda cobrança entraria como linha nova a cada rodada.
const { error: erroGravar } = await sb
  .from("boletos_parcelas")
  .upsert(paraParcelas, {
    onConflict: "workspace_id,empreendimento,unidade,competencia,sequencia",
  });
if (erroGravar) throw new Error(`boletos_parcelas: ${erroGravar.message}`);

// O documento é da PESSOA e vive por unidade — é o que o boleto usa como pagador.
//
// ⚠️ UMA LINHA POR UNIDADE, E ISSO DEIXOU DE SER AUTOMÁTICO. Com duas cobranças na mesma unidade, o
// `map` direto produz o MESMO cadastro duas vezes no mesmo upsert, e o Postgres recusa o lote
// inteiro: "ON CONFLICT DO UPDATE command cannot affect row a second time". Não é aviso, é a carga
// não acontecendo.
const cadastroPorUnidade = new Map();
for (const l of aGravar) {
  if (!l.unidade || !l.documento) continue;
  if (cadastroPorUnidade.has(l.unidade)) continue;
  cadastroPorUnidade.set(l.unidade, {
    contato: l.contato,
    documento: l.documento,
    empreendimento: l.empreendimento,
    nome: l.nome,
    unidade: l.unidade,
    workspace_id: l.workspace,
  });
}
const paraDocumentos = [...cadastroPorUnidade.values()];

const { error: erroDocs } = await sb
  .from("boletos_documentos")
  .upsert(paraDocumentos, { onConflict: "workspace_id,empreendimento,unidade" });
if (erroDocs) throw new Error(`boletos_documentos: ${erroDocs.message}`);

console.log(
  `\nPronto: ${paraParcelas.length} parcelas e ${paraDocumentos.length} documentos na carteira.`,
);
