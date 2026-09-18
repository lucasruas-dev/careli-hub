import type { SupabaseClient } from "@supabase/supabase-js";

import { type EnvelopeDaProposta, envelopeQueSegura } from "@/lib/assinatura/envio-db";
import { cardsAbertosDaProposta } from "@/lib/temis/cards-abertos-db";
import { rotuloDoMotivo } from "@/lib/temis/indeferimento";

import { codigoDaVenda } from "./codigo-da-venda";
import { ETAPAS_DO_FLUXO } from "./fluxo-de-venda";

// O QUE O INDEFERIMENTO DE UM CARD DA TÊMIS FAZ COM A VENDA NO HÉRCULES.
//
// `lib/temis/indeferimento.ts` promete que indeferir "devolve a quem vendeu". Até 18/09/2026 o
// Hércules nunca soube do indeferimento: o card ia para a coluna Indeferido e a venda ficava parada
// onde estava, sem botão nenhum na tela Venda. Medido em produção: a Nívea indeferiu os pedidos de
// cancelamento do VOL1106 (COD 000019) e do VOC0306 (COD 000021) e os cards de contrato das mesmas
// vendas, e os dois lotes ficaram presos, com a venda em contrato e a marca do pedido de pé.
//
// São dois desfechos, um por tipo de card:
//
//   • PEDIDO DE CANCELAMENTO OU DE DISTRATO INDEFERIDO = o pedido foi RECUSADO. A venda continua como
//     estava, e a marca do pedido (`cancelamento_pedido_*`) sai da proposta: é ela que faz a tela
//     Venda mostrar "Cancelamento pedido" e esconder "Solicitar cancelamento". Sem limpar, quem pediu
//     não consegue pedir de novo nunca mais;
//   • CONTRATO INDEFERIDO = o contrato volta para quem vendeu corrigir. A venda sai de `contrato` e
//     volta para `proposta` (a reserva continua `proposta`), e a tela Venda volta a oferecer
//     "Cancelar proposta" e "Enviar para contrato".
//
// ⚠️ ISTO NUNCA DERRUBA O INDEFERIMENTO. O card já foi para Indeferido quando esta função roda; o
// que dá errado aqui vira AVISO na resposta e linha no log, e a venda fica como estava (o erro
// barato: a venda parada a mais, que a tela da Têmis conta e alguém destrava com um clique).

const WORKSPACE = "careli";

/**
 * Os destinos ESPECIAIS de `hercules_proposta_etapas` para o pedido e a recusa dele: não são etapas
 * (a venda não muda de etapa), são fatos da venda. `historico-da-unidade.ts` os escreve por extenso.
 */
export const MOVIMENTO_PEDIDO_DE_CANCELAMENTO = "pedido_de_cancelamento";
export const MOVIMENTO_PEDIDO_DE_DISTRATO = "pedido_de_distrato";
export const MOVIMENTO_CANCELAMENTO_INDEFERIDO = "pedido_de_cancelamento_indeferido";
export const MOVIMENTO_DISTRATO_INDEFERIDO = "pedido_de_distrato_indeferido";

/** O que aconteceu com a venda, em uma frase para a tela, e o que ficou por fazer. */
export type VendaNoIndeferimento = {
  /** O que NÃO aconteceu e precisa de gente (envelope vivo, leitura que falhou). */
  aviso: null | string;
  /** O que foi feito na venda. `nada` também é resposta: card sem venda, venda em outra etapa. */
  feito: "carimbo_limpo" | "nada" | "voltou_para_proposta";
  /** A frase do recado da tela. `null` quando o card não tem venda ligada. */
  recado: null | string;
};

type CardIndeferido = { id: string; proposta_id: null | string; tipo: string };

type QuemIndeferiu = { motivo: string; observacao: null | string; usuarioNome: null | string };

/**
 * Leva o indeferimento do card para a venda do Hércules.
 *
 * `motivo` e `observacao` são os do indeferimento (já conferidos por `conferirIndeferimento`): vão
 * para o movimento da venda que volta de `contrato` para `proposta`.
 */
