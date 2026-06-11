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
import { chronosCaptureStatusLabels } from "@/lib/chronos/types";
import { Badge } from "@repo/uix";
import { Download, FileText, PlayCircle, Video, X } from "lucide-react";
import { useState } from "react";

type ChronosDriveViewMode = "grid" | "list";

type ChronosDriveMeetingRecordingCardProps = {
  onOpenMeetingMinutes: (meetingId: string) => void;
  recordingMeeting: ChronosDriveRecordingMeeting;
  viewMode: ChronosDriveViewMode;
};

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
  const status =
    recordingMeeting.availableRecordings > 0
      ? "available"
      : (primaryRecording?.status ?? meeting.recordingStatus);
  const statusLabel = getChronosDriveRecordingStatusLabel(
    recordingMeeting,
    status,
  );
  const videoStatusLabel = getChronosDriveVideoStatusLabel(recordingMeeting);
  const audioStatusLabel = getChronosDriveAudioStatusLabel(recordingMeeting);
  const missingVideoLabel =
    recordingMeeting.failedVideoRecordings > 0
      ? "Video falhou; audio pode gerar ata"
      : recordingMeeting.availableAudioRecordings > 0
        ? "Video indisponivel; audio salvo"
        : "Video em processamento";
  const checkedInParticipants = getChronosCheckedInParticipants(meeting);

  if (viewMode === "list") {
    return (
      <article className="grid gap-3 border-b border-[#edf0f4] bg-white px-3 py-3 text-sm text-[#101820] transition hover:bg-[#fafbfc] xl:grid-cols-[minmax(14rem,1.4fr)_minmax(10rem,0.8fr)_minmax(14rem,1fr)_auto] xl:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="m-0 truncate text-sm font-semibold text-[#101820]">
              {displayTitle}
            </p>
            <Badge variant={status === "available" ? "success" : "neutral"}>
              {statusLabel}
            </Badge>
          </div>
          <p className="m-0 mt-1 truncate text-xs text-[#667085]">
            {meeting.protocol}
          </p>
        </div>
        <div className="grid gap-1 text-xs text-[#667085]">
          <span>Inicio: {formatChronosDateTime(startedAt)}</span>
          <span>Fim: {formatChronosDateTime(endedAt)}</span>
        </div>
        <div className="grid gap-1 text-xs text-[#667085]">
          <span>Participantes: {checkedInParticipants.length}</span>
          <span className="truncate">
            Pessoas: {recordingMeeting.participantText || "-"}
          </span>
          <span className="truncate">
            Assunto: {meeting.objective || meeting.title}
          </span>
          <span>
            Video: {videoStatusLabel} / Audio e ata: {audioStatusLabel}
          </span>
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
    <article className="grid overflow-hidden rounded-md border border-[#edf0f4] bg-[#fafbfc] text-sm text-[#101820] transition hover:border-[#d9e0e7] hover:bg-white">
      {canOpenVideo ? (
        <video
          className="aspect-video w-full bg-black"
          controls
          preload="metadata"
          src={primaryRecording?.url}
        />
      ) : (
        <div className="grid aspect-video place-items-center bg-[#101820] text-white">
          <div className="grid justify-items-center gap-2">
            <Video aria-hidden="true" size={24} />
            <span className="text-xs font-semibold text-[#d7dee8]">
              {recordingMeeting.recordings.length > 0
                ? missingVideoLabel
                : "Gravacao ainda nao disponivel"}
            </span>
          </div>
        </div>
      )}
      <div className="grid gap-3 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-semibold text-[#101820]">
              {displayTitle}
            </p>
            <p className="m-0 mt-1 truncate text-xs text-[#667085]">
              {meeting.protocol}
            </p>
          </div>
          <Badge variant={status === "available" ? "success" : "neutral"}>
            {statusLabel}
          </Badge>
        </div>
        <div className="grid gap-1 text-xs text-[#667085]">
          <span>Inicio: {formatChronosDateTime(startedAt)}</span>
          <span>Fim: {formatChronosDateTime(endedAt)}</span>
          <span>Participantes: {checkedInParticipants.length}</span>
          <span className="truncate">
            Pessoas: {recordingMeeting.participantText || "-"}
          </span>
          <span className="truncate">
            Assunto: {meeting.objective || meeting.title}
          </span>
          <span>
            Duracao: {formatChronosDuration(recordingMeeting.totalDurationSeconds)}
            {primaryRecording?.sizeBytes
              ? ` / ${formatChronosFileSize(primaryRecording.sizeBytes)}`
              : ""}
          </span>
          <span>
            Arquivos: {recordingMeeting.recordings.length} / disponiveis:{" "}
            {recordingMeeting.availableRecordings}
          </span>
          <span>
            Video: {videoStatusLabel} / Audio e ata: {audioStatusLabel}
          </span>
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

function getChronosDriveRecordingStatusLabel(
  recordingMeeting: ChronosDriveRecordingMeeting,
  status: keyof typeof chronosCaptureStatusLabels,
) {
  if (
    recordingMeeting.failedVideoRecordings > 0 &&
    recordingMeeting.availableAudioRecordings > 0
  ) {
    return "Audio disponivel";
  }

  if (
    recordingMeeting.failedRecordings > 0 &&
    recordingMeeting.availableRecordings > 0
  ) {
    return "Parcial";
  }

  return chronosCaptureStatusLabels[status];
}

function getChronosDriveVideoStatusLabel(
  recordingMeeting: ChronosDriveRecordingMeeting,
) {
  if (recordingMeeting.availableVideoRecordings > 0) {
    return "Disponivel";
  }

  if (recordingMeeting.failedVideoRecordings > 0) {
    return "Falhou";
  }

  return "Pendente";
}

function getChronosDriveAudioStatusLabel(
  recordingMeeting: ChronosDriveRecordingMeeting,
) {
  const meeting = normalizeChronosMeetingRuntime(recordingMeeting.meeting);

  if (meeting.transcript.length > 0) {
    return "Transcricao disponivel";
  }

  if (meeting.transcriptionStatus === "available") {
    return "Transcricao em sincronizacao";
  }

  if (meeting.transcriptionStatus === "processing") {
    return "Transcricao em processamento";
  }

  if (recordingMeeting.availableAudioRecordings > 0) {
    return "Disponivel para transcricao";
  }

  if (recordingMeeting.recordings.some(isChronosAudioRecording)) {
    return "Processando";
  }

  return "Pendente";
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
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button
        className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#101820] transition hover:border-[#A07C3B]"
        onClick={() => onOpenMeetingMinutes(recordingMeetingRuntime.meeting.id)}
        type="button"
      >
        <FileText aria-hidden="true" size={13} />
        Ata
      </button>
      <div className="flex min-w-0 flex-wrap gap-2">
        {canOpenVideo && primaryRecording ? (
          <button
            className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#101820] transition hover:border-[#A07C3B]"
            onClick={() => setPlayerOpen(true)}
            type="button"
          >
            <PlayCircle aria-hidden="true" size={13} />
            Assistir
          </button>
        ) : (
          <button
            className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#8a95a6] disabled:cursor-not-allowed disabled:opacity-70"
            disabled
            type="button"
          >
            <PlayCircle aria-hidden="true" size={13} />
            Video em processamento
          </button>
        )}
        {downloadUrl && downloadUrl !== "#" && primaryRecording ? (
          <a
            className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-[#101820] bg-[#101820] px-2.5 text-xs font-semibold text-white transition hover:bg-black"
            download={primaryRecording.name}
            href={downloadUrl}
          >
            <Download aria-hidden="true" size={13} />
            Baixar
          </a>
        ) : null}
      </div>
      {playerOpen && primaryRecording?.url ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-[#101820]/75 p-4"
          role="dialog"
        >
          <div className="grid max-h-[92dvh] w-full max-w-5xl overflow-hidden rounded-md border border-[#2a3542] bg-[#101820] shadow-2xl">
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
                  className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-white/15 bg-white px-2.5 text-xs font-semibold text-[#101820] transition hover:bg-[#f3f6fa]"
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
