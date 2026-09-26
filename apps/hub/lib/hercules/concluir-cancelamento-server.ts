import type { SupabaseClient } from "@supabase/supabase-js";

import type { PortaDaClicksign } from "@/lib/assinatura/clicksign/cliente";
import { cancelarEnvelope, consultarEnvelope } from "@/lib/assinatura/clicksign/envelope";
import {
  COLUNAS_PARA_CANCELAR,
  type EnvelopeParaCancelar,
  envelopeQueSegura,
} from "@/lib/assinatura/envio-db";
import { classificarCancelamento } from "@/lib/temis/cancelamento";
import { cardsAbertosDaProposta } from "@/lib/temis/cards-abertos-db";
import {
  conferirDeclaracoes,
  ehTipoQueConclui,
  type TipoQueConclui,
} from "@/lib/temis/conclusao-do-cancelamento";
import { registrarPassagemDeEtapa } from "@/lib/temis/passagem-de-etapa-db";
import { carimbarCancelamento, decisaoDoEstadoReal } from "@/lib/temis/retorno-para-correcao";
import { ATIVIDADES, ESTAGIOS_ENCERRADOS, NOME_DO_TIPO } from "@/lib/temis/trabalhos";

// ⚠️ A LISTA DE "VENDA MORTA" VEM DE UM LUGAR SÓ (`VENDA_DESFEITA`): a cópia local daqui
// (`JA_DESFEITA`) era a segunda de três, e a terceira, na Têmis, nem existia.
import { VENDA_DESFEITA } from "./acao-de-cancelamento";
import { type DesfechoDaUnidade, desfechoDaUnidade, soltarLoteDaVendaDesfeita } from "./cancelar-reserva-server";
import { codigoDaVenda } from "./codigo-da-venda";
import { lerFatosDoContrato } from "./fatos-do-contrato-server";
import { ETAPAS_DO_FLUXO } from "./fluxo-de-venda";
import { lerSituacaoDasUnidades, type SituacaoDasUnidades } from "./situacao-da-unidade";

// CONCLUIR O CANCELAMENTO (OU O DISTRATO) — a ação que faz a coisa.
//
// Lucas (18/09/2026): *"o time administrativo quando finaliza um cancelamento de contrato, a unidade
// nao esta voltando para disponibilidade"*.
//
// ⚠️ O PEDIDO NÃO CANCELA NADA, E NINGUÉM CANCELAVA DEPOIS. A tela Venda abre o pedido na Têmis e
// deixa a venda em contrato de propósito ("a venda continua em contrato até a Têmis concluir"). Só
// que a Têmis não tinha como concluir: o card de cancelamento oferecia "Indeferir" e mais nada, e o
// último item do checklist ("Liberar a unidade para venda") era só texto. Medido em produção: a
// Nívea "finalizou" os cancelamentos do VOL1106 (COD 000019) e do VOC0306 (COD 000021) pelo único
// botão que havia, Indeferir, e os dois lotes ficaram presos, com a venda em contrato, a reserva em
// proposta e o cadastro reservado.
//
// ⚠️ A ORDEM É O DESENHO INTEIRO, e ela é a mesma do cancelamento da proposta na tela Venda
// (`app/api/incorporador/venda/proposta/route.ts`, PATCH):
//
//   0. ler e conferir tudo ANTES de gravar qualquer coisa: o card, a venda, as declarações do
//      distrato, os fatos do contrato (reapurados agora) e, no cancelamento, o envelope vivo na
//      Clicksign (cancelado aqui, lendo o estado real antes). Qualquer recusa daqui não grava nada;
//   1. a VENDA morre primeiro, condicional à etapa lida (`cancelado` ou `distrato`);
//   2. a RESERVA cai depois, só a situação (como no cancelamento da proposta);
//   3. o card de CONTRATO que ainda andava é indeferido, apontando para este card;
//   4. o PRÓPRIO card vai para o fim (Concluído), com todas as atividades marcadas;
//   5. a UNIDADE por último, pela trava (`devolverCadastroDaUnidade`): só volta se o terreno
//      inteiro ficou sem dono, e só a partir de `reservada` ou `vendida`. Nunca `bloqueada`.
//
// São gravações sem transação (o cliente do Supabase não tem uma). Soltar a unidade POR ÚLTIMO é o
// que garante que nenhuma falha no meio deixe um lote livre com dono: o pior estado possível é o
// lote ocupado a mais, que se corrige com um clique. O contrário vira processo.
//
// ⚠️ DINHEIRO DO CLIENTE NÃO SOME POR CLIQUE. Os fatos são REAPURADOS no instante de concluir, pela
// mesma leitura do pedido (`lerFatosDoContrato`). Se um card de CANCELAMENTO descobre que agora
// alguém assinou ou pagou, a conclusão é RECUSADA: a situação mudou e o instrumento é o distrato.

const WORKSPACE = "careli";

export type PedidoDeConclusao = {
  /** As declarações do distrato, como a tela mandou (`DECLARACOES_DO_DISTRATO`). */
  declaracoes?: unknown;
  trabalhoId: string;
  usuarioId: null | string;
  usuarioNome: null | string;
};

// ⚠️ O DESFECHO DA UNIDADE MORA AGORA EM cancelar-reserva-server.ts (24/09/2026), junto com a
// soltura: o Cancelar proposta do Hércules passou a dizer à tela o mesmo que a Têmis diz.
export { type DesfechoDaUnidade, desfechoDaUnidade } from "./cancelar-reserva-server";

