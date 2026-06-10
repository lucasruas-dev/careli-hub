import type {
  HermesChannel,
  HermesMessage,
  HermesPresenceUser,
  HermesThreadReply,
} from "./types";

const HERMES_THREAD_READ_STORAGE_PREFIX = "careli:hermes:thread-read-state";

export type HermesThreadReadReceipt = {
  lastReplyAt?: string;
  readAt: string;
  threadCount: number;
};

export type HermesThreadNotificationEntry = {
  channelName: string;
  id: string;
  lastReplyLabel: string;
  messageId: HermesMessage["id"];
  parentAuthorName?: string;
  parentPreview: string;
  replyCount: number;
  unreadCount: number;
};

export function getHermesThreadReadStorageKey(
  userId: HermesPresenceUser["id"],
) {
  return `${HERMES_THREAD_READ_STORAGE_PREFIX}:${userId}`;
}

export function normalizeHermesThreadReadState(
  input: unknown,
): Record<string, HermesThreadReadReceipt> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const nextState: Record<string, HermesThreadReadReceipt> = {};

  for (const [messageId, value] of Object.entries(input)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const record = value as Record<string, unknown>;
    const threadCount =
      typeof record.threadCount === "number" &&
      Number.isFinite(record.threadCount)
        ? Math.max(0, Math.floor(record.threadCount))
        : 0;

    nextState[messageId] = {
      lastReplyAt:
        typeof record.lastReplyAt === "string"
          ? record.lastReplyAt
          : undefined,
      readAt:
        typeof record.readAt === "string"
          ? record.readAt
          : new Date().toISOString(),
      threadCount,
    };
  }

  return nextState;
}

export function getHermesThreadUnreadCount(
  message: HermesMessage,
  receipt: HermesThreadReadReceipt | undefined,
) {
  if (message.deletedAt || message.threadParentMessageId) {
    return 0;
  }

  const threadCount = message.threadCount ?? 0;

  if (threadCount <= 0 || !receipt) {
    return 0;
  }

  return Math.max(0, threadCount - receipt.threadCount);
}

export function getHermesThreadParentPreview(message: HermesMessage) {
  const value =
    message.body.trim() ||
    message.attachment?.label ||
    "Mensagem com resposta";

  return value.length > 92 ? `${value.slice(0, 89)}...` : value;
}

export function formatHermesThreadNotificationTime(value: string | undefined) {
  if (!value) {
    return "--:--";
  }

  const time = Date.parse(value);

  if (Number.isNaN(time)) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(time));
}

export function getLatestHermesThreadReplyCreatedAt(
  replies: readonly HermesThreadReply[],
) {
  return replies.reduce<string | undefined>((latestValue, reply) => {
    if (!reply.createdAt) {
      return latestValue;
    }

    if (!latestValue) {
      return reply.createdAt;
    }

    const latestTime = Date.parse(latestValue);
    const replyTime = Date.parse(reply.createdAt);

    if (Number.isNaN(latestTime)) {
      return reply.createdAt;
    }

    if (Number.isNaN(replyTime)) {
      return latestValue;
    }

    return replyTime > latestTime ? reply.createdAt : latestValue;
  }, undefined);
}

export function getHermesThreadNotificationSortTime({
  messages,
  notification,
}: {
  messages: readonly HermesMessage[];
  notification: HermesThreadNotificationEntry;
}) {
  const message = messages.find(
    (currentMessage) => currentMessage.id === notification.messageId,
  );
  const time = Date.parse(
    message?.lastThreadReplyAt ?? message?.createdAt ?? "",
  );

  return Number.isNaN(time) ? 0 : time;
}

export function getHermesThreadChannelName({
  activeChannel,
  channelsById,
  message,
}: {
  activeChannel: HermesChannel;
  channelsById: ReadonlyMap<HermesChannel["id"], HermesChannel>;
  message: HermesMessage;
}) {
  return channelsById.get(message.channelId)?.name ?? activeChannel.name;
}
