// SEMEIA O CADASTRO DE EMPREENDIMENTOS DO PANTEON — PAI E FILHOS (migration 0123).
//
// Lucas (02/09/2026): *"a partir de hoje vamos cadastrar os empreendimentos dentro do panteon (...)
// ter o empreendimento pai, e os filhos (...) hoje eu não tenho esse agrupamento para o Vale do
// Ouro, está todo solto, tem que unificar"*.
//
// É uma IMPORTAÇÃO ÚNICA: lê o C2X uma vez (read-only, como sempre) para não digitar 36 nomes e
// cidades à mão, e grava no Panteon. Depois disso o cadastro vive aqui e o C2X não é mais
// consultado para isso (*"não quero consultar c2x, quero importar"*).
//
// A REGRA DO AGRUPAMENTO: filhos do mesmo pai têm o MESMO `name` no C2X ("VALE DO OURO" ×4,
// "LAGOA BONITA" ×3, "LAVRA DO OURO" ×2...). O ESPELHO É O PAI (Lucas: *"o espelho sempre será o
// pai, porque lá que vai morar todos os registros, vendas"*): "LAGOA BONITA - MASTERPLAN" (31) e
// o VLO (35) viram o próprio pai, com o id do C2X neles; VOC/VOL/VOR e LBF/LBR/LBP viram FILHOS =
// visões segmentadas. Empreendimento único (Garden) é pai sem filho. Grupo sem espelho no C2X
// (Lavra do Ouro) é pai sem id, só com os filhos.
//
// ⚠️ SÓ GRAVA COM `--gravar`. Sem a flag mostra o que faria.
// ⚠️ EXIGE A MIGRATION 0123 APLICADA.
// ⚠️ Rodar de novo NÃO duplica: casa pelo `codigo` (único por workspace) e atualiza.
//
// Uso (da RAIZ do monorepo):
//   node scripts/hercules/semear-empreendimentos.mjs            # ensaio
//   node scripts/hercules/semear-empreendimentos.mjs --gravar   # grava

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = requireDoRepo("mysql2/promise");
const { createClient } = requireDoRepo("@supabase/supabase-js");

const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const GRAVAR = process.argv.includes("--gravar");
const WORKSPACE = "careli";

// OS 11 QUE ESTÃO VENDENDO (Lucas: *"vamos pegar somente as que estamos tendo venda"* → *"os 11"*):
// os empreendimentos com recepção de CAD ligada em 02/09/2026. Por CÓDIGO DO PAI.
const VENDENDO = new Set([
  "VDO", "REP", "VAL", "VLO", "RVP", "GDN", "JDG", "ACP", "LAB", // + Lagoa Bonita (LAB é o pai)
]);

// Nome de mercado do PAI, quando o do C2X não serve como está.
const NOME_DE_MERCADO = {
  "ALDEIA DAS CACHOEIRAS DAS PEDRAS": "Aldeia das Cachoeiras das Pedras",
  "CONDOMINIO RECANTO DO PARA": "Recanto do Pará",
  "RESIDENCIAL VILLA PARIS": "Villa Paris",
  "VISTAS DA PRAIA RESIDENCIAL": "Vistas da Praia",
};

// Empreendimentos do C2X que NÃO são produto (testes e aditivos): ficam de fora do cadastro.
const IGNORAR = new Set(["SDT", "TSC", "ADT"]);

// Espelhos = o PAI. O C2X guarda o masterplan e o conjunto inteiro de unidades nestes.
const ESPELHOS = new Set(["LAB", "VLO"]);

const UF = {
  "Minas Gerais": "MG", "São Paulo": "SP", "Espírito Santo": "ES", "Rio de Janeiro": "RJ",
  "Bahia": "BA", "Goiás": "GO", "Distrito Federal": "DF",
};