export type ConclusaoFeita = {
  /** Tudo o que não impediu a conclusão, mas precisa ser dito (card de contrato, histórico). */
  avisos: string[];
  /** O próprio card foi para Concluído? */
  cardConcluido: boolean;
  codigo: null | string;
  /** Os cards de contrato desta venda que foram indeferidos junto. */
  contratosIndeferidos: string[];
  /** O envelope do contrato cancelado na Clicksign, quando havia um vivo. */
  envelopeCancelado: null | string;
  /** Cópias antigas do C2X (etapa `reservado`, mesmo cliente, mesmo terreno) encerradas junto. */
  copiasEncerradas: number;
  /** A venda já estava cancelada/distratada quando o clique chegou: nada a fazer nela. */
  jaEstavaDesfeita: boolean;
  ok: true;
  /** O recado para a tela, em uma frase. */
  recado: string;
  tipo: TipoQueConclui;
  unidade: DesfechoDaUnidade;
};

export type FalhaNaConclusao = {
  erro: string;
  ok: false;
  status: 400 | 404 | 409 | 422 | 502 | 503;
};

type CardDaConclusao = {
  estagio: string;
  id: string;
  proposta_id: null | string;
  tipo: string;
  /** "Quadra 11 · Lote 06": é o nome que vai nas frases (o COD de venda importada não é único). */
  unidade: null | string;
};

type VendaDaConclusao = {
  cancelada_em: null | string;
  cancelamento_pedido_em: null | string;
  cancelamento_pedido_motivo: null | string;
  cliente_documento: null | string;
  codigo: null | string;
  data_assinatura: null | string;
  data_ato: null | string;
  data_faturamento: null | string;
  etapa: string;
  id: string;
  protocolo_numero: null | number;
  reserva_id: null | string;
  unidade_id: null | string;
};

/**
 * Conclui o card de cancelamento ou de distrato: a venda cai, a reserva cai, o card fecha e o lote
 * volta se a trava deixar.
 *
 * `porta` é a chamada HTTP da Clicksign (o duplo do teste entra por aqui).
 */
