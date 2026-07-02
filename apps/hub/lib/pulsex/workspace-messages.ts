import type {
  HermesChannel,
  HermesMessage,
  HermesPresenceUser,
  HermesReaction,
  HermesReactionEmoji,
} from "./types";

export function toggleHermesReactions({
  currentUserId,
  emoji,
  reactions,
}: {
  currentUserId: HermesPresenceUser["id"];
  emoji: HermesReactionEmoji;
  reactions: readonly HermesReaction[];
}): HermesReaction[] {
  const nextReactions = [...reactions];
  const reactionIndex = nextReactions.findIndex(
    (reaction) => reaction.emoji === emoji,
  );

  if (reactionIndex < 0) {
    return [
      ...nextReactions,
      {
        count: 1,
        emoji,
        reactedByUserIds: [currentUserId],
      },
    ];
  }

  const reaction = nextReactions[reactionIndex];

  if (!reaction) {
    return nextReactions;
  }

  const hasReacted = reaction.reactedByUserIds.includes(currentUserId);
  const reactedByUserIds = hasReacted
    ? reaction.reactedByUserIds.filter((userId) => userId !== currentUserId)
    : [...reaction.reactedByUserIds, currentUserId];
  const count = hasReacted ? reaction.count - 1 : reaction.count + 1;

  if (count <= 0) {
    nextReactions.splice(reactionIndex, 1);
    return nextReactions;
  }

  nextReactions[reactionIndex] = {
    ...reaction,
    count,
    reactedByUserIds,
  };

  return nextReactions;
}

export function mergeHermesChannelMessages({
  channelId,
  currentMessages,
  nextMessages,
  replaceChannel,
}: {
  channelId: HermesChannel["id"];
  currentMessages: readonly HermesMessage[];
  nextMessages: readonly HermesMessage[];
  replaceChannel: boolean;
}) {
  const nextIds = new Set(nextMessages.map((message) => message.id));
  const nextClientMessageIds = new Set(
    nextMessages
      .map((message) => message.clientMessageId)
      .filter((id): id is string => Boolean(id)),
  );
  const retainedMessages = currentMessages.filter((message) => {
    if (message.channelId !== channelId) {
      return true;
    }

    if (nextIds.has(message.id)) {
      return false;
    }

    if (
      message.clientMessageId &&
      nextClientMessageIds.has(message.clientMessageId)
    ) {
      return false;
    }

    return replaceChannel ? isLocalPendingHermesMessage(message) : true;
  });

  return [...retainedMessages, ...nextMessages].sort(compareHermesMessages);
}

export function withMessageDeliveryData(
  messages: readonly HermesMessage[],
  channels: readonly HermesChannel[],
) {
  const channelsById = new Map(
    channels.map((channel) => [channel.id, channel] as const),
  );

  return messages.map((message) => {
    const channel = channelsById.get(message.channelId);

    if (!channel) {
      return message;
    }

    return {
      ...message,
      deliveryStatus: getMessageDeliveryStatus(message, channel),
      deliveredTo: getMessageRecipientUserIds({
        channel,
        messageAuthorId: message.authorId,
      }),
      readBy: getMessageReadUserIds(message, channel),
    };
  });
}

export function withChannelUnreadCounts({
  channels,
  currentUserId,
  messages,
}: {
  channels: readonly HermesChannel[];
  currentUserId: HermesPresenceUser["id"];
  messages: readonly HermesMessage[];
}) {
  const messagesByChannelId = new Map<HermesChannel["id"], HermesMessage[]>();

  for (const message of messages) {
    if (message.deletedAt || message.threadParentMessageId) {
      continue;
    }

    const channelMessages = messagesByChannelId.get(message.channelId) ?? [];

    channelMessages.push(message);
    messagesByChannelId.set(message.channelId, channelMessages);
  }

  return channels.map((channel) => {
    const lastReadAt = channel.memberReadAtByUserId?.[currentUserId];
    const lastReadTime = lastReadAt ? Date.parse(lastReadAt) : Number.NaN;
    const unreadMessages = (messagesByChannelId.get(channel.id) ?? []).filter(
      (message) =>
        message.authorId !== currentUserId &&
        isMessageNewerThanLastRead(message, lastReadTime),
    );
    const unreadMentionCount = unreadMessages.filter((message) =>
      message.mentionUserIds?.includes(currentUserId),
    ).length;

    return {
      ...channel,
      unreadCount: unreadMessages.length,
      unreadMentionCount,
    };
  });
}

export function getMessageRecipientUserIds({
  channel,
  messageAuthorId,
}: {
  channel: HermesChannel;
  messageAuthorId: HermesPresenceUser["id"];
}) {
  return (channel.memberUserIds ?? []).filter(
    (userId) => userId !== messageAuthorId,
  );
}

function isLocalPendingHermesMessage(message: HermesMessage) {
  return (
    message.id.startsWith("local-") &&
    (message.deliveryStatus === "pending" || message.deliveryStatus === "failed")
  );
}

function compareHermesMessages(
  firstMessage: HermesMessage,
  secondMessage: HermesMessage,
) {
  const firstTime = getHermesMessageSortTime(firstMessage);
  const secondTime = getHermesMessageSortTime(secondMessage);

  if (firstTime !== secondTime) {
    return firstTime - secondTime;
  }

  return firstMessage.id.localeCompare(secondMessage.id);
}

function getHermesMessageSortTime(message: HermesMessage) {
  if (!message.createdAt) {
    return 0;
  }

  const time = Date.parse(message.createdAt);

  return Number.isNaN(time) ? 0 : time;
}

function isMessageNewerThanLastRead(
  message: HermesMessage,
  lastReadTime: number,
) {
  const createdAt = message.createdAt ?? message.timestamp;
  const messageTime = Date.parse(createdAt);

  if (Number.isNaN(messageTime)) {
    return false;
  }

  if (Number.isNaN(lastReadTime)) {
    return true;
  }

  return messageTime > lastReadTime;
}

function getMessageReadUserIds(message: HermesMessage, channel: HermesChannel) {
  if (!message.createdAt) {
    return message.readBy ?? [];
  }

  const messageCreatedAt = Date.parse(message.createdAt);

  if (Number.isNaN(messageCreatedAt)) {
    return message.readBy ?? [];
  }

  return Object.entries(channel.memberReadAtByUserId ?? {})
    .filter(([userId]) => userId !== message.authorId)
    .filter(([, lastReadAt]) => {
      const lastReadTime = Date.parse(lastReadAt);

      return !Number.isNaN(lastReadTime) && lastReadTime >= messageCreatedAt;
    })
    .map(([userId]) => userId);
}

function getMessageDeliveryStatus(
  message: HermesMessage,
  channel: HermesChannel,
): NonNullable<HermesMessage["deliveryStatus"]> {
  if (message.deliveryStatus === "pending" || message.deliveryStatus === "failed") {
    return message.deliveryStatus;
  }

  const recipientUserIds = getMessageRecipientUserIds({
    channel,
    messageAuthorId: message.authorId,
  });
  const readUserIds = new Set(getMessageReadUserIds(message, channel));

  if (
    recipientUserIds.length > 0 &&
    recipientUserIds.every((userId) => readUserIds.has(userId))
  ) {
    return "read";
  }

  return "delivered";
}
