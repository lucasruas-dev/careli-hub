"use client";

import type {
  HermesMessage,
  HermesMessageAttachment,
  HermesMessageTag,
  HermesPresenceUser,
  HermesReactionEmoji,
  HermesThreadReply,
} from "@/lib/pulsex";
import { Image as ImageIcon, Paperclip, Send, X } from "lucide-react";
import {
  useEffect,
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
  onChangeReply: (value: string) => void;
  onClose: () => void;
  onEditMessage?: (
    messageId: HermesMessage["id"],
    body: string,
  ) => Promise<void> | void;
  onSubmitReply: (input?: { attachment?: HermesMessageAttachment }) => boolean;
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
  replyValue,
  users,
}: ThreadPanelProps) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [attachment, setAttachment] = useState<HermesMessageAttachment | null>(
    null,
  );
  const [mediaError, setMediaError] = useState<string | null>(null);

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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitReply();
    }
  }

  function submitReply() {
    const didSubmit = onSubmitReply(
      attachment ? { attachment } : undefined,
    );

    if (!didSubmit) {
      return;
    }

    setAttachment(null);
    setMediaError(null);
  }

  async function handleImageInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!file) {
      return;
    }

    await attachImageFile(file);
  }

  async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const imageFile = getClipboardImageFile(event.clipboardData);

    if (!imageFile) {
      return;
    }

    event.preventDefault();
    await attachImageFile(imageFile, {
      label: `Print ${formatAttachmentTime(new Date())}.${getImageExtension(imageFile.type)}`,
    });
  }

  async function attachImageFile(
    file: File,
    options: { label?: string } = {},
  ) {
    if (!file.type.startsWith("image/")) {
      setMediaError("Selecione uma imagem.");
      return;
    }

    if (file.size > MAX_THREAD_IMAGE_BYTES) {
      setMediaError("Imagem acima de 8 MB.");
      return;
    }

    let url: string;

    try {
      url = await readFileAsDataUrl(file);
    } catch {
      setMediaError("Nao foi possivel carregar a imagem.");
      return;
    }

    setAttachment({
      label: options.label ?? file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      type: "image",
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
        {replies.map((reply) => {
          const author = users.find((user) => user.id === reply.authorId);

          return (
            <div className="px-4 py-1" key={reply.id}>
              <MessageItem
                author={author}
                currentUserId={currentUserId}
                message={mapThreadReplyToMessage(reply, message)}
                onPreviewAttachment={onPreviewAttachment}
                onToggleReaction={onToggleReaction}
                onToggleTag={onToggleTag}
                reactionOptions={reactionOptions}
                users={users}
              />
            </div>
          );
        })}
      </div>
      <form
        className="border-t border-[#d9e0ea] px-4 py-3"
        onSubmit={handleSubmit}
      >
        <input
          accept="image/*"
          className="hidden"
          onChange={handleImageInputChange}
          ref={imageInputRef}
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
          <div className="flex items-end gap-2">
            <button
              aria-label="Anexar imagem"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#667085] outline-none transition hover:bg-[#eef2f7] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
              onClick={() => imageInputRef.current?.click()}
              type="button"
            >
              <Paperclip aria-hidden="true" size={17} />
            </button>
            <textarea
              aria-label="Responder"
              className="max-h-36 min-h-11 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-1 py-1.5 text-sm leading-5 text-[var(--uix-text-primary)] outline-none placeholder:text-[var(--uix-text-muted)]"
              onChange={(event) => onChangeReply(event.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Responder"
              ref={replyTextareaRef}
              rows={1}
              value={replyValue}
            />
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
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-[#d9e0ea] bg-[#f8fafc] p-2">
      <span
        aria-label={attachment.label}
        className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-white text-[#667085]"
        role="img"
        style={
          attachment.url
            ? {
                backgroundImage: `url(${attachment.url})`,
                backgroundPosition: "center",
                backgroundSize: "cover",
              }
            : undefined
        }
      >
        {attachment.url ? null : <ImageIcon aria-hidden="true" size={18} />}
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
        aria-label="Remover imagem"
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
    reactions: reply.reactions,
    status: "neutral",
    tags: reply.tags,
    threadParentMessageId: parentMessage.id,
    timestamp: reply.timestamp,
  };
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

      reject(new Error("Imagem invalida."));
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
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

const MAX_THREAD_IMAGE_BYTES = 8 * 1024 * 1024;
