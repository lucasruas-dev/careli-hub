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
export const DEPOIS_DO_CONTRATO: ReadonlySet<string> = new Set(["assinatura", "contrato", "faturado"]);

/**
 * AS ETAPAS EM QUE A VENDA JÁ FOI DESFEITA: não há mais venda para nada acompanhar.
 *
 * ⚠️ UMA RÉGUA SÓ PARA "ESTA VENDA ESTÁ MORTA?", E ELA ESTAVA ESCRITA EM TRÊS LUGARES. O motor da
 * conclusão tinha a lista dele (`JA_DESFEITA`), a porta do cancelamento pela Têmis comparava as duas
 * palavras à mão e a Têmis não perguntava nada. Três cópias da mesma pergunta divergem no dia em que
 * uma quarta etapa terminal nascer, e a que ficar para trás é a que deixa card andando sobre venda
 * morta.
 */
export const VENDA_DESFEITA: ReadonlySet<string> = new Set(["cancelado", "distrato"]);

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

  // ⚠️ A RÉGUA JÁ DIZ QUE O PEDIDO EXISTE (21/09/2026). A situação `em_cancelamento` é a marca já
  // peneirada — pedido carimbado E card vivo na Têmis —, e a ficha chega aqui com ela no lugar da
  // etapa. Sem este caso, o lote em cancelamento caía no fim da função e mostrava "Não há reserva
  // nem proposta para cancelar nesta unidade", que manda procurar defeito onde não há.
  if (etapa === "em_cancelamento") {
    return {
      motivo: "Já existe um pedido de cancelamento na Têmis para esta venda.",
      rotulo: "Cancelamento pedido",
      tipo: null,
    };
  }

  if (DEPOIS_DO_CONTRATO.has(etapa)) {
    // ⚠️ O CONTRATO QUE VEIO DO C2X TAMBÉM SE CANCELA AQUI. Até 16/09/2026 só a venda nativa abria
    // pedido, porque o Panteon não escreve no legado. O Lucas decidiu, olhando um contrato da
    // Aldeia (ACP1, importado do C2X) com o botão apagado: *"será feito aqui"*. O pedido abre o
    // mesmo card na Têmis, e quem conclui é o jurídico, pelo Panteon, como na venda nativa.
    //
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
