"use client";

import type {
  PulseXCallRealtimeSignal,
  PulseXCallRealtimeSignalInput,
  PulseXCallSession,
  PulseXPresenceUser,
} from "@/lib/pulsex";
import { Clock, Phone, Video, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CallControls } from "./call-controls";
import { CallParticipantTile } from "./call-participant-tile";

type CallPanelProps = {
  currentUserId: PulseXPresenceUser["id"];
  onClose: () => void;
  onEnd: () => void;
  onSendSignal: (signal: PulseXCallRealtimeSignalInput) => void;
  realtimeSignals: readonly PulseXCallRealtimeSignal[];
  session: PulseXCallSession;
};

type MediaDeviceOption = {
  deviceId: string;
  label: string;
};

const defaultDeviceValue = "__default__";
const peerConnectionConfig = {
  iceServers: [
    {
      urls: "stun:stun.l.google.com:19302",
    },
  ],
} satisfies RTCConfiguration;

export function CallPanel({
  currentUserId,
  onClose,
  onEnd,
  onSendSignal,
  realtimeSignals,
  session,
}: CallPanelProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(session.type === "video");
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [audioInputId, setAudioInputId] = useState(defaultDeviceValue);
  const [videoInputId, setVideoInputId] = useState(defaultDeviceValue);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceOption[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceOption[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [remoteStreamsByUserId, setRemoteStreamsByUserId] = useState<
    Record<string, MediaStream>
  >({});
  const handledSignalIdsRef = useRef<Set<string>>(new Set());
  const localStreamRef = useRef<MediaStream | null>(null);
  const localStreamWaitersRef = useRef<
    Array<(stream: MediaStream | null) => void>
  >([]);
  const pendingOfferUserIdsRef = useRef<Set<PulseXPresenceUser["id"]>>(
    new Set(),
  );
  const pendingIceCandidatesRef = useRef<
    Map<PulseXPresenceUser["id"], RTCIceCandidateInit[]>
  >(new Map());
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const CallIcon = session.type === "video" ? Video : Phone;

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const nextAudioInputs = createDeviceOptions(
      devices.filter((device) => device.kind === "audioinput"),
      "Microfone",
    );
    const nextVideoInputs = createDeviceOptions(
      devices.filter((device) => device.kind === "videoinput"),
      "Camera",
    );

    setAudioInputs(nextAudioInputs);
    setVideoInputs(nextVideoInputs);
    setAudioInputId((currentId) =>
      isKnownDevice(currentId, nextAudioInputs) ? currentId : defaultDeviceValue,
    );
    setVideoInputId((currentId) =>
      isKnownDevice(currentId, nextVideoInputs) ? currentId : defaultDeviceValue,
    );
  }, []);

  useEffect(() => {
    void refreshDevices();

    if (!navigator.mediaDevices?.addEventListener) {
      return;
    }

    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);

    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
    };
  }, [refreshDevices]);

  const attachLocalTracks = useCallback(
    (peerConnection: RTCPeerConnection, stream: MediaStream) => {
      stream.getTracks().forEach((track) => {
        const sender = findPeerSender(peerConnection, track.kind);

        if (sender) {
          void sender.replaceTrack(track);
          return;
        }

        peerConnection.addTrack(track, stream);
      });
    },
    [],
  );

  const replaceLocalVideoTrack = useCallback(
    (nextTrack: MediaStreamTrack | null) => {
      const currentStream = localStreamRef.current;
      const currentAudioTracks = currentStream?.getAudioTracks() ?? [];
      const currentVideoTracks = currentStream?.getVideoTracks() ?? [];

      currentVideoTracks.forEach((track) => {
        if (track !== nextTrack) {
          track.stop();
        }
      });

      const nextStream = new MediaStream([
        ...currentAudioTracks,
        ...(nextTrack ? [nextTrack] : []),
      ]);

      localStreamRef.current = nextStream;
      setLocalStream(nextStream);

      peerConnectionsRef.current.forEach((peerConnection) => {
        replacePeerVideoTrack(peerConnection, nextStream, nextTrack);
      });
    },
    [],
  );

  const waitForLocalStream = useCallback(() => {
    if (localStreamRef.current) {
      return Promise.resolve(localStreamRef.current);
    }

    return new Promise<MediaStream | null>((resolve) => {
      const waiterRef: {
        current: ((stream: MediaStream | null) => void) | null;
      } = { current: null };
      const timeoutId = window.setTimeout(() => {
        if (!waiterRef.current) {
          resolve(null);
          return;
        }

        localStreamWaitersRef.current = localStreamWaitersRef.current.filter(
          (currentWaiter) => currentWaiter !== waiterRef.current,
        );
        resolve(null);
      }, 4_000);
      const waiter = (stream: MediaStream | null) => {
        window.clearTimeout(timeoutId);
        resolve(stream);
      };

      waiterRef.current = waiter;
      localStreamWaitersRef.current.push(waiter);
    });
  }, []);

  const closePeerConnection = useCallback((remoteUserId: string) => {
    const peerConnection = peerConnectionsRef.current.get(remoteUserId);

    if (peerConnection) {
      peerConnection.close();
      peerConnectionsRef.current.delete(remoteUserId);
    }
    pendingIceCandidatesRef.current.delete(remoteUserId);

    setRemoteStreamsByUserId((currentStreams) => {
      const nextStreams = { ...currentStreams };
      delete nextStreams[remoteUserId];
      return nextStreams;
    });
  }, []);

  const cleanupPeerConnections = useCallback(() => {
    peerConnectionsRef.current.forEach((peerConnection) => {
      peerConnection.close();
    });
    peerConnectionsRef.current.clear();
    localStreamWaitersRef.current.forEach((resolve) => resolve(null));
    localStreamWaitersRef.current = [];
  }, []);

  const flushPendingIceCandidates = useCallback(
    async (remoteUserId: PulseXPresenceUser["id"]) => {
      const peerConnection = peerConnectionsRef.current.get(remoteUserId);
      const candidates = pendingIceCandidatesRef.current.get(remoteUserId) ?? [];

      if (!peerConnection || candidates.length === 0) {
        return;
      }

      pendingIceCandidatesRef.current.delete(remoteUserId);

      for (const candidate of candidates) {
        await peerConnection.addIceCandidate(candidate);
      }
    },
    [],
  );

  const getPeerConnection = useCallback(
    (remoteUserId: string) => {
      const existingConnection = peerConnectionsRef.current.get(remoteUserId);

      if (
        existingConnection &&
        existingConnection.connectionState !== "closed"
      ) {
        return existingConnection;
      }

      if (typeof RTCPeerConnection === "undefined") {
        setMediaError("Chamadas em tempo real indisponiveis neste navegador.");
        return null;
      }

      const peerConnection = new RTCPeerConnection(peerConnectionConfig);

      ensurePeerTransceiver(peerConnection, "audio");
      ensurePeerTransceiver(peerConnection, "video");

      peerConnection.onicecandidate = (event) => {
        onSendSignal({
          callId: session.id,
          candidate: event.candidate?.toJSON() ?? null,
          channelId: session.channelId,
          kind: "ice-candidate",
          toUserId: remoteUserId,
        });
      };
      peerConnection.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);

        setRemoteStreamsByUserId((currentStreams) => ({
          ...currentStreams,
          [remoteUserId]: stream,
        }));
      };
      peerConnection.onconnectionstatechange = () => {
        if (
          peerConnection.connectionState === "closed" ||
          peerConnection.connectionState === "disconnected" ||
          peerConnection.connectionState === "failed"
        ) {
          closePeerConnection(remoteUserId);
        }
      };

      if (localStreamRef.current) {
        attachLocalTracks(peerConnection, localStreamRef.current);
      }

      peerConnectionsRef.current.set(remoteUserId, peerConnection);
      return peerConnection;
    },
    [
      attachLocalTracks,
      closePeerConnection,
      onSendSignal,
      session.channelId,
      session.id,
    ],
  );

  const sendOfferToParticipant = useCallback(
    async (remoteUserId: string) => {
      try {
        const stream = await waitForLocalStream();

        if (!stream) {
          pendingOfferUserIdsRef.current.add(remoteUserId);
          return;
        }

        const peerConnection = getPeerConnection(remoteUserId);

        if (!peerConnection) {
          return;
        }

        attachLocalTracks(peerConnection, stream);

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        if (!peerConnection.localDescription) {
          return;
        }

        onSendSignal({
          callId: session.id,
          channelId: session.channelId,
          description: {
            sdp: peerConnection.localDescription.sdp,
            type: peerConnection.localDescription.type,
          },
          kind: "offer",
          toUserId: remoteUserId,
        });
      } catch {
        setMediaError("Nao foi possivel iniciar a conexao da chamada.");
      }
    },
    [
      attachLocalTracks,
      getPeerConnection,
      onSendSignal,
      session.channelId,
      session.id,
      waitForLocalStream,
    ],
  );

  const handleCallRealtimeSignal = useCallback(
    async (signal: PulseXCallRealtimeSignal) => {
      if (signal.callId !== session.id || signal.fromUserId === currentUserId) {
        return;
      }

      if (signal.kind === "join") {
        await sendOfferToParticipant(signal.fromUserId);
        return;
      }

      if (signal.kind === "offer" && signal.description) {
        try {
          const stream = await waitForLocalStream();
          const peerConnection = getPeerConnection(signal.fromUserId);

          if (!peerConnection) {
            return;
          }

          if (stream) {
            attachLocalTracks(peerConnection, stream);
          }

          await peerConnection.setRemoteDescription(signal.description);
          await flushPendingIceCandidates(signal.fromUserId);

          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);

          if (!peerConnection.localDescription) {
            return;
          }

          onSendSignal({
            callId: session.id,
            channelId: session.channelId,
            description: {
              sdp: peerConnection.localDescription.sdp,
              type: peerConnection.localDescription.type,
            },
            kind: "answer",
            toUserId: signal.fromUserId,
          });
        } catch {
          setMediaError("Nao foi possivel responder a chamada.");
        }
        return;
      }

      if (signal.kind === "answer" && signal.description) {
        try {
          const peerConnection = getPeerConnection(signal.fromUserId);

          if (!peerConnection) {
            return;
          }

          await peerConnection.setRemoteDescription(signal.description);
          await flushPendingIceCandidates(signal.fromUserId);
        } catch {
          setMediaError("Nao foi possivel concluir a conexao da chamada.");
        }
        return;
      }

      if (signal.kind === "ice-candidate") {
        try {
          const peerConnection = getPeerConnection(signal.fromUserId);

          if (!peerConnection || !signal.candidate) {
            return;
          }

          if (!peerConnection.remoteDescription) {
            const currentCandidates =
              pendingIceCandidatesRef.current.get(signal.fromUserId) ?? [];
            pendingIceCandidatesRef.current.set(signal.fromUserId, [
              ...currentCandidates,
              signal.candidate,
            ]);
            return;
          }

          await peerConnection.addIceCandidate(signal.candidate);
        } catch {
          setMediaError("Nao foi possivel sincronizar a chamada.");
        }
        return;
      }

      if (
        signal.kind === "decline" ||
        signal.kind === "end" ||
        signal.kind === "leave"
      ) {
        closePeerConnection(signal.fromUserId);
      }
    },
    [
      attachLocalTracks,
      closePeerConnection,
      currentUserId,
      flushPendingIceCandidates,
      getPeerConnection,
      onSendSignal,
      sendOfferToParticipant,
      session.channelId,
      session.id,
      waitForLocalStream,
    ],
  );

  useEffect(() => {
    realtimeSignals.forEach((signal) => {
      if (handledSignalIdsRef.current.has(signal.id)) {
        return;
      }

      handledSignalIdsRef.current.add(signal.id);
      void handleCallRealtimeSignal(signal);
    });
  }, [handleCallRealtimeSignal, realtimeSignals]);

  const restoreCameraAfterScreenShare = useCallback(async () => {
    if (session.type !== "video" || !cameraEnabled) {
      replaceLocalVideoTrack(null);
      return;
    }

    try {
      const cameraTrack = await requestCallVideoTrack(videoInputId);

      if (!cameraTrack) {
        replaceLocalVideoTrack(null);
        setCameraEnabled(false);
        return;
      }

      replaceLocalVideoTrack(cameraTrack);
    } catch {
      replaceLocalVideoTrack(null);
      setCameraEnabled(false);
      setMediaError("Nao foi possivel restaurar a camera.");
    }
  }, [cameraEnabled, replaceLocalVideoTrack, session.type, videoInputId]);

  const stopScreenSharing = useCallback(() => {
    const screenTrack = screenTrackRef.current;

    screenTrackRef.current = null;

    if (screenTrack && screenTrack.readyState !== "ended") {
      screenTrack.stop();
    }

    setIsScreenSharing(false);
    void restoreCameraAfterScreenShare();
  }, [restoreCameraAfterScreenShare]);

  const startScreenSharing = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMediaError("Compartilhamento de tela indisponivel neste navegador.");
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: true,
      });
      const [screenTrack] = displayStream.getVideoTracks();

      if (!screenTrack) {
        setMediaError("Nao foi possivel capturar a tela.");
        return;
      }

      screenTrackRef.current?.stop();
      screenTrackRef.current = screenTrack;
      screenTrack.addEventListener(
        "ended",
        () => {
          if (screenTrackRef.current !== screenTrack) {
            return;
          }

          screenTrackRef.current = null;
          setIsScreenSharing(false);
          void restoreCameraAfterScreenShare();
        },
        { once: true },
      );

      replaceLocalVideoTrack(screenTrack);
      setIsScreenSharing(true);
      setMediaError(null);
    } catch {
      setMediaError("Nao foi possivel compartilhar a tela.");
    }
  }, [replaceLocalVideoTrack, restoreCameraAfterScreenShare]);

  const handleToggleScreenShare = useCallback(() => {
    if (isScreenSharing) {
      stopScreenSharing();
      return;
    }

    void startScreenSharing();
  }, [isScreenSharing, startScreenSharing, stopScreenSharing]);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError("Midia indisponivel neste navegador.");
      return;
    }

    if (isScreenSharing) {
      return;
    }

    let cancelled = false;

    requestCallMedia({
      audioInputId,
      cameraEnabled,
      sessionType: session.type,
      videoInputId,
    })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        setLocalStream((currentStream) => {
          currentStream?.getTracks().forEach((track) => track.stop());
          return stream;
        });
        void refreshDevices();
        setMediaError(
          session.type === "video" &&
            cameraEnabled &&
            stream.getVideoTracks().length === 0
            ? "Nao foi possivel abrir a camera. A chamada continua com audio."
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setMediaError("Permita microfone e camera para usar chamadas.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    audioInputId,
    cameraEnabled,
    isScreenSharing,
    refreshDevices,
    session.type,
    videoInputId,
  ]);

  useEffect(() => {
    localStreamRef.current = localStream;

    if (!localStream) {
      return;
    }

    const waiters = [...localStreamWaitersRef.current];
    localStreamWaitersRef.current = [];
    waiters.forEach((resolve) => resolve(localStream));

    peerConnectionsRef.current.forEach((peerConnection) => {
      attachLocalTracks(peerConnection, localStream);
    });

    const pendingUserIds = [...pendingOfferUserIdsRef.current];
    pendingOfferUserIdsRef.current.clear();
    pendingUserIds.forEach((userId) => {
      void sendOfferToParticipant(userId);
    });
  }, [attachLocalTracks, localStream, sendOfferToParticipant]);

  useEffect(() => {
    localStream
      ?.getAudioTracks()
      .forEach((track) => {
        track.enabled = !isMuted;
      });
  }, [isMuted, localStream]);

  useEffect(() => {
    return () => {
      screenTrackRef.current?.stop();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    return () => {
      cleanupPeerConnections();
    };
  }, [cleanupPeerConnections]);

  return (
    <section
      aria-label="Chamada PulseX"
      className="fixed inset-x-4 top-20 z-[70] overflow-hidden rounded-xl border border-white/10 bg-[#0b1017] text-white shadow-2xl"
    >
      <header className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#A07C3B] text-white">
            <CallIcon aria-hidden="true" size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="m-0 truncate text-sm font-semibold">
              {session.title}
            </h2>
            <p className="m-0 mt-1 flex items-center gap-2 text-xs text-white/55">
              <span>{getCallTypeLabel(session.type)}</span>
              <span className="text-white/25">/</span>
              <span>{getCallStatusLabel(session.status)}</span>
              <span className="text-white/25">/</span>
              <Clock aria-hidden="true" size={13} />
              <span>{session.durationLabel ?? "00:00"}</span>
            </p>
          </div>
        </div>
        <button
          aria-label="Fechar painel de chamada"
          className="grid h-8 w-8 place-items-center rounded-md text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          onClick={onClose}
          type="button"
        >
          <X size={17} />
        </button>
      </header>
      <div className="grid gap-3 border-b border-white/10 bg-[#0d131d] px-4 py-3 md:grid-cols-2">
        <DeviceSelect
          devices={audioInputs}
          label="Microfone"
          onChange={setAudioInputId}
          value={audioInputId}
        />
        {session.type === "video" ? (
          <DeviceSelect
            devices={videoInputs}
            disabled={!cameraEnabled}
            label="Camera"
            onChange={setVideoInputId}
            value={videoInputId}
          />
        ) : null}
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {session.participants.map((participant) => {
          const participantUserId = participant.userId;
          const isLocalParticipant = participantUserId === currentUserId;
          const remoteStream = participantUserId
            ? remoteStreamsByUserId[participantUserId]
            : null;

          return (
            <CallParticipantTile
              isLocalMedia={isLocalParticipant}
              key={participant.id}
              mediaStream={isLocalParticipant ? localStream : remoteStream}
              participant={{
                ...participant,
                isCameraOn: isLocalParticipant
                  ? cameraEnabled || isScreenSharing
                  : Boolean(remoteStream?.getVideoTracks().length) ||
                    participant.isCameraOn,
                isMuted: isLocalParticipant ? isMuted : participant.isMuted,
                isScreenSharing: isLocalParticipant
                  ? isScreenSharing
                  : participant.isScreenSharing,
              }}
            />
          );
        })}
      </div>
      {mediaError ? (
        <p className="m-0 border-t border-white/10 px-4 py-2 text-xs text-amber-200">
          {mediaError}
        </p>
      ) : null}
      <CallControls
        cameraEnabled={cameraEnabled}
        isAudioOnly={session.type === "audio"}
        isMuted={isMuted}
        isScreenSharing={isScreenSharing}
        onEnd={onEnd}
        onToggleCamera={() => setCameraEnabled((current) => !current)}
        onToggleMicrophone={() => setIsMuted((current) => !current)}
        onToggleScreenShare={handleToggleScreenShare}
      />
    </section>
  );
}

