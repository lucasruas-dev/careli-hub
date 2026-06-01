import { formatChronosDateTime } from "@/lib/chronos/format";
import type { ChronosMeeting, ChronosUpdateInput } from "@/lib/chronos/types";
import { Surface } from "@repo/uix";
import { ChevronDown, ChevronUp, Mic } from "lucide-react";
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
  const transcript = Array.isArray(meeting.transcript) ? meeting.transcript : [];

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

  return (
    <Surface bordered className="grid min-h-full grid-rows-[auto_auto_minmax(0,1fr)] border-[#d9e0e7] bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-[#edf0f4] p-4">
        <PanelTitle eyebrow="Transcricao" title="Memoria textual" />
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#526078] transition hover:bg-[#f8fafc] hover:text-[#101820]"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded ? (
            <ChevronUp aria-hidden="true" size={13} />
          ) : (
            <ChevronDown aria-hidden="true" size={13} />
          )}
          {expanded ? "Ocultar" : `Expandir (${transcript.length})`}
        </button>
      </div>
      {expanded ? (
        <>
          <form
            className="grid gap-2 border-b border-[#edf0f4] bg-[#fafbfc] p-3"
            onSubmit={handleSubmit}
          >
            <input
              className="h-9 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm outline-none focus:border-[#A07C3B]"
              onChange={(event) => setSpeakerLabel(event.target.value)}
              placeholder="Participante"
              value={speakerLabel}
            />
            <textarea
              className="min-h-24 resize-none rounded-md border border-[#d9e0e7] bg-white p-3 text-sm outline-none focus:border-[#A07C3B]"
              onChange={(event) => setContent(event.target.value)}
              placeholder="Trecho da transcricao"
              required
              value={content}
            />
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#101820] px-3 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60"
              disabled={saving}
              type="submit"
            >
              <Mic aria-hidden="true" size={15} />
              Registrar
            </button>
          </form>
          <div className="min-h-0 overflow-y-auto p-3">
            {transcript.map((segment) => (
              <div
                className="mb-2 rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3"
                key={segment.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase text-[#667085]">
                    {readChronosRenderableText(segment.speakerLabel) ??
                      "Participante"}
                  </span>
                  <span className="text-xs text-[#98a2b3]">
                    {formatChronosDateTime(segment.createdAt)}
                  </span>
                </div>
                <p className="m-0 mt-2 text-sm leading-6 text-[#344054]">
                  {readChronosRenderableText(segment.content) ??
                    "Trecho sem conteudo textual."}
                </p>
              </div>
            ))}
            {transcript.length === 0 ? (
              <EmptyPanel text="Nenhum trecho transcrito." />
            ) : null}
          </div>
        </>
      ) : (
        <div className="p-3 text-sm font-semibold text-[#667085]">
          {transcript.length} trecho(s) transcrito(s) oculto(s).
        </div>
      )}
    </Surface>
  );
}

function readChronosRenderableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
