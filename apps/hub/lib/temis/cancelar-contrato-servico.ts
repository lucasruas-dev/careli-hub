import type { SupabaseClient } from "@supabase/supabase-js";

import type { PortaDaClicksign } from "@/lib/assinatura/clicksign/cliente";
import { DEPOIS_DO_CONTRATO, VENDA_DESFEITA } from "@/lib/hercules/acao-de-cancelamento";
import { codigoDaVenda } from "@/lib/hercules/codigo-da-venda";
import {
  type ConclusaoFeita,
  concluirCancelamentoDoCard,
} from "@/lib/hercules/concluir-cancelamento-server";
import type { FatosApurados } from "@/lib/hercules/fatos-do-contrato";
import { lerFatosDoContrato } from "@/lib/hercules/fatos-do-contrato-server";
import {
  MOVIMENTO_PEDIDO_DE_CANCELAMENTO,
  MOVIMENTO_PEDIDO_DE_DISTRATO,
} from "@/lib/hercules/indeferimento-na-venda-server";
import { marcaEhResto } from "@/lib/hercules/marca-de-pedido";

import { type ClassificacaoDoCancelamento, classificarCancelamento } from "./cancelamento";
import { conferirMotivoDoCancelamento, podeCancelarOContrato } from "./cancelamento-do-contrato";
import { cardsAbertosDaProposta } from "./cards-abertos-db";
import { conferirDeclaracoes } from "./conclusao-do-cancelamento";
import { NOME_DO_TIPO } from "./trabalhos";
import { abrirTrabalho, ehColunaDoDonoAusente } from "./trabalhos-db";

// CANCELAR O CONTRATO DE DENTRO DA TÊMIS — a porta que faltava, com o motor que já existia.
//
// Lucas (23/09/2026): *"coloca por favor um botão de cancelamento de contrato na temis. o time vai
// precisar cancelar"*.
//
// ⚠️ NADA DE MOTOR NOVO AQUI, E ISSO É O DESENHO. O que desfaz uma venda (cancelar o envelope na
// Clicksign lendo o estado real antes, derrubar a venda, a reserva, o card de contrato irmão, fechar
// o card e soltar o lote pela trava, na ordem em que uma falha no meio deixa o estado recuperável)
// mora em `lib/hercules/concluir-cancelamento-server.ts`, roda em produção desde 18/09/2026 e tem
// 40 testes. Este arquivo abre o PEDIDO que aquele motor conclui, e chama o motor. Um segundo
// caminho que derrubasse a venda por conta própria divergiria do primeiro no primeiro conserto — e a
// divergência aqui é dinheiro do cliente e lote vendido duas vezes.
//
// ⚠️ A ORDEM DAS ESCRITAS, E O PORQUÊ (não há transação: o cliente do Supabase não tem uma):
//
//   0. ler e conferir TUDO sem gravar nada: o card, a venda, o motivo escrito, os fatos do contrato
//      (assinou? pagou?), a classificação, as declarações quando é distrato e se já existe pedido na
//      fila. Qualquer recusa daqui não deixa rastro nenhum;
//   1. a MARCA do pedido na venda (`cancelamento_pedido_*`), que é REFAZÍVEL: ela não muda a etapa
//      da venda, o indeferimento sabe limpá-la e a rota do pedido do Hércules sabe tratá-la como
//      resto. É ela que impede um segundo pedido nascer enquanto este anda;
//   2. o CARD do pedido na fila da Têmis — o rastro. Se ele não nascer, a marca do passo 1 é
//      desfeita (o mesmo rollback da rota do Hércules), e aí nada sobrou — SALVO no caminho da marca
//      órfã, onde a história do pedido antigo já foi arquivada e não se apaga. É a única coisa que
//      este arquivo grava e não desfaz, e a frase de quem lê a falha diz isso (`frasePorTrasDoDesfazer`);
//   3. a CONCLUSÃO, pelo motor. É aqui que mora tudo o que NÃO se desfaz, e é por isso que ela é a
//      última: se a Clicksign recusar o cancelamento do envelope, o motor não grava nada na venda, e
//      o que fica é um pedido ABERTO na fila, com o motivo, que o próprio jurídico conclui ou
//      indefere pela tela do card. Meio cancelamento não existe.
//
// ⚠️ E O MOTIVO É OBRIGATÓRIO, conferido aqui e não só na tela. Ver `conferirMotivoDoCancelamento`.

const WORKSPACE = "careli";

export type PedidoDeCancelamentoDoContrato = {
  /** As duas declarações do distrato (`DECLARACOES_DO_DISTRATO`), quando a classificação pede. */
  declaracoes?: unknown;
  motivo: unknown;
  trabalhoId: string;
  usuarioId: null | string;
  usuarioNome: null | string;
};

export type CancelamentoDoContratoFeito = {
  /** O que não impediu o cancelamento e precisa ser dito (a venda do C2X, o card que sobrou). */
  avisos: string[];
  /** O card do pedido que nasceu — é por ele que o histórico do ato fica no quadro. */
  cardDoPedido: string;
  classificacao: ClassificacaoDoCancelamento;
  /** O desfecho do motor, como ele o devolve: recado, unidade, envelope, avisos. */
  conclusao: ConclusaoFeita;
  ok: true;
};

