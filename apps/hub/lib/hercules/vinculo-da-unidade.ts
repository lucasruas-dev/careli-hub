// VINCULAR A UNIDADE À CATEGORIA — a régua pura, sem banco.
//
// Lucas (15/09/2026): *"eu criei umas categorias mas não tem como eu vincular a unidade aquela
// categoria, não temos a tela de cadastro da unidade a qual eu posso vincular aquela unidade ao
// filho, categoria"*. E sobre COMO isso vai acontecer: *"vai ocorrer das duas formas, normalmente
// vamos subir em massa essa configuração na importação de unidades, mas teremos cenários que
// precisamos cadastrar uma unidade nova e apontar essa estrutura, ou até mesmo atualizar"*.
//
// ⚠️ O MESMO TERRENO TEM DUAS LINHAS, E O VÍNCULO TEM DE ALCANÇAR AS DUAS. Medido em 15/09/2026:
// no Lagoa Bonita, 495 linhas vivem no PAI (31) e 412 delas são espelho das linhas das glebas
// (LBF 33, LBP 32, LBR 27). Carimbar a categoria só na linha que o operador clicou recriaria, numa
// coluna nova, exatamente a divergência pai × filho que a migration 0161 existe para acabar: o mapa
// do pai diria "Condomínio" e a Mesa de Venda, que lê a gleba, diria "sem categoria".
//
// ⚠️ E A CHAVE DO TERRENO É QUADRA + LOTE, NÃO O CÓDIGO. O código muda de prefixo entre os níveis
// (`LABC0101` no pai, `LBRC0101` na gleba); a quadra e o lote são os mesmos. É a mesma chave que a
// contagem de categorias já usa (`temis/categorias/route.ts`) e que o `segmentar-unidades.mjs` usa
// para casar pai e filho.
//
// ⚠️ MUDAR A CATEGORIA NÃO MEXE EM VENDA ANDANDO, e isso é decisão do Lucas: *"não muda nada o que
// já está venda andando"*. A proposta CONGELA as condições quando nasce (`condicoes.plano` guarda
// entrada, parcelas, juros, índice e sistema), então trocar a categoria depois não altera contrato
// nenhum — muda apenas o que será oferecido nas PRÓXIMAS simulações. Por isso não há trava aqui.

import { chaveDaUnidade } from "./unidade-nova";

/** O mínimo que uma linha precisa trazer para esta régua decidir. */
export type LinhaParaVincular = {
  /** O apartamento do prédio (0171). Preenchido = a chave é torre e apartamento, não quadra e lote. */
  apartamento?: null | string;
  categoria_id?: null | string;
  enterprise_id?: null | string;
  id: string;
  lote: null | string;
  quadra: null | string;
  torre?: null | string;
};

/**
 * Normaliza quadra e lote para comparar entre níveis: "01" e "1" são o mesmo lote.
 *
 * ⚠️ O APARTAMENTO NÃO TEM QUADRA NEM LOTE (revisão de 16/09/2026, achado 28 da onda 2). Toda
 * unidade de prédio tem os dois nulos, e sem este ramo todas ganhavam a MESMA chave "|": o vínculo de
 * um apartamento carimbaria o prédio inteiro, e a trava do "|" recusava qualquer apartamento. Com o
 * apartamento preenchido, a chave é a do cadastro de unidades (`chaveDaUnidade("vertical", …)`,
 * "TORRE|APTO", sem zero à esquerda), a mesma que a conferência de duplicado usa. Loteamento e prédio
 * não dividem família (um produto é de um tipo só), então as duas réguas não se cruzam.
 */
export function chaveDoTerreno(linha: {
  apartamento?: null | string;
  lote: null | string;
  quadra: null | string;
  torre?: null | string;
}): string {
  if (String(linha.apartamento ?? "").trim()) {
    return chaveDaUnidade("vertical", {
      apartamento: linha.apartamento,
      lote: linha.lote,
      quadra: linha.quadra,
      torre: linha.torre,
    });
  }
  const limpa = (v: null | string): string =>
    String(v ?? "")
      .trim()
      .toUpperCase()
      // Zero à esquerda não distingue lote: o pai grava "0101" onde a gleba grava "101".
      .replace(/^0+(?=\d)/, "");
  return `${limpa(linha.quadra)}|${limpa(linha.lote)}`;
}

export type PlanoDeVinculo = {
  /** Os ids que vão receber o carimbo — inclui os gêmeos dos escolhidos. */
  ids: string[];
  /** Quantos terrenos distintos o operador está mexendo (não quantas linhas). */
  terrenos: number;
  /** Linhas que entraram por serem gêmeas de uma escolhida, e não por escolha direta. */
  porParentesco: number;
};

/**
 * Dado o que o operador escolheu, quais linhas devem receber o vínculo.
 *
 * ⚠️ O ALCANCE É POR TERRENO, E NÃO POR LINHA. Escolher um lote da gleba carimba também a linha do
 * pai que representa o mesmo terreno, e vice-versa — senão as duas telas passam a discordar sobre a
 * categoria do mesmo lote.
 *
 * ⚠️ E O UNIVERSO É O QUE QUEM CHAMA TROUXE. Esta função não busca nada: ela recebe as linhas
 * candidatas (a família inteira) e decide. Quem chamar com só metade da família carimba só metade —
 * é responsabilidade da rota trazer pai e filhos.
 */
export function planoDeVinculo(
  escolhidos: readonly string[],
  universo: readonly LinhaParaVincular[],
): PlanoDeVinculo {
  const escolhida = new Set(escolhidos.map((i) => String(i).trim()).filter(Boolean));
  if (escolhida.size === 0) return { ids: [], porParentesco: 0, terrenos: 0 };

  const terrenosAlvo = new Set<string>();
  for (const linha of universo) {
    if (escolhida.has(linha.id)) terrenosAlvo.add(chaveDoTerreno(linha));
  }

  const ids: string[] = [];
  let porParentesco = 0;
  for (const linha of universo) {
    if (!terrenosAlvo.has(chaveDoTerreno(linha))) continue;
    ids.push(linha.id);
    if (!escolhida.has(linha.id)) porParentesco += 1;
  }

  return { ids, porParentesco, terrenos: terrenosAlvo.size };
}

/**
 * O que a planilha de importação diz sobre a categoria de cada terreno.
 *
 * ⚠️ CASA POR NOME, PORQUE É O QUE O OPERADOR DIGITA. Ele escreve "Condomínio" na coluna, não um
 * uuid. A comparação ignora caixa e acento — "CONDOMINIO" e "Condomínio" são a mesma categoria, e
 * recusar por causa do acento faria a importação falhar por um detalhe de teclado.
 */
export function categoriaPorNome(
  categorias: readonly { id: string; nome: string }[],
): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const c of categorias) mapa.set(comparavel(c.nome), c.id);
  return mapa;
}

/** Minúsculo, sem acento, sem espaço duplo — a forma de comparar nome digitado. */
export function comparavel(texto: null | string | undefined): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
