// CASAMENTO POR SEMELHANÇA DE NOME — o Vale do Sol, onde a identidade exata não alcançou.
//
// Uso:
//   node scripts/boletos/casar-por-semelhanca.mjs            (ensaio)
//   node scripts/boletos/casar-por-semelhanca.mjs --gravar
//
// ⚠️ AUTORIZADO PELO LUCAS EM 02/09/2026 (*"pode casar por semelhança"*), DEPOIS de ver que a
// identidade exata deixava 30 pessoas sem CPF por diferenças de grafia. Mas semelhança solta erra:
// no primeiro corte, três dos treze pares eram gente diferente —
//
//   CASSIO NASIONEZIO ALVES DOS SANTOS   ~  GETULIO ALVES SANTOS ROSA
//   EDUARDA FERNANDA OLIVEIRA            ~  ISABELA DE OLIVEIRA
//   PAULO LINHARES                       ~  PEDRO HENRIQUE LINHARES SOARES
//
// — todos com metade dos sobrenomes em comum e PRIMEIRO NOME DIFERENTE. Sobrenome é herdado e se
// repete no mesmo loteamento; o primeiro nome é o que distingue as pessoas.
//
// ⚠️ POR ISSO O CRITÉRIO TEM TRÊS EXIGÊNCIAS, e todas precisam passar:
//   1. o PRIMEIRO NOME é igual ou erra por uma letra (THALLES/TALLES, YASMIN/YASMIM);
//   2. um nome é a CONTINUAÇÃO do outro (MARIA BETANIA DA SILVA → + QUIRINO) ou o último
//      sobrenome também erra por no máximo uma letra (VASCONSELOS/VASCONCELOS);
//   3. pelo menos 60% dos sobrenomes coincidem.
//
// ⚠️ AMBIGUIDADE DERRUBA O PAR. Se dois clientes do LSoft passarem no critério para a mesma linha,
// nenhum é gravado: um CPF errado no boleto é pior do que um boleto a menos.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const raiz = process.cwd();
const req = createRequire(path.resolve(raiz, "apps/hub/package.json"));
const ExcelJS = req("exceljs");
const { createClient } = req("@supabase/supabase-js");

const gravar = process.argv.includes("--gravar");

const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(raiz, "apps/hub/.env.local"), "utf8")
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
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** As partículas não distinguem ninguém: "DA SILVA" e "SILVA" são o mesmo sobrenome. */
const PARTICULAS = new Set(["DA", "DE", "DO", "DAS", "DOS", "E"]);
const partes = (nome) => norm(nome).split(" ").filter((t) => t && !PARTICULAS.has(t));