export async function devolverVendaNoIndeferimento(
  sb: SupabaseClient,
  card: CardIndeferido,
  quem: QuemIndeferiu,
): Promise<VendaNoIndeferimento> {
  const propostaId = String(card.proposta_id ?? "").trim();
  if (!propostaId) return { aviso: null, feito: "nada", recado: null };

  const tipo = String(card.tipo ?? "").trim();
  try {
    if (tipo === "cancelamento" || tipo === "distrato") {
      return await recusarOPedido(sb, card.id, propostaId, tipo, quem);
    }
    if (tipo === "contrato") {
      return await devolverAQuemVendeu(sb, propostaId, card.id, quem);
    }
    return { aviso: null, feito: "nada", recado: null };
  } catch (erro) {
    console.error("[hercules][indeferimento] a venda não acompanhou o indeferimento", {
      erro,
      propostaId,
      trabalhoId: card.id,
    });
    return {
      aviso: "O card foi indeferido, mas a venda no Hércules não foi atualizada. Avise o time do Panteon.",
      feito: "nada",
      recado: null,
    };
  }
}

/**
 * O PEDIDO RECUSADO: a marca do pedido sai da venda, e a venda fica onde estava.
 *
 * ⚠️ SÓ SE NÃO SOBROU OUTRO PEDIDO ABERTO para a mesma venda. A marca é UMA por venda e trava o
 * segundo pedido; se outro card de cancelamento ou de distrato desta venda ainda anda na Têmis,
 * limpar a marca abriria a porta para um terceiro pedido do mesmo contrato. Leitura que falha
 * também não limpa: "não sei se há outro" não é "não há".
 *
 * ⚠️ SÓ NA VENDA VIVA (etapa do caminho) E SÓ COM A MARCA DE PÉ. Na venda que já caiu por outro
 * card, a marca é história: é dela que a ficha do lote tira a linha "Cancelamento solicitado".
 */
