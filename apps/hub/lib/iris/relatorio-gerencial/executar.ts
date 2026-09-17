import { getCacaSender, sendGmailMessage } from "@/lib/iris/gmail";
import { createIrisMetaAdminClient } from "@/lib/iris/meta-server";
import { publishHubNotification } from "@/lib/notifications/publish";

import { lerDadosDoRelatorio } from "./dados";
import { assuntoDoEmail, montarHtml, montarTexto } from "./html";
import { dataNaCasa, diaNaCasa, ehDiaUtil, janelaDoDia } from "./janela";
import { lerODia, selecionarConversas } from "./leitura";
import {
  desempenhoPorFila,
  falhasDeEntrega,
  movimentoPorHora,
  quemAtendeu,
  resumoDoBacklog,
  resumoDoDia,
  semRespostaAoFim,
} from "./metricas";

// O ENVIO DO RELATÓRIO — junta a apuração, o e-mail e o registro.
//
// Lucas (17/09/2026): *"todo dia útil, às 18h30, sai um relatório em HTML das filas (...) para
// nivea.careli@careli.adm.br, pela caixa da CACÁ"*.
//
// ⚠️ A FALHA NÃO PODE SER SILENCIOSA. Em 26/07/2026 o refresh token do Gmail expirou e 25
// imobiliárias ficaram sem receber, sem alarme nenhum. Aqui, envio que falha grava a linha com o
// motivo E publica um alerta no hub para quem cuida disso. Um relatório que para de chegar em
// silêncio é pior do que não existir.

/** ⚠️ CONSTANTE, PORQUE A LISTA VAI CRESCER — e mexer em lista não é mexer em regra. */
export const DESTINATARIOS = ["nivea.careli@careli.adm.br"] as const;

/** Quem é avisado quando o envio falha. Por e-mail, não: se o Gmail caiu, o alerta cai junto. */
const AVISAR_NA_FALHA = ["lucas.ruas@careli.adm.br"];

export type ResultadoDoEnvio = {
  dia: string;
  destinatarios: string[];
  erro?: string;
  gmailMessageId?: string;
  resumo: Record<string, unknown>;
  status: "enviado" | "falhou" | "sem_dados";
};

