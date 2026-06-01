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
import { formatChronosDuration } from "@/lib/chronos/recording";
import {
  chronosCaptureStatusLabels,
  type ChronosMeeting,
  type ChronosMinutesProfile,
} from "@/lib/chronos/types";
import { Badge } from "@repo/uix";
import { Download, FileText, Loader2, Mic, PlayCircle, Video } from "lucide-react";

type ChronosDriveViewMode = "grid" | "list";

type ChronosTranscribeExistingRecordingInput = {
  meeting: ChronosMeeting;
  minutesProfile?: ChronosMinutesProfile;
  recordingId: string;
};

type ChronosTranscribeRecordingInput = {
  file: Blob;
  fileName?: string;
  meeting: ChronosMeeting;
  recordingId?: string;
};

type ChronosDriveMeetingRecordingCardProps = {
  onSelectMeeting: (meetingId: string) => void;
  onTranscribeExistingRecording: (
    input: ChronosTranscribeExistingRecordingInput,
  ) => Promise<void>;
  onTranscribeRecording: (
    input: ChronosTranscribeRecordingInput,
  ) => Promise<void>;
  recordingMeeting: ChronosDriveRecordingMeeting;
  saving: boolean;
  viewMode: ChronosDriveViewMode;
};

export function ChronosDriveMeetingRecordingCard({
  onSelectMeeting,
  onTranscribeExistingRecording,
  onTranscribeRecording,
  recordingMeeting,
  saving,
  viewMode,
}: ChronosDriveMeetingRecordingCardProps) {
  const { meeting, primaryRecording } = recordingMeeting;
  const canOpenVideo = isChronosDriveRecordingPlayable(primaryRecording);
  const downloadUrl = getChronosDriveRecordingDownloadUrl(primaryRecording);
  const startedAt = getChronosMeetingDriveStart(meeting);
  const endedAt = getChronosMeetingDriveEnd(meeting);
  const displayTitle = getChronosDriveMeetingDisplayTitle(
    meeting,
    recordingMeeting.roomLabel,
  );
  const status =
    primaryRecording?.status ??
    (recordingMeeting.availableRecordings > 0
      ? "available"
      : meeting.recordingStatus);
  const hasPendingMediaLink = Boolean(
    primaryRecording?.status === "available" && !canOpenVideo,
  );
  const statusLabel = hasPendingMediaLink
    ? "Link pendente"
    : chronosCaptureStatusLabels[status] ?? "Nao iniciada";
  const statusVariant =
    status === "available" && !hasPendingMediaLink ? "success" : "neutral";
  const videoPlaceholderLabel = hasPendingMediaLink
    ? "Link de video pendente"
    : recordingMeeting.recordings.length > 0
      ? "Video em processamento"
      : "Gravacao ainda nao disponivel";
  const checkedInParticipants = getChronosCheckedInParticipants(meeting);

  if (viewMode === "list") {
    return (
      <article className="grid gap-3 border-b border-[#edf0f4] bg-white px-3 py-3 text-sm text-[#101820] transition hover:bg-[#fafbfc] xl:grid-cols-[minmax(14rem,1.4fr)_minmax(10rem,0.8fr)_minmax(14rem,1fr)_auto] xl:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="m-0 truncate text-sm font-semibold text-[#101820]">
              {displayTitle}
            </p>
            <Badge variant={statusVariant}>
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
        </div>
        <ChronosDriveRecordingActions
          canOpenVideo={canOpenVideo}
          downloadUrl={downloadUrl}
          onSelectMeeting={onSelectMeeting}
          onTranscribeExistingRecording={onTranscribeExistingRecording}
          onTranscribeRecording={onTranscribeRecording}
          primaryRecording={primaryRecording}
          recordingMeeting={recordingMeeting}
          saving={saving}
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
              {videoPlaceholderLabel}
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
          <Badge variant={statusVariant}>
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
        </div>
        <ChronosDriveRecordingActions
          canOpenVideo={canOpenVideo}
          downloadUrl={downloadUrl}
          onSelectMeeting={onSelectMeeting}
          onTranscribeExistingRecording={onTranscribeExistingRecording}
          onTranscribeRecording={onTranscribeRecording}
          primaryRecording={primaryRecording}
          recordingMeeting={recordingMeeting}
          saving={saving}
        />
      </div>
    </article>
  );
}

function ChronosDriveRecordingActions({
  canOpenVideo,
  downloadUrl,
  onSelectMeeting,
  onTranscribeExistingRecording,
  onTranscribeRecording,
  primaryRecording,
  recordingMeeting,
  saving,
}: {
  canOpenVideo: boolean;
  downloadUrl?: string;
  onSelectMeeting: (meetingId: string) => void;
  onTranscribeExistingRecording: (
    input: ChronosTranscribeExistingRecordingInput,
  ) => Promise<void>;
  onTranscribeRecording: (
    input: ChronosTranscribeRecordingInput,
  ) => Promise<void>;
  primaryRecording: ChronosDriveRecordingItem | null;
  recordingMeeting: ChronosDriveRecordingMeeting;
  saving: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#101820] transition hover:border-[#A07C3B]"
        onClick={() => onSelectMeeting(recordingMeeting.meeting.id)}
        type="button"
      >
        <FileText aria-hidden="true" size={13} />
        Reuniao
      </button>
      <div className="flex flex-wrap gap-2">
        {canOpenVideo && primaryRecording ? (
          <a
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#101820] transition hover:border-[#A07C3B]"
            href={primaryRecording.url}
            rel="noreferrer"
            target="_blank"
          >
            <PlayCircle aria-hidden="true" size={13} />
            Assistir
          </a>
        ) : (
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#8a95a6] disabled:cursor-not-allowed disabled:opacity-70"
            disabled
            type="button"
          >
            <PlayCircle aria-hidden="true" size={13} />
            Video em processamento
          </button>
        )}
        {downloadUrl && downloadUrl !== "#" && primaryRecording ? (
          <a
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#101820] bg-[#101820] px-2.5 text-xs font-semibold text-white transition hover:bg-black"
            download={primaryRecording.name}
            href={downloadUrl}
          >
            <Download aria-hidden="true" size={13} />
            Baixar
          </a>
        ) : null}
        {primaryRecording ? (
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#101820] transition hover:bg-[#f8fafc] disabled:cursor-wait disabled:opacity-60"
            disabled={
              saving ||
              Boolean(primaryRecording.transcribedAt) ||
              !canTranscribeChronosDriveRecording(primaryRecording)
            }
            onClick={() =>
              primaryRecording.blob
                ? void onTranscribeRecording({
                    file: primaryRecording.blob as Blob,
                    fileName: primaryRecording.name,
                    meeting: recordingMeeting.meeting,
                    recordingId: primaryRecording.id,
                  })
                : void onTranscribeExistingRecording({
                    meeting: recordingMeeting.meeting,
                    recordingId: primaryRecording.id,
                  })
            }
            type="button"
          >
            {saving ? (
              <Loader2 aria-hidden="true" className="animate-spin" size={13} />
            ) : (
              <Mic aria-hidden="true" size={13} />
            )}
            {primaryRecording.transcribedAt
              ? "Transcrita"
              : saving
                ? "Transcrevendo"
              : canTranscribeChronosDriveRecording(primaryRecording)
                ? "Transcrever"
                : "Aguardando video"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function canTranscribeChronosDriveRecording(
  recording: ChronosDriveRecordingItem,
) {
  return Boolean(recording.blob || isChronosDriveRecordingPlayable(recording));
}

function getChronosDriveRecordingDownloadUrl(
  recording: ChronosDriveRecordingItem | null,
) {
  return normalizeChronosDriveRecordingUrl(
    recording?.downloadUrl ?? recording?.url,
  );
}

function isChronosDriveRecordingPlayable(
  recording: ChronosDriveRecordingItem | null,
) {
  return Boolean(normalizeChronosDriveRecordingUrl(recording?.url));
}

function normalizeChronosDriveRecordingUrl(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();

  return trimmed && trimmed !== "#" ? trimmed : "";
}
