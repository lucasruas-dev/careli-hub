import {
  getChronosMeetingLocationLabel,
  getChronosMeetingProfileLabel,
  getChronosMeetingRoomPath,
} from "@/lib/chronos/calendar";
import { formatChronosDateTime } from "@/lib/chronos/format";
import {
  type ChronosMeeting,
  type ChronosParticipant,
  type ChronosUpdateInput,
} from "@/lib/chronos/types";
import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Copy,
  FileText,
  HelpCircle,
  ListChecks,
  MapPin,
  MessageCircle,
  Pencil,
  Send,
  Trash2,
  UsersRound,
  Video,
  X,
  XCircle,
} from "lucide-react";
import Image from "next/image";
import { useState, type ReactNode } from "react";
import {
  chronosRsvpLabels,
  getChronosCurrentUserParticipant,
  getChronosParticipantRsvpStatus,
  type ChronosCurrentUser,
  type ChronosRsvpStatus,
} from "./chronos-rsvp";

type ChronosCalendarEventDetailsPopupProps = {
  currentUser?: ChronosCurrentUser | null;
  meeting: ChronosMeeting;
  onClose: () => void;
  onDelete: (meetingId: string) => Promise<void>;
  onEdit: (meetingId: string) => void;
  onUpdateParticipantResponse: (
    input: Extract<ChronosUpdateInput, { action: "update_participant_response" }>,
  ) => Promise<void>;
  saving: boolean;
};

