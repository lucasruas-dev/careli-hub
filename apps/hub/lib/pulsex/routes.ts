export const HERMES_MODULE_ID = "hermes";
export const HERMES_ROUTE = "/hermes";
export const LEGACY_PULSEX_ROUTE = "/pulsex";
export const HERMES_MESSAGES_API_ROUTE = "/api/hermes/messages";
export const LEGACY_PULSEX_MESSAGES_API_ROUTE = "/api/pulsex/messages";

export function getHermesMessagesApiUrl(input: {
  channelId?: string;
  threadParentMessageId?: string;
} = {}) {
  const params = new URLSearchParams();

  if (input.channelId) {
    params.set("channelId", input.channelId);
  }

  if (input.threadParentMessageId) {
    params.set("threadParentMessageId", input.threadParentMessageId);
  }

  const queryString = params.toString();

  return queryString
    ? `${HERMES_MESSAGES_API_ROUTE}?${queryString}`
    : HERMES_MESSAGES_API_ROUTE;
}
