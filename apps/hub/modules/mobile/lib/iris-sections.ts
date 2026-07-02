import type { IrisStatus, IrisTicket } from "@/modules/caredesk/types/iris-types";

// Agrupamento da fila do Iris por SEÇÃO (status), para a lista mobile. Espelha o
// statusColumnKey do board do desktop (iris-board-kanban), com a seção extra
// "Sem resposta" (a métrica isWaitingForIris do board) no topo — pedido do Lucas.
//
// NOTA (Onda 1): a deteccao de "Com a Cacá" aqui é uma APROXIMAÇÃO — o isCacaOwned
// real (IrisPage) puxa metadata/automação (handoffRequired, origem de contato ativo)
// que não é exportada. Aqui usamos só o dono do ticket. Refinar na Onda 2.

export type IrisSectionKey =
  | "aguardando"
  | "caca"
  | "erro"
  | "pendente"
  | "resolvido"
  | "sem_resposta";

export type IrisSection = {
  accent: string;
  key: IrisSectionKey;
  label: string;
  tickets: IrisTicket[];
};

const SECTION_ORDER: readonly { accent: string; key: IrisSectionKey; label: string }[] = [
  { accent: "#c0392b", key: "erro", label: "Erro de envio" },
  { accent: "#A07C3B", key: "sem_resposta", label: "Sem resposta" },
  { accent: "#1d9e75", key: "caca", label: "Com a Cacá" },
  { accent: "#ba7517", key: "pendente", label: "Pendente" },
  { accent: "#0f6e56", key: "aguardando", label: "Aguardando cliente" },
  { accent: "#64748b", key: "resolvido", label: "Resolvido hoje" },
];

const CLOSED_STATUSES: readonly IrisStatus[] = ["cancelled", "closed", "resolved"];

function isClosedTicket(ticket: IrisTicket): boolean {
  return CLOSED_STATUSES.includes(ticket.status);
}

function timeOf(value?: string | null): number {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function hasCareliResponse(ticket: IrisTicket): boolean {
  if (ticket.firstRespondedAt) {
    return true;
  }

  return ticket.messages.some(
    (message) =>
      message.direction === "outbound" ||
      message.senderType === "operator" ||
      message.senderType === "agent",
  );
}

// Espelha effectiveIrisStatus: um "new" sem resposta da Careli há +3min vira "pending".
function effectiveStatus(ticket: IrisTicket): IrisStatus {
  if (ticket.status === "new" && !hasCareliResponse(ticket)) {
    const openedAt = timeOf(ticket.openedAt);

    if (openedAt && Date.now() - openedAt >= 3 * 60 * 1000) {
      return "pending";
    }
  }

  return ticket.status;
}

function isClosedToday(ticket: IrisTicket): boolean {
  if (!isClosedTicket(ticket)) {
    return false;
  }

  const today = new Date().toDateString();
  return (
    new Date(ticket.lastMessageAt ?? ticket.openedAt).toDateString() === today
  );
}

function isWaitingForIris(ticket: IrisTicket): boolean {
  const status = effectiveStatus(ticket);

  return (
    !isClosedTicket(ticket) &&
    (ticket.unread ||
      status === "new" ||
      status === "pending" ||
      status === "waiting_operator")
  );
}

function normalizeOwner(value?: string | null): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function isCacaOwned(ticket: IrisTicket): boolean {
  if (isClosedTicket(ticket)) {
    return false;
  }

  const owner = normalizeOwner(ticket.assignedToLabel);
  return owner === "" || owner === "caca";
}

function sectionKeyFor(ticket: IrisTicket): IrisSectionKey | null {
  if (isClosedToday(ticket)) {
    return "resolvido";
  }

  // Encerrados de dias anteriores saem da fila operacional.
  if (isClosedTicket(ticket)) {
    return null;
  }

  if (ticket.hasDeliveryError) {
    return "erro";
  }

  if (isWaitingForIris(ticket)) {
    return "sem_resposta";
  }

  if (isCacaOwned(ticket)) {
    return "caca";
  }

  if (effectiveStatus(ticket) === "waiting_customer") {
    return "aguardando";
  }

  return "pendente";
}

/**
 * Se a conversa está ESPERANDO a gente (última mensagem não-interna foi do
 * cliente e o ticket não está fechado), retorna o instante dessa mensagem —
 * base do cronômetro "sem resposta". Senão, null.
 */
export function getIrisWaitingSince(ticket: IrisTicket): string | null {
  if (isClosedTicket(ticket)) {
    return null;
  }

  const conversation = [...ticket.messages]
    .filter((message) => message.direction !== "internal")
    .sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt));

  const last = conversation[conversation.length - 1];

  if (!last || last.direction !== "inbound") {
    return null;
  }

  return last.createdAt ?? ticket.lastMessageAt ?? null;
}

export function groupIrisTicketsBySection(
  tickets: readonly IrisTicket[],
): IrisSection[] {
  const buckets = new Map<IrisSectionKey, IrisTicket[]>();

  for (const ticket of tickets) {
    const key = sectionKeyFor(ticket);

    if (!key) {
      continue;
    }

    const bucket = buckets.get(key);

    if (bucket) {
      bucket.push(ticket);
    } else {
      buckets.set(key, [ticket]);
    }
  }

  const byRecent = (a: IrisTicket, b: IrisTicket) =>
    timeOf(b.lastMessageAt ?? b.openedAt) - timeOf(a.lastMessageAt ?? a.openedAt);

  return SECTION_ORDER.map((section) => ({
    ...section,
    tickets: (buckets.get(section.key) ?? []).sort(byRecent),
  })).filter((section) => section.tickets.length > 0);
}
