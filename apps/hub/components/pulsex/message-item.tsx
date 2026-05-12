"use client";

import type {
  PulseXMessage,
  PulseXMessageTag,
  PulseXPresenceUser,
  PulseXReactionEmoji,
} from "@/lib/pulsex";
import {
  CheckCheck,
  FileText,
  Image,
  Info,
  Mic,
  Reply,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import { useState } from "react";

type MessageItemProps = {
  author?: PulseXPresenceUser;
  currentUserId?: PulseXPresenceUser["id"];
  message: PulseXMessage;
  onOpenThread?: (messageId: PulseXMessage["id"]) => void;
  onToggleReaction?: (
    messageId: PulseXMessage["id"],
    emoji: PulseXReactionEmoji,
  ) => void;
  reactionOptions?: readonly PulseXReactionEmoji[];
  users?: readonly PulseXPresenceUser[];
};

const mentionPattern = /(@[A-Za-z0-9_-]+)/g;

const tagStyles = {
  acompanhar: "border-sky-200 bg-sky-50 text-sky-700",
  importante: "border-[#A07C3B]/30 bg-[#A07C3B]/10 text-[#7b5f2d]",
  pendente: "border-amber-200 bg-amber-50 text-amber-700",
  resolvido: "border-emerald-200 bg-emerald-50 text-emerald-700",
  urgente: "border-rose-200 bg-rose-50 text-rose-700",
} as const satisfies Record<PulseXMessageTag, string>;

const tagLabels = {
  acompanhar: "Acompanhar",
  importante: "Importante",
  pendente: "Pendente",
  resolvido: "Resolvido",
  urgente: "Urgente",
} as const satisfies Record<PulseXMessageTag, string>;

function renderMessageBody(body: string) {
  return body.split(mentionPattern).map((part, index) => {
    if (part.match(mentionPattern)) {
      return (
        <span
          className="font-semibold text-[var(--uix-brand-primary)]"
          key={`${part}-${index}`}
        >
          {part}
        </span>
      );
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

export function MessageItem({
  author,
  currentUserId,
  message,
  onOpenThread,
  onToggleReaction,
  reactionOptions = [],
  users = [],
}: MessageItemProps) {
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const isOwn = message.authorId === currentUserId;
  const reactionEmojis = [
    ...new Set([
      ...(message.reactions?.map((reaction) => reaction.emoji) ?? []),
      ...reactionOptions,
    ]),
  ] as PulseXReactionEmoji[];

  return (
    <div
      className={`flex ${isOwn ? "justify-end" : "justify-start"} px-4 py-0.5`}
    >
      <div
        className={`group max-w-[66%] border ${
          isOwn
            ? "border-[#A07C3B]/30 bg-[#f7f9fc] text-[#121722]"
            : "border-[#d9e0ea] bg-white text-[var(--uix-text-primary)]"
        } rounded-md px-3 py-2 shadow-sm`}
      >
        {!isOwn ? (
          <p className="m-0 mb-1 text-xs font-semibold text-[var(--uix-brand-primary)]">
            {author?.label ?? "PulseX"}
          </p>
        ) : null}
        {message.tags?.length ? (
          <div className="mb-2 flex flex-wrap gap-1">
            {message.tags.map((tag) => (
              <span
                className={`rounded-full border px-2 py-0.5 text-[0.64rem] font-semibold ${tagStyles[tag]}`}
                key={tag}
              >
                {tagLabels[tag]}
              </span>
            ))}
          </div>
        ) : null}
        {message.attachment ? (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-[#d9e0ea] bg-[#f3f6fa] px-2.5 py-2 text-xs">
            {message.attachment.type === "audio" ? (
              <Mic aria-hidden="true" size={15} />
            ) : message.attachment.type === "image" ? (
              <Image aria-hidden="true" size={15} />
            ) : (
              <FileText aria-hidden="true" size={15} />
            )}
            <span className="truncate font-medium">
              {message.attachment.label}
            </span>
          </div>
        ) : null}
        <p className="m-0 whitespace-pre-wrap text-sm leading-6">
          {message.deletedAt ? "Mensagem apagada" : renderMessageBody(message.body)}
        </p>
        <div className="mt-1 flex items-center justify-end gap-2 text-[0.66rem] opacity-60">
          {message.editedAt ? <span>editada</span> : null}
          <span>{message.timestamp}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1 opacity-90">
          {reactionEmojis.map((emoji) => {
            const reaction = message.reactions?.find(
              (messageReaction) => messageReaction.emoji === emoji,
            );
            const selected = currentUserId
              ? reaction?.reactedByUserIds.includes(currentUserId)
              : false;

            return (
              <button
                aria-pressed={selected}
                className="rounded border border-[#d9e0ea] bg-white/70 px-1.5 py-0.5 text-[0.68rem] outline-none transition hover:bg-white focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)] data-[selected=true]:border-[#A07C3B] data-[selected=true]:bg-[#A07C3B]/15"
                data-selected={selected}
                key={emoji}
                onClick={() => onToggleReaction?.(message.id, emoji)}
                type="button"
              >
                {emoji} {reaction?.count ?? ""}
              </button>
            );
          })}
          <button
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.68rem] text-inherit opacity-65 outline-none transition hover:bg-[#A07C3B]/10 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
            onClick={() => onOpenThread?.(message.id)}
            type="button"
          >
            <Reply aria-hidden="true" size={12} />
            {message.threadCount ? `${message.threadCount} respostas` : "Responder"}
          </button>
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
                message={message}
                users={users}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageInfoPanel({
  author,
  message,
  users,
}: {
  author?: PulseXPresenceUser;
  message: PulseXMessage;
  users: readonly PulseXPresenceUser[];
}) {
  const deliveredUsers = getUsersById(users, message.deliveredTo);
  const readUsers = getUsersById(users, message.readBy);

  return (
    <div className="absolute bottom-full right-0 z-20 mb-2 w-72 rounded-md border border-[#d9e0ea] bg-white p-3 text-left text-xs text-[#344054] shadow-lg">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#121722]">
        <CheckCheck aria-hidden="true" size={15} />
        Informações
      </div>
      <InfoRow label="Enviada por" value={author?.label ?? "PulseX"} />
      <InfoRow label="Horário" value={message.timestamp} />
      <InfoRow
        label="Lida por"
        value={formatUserList(readUsers)}
      />
      <InfoRow
        label="Entregue para"
        value={formatUserList(deliveredUsers)}
      />
      {message.tags?.length ? (
        <div className="mt-2">
          <p className="m-0 mb-1 text-[0.68rem] font-semibold uppercase text-[#667085]">
            Tags
          </p>
          <div className="flex flex-wrap gap-1">
            {message.tags.map((tag) => (
              <span
                className={`rounded-full border px-2 py-0.5 text-[0.64rem] font-semibold ${tagStyles[tag]}`}
                key={tag}
              >
                {tagLabels[tag]}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
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

function getUsersById(
  users: readonly PulseXPresenceUser[],
  userIds: readonly PulseXPresenceUser["id"][] = [],
) {
  return userIds
    .map((userId) => users.find((user) => user.id === userId))
    .filter((user): user is PulseXPresenceUser => Boolean(user));
}

function formatUserList(users: readonly PulseXPresenceUser[]) {
  if (users.length === 0) {
    return "Ninguém ainda";
  }

  return users.map((user) => user.label).join(", ");
}
