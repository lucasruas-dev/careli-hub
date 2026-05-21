const HERMES_DIRECT_CHANNEL_PREFIX = "direct-";
const HERMES_DIRECT_CHANNEL_SEPARATOR = "--";

export function createHermesDirectChannelId(
  firstUserId: string,
  secondUserId: string,
) {
  const first = firstUserId.trim();
  const second = secondUserId.trim();

  if (!first || !second || first === second) {
    return "";
  }

  return `${HERMES_DIRECT_CHANNEL_PREFIX}${[first, second]
    .sort()
    .join(HERMES_DIRECT_CHANNEL_SEPARATOR)}`;
}

export function getHermesDirectPeerUserId(
  channelId: string,
  currentUserId: string,
) {
  const parsedChannel = parseHermesDirectChannelId(channelId);

  if (!parsedChannel || !parsedChannel.userIds.includes(currentUserId)) {
    return null;
  }

  return (
    parsedChannel.userIds.find((userId) => userId !== currentUserId) ?? null
  );
}

export function isHermesDirectChannelId(channelId: string) {
  return Boolean(parseHermesDirectChannelId(channelId));
}

export function parseHermesDirectChannelId(channelId: string):
  | {
      userIds: readonly [string, string];
    }
  | null {
  if (!channelId.startsWith(HERMES_DIRECT_CHANNEL_PREFIX)) {
    return null;
  }

  const rawUserIds = channelId
    .slice(HERMES_DIRECT_CHANNEL_PREFIX.length)
    .split(HERMES_DIRECT_CHANNEL_SEPARATOR)
    .map((userId) => userId.trim())
    .filter(Boolean);

  if (rawUserIds.length !== 2 || rawUserIds[0] === rawUserIds[1]) {
    return null;
  }

  const userIds = rawUserIds.sort() as [string, string];
  const expectedChannelId = createHermesDirectChannelId(userIds[0], userIds[1]);

  if (channelId !== expectedChannelId) {
    return null;
  }

  return { userIds };
}