export type FalhaNoCancelamentoDoContrato = {
  /**
   * O card do pedido, quando ele JÁ NASCEU e foi a conclusão que parou.
   *
   * ⚠️ ELE É A SAÍDA DE QUEM LEU A FALHA. Sem este id a tela diria "não deu" sobre um pedido que
   * está aberto na fila, e o jurídico abriria um SEGUNDO pedido do mesmo contrato.
   */
  cardDoPedido?: string;
  erro: string;
  ok: false;
  status: 400 | 404 | 409 | 422 | 502 | 503;
};

type CardDoContrato = {
  cliente_cpf: null | string;
  cliente_nome: null | string;
  enterprise_codigo: null | string;
  enterprise_id: null | string;
  enterprise_nome: null | string;
  estagio: null | string;
  id: string;
  proposta_id: null | string;
  tipo: null | string;
  unidade: null | string;
};

type VendaDoContrato = {
  /**
   * O carimbo de última alteração, LIDO para poder ser devolvido.
   *
   * ⚠️ ELE ENTRA NA LEITURA SÓ PARA O DESFAZER SER EXATO. A marca do pedido escreve
   * `atualizado_em`; sem o valor anterior em mãos, desfazer a marca deixava a venda com a data de
   * hoje e a frase "Nada foi gravado" era falsa por uma coluna.
   */
  atualizado_em: null | string;
  cancelamento_pedido_em: null | string;
  cancelamento_pedido_motivo: null | string;
  cancelamento_pedido_por: null | string;
  cancelamento_pedido_tipo: null | string;
  cliente_documento: null | string;
  cliente_nome: null | string;
  codigo: null | string;
  data_assinatura: null | string;
  data_ato: null | string;
  data_faturamento: null | string;
  etapa: null | string;
  id: string;
  origem: null | string;
  protocolo_numero: null | number;
};

/** O que o GET da tela mostra antes de perguntar o motivo. */
export type ApuracaoDoCancelamento = {
  classificacao: ClassificacaoDoCancelamento;
  codigo: null | string;
  fatos: FatosApurados;
  ok: true;
  /** Já existe pedido de cancelamento ou distrato aberto para esta venda? O id dele. */
  pedidoAberto: null | string;
  /** A venda veio do C2X: o Panteon não escreve no legado, e o jurídico precisa saber. */
  vendaDoLegado: boolean;
};

/**
 * O QUE O SISTEMA SABE, para a tela escrever antes de o jurídico digitar o motivo.
 *
 * ⚠️ ELE NÃO DECIDE NADA — só conta. Quem grava é `cancelarContratoDoCard`, que REFAZ a apuração no
 * instante da escrita: entre abrir a confirmação e clicar pode entrar uma assinatura ou um pagamento,
 * e a classificação que vale é a do momento em que a venda cai. É a mesma divisão do GET/POST da rota
 * do pedido no Hércules.
 */
export async function apurarCancelamentoDoContrato(
  sb: SupabaseClient,
  trabalhoId: string,
): Promise<ApuracaoDoCancelamento | FalhaNoCancelamentoDoContrato> {
  const lido = await lerCardEVenda(sb, trabalhoId);
  if (!lido.ok) return lido;
  const { venda } = lido;

  let fatos: FatosApurados;
  try {
    fatos = await lerFatosDoContrato(sb, venda);
  } catch (erro) {
    console.error("[temis][cancelar-contrato] falha ao apurar os fatos", erro);
    return {
      erro: "Não foi possível conferir agora se este contrato foi assinado ou pago.",
      ok: false,
      status: 503,
    };
  }

  // ⚠️ LEITURA QUE FALHA NÃO VIRA "NÃO HÁ PEDIDO". Dizer isso sem ter conseguido perguntar faria a
  // tela oferecer o cancelamento de um contrato que já tem pedido na fila do jurídico.
  const abertos = await cardsAbertosDaProposta(sb, {
    propostaId: venda.id,
    tipos: ["cancelamento", "distrato"],
  });
  if (!abertos.ok) {
    return {
      erro: "Não foi possível conferir se já existe um pedido de cancelamento nesta venda.",
      ok: false,
      status: 503,
    };
  }

  return {
    classificacao: classificarCancelamento(fatos),
    codigo: codigoDaVendaLida(venda),
    fatos,
    ok: true,
    pedidoAberto: abertos.cards[0]?.id ?? null,
    vendaDoLegado: String(venda.origem ?? "").trim() === "c2x",
  };
}

/**
 * CANCELA O CONTRATO DESTE CARD: abre o pedido, e conclui pelo motor.
 *
 * `porta` é a chamada HTTP da Clicksign, repassada ao motor (o duplo do teste entra por aqui).
 */
