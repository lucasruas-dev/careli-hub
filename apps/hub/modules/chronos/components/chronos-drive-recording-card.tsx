import {
  getChronosDriveMeetingDisplayTitle,
  getChronosMeetingDriveEnd,
  getChronosMeetingDriveStart,
  type ChronosDriveRecordingItem,
  type ChronosDriveRecordingMeeting,
} from "@/lib/chronos/drive";
import {
  formatChronosDateTime,
  formatChronosFileSize,
} from "@/lib/chronos/format";
import { getChronosCheckedInParticipants } from "@/lib/chronos/minutes";
import { normalizeChronosMeetingRuntime } from "@/lib/chronos/runtime-meeting";
import { formatChronosDuration } from "@/lib/chronos/recording";
import type { ChronosMeeting } from "@/lib/chronos/types";
import {
  Download,
  FileText,
  Mic,
  PlayCircle,
  Users,
  Video,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";

type ChronosDriveViewMode = "grid" | "list";

type ChronosDriveMeetingRecordingCardProps = {
  onOpenMeetingMinutes: (meetingId: string) => void;
  recordingMeeting: ChronosDriveRecordingMeeting;
  viewMode: ChronosDriveViewMode;
};

// Objetivo padrao gravado pelas salas avulsas — nao e assunto real, e ruido.
const genericChronosObjectives = new Set([
  "sala publica whereby aberta pelo chronos.",
  "sala publica whereby aberta pelo chronos",
]);

type ChronosDriveArtifactState = "failed" | "none" | "ok" | "processing";

export function ChronosDriveMeetingRecordingCard({
  onOpenMeetingMinutes,
  recordingMeeting,
  viewMode,
}: ChronosDriveMeetingRecordingCardProps) {
  const { primaryRecording } = recordingMeeting;
  const meeting = normalizeChronosMeetingRuntime(recordingMeeting.meeting);
  const safeRecordingMeeting = { ...recordingMeeting, meeting };
  const downloadUrl = primaryRecording?.downloadUrl ?? primaryRecording?.url;
  const canOpenVideo = Boolean(
    primaryRecording &&
      !isChronosAudioRecording(primaryRecording) &&
      primaryRecording.url &&
      primaryRecording.url !== "#",
  );
  const startedAt = getChronosMeetingDriveStart(meeting);
  const endedAt = getChronosMeetingDriveEnd(meeting);
  const displayTitle = getChronosDriveMeetingDisplayTitle(
    meeting,
    recordingMeeting.roomLabel,
  );
  const people = getChronosDrivePeople(recordingMeeting, meeting);
  const objective = getChronosDriveMeaningfulObjective(meeting);
  const whenLine = formatChronosDriveWhenLine(startedAt, endedAt);
  const detailLine = [
    recordingMeeting.totalDurationSeconds
      ? formatChronosDuration(recordingMeeting.totalDurationSeconds)
      : null,
    primaryRecording?.sizeBytes
      ? formatChronosFileSize(primaryRecording.sizeBytes)
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (viewMode === "list") {
    return (
      <article className="grid gap-3 border-b border-line bg-surface px-3 py-3 text-sm text-ink transition hover:bg-subtle xl:grid-cols-[minmax(15rem,1.3fr)_minmax(11rem,0.9fr)_minmax(13rem,1fr)_auto] xl:items-center">
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-semibold text-ink">
            {displayTitle}
          </p>
          <p className="m-0 mt-1 truncate text-xs text-ink-muted">
            {meeting.protocol}
            {recordingMeeting.roomLabel ? ` · ${recordingMeeting.roomLabel}` : ""}
          </p>
          {objective ? (
            <p
              className="m-0 mt-1 truncate text-xs text-ink-muted"
              title={objective}
            >
              {objective}
            </p>
          ) : null}
        </div>
        <div className="grid gap-1 text-xs text-ink-muted">
          <span>{whenLine}</span>
          {detailLine ? <span>{detailLine}</span> : null}
          {people.length > 0 ? (
            <span
              className="inline-flex min-w-0 items-center gap-1"
              title={people.join(", ")}
            >
              <Users aria-hidden="true" className="shrink-0" size={12} />
              <span className="truncate">{formatChronosDrivePeople(people)}</span>
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ChronosDriveArtifactChips
            meeting={meeting}
            recordingMeeting={safeRecordingMeeting}
          />
        </div>
        <ChronosDriveRecordingActions
          canOpenVideo={canOpenVideo}
          downloadUrl={downloadUrl}
          onOpenMeetingMinutes={onOpenMeetingMinutes}
          primaryRecording={primaryRecording}
          recordingMeeting={safeRecordingMeeting}
        />
      </article>
    );
  }

  return (
    <article className="grid overflow-hidden rounded-md border border-line bg-subtle text-sm text-ink transition hover:border-line hover:bg-surface">
      {canOpenVideo ? (
        <video
          className="aspect-video w-full bg-black"
          controls
          preload="metadata"
          src={primaryRecording?.url}
        />
      ) : (
        <div className="grid aspect-video place-items-center bg-inverse text-brand-ink">
          <div className="grid justify-items-center gap-2">
            <Video aria-hidden="true" size={24} />
            <span className="text-xs font-semibold text-[#d7dee8]">
              {recordingMeeting.failedVideoRecordings > 0
                ? "Video falhou; audio pode gerar ata"
                : "Video em processamento"}
            </span>
          </div>
        </div>
      )}
      <div className="grid gap-3 p-3">
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-semibold text-ink">
            {displayTitle}
          </p>
          <p className="m-0 mt-1 truncate text-xs text-ink-muted">
            {meeting.protocol}
            {recordingMeeting.roomLabel ? ` · ${recordingMeeting.roomLabel}` : ""}
          </p>
        </div>
        <div className="grid gap-1 text-xs text-ink-muted">
          <span>{whenLine}</span>
          {detailLine ? <span>{detailLine}</span> : null}
          {people.length > 0 ? (
            <span
              className="inline-flex min-w-0 items-center gap-1"
              title={people.join(", ")}
            >
              <Users aria-hidden="true" className="shrink-0" size={12} />
              <span className="truncate">{formatChronosDrivePeople(people)}</span>
            </span>
          ) : null}
          {objective ? (
            <span className="truncate" title={objective}>
              {objective}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ChronosDriveArtifactChips
            meeting={meeting}
            recordingMeeting={safeRecordingMeeting}
          />
        </div>
        <ChronosDriveRecordingActions
          canOpenVideo={canOpenVideo}
          downloadUrl={downloadUrl}
          onOpenMeetingMinutes={onOpenMeetingMinutes}
          primaryRecording={primaryRecording}
          recordingMeeting={safeRecordingMeeting}
        />
      </div>
    </article>
  );
}

// Quem estava na reuniao: participantes com check-in; sem check-in (salas
// avulsas), cai para quem a transcricao registrou falando.
function getChronosDrivePeople(
  recordingMeeting: ChronosDriveRecordingMeeting,
  meeting: ChronosMeeting,
) {
  const checkedIn = getChronosCheckedInParticipants(meeting)
    .map((participant) => participant.displayName?.trim())
    .filter((name): name is string => Boolean(name));

  if (checkedIn.length > 0) {
    return Array.from(new Set(checkedIn));
  }

  // Snapshot leve: os segmentos completos nao vem na listagem — o resumo de
  // quem falou chega em transcriptSpeakerLabels; o transcript so existe se a
  // reuniao ja foi hidratada sob demanda.
  const speakers =
    meeting.transcriptSpeakerLabels && meeting.transcriptSpeakerLabels.length > 0
      ? meeting.transcriptSpeakerLabels
      : meeting.transcript
          .map((segment) => segment.speakerLabel?.trim())
          .filter((name): name is string => Boolean(name));

  return Array.from(new Set(speakers));
}

function formatChronosDrivePeople(people: string[]) {
  const shown = people.slice(0, 3);
  const remaining = people.length - shown.length;

  return remaining > 0 ? `${shown.join(", ")} +${remaining}` : shown.join(", ");
}

function getChronosDriveMeaningfulObjective(meeting: ChronosMeeting) {
  const objective = meeting.objective?.trim();

  if (!objective) {
    return null;
  }

  if (genericChronosObjectives.has(objective.toLowerCase())) {
    return null;
  }

  return objective;
}

function formatChronosDriveWhenLine(
  startedAt: string | null | undefined,
  endedAt: string | null | undefined,
) {
  const start = formatChronosDateTime(startedAt);

  if (!endedAt) {
    return start;
  }

  const end = formatChronosDateTime(endedAt);
  const endTime = end.includes(" ") ? end.slice(end.indexOf(" ") + 1) : end;
  const sameDay =
    start.includes(" ") &&
    end.includes(" ") &&
    start.slice(0, start.indexOf(" ")) === end.slice(0, end.indexOf(" "));

  return sameDay ? `${start} ate ${endTime}` : `${start} ate ${end}`;
}

function ChronosDriveArtifactChips({
  meeting,
  recordingMeeting,
}: {
  meeting: ChronosMeeting;
  recordingMeeting: ChronosDriveRecordingMeeting;
}) {
  const videoState: ChronosDriveArtifactState =
    recordingMeeting.availableVideoRecordings > 0
      ? "ok"
      : recordingMeeting.failedVideoRecordings > 0
        ? "failed"
        : "processing";
  const videoTitle =
    videoState === "ok"
      ? "Video disponivel"
      : videoState === "failed"
        ? "Video falhou; audio pode gerar ata"
        : "Video em processamento";

  const transcriptSegmentCount =
    meeting.transcriptSegmentCount ?? meeting.transcript.length;
  const transcriptState: ChronosDriveArtifactState =
    transcriptSegmentCount > 0
      ? "ok"
      : meeting.transcriptionStatus === "processing" ||
          meeting.transcriptionStatus === "available" ||
          recordingMeeting.availableAudioRecordings > 0
        ? "processing"
        : "none";
  const transcriptTitle =
    transcriptState === "ok"
      ? "Transcricao disponivel"
      : transcriptState === "processing"
        ? "Transcricao em processamento"
        : "Sem transcricao";

  const minutesState: ChronosDriveArtifactState =
    meeting.minutes.length > 0
      ? "ok"
      : transcriptSegmentCount > 0
        ? "processing"
        : "none";
  const minutesTitle =
    minutesState === "ok"
      ? "Ata gerada"
      : minutesState === "processing"
        ? "Ata pode ser gerada (transcricao pronta)"
        : "Sem ata";

  return (
    <>
      <ChronosDriveArtifactChip icon={<Video size={12} />} state={videoState} title={videoTitle}>
        Video
      </ChronosDriveArtifactChip>
      <ChronosDriveArtifactChip
        icon={<Mic size={12} />}
        state={transcriptState}
        title={transcriptTitle}
      >
        Transcricao
      </ChronosDriveArtifactChip>
      <ChronosDriveArtifactChip
        icon={<FileText size={12} />}
        state={minutesState}
        title={minutesTitle}
      >
        Ata
      </ChronosDriveArtifactChip>
    </>
  );
}

const chronosDriveChipStateClasses: Record<ChronosDriveArtifactState, string> = {
  failed: "border-[#f4c7c3] bg-[#fdecea] text-[#a50e0e]",
  none: "border-[#e4e8ee] bg-[#f6f8fa] text-ink-muted",
  ok: "border-[#c9e7d4] bg-[#e6f4ea] text-[#188038]",
  processing: "border-[#f0e0bb] bg-[#fdf7e7] text-[#8a6d1d]",
};

function ChronosDriveArtifactChip({
  children,
  icon,
  state,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  state: ChronosDriveArtifactState;
  title: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${chronosDriveChipStateClasses[state]}`}
      title={title}
    >
      {icon}
      {children}
    </span>
  );
}

function ChronosDriveRecordingActions({
  canOpenVideo,
  downloadUrl,
  onOpenMeetingMinutes,
  primaryRecording,
  recordingMeeting,
}: {
  canOpenVideo: boolean;
  downloadUrl?: string;
  onOpenMeetingMinutes: (meetingId: string) => void;
  primaryRecording: ChronosDriveRecordingItem | null;
  recordingMeeting: ChronosDriveRecordingMeeting;
}) {
  const recordingMeetingRuntime = {
    ...recordingMeeting,
    meeting: normalizeChronosMeetingRuntime(recordingMeeting.meeting),
  };
  const [playerOpen, setPlayerOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button
        className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-surface px-2.5 text-xs font-semibold text-ink transition hover:border-[#A07C3B]"
        onClick={() => onOpenMeetingMinutes(recordingMeetingRuntime.meeting.id)}
        type="button"
      >
        <FileText aria-hidden="true" size={13} />
        Ata
      </button>
      {canOpenVideo && primaryRecording ? (
        <button
          className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-surface px-2.5 text-xs font-semibold text-ink transition hover:border-[#A07C3B]"
          onClick={() => setPlayerOpen(true)}
          type="button"
        >
          <PlayCircle aria-hidden="true" size={13} />
          Assistir
        </button>
      ) : (
        <button
          className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-surface px-2.5 text-xs font-semibold text-ink-muted disabled:cursor-not-allowed disabled:opacity-70"
          disabled
          title="O video ainda esta sendo copiado para o Drive"
          type="button"
        >
          <PlayCircle aria-hidden="true" size={13} />
          Processando
        </button>
      )}
      {downloadUrl && downloadUrl !== "#" && primaryRecording ? (
        <a
          className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-line-strong bg-inverse px-2.5 text-xs font-semibold text-brand-ink transition hover:bg-black"
          download={primaryRecording.name}
          href={downloadUrl}
        >
          <Download aria-hidden="true" size={13} />
          Baixar
        </a>
      ) : null}
      {playerOpen && primaryRecording?.url ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-inverse/75 p-4"
          role="dialog"
        >
          <div className="grid max-h-[92dvh] w-full max-w-5xl overflow-hidden rounded-md border border-[#2a3542] bg-inverse shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <p className="m-0 truncate text-sm font-semibold text-white">
                  {recordingMeetingRuntime.meeting.title}
                </p>
                <p className="m-0 mt-1 truncate text-xs text-[#aab4c1]">
                  {recordingMeetingRuntime.meeting.protocol}
                </p>
              </div>
              <button
                aria-label="Fechar player"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-white/15 text-white transition hover:bg-white/10"
                onClick={() => setPlayerOpen(false)}
                type="button"
              >
                <X aria-hidden="true" size={16} />
              </button>
            </div>
            <video
              className="max-h-[72dvh] w-full bg-black"
              controls
              preload="metadata"
              src={primaryRecording.url}
            />
            {downloadUrl && downloadUrl !== "#" ? (
              <div className="flex justify-end border-t border-white/10 px-4 py-3">
                <a
                  className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-white/15 bg-surface px-2.5 text-xs font-semibold text-ink transition hover:bg-subtle"
                  download={primaryRecording.name}
                  href={downloadUrl}
                >
                  <Download aria-hidden="true" size={13} />
                  Baixar arquivo
                </a>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function isChronosAudioRecording(recording: ChronosDriveRecordingItem) {
  const mimeType = recording.mimeType?.toLowerCase() ?? "";
  const fileName = recording.name.toLowerCase();

  return (
    mimeType.startsWith("audio/") ||
    fileName.endsWith("-audio.mp4") ||
    (fileName.includes("-audio-") && fileName.endsWith(".mp4")) ||
    fileName.endsWith(".ogg") ||
    fileName.endsWith(".mp3") ||
    fileName.endsWith(".m4a") ||
    fileName.endsWith(".wav")
  );
}
