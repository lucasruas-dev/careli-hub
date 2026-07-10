import type { HubItTicket } from "./types";

// Helpers de hidratacao sob demanda do HelpDesk.
//
// A listagem (`details=list`) traz o ticket SEM eventos e anexos: os anexos sao
// data-URLs em base64 e um unico ticket pode carregar megabytes. O detalhe
// (`details=full&protocol=...`) e buscado so quando o ticket e aberto.
//
// Estes dois helpers mantem os detalhes ja carregados vivos quando a lista e
// recarregada, pra abrir um ticket duas vezes nao refazer o download.

export function mergeTicketListWithExistingDetails(
  nextTickets: HubItTicket[],
  currentTickets: HubItTicket[],
) {
  const currentByProtocol = new Map(
    currentTickets.map((ticket) => [ticket.protocol, ticket]),
  );

  return nextTickets.map((ticket) => {
    const currentTicket = currentByProtocol.get(ticket.protocol);

    if (
      currentTicket &&
      (currentTicket.attachments.length > 0 || currentTicket.events.length > 0)
    ) {
      return {
        ...ticket,
        attachments: currentTicket.attachments,
        events: currentTicket.events,
      };
    }

    return ticket;
  });
}

export function upsertTicketWithDetails(
  currentTickets: HubItTicket[],
  ticketDetail: HubItTicket,
) {
  if (
    !currentTickets.some((ticket) => ticket.protocol === ticketDetail.protocol)
  ) {
    return [ticketDetail, ...currentTickets];
  }

  return currentTickets.map((ticket) =>
    ticket.protocol === ticketDetail.protocol ? ticketDetail : ticket,
  );
}