export async function cancelarContratoDoCard(
  sb: SupabaseClient,
  pedido: PedidoDeCancelamentoDoContrato,
  porta?: PortaDaClicksign,
): Promise<CancelamentoDoContratoFeito | FalhaNoCancelamentoDoContrato> {
  // ── 0. LER E CONFERIR, SEM GRAVAR NADA ────────────────────────────────────
  const motivoConferido = conferirMotivoDoCancelamento(pedido.motivo);
  if (!motivoConferido.ok) return { erro: motivoConferido.erro, ok: false, status: 422 };
  const motivo = motivoConferido.motivo;

  const lido = await lerCardEVenda(sb, pedido.trabalhoId);
  if (!lido.ok) return lido;
  const { card, venda } = lido;

  let fatos: FatosApurados;
  try {
    fatos = await lerFatosDoContrato(sb, venda);
  } catch (erro) {
    console.error("[temis][cancelar-contrato] falha ao apurar os fatos", erro);
    return {
      erro: "Não foi possível conferir agora se este contrato foi assinado ou pago. Nada foi gravado.",
      ok: false,
      status: 503,
    };
  }

  // ⚠️ QUEM CLICA NÃO ESCOLHE O INSTRUMENTO, e não há ajuste manual por aqui de propósito. A rota do
  // Hércules aceita uma correção declarada (`ajuste`) para o pagamento feito por fora do sistema;
  // aceitá-la aqui permitiria rebaixar um distrato a cancelamento simples — sair sem devolver
  // dinheiro do cliente — no único lugar onde quem clica é também quem conclui. Se a apuração estiver
  // errada, o caminho continua sendo o pedido pela tela Venda, que grava que alguém corrigiu à mão.
  const classificacao = classificarCancelamento(fatos);

  // ⚠️ AS DECLARAÇÕES DO DISTRATO VÊM ANTES DE QUALQUER ESCRITA, e são as MESMAS que o botão de
  // concluir exige (`conferirDeclaracoes`). Sem elas o motor recusaria a conclusão depois de o
  // pedido já ter nascido — o pedido ficaria aberto na fila por uma caixa não marcada.
  const declaracoes = conferirDeclaracoes(classificacao.tipo, pedido.declaracoes);
  if (!declaracoes.ok) {
    return {
      erro: `${declaracoes.erro} (este contrato exige distrato: ${classificacao.porque}).`,
      ok: false,
      status: 422,
    };
  }

  const abertos = await cardsAbertosDaProposta(sb, {
    propostaId: venda.id,
    tipos: ["cancelamento", "distrato"],
  });
  if (!abertos.ok) {
    return {
      erro: "Não foi possível conferir se já existe um pedido de cancelamento nesta venda. Nada foi gravado; tente de novo em instantes.",
      ok: false,
      status: 503,
    };
  }
  // ⚠️ UM PEDIDO POR VENDA. O segundo card na fila do mesmo contrato deixa quem lê o quadro sem
  // saber qual dos dois vale — e o jurídico tem por onde terminar o que já existe.
  const jaNaFila = abertos.cards[0];
  if (jaNaFila) {
    return {
      cardDoPedido: jaNaFila.id,
      erro: `Já existe um pedido de ${nomeDoPedido(jaNaFila.tipo)} na fila para esta venda. Abra esse card e conclua por ele; nada foi gravado aqui.`,
      ok: false,
      status: 409,
    };
  }

  const agora = new Date().toISOString();

  // ── 1. A MARCA DO PEDIDO NA VENDA (refazível) ─────────────────────────────
  const marcado = await marcarOPedido(sb, venda, {
    agora,
    motivo,
    quemNome: pedido.usuarioNome,
    tipo: classificacao.tipo,
  });
  if (!marcado.ok) return marcado;

  // ── 2. O CARD DO PEDIDO NA FILA ───────────────────────────────────────────
  //
  // ⚠️ O CARD EXISTE PARA O RASTRO SER O MESMO DO OUTRO CAMINHO. O quadro, o histórico da venda, a
  // ficha do lote e a conclusão leem o pedido no card; cancelar sem abri-lo deixaria a venda morta
  // sem nada na Têmis dizendo quem a matou e por quê.
  const nascido = await abrirOPedido(sb, {
    card,
    classificacao,
    fatos,
    motivo,
    quem: pedido.usuarioId,
    quemNome: pedido.usuarioNome,
    venda,
  });
  if (!nascido.ok) {
    // ⚠️ A MARCA VOLTA ATRÁS QUANDO O CARD NÃO NASCEU, e a condição é a marca DESTA chamada: sem
    // card, o pedido não existe, e deixar a marca de pé apagaria o botão do pedido no Hércules para
    // sempre, num contrato sem pedido nenhum na fila.
    const desfeito = await desfazerAMarca(sb, venda, agora);
    return {
      erro: `O pedido não chegou à fila da Têmis (${nascido.erro}). ${
        desfeito
          ? frasePorTrasDoDesfazer(marcado.substituiuMarcaAntiga)
          : "A marca do pedido ficou registrada na venda e o botão do Hércules volta a aceitar o pedido em 15 minutos. O contrato continua como estava; avise o time do Panteon."
      }`,
      ok: false,
      status: 502,
    };
  }

  // ── 3. A CONCLUSÃO, PELO MOTOR ────────────────────────────────────────────
  //
  // ⚠️ É AQUI QUE O ENVELOPE MORRE, E ANTES DE A VENDA CAIR — a ordem é do motor, e ele lê o estado
  // REAL na Clicksign imediatamente antes de cancelar (o webhook do nosso banco atrasa). Recusa da
  // Clicksign, leitura que não responde ou contrato que consta assinado por todos PARAM a conclusão
  // sem gravar nada na venda.
  const conclusao = await concluirCancelamentoDoCard(
    sb,
    {
      declaracoes: pedido.declaracoes,
      trabalhoId: nascido.id,
      usuarioId: pedido.usuarioId,
      usuarioNome: pedido.usuarioNome,
    },
    porta,
  );

  if (!conclusao.ok) {
    // ⚠️ O PEDIDO FICA ABERTO, E A FRASE DIZ O CAMINHO. Nada ficou pela metade: a venda continua na
    // etapa em que estava, o contrato continua valendo e o pedido está na fila com o motivo escrito.
    // Apagar o card aqui jogaria fora o único registro de que alguém tentou cancelar, e a próxima
    // tentativa nasceria sem saber que a Clicksign recusou.
    return {
      cardDoPedido: nascido.id,
      erro: `${conclusao.erro} O pedido de ${NOME_DO_TIPO[classificacao.tipo].toLowerCase()} FICOU ABERTO na fila com o motivo registrado: resolva o que a frase acima diz e conclua por esse card, ou indefira-o para devolver a venda.`,
      ok: false,
      status: conclusao.status === 400 ? 409 : conclusao.status,
    };
  }

  const avisos: string[] = [];
  if (String(venda.origem ?? "").trim() === "c2x") {
    // ⚠️ O PANTEON NÃO ESCREVE NO LEGADO (Lucas, 16/09/2026: *"não precisa fazer nada no c2x, se
    // precisar o time faz manualmente"*). O aviso é o que impede alguém concluir que o C2X acompanhou.
    avisos.push(
      "Esta venda veio do C2X: o Panteon não altera o legado. Se o cancelamento precisar aparecer lá, o ajuste é manual.",
    );
  }

  return { avisos, cardDoPedido: nascido.id, classificacao, conclusao, ok: true };
}