export async function executarRelatorioDeAtendimento(opcoes?: {
  /** `2026-09-17` para reprocessar um dia; sem isto, o dia de hoje no fuso da casa. */
  dia?: null | string;
  /** Monta e devolve o HTML sem enviar nem registrar — a conferência antes de ligar o cron. */
  ensaio?: boolean;
  origem?: "cron" | "manual";
}): Promise<ResultadoDoEnvio & { html: string }> {
  const dia = opcoes?.dia?.trim() || diaNaCasa(new Date());
  const janela = janelaDoDia(dia);
  const origem = opcoes?.origem ?? "cron";

  const dados = await lerDadosDoRelatorio(janela);

  const resumo = resumoDoDia(dados.tickets, dados.mensagens, janela);
  const conteudo = {
    backlog: resumoDoBacklog(dados.backlogDoAtendimento),
    falhas: falhasDeEntrega(dados.mensagens, janela),
    janela,
    movimento: movimentoPorHora(dados.mensagens, janela, (iso) =>
      Number(
        new Intl.DateTimeFormat("pt-BR", {
          hour: "2-digit",
          hour12: false,
          timeZone: "America/Sao_Paulo",
        }).format(new Date(iso)),
      ),
    ),
    pessoas: quemAtendeu(dados.mensagens, dados.nomePorUsuario, janela),
    porFila: desempenhoPorFila(dados.tickets, dados.mensagens, janela),
    resumo,
    semResposta: semRespostaAoFim(dados.mensagens, janela),
  };

  // ⚠️ A LEITURA É A ÚLTIMA COISA, E ELA NÃO DERRUBA O RELATÓRIO. Sem chave, com a API fora ou
  // com resposta fora do formato, o e-mail sai com os blocos medidos — que é o que a Nívea precisa
  // ter todo dia, chova ou não chova na Anthropic.
  let leitura = null;
  try {
    const conversas = selecionarConversas(dados.tickets, dados.mensagens, janela);
    leitura = await lerODia(conversas, {
      abertos: resumo.abertos,
      fechados: resumo.fechados,
      mediana: resumo.medianaMinutos,
    });
  } catch (erro) {
    console.error("[iris][relatorio] a leitura do dia falhou; segue sem ela", erro);
  }

  const html = montarHtml({ ...conteudo, leitura });
  const numeros: Record<string, unknown> = {
    abertos: resumo.abertos,
    backlogDeCliente: conteudo.backlog.cliente,
    fechados: resumo.fechados,
    medianaMinutos: resumo.medianaMinutos,
    mensagens: resumo.mensagensEntrada + resumo.mensagensSaida,
    // Quantos itens a leitura publicou e quantos ela descartou por não bater com conversa nenhuma.
    leitura: leitura
      ? {
          acoes: leitura.acoes.length,
          descartados: leitura.descartados,
          insatisfeitos: leitura.insatisfeitos.length,
          modelo: leitura.modelo,
          negativos: leitura.negativos.length,
          positivos: leitura.positivos.length,
        }
      : null,
    pessoas: conteudo.pessoas.length,
    recadosRecebidos: resumo.recadosRecebidos,
    recadosRespondidos: resumo.recadosRespondidos,
  };

  if (opcoes?.ensaio) {
    return { dia, destinatarios: [...DESTINATARIOS], html, resumo: numeros, status: "sem_dados" };
  }

  // ⚠️ DIA SEM MOVIMENTO NÃO VIRA E-MAIL. Feriado e fim de semana existem, e um relatório zerado
  // todo dia ensina a ignorar o relatório.
  if (resumo.mensagensEntrada + resumo.mensagensSaida === 0) {
    await registrar({
      destinatarios: [],
      dia,
      janela,
      origem,
      resumo: numeros,
      status: "sem_dados",
    });
    return { dia, destinatarios: [], html, resumo: numeros, status: "sem_dados" };
  }

  try {
    const enviado = await sendGmailMessage({
      bodyHtml: html,
      bodyText: montarTexto({ ...conteudo, leitura }),
      from: getCacaSender(),
      subjectLine: assuntoDoEmail(janela),
      to: DESTINATARIOS.join(", "),
    });

    await registrar({
      destinatarios: [...DESTINATARIOS],
      dia,
      gmailMessageId: enviado.id,
      janela,
      origem,
      resumo: numeros,
      status: "enviado",
    });

    return {
      dia,
      destinatarios: [...DESTINATARIOS],
      gmailMessageId: enviado.id,
      html,
      resumo: numeros,
      status: "enviado",
    };
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : "Falha desconhecida no envio.";
    await registrar({
      destinatarios: [...DESTINATARIOS],
      dia,
      erro: motivo,
      janela,
      origem,
      resumo: numeros,
      status: "falhou",
    });
    await alertar(dia, motivo);
    return {
      dia,
      destinatarios: [...DESTINATARIOS],
      erro: motivo,
      html,
      resumo: numeros,
      status: "falhou",
    };
  }
}

async function registrar(linha: {
  destinatarios: string[];
  dia: string;
  erro?: string;
  gmailMessageId?: string;
  janela: { fim: Date; inicio: Date };
  origem: string;
  resumo: Record<string, unknown>;
  status: string;
}): Promise<void> {
  const client = createIrisMetaAdminClient();
  if (!client) return;

  const { error } = await client.from("iris_relatorio_execucoes").insert({
    destinatarios: linha.destinatarios,
    dia: linha.dia,
    erro: linha.erro ?? null,
    gmail_message_id: linha.gmailMessageId ?? null,
    janela_fim: linha.janela.fim.toISOString(),
    janela_inicio: linha.janela.inicio.toISOString(),
    origem: linha.origem,
    resumo: linha.resumo,
    status: linha.status,
  });

  // ⚠️ O REGISTRO NÃO DERRUBA O ENVIO. Se a tabela sumir, o e-mail ainda tem de sair; o que não
  // pode é a falha do log passar despercebida no console.
  if (error) console.error("[iris][relatorio] falha ao registrar a execução", error.message);
}

/** O alerta dentro do hub: quem cuida do relatório vê que ele não saiu, sem depender do e-mail. */
async function alertar(dia: string, motivo: string): Promise<void> {
  try {
    const client = createIrisMetaAdminClient();
    if (!client) return;

    const { data } = await client.from("hub_users").select("id,email").in("email", AVISAR_NA_FALHA);
    const ids = ((data ?? []) as Array<{ id: string }>).map((u) => u.id);
    if (ids.length === 0) return;

    await publishHubNotification(
      {
        body: `${motivo}. A caixa da CACÁ pode estar sem autenticação: confira o refresh token do Gmail.`,
        kind: "alerta",
        moduleId: "iris",
        recipientUserIds: ids,
        severity: "danger",
        title: `O relatório de atendimento de ${dataNaCasa(dia)} não foi enviado`,
      },
      client,
    );
  } catch (erro) {
    console.error("[iris][relatorio] falha ao alertar sobre o envio", erro);
  }
}

export { ehDiaUtil };
