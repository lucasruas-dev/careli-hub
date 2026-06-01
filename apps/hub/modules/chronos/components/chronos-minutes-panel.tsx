import { buildChronosMinutesContext } from "@/lib/chronos/minutes";
import { buildChronosMinutesDraft } from "@/lib/chronos/minutes-draft";
import { openChronosMinutesPrintWindow } from "@/lib/chronos/minutes-preview";
import {
  chronosMinutesProfileLabels,
  chronosMinutesStatusLabels,
  type ChronosMeeting,
  type ChronosMinutesProfile,
  type ChronosMinutesStatus,
  type ChronosUpdateInput,
} from "@/lib/chronos/types";
import { Badge, Surface } from "@repo/uix";
import { Download, Loader2, Mic, Save, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
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
  }) => Promise<void>;
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
  const meetingMinutes = Array.isArray(meeting.minutes) ? meeting.minutes : [];
  const meetingTranscript = Array.isArray(meeting.transcript)
    ? meeting.transcript
    : [];
  const latestMinutes = meetingMinutes[0];
  const latestMinutesContent =
    typeof latestMinutes?.content === "string" ? latestMinutes.content : "";
  const executiveSummaryText =
    typeof meeting.executiveSummary === "string"
      ? meeting.executiveSummary.trim()
      : "";
  const [minutesProfile, setMinutesProfile] =
    useState<ChronosMinutesProfile>("alinhamento");
  const [minutesView, setMinutesView] = useState<"edit" | "preview">("preview");
  const [minutesDraft, setMinutesDraft] = useState(
    latestMinutesContent || buildChronosMinutesDraft(meeting),
  );
  const minutesContext = useMemo(
    () => buildChronosMinutesContext(meeting),
    [meeting],
  );
  const hasTranscript = meetingTranscript.length > 0;
  const transcribableRecording = useMemo(
    () => {
      const recordings = Array.isArray(meeting.recordings)
        ? meeting.recordings
        : [];

      return (
        recordings.find(
          (recording) =>
            recording.status === "available" &&
            Boolean(recording.downloadUrl ?? recording.playbackUrl),
        ) ?? null
      );
    },
    [meeting.recordings],
  );
  const canGenerateMinutes = hasTranscript || Boolean(transcribableRecording);
  const minutesStatusLabel =
    chronosMinutesStatusLabels[meeting.minutesStatus] ?? "Nao iniciada";
  const minutesStatusVariant =
    chronosMinutesStatusVariant[meeting.minutesStatus] ?? "neutral";
  const minutesEvidenceLabel = hasTranscript
    ? "Transcricao registrada: ata formatada pode ser gerada pela memoria textual."
    : transcribableRecording
      ? "Gravacao disponivel: transcreva para a Athena montar a ata com mais precisao."
      : "Aguardando gravacao ou transcricao para liberar a ata operacional.";

  useEffect(() => {
    setMinutesDraft(latestMinutesContent || buildChronosMinutesDraft(meeting));
  }, [latestMinutesContent, meeting]);

  async function saveMinutes(status: ChronosMinutesStatus) {
    await onUpdate({
      action: "save_minutes",
      content: minutesDraft,
      meetingId: meeting.id,
      status,
    });
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
        <Badge variant={minutesStatusVariant}>{minutesStatusLabel}</Badge>
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
              onClick={() => void onGenerateMinutesDraft(meeting, minutesProfile)}
              type="button"
            >
              {saving ? (
                <Loader2 aria-hidden="true" className="animate-spin" size={15} />
              ) : (
                <Sparkles aria-hidden="true" size={15} />
              )}
              {hasTranscript ? "Gerar ata da transcricao" : "Gerar ata Athena"}
            </button>
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[#101820] bg-[#101820] px-3 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:border-[#d9e0e7] disabled:bg-[#f8fafc] disabled:text-[#8a95a6]"
              disabled={saving || !transcribableRecording}
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
              {saving ? (
                <Loader2 aria-hidden="true" className="animate-spin" size={15} />
              ) : (
                <Mic aria-hidden="true" size={15} />
              )}
              {transcribableRecording
                ? saving
                  ? "Transcrevendo"
                  : "Transcrever gravacao"
                : hasTranscript
                  ? "Transcricao registrada"
                  : "Gravacao pendente"}
            </button>
          </div>
          <div className="rounded-md border border-[#d9e0e7] bg-white px-3 py-2 text-xs font-semibold text-[#526078]">
            {minutesEvidenceLabel}
          </div>
          <div className="rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3 text-sm leading-6 text-[#344054]">
            {executiveSummaryText || "Resumo executivo pendente."}
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
            meeting={meeting}
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
          disabled={saving}
          onClick={() =>
            openChronosMinutesPrintWindow({ meeting, minutes: minutesDraft })
          }
          type="button"
        >
          <Download aria-hidden="true" size={15} />
          Gerar PDF
        </button>
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#101820] transition hover:bg-[#f8fafc] disabled:cursor-wait disabled:opacity-60"
          disabled={saving}
          onClick={() => void saveMinutes("in_review")}
          type="button"
        >
          <Save aria-hidden="true" size={15} />
          Revisao
        </button>
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md bg-[#101820] px-3 text-sm font-semibold text-white transition hover:bg-[#1f2937] disabled:cursor-wait disabled:opacity-60"
          disabled={saving}
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
