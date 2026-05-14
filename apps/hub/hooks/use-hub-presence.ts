"use client";

import {
  HUB_IDLE_TIMEOUT_MS,
  HUB_PRESENCE_HEARTBEAT_MS,
  markHubPresence,
  normalizeHubPresenceStatus,
  type HubPresenceChangeReason,
  type HubPresenceStatus,
} from "@/lib/hub-presence";
import { hasHubSupabaseConfig } from "@/lib/supabase/client";
import { useCallback, useEffect, useRef, useState } from "react";

type PresenceControllerInput = {
  enabled: boolean;
  source?: string;
};

type MarkPresenceOptions = {
  manual?: boolean;
  metadata?: Record<string, unknown>;
  reason?: HubPresenceChangeReason;
};

const manualHoldStatuses = new Set<HubPresenceStatus>([
  "agenda",
  "lunch",
  "offline",
]);

export function useHubPresenceController({
  enabled,
  source = "hub-shell",
}: PresenceControllerInput) {
  const [status, setStatus] = useState<HubPresenceStatus>("offline");
  const statusRef = useRef<HubPresenceStatus>("offline");
  const lastSentAtRef = useRef(0);
  const manualStatusRef = useRef<HubPresenceStatus | null>(null);
  const lastActivityAtRef = useRef(Date.now());

  const markPresence = useCallback(
    async (nextStatus: HubPresenceStatus, options: MarkPresenceOptions = {}) => {
      const normalizedStatus = normalizeHubPresenceStatus(nextStatus);

      if (options.manual) {
        manualStatusRef.current = manualHoldStatuses.has(normalizedStatus)
          ? normalizedStatus
          : null;
      }

      statusRef.current = normalizedStatus;
      setStatus(normalizedStatus);

      if (!enabled || !hasHubSupabaseConfig()) {
        return;
      }

      lastSentAtRef.current = Date.now();

      await markHubPresence({
        metadata: options.metadata,
        reason: options.reason ?? (options.manual ? "manual" : "heartbeat"),
        source,
        status: normalizedStatus,
      });
    },
    [enabled, source],
  );

  useEffect(() => {
    if (!enabled || !hasHubSupabaseConfig()) {
      return;
    }

    let disposed = false;

    function runPresenceUpdate(
      nextStatus: HubPresenceStatus,
      reason: HubPresenceChangeReason,
    ) {
      if (disposed) {
        return;
      }

      markPresence(nextStatus, { reason }).catch((error: unknown) => {
        if (isLocalDevelopmentRuntime()) {
          console.warn("[presence] update error", error);
        }
      });
    }

    function handleActivity() {
      lastActivityAtRef.current = Date.now();

      if (
        manualStatusRef.current &&
        manualHoldStatuses.has(manualStatusRef.current)
      ) {
        return;
      }

      if (document.visibilityState === "visible") {
        const recentlySynced =
          Date.now() - lastSentAtRef.current < HUB_PRESENCE_HEARTBEAT_MS / 2;

        if (statusRef.current === "online" && recentlySynced) {
          return;
        }

        runPresenceUpdate("online", "activity");
      }
    }

    function updateAutomaticPresence() {
      if (
        manualStatusRef.current &&
        manualHoldStatuses.has(manualStatusRef.current)
      ) {
        runPresenceUpdate(manualStatusRef.current, "heartbeat");
        return;
      }

      const isIdle = Date.now() - lastActivityAtRef.current >= HUB_IDLE_TIMEOUT_MS;
      const nextStatus =
        document.visibilityState === "hidden" || isIdle ? "away" : "online";
      const reason = nextStatus === "away" ? "idle" : "heartbeat";

      runPresenceUpdate(nextStatus, reason);
    }

    const activityEvents = [
      "click",
      "keydown",
      "mousedown",
      "mousemove",
      "pointerdown",
      "scroll",
      "touchstart",
    ] as const;

    runPresenceUpdate("online", "login");

    for (const eventName of activityEvents) {
      window.addEventListener(eventName, handleActivity, { passive: true });
    }

    document.addEventListener("visibilitychange", updateAutomaticPresence);

    const intervalId = window.setInterval(
      updateAutomaticPresence,
      HUB_PRESENCE_HEARTBEAT_MS,
    );

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", updateAutomaticPresence);

      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, handleActivity);
      }
    };
  }, [enabled, markPresence]);

  return {
    setStatus: markPresence,
    status,
  };
}

function isLocalDevelopmentRuntime() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}
