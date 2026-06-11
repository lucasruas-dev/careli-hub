"use client";

import {
  HUB_AUTO_LOGOUT_TIMEOUT_MS,
  HUB_IDLE_TIMEOUT_MS,
  HUB_PRESENCE_HEARTBEAT_MS,
  getHubPresenceCurrentMeeting,
  markHubPresence,
  normalizeHubPresenceStatus,
  type HubPresenceActiveMeeting,
  type HubPresenceChangeReason,
  type HubPresenceStatus,
} from "@/lib/hub-presence";
import { hasHubSupabaseConfig } from "@/lib/supabase/client";
import { useCallback, useEffect, useRef, useState } from "react";

type PresenceControllerInput = {
  enabled: boolean;
  onAutoLogout?: (details: {
    awayTimeoutMs: number;
    idleMs: number;
    logoutTimeoutMs: number;
  }) => Promise<unknown> | unknown;
  source?: string;
};

type MarkPresenceOptions = {
  manual?: boolean;
  metadata?: Record<string, unknown>;
  reason?: HubPresenceChangeReason;
};

const manualHoldStatuses = new Set<HubPresenceStatus>([]);

export function useHubPresenceController({
  enabled,
  onAutoLogout,
  source = "hub-shell",
}: PresenceControllerInput) {
  const [status, setStatus] = useState<HubPresenceStatus>("offline");
  const activeMeetingRef = useRef<HubPresenceActiveMeeting | null>(null);
  const autoLogoutTriggeredRef = useRef(false);
  const statusRef = useRef<HubPresenceStatus>("offline");
  const lastSentAtRef = useRef(0);
  const manualStatusRef = useRef<HubPresenceStatus | null>(null);
  const lastActivityAtRef = useRef(Date.now());
  const onAutoLogoutRef = useRef(onAutoLogout);

  useEffect(() => {
    onAutoLogoutRef.current = onAutoLogout;
  }, [onAutoLogout]);

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
      metadata?: Record<string, unknown>,
    ) {
      if (disposed) {
        return;
      }

      markPresence(nextStatus, { metadata, reason }).catch((error: unknown) => {
        if (isLocalDevelopmentRuntime()) {
          console.warn("[presence] update error", error);
        }
      });
    }

    function refreshCurrentMeeting() {
      getHubPresenceCurrentMeeting()
        .then((meeting) => {
          activeMeetingRef.current = meeting;
        })
        .catch((error: unknown) => {
          activeMeetingRef.current = null;

          if (isLocalDevelopmentRuntime()) {
            console.warn("[presence] meeting check error", error);
          }
        });
    }

    function triggerAutoLogout(idleMs: number) {
      if (autoLogoutTriggeredRef.current) {
        return;
      }

      autoLogoutTriggeredRef.current = true;

      markPresence("offline", {
        metadata: {
          awayTimeoutMs: HUB_IDLE_TIMEOUT_MS,
          idleMs,
          logoutTimeoutMs: HUB_AUTO_LOGOUT_TIMEOUT_MS,
          trigger: "auto_logout",
        },
        reason: "logout",
      })
        .catch((error: unknown) => {
          if (isLocalDevelopmentRuntime()) {
            console.warn("[presence] auto logout update error", error);
          }
        })
        .finally(() => {
          void onAutoLogoutRef.current?.({
            awayTimeoutMs: HUB_IDLE_TIMEOUT_MS,
            idleMs,
            logoutTimeoutMs: HUB_AUTO_LOGOUT_TIMEOUT_MS,
          });
        });
    }

    function handleActivity() {
      lastActivityAtRef.current = Date.now();
      autoLogoutTriggeredRef.current = false;

      const activeMeeting = activeMeetingRef.current;

      if (activeMeeting) {
        runPresenceUpdate("agenda", "agenda", {
          meetingId: activeMeeting.id,
          protocol: activeMeeting.protocol,
          rule: "chronos_current_meeting",
        });
        return;
      }

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
      const activeMeeting = activeMeetingRef.current;

      if (activeMeeting) {
        autoLogoutTriggeredRef.current = false;
        runPresenceUpdate("agenda", "agenda", {
          meetingId: activeMeeting.id,
          protocol: activeMeeting.protocol,
          rule: "chronos_current_meeting",
        });
        return;
      }

      const idleMs = Date.now() - lastActivityAtRef.current;

      if (idleMs >= HUB_AUTO_LOGOUT_TIMEOUT_MS) {
        triggerAutoLogout(idleMs);
        return;
      }

      if (idleMs >= HUB_IDLE_TIMEOUT_MS) {
        runPresenceUpdate("away", "idle", {
          awayTimeoutMs: HUB_IDLE_TIMEOUT_MS,
          idleMs,
          logoutTimeoutMs: HUB_AUTO_LOGOUT_TIMEOUT_MS,
          rule: "idle_without_panteon_activity",
        });
        return;
      }

      if (
        manualStatusRef.current &&
        manualHoldStatuses.has(manualStatusRef.current)
      ) {
        runPresenceUpdate(manualStatusRef.current, "heartbeat");
        return;
      }

      if (document.visibilityState === "visible") {
        runPresenceUpdate("online", "heartbeat");
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        handleActivity();
        return;
      }

      updateAutomaticPresence();
    }

    const activityEvents = [
      "click",
      "keydown",
      "mousedown",
      "mousemove",
      "pointerdown",
      "scroll",
      "touchstart",
      "wheel",
    ] as const;

    refreshCurrentMeeting();
    runPresenceUpdate("online", "login");

    for (const eventName of activityEvents) {
      window.addEventListener(eventName, handleActivity, { passive: true });
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    const intervalId = window.setInterval(
      updateAutomaticPresence,
      HUB_PRESENCE_HEARTBEAT_MS,
    );
    const meetingIntervalId = window.setInterval(refreshCurrentMeeting, 60_000);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.clearInterval(meetingIntervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, handleActivity);
      }
    };
  }, [enabled, markPresence, source]);

  return {
    setStatus: markPresence,
    status,
  };
}

function isLocalDevelopmentRuntime() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}
