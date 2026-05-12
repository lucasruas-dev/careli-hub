"use client";

import type {
  PulseXMessage,
  PulseXMessageFilter,
  PulseXPresenceUser,
  PulseXReactionEmoji,
} from "@/lib/pulsex";
import { EmptyState } from "@repo/uix";
import { useEffect, useRef } from "react";
import { MessageItem } from "./message-item";

type MessageListProps = {
  currentUserId?: PulseXPresenceUser["id"];
  filter?: PulseXMessageFilter;
  messages: readonly PulseXMessage[];
  onOpenThread?: (messageId: PulseXMessage["id"]) => void;
  onToggleReaction?: (
    messageId: PulseXMessage["id"],
    emoji: PulseXReactionEmoji,
  ) => void;
  reactionOptions?: readonly PulseXReactionEmoji[];
  users: readonly PulseXPresenceUser[];
};

export function MessageList({
  currentUserId,
  filter = "all",
  messages,
  onOpenThread,
  onToggleReaction,
  reactionOptions,
  users,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastMessageId = messages.at(-1)?.id;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [lastMessageId]);

  if (messages.length === 0) {
    return (
      <EmptyState
        description={
          filter === "all"
            ? "As mensagens do canal aparecerao aqui quando o realtime real entrar."
            : "Nenhuma mensagem desta conversa possui a tag selecionada."
        }
        title={
          filter === "all" ? "Nenhuma mensagem" : "Nenhuma mensagem no filtro"
        }
      />
    );
  }

  return (
    <div
      aria-label="Mensagens do canal"
      className="grid gap-2 px-2"
      role="log"
    >
      {messages.map((message) => (
        <MessageItem
          author={users.find((user) => user.id === message.authorId)}
          currentUserId={currentUserId}
          key={message.id}
          message={message}
          onOpenThread={onOpenThread}
          onToggleReaction={onToggleReaction}
          reactionOptions={reactionOptions}
          users={users}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
