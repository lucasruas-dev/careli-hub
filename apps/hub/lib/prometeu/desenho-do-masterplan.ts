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
  // ⚠️ JARDIM DAS GERAIS: geometria RECONSTRUIDA DA ARTE, validada pela CARGA DO C2X.
  // O JDG e o unico lancamento sem SVG do projetista (o .cdr veio vazio; o PDF de 1,5 GB e um
  // PSD achatado). Depois que a primeira tentativa reprovou, o Lucas regravou a arte com as
  // divisas em BRANCO e os numeros ampliados (29/08), e a reconstrucao passou a ser guiada por
  // dado, nao por olho:
  //   • numeros de lote LIDOS da propria arte (cluster de glifos + leitura visual), quadra pelo
  //     marcador vermelho — a numeracao da arte nova NAO bate com a do PDF antigo;
  //   • corte por watershed global (linha branca e arvore = muralha; borda de quadra = muralha
  //     absoluta; sementes-fantasma absorvem area sem dono) + reparo por pares e ajuste final
  //     proporcionais a AREA DA CARGA;
  //   • QA final: 250/250 unidades da carga com poligono, correlacao area-desenho x area-carga
  //     0,88, nenhum lote com desvio > 35%. Scripts em scripts/prometeu/masterplan-jdg/.
  // Quando o SVG do urbanismo chegar, este arquivo sai e volta o caminho normal.
  JDG: {
    base: "/masterplans-telao/jardim-das-gerais.png",
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
