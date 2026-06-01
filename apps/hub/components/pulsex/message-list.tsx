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
  channelId: string;
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
  getThreadUnreadCount?: (messageId: HermesMessage["id"]) => number;
  reactionOptions?: readonly HermesReactionEmoji[];
  users: readonly HermesPresenceUser[];
};

export function MessageList({
  callEvents = [],
  channelId,
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
  getThreadUnreadCount,
  reactionOptions,
  users,
}: MessageListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const previousChannelIdRef = useRef(channelId);
  const shouldFollowTailRef = useRef(true);
  const timelineItems = getHermesTimelineItems({
    callEvents: filter === "all" ? callEvents : [],
    messages,
  });
  const lastTimelineItemId = timelineItems.at(-1)?.id;
  const visibleTimelineItems =
    getHermesTimelineItemsWithDateDividers(timelineItems);

  function handleScroll() {
    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    shouldFollowTailRef.current = distanceFromBottom < 96;
  }

  useEffect(() => {
    const channelChanged = previousChannelIdRef.current !== channelId;

    if (channelChanged) {
      previousChannelIdRef.current = channelId;
      shouldFollowTailRef.current = true;
    }

    if (!shouldFollowTailRef.current) {
      return;
    }

    window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({
        behavior: channelChanged ? "auto" : "smooth",
        block: "end",
      });
    });
  }, [channelId, lastTimelineItemId]);

  if (timelineItems.length === 0) {
    return (
      <div className="grid h-full min-h-0 place-items-center px-4">
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
      </div>
    );
  }

  return (
    <div
      aria-label="Mensagens do canal"
      className="h-full min-h-0 overflow-y-auto overflow-x-hidden px-2 py-4 [scrollbar-gutter:stable]"
      onScroll={handleScroll}
      ref={scrollContainerRef}
      role="log"
    >
      <div className="grid min-h-full content-end gap-2">
        {visibleTimelineItems.map((item) => {
          if (item.kind === "message") {
            return (
              <MessageItem
                author={users.find(
                  (user) => user.id === item.message.authorId,
                )}
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
                threadUnreadCount={getThreadUnreadCount?.(item.message.id) ?? 0}
                users={users}
              />
            );
          }

          if (item.kind === "call") {
            return (
              <HermesCallEventCard
                entry={item.entry}
                key={item.id}
                onReturnCall={onReturnCall}
              />
            );
          }

          return <HermesDateDivider key={item.id} label={item.label} />;
        })}
        <div ref={bottomRef} />
      </div>
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

type HermesVisibleTimelineItem =
  | HermesTimelineItem
  | {
      id: string;
      kind: "date";
      label: string;
      sortTime: number;
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

function getHermesTimelineItemsWithDateDividers(
  timelineItems: readonly HermesTimelineItem[],
): HermesVisibleTimelineItem[] {
  const visibleItems: HermesVisibleTimelineItem[] = [];
  let currentDateKey = "";

  for (const item of timelineItems) {
    const dateKey = getHermesTimelineDateKey(item.sortTime);

    if (dateKey !== currentDateKey) {
      currentDateKey = dateKey;
      visibleItems.push({
        id: `date-${dateKey}`,
        kind: "date",
        label: formatHermesTimelineDateLabel(item.sortTime),
        sortTime: item.sortTime,
      });
    }

    visibleItems.push(item);
  }

  return visibleItems;
}

function HermesDateDivider({ label }: { label: string }) {
  return (
    <div className="sticky top-2 z-10 my-3 grid place-items-center">
      <span className="rounded-full border border-[#d9e0ea] bg-white/95 px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.08em] text-[#667085] shadow-sm backdrop-blur">
        {label}
      </span>
    </div>
  );
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

function getHermesTimelineDateKey(time: number) {
  if (!Number.isFinite(time) || time <= 0) {
    return "sem-data";
  }

  const date = new Date(time);

  return [
    date.getFullYear(),
    (date.getMonth() + 1).toString().padStart(2, "0"),
    date.getDate().toString().padStart(2, "0"),
  ].join("-");
}

function formatHermesTimelineDateLabel(time: number) {
  if (!Number.isFinite(time) || time <= 0) {
    return "Sem data";
  }

  const date = new Date(time);
  const dateLabel = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  const weekdayLabel = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
  }).format(date);
  const dateKey = getHermesTimelineDateKey(time);
  const today = new Date();
  const todayKey = getHermesTimelineDateKey(today.getTime());
  const yesterday = new Date(today);

  yesterday.setDate(today.getDate() - 1);

  const yesterdayKey = getHermesTimelineDateKey(yesterday.getTime());

  if (dateKey === todayKey) {
    return `Hoje - ${dateLabel}, ${weekdayLabel}`;
  }

  if (dateKey === yesterdayKey) {
    return `Ontem - ${dateLabel}, ${weekdayLabel}`;
  }

  return `${dateLabel}, ${weekdayLabel}`;
}
