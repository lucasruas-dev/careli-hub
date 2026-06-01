import type {
  PortfolioUnit,
  QueueClient,
} from "@/modules/guardian/attendance/types";

const EMPTY_THREAD_FIELD = "-";

export type MessageStatus = "enviada" | "entregue" | "lida";

export type MessageKind = "text" | "audio" | "document";

export type WhatsAppMessage = {
  id: string;
  author: "client" | "operator";
  body: string;
  date: string;
  duration?: string;
  fileName?: string;
  kind: MessageKind;
  operator?: string;
  status?: MessageStatus;
  ticketProtocol: string;
  time: string;
};

export type HadesWhatsAppTicketStatus =
  | "Pendente"
  | "Aguardando operador"
  | "Em atendimento"
  | "Aguardando cliente"
  | "Aguardando pagamento"
  | "Convertido em promessa"
  | "Convertido em acordo"
  | "Encerrado"
  | "Cancelado";

export type HadesWhatsAppTicketCycleInput = {
  openedAt?: string;
  profileName: string;
  protocol: string;
  status: HadesWhatsAppTicketStatus;
};

export type TicketCycle = {
  protocol: string;
  profileName: string;
  operator: string;
  openedAt: string;
  status: HadesWhatsAppTicketStatus;
  unitCode?: string;
  unitLabel?: string;
};

export type HadesConversationListItem = {
  id: string;
  name: string;
  preview: string;
  time: string;
};

export function buildMessages(client: QueueClient): WhatsAppMessage[] {
  const currentProtocol = EMPTY_THREAD_FIELD;

  return [
    {
      id: `${client.id}-msg-empty`,
      author: "operator",
      body: EMPTY_THREAD_FIELD,
      date: EMPTY_THREAD_FIELD,
      kind: "text",
      operator: client.responsavel,
      status: "entregue",
      ticketProtocol: currentProtocol,
      time: EMPTY_THREAD_FIELD,
    },
  ];
}

export function buildTicketCycles(
  client: QueueClient,
  currentTicket: HadesWhatsAppTicketCycleInput,
  selectedUnit?: PortfolioUnit
): TicketCycle[] {
  const fallbackUnit = selectedUnit ?? client.carteira.unidades[0];

  return [
    {
      protocol: currentTicket.protocol,
      profileName: currentTicket.profileName || EMPTY_THREAD_FIELD,
      operator: client.responsavel,
      openedAt: currentTicket.openedAt ?? EMPTY_THREAD_FIELD,
      status: currentTicket.status,
      unitCode: fallbackUnit?.matricula,
      unitLabel: fallbackUnit?.unidadeLote,
    },
  ];
}

export function buildConversationList(
  client: QueueClient
): HadesConversationListItem[] {
  return [
    { id: client.id, name: client.nome, preview: EMPTY_THREAD_FIELD, time: EMPTY_THREAD_FIELD },
  ];
}

export function firstName(name: string) {
  return name.split(" ")[0] ?? name;
}
