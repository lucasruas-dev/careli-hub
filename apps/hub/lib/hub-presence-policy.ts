export const HUB_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const HUB_AUTO_LOGOUT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export const HUB_PRESENCE_HEARTBEAT_MS = 30 * 1000;

export const HUB_PRESENCE_POLICY_LABEL = "ausente apos 10 min / logout 2 h";

export function formatHubPresencePolicyLabel() {
  return HUB_PRESENCE_POLICY_LABEL;
}

// Sinal cross-tab de "chamada Chronos ativa". A sala de video (Whereby embed em
// /chronos/operacao) roda em tela cheia, sem a topbar que hospeda o controlador de
// presenca; quando o Hub fica aberto em outra aba, o auto-logout de 2h daquela aba
// encerra a sessao Supabase (global) e derruba a videochamada. A sala publica este
// heartbeat no localStorage e o controlador de presenca o respeita em qualquer aba.
export const HUB_CHRONOS_CALL_HEARTBEAT_KEY = "chronos:call-heartbeat";
export const HUB_CHRONOS_CALL_HEARTBEAT_INTERVAL_MS = 15 * 1000;
export const HUB_CHRONOS_CALL_HEARTBEAT_TTL_MS = 35 * 1000;

export function writeHubChronosCallHeartbeat(now = Date.now()) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(HUB_CHRONOS_CALL_HEARTBEAT_KEY, String(now));
  } catch {
    // localStorage indisponivel (modo privado/cota) — ignora.
  }
}

export function clearHubChronosCallHeartbeat() {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(HUB_CHRONOS_CALL_HEARTBEAT_KEY);
  } catch {
    // ignora
  }
}

export function isHubChronosCallHeartbeatActive(now = Date.now()) {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const raw = window.localStorage.getItem(HUB_CHRONOS_CALL_HEARTBEAT_KEY);
    if (!raw) {
      return false;
    }
    const timestamp = Number.parseInt(raw, 10);
    if (!Number.isFinite(timestamp)) {
      return false;
    }
    return now - timestamp < HUB_CHRONOS_CALL_HEARTBEAT_TTL_MS;
  } catch {
    return false;
  }
}
