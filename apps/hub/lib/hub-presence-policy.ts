export const HUB_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const HUB_AUTO_LOGOUT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export const HUB_PRESENCE_HEARTBEAT_MS = 30 * 1000;

export const HUB_PRESENCE_POLICY_LABEL = "ausente apos 10 min / logout 2 h";

export function formatHubPresencePolicyLabel() {
  return HUB_PRESENCE_POLICY_LABEL;
}
