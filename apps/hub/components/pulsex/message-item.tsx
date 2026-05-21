"use client";

import { AthenaIcon } from "@/components/athena-icon";
import type {
  HermesMessage,
  HermesMessageMention,
  HermesMessageTag,
  HermesPresenceUser,
  HermesReaction,
  HermesReactionEmoji,
} from "@/lib/pulsex";
import {
  Check,
  CheckCheck,
  Download,
  ExternalLink,
  FileText,
  Image,
  Info,
  Mic,
  Pencil,
  Reply,
  SmilePlus,
  Tag,
  Video,
  X,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  getHermesMessageTagClassName,
  getHermesMessageTagLabel,
  hermesMessageTagOptions,
} from "@/lib/pulsex/message-tags";

type MessageItemProps = {
  author?: HermesPresenceUser;
  currentUserId?: HermesPresenceUser["id"];
  message: HermesMessage;
  onOpenThread?: (messageId: HermesMessage["id"]) => void;
  onAskAiReply?: (messageId: HermesMessage["id"]) => void;
  onEditMessage?: (
    messageId: HermesMessage["id"],
    body: string,
  ) => Promise<void> | void;
  onToggleTag?: (messageId: HermesMessage["id"], tag: HermesMessageTag) => void;
  onToggleReaction?: (
    messageId: HermesMessage["id"],
    emoji: HermesReactionEmoji,
  ) => void;
  onPreviewAttachment?: (
    attachment: NonNullable<HermesMessage["attachment"]>,
  ) => void;
  reactionOptions?: readonly HermesReactionEmoji[];
  users?: readonly HermesPresenceUser[];
};

