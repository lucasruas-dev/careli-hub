// A PONTE ENTRE O HÉRCULES E A TÊMIS — a venda vira trabalho de contrato.
//
// Regra do Lucas (02/09/2026): *"contrato vai nascer do hercules, o coordenador ou operador vai
// inputar a proposta e vai ter a opção de emissão de contrato"*.
//
// ⚠️ É AQUI QUE O ACORDO COMERCIAL VIRA OBRIGAÇÃO JURÍDICA, e essa é a fronteira entre os dois
// módulos. Até este ponto é Hércules (negociação, que ainda pode mudar); daqui em diante é Têmis (o
// documento que o comprador assina). Por isso a emissão é um ATO — um clique com data e autor — e
// não uma consequência automática de a venda ficar confirmada: existe venda confirmada que espera
// documentação, e gerar contrato sozinho tiraria de alguém a decisão de quando o cliente é
// convidado a assinar.

import { servicoDisponivel } from "@/lib/temis/documentos-do-empreendimento";

export type VendaParaEmitir = {
  /** Já existe trabalho de contrato aberto para esta venda? */
  contratoJaEmitido: boolean;
  /** Os tipos de documento publicados no empreendimento. */
  documentosPublicados: ("cancelamento" | "cessao" | "contrato" | "distrato")[];
  /** A venda aponta para um plano, e o plano decide qual minuta usar. */
  planoTemMinuta: boolean;
  situacao: "cancelada" | "confirmada" | "rascunho";
};

export type PodeEmitir = { ok: true } | { porque: string; ok: false };

/**
 * A venda pode virar contrato?
 *
 * ⚠️ AS QUATRO PERGUNTAS ESTÃO EM ORDEM DE QUEM RESOLVE. Situação e emissão anterior são fatos da
 * venda, e quem clicou resolve na hora; minuta publicada e vínculo com o plano são configuração do
 * empreendimento, que depende de outra pessoa. Perguntar pela configuração antes faria o operador ir
 * atrás do jurídico para descobrir, no fim, que a venda estava cancelada.
 *
 * ⚠️ ESTA FUNÇÃO NÃO ESTÁ LIGADA A NADA, E ISSO IMPORTA PARA QUEM CHEGAR AQUI DEPOIS. Medido em
 * 26/09/2026 (`grep -rn podeEmitirContrato` em app/, lib/ e modules/): a única referência viva é o
 * próprio `emitir-contrato.test.ts`. Nenhuma rota passa por ela.
 *
 * ⚠️ E ELA NÃO PERGUNTA PELA CAD. Lucas (26/09/2026): *"faz uma barra, para enviar para contrato
 * precisa da cad validada"*. A barra foi implementada nas portas que rodam de verdade
 * (`app/api/incorporador/venda/contrato/route.ts`, `lib/temis/contrato-servico.ts`,
 * `lib/assinatura/envio-db.ts` e `lib/temis/trabalhos-db.ts`), por `recusaDaCadParaContrato` /
 * `recusaDaCadDaProposta` em `lib/hercules/cad-para-contrato.ts`. Quem for LIGAR esta régua a uma rota
 * um dia tem que acrescentar a quinta pergunta aqui, ou a casa passa a ter uma segunda régua mais
 * frouxa que o typecheck aprova, o teste cobre e a produção obedece — o padrão que a casa chama de
 * "efeito colateral que não derruba e some".
 */
export function podeEmitirContrato(venda: VendaParaEmitir): PodeEmitir {
  if (venda.situacao === "cancelada") {
    return { ok: false, porque: "esta venda foi cancelada" };
  }

  // ⚠️ RASCUNHO NÃO GERA CONTRATO. No salão, o rascunho é o momento em que duas pessoas disputam o
  // mesmo lote — gerar documento a partir dele poria no papel uma venda que ainda pode não existir.
  if (venda.situacao === "rascunho") {
    return { ok: false, porque: "a venda ainda é rascunho: confirme antes de emitir o contrato" };
  }

  // ⚠️ UM CONTRATO POR VENDA. Sem esta trava, dois cliques em segundos abrem dois trabalhos, e o
  // board mostra a mesma pessoa duas vezes na fila de assinatura — que é como se despacha dois
  // contratos do mesmo imóvel para o mesmo comprador.
  if (venda.contratoJaEmitido) {
    return { ok: false, porque: "o contrato desta venda já foi emitido e está no board da Têmis" };
  }

  const doEmpreendimento = servicoDisponivel("contrato", {
    documentosPublicados: venda.documentosPublicados,
    taxaDeCessao: null,
  });
  if (!doEmpreendimento.ok) {
    return { ok: false, porque: doEmpreendimento.faltando.join("; ") };
  }

  // ⚠️ O PLANO É QUEM DECIDE A MINUTA. Regra da casa: *"a unidade x foi vendida no plano a, aí o
  // contrato que vai ser gerado é do plano"*. Com o empreendimento tendo minuta publicada mas o
  // plano sem vínculo, a confecção chegaria sem saber qual texto usar — e pararia depois de o card
  // já ter nascido.
  if (!venda.planoTemMinuta) {
    return {
      ok: false,
      porque: "o plano desta venda não aponta para nenhuma minuta: vincule na tela de Planos",
    };
  }

  return { ok: true };
}
