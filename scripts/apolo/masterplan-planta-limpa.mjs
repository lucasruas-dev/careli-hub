// PLANTA LIMPA — só o desenho do loteamento: sem as logos impressas e sem a moldura azul.
//
// Uso (da raiz do repo):
//   node scripts/apolo/masterplan-planta-limpa.mjs
//
// Entrada: apps/hub/public/masterplans/planta-vale-do-ouro.jpg  (a arte de venda, 3840x2400)
// Saídas:  apps/hub/public/masterplans/planta-vale-do-ouro-limpa.jpg
//          apps/hub/public/masterplan/vale-do-ouro-recorte.json  (o recorte, para o mapa seguir)
//
// Pedido do Lucas (10/08): "teria como deixar só a planta? tirar as logos?" e, logo depois,
// "e tira o fundo azul, deixa somente a planta".
//
// COMO O ALINHAMENTO SOBREVIVE AO RECORTE. Os 298 polígonos do masterplan estão em coordenadas da
// imagem inteira (viewBox "0 0 3840 2400"). Recortar sem mais nada jogaria todos eles fora de
// lugar. A saída é o próprio SVG: `viewBox` aceita deslocamento, então o mapa passa a usar
// "x y largura altura" do recorte e cada polígono continua exatamente sobre o seu lote, sem que um
// único ponto precise ser recalculado. É por isso que este script grava o recorte num JSON: quem
// monta a página lê dali, em vez de alguém copiar quatro números na mão.
//
// A ORDEM IMPORTA: primeiro apagamos as logos, depois medimos onde o desenho começa e termina. Ao
// contrário, a logo do canto entraria na conta e a moldura azul continuaria na imagem.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const sharp = requireDoRepo("sharp");

const ENTRADA = path.resolve("apps/hub/public/masterplans/planta-vale-do-ouro.jpg");
const SAIDA = path.resolve("apps/hub/public/masterplans/planta-vale-do-ouro-limpa.jpg");
const RECORTE = path.resolve("apps/hub/public/masterplan/vale-do-ouro-recorte.json");
const GEOMETRIA = path.resolve("apps/hub/public/masterplan/vale-do-ouro-lotes.json");

// Ponto de amostragem da cor da moldura: um pedaço de azul limpo, longe do desenho e das marcas.
const AMOSTRA_FUNDO = [1500, 150];

// Distância de cor a partir da qual o pixel deixa de ser "fundo". O azul da moldura é chapado, e a
// planta encosta nele com verde e branco: 26 separa os dois com folga e não come a borda da grama.
const LIMIAR_FUNDO = 26;

// Respiro em volta do desenho, para o recorte não raspar a borda da planta.
const FOLGA = 12;

