import type { SupabaseClient } from "@supabase/supabase-js";

import type { PortaDaClicksign } from "@/lib/assinatura/clicksign/cliente";
import { cancelarEnvelope, consultarEnvelope } from "@/lib/assinatura/clicksign/envelope";
import { type EnvelopeDaProposta, envelopeQueSegura } from "@/lib/assinatura/envio-db";
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

import { type DevolucaoDoCadastro, devolverCadastroDaUnidade } from "./cancelar-reserva-server";
import { codigoDaVenda } from "./codigo-da-venda";
import { lerFatosDoContrato } from "./fatos-do-contrato-server";
import { ETAPAS_DO_FLUXO } from "./fluxo-de-venda";

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

/** O que aconteceu com a unidade, pronto para a tela e para o histórico. */
export type DesfechoDaUnidade = { frase: string; voltou: boolean };

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
};

type VendaDaConclusao = {
  cancelamento_pedido_motivo: null | string;
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

/** As etapas de onde a venda já saiu do caminho: concluir de novo não tem o que fazer nela. */
const JA_DESFEITA = new Set(["cancelado", "distrato"]);

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
    .select("id, tipo, estagio, proposta_id")
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
  if ((ESTAGIOS_ENCERRADOS as readonly string[]).includes(estagio)) {
    return {
      erro:
        estagio === "indeferido"
          ? "Este pedido foi indeferido: a venda continua como estava. Para desfazer a venda agora, peça o cancelamento de novo no Hércules, na tela da venda."
          : "Este card já está concluído.",
      ok: false,
      status: 409,
    };
  }

  if (!card.proposta_id) {
    return {
      erro: "Este card não tem venda ligada no Panteon: não há venda para cancelar daqui.",
      ok: false,
      status: 409,
    };
  }

  // ⚠️ AS DECLARAÇÕES VÊM ANTES DE QUALQUER LEITURA CARA E DE QUALQUER CHAMADA À CLICKSIGN: sem
  // elas o distrato não conclui, e não há por que perguntar mais nada.
  const declaracoes = conferirDeclaracoes(tipo, pedido.declaracoes);
  if (!declaracoes.ok) return { erro: declaracoes.erro, ok: false, status: 422 };

  const { data: linhaDaVenda, error: erroDaVenda } = await sb
    .from("hercules_propostas")
    .select(
      "id, codigo, protocolo_numero, etapa, reserva_id, unidade_id, cancelamento_pedido_motivo, data_assinatura, data_ato, data_faturamento",
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
  /** "a venda COD 000019", como a tela Venda escreve o código. */
  const aVenda = codigo ? `a venda COD ${codigo}` : "a venda";
  const etapaLida = String(venda.etapa ?? "").trim();
  const jaEstavaDesfeita = JA_DESFEITA.has(etapaLida);

  if (!jaEstavaDesfeita && !(ETAPAS_DO_FLUXO as readonly string[]).includes(etapaLida)) {
    return {
      erro: `A venda deste card está numa etapa que o Panteon não conhece ("${etapaLida}"). Nada foi gravado.`,
      ok: false,
      status: 409,
    };
  }

  let envelopeCancelado: null | string = null;

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

    // ⚠️ SÓ O CANCELAMENTO TOCA NO ENVELOPE. No distrato o contrato foi assinado: ele é o documento
    // da venda desfeita e fica como está na Clicksign.
    if (tipo === "cancelamento") {
      const envelope = await cancelarEnvelopeVivoDoContrato(sb, venda.id, porta);
      if (!envelope.ok) return envelope;
      envelopeCancelado = envelope.envelopeCancelado;
    }
  }

  const agora = new Date().toISOString();
  const nomeDoTipo = NOME_DO_TIPO[tipo];
  const quem = texto(pedido.usuarioNome);
  const avisos: string[] = [];

  // ⚠️ NO DISTRATO O ENVELOPE NÃO SE MEXE, MAS O QUE AINDA CORRE PRECISA SER DITO. O distrato pode
  // nascer do PAGAMENTO com o contrato ainda sem todas as assinaturas: aí há um envelope vivo na
  // Clicksign de uma venda que acabou de cair, e alguém ainda pode assinar. Cancelar daqui é decisão
  // que a regra do distrato não deu; ficar calado seria pior. Só leitura, e falha não para nada.
  if (tipo === "distrato" && !jaEstavaDesfeita) {
    const aviso = await avisoDoEnvelopeNoDistrato(sb, venda.id);
    if (aviso) avisos.push(aviso);
  }
  const envelopeJaMorreu = envelopeCancelado
    ? ` O envelope ${envelopeCancelado} já foi cancelado na Clicksign.`
    : "";

  // ── 1. A VENDA MORRE PRIMEIRO ─────────────────────────────────────────────
  if (!jaEstavaDesfeita) {
    const motivoGravado = [
      texto(venda.cancelamento_pedido_motivo) ?? "Pedido sem motivo registrado",
      `${nomeDoTipo} concluído na Têmis${quem ? ` por ${quem}` : ""}`,
      declaracoes.declaradas.length > 0 ? `Declarado: ${declaracoes.declaradas.join("; ")}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const { data: desfeitas, error: erroDaVenda1 } = await sb
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
      .eq("etapa", etapaLida)
      .select("id");

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

  // ── 3. O CARD DE CONTRATO QUE AINDA ANDAVA ───────────────────────────────
  //
  // ⚠️ SEM ISTO O JURÍDICO CONTINUARIA TRABALHANDO UM CONTRATO DE VENDA DESFEITA: gerando, mandando
  // assinar. O card é indeferido (a saída lateral), com o motivo apontando para este card, e a
  // passagem vai para o histórico dele. Falha aqui não desfaz nada: a venda já caiu, e o aviso diz
  // qual card sobrou aberto.
  const contratosIndeferidos: string[] = [];
  const abertos = await cardsAbertosDaProposta(sb, { propostaId: venda.id, tipos: ["contrato"] });
  if (!abertos.ok) {
    avisos.push("Não deu para conferir se o card de contrato desta venda ainda estava aberto.");
  } else {
    for (const contrato of abertos.cards) {
      const observacao = `Venda cancelada pelo card de ${nomeDoTipo.toLowerCase()} ${card.id}`;
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
        avisos.push(`O card de contrato ${contrato.id} continua aberto: indefira por lá.`);
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

  const cardConcluido = !erroDoFechamento && (fechados?.length ?? 0) > 0;
  if (!cardConcluido) {
    if (erroDoFechamento) {
      console.error("[hercules][concluir-cancelamento] falha ao fechar o card", erroDoFechamento);
    }
    avisos.push("A venda caiu, mas este card não foi para Concluído (ele mudou de etapa ou a gravação falhou). Abra de novo e confira.");
  }

  // ── 5. A UNIDADE POR ÚLTIMO, PELA TRAVA ──────────────────────────────────
  //
  // ⚠️ SEM `reservaId` COMO "MINHA". A reserva desta venda já caiu no passo 2; se por algum motivo
  // ela ainda estiver viva, a trava PRECISA contá-la como dona, e é o que acontece sem o parâmetro.
  // `vendida` entra nos aceitos porque a venda importada do C2X chega com o cadastro `vendida` pela
  // carga; `bloqueada` nunca sai daqui (a própria função o recusa).
  const unidade: DesfechoDaUnidade = venda.unidade_id
    ? desfechoDaUnidade(
        await devolverCadastroDaUnidade(sb, venda.unidade_id, {}, { aceitos: ["reservada", "vendida"] }),
      )
    : { frase: "a venda não tem unidade ligada no Panteon", voltou: false };

  // ⚠️ A PASSAGEM DO CARD É GRAVADA DEPOIS DA UNIDADE, e é a única coisa fora da ordem acima — de
  // propósito: ela é HISTÓRICO, não estado, e só depois do passo 5 dá para escrever nela se o lote
  // voltou. O recado da tela some em segundos; o histórico do card é onde o jurídico vai procurar
  // por que um lote não voltou para a venda.
  if (cardConcluido) {
    await registrarPassagemDeEtapa(sb, {
      de: estagio,
      observacao: [
        codigo ? `Venda COD ${codigo} ${tipo === "distrato" ? "distratada" : "cancelada"}` : null,
        jaEstavaDesfeita ? "a venda já estava desfeita quando o card foi concluído" : null,
        declaracoes.declaradas.length > 0 ? `Declarado: ${declaracoes.declaradas.join("; ")}` : null,
        envelopeCancelado ? `envelope ${envelopeCancelado} cancelado na Clicksign` : null,
        primeiraMaiuscula(unidade.frase),
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

  return {
    avisos,
    cardConcluido,
    codigo,
    contratosIndeferidos,
    envelopeCancelado,
    jaEstavaDesfeita,
    ok: true,
    recado: [`${vendaCaiu} e ${unidade.frase}.`, ...avisos].join(" "),
    tipo,
    unidade,
  };
}

/**
 * A frase do que aconteceu com a unidade, a partir do desfecho da trava.
 *
 * ⚠️ "NÃO VOLTOU" SEMPRE COM O PORQUÊ. Quem concluiu um cancelamento e vê o lote ocupado precisa
 * saber se é outro dono (e qual), um bloqueio do Apolo ou uma leitura que falhou: são três conversas
 * diferentes, com três pessoas diferentes.
 */
export function desfechoDaUnidade(d: DevolucaoDoCadastro): DesfechoDaUnidade {
  if (d.devolvida) return { frase: "a unidade voltou para a disponibilidade", voltou: true };
  switch (d.porque) {
    case "ja_disponivel":
      return { frase: "o cadastro da unidade já dizia disponível", voltou: true };
    case "outro_dono":
      return {
        frase: `a unidade NÃO voltou para a disponibilidade: o lote tem outro dono (${d.donos[0]?.descricao ?? "outro processo vivo"})`,
        voltou: false,
      };
    case "bloqueada":
      return {
        frase: "a unidade NÃO voltou para a disponibilidade: ela está bloqueada no cadastro",
        voltou: false,
      };
    case "cadastro":
      return {
        frase: `a unidade NÃO voltou para a disponibilidade: o cadastro dela está "${d.situacao ?? "sem situação"}"`,
        voltou: false,
      };
    default:
      return {
        frase:
          "a unidade NÃO voltou para a disponibilidade: não deu para conferir se o lote tem outro dono, e ela fica ocupada até alguém conferir",
        voltou: false,
      };
  }
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
  porta?: PortaDaClicksign,
): Promise<{ envelopeCancelado: null | string; ok: true } | FalhaNaConclusao> {
  const { data, error } = await sb
    .from("temis_envelopes")
    .select("criado_em, envelope_id, estado, falha, id, provedor")
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

  const vivo = envelopeQueSegura((data ?? []) as EnvelopeDaProposta[]);
  if (!vivo) return { envelopeCancelado: null, ok: true };

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
      return { envelopeCancelado: null, ok: true };
    case "distrato":
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

  const cancelamento = await cancelarEnvelope(vivo.envelope_id, porta);
  if (!cancelamento.ok) {
    return {
      erro: cancelamento.duvidoso
        ? `A Clicksign não respondeu ao cancelamento do envelope ${cancelamento.envelopeId}, e não dá para saber se ele chegou. A venda NÃO foi cancelada. Confira o envelope na Clicksign antes de concluir. (${cancelamento.erro})`
        : `A Clicksign recusou o cancelamento do envelope ${cancelamento.envelopeId}: ele continua valendo. A venda NÃO foi cancelada. Cancele o envelope na Clicksign antes de concluir. (${cancelamento.erro})`,
      ok: false,
      status: 502,
    };
  }

  await carimbarCancelamento(sb, vivo.id, cancelamento.envelopeId, "panteon:conclusao_do_cancelamento");
  return { envelopeCancelado: cancelamento.envelopeId, ok: true };
}

/**
 * O envelope do contrato que ainda corre na Clicksign quando o DISTRATO conclui: só a frase.
 *
 * ⚠️ `assinado` NÃO É AVISO: é o contrato que o distrato desfaz, e ele fica como está. Aviso é o
 * envelope que alguém ainda pode assinar (aguardando, parcial, rascunho, ou o envio sem desfecho).
 */
async function avisoDoEnvelopeNoDistrato(sb: SupabaseClient, propostaId: string): Promise<null | string> {
  const { data, error } = await sb
    .from("temis_envelopes")
    .select("criado_em, envelope_id, estado, falha, id, provedor")
    .eq("proposta_id", propostaId)
    .order("criado_em", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[hercules][concluir-cancelamento] falha ao ler os envelopes do distrato", error);
    return "Não deu para conferir se o contrato desta venda ainda corre na Clicksign: confira por lá.";
  }

  const vivo = envelopeQueSegura((data ?? []) as EnvelopeDaProposta[]);
  if (!vivo || vivo.estado === "assinado") return null;
  return `O contrato desta venda ainda corre na Clicksign (${vivo.envelope_id ?? `registro ${vivo.id}`}) e não foi mexido: cancele o envelope por lá se ele não servir mais.`;
}

function texto(valor: null | string | undefined): null | string {
  const t = String(valor ?? "").trim();
  return t || null;
}

function primeiraMaiuscula(frase: string): string {
  return frase ? frase.charAt(0).toUpperCase() + frase.slice(1) : frase;
}
