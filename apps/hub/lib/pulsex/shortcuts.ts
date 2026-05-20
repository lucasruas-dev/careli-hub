import type { HermesChannel, HermesMessage, HermesPresenceUser } from "./types";

export type HermesShortcutFilter = "favorites" | "mentions" | "unread";

type HermesShortcutInput = {
  channels: readonly HermesChannel[];
  currentUserId: HermesPresenceUser["id"];
  favoriteChannelIds: readonly HermesChannel["id"][];
  messages: readonly HermesMessage[];
};

export function getHermesShortcutChannels({
  channels,
  currentUserId,
  favoriteChannelIds,
  messages,
  shortcut,
}: HermesShortcutInput & {
  shortcut: HermesShortcutFilter | null;
}) {
  if (!shortcut) {
    return [...channels];
  }

  const favoriteIds = new Set(favoriteChannelIds);
  const mentionChannelIds = new Set(
    messages
      .filter((message) => isMessageMentioningUser(message, currentUserId))
      .map((message) => message.channelId),
  );

  return channels.filter((channel) => {
    if (shortcut === "unread") {
      return (channel.unreadCount ?? 0) > 0;
    }

    if (shortcut === "mentions") {
      return mentionChannelIds.has(channel.id);
    }

    return favoriteIds.has(channel.id);
  });
}

export function getHermesShortcutCounts({
  channels,
  currentUserId,
  favoriteChannelIds,
  messages,
}: HermesShortcutInput) {
  const favoriteIds = new Set(favoriteChannelIds);

  return {
    favorites: channels.filter((channel) => favoriteIds.has(channel.id)).length,
    mentions: messages.filter((message) =>
      isMessageMentioningUser(message, currentUserId),
    ).length,
    unread: channels.reduce(
      (total, channel) => total + (channel.unreadCount ?? 0),
      0,
    ),
  };
}

function isMessageMentioningUser(
  message: HermesMessage,
  userId: HermesPresenceUser["id"],
) {
  return (
    message.authorId !== userId &&
    Boolean(message.mentionUserIds?.includes(userId))
  );
}
