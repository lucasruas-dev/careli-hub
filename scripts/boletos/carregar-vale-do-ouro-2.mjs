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
// ⚠️ A UNIDADE É A CHAVE DA COBRANÇA (unique de workspace + empreendimento + unidade + competência),
// e aqui ela mora em TEXTO LIVRE: a coluna `quadra` do espelho está NULA em 6 das 11 parcelas de
// setembro porque o importador não reconheceu a grafia. A quadra sai de `observacoes`.
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
const conflitos = new Map();

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
  if (!conflitos.has(chave)) conflitos.set(chave, []);
  conflitos.get(chave).push(linha);
  linhas.push(linha);
}

console.log(`\nCARTEIRA ${EMPREENDIMENTO} · competência ${competencia}`);
console.log(`${linhas.length} parcelas, ${codigos.length} clientes.\n`);

console.log("UNIDADE     CLIENTE                          VALOR         VENC  PARC     CPF");
for (const l of linhas.sort((a, b) => a.unidade.localeCompare(b.unidade))) {
  console.log(
    `${(l.unidade || "(SEM UNIDADE)").padEnd(11)} ${l.nome.slice(0, 30).padEnd(32)} ` +
      `${("R$ " + l.valor.toFixed(2)).padStart(12)}  dia ${String(l.vencimentoDia).padStart(2)}  ` +
      `${String(l.parcelaAtual).padStart(3)}/${String(l.totalParcelas).padEnd(3)} ` +
      `${l.documento ? l.documento.length === 11 ? "CPF ok" : "CNPJ" : "SEM DOC"}` +
      `${l.contato ? "" : "  SEM CONTATO"}`,
  );
}

// ⚠️ A UNICIDADE É (workspace, empreendimento, unidade, competência): duas parcelas da MESMA
// unidade no mesmo mês não cabem na tabela, e escolher uma delas sozinho seria decidir quanto
// cobrar. Estas saem separadas para alguém decidir.
const duplicadas = [...conflitos.entries()].filter(([, v]) => v.length > 1);
if (duplicadas.length > 0) {
  console.log("\n⚠️ MAIS DE UMA PARCELA NA MESMA UNIDADE — não cabem as duas, decida qual emitir:");
  for (const [unidade, itens] of duplicadas) {
    console.log(`  ${unidade} · ${itens[0].nome}`);
    for (const i of itens) {
      console.log(`     R$ ${i.valor.toFixed(2)} · vence dia ${i.vencimentoDia} · ${i.observacoes}`);
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

// ⚠️ O CONFLITO NÃO TRAVA A CARTEIRA INTEIRA, mas também não se resolve sozinho. Com
// `--pular-conflitos` as unidades limpas entram e as disputadas ficam de fora, LISTADAS: assim
// nove clientes recebem no dia certo enquanto um caso espera decisão humana. Sem a flag, nada
// entra — porque gravar metade em silêncio é o jeito de a outra metade ser esquecida.
const pularConflitos = process.argv.includes("--pular-conflitos");
const unidadesEmConflito = new Set(duplicadas.map(([unidade]) => unidade));

if (duplicadas.length > 0 && !pularConflitos) {
  console.log("\nNÃO GRAVEI: resolva as unidades com mais de uma parcela, ou use --pular-conflitos.");
  process.exit(1);
}

const aGravar = linhas.filter((l) => !unidadesEmConflito.has(l.unidade));

if (unidadesEmConflito.size > 0) {
  console.log(
    `\nDeixando de fora ${unidadesEmConflito.size} unidade(s) em conflito: ` +
      [...unidadesEmConflito].join(", "),
  );
}

const paraParcelas = aGravar.map((l) => ({
  bloqueio: l.bloqueio,
  competencia: l.competencia,
  empreendimento: l.empreendimento,
  nome: l.nome,
  origem: "lsoft",
  parcela_atual: l.parcelaAtual,
  total_parcelas: l.totalParcelas,
  unidade: l.unidade,
  unidade_incerta: l.unidadeIncerta,
  valor: l.valor,
  vencimento_dia: l.vencimentoDia,
  workspace_id: l.workspace,
}));

const { error: erroGravar } = await sb
  .from("boletos_parcelas")
  .upsert(paraParcelas, { onConflict: "workspace_id,empreendimento,unidade,competencia" });
if (erroGravar) throw new Error(`boletos_parcelas: ${erroGravar.message}`);

// O documento é da PESSOA e vive por unidade — é o que o boleto usa como pagador.
const paraDocumentos = aGravar
  .filter((l) => l.unidade && l.documento)
  .map((l) => ({
    contato: l.contato,
    documento: l.documento,
    empreendimento: l.empreendimento,
    nome: l.nome,
    unidade: l.unidade,
    workspace_id: l.workspace,
  }));

const { error: erroDocs } = await sb
  .from("boletos_documentos")
  .upsert(paraDocumentos, { onConflict: "workspace_id,empreendimento,unidade" });
if (erroDocs) throw new Error(`boletos_documentos: ${erroDocs.message}`);

console.log(
  `\nPronto: ${paraParcelas.length} parcelas e ${paraDocumentos.length} documentos na carteira.`,
);
