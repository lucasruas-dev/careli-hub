// A CHAVE DE UMA LINHA DA CARTEIRA — e por que o id da unidade não serve.
//
// Nívea, 21/09/2026, no Financeiro do portal da Gurgel: *"O filtro não está funcionando. O Luna
// está precisando de alguns boletos e não está conseguindo filtrar."* Lucas, confirmando:
// *"realmente, ao clicar no veredas não está filtrando"*.
//
// ⚠️ O FILTRO FUNCIONAVA. Medido na sessão real em 21/09/2026: a tela pede
// `?code=pai:044f4f12…` (o Veredas), o servidor responde 200 com 38 unidades, TODAS do Veredas, e o
// contador da tela mostra 38 — certo. O que estava errado era o DOM: sobravam 18 linhas da consulta
// anterior (10 VOC, 6 VOL e 2 REP), misturadas no meio das 38. Quem olhava via Vale do Ouro dentro
// do Veredas e concluía, com razão, que o filtro não pegou.
//
// ⚠️ A CAUSA É CHAVE REPETIDA NO REACT. A lista usava `key={unit.id}`, e o id é o da UNIDADE — que
// aparece MAIS DE UMA VEZ quando o lote foi revendido ou cedido: cada contrato vira uma linha. Na
// resposta "Todos" da Gurgel são 473 linhas para 453 ids distintos; o id 2646 (REPC96), por exemplo,
// tem duas linhas, uma de LUCIMAR e outra de SIMONE. Com chave duplicada o React não sabe casar o
// que era com o que passou a ser, e ao trocar de filtro ele deixa nós órfãos na tabela.
//
// ⚠️ E A MESMA CHAVE ABRE A LINHA. `abertas` guarda quem está expandido; com o id da unidade, clicar
// para ver as parcelas de um contrato abria também o outro contrato do mesmo lote.

/** O que identifica uma linha: a unidade, o contrato e o comprador daquela linha. */
export type LinhaDaCarteira = {
  client?: null | string;
  contractCode?: null | string;
  id: number | string;
};

/**
 * A chave estável de uma linha da carteira.
 *
 * ⚠️ NÃO USA O ÍNDICE DA LISTA, de propósito: a tabela ordena por seis colunas diferentes, e índice
 * como chave faria o React remontar tudo a cada ordenação — trocando o estado de "aberta" de linha.
 * Unidade + contrato + comprador é o que distingue duas linhas do mesmo lote e não muda quando a
 * ordem muda.
 */
export function chaveDaLinhaDaCarteira(unit: LinhaDaCarteira): string {
  const partes = [
    String(unit.id ?? "").trim(),
    String(unit.contractCode ?? "").trim(),
    String(unit.client ?? "").trim().toLowerCase(),
  ];
  return partes.join("|");
}
