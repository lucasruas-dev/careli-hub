// ONDE MORA O DESENHO DE CADA LANÇAMENTO, para o telão do salão.
//
// ⚠️ Não confundir com MASTERPLANS_INTERNOS (lib/apolo/incorporador/empreendimentos-do-portal.ts):
// aquele é a tela A-INTERNO do PORTAL, um HTML completo com os lotes já embutidos como dados,
// feito para o corretor navegar. Este aqui é o TELÃO: imagem de fundo + os contornos dos lotes,
// pintados ao vivo pela situação. Formatos diferentes, propósitos diferentes.
//
// O desenho vem do arquivo que o designer entrega, com uma camada por cima onde CADA LOTE é um
// path nomeado com o `name` da unidade no C2X (`RVPA01`). Foi assim que o Villa Paris chegou em
// 28/08/2026 — 97 lotes casando 1 para 1 com o C2X, conferido antes de entrar aqui.
//
// ⚠️ Antes de acrescentar um lançamento nesta lista, CONFIRA a correspondência lendo os nomes no
// banco: um path chamado errado não quebra nada, ele só nunca pinta — e ninguém percebe até o
// dia do evento, com o mapa projetado e um lote teimando em ficar cinza.

export type DesenhoDoMasterplan = {
  /** Imagem de fundo (a arte do loteamento), servida de /public. */
  base: string;
  /** JSON `{ "RVPA01": "M ... Z", ... }` com o contorno de cada lote. */
  contornos: string;
  /** O mesmo viewBox do arquivo original — os paths estão nessas coordenadas. */
  viewBox: string;
};

const POR_CODIGO: Record<string, DesenhoDoMasterplan> = {
  // ⚠️ JARDIM DAS GERAIS: a geometria aqui foi RECONSTRUIDA, e nao recebida do designer.
  // Diferente de todos os outros masterplans da casa, que saem de um SVG com um path por lote
  // rotulado em `inkscape:label`, o JDG so tinha material raster: o .cdr veio vazio (11 KB, sem
  // desenho) e o PDF de 1,5 GB e um PSD achatado - 820 camadas de imagem e ZERO vetor.
  //
  // O que salvou foi o TEXTO do PDF, que traz as 46 quadras e os 442 lotes com coordenada
  // exata. Os contornos vieram de Voronoi semeado nesses pontos, recortado pela mancha de cada
  // quadra: lote de loteamento e fatia entre a rua e o fundo, e a divisa entre dois vizinhos e
  // praticamente a mediatriz entre os centros deles. As arestas batem com as divisas do
  // desenho, mas sao APROXIMADAS - quando o SVG do projetista chegar, este arquivo e
  // substituido pelo caminho normal (scripts/apolo/masterplan-geometria-*.mjs).
  //
  // ⚠️ 436 dos 442 lotes. Seis ficaram de fora porque caem em quadras que se tocam sem rua no
  // meio (10, 11 e 42) e a associacao lote->quadra ficou ambigua: JDG1018, JDG1020, JDG1101,
  // JDG1102, JDG4201 e JDG4202. Eles nao pintam no telao ate serem conferidos contra a carga
  // do C2X - que na data desta entrada ainda nao existia (o JDG tinha ZERO unidades).
  JDG: {
    base: "/masterplans-telao/jardim-das-gerais.jpg",
    contornos: "/masterplans-telao/jardim-das-gerais-lotes.json",
    viewBox: "0 0 3840 2160",
  },
  RVP: {
    base: "/masterplans-telao/villa-paris.jpg",
    contornos: "/masterplans-telao/villa-paris-lotes.json",
    viewBox: "0 0 3840 2160",
  },
};

/** O desenho do lançamento, ou `null` quando esse empreendimento ainda não tem mapa. */
export function desenhoDoMasterplan(
  enterpriseCode: null | string | undefined,
): null | DesenhoDoMasterplan {
  const codigo = String(enterpriseCode ?? "")
    .trim()
    .toUpperCase();
  return codigo ? (POR_CODIGO[codigo] ?? null) : null;
}
