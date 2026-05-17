import type { PulseXChannel, PulseXMessage, PulseXPresenceUser } from "./types";

export type PulseXShortcutFilter = "favorites" | "mentions" | "unread";

type PulseXShortcutInput = {
  channels: readonly PulseXChannel[];
  currentUserId: PulseXPresenceUser["id"];
  favoriteChannelIds: readonly PulseXChannel["id"][];
  messages: readonly PulseXMessage[];
};

export function getPulseXShortcutChannels({
  channels,
  currentUserId,
  favoriteChannelIds,
  messages,
  shortcut,
}: PulseXShortcutInput & {
  shortcut: PulseXShortcutFilter | null;
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

export function getPulseXShortcutCounts({
  channels,
  currentUserId,
  favoriteChannelIds,
  messages,
}: PulseXShortcutInput) {
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
  message: PulseXMessage,
  userId: PulseXPresenceUser["id"],
) {
  return (
    message.authorId !== userId &&
    Boolean(message.mentionUserIds?.includes(userId))
  );
}