/** Distância de edição, para tolerar UMA letra trocada e não mais que isso. */
function distancia(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  const m = a.length;
  const n = b.length;
  let anterior = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const atual = [i];
    for (let j = 1; j <= n; j += 1) {
      atual[j] = Math.min(
        anterior[j] + 1,
        atual[j - 1] + 1,
        anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    anterior = atual;
  }
  return anterior[n];
}

const quaseIgual = (a, b) => distancia(a, b) <= 1;

/** Um conjunto de nomes é a continuação do outro? (MARIA BETANIA DA SILVA → + QUIRINO) */
function continuacao(a, b) {
  const [curto, longo] = a.length <= b.length ? [a, b] : [b, a];
  return curto.every((t, i) => quaseIgual(t, longo[i]));
}

/** As três exigências. Devolve o motivo quando passa, para o relatório poder mostrar. */
function parece(nomeA, nomeB) {
  const a = partes(nomeA);
  const b = partes(nomeB);
  if (a.length === 0 || b.length === 0) return null;

  // 1) primeiro nome
  if (!quaseIgual(a[0], b[0])) return null;

  // 2) continuação, ou último sobrenome quase igual
  const ehContinuacao = continuacao(a, b);
  const mesmoFim = quaseIgual(a[a.length - 1], b[b.length - 1]);
  if (!ehContinuacao && !mesmoFim) return null;

  // 3) maioria dos sobrenomes
  const sa = new Set(a.slice(1));
  const sb2 = new Set(b.slice(1));
  let comuns = 0;
  for (const t of sa) if ([...sb2].some((x) => quaseIgual(x, t))) comuns += 1;
  const proporcao = comuns / Math.max(1, Math.min(sa.size, sb2.size));
  if (proporcao < 0.6) return null;

  return {
    motivo: ehContinuacao
      ? a.length === b.length
        ? "mesmo nome, grafia diferente"
        : "um nome continua o outro"
      : "mesmo primeiro nome e mesmo último sobrenome",
    proporcao,
  };
}

// ── OS DADOS ────────────────────────────────────────────────────────────────

const { data: parcelas } = await sb
  .from("boletos_parcelas")
  .select("unidade,nome")
  .eq("workspace_id", "careli")
  .eq("empreendimento", "vale-do-sol")
  .eq("competencia", "2026-09")
  .is("bloqueio", null);
const { data: docs } = await sb
  .from("boletos_documentos")
  .select("unidade,documento")
  .eq("workspace_id", "careli")
  .eq("empreendimento", "vale-do-sol");

const temDoc = new Set(docs.map((d) => d.unidade));
const jaUsados = new Set(docs.map((d) => d.documento));
const faltam = parcelas.filter((p) => !temDoc.has(p.unidade));

const codigos = new Set();
for (let de = 0; ; de += 1000) {
  const { data } = await sb
    .from("lsoft_parcelas")
    .select("cliente_codigo")
    .eq("empreendimento", "Vale do Sol")
    .range(de, de + 999);
  for (const d of data) if (d.cliente_codigo) codigos.add(d.cliente_codigo);
  if (data.length < 1000) break;
}
const lista = [...codigos];
const clientes = [];
// ⚠️ `.in()` estoura a URL com muitos itens — lotes de 100.
for (let i = 0; i < lista.length; i += 100) {
  const { data } = await sb
    .from("lsoft_clientes")
    .select("codigo,nome,cpf,celular,telefone")
    .in("codigo", lista.slice(i, i + 100));
  clientes.push(...data);
}

console.log(`${faltam.length} unidades sem CPF · ${clientes.length} clientes no LSoft`);

// ── O CASAMENTO ─────────────────────────────────────────────────────────────

const paraGravar = [];
const ambiguos = [];
const semPar = [];
const usadosAgora = new Set();

for (const f of faltam) {
  const candidatos = clientes
    .map((c) => ({ c, r: parece(f.nome, c.nome) }))
    .filter((x) => x.r)
    .filter((x) => {
      const d = String(x.c.cpf ?? "").replace(/\D/g, "");
      return (d.length === 11 || d.length === 14) && !jaUsados.has(d) && !usadosAgora.has(d);
    });

  if (candidatos.length === 0) {
    semPar.push(f);
    continue;
  }
  if (candidatos.length > 1) {
    ambiguos.push({ f, nomes: candidatos.map((x) => x.c.nome) });
    continue;
  }

  const { c, r } = candidatos[0];
  const dig = String(c.cpf).replace(/\D/g, "");
  usadosAgora.add(dig);
  paraGravar.push({
    contato: c.celular || c.telefone || null,
    documento: dig,
    empreendimento: "vale-do-sol",
    motivo: r.motivo,
    nome: f.nome,
    nomeLsoft: c.nome,
    unidade: f.unidade,
    workspace_id: "careli",
  });
}

console.log(`\n${paraGravar.length} casaram:`);
for (const p of paraGravar.sort((a, b) => a.unidade.localeCompare(b.unidade))) {
  console.log(`   ${p.unidade.padEnd(12)} "${p.nome}"`);
  console.log(`   ${" ".repeat(12)}  ~ "${p.nomeLsoft}"  (${p.motivo})`);
}
if (ambiguos.length) {
  console.log(`\n⚠️ ${ambiguos.length} ambíguo(s) — nenhum gravado:`);
  for (const a of ambiguos) console.log(`   ${a.f.unidade} "${a.f.nome}" → ${a.nomes.join(" / ")}`);
}
console.log(`\n${semPar.length} sem par (o CPF precisa ser buscado a mão):`);
for (const s of semPar) console.log(`   ${s.unidade.padEnd(12)} ${s.nome}`);

if (!gravar) {
  console.log("\nENSAIO — nada foi gravado. Rode com --gravar para valer.");
  process.exit(0);
}

const { data, error } = await sb
  .from("boletos_documentos")
  .upsert(
    paraGravar.map(({ motivo, nomeLsoft, ...resto }) => resto),
    { onConflict: "workspace_id,empreendimento,unidade" },
  )
  .select("id");
if (error) {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
}
console.log(`\n✓ ${data.length} documentos gravados.`);
