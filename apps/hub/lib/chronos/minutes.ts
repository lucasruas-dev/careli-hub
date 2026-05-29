import type { ChronosMeeting, ChronosParticipant } from "./types";

const chronosMinutesTimeZone = "America/Sao_Paulo";

export type ChronosMinutesParticipant = Pick<
  ChronosParticipant,
  "displayName" | "email" | "id" | "joinedAt" | "leftAt" | "organization" | "role"
>;

export type ChronosMinutesContext = {
  actualEndAt: string | null;
  actualEndLabel: string;
  defaultActionDueAt: string | null;
  defaultActionDueLabel: string;
  participants: ChronosMinutesParticipant[];
  scheduledStartAt: string | null;
  scheduledStartLabel: string;
};

export function buildChronosMinutesContext(
  meeting: ChronosMeeting,
): ChronosMinutesContext {
  const scheduledStartAt = meeting.startsAt ?? null;
  const actualEndAt = getChronosActualEndAt(meeting) ?? null;
  const defaultActionDueAt = addBusinessDaysIso(
    actualEndAt ?? scheduledStartAt ?? meeting.createdAt,
    5,
  );

  return {
    actualEndAt,
    actualEndLabel: formatChronosDateTime(actualEndAt),
    defaultActionDueAt,
    defaultActionDueLabel: formatChronosDate(defaultActionDueAt),
    participants: getChronosCheckedInParticipants(meeting),
    scheduledStartAt,
    scheduledStartLabel: formatChronosDateTime(scheduledStartAt),
  };
}

export function getChronosCheckedInParticipants(
  meeting: ChronosMeeting,
): ChronosMinutesParticipant[] {
  const participants = meeting.participants.filter(hasChronosCheckIn);
  const participantsByKey = new Map<string, ChronosMinutesParticipant>();

  for (const participant of participants) {
    const key = getParticipantDedupeKey(participant);

    if (!participantsByKey.has(key)) {
      participantsByKey.set(key, {
        displayName: participant.displayName,
        email: participant.email,
        id: participant.id,
        joinedAt: participant.joinedAt,
        leftAt: participant.leftAt,
        organization: participant.organization,
        role: participant.role,
      });
    }
  }

  return Array.from(participantsByKey.values()).sort((left, right) =>
    (left.joinedAt ?? left.displayName).localeCompare(
      right.joinedAt ?? right.displayName,
      "pt-BR",
    ),
  );
}

export function getChronosActualEndAt(meeting: ChronosMeeting) {
  const metadata = meeting.metadata ?? {};
  const externalRoom = readRecord(metadata.externalRoom);
  const closure = readRecord(metadata.closure);
  const explicitEnd =
    readString(externalRoom.actualEndedAt) ?? readString(closure.closedAt);

  if (explicitEnd) {
    return explicitEnd;
  }

  const candidates = [
    ...meeting.recordings.map((recording) => recording.stoppedAt),
    ...meeting.participants.map((participant) => participant.leftAt),
    ...meeting.timeline
      .filter((event) => event.eventType === "left")
      .map((event) => event.eventAt),
  ].filter(isValidDateString);

  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort(
    (left, right) => new Date(right).getTime() - new Date(left).getTime(),
  )[0] ?? null;
}

export function formatChronosDateTime(value?: string | null) {
  if (!value || !isValidDateString(value)) {
    return "Nao informado";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: chronosMinutesTimeZone,
  }).format(new Date(value));
}

export function formatChronosDate(value?: string | null) {
  if (!value || !isValidDateString(value)) {
    return "Nao informado";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: chronosMinutesTimeZone,
  }).format(new Date(value));
}

function hasChronosCheckIn(participant: ChronosParticipant) {
  if (isValidDateString(participant.joinedAt)) {
    return true;
  }

  const normalizedStatus = normalizeSearchText(participant.attendanceStatus);

  return [
    "checked in",
    "checked-in",
    "checkin",
    "joined",
    "present",
    "presente",
  ].includes(normalizedStatus);
}

function addBusinessDaysIso(value: string | null, amount: number) {
  if (!value || !isValidDateString(value)) {
    return null;
  }

  const date = new Date(value);
  let remaining = amount;

  while (remaining > 0) {
    date.setDate(date.getDate() + 1);

    const day = date.getDay();

    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }

  return date.toISOString();
}

function getParticipantDedupeKey(participant: ChronosParticipant) {
  if (participant.email) {
    return `email:${participant.email.trim().toLowerCase()}`;
  }

  if (participant.userId) {
    return `user:${participant.userId}`;
  }

  return `name:${normalizeSearchText(participant.displayName)}`;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown) {
  return typeof value === "string" && isValidDateString(value) ? value : null;
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}
