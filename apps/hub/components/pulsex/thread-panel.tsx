"use client";

import type {
  PulseXMessage,
  PulseXPresenceUser,
  PulseXReactionEmoji,
  PulseXThreadReply,
} from "@/lib/pulsex";
import { Send, X } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { MessageItem } from "./message-item";

type ThreadPanelProps = {
  currentUserId: PulseXPresenceUser["id"];
  message?: PulseXMessage;
  onChangeReply: (value: string) => void;
  onClose: () => void;
  onSubmitReply: () => void;
  onToggleReaction: (
    messageId: PulseXMessage["id"],
    emoji: PulseXReactionEmoji,
  ) => void;
  reactionOptions: readonly PulseXReactionEmoji[];
  replies: readonly PulseXThreadReply[];
  replyValue: string;
  users: readonly PulseXPresenceUser[];
};

export function ThreadPanel({
  currentUserId,
  message,
  onChangeReply,
  onClose,
  onSubmitReply,
  onToggleReaction,
  reactionOptions,
  replies,
  replyValue,
  users,
}: ThreadPanelProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmitReply();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmitReply();
    }
  }

  if (!message) {
    return null;
  }

  const isReplyEmpty = replyValue.trim().length === 0;

  return (
    <aside className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto] border-l border-[#d9e0ea] bg-white">
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
          onToggleReaction={onToggleReaction}
          reactionOptions={reactionOptions}
          users={users}
        />
        <div className="my-3 text-center text-xs text-[var(--uix-text-muted)]">
          {replies.length} respostas
        </div>
        {replies.map((reply) => {
          const author = users.find((user) => user.id === reply.authorId);
          const isOwn = reply.authorId === currentUserId;
          const authorName = author?.label ?? reply.authorName ?? "PulseX";
          const authorAvatarUrl = author?.avatarUrl ?? reply.authorAvatarUrl;
          const authorInitials = author?.initials ?? getInitials(authorName);

          return (
            <div
              className={`flex items-end gap-2 ${isOwn ? "justify-end" : "justify-start"} px-4 py-1`}
              key={reply.id}
            >
              {!isOwn ? (
                <ThreadReplyAvatar
                  avatarUrl={authorAvatarUrl}
                  initials={authorInitials}
                  name={authorName}
                />
              ) : null}
              <div
                className={`max-w-[78%] rounded-md border px-4 py-2 text-sm shadow-sm ${
                  isOwn
                    ? "border-[#A07C3B]/30 bg-[#f7f9fc] text-[#121722]"
                    : "border-[#d9e0ea] bg-white text-[var(--uix-text-primary)]"
                }`}
              >
                <p className="m-0 whitespace-pre-wrap leading-6">{reply.body}</p>
                <p className="m-0 mt-1 text-right text-[0.68rem] opacity-70">
                  {reply.timestamp}
                </p>
              </div>
              {isOwn ? (
                <ThreadReplyAvatar
                  avatarUrl={authorAvatarUrl}
                  initials={authorInitials}
                  name={authorName}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <form
        className="flex items-end gap-2 border-t border-[#d9e0ea] px-4 py-3"
        onSubmit={handleSubmit}
      >
        <textarea
          aria-label="Responder"
          className="max-h-28 min-h-10 flex-1 resize-none rounded-md border border-[#d9e0ea] bg-[#f8fafc] px-4 py-2.5 text-sm leading-5 text-[var(--uix-text-primary)] outline-none transition placeholder:text-[var(--uix-text-muted)] focus:border-[var(--uix-brand-primary)] focus:bg-white"
          onChange={(event) => onChangeReply(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Responder"
          rows={1}
          value={replyValue}
        />
        <button
          aria-label="Enviar resposta"
          className="grid h-10 w-10 place-items-center rounded-md bg-[var(--uix-brand-primary)] text-white outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)] disabled:cursor-not-allowed disabled:bg-[#e6ebf2] disabled:text-[#8b98aa]"
          disabled={isReplyEmpty}
          type="submit"
        >
          <Send aria-hidden="true" size={17} />
        </button>
      </form>
    </aside>
  );
}

function ThreadReplyAvatar({
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
      className="mb-1 grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full border border-[#d9e0ea] bg-[#101820] text-[0.62rem] font-semibold text-white shadow-sm"
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

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
