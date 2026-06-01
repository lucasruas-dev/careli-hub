import { formatChronosDateTime } from "@/lib/chronos/format";
import {
  chronosCaptureStatusLabels,
  type ChronosMeeting,
} from "@/lib/chronos/types";
import { Surface } from "@repo/uix";
import { InfoBlock, PanelTitle } from "./chronos-panels";

type RecordingContextPanelProps = {
  meeting: ChronosMeeting;
};

export function RecordingContextPanel({
  meeting,
}: RecordingContextPanelProps) {
  const recordingStatusLabel =
    chronosCaptureStatusLabels[meeting.recordingStatus] ?? "Nao iniciada";
  const transcriptionStatusLabel =
    chronosCaptureStatusLabels[meeting.transcriptionStatus] ?? "Nao iniciada";

  return (
    <Surface bordered className="min-h-full border-[#d9e0e7] bg-white p-4">
      <PanelTitle eyebrow="Gravacoes" title="Identificacao da reuniao" />
      <div className="mt-4 grid gap-3">
        <InfoBlock label="protocolo" value={meeting.protocol} />
        <InfoBlock label="reuniao" value={meeting.title} />
        <InfoBlock
          label="data"
          value={formatChronosDateTime(meeting.startsAt)}
        />
        <InfoBlock label="sala" value={meeting.room?.name ?? "-"} />
        <InfoBlock
          label="gravacao"
          value={recordingStatusLabel}
        />
        <InfoBlock
          label="transcricao"
          value={transcriptionStatusLabel}
        />
      </div>
    </Surface>
  );
}
