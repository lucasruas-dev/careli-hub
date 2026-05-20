import type { HermesChannel, HermesMessage } from "./types";

export const PULSEX_MESSAGE_BROADCAST_EVENT = "message-created";

export function getHermesMessageRealtimeTopic(channelId: HermesChannel["id"]) {
  return `pulsex:messages:${channelId}`;
}

export function parseHermesMessageBroadcastPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const message = (payload as { message?: unknown }).message;

  if (!message || typeof message !== "object") {
    return null;
  }

  const maybeMessage = message as Partial<HermesMessage>;

  if (
    !maybeMessage.id ||
    !maybeMessage.authorId ||
    !maybeMessage.body ||
    !maybeMessage.channelId ||
    !maybeMessage.timestamp
  ) {
    return null;
  }

  return {
    ...maybeMessage,
    authorId: maybeMessage.authorId,
    body: maybeMessage.body,
    channelId: maybeMessage.channelId,
    id: maybeMessage.id,
    reactions: maybeMessage.reactions ?? [],
    status: maybeMessage.status ?? "neutral",
    tags: maybeMessage.tags ?? [],
    timestamp: maybeMessage.timestamp,
  } satisfies HermesMessage;
}
