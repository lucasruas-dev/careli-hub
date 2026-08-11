// PLANTA DO VALE DO OURO — a arte oficial, transparente, pronta para o masterplan.
//
// Uso (da raiz do repo):
//   node --max-old-space-size=8192 scripts/apolo/masterplan-planta-vale-do-ouro.mjs [caminho.png]
//
// Entrada padrão: o PNG que o Lucas entregou em 11/08, já sem as logos e com fundo transparente
//   ~/Downloads/Masterplan__ vale do ouro - medidas - png - TRANSPARENTE.png  (9999x6118, 56 MB)
// Saídas:
//   apps/hub/public/masterplans/planta-vale-do-ouro-limpa.webp
//   apps/hub/public/masterplan/vale-do-ouro-recorte.json   (o viewBox que o mapa tem que usar)
//
// ESTE SCRIPT SUBSTITUI O `masterplan-planta-limpa.mjs`, que era remendo: aquele pegava a arte de
// venda (com moldura azul e quatro logos impressas), apagava as marcas por componente conexo e
// recortava. Funcionava, mas sempre sobrava fundo nos cantos, porque o terreno é um polígono
// irregular — foi o que o Lucas viu: "no vale do ouro temos uma parte branca". Com a arte
// transparente na origem, o problema deixa de existir.
//
// ⚠️ O ENQUADRAMENTO MUDOU, E É POR ISSO QUE ESTE SCRIPT CALCULA UM viewBox.
// Os 298 polígonos dos lotes foram extraídos do SVG do projetista, em coordenadas da arte ANTIGA
// (3840x2400). O PNG novo tem outra resolução e outra margem em volta do desenho. Realinhar
// vértice por vértice seria retrabalho e risco; em vez disso, recortamos o PNG exatamente na
// mancha do desenho e apontamos o `viewBox` do SVG para a mancha equivalente na arte antiga. As
// duas viram a MESMA janela, e cada lote continua sobre o seu desenho.
//
// Isso só é honesto porque as proporções internas do desenho batem nas duas artes (1,5419 contra
// 1,5416, medido). Se um dia vier uma arte com outro desenho, a conferência no fim deste script
// acusa: ela mede se o centro de cada um dos 298 polígonos cai sobre área de lote.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const sharp = requireDoRepo("sharp");

const casa = process.env.USERPROFILE || process.env.HOME || ".";
const ENTRADA =
  process.argv[2] ||
  path.join(casa, "Downloads", "Masterplan__ vale do ouro - medidas - png - TRANSPARENTE.png");

const SAIDA = path.resolve("apps/hub/public/masterplans/planta-vale-do-ouro-limpa.webp");
const RECORTE = path.resolve("apps/hub/public/masterplan/vale-do-ouro-recorte.json");
const GEOMETRIA = path.resolve("apps/hub/public/masterplan/vale-do-ouro-lotes.json");

// A MANCHA DO DESENHO NA ARTE ANTIGA, em coordenadas dos polígonos. Medida pelo script anterior
// (componente conexo, depois de apagar as quatro logos): o desenho ia de (81,28) a (3733,2397).
// É esta janela que o `viewBox` vai apontar, e é ela que casa com o recorte do PNG novo.
const DESENHO_ANTIGO = { x0: 81, x1: 3733, y0: 28, y1: 2397 };

// A tela não precisa de 9999px de largura: o zoom máximo é 300% sobre uma área de ~1100px, então
// 4400px já entrega mais pixel do que a tela consegue mostrar, com um terço do peso.
const LARGURA_ALVO = 4400;

