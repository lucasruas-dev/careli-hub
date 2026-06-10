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

  return (
    meeting.participants.find(
      (participant) =>
        (currentUser.id && participant.userId === currentUser.id) ||
        (email && participant.email?.trim().toLowerCase() === email),
    ) ?? null
  );
}

export function getChronosCurrentUserRsvpStatus(
  meeting: ChronosMeeting,
  currentUser?: ChronosCurrentUser | null,
): ChronosRsvpStatus {
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
