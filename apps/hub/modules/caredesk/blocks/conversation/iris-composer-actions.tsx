"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  CalendarClock,
  CheckCircle2,
  CircleStop,
  ClipboardList,
  Clock3,
  FileText,
  Headset,
  Loader2,
  LockKeyhole,
  MessageSquare,
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
  channelKind = "whatsapp",
  cobrancaMode = false,
  composerMode = "reply",
  composerReady,
  customerServiceWindow,
  draft,
  mustWhisper = false,
  onComposerModeChange,
  editingMessageBody,
  emojiOptions,
  emojiPickerOpen,
  emojiPickerRef,
  lockedByCaca = false,
  onSendAsCaca,
  sendingAsCaca = false,
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
  attachmentInputAccept = "image/*",
  attachmentPreview = null,
  hasAttachment = false,
  onPickAttachment,
  onCancelAttachment,
  onComposerPaste,
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
  channelKind?: string;
  cobrancaMode?: boolean;
  composerMode?: "reply" | "note";
  composerReady: boolean;
  customerServiceWindow: IrisConversationComposerWindow;
  draft: string;
  mustWhisper?: boolean;
  onComposerModeChange?: (mode: "reply" | "note") => void;
  editingMessageBody?: string | null;
  emojiOptions: string[];
  emojiPickerOpen: boolean;
  emojiPickerRef: RefObject<HTMLDivElement | null>;
  lockedByCaca?: boolean;
  onSendAsCaca?: (text: string) => void | Promise<void>;
  sendingAsCaca?: boolean;
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
  attachmentInputAccept?: string;
  attachmentPreview?: {
    fileName: string;
    kind: "document" | "image";
    previewUrl: string | null;
  } | null;
  hasAttachment?: boolean;
  onPickAttachment?: (file: File | null) => void;
  onCancelAttachment?: () => void;
  onComposerPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleAttachmentInputChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0] ?? null;

    onPickAttachment?.(file);
    // Permite reescolher o MESMO arquivo depois (senão o onChange não dispara).
    event.target.value = "";
  }
  const [agendaModalKind, setAgendaModalKind] = useState<
    "retorno" | "tarefa" | null
  >(null);
  const [cacaReplyOpen, setCacaReplyOpen] = useState(false);
  const [cacaText, setCacaText] = useState("");
  const hasComposerContext = Boolean(editingMessageBody || replyToMessageBody);
  const composerContextBody =
    editingMessageBody ?? replyToMessageBody ?? "Mensagem selecionada";
  const composerContextLabel = editingMessageBody
    ? "Editando mensagem"
    : "Respondendo";
  const noteMode = composerMode === "note";
  const isEmailChannel = channelKind === "email";
  // Grupo de WhatsApp (monitoramento): sem a janela de 24h do Meta 1:1.
  const isGroupChannel = channelKind === "group";
  const composerPlaceholder = noteMode
    ? "Mensagem assistida — nao vai pro cliente..."
    : composerReady
      ? editingMessageBody
        ? "Editar mensagem no Iris..."
        : isEmailChannel
          ? "Escrever resposta de e-mail..."
          : "Escrever mensagem WhatsApp..."
      : ticketClosed
        ? "Ticket encerrado"
        : isEmailChannel
          ? "E-mail"
          : "Aguardando janela WhatsApp";
  const sendLabel = noteMode
    ? "Enviar no modo assistido"
    : composerReady
      ? editingMessageBody
        ? "Salvar edicao"
        : "Enviar mensagem"
      : blockedTooltip;

  return (
    <footer className="shrink-0 border-t border-line bg-surface p-2.5">
      {!ticketClosed ? (
        <div className="mb-2 flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-line/70 bg-subtle/70 p-0.5">
            <button
              type="button"
              onClick={() => onComposerModeChange?.("reply")}
              disabled={mustWhisper}
              aria-pressed={!noteMode}
              className={[
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                !noteMode
                  ? isEmailChannel
                    ? "bg-surface text-indigo-600 shadow-sm ring-1 ring-indigo-200 dark:text-indigo-300 dark:ring-indigo-400/30"
                    : "bg-surface text-[#0f766e] shadow-sm ring-1 ring-emerald-100"
                  : "text-ink-muted hover:text-ink",
              ].join(" ")}
            >
              <MessageSquare className="size-3.5" aria-hidden="true" />
              Responder cliente
            </button>
            <button
              type="button"
              onClick={() => onComposerModeChange?.("note")}
              aria-pressed={noteMode}
              className={[
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                noteMode
                  ? "bg-[#A07C3B]/12 text-[#7A5E2C] shadow-sm ring-1 ring-[#A07C3B]/25"
                  : "text-ink-muted hover:text-ink",
              ].join(" ")}
            >
              <Headset className="size-3.5" aria-hidden="true" />
              Assistido
            </button>
          </div>
        </div>
      ) : null}

      {ticketClosed ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
            <LockKeyhole className="size-3.5" aria-hidden="true" />
            <span>{cobrancaMode ? "Atendimento encerrado" : "Ticket encerrado"}</span>
          </div>
          {cobrancaMode ? null : <TicketChecklist items={ticketChecklist} />}
        </div>
      ) : null}

      {!ticketClosed && !noteMode && lockedByCaca ? (
        <div className="mb-2 rounded-lg border border-[#A07C3B]/25 bg-[#A07C3B]/12 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#7A5E2C]">
            <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              Atendimento conduzido pela Caca. Voce acompanha e direciona; para
              intervir, use Direcionar ou responda como Caca.
            </span>
            {onSendAsCaca ? (
              <button
                type="button"
                onClick={() => setCacaReplyOpen((current) => !current)}
                aria-pressed={cacaReplyOpen}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#A07C3B]/40 bg-surface px-2.5 py-1 text-[11px] font-semibold text-[#7A5E2C] transition-colors hover:bg-[#f4ebdc]"
              >
                <Sparkles className="size-3.5" aria-hidden="true" />
                Responder como Caca
              </button>
            ) : null}
          </div>

          {onSendAsCaca && cacaReplyOpen ? (
            <div className="mt-2 space-y-2">
              <textarea
                value={cacaText}
                onChange={(event) => setCacaText(event.target.value)}
                rows={3}
                placeholder="Mensagem enviada ao cliente assinada como Caca..."
                className="w-full resize-none rounded-lg border border-[#A07C3B]/30 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-[#A07C3B]/60"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCacaReplyOpen(false);
                    setCacaText("");
                  }}
                  className="inline-flex h-8 items-center rounded-lg border border-line/70 bg-surface px-3 text-xs font-medium text-ink-soft hover:bg-subtle"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!cacaText.trim() || sendingAsCaca}
                  onClick={async () => {
                    const value = cacaText.trim();
                    if (!value) {
                      return;
                    }
                    await onSendAsCaca(value);
                    setCacaText("");
                    setCacaReplyOpen(false);
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#A07C3B] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sendingAsCaca ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="size-3.5" aria-hidden="true" />
                  )}
                  Enviar como Caca
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!ticketClosed && !noteMode && !lockedByCaca && !isEmailChannel && !isGroupChannel ? (
        <div
          className={[
            "mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2",
            customerServiceWindow.open
              ? "border-emerald-100 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/12"
              : "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/12",
          ].join(" ")}
        >
          <div
            className={[
              "flex min-w-0 items-center gap-2 text-xs font-semibold",
              customerServiceWindow.open
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-amber-800 dark:text-amber-300",
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
                className="flex size-8 items-center justify-center rounded-lg border border-line/80 bg-surface text-ink-muted transition-colors hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]"
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
                    : "border-[#A07C3B]/25 bg-[#A07C3B]/12 text-[#7A5E2C] hover:bg-[#f4ebdc]",
                ].join(" ")}
              >
                <Sparkles className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {hasComposerContext ? (
        <div className="mb-2 flex items-start justify-between gap-3 rounded-lg border border-[#eadcc2] bg-[#A07C3B]/12 px-3 py-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-normal text-[#7A5E2C]">
              {composerContextLabel}
            </p>
            <p className="mt-0.5 line-clamp-1 text-xs font-medium text-ink-soft">
              {composerContextBody}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelComposerContext}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface hover:text-[#7A5E2C]"
            aria-label="Cancelar contexto"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {attachmentPreview ? (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-[#eadcc2] bg-[#A07C3B]/12 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2.5">
            {attachmentPreview.kind === "image" && attachmentPreview.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={attachmentPreview.previewUrl}
                alt=""
                className="size-10 shrink-0 rounded-md object-cover"
              />
            ) : (
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface text-[#7A5E2C]">
                <FileText className="size-5" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-normal text-[#7A5E2C]">
                {attachmentPreview.kind === "image" ? "Imagem" : "Documento"}
              </p>
              <p className="mt-0.5 line-clamp-1 text-xs font-medium text-ink-soft">
                {attachmentPreview.fileName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancelAttachment}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface hover:text-[#7A5E2C]"
            aria-label="Remover anexo"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div ref={emojiPickerRef} className="relative">
        {emojiPickerOpen && composerReady ? (
          <div className="absolute bottom-full left-0 z-20 mb-2 grid max-h-56 w-56 grid-cols-6 gap-1 overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-[0_18px_45px_rgba(15,23,42,0.14)]">
            {emojiOptions.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onInsertEmoji(emoji)}
                className="flex size-8 items-center justify-center rounded-lg text-base transition-colors hover:bg-subtle"
                aria-label={`Inserir ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}

        <div
          className={[
            "flex items-center gap-2 rounded-xl border p-2 transition-opacity",
            noteMode
              ? "border-[#A07C3B]/40 bg-[#A07C3B]/12"
              : "border-line/70 bg-subtle/70",
            composerReady ? "opacity-100" : "opacity-55",
          ].join(" ")}
        >
          {recordingAudio ? (
            <div className="flex w-full items-center gap-3 px-1.5 py-1">
              <span className="relative flex size-3 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex size-3 rounded-full bg-rose-500" />
              </span>
              <span className="text-sm font-medium text-ink-soft">
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
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-rose-500"
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
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-rose-500"
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
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#A07C3B] text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-subtle"
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
              <input
                ref={fileInputRef}
                type="file"
                accept={attachmentInputAccept}
                className="hidden"
                onChange={handleAttachmentInputChange}
              />
              <ComposerIconButton
                disabled={
                  !canSendFreeForm || sending || noteMode || isEmailChannel
                }
                label={
                  noteMode
                    ? "Anexo indisponivel na nota"
                    : isEmailChannel
                      ? "Anexo indisponivel no e-mail"
                      : "Anexar arquivo, foto ou print"
                }
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="size-4" aria-hidden="true" />
              </ComposerIconButton>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={onComposerKeyDown}
                onPaste={onComposerPaste}
                placeholder={
                  hasAttachment
                    ? "Adicione uma legenda (opcional)..."
                    : composerPlaceholder
                }
                disabled={!composerReady}
                className="min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-ink outline-none placeholder:text-ink-muted"
              />
              <ComposerIconButton
                disabled={
                  !canSendFreeForm || sending || noteMode || isEmailChannel
                }
                label={
                  noteMode
                    ? "Audio indisponivel na nota"
                    : isEmailChannel
                      ? "Audio indisponivel no e-mail"
                      : "Gravar audio"
                }
                onClick={onStartAudioRecording}
              >
                <Mic className="size-4" aria-hidden="true" />
              </ComposerIconButton>
              <Tooltip content={sendLabel} placement="top">
                <button
                  type="button"
                  disabled={
                    sending ||
                    (!draft.trim() && !hasAttachment) ||
                    !composerReady
                  }
                  onClick={onSendMessage}
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#A07C3B] text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-subtle"
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
            className="flex size-8 items-center justify-center rounded-lg border border-line/70 bg-surface text-ink-muted transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C] disabled:cursor-not-allowed disabled:opacity-45"
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
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface hover:text-[#7A5E2C] disabled:cursor-not-allowed disabled:opacity-45"
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
              : "bg-surface text-amber-700 ring-amber-200",
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