function getCallTypeLabel(type: PulseXCallSession["type"]) {
  return type === "video" ? "Video" : "Audio";
}

function getCallStatusLabel(status: PulseXCallSession["status"]) {
  const labels = {
    active: "Em andamento",
    ended: "Finalizada",
    idle: "Pronta",
    missed: "Perdida",
    ringing: "Chamando",
  } as const satisfies Record<PulseXCallSession["status"], string>;

  return labels[status];
}

function DeviceSelect({
  devices,
  disabled = false,
  label,
  onChange,
  value,
}: {
  devices: readonly MediaDeviceOption[];
  disabled?: boolean;
  label: string;
  onChange: (deviceId: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[0.68rem] font-semibold uppercase tracking-wide text-white/45">
        {label}
      </span>
      <select
        className="h-9 rounded-md border border-white/10 bg-white/10 px-2 text-sm text-white outline-none transition focus:border-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-45"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option className="text-[#101820]" value={defaultDeviceValue}>
          Padrao do sistema
        </option>
        {devices.map((device) => (
          <option
            className="text-[#101820]"
            key={device.deviceId}
            value={device.deviceId}
          >
            {device.label}
          </option>
        ))}
      </select>
    </label>
  );
}

async function requestCallMedia({
  audioInputId,
  cameraEnabled,
  sessionType,
  videoInputId,
}: {
  audioInputId: string;
  cameraEnabled: boolean;
  sessionType: PulseXCallSession["type"];
  videoInputId: string;
}) {
  const needsVideo = sessionType === "video" && cameraEnabled;

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: createDeviceConstraint(audioInputId),
      video: needsVideo ? createDeviceConstraint(videoInputId) : false,
    });
  } catch (error) {
    if (!needsVideo) {
      throw error;
    }

    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: createDeviceConstraint(audioInputId),
        video: true,
      });
    } catch {
      return navigator.mediaDevices.getUserMedia({
        audio: createDeviceConstraint(audioInputId),
        video: false,
      });
    }
  }
}

