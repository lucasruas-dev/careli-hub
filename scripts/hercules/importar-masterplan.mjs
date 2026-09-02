// IMPORTA UM MASTERPLAN (SVG) PARA O HÉRCULES — bucket + hercules_masterplans (migration 0123).
//
// Lucas (02/09/2026): *"lembrando que não quero consultar c2x, quero importar"* · *"vamos pegar
// somente as que estamos tendo venda"* · *"o que não tiver masterplan cadastrado pode até tirar o
// botão"*.
//
// O QUE FAZ: lê o SVG, conta os lotes (`inkscape:label`, que é o que o C2X também lê — ver a memória
// reference_c2x_masterplan_inkscape_label), confere contra as unidades do PAI em hercules_unidades
// (as dos filhos, casadas por código), sobe para `apolo-documents/hercules-masterplans/<codigo>/v<n>.svg`
// e grava a versão. Publica só com `--publicar`; a versão anterior publicada é despublicada (uma
// publicada por empreendimento, índice parcial).
//
// ⚠️ SÓ GRAVA COM `--gravar`. Sem a flag: só a conferência (labels × unidades), que já vale ouro —
//    foi assim que descobrimos lotes com nome do vizinho no JDG.
// ⚠️ EXIGE AS MIGRATIONS 0123 aplicadas e o pai semeado (scripts/hercules/semear-empreendimentos.mjs).
//
// Uso (da RAIZ do monorepo):
//   node scripts/hercules/importar-masterplan.mjs --pai VLO --svg "C:/.../MASTERPLAN_VALE_DO_OURO.svg"
//   node scripts/hercules/importar-masterplan.mjs --pai VLO --svg ... --gravar --publicar

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
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

