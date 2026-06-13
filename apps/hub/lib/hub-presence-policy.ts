export const HUB_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
export const HUB_AUTO_LOGOUT_TIMEOUT_MS = 10 * 60 * 1000;
export const HUB_PRESENCE_HEARTBEAT_MS = 30 * 1000;

export const HUB_PRESENCE_POLICY_LABEL = "ausente apos 5 min / logout 10 min";

export function formatHubPresencePolicyLabel() {
  return HUB_PRESENCE_POLICY_LABEL;
}
