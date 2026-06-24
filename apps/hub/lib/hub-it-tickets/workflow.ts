import type { HubItTicket, HubItTicketStatus } from "./types";

// Fonte UNICA do workflow de chamados de TI.
//
// Os tickets tem 11 status no banco (ver `types.ts`), mas o fluxo operacional
// trabalha com poucas ETAPAS. Aqui mora o mapeamento status -> etapa, usado
// tanto no board do Zeus (TI) quanto no "Meus chamados" do time, pra os dois
// verem exatamente o MESMO workflow.

export type TicketWorkflowStage =
  | "backlog"
  | "finalizado"
  | "novo"
  | "revisao"
  | "tratativa"
  | "validacao";

export const ticketWorkflowStageLabels = {
  backlog: "Backlog",
  finalizado: "Finalizado",
  novo: "Novo",
  revisao: "Revisao",
  tratativa: "Em tratativa",
  validacao: "Validacao",
} as const satisfies Record<TicketWorkflowStage, string>;

// Ordem operacional do fluxo (esquerda -> direita).
export const ticketWorkflowStageOrder = [
  "backlog",
  "novo",
  "tratativa",
  "validacao",
  "revisao",
  "finalizado",
] as const satisfies readonly TicketWorkflowStage[];

export function getTicketWorkflowStageFromStatus(
  status: HubItTicketStatus,
): TicketWorkflowStage {
  if (status === "novo") {
    return "novo";
  }

  if (status === "aguardando_cliente" || status === "resolvido") {
    return "validacao";
  }

  if (status === "em_revisao") {
    return "revisao";
  }

  if (status === "fechado") {
    return "finalizado";
  }

  return "tratativa";
}

export function isTicketBacklog(ticket: HubItTicket): boolean {
  return ticket.roadmap?.active === true;
}

export function getTicketWorkflowStage(
  ticket: HubItTicket,
): TicketWorkflowStage {
  if (isTicketBacklog(ticket)) {
    return "backlog";
  }

  return getTicketWorkflowStageFromStatus(ticket.status);
}

export function countTicketsByWorkflowStage(
  tickets: HubItTicket[],
): Record<TicketWorkflowStage, number> {
  return tickets.reduce<Record<TicketWorkflowStage, number>>(
    (counts, ticket) => {
      counts[getTicketWorkflowStage(ticket)] += 1;
      return counts;
    },
    {
      backlog: 0,
      finalizado: 0,
      novo: 0,
      revisao: 0,
      tratativa: 0,
      validacao: 0,
    },
  );
}
