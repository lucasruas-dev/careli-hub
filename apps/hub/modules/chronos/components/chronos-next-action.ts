import { countOpenFollowUps } from "@/lib/chronos/calendar";
import type { ChronosMeeting } from "@/lib/chronos/types";
import type { BadgeVariant } from "@repo/uix";

export type ChronosNextAction = {
  badge: string;
  description: string;
  title: string;
  variant: BadgeVariant;
};

export function buildChronosNextAction(
  meeting: ChronosMeeting,
): ChronosNextAction {
  const openFollowUps = countOpenFollowUps(meeting);

  if (meeting.status === "scheduled") {
    return {
      badge: "agenda",
      description:
        "Confirmar sala, participantes, pauta e referencia externa antes de abrir a entrada.",
      title: "Preparar compromisso executivo",
      variant: "neutral",
    };
  }

  if (meeting.status === "lobby") {
    return {
      badge: "entrada",
      description:
        "Validar presenca dos participantes e iniciar a reuniao somente quando a sala estiver pronta.",
      title: "Controlar entrada da reuniao",
      variant: "info",
    };
  }

  if (meeting.status === "live") {
    return {
      badge: "ao vivo",
      description:
        "Manter gravacao, transcricao e marcos de timeline acompanhados durante a sessao.",
      title: "Conduzir registro formal",
      variant: "danger",
    };
  }

  if (!meeting.executiveSummary) {
    return {
      badge: "resumo",
      description:
        "Gerar ou registrar resumo executivo antes de submeter a ata para revisao humana.",
      title: "Criar resumo executivo",
      variant: "warning",
    };
  }

  if (
    meeting.minutesStatus === "not_started" ||
    meeting.minutesStatus === "draft"
  ) {
    return {
      badge: "ata",
      description:
        "Revisar o rascunho, ajustar decisoes e enviar a ata para revisao humana.",
      title: "Submeter ata para revisao",
      variant: "warning",
    };
  }

  if (meeting.minutesStatus === "in_review") {
    return {
      badge: "revisao",
      description:
        "Aprovar somente depois de leitura humana. O Chronos nao formaliza ata automaticamente.",
      title: "Aprovar ata revisada",
      variant: "warning",
    };
  }

  if (openFollowUps > 0) {
    return {
      badge: "follow-up",
      description: `Acompanhar ${openFollowUps} encaminhamento${
        openFollowUps === 1 ? "" : "s"
      } antes de encerrar a memoria executiva.`,
      title: "Acompanhar encaminhamentos",
      variant: "info",
    };
  }

  if (meeting.status !== "closed") {
    return {
      badge: "fechamento",
      description:
        "Ata aprovada e encaminhamentos resolvidos. A reuniao ja pode ser fechada formalmente.",
      title: "Fechar memoria executiva",
      variant: "success",
    };
  }

  return {
    badge: "formalizada",
    description:
      "Reuniao preservada como historico formal, com rastreabilidade e memoria executiva.",
    title: "Historico concluido",
    variant: "success",
  };
}
