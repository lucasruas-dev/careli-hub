"use client";

import type {
  PulseXMessage,
  PulseXMessageFilter,
  PulseXMessageTag,
  PulseXPresenceUser,
} from "@/lib/pulsex";
import { EmptyState } from "@repo/uix";
import { useEffect, useRef } from "react";
import { MessageItem } from "./message-item";

type MessageListProps = {
  currentUserId?: PulseXPresenceUser["id"];
  filter?: PulseXMessageFilter;
  messages: readonly PulseXMessage[];
  onEditMessage?: (
    messageId: PulseXMessage["id"],
    body: string,
  ) => Promise<void> | void;
  onOpenThread?: (messageId: PulseXMessage["id"]) => void;
  onToggleTag?: (
    messageId: PulseXMessage["id"],
    tag: PulseXMessageTag,
  ) => void;
  users: readonly PulseXPresenceUser[];
};

export function MessageList({
  currentUserId,
  filter = "all",
  messages,
  onEditMessage,
  onOpenThread,
  onToggleTag,
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
            ? "As mensagens deste canal aparecerao aqui."
            : filter === "mentions"
              ? "Nenhuma mensagem marcou voce neste canal."
            : "Nenhuma mensagem desta conversa possui a tag selecionada."
        }
        title={
          filter === "all"
            ? "Nenhuma mensagem"
            : filter === "mentions"
              ? "Nenhuma mencao"
              : "Nenhuma mensagem no filtro"
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
          onEditMessage={onEditMessage}
          onOpenThread={onOpenThread}
          onToggleTag={onToggleTag}
          users={users}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
