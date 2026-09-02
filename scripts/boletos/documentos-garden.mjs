// OS CPF/CNPJ DO GARDEN — do LSoft para `boletos_documentos`, já na unidade de hoje.
//
// Uso:
//   node scripts/boletos/documentos-garden.mjs            (ensaio)
//   node scripts/boletos/documentos-garden.mjs --gravar
//
// ⚠️ O LSOFT GUARDA O LOTE ANTIGO, e é isso que o torna útil aqui: `lsoft_parcelas` traz `quadra` e
// `lote` na numeração velha — a mesma da planilha de boletos. O CPF entra por essa chave, que é uma
// chave de verdade, e não pelo nome. A unidade gravada é a NOVA, lida de `boletos_parcelas`, que
// `carregar-garden.mjs` já converteu pelo masterplan.
//
// ⚠️ OS DOCUMENTOS VELHOS DO GARDEN ESTAVAM COM O CÓDIGO DO CLIENTE NO LUGAR DA UNIDADE
// (`00000487`, que é `lsoft_clientes.codigo`), então nunca casavam com parcela nenhuma: o CPF
// estava no banco e a tela dizia "sem CPF". Eles não são apagados aqui — sair da tabela é decisão
// do Lucas —, mas deixam de importar assim que a unidade certa existe.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const raiz = process.cwd();
const req = createRequire(path.resolve(raiz, "apps/hub/package.json"));
const ExcelJS = req("exceljs");
const { createClient } = req("@supabase/supabase-js");

const BOLETOS = "C:/Users/lucas/Downloads/b22dcd5f-ad68-4763-9b67-3da835fb961f (1).xlsx";
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

function texto(c) {
  const v = c.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    return String(v.result ?? v.text ?? v.richText?.map((x) => x.text).join("") ?? "");
  }
  return String(v);
}
const nq = (s) => String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");
const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// 1) a planilha de boletos: nome + telefone por (quadra, lote antigo)
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(BOLETOS);
const ws = wb.getWorksheet("BOLETOS GARDEN");
const daPlanilha = new Map();
for (let r = 4; r <= ws.rowCount; r++) {
  const l = ws.getRow(r);
  const antigo = nq(texto(l.getCell(1)));
  const q = nq(texto(l.getCell(2)));
  const nome = texto(l.getCell(3)).trim();
  const contato = texto(l.getCell(4)).trim();
  if (antigo && q && nome) daPlanilha.set(`${q}|${antigo}`, { contato, nome });
}

// 2) as unidades de hoje, como `carregar-garden.mjs` gravou
const { data: parcelas, error: erroP } = await sb
  .from("boletos_parcelas")
  .select("unidade,nome")
  .eq("workspace_id", "careli")
  .eq("empreendimento", "garden")
  .eq("competencia", "2026-09");
if (erroP) throw erroP;
const porNomeUnidade = new Map();
for (const p of parcelas) {
  const k = norm(p.nome);
  if (!porNomeUnidade.has(k)) porNomeUnidade.set(k, []);
  porNomeUnidade.get(k).push(p.unidade);
}

// 3) o LSoft: (quadra, lote antigo) -> cliente
const pares = new Map();
for (let de = 0; ; de += 1000) {
  const { data, error } = await sb
    .from("lsoft_parcelas")
    .select("cliente_codigo,quadra,lote")
    .eq("empreendimento", "Garden")
    .range(de, de + 999);
  if (error) throw error;
  for (const d of data) {
    if (d.cliente_codigo && d.quadra && d.lote) pares.set(`${nq(d.quadra)}|${nq(d.lote)}`, d.cliente_codigo);
  }
  if (data.length < 1000) break;
}
const lista = [...new Set(pares.values())];
const clientes = new Map();
// ⚠️ `.in()` estoura a URL com muitos itens — lotes de 100.
for (let i = 0; i < lista.length; i += 100) {
  const { data, error } = await sb
    .from("lsoft_clientes")
    .select("codigo,nome,cpf,celular,telefone")
    .in("codigo", lista.slice(i, i + 100));
  if (error) throw error;
  for (const c of data) clientes.set(c.codigo, c);
}
console.log(`LSoft: ${pares.size} pares (quadra, lote antigo) · ${clientes.size} clientes`);
console.log(`Parcelas de setembro no banco: ${parcelas.length}`);