/**
 * O card e a venda, com todas as recusas que não gravam nada.
 *
 * ⚠️ O ALCANCE DO CARD (o portal) NÃO SE CONFERE AQUI: quem chama é a rota do hub, e a régua dela é
 * nominal (`autorizarAlteracaoManualDoContrato`). Uma conferência de escopo por dentro daria a
 * impressão de que esta função pode ser aberta a outra porta sem revisar a régua.
 */
async function lerCardEVenda(
  sb: SupabaseClient,
  trabalhoId: string,
): Promise<
  | FalhaNoCancelamentoDoContrato
  | { card: CardDoContrato; ok: true; venda: VendaDoContrato }
> {
  const id = String(trabalhoId ?? "").trim();
  if (!id) return { erro: "Informe o trabalho.", ok: false, status: 400 };

  const { data: linhaDoCard, error: erroDoCard } = await sb
    .from("temis_trabalhos")
    // ⚠️ OS NOMES SÃO `enterprise_*` E `cliente_cpf`, conferidos no schema: o `select` é string, e o
    // typecheck não alcança. Coluna errada aqui devolve erro para a linha inteira.
    .select(
      "id, tipo, estagio, proposta_id, unidade, cliente_nome, cliente_cpf, enterprise_id, enterprise_codigo, enterprise_nome",
    )
    .eq("workspace_id", WORKSPACE)
    .eq("id", id)
    .maybeSingle();

  if (erroDoCard) {
    console.error("[temis][cancelar-contrato] falha ao ler o card", erroDoCard);
    return { erro: "Não foi possível abrir o trabalho. Nada foi gravado.", ok: false, status: 503 };
  }
  const card = linhaDoCard as CardDoContrato | null;
  if (!card) return { erro: "Trabalho não encontrado.", ok: false, status: 404 };

  const tipo = String(card.tipo ?? "").trim();
  const estagio = String(card.estagio ?? "").trim();
  if (tipo !== "contrato") {
    return {
      erro: "Daqui só se cancela o contrato. Num pedido de cancelamento ou de distrato, quem desfaz a venda é o botão de concluir.",
      ok: false,
      status: 409,
    };
  }
  if (!podeCancelarOContrato(tipo, estagio)) {
    return {
      erro:
        estagio === "analise"
          ? "Este contrato ainda está em Análise: aqui o caminho é Indeferir, que devolve a venda a quem vendeu sem gastar um cancelamento."
          : "Este card não está numa etapa em que o contrato se cancele daqui. Do Faturado e do Indeferido o caminho é o pedido de cancelamento no Hércules, na tela da venda.",
      ok: false,
      status: 409,
    };
  }
  if (!card.proposta_id) {
    return {
      erro: "Este card não tem venda ligada no Panteon: não há contrato de venda para cancelar daqui.",
      ok: false,
      status: 409,
    };
  }
  // ⚠️ SEM EMPREENDIMENTO NÃO SE ABRE O CARD DO PEDIDO, e é melhor recusar aqui do que no meio: o
  // insert da fila recusaria a linha, e a marca do pedido já estaria gravada na venda para ser
  // desfeita. `enterprise_id` é a coluna que todo card carrega; vazia, algo está errado no card.
  if (!String(card.enterprise_id ?? "").trim()) {
    return {
      erro: "Este card não tem empreendimento gravado, e o pedido de cancelamento nasce com ele. Avise o time do Panteon.",
      ok: false,
      status: 409,
    };
  }

  const { data: linhaDaVenda, error: erroDaVenda } = await sb
    .from("hercules_propostas")
    .select(
      "id, codigo, protocolo_numero, etapa, origem, cliente_nome, cliente_documento, cancelamento_pedido_em, cancelamento_pedido_motivo, cancelamento_pedido_por, cancelamento_pedido_tipo, data_assinatura, data_ato, data_faturamento, atualizado_em",
    )
    .eq("workspace_id", WORKSPACE)
    .eq("id", card.proposta_id)
    .maybeSingle();

  if (erroDaVenda) {
    console.error("[temis][cancelar-contrato] falha ao ler a venda", erroDaVenda);
    return {
      erro: "Não foi possível ler a venda deste card. Nada foi gravado.",
      ok: false,
      status: 503,
    };
  }
  const venda = linhaDaVenda as VendaDoContrato | null;
  if (!venda) return { erro: "A venda deste card não foi encontrada.", ok: false, status: 404 };

  // ⚠️ A ETAPA DA VENDA MANDA, E NÃO A COLUNA DO CARD. Card em "Em assinatura" com a venda em
  // `proposta` existe (um contrato indeferido devolve a venda e o card pode ter sido reaberto): ali o
  // cancelamento é de PROPOSTA, é um clique no Hércules e devolve o lote na hora. A lista é a mesma
  // do pedido pela tela Venda (`DEPOIS_DO_CONTRATO`), para os dois caminhos aceitarem o mesmo.
  const etapa = String(venda.etapa ?? "").trim();
  if (!DEPOIS_DO_CONTRATO.has(etapa)) {
    return {
      erro: VENDA_DESFEITA.has(etapa)
        ? "A venda deste contrato já foi desfeita. Este card pode ser indeferido para sair da fila."
        : `A venda deste contrato está em "${etapa}", antes do contrato: o cancelamento dela é no Hércules, na tela da venda, e devolve o lote na hora.`,
      ok: false,
      status: 409,
    };
  }

  return { card, ok: true, venda };
}

