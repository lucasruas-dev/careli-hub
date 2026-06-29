"use client";

import { useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import {
  CalendarClock,
  CheckCircle2,
  CircleStop,
  ClipboardList,
  Clock3,
  LockKeyhole,
  Mic,
  Paperclip,
  Send,
  Smile,
  Sparkles,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { Tooltip } from "@repo/uix";

import {
  AgendaQuickCreateModal,
  type AgendaQuickCreateContext,
} from "@/modules/agenda/AgendaQuickCreateModal";

export type IrisConversationComposerChecklistItem = {
  id: string;
  label: string;
  ok: boolean;
};

export type IrisConversationComposerWindow = {
  label: string;
  open: boolean;
};

export function IrisConversationComposerActions({
  agendaContext,
  attendantOpen = false,
  blockedTooltip,
  canSendFreeForm,
  cobrancaMode = false,
  composerReady,
  customerServiceWindow,
  draft,
  editingMessageBody,
  emojiOptions,
  emojiPickerOpen,
  emojiPickerRef,
  lockedByCaca = false,
  onOpenNotes,
  onCancelComposerContext,
  onComposerKeyDown,
  onDraftChange,
  onInsertEmoji,
  onSendMessage,
  onToggleAttendant,
  onStartAudioRecording,
  onStopAudioRecording,
  onCancelAudio,
  onSendAudioPreview,
  audioPreviewUrl = null,
  recordingElapsedLabel = "0:00",
  onToggleEmojiPicker,
  operationReady,
  recordingAudio,
  replyToMessageBody,
  sending,
  textareaRef,
  ticketChecklist,
  ticketClosed,
}: {
  agendaContext?: AgendaQuickCreateContext | null;
  attendantOpen?: boolean;
  blockedTooltip: string;
  canSendFreeForm: boolean;
  cobrancaMode?: boolean;
  composerReady: boolean;
  customerServiceWindow: IrisConversationComposerWindow;
  draft: string;
  editingMessageBody?: string | null;
  emojiOptions: string[];
  emojiPickerOpen: boolean;
  emojiPickerRef: RefObject<HTMLDivElement | null>;
  lockedByCaca?: boolean;
  onOpenNotes?: () => void;
  onCancelComposerContext: () => void;
  onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onDraftChange: (value: string) => void;
  onInsertEmoji: (emoji: string) => void;
  onSendMessage: () => void;
  onToggleAttendant?: () => void;
  onStartAudioRecording: () => void;
  onStopAudioRecording: () => void;
  onCancelAudio: () => void;
  onSendAudioPreview: () => void;
  audioPreviewUrl?: string | null;
  recordingElapsedLabel?: string;
  onToggleEmojiPicker: () => void;
  operationReady: boolean;
  recordingAudio: boolean;
  replyToMessageBody?: string | null;
  sending: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  ticketChecklist: IrisConversationComposerChecklistItem[];
  ticketClosed: boolean;
}) {
  const [agendaModalKind, setAgendaModalKind] = useState<
    "retorno" | "tarefa" | null
  >(null);
  const hasComposerContext = Boolean(editingMessageBody || replyToMessageBody);
  const composerContextBody =
    editingMessageBody ?? replyToMessageBody ?? "Mensagem selecionada";
  const composerContextLabel = editingMessageBody
    ? "Editando mensagem"
    : "Respondendo";
  const composerPlaceholder = composerReady
    ? editingMessageBody
      ? "Editar mensagem no Iris..."
      : "Escrever mensagem WhatsApp..."
    : ticketClosed
      ? "Ticket encerrado"
      : "Aguardando janela WhatsApp";
  const sendLabel = composerReady
    ? editingMessageBody
      ? "Salvar edicao"
      : "Enviar mensagem"
    : blockedTooltip;

  return (
    <footer className="shrink-0 border-t border-slate-100 bg-white p-2.5">
      {ticketClosed ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
            <LockKeyhole className="size-3.5" aria-hidden="true" />
            <span>{cobrancaMode ? "Atendimento encerrado" : "Ticket encerrado"}</span>
          </div>
          {cobrancaMode ? null : <TicketChecklist items={ticketChecklist} />}
        </div>
      ) : null}

      {!ticketClosed && lockedByCaca ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-[#A07C3B]/25 bg-[#fbf6ec] px-3 py-2 text-xs font-semibold text-[#7A5E2C]">
          <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            Atendimento conduzido pela Caca. Voce pode acompanhar e direcionar, mas
            nao enviar mensagens (use Direcionar se precisar intervir).
          </span>
        </div>
      ) : null}

      {!ticketClosed && !lockedByCaca ? (
        <div
          className={[
            "mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2",
            customerServiceWindow.open
              ? "border-emerald-100 bg-emerald-50"
              : "border-amber-200 bg-amber-50",
          ].join(" ")}
        >
          <div
            className={[
              "flex min-w-0 items-center gap-2 text-xs font-semibold",
              customerServiceWindow.open
                ? "text-emerald-700"
                : "text-amber-800",
            ].join(" ")}
          >
            {customerServiceWindow.open ? (
              <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <LockKeyhole className="size-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0">{customerServiceWindow.label}</span>
          </div>
        </div>
      ) : null}

      <div className="mb-2 flex items-center justify-between gap-2">
        <OperationalToolbar
          disabled={!operationReady}
          onCreate={(kind) => setAgendaModalKind(kind)}
        />
        <div className="flex items-center gap-1.5">
          {onOpenNotes ? (
            <Tooltip content="Notas do atendimento" placement="top">
              <button
                type="button"
                onClick={onOpenNotes}
                aria-label="Notas do atendimento"
                className="flex size-8 items-center justify-center rounded-lg border border-slate-200/80 bg-white text-slate-500 transition-colors hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]"
              >
                <StickyNote className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
          ) : null}
          {onToggleAttendant ? (
            <Tooltip content="Athena" placement="top">
              <button
                type="button"
                onClick={onToggleAttendant}
                disabled={ticketClosed}
                aria-label="Athena — assistente"
                className={[
                  "flex size-8 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                  attendantOpen
                    ? "border-[#A07C3B]/40 bg-[#A07C3B] text-white hover:bg-[#8E6F35]"
                    : "border-[#A07C3B]/25 bg-[#fbf6ec] text-[#7A5E2C] hover:bg-[#f4ebdc]",
                ].join(" ")}
              >
                <Sparkles className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {hasComposerContext ? (
        <div className="mb-2 flex items-start justify-between gap-3 rounded-lg border border-[#eadcc2] bg-[#fbf6ec] px-3 py-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-normal text-[#7A5E2C]">
              {composerContextLabel}
            </p>
            <p className="mt-0.5 line-clamp-1 text-xs font-medium text-slate-600">
              {composerContextBody}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelComposerContext}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white hover:text-[#7A5E2C]"
            aria-label="Cancelar contexto"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div ref={emojiPickerRef} className="relative">
        {emojiPickerOpen && composerReady ? (
          <div className="absolute bottom-full left-0 z-20 mb-2 grid w-56 grid-cols-6 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-[0_18px_45px_rgba(15,23,42,0.14)]">
            {emojiOptions.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onInsertEmoji(emoji)}
                className="flex size-8 items-center justify-center rounded-lg text-base transition-colors hover:bg-slate-100"
                aria-label={`Inserir ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}

        <div
          className={[
            "flex items-center gap-2 rounded-xl border border-slate-200/70 bg-slate-50/70 p-2 transition-opacity",
            composerReady ? "opacity-100" : "opacity-55",
          ].join(" ")}
        >
          {recordingAudio ? (
            <div className="flex w-full items-center gap-3 px-1.5 py-1">
              <span className="relative flex size-3 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex size-3 rounded-full bg-rose-500" />
              </span>
              <span className="text-sm font-medium text-slate-600">
                Gravando
              </span>
              <span className="font-mono text-sm tabular-nums text-rose-500">
                {recordingElapsedLabel}
              </span>
              <span className="flex flex-1 items-end gap-0.5 overflow-hidden">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((bar) => (
                  <span
                    key={bar}
                    className="w-1 animate-pulse rounded-full bg-rose-300"
                    style={{
                      animationDelay: `${bar * 110}ms`,
                      height: `${8 + ((bar * 5) % 14)}px`,
                    }}
                  />
                ))}
              </span>
              <Tooltip content="Cancelar" placement="top">
                <button
                  type="button"
                  onClick={onCancelAudio}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-rose-500"
                  aria-label="Cancelar gravacao"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip content="Parar" placement="top">
                <button
                  type="button"
                  onClick={onStopAudioRecording}
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#A07C3B] text-white transition-colors hover:bg-[#8E6F35]"
                  aria-label="Parar gravacao"
                >
                  <CircleStop className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            </div>
          ) : audioPreviewUrl ? (
            <div className="flex w-full items-center gap-2 px-1">
              <Tooltip content="Descartar" placement="top">
                <button
                  type="button"
                  onClick={onCancelAudio}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-rose-500"
                  aria-label="Descartar audio"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
              <audio
                controls
                src={audioPreviewUrl}
                className="h-9 min-w-0 flex-1"
              />
              <Tooltip content="Enviar audio" placement="top">
                <button
                  type="button"
                  disabled={sending}
                  onClick={onSendAudioPreview}
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#A07C3B] text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-slate-300"
                  aria-label="Enviar audio"
                >
                  <Send className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            </div>
          ) : (
            <>
              <ComposerIconButton
                disabled={!composerReady}
                label="Emoji"
                onClick={onToggleEmojiPicker}
              >
                <Smile className="size-4" aria-hidden="true" />
              </ComposerIconButton>
              <ComposerIconButton
                disabled
                label="Anexos em breve"
                onClick={() => undefined}
              >
                <Paperclip className="size-4" aria-hidden="true" />
              </ComposerIconButton>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder={composerPlaceholder}
                disabled={!composerReady}
                className="min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
              <ComposerIconButton
                disabled={!canSendFreeForm || sending}
                label="Gravar audio"
                onClick={onStartAudioRecording}
              >
                <Mic className="size-4" aria-hidden="true" />
              </ComposerIconButton>
              <Tooltip content={sendLabel} placement="top">
                <button
                  type="button"
                  disabled={sending || !draft.trim() || !composerReady}
                  onClick={onSendMessage}
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#A07C3B] text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-slate-300"
                  aria-label={sendLabel}
                >
                  <Send className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {agendaModalKind && agendaContext ? (
        <AgendaQuickCreateModal
          context={agendaContext}
          kind={agendaModalKind}
          onClose={() => setAgendaModalKind(null)}
        />
      ) : null}
    </footer>
  );
}

function OperationalToolbar({
  disabled,
  onCreate,
}: {
  disabled: boolean;
  onCreate: (kind: "retorno" | "tarefa") => void;
}) {
  const tools: Array<{
    icon: typeof CalendarClock;
    kind: "retorno" | "tarefa";
    label: string;
  }> = [
    { icon: CalendarClock, kind: "retorno", label: "Retorno" },
    { icon: ClipboardList, kind: "tarefa", label: "Tarefa" },
  ];

  return (
    <div className="flex items-center gap-1">
      {tools.map((tool) => (
        <Tooltip content={tool.label} key={tool.label} placement="top">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onCreate(tool.kind)}
            aria-label={tool.label}
            className="flex size-8 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-400 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <tool.icon className="size-4" aria-hidden="true" />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

function ComposerIconButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} placement="top">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-label={label}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white hover:text-[#7A5E2C] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {children}
      </button>
    </Tooltip>
  );
}

function TicketChecklist({
  compact = false,
  items,
}: {
  compact?: boolean;
  items: IrisConversationComposerChecklistItem[];
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {items.map((item) => (
        <span
          key={item.id}
          className={[
            "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ring-1",
            item.ok
              ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
              : "bg-white text-amber-700 ring-amber-200",
            compact ? "py-0.5" : "",
          ].join(" ")}
        >
          <CheckCircle2 className="size-3" aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}