async function recusarOPedido(
  sb: SupabaseClient,
  trabalhoId: string,
  propostaId: string,
  tipo: "cancelamento" | "distrato",
  quem: QuemIndeferiu,
): Promise<VendaNoIndeferimento> {
  const nome = tipo === "distrato" ? "distrato" : "cancelamento";

  const outros = await cardsAbertosDaProposta(sb, {
    exceto: trabalhoId,
    propostaId,
    tipos: ["cancelamento", "distrato"],
  });
  if (!outros.ok) {
    return {
      aviso: `Pedido de ${nome} indeferido, mas não deu para conferir se esta venda tem outro pedido aberto: a marca do pedido ficou na venda. Avise o time do Panteon.`,
      feito: "nada",
      recado: null,
    };
  }
  if (outros.cards.length > 0) {
    return {
      aviso: null,
      feito: "nada",
      recado: `Pedido de ${nome} indeferido. Esta venda tem outro pedido aberto na Têmis, e ele continua valendo.`,
    };
  }

  // ⚠️ A HISTÓRIA ANTES DA LIMPEZA (revisão de 18/09/2026; Lucas: *"tudo tem que ter histórico"*).
  // A linha "Cancelamento solicitado" da ficha do lote sai da marca do pedido: limpar a marca apagava
  // da ficha quem pediu, quando e por quê, e a recusa não entrava em lugar nenhum do Hércules. Os dois
  // fatos viram movimento da venda ANTES de a marca sair; se a gravação falhar, a marca fica (o
  // pedido novo espera, a história não se perde).
  const { data: lida, error: erroDaLeitura } = await sb
    .from("hercules_propostas")
    .select("id, etapa, etapa_desde, cancelamento_pedido_em, cancelamento_pedido_motivo, cancelamento_pedido_por, cancelamento_pedido_tipo")
    .eq("workspace_id", WORKSPACE)
    .eq("id", propostaId)
    .maybeSingle();
  if (erroDaLeitura) {
    console.error("[hercules][indeferimento] falha ao ler o pedido da venda", erroDaLeitura);
    return {
      aviso: `Pedido de ${nome} indeferido, mas não deu para ler a venda: a marca do pedido ficou nela. Avise o time do Panteon.`,
      feito: "nada",
      recado: null,
    };
  }
  const pedido = lida as null | {
    cancelamento_pedido_em: null | string;
    cancelamento_pedido_motivo: null | string;
    cancelamento_pedido_por: null | string;
    cancelamento_pedido_tipo: null | string;
    etapa: string;
    etapa_desde?: null | string;
  };
  if (!pedido?.cancelamento_pedido_em || !(ETAPAS_DO_FLUXO as readonly string[]).includes(String(pedido.etapa ?? ""))) {
    return { aviso: null, feito: "nada", recado: `Pedido de ${nome} indeferido.` };
  }

  const tipoDoPedido = String(pedido.cancelamento_pedido_tipo ?? tipo).trim() === "distrato" ? "distrato" : "cancelamento";
  const agora = new Date().toISOString();
  const { error: erroDaHistoria } = await sb.from("hercules_proposta_etapas").insert([
    {
      autor_nome: pedido.cancelamento_pedido_por,
      de: null,
      motivo: pedido.cancelamento_pedido_motivo,
      observacao: null,
      para: tipoDoPedido === "distrato" ? MOVIMENTO_PEDIDO_DE_DISTRATO : MOVIMENTO_PEDIDO_DE_CANCELAMENTO,
      proposta_id: propostaId,
      quando: pedido.cancelamento_pedido_em,
      workspace_id: WORKSPACE,
    },
    {
      autor_nome: quem.usuarioNome,
      de: null,
      motivo: rotuloDoMotivo(quem.motivo),
      observacao: quem.observacao,
      para: tipoDoPedido === "distrato" ? MOVIMENTO_DISTRATO_INDEFERIDO : MOVIMENTO_CANCELAMENTO_INDEFERIDO,
      proposta_id: propostaId,
      quando: agora,
      workspace_id: WORKSPACE,
    },
  ]);
  if (erroDaHistoria) {
    console.error("[hercules][indeferimento] a história do pedido não foi gravada; a marca fica", {
      erro: erroDaHistoria.message,
      propostaId,
    });
    return {
      aviso: `Pedido de ${nome} indeferido, mas a história do pedido não foi gravada na venda, então a marca do pedido ficou nela. Avise o time do Panteon.`,
      feito: "nada",
      recado: null,
    };
  }

  const { data: limpas, error } = await sb
    .from("hercules_propostas")
    .update({
      atualizado_em: agora,
      cancelamento_pedido_em: null,
      cancelamento_pedido_motivo: null,
      cancelamento_pedido_por: null,
      cancelamento_pedido_tipo: null,
    })
    .eq("id", propostaId)
    // ⚠️ A MARCA QUE FOI LIDA, e não "qualquer marca" (revisão de 18/09/2026): um pedido novo que
    // entrou entre a leitura e esta escrita tem marca própria, e não é ela que este indeferimento recusa.
    .eq("cancelamento_pedido_em", pedido.cancelamento_pedido_em)
    .in("etapa", [...ETAPAS_DO_FLUXO])
    // ⚠️ O `.select()` DIZ SE PEGOU LINHA: sem ele, "a marca saiu" e "não havia marca" seriam a
    // mesma resposta, e a tela contaria uma liberação que não aconteceu.
    .select("id");

  if (error) {
    console.error("[hercules][indeferimento] a marca do pedido não saiu da venda", {
      erro: error.message,
      propostaId,
    });
    return {
      aviso: `Pedido de ${nome} indeferido, mas a marca do pedido não saiu da venda. Avise o time do Panteon.`,
      feito: "nada",
      recado: null,
    };
  }

  if ((limpas ?? []).length === 0) {
    return { aviso: null, feito: "nada", recado: `Pedido de ${nome} indeferido.` };
  }

  // ⚠️ O CONTRATO JÁ INDEFERIDO: A VENDA VOLTA PARA PROPOSTA AGORA (revisão de 18/09/2026). Com o
  // pedido aberto, o indeferimento do contrato segurou a venda em Contrato (ver `devolverAQuemVendeu`);
  // quando o pedido também é recusado, ninguém mais a tirava de lá. Foi o que prendeu VOL1106 e
  // VOC0306: a Nívea indeferiu primeiro o contrato (no VOC0306: "Contrato não será gerado, pois foi
  // solicitado o cancelamento.") e depois o pedido (no VOL1106: "Cancelamento não será realizado, pois
  // não foi gerado contrato nem boletos."). A saída que ela apontou é a proposta: sem contrato, quem
  // vendeu cancela a proposta no Hércules, e o lote volta. Oferecer um pedido novo mandaria de volta
  // à Têmis o que ela recusou.
  //
  // ⚠️ SÓ NO PEDIDO DE CANCELAMENTO, NUNCA NO DE DISTRATO (revisão de 18/09/2026). O distrato só é
  // escolhido quando o sistema apurou pagamento ou assinatura; em Proposta, a venda sairia por
  // "Cancelar proposta", que não confere pagamento nenhum, e o lote voltaria sem devolução ao cliente.
  // No distrato recusado a venda fica em Contrato, e o jurídico decide o caminho.
  //
  // ⚠️ E SÓ COM O INDEFERIMENTO DESTA PASSAGEM POR CONTRATO: o card indeferido tem de ser posterior à
  // entrada da venda em `contrato`. Um indeferimento de uma passagem anterior não diz nada sobre o
  // contrato de agora.
  if (String(pedido.etapa ?? "") === "contrato" && tipoDoPedido === "cancelamento") {
    const contrato = await contratoJaIndeferido(sb, propostaId, pedido.etapa_desde ?? null);
    if (contrato === "falhou") {
      return {
        aviso: `Pedido de ${nome} indeferido, mas não deu para conferir o card de contrato desta venda: ela continua em Contrato no Hércules. Avise o time do Panteon.`,
        feito: "carimbo_limpo",
        recado: null,
      };
    }
    if (contrato) {
      const volta = await devolverAQuemVendeu(sb, propostaId, contrato.id, {
        motivo: contrato.indeferido_motivo ?? "outro",
        observacao: contrato.indeferido_observacao,
        usuarioNome: contrato.indeferido_por_nome,
      });
      if (volta.feito === "voltou_para_proposta") {
        return {
          aviso: null,
          feito: "voltou_para_proposta",
          recado: `Pedido de ${nome} indeferido. Como o contrato desta venda também foi indeferido, ela voltou para Proposta no Hércules: quem vendeu cancela a proposta ou envia de novo.`,
        };
      }
      // A venda não voltou (envelope vivo, outro card, venda que andou): a notícia do pedido vem
      // primeiro, senão quem acabou de indeferir lê só "Contrato indeferido, mas..." e não sabe que a
      // marca saiu.
      const prefixo = `Pedido de ${nome} indeferido, e a marca do pedido saiu da venda.`;
      return {
        aviso: volta.aviso ? `${prefixo} ${volta.aviso}` : null,
        feito: "carimbo_limpo",
        recado: volta.recado ? `${prefixo} ${volta.recado}` : null,
      };
    }
  }

  return {
    aviso: null,
    feito: "carimbo_limpo",
    recado: `Pedido de ${nome} indeferido. A venda continua como estava, e o Hércules volta a oferecer o pedido de cancelamento.`,
  };
}

