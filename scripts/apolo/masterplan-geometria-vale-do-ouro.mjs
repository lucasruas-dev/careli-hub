// GEOMETRIA DOS LOTES DO VALE DO OURO — do SVG do projetista para o JSON que o masterplan lê.
//
// Uso (da raiz do repo):
//   node scripts/apolo/masterplan-geometria-vale-do-ouro.mjs
//
// Entrada:  C:/Users/lucas/Documents/Careli_C2x/Masterplans/MASTERPLAN_VALE_DO_OURO.svg (24 MB)
// Saída:    apps/hub/public/masterplan/vale-do-ouro-lotes.json
//
// O formato de saída é o MESMO do Garden (public/masterplan/garden-lotes.json):
//   { viewBox, lotes: [ { id, quadra, lote, pontos: [[x,y], ...] } ] }
// Geometria e só geometria. Preço, situação e comprador NÃO entram aqui: eles vêm do C2X, por
// rota autenticada, e é essa separação que impede o masterplan de virar um arquivo público com
// dado comercial dentro.
//
// ⚠️ A CHAVE É O `inkscape:label`, NUNCA O `id`.
// É a mesma regra que o C2X usa para ler masterplan, e neste arquivo ela não é teoria: QUATRO
// lotes têm id divergente do label (VLO0234 com id VLO0233, VLO0233 com id VLO0233-8, VLO0305
// com id VLO0306-9, VLO1503 com id VLO1502-5). Ler pelo id troca quatro lotes de lugar no mapa,
// e um mapa que troca lote de lugar é pior do que não ter mapa.
//
// ⚠️ O NOME NO SVG É "VLOqqll" — o registro HISTÓRICO, anterior à divisão.
// Hoje o loteamento é VOL (Lino) + VOC (Cecílio), e a divisão foi feita lote a lote DENTRO da
// mesma quadra. Por isso a chave de cruzamento é (quadra, lote), não o código: é ela que
// sobreviveu à divisão.

import fs from "node:fs";
import path from "node:path";

const ENTRADA = "C:/Users/lucas/Documents/Careli_C2x/Masterplans/MASTERPLAN_VALE_DO_OURO.svg";
const SAIDA = path.resolve("apps/hub/public/masterplan/vale-do-ouro-lotes.json");

// ── conversão do atributo `d` em lista de vértices ────────────────────────
//
// O Inkscape grava m/l/h/v/z (relativos) e M/L/H/V/Z (absolutos), e em quatro lotes há curva
// Bézier (c/C). Curva vira segmento reto entre os extremos: num lote de ~360 m² desenhado em
// 3840x2400 a diferença é sub-pixel, e o polígono do mapa é área de clique, não planta de obra.
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

function principal() {
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

  // ⚠️ NENHUM `transform` PODE EXISTIR. Se o projetista mover a camada no Inkscape, os pontos
  // saem deslocados e o mapa fica inteiro fora de lugar, sem erro nenhum. Parar aqui é a
  // diferença entre um problema visível agora e um mapa errado publicado.
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

    const casa = label.match(/^VLO(\d{2})(\d{2})$/);
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

  lotes.sort((a, b) => a.id.localeCompare(b.id));

  const saida = {
    // A planta de fundo é a MESMA já publicada: o SVG carrega uma cópia dela embutida em base64,
    // e a comparação pixel a pixel deu diferença média de 0,31 em 255 (só compressão JPEG).
    // Apontar para o arquivo que já está no ar evita 2,3 MB duplicados no repo.
    planta: "/masterplans/planta-vale-do-ouro.jpg",
    viewBox,
    lotes: lotes.map(({ area_px, ...resto }) => ({ ...resto, areaPx: area_px })),
  };

  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, JSON.stringify(saida), "utf8");

  const quadras = new Map();
  for (const l of lotes) quadras.set(l.quadra, (quadras.get(l.quadra) ?? 0) + 1);

  console.log(`viewBox: ${viewBox}`);
  console.log(`lotes:   ${lotes.length}`);
  console.log(`quadras: ${[...quadras.keys()].sort().map((q) => `${q}:${quadras.get(q)}`).join(" ")}`);
  console.log(`vértices: ${lotes.reduce((s, l) => s + l.pontos.length, 0)} (média ${(lotes.reduce((s, l) => s + l.pontos.length, 0) / lotes.length).toFixed(1)})`);
  console.log(`gravado: ${SAIDA} (${(fs.statSync(SAIDA).size / 1024).toFixed(0)} KB)`);
}

principal();
