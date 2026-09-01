// CARGA DOS DOCUMENTOS DA DEVOLUTIVA — CPF/CNPJ dos clientes que recebem boleto.
//
// Uso:
//   node scripts/boletos/carregar-documentos.mjs <arquivo.xlsx>            (ensaio, nao grava)
//   node scripts/boletos/carregar-documentos.mjs <arquivo.xlsx> --gravar   (grava no Supabase)
//
// ⚠️ ENSAIO POR PADRAO. Gravar so com --gravar explicito: a tabela guarda dado pessoal e a chave e
// empreendimento+unidade, entao uma coluna deslocada sobrescreveria o documento de outra pessoa.
//
// ⚠️ A LINHA COM "?" NAO E CLIENTE. Decisao do Lucas (01/09/2026): *"o que estão em ? não é
// cliente, pode desconsiderar"*. Na devolutiva sao 4 linhas do Vale do Sol, entre elas a CAIXA
// ECONOMICA FEDERAL — unidades retomadas, sem comprador. Elas nao entram.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const raiz = process.cwd();
const req = createRequire(path.resolve(raiz, "apps/hub/package.json"));
const ExcelJS = req("exceljs");
const { createClient } = req("@supabase/supabase-js");

const arquivo = process.argv[2];
const gravar = process.argv.includes("--gravar");
if (!arquivo) {
  console.error("Informe o arquivo: node scripts/boletos/carregar-documentos.mjs <arquivo.xlsx> [--gravar]");
  process.exit(1);
}

// Como a devolutiva nomeia cada empreendimento -> o `slug` de lib/apolo/boletos/empreendimentos.ts.
const SLUG = {
  "ed. cristal": "ed-cristal",
  "ed. esmeralda": "ed-esmeralda",
  "ed. jade": "ed-jade",
  "ed. rubi": "ed-rubi",
  garden: "garden",
  "giant towers": "giant-towers",
  guaimbé: "guaimbe",
  guaimbe: "guaimbe",
  "on sky": "on-sky",
  "vale do sol": "vale-do-sol",
};

/** Texto de uma célula, sem tocar em `.text` — ver [[reference_exceljs_duas_armadilhas]]. */
function texto(celula) {
  const v = celula.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    return String(v.result ?? v.text ?? v.richText?.map((x) => x.text).join("") ?? "");
  }
  return String(v);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(arquivo);
const ws = wb.worksheets[0];

const aceitos = [];
const descartados = [];
const problemas = [];

for (let r = 2; r <= ws.rowCount; r++) {
  const linha = ws.getRow(r);
  const bruto = {
    contato: texto(linha.getCell(4)).trim(),
    documento: texto(linha.getCell(5)).trim(),
    empreendimento: texto(linha.getCell(1)).trim(),
    marca: texto(linha.getCell(6)).trim(),
    nome: texto(linha.getCell(3)).trim(),
    unidade: texto(linha.getCell(2)).trim(),
  };

  if (!bruto.empreendimento && !bruto.nome) continue;

  // A marca "?" diz que aquela unidade não tem cliente.
  if (bruto.marca.includes("?")) {
    descartados.push({ ...bruto, motivo: "marcada com ? — não é cliente" });
    continue;
  }

  const slug = SLUG[bruto.empreendimento.toLowerCase()];
  if (!slug) {
    problemas.push({ ...bruto, motivo: `empreendimento desconhecido: "${bruto.empreendimento}"` });
    continue;
  }

  const digitos = bruto.documento.replace(/\D/g, "");
  if (digitos.length !== 11 && digitos.length !== 14) {
    problemas.push({ ...bruto, motivo: `documento com ${digitos.length} dígitos` });
    continue;
  }
  if (!bruto.unidade) {
    problemas.push({ ...bruto, motivo: "sem unidade — não há como casar com a planilha" });
    continue;
  }

  aceitos.push({
    contato: bruto.contato || null,
    documento: digitos,
    empreendimento: slug,
    nome: bruto.nome,
    unidade: bruto.unidade,
    workspace_id: "careli",
  });
}

// ⚠️ DUAS LINHAS PARA A MESMA UNIDADE derrubariam o upsert com "ON CONFLICT DO UPDATE command
// cannot affect row a second time". Melhor achar aqui, com o nome das duas na frente.
const porChave = new Map();
const duplicados = [];
for (const a of aceitos) {
  const chave = `${a.empreendimento}|${a.unidade}`;
  if (porChave.has(chave)) duplicados.push({ chave, nomes: [porChave.get(chave).nome, a.nome] });
  else porChave.set(chave, a);
}

const porEmpreendimento = {};
for (const a of aceitos) porEmpreendimento[a.empreendimento] = (porEmpreendimento[a.empreendimento] ?? 0) + 1;

console.log(`\n${aceitos.length} documentos aceitos:`);
for (const [e, n] of Object.entries(porEmpreendimento).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)} ${e}`);
}
const cpfs = aceitos.filter((a) => a.documento.length === 11).length;
console.log(`  (${cpfs} CPF · ${aceitos.length - cpfs} CNPJ)`);

if (descartados.length) {
  console.log(`\n${descartados.length} descartados (marcados com "?"):`);
  for (const d of descartados) console.log(`  ${d.empreendimento} · un ${d.unidade} · ${d.nome}`);
}
if (problemas.length) {
  console.log(`\n⚠️ ${problemas.length} com problema:`);
  for (const p of problemas) console.log(`  ${p.empreendimento} · un ${p.unidade} · ${p.nome} — ${p.motivo}`);
}
if (duplicados.length) {
  console.log(`\n⚠️ ${duplicados.length} unidade(s) repetida(s) — a carga NÃO roda assim:`);
  for (const d of duplicados) console.log(`  ${d.chave}: ${d.nomes.join(" / ")}`);
  process.exit(1);
}

if (!gravar) {
  console.log("\nENSAIO — nada foi gravado. Rode com --gravar para valer.");
  process.exit(0);
}

const env = Object.fromEntries(
  fs.readFileSync(path.resolve(raiz, "apps/hub/.env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// ⚠️ UPSERT PELA CHAVE COMPLETA. Ver [[reference_postgrest_upsert_not_null]]: índice parcial não
// serve para ON CONFLICT. Aqui a constraint é completa (workspace + empreendimento + unidade).
const { data, error } = await supabase
  .from("boletos_documentos")
  .upsert(aceitos, { onConflict: "workspace_id,empreendimento,unidade" })
  .select("id");

if (error) {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
}
console.log(`\n✓ ${data.length} documentos gravados.`);
