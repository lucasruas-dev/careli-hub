import { buildChronosMinutesContext } from "@/lib/chronos/minutes";
import { buildChronosMinutesDraft } from "@/lib/chronos/minutes-draft";
import { openChronosMinutesPrintWindow } from "@/lib/chronos/minutes-preview";
import { normalizeChronosMeetingRuntime } from "@/lib/chronos/runtime-meeting";
import {
  chronosMinutesProfileLabels,
  chronosMinutesStatusLabels,
  type ChronosMeeting,
  type ChronosMinutesProfile,
  type ChronosMinutesStatus,
  type ChronosUpdateInput,
} from "@/lib/chronos/types";
import { Badge, Surface } from "@repo/uix";
import { Download, Mic, Save, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ChronosMinutesFormattedPreview } from "./chronos-minutes-formatted-preview";
import { chronosMinutesStatusVariant } from "./chronos-minutes-status";
import { PanelTitle } from "./chronos-panels";

type MinutesPanelProps = {
  canDeleteMinutes: boolean;
  meeting: ChronosMeeting;
  onGenerateMinutesDraft: (
    meeting: ChronosMeeting,
    minutesProfile: ChronosMinutesProfile,
  ) => Promise<void>;
  onTranscribeExistingRecording: (input: {
    meeting: ChronosMeeting;
    minutesProfile?: ChronosMinutesProfile;
    recordingId: string;
  }) => Promise<boolean>;
  onUpdate: (input: ChronosUpdateInput) => Promise<void>;
  saving: boolean;
};