async function requestCallVideoTrack(videoInputId: string) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: createDeviceConstraint(videoInputId),
  });

  return stream.getVideoTracks()[0] ?? null;
}

function replacePeerVideoTrack(
  peerConnection: RTCPeerConnection,
  stream: MediaStream,
  track: MediaStreamTrack | null,
) {
  const videoSender = findPeerSender(peerConnection, "video");

  if (videoSender) {
    void videoSender.replaceTrack(track);
    return;
  }

  if (track) {
    peerConnection.addTrack(track, stream);
  }
}

function ensurePeerTransceiver(
  peerConnection: RTCPeerConnection,
  kind: "audio" | "video",
) {
  const hasTransceiver = peerConnection.getTransceivers().some(
    (transceiver) =>
      transceiver.sender.track?.kind === kind ||
      transceiver.receiver.track.kind === kind,
  );

  if (!hasTransceiver) {
    peerConnection.addTransceiver(kind, { direction: "sendrecv" });
  }
}

function findPeerSender(
  peerConnection: RTCPeerConnection,
  kind: MediaStreamTrack["kind"],
) {
  const sender = peerConnection
    .getSenders()
    .find((currentSender) => currentSender.track?.kind === kind);

  if (sender) {
    return sender;
  }

  return peerConnection
    .getTransceivers()
    .find((transceiver) => transceiver.receiver.track.kind === kind)?.sender;
}

function createDeviceConstraint(deviceId: string): boolean | MediaTrackConstraints {
  return deviceId === defaultDeviceValue
    ? true
    : {
        deviceId: {
          exact: deviceId,
        },
      };
}

function createDeviceOptions(
  devices: readonly MediaDeviceInfo[],
  fallbackLabel: string,
) {
  return devices
    .filter((device) => device.deviceId)
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `${fallbackLabel} ${index + 1}`,
    }));
}

function isKnownDevice(
  deviceId: string,
  devices: readonly MediaDeviceOption[],
) {
  return (
    deviceId === defaultDeviceValue ||
    devices.some((device) => device.deviceId === deviceId)
  );
}
