"use client";

import type {
  HermesMessage,
  HermesMessageAttachment,
  HermesMessageMention,
  HermesMessageTag,
  HermesPresenceUser,
  HermesReactionEmoji,
  HermesThreadReply,
} from "@/lib/pulsex";
import {
  AtSign,
  FileText,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Send,
  Video,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { MessageItem } from "./message-item";

type ThreadPanelProps = {
  currentUserId: HermesPresenceUser["id"];
  message?: HermesMessage;
  onChangeReply: (
    value: string,
    mentions: readonly HermesMessageMention[],
  ) => void;
  onClose: () => void;
  onEditMessage?: (
    messageId: HermesMessage["id"],
    body: string,
  ) => Promise<void> | void;
  onSubmitReply: (input?: {
    attachment?: HermesMessageAttachment;
    mentions?: readonly HermesMessageMention[];
  }) => boolean;
  onToggleReaction: (
    messageId: HermesMessage["id"],
    emoji: HermesReactionEmoji,
  ) => void;
  onPreviewAttachment?: (
    attachment: NonNullable<HermesMessage["attachment"]>,
  ) => void;
  onToggleTag: (
    messageId: HermesMessage["id"],
    tag: HermesMessageTag,
  ) => void;
  reactionOptions: readonly HermesReactionEmoji[];
  replies: readonly HermesThreadReply[];
  replyMentions: readonly HermesMessageMention[];
  replyValue: string;
  users: readonly HermesPresenceUser[];
};

export function ThreadPanel({
  currentUserId,
  message,
  onChangeReply,
  onClose,
  onEditMessage,
  onSubmitReply,
  onToggleReaction,
  onPreviewAttachment,
  onToggleTag,
  reactionOptions,
  replies,
  replyMentions,
  replyValue,
  users,
}: ThreadPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [attachment, setAttachment] = useState<HermesMessageAttachment | null>(
    null,
  );
  const [activeMention, setActiveMention] = useState<{
    end: number;
    query: string;
    start: number;
    trigger: string;
  } | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const mentionOptions = useMemo(() => {
    if (!activeMention) {
      return [];
    }

    return users
      .filter((user) => matchesMentionQuery(user, activeMention.query))
      .slice(0, 6);
  }, [activeMention, users]);
  const isMentionOpen = Boolean(activeMention && mentionOptions.length > 0);

  useEffect(() => {
    const textarea = replyTextareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(
      Math.max(textarea.scrollHeight, 44),
      144,
    )}px`;
  }, [replyValue]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitReply();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && isMentionOpen) {
      event.preventDefault();
      closeMentionMenu();
      return;
    }

    if (isMentionOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveMentionIndex((currentIndex) =>
          currentIndex >= mentionOptions.length - 1 ? 0 : currentIndex + 1,
        );
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveMentionIndex((currentIndex) =>
          currentIndex <= 0 ? mentionOptions.length - 1 : currentIndex - 1,
        );
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        selectMention(mentionOptions[activeMentionIndex]);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitReply();
    }
  }

  function submitReply() {
    const didSubmit = onSubmitReply(
      attachment || replyMentions.length > 0
        ? { attachment: attachment ?? undefined, mentions: replyMentions }
        : undefined,
    );

    if (!didSubmit) {
      return;
    }

    setAttachment(null);
    closeMentionMenu();
    setMediaError(null);
  }

  function handleReplyChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.target.value;
    const nextCaretIndex = event.target.selectionStart;
    const nextMentions = replyMentions.filter((mention) =>
      nextValue.includes(mention.displayName),
    );

    onChangeReply(nextValue, nextMentions);
    updateActiveMention(nextValue, nextCaretIndex);
  }

  function selectMention(user: HermesPresenceUser | undefined) {
    if (!user || !activeMention) {
      return;
    }

    const insertedText = `${user.label} `;
    const nextValue = `${replyValue.slice(0, activeMention.start)}${insertedText}${replyValue.slice(activeMention.end)}`;
    const nextCaretIndex = activeMention.start + insertedText.length;
    const nextMention = {
      displayName: user.label,
      trigger: activeMention.trigger,
      userId: user.id,
    } satisfies HermesMessageMention;
    const nextMentions = [
      ...replyMentions.filter((mention) => mention.userId !== user.id),
      nextMention,
    ];

    onChangeReply(nextValue, nextMentions);
    closeMentionMenu();
    window.requestAnimationFrame(() => {
      replyTextareaRef.current?.focus();
      replyTextareaRef.current?.setSelectionRange(
        nextCaretIndex,
        nextCaretIndex,
      );
    });
  }

  function removeMention(userId: HermesPresenceUser["id"]) {
    const mention = replyMentions.find(
      (currentMention) => currentMention.userId === userId,
    );

    if (!mention) {
      return;
    }

    onChangeReply(
      replyValue
        .replace(mention.displayName, "")
        .replace(/\s{2,}/g, " ")
        .trimStart(),
      replyMentions.filter((currentMention) => currentMention.userId !== userId),
    );
  }

  function updateActiveMention(nextValue: string, caretIndex: number) {
    setActiveMention(getActiveMentionQuery(nextValue, caretIndex));
    setActiveMentionIndex(0);
  }

  function closeMentionMenu() {
    setActiveMention(null);
    setActiveMentionIndex(0);
  }

  async function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!file) {
      return;
    }

    await attachFile(file);
  }

  async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const imageFile = getClipboardImageFile(event.clipboardData);

    if (!imageFile) {
      return;
    }

    event.preventDefault();
    await attachFile(imageFile, {
      label: `Print ${formatAttachmentTime(new Date())}.${getImageExtension(imageFile.type)}`,
      type: "image",
    });
  }

  async function attachFile(
    file: File,
    options: {
      label?: string;
      type?: HermesMessageAttachment["type"];
    } = {},
  ) {
    if (file.size > MAX_THREAD_ATTACHMENT_BYTES) {
      setMediaError("Arquivo acima de 50 MB.");
      return;
    }

    let url: string;

    try {
      url = await readFileAsDataUrl(file);
    } catch {
      setMediaError("Nao foi possivel carregar o anexo.");
      return;
    }

    const mimeType = file.type || "application/octet-stream";

    setAttachment({
      label: options.label ?? file.name,
      mimeType,
      sizeBytes: file.size,
      type: options.type ?? getAttachmentType(mimeType),
      url,
    });
    setMediaError(null);
  }

  if (!message) {
    return null;
  }

  const isReplyEmpty = replyValue.trim().length === 0 && !attachment;

  return (
    <aside className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-l-[1.15rem] border-l border-[#d9e0ea] bg-white">
      <header className="flex h-16 items-center justify-between border-b border-[#d9e0ea] px-5">
        <div>
          <p className="m-0 text-sm font-semibold text-[var(--uix-text-primary)]">
            Respostas
          </p>
          <p className="m-0 text-xs text-[var(--uix-text-muted)]">
            {replies.length} mensagens
          </p>
        </div>
        <button
          aria-label="Fechar respostas"
          className="grid h-9 w-9 place-items-center rounded-md text-[var(--uix-text-muted)] outline-none transition hover:bg-[#eef2f7] hover:text-[var(--uix-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={17} />
        </button>
      </header>
      <div className="min-h-0 overflow-auto bg-[#f3f6fa] py-4">
        <MessageItem
          author={users.find((user) => user.id === message.authorId)}
          currentUserId={currentUserId}
          message={message}
          onEditMessage={onEditMessage}
          onPreviewAttachment={onPreviewAttachment}
          onToggleReaction={onToggleReaction}
          onToggleTag={onToggleTag}
          reactionOptions={reactionOptions}
          users={users}
        />
        <div className="my-3 text-center text-xs text-[var(--uix-text-muted)]">
          {replies.length} respostas
        </div>
        {buildThreadReplyRows(replies).map((row) =>
          row.kind === "date" ? (
            <ThreadDateSeparator key={row.id} label={row.label} />
          ) : (
            <div className="px-4 py-1" key={row.reply.id}>
              <MessageItem
                author={users.find((user) => user.id === row.reply.authorId)}
                currentUserId={currentUserId}
                message={mapThreadReplyToMessage(row.reply, message)}
                onPreviewAttachment={onPreviewAttachment}
                onToggleReaction={onToggleReaction}
                onToggleTag={onToggleTag}
                reactionOptions={reactionOptions}
                users={users}
              />
            </div>
          ),
        )}
      </div>
      <form
        className="border-t border-[#d9e0ea] px-4 py-3"
        onSubmit={handleSubmit}
      >
        <input
          accept={THREAD_ATTACHMENT_ACCEPT}
          className="hidden"
          onChange={handleFileInputChange}
          ref={fileInputRef}
          type="file"
        />
        <div className="grid gap-2 rounded-[1.15rem] border border-[#d9e0ea] bg-white p-2 shadow-[0_10px_26px_rgba(16,24,32,0.08)] transition focus-within:border-[var(--uix-brand-primary)]">
          {attachment ? (
            <ThreadAttachmentPreview
              attachment={attachment}
              onRemove={() => setAttachment(null)}
            />
          ) : null}
          {mediaError ? (
            <span className="px-1 text-xs font-medium text-red-600">
              {mediaError}
            </span>
          ) : null}
          {replyMentions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-1">
              {replyMentions.map((mention) => (
                <button
                  className="rounded px-1.5 py-0.5 text-xs font-semibold text-[#7b5f2d] outline-none transition hover:bg-[#A07C3B]/10 focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
                  key={`${mention.userId}-${mention.displayName}`}
                  onClick={() => removeMention(mention.userId)}
                  type="button"
                >
                  {mention.displayName}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <button
              aria-label="Anexar arquivo"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#667085] outline-none transition hover:bg-[#eef2f7] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              <Paperclip aria-hidden="true" size={17} />
            </button>
            <button
              aria-label="Marcar pessoa"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#667085] outline-none transition hover:bg-[#eef2f7] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
              onClick={() => {
                const textarea = replyTextareaRef.current;
                const start = textarea?.selectionStart ?? replyValue.length;
                const end = textarea?.selectionEnd ?? replyValue.length;
                const prefix = start > 0 && !/\s$/.test(replyValue.slice(0, start)) ? " @" : "@";
                const nextValue = `${replyValue.slice(0, start)}${prefix}${replyValue.slice(end)}`;
                const nextCaretIndex = start + prefix.length;

                onChangeReply(nextValue, replyMentions);
                updateActiveMention(nextValue, nextCaretIndex);
                window.requestAnimationFrame(() => {
                  replyTextareaRef.current?.focus();
                  replyTextareaRef.current?.setSelectionRange(
                    nextCaretIndex,
                    nextCaretIndex,
                  );
                });
              }}
              type="button"
            >
              <AtSign aria-hidden="true" size={17} />
            </button>
            <div className="relative min-w-0 flex-1">
              {isMentionOpen ? (
                <MentionAutocomplete
                  activeIndex={activeMentionIndex}
                  onSelect={selectMention}
                  users={mentionOptions}
                />
              ) : null}
              <textarea
                aria-autocomplete="list"
                aria-controls={
                  isMentionOpen ? "pulsex-thread-mention-listbox" : undefined
                }
                aria-expanded={isMentionOpen}
                aria-label="Responder"
                className="max-h-36 min-h-11 w-full resize-none overflow-y-auto border-0 bg-transparent px-1 py-1.5 text-sm leading-5 text-[var(--uix-text-primary)] outline-none placeholder:text-[var(--uix-text-muted)]"
                onBlur={() => window.setTimeout(closeMentionMenu, 120)}
                onChange={handleReplyChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onSelect={(event) =>
                  updateActiveMention(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart,
                  )
                }
                placeholder="Responder"
                ref={replyTextareaRef}
                rows={1}
                value={replyValue}
              />
            </div>
            <button
              aria-label="Enviar resposta"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#A07C3B] text-white shadow-[0_8px_18px_rgba(160,124,59,0.28)] outline-none ring-1 ring-[#8c6b2f]/20 transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)] disabled:cursor-not-allowed disabled:bg-[#efe4d2] disabled:text-[#8c6b2f] disabled:shadow-none disabled:ring-[#A07C3B]/35"
              disabled={isReplyEmpty}
              type="submit"
            >
              <Send aria-hidden="true" size={16} />
            </button>
          </div>
        </div>
      </form>
    </aside>
  );
}

function ThreadAttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: HermesMessageAttachment;
  onRemove: () => void;
}) {
  const Icon = getAttachmentIcon(attachment.type);
  const isImageAttachment = attachment.type === "image" && Boolean(attachment.url);

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-[#d9e0ea] bg-[#f8fafc] p-2">
      <span
        aria-label={attachment.label}
        className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-white text-[#667085]"
        role="img"
        style={
          isImageAttachment
            ? {
                backgroundImage: `url(${attachment.url})`,
                backgroundPosition: "center",
                backgroundSize: "cover",
              }
            : undefined
        }
      >
        {isImageAttachment ? null : <Icon aria-hidden="true" size={18} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-[#121722]">
          {attachment.label}
        </span>
        {attachment.sizeBytes ? (
          <span className="text-[0.68rem] text-[#667085]">
            {formatFileSize(attachment.sizeBytes)}
          </span>
        ) : null}
      </span>
      <button
        aria-label="Remover anexo"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#667085] transition hover:bg-[#e6ebf2] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
        onClick={onRemove}
        type="button"
      >
        <X aria-hidden="true" size={15} />
      </button>
    </div>
  );
}

function mapThreadReplyToMessage(
  reply: HermesThreadReply,
  parentMessage: HermesMessage,
): HermesMessage {
  return {
    attachment: reply.attachment,
    authorAvatarUrl: reply.authorAvatarUrl,
    authorId: reply.authorId,
    authorName: reply.authorName,
    body: reply.body,
    channelId: reply.channelId,
    createdAt: reply.createdAt,
    id: reply.id,
    mentionUserIds: reply.mentionUserIds,
    mentions: reply.mentions,
    reactions: reply.reactions,
    status: "neutral",
    tags: reply.tags,
    threadParentMessageId: parentMessage.id,
    timestamp: reply.timestamp || formatThreadReplyTime(reply.createdAt),
  };
}

type ThreadReplyRow =
  | { id: string; kind: "date"; label: string }
  | { kind: "reply"; reply: HermesThreadReply };

// Agrupa as respostas por dia inserindo divisorias de data, igual a lista
// principal de mensagens (Hermes), para a thread tambem mostrar DATA + HORA.
function buildThreadReplyRows(
  replies: readonly HermesThreadReply[],
): ThreadReplyRow[] {
  const rows: ThreadReplyRow[] = [];
  let currentDateKey = "";

  for (const reply of replies) {
    const dateInfo = getThreadReplyDateInfo(reply.createdAt);

    if (dateInfo && dateInfo.key !== currentDateKey) {
      rows.push({
        id: `thread-date-${dateInfo.key}`,
        kind: "date",
        label: dateInfo.label,
      });
      currentDateKey = dateInfo.key;
    }

    rows.push({ kind: "reply", reply });
  }

  return rows;
}

function ThreadDateSeparator({ label }: { label: string }) {
  return (
    <div
      aria-label={`Data das respostas: ${label}`}
      className="my-2 flex justify-center px-4"
      role="separator"
    >
      <span className="rounded-full border border-[#d9e0ea] bg-white px-3 py-1 text-xs font-semibold text-[#475467] shadow-sm">
        {label}
      </span>
    </div>
  );
}

const threadReplyDateLabelFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
  weekday: "long",
  year: "numeric",
});

const threadReplyDateKeyFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
  year: "numeric",
});

function getThreadReplyDateInfo(createdAt?: string) {
  if (!createdAt) {
    return null;
  }

  const time = Date.parse(createdAt);

  if (!Number.isFinite(time)) {
    return null;
  }

  const date = new Date(time);
  const label = threadReplyDateLabelFormatter.format(date);

  return {
    key: getThreadReplyDateKey(date),
    label: label.charAt(0).toLocaleUpperCase("pt-BR") + label.slice(1),
  };
}

function getThreadReplyDateKey(date: Date) {
  const parts = threadReplyDateKeyFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";

  return `${year}-${month}-${day}`;
}

function formatThreadReplyTime(createdAt?: string) {
  if (!createdAt) {
    return "";
  }

  const time = Date.parse(createdAt);

  if (!Number.isFinite(time)) {
    return "";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(time));
}

function MentionAutocomplete({
  activeIndex,
  onSelect,
  users,
}: {
  activeIndex: number;
  onSelect: (user: HermesPresenceUser) => void;
  users: readonly HermesPresenceUser[];
}) {
  return (
    <div
      className="absolute bottom-full left-0 z-40 mb-2 w-72 overflow-hidden rounded-md border border-[#d9e0ea] bg-white shadow-xl"
      id="pulsex-thread-mention-listbox"
      role="listbox"
    >
      {users.map((user, index) => (
        <button
          aria-selected={index === activeIndex}
          className="grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-left outline-none transition hover:bg-[#f3f6fa] data-[active=true]:bg-[#f7f3eb]"
          data-active={index === activeIndex}
          key={user.id}
          onClick={() => onSelect(user)}
          onMouseDown={(event) => event.preventDefault()}
          role="option"
          type="button"
        >
          <span className="grid h-8 w-8 place-items-center rounded-md bg-[#101820] text-xs font-semibold text-white">
            {user.initials}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-[#121722]">
              {user.label}
            </span>
            <span className="block truncate text-xs text-[#667085]">
              {user.role} / {getPresenceLabel(user.status)}
            </span>
          </span>
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${getPresenceDotClassName(user.status)}`}
          />
        </button>
      ))}
    </div>
  );
}