/**
 * O card de contrato mais recente da venda, se ele acabou indeferido NESTA passagem por contrato.
 *
 * `null` quando não há card de contrato, quando o mais recente não foi indeferido (o contrato anda,
 * ou já foi assinado) ou quando o indeferimento é anterior a `desde` (a entrada da venda em
 * `contrato`): aí a venda fica como está. `"falhou"` quando a leitura não respondeu.
 */
async function contratoJaIndeferido(
  sb: SupabaseClient,
  propostaId: string,
  desde: null | string,
): Promise<"falhou" | null | {
  id: string;
  indeferido_motivo: null | string;
  indeferido_observacao: null | string;
  indeferido_por_nome: null | string;
}> {
  const { data, error } = await sb
    .from("temis_trabalhos")
    .select("id, estagio, indeferido_em, indeferido_motivo, indeferido_observacao, indeferido_por_nome")
    .eq("workspace_id", WORKSPACE)
    .eq("proposta_id", propostaId)
    .eq("tipo", "contrato")
    .order("criado_em", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[hercules][indeferimento] falha ao ler o card de contrato da venda", error.message);
    return "falhou";
  }
  const ultimo = ((data ?? []) as Array<{
    estagio: null | string;
    id: string;
    indeferido_em: null | string;
    indeferido_motivo: null | string;
    indeferido_observacao: null | string;
    indeferido_por_nome: null | string;
  }>)[0];
  if (!ultimo || ultimo.estagio !== "indeferido") return null;
  // Sem a data de entrada em contrato, ou sem a data do indeferimento, não dá para provar que ele é
  // desta passagem: a venda fica como está (o erro barato).
  const entrou = Date.parse(String(desde ?? ""));
  const indeferido = Date.parse(String(ultimo.indeferido_em ?? ""));
  if (!Number.isFinite(entrou) || !Number.isFinite(indeferido) || indeferido < entrou) return null;
  return ultimo;
}

