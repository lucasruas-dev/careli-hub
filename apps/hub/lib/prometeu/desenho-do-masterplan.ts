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
  // ⚠️ O JARDIM DAS GERAIS AINDA NAO TEM MAPA, e a tentativa de 29/08/2026 esta registrada aqui
  // para ninguem repetir. O JDG foi o unico lancamento em que o projetista NAO entregou o SVG
  // com um path por lote: o .cdr veio vazio (11 KB, so o template do Corel), o PDF de 1,5 GB e
  // um PSD achatado (820 camadas de imagem, zero vetor) e o PSD nao tem mascara vetorial.
  //
  // Tentei reconstruir a geometria da imagem, por dois caminhos, e os DOIS reprovaram na
  // conferencia em zoom:
  //   1. WATERSHED semeado nos numeros dos lotes - persegue contraste, e a divisa aqui e uma
  //      linha de ~3px em verde-agua sobre verde com arvores desenhadas por cima: ele contornava
  //      copa de arvore e cortava o lote atravessado.
  //   2. VORONOI entre os numeros - a premissa era que o numero fica no centro do lote e que a
  //      divisa e a mediatriz entre vizinhos. FALSO: os numeros sao posicionados por estetica,
  //      perto da frente do lote, entao as arestas saiam tortas por cima das divisas reais.
  //   3. HOUGH sobre as divisas realcadas - nao achou uma unica divisa de lote; o limiar pegou a
  //      mata clara do topo como ruido.
  //
  // A conclusao e que a imagem NAO permite extrair a geometria: nao e questao de afinar
  // parametro. O que resolve e o mesmo que resolveu em todos os outros - o SVG (ou DWG/DXF) do
  // urbanismo, com um path por lote rotulado. O loteamento foi aprovado em prefeitura, entao a
  // planta vetorial existe.
  //
  // O material levantado (fundo 4K, inventario de 46 quadras / 442 lotes / 273 areas lido do
  // texto do PDF, e os scripts) esta em scripts/prometeu/masterplan-jdg/ e continua valendo: o
  // inventario serve para conferir a carga do C2X, e o fundo e o mesmo. So a GEOMETRIA falta.
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
