"use client";

import type {
  PulseXCallParticipant,
  PulseXCallRealtimeSignal,
  PulseXCallRealtimeSignalInput,
  PulseXCallSession,
  PulseXCallSignalKind,
  PulseXPresenceUser,
} from "@/lib/pulsex";
import {
  getHubSupabaseClient,
  hasHubSupabaseConfig,
  logSupabaseDiagnostic,
  serializeDiagnosticError,
} from "@/lib/supabase/client";
import {
  isPulseXCallSoundId,
  playPulseXCallSound,
  playPulseXOutgoingCallSound,
  pulsexCallSoundOptions,
  showBrowserPulseXNotification,
  type PulseXCallSoundId,
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
import type { PulseXCallSoundOption } from "@/components/pulsex/conversation-header";

type PulseXCallContextValue = {
  callSoundId: PulseXCallSoundId;
  callSoundOptions: readonly PulseXCallSoundOption[];
  endActiveCall: () => void;
  previewCallSound: (soundId: string) => void;
  setCallSoundId: (soundId: string) => void;
  startCall: (input: {
    session: PulseXCallSession;
    targetUserIds: readonly PulseXPresenceUser["id"][];
  }) => void;
};

type HubSupabaseClient = NonNullable<ReturnType<typeof getHubSupabaseClient>>;
type HubRealtimeChannel = ReturnType<HubSupabaseClient["channel"]>;

const PULSEX_CALL_SIGNAL_EVENT = "call-signal";
const PULSEX_CALL_SIGNAL_TOPIC = "pulsex:calls";
const PULSEX_ACTIVE_CALL_STORAGE_KEY = "careli:pulsex:active-call";
const PULSEX_CALL_SOUND_STORAGE_KEY = "careli:pulsex:call-sound";
const PULSEX_ACTIVE_CALL_STORAGE_TTL_MS = 1000 * 60 * 60 * 4;

type StoredPulseXActiveCall = {
  currentUserId: PulseXPresenceUser["id"];
  isCallPanelOpen: boolean;
  savedAt: number;
  session: PulseXCallSession;
};

const PulseXCallContext = createContext<PulseXCallContextValue | null>(null);

export function PulseXCallProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const { hubUser, profileStatus } = useAuth();
  const currentUserId = hubUser?.id ?? "";
  const [activeCall, setActiveCall] = useState<PulseXCallSession | null>(null);
  const [callSignals, setCallSignals] = useState<PulseXCallRealtimeSignal[]>([]);
  const [incomingCall, setIncomingCall] = useState<PulseXCallSession | null>(
    null,
  );
  const [isCallPanelOpen, setIsCallPanelOpen] = useState(true);
  const [isCallRealtimeReady, setIsCallRealtimeReady] = useState(false);
  const [restoredCallId, setRestoredCallId] = useState<string | null>(null);
  const [callSoundId, setInternalCallSoundId] = useState<PulseXCallSoundId>(
    pulsexCallSoundOptions[0].id,
  );
  const activeCallRef = useRef<PulseXCallSession | null>(null);
  const callRealtimeChannelRef = useRef<HubRealtimeChannel | null>(null);
  const incomingCallRef = useRef<PulseXCallSession | null>(null);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  useEffect(() => {
    const savedSoundId = window.localStorage.getItem(
      PULSEX_CALL_SOUND_STORAGE_KEY,
    );

    if (isPulseXCallSoundId(savedSoundId)) {
      setInternalCallSoundId(savedSoundId);
    }
  }, []);

  useEffect(() => {
    if (hubUser || profileStatus === "loading") {
      return;
    }

    setActiveCall(null);
    setIncomingCall(null);
    setCallSignals([]);
    clearStoredPulseXActiveCall();
  }, [hubUser, profileStatus]);

  useEffect(() => {
    if (!currentUserId || activeCallRef.current || profileStatus === "loading") {
      return;
    }

    const restoredCall = readStoredPulseXActiveCall(currentUserId);

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
      clearStoredPulseXActiveCall();
      return;
    }

    writeStoredPulseXActiveCall({
      currentUserId,
      isCallPanelOpen,
      savedAt: Date.now(),
      session: activeCall,
    });
  }, [activeCall, currentUserId, isCallPanelOpen]);

  const appendCallSignal = useCallback((signal: PulseXCallRealtimeSignal) => {
    setCallSignals((currentSignals) =>
      [...currentSignals.filter((item) => item.id !== signal.id), signal].slice(
        -160,
      ),
    );
  }, []);

  const sendCallSignal = useCallback(
    (input: PulseXCallRealtimeSignalInput) => {
      if (!currentUserId) {
        return null;
      }

      const signal = {
        ...input,
        fromUserId: input.fromUserId ?? currentUserId,
        id: createPulseXCallSignalId(input.kind),
        sentAt: new Date().toISOString(),
      } satisfies PulseXCallRealtimeSignal;
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

  const handleIncomingCallSignal = useCallback(
    (signal: PulseXCallRealtimeSignal) => {
      appendCallSignal(signal);

      if (signal.kind === "invite" && signal.session) {
        if (
          activeCallRef.current?.id === signal.callId ||
          incomingCallRef.current?.id === signal.callId
        ) {
          return;
        }

        setIncomingCall(signal.session);
        showBrowserPulseXNotification({
          body: `${getCallCallerLabel(signal.session)} chamou em ${signal.session.title}.`,
          title: "Chamada no PulseX",
        });
        return;
      }

      if (signal.kind === "join" && signal.participant) {
        const participant = signal.participant;

        setActiveCall((currentCall) =>
          currentCall?.id === signal.callId
            ? upsertCallParticipant(currentCall, participant, "joined")
            : currentCall,
        );
        return;
      }

      if (signal.kind === "decline" || signal.kind === "leave") {
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
        setIncomingCall((currentCall) =>
          currentCall?.id === signal.callId ? null : currentCall,
        );
        setActiveCall((currentCall) =>
          currentCall?.id === signal.callId ? null : currentCall,
        );
      }
    },
    [appendCallSignal],
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
          const signal = parsePulseXCallSignal(message.payload);

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

    playPulseXCallSound(callSoundId);
    const intervalId = window.setInterval(() => {
      playPulseXCallSound(callSoundId);
    }, 2_200);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [callSoundId, incomingCall]);

  useEffect(() => {
    if (
      !activeCall ||
      activeCall.initiatedByUserId !== currentUserId ||
      !hasPendingInvitedCallParticipant(activeCall, currentUserId)
    ) {
      return;
    }

    playPulseXOutgoingCallSound();
    const intervalId = window.setInterval(() => {
      playPulseXOutgoingCallSound();
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
      session: PulseXCallSession;
      targetUserIds: readonly PulseXPresenceUser["id"][];
    }) => {
      setActiveCall(session);
      setIncomingCall(null);
      setIsCallPanelOpen(true);
      sendCallSignal({
        callId: session.id,
        channelId: session.channelId,
        kind: "invite",
        session,
        targetUserIds,
      });
    },
    [sendCallSignal],
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
  }, [currentUserId, incomingCall, sendCallSignal]);

  const declineIncomingCall = useCallback(() => {
    if (!incomingCall) {
      return;
    }

    sendCallSignal({
      callId: incomingCall.id,
      channelId: incomingCall.channelId,
      kind: "decline",
    });
    setIncomingCall(null);
  }, [incomingCall, sendCallSignal]);

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
      sendCallSignal({
        callId: call.id,
        channelId: call.channelId,
        kind: call.initiatedByUserId === currentUserId ? "end" : "leave",
      });
    }

    setActiveCall(null);
    setIsCallPanelOpen(true);
  }, [currentUserId, sendCallSignal]);

  const setCallSoundId = useCallback((soundId: string) => {
    if (!isPulseXCallSoundId(soundId)) {
      return;
    }

    setInternalCallSoundId(soundId);
    window.localStorage.setItem(PULSEX_CALL_SOUND_STORAGE_KEY, soundId);
  }, []);

  const previewCallSound = useCallback((soundId: string) => {
    if (isPulseXCallSoundId(soundId)) {
      playPulseXCallSound(soundId);
    }
  }, []);

  return (
    <PulseXCallContext.Provider
      value={{
        callSoundId,
        callSoundOptions: pulsexCallSoundOptions,
        endActiveCall,
        previewCallSound,
        setCallSoundId,
        startCall,
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
    </PulseXCallContext.Provider>
  );
}

export function usePulseXCall() {
  const context = useContext(PulseXCallContext);

  if (!context) {
    throw new Error("usePulseXCall must be used inside PulseXCallProvider");
  }

  return context;
}

const pulseXCallSignalKinds = new Set<PulseXCallSignalKind>([
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

function createPulseXCallSignalId(kind: PulseXCallSignalKind) {
  return `call-signal-${kind}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function getCallCallerLabel(session: PulseXCallSession) {
  return (
    session.participants.find(
      (participant) => participant.userId === session.initiatedByUserId,
    )?.label ?? "Alguem"
  );
}

function getCallParticipantForUser(
  session: PulseXCallSession,
  userId: PulseXPresenceUser["id"],
) {
  return session.participants.find((participant) => participant.userId === userId);
}

function hasPendingInvitedCallParticipant(
  session: PulseXCallSession,
  currentUserId: PulseXPresenceUser["id"],
) {
  return session.participants.some(
    (participant) =>
      participant.userId !== currentUserId && participant.status === "invited",
  );
}

function parsePulseXCallSignal(
  value: unknown,
): PulseXCallRealtimeSignal | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const maybeSignal = value as Partial<PulseXCallRealtimeSignal>;

  if (
    typeof maybeSignal.callId !== "string" ||
    typeof maybeSignal.channelId !== "string" ||
    typeof maybeSignal.fromUserId !== "string" ||
    typeof maybeSignal.id !== "string" ||
    typeof maybeSignal.kind !== "string" ||
    typeof maybeSignal.sentAt !== "string" ||
    !pulseXCallSignalKinds.has(maybeSignal.kind as PulseXCallSignalKind)
  ) {
    return null;
  }

  return maybeSignal as PulseXCallRealtimeSignal;
}

function shouldHandleCallSignalForCurrentUser({
  activeCall,
  currentUserId,
  incomingCall,
  signal,
}: {
  activeCall: PulseXCallSession | null;
  currentUserId: PulseXPresenceUser["id"];
  incomingCall: PulseXCallSession | null;
  signal: PulseXCallRealtimeSignal;
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
  session: PulseXCallSession,
  userId: PulseXPresenceUser["id"],
  status: PulseXCallParticipant["status"],
): PulseXCallSession {
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
  session: PulseXCallSession,
  userId: PulseXPresenceUser["id"],
  isScreenSharing: boolean,
): PulseXCallSession {
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
  session: PulseXCallSession,
  participant: PulseXCallParticipant,
  status: PulseXCallParticipant["status"],
): PulseXCallSession {
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

function readStoredPulseXActiveCall(currentUserId: PulseXPresenceUser["id"]) {
  try {
    const storedValue = window.sessionStorage.getItem(
      PULSEX_ACTIVE_CALL_STORAGE_KEY,
    );

    if (!storedValue) {
      return null;
    }

    const parsedValue = JSON.parse(storedValue) as Partial<StoredPulseXActiveCall>;
    const savedAt =
      typeof parsedValue.savedAt === "number" ? parsedValue.savedAt : 0;
    const isExpired =
      !savedAt || Date.now() - savedAt > PULSEX_ACTIVE_CALL_STORAGE_TTL_MS;

    if (
      isExpired ||
      parsedValue.currentUserId !== currentUserId ||
      !isStoredPulseXCallSession(parsedValue.session)
    ) {
      clearStoredPulseXActiveCall();
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
    clearStoredPulseXActiveCall();
    return null;
  }
}

function writeStoredPulseXActiveCall(activeCall: StoredPulseXActiveCall) {
  try {
    window.sessionStorage.setItem(
      PULSEX_ACTIVE_CALL_STORAGE_KEY,
      JSON.stringify(activeCall),
    );
  } catch {
    // Session persistence is a resilience layer; a blocked storage should not end calls.
  }
}

function clearStoredPulseXActiveCall() {
  try {
    window.sessionStorage.removeItem(PULSEX_ACTIVE_CALL_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function isStoredPulseXCallSession(
  value: unknown,
): value is PulseXCallSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybeSession = value as Partial<PulseXCallSession>;

  return (
    typeof maybeSession.channelId === "string" &&
    typeof maybeSession.id === "string" &&
    Array.isArray(maybeSession.participants) &&
    typeof maybeSession.status === "string" &&
    typeof maybeSession.title === "string" &&
    (maybeSession.type === "audio" || maybeSession.type === "video")
  );
}
