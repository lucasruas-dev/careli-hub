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
  durationLabel: string;
  durationSeconds: number | null;
  participants: ChronosMinutesParticipant[];
  scheduledStartAt: string | null;
  scheduledStartLabel: string;
};

export function buildChronosMinutesContext(
  meeting: ChronosMeeting,
): ChronosMinutesContext {
  const scheduledStartAt = meeting.startsAt ?? null;
  const actualEndAt = getChronosActualEndAt(meeting) ?? null;
  const durationSeconds = getChronosDurationSeconds({
    endsAt: actualEndAt,
    startsAt: scheduledStartAt,
  });
  const defaultActionDueAt = addBusinessDaysIso(
    actualEndAt ?? scheduledStartAt ?? meeting.createdAt,
    5,
  );

  return {
    actualEndAt,
    actualEndLabel: formatChronosDateTime(actualEndAt),
    defaultActionDueAt,
    defaultActionDueLabel: formatChronosDate(defaultActionDueAt),
    durationLabel: formatChronosDuration(durationSeconds),
    durationSeconds,
    participants: getChronosCheckedInParticipants(meeting),
    scheduledStartAt,
    scheduledStartLabel: formatChronosDateTime(scheduledStartAt),
  };
}

export function getChronosCheckedInParticipants(
  meeting: ChronosMeeting,
): ChronosMinutesParticipant[] {
  const participants = (
    Array.isArray(meeting.participants) ? meeting.participants : []
  ).filter(hasChronosCheckIn);
  const participantsByKey = new Map<string, ChronosMinutesParticipant>();

  for (const participant of participants) {
    const key = getParticipantDedupeKey(participant);
    const existingKey = findExistingParticipantDedupeKey(
      participantsByKey,
      participant,
    );

    participantsByKey.set(
      existingKey ?? key,
      mergeChronosMinutesParticipant(
        participantsByKey.get(existingKey ?? key),
        participant,
      ),
    );
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
  const recordings = Array.isArray(meeting.recordings) ? meeting.recordings : [];
  const participants = Array.isArray(meeting.participants)
    ? meeting.participants
    : [];
  const timeline = Array.isArray(meeting.timeline) ? meeting.timeline : [];

  if (explicitEnd) {
    return explicitEnd;
  }

  const candidates = [
    meeting.status === "closed" ? meeting.updatedAt : null,
    ...recordings.map((recording) => recording.stoppedAt),
    ...participants.map((participant) => participant.leftAt),
    ...timeline
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

export function getChronosDurationSeconds({
  endsAt,
  startsAt,
}: {
  endsAt?: string | null;
  startsAt?: string | null;
}) {
  if (!isValidDateString(startsAt) || !isValidDateString(endsAt)) {
    return null;
  }

  return Math.max(
    0,
    Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 1000),
  );
}

export function formatChronosDuration(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "Nao informado";
  }

  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}min`;
  }

  if (minutes > 0) {
    return `${minutes}min ${seconds.toString().padStart(2, "0")}s`;
  }

  return `${seconds}s`;
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

  return `name:${getParticipantNameKey(participant.displayName)}`;
}

function findExistingParticipantDedupeKey(
  participantsByKey: Map<string, ChronosMinutesParticipant>,
  participant: ChronosParticipant,
) {
  const emailKey = participant.email
    ? `email:${participant.email.trim().toLowerCase()}`
    : "";
  const userKey = participant.userId ? `user:${participant.userId}` : "";
  const nameKey = `name:${getParticipantNameKey(participant.displayName)}`;

  for (const key of [emailKey, userKey, nameKey]) {
    if (key && participantsByKey.has(key)) {
      return key;
    }
  }

  const participantNameKey = getParticipantNameKey(participant.displayName);

  for (const [key, existingParticipant] of participantsByKey) {
    const existingNameKey = getParticipantNameKey(existingParticipant.displayName);

    if (
      participantNameKey &&
      existingNameKey &&
      (participantNameKey === existingNameKey ||
        participantNameKey.startsWith(`${existingNameKey} `) ||
        existingNameKey.startsWith(`${participantNameKey} `))
    ) {
      return key;
    }
  }

  return null;
}

function mergeChronosMinutesParticipant(
  current: ChronosMinutesParticipant | undefined,
  incoming: ChronosParticipant,
): ChronosMinutesParticipant {
  if (!current) {
    return {
      displayName: incoming.displayName,
      email: incoming.email,
      id: incoming.id,
      joinedAt: incoming.joinedAt,
      leftAt: incoming.leftAt,
      organization: incoming.organization,
      role: incoming.role,
    };
  }

  return {
    ...current,
    displayName: chooseParticipantDisplayName(
      current.displayName,
      incoming.displayName,
    ),
    email: current.email ?? incoming.email,
    joinedAt: chooseEarliestDate(current.joinedAt, incoming.joinedAt),
    leftAt: chooseLatestDate(current.leftAt, incoming.leftAt),
    organization: current.organization ?? incoming.organization,
  };
}

function chooseParticipantDisplayName(current: string, incoming: string) {
  const currentIsAllCaps = current === current.toUpperCase();
  const incomingIsAllCaps = incoming === incoming.toUpperCase();

  if (currentIsAllCaps && !incomingIsAllCaps) {
    return incoming;
  }

  return current;
}

function chooseEarliestDate(left?: string | null, right?: string | null) {
  if (!isValidDateString(left)) {
    return isValidDateString(right) ? right : left;
  }

  if (!isValidDateString(right)) {
    return left;
  }

  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

function chooseLatestDate(left?: string | null, right?: string | null) {
  if (!isValidDateString(left)) {
    return isValidDateString(right) ? right : left;
  }

  if (!isValidDateString(right)) {
    return left;
  }

  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function getParticipantNameKey(value: string) {
  const words = normalizeSearchText(value)
    .split(/\s+/)
    .filter(Boolean);

  return words.length >= 2 ? words.slice(0, 2).join(" ") : words.join(" ");
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

function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}