async function principal() {
  if (!fs.existsSync(ENTRADA)) {
    console.error(`PNG não encontrado: ${ENTRADA}`);
    process.exit(1);
  }

  const original = sharp(ENTRADA, { limitInputPixels: false });
  const meta = await original.metadata();
  console.log(`entrada: ${meta.width}x${meta.height} · alfa: ${meta.hasAlpha}`);

  if (!meta.hasAlpha) {
    console.error("O PNG não tem canal alfa. Este script espera a arte com fundo transparente.");
    process.exit(1);
  }

  // 1) RECORTA A MANCHA. `trim` remove a borda transparente e informa quanto tirou de cada lado,
  //    que é a informação de que precisamos para o viewBox.
  const recortado = await sharp(ENTRADA, { limitInputPixels: false })
    .trim({ threshold: 1 })
    .toBuffer({ resolveWithObject: true });

  console.log(
    `desenho: ${recortado.info.width}x${recortado.info.height} · proporção ${(recortado.info.width / recortado.info.height).toFixed(4)}`,
  );

  const proporcaoNova = recortado.info.width / recortado.info.height;
  const larguraAntiga = DESENHO_ANTIGO.x1 - DESENHO_ANTIGO.x0;
  const alturaAntiga = DESENHO_ANTIGO.y1 - DESENHO_ANTIGO.y0;
  const proporcaoAntiga = larguraAntiga / alturaAntiga;
  const desvio = Math.abs(proporcaoNova / proporcaoAntiga - 1);

  console.log(
    `proporção antiga ${proporcaoAntiga.toFixed(4)} · nova ${proporcaoNova.toFixed(4)} · desvio ${(desvio * 100).toFixed(2)}%`,
  );

  // ⚠️ TRAVA. Acima de 1,5% o desenho não é o mesmo, e esticar a imagem para caber no viewBox
  // antigo deslocaria os lotes de forma invisível — mapa errado com cara de mapa certo.
  if (desvio > 0.015) {
    console.error(
      "A proporção do desenho novo não bate com a do antigo. Os 298 polígonos precisariam ser realinhados antes de trocar a planta.",
    );
    process.exit(1);
  }

  // 2) REDIMENSIONA e grava em WebP com alfa.
  const altura = Math.round(LARGURA_ALVO / proporcaoNova);
  await sharp(recortado.data, { limitInputPixels: false })
    .resize(LARGURA_ALVO, altura, { fit: "fill", kernel: "lanczos3" })
    .webp({ alphaQuality: 100, effort: 5, quality: 90 })
    .toFile(SAIDA);

  // 3) O viewBox: a janela do desenho na arte ANTIGA, que é onde os polígonos vivem.
  fs.writeFileSync(
    RECORTE,
    JSON.stringify({
      altura: alturaAntiga,
      largura: larguraAntiga,
      viewBox: `${DESENHO_ANTIGO.x0} ${DESENHO_ANTIGO.y0} ${larguraAntiga} ${alturaAntiga}`,
      x: DESENHO_ANTIGO.x0,
      y: DESENHO_ANTIGO.y0,
    }),
    "utf8",
  );

  console.log(`gravado: ${SAIDA} (${(fs.statSync(SAIDA).size / 1024 / 1024).toFixed(2)} MB, ${LARGURA_ALVO}x${altura})`);
  console.log(`viewBox: ${DESENHO_ANTIGO.x0} ${DESENHO_ANTIGO.y0} ${larguraAntiga} ${alturaAntiga}`);

  // 4) CONFERÊNCIA: o centro de cada lote cai sobre área de lote, ou na rua? É o teste que pega
  //    qualquer deslocamento que importe — e o único jeito de afirmar que a troca de planta deu
  //    certo sem depender de olhar a tela.
  const geometria = JSON.parse(fs.readFileSync(GEOMETRIA, "utf8"));
  const { data, info } = await sharp(SAIDA).raw().toBuffer({ resolveWithObject: true });

  const escalaX = info.width / larguraAntiga;
  const escalaY = info.height / alturaAntiga;

  let sobreLote = 0;
  let sobreRua = 0;
  let transparente = 0;

  for (const lote of geometria.lotes) {
    const cx = lote.pontos.reduce((s, p) => s + p[0], 0) / lote.pontos.length;
    const cy = lote.pontos.reduce((s, p) => s + p[1], 0) / lote.pontos.length;
    const x = Math.round((cx - DESENHO_ANTIGO.x0) * escalaX);
    const y = Math.round((cy - DESENHO_ANTIGO.y0) * escalaY);

    if (x < 0 || y < 0 || x >= info.width || y >= info.height) {
      transparente += 1;
      continue;
    }

    const i = (y * info.width + x) * info.channels;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const a = info.channels === 4 ? data[i + 3] : 255;

    if (a < 128) transparente += 1;
    else if (Math.min(r, g, b) > 120 && Math.max(r, g, b) - Math.min(r, g, b) < 30) sobreRua += 1;
    else sobreLote += 1;
  }

  const total = geometria.lotes.length;
  console.log(
    `conferência: ${sobreLote}/${total} sobre lote · ${sobreRua} na rua · ${transparente} fora do desenho`,
  );

  if (sobreLote / total < 0.9) {
    console.error("Alinhamento ruim: a planta nova não casa com os polígonos. NÃO publicar.");
    process.exit(1);
  }
}

await principal();
