// O QUE A ROTA PÚBLICA DO PDF DA SIMULAÇÃO ACEITA — preço e entrada, conferidos no servidor.
//
// Revisão de 18/09/2026, com os planos do Garden ganhando desconto (0178): a rota do PDF do espelho
// público (`app/api/publico/espelho/simulacao`) aceitava o `valor` e a `entrada` que viessem no corpo,
// sem piso nenhum, numa página SEM LOGIN. Com o plano de desconto, a folha passou a imprimir "Valor de
// tabela" e "Desconto X%" calculados desse valor: qualquer pessoa com o link baixava uma folha com a
// marca da casa dizendo "Desconto 50%".
//
// ⚠️ A TELA NÃO É A ÚLTIMA PALAVRA. O simulador no modo simulação já prende o desconto ao do plano
// (`SimuladorDeProposta`, `ajusteDaTela`), mas o corpo da requisição é do cliente e se escreve à mão.
// Aqui o servidor põe o chão de novo, com a mesma régua da casa:
//
//   • o valor nunca fica abaixo do menor preço de plano do lote (a tabela com o MAIOR desconto de
//     plano cadastrado, `menorPrecoDePlano`) e nunca acima da tabela (no espelho não existe acréscimo);
//   • a entrada nunca fica abaixo do piso do empreendimento (`entradaMinima`, o mesmo da Mesa) nem
//     acima do valor.

import { entradaMinima } from "../composicoes";
import { menorPrecoDePlano } from "../tabela-do-lote";

/** Um número do corpo, em reais com centavos; lixo vira nulo. */
function reais(v: unknown): null | number {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function valoresDaSimulacaoPublica(entrada: {
  /** O piso do empreendimento (`pisoDeEntradaPublico`). Nulo = padrão da casa. */
  entradaMinimaPercentual: null | number;
  /** A entrada que veio no corpo. */
  entradaPedida: unknown;
  /** Os planos do empreendimento, com o desconto de cada um. */
  planos: ReadonlyArray<{ descontoPercentual?: unknown }>;
  /** A tabela do lote, lida do banco. */
  precoDeTabela: number;
  /** O valor que veio no corpo. Ausente = a tabela. */
  valorPedido: unknown;
}): { entrada: number; valor: number } {
  const { precoDeTabela } = entrada;
  const piso = menorPrecoDePlano(precoDeTabela, entrada.planos);
  const pedido = reais(entrada.valorPedido);
  const valor = Math.min(
    precoDeTabela,
    Math.max(piso, pedido !== null && pedido > 0 ? pedido : precoDeTabela),
  );

  const minima = entradaMinima(valor, entrada.entradaMinimaPercentual);
  const entradaPedida = reais(entrada.entradaPedida) ?? 0;
  return {
    entrada: Math.min(valor, Math.max(minima, entradaPedida)),
    valor,
  };
}