function getActiveMentionQuery(value: string, caretIndex: number) {
  const beforeCaret = value.slice(0, caretIndex);
  const match = beforeCaret.match(/(^|\s)@([^\s@]*)$/);

  if (!match || typeof match.index !== "number") {
    return null;
  }

  const prefix = match[1] ?? "";
  const query = match[2] ?? "";
  const triggerStart = match.index + prefix.length;

  return {
    end: caretIndex,
    query,
    start: triggerStart,
    trigger: `@${query}`,
  };
}

function matchesMentionQuery(user: HermesPresenceUser, query: string) {
  const normalizedQuery = normalizeSearchValue(query);
  const searchValues = [
    user.label,
    ...user.label.split(" "),
    user.email,
    user.username,
  ];

  if (!normalizedQuery) {
    return true;
  }

  return searchValues.some((value) =>
    normalizeSearchValue(value ?? "").includes(normalizedQuery),
  );
}

function normalizeSearchValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getPresenceLabel(status: HermesPresenceUser["status"]) {
  const labels = {
    agenda: "agenda",
    away: "ausente",
    busy: "agenda",
    lunch: "almoco",
    offline: "offline",
    online: "online",
  } as const satisfies Record<HermesPresenceUser["status"], string>;

  return labels[status];
}

function getPresenceDotClassName(status: HermesPresenceUser["status"]) {
  const classNames = {
    agenda: "bg-sky-500",
    away: "bg-red-500",
    busy: "bg-sky-500",
    lunch: "bg-yellow-400",
    offline: "bg-slate-300",
    online: "bg-emerald-500",
  } as const satisfies Record<HermesPresenceUser["status"], string>;

  return classNames[status];
}

function getClipboardImageFile(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.files).find((file) =>
    file.type.startsWith("image/"),
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Anexo invalido."));
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function getAttachmentType(mimeType: string): HermesMessageAttachment["type"] {
  if (mimeType.startsWith("audio/")) {
    return "audio";
  }

  if (mimeType.startsWith("image/")) {
    return "image";
  }

  if (mimeType.startsWith("video/")) {
    return "video";
  }

  return "file";
}

function getAttachmentIcon(type: HermesMessageAttachment["type"]) {
  if (type === "audio") {
    return Mic;
  }

  if (type === "image") {
    return ImageIcon;
  }

  if (type === "video") {
    return Video;
  }

  return FileText;
}

function getImageExtension(mimeType: string) {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  return "png";
}

function formatAttachmentTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .format(date)
    .replace(/\D/g, "");
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const THREAD_ATTACHMENT_ACCEPT =
  "audio/*,image/*,video/*,.csv,.doc,.docx,.pdf,.ppt,.pptx,.txt,.xls,.xlsx";
const MAX_THREAD_ATTACHMENT_BYTES = 50 * 1024 * 1024;