async function principal() {
  if (!fs.existsSync(ENTRADA)) {
    console.error(`Planta não encontrada: ${ENTRADA}`);
    process.exit(1);
  }

  const meta = await sharp(ENTRADA).metadata();
  console.log(`entrada: ${meta.width}x${meta.height}`);

  // 1) COR DA MOLDURA.
  const { data, info } = await sharp(ENTRADA).raw().toBuffer({ resolveWithObject: true });
  const corEm = (x, y) => {
    const i = (y * info.width + x) * info.channels;
    return { b: data[i + 2], g: data[i + 1], r: data[i] };
  };
  const fundo = corEm(AMOSTRA_FUNDO[0], AMOSTRA_FUNDO[1]);
  console.log(`moldura: rgb(${fundo.r},${fundo.g},${fundo.b})`);

  // 2) AS MARCAS SÃO ILHAS. Em vez de eu chutar quatro retângulos (foi o que fiz primeiro, e os
  //    retângulos saíram deslocados, deixando meia logo na tela), quem separa marca de planta é a
  //    própria imagem: o desenho do loteamento é UMA mancha grande e contínua, e cada logo é um
  //    borrão solto, cercado de azul por todos os lados.
  //
  //    Então: marca tudo que não é moldura, acha a MAIOR região conectada (a planta) e pinta de
  //    azul todo o resto. Some a logo do topo, as duas da direita, a assinatura do rodapé e
  //    qualquer outra marca que apareça numa arte futura, sem ninguém precisar medir nada.
  const total = info.width * info.height;
  const ehConteudo = new Uint8Array(total);
  for (let p = 0; p < total; p += 1) {
    const i = p * info.channels;
    const dist =
      Math.abs(data[i] - fundo.r) + Math.abs(data[i + 1] - fundo.g) + Math.abs(data[i + 2] - fundo.b);
    ehConteudo[p] = dist > LIMIAR_FUNDO ? 1 : 0;
  }

  // Rotulagem por varredura em fila (BFS), 4-vizinhos. Fila em Int32Array porque são 9,2 milhões
  // de pixels e um array de JS comum aqui custa memória e tempo demais.
  const rotulo = new Int32Array(total).fill(-1);
  const fila = new Int32Array(total);
  const tamanhos = [];

  for (let semente = 0; semente < total; semente += 1) {
    if (!ehConteudo[semente] || rotulo[semente] !== -1) continue;

    const atual = tamanhos.length;
    let inicio = 0;
    let fim = 0;
    fila[fim++] = semente;
    rotulo[semente] = atual;
    let tamanho = 0;

    while (inicio < fim) {
      const p = fila[inicio++];
      tamanho += 1;
      const x = p % info.width;
      const y = (p - x) / info.width;

      if (x > 0 && ehConteudo[p - 1] && rotulo[p - 1] === -1) {
        rotulo[p - 1] = atual;
        fila[fim++] = p - 1;
      }
      if (x < info.width - 1 && ehConteudo[p + 1] && rotulo[p + 1] === -1) {
        rotulo[p + 1] = atual;
        fila[fim++] = p + 1;
      }
      if (y > 0 && ehConteudo[p - info.width] && rotulo[p - info.width] === -1) {
        rotulo[p - info.width] = atual;
        fila[fim++] = p - info.width;
      }
      if (y < info.height - 1 && ehConteudo[p + info.width] && rotulo[p + info.width] === -1) {
        rotulo[p + info.width] = atual;
        fila[fim++] = p + info.width;
      }
    }

    tamanhos.push(tamanho);
  }

  const planta = tamanhos.indexOf(Math.max(...tamanhos));
  const ilhas = tamanhos.filter((t, i) => i !== planta && t > 200).length;
  console.log(
    `regiões: ${tamanhos.length} · planta = ${(((tamanhos[planta] ?? 0) / total) * 100).toFixed(1)}% da imagem · ${ilhas} marcas apagadas`,
  );

  // Pinta de azul tudo que não é a planta.
  const limpo = Buffer.from(data);
  for (let p = 0; p < total; p += 1) {
    if (rotulo[p] === planta) continue;
    const i = p * info.channels;
    limpo[i] = fundo.r;
    limpo[i + 1] = fundo.g;
    limpo[i + 2] = fundo.b;
  }

  const semMarcas = {
    data: limpo,
    info,
  };

  // 3) ONDE A PLANTA COMEÇA E TERMINA — a caixa da própria mancha, agora que as ilhas já saíram.
  const { info: infoPix } = semMarcas;
  let x0 = infoPix.width;
  let y0 = infoPix.height;
  let x1 = -1;
  let y1 = -1;

  for (let p = 0; p < total; p += 1) {
    if (rotulo[p] !== planta) continue;
    const x = p % infoPix.width;
    const y = (p - x) / infoPix.width;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }

  // 3) O RECORTE PRECISA CONTER TODOS OS LOTES. Se um polígono ficasse fora, aquele lote sumiria
  // do mapa sem aviso. A caixa final é a UNIÃO do desenho com a caixa dos polígonos.
  const geometria = JSON.parse(fs.readFileSync(GEOMETRIA, "utf8"));
  for (const lote of geometria.lotes) {
    for (const [px, py] of lote.pontos) {
      if (px < x0) x0 = Math.floor(px);
      if (px > x1) x1 = Math.ceil(px);
      if (py < y0) y0 = Math.floor(py);
      if (py > y1) y1 = Math.ceil(py);
    }
  }

  const left = Math.max(0, x0 - FOLGA);
  const top = Math.max(0, y0 - FOLGA);
  const width = Math.min(infoPix.width - left, x1 - x0 + 1 + FOLGA * 2);
  const height = Math.min(infoPix.height - top, y1 - y0 + 1 + FOLGA * 2);

  console.log(`desenho: (${x0},${y0}) até (${x1},${y1})`);
  console.log(`recorte: ${width}x${height} a partir de (${left},${top})`);

  // ⚠️ Qualidade alta: a planta traz o número do lote e a metragem impressos em corpo pequeno, e é
  // isso que o corretor lê no zoom. Compressão barata borra justamente essa informação.
  await sharp(limpo, {
    raw: { channels: info.channels, height: info.height, width: info.width },
  })
    .extract({ height, left, top, width })
    .jpeg({ mozjpeg: true, quality: 92 })
    .toFile(SAIDA);

  fs.writeFileSync(
    RECORTE,
    JSON.stringify({
      altura: height,
      largura: width,
      // O viewBox que a página tem que usar para o overlay cair em cima do lote certo.
      viewBox: `${left} ${top} ${width} ${height}`,
      x: left,
      y: top,
    }),
    "utf8",
  );

  console.log(`gravado: ${SAIDA} (${(fs.statSync(SAIDA).size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`recorte: ${RECORTE}`);
}

await principal();