export function MinutesPanel({
  canDeleteMinutes,
  meeting,
  onGenerateMinutesDraft,
  onTranscribeExistingRecording,
  onUpdate,
  saving,
}: MinutesPanelProps) {
  const safeMeeting = useMemo(
    () => normalizeChronosMeetingRuntime(meeting),
    [meeting],
  );
  const latestMinutes = safeMeeting.minutes[0];
  const [minutesProfile, setMinutesProfile] =
    useState<ChronosMinutesProfile>("alinhamento");
  const [minutesView, setMinutesView] = useState<"edit" | "preview">("preview");
  const [minutesDraft, setMinutesDraft] = useState(
    latestMinutes?.content || buildChronosMinutesDraft(safeMeeting),
  );
  const minutesContext = useMemo(
    () => buildChronosMinutesContext(safeMeeting),
    [safeMeeting],
  );
  const hasTranscript = safeMeeting.transcript.length > 0;
  const hasOfficialTranscript = safeMeeting.transcript.some(
    (segment) => isChronosMinutesOfficialTranscriptSource(segment.source),
  );
  const transcribableRecording = useMemo(
    () => selectChronosMinutesTranscribableRecording(safeMeeting.recordings),
    [safeMeeting.recordings],
  );
  const canGenerateMinutes = hasTranscript || Boolean(transcribableRecording);
  const hasMinutesEvidence = hasTranscript;
  const canPersistMinutes = Boolean(minutesDraft.trim()) && hasMinutesEvidence;
  const minutesEvidenceLabel = hasOfficialTranscript
    ? "Transcricao pos-gravacao registrada: ata formatada pode ser gerada pela memoria textual oficial."
    : hasTranscript && transcribableRecording
      ? "Transcricao parcial detectada: gere a transcricao oficial a partir da gravacao."
      : hasTranscript
        ? "Transcricao registrada: ata formatada pode ser gerada pela memoria textual disponivel."
        : transcribableRecording
          ? "Gravacao disponivel: use a Athena para transcrever e gerar a ata em um fluxo unico."
          : "Aguardando gravacao ou transcricao para liberar a ata operacional.";

  useEffect(() => {
    setMinutesDraft(
      latestMinutes?.content || buildChronosMinutesDraft(safeMeeting),
    );
  }, [latestMinutes?.content, safeMeeting]);

  async function saveMinutes(status: ChronosMinutesStatus) {
    if (!canPersistMinutes) {
      return;
    }

    await onUpdate({
      action: "save_minutes",
      content: minutesDraft,
      meetingId: meeting.id,
      status,
    });
  }

  async function runPrimaryMinutesAction() {
    if (!hasOfficialTranscript && transcribableRecording) {
      await onTranscribeExistingRecording({
        meeting: safeMeeting,
        minutesProfile,
        recordingId: transcribableRecording.id,
      });
      return;
    }

    if (hasTranscript) {
      await onGenerateMinutesDraft(safeMeeting, minutesProfile);
    }
  }

  async function deleteLatestMinutes() {
    if (!latestMinutes) {
      return;
    }

    if (
      !window.confirm(
        "Excluir a ata selecionada? Essa acao fica registrada no Chronos.",
      )
    ) {
      return;
    }

    await onUpdate({
      action: "delete_minutes",
      meetingId: meeting.id,
      minutesId: latestMinutes.id,
    });
  }

  return (
    <Surface bordered className="grid min-h-full grid-rows-[auto_minmax(0,1fr)_auto] border-[#d9e0e7] bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-[#edf0f4] p-4">
        <PanelTitle eyebrow="Ata" title="Formalizacao" />
        <Badge variant={chronosMinutesStatusVariant[safeMeeting.minutesStatus]}>
          {chronosMinutesStatusLabels[safeMeeting.minutesStatus]}
        </Badge>
      </div>
      <div className="min-h-0 overflow-y-auto p-4">
        <div className="mb-4 grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {Object.entries(chronosMinutesProfileLabels).map(
                ([profileId, label]) => (
                  <button
                    className={`inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-semibold transition ${
                      minutesProfile === profileId
                        ? "border-[#101820] bg-[#101820] text-white"
                        : "border-[#d9e0e7] bg-white text-[#526078] hover:bg-[#f8fafc]"
                    }`}
                    key={profileId}
                    onClick={() =>
                      setMinutesProfile(profileId as ChronosMinutesProfile)
                    }
                    type="button"
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
            <div className="inline-flex rounded-md border border-[#d9e0e7] bg-[#f8fafc] p-1">
              {[
                ["preview", "Formatada"],
                ["edit", "Texto"],
              ].map(([viewId, label]) => (
                <button
                  className={`h-7 rounded px-2 text-xs font-bold transition ${
                    minutesView === viewId
                      ? "bg-[#101820] text-white"
                      : "text-[#526078] hover:bg-white"
                  }`}
                  key={viewId}
                  onClick={() => setMinutesView(viewId as "edit" | "preview")}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#101820] transition hover:bg-[#f8fafc] disabled:cursor-wait disabled:opacity-60"
              disabled={saving || !canGenerateMinutes}
              onClick={() => void runPrimaryMinutesAction()}
              type="button"
            >
              <Sparkles aria-hidden="true" size={15} />
              {hasTranscript
                ? hasOfficialTranscript
                  ? "Gerar ata da transcricao"
                  : transcribableRecording
                    ? "Transcrever gravacao oficial"
                    : "Gerar ata da transcricao"
                : transcribableRecording
                  ? "Transcrever e gerar ata"
                  : "Aguardando evidencia"}
            </button>
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[#101820] bg-[#101820] px-3 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:border-[#d9e0e7] disabled:bg-[#f8fafc] disabled:text-[#8a95a6]"
              disabled={
                saving || !transcribableRecording || hasOfficialTranscript
              }
              onClick={() =>
                transcribableRecording
                  ? void onTranscribeExistingRecording({
                      meeting,
                      minutesProfile,
                      recordingId: transcribableRecording.id,
                    })
                  : undefined
              }
              type="button"
            >
              <Mic aria-hidden="true" size={15} />
              {transcribableRecording
                ? hasOfficialTranscript
                  ? "Transcricao registrada"
                  : "Transcrever gravacao"
                : "Gravacao pendente"}
            </button>
          </div>
          <div className="rounded-md border border-[#d9e0e7] bg-white px-3 py-2 text-xs font-semibold text-[#526078]">
            {minutesEvidenceLabel}
          </div>
          <div className="rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3 text-sm leading-6 text-[#344054]">
            {safeMeeting.executiveSummary || "Resumo executivo pendente."}
          </div>
        </div>
        {minutesView === "edit" ? (
          <textarea
            className="min-h-[22rem] w-full resize-none rounded-md border border-[#d9e0e7] bg-white p-3 text-sm leading-6 outline-none focus:border-[#A07C3B]"
            onChange={(event) => setMinutesDraft(event.target.value)}
            value={minutesDraft}
          />
        ) : (
          <ChronosMinutesFormattedPreview
            context={minutesContext}
            meeting={safeMeeting}
            minutes={minutesDraft}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#edf0f4] p-3">
        {canDeleteMinutes && latestMinutes ? (
          <button
            aria-label="Excluir ata"
            className="mr-auto inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
            disabled={saving}
            onClick={() => void deleteLatestMinutes()}
            type="button"
          >
            <Trash2 aria-hidden="true" size={15} />
            Excluir
          </button>
        ) : null}
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#101820] transition hover:bg-[#f8fafc] disabled:cursor-wait disabled:opacity-60"
          disabled={saving || !minutesDraft.trim()}
          onClick={() =>
            openChronosMinutesPrintWindow({
              meeting: safeMeeting,
              minutes: minutesDraft,
            })
          }
          type="button"
        >
          <Download aria-hidden="true" size={15} />
          PDF
        </button>
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#101820] transition hover:bg-[#f8fafc] disabled:cursor-wait disabled:opacity-60"
          disabled={saving || !canPersistMinutes}
          onClick={() => void saveMinutes("in_review")}
          type="button"
        >
          <Save aria-hidden="true" size={15} />
          Revisao
        </button>
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md bg-[#101820] px-3 text-sm font-semibold text-white transition hover:bg-[#1f2937] disabled:cursor-wait disabled:opacity-60"
          disabled={saving || !canPersistMinutes}
          onClick={() => void saveMinutes("approved")}
          type="button"
        >
          <ShieldCheck aria-hidden="true" size={15} />
          Aprovar
        </button>
      </div>
    </Surface>
  );
}

function selectChronosMinutesTranscribableRecording(
  recordings: ChronosMeeting["recordings"],
) {
  return (
    [...recordings]
      .filter((recording) => {
        const recordingUrl = recording.downloadUrl ?? recording.playbackUrl;

        return (
          recording.status === "available" &&
          Boolean(recordingUrl && recordingUrl !== "#")
        );
      })
      .sort((firstRecording, secondRecording) => {
        const firstPriority =
          getChronosMinutesRecordingTranscriptionPriority(firstRecording);
        const secondPriority =
          getChronosMinutesRecordingTranscriptionPriority(secondRecording);

        if (firstPriority !== secondPriority) {
          return secondPriority - firstPriority;
        }

        return (
          getChronosMinutesRecordingSortDate(secondRecording) -
          getChronosMinutesRecordingSortDate(firstRecording)
        );
      })[0] ?? null
  );
}

function getChronosMinutesRecordingTranscriptionPriority(
  recording: ChronosMeeting["recordings"][number],
) {
  const metadata = recording.metadata ?? {};
  const source = typeof metadata.source === "string" ? metadata.source : "";
  const kind = typeof metadata.kind === "string" ? metadata.kind : "";
  const storagePath = recording.storagePath?.toLowerCase() ?? "";
  const isAudio = isChronosMinutesAudioRecording(recording);

  if (
    source === "chronos-livekit-egress-participant-audio" ||
    kind === "participant-audio" ||
    (isAudio && storagePath.includes("/participants/"))
  ) {
    return 2;
  }

  return isAudio ? 1 : 0;
}

function isChronosMinutesAudioRecording(
  recording: ChronosMeeting["recordings"][number],
) {
  const mimeType = recording.mimeType?.toLowerCase() ?? "";
  const fileName = recording.fileName?.toLowerCase() ?? "";
  const storagePath = recording.storagePath?.toLowerCase() ?? "";

  return (
    mimeType.startsWith("audio/") ||
    fileName.endsWith("-audio.mp4") ||
    fileName.endsWith(".ogg") ||
    fileName.endsWith(".mp3") ||
    fileName.endsWith(".m4a") ||
    fileName.endsWith(".wav") ||
    storagePath.endsWith(".ogg") ||
    storagePath.endsWith(".mp3") ||
    storagePath.endsWith(".m4a") ||
    storagePath.endsWith(".wav") ||
    (storagePath.includes("-audio-") && storagePath.endsWith(".mp4"))
  );
}

function getChronosMinutesRecordingSortDate(
  recording: ChronosMeeting["recordings"][number],
) {
  return (
    parseChronosMinutesRecordingDate(recording.stoppedAt) ||
    parseChronosMinutesRecordingDate(recording.startedAt) ||
    parseChronosMinutesRecordingDate(recording.storagePath)
  );
}

function parseChronosMinutesRecordingDate(value?: string | null) {
  const timestamp = value ? Date.parse(value) : NaN;

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isChronosMinutesOfficialTranscriptSource(source?: string | null) {
  return source === "openai" || source === "whereby";
}
