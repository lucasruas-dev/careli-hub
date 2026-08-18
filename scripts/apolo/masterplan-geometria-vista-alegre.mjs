// GEOMETRIA DOS LOTES DO VISTA ALEGRE — do SVG do projetista para o JSON que o masterplan lê.
//
// Uso (da raiz do repo):
//   node scripts/apolo/masterplan-geometria-vista-alegre.mjs
//
// Entrada:  C:/Users/lucas/Documents/Careli_C2x/Masterplans/Masterplan - Vista Alegre.svg (15,9 MB)
// Saídas:   apps/hub/public/masterplan/vista-alegre-lotes.json      (a geometria)
//           apps/hub/public/masterplans/planta-vista-alegre.webp   (a planta de fundo)
//
// O molde é o da Lagoa Bonita (masterplan-geometria-lagoa-bonita.mjs), que é o mais novo: leitura
// pelo `inkscape:label`, planta embutida extraída do próprio SVG (com a limpeza de entidades que o
// Inkscape exige) e o mesmo formato de JSON do Vale do Ouro:
//   { planta, viewBox, lotes: [ { id, quadra, lote, pontos: [[x,y], ...] } ] }
// Geometria e só geometria. Preço, situação e comprador NÃO entram aqui: eles vêm do C2X, por
// rota autenticada, e é essa separação que impede o masterplan de virar um arquivo público com
// dado comercial dentro.
//
// ⚠️ A CHAVE É O `inkscape:label`, NUNCA O `id` — a regra que o Vale do Ouro provou na prática
// (quatro lotes com id divergente do label trocavam de lugar no mapa).
//
// O NOME NO SVG É "VALqll": VAL + quadra + lote. A quadra é UMA LETRA (A..I) e o lote tem DOIS
// dígitos (VALA01 = quadra A, lote 01; VALI10 = quadra I, lote 10) — diferente da Lagoa, onde o
// bloco é letra+dois dígitos ("C01"). No C2X (enterprise 29, code VAL) o espelho é exato: 126
// unidades com `block` "A".."I" e `lot` "01".."24", conferido em 17/08/2026 — inclusive a
// contagem por quadra (A:4 B:3 C:24 D:14 E:16 F:17 G:17 H:21 I:10) bate 1:1 com o SVG.
// A chave de cruzamento é (quadra, lote), a mesma dos irmãos.
//
// A PLANTA SAI DO MESMO SVG, embutida em base64 cobrindo o viewBox inteiro (0 0 3840 2160):
// polígonos e planta compartilham a mesma moldura, então o alinhamento vem por construção. A
// planta é pública de propósito: é o desenho que qualquer folder de venda já mostra — sem preço
// e sem nome.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const sharp = requireDoRepo("sharp");

const ENTRADA = "C:/Users/lucas/Documents/Careli_C2x/Masterplans/Masterplan - Vista Alegre.svg";
const SAIDA = path.resolve("apps/hub/public/masterplan/vista-alegre-lotes.json");
const PLANTA = path.resolve("apps/hub/public/masterplans/planta-vista-alegre.webp");

// VALA01 -> quadra A, lote 01. Uma letra e dois dígitos, sem exceção nos 126.
const PADRAO_LABEL = /^VAL([A-I])(\d{2})$/;

// ── conversão do atributo `d` em lista de vértices ────────────────────────
//
// O Inkscape grava m/l/h/v/z (relativos) e M/L/H/V/Z (absolutos), e em alguns lotes há curva
// Bézier (c/C). Curva vira segmento reto entre os extremos: num lote desenhado em 3840x2160 a
// diferença é sub-pixel, e o polígono do mapa é área de clique, não planta de obra.
function pontosDoPath(d) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const pontos = [];
  let x = 0;
  let y = 0;
  let comando = "";
  let i = 0;

  const numero = () => Number(tokens[i++]);
  const empurra = () => pontos.push([Number(x.toFixed(2)), Number(y.toFixed(2))]);

  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) {
      comando = tokens[i++];
    } else if (comando === "m") {
      // Repetição de `m` é `l` implícito (regra do SVG), e o mesmo vale para `M` -> `L`.
      comando = "l";
    } else if (comando === "M") {
      comando = "L";
    }

    switch (comando) {
      case "M":
      case "m": {
        const dx = numero();
        const dy = numero();
        x = comando === "m" ? x + dx : dx;
        y = comando === "m" ? y + dy : dy;
        empurra();
        comando = comando === "m" ? "l" : "L";
        break;
      }
      case "L":
      case "l": {
        const dx = numero();
        const dy = numero();
        x = comando === "l" ? x + dx : dx;
        y = comando === "l" ? y + dy : dy;
        empurra();
        break;
      }
      case "H":
      case "h": {
        const dx = numero();
        x = comando === "h" ? x + dx : dx;
        empurra();
        break;
      }
      case "V":
      case "v": {
        const dy = numero();
        y = comando === "v" ? y + dy : dy;
        empurra();
        break;
      }
      case "C":
      case "c": {
        // Só o ponto final importa: os dois de controle são descartados.
        const nums = [numero(), numero(), numero(), numero(), numero(), numero()];
        x = comando === "c" ? x + nums[4] : nums[4];
        y = comando === "c" ? y + nums[5] : nums[5];
        empurra();
        break;
      }
      case "Z":
      case "z":
        // Fecha o polígono. Não empurra vértice: o consumidor fecha sozinho.
        break;
      default:
        // Comando que não usamos (arcos, quadráticas). Aborta este lote em vez de desenhar torto.
        return null;
    }
  }

  return pontos.length >= 3 ? pontos : null;
}

