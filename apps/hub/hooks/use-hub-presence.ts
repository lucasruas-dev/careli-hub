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

function isManualHoldPresence(status: HubPresenceStatus) {
  return status === "agenda" || status === "away" || status === "lunch";
}

function isProtectedManualPresence(status: HubPresenceStatus | null) {
  return status === "agenda" || status === "lunch";
}

export function useHubPresenceController({
  enabled,
  onAutoLogout,
  source = "hub-shell",
}: PresenceControllerInput) {
  const [status, setStatus] = useState<HubPresenceStatus>("offline");
  const activeMeetingRef = useRef<HubPresenceActiveMeeting | null>(null);
  const awayTimeoutRef = useRef<number | null>(null);
  const autoLogoutTriggeredRef = useRef(false);
  const logoutTimeoutRef = useRef<number | null>(null);
  const statusRef = useRef<HubPresenceStatus>("offline");
  const lastSentAtRef = useRef(0);
  const lastActivityAtRef = useRef(Date.now());
  const manualPresenceRef = useRef<HubPresenceStatus | null>(null);
  const onAutoLogoutRef = useRef(onAutoLogout);

  useEffect(() => {
    onAutoLogoutRef.current = onAutoLogout;
  }, [onAutoLogout]);

  const markPresence = useCallback(
    async (nextStatus: HubPresenceStatus, options: MarkPresenceOptions = {}) => {
      const normalizedStatus = normalizeHubPresenceStatus(nextStatus);

      if (options.manual) {
        lastActivityAtRef.current = Date.now();
        autoLogoutTriggeredRef.current = false;
        manualPresenceRef.current = isManualHoldPresence(normalizedStatus)
          ? normalizedStatus
          : null;
      } else if (normalizedStatus === "offline" || normalizedStatus === "online") {
        manualPresenceRef.current = null;
      }

      statusRef.current = normalizedStatus;
      setStatus(normalizedStatus);

      if (!enabled || !hasHubSupabaseConfig()) {
        return;
      }

      const sentAt = Date.now();
      lastSentAtRef.current = sentAt;

      const savedPresence = await markHubPresence({
        metadata: options.metadata,
        reason: options.reason ?? (options.manual ? "manual" : "heartbeat"),
        source,
        status: normalizedStatus,
      });

      if (savedPresence && lastSentAtRef.current === sentAt) {
        statusRef.current = savedPresence.status;
        setStatus(savedPresence.status);
      }
    },
    [enabled, source],
  );

  useEffect(() => {
    if (!enabled || !hasHubSupabaseConfig()) {
      return;
    }

    let disposed = false;

    function clearPresenceTimers() {
      if (awayTimeoutRef.current !== null) {
        window.clearTimeout(awayTimeoutRef.current);
        awayTimeoutRef.current = null;
      }

      if (logoutTimeoutRef.current !== null) {
        window.clearTimeout(logoutTimeoutRef.current);
        logoutTimeoutRef.current = null;
      }
    }

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

          if (meeting && !disposed) {
            updateAutomaticPresence();
          }
        })
        .catch((error: unknown) => {
          activeMeetingRef.current = null;

          if (isLocalDevelopmentRuntime()) {
            console.warn("[presence] meeting check error", error);
          }
        });
    }

    function getAgendaExceptionRule() {
      if (manualPresenceRef.current === "agenda") {
        return "manual_agenda";
      }

      if (activeMeetingRef.current) {
        return "chronos_current_meeting";
      }

      if (isChronosCallRoute()) {
        return "chronos_call_route";
      }

      return null;
    }

    function isAgendaExceptionActive() {
      return getAgendaExceptionRule() !== null;
    }

    function isPresencePenaltyExempt() {
      return (
        isAgendaExceptionActive() ||
        isProtectedManualPresence(manualPresenceRef.current)
      );
    }

    function getMeetingMetadata() {
      const activeMeeting = activeMeetingRef.current;
      const rule = getAgendaExceptionRule() ?? "chronos_call_route";

      return activeMeeting
        ? {
            meetingId: activeMeeting.id,
            protocol: activeMeeting.protocol,
            rule,
          }
        : {
            rule,
          };
    }

    function schedulePresenceTimers() {
      clearPresenceTimers();

      if (isPresencePenaltyExempt()) {
        return;
      }

      const idleMs = Date.now() - lastActivityAtRef.current;
      const awayDelay = Math.max(0, HUB_IDLE_TIMEOUT_MS - idleMs);
      const logoutDelay = Math.max(0, HUB_AUTO_LOGOUT_TIMEOUT_MS - idleMs);

      awayTimeoutRef.current = window.setTimeout(() => {
        updateAutomaticPresence();
      }, awayDelay + 50);

      logoutTimeoutRef.current = window.setTimeout(() => {
        updateAutomaticPresence();
      }, logoutDelay + 50);
    }

    function recordIdleAway(idleMs: number) {
      runPresenceUpdate("away", "idle", {
        awayTimeoutMs: HUB_IDLE_TIMEOUT_MS,
        idleMs,
        logoutTimeoutMs: HUB_AUTO_LOGOUT_TIMEOUT_MS,
        rule: "idle_without_panteon_activity",
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

    function reconcileIdleBeforeActivity(now = Date.now()) {
      if (isPresencePenaltyExempt()) {
        return true;
      }

      const idleMs = now - lastActivityAtRef.current;

      if (idleMs >= HUB_AUTO_LOGOUT_TIMEOUT_MS) {
        triggerAutoLogout(idleMs);
        return false;
      }

      return true;
    }

    function handleActivity() {
      const now = Date.now();
      const idleMs = now - lastActivityAtRef.current;

      if (!reconcileIdleBeforeActivity(now)) {
        return;
      }

      lastActivityAtRef.current = now;
      autoLogoutTriggeredRef.current = false;

      if (isAgendaExceptionActive()) {
        runPresenceUpdate("agenda", "agenda", {
          ...getMeetingMetadata(),
        });
        schedulePresenceTimers();
        return;
      }

      if (isProtectedManualPresence(manualPresenceRef.current)) {
        schedulePresenceTimers();
        return;
      }

      if (manualPresenceRef.current) {
        schedulePresenceTimers();
        return;
      }

      if (document.visibilityState === "visible") {
        const recentlySynced =
          Date.now() - lastSentAtRef.current < HUB_PRESENCE_HEARTBEAT_MS / 2;

        if (statusRef.current === "online" && recentlySynced) {
          return;
        }

        runPresenceUpdate(
          "online",
          "activity",
          idleMs >= HUB_IDLE_TIMEOUT_MS
            ? {
                awayTimeoutMs: HUB_IDLE_TIMEOUT_MS,
                idleMs,
                logoutTimeoutMs: HUB_AUTO_LOGOUT_TIMEOUT_MS,
                rule: "return_after_idle_without_panteon_activity",
              }
            : undefined,
        );
      }

      schedulePresenceTimers();
    }

    function updateAutomaticPresence() {
      if (isAgendaExceptionActive()) {
        autoLogoutTriggeredRef.current = false;
        runPresenceUpdate("agenda", "agenda", {
          ...getMeetingMetadata(),
        });
        schedulePresenceTimers();
        return;
      }

      if (isProtectedManualPresence(manualPresenceRef.current)) {
        clearPresenceTimers();
        return;
      }

      const idleMs = Date.now() - lastActivityAtRef.current;

      if (idleMs >= HUB_AUTO_LOGOUT_TIMEOUT_MS) {
        triggerAutoLogout(idleMs);
        return;
      }

      if (idleMs >= HUB_IDLE_TIMEOUT_MS) {
        recordIdleAway(idleMs);
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
    schedulePresenceTimers();

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
      clearPresenceTimers();
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

function isChronosCallRoute() {
  const pathname = window.location.pathname;

  return /^\/chronos\/(?!recording-view(?:\/|$))[^/]+/.test(pathname);
}

function isLocalDevelopmentRuntime() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}
