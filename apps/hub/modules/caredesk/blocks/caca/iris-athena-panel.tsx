"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Coins,
  CornerDownLeft,
  Copy,
  FileText,
  ListChecks,
  Loader2,
  Mic,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { Tooltip } from "@repo/uix";

export type AthenaAction =
  | "ajustar_tom"
  | "boletos"
  | "livre"
  | "resumir"
  | "tickets"
  | "total";

export type AthenaMessage = {
  audioUrl?: string;
  id: string;
  role: "athena" | "operator";
  text: string;
};

const SHORTCUTS: { action: AthenaAction; icon: typeof Coins; label: string }[] = [
  { action: "boletos", icon: FileText, label: "Enviar boletos" },
  { action: "total", icon: Coins, label: "Total em aberto" },
  { action: "resumir", icon: ListChecks, label: "Resumir conversa" },
];
// Iris (atendimento): a Athena traz a lista de tickets do cliente.
const IRIS_SHORTCUTS: { action: AthenaAction; icon: typeof Coins; label: string }[] =
  [{ action: "tickets", icon: ListChecks, label: "Lista de tickets" }];

// ATHENA — assistente do operador (Hades). UI discreta, estilo chat, junto ao
// compositor. Nunca envia sozinha: cada resposta vai pro rascunho.
export function IrisAthenaPanel({
  cobrancaMode = false,
  contextMessage,
  disabled,
  loading,
  onClearContext,
  onClose,
  onPromptChange,
  onSend,
  onTranscribe,
  onUseReply,
  prompt,
  thread,
}: {
  cobrancaMode?: boolean;
  contextMessage?: string | null;
  disabled: boolean;
  loading: boolean;
  onClearContext: () => void;
  onClose: () => void;
  onPromptChange: (value: string) => void;
  onSend: (
    action: AthenaAction,
    promptOverride?: string,
    audioUrl?: string,
  ) => void;
  onTranscribe: (audio: Blob) => Promise<string>;
  onUseReply: (text: string) => void;
  prompt: string;
  thread: AthenaMessage[];
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Rola pro fim quando chega mensagem nova ou a Athena comeca a pensar.
  useEffect(() => {
    const node = threadRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [thread, loading]);

  function submitFree() {
    if (!prompt.trim() || loading || disabled) return;
    onSend("livre");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitFree();
    }
  }

  async function copy(message: AthenaMessage) {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // clipboard pode estar bloqueado; ignora.
    }
  }

  // Audio: grava no navegador, transcreve por baixo (Whisper) e manda o texto
  // pra Athena — o audio em si vira bolha de voz na conversa.
  async function startRecording() {
    if (disabled || loading || transcribing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        if (blob.size === 0) return;
        const audioUrl = URL.createObjectURL(blob);
        setTranscribing(true);
        try {
          const text = await onTranscribe(blob);
          onSend("livre", text || "(não consegui transcrever o áudio)", audioUrl);
        } finally {
          setTranscribing(false);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch {
      setRecording(false);
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setRecording(false);
  }

  function toggleRecording() {
    if (recording) {
      stopRecording();
    } else {
      void startRecording();
    }
  }

  return (
    <div className="flex max-h-[64vh] w-full flex-col overflow-hidden rounded-xl border border-[#A07C3B]/30 bg-surface shadow-[0_24px_60px_rgba(15,23,42,0.20)]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#A07C3B]/15 bg-[#A07C3B]/8 px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-[#A07C3B] text-white">
              <Sparkles className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-[#5E481F]">Athena</p>
              <p className="text-[10px] text-[#7A5E2C]">assistente do operador</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar Athena"
            className="flex size-8 items-center justify-center rounded-lg text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/12"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-line px-3 py-2.5">
          {(cobrancaMode ? SHORTCUTS : IRIS_SHORTCUTS).map((shortcut) => (
            <Tooltip key={shortcut.action} content={shortcut.label} placement="top">
              <button
                type="button"
                onClick={() => onSend(shortcut.action)}
                disabled={disabled || loading}
                aria-label={shortcut.label}
                className="flex size-7 items-center justify-center rounded-md border border-line/80 bg-surface text-ink-muted transition-colors hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <shortcut.icon className="size-3.5" aria-hidden="true" />
              </button>
            </Tooltip>
          ))}
        </div>

        {contextMessage ? (
          <div className="flex shrink-0 items-start gap-2 border-b border-line bg-[#A07C3B]/6 px-3 py-2">
            <span className="mt-0.5 shrink-0 text-[10px] font-semibold uppercase tracking-normal text-[#7A5E2C]">
              Sobre
            </span>
            <p className="line-clamp-2 min-w-0 flex-1 text-[11px] italic text-ink-soft">
              “{contextMessage}”
            </p>
            <button
              type="button"
              onClick={onClearContext}
              aria-label="Remover contexto da mensagem"
              className="shrink-0 text-ink-muted transition-colors hover:text-[#7A5E2C]"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <div
          ref={threadRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-subtle/40 p-3 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]"
        >
          {thread.length === 0 && !loading ? (
            <p className="px-1 py-3 text-center text-xs text-ink-muted">
              Peça à Athena para montar uma mensagem, resumir a conversa ou tirar
              uma dúvida sobre o cliente.
            </p>
          ) : null}

          {thread.map((message) =>
            message.role === "operator" ? (
              <div
                key={message.id}
                className="ml-auto max-w-[80%] rounded-[10px_10px_2px_10px] border border-line/70 bg-surface px-3 py-2 text-xs leading-relaxed text-ink"
              >
                {message.audioUrl ? (
                  <>
                    <audio
                      controls
                      src={message.audioUrl}
                      className="h-8 w-full"
                    />
                    {message.text ? (
                      <p className="mt-1 text-[11px] italic text-ink-muted">
                        “{message.text}”
                      </p>
                    ) : null}
                  </>
                ) : (
                  message.text
                )}
              </div>
            ) : (
              <div key={message.id} className="max-w-[88%]">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="flex size-4 items-center justify-center rounded bg-[#A07C3B]/12 text-[#7A5E2C]">
                    <Sparkles className="size-2.5" aria-hidden="true" />
                  </span>
                  <span className="text-[10px] font-semibold text-[#7A5E2C]">
                    Athena
                  </span>
                </div>
                <div className="rounded-[2px_10px_10px_10px] border border-line/70 bg-surface px-3 py-2.5">
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink">
                    {message.text}
                  </p>
                  <div className="mt-2 flex gap-1.5">
                    <Tooltip content="Usar no rascunho" placement="top">
                      <button
                        type="button"
                        onClick={() => onUseReply(message.text)}
                        aria-label="Usar no rascunho"
                        className="flex size-7 items-center justify-center rounded-md bg-[#A07C3B] text-white transition-colors hover:bg-[#8E6F35]"
                      >
                        <CornerDownLeft className="size-3.5" aria-hidden="true" />
                      </button>
                    </Tooltip>
                    <Tooltip
                      content={copiedId === message.id ? "Copiado" : "Copiar"}
                      placement="top"
                    >
                      <button
                        type="button"
                        onClick={() => void copy(message)}
                        aria-label="Copiar"
                        className="flex size-7 items-center justify-center rounded-md border border-line/80 text-ink-muted transition-colors hover:bg-subtle"
                      >
                        <Copy className="size-3.5" aria-hidden="true" />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              </div>
            ),
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-[11px] text-[#7A5E2C]">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Athena está pensando…
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-end gap-2 border-t border-line px-3 py-2.5">
          <Sparkles className="mb-1.5 size-4 shrink-0 text-[#A07C3B]" aria-hidden="true" />
          <textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled || loading}
            rows={1}
            placeholder={recording ? "Gravando áudio…" : "Peça algo à Athena…"}
            className="max-h-24 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-sm text-ink outline-none placeholder:text-ink-muted disabled:cursor-not-allowed"
          />
          <Tooltip content={recording ? "Parar e enviar" : "Gravar áudio"} placement="top">
            <button
              type="button"
              onClick={toggleRecording}
              disabled={disabled || loading || transcribing}
              aria-label={recording ? "Parar gravação" : "Gravar áudio para a Athena"}
              className={[
                "flex size-9 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                recording
                  ? "border-rose-200 bg-rose-50 text-rose-600"
                  : "border-line/80 text-ink-muted hover:bg-subtle hover:text-[#7A5E2C]",
              ].join(" ")}
            >
              {transcribing ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : recording ? (
                <Square className="size-3.5" aria-hidden="true" />
              ) : (
                <Mic className="size-4" aria-hidden="true" />
              )}
            </button>
          </Tooltip>
          <button
            type="button"
            onClick={submitFree}
            disabled={disabled || loading || !prompt.trim()}
            aria-label="Enviar para a Athena"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B] text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-subtle"
          >
            <Send className="size-4" aria-hidden="true" />
          </button>
        </div>
    </div>
  );
}
