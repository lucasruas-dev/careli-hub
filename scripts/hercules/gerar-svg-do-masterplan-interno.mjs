// GERA O SVG DE UM MASTERPLAN A PARTIR DO MASTERPLAN INTERNO DO PANTEON (o HTML gerado).
//
// Lucas (02/09/2026), sobre o Garden: *"o garden já tem masterplan dentro do panteon"*. O SVG que
// subimos no C2X em 07/08 sumiu do disco, mas o `masterplans-internos/garden.html` guarda, em
// `const DADOS=[...]`, o polígono de cada lote — e a planta está em `public/garden/garden-planta.jpg`.
// Este script refaz o SVG no molde que o C2X e o importador leem (`inkscape:label` por lote; ver a
// memória reference_c2x_masterplan_inkscape_label).
//
// FORMATO DE `DADOS` (uma linha por lote):
//   [quadra(número), "lote"(texto, 2 dígitos), situação, área, valor, "comprador", "x,y x,y ..."]
// O código do lote é montado como o HTML monta: PREFIXO + quadra com 2 dígitos + lote.
//
// ⚠️ SÓ ESCREVE O ARQUIVO DE SAÍDA. Não toca em banco nem em bucket: a importação é do
//    scripts/hercules/importar-masterplan.mjs, que confere label × unidade antes de subir.
//
// Uso (da RAIZ do monorepo):
//   node scripts/hercules/gerar-svg-do-masterplan-interno.mjs --html apps/hub/masterplans-internos/garden.html \
//     --planta apps/hub/public/garden/garden-planta.jpg --prefixo GDN --saida "C:/.../MASTERPLAN_GARDEN.svg"

import fs from "node:fs";
import path from "node:path";

function arg(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const HTML = arg("html");
const PLANTA = arg("planta");
const PREFIXO = String(arg("prefixo") ?? "").trim().toUpperCase();
const SAIDA = arg("saida");

if (!HTML || !PLANTA || !PREFIXO || !SAIDA) {
  console.error("Uso: --html <masterplan.html> --planta <imagem> --prefixo <GDN> --saida <arquivo.svg>");
  process.exit(1);
}
for (const f of [HTML, PLANTA]) {
  if (!fs.existsSync(f)) {
    console.error(`Não encontrado: ${f}`);
    process.exit(1);
  }
}

const html = fs.readFileSync(HTML, "utf8");

// Dimensões do mapa: o MAIOR viewBox do HTML é o do SVG do masterplan (os pequenos são ícones).
const caixas = [...html.matchAll(/viewBox="0 0 (\d{3,5}) (\d{3,5})"/g)]
  .map((m) => [Number(m[1]), Number(m[2])])
  .sort((a, b) => b[0] * b[1] - a[0] * a[1]);
const [W, H] = caixas[0] ?? [0, 0];
if (!W || !H) {
  console.error("Não achei o viewBox do masterplan no HTML.");
  process.exit(1);
}

// O bloco DADOS: do "const DADOS=[" até a linha que fecha com "]".
const inicio = html.indexOf("const DADOS=[");
if (inicio < 0) {
  console.error("Não achei `const DADOS=[` no HTML.");
  process.exit(1);
}
const corpo = html.slice(inicio + "const DADOS=[".length);
// O bloco termina em "];" — e a última linha de lote pode carregar o "]" de fechamento colada
// ("...]];"), sem quebra de linha antes.
const fim = corpo.indexOf("];");
const bloco = corpo.slice(0, fim < 0 ? undefined : fim + 1);

// Cada linha é um array JSON válido (aspas duplas, números): parse linha a linha, tolerando a
// vírgula final e o "]" do fechamento do array na última linha.
const lotes = [];
for (const linhaCrua of bloco.split(/\r?\n/)) {
  let linha = linhaCrua.trim().replace(/,$/, "");
  if (linha.endsWith("]]")) linha = linha.slice(0, -1);
  if (!linha.startsWith("[")) continue;
  let r;
  try {
    r = JSON.parse(linha);
  } catch {
    console.error(`Linha que não parseia: ${linha.slice(0, 80)}`);
    process.exit(1);
  }
  const quadra = String(r[0]).padStart(2, "0");
  const lote = String(r[1]);
  const pontos = String(r[6] ?? "").trim();
  if (!pontos) continue;
  lotes.push({ codigo: `${PREFIXO}${quadra}${lote}`, pontos, quadra, lote });
}

// ⚠️ O INKSCAPE COPIA O LABEL AO DUPLICAR — e um HTML gerado pode carregar o mesmo defeito.
const vistos = new Map();
for (const l of lotes) vistos.set(l.codigo, (vistos.get(l.codigo) ?? 0) + 1);
const repetidos = [...vistos.entries()].filter(([, n]) => n > 1).map(([c]) => c);

// A planta embutida em base64, para o SVG ser um arquivo só (como os do C2X).
const bytes = fs.readFileSync(PLANTA);
const ext = path.extname(PLANTA).toLowerCase();
const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
const href = `data:${mime};base64,${bytes.toString("base64")}`;

// Polígono → path fechado. Os pontos já estão no espaço do viewBox W×H.
function pathDe(pontos) {
  const pares = pontos.split(/\s+/).map((p) => p.split(",").map(Number));
  const [primeiro, ...resto] = pares;
  return `M ${primeiro[0]},${primeiro[1]} ` + resto.map(([x, y]) => `L ${x},${y}`).join(" ") + " Z";
}

const paths = lotes
  .map(
    (l) =>
      `    <path style="opacity:0.85;fill:#000000;stroke:#71c464;stroke-opacity:0" d="${pathDe(l.pontos)}" id="${l.codigo}" data-name="${l.codigo}" inkscape:label="${l.codigo}" />`,
  )
  .join("\n");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg version="1.1" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
     xmlns:xlink="http://www.w3.org/1999/xlink" xmlns="http://www.w3.org/2000/svg">
  <g inkscape:groupmode="layer" inkscape:label="Imagem" id="camada-imagem">
    <image width="${W}" height="${H}" preserveAspectRatio="none" xlink:href="${href}" id="mapa-base" />
  </g>
  <g inkscape:groupmode="layer" inkscape:label="Lotes" id="camada-lotes">
${paths}
  </g>
</svg>
`;

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, svg);

console.log(`${path.basename(SAIDA)}: ${Math.round(svg.length / 1024)} KB, ${lotes.length} lotes (${vistos.size} códigos únicos), viewBox ${W}x${H}`);
if (repetidos.length) console.log(`⚠️ códigos REPETIDOS (${repetidos.length}): ${repetidos.slice(0, 20).join(", ")}`);
console.log(`quadras: ${[...new Set(lotes.map((l) => l.quadra))].sort().join(" ")}`);
