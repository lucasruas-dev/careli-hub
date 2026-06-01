import {
  chronosCaptureStatusLabels,
  type ChronosMeeting,
} from "@/lib/chronos/types";
import {
  mapPersistedRecording,
  type LocalRecording,
} from "@/lib/chronos/drive";
import { formatChronosDuration } from "@/lib/chronos/recording";
import { Surface } from "@repo/uix";
import { Download, Mic, PlayCircle, Upload } from "lucide-react";
import { useRef, type ChangeEvent } from "react";
import { EmptyPanel, InfoBlock, PanelTitle } from "./chronos-panels";

type RecordingsPanelProps = {
  localRecordings: LocalRecording[];
  meeting: ChronosMeeting;
  onTranscribeRecording: (input: {
    file: Blob;
    fileName?: string;
    meeting: ChronosMeeting;
    recordingId?: string;
  }) => Promise<void>;
  saving: boolean;
};

export function RecordingsPanel({
  localRecordings,
  meeting,
  onTranscribeRecording,
  saving,
}: RecordingsPanelProps) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const meetingLocalRecordings = localRecordings.filter(
    (recording) => recording.meetingId === meeting.id,
  );
  const meetingRecordings = Array.isArray(meeting.recordings)
    ? meeting.recordings
    : [];
  const recordings = [
    ...meetingLocalRecordings,
    ...meetingRecordings.map((recording) =>
      mapPersistedRecording(recording, meeting.id),
    ),
  ];

  async function handleUploadChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (file) {
      await onTranscribeRecording({
        file,
        fileName: file.name,
        meeting,
      });
    }

    event.target.value = "";
  }

  return (
    <Surface bordered className="min-h-full border-[#d9e0e7] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PanelTitle eyebrow="Gravacoes" title="Registro audiovisual" />
        <input
          accept="audio/*,video/*,.webm,.m4a,.mp3,.mp4,.ogg,.wav"
          className="hidden"
          onChange={(event) => void handleUploadChange(event)}
          ref={uploadInputRef}
          type="file"
        />
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#101820] transition hover:bg-[#f8fafc] disabled:cursor-wait disabled:opacity-60"
          disabled={saving}
          onClick={() => uploadInputRef.current?.click()}
          type="button"
        >
          <Upload aria-hidden="true" size={15} />
          Transcrever arquivo
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <InfoBlock
          label="status"
          value={chronosCaptureStatusLabels[meeting.recordingStatus]}
        />
        <InfoBlock
          label="arquivos locais"
          value={String(meetingLocalRecordings.length)}
        />
      </div>
      <div className="mt-4 grid gap-3">
        {recordings.map((recording) => {
          const downloadUrl = recording.downloadUrl ?? recording.url;

          return (
            <div
              className="rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3 text-sm text-[#101820] transition hover:border-[#d9e0e7] hover:bg-white"
              key={recording.id}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <strong className="block truncate text-sm font-semibold">
                    {recording.name}
                  </strong>
                  <span className="text-xs font-semibold text-[#667085]">
                    {formatChronosDuration(recording.durationSeconds)}
                  </span>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {recording.url !== "#" ? (
                    <a
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#101820] transition hover:border-[#A07C3B]"
                      href={recording.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <PlayCircle aria-hidden="true" size={13} />
                      Assistir
                    </a>
                  ) : null}
                  {downloadUrl && downloadUrl !== "#" ? (
                    <a
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#101820] bg-[#101820] px-2.5 text-xs font-semibold text-white transition hover:bg-black"
                      download={recording.name}
                      href={downloadUrl}
                    >
                      <Download aria-hidden="true" size={13} />
                      Baixar
                    </a>
                  ) : null}
                  {recording.blob ? (
                    <button
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#101820] transition hover:bg-[#f8fafc] disabled:cursor-wait disabled:opacity-60"
                      disabled={saving || Boolean(recording.transcribedAt)}
                      onClick={() =>
                        void onTranscribeRecording({
                          file: recording.blob as Blob,
                          fileName: recording.name,
                          meeting,
                          recordingId: recording.id,
                        })
                      }
                      type="button"
                    >
                      <Mic aria-hidden="true" size={13} />
                      {recording.transcribedAt ? "Transcrita" : "Transcrever"}
                    </button>
                  ) : null}
                </div>
              </div>
              {recording.url !== "#" ? (
                <video
                  className="mt-3 aspect-video w-full rounded-md border border-[#d9e0e7] bg-black"
                  controls
                  preload="metadata"
                  src={recording.url}
                />
              ) : null}
            </div>
          );
        })}
        {recordings.length === 0 ? (
          <EmptyPanel text="Nenhuma gravacao registrada." />
        ) : null}
      </div>
    </Surface>
  );
}