export function ChronosCalendarEventDetailsPopup({
  currentUser,
  meeting,
  onClose,
  onDelete,
  onEdit,
  onUpdateParticipantResponse,
  saving,
}: ChronosCalendarEventDetailsPopupProps) {
  const [copied, setCopied] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [guestsExpanded, setGuestsExpanded] = useState(true);
  const roomPath = getChronosMeetingRoomPath(meeting);
  const roomUrl =
    roomPath && typeof window !== "undefined"
      ? new URL(roomPath, window.location.origin).toString()
      : roomPath;
  const meetingProfile = getChronosMeetingProfileLabel(meeting);
  const participants = getChronosDisplayParticipants(meeting);
  const currentUserParticipant = getChronosCurrentUserParticipant(
    meeting,
    currentUser,
  );
  const isEventHost = Boolean(
    currentUser?.id && meeting.hostUserId === currentUser.id,
  );
  const canAnswerRsvp = Boolean(
    !isEventHost &&
      currentUserParticipant &&
      currentUserParticipant.role !== "host",
  );
  const currentUserRsvp = currentUserParticipant
    ? getChronosParticipantRsvpStatus(currentUserParticipant)
    : "pending";
  const agendaItems = parseChronosAgendaPreview(meeting);
  const inviteText = buildChronosWhatsAppInviteText({
    agendaItems,
    meeting,
    meetingProfile,
    roomUrl,
  });
  const whatsAppShareUrl = `https://wa.me/?text=${encodeURIComponent(inviteText)}`;

  async function copyRoomLink() {
    if (!roomUrl) {
      return;
    }

    await navigator.clipboard.writeText(roomUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function copyInviteText() {
    await navigator.clipboard.writeText(inviteText);
    setInviteCopied(true);
    window.setTimeout(() => setInviteCopied(false), 1800);
  }

  async function requestDelete() {
    if (!window.confirm(`Excluir "${meeting.title}" da agenda Chronos?`)) {
      return;
    }

    await onDelete(meeting.id);
  }

  async function answerRsvp(responseStatus: Extract<
    ChronosUpdateInput,
    { action: "update_participant_response" }
  >["responseStatus"]) {
    await onUpdateParticipantResponse({
      action: "update_participant_response",
      meetingId: meeting.id,
      responseStatus,
    });
  }

  return (
    <section
      aria-label="Detalhes do evento Chronos"
      className="relative z-10 grid max-h-[calc(100vh-7rem)] w-[min(34rem,calc(100vw-2rem))] max-w-full gap-4 overflow-y-auto overflow-x-hidden rounded-lg border border-[#d9e0e7] bg-white p-4 shadow-[0_22px_70px_rgb(16_24_32_/_0.22)]"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-xl font-semibold leading-6 text-[#101820]">
            {meeting.title}
          </h2>
          <p className="m-0 mt-1 break-words text-sm font-medium text-[#667085]">
            {formatChronosEventDateRange(meeting.startsAt, meeting.endsAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            aria-label="Criar convite para WhatsApp"
            className="grid h-8 w-8 place-items-center rounded-md text-[#526078] transition hover:bg-[#f5f7fa] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            onClick={() => setInviteOpen(true)}
            type="button"
          >
            <MessageCircle aria-hidden="true" size={16} />
          </button>
          <button
            aria-label="Editar evento"
            className="grid h-8 w-8 place-items-center rounded-md text-[#526078] transition hover:bg-[#f5f7fa] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            onClick={() => onEdit(meeting.id)}
            type="button"
          >
            <Pencil aria-hidden="true" size={16} />
          </button>
          <button
            aria-label="Excluir evento"
            className="grid h-8 w-8 place-items-center rounded-md text-red-600 transition hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-200 disabled:cursor-wait disabled:opacity-55"
            disabled={saving}
            onClick={() => void requestDelete()}
            type="button"
          >
            <Trash2 aria-hidden="true" size={16} />
          </button>
          <button
            aria-label="Fechar detalhes"
            className="grid h-8 w-8 place-items-center rounded-md text-[#667085] transition hover:bg-[#f5f7fa] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={17} />
          </button>
        </div>
      </div>

      <div className="grid gap-3">
        <DetailIconRow icon={<CalendarClock aria-hidden="true" size={17} />}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-[#101820]">{meetingProfile}</span>
            <span className="rounded-full border border-[#d9e0e7] bg-[#f8fafc] px-2 py-0.5 text-xs font-bold text-[#526078]">
              {meeting.protocol}
            </span>
          </div>
        </DetailIconRow>

        <DetailIconRow icon={<MapPin aria-hidden="true" size={17} />}>
          <div className="grid gap-1 text-sm">
            <span className="font-semibold text-[#101820]">
              {getChronosMeetingLocationLabel(meeting)}
            </span>
            <span className="text-[#667085]">
              {meeting.hostName ?? "Host Chronos"}
            </span>
          </div>
        </DetailIconRow>
      </div>

      {roomUrl ? (
        <DetailIconRow icon={<Video aria-hidden="true" size={17} />}>
          <div className="grid gap-2">
            <div className="flex min-w-0 items-center gap-2 overflow-hidden">
              <code className="min-w-0 flex-1 truncate rounded-md bg-[#f5f7fa] px-2 py-2 text-xs font-semibold text-[#344054]">
                {roomUrl}
              </code>
              <button
                aria-label="Copiar link da sala"
                className="grid h-9 w-9 place-items-center rounded-md border border-[#d9e0e7] text-[#526078] transition hover:bg-[#f8fafc] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={() => void copyRoomLink()}
                type="button"
              >
                <ClipboardCheck aria-hidden="true" size={16} />
              </button>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs font-semibold text-[#667085]">
                {copied ? "Link copiado." : "Disponivel para convidados externos."}
              </span>
              <a
                className="inline-flex h-8 items-center justify-center rounded-md bg-[#101820] px-3 text-xs font-semibold text-white transition hover:bg-[#1f2937]"
                href={roomPath ?? "#"}
                rel="noreferrer"
                target="_blank"
              >
                Abrir sala
              </a>
            </div>
          </div>
        </DetailIconRow>
      ) : null}

      {meeting.objective ? (
        <DetailIconRow icon={<FileText aria-hidden="true" size={17} />}>
          <p className="m-0 whitespace-pre-wrap text-sm leading-5 text-[#344054]">
            {meeting.objective}
          </p>
        </DetailIconRow>
      ) : null}

      {agendaItems.length > 0 ? (
        <DetailIconRow icon={<ListChecks aria-hidden="true" size={17} />}>
          <div className="grid gap-2">
            <p className="m-0 text-xs font-bold uppercase text-[#667085]">
              Pauta
            </p>
            <div className="max-h-[22rem] overflow-y-auto overflow-x-hidden rounded-md border border-[#edf0f4] bg-[#fbfcfd] px-3 py-3 pr-2">
              <ChronosAgendaPreview items={agendaItems} />
            </div>
          </div>
        </DetailIconRow>
      ) : null}

      {canAnswerRsvp ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#d9e0e7] bg-[#fafbfc] p-3">
          <span className="text-sm font-semibold text-[#101820]">
            Vai participar?
          </span>
          <div className="flex items-center gap-1">
            {(
              [
                { icon: Check, label: "Sim", status: "accepted" },
                { icon: XCircle, label: "Nao", status: "declined" },
                { icon: HelpCircle, label: "Talvez", status: "tentative" },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = currentUserRsvp === item.status;

              return (
                <button
                  aria-pressed={active}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-wait disabled:opacity-55 ${
                    active
                      ? "border-[#101820] bg-[#101820] text-white"
                      : "border-[#d9e0e7] bg-white text-[#526078] hover:bg-[#f8fafc] hover:text-[#101820]"
                  }`}
                  disabled={saving}
                  key={item.status}
                  onClick={() => void answerRsvp(item.status)}
                  type="button"
                >
                  <Icon aria-hidden="true" size={14} />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <DetailIconRow icon={<UsersRound aria-hidden="true" size={17} />}>
      <div className="grid gap-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <p className="m-0 min-w-0 text-xs font-bold uppercase text-[#667085]">
            Convidados ({participants.length})
          </p>
          {participants.length > 0 ? (
            <button
              aria-expanded={guestsExpanded}
              aria-label={
                guestsExpanded ? "Ocultar convidados" : "Expandir convidados"
              }
              className="grid h-8 w-8 place-items-center rounded-md border border-[#d9e0e7] text-[#526078] transition hover:bg-[#f8fafc] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onClick={() => setGuestsExpanded((current) => !current)}
              type="button"
            >
              {guestsExpanded ? (
                <ChevronUp aria-hidden="true" size={16} />
              ) : (
                <ChevronDown aria-hidden="true" size={16} />
              )}
            </button>
          ) : null}
        </div>
        {participants.length > 0 && guestsExpanded ? (
          <div className="grid max-h-48 gap-1 overflow-y-auto overflow-x-hidden pr-1">
            {participants.map((participant) => (
              <div
                className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-[#f8fafc]"
                key={participant.id}
              >
                <span
                  aria-hidden="true"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#eaf3ff] text-xs font-bold uppercase text-[#0b66d8]"
                >
                  {getParticipantInitials(participant.displayName)}
                </span>
                <span className="min-w-0 truncate text-sm font-medium text-[#344054]">
                  {getParticipantDisplayName(participant.displayName)}
                </span>
                <RsvpBadge status={getChronosParticipantRsvpStatus(participant)} />
              </div>
            ))}
          </div>
        ) : null}
        {participants.length === 0 ? (
          <span className="rounded-md border border-dashed border-[#d9e0e7] bg-[#fafbfc] p-3 text-sm text-[#667085]">
            Nenhum convidado adicional registrado.
          </span>
        ) : null}
      </div>
      </DetailIconRow>

      {inviteOpen ? (
        <div
          aria-label="Convite Chronos para WhatsApp"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-[#101820]/55 px-4 py-6"
          onClick={() => setInviteOpen(false)}
          role="dialog"
        >
          <div
            className="grid max-h-[calc(100vh-3rem)] w-[min(38rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-[#d9e0e7] bg-white shadow-[0_28px_90px_rgb(16_24_32_/_0.28)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-[#edf0f4] px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-[#101820]">
                  <Image
                    alt="Careli"
                    className="h-10 w-10 object-contain"
                    height={40}
                    src="/careli-invite-logo.png"
                    width={40}
                  />
                </span>
                <div className="min-w-0">
                  <p className="m-0 text-xs font-bold uppercase text-[#A07C3B]">
                    Careli
                  </p>
                  <h3 className="m-0 truncate text-lg font-semibold text-[#101820]">
                    Convite da reuniao
                  </h3>
                </div>
              </div>
              <button
                aria-label="Fechar convite"
                className="grid h-8 w-8 place-items-center rounded-md text-[#667085] transition hover:bg-[#f5f7fa] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={() => setInviteOpen(false)}
                type="button"
              >
                <X aria-hidden="true" size={17} />
              </button>
            </div>

            <div className="grid gap-4 overflow-y-auto px-5 py-4">
              <div className="rounded-md border border-[#d9e0e7] bg-[#fbfcfd] p-4">
                <p className="m-0 text-sm font-semibold text-[#101820]">
                  O time da Careli convida voce para uma reuniao de{" "}
                  <span className="text-[#A07C3B]">{meetingProfile}</span>.
                </p>
                <p className="m-0 mt-2 text-sm leading-5 text-[#526078]">
                  Abaixo seguem os detalhes para participar.
                </p>
              </div>

              <div className="grid gap-3 rounded-md border border-[#edf0f4] p-4">
                <InviteDetail label="Assunto" value={meeting.title} />
                <InviteDetail label="Host" value={meeting.hostName ?? "Host Chronos"} />
                <InviteDetail
                  label="Data e hora"
                  value={formatChronosEventDateRange(meeting.startsAt, meeting.endsAt)}
                />
                <InviteDetail
                  label="Sala"
                  value={getChronosMeetingLocationLabel(meeting)}
                />
                {roomUrl ? (
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="text-xs font-bold uppercase text-[#667085]">
                      Sala online
                    </span>
                    <a
                      className="inline-flex h-9 items-center justify-center rounded-md bg-[#101820] px-3 text-xs font-semibold text-white transition hover:bg-[#1f2937]"
                      href={roomUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Entrar
                    </a>
                  </div>
                ) : null}
              </div>

              {agendaItems.length > 0 ? (
                <div className="grid gap-2 rounded-md border border-[#edf0f4] bg-[#fbfcfd] p-4">
                  <p className="m-0 text-xs font-bold uppercase text-[#667085]">
                    Pauta
                  </p>
                  <div className="max-h-56 overflow-y-auto pr-2">
                    <ChronosAgendaPreview items={agendaItems} />
                  </div>
                </div>
              ) : null}

              <label className="grid gap-2">
                <span className="text-xs font-bold uppercase text-[#667085]">
                  Texto para WhatsApp
                </span>
                <textarea
                  className="min-h-56 resize-y rounded-md border border-[#d9e0e7] bg-white p-3 text-sm leading-5 text-[#344054] outline-none focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
                  readOnly
                  value={inviteText}
                />
              </label>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-[#edf0f4] px-5 py-4">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#526078] transition hover:bg-[#f8fafc] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={() => void copyInviteText()}
                type="button"
              >
                <Copy aria-hidden="true" size={16} />
                {inviteCopied ? "Copiado" : "Copiar"}
              </button>
              <a
                className="inline-flex h-9 items-center gap-2 rounded-md bg-[#101820] px-3 text-sm font-semibold text-white transition hover:bg-[#1f2937] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                href={whatsAppShareUrl}
                rel="noreferrer"
                target="_blank"
              >
                <Send aria-hidden="true" size={16} />
                WhatsApp
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatChronosEventDateRange(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
) {
  const startDate = startsAt ? new Date(startsAt) : null;
  const weekDay =
    startDate && !Number.isNaN(startDate.getTime())
      ? new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(startDate)
      : null;
  const startLabel = formatChronosDateTime(startsAt);
  const endLabel = endsAt ? formatChronosDateTime(endsAt) : null;
  const dateLabel = endLabel ? `${startLabel} - ${endLabel}` : startLabel;

  return weekDay ? `${capitalizeFirst(weekDay)}, ${dateLabel}` : dateLabel;
}

function capitalizeFirst(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildChronosWhatsAppInviteText({
  agendaItems,
  meeting,
  meetingProfile,
  roomUrl,
}: {
  agendaItems: ChronosAgendaPreviewItem[];
  meeting: ChronosMeeting;
  meetingProfile: string;
  roomUrl: string | null;
}) {
  const agendaLines = agendaItems
    .map((item) => formatAgendaInviteLine(item))
    .filter(Boolean);
  const lines = [
    "*Careli | Convite de reunião*",
    "",
    `O time da Careli convida você para uma reunião de ${meetingProfile}.`,
    "",
    "*Detalhes*",
    `• *Assunto:* ${meeting.title}`,
    `• *Tipo:* ${meetingProfile}`,
    `• *Host:* ${meeting.hostName ?? "Host Chronos"}`,
    `• *Data e hora:* ${formatChronosEventDateRange(meeting.startsAt, meeting.endsAt)}`,
    `• *Sala:* ${getChronosMeetingLocationLabel(meeting)}`,
    roomUrl ? `• *Link da sala:* ${roomUrl}` : null,
    "",
    agendaLines.length ? "*Pauta*" : null,
    ...agendaLines,
    "",
    "Até lá,",
    "Time Careli",
  ].filter((line): line is string => typeof line === "string");

  return lines.join("\n");
}

function formatAgendaInviteLine(item: ChronosAgendaPreviewItem) {
  const text = stripWhatsAppMarkdown(item.text);

  if (item.type === "heading") {
    return `*${text}*`;
  }

  if (item.type === "subheading") {
    return `*${text.toUpperCase()}*`;
  }

  if (item.type === "bullet") {
    return `• ${text}`;
  }

  return text;
}

function stripWhatsAppMarkdown(value: string) {
  return value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

function getParticipantDisplayName(displayName: string) {
  if (!displayName.includes("@")) {
    return displayName;
  }

  const localPart = displayName.split("@")[0] ?? displayName;

  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getParticipantInitials(displayName: string) {
  const displayParts = getParticipantDisplayName(displayName).split(/\s+/);
  const initials = displayParts
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("");

  return initials || "?";
}

function getChronosDisplayParticipants(meeting: ChronosMeeting): ChronosParticipant[] {
  const persistedParticipants = meeting.participants.filter(
    (participant) =>
      participant.role !== "host" &&
      !(
        meeting.hostUserId !== null &&
        meeting.hostUserId !== undefined &&
        participant.userId === meeting.hostUserId
      ),
  );

  if (persistedParticipants.length > 0) {
    return persistedParticipants;
  }

  return getChronosInviteesFromMetadata(meeting);
}

function getChronosInviteesFromMetadata(meeting: ChronosMeeting): ChronosParticipant[] {
  const metadata = meeting.metadata ?? {};
  const hubInvitees = Array.isArray(metadata.hubInvitees)
    ? metadata.hubInvitees
    : [];
  const apoloInvitees = Array.isArray(metadata.apoloInvitees)
    ? metadata.apoloInvitees
    : [];
  const participants: ChronosParticipant[] = [];

  [...hubInvitees, ...apoloInvitees].forEach((invitee, index) => {
    if (!invitee || typeof invitee !== "object") {
      return;
    }

    const record = invitee as Record<string, unknown>;
    const displayName =
      typeof record.displayName === "string" ? record.displayName.trim() : "";

    if (!displayName) {
      return;
    }

    const email = typeof record.email === "string" ? record.email.trim() : null;
    const userId =
      typeof record.userId === "string"
        ? record.userId.trim()
        : typeof record.entityId === "string"
          ? record.entityId.trim()
          : null;

    participants.push({
      attendanceStatus: "invited",
      displayName,
      email,
      id: `metadata-invitee-${meeting.id}-${index}`,
      joinedAt: null,
      leftAt: null,
      metadata: {
        chronosResponseStatus: "pending",
        source: "chronos-metadata",
      },
      organization:
        typeof record.organization === "string" ? record.organization.trim() : null,
      role: "participant",
      userId,
    });
  });

  return participants;
}

type ChronosAgendaPreviewItem =
  | { id: string; text: string; type: "body" | "bullet" | "heading" | "numbered" | "subheading" };

function parseChronosAgendaPreview(meeting: ChronosMeeting): ChronosAgendaPreviewItem[] {
  const agenda = meeting.metadata?.agenda;

  if (!Array.isArray(agenda)) {
    return [];
  }

  return agenda
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .map((line, index) => {
      const cleanLine = line.replace(/^[-–—]\s*$/, "").trim();

      if (!cleanLine || cleanLine === "***" || cleanLine === "---") {
        return null;
      }

      if (cleanLine.startsWith("### ")) {
        return {
          id: `${index}-${cleanLine}`,
          text: stripMarkdown(cleanLine.replace(/^###\s+/, "")),
          type: "subheading" as const,
        };
      }

      if (cleanLine.startsWith("## ")) {
        return {
          id: `${index}-${cleanLine}`,
          text: stripMarkdown(cleanLine.replace(/^##\s+/, "")),
          type: "heading" as const,
        };
      }

      if (/^\d+\.\s+/.test(cleanLine)) {
        return {
          id: `${index}-${cleanLine}`,
          text: stripMarkdown(cleanLine),
          type: "numbered" as const,
        };
      }

      if (/^[•*-]\s+/.test(cleanLine)) {
        return {
          id: `${index}-${cleanLine}`,
          text: stripMarkdown(cleanLine.replace(/^[•*-]\s+/, "")),
          type: "bullet" as const,
        };
      }

      return {
        id: `${index}-${cleanLine}`,
        text: stripMarkdown(cleanLine),
        type: "body" as const,
      };
    })
    .filter((item): item is ChronosAgendaPreviewItem => Boolean(item));
}

function ChronosAgendaPreview({ items }: { items: ChronosAgendaPreviewItem[] }) {
  return (
    <div className="grid gap-2 text-sm leading-5 text-[#344054]">
      {items.map((item) => {
        if (item.type === "heading") {
          return (
            <p className="m-0 text-base font-semibold leading-6 text-[#101820]" key={item.id}>
              {renderInlineMarkdown(item.text)}
            </p>
          );
        }

        if (item.type === "subheading") {
          return (
            <p
              className="m-0 mt-2 text-sm font-bold uppercase tracking-[0.02em] text-[#101820]"
              key={item.id}
            >
              {renderInlineMarkdown(item.text)}
            </p>
          );
        }

        if (item.type === "numbered") {
          return (
            <p className="m-0 mt-1 font-semibold text-[#101820]" key={item.id}>
              {renderInlineMarkdown(item.text)}
            </p>
          );
        }

        if (item.type === "bullet") {
          return (
            <p className="m-0 grid grid-cols-[0.75rem_minmax(0,1fr)] gap-2" key={item.id}>
              <span aria-hidden="true" className="pt-[0.42rem] text-[#A07C3B]">
                •
              </span>
              <span>{renderInlineMarkdown(item.text)}</span>
            </p>
          );
        }

        return (
          <p className="m-0" key={item.id}>
            {renderInlineMarkdown(item.text)}
          </p>
        );
      })}
    </div>
  );
}

function stripMarkdown(value: string) {
  return value.replace(/^\s*#+\s*/, "").trim();
}

function renderInlineMarkdown(value: string) {
  const parts = value.split(/(\*\*[^*]+\*\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong className="font-semibold text-[#101820]" key={`${part}-${index}`}>
          {part.slice(2, -2)}
        </strong>
      );
    }

    return part;
  });
}

function InviteDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-start">
      <span className="text-xs font-bold uppercase text-[#667085]">{label}</span>
      <span className="min-w-0 break-words text-sm font-semibold text-[#101820]">
        {value}
      </span>
    </div>
  );
}

function DetailIconRow({
  children,
  icon,
}: {
  children: ReactNode;
  icon: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-3">
      <span className="mt-1 grid h-7 w-7 place-items-center text-[#667085]">
        {icon}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function RsvpBadge({ status }: { status: ChronosRsvpStatus }) {
  const className = {
    accepted: "border-emerald-200 bg-emerald-50 text-emerald-700",
    declined: "border-red-200 bg-red-50 text-red-700",
    pending: "border-[#d9e0e7] bg-[#f8fafc] text-[#667085]",
    tentative: "border-amber-200 bg-amber-50 text-amber-700",
  } satisfies Record<ChronosRsvpStatus, string>;

  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${className[status]}`}
    >
      {chronosRsvpLabels[status]}
    </span>
  );
}