// ⚠️ QUEM COMPROU DOIS LOTES SÓ CASA UMA VEZ PELA CHAVE. O LSoft tem 140 pares e a planilha 142
// linhas, mas 20 clientes têm mais de um lote e nem todos os pares dele estão lá: BRENO AUGUSTO
// tem Q04 L13 e L14, e só um dos dois casa. O CPF, porém, é o MESMO — é a mesma pessoa, no mesmo
// empreendimento, já identificada por chave forte no outro lote. Este índice guarda o que a chave
// já provou, para o segundo lote aproveitar; ele nunca inventa vínculo novo, só repete um confirmado.
const cpfJaProvado = new Map();
for (const [chave, p] of daPlanilha) {
  const codigo = pares.get(chave);
  const cli = codigo ? clientes.get(codigo) : null;
  const dig = String(cli?.cpf ?? "").replace(/\D/g, "");
  if (dig.length === 11 || dig.length === 14) cpfJaProvado.set(norm(p.nome), { cli, dig });
}

// 4) casa: planilha -> LSoft (pelo lote antigo) -> unidade de hoje (pelo nome da parcela)
const documentos = [];
const porRepeticao = [];
const semCpf = [];
const semUnidade = [];
const usadas = new Set();
for (const [chave, p] of daPlanilha) {
  const codigo = pares.get(chave);
  let cli = codigo ? clientes.get(codigo) : null;
  let dig = String(cli?.cpf ?? "").replace(/\D/g, "");
  let repetido = false;

  // O segundo lote do mesmo comprador herda o CPF que a chave já provou no primeiro.
  if (dig.length !== 11 && dig.length !== 14) {
    const provado = cpfJaProvado.get(norm(p.nome));
    if (provado) {
      cli = provado.cli;
      dig = provado.dig;
      repetido = true;
    }
  }

  const candidatas = (porNomeUnidade.get(norm(p.nome)) ?? []).filter((u) => !usadas.has(u));
  const unidade = candidatas[0] ?? null;
  if (!unidade) {
    semUnidade.push({ chave, nome: p.nome });
    continue;
  }
  if (dig.length !== 11 && dig.length !== 14) {
    semCpf.push({ chave, nome: p.nome, unidade });
    continue;
  }
  usadas.add(unidade);
  if (repetido) porRepeticao.push({ nome: p.nome, unidade });
  documentos.push({
    contato: p.contato || cli.celular || cli.telefone || null,
    documento: dig,
    empreendimento: "garden",
    nome: p.nome,
    unidade,
    workspace_id: "careli",
  });
}

console.log(`\n${documentos.length} documento(s) prontos`);
console.log(`${semCpf.length} sem CPF no LSoft · ${semUnidade.length} sem parcela de setembro`);
if (porRepeticao.length) {
  console.log(`${porRepeticao.length} herdaram o CPF do outro lote do mesmo comprador:`);
  for (const x of porRepeticao) console.log(`   ${x.unidade} — ${x.nome}`);
}
for (const s of semCpf) console.log(`   [sem CPF] ${s.unidade} — ${s.nome}`);
for (const s of semUnidade.slice(0, 10)) console.log(`   [sem parcela] antigo Q${s.chave} — ${s.nome}`);

if (!gravar) {
  console.log("\nENSAIO — nada foi gravado. Rode com --gravar para valer.");
  process.exit(0);
}

const { data, error } = await sb
  .from("boletos_documentos")
  .upsert(documentos, { onConflict: "workspace_id,empreendimento,unidade" })
  .select("id");
if (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}
console.log(`\n✓ ${data.length} documentos do Garden gravados.`);
