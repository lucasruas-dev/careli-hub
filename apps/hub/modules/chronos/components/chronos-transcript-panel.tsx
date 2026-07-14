import { formatChronosDateTime } from "@/lib/chronos/format";
import type { ChronosMeeting, ChronosUpdateInput } from "@/lib/chronos/types";
import { Surface } from "@repo/uix";
import { ChevronDown, ChevronUp, Download, FileText, Mic } from "lucide-react";
import { useState, type FormEvent } from "react";
import { EmptyPanel, PanelTitle } from "./chronos-panels";

type TranscriptPanelProps = {
  meeting: ChronosMeeting;
  onUpdate: (input: ChronosUpdateInput) => Promise<void>;
  saving: boolean;
  userName: string;
};

export function TranscriptPanel({
  meeting,
  onUpdate,
  saving,
  userName,
}: TranscriptPanelProps) {
  const [speakerLabel, setSpeakerLabel] = useState(userName);
  const [content, setContent] = useState("");
  const [expanded, setExpanded] = useState(true);
  const transcriptPreview = meeting.transcript.slice(0, 8);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await onUpdate({
      action: "add_transcript",
      content,
      meetingId: meeting.id,
      speakerLabel,
    });
    setContent("");
  }

  function handleDownloadTranscript() {
    if (meeting.transcript.length === 0) {
      return;
    }

    const lines = meeting.transcript.map((segment) =>
      [
        `[${formatChronosDateTime(segment.createdAt)}]`,
        segment.speakerLabel ?? "Participante",
        segment.content,
      ].join(" "),
    );
    const blob = new Blob(
      [
        [
          `Transcricao Chronos - ${meeting.protocol}`,
          meeting.title,
          "",
          ...lines,
        ].join("\n"),
      ],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `${meeting.protocol || "chronos"}-transcricao.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Surface bordered className="grid min-h-full grid-rows-[auto_auto_minmax(0,1fr)] border-line bg-surface">
      <div className="flex items-start justify-between gap-3 border-b border-line p-4">
        <PanelTitle eyebrow="Transcricao" title="Memoria textual" />
        <div className="flex flex-wrap justify-end gap-2">
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs font-semibold text-ink-muted transition hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            disabled={meeting.transcript.length === 0}
            onClick={handleDownloadTranscript}
            type="button"
          >
            <Download aria-hidden="true" size={13} />
            Baixar
          </button>
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs font-semibold text-ink-muted transition hover:bg-subtle hover:text-ink"
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            {expanded ? (
              <ChevronUp aria-hidden="true" size={13} />
            ) : (
              <ChevronDown aria-hidden="true" size={13} />
            )}
            {expanded ? "Ocultar" : `Expandir (${meeting.transcript.length})`}
          </button>
        </div>
      </div>
      {expanded ? (
        <>
          {meeting.transcript.length > 0 ? (
            <div className="border-b border-line bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-md bg-inverse text-[#A07C3B]">
                    <FileText aria-hidden="true" size={14} />
                  </span>
                  <div>
                    <p className="m-0 text-xs font-bold uppercase text-ink-muted">
                      Previa
                    </p>
                    <strong className="text-sm text-ink">
                      Transcricao consultavel
                    </strong>
                  </div>
                </div>
                <span className="rounded-full border border-line bg-subtle px-2.5 py-1 text-xs font-semibold text-ink-muted">
                  {meeting.transcript.length} trecho(s)
                </span>
              </div>
              <div className="mt-3 max-h-56 overflow-y-auto rounded-md border border-line bg-subtle">
                {transcriptPreview.map((segment) => (
                  <div
                    className="grid gap-1 border-b border-line px-3 py-2 last:border-b-0"
                    key={`preview-${segment.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-bold uppercase text-ink-muted">
                        {segment.speakerLabel ?? "Participante"}
                      </span>
                      <span className="shrink-0 text-xs text-ink-muted">
                        {formatChronosDateTime(segment.createdAt)}
                      </span>
                    </div>
                    <p className="m-0 line-clamp-2 text-sm leading-5 text-ink">
                      {segment.content}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <form
            className="grid gap-2 border-b border-line bg-subtle p-3"
            onSubmit={handleSubmit}
          >
            <input
              className="h-9 rounded-md border border-line bg-surface px-3 text-sm outline-none focus:border-[#A07C3B]"
              onChange={(event) => setSpeakerLabel(event.target.value)}
              placeholder="Participante"
              value={speakerLabel}
            />
            <textarea
              className="min-h-24 resize-none rounded-md border border-line bg-surface p-3 text-sm outline-none focus:border-[#A07C3B]"
              onChange={(event) => setContent(event.target.value)}
              placeholder="Trecho da transcricao"
              required
              value={content}
            />
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-inverse px-3 text-sm font-semibold text-brand-ink disabled:cursor-wait disabled:opacity-60"
              disabled={saving}
              type="submit"
            >
              <Mic aria-hidden="true" size={15} />
              Registrar
            </button>
          </form>
          <div className="min-h-0 overflow-y-auto p-3">
            {meeting.transcript.map((segment) => (
              <div
                className="mb-2 rounded-md border border-line bg-subtle p-3"
                key={segment.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase text-ink-muted">
                    {segment.speakerLabel ?? "Participante"}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {formatChronosDateTime(segment.createdAt)}
                  </span>
                </div>
                <p className="m-0 mt-2 text-sm leading-6 text-ink">
                  {segment.content}
                </p>
              </div>
            ))}
            {meeting.transcript.length === 0 ? (
              <EmptyPanel text="Nenhum trecho transcrito." />
            ) : null}
          </div>
        </>
      ) : (
        <div className="p-3 text-sm font-semibold text-ink-muted">
          {meeting.transcript.length} trecho(s) transcrito(s) oculto(s).
        </div>
      )}
    </Surface>
  );
}