function titulo(nome) {
  const pequenas = new Set(["da", "de", "do", "das", "dos", "e"]);
  return String(nome ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((p, i) => (i > 0 && pequenas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ")
    .replace(/\bPara\b/, "Pará");
}

// ── 1. LER O C2X (uma vez) ─────────────────────────────────────────────────────
const c2x = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});
const [linhas] = await c2x.query(`
  select e.id, e.code, e.name, c.name as cidade, s.name as estado
  from enterprises e
  left join cities c on c.id = e.city_id
  left join states s on s.id = c.state_id
  order by e.id`);
await c2x.end();

// ── 2. AGRUPAR ─────────────────────────────────────────────────────────────────
const grupos = new Map(); // chave = nome normalizado do pai
for (const l of linhas) {
  const code = String(l.code ?? "").trim().toUpperCase();
  if (!code || IGNORAR.has(code)) continue;
  const nomeCru = String(l.name ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  const ehEspelho = /- MASTERPLAN$/.test(nomeCru) || ESPELHOS.has(code);
  const chave = nomeCru.replace(/\s*-\s*MASTERPLAN$/, "");
  const g = grupos.get(chave) ?? { chave, filhos: [], espelho: null, cidade: null, uf: null };
  g.cidade = g.cidade ?? (l.cidade ? String(l.cidade).trim() : null);
  g.uf = g.uf ?? (l.estado ? (UF[String(l.estado).trim()] ?? String(l.estado).trim()) : null);
  if (ehEspelho) g.espelho = { c2xId: String(l.id), codigo: code };
  else g.filhos.push({ c2xId: String(l.id), codigo: code, nome: titulo(nomeCru) });
  grupos.set(chave, g);
}

// ── 3. MONTAR PAIS E FILHOS ────────────────────────────────────────────────────
const pais = [];
for (const g of grupos.values()) {
  let filhos = [...g.filhos].sort((a, b) => a.codigo.localeCompare(b.codigo));
  // O pai: o espelho quando existe (LAB, VLO). Empreendimento único vira pai sem filho (o id do
  // C2X sobe para o pai). Grupo sem espelho (Lavra, Rio de Pedras, Portal dos Vales) ganha um pai
  // só do Panteon, sem id do C2X, e os filhos ficam.
  let codigoDoPai;
  let c2xDoPai = null;
  if (g.espelho) {
    codigoDoPai = g.espelho.codigo;
    c2xDoPai = g.espelho.c2xId;
  } else if (filhos.length === 1) {
    codigoDoPai = filhos[0].codigo;
    c2xDoPai = filhos[0].c2xId;
    filhos = [];
  } else {
    codigoDoPai = filhos[0].codigo.slice(0, 2) + "X"; // LOS/LOU→LOX, RDP/RPS/RPC→RDX, PDV/PVS→PDX
  }
  const nome = NOME_DE_MERCADO[g.chave] ?? titulo(g.chave);
  pais.push({
    c2x_enterprise_id: c2xDoPai,
    cidade: g.cidade,
    codigo: codigoDoPai,
    filhos,
    nome,
    uf: g.uf,
    vendendo: VENDENDO.has(codigoDoPai) || filhos.some((f) => VENDENDO.has(f.codigo)),
  });
}
pais.sort((a, b) => Number(b.vendendo) - Number(a.vendendo) || a.nome.localeCompare(b.nome));

console.log(`${pais.length} pais, ${pais.reduce((n, p) => n + p.filhos.length, 0)} filhos\n`);
for (const p of pais) {
  console.log(
    `${p.vendendo ? "●" : "○"} ${p.codigo.padEnd(4)} ${p.nome}  (${p.cidade ?? "?"}/${p.uf ?? "?"})` +
      (p.c2x_enterprise_id ? `  c2x ${p.c2x_enterprise_id}` : "  (só no Panteon)"),
  );
  for (const f of p.filhos) console.log(`     └ visão ${f.codigo.padEnd(4)} c2x ${f.c2xId}`);
}

if (!GRAVAR) {
  console.log("\nEnsaio. Rode com --gravar para valer.");
  process.exit(0);
}

// ── 4. GRAVAR NO PANTEON ───────────────────────────────────────────────────────
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const chave = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
if (!url || !chave) {
  console.error("Sem NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no apps/hub/.env.local.");
  process.exit(1);
}
const supabase = createClient(url, chave, { auth: { persistSession: false } });

async function upsert(linha) {
  // Casa pelo código: rodar de novo atualiza em vez de duplicar.
  const { data, error } = await supabase
    .from("hercules_empreendimentos")
    .upsert(linha, { onConflict: "workspace_id,codigo" })
    .select("id")
    .maybeSingle();
  // ⚠️ CHECAR `error` SEMPRE: o PostgREST falha calado em NOT NULL / índice único.
  if (error || !data?.id) throw new Error(`${linha.codigo}: ${error?.message ?? "sem id de volta"}`);
  return data.id;
}

let ordem = 0;
for (const p of pais) {
  const paiId = await upsert({
    atualizado_em: new Date().toISOString(),
    c2x_enterprise_id: p.c2x_enterprise_id,
    cidade: p.cidade,
    codigo: p.codigo,
    nome: p.nome,
    ordem: ordem++,
    pai_id: null,
    uf: p.uf,
    vendendo: p.vendendo,
    workspace_id: WORKSPACE,
  });
  let ordemFilho = 0;
  for (const f of p.filhos) {
    await upsert({
      atualizado_em: new Date().toISOString(),
      c2x_enterprise_id: f.c2xId,
      cidade: p.cidade,
      codigo: f.codigo,
      nome: `${p.nome} · ${f.codigo}`,
      ordem: ordemFilho++,
      pai_id: paiId,
      uf: p.uf,
      vendendo: p.vendendo,
      workspace_id: WORKSPACE,
    });
  }
  console.log(`gravado ${p.codigo} ${p.nome} + ${p.filhos.length} filho(s)`);
}
console.log("\nCadastro semeado.");