export function MessageItem({
  author,
  currentUserId,
  message,
  onEditMessage,
  onAskAiReply,
  onOpenThread,
  onPreviewAttachment,
  onToggleReaction,
  onToggleTag,
  reactionOptions = defaultReactionOptions,
  users = [],
}: MessageItemProps) {
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editValue, setEditValue] = useState(message.body);
  const [isEditing, setIsEditing] = useState(false);
  const [isReactionPickerOpen, setIsReactionPickerOpen] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isTagMenuOpen, setIsTagMenuOpen] = useState(false);
  const messageItemRef = useRef<HTMLDivElement | null>(null);
  const isOwn = message.authorId === currentUserId;
  const authorName = getAuthorName(author, message);
  const authorAvatarUrl = author?.avatarUrl ?? message.authorAvatarUrl;
  const authorInitials = author?.initials ?? getInitials(authorName);
  const deliveryState = getDeliveryState({ message, users });
  const visibleReactions = (message.reactions ?? []).filter(
    (reaction) => reaction.count > 0,
  );
  const shouldShowBody =
    message.deletedAt ||
    !(
      message.attachment?.type === "sticker" &&
      message.body === message.attachment.label
    );
  const standaloneEmoji = getStandaloneEmojiMessage(message.body, message.attachment);
  const isStandaloneEmoji =
    Boolean(standaloneEmoji) &&
    !message.deletedAt &&
    !message.tags?.length &&
    !isEditing;

  useEffect(() => {
    if (!isEditing) {
      setEditValue(message.body);
    }
  }, [isEditing, message.body]);

  useEffect(() => {
    if (!isInfoOpen && !isReactionPickerOpen && !isTagMenuOpen) {
      return;
    }

    function handleDocumentPointerDown(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (messageItemRef.current?.contains(target)) {
        return;
      }

      setIsInfoOpen(false);
      setIsReactionPickerOpen(false);
      setIsTagMenuOpen(false);
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);

    return () => {
      document.removeEventListener(
        "pointerdown",
        handleDocumentPointerDown,
        true,
      );
    };
  }, [isInfoOpen, isReactionPickerOpen, isTagMenuOpen]);

  const infoButton = (
    <button
      aria-expanded={isInfoOpen}
      aria-label="Informações da mensagem"
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.68rem] outline-none transition hover:bg-[#A07C3B]/10 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)] ${
        isInfoOpen
          ? "bg-[#A07C3B]/10 text-[#7b5f2d] opacity-100"
          : "text-inherit opacity-65"
      }`}
      onClick={() => {
        setIsReactionPickerOpen(false);
        setIsTagMenuOpen(false);
        setIsInfoOpen((currentValue) => !currentValue);
      }}
      type="button"
    >
      <Info aria-hidden="true" size={12} />
    </button>
  );

  async function handleSubmitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextBody = editValue.trim();

    if (!nextBody || nextBody === message.body || !onEditMessage) {
      setIsEditing(false);
      setEditError(null);
      return;
    }

    setIsSavingEdit(true);
    setEditError(null);

    try {
      await onEditMessage(message.id, nextBody);
      setIsEditing(false);
    } catch {
      setEditError("Nao foi possivel editar.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setEditValue(message.body);
      setEditError(null);
      setIsEditing(false);
    }
  }

  function handleSelectReaction(emoji: HermesReactionEmoji) {
    onToggleReaction?.(message.id, emoji);
    setIsReactionPickerOpen(false);
  }

  return (
    <div
      className={`relative flex items-end gap-2 px-4 py-1 ${
        isOwn ? "justify-end" : "justify-start"
      } ${isInfoOpen || isReactionPickerOpen || isTagMenuOpen ? "z-[80]" : "z-0"}`}
      ref={messageItemRef}
    >
      {!isOwn ? (
        <MessageAvatar
          avatarUrl={authorAvatarUrl}
          initials={authorInitials}
          name={authorName}
        />
      ) : null}
      <div
        className={`group relative ${
          isStandaloneEmoji
            ? "max-w-[9rem] border-0 bg-transparent px-1 py-0 text-[#101820] shadow-none"
            : `max-w-[min(72%,46rem)] border px-3 py-2 shadow-[0_1px_2px_rgba(16,24,32,0.12)] ${
                isOwn
                  ? "rounded-2xl rounded-br-md border-[#d6e7df] bg-[#effaf5] text-[#101820]"
                  : "rounded-2xl rounded-bl-md border-[#e5e9ef] bg-white text-[var(--uix-text-primary)]"
              }`
        }`}
      >
        {!isStandaloneEmoji ? (
          <span
            aria-hidden="true"
            className={`absolute bottom-0 h-3 w-3 rotate-45 ${
              isOwn
                ? "-right-1 border-r border-b border-[#d6e7df] bg-[#effaf5]"
                : "-left-1 border-l border-b border-[#e5e9ef] bg-white"
            }`}
          />
        ) : null}
        {message.tags?.length ? (
          <div className="relative z-10 mb-2 flex flex-wrap gap-1">
            {message.tags.map((tag) => (
              <span
                aria-label={`Tag ${getHermesMessageTagLabel(tag)}`}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.64rem] font-semibold shadow-sm ${getHermesMessageTagClassName(tag)}`}
                key={tag}
              >
                <Tag aria-hidden="true" size={10} />
                {getHermesMessageTagLabel(tag)}
              </span>
            ))}
          </div>
        ) : null}
        {message.attachment ? (
          <MessageAttachmentPreview
            attachment={message.attachment}
            onPreview={onPreviewAttachment}
          />
        ) : null}
        {isEditing ? (
          <form className="relative grid gap-2" onSubmit={handleSubmitEdit}>
            <textarea
              aria-label="Editar mensagem"
              className="max-h-32 min-h-20 resize-none rounded-md border border-[#d9e0ea] bg-white px-3 py-2 text-sm leading-5 text-[#121722] outline-none transition focus:border-[#A07C3B]"
              disabled={isSavingEdit}
              onChange={(event) => setEditValue(event.target.value)}
              onKeyDown={handleEditKeyDown}
              rows={3}
              value={editValue}
            />
            {editError ? (
              <span className="text-xs font-medium text-rose-600">
                {editError}
              </span>
            ) : null}
            <span className="flex justify-end gap-1.5">
              <button
                aria-label="Cancelar edicao"
                className="grid h-8 w-8 place-items-center rounded-md text-[#667085] outline-none transition hover:bg-[#eef2f7] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                disabled={isSavingEdit}
                onClick={() => {
                  setEditValue(message.body);
                  setEditError(null);
                  setIsEditing(false);
                }}
                type="button"
              >
                <X aria-hidden="true" size={15} />
              </button>
              <button
                aria-label="Salvar edicao"
                className="grid h-8 w-8 place-items-center rounded-md bg-[#A07C3B] text-white outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:bg-[#d9e0ea]"
                disabled={isSavingEdit || !editValue.trim()}
                type="submit"
              >
                <Check aria-hidden="true" size={15} />
              </button>
            </span>
          </form>
        ) : isStandaloneEmoji ? (
          <div className="relative z-10 text-[3.45rem] leading-none drop-shadow-sm">
            {standaloneEmoji}
          </div>
        ) : shouldShowBody ? (
          <div className="relative z-10 min-w-0 max-w-full whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">
            {message.deletedAt
              ? "Mensagem apagada"
              : renderMessageBody(message, users)}
          </div>
        ) : null}
        <div
          className={`relative mt-1 flex items-center justify-end gap-2 text-[0.66rem] ${
            isOwn ? "text-[#2f6b52]" : "text-[#667085]"
          }`}
        >
          {message.editedAt ? <span>editada</span> : null}
          <span className="font-bold text-[#101820]">{message.timestamp}</span>
          {isOwn ? (
            <Tooltip
              content={deliveryState.allRead ? "Todos leram" : "Enviado"}
            >
              <span
                aria-label={deliveryState.allRead ? "Todos leram" : "Enviado"}
                className={
                  deliveryState.allRead ? "text-[#2085ff]" : "text-[#8b98aa]"
                }
                role="img"
              >
                <CheckCheck aria-hidden="true" size={14} strokeWidth={2.4} />
              </span>
            </Tooltip>
          ) : null}
        </div>
        <div
          className={`relative mt-1.5 flex flex-wrap items-center gap-1 opacity-90 ${
            isOwn ? "justify-end text-[#2f6b52]" : "justify-start"
          }`}
        >
          {onToggleReaction && !message.deletedAt ? (
            <div className="relative">
              <button
                aria-expanded={isReactionPickerOpen}
                aria-label="Reagir com emoji"
                className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.68rem] text-inherit opacity-65 outline-none transition hover:bg-[#A07C3B]/10 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
                onClick={() => {
                  setIsInfoOpen(false);
                  setIsTagMenuOpen(false);
                  setIsReactionPickerOpen((currentValue) => !currentValue);
                }}
                type="button"
              >
                <SmilePlus aria-hidden="true" size={13} />
              </button>
              {isReactionPickerOpen ? (
                <ReactionPicker
                  currentUserId={currentUserId}
                  messageReactions={message.reactions ?? []}
                  onSelect={handleSelectReaction}
                  options={reactionOptions}
                  placement={isOwn ? "right" : "left"}
                />
              ) : null}
            </div>
          ) : null}
          {onOpenThread ? (
            <button
              aria-label={
                message.threadCount
                  ? `${message.threadCount} respostas`
                  : "Responder"
              }
              className={`inline-flex min-w-6 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)] ${
                message.threadCount
                  ? "border border-[#A07C3B] bg-[#A07C3B] text-white opacity-100 shadow-sm shadow-[#A07C3B]/25 hover:brightness-110"
                  : "text-inherit opacity-65 hover:bg-[#A07C3B]/10 hover:opacity-100"
              }`}
              onClick={() => onOpenThread(message.id)}
              type="button"
            >
              <Reply aria-hidden="true" size={13} />
              {message.threadCount ? (
                <span className="text-[0.65rem] font-semibold">
                  {message.threadCount}
                </span>
              ) : null}
            </button>
          ) : null}
          {onAskAiReply && !message.deletedAt ? (
            <button
              aria-label="Responder com Athena"
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.68rem] text-inherit opacity-65 outline-none transition hover:bg-[#A07C3B]/10 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
              onClick={() => onAskAiReply(message.id)}
              type="button"
            >
              <AthenaIcon aria-hidden="true" className="size-4" />
            </button>
          ) : null}
          {isOwn && onEditMessage && !message.deletedAt ? (
            <button
              aria-label="Editar mensagem"
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.68rem] text-inherit opacity-65 outline-none transition hover:bg-[#A07C3B]/10 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
              onClick={() => {
                setIsReactionPickerOpen(false);
                setEditValue(message.body);
                setEditError(null);
                setIsEditing(true);
              }}
              type="button"
            >
              <Pencil aria-hidden="true" size={12} />
            </button>
          ) : null}
          <div className="relative">
            <button
              aria-expanded={isTagMenuOpen}
              aria-label="Marcar mensagem"
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.68rem] text-inherit opacity-65 outline-none transition hover:bg-[#A07C3B]/10 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
              onClick={() => {
                setIsReactionPickerOpen(false);
                setIsInfoOpen(false);
                setIsTagMenuOpen((currentValue) => !currentValue);
              }}
              type="button"
            >
              <Tag aria-hidden="true" size={12} />
            </button>
            {isTagMenuOpen ? (
              <div className="absolute right-0 top-full z-[90] mt-2 w-44 overflow-hidden rounded-md border border-[#d9e0ea] bg-[#ffffff] py-1 text-left text-xs text-[#344054] shadow-[0_16px_34px_rgba(16,24,32,0.20)] ring-1 ring-[#d9e0ea]">
                {hermesMessageTagOptions.map((tag) => {
                  const selected = message.tags?.includes(tag.id) ?? false;

                  return (
                    <button
                      aria-pressed={selected}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left outline-none transition hover:bg-[#f3f6fa] focus-visible:bg-[#f3f6fa]"
                      key={tag.id}
                      onClick={() => onToggleTag?.(message.id, tag.id)}
                      type="button"
                    >
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[0.64rem] font-semibold ${
                          selected
                            ? getHermesMessageTagClassName(tag.id)
                            : "border-[#d9e0ea] bg-white text-[#667085]"
                        }`}
                      >
                        {tag.label}
                      </span>
                      {selected ? (
                        <Check
                          aria-hidden="true"
                          className="text-[#A07C3B]"
                          size={13}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="relative">
            {infoButton}
          </div>
        </div>
        {isInfoOpen ? (
          <MessageInfoPanel
            author={author}
            currentUserId={currentUserId}
            message={message}
            users={users}
          />
        ) : null}
        {visibleReactions.length > 0 ? (
          <ReactionSummary
            currentUserId={currentUserId}
            isOwn={isOwn}
            onSelect={onToggleReaction ? handleSelectReaction : undefined}
            reactions={visibleReactions}
          />
        ) : null}
      </div>
      {isOwn ? (
        <MessageAvatar
          avatarUrl={authorAvatarUrl}
          initials={authorInitials}
          name={authorName}
        />
      ) : null}
    </div>
  );
}

function MessageInfoPanel({
  author,
  currentUserId,
  message,
  users,
}: {
  author?: HermesPresenceUser;
  currentUserId?: HermesPresenceUser["id"];
  message: HermesMessage;
  users: readonly HermesPresenceUser[];
}) {
  const fallbackDeliveredUserIds = getFallbackDeliveredUserIds({
    message,
    users,
  });
  const deliveredUserIds = excludeAuthorUserIds({
    message,
    userIds:
      message.deliveredTo && message.deliveredTo.length > 0
        ? message.deliveredTo
        : fallbackDeliveredUserIds,
  });
  const readUserIds = excludeAuthorUserIds({
    message,
    userIds: message.readBy ?? [],
  });
  const deliveredUsers = getUsersById(users, deliveredUserIds);
  const readUsers = getUsersById(users, readUserIds);
  const mentionedUsers = getUsersById(users, message.mentionUserIds);
  const deliveredFallbackLabel = getFallbackUserLabel({
    author,
    currentUserId,
    message,
    userIds: deliveredUserIds,
  });
  const readFallbackLabel = getFallbackUserLabel({
    author,
    currentUserId,
    message,
    userIds: readUserIds,
  });

  return (
    <div className="relative z-[90] mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-[#d9e0ea] bg-[#ffffff] p-3 text-left text-xs text-[#344054] shadow-[0_18px_42px_rgba(16,24,32,0.20)] ring-1 ring-[#d9e0ea]">
      <div className="mb-2 flex items-center gap-2 border-b border-[#eef2f7] pb-2 text-sm font-semibold text-[#121722]">
        <CheckCheck aria-hidden="true" size={15} />
        Informações
      </div>
      <InfoRow label="Enviada por" value={getAuthorName(author, message)} />
      <InfoRow label="Horário" value={message.timestamp} />
      <InfoRow
        label="Lida por"
        value={formatUserList(readUsers, readFallbackLabel)}
      />
      <InfoRow
        label="Entregue para"
        value={formatUserList(deliveredUsers, deliveredFallbackLabel)}
      />
      {mentionedUsers.length > 0 ? (
        <InfoRow label="Mencoes" value={formatUserList(mentionedUsers)} />
      ) : null}
      {message.tags?.length ? (
        <div className="mt-2">
          <p className="m-0 mb-1 text-[0.68rem] font-semibold uppercase text-[#667085]">
            Tags
          </p>
          <div className="flex flex-wrap gap-1">
            {message.tags.map((tag) => (
              <span
                className={`rounded-full border px-2 py-0.5 text-[0.64rem] font-semibold ${getHermesMessageTagClassName(tag)}`}
                key={tag}
              >
                {getHermesMessageTagLabel(tag)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReactionPicker({
  currentUserId,
  messageReactions,
  onSelect,
  options,
  placement,
}: {
  currentUserId?: HermesPresenceUser["id"];
  messageReactions: readonly HermesReaction[];
  onSelect: (emoji: HermesReactionEmoji) => void;
  options: readonly HermesReactionEmoji[];
  placement: "left" | "right";
}) {
  return (
    <div
      className={`absolute top-full z-[90] mt-2 flex items-center gap-1 rounded-full border border-[#d9e0ea] bg-[#ffffff] px-1.5 py-1 shadow-[0_18px_40px_rgba(16,24,32,0.22)] ring-1 ring-[#d9e0ea] ${
        placement === "right" ? "right-0" : "left-0"
      }`}
    >
      {options.map((emoji) => {
        const selected = messageReactions.some(
          (reaction) =>
            reaction.emoji === emoji &&
            currentUserId &&
            reaction.reactedByUserIds.includes(currentUserId),
        );

        return (
          <button
            aria-label={`Reagir com ${emoji}`}
            aria-pressed={selected}
            className="grid h-8 w-8 place-items-center rounded-full text-[1.2rem] outline-none transition hover:scale-125 hover:bg-[#f3f6fa] focus-visible:ring-2 focus-visible:ring-[#A07C3B] aria-pressed:bg-[#eaf7f0]"
            key={emoji}
            onClick={() => onSelect(emoji)}
            type="button"
          >
            {emoji}
          </button>
        );
      })}
    </div>
  );
}

function ReactionSummary({
  currentUserId,
  isOwn,
  onSelect,
  reactions,
}: {
  currentUserId?: HermesPresenceUser["id"];
  isOwn: boolean;
  onSelect?: (emoji: HermesReactionEmoji) => void;
  reactions: readonly HermesReaction[];
}) {
  return (
    <div
      className={`relative z-10 mt-1 flex ${
        isOwn ? "justify-end" : "justify-start"
      }`}
    >
      <div className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-full border border-[#d9e0ea] bg-white px-1.5 py-0.5 text-xs shadow-sm">
        {reactions.map((reaction) => {
          const selected =
            Boolean(currentUserId) &&
            reaction.reactedByUserIds.includes(currentUserId ?? "");

          return (
            <button
              aria-label={`${reaction.count} reacoes com ${reaction.emoji}`}
              aria-pressed={selected}
              className="inline-flex h-6 items-center gap-1 rounded-full px-1.5 text-[0.72rem] font-semibold text-[#344054] outline-none transition hover:bg-[#f3f6fa] focus-visible:ring-2 focus-visible:ring-[#A07C3B] aria-pressed:bg-[#eaf7f0] aria-pressed:text-[#16794f]"
              disabled={!onSelect}
              key={reaction.emoji}
              onClick={() => onSelect?.(reaction.emoji)}
              type="button"
            >
              <span className="text-[0.95rem] leading-none">
                {reaction.emoji}
              </span>
              <span>{reaction.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MessageAttachmentPreview({
  attachment,
  onPreview,
}: {
  attachment: NonNullable<HermesMessage["attachment"]>;
  onPreview?: (attachment: NonNullable<HermesMessage["attachment"]>) => void;
}) {
  if (attachment.type === "sticker") {
    return (
      <div className="mb-1 inline-grid min-w-28 justify-items-center gap-1 rounded-2xl border border-[#d9e0ea] bg-[#ffffff] px-4 py-3 text-center shadow-sm">
        <span className="text-5xl leading-none" role="img" aria-label={attachment.label}>
          {attachment.emoji ?? "\u{1F642}"}
        </span>
        <span className="text-[0.68rem] font-semibold uppercase text-[#667085]">
          {attachment.label}
        </span>
      </div>
    );
  }

  if (attachment.type === "image" && attachment.url) {
    return (
      <button
        aria-label={`Visualizar imagem ${attachment.label}`}
        className="mb-2 block w-full overflow-hidden rounded-md border border-[#d9e0ea] bg-[#f3f6fa] text-left outline-none transition hover:border-[#A07C3B] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
        onClick={() => onPreview?.(attachment)}
        type="button"
      >
        <span
          aria-label={attachment.label}
          className="block h-56 w-full bg-cover bg-center"
          role="img"
          style={{ backgroundImage: `url(${attachment.url})` }}
        />
        <AttachmentCaption attachment={attachment} />
      </button>
    );
  }

  if (attachment.type === "audio" && attachment.url) {
    return (
      <div className="mb-2 rounded-md border border-[#d9e0ea] bg-[#f3f6fa] p-2.5">
        <AttachmentCaption attachment={attachment} />
        <audio className="mt-2 w-full" controls src={attachment.url} />
      </div>
    );
  }

  if (attachment.type === "video" && attachment.url) {
    return (
      <div className="mb-2 overflow-hidden rounded-md border border-[#d9e0ea] bg-[#f3f6fa]">
        <video
          className="max-h-60 w-full bg-black"
          controls
          src={attachment.url}
        />
        <AttachmentCaption attachment={attachment} />
      </div>
    );
  }

  const Icon = getAttachmentIcon(attachment.type);

  return (
    <div className="mb-2 grid gap-2 rounded-md border border-[#d9e0ea] bg-[#f3f6fa] p-2.5 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white text-[#667085]">
          <Icon aria-hidden="true" size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-[#121722]">
            {attachment.label}
          </span>
          {attachment.sizeBytes ? (
            <span className="mt-0.5 block text-[#667085]">
              {formatFileSize(attachment.sizeBytes)}
            </span>
          ) : null}
        </span>
      </div>
      {attachment.url ? (
        <div className="flex flex-wrap gap-2">
          <AttachmentActionLink
            href={attachment.url}
            icon={<ExternalLink aria-hidden="true" size={13} />}
            label="Abrir"
          />
          <AttachmentActionLink
            download={attachment.label}
            href={attachment.url}
            icon={<Download aria-hidden="true" size={13} />}
            label="Baixar"
          />
        </div>
      ) : (
        <span className="text-[#667085]">Arquivo indisponivel.</span>
      )}
    </div>
  );
}

function AttachmentActionLink({
  download,
  href,
  icon,
  label,
}: {
  download?: string;
  href: string;
  icon: ReactNode;
  label: string;
}) {
  return (
    <a
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#cfd8e3] bg-white px-2 font-semibold text-[#344054] no-underline outline-none transition hover:border-[#A07C3B] hover:text-[#7b5f2d] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
      download={download}
      href={href}
      rel="noreferrer"
      target={download ? undefined : "_blank"}
    >
      {icon}
      {label}
    </a>
  );
}

function AttachmentCaption({
  attachment,
}: {
  attachment: NonNullable<HermesMessage["attachment"]>;
}) {
  const Icon = getAttachmentIcon(attachment.type);

  return (
    <div className="flex items-center gap-2 px-2.5 py-2 text-xs">
      <Icon aria-hidden="true" size={15} />
      <span className="min-w-0 flex-1 truncate font-medium">
        {attachment.label}
      </span>
      {attachment.durationSeconds ? (
        <span className="text-[#667085]">
          {formatDuration(attachment.durationSeconds)}
        </span>
      ) : attachment.sizeBytes ? (
        <span className="text-[#667085]">
          {formatFileSize(attachment.sizeBytes)}
        </span>
      ) : null}
    </div>
  );
}

function getAttachmentIcon(
  type: NonNullable<HermesMessage["attachment"]>["type"],
) {
  if (type === "audio") {
    return Mic;
  }

  if (type === "image") {
    return Image;
  }

  if (type === "sticker") {
    return SmilePlus;
  }

  if (type === "video") {
    return Video;
  }

  return FileText;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 py-1">
      <span className="text-[#667085]">{label}</span>
      <span className="min-w-0 truncate font-medium text-[#121722]">
        {value}
      </span>
    </div>
  );
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;

  return `${minutes}:${restSeconds.toString().padStart(2, "0")}`;
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

function MessageAvatar({
  avatarUrl,
  initials,
  name,
}: {
  avatarUrl?: string;
  initials: string;
  name: string;
}) {
  return (
    <span
      aria-label={`Foto de ${name}`}
      className="mb-1 grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full border border-[#d9e0ea] bg-[#101820] text-[0.68rem] font-semibold text-white shadow-sm"
      role="img"
      style={
        avatarUrl
          ? {
              backgroundImage: `url(${avatarUrl})`,
              backgroundPosition: "center",
              backgroundSize: "cover",
            }
          : undefined
      }
    >
      {avatarUrl ? null : initials}
    </span>
  );
}

function getAuthorName(
  author: HermesPresenceUser | undefined,
  message: HermesMessage,
) {
  return author?.label ?? message.authorName ?? "Sistema";
}

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function getStandaloneEmojiMessage(
  body: string,
  attachment: HermesMessage["attachment"],
) {
  if (attachment) {
    return null;
  }

  const value = body.trim();

  if (!value || value.length > 32 || /[A-Za-z0-9]/.test(value)) {
    return null;
  }

  const compactValue = value.replace(/\s/g, "");
  const emojiOnlyPattern =
    /^(?:[\u00A9\u00AE\u203C-\u3299]\uFE0F?|[\u{1F000}-\u{1FAFF}]|\uFE0F|\u200D)+$/u;

  if (!emojiOnlyPattern.test(compactValue)) {
    return null;
  }

  const visibleCharacters = Array.from(
    compactValue.replace(/[\uFE0F\u200D]/g, ""),
  );

  if (visibleCharacters.length > 6) {
    return null;
  }

  return value;
}

function getUsersById(
  users: readonly HermesPresenceUser[],
  userIds: readonly HermesPresenceUser["id"][] = [],
) {
  return userIds
    .map((userId) => users.find((user) => user.id === userId))
    .filter((user): user is HermesPresenceUser => Boolean(user));
}

function getFallbackDeliveredUserIds({
  message,
  users,
}: {
  message: HermesMessage;
  users: readonly HermesPresenceUser[];
}) {
  const channelUserIds = users
    .filter((user) => user.channelIds.includes(message.channelId))
    .filter((user) => user.id !== message.authorId)
    .map((user) => user.id);

  if (channelUserIds.length > 0) {
    return channelUserIds;
  }

  return [];
}

function getFallbackUserLabel({
  author,
  currentUserId,
  message,
  userIds,
}: {
  author?: HermesPresenceUser;
  currentUserId?: HermesPresenceUser["id"];
  message: HermesMessage;
  userIds: readonly HermesPresenceUser["id"][];
}) {
  if (userIds.includes(author?.id ?? "")) {
    return author?.label;
  }

  if (userIds.includes(message.authorId)) {
    return getAuthorName(author, message);
  }

  if (currentUserId && userIds.includes(currentUserId)) {
    return "Voce";
  }

  return undefined;
}

function formatUserList(
  users: readonly HermesPresenceUser[],
  fallbackLabel?: string,
) {
  if (users.length === 0) {
    return fallbackLabel ?? "Ninguém ainda";
  }

  return users.map((user) => user.label).join(", ");
}

function getDeliveryState({
  message,
  users,
}: {
  message: HermesMessage;
  users: readonly HermesPresenceUser[];
}) {
  const recipientUserIds = excludeAuthorUserIds({
    message,
    userIds:
      message.deliveredTo && message.deliveredTo.length > 0
        ? message.deliveredTo
        : getFallbackDeliveredUserIds({ message, users }),
  });
  const readUserIds = new Set(
    excludeAuthorUserIds({
      message,
      userIds: message.readBy ?? [],
    }),
  );

  return {
    allRead:
      recipientUserIds.length > 0 &&
      recipientUserIds.every((userId) => readUserIds.has(userId)),
    recipientUserIds,
  };
}

function excludeAuthorUserIds({
  message,
  userIds,
}: {
  message: HermesMessage;
  userIds: readonly HermesPresenceUser["id"][];
}) {
  return [...new Set(userIds)].filter((userId) => userId !== message.authorId);
}

function renderMessageBody(
  message: HermesMessage,
  users: readonly HermesPresenceUser[],
) {
  const body = message.body;
  const ranges = getMentionRanges({ body, message, users });
  const lines = body.split(/\r?\n/);

  if (lines.length > 1 || lines.some((line) => getBulletLineParts(line))) {
    let cursor = 0;

    return lines.map((line, index) => {
      const lineStart = cursor;
      const lineEnd = lineStart + line.length;
      const bulletParts = getBulletLineParts(line);
      const contentStart = bulletParts
        ? lineStart + bulletParts.contentStart
        : lineStart;
      const content = bulletParts ? bulletParts.content : line;
      const lineRanges = ranges.filter(
        (range) => range.start < lineEnd && range.end > contentStart,
      );

      cursor = lineEnd + 1;

      if (!line.trim()) {
        return <div className="h-2" key={`line-${index}`} />;
      }

      if (bulletParts) {
        return (
          <div
            className="grid grid-cols-[0.85rem_minmax(0,1fr)] gap-1.5 py-0.5"
            key={`line-${index}`}
          >
            <span className="pt-px text-center text-base font-black leading-5 text-[#101820]">
              •
            </span>
            <span className="min-w-0">
              {renderMessageTextInline({
                body,
                keyPrefix: `line-${index}`,
                ranges: lineRanges,
                text: content,
                textStart: contentStart,
              })}
            </span>
          </div>
        );
      }

      return (
        <div key={`line-${index}`}>
          {renderMessageTextInline({
            body,
            keyPrefix: `line-${index}`,
            ranges: lineRanges,
            text: content,
            textStart: contentStart,
          })}
        </div>
      );
    });
  }

  if (ranges.length === 0) {
    return body;
  }

  return renderMessageTextInline({
    body,
    keyPrefix: "body",
    ranges,
    text: body,
    textStart: 0,
  });
}

function renderMessageTextInline({
  body,
  keyPrefix,
  ranges,
  text,
  textStart,
}: {
  body: string;
  keyPrefix: string;
  ranges: ReturnType<typeof getMentionRanges>;
  text: string;
  textStart: number;
}) {
  if (ranges.length === 0) {
    return text;
  }

  const fragments = [];
  let cursor = 0;

  ranges.forEach((range, index) => {
    const start = Math.max(0, range.start - textStart);
    const end = Math.min(text.length, range.end - textStart);

    if (start < cursor || end <= 0 || start >= text.length) {
      return;
    }

    if (start > cursor) {
      fragments.push(
        <span key={`${keyPrefix}-text-${index}-${cursor}`}>
          {text.slice(cursor, start)}
        </span>,
      );
    }

    const mentionText = body.slice(range.start, range.end);

    fragments.push(
      <span
        className="inline-flex items-baseline rounded-md border border-sky-300 bg-sky-100 px-1 font-semibold text-sky-900"
        data-user-id={range.mention.userId}
        key={`${keyPrefix}-mention-${range.mention.userId}-${range.start}`}
      >
        <span aria-hidden="true">
          {mentionText.trimStart().startsWith("@") ? "" : "@"}
        </span>
        {mentionText}
      </span>,
    );
    cursor = end;
  });

  if (cursor < text.length) {
    fragments.push(
      <span key={`${keyPrefix}-text-tail-${cursor}`}>
        {text.slice(cursor)}
      </span>,
    );
  }

  return fragments;
}

function getBulletLineParts(line: string) {
  const match = line.match(/^(\s*)(?:[-*•])\s*(.+)$/);

  if (!match?.[2]) {
    return null;
  }

  const contentStart = line.indexOf(match[2]);

  return {
    content: match[2],
    contentStart,
  };
}

function getMentionRanges({
  body,
  message,
  users,
}: {
  body: string;
  message: HermesMessage;
  users: readonly HermesPresenceUser[];
}) {
  const ranges: {
    end: number;
    mention: HermesMessageMention;
    start: number;
  }[] = [];

  function addMentionRange(mention: HermesMessageMention) {
    const range = findMentionRangeInBody(body, mention.displayName);

    if (!range) {
      return;
    }

    ranges.push({
      end: range.end,
      mention,
      start: range.start,
    });
  }

  (message.mentions ?? []).forEach(addMentionRange);

  const knownMentionUserIds = new Set(
    ranges.map((range) => range.mention.userId),
  );

  (message.mentionUserIds ?? []).forEach((userId) => {
    if (knownMentionUserIds.has(userId)) {
      return;
    }

    const user = users.find((currentUser) => currentUser.id === userId);
    const displayName = user?.label;

    if (!displayName) {
      return;
    }

    addMentionRange({
      displayName,
      trigger: "@",
      userId,
    });
  });

  return ranges
    .sort((firstRange, secondRange) => firstRange.start - secondRange.start)
    .filter((range, index, allRanges) => {
      const previousRange = allRanges[index - 1];

      return !previousRange || range.start >= previousRange.end;
    });
}

function findMentionRangeInBody(body: string, displayName: string) {
  const candidates = [`@${displayName}`, displayName];

  for (const candidate of candidates) {
    const exactIndex = body.indexOf(candidate);

    if (exactIndex >= 0) {
      return {
        end: exactIndex + candidate.length,
        start: exactIndex,
      };
    }
  }

  const normalizedBody = normalizeMentionText(body);

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeMentionText(candidate);
    const normalizedIndex = normalizedBody.indexOf(normalizedCandidate);

    if (normalizedIndex >= 0) {
      return {
        end: normalizedIndex + candidate.length,
        start: normalizedIndex,
      };
    }
  }

  return null;
}

function normalizeMentionText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

const defaultReactionOptions = [
  "\u{1F44D}",
  "\u2764\uFE0F",
  "\u{1F602}",
  "\u{1F62E}",
  "\u{1F622}",
  "\u{1F64F}",
] as const satisfies readonly HermesReactionEmoji[];
