// QUAL CANCELAMENTO CABE NESTA UNIDADE.
//
// ⚠️ A VENDA EM CONTRATO NÃO TINHA SAÍDA NENHUMA. Na ficha de um lote em `contrato`, os quatro
// botões aparecem apagados: Reservar só em disponível, Gerar proposta só sobre reserva, Enviar para
// contrato só sobre proposta, e Cancelar só em reserva ou proposta. Quem despachou por engano — ou
// cujo cliente desistiu depois — ficava olhando um lote preso, sem um botão sequer, e a única saída
// era SQL na mão.
//
// ⚠️ E NÃO É O MESMO ATO. Cancelar reserva devolve o lote na hora. Cancelar proposta idem, com
// aviso para os três. Depois do contrato despachado, quem desfaz é o JURÍDICO: pode ser
// cancelamento simples ou distrato com devolução de valores, e a diferença depende de fatos do
// contrato (assinou? pagou?), não da vontade de quem clica. Por isso o terceiro caso abre um
// PEDIDO na Têmis e não mexe na etapa da venda — a mesma razão pela qual o comentário antigo desta
// tela dizia que "o botão que serve para as duas coisas é o botão que alguém clica errado". Ele
// continua valendo: são três ações, com três rótulos e três modais.
//
// ⚠️ O RÓTULO DIZ O QUE ACONTECE. "Solicitar cancelamento" é um verbo que não promete desfazer —
// quem clica sabe que abriu um pedido, e a modal repete que a venda continua em contrato até o
// jurídico decidir.

/** As etapas em que a venda já saiu da mão do coordenador e o desfazer é do jurídico. */
const DEPOIS_DO_CONTRATO = new Set(["assinatura", "contrato", "faturado"]);

export type TipoDaAcaoDeCancelamento = "pedido" | "proposta" | "reserva";

export type AcaoDeCancelamento = {
  /** `null` quando não há nada a cancelar — o botão fica apagado com o motivo no `title`. */
  tipo: null | TipoDaAcaoDeCancelamento;
  /** O texto do `title`: por que pode, ou por que não pode. */
  motivo: string;
  rotulo: string;
};

export type SituacaoDaUnidade = {
  /** A etapa que a grade pinta. */
  etapa: null | string;
  /** Já existe pedido de cancelamento aberto para esta venda? */
  pedidoAberto?: boolean;
  /** Proposta viva nascida no Panteon. */
  propostaNativa: boolean;
  /** Proposta viva que veio da carga do C2X: o cancelamento dela é no legado. */
  propostaDoLegado: boolean;
  /** A venda nativa que chegou ao contrato — só ela pode virar pedido daqui. */
  vendaNativa?: boolean;
};

export function acaoDeCancelamento(u: SituacaoDaUnidade): AcaoDeCancelamento {
  const etapa = String(u.etapa ?? "").trim().toLowerCase();

  if (etapa === "reservado") {
    return {
      motivo: "Cancela a reserva; a unidade volta para a disponibilidade e os três são avisados.",
      rotulo: "Cancelar reserva",
      tipo: "reserva",
    };
  }

  if (etapa === "proposta") {
    if (u.propostaNativa) {
      return {
        motivo:
          "Cancela a proposta; a unidade volta para a disponibilidade, os três são avisados e o PDF deixa de valer.",
        rotulo: "Cancelar proposta",
        tipo: "proposta",
      };
    }
    if (u.propostaDoLegado) {
      return {
        motivo: "Esta proposta veio do C2X: o cancelamento dela é feito lá.",
        rotulo: "Cancelar proposta",
        tipo: null,
      };
    }
  }

  if (DEPOIS_DO_CONTRATO.has(etapa)) {
    // ⚠️ SÓ A VENDA NATIVA. Onze dos treze contratos vivos são do C2X, e o Panteon não escreve no
    // legado: oferecer o pedido ali abriria um card que o jurídico não consegue executar deste lado.
    if (!u.vendaNativa) {
      return {
        motivo: "Este contrato corre no C2X: o cancelamento dele é feito lá.",
        rotulo: "Solicitar cancelamento",
        tipo: null,
      };
    }
    // ⚠️ UM PEDIDO POR VENDA. O segundo clique abriria um segundo card na fila do jurídico para o
    // mesmo contrato, e quem lê o board não tem como saber qual dos dois vale.
    if (u.pedidoAberto) {
      return {
        motivo: "Já existe um pedido de cancelamento na Têmis para esta venda.",
        rotulo: "Cancelamento pedido",
        tipo: null,
      };
    }
    return {
      motivo:
        "Abre um pedido de cancelamento na Têmis. O jurídico decide o instrumento e os valores; a venda continua na etapa em que está.",
      rotulo: "Solicitar cancelamento",
      tipo: "pedido",
    };
  }

  // ⚠️ A UNIDADE VENDIDA CAI AQUI, e a frase precisa dizer a verdade dela: ela não está "sem nada
  // para cancelar" — ela está fora do alcance desta tela. Dizer "não há o que cancelar" num lote
  // vendido manda o coordenador procurar defeito onde não há.
  const foraDoAlcance = etapa === "vendida" || etapa === "distrato" || etapa === "cancelado";
  return {
    motivo: foraDoAlcance
      ? "Esta venda não corre pelo Hércules: o cancelamento dela é tratado pelo jurídico, fora desta tela."
      : "Não há reserva nem proposta para cancelar nesta unidade.",
    rotulo: "Cancelar reserva",
    tipo: null,
  };
}
