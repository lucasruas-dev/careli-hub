import type { ApoloEntity } from "@/lib/apolo/types";
import type {
  ChronosApoloInvitee,
  ChronosHubInvitee,
} from "@/lib/chronos/types";

export type ChronosInviteeSource = "external" | "internal";

export type ChronosAgendaInvitee = ChronosApoloInvitee & {
  operationalProfile?: string | null;
  role?: string | null;
  source: ChronosInviteeSource;
  userId?: string;
};

export function parseLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function mapApoloEntityToChronosInvitee(
  entity: ApoloEntity,
): ChronosApoloInvitee {
  const email = entity.contacts.find(
    (contact) => contact.type === "email" && contact.value.trim(),
  )?.value;
  const phone = entity.contacts.find(
    (contact) =>
      (contact.type === "whatsapp" || contact.type === "phone") &&
      contact.value.trim(),
  )?.value;

  return {
    displayName: entity.displayName,
    email,
    entityId: entity.id,
    organization: entity.relationships[0]?.label ?? entity.locationLabel,
    phone,
  };
}

export function hasChronosInviteeContact(invitee: ChronosApoloInvitee) {
  return Boolean(invitee.email || invitee.phone);
}

export function mapHubInviteeToAgendaInvitee(
  invitee: ChronosHubInvitee,
): ChronosAgendaInvitee {
  return {
    displayName: invitee.displayName,
    email: invitee.email,
    entityId: invitee.userId,
    operationalProfile: invitee.operationalProfile,
    organization: "Careli",
    role: invitee.role,
    source: "internal",
    userId: invitee.userId,
  };
}

export function mapAgendaInviteeToApoloInvitee(
  invitee: ChronosAgendaInvitee,
): ChronosApoloInvitee {
  return {
    displayName: invitee.displayName,
    email: invitee.email,
    entityId: invitee.entityId,
    organization: invitee.organization,
    phone: invitee.phone,
  };
}

export function mapAgendaInviteeToHubInvitee(
  invitee: ChronosAgendaInvitee,
): ChronosHubInvitee {
  return {
    displayName: invitee.displayName,
    email: invitee.email ?? "",
    operationalProfile: invitee.operationalProfile ?? null,
    role: invitee.role ?? null,
    userId: invitee.userId ?? invitee.entityId,
  };
}

export function getInviteeKey(invitee: ChronosAgendaInvitee) {
  return `${invitee.source}:${invitee.entityId}`;
}

export function parseParticipants(value: string) {
  return parseLines(value).map((line) => {
    const [displayName = "", email = "", organization = ""] = line
      .split("|")
      .map((part) => part.trim());

    return {
      displayName,
      email,
      organization,
      role: "participant" as const,
    };
  });
}
