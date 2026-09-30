// O LOTE ANTIGO E O LOTE NOVO DO GARDEN, nos dois sentidos. Funções PURAS, sem banco.
//
// O Garden foi renumerado. O LSoft guarda o lote ANTIGO, da numeração corrida do loteamento (as
// colunas `quadra` e `lote` de `lsoft_parcelas`, e o texto de `observacoes`); o Panteon, os boletos
// (`boletos_documentos`, `boletos_parcelas`, `boletos_pagamentos`) e o mapa usam o NOVO ("Q12 L26").
// Quem precisa atravessar de um para o outro importa daqui: a carteira do Financeiro (uma linha por
// lote novo, lib/lsoft/carteira-no-financeiro.ts) e a baixa que o hub dá no LSoft a partir do boleto
// pago (Lucas, 29/09/2026: *"a partir de setembro, quem alimenta a carteira é o hub"*).
//
// ⚠️ O MAPA É UM RETRATO CONFERIDO, E NÃO UMA TABELA VIVA. `dados/garden-lotes.json` é a cópia, para
// o app importar, de scripts/carteira/dados/garden-lote-antigo-para-novo.json (congelado em
// 29/09/2026, 143 lotes, sem nome nem CPF de comprador): a regra `loteDeHoje` de
// scripts/boletos/carregar-garden.mjs aplicada às três planilhas da renumeração. Lote que não está
// nele não tem conversão, e quem chama decide o que fazer com isso (a carteira avisa na linha).
//
// ⚠️ A CHAVE É O NÚMERO DO LOTE ANTIGO, E A QUADRA NÃO VETA. A numeração antiga é corrida no
// loteamento inteiro (143 números distintos no mapa, nenhum repetido), então o número sozinho já diz
// qual é o lote. E a quadra que o LSoft gravou erra: medido em 29/09/2026 nos 106 clientes do Garden
// na carteira, 4 têm a quadra do LSoft diferente da do mapa (o 151 gravado na quadra 9, o 343 e o 374
// na 12, o 107 na 16), e nos 4 o boleto do MESMO CPF confirma o lote que o mapa dá pelo número. Vetar
// pela quadra jogaria esses 4 no "sem lote". A divergência vem marcada (`quadraDiverge`) para quem
// quiser mostrar.

import MAPA from "./dados/garden-lotes.json";

/** Uma linha do mapa: o lote antigo (número corrido), a quadra antiga (pode faltar) e o novo. */
export type LoteDoMapaDoGarden = { antigo: string; novo: string; quadra: null | string };

/** O número sem zero à esquerda ("0397" e "397" são o mesmo lote); nulo se não houver número. */
function numeroLimpo(valor: unknown): null | string {
  const casa = String(valor ?? "").trim().match(/^0*(\d+)$/);
  if (!casa) return null;
  return String(Number(casa[1]));
}

/**
 * "Q12 L26", "Q12-L26", "q12 l26", "Q 12 L 26" → quadra "12" e lote "26" (dois dígitos no mínimo).
 * Qualquer outra coisa (o código solto "00000487", "APTO 205"): nulo.
 */
export function partesDoLoteNovo(unidade: unknown): null | { lote: string; quadra: string } {
  const casa = String(unidade ?? "").trim().match(/^Q\s*0*(\d{1,3})\s*[-\s/]?\s*L\s*0*(\d{1,4})$/i);
  if (!casa) return null;
  return { lote: String(casa[2]).padStart(2, "0"), quadra: String(casa[1]).padStart(2, "0") };
}

/** O rótulo do lote novo como o boleto e o mapa escrevem ("Q12 L26"); nulo se não for lote. */
export function rotuloDoLoteNovo(unidade: unknown): null | string {
  const partes = partesDoLoteNovo(unidade);
  return partes ? `Q${partes.quadra} L${partes.lote}` : null;
}

const LOTES: readonly LoteDoMapaDoGarden[] = (MAPA.lotes as Array<{ antigo: string; novo: string; quadra: string }>)
  .map((linha) => ({
    antigo: numeroLimpo(linha.antigo) ?? "",
    novo: rotuloDoLoteNovo(linha.novo) ?? "",
    quadra: numeroLimpo(linha.quadra),
  }))
  .filter((linha) => linha.antigo !== "" && linha.novo !== "");