/**
 * A MARCA DO PEDIDO NA VENDA — o passo 1, o único que este arquivo grava na venda.
 *
 * ⚠️ ELA NÃO MEXE NA ETAPA DA VENDA, e é por isso que é o primeiro passo: se tudo parar aqui, a
 * venda continua exatamente como estava, e a marca é tratada como resto pelos dois caminhos do
 * pedido (`marcaEhResto`, `limparMarcaOrfa`).
 *
 * ⚠️ E ELA É O QUE LEVA O MOTIVO PARA A VENDA. O motor grava em `cancelada_motivo` o motivo do
 * PEDIDO; sem a marca, a venda cancelada diria "Pedido sem motivo registrado".
 *
 * ⚠️ A MARCA ANTIGA SEM CARD ABERTO É RESTO, E É SUBSTITUÍDA COM A HISTÓRIA GUARDADA. Medido em
 * 23/09/2026: 1 venda viva (Larissa Fontes Marques, marcada em 12/09) com marca de pé e ZERO cards
 * de pedido abertos. Recusar por causa dela deixaria essa venda sem saída pela tela — exatamente o
 * defeito que a casa já consertou duas vezes (VOL1106 e VOC0306). Antes de substituir, o pedido
 * antigo vira movimento em `hercules_proposta_etapas`, como o indeferimento faz: a ficha do lote
 * continua sabendo quem pediu e por quê.
 */
