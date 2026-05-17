"use client";

import type {
  PulseXMessage,
  PulseXMessageTag,
  PulseXPresenceUser,
  PulseXReactionEmoji,
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
  Tag,
  Video,
  X,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import {
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  getPulseXMessageTagClassName,
  getPulseXMessageTagLabel,
  pulseXMessageTagOptions,
} from "@/lib/pulsex/message-tags";

type MessageItemProps = {
  author?: PulseXPresenceUser;
  currentUserId?: PulseXPresenceUser["id"];
  message: PulseXMessage;
  onOpenThread?: (messageId: PulseXMessage["id"]) => void;
  onEditMessage?: (
    messageId: PulseXMessage["id"],
    body: string,
  ) => Promise<void> | void;
  onToggleTag?: (
    messageId: PulseXMessage["id"],
    tag: PulseXMessageTag,
  ) => void;
  onToggleReaction?: (
    messageId: PulseXMessage["id"],
    emoji: PulseXReactionEmoji,
  ) => void;
  reactionOptions?: readonly PulseXReactionEmoji[];
  users?: readonly PulseXPresenceUser[];
};

export function MessageItem({
  author,
  currentUserId,
  message,
  onEditMessage,
  onOpenThread,
  onToggleTag,
  users = [],
}: MessageItemProps) {
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editValue, setEditValue] = useState(message.body);
  const [isEditing, setIsEditing] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isTagMenuOpen, setIsTagMenuOpen] = useState(false);
  const isOwn = message.authorId === currentUserId;
  const authorName = getAuthorName(author, message);
  const authorAvatarUrl = author?.avatarUrl ?? message.authorAvatarUrl;
  const authorInitials = author?.initials ?? getInitials(authorName);
  const deliveryState = getDeliveryState({ message, users });

  useEffect(() => {
    if (!isEditing) {
      setEditValue(message.body);
    }
  }, [isEditing, message.body]);

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

  return (
    <div
      className={`flex items-end gap-2 px-4 py-1 ${
        isOwn ? "justify-end" : "justify-start"
      }`}
    >
      {!isOwn ? (
        <MessageAvatar
          avatarUrl={authorAvatarUrl}
          initials={authorInitials}
          name={authorName}
        />
      ) : null}
      <div
        className={`group max-w-[66%] border ${
          isOwn
            ? "border-[#A07C3B]/30 bg-[#f7f9fc] text-[#121722]"
            : "border-[#d9e0ea] bg-white text-[var(--uix-text-primary)]"
        } rounded-md px-3 py-2 shadow-sm`}
      >
        {message.tags?.length ? (
          <div className="mb-2 flex flex-wrap gap-1">
            {message.tags.map((tag) => (
              <span
                className={`rounded-full border px-2 py-0.5 text-[0.64rem] font-semibold ${getPulseXMessageTagClassName(tag)}`}
                key={tag}
              >
                {getPulseXMessageTagLabel(tag)}
              </span>
            ))}
          </div>
        ) : null}
        {message.attachment ? (
          <MessageAttachmentPreview attachment={message.attachment} />
        ) : null}
        {isEditing ? (
          <form className="grid gap-2" onSubmit={handleSubmitEdit}>
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
        ) : (
          <p className="m-0 whitespace-pre-wrap text-sm leading-6">
            {message.deletedAt ? "Mensagem apagada" : renderMessageBody(message)}
          </p>
        )}
        <div className="mt-1 flex items-center justify-end gap-2 text-[0.66rem] opacity-70">
          {message.editedAt ? <span>editada</span> : null}
          <span>{message.timestamp}</span>
          {isOwn ? (
            <Tooltip content={deliveryState.allRead ? "Todos leram" : "Enviado"}>
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
        <div className="mt-1.5 flex flex-wrap items-center gap-1 opacity-90">
          <Tooltip content="Responder">
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
              onClick={() => onOpenThread?.(message.id)}
              type="button"
            >
              <Reply aria-hidden="true" size={13} />
              {message.threadCount ? (
                <span className="text-[0.65rem] font-semibold">
                  {message.threadCount}
                </span>
              ) : null}
            </button>
          </Tooltip>
          {isOwn && onEditMessage && !message.deletedAt ? (
            <Tooltip content="Editar mensagem">
              <button
                aria-label="Editar mensagem"
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.68rem] text-inherit opacity-65 outline-none transition hover:bg-[#A07C3B]/10 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
                onClick={() => {
                  setEditValue(message.body);
                  setEditError(null);
                  setIsEditing(true);
                }}
                type="button"
              >
                <Pencil aria-hidden="true" size={12} />
              </button>
            </Tooltip>
          ) : null}
          <div className="relative">
            <Tooltip content="Marcar mensagem">
              <button
                aria-expanded={isTagMenuOpen}
                aria-label="Marcar mensagem"
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.68rem] text-inherit opacity-65 outline-none transition hover:bg-[#A07C3B]/10 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
                onClick={() => setIsTagMenuOpen((currentValue) => !currentValue)}
                type="button"
              >
                <Tag aria-hidden="true" size={12} />
              </button>
            </Tooltip>
            {isTagMenuOpen ? (
              <div className="absolute bottom-full right-0 z-20 mb-2 w-44 overflow-hidden rounded-md border border-[#d9e0ea] bg-white py-1 text-left text-xs text-[#344054] shadow-lg">
                {pulseXMessageTagOptions.map((tag) => {
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
                            ? getPulseXMessageTagClassName(tag.id)
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
            <Tooltip content="Informações da mensagem">
              <button
                aria-expanded={isInfoOpen}
                aria-label="Informações da mensagem"
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.68rem] text-inherit opacity-65 outline-none transition hover:bg-[#A07C3B]/10 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
                onClick={() => setIsInfoOpen((currentValue) => !currentValue)}
                type="button"
              >
                <Info aria-hidden="true" size={12} />
              </button>
            </Tooltip>
            {isInfoOpen ? (
              <MessageInfoPanel
                author={author}
                currentUserId={currentUserId}
                message={message}
                users={users}
              />
            ) : null}
          </div>
        </div>
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
  author?: PulseXPresenceUser;
  currentUserId?: PulseXPresenceUser["id"];
  message: PulseXMessage;
  users: readonly PulseXPresenceUser[];
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
    <div className="absolute bottom-full right-0 z-20 mb-2 w-72 rounded-md border border-[#d9e0ea] bg-white p-3 text-left text-xs text-[#344054] shadow-lg">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#121722]">
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
        <InfoRow
          label="Mencoes"
          value={formatUserList(mentionedUsers)}
        />
      ) : null}
      {message.tags?.length ? (
        <div className="mt-2">
          <p className="m-0 mb-1 text-[0.68rem] font-semibold uppercase text-[#667085]">
            Tags
          </p>
          <div className="flex flex-wrap gap-1">
            {message.tags.map((tag) => (
              <span
                className={`rounded-full border px-2 py-0.5 text-[0.64rem] font-semibold ${getPulseXMessageTagClassName(tag)}`}
                key={tag}
              >
                {getPulseXMessageTagLabel(tag)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MessageAttachmentPreview({
  attachment,
}: {
  attachment: NonNullable<PulseXMessage["attachment"]>;
}) {
  if (attachment.type === "image" && attachment.url) {
    return (
      <a
        className="mb-2 block overflow-hidden rounded-md border border-[#d9e0ea] bg-[#f3f6fa]"
        href={attachment.url}
        rel="noreferrer"
        target="_blank"
      >
        <span
          aria-label={attachment.label}
          className="block h-56 w-full bg-cover bg-center"
          role="img"
          style={{ backgroundImage: `url(${attachment.url})` }}
        />
        <AttachmentCaption attachment={attachment} />
      </a>
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
        <video className="max-h-60 w-full bg-black" controls src={attachment.url} />
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
  attachment: NonNullable<PulseXMessage["attachment"]>;
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

function getAttachmentIcon(type: NonNullable<PulseXMessage["attachment"]>["type"]) {
  if (type === "audio") {
    return Mic;
  }

  if (type === "image") {
    return Image;
  }

  if (type === "video") {
    return Video;
  }

  return FileText;
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
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
      title={name}
    >
      {avatarUrl ? null : initials}
    </span>
  );
}

function getAuthorName(
  author: PulseXPresenceUser | undefined,
  message: PulseXMessage,
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

function getUsersById(
  users: readonly PulseXPresenceUser[],
  userIds: readonly PulseXPresenceUser["id"][] = [],
) {
  return userIds
    .map((userId) => users.find((user) => user.id === userId))
    .filter((user): user is PulseXPresenceUser => Boolean(user));
}

function getFallbackDeliveredUserIds({
  message,
  users,
}: {
  message: PulseXMessage;
  users: readonly PulseXPresenceUser[];
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
  author?: PulseXPresenceUser;
  currentUserId?: PulseXPresenceUser["id"];
  message: PulseXMessage;
  userIds: readonly PulseXPresenceUser["id"][];
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
  users: readonly PulseXPresenceUser[],
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
  message: PulseXMessage;
  users: readonly PulseXPresenceUser[];
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
  message: PulseXMessage;
  userIds: readonly PulseXPresenceUser["id"][];
}) {
  return [...new Set(userIds)].filter((userId) => userId !== message.authorId);
}

function renderMessageBody(message: PulseXMessage) {
  const body = message.body;
  const mentions = message.mentions ?? [];
  const ranges = mentions
    .map((mention) => {
      const start = body.indexOf(mention.displayName);

      if (start < 0) {
        return null;
      }

      return {
        end: start + mention.displayName.length,
        mention,
        start,
      };
    })
    .filter((range): range is NonNullable<typeof range> => Boolean(range))
    .sort((firstRange, secondRange) => firstRange.start - secondRange.start);

  if (ranges.length === 0) {
    return body;
  }

  const fragments = [];
  let cursor = 0;

  ranges.forEach((range, index) => {
    if (range.start < cursor) {
      return;
    }

    if (range.start > cursor) {
      fragments.push(
        <span key={`text-${index}-${cursor}`}>
          {body.slice(cursor, range.start)}
        </span>,
      );
    }

    fragments.push(
      <span
        className="rounded-sm bg-[#A07C3B]/10 px-0.5 font-semibold text-[#7b5f2d]"
        data-user-id={range.mention.userId}
        key={`mention-${range.mention.userId}-${range.start}`}
      >
        {range.mention.displayName}
      </span>,
    );
    cursor = range.end;
  });

  if (cursor < body.length) {
    fragments.push(<span key={`text-tail-${cursor}`}>{body.slice(cursor)}</span>);
  }

  return fragments;
}
