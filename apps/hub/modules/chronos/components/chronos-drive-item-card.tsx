import { formatChronosDateTime } from "@/lib/chronos/format";
import { getChronosCheckedInParticipants } from "@/lib/chronos/minutes";
import { normalizeChronosMeetingRuntime } from "@/lib/chronos/runtime-meeting";
import {
  chronosCaptureStatusLabels,
  chronosMinutesStatusLabels,
  type ChronosMeeting,
  type ChronosMinutesStatus,
} from "@/lib/chronos/types";
import { Badge } from "@repo/uix";
import type { BadgeVariant } from "@repo/uix";

type ChronosDriveView = "recordings" | "minutes";

const minutesVariant = {
  approved: "success",
  draft: "neutral",
  in_review: "warning",
  not_started: "neutral",
  rejected: "danger",
} as const satisfies Record<ChronosMinutesStatus, BadgeVariant>;

type ChronosDriveItemCardProps = {
  driveView: ChronosDriveView;
  meeting: ChronosMeeting;
  onSelectMeeting: (meetingId: string) => void;
  selected: boolean;
};

export function ChronosDriveItemCard({
  driveView,
  meeting,
  onSelectMeeting,
  selected,
}: ChronosDriveItemCardProps) {
  const safeMeeting = normalizeChronosMeetingRuntime(meeting);
  const checkedInParticipants = getChronosCheckedInParticipants(safeMeeting);
  const participants = checkedInParticipants
    .map((participant) => participant.displayName)
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");

  return (
    <button
      className={`grid min-w-0 gap-3 overflow-hidden rounded-md border p-3 text-left transition ${
        selected
          ? "border-[#A07C3B] bg-[#fffaf0] dark:bg-[#a07c3b]/10"
          : "border-line bg-subtle hover:border-line hover:bg-surface"
      }`}
      onClick={() => onSelectMeeting(meeting.id)}
      type="button"
    >
      <span className="flex min-w-0 items-start justify-between gap-2">
        <span className="min-w-0 flex-1">
          <span className="block overflow-hidden text-sm font-semibold leading-5 text-ink [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [overflow-wrap:anywhere]">
            {meeting.title}
          </span>
          <span className="mt-1 block text-xs text-ink-muted">
            {meeting.room?.name ?? "Sala pendente"}
          </span>
        </span>
        <Badge
          className="shrink-0"
          variant={
            driveView === "recordings"
              ? safeMeeting.recordingStatus === "available"
                ? "success"
                : "warning"
              : minutesVariant[safeMeeting.minutesStatus]
          }
        >
          {driveView === "recordings"
            ? chronosCaptureStatusLabels[safeMeeting.recordingStatus]
            : chronosMinutesStatusLabels[safeMeeting.minutesStatus]}
        </Badge>
      </span>
      <span className="grid gap-1 text-xs text-ink-muted">
        <span>Inicio: {formatChronosDateTime(meeting.startsAt)}</span>
        <span>Participantes: {checkedInParticipants.length}</span>
        <span className="truncate">Nomes: {participants || "-"}</span>
        <span className="overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [overflow-wrap:anywhere]">
          Tema: {meeting.objective || meeting.title}
        </span>
      </span>
      <span className="flex flex-wrap gap-1">
        <Badge variant="neutral">{meeting.protocol}</Badge>
        {driveView === "recordings" ? (
          <Badge variant="neutral">{safeMeeting.recordings.length} arquivos</Badge>
        ) : (
          <Badge variant="neutral">{safeMeeting.minutes.length} versoes</Badge>
        )}
      </span>
    </button>
  );
}
