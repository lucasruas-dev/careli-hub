// O CPF E O TELEFONE DAS SEIS LINHAS QUE NASCERAM COM UNIDADE NOVA.
//
// Uso:
//   node scripts/boletos/documentos-unidades-repetidas.mjs            (ensaio)
//   node scripts/boletos/documentos-unidades-repetidas.mjs --gravar
//
// ⚠️ ELAS APARECERAM SEM CPF PORQUE O CADASTRO É INDEXADO PELA UNIDADE, e as unidades `406 BL 04
// (2)`, `408 BL 01 (2)` e `101 BL 01 (2)` acabaram de nascer — não existiam em `boletos_documentos`.
// As PESSOAS têm documento: o CPF está no LSoft e o telefone na própria planilha, na coluna de
// forma de envio. O que faltava era a ponte.
//
// ⚠️ O CASAMENTO COM O LSOFT É POR NOME, E POR IDENTIDADE EXATA. No Vale do Sol `quadra` e `lote`
// vêm nulos em 96 dos 99 clientes, então o nome é a única ponte — e por isso ela é estreita: nome
// idêntico depois de normalizar, sem homônimo dos dois lados. Quem não casar exato fica sem CPF e
// aparece na tela para ser preenchido à mão, que é melhor do que um CPF plausível e errado.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const raiz = process.cwd();
const req = createRequire(path.resolve(raiz, "apps/hub/package.json"));
const ExcelJS = req("exceljs");
const { createClient } = req("@supabase/supabase-js");
const esbuild = req("esbuild");

const ARQUIVO = "C:/Users/lucas/Downloads/05b30114-4687-4451-a728-31446aac2026.xlsx";
const ABA = "BOLETOS VALE SOL";
const SLUG = "vale-do-sol";

const gravar = process.argv.includes("--gravar");

const compilado = await esbuild.build({
  bundle: true,
  entryPoints: [path.resolve(raiz, "apps/hub/lib/apolo/boletos/telefone-padrao.ts")],
  format: "esm",
  platform: "node",
  write: false,
});
const { telefonePadrao } = await import(
  `data:text/javascript;base64,${Buffer.from(compilado.outputFiles[0].text).toString("base64")}`
);

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

function texto(c) {
  const v = c.value;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return "";
  if (typeof v === "object") {
    return String(v.result ?? v.text ?? v.richText?.map((x) => x.text).join("") ?? "");
  }
  return String(v);
}

// 1) as parcelas sem cadastro
const { data: parcelas, error: erroP } = await sb
  .from("boletos_parcelas")
  .select("unidade,nome")
  .eq("workspace_id", "careli")
  .eq("empreendimento", SLUG)
  .eq("competencia", "2026-09");
if (erroP) throw erroP;

const { data: docs } = await sb
  .from("boletos_documentos")
  .select("unidade")
  .eq("workspace_id", "careli")
  .eq("empreendimento", SLUG);
const jaTem = new Set((docs ?? []).map((d) => d.unidade));
const faltam = parcelas.filter((p) => !jaTem.has(p.unidade));

// 2) o telefone, da própria planilha
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(ARQUIVO);
const ws = wb.getWorksheet(ABA);
const telefonePorNome = new Map();
for (let r = 3; r <= ws.rowCount; r++) {
  const l = ws.getRow(r);
  const nome = texto(l.getCell(2)).trim();
  const contato = texto(l.getCell(3)).trim();
  if (nome && contato) telefonePorNome.set(norm(nome), contato);
}

// 3) o CPF, do LSoft
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
const porNome = new Map();
for (let i = 0; i < lista.length; i += 100) {
  const { data } = await sb
    .from("lsoft_clientes")
    .select("codigo,nome,cpf,celular,telefone")
    .in("codigo", lista.slice(i, i + 100));
  for (const c of data) {
    const k = norm(c.nome);
    if (!porNome.has(k)) porNome.set(k, []);
    porNome.get(k).push(c);
  }
}

const paraGravar = [];
const semCpf = [];
for (const p of faltam) {
  const chave = norm(p.nome);
  const candidatos = porNome.get(chave) ?? [];
  const cli = candidatos.length === 1 ? candidatos[0] : null;
  const dig = String(cli?.cpf ?? "").replace(/\D/g, "");
  const telefone = telefonePadrao(
    telefonePorNome.get(chave) || cli?.celular || cli?.telefone || null,
  );

  if (dig.length !== 11 && dig.length !== 14) {
    semCpf.push({ ...p, motivo: candidatos.length === 0 ? "não achei no LSoft" : candidatos.length > 1 ? "homônimo no LSoft" : "sem CPF no LSoft", telefone });
    continue;
  }
  paraGravar.push({
    contato: telefone,
    documento: dig,
    empreendimento: SLUG,
    nome: p.nome,
    unidade: p.unidade,
    workspace_id: "careli",
  });
}

console.log(`${faltam.length} unidade(s) sem cadastro`);
console.log(`  ${paraGravar.length} com CPF achado no LSoft`);
for (const g of paraGravar) {
  console.log(`     ${g.unidade.padEnd(16)} ${g.nome.padEnd(32)} tel ${g.contato ?? "—"}`);
}
if (semCpf.length) {
  console.log(`  ${semCpf.length} sem CPF (ficam para preencher na tela):`);
  for (const s of semCpf) console.log(`     ${s.unidade.padEnd(16)} ${s.nome.padEnd(32)} ${s.motivo}`);
}

if (!gravar) {
  console.log("\nENSAIO — nada foi gravado. Rode com --gravar para valer.");
  process.exit(0);
}

const { data, error } = await sb
  .from("boletos_documentos")
  .upsert(paraGravar, { onConflict: "workspace_id,empreendimento,unidade" })
  .select("id");
if (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}
console.log(`\n✓ ${data.length} cadastros gravados.`);