// Área por shoelace, em px². Serve de conferência contra a área real em m² do C2X.
function areaDoPoligono(pontos) {
  let soma = 0;
  for (let i = 0; i < pontos.length; i += 1) {
    const [x1, y1] = pontos[i];
    const [x2, y2] = pontos[(i + 1) % pontos.length];
    soma += x1 * y2 - x2 * y1;
  }
  return Math.abs(soma) / 2;
}

async function extrairPlanta(svg) {
  const embutida = svg.match(/xlink:href="data:image\/(png|jpeg);base64,([^"]+)"/);
  if (!embutida) {
    console.error("O SVG não tem a planta embutida em base64. Sem ela o mapa fica sem fundo.");
    process.exit(1);
  }

  // ⚠️ O INKSCAPE QUEBRA O BASE64 EM LINHAS E AS GRAVA COMO ENTIDADE XML (`&#10;`). Decodificar
  // sem limpar corta o PNG no primeiro `&` e o sharp devolve "corrupt header" — foi o primeiro
  // erro da extração da Lagoa. Tira-se a entidade e qualquer espaço antes de decodificar.
  const bruta = Buffer.from(embutida[2].replace(/&#\d+;|\s+/g, ""), "base64");
  const meta = await sharp(bruta, { limitInputPixels: false }).metadata();

  // WebP a 90: a mesma régua das plantas irmãs. A proporção NATIVA não importa — o SVG estica a
  // imagem no viewBox (`preserveAspectRatio="none"`) e a tela faz o mesmo (`object-fit:fill`),
  // então gravamos o pixel como veio, sem resize e sem recorte.
  await sharp(bruta, { limitInputPixels: false })
    .webp({ effort: 5, quality: 90 })
    .toFile(PLANTA);

  console.log(
    `planta:  ${meta.width}x${meta.height} ${embutida[1]} embutido -> ${PLANTA} (${(fs.statSync(PLANTA).size / 1024 / 1024).toFixed(2)} MB)`,
  );
}

async function principal() {
  if (!fs.existsSync(ENTRADA)) {
    console.error(`SVG não encontrado: ${ENTRADA}`);
    process.exit(1);
  }

  const svg = fs.readFileSync(ENTRADA, "utf8");

  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
  if (!viewBox) {
    console.error("SVG sem viewBox: sem ele o overlay não tem como se alinhar à planta.");
    process.exit(1);
  }

  // ⚠️ NENHUM `transform` PODE EXISTIR EM PATH OU GRUPO. Se o projetista mover a camada no
  // Inkscape, os pontos saem deslocados e o mapa fica inteiro fora de lugar, sem erro nenhum.
  if (/<(path|g)\b[^>]*\btransform=/.test(svg)) {
    console.error("O SVG tem `transform` em path ou grupo. Achate as transformações no Inkscape antes.");
    process.exit(1);
  }

  const lotes = [];
  const semGeometria = [];
  const vistos = new Set();

  for (const tag of svg.match(/<path\b[^>]*>/g) ?? []) {
    const label = tag.match(/inkscape:label="([^"]+)"/)?.[1]?.trim();
    if (!label) continue;

    const casa = label.match(PADRAO_LABEL);
    if (!casa) continue;

    const [, quadra, lote] = casa;
    if (vistos.has(label)) {
      console.error(`Rótulo duplicado no SVG: ${label}. Corrija no Inkscape (um lote, um rótulo).`);
      process.exit(1);
    }
    vistos.add(label);

    const d = tag.match(/\sd="([^"]+)"/)?.[1];
    const pontos = d ? pontosDoPath(d) : null;

    if (!pontos) {
      semGeometria.push(label);
      continue;
    }

    lotes.push({ area_px: Math.round(areaDoPoligono(pontos)), id: label, lote, pontos, quadra });
  }

  if (semGeometria.length) {
    console.error(`Lotes sem geometria utilizável: ${semGeometria.join(", ")}`);
    process.exit(1);
  }

  // Quadra em ordem, e o LOTE em ordem NUMÉRICA — a régua que vale também para o irmão do
  // Recanto do Pará, onde o lote passa de 99 e a ordem de texto colocaria "100" antes de "67".
  lotes.sort((a, b) => a.quadra.localeCompare(b.quadra) || Number(a.lote) - Number(b.lote));

  const saida = {
    planta: "/masterplans/planta-vista-alegre.webp",
    viewBox,
    lotes: lotes.map(({ area_px, ...resto }) => ({ ...resto, areaPx: area_px })),
  };

  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.mkdirSync(path.dirname(PLANTA), { recursive: true });
  fs.writeFileSync(SAIDA, JSON.stringify(saida), "utf8");

  await extrairPlanta(svg);

  const quadras = new Map();
  for (const l of lotes) quadras.set(l.quadra, (quadras.get(l.quadra) ?? 0) + 1);

  console.log(`viewBox: ${viewBox}`);
  console.log(`lotes:   ${lotes.length}`);
  console.log(`quadras: ${[...quadras.keys()].sort().map((q) => `${q}:${quadras.get(q)}`).join(" ")}`);
  console.log(`vértices: ${lotes.reduce((s, l) => s + l.pontos.length, 0)} (média ${(lotes.reduce((s, l) => s + l.pontos.length, 0) / lotes.length).toFixed(1)})`);
  console.log(`gravado: ${SAIDA} (${(fs.statSync(SAIDA).size / 1024).toFixed(0)} KB)`);
}

await principal();
