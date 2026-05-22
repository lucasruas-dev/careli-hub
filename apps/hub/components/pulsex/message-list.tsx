"use client";

import type {
  HermesCallHistoryEntry,
  HermesMessage,
  HermesMessageFilter,
  HermesMessageTag,
  HermesPresenceUser,
  HermesReactionEmoji,
} from "@/lib/pulsex";
import { EmptyState } from "@repo/uix";
import { PhoneCall, PhoneMissed, Video } from "lucide-react";
import { useEffect, useRef } from "react";
import { MessageItem } from "./message-item";

type MessageListProps = {
  callEvents?: readonly HermesCallHistoryEntry[];
  currentUserId?: HermesPresenceUser["id"];
  filter?: HermesMessageFilter;
  messages: readonly HermesMessage[];
  onEditMessage?: (
    messageId: HermesMessage["id"],
    body: string,
  ) => Promise<void> | void;
  onAskAiReply?: (messageId: HermesMessage["id"]) => void;
  onOpenThread?: (messageId: HermesMessage["id"]) => void;
  onReturnCall?: (entry: HermesCallHistoryEntry) => void;
  onToggleTag?: (
    messageId: HermesMessage["id"],
    tag: HermesMessageTag,
  ) => void;
  onToggleReaction?: (
    messageId: HermesMessage["id"],
    emoji: HermesReactionEmoji,
  ) => void;
  onPreviewAttachment?: (
    attachment: NonNullable<HermesMessage["attachment"]>,
  ) => void;
  reactionOptions?: readonly HermesReactionEmoji[];
  users: readonly HermesPresenceUser[];
};

export function MessageList({
  callEvents = [],
  currentUserId,
  filter = "all",
  messages,
  onEditMessage,
  onAskAiReply,
  onOpenThread,
  onPreviewAttachment,
  onReturnCall,
  onToggleReaction,
  onToggleTag,
  reactionOptions,
  users,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const timelineItems = getHermesTimelineItems({
    callEvents: filter === "all" ? callEvents : [],
    messages,
  });
  const lastTimelineItemId = timelineItems.at(-1)?.id;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [lastTimelineItemId]);

  if (timelineItems.length === 0) {
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
      {timelineItems.map((item) =>
        item.kind === "message" ? (
          <MessageItem
            author={users.find((user) => user.id === item.message.authorId)}
            currentUserId={currentUserId}
            key={item.id}
            message={item.message}
            onAskAiReply={onAskAiReply}
            onEditMessage={onEditMessage}
            onOpenThread={onOpenThread}
            onPreviewAttachment={onPreviewAttachment}
            onToggleReaction={onToggleReaction}
            onToggleTag={onToggleTag}
            reactionOptions={reactionOptions}
            users={users}
          />
        ) : (
          <HermesCallEventCard
            entry={item.entry}
            key={item.id}
            onReturnCall={onReturnCall}
          />
        ),
      )}
      <div ref={bottomRef} />
    </div>
  );
}

type HermesTimelineItem =
  | {
      id: string;
      kind: "call";
      sortTime: number;
      entry: HermesCallHistoryEntry;
    }
  | {
      id: string;
      kind: "message";
      sortTime: number;
      message: HermesMessage;
    };

function getHermesTimelineItems({
  callEvents,
  messages,
}: {
  callEvents: readonly HermesCallHistoryEntry[];
  messages: readonly HermesMessage[];
}): HermesTimelineItem[] {
  return [
    ...messages.map((message) => ({
      id: `message-${message.id}`,
      kind: "message" as const,
      message,
      sortTime: getHermesMessageTimelineTime(message),
    })),
    ...callEvents.map((entry) => ({
      entry,
      id: `call-${entry.id}`,
      kind: "call" as const,
      sortTime: getHermesCallTimelineTime(entry),
    })),
  ].sort((firstItem, secondItem) => {
    if (firstItem.sortTime !== secondItem.sortTime) {
      return firstItem.sortTime - secondItem.sortTime;
    }

    return firstItem.id.localeCompare(secondItem.id);
  });
}

function HermesCallEventCard({
  entry,
  onReturnCall,
}: {
  entry: HermesCallHistoryEntry;
  onReturnCall?: (entry: HermesCallHistoryEntry) => void;
}) {
  const copy = getCallEventCopy(entry);
  const isOutgoing = entry.direction === "outgoing";

  return (
    <article
      className={`grid max-w-[28rem] ${
        isOutgoing ? "justify-self-end pr-10" : "justify-self-start pl-10"
      }`}
    >
      <button
        className={`grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border px-4 py-3 text-left shadow-sm outline-none transition hover:shadow-md focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
          isOutgoing
            ? "border-[#c8ecd7] bg-[#eaf8f0]"
            : "border-[#e1e7ef] bg-white"
        }`}
        onClick={() => onReturnCall?.(entry)}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`grid h-10 w-10 place-items-center rounded-full ${copy.iconClass}`}
        >
          {copy.icon}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[#101820]">
            {copy.title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-[#667085]">
            {copy.subtitle}
          </span>
        </span>
        <span className="self-end text-xs font-bold text-[#101820]">
          {formatCallEventTime(entry.startedAt)}
        </span>
      </button>
    </article>
  );
}

function getCallEventCopy(entry: HermesCallHistoryEntry) {
  const kindLabel = entry.type === "video" ? "video" : "voz";
  const callIcon =
    entry.status === "missed" || entry.status === "declined" ? (
      <PhoneMissed aria-hidden="true" size={17} />
    ) : entry.type === "video" ? (
      <Video aria-hidden="true" size={17} />
    ) : (
      <PhoneCall aria-hidden="true" size={17} />
    );

  if (entry.status === "missed") {
    return {
      icon: callIcon,
      iconClass: "bg-[#fff1f2] text-rose-600",
      subtitle: "Clique para retornar",
      title: `Ligacao de ${kindLabel} perdida`,
    };
  }

  if (entry.status === "declined") {
    return {
      icon: callIcon,
      iconClass: "bg-[#fff7ed] text-orange-600",
      subtitle: "Clique para retornar",
      title: `Ligacao de ${kindLabel} nao atendida`,
    };
  }

  if (entry.status === "ringing") {
    return {
      icon: callIcon,
      iconClass:
        entry.direction === "outgoing"
          ? "bg-[#f2f4f7] text-[#344054]"
          : "bg-[#ecfdf3] text-emerald-700",
      subtitle:
        entry.direction === "outgoing" ? "Chamando" : "Clique para retornar",
      title:
        entry.direction === "outgoing"
          ? `Ligacao de ${kindLabel} realizada`
          : `Ligacao de ${kindLabel} recebida`,
    };
  }

  return {
    icon: callIcon,
    iconClass: "bg-[#f2f4f7] text-[#344054]",
    subtitle: entry.durationLabel
      ? `Duracao ${entry.durationLabel}`
      : "Clique para ligar novamente",
    title: `Ligacao de ${kindLabel} finalizada`,
  };
}

function getHermesMessageTimelineTime(message: HermesMessage) {
  const time = Date.parse(message.createdAt ?? message.timestamp);

  return Number.isNaN(time) ? 0 : time;
}

function getHermesCallTimelineTime(entry: HermesCallHistoryEntry) {
  const time = Date.parse(entry.startedAt);

  return Number.isNaN(time) ? 0 : time;
}

function formatCallEventTime(value: string) {
  const time = Date.parse(value);

  if (Number.isNaN(time)) {
    return "--:--";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(time));
}
