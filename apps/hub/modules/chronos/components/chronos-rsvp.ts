import type { ChronosMeeting, ChronosParticipant } from "@/lib/chronos/types";

export type ChronosRsvpStatus = "accepted" | "declined" | "pending" | "tentative";

export type ChronosCurrentUser = {
  email?: string | null;
  id?: string | null;
};

export const chronosRsvpLabels = {
  accepted: "Aceito",
  declined: "Recusado",
  pending: "Pendente",
  tentative: "Talvez",
} as const satisfies Record<ChronosRsvpStatus, string>;

export function getChronosParticipantRsvpStatus(
  participant: ChronosParticipant,
): ChronosRsvpStatus {
  const metadata = participant.metadata ?? {};
  const metadataStatus = normalizeRsvpValue(
    metadata.googleResponseStatus ?? metadata.chronosResponseStatus,
  );

  if (metadataStatus) {
    return metadataStatus;
  }

  const attendanceStatus = participant.attendanceStatus.trim().toLowerCase();

  if (["accepted", "confirmed", "joined", "present"].includes(attendanceStatus)) {
    return "accepted";
  }

  if (["declined", "refused", "rejected"].includes(attendanceStatus)) {
    return "declined";
  }

  if (["tentative", "maybe"].includes(attendanceStatus)) {
    return "tentative";
  }

  return "pending";
}

export function getChronosCurrentUserParticipant(
  meeting: ChronosMeeting,
  currentUser?: ChronosCurrentUser | null,
) {
  if (!currentUser?.id && !currentUser?.email) {
    return null;
  }

  const email = currentUser.email?.trim().toLowerCase();
  const matches = meeting.participants.filter(
    (participant) =>
      (currentUser.id && participant.userId === currentUser.id) ||
      (email && participant.email?.trim().toLowerCase() === email),
  );

  // Se o usuario aparece tanto como host quanto como convidado (duplicidade no
  // cadastro), o papel de host prevalece: o organizador nao confirma presenca
  // no proprio evento.
  return (
    matches.find((participant) => participant.role === "host") ??
    matches[0] ??
    null
  );
}

export function getChronosCurrentUserRsvpStatus(
  meeting: ChronosMeeting,
  currentUser?: ChronosCurrentUser | null,
): ChronosRsvpStatus {
  // O organizador (host_user_id do evento) nunca confirma presenca no proprio
  // evento. Checamos direto o host_user_id porque o sync pode reescrever os
  // participantes e rebaixar o criador para "participant" pendente.
  if (
    currentUser?.id &&
    meeting.hostUserId &&
    currentUser.id === meeting.hostUserId
  ) {
    return "accepted";
  }

  const participant = getChronosCurrentUserParticipant(meeting, currentUser);

  if (!participant || participant.role === "host") {
    return "accepted";
  }

  return getChronosParticipantRsvpStatus(participant);
}

function normalizeRsvpValue(value: unknown): ChronosRsvpStatus | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (["accepted", "confirmed", "yes"].includes(normalized)) {
    return "accepted";
  }

  if (["declined", "no"].includes(normalized)) {
    return "declined";
  }

  if (["tentative", "maybe"].includes(normalized)) {
    return "tentative";
  }

  if (["needsaction", "needs_action", "pending", "invited"].includes(normalized)) {
    return "pending";
  }

  return null;
}
