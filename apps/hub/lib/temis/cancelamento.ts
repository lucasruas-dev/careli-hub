// O QUE É ESTE CANCELAMENTO — quem decide é o sistema, não quem clica.
//
// Regra do Lucas (02/09/2026): *"na verdade o botão que vamos ter é de cancelamento, o sistema vai
// ter que identificar se aquele cancelamento vai precisar de um distrato ou não"*.
//
// ⚠️ QUEM ABRE A SOLICITAÇÃO NÃO ESCOLHE O TIPO, e isso é a proteção principal desta tela. Um
// atendente que precisasse escolher entre "cancelamento" e "distrato" acertaria na maioria e
// erraria no caso raro — e o caso raro aqui é o que tem dinheiro do cliente no meio. As duas
// perguntas que decidem (assinou? pagou?) são fato do contrato, não opinião de quem atende.
//
// ⚠️ E É O PAGAMENTO QUE ABRE A DEVOLUÇÃO. Cancelar um contrato pago sem devolver é reter dinheiro
// de quem saiu; devolver num contrato não pago é pagar duas vezes. Por isso a conta de valores e a
// coleta dos dados bancários entram no fluxo pela classificação, e não por alguém lembrar.

export type ClassificacaoDoCancelamento = {
  /** Precisa colher dados bancários e apurar o que devolver. */
  devolveValores: boolean;
  /** O que explicar a quem abriu a solicitação, na própria tela. */
  porque: string;
  tipo: "cancelamento" | "distrato";
};

export type FatosDoContrato = {
  /**
   * Todas as assinaturas foram colhidas.
   *
   * ⚠️ PARCIAL CONTA COMO NÃO ASSINADO. Contrato com três de cinco assinaturas não obriga ninguém:
   * tratá-lo como assinado geraria distrato de um contrato que juridicamente não se formou.
   */
  assinaturaCompleta: boolean;
  /** Houve QUALQUER pagamento — ato, sinal ou parcela. */
  houvePagamento: boolean;
};

/**
 * A classificação, pelas duas perguntas.
 *
 * | assinatura | pagamento | resultado                              |
 * |------------|-----------|----------------------------------------|
 * | não        | não       | cancelamento                            |
 * | sim        | não       | distrato                                |
 * | sim        | sim       | distrato + devolução                    |
 * | não        | sim       | distrato + devolução                    |
 *
 * ⚠️ PAGOU SEM ASSINAR TAMBÉM É DISTRATO. Parece contraintuitivo — sem assinatura não há contrato
 * formado —, mas o dinheiro entrou, e desfazer o que envolve dinheiro do cliente precisa do
 * instrumento que registra o acerto. Regra do Lucas: *"se houve o pagamento e não houve assinatura,
 * distrato e a solicitação dos dados bancários"*.
 */
export function classificarCancelamento(fatos: FatosDoContrato): ClassificacaoDoCancelamento {
  if (fatos.houvePagamento) {
    return {
      devolveValores: true,
      porque: fatos.assinaturaCompleta
        ? "o contrato foi assinado e houve pagamento: exige distrato e devolução dos valores devidos"
        : "houve pagamento antes de as assinaturas fecharem: exige distrato e devolução dos valores devidos",
      tipo: "distrato",
    };
  }

  if (fatos.assinaturaCompleta) {
    return {
      devolveValores: false,
      porque: "o contrato foi assinado por todos e nada foi pago: exige distrato, sem devolução",
      tipo: "distrato",
    };
  }

  return {
    devolveValores: false,
    porque: "as assinaturas não fecharam e nada foi pago: o contrato não chegou a se formar",
    tipo: "cancelamento",
  };
}
