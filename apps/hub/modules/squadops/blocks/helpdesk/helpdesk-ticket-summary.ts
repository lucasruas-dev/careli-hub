import type { HubItTicket } from "@/lib/hub-it-tickets/types";

export function countOpenItTickets(tickets: readonly HubItTicket[]) {
  return tickets.filter((ticket) => isOpenItTicket(ticket)).length;
}

export function countItTicketsWaitingForZeus(
  tickets: readonly HubItTicket[],
) {
  return tickets.filter((ticket) => isItTicketWaitingForZeus(ticket)).length;
}

function isOpenItTicket(ticket: HubItTicket) {
  return ticket.status !== "resolvido" && ticket.status !== "fechado";
}

function isItTicketWaitingForZeus(ticket: HubItTicket) {
  return ticket.status === "novo" || ticket.status === "em_revisao";
}
