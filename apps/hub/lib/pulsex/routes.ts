export const HERMES_MODULE_ID = "hermes";
export const HERMES_ROUTE = "/hermes";
export const LEGACY_PULSEX_ROUTE = "/pulsex";
export const HERMES_MESSAGES_API_ROUTE = "/api/hermes/messages";
export const HERMES_MESSAGES_PUSH_API_ROUTE = "/api/hermes/messages/push";
export const LEGACY_PULSEX_MESSAGES_API_ROUTE = "/api/pulsex/messages";

export function getHermesMessagesApiUrl(input: {
  after?: string;
  before?: string;
  channelId?: string;
  channelIds?: readonly string[];
  limit?: number;
  threadParentMessageId?: string;
} = {}) {
  const params = new URLSearchParams();

  if (input.channelId) {
    params.set("channelId", input.channelId);
  }

  if (input.channelIds?.length) {
    params.set("channelIds", input.channelIds.join(","));
  }

  if (input.threadParentMessageId) {
    params.set("threadParentMessageId", input.threadParentMessageId);
  }

  if (input.after) {
    params.set("after", input.after);
  }

  if (input.before) {
    params.set("before", input.before);
  }

  if (input.limit) {
    params.set("limit", input.limit.toString());
  }

  const queryString = params.toString();

  return queryString
    ? `${HERMES_MESSAGES_API_ROUTE}?${queryString}`
    : HERMES_MESSAGES_API_ROUTE;
}