/**
 * O CONTRATO DEVOLVIDO: a venda volta de `contrato` para `proposta`.
 *
 * ⚠️ ENVELOPE VIVO SEGURA A VENDA EM CONTRATO. O Indeferir só aparece na Análise, então não há
 * contrato gerado nem envelope, pelo caminho da tela. Mas o card pode ter voltado para a Análise com
 * um envelope que não se conseguiu cancelar, e devolver a venda para `proposta` com o contrato na
 * rua deixaria a tela Venda oferecendo "Cancelar proposta" sobre um contrato que alguém ainda pode
 * assinar. Não sabe = não devolve (leitura que falha também segura).
 *
 * ⚠️ SÓ DE `contrato` PARA `proposta`, COM A CONDIÇÃO NA ESCRITA. Venda em outra etapa (assinatura,
 * faturada, já cancelada) não se mexe: o indeferimento do card não desfaz o que aconteceu depois.
 */
async function devolverAQuemVendeu(
  sb: SupabaseClient,
  propostaId: string,
  trabalhoId: string,
  quem: QuemIndeferiu,
): Promise<VendaNoIndeferimento> {
  const { data: linha, error: erroDaVenda } = await sb
    .from("hercules_propostas")
    .select("id, etapa, codigo, protocolo_numero, cancelamento_pedido_em")
    .eq("workspace_id", WORKSPACE)
    .eq("id", propostaId)
    .maybeSingle();

  if (erroDaVenda || !linha) {
    if (erroDaVenda) {
      console.error("[hercules][indeferimento] falha ao ler a venda do contrato", erroDaVenda);
    }
    return {
      aviso: "Contrato indeferido, mas não deu para ler a venda no Hércules: ela continua em Contrato. Avise o time do Panteon.",
      feito: "nada",
      recado: null,
    };
  }

  const venda = linha as {
    cancelamento_pedido_em: null | string;
    codigo: null | string;
    etapa: string;
    id: string;
    protocolo_numero: null | number;
  };
  const cod = String(venda.codigo ?? "").trim() || codigoDaVenda(venda.protocolo_numero) || null;
  const aVenda = cod ? `A venda COD ${cod}` : "A venda";
  const etapa = String(venda.etapa ?? "").trim();

  if (etapa !== "contrato") {
    return {
      aviso: null,
      feito: "nada",
      recado: `Contrato indeferido. ${aVenda} não estava em Contrato no Hércules, e não foi mexida.`,
    };
  }

  // ⚠️ PEDIDO DE CANCELAMENTO ABERTO SEGURA A VENDA EM CONTRATO (revisão de 18/09/2026). Devolvida
  // para Proposta, a tela Venda ofereceria "Cancelar proposta", e a venda cairia por ali sem distrato
  // nem devolução de valores, com o card do pedido (talvez um distrato por pagamento feito por fora)
  // largado na fila. Enquanto houver pedido, quem desfaz a venda é a conclusão dele.
  if (venda.cancelamento_pedido_em) {
    return {
      aviso: null,
      feito: "nada",
      recado: `Contrato indeferido. ${aVenda} tem pedido de cancelamento aberto: ela continua em Contrato no Hércules até a Têmis decidir o pedido.`,
    };
  }
  const outrosCards = await cardsAbertosDaProposta(sb, {
    exceto: trabalhoId,
    propostaId,
    tipos: ["cancelamento", "distrato", "contrato"],
  });
  if (!outrosCards.ok) {
    return {
      aviso: `Contrato indeferido, mas não deu para conferir os outros cards desta venda: ${aVenda.toLowerCase()} continua em Contrato no Hércules. Avise o time do Panteon.`,
      feito: "nada",
      recado: null,
    };
  }
  if (outrosCards.cards.length > 0) {
    // ⚠️ OUTRO CARD ABERTO = O CONTRATO NOVO (ou um pedido) JÁ ANDA. Indeferir um card velho (aba
    // antiga, chamada direta à API) não pode puxar para Proposta a venda cujo contrato novo o
    // jurídico está confeccionando.
    return {
      aviso: null,
      feito: "nada",
      recado: `Contrato indeferido. ${aVenda} tem outro card aberto na Têmis, e continua como está no Hércules.`,
    };
  }

  const { data: envelopes, error: erroDoEnvelope } = await sb
    .from("temis_envelopes")
    .select("criado_em, envelope_id, estado, falha, id, provedor")
    .eq("proposta_id", propostaId)
    .order("criado_em", { ascending: false })
    .limit(50);

  if (erroDoEnvelope) {
    console.error("[hercules][indeferimento] falha ao ler os envelopes da venda", erroDoEnvelope);
    return {
      aviso: `Contrato indeferido, mas não deu para conferir o envelope desta venda na Clicksign: ${aVenda.toLowerCase()} continua em Contrato no Hércules. Avise o time do Panteon.`,
      feito: "nada",
      recado: null,
    };
  }

  const vivo = envelopeQueSegura((envelopes ?? []) as EnvelopeDaProposta[]);
  if (vivo) {
    console.warn("[hercules][indeferimento] contrato indeferido com envelope vivo: a venda fica em contrato", {
      envelope: vivo.envelope_id,
      estado: vivo.estado,
      propostaId,
      registro: vivo.id,
    });
    return {
      aviso: `Contrato indeferido, mas ${aVenda.toLowerCase()} continua em Contrato no Hércules: existe envelope vivo deste contrato na Clicksign (${vivo.envelope_id ?? `registro ${vivo.id}`}). Cancele o envelope por lá antes de devolver a venda.`,
      feito: "nada",
      recado: null,
    };
  }

  const agora = new Date().toISOString();
  const { data: voltadas, error: erroDaVolta } = await sb
    .from("hercules_propostas")
    .update({
      atualizado_em: agora,
      etapa: "proposta",
      // ⚠️ O MAPA PINTA PELA PROPOSTA DE `etapa_desde` MAIS RECENTE, e a ficha do lote conta o autor
      // do passo por `etapa_por`: os dois andam juntos com a etapa, como no envio para contrato.
      etapa_desde: agora,
      etapa_por: quem.usuarioNome,
    })
    .eq("id", propostaId)
    .eq("etapa", "contrato")
    .is("cancelamento_pedido_em", null)
    .select("id");

  if (erroDaVolta) {
    console.error("[hercules][indeferimento] a venda não voltou para proposta", erroDaVolta);
    return {
      aviso: `Contrato indeferido, mas ${aVenda.toLowerCase()} não voltou para Proposta no Hércules. Avise o time do Panteon.`,
      feito: "nada",
      recado: null,
    };
  }
  if ((voltadas ?? []).length === 0) {
    return {
      aviso: null,
      feito: "nada",
      recado: `Contrato indeferido. ${aVenda} saiu de Contrato no Hércules enquanto a tela estava aberta, e não foi mexida.`,
    };
  }

  // ⚠️ O PASSO VIRA LINHA NO HISTÓRICO, como no envio para contrato (Lucas, 05/09/2026: *"tudo tem
  // que ter histórico"*). E não derruba a volta se falhar: a venda já está em `proposta`.
  const { error: erroDoMovimento } = await sb.from("hercules_proposta_etapas").insert({
    autor_nome: quem.usuarioNome,
    de: "contrato",
    motivo: `Contrato indeferido na Têmis: ${rotuloDoMotivo(quem.motivo)}`,
    observacao: quem.observacao,
    para: "proposta",
    proposta_id: propostaId,
    quando: agora,
    workspace_id: WORKSPACE,
  });
  if (erroDoMovimento) {
    console.error("[hercules][indeferimento] falha ao registrar o movimento", erroDoMovimento);
  }

  return {
    aviso: null,
    feito: "voltou_para_proposta",
    recado: `Contrato indeferido. ${aVenda} voltou para Proposta no Hércules: quem vendeu corrige e envia de novo.`,
  };
}