const PELO_ANTIGO = new Map(LOTES.map((linha) => [linha.antigo, linha]));
const PELO_NOVO = new Map(LOTES.map((linha) => [linha.novo, linha]));

/** O mapa inteiro, na ordem do arquivo. Só leitura. */
export function lotesDoMapaDoGarden(): readonly LoteDoMapaDoGarden[] {
  return LOTES;
}

/**
 * A conversão do lote antigo, com o que dá para saber dela.
 *
 * @param quadra A quadra que o LSoft gravou (só para marcar a divergência; ver o cabeçalho).
 * @param lote   O número do lote antigo ("397", "0397" ou 397).
 * @returns nulo quando o número não está no mapa (ou não é número).
 */
export function conversaoDoLoteAntigo(
  quadra: null | number | string | undefined,
  lote: null | number | string | undefined,
): null | { novo: string; quadraDiverge: boolean; quadraDoMapa: null | string } {
  const antigo = numeroLimpo(lote);
  if (!antigo) return null;
  const linha = PELO_ANTIGO.get(antigo);
  if (!linha) return null;
  const quadraInformada = numeroLimpo(quadra);
  return {
    novo: linha.novo,
    quadraDiverge: quadraInformada !== null && linha.quadra !== null && quadraInformada !== linha.quadra,
    quadraDoMapa: linha.quadra,
  };
}

/** Lote antigo do LSoft → lote novo ("Q12 L26"). Nulo = sem conversão no mapa. */
export function loteNovoDoAntigo(
  quadra: null | number | string | undefined,
  lote: null | number | string | undefined,
): null | string {
  return conversaoDoLoteAntigo(quadra, lote)?.novo ?? null;
}

/**
 * Lote novo ("Q12 L26", "Q12-L26") → lote antigo, como o LSoft o guarda.
 *
 * ⚠️ QUEM CASA COM `lsoft_parcelas` CASA PELO `lote`, E NÃO PELO PAR (quadra, lote): a quadra do
 * LSoft diverge da do mapa em 4 dos 106 clientes (ver o cabeçalho). A `quadra` devolvida é a do mapa
 * (a antiga, sem zero à esquerda) e pode ser nula: o antigo 284 veio com a quadra em branco.
 */
export function loteAntigoDoNovo(novo: unknown): null | { lote: string; quadra: null | string } {
  const rotulo = rotuloDoLoteNovo(novo);
  if (!rotulo) return null;
  const linha = PELO_NOVO.get(rotulo);
  return linha ? { lote: linha.antigo, quadra: linha.quadra } : null;
}

/** "216 E 217", "287/288/289", "90, 91": os números separados por barra, vírgula, "&" ou " E ". */
const SEPARADOR = String.raw`\s*(?:\/|,|&|\s+E\s+)\s*`;
const CITACAO = new RegExp(String.raw`\bLOTE[SV]?\s*:?\s*(\d+(?:${SEPARADOR}\d+)*)`, "gi");
const ENTRE_NUMEROS = new RegExp(SEPARADOR, "i");

/**
 * Os lotes antigos que o texto de uma parcela do LSoft cita, na ordem, sem repetir.
 *
 * O LSoft do Garden escreve o lote em `observacoes` de uns dez jeitos, todos medidos em 29/09/2026
 * nos 106 clientes da carteira: "LOTE: 76 - QUADRA: 09", "LOTE 402 QUADRA 12 PARCELA ANUAL",
 * "LOTE: 216 E 217\r\nQUADRA: 04", "LOTES: 287/288/289 - QUADRA: 17", "LOTE:74/75  QUADRA:09" e até
 * "ENTRADA LOTEV 179" (o V é erro de digitação, e o lote é o 179). O que vem depois da quadra
 * ("84 PARC 2119,05", "ENTRADA 1/2") não é lote e não entra: só conta o número colado ao "LOTE".
 */
export function lotesCitadosNoTexto(texto: unknown): string[] {
  const achados: string[] = [];
  for (const casa of String(texto ?? "").matchAll(CITACAO)) {
    for (const pedaco of String(casa[1] ?? "").split(ENTRE_NUMEROS)) {
      const numero = numeroLimpo(pedaco);
      if (numero && !achados.includes(numero)) achados.push(numero);
    }
  }
  return achados;
}