export async function concluirCancelamentoDoCard(
  sb: SupabaseClient,
  pedido: PedidoDeConclusao,
  porta?: PortaDaClicksign,
): Promise<ConclusaoFeita | FalhaNaConclusao> {
  // ── 0. LER E CONFERIR, SEM GRAVAR NADA ────────────────────────────────────
  const { data: linhaDoCard, error: erroDoCard } = await sb
    .from("temis_trabalhos")
    .select("id, tipo, estagio, proposta_id, unidade")
    .eq("workspace_id", WORKSPACE)
    .eq("id", pedido.trabalhoId)
    .maybeSingle();

  if (erroDoCard) {
    console.error("[hercules][concluir-cancelamento] falha ao ler o card", erroDoCard);
    return { erro: "Não foi possível abrir o trabalho. Nada foi gravado.", ok: false, status: 503 };
  }
  const card = linhaDoCard as CardDaConclusao | null;
  if (!card) return { erro: "Trabalho não encontrado.", ok: false, status: 404 };

  const tipo = String(card.tipo ?? "").trim();
  if (!ehTipoQueConclui(tipo)) {
    return {
      erro: "Só o card de cancelamento ou de distrato se conclui por aqui.",
      ok: false,
      status: 409,
    };
  }

  const estagio = String(card.estagio ?? "").trim();
  // ⚠️ CONCLUÍDO NÃO É FIM DE CONVERSA: é a RETOMADA (revisão de 18/09/2026). Se a trava segurou o
  // lote no clique, ou se o card chegou a Concluído por outro caminho sem a venda cair, é daqui que
  // se termina. O passo 4 (fechar o card) é pulado; todo o resto é condicional e passa pela trava.
  const retomada = estagio === "faturado";
  if (estagio === "indeferido") {
    return {
      erro: "Este pedido foi indeferido: a venda continua como estava. Para desfazer a venda agora, peça o cancelamento de novo no Hércules, na tela da venda.",
      ok: false,
      status: 409,
    };
  }
  if (!retomada && (ESTAGIOS_ENCERRADOS as readonly string[]).includes(estagio)) {
    return { erro: "Este card não está mais aberto.", ok: false, status: 409 };
  }

  if (!card.proposta_id) {
    return {
      erro: "Este card não tem venda ligada no Panteon: não há venda para cancelar daqui.",
      ok: false,
      status: 409,
    };
  }


  const { data: linhaDaVenda, error: erroDaVenda } = await sb
    .from("hercules_propostas")
    .select(
      "id, codigo, protocolo_numero, etapa, reserva_id, unidade_id, cliente_documento, cancelada_em, cancelamento_pedido_em, cancelamento_pedido_motivo, data_assinatura, data_ato, data_faturamento",
    )
    .eq("workspace_id", WORKSPACE)
    .eq("id", card.proposta_id)
    .maybeSingle();

  if (erroDaVenda) {
    console.error("[hercules][concluir-cancelamento] falha ao ler a venda", erroDaVenda);
    return { erro: "Não foi possível ler a venda deste card. Nada foi gravado.", ok: false, status: 503 };
  }
  const venda = linhaDaVenda as VendaDaConclusao | null;
  if (!venda) return { erro: "A venda deste card não foi encontrada.", ok: false, status: 404 };

  const codigo = texto(venda.codigo) ?? (codigoDaVenda(venda.protocolo_numero) || null);
  const nomeDaUnidade = texto(card.unidade);
  /**
   * "a venda COD 000019 (Quadra 11 · Lote 06)". ⚠️ O NOME DA UNIDADE VAI JUNTO porque o COD da venda
   * importada do C2X não é único ("ACP1" aparece em ~18 propostas de unidades diferentes).
   */
  const aVenda = `${codigo ? `a venda COD ${codigo}` : "a venda"}${nomeDaUnidade ? ` (${nomeDaUnidade})` : ""}`;
  const etapaLida = String(venda.etapa ?? "").trim();
  const jaEstavaDesfeita = VENDA_DESFEITA.has(etapaLida);

  // ⚠️ AS DECLARAÇÕES VÊM ANTES DE QUALQUER CHAMADA À CLICKSIGN: sem elas o distrato não derruba a
  // venda. Na retomada de venda JÁ desfeita elas foram dadas na conclusão, e não se pedem de novo.
  const declaracoes = jaEstavaDesfeita
    ? { declaradas: [] as string[], ok: true as const }
    : conferirDeclaracoes(tipo, pedido.declaracoes);
  if (!declaracoes.ok) return { erro: declaracoes.erro, ok: false, status: 422 };

  if (!jaEstavaDesfeita && !(ETAPAS_DO_FLUXO as readonly string[]).includes(etapaLida)) {
    return {
      erro: `A venda deste card está numa etapa que o Panteon não conhece ("${etapaLida}"). Nada foi gravado.`,
      ok: false,
      status: 409,
    };
  }

  let envelopeCancelado: null | string = null;
  /** O contrato desta venda está assinado por todos? (é o que impede indeferir o card de contrato) */
  let contratoAssinado = false;

  if (!jaEstavaDesfeita) {
    // ⚠️ OS FATOS SÃO DE AGORA, NÃO DO DIA DO PEDIDO. Entre o pedido e a conclusão o cliente pode ter
    // assinado ou pago; a classificação que vale é a do instante em que a venda cai.
    let fatos: Awaited<ReturnType<typeof lerFatosDoContrato>>;
    try {
      fatos = await lerFatosDoContrato(sb, venda);
    } catch (erro) {
      console.error("[hercules][concluir-cancelamento] falha ao apurar os fatos", erro);
      return {
        erro: "Não foi possível conferir agora se o contrato foi assinado ou pago. Nada foi gravado.",
        ok: false,
        status: 503,
      };
    }

    const classificacao = classificarCancelamento(fatos);
    // ⚠️ SÓ NESTE SENTIDO. Um card de distrato cujos fatos hoje dariam cancelamento simples segue:
    // o distrato é o instrumento mais completo (termo assinado, valores acertados), e o pedido pode
    // ter nascido com ajuste manual declarando um pagamento feito por fora. O contrário não segue:
    // cancelamento simples sobre contrato assinado ou pago é sair sem devolver dinheiro do cliente.
    if (tipo === "cancelamento" && classificacao.tipo === "distrato") {
      return {
        erro: `A situação mudou: agora exige distrato (${classificacao.porque}; ${fatos.comoSoube.assinatura}, ${fatos.comoSoube.pagamento}). Nada foi gravado. Indefira este card e peça o cancelamento de novo no Hércules, na tela da venda: o pedido novo sai classificado pelos fatos de hoje.`,
        ok: false,
        status: 409,
      };
    }

    // ⚠️ O ENVELOPE QUE AINDA SE PODE ASSINAR MORRE NOS DOIS TIPOS (revisão de 18/09/2026). O
    // distrato pode nascer do PAGAMENTO com o contrato sem todas as assinaturas: deixar o envelope
    // vivo seria deixar alguém assinar o contrato de um lote que já voltou para a venda, e o webhook
    // ignora card indeferido. Só o contrato assinado por todos fica como está (é o documento que o
    // distrato desfaz); no cancelamento, assinado por todos é recusa (virou distrato).
    const envelope = await cancelarEnvelopeVivoDoContrato(sb, venda.id, tipo, porta);
    if (!envelope.ok) return envelope;
    envelopeCancelado = envelope.envelopeCancelado;
    contratoAssinado = envelope.contratoAssinado;
  }

  const agora = new Date().toISOString();
  const nomeDoTipo = NOME_DO_TIPO[tipo];
  const quem = texto(pedido.usuarioNome);
  const avisos: string[] = [];
  const envelopeJaMorreu = envelopeCancelado
    ? ` O envelope ${envelopeCancelado} já foi cancelado na Clicksign.`
    : "";

  // ⚠️ O CARD É RELIDO LOGO ANTES DE GRAVAR (revisão de 18/09/2026). Entre a primeira leitura e aqui
  // passaram a reapuração e a Clicksign (segundos): se alguém indeferiu o pedido nesse meio, a venda
  // NÃO pode cair por baixo de um pedido recusado. A condição no passo 1 fecha o resto da janela.
  const { data: releitura, error: erroDaReleitura } = await sb
    .from("temis_trabalhos")
    .select("estagio")
    .eq("workspace_id", WORKSPACE)
    .eq("id", card.id)
    .maybeSingle();
  if (erroDaReleitura || !releitura) {
    return {
      erro: `Não foi possível conferir o card antes de gravar. Nada foi gravado na venda.${envelopeJaMorreu}`,
      ok: false,
      status: 503,
    };
  }
  if (String((releitura as { estagio: null | string }).estagio ?? "").trim() !== estagio) {
    return {
      erro: `Este card mudou enquanto a tela estava aberta (outra pessoa indeferiu ou concluiu). Nada foi gravado na venda.${envelopeJaMorreu} Abra o card de novo.`,
      ok: false,
      status: 409,
    };
  }

  // ── 1. A VENDA MORRE PRIMEIRO ─────────────────────────────────────────────
  if (!jaEstavaDesfeita) {
    const motivoGravado = [
      texto(venda.cancelamento_pedido_motivo) ?? "Pedido sem motivo registrado",
      `${nomeDoTipo} concluído na Têmis${quem ? ` por ${quem}` : ""}`,
      declaracoes.declaradas.length > 0 ? `Declarado: ${declaracoes.declaradas.join("; ")}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const desfazer = sb
      .from("hercules_propostas")
      .update({
        aberta: false,
        atualizado_em: agora,
        cancelada_em: agora,
        cancelada_motivo: motivoGravado,
        cancelada_por: pedido.usuarioId,
        cancelada_por_nome: pedido.usuarioNome,
        etapa: tipo === "distrato" ? "distrato" : "cancelado",
        // ⚠️ O MAPA PINTA PELA PROPOSTA DE `etapa_desde` MAIS RECENTE, e o histórico conta o passo
        // por ele. Mesma razão do cancelamento da proposta.
        etapa_desde: agora,
        etapa_por: pedido.usuarioNome,
      })
      .eq("id", venda.id)
      // ⚠️ COMPARAÇÃO E TROCA com a etapa LIDA: se a venda andou (ou outra pessoa concluiu) entre a
      // leitura e aqui, os fatos reapurados já não são os dela, e nada mais se grava.
      .eq("etapa", etapaLida);
    // ⚠️ E COM O PEDIDO AINDA DE PÉ, quando havia um: o indeferimento limpa a marca, e a venda de um
    // pedido recusado não cai por uma conclusão que começou antes da recusa.
    const { data: desfeitas, error: erroDaVenda1 } = await (venda.cancelamento_pedido_em
      ? desfazer.not("cancelamento_pedido_em", "is", null)
      : desfazer
    ).select("id");

    if (erroDaVenda1) {
      console.error("[hercules][concluir-cancelamento] falha ao cancelar a venda", erroDaVenda1);
      return {
        erro: `Não foi possível cancelar a venda agora.${envelopeJaMorreu} Tente de novo em instantes.`,
        ok: false,
        status: 503,
      };
    }
    if (!desfeitas || desfeitas.length === 0) {
      return {
        erro: `A venda mudou enquanto a tela estava aberta (outra pessoa concluiu, ou ela andou de etapa). Nada mais foi gravado.${envelopeJaMorreu} Abra o card de novo.`,
        ok: false,
        status: 409,
      };
    }
  }

  // ── 2. A RESERVA CAI DEPOIS ───────────────────────────────────────────────
  //
  // ⚠️ SÓ A SITUAÇÃO, SEM OS CAMPOS `cancelada_*`, como no cancelamento da proposta: a reserva não
  // foi cancelada por ninguém, ela foi CONSUMIDA pela venda e cai junto com ela. E o erro PARA AQUI,
  // com a unidade ainda presa: a reserva viva é dona do lote para o índice da 0125, e soltar o
  // cadastro por cima dela deixaria a tela oferecendo um lote que recusa a próxima reserva.
  if (venda.reserva_id) {
    const { error: erroDaReserva } = await sb
      .from("hercules_reservas")
      .update({ atualizado_em: agora, situacao: "cancelada" })
      .eq("id", venda.reserva_id)
      .in("situacao", ["ativa", "proposta"])
      .select("id");

    if (erroDaReserva) {
      console.error("[hercules][concluir-cancelamento] falha ao derrubar a reserva", erroDaReserva);
      return {
        erro: `${primeiraMaiuscula(aVenda)} foi desfeita, mas a reserva não caiu, e a unidade continua presa. Clique em concluir de novo em instantes: o que já foi feito não se repete.`,
        ok: false,
        status: 503,
      };
    }
  }

  // ── 2½. A CÓPIA DO C2X DO MESMO CLIENTE, E O TERRENO PARA A TRAVA ─────────
  //
  // ⚠️ MEDIDO EM 18/09/2026: em 4 dos 5 distratos parados (VOL0710, VOC0911, VOC1102, VOR1401) a linha
  // antiga do Vale do Ouro (VLO) tem uma proposta `reservado` do MESMO cliente, cópia que a carga do
  // C2X trouxe da venda de antes da divisão. A trava a conta como dona (com razão: é uma proposta
  // viva), e o lote não voltaria nunca. Ela é encerrada junto, e SÓ ela: origem C2X, etapa
  // `reservado`, no MESMO terreno, com o MESMO documento do cliente desta venda. Outro cliente,
  // outra etapa ou venda nascida no Panteon nunca é tocada aqui.
  const terreno = await terrenoDaUnidade(sb, venda.unidade_id);
  let copiasEncerradas = 0;
  if (terreno.ok && terreno.situacoes && venda.unidade_id) {
    const copias = await encerrarCopiasDoC2x(sb, {
      agora,
      // ⚠️ SÓ O QUE JÁ EXISTIA QUANDO O CANCELAMENTO FOI PEDIDO (revisão de 18/09/2026). Medido: as
      // cópias reais nasceram entre agosto e setembro, perto da venda (VOL2: três dias depois), então
      // a data da venda não separa nada. O que separa é o pedido: a reserva do mesmo cliente criada
      // DEPOIS dele é a renegociação (2 dos 5 distratos são "mudança de fluxo de pagamento") e é
      // dona do lote. Sem marca de pedido, vale a queda da venda (retomada) ou agora.
      corte: venda.cancelamento_pedido_em ?? (jaEstavaDesfeita ? venda.cancelada_em : agora),
      documento: venda.cliente_documento,
      linhas: terreno.situacoes.terreno(venda.unidade_id)?.linhas ?? [],
      motivo: `Cópia do C2X encerrada junto com o ${nomeDoTipo.toLowerCase()} da venda${codigo ? ` COD ${codigo}` : ""}${quem ? `, concluído por ${quem}` : ""}`,
      propostaId: venda.id,
      usuarioId: pedido.usuarioId,
      usuarioNome: pedido.usuarioNome,
    });
    copiasEncerradas = copias.encerradas;
    if (copias.aviso) avisos.push(copias.aviso);
  }

  // ── 3. O CARD DE CONTRATO QUE AINDA ANDAVA ───────────────────────────────
  //
  // ⚠️ SEM ISTO O JURÍDICO CONTINUARIA TRABALHANDO UM CONTRATO DE VENDA DESFEITA: gerando, mandando
  // assinar. O card é indeferido (a saída lateral), com o motivo apontando para este card, e a
  // passagem vai para o histórico dele. Falha aqui não desfaz nada: a venda já caiu, e o aviso diz
  // qual card sobrou aberto.
  const contratosIndeferidos: string[] = [];
  const doContrato = nomeDaUnidade ? ` de ${nomeDaUnidade}` : "";
  const abertos = await cardsAbertosDaProposta(sb, { propostaId: venda.id, tipos: ["contrato"] });
  if (!abertos.ok) {
    avisos.push(`Não deu para conferir se o card de contrato${doContrato} ainda estava aberto: confira no quadro.`);
  } else {
    for (const contrato of abertos.cards) {
      // ⚠️ CONTRATO ASSINADO NÃO VIRA "INDEFERIDO" (revisão de 18/09/2026). Indeferido é o trabalho
      // RECUSADO; um contrato assinado por todos é o documento que o distrato desfaz, e marcá-lo como
      // recusado reescreveria o que aconteceu. Ele fica onde está, e o recado diz.
      const podeIndeferir =
        contrato.estagio === "analise" ||
        contrato.estagio === "contrato" ||
        (contrato.estagio === "assinatura" && !contratoAssinado);
      if (!podeIndeferir) {
        avisos.push(
          `O card de contrato${doContrato} fica em ${contrato.estagio === "prazo_legal" ? "Pré-faturamento" : "Em assinatura"}: o contrato foi assinado, e o ${nomeDoTipo.toLowerCase()} é o documento que o desfaz.`,
        );
        continue;
      }
      const observacao = `Venda ${tipo === "distrato" ? "distratada" : "cancelada"} pelo pedido de ${nomeDoTipo.toLowerCase()}${codigo ? ` (COD ${codigo})` : ""}`;
      const { data: indeferidos, error: erroDoContrato } = await sb
        .from("temis_trabalhos")
        .update({
          atualizado_em: agora,
          estagio: "indeferido",
          estagio_desde: agora,
          indeferido_em: agora,
          indeferido_motivo: "outro",
          indeferido_observacao: observacao,
          indeferido_por: pedido.usuarioId,
          indeferido_por_nome: pedido.usuarioNome,
        })
        .eq("id", contrato.id)
        .eq("estagio", contrato.estagio)
        .select("id");

      if (erroDoContrato || !indeferidos || indeferidos.length === 0) {
        if (erroDoContrato) {
          console.error("[hercules][concluir-cancelamento] falha ao indeferir o contrato", erroDoContrato);
        }
        avisos.push(`O card de contrato${doContrato} continua aberto: indefira por lá.`);
        continue;
      }

      contratosIndeferidos.push(contrato.id);
      await registrarPassagemDeEtapa(sb, {
        de: contrato.estagio,
        motivo: "outro",
        observacao,
        origem: "indeferimento",
        para: "indeferido",
        propostaId: venda.id,
        quem: pedido.usuarioId,
        quemNome: pedido.usuarioNome,
        trabalhoId: contrato.id,
        trabalhoTipo: "contrato",
      });
    }
  }

  // ── 4. O PRÓPRIO CARD VAI PARA O FIM ──────────────────────────────────────
  //
  // ⚠️ TODAS AS ATIVIDADES MARCADAS: o card concluído com o checklist pela metade diria no quadro
  // que ficou trabalho por fazer, e a última delas ("Liberar a unidade para venda") é exatamente o
  // que esta função faz no passo 5.
  let cardConcluido = retomada;
  if (!retomada) {
    const { data: fechados, error: erroDoFechamento } = await sb
      .from("temis_trabalhos")
      .update({
        atividades_feitas: ATIVIDADES[tipo].map((a) => a.texto),
        atualizado_em: agora,
        estagio: "faturado",
        estagio_desde: agora,
      })
      .eq("id", card.id)
      .eq("estagio", estagio)
      .select("id");

    cardConcluido = !erroDoFechamento && (fechados?.length ?? 0) > 0;
    if (!cardConcluido && erroDoFechamento) {
      console.error("[hercules][concluir-cancelamento] falha ao fechar o card", erroDoFechamento);
    }
  }
  if (!cardConcluido) {
    avisos.push("A venda caiu, mas este card não foi para Concluído (ele mudou de etapa ou a gravação falhou). Abra de novo e confira.");
  }

  // ── 5. A UNIDADE POR ÚLTIMO, PELA TRAVA ──────────────────────────────────
  //
  // ⚠️ SEM `reservaId` COMO "MINHA". A reserva desta venda já caiu no passo 2; se por algum motivo
  // ela ainda estiver viva, a trava PRECISA contá-la como dona, e é o que acontece sem o parâmetro.
  // `vendida` entra nos aceitos porque a venda importada do C2X chega com o cadastro `vendida` pela
  // carga; `bloqueada` nunca sai daqui (a própria função o recusa).
  //
  // ⚠️ NA RETOMADA, `vendida` SÓ SE NINGUÉM MEXEU NO CADASTRO DEPOIS QUE A VENDA CAIU (revisão de
  // 18/09/2026). Quando ESTE clique derrubou a venda, o `vendida` é dela. Numa retomada tardia, o
  // cadastro pode ter virado `vendida` por outra venda (a carga do C2X traz lote vendido sem proposta:
  // 114 hoje), e a trava não enxerga venda sem proposta. O carimbo de tempo é a prova barata: cadastro
  // atualizado depois da queda da venda não é mais dela.
  //
  // ⚠️ E NÃO HÁ DATA QUE PROVE QUE O `vendida` AINDA É DELA (revisão de 18/09/2026): a carga do C2X
  // grava a situação sem mexer em `atualizado_em`, então o carimbo de tempo não separa o `vendida`
  // desta venda do de uma revenda feita no legado. Na retomada, só `reservada` volta; o `vendida`
  // que sobrar é conferido e liberado por gente (o recado diz o porquê).
  //
  // ⚠️ E A SOLTURA PASSA POR `soltarLoteDaVendaDesfeita` (24/09/2026), a mesma do Cancelar proposta
  // do Hércules. Lucas, 24/09/2026: *"lembrando que quando tem cancelamento a unidade tem que ficar
  // disponivel, tem que ter esse reflexo"*. Ela acrescenta à trava de sempre a reserva esquecida em
  // `proposta` desta venda no terreno e a PROVA PELA RÉGUA: com a irmã de outra gleba com dono no
  // cadastro, o recado diz qual irmã em vez de "voltou". A reserva ligada já caiu no passo 2, com o
  // erro lido e antes dos cards; aqui ela não é gravada de novo (`reservaLigadaJaCaiu`).
  const aceitos: string[] = jaEstavaDesfeita ? ["reservada"] : ["reservada", "vendida"];
  let unidade: DesfechoDaUnidade;
  if (!venda.unidade_id) {
    unidade = { frase: "a venda não tem unidade ligada no Panteon", voltou: false };
  } else if (!terreno.ok) {
    unidade = desfechoDaUnidade({ devolvida: false, porque: "leitura_falhou" });
  } else {
    const soltura = await soltarLoteDaVendaDesfeita(sb, {
      aceitos,
      agora,
      jaLida: terreno.situacoes ?? undefined,
      reservaLigadaJaCaiu: true,
      venda: { id: venda.id, reserva_id: venda.reserva_id, unidade_id: venda.unidade_id },
    });
    unidade = desfechoDaUnidade(
      soltura.ok ? soltura.desfecho : { devolvida: false, porque: "leitura_falhou" },
    );
  }

  // ⚠️ A PASSAGEM DO CARD É GRAVADA DEPOIS DA UNIDADE, e é a única coisa fora da ordem acima — de
  // propósito: ela é HISTÓRICO, não estado, e só depois do passo 5 dá para escrever nela se o lote
  // voltou. O recado da tela some em segundos; o histórico do card é onde o jurídico vai procurar
  // por que um lote não voltou para a venda.
  if (cardConcluido) {
    await registrarPassagemDeEtapa(sb, {
      // Na retomada o card não anda (Concluído → Concluído), e passagem sem movimento é descartada:
      // sem etapa de origem, a tentativa entra no histórico do card com o desfecho dela.
      de: retomada ? null : estagio,
      observacao: [
        retomada ? "Nova tentativa de liberar a unidade" : null,
        codigo ? `Venda COD ${codigo} ${tipo === "distrato" ? "distratada" : "cancelada"}` : null,
        jaEstavaDesfeita && !retomada ? "a venda já estava desfeita quando o card foi concluído" : null,
        declaracoes.declaradas.length > 0 ? `Declarado: ${declaracoes.declaradas.join("; ")}` : null,
        envelopeCancelado ? `envelope ${envelopeCancelado} cancelado na Clicksign` : null,
        copiasEncerradas > 0
          ? `${copiasEncerradas} cópia(s) antiga(s) do C2X do mesmo cliente encerrada(s)`
          : null,
        primeiraMaiuscula(unidade.frase),
        // ⚠️ OS AVISOS TAMBÉM FICAM NO HISTÓRICO: o recado da tela some; o card é onde se procura
        // depois por que o lote não voltou ou qual card ficou aberto.
        ...avisos,
      ]
        .filter(Boolean)
        .join(" · "),
      origem: "conclusao",
      para: "faturado",
      propostaId: venda.id,
      quem: pedido.usuarioId,
      quemNome: pedido.usuarioNome,
      trabalhoId: card.id,
      trabalhoTipo: tipo,
    });
  }

  const vendaCaiu = jaEstavaDesfeita
    ? `${primeiraMaiuscula(aVenda)} já estava ${etapaLida === "distrato" ? "distratada" : "cancelada"}`
    : `${nomeDoTipo} concluído: ${aVenda} foi ${tipo === "distrato" ? "distratada" : "cancelada"}${venda.reserva_id ? ", a reserva caiu" : ""}`;
  const dasCopias =
    copiasEncerradas > 0
      ? `, ${copiasEncerradas === 1 ? "a cópia antiga do C2X do mesmo cliente foi encerrada" : `${copiasEncerradas} cópias antigas do C2X do mesmo cliente foram encerradas`}`
      : "";

  return {
    avisos,
    cardConcluido,
    codigo,
    contratosIndeferidos,
    copiasEncerradas,
    envelopeCancelado,
    jaEstavaDesfeita,
    ok: true,
    recado: [`${vendaCaiu}${dasCopias} e ${unidade.frase}.`, ...avisos].join(" "),
    tipo,
    unidade,
  };
}

/**
 * O envelope do CONTRATO desta venda, se ainda vivo na Clicksign, morre antes de a venda cair.
 *
 * ⚠️ A MESMA MAQUINARIA DA VOLTA PARA A ANÁLISE (`lib/temis/retorno-para-correcao.ts`): a régua do
 * banco (`envelopeQueSegura`), a leitura do estado REAL na Clicksign imediatamente antes
 * (`consultarEnvelope`), a mesma tabela de decisão (`decisaoDoEstadoReal`) e o mesmo carimbo. As
 * frases é que são outras: aqui não há card voltando para a análise, há uma venda que ia cair.
 *
 * ⚠️ FALHA FECHADA EM TODA DÚVIDA. Assinado por todos na Clicksign (o webhook ainda não chegou) é
 * distrato, e a venda não cai como cancelamento; estado que não se afirma, leitura que falha,
 * envelope de outro provedor, envio sem id e cancelamento recusado ou duvidoso RECUSAM a conclusão
 * sem gravar nada no Panteon.
 *
 * ⚠️ O ENVELOPE É LIDO POR PROPOSTA, E AQUI ISSO É CERTO: só o card de contrato produz envelope
 * (`conferirEMatarOEnvelope`), então o envelope desta proposta É o do contrato da venda.
 */
async function cancelarEnvelopeVivoDoContrato(
  sb: SupabaseClient,
  propostaId: string,
  tipo: TipoQueConclui,
  porta?: PortaDaClicksign,
): Promise<{ contratoAssinado: boolean; envelopeCancelado: null | string; ok: true } | FalhaNaConclusao> {
  const { data, error } = await sb
    .from("temis_envelopes")
    // ⚠️ `COLUNAS_PARA_CANCELAR` traz `provedor_documento_id` junto: cancelar na v3 é um PATCH no
    // DOCUMENTO (doc lida 25/09/2026, ver `cancelarEnvelope`), e o id dele vem desta linha.
    .select(COLUNAS_PARA_CANCELAR)
    .eq("proposta_id", propostaId)
    .order("criado_em", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[hercules][concluir-cancelamento] falha ao ler os envelopes", error);
    return {
      erro: "Não foi possível conferir o envelope do contrato desta venda. Nada foi gravado; tente de novo em instantes.",
      ok: false,
      status: 503,
    };
  }

  const vivo = envelopeQueSegura((data ?? []) as unknown as EnvelopeParaCancelar[]);
  if (!vivo) return { contratoAssinado: false, envelopeCancelado: null, ok: true };

  // No distrato, o contrato assinado por todos é o documento que ele desfaz: fica como está.
  if (vivo.estado === "assinado" && tipo === "distrato") {
    return { contratoAssinado: true, envelopeCancelado: null, ok: true };
  }
  if (vivo.estado === "assinado") {
    return {
      erro: "A situação mudou: o contrato desta venda consta assinado por todos, e agora exige distrato. Nada foi gravado. Indefira este card e peça o cancelamento de novo no Hércules, na tela da venda.",
      ok: false,
      status: 409,
    };
  }

  if (vivo.provedor !== "clicksign") {
    return {
      erro: `O envelope vivo do contrato desta venda não é da Clicksign (registro ${vivo.id}), e daqui só se cancela envelope da Clicksign. Nada foi gravado. Cancele o envelope no provedor dele antes de concluir.`,
      ok: false,
      status: 409,
    };
  }

  if (!vivo.envelope_id) {
    return {
      erro: `Existe um envio do contrato desta venda que o Panteon não sabe como terminou (registro ${vivo.id}). Nada foi gravado. Confira na Clicksign se o envelope existe e, se existir, cancele por lá antes de concluir.`,
      ok: false,
      status: 409,
    };
  }

  const leitura = await consultarEnvelope(vivo.envelope_id, porta);
  if (!leitura.ok) {
    return {
      erro: `Não deu para confirmar na Clicksign o estado do envelope ${leitura.envelopeId}. Nada foi gravado nem cancelado. (${leitura.erro}${leitura.requestId ? ` · request ${leitura.requestId}` : ""})`,
      ok: false,
      status: 502,
    };
  }

  switch (decisaoDoEstadoReal(leitura.estado)) {
    case "ja_morreu":
      // Já morreu lá fora: não se cancela duas vezes. A linha do banco espera o webhook, como na volta.
      return { contratoAssinado: false, envelopeCancelado: null, ok: true };
    case "distrato":
      if (tipo === "distrato") return { contratoAssinado: true, envelopeCancelado: null, ok: true };
      return {
        erro: `A situação mudou: a Clicksign diz que o envelope ${leitura.envelopeId} está assinado por todos, e agora exige distrato. Nada foi gravado. Indefira este card e peça o cancelamento de novo no Hércules, na tela da venda.`,
        ok: false,
        status: 409,
      };
    case "conferir":
      return {
        erro: `A Clicksign respondeu "${leitura.status}" para o envelope ${leitura.envelopeId}, e daqui não dá para afirmar se o contrato foi assinado por todos. Nada foi gravado nem cancelado. Confira o envelope na Clicksign antes de concluir.`,
        ok: false,
        status: 409,
      };
    default:
      break;
  }

  // ⚠️ SEM O ID DO DOCUMENTO NÃO DÁ PARA CANCELAR, e a venda NÃO cai. É a mesma recusa da volta para a
  // análise (`conferirEMatarOEnvelope`, em `lib/temis/retorno-para-correcao.ts`), pelo mesmo motivo:
  // cancelar na Clicksign v3 é `PATCH /envelopes/{envelope_id}/documents/{document_id}` (doc lida
  // 25/09/2026, ver `cancelarEnvelope`). Concluir aqui derrubaria a venda com o contrato ainda na rua.
  //
  // ⚠️ E ELA VEM DEPOIS DA LEITURA, NÃO ANTES — foi assim que nasceu em 25/09/2026 e é o que estava
  // errado. Chegar até aqui significa que `decisaoDoEstadoReal` acabou de dizer "cancelar" sobre o
  // estado LIDO na Clicksign: o envelope está correndo AGORA, medido. Recusar antes da leitura mandava
  // o operador cancelar à mão um envelope cujo estado ninguém havia lido — inclusive um assinado por
  // todos cujo webhook ainda estava a caminho — e prendia a venda também quando o envelope já estava
  // morto lá fora (o `ja_morreu` acima, que solta a conclusão sem PATCH nenhum).
  if (!vivo.provedor_documento_id) {
    return {
      erro: `O Panteon não guardou qual documento do envelope ${vivo.envelope_id} cancelar na Clicksign (registro ${vivo.id}), e o cancelamento é feito no documento, não no envelope. Nada foi gravado. Cancele o envelope ${vivo.envelope_id} na Clicksign antes de concluir.`,
      ok: false,
      status: 409,
    };
  }

  const cancelamento = await cancelarEnvelope(vivo.envelope_id, vivo.provedor_documento_id, porta);
  // ⚠️ AS DUAS FRASES PARARAM DE AFIRMAR O QUE O CÓDIGO NÃO SABE, e é a mesma correção da volta para a
  // análise. A duvidosa cobre dois fatos desde 25/09/2026 (o timeout e a releitura que não confirmou a
  // morte do envelope), então ela não diz mais "não respondeu". A da recusa não diz mais "ele continua
  // valendo": o documento só aceita `canceled` enquanto está `running` ("Editar Documento", doc lida
  // 25/09/2026), então um 4xx é tanto "recusou" quanto "já está cancelado".
  if (!cancelamento.ok) {
    return {
      erro: cancelamento.duvidoso
        ? `O Panteon não conseguiu confirmar na Clicksign que o envelope ${cancelamento.envelopeId} morreu. A venda NÃO foi cancelada. Confira o envelope na Clicksign antes de concluir. (${cancelamento.erro})`
        : `A Clicksign recusou o cancelamento do contrato do envelope ${cancelamento.envelopeId} — pode ser que ele já esteja cancelado ou fechado. A venda NÃO foi cancelada. Confira o envelope na Clicksign e, se ainda estiver correndo, cancele por lá antes de concluir. (${cancelamento.erro})`,
      ok: false,
      status: 502,
    };
  }

  await carimbarCancelamento(sb, vivo.id, cancelamento.envelopeId, "panteon:conclusao_do_cancelamento");
  return { contratoAssinado: false, envelopeCancelado: cancelamento.envelopeId, ok: true };
}

/**
 * O terreno da unidade (a régua única), lido UMA vez: serve à cópia do C2X e à trava.
 *
 * ⚠️ FALHA = NÃO SE SABE, e quem chama não devolve o lote nem encerra cópia.
 */
async function terrenoDaUnidade(
  sb: SupabaseClient,
  unidadeId: null | string,
): Promise<
  | { ok: false }
  | {
      ok: true;
      situacoes: null | SituacaoDasUnidades;
      unidade: null | { atualizado_em: null | string; enterprise_id: string };
    }
> {
  if (!unidadeId) return { ok: true, situacoes: null, unidade: null };
  try {
    const { data, error } = await sb
      .from("hercules_unidades")
      .select("id, enterprise_id, atualizado_em")
      .eq("id", unidadeId)
      .maybeSingle();
    if (error || !data) return { ok: false };
    const unidade = data as { atualizado_em: null | string; enterprise_id: number | string };
    const enterpriseId = String(unidade.enterprise_id ?? "").trim();
    if (!enterpriseId) return { ok: false };
    const situacoes = await lerSituacaoDasUnidades(sb, [enterpriseId]);
    return {
      ok: true,
      situacoes,
      unidade: { atualizado_em: unidade.atualizado_em ?? null, enterprise_id: enterpriseId },
    };
  } catch (erro) {
    console.error("[hercules][concluir-cancelamento] falha ao ler o terreno", { erro, unidadeId });
    return { ok: false };
  }
}

/**
 * Encerra as cópias antigas do C2X desta venda no mesmo terreno.
 *
 * ⚠️ TRÊS CONDIÇÕES, TODAS NA LEITURA E A ETAPA DE NOVO NA ESCRITA: origem `c2x`, etapa `reservado`,
 * mesmo documento do cliente (só dígitos, e documento vazio não casa com nada). Leitura que falha
 * não encerra nada e vira aviso: o lote fica ocupado, que é o erro barato.
 */
async function encerrarCopiasDoC2x(
  sb: SupabaseClient,
  args: {
    agora: string;
    /** Só cópia criada até aqui (ver o passo 2½). Sem data, nenhuma cópia é encerrada. */
    corte: null | string;
    documento: null | string;
    linhas: string[];
    motivo: string;
    propostaId: string;
    usuarioId: null | string;
    usuarioNome: null | string;
  },
): Promise<{ aviso: null | string; encerradas: number }> {
  const documento = String(args.documento ?? "").replace(/\D/g, "");
  const corte = Date.parse(String(args.corte ?? ""));
  if (!documento || args.linhas.length === 0 || !Number.isFinite(corte)) {
    return { aviso: null, encerradas: 0 };
  }

  const { data, error } = await sb
    .from("hercules_propostas")
    .select("id, cliente_documento, criado_em_c2x")
    .eq("workspace_id", WORKSPACE)
    .in("unidade_id", args.linhas)
    .eq("origem", "c2x")
    .eq("etapa", "reservado");
  if (error) {
    console.error("[hercules][concluir-cancelamento] falha ao procurar a cópia do C2X", error);
    return {
      aviso: "Não deu para conferir se há cópia antiga do C2X deste cliente no mesmo lote.",
      encerradas: 0,
    };
  }

  const copias = (
    (data ?? []) as Array<{ cliente_documento: null | string; criado_em_c2x: null | string; id: string }>
  ).filter((c) => {
    const criada = Date.parse(String(c.criado_em_c2x ?? ""));
    return (
      c.id !== args.propostaId &&
      String(c.cliente_documento ?? "").replace(/\D/g, "") === documento &&
      Number.isFinite(criada) &&
      criada <= corte
    );
  });
  let encerradas = 0;
  for (const copia of copias) {
    const { data: mexidas, error: erroDaCopia } = await sb
      .from("hercules_propostas")
      .update({
        aberta: false,
        atualizado_em: args.agora,
        cancelada_em: args.agora,
        cancelada_motivo: args.motivo,
        cancelada_por: args.usuarioId,
        cancelada_por_nome: args.usuarioNome,
        etapa: "cancelado",
        etapa_desde: args.agora,
        etapa_por: args.usuarioNome,
      })
      .eq("id", copia.id)
      .eq("etapa", "reservado")
      .select("id");
    if (erroDaCopia) {
      console.error("[hercules][concluir-cancelamento] a cópia do C2X não foi encerrada", {
        copia: copia.id,
        erro: erroDaCopia.message,
      });
      continue;
    }
    encerradas += (mexidas ?? []).length;
  }
  return { aviso: null, encerradas };
}

function texto(valor: null | string | undefined): null | string {
  const t = String(valor ?? "").trim();
  return t || null;
}

function primeiraMaiuscula(frase: string): string {
  return frase ? frase.charAt(0).toUpperCase() + frase.slice(1) : frase;
}
