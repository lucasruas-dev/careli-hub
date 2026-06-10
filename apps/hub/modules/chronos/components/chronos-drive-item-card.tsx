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
      className={`grid gap-3 rounded-md border p-3 text-left transition ${
        selected
          ? "border-[#A07C3B] bg-[#fffaf0]"
          : "border-[#edf0f4] bg-[#fafbfc] hover:border-[#d9e0e7] hover:bg-white"
      }`}
      onClick={() => onSelectMeeting(meeting.id)}
      type="button"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[#101820]">
            {meeting.title}
          </span>
          <span className="mt-1 block text-xs text-[#667085]">
            {meeting.room?.name ?? "Sala pendente"}
          </span>
        </span>
        <Badge
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
      <span className="grid gap-1 text-xs text-[#667085]">
        <span>Inicio: {formatChronosDateTime(meeting.startsAt)}</span>
        <span>Participantes: {checkedInParticipants.length}</span>
        <span className="truncate">Nomes: {participants || "-"}</span>
        <span>Tema: {meeting.objective || meeting.title}</span>
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