function arg(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const GRAVAR = process.argv.includes("--gravar");
const PUBLICAR = process.argv.includes("--publicar");
const PAI = String(arg("pai") ?? "").trim().toUpperCase();
const SVG = arg("svg");
const WORKSPACE = "careli";
const BUCKET = "apolo-documents";
const PREFIXO = "hercules-masterplans";

if (!PAI || !SVG) {
  console.error("Uso: --pai <CODIGO DO PAI> --svg <arquivo.svg> [--gravar] [--publicar]");
  process.exit(1);
}
if (!fs.existsSync(SVG)) {
  console.error(`SVG não encontrado: ${SVG}`);
  process.exit(1);
}

// ── 1. O ARQUIVO ───────────────────────────────────────────────────────────────
const svg = fs.readFileSync(SVG);
const texto = svg.toString("utf8");
// Lote = label que começa com 3-4 letras e tem número (o padrão de código de unidade). Camadas
// ("Imagem", "Lotes") ficam de fora.
const labels = [...texto.matchAll(/inkscape:label="([A-Z]{2,4}[A-Z0-9 -]*\d[A-Z0-9 -]*)"/g)].map((m) => m[1].trim());
const unicos = new Set(labels);
const repetidos = labels.filter((l, i) => labels.indexOf(l) !== i);

console.log(`${path.basename(SVG)}: ${Math.round(svg.length / 1024)} KB, ${labels.length} labels de lote (${unicos.size} únicos)`);
if (repetidos.length) {
  // ⚠️ O INKSCAPE COPIA O LABEL AO DUPLICAR: lote novo nasce com o nome do vizinho (JDG, 29/08).
  console.log(`⚠️ labels REPETIDOS (${[...new Set(repetidos)].length}): ${[...new Set(repetidos)].slice(0, 20).join(", ")}`);
}
if (svg.length > 50 * 1024 * 1024) {
  console.error("Arquivo acima de 50 MB: o bucket recusa. Comprima a imagem embutida antes.");
  process.exit(1);
}

// ── 2. O PAI E AS UNIDADES ─────────────────────────────────────────────────────
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const chave = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
if (!url || !chave) {
  console.error("Sem NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no apps/hub/.env.local.");
  process.exit(1);
}
const supabase = createClient(url, chave, { auth: { persistSession: false } });

const { data: pai, error: erroPai } = await supabase
  .from("hercules_empreendimentos")
  .select("id,codigo,nome,c2x_enterprise_id")
  .eq("workspace_id", WORKSPACE)
  .eq("codigo", PAI)
  .is("pai_id", null)
  .maybeSingle();
if (erroPai || !pai) {
  console.error(`Pai ${PAI} não encontrado no cadastro (${erroPai?.message ?? "semeie antes"}).`);
  process.exit(1);
}

// As unidades moram no PAI (o espelho). Só quando o pai não tem id no C2X (grupo sem espelho) é
// que o conjunto vem dos filhos — e aí, sem espelho, cada filho traz as suas sem repetir.
const { data: filhos } = await supabase
  .from("hercules_empreendimentos")
  .select("codigo,c2x_enterprise_id")
  .eq("pai_id", pai.id);
const idsDoConjunto = pai.c2x_enterprise_id
  ? [pai.c2x_enterprise_id]
  : [...new Set((filhos ?? []).map((f) => f.c2x_enterprise_id).filter(Boolean))];

// ⚠️ PostgREST corta em 1.000 linhas sem erro: pagina.
const unidades = [];
for (let de = 0; ; de += 1000) {
  const { data, error } = await supabase
    .from("hercules_unidades")
    .select("codigo,enterprise_id,quadra,lote")
    .in("enterprise_id", idsDoConjunto)
    .range(de, de + 999);
  if (error) {
    console.error(`Erro lendo unidades: ${error.message}`);
    process.exit(1);
  }
  unidades.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
const codigos = new Set(unidades.map((u) => String(u.codigo).trim().toUpperCase()));

// Label × unidade. No conjunto com espelho (Lagoa Bonita), o label é do ESPELHO (LABC0101) e a
// unidade vendável é da gleba (LBRC0101): casa por (quadra, lote) quando o código não bate.
const chaveQL = new Map();
for (const u of unidades) {
  if (u.quadra != null && u.lote != null) chaveQL.set(`${String(u.quadra).trim()}|${String(u.lote).trim()}`, u);
}
function casa(label) {
  const l = label.toUpperCase();
  if (codigos.has(l)) return "codigo";
  const m = l.match(/^[A-Z]{2,4}([A-Z0-9]+?)(\d{2,})$/);
  if (m && chaveQL.has(`${m[1]}|${String(Number(m[2]))}`)) return "quadra+lote";
  return null;
}
const semUnidade = [...unicos].filter((l) => !casa(l));
const semLabel = [...codigos].filter((c) => !unicos.has(c)).length;

console.log(`pai ${pai.codigo} ${pai.nome}: ${unidades.length} unidades em ${idsDoConjunto.length} empreendimento(s) do C2X`);
console.log(`labels sem unidade: ${semUnidade.length}${semUnidade.length ? " → " + semUnidade.slice(0, 15).join(", ") : ""}`);
console.log(`unidades sem label (por código): ${semLabel}`);

if (!GRAVAR) {
  console.log("\nEnsaio. Rode com --gravar (e --publicar) para valer.");
  process.exit(0);
}

// ── 3. VERSÃO, UPLOAD E REGISTRO ───────────────────────────────────────────────
const { data: ultima } = await supabase
  .from("hercules_masterplans")
  .select("versao")
  .eq("empreendimento_id", pai.id)
  .order("versao", { ascending: false })
  .limit(1)
  .maybeSingle();
const versao = (ultima?.versao ?? 0) + 1;
const objeto = `${PREFIXO}/${pai.codigo}/v${versao}.svg`;

const { error: erroUpload } = await supabase.storage
  .from(BUCKET)
  .upload(objeto, svg, { contentType: "image/svg+xml", upsert: false });
if (erroUpload) {
  console.error(`Falha no upload de ${objeto}: ${erroUpload.message}`);
  process.exit(1);
}

if (PUBLICAR) {
  // Uma publicada por empreendimento: despublica a anterior ANTES de inserir a nova publicada.
  const { error } = await supabase
    .from("hercules_masterplans")
    .update({ publicado_em: null })
    .eq("empreendimento_id", pai.id)
    .not("publicado_em", "is", null);
  if (error) {
    console.error(`Falha ao despublicar a anterior: ${error.message}`);
    process.exit(1);
  }
}

const { data: gravado, error: erroInsert } = await supabase
  .from("hercules_masterplans")
  .insert({
    bytes: svg.length,
    empreendimento_id: pai.id,
    lotes: unicos.size,
    observacao: `importado de ${path.basename(SVG)}; ${semUnidade.length} label(s) sem unidade`,
    publicado_em: PUBLICAR ? new Date().toISOString() : null,
    publicado_por: PUBLICAR ? "script importar-masterplan" : null,
    svg_path: objeto,
    versao,
  })
  .select("id")
  .maybeSingle();
if (erroInsert || !gravado?.id) {
  console.error(`Falha ao registrar a versão: ${erroInsert?.message ?? "sem id"}`);
  process.exit(1);
}

console.log(`\nv${versao} de ${pai.codigo} gravada em ${objeto}${PUBLICAR ? " e PUBLICADA" : " (não publicada)"}.`);