async function marcarOPedido(
  sb: SupabaseClient,
  venda: VendaDoContrato,
  args: {
    agora: string;
    motivo: string;
    quemNome: null | string;
    tipo: "cancelamento" | "distrato";
  },
): Promise<FalhaNoCancelamentoDoContrato | { ok: true; substituiuMarcaAntiga: boolean }> {
  const marcaAntiga = venda.cancelamento_pedido_em;
  const valores = {
    atualizado_em: args.agora,
    cancelamento_pedido_em: args.agora,
    cancelamento_pedido_motivo: args.motivo,
    cancelamento_pedido_por: args.quemNome,
    cancelamento_pedido_tipo: args.tipo,
  };

  if (marcaAntiga) {
    // ⚠️ A MARCA RECÉM-NASCIDA NÃO É RESTO. A rota do pedido do Hércules grava a marca ANTES de criar
    // o card; tratá-la como resto aqui abriria o segundo pedido que ela existe para impedir. Os cards
    // abertos já foram contados por quem chama, e chegam aqui como zero.
    if (!marcaEhResto({ agora: new Date(args.agora), cardsAbertos: 0, marca: marcaAntiga })) {
      return {
        erro: "Um pedido de cancelamento acabou de ser aberto para esta venda em outra tela. Abra o quadro de novo e conclua por aquele card; nada foi gravado aqui.",
        ok: false,
        status: 409,
      };
    }

    // ⚠️ UM OBJETO, E NÃO UMA LISTA DE UM: o PostgREST aceita os dois, e a linha única é a forma que
    // toda a casa usa para um movimento só.
    const { error: erroDaHistoria } = await sb.from("hercules_proposta_etapas").insert({
      autor_nome: venda.cancelamento_pedido_por,
      de: null,
      motivo: venda.cancelamento_pedido_motivo,
      observacao: null,
      para:
        String(venda.cancelamento_pedido_tipo ?? "").trim() === "distrato"
          ? MOVIMENTO_PEDIDO_DE_DISTRATO
          : MOVIMENTO_PEDIDO_DE_CANCELAMENTO,
      proposta_id: venda.id,
      quando: marcaAntiga,
      workspace_id: WORKSPACE,
    });
    // ⚠️ SEM A HISTÓRIA, A MARCA NÃO SE SUBSTITUI. Trocar o motivo antigo sem guardá-lo apagaria da
    // ficha do lote quem pediu o cancelamento anterior e por quê — e nada aqui é urgente o bastante
    // para pagar esse preço.
    if (erroDaHistoria) {
      console.error(
        "[temis][cancelar-contrato] a história do pedido antigo não foi gravada",
        erroDaHistoria,
      );
      return {
        erro: "Esta venda tem um pedido de cancelamento antigo sem card na fila, e não foi possível guardar a história dele. Nada foi gravado; tente de novo em instantes.",
        ok: false,
        status: 503,
      };
    }
  }

  // ⚠️ COMPARAÇÃO E TROCA NA PRÓPRIA ESCRITA: é ela que impede o segundo pedido de dois cliques
  // rápidos. Sem marca antiga, a condição é `is null`; com marca antiga, é a marca LIDA — a que
  // entrou depois desta leitura é de outro pedido, e não se sobrescreve.
  //
  // ⚠️ NÃO TROQUE ESTAS DUAS LINHAS POR UM `update(...).eq("id", ...).select("id")` SECO. A revisão
  // adversarial de 23/09/2026 fez exatamente isso e os 48 testes do lote continuaram VERDES: sem a
  // condição, duas requisições que leem `cancelamento_pedido_em = null` passam as duas pelo
  // `jaNaFila`, gravam as duas a marca, abrem as duas um card na fila e chamam a Clicksign DUAS
  // VEZES na conta de produção. A comparação e troca do motor impede a venda de cair duas vezes,
  // mas a perdedora deixaria o segundo card aberto, que é o que esta marca existe para impedir.
  //
  // ⚠️ E AGORA ELA TEM TESTE QUE CAI QUANDO SOME: "a requisição irmã grava a marca entre a nossa
  // leitura e a nossa escrita" e "dois cliques ao mesmo tempo", em `cancelar-contrato-servico.test.ts`.
  const escrita = sb.from("hercules_propostas").update(valores).eq("id", venda.id);
  const { data: marcadas, error } = await (marcaAntiga
    ? escrita.eq("cancelamento_pedido_em", marcaAntiga)
    : escrita.is("cancelamento_pedido_em", null)
  ).select("id");

  // ⚠️ FALHA DE ESCRITA NÃO É "JÁ EXISTE". Zero linhas pelo `is null` é outro clique que chegou
  // primeiro; zero linhas por erro do banco é outra coisa, e mandar "já existe um pedido" faria o
  // jurídico procurar na fila um card que ninguém abriu.
  // ⚠️ AQUI TAMBÉM A FRASE PRECISA SABER DA HISTÓRIA, e não só o desfazer lá de cima. Estes dois
  // caminhos correm DEPOIS do insert em `hercules_proposta_etapas` (o arquivamento da marca órfã),
  // que nunca se desfaz: dizer "Nada foi gravado" neles é mentir do mesmo jeito. Medido na revisão
  // de 24/09/2026, reproduzindo o 409 com marca órfã de 12/09: a frase dizia que nada foi gravado
  // e havia uma linha de história gravada, com a marca antiga perdida.
  if (error) {
    console.error("[temis][cancelar-contrato] falha ao marcar o pedido na venda", error);
    return {
      erro: `Não foi possível registrar o pedido na venda. ${frasePorTrasDoDesfazer(Boolean(marcaAntiga))} Tente de novo em instantes.`,
      ok: false,
      status: 503,
    };
  }
  if (!marcadas || marcadas.length === 0) {
    return {
      erro: `Esta venda mudou enquanto a tela estava aberta (outro pedido de cancelamento chegou primeiro). ${frasePorTrasDoDesfazer(Boolean(marcaAntiga))} Abra o card de novo.`,
      ok: false,
      status: 409,
    };
  }

  return { ok: true, substituiuMarcaAntiga: Boolean(marcaAntiga) };
}

