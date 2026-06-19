"use client";

import type {
  HermesCallHistoryEntry,
  HermesCallHistoryStatus,
  HermesCallParticipant,
  HermesCallRealtimeSignal,
  HermesCallRealtimeSignalInput,
  HermesCallSession,
  HermesCallSignalKind,
  HermesPresenceUser,
} from "@/lib/pulsex";
import {
  getHubSupabaseClient,
  hasHubSupabaseConfig,
  logSupabaseDiagnostic,
  serializeDiagnosticError,
} from "@/lib/supabase/client";
import {
  playHermesCallSound,
  playHermesOutgoingCallSound,
  showBrowserHermesNotification,
} from "@/lib/pulsex/notification-effects";
import { useAuth } from "@/providers/auth-provider";
import { Tooltip } from "@repo/uix";
import { Phone, PhoneOff } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CallPanel } from "@/components/pulsex/call-panel";
import { IncomingCallBanner } from "@/components/pulsex/incoming-call-banner";

type HermesCallContextValue = {
  callHistory: readonly HermesCallHistoryEntry[];
  endActiveCall: () => void;
  markCallHistoryRead: (channelId?: string) => void;
  startCall: (input: {
    session: HermesCallSession;
    targetUserIds: readonly HermesPresenceUser["id"][];
  }) => void;
  unreadCallCount: number;
};

type HubSupabaseClient = NonNullable<ReturnType<typeof getHubSupabaseClient>>;
type HubRealtimeChannel = ReturnType<HubSupabaseClient["channel"]>;

const PULSEX_CALL_SIGNAL_EVENT = "call-signal";
const PULSEX_CALL_SIGNAL_TOPIC = "pulsex:calls";
const PULSEX_ACTIVE_CALL_STORAGE_KEY = "careli:pulsex:active-call";
const PULSEX_CALL_HISTORY_STORAGE_KEY = "careli:pulsex:call-history";
const PULSEX_ACTIVE_CALL_STORAGE_TTL_MS = 1000 * 60 * 60 * 4;
const PULSEX_CALL_HISTORY_LIMIT = 80;
const PULSEX_CALL_DISABLED_HOSTS = new Set([
  "ops.c2x.app.br",
  "ops.c2x.careli",
  "ops.careli.adm.br",
]);

type StoredHermesActiveCall = {
  currentUserId: HermesPresenceUser["id"];
  isCallPanelOpen: boolean;
  savedAt: number;
  session: HermesCallSession;
};

const HermesCallContext = createContext<HermesCallContextValue | null>(null);

export function HermesCallProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  if (isHermesCallDisabledHost()) {
    return (
      <HermesCallContext.Provider value={disabledHermesCallContextValue}>
        {children}
      </HermesCallContext.Provider>
    );
  }

  return <ActiveHermesCallProvider>{children}</ActiveHermesCallProvider>;
}

function ActiveHermesCallProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const { hubUser, profileStatus } = useAuth();
  const currentUserId = hubUser?.id ?? "";
  const [activeCall, setActiveCall] = useState<HermesCallSession | null>(null);
  const [callSignals, setCallSignals] = useState<HermesCallRealtimeSignal[]>([]);
  const [incomingCall, setIncomingCall] = useState<HermesCallSession | null>(
    null,
  );
  const [callHistory, setCallHistory] = useState<HermesCallHistoryEntry[]>([]);
  const [isCallPanelOpen, setIsCallPanelOpen] = useState(true);
  const [callHistoryStorageUserId, setCallHistoryStorageUserId] = useState<
    HermesPresenceUser["id"] | null
  >(null);
  const [isCallHistoryStorageReady, setIsCallHistoryStorageReady] =
    useState(false);
  const [isCallRealtimeReady, setIsCallRealtimeReady] = useState(false);
  const [restoredCallId, setRestoredCallId] = useState<string | null>(null);
  const activeCallRef = useRef<HermesCallSession | null>(null);
  const callRealtimeChannelRef = useRef<HubRealtimeChannel | null>(null);
  const incomingCallRef = useRef<HermesCallSession | null>(null);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  useEffect(() => {
    if (hubUser || profileStatus === "loading") {
      return;
    }

    setActiveCall(null);
    setIncomingCall(null);
    setCallSignals([]);
    clearStoredHermesActiveCall();
  }, [hubUser, profileStatus]);

  useEffect(() => {
    if (!currentUserId) {
      setCallHistory([]);
      setCallHistoryStorageUserId(null);
      setIsCallHistoryStorageReady(false);
      return;
    }

    setCallHistory(readStoredHermesCallHistory(currentUserId));
    setCallHistoryStorageUserId(currentUserId);
    setIsCallHistoryStorageReady(true);
  }, [currentUserId]);

  useEffect(() => {
    if (
      !currentUserId ||
      !isCallHistoryStorageReady ||
      callHistoryStorageUserId !== currentUserId
    ) {
      return;
    }

    writeStoredHermesCallHistory(currentUserId, callHistory);
  }, [
    callHistory,
    callHistoryStorageUserId,
    currentUserId,
    isCallHistoryStorageReady,
  ]);

  useEffect(() => {
    if (!currentUserId || activeCallRef.current || profileStatus === "loading") {
      return;
    }

    const restoredCall = readStoredHermesActiveCall(currentUserId);

    if (!restoredCall) {
      return;
    }

    setActiveCall(restoredCall.session);
    setIncomingCall(null);
    setIsCallPanelOpen(restoredCall.isCallPanelOpen);
    setRestoredCallId(restoredCall.session.id);
  }, [currentUserId, profileStatus]);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    if (!activeCall) {
      clearStoredHermesActiveCall();
      return;
    }

    writeStoredHermesActiveCall({
      currentUserId,
      isCallPanelOpen,
      savedAt: Date.now(),
      session: activeCall,
    });
  }, [activeCall, currentUserId, isCallPanelOpen]);

  const appendCallSignal = useCallback((signal: HermesCallRealtimeSignal) => {
    setCallSignals((currentSignals) =>
      [...currentSignals.filter((item) => item.id !== signal.id), signal].slice(
        -160,
      ),
    );
  }, []);

  const sendCallSignal = useCallback(
    (input: HermesCallRealtimeSignalInput) => {
      if (!currentUserId) {
        return null;
      }

      const signal = {
        ...input,
        fromUserId: input.fromUserId ?? currentUserId,
        id: createHermesCallSignalId(input.kind),
        sentAt: new Date().toISOString(),
      } satisfies HermesCallRealtimeSignal;
      const realtimeChannel = callRealtimeChannelRef.current;

      if (!realtimeChannel) {
        logSupabaseDiagnostic("pulsex", "call signal skipped", {
          kind: signal.kind,
          reason: "missing-realtime-channel",
        });
        return signal;
      }

      realtimeChannel
        .send({
          event: PULSEX_CALL_SIGNAL_EVENT,
          payload: signal,
          type: "broadcast",
        })
        .then((response) => {
          logSupabaseDiagnostic("pulsex", "call signal sent", {
            kind: signal.kind,
            response,
          });
        })
        .catch((error: unknown) => {
          logSupabaseDiagnostic("pulsex", "call signal error", {
            error: serializeDiagnosticError(error),
            kind: signal.kind,
          });
        });

      return signal;
    },
    [currentUserId],
  );

  const recordCallHistory = useCallback(
    (
      session: HermesCallSession,
      status: HermesCallHistoryStatus,
      options: { unread?: boolean } = {},
    ) => {
      if (!currentUserId) {
        return;
      }

      const entry = createHermesCallHistoryEntry({
        currentUserId,
        session,
        status,
        unread: options.unread ?? false,
      });

      setCallHistory((currentHistory) =>
        upsertHermesCallHistoryEntry(currentHistory, entry),
      );
    },
    [currentUserId],
  );

  const handleIncomingCallSignal = useCallback(
    (signal: HermesCallRealtimeSignal) => {
      appendCallSignal(signal);

      if (signal.kind === "invite" && signal.session) {
        if (
          activeCallRef.current?.id === signal.callId ||
          incomingCallRef.current?.id === signal.callId
        ) {
          return;
        }

        recordCallHistory(signal.session, "ringing", {
          unread: true,
        });
        setIncomingCall(signal.session);
        showBrowserHermesNotification({
          body: `${getCallCallerLabel(signal.session)} chamou em ${signal.session.title}.`,
          title: "Chamada no Hermes",
        });
        return;
      }

      if (signal.kind === "join" && signal.participant) {
        const participant = signal.participant;
        const currentCall = activeCallRef.current;

        if (
          currentCall?.id === signal.callId &&
          currentCall.initiatedByUserId === currentUserId
        ) {
          recordCallHistory(currentCall, "answered");
        }

        setActiveCall((currentCall) =>
          currentCall?.id === signal.callId
            ? upsertCallParticipant(currentCall, participant, "joined")
            : currentCall,
        );
        return;
      }

      if (signal.kind === "decline" || signal.kind === "leave") {
        const currentCall = activeCallRef.current;

        if (
          currentCall?.id === signal.callId &&
          currentCall.initiatedByUserId === currentUserId
        ) {
          recordCallHistory(
            currentCall,
            signal.kind === "decline" ? "declined" : "ended",
          );
        }

        setActiveCall((currentCall) =>
          currentCall?.id === signal.callId
            ? updateCallParticipantStatus(
                currentCall,
                signal.fromUserId,
                "left",
              )
            : currentCall,
        );
        return;
      }

      if (
        signal.kind === "screen-share-start" ||
        signal.kind === "screen-share-stop"
      ) {
        setActiveCall((currentCall) =>
          currentCall?.id === signal.callId
            ? updateCallParticipantScreenShare(
                currentCall,
                signal.fromUserId,
                signal.kind === "screen-share-start",
              )
            : currentCall,
        );
        return;
      }

      if (signal.kind === "end") {
        const pendingIncomingCall = incomingCallRef.current;
        const currentCall = activeCallRef.current;

        if (pendingIncomingCall?.id === signal.callId) {
          recordCallHistory(pendingIncomingCall, "missed", {
            unread: true,
          });
        }

        if (currentCall?.id === signal.callId) {
          recordCallHistory(currentCall, "ended");
        }

        setIncomingCall((currentCall) =>
          currentCall?.id === signal.callId ? null : currentCall,
        );
        setActiveCall((currentCall) =>
          currentCall?.id === signal.callId ? null : currentCall,
        );
      }
    },
    [appendCallSignal, currentUserId, recordCallHistory],
  );

  useEffect(() => {
    if (
      !currentUserId ||
      profileStatus !== "ready" ||
      !hasHubSupabaseConfig()
    ) {
      return;
    }

    const client = getHubSupabaseClient();

    if (!client) {
      return;
    }

    const realtimeChannel = client.channel(PULSEX_CALL_SIGNAL_TOPIC, {
      config: {
        broadcast: {
          ack: true,
          self: false,
        },
      },
    });

    callRealtimeChannelRef.current = realtimeChannel;
    realtimeChannel
      .on(
        "broadcast",
        {
          event: PULSEX_CALL_SIGNAL_EVENT,
        },
        (message: { payload?: unknown }) => {
          const signal = parseHermesCallSignal(message.payload);

          if (
            !signal ||
            !shouldHandleCallSignalForCurrentUser({
              activeCall: activeCallRef.current,
              currentUserId,
              incomingCall: incomingCallRef.current,
              signal,
            })
          ) {
            return;
          }

          handleIncomingCallSignal(signal);
        },
      )
      .subscribe((status) => {
        logSupabaseDiagnostic("pulsex", "call realtime status", {
          status,
        });
        setIsCallRealtimeReady(status === "SUBSCRIBED");
      });

    return () => {
      if (callRealtimeChannelRef.current === realtimeChannel) {
        callRealtimeChannelRef.current = null;
      }

      setIsCallRealtimeReady(false);
      void client.removeChannel(realtimeChannel);
    };
  }, [currentUserId, handleIncomingCallSignal, profileStatus]);

  useEffect(() => {
    if (!incomingCall) {
      return;
    }

    playHermesCallSound();
    const intervalId = window.setInterval(() => {
      playHermesCallSound();
    }, 2_200);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [incomingCall]);

  useEffect(() => {
    if (
      !activeCall ||
      activeCall.initiatedByUserId !== currentUserId ||
      !hasPendingInvitedCallParticipant(activeCall, currentUserId)
    ) {
      return;
    }

    playHermesOutgoingCallSound();
    const intervalId = window.setInterval(() => {
      playHermesOutgoingCallSound();
    }, 2_500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeCall, currentUserId]);

  const startCall = useCallback(
    ({
      session,
      targetUserIds,
    }: {
      session: HermesCallSession;
      targetUserIds: readonly HermesPresenceUser["id"][];
    }) => {
      setActiveCall(session);
      setIncomingCall(null);
      setIsCallPanelOpen(true);
      recordCallHistory(session, "ringing");
      sendCallSignal({
        callId: session.id,
        channelId: session.channelId,
        kind: "invite",
        session,
        targetUserIds,
      });
    },
    [recordCallHistory, sendCallSignal],
  );

  const acceptIncomingCall = useCallback(() => {
    if (!incomingCall || !currentUserId) {
      return;
    }

    const currentParticipant = getCallParticipantForUser(
      incomingCall,
      currentUserId,
    );
    const acceptedCall = updateCallParticipantStatus(
      {
        ...incomingCall,
        durationLabel: "00:00",
        status: "active",
      },
      currentUserId,
      "joined",
    );

    setActiveCall(acceptedCall);
    setIsCallPanelOpen(true);
    setIncomingCall(null);
    recordCallHistory(acceptedCall, "answered");
    sendCallSignal({
      callId: incomingCall.id,
      channelId: incomingCall.channelId,
      kind: "join",
      participant: currentParticipant
        ? {
            ...currentParticipant,
            status: "joined",
          }
        : undefined,
    });
  }, [currentUserId, incomingCall, recordCallHistory, sendCallSignal]);

  const declineIncomingCall = useCallback(() => {
    if (!incomingCall) {
      return;
    }

    sendCallSignal({
      callId: incomingCall.id,
      channelId: incomingCall.channelId,
      kind: "decline",
    });
    recordCallHistory(incomingCall, "declined");
    setIncomingCall(null);
  }, [incomingCall, recordCallHistory, sendCallSignal]);

  useEffect(() => {
    if (
      !activeCall ||
      activeCall.id !== restoredCallId ||
      !currentUserId ||
      !isCallRealtimeReady
    ) {
      return;
    }

    const currentParticipant = getCallParticipantForUser(
      activeCall,
      currentUserId,
    );

    sendCallSignal({
      callId: activeCall.id,
      channelId: activeCall.channelId,
      kind: "join",
      participant: currentParticipant
        ? {
            ...currentParticipant,
            status: "joined",
          }
        : undefined,
    });
    setRestoredCallId(null);
  }, [
    activeCall,
    currentUserId,
    isCallRealtimeReady,
    restoredCallId,
    sendCallSignal,
  ]);

  const endActiveCall = useCallback(() => {
    const call = activeCallRef.current;

    if (call) {
      recordCallHistory(call, "ended");
      sendCallSignal({
        callId: call.id,
        channelId: call.channelId,
        kind: call.initiatedByUserId === currentUserId ? "end" : "leave",
      });
    }

    setActiveCall(null);
    setIsCallPanelOpen(true);
  }, [currentUserId, recordCallHistory, sendCallSignal]);

  const markCallHistoryRead = useCallback((channelId?: string) => {
    setCallHistory((currentHistory) => {
      let hasChanges = false;
      const nextHistory = currentHistory.map((entry) => {
        if (!entry.isUnread || (channelId && entry.channelId !== channelId)) {
          return entry;
        }

        hasChanges = true;
        return {
          ...entry,
          isUnread: false,
        };
      });

      return hasChanges ? nextHistory : currentHistory;
    });
  }, []);

  const unreadCallCount = callHistory.filter((entry) => entry.isUnread).length;

  return (
    <HermesCallContext.Provider
      value={{
        callHistory,
        endActiveCall,
        markCallHistoryRead,
        startCall,
        unreadCallCount,
      }}
    >
      {children}
      {incomingCall ? (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-[80]">
          <IncomingCallBanner
            onAccept={acceptIncomingCall}
            onDecline={declineIncomingCall}
            session={incomingCall}
          />
        </div>
      ) : null}
      {activeCall ? (
        <div
          aria-hidden={!isCallPanelOpen}
          className={isCallPanelOpen ? undefined : "pointer-events-none invisible"}
        >
          <CallPanel
            currentUserId={currentUserId}
            onClose={() => setIsCallPanelOpen(false)}
            onEnd={endActiveCall}
            onSendSignal={sendCallSignal}
            realtimeSignals={callSignals}
            session={activeCall}
          />
        </div>
      ) : null}
      {activeCall && !isCallPanelOpen ? (
        <div className="fixed bottom-5 right-5 z-[80] flex items-center gap-2 rounded-full border border-[#d9e0e7] bg-white p-2 shadow-2xl">
          <button
            className="flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-[#101820] outline-none transition hover:bg-[#f4f6f8] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            onClick={() => setIsCallPanelOpen(true)}
            type="button"
          >
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#A07C3B] text-white">
              <Phone aria-hidden="true" size={15} />
            </span>
            <span>{activeCall.title}</span>
          </button>
          <Tooltip content="Encerrar chamada">
            <button
              aria-label="Encerrar chamada"
              className="grid h-10 w-10 place-items-center rounded-full bg-rose-600 text-white outline-none transition hover:bg-rose-500 focus-visible:ring-2 focus-visible:ring-rose-300"
              onClick={endActiveCall}
              type="button"
            >
              <PhoneOff aria-hidden="true" size={17} />
            </button>
          </Tooltip>
        </div>
      ) : null}
    </HermesCallContext.Provider>
  );
}

const disabledHermesCallContextValue = {
  callHistory: [],
  endActiveCall: noopHermesCallAction,
  markCallHistoryRead: noopHermesCallAction,
  startCall: noopHermesCallAction,
  unreadCallCount: 0,
} satisfies HermesCallContextValue;

function noopHermesCallAction() {
  return;
}

function isHermesCallDisabledHost() {
  if (typeof window === "undefined") {
    return false;
  }

  return PULSEX_CALL_DISABLED_HOSTS.has(
    normalizeHermesCallHost(window.location.hostname),
  );
}

function normalizeHermesCallHost(hostname: string) {
  return hostname
    .toLowerCase()
    .replace(/,+/g, ".")
    .replace(/\.\.+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

export function useHermesCall() {
  const context = useContext(HermesCallContext);

  if (!context) {
    throw new Error("useHermesCall must be used inside HermesCallProvider");
  }

  return context;
}

const hermesCallSignalKinds = new Set<HermesCallSignalKind>([
  "answer",
  "decline",
  "end",
  "ice-candidate",
  "invite",
  "join",
  "leave",
  "offer",
  "screen-share-start",
  "screen-share-stop",
]);

const hermesCallHistoryStatuses = new Set<HermesCallHistoryStatus>([
  "answered",
  "declined",
  "ended",
  "missed",
  "ringing",
]);

function createHermesCallSignalId(kind: HermesCallSignalKind) {
  return `call-signal-${kind}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function getCallCallerLabel(session: HermesCallSession) {
  return (
    session.participants.find(
      (participant) => participant.userId === session.initiatedByUserId,
    )?.label ?? "Alguem"
  );
}

function createHermesCallHistoryEntry({
  currentUserId,
  session,
  status,
  unread,
}: {
  currentUserId: HermesPresenceUser["id"];
  session: HermesCallSession;
  status: HermesCallHistoryStatus;
  unread: boolean;
}): HermesCallHistoryEntry {
  const direction =
    session.initiatedByUserId === currentUserId ? "outgoing" : "incoming";
  const caller = getHermesCallInitiator(session);
  const firstOtherParticipant = session.participants.find(
    (participant) => participant.userId !== currentUserId,
  );
  const participantNames = Array.from(
    new Set(
      session.participants
        .map((participant) => participant.label)
        .filter((label) => label.trim().length > 0),
    ),
  );
  const startedAt = normalizeHermesCallDate(
    session.startedAt,
    new Date().toISOString(),
  ) ?? new Date().toISOString();
  const endedAt = normalizeHermesCallDate(session.endedAt, undefined);

  return {
    callId: session.id,
    callerAvatarUrl:
      direction === "incoming" ? caller?.avatarUrl : firstOtherParticipant?.avatarUrl,
    callerName:
      direction === "incoming"
        ? (caller?.label ?? session.title)
        : (firstOtherParticipant?.label ?? session.title),
    callerUserId:
      direction === "incoming" ? caller?.userId : firstOtherParticipant?.userId,
    channelId: session.channelId,
    channelName: session.title,
    direction,
    durationLabel: session.durationLabel,
    endedAt:
      endedAt ??
      (status === "ended" || status === "declined" || status === "missed"
        ? new Date().toISOString()
        : undefined),
    id: `call-history-${session.id}`,
    isUnread: unread,
    participantNames,
    startedAt,
    status,
    type: session.type,
  };
}

function getHermesCallInitiator(session: HermesCallSession) {
  return (
    session.participants.find(
      (participant) => participant.userId === session.initiatedByUserId,
    ) ?? session.participants[0]
  );
}

function upsertHermesCallHistoryEntry(
  history: readonly HermesCallHistoryEntry[],
  entry: HermesCallHistoryEntry,
): HermesCallHistoryEntry[] {
  const existingEntry = history.find((item) => item.callId === entry.callId);
  const mergedEntry = existingEntry
    ? {
        ...existingEntry,
        ...entry,
        isUnread: entry.isUnread,
        startedAt: existingEntry.startedAt || entry.startedAt,
      }
    : entry;

  return [
    mergedEntry,
    ...history.filter((item) => item.callId !== entry.callId),
  ]
    .sort(compareHermesCallHistoryEntries)
    .slice(0, PULSEX_CALL_HISTORY_LIMIT);
}

function compareHermesCallHistoryEntries(
  firstEntry: HermesCallHistoryEntry,
  secondEntry: HermesCallHistoryEntry,
) {
  return (
    getHermesCallHistoryTime(secondEntry) - getHermesCallHistoryTime(firstEntry)
  );
}

function getHermesCallHistoryTime(entry: HermesCallHistoryEntry) {
  const time = Date.parse(entry.startedAt);

  return Number.isNaN(time) ? 0 : time;
}

function normalizeHermesCallDate(
  value: string | undefined,
  fallback: string | undefined,
) {
  if (!value) {
    return fallback;
  }

  const time = Date.parse(value);

  if (Number.isNaN(time)) {
    return fallback;
  }

  return new Date(time).toISOString();
}

function getCallParticipantForUser(
  session: HermesCallSession,
  userId: HermesPresenceUser["id"],
) {
  return session.participants.find((participant) => participant.userId === userId);
}

function hasPendingInvitedCallParticipant(
  session: HermesCallSession,
  currentUserId: HermesPresenceUser["id"],
) {
  return session.participants.some(
    (participant) =>
      participant.userId !== currentUserId && participant.status === "invited",
  );
}

function parseHermesCallSignal(
  value: unknown,
): HermesCallRealtimeSignal | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const maybeSignal = value as Partial<HermesCallRealtimeSignal>;

  if (
    typeof maybeSignal.callId !== "string" ||
    typeof maybeSignal.channelId !== "string" ||
    typeof maybeSignal.fromUserId !== "string" ||
    typeof maybeSignal.id !== "string" ||
    typeof maybeSignal.kind !== "string" ||
    typeof maybeSignal.sentAt !== "string" ||
    !hermesCallSignalKinds.has(maybeSignal.kind as HermesCallSignalKind)
  ) {
    return null;
  }

  return maybeSignal as HermesCallRealtimeSignal;
}

function shouldHandleCallSignalForCurrentUser({
  activeCall,
  currentUserId,
  incomingCall,
  signal,
}: {
  activeCall: HermesCallSession | null;
  currentUserId: HermesPresenceUser["id"];
  incomingCall: HermesCallSession | null;
  signal: HermesCallRealtimeSignal;
}) {
  if (signal.fromUserId === currentUserId) {
    return false;
  }

  if (signal.toUserId && signal.toUserId !== currentUserId) {
    return false;
  }

  if (signal.kind === "invite") {
    const targetUserIds = signal.targetUserIds ?? [];

    if (targetUserIds.includes(currentUserId)) {
      return true;
    }

    return Boolean(
      signal.session?.participants.some(
        (participant) => participant.userId === currentUserId,
      ),
    );
  }

  if (
    signal.kind === "offer" ||
    signal.kind === "answer" ||
    signal.kind === "ice-candidate"
  ) {
    return signal.toUserId === currentUserId;
  }

  return activeCall?.id === signal.callId || incomingCall?.id === signal.callId;
}

function updateCallParticipantStatus(
  session: HermesCallSession,
  userId: HermesPresenceUser["id"],
  status: HermesCallParticipant["status"],
): HermesCallSession {
  return {
    ...session,
    participants: session.participants.map((participant) =>
      participant.userId === userId
        ? {
            ...participant,
            status,
          }
        : participant,
    ),
  };
}

function updateCallParticipantScreenShare(
  session: HermesCallSession,
  userId: HermesPresenceUser["id"],
  isScreenSharing: boolean,
): HermesCallSession {
  return {
    ...session,
    participants: session.participants.map((participant) =>
      participant.userId === userId
        ? {
            ...participant,
            isScreenSharing,
          }
        : participant,
    ),
  };
}

function upsertCallParticipant(
  session: HermesCallSession,
  participant: HermesCallParticipant,
  status: HermesCallParticipant["status"],
): HermesCallSession {
  const existingUserId = participant.userId;
  const hasParticipant = session.participants.some(
    (currentParticipant) =>
      currentParticipant.userId === existingUserId ||
      currentParticipant.id === participant.id,
  );

  return {
    ...session,
    participants: hasParticipant
      ? session.participants.map((currentParticipant) =>
          currentParticipant.userId === existingUserId ||
          currentParticipant.id === participant.id
            ? {
                ...currentParticipant,
                ...participant,
                status,
              }
            : currentParticipant,
        )
      : [
          ...session.participants,
          {
            ...participant,
            status,
          },
        ],
  };
}

function readStoredHermesActiveCall(currentUserId: HermesPresenceUser["id"]) {
  try {
    const storedValue = window.sessionStorage.getItem(
      PULSEX_ACTIVE_CALL_STORAGE_KEY,
    );

    if (!storedValue) {
      return null;
    }

    const parsedValue = JSON.parse(storedValue) as Partial<StoredHermesActiveCall>;
    const savedAt =
      typeof parsedValue.savedAt === "number" ? parsedValue.savedAt : 0;
    const isExpired =
      !savedAt || Date.now() - savedAt > PULSEX_ACTIVE_CALL_STORAGE_TTL_MS;

    if (
      isExpired ||
      parsedValue.currentUserId !== currentUserId ||
      !isStoredHermesCallSession(parsedValue.session)
    ) {
      clearStoredHermesActiveCall();
      return null;
    }

    return {
      isCallPanelOpen: parsedValue.isCallPanelOpen !== false,
      session: {
        ...parsedValue.session,
        status:
          parsedValue.session.status === "ended"
            ? "active"
            : parsedValue.session.status,
      },
    };
  } catch {
    clearStoredHermesActiveCall();
    return null;
  }
}

function writeStoredHermesActiveCall(activeCall: StoredHermesActiveCall) {
  try {
    window.sessionStorage.setItem(
      PULSEX_ACTIVE_CALL_STORAGE_KEY,
      JSON.stringify(activeCall),
    );
  } catch {
    // Session persistence is a resilience layer; a blocked storage should not end calls.
  }
}

function clearStoredHermesActiveCall() {
  try {
    window.sessionStorage.removeItem(PULSEX_ACTIVE_CALL_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function readStoredHermesCallHistory(currentUserId: HermesPresenceUser["id"]) {
  try {
    const storedValue = window.localStorage.getItem(
      getHermesCallHistoryStorageKey(currentUserId),
    );

    if (!storedValue) {
      return [];
    }

    const parsedValue = JSON.parse(storedValue);

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue
      .filter(isStoredHermesCallHistoryEntry)
      .sort(compareHermesCallHistoryEntries)
      .slice(0, PULSEX_CALL_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function writeStoredHermesCallHistory(
  currentUserId: HermesPresenceUser["id"],
  history: readonly HermesCallHistoryEntry[],
) {
  try {
    window.localStorage.setItem(
      getHermesCallHistoryStorageKey(currentUserId),
      JSON.stringify(history.slice(0, PULSEX_CALL_HISTORY_LIMIT)),
    );
  } catch {
    // Local history is a convenience layer; calls must keep working without it.
  }
}

function getHermesCallHistoryStorageKey(currentUserId: HermesPresenceUser["id"]) {
  return `${PULSEX_CALL_HISTORY_STORAGE_KEY}:${currentUserId}`;
}

function isStoredHermesCallSession(
  value: unknown,
): value is HermesCallSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybeSession = value as Partial<HermesCallSession>;

  return (
    typeof maybeSession.channelId === "string" &&
    typeof maybeSession.id === "string" &&
    Array.isArray(maybeSession.participants) &&
    typeof maybeSession.status === "string" &&
    typeof maybeSession.title === "string" &&
    (maybeSession.type === "audio" || maybeSession.type === "video")
  );
}

function isStoredHermesCallHistoryEntry(
  value: unknown,
): value is HermesCallHistoryEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybeEntry = value as Partial<HermesCallHistoryEntry>;

  return (
    typeof maybeEntry.callId === "string" &&
    typeof maybeEntry.callerName === "string" &&
    typeof maybeEntry.channelId === "string" &&
    typeof maybeEntry.channelName === "string" &&
    (maybeEntry.direction === "incoming" ||
      maybeEntry.direction === "outgoing") &&
    typeof maybeEntry.id === "string" &&
    typeof maybeEntry.startedAt === "string" &&
    typeof maybeEntry.status === "string" &&
    hermesCallHistoryStatuses.has(maybeEntry.status as HermesCallHistoryStatus) &&
    (maybeEntry.type === "audio" || maybeEntry.type === "video")
  );
}
