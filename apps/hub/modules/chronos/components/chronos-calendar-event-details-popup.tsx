import {
  getChronosCalendarEventKind,
  getChronosMeetingLocationLabel,
  getChronosMeetingProfileLabel,
  getChronosMeetingRoomPath,
} from "@/lib/chronos/calendar";
import { formatChronosDateTime } from "@/lib/chronos/format";
import {
  chronosCalendarEventKindLabels,
  chronosMeetingStatusLabels,
  type ChronosMeeting,
} from "@/lib/chronos/types";
import { Badge } from "@repo/uix";
import { ClipboardCheck, Trash2, X } from "lucide-react";
import { useState } from "react";
import { chronosMeetingStatusVariant } from "./chronos-meeting-status";

type ChronosCalendarEventDetailsPopupProps = {
  meeting: ChronosMeeting;
  onClose: () => void;
  onDelete: (meetingId: string) => Promise<void>;
  saving: boolean;
};

export function ChronosCalendarEventDetailsPopup({
  meeting,
  onClose,
  onDelete,
  saving,
}: ChronosCalendarEventDetailsPopupProps) {
  const [copied, setCopied] = useState(false);
  const roomPath = getChronosMeetingRoomPath(meeting);
  const roomUrl =
    roomPath && typeof window !== "undefined"
      ? new URL(roomPath, window.location.origin).toString()
      : roomPath;
  const eventKind = getChronosCalendarEventKind(meeting);
  const meetingProfile = getChronosMeetingProfileLabel(meeting);
  const participants = meeting.participants.filter(
    (participant) => participant.role !== "host",
  );

  async function copyRoomLink() {
    if (!roomUrl) {
      return;
    }

    await navigator.clipboard.writeText(roomUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function requestDelete() {
    if (!window.confirm(`Excluir "${meeting.title}" da agenda Chronos?`)) {
      return;
    }

    await onDelete(meeting.id);
  }

  return (
    <section
      aria-label="Detalhes do evento Chronos"
      className="relative z-10 grid max-h-[calc(100vh-7rem)] w-full max-w-[34rem] gap-4 overflow-auto rounded-lg border border-[#d9e0e7] bg-white p-4 shadow-[0_22px_70px_rgb(16_24_32_/_0.22)]"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">
              {chronosCalendarEventKindLabels[eventKind]}
            </Badge>
            <Badge variant={chronosMeetingStatusVariant[meeting.status]}>
              {chronosMeetingStatusLabels[meeting.status]}
            </Badge>
          </div>
          <h2 className="mt-3 truncate text-xl font-semibold text-[#101820]">
            {meeting.title}
          </h2>
          <p className="m-0 mt-1 text-sm font-medium text-[#667085]">
            {formatChronosDateTime(meeting.startsAt)}
            {meeting.endsAt ? ` - ${formatChronosDateTime(meeting.endsAt)}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
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

      <div className="grid gap-2 rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3 text-sm">
        <DetailRow label="Tipo" value={meetingProfile} />
        <DetailRow label="Local" value={getChronosMeetingLocationLabel(meeting)} />
        <DetailRow label="Host" value={meeting.hostName ?? "Host Chronos"} />
        <DetailRow label="Protocolo" value={meeting.protocol} />
      </div>

      {roomUrl ? (
        <div className="grid gap-2 rounded-md border border-[#d9e0e7] bg-white p-3">
          <p className="m-0 text-xs font-bold uppercase text-[#667085]">
            Link da sala
          </p>
          <div className="flex min-w-0 items-center gap-2">
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
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#667085]">
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
      ) : null}

      {meeting.objective ? (
        <div className="grid gap-1 rounded-md border border-[#edf0f4] bg-white p-3">
          <p className="m-0 text-xs font-bold uppercase text-[#667085]">
            Descricao
          </p>
          <p className="m-0 text-sm leading-5 text-[#344054]">
            {meeting.objective}
          </p>
        </div>
      ) : null}

      <div className="grid gap-2">
        <p className="m-0 text-xs font-bold uppercase text-[#667085]">
          Convidados
        </p>
        {participants.length > 0 ? (
          <div className="grid max-h-40 gap-1 overflow-auto">
            {participants.map((participant) => (
              <div
                className="flex items-center justify-between gap-2 rounded-md border border-[#edf0f4] bg-[#fafbfc] px-3 py-2"
                key={participant.id}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[#101820]">
                    {participant.displayName}
                  </span>
                  <span className="block truncate text-xs text-[#667085]">
                    {[participant.email, participant.organization]
                      .filter(Boolean)
                      .join(" / ") || "Sem contato cadastrado"}
                  </span>
                </span>
                <Badge variant="neutral">{participant.role}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <span className="rounded-md border border-dashed border-[#d9e0e7] bg-[#fafbfc] p-3 text-sm text-[#667085]">
            Nenhum convidado adicional registrado.
          </span>
        )}
      </div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
      <span className="text-xs font-bold uppercase text-[#667085]">{label}</span>
      <span className="truncate font-semibold text-[#101820]">{value}</span>
    </div>
  );
}