/**
 * Desfaz a marca desta chamada. `false` = ela ficou de pé, e a frase para o jurídico muda.
 *
 * ⚠️ ELE DEVOLVE `atualizado_em` AO VALOR LIDO, e é isso que faz "Nada foi gravado" ser verdade
 * quando não havia marca antiga: a marca do pedido escreve essa coluna junto, e zerar só as quatro
 * colunas do pedido deixava a venda com a data de hoje numa chamada que não mudou mais nada.
 *
 * ⚠️ A COLUNA É `NOT NULL` COM DEFAULT `now()` (conferida em `information_schema` em 23/09/2026:
 * 4.947 vendas, todas preenchidas), então valor ausente na leitura NÃO entra na escrita: mandar
 * nulo faria o Postgres recusar o desfazer inteiro e a marca ficaria de pé por causa do carimbo.
 *
 * ⚠️ E ELE NÃO RESSUSCITA A MARCA ANTIGA, DE PROPÓSITO. Ver a frase de quem chama.
 */
async function desfazerAMarca(
  sb: SupabaseClient,
  venda: Pick<VendaDoContrato, "atualizado_em" | "id">,
  marca: string,
): Promise<boolean> {
  const valores: Record<string, unknown> = {
    cancelamento_pedido_em: null,
    cancelamento_pedido_motivo: null,
    cancelamento_pedido_por: null,
    cancelamento_pedido_tipo: null,
  };
  const carimboAntigo = String(venda.atualizado_em ?? "").trim();
  if (carimboAntigo) valores.atualizado_em = venda.atualizado_em;

  const { data: limpas, error } = await sb
    .from("hercules_propostas")
    .update(valores)
    .eq("id", venda.id)
    // ⚠️ SÓ A MARCA DESTA CHAMADA, e não a de um pedido que tenha entrado depois dela.
    .eq("cancelamento_pedido_em", marca)
    .select("id");

  if (error || (limpas?.length ?? 0) === 0) {
    console.error("[temis][cancelar-contrato] o carimbo do pedido ficou de pé", {
      erro: error?.message ?? null,
      proposta: venda.id,
    });
    return false;
  }
  return true;
}

/**
 * O CARD DO PEDIDO — o passo 2.
 *
 * ⚠️ OS DADOS SAEM DO CARD DE CONTRATO, E NÃO DE UMA LEITURA NOVA DA UNIDADE. `temis_trabalhos` NÃO
 * TEM `unidade_id` (conferido em `information_schema` em 23/09/2026): tem `enterprise_id`,
 * `enterprise_codigo`, `enterprise_nome` e `unidade` como TEXTO ("Quadra 03 · Lote 06"). Casar esse
 * texto com uma unidade para descobrir o id seria colar o pedido no lote errado no dia em que dois
 * empreendimentos tivessem a mesma quadra e lote — e o motor não precisa dele: ele lê `unidade_id`
 * da própria venda.
 *
 * ⚠️ O DONO DO PEDIDO É O DONO DO CARD DE CONTRATO (Lucas, 16/09/2026: quem confecciona o contrato
 * confecciona o distrato). Coluna ausente (0172 pendente) vira nulo, que é a fila da Careli.
 */
async function abrirOPedido(
  sb: SupabaseClient,
  args: {
    card: CardDoContrato;
    classificacao: ClassificacaoDoCancelamento;
    fatos: FatosApurados;
    motivo: string;
    quem: null | string;
    quemNome: null | string;
    venda: VendaDoContrato;
  },
): Promise<{ erro: string; ok: false } | { id: string; ok: true }> {
  const cod = args.venda.codigo || codigoDaVenda(args.venda.protocolo_numero) || "—";
  const operadoPor = await donoDoCardDeContrato(sb, args.card.id);

  // ⚠️ O FORMATO DA OBSERVAÇÃO É O QUE `pedidoDoTrabalho` SABE LER, parte por parte e na ordem: a
  // origem, o COD, o motivo, a apuração e — por ÚLTIMO, sem rótulo — a classificação. Ela é a única
  // parte sem prefixo, e é reconhecida pela POSIÇÃO: qualquer texto solto depois dela passaria a
  // aparecer como "Classificação" na tela da análise. Por isso o aviso da venda importada do C2X vai
  // na resposta, e não aqui.
  const observacao = [
    "Pedido de cancelamento pela tela Trabalho da Têmis",
    `COD ${cod}`,
    `motivo: ${args.motivo}`,
    `apurado pelo sistema: ${args.fatos.comoSoube.assinatura}, ${args.fatos.comoSoube.pagamento}`,
    args.classificacao.porque,
  ].join(" · ");

  const aberto = await abrirTrabalho({
    abertoPor: args.quem,
    // ⚠️ O CANAL É `coordenador` PORQUE FOI GENTE DA CASA NUMA TELA INTERNA. `hercules` é o pedido
    // que vem da tela Venda, e `iris` exige ticket e evidência do atendimento. O canal não recorta
    // board nenhum; ele conta de onde o card veio, e mentir nele estragaria a única leitura que
    // diferencia o pedido do coordenador do pedido do jurídico.
    canal: "coordenador",
    clienteCpf: args.card.cliente_cpf ?? args.venda.cliente_documento,
    clienteNome: args.card.cliente_nome || args.venda.cliente_nome || "Cliente",
    empreendimentoCodigo: args.card.enterprise_codigo || "—",
    empreendimentoId: String(args.card.enterprise_id ?? ""),
    empreendimentoNome: args.card.enterprise_nome || "Empreendimento",
    observacao,
    operadoPor,
    propostaId: args.venda.id,
    tipo: args.classificacao.tipo,
    // ⚠️ O CARD DE ORIGEM É O CONTRATO QUE ESTÁ SENDO CANCELADO: é o que liga os dois lados no
    // histórico, e o motor indefere esse mesmo card no passo dele.
    trabalhoOrigemId: args.card.id,
    unidade: args.card.unidade || "—",
  });

  if (aberto.ok) return { id: aberto.id, ok: true };
  console.error("[temis][cancelar-contrato] a fila recusou o pedido", aberto.erro);
  return { erro: aberto.erro, ok: false };
}

/**
 * O dono do card de contrato, para o pedido herdar a fila.
 *
 * ⚠️ COLUNA AUSENTE É NULO, E NÃO ERRO (0172 pendente): sem a coluna não há dono para herdar, e o
 * card nasce na fila da Careli, como todo card nascia. Outro erro de leitura também vira nulo aqui,
 * de propósito: a fila errada se corrige no quadro, e derrubar o cancelamento inteiro por causa dela
 * deixaria o lote preso.
 */
async function donoDoCardDeContrato(sb: SupabaseClient, cardId: string): Promise<null | string> {
  const { data, error } = await sb
    .from("temis_trabalhos")
    .select("operado_por")
    .eq("workspace_id", WORKSPACE)
    .eq("id", cardId)
    .maybeSingle<{ operado_por: null | string }>();

  if (error) {
    if (!ehColunaDoDonoAusente(error)) {
      console.error("[temis][cancelar-contrato] falha ao ler o dono do card", error.message);
    }
    return null;
  }
  return data?.operado_por ?? null;
}

/**
 * O QUE DE FATO SOBROU quando o card não nasceu e a marca foi desfeita.
 *
 * ⚠️ "NADA FOI GRAVADO" SÓ VALE QUANDO NÃO HAVIA MARCA ANTIGA, e antes desta função a frase era uma
 * só para os dois caminhos. Com marca órfã na venda, `marcarOPedido` INSERE o pedido antigo em
 * `hercules_proposta_etapas` e substitui a marca; o desfazer devolve a marca a NULO, e não a antiga.
 * A tela dizia "Nada foi gravado; o contrato continua como estava" sobre uma venda que tinha ganhado
 * uma linha de história e perdido a marca do pedido anterior.
 *
 * ⚠️ A ESCOLHA FOI A FRASE DIZER A VERDADE, E NÃO O DESFAZER RESSUSCITAR O PEDIDO ANTIGO. Ressuscitar
 * significaria regravar as quatro colunas da marca velha E apagar a linha de história que acabou de
 * nascer — e apagar história é exatamente o que este arquivo já se recusa a fazer no caminho de ida
 * ("SEM A HISTÓRIA, A MARCA NÃO SE SUBSTITUI"). A marca órfã não tinha card na fila em lugar nenhum:
 * de volta, ela só voltaria a apagar o botão do pedido no Hércules, que é o defeito que a casa já
 * consertou duas vezes (VOL1106 e VOC0306). O que se perde é reversibilidade de uma marca que já era
 * resto; o que se ganha é uma frase que não mente no único caminho destrutivo desta porta.
 *
 * ⚠️ E O ALCANCE DISSO HOJE É ZERO, medido em 23/09/2026: a única venda viva com marca órfã (Larissa
 * Fontes Marques, 12/09) não tem card de contrato que este botão alcance. A frase foi consertada por
 * ser frase de caminho destrutivo, não por estar ferindo alguém agora.
 */
function frasePorTrasDoDesfazer(substituiuMarcaAntiga: boolean): string {
  if (!substituiuMarcaAntiga) return "Nada foi gravado; o contrato continua como estava.";
  return "O contrato continua como estava e nenhum pedido está na fila. Uma coisa ficou gravada: esta venda tinha um pedido de cancelamento antigo sem card, e ele foi arquivado no histórico da venda antes desta tentativa. A marca dele não voltou.";
}

/**
 * "cancelamento" ou "distrato" em minúscula, para entrar no meio de uma frase.
 *
 * ⚠️ O TIPO VEM DO BANCO COMO `string`, e a tabela `NOME_DO_TIPO` cobre os cinco tipos: um valor
 * inesperado cairia em `undefined` e a frase sairia "pedido de undefined". Aqui ele cai em
 * "cancelamento", que é a palavra certa para os dois tipos que esta função pode receber.
 */
function nomeDoPedido(tipo: string): string {
  return String(tipo ?? "").trim() === "distrato"
    ? NOME_DO_TIPO.distrato.toLowerCase()
    : NOME_DO_TIPO.cancelamento.toLowerCase();
}

function codigoDaVendaLida(venda: VendaDoContrato): null | string {
  const codigo = String(venda.codigo ?? "").trim();
  if (codigo) return codigo;
  return codigoDaVenda(venda.protocolo_numero) || null;
}
