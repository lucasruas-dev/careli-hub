"use client";

import type {
  HermesCallRealtimeSignal,
  HermesCallRealtimeSignalInput,
  HermesCallSession,
  HermesPresenceUser,
} from "@/lib/pulsex";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  Clock,
  Maximize2,
  Minimize2,
  Phone,
  Video,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import { useCallback, useEffect, useRef, useState } from "react";
import { CallControls } from "./call-controls";
import { CallParticipantTile } from "./call-participant-tile";

type CallPanelProps = {
  currentUserId: HermesPresenceUser["id"];
  onClose: () => void;
  onEnd: () => void;
  onSendSignal: (signal: HermesCallRealtimeSignalInput) => void;
  realtimeSignals: readonly HermesCallRealtimeSignal[];
  session: HermesCallSession;
};

type MediaDeviceOption = {
  deviceId: string;
  label: string;
};

type CallPanelPosition = {
  left: number;
  top: number;
};

type CallPanelDragState = {
  offsetX: number;
  offsetY: number;
  panelHeight: number;
  panelWidth: number;
  pointerId: number;
};

type PictureInPictureDocument = Document & {
  exitPictureInPicture?: () => Promise<void>;
  pictureInPictureElement?: Element | null;
  pictureInPictureEnabled?: boolean;
};

type PictureInPictureVideoElement = HTMLVideoElement & {
  requestPictureInPicture?: () => Promise<unknown>;
};

const defaultDeviceValue = "__default__";
const peerConnectionConfig = {
  iceCandidatePoolSize: 4,
  iceServers: createIceServers(),
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
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const [panelPosition, setPanelPosition] = useState<CallPanelPosition | null>(
    null,
  );
  const [pictureInPictureParticipantId, setPictureInPictureParticipantId] =
    useState<string | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenShareZoom, setScreenShareZoom] = useState(1);
  const [remoteScreenSharingUserIds, setRemoteScreenSharingUserIds] = useState<
    HermesPresenceUser["id"][]
  >([]);
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
  const dragStateRef = useRef<CallPanelDragState | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localStreamWaitersRef = useRef<
    Array<(stream: MediaStream | null) => void>
  >([]);
  const pendingOfferUserIdsRef = useRef<Set<HermesPresenceUser["id"]>>(
    new Set(),
  );
  const pendingAnswerSignalsRef = useRef<
    Map<HermesPresenceUser["id"], HermesCallRealtimeSignal>
  >(new Map());
  const pendingIceCandidatesRef = useRef<
    Map<HermesPresenceUser["id"], RTCIceCandidateInit[]>
  >(new Map());
  const panelRef = useRef<HTMLElement>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const videoElementsByParticipantIdRef = useRef<Map<string, HTMLVideoElement>>(
    new Map(),
  );
  const CallIcon = session.type === "video" ? Video : Phone;
  const panelClassName = isFullScreen
    ? "fixed inset-0 z-[90] grid h-dvh w-screen grid-rows-[auto_minmax(0,1fr)_auto_auto] overflow-hidden rounded-none border-0 bg-[#0b1017] text-white shadow-2xl"
    : `fixed z-[70] grid h-[min(86vh,780px)] w-[min(88vw,1080px)] grid-rows-[auto_minmax(0,1fr)_auto_auto] overflow-hidden rounded-xl border border-white/10 bg-[#0b1017] text-white shadow-2xl ${
        isDraggingPanel ? "select-none" : ""
      }`;
  const panelStyle: CSSProperties | undefined = isFullScreen
    ? undefined
    : panelPosition
      ? {
          left: panelPosition.left,
          top: panelPosition.top,
        }
      : {
          left: "50%",
          top: "3.5rem",
          transform: "translateX(-50%)",
        };
  const isPictureInPictureAvailable =
    session.type === "video" &&
    typeof document !== "undefined" &&
    Boolean((document as PictureInPictureDocument).pictureInPictureEnabled);

  const clampPanelPosition = useCallback(
    (
      left: number,
      top: number,
      panelWidth: number,
      panelHeight: number,
    ): CallPanelPosition => {
      const viewportMargin = 12;
      const maxLeft = Math.max(
        viewportMargin,
        window.innerWidth - panelWidth - viewportMargin,
      );
      const maxTop = Math.max(
        viewportMargin,
        window.innerHeight - panelHeight - viewportMargin,
      );

      return {
        left: Math.min(Math.max(viewportMargin, left), maxLeft),
        top: Math.min(Math.max(viewportMargin, top), maxTop),
      };
    },
    [],
  );

  const handlePanelDragStart = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (isFullScreen || event.button !== 0) {
        return;
      }

      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (
        target.closest(
          "button,a,input,select,textarea,[role='button'],[role='menu']",
        )
      ) {
        return;
      }

      const panel = panelRef.current;

      if (!panel) {
        return;
      }

      const panelRect = panel.getBoundingClientRect();

      dragStateRef.current = {
        offsetX: event.clientX - panelRect.left,
        offsetY: event.clientY - panelRect.top,
        panelHeight: panelRect.height,
        panelWidth: panelRect.width,
        pointerId: event.pointerId,
      };
      setPanelPosition({
        left: panelRect.left,
        top: panelRect.top,
      });
      setIsDraggingPanel(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [isFullScreen],
  );

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
      isKnownDevice(currentId, nextAudioInputs)
        ? currentId
        : defaultDeviceValue,
    );
    setVideoInputId((currentId) =>
      isKnownDevice(currentId, nextVideoInputs)
        ? currentId
        : defaultDeviceValue,
    );
  }, []);

  useEffect(() => {
    if (!isDraggingPanel) {
      return;
    }

    function handlePointerMove(event: PointerEvent) {
      const dragState = dragStateRef.current;

      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      setPanelPosition(
        clampPanelPosition(
          event.clientX - dragState.offsetX,
          event.clientY - dragState.offsetY,
          dragState.panelWidth,
          dragState.panelHeight,
        ),
      );
    }

    function stopDragging(event: PointerEvent) {
      const dragState = dragStateRef.current;

      if (dragState && event.pointerId !== dragState.pointerId) {
        return;
      }

      dragStateRef.current = null;
      setIsDraggingPanel(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [clampPanelPosition, isDraggingPanel]);

  useEffect(() => {
    if (isFullScreen || !panelPosition) {
      return;
    }

    function handleWindowResize() {
      const panel = panelRef.current;

      if (!panel) {
        return;
      }

      const panelRect = panel.getBoundingClientRect();

      setPanelPosition((currentPosition) =>
        currentPosition
          ? clampPanelPosition(
              currentPosition.left,
              currentPosition.top,
              panelRect.width,
              panelRect.height,
            )
          : currentPosition,
      );
    }

    window.addEventListener("resize", handleWindowResize);

    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [clampPanelPosition, isFullScreen, panelPosition]);

  useEffect(() => {
    void refreshDevices();

    if (!navigator.mediaDevices?.addEventListener) {
      return;
    }

    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);

    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        refreshDevices,
      );
    };
  }, [refreshDevices]);

  const attachLocalTracks = useCallback(
    async (peerConnection: RTCPeerConnection, stream: MediaStream) => {
      await Promise.all(
        stream.getTracks().map(async (track) => {
          const sender = findPeerSender(peerConnection, track.kind);

          if (sender) {
            await sender.replaceTrack(track);
            return;
          }

          peerConnection.addTrack(track, stream);
        }),
      );
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
    async (remoteUserId: HermesPresenceUser["id"]) => {
      const peerConnection = peerConnectionsRef.current.get(remoteUserId);
      const candidates =
        pendingIceCandidatesRef.current.get(remoteUserId) ?? [];

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
    (
      remoteUserId: string,
      options?: {
        prepareOfferTransceivers?: boolean;
      },
    ) => {
      const existingConnection = peerConnectionsRef.current.get(remoteUserId);

      if (
        existingConnection &&
        existingConnection.connectionState !== "closed"
      ) {
        if (options?.prepareOfferTransceivers) {
          ensurePeerTransceiver(existingConnection, "audio");
          ensurePeerTransceiver(existingConnection, "video");
        }
        return existingConnection;
      }

      if (typeof RTCPeerConnection === "undefined") {
        setMediaError("Chamadas em tempo real indisponiveis neste navegador.");
        return null;
      }

      const peerConnection = new RTCPeerConnection(peerConnectionConfig);

      if (options?.prepareOfferTransceivers) {
        ensurePeerTransceiver(peerConnection, "audio");
        ensurePeerTransceiver(peerConnection, "video");
      }

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
        const incomingTracks = event.streams[0]?.getTracks() ?? [event.track];

        setRemoteStreamsByUserId((currentStreams) => {
          const currentStream =
            currentStreams[remoteUserId] ?? new MediaStream();
          const nextStream = new MediaStream(currentStream.getTracks());

          incomingTracks.forEach((track) => {
            if (
              !nextStream
                .getTracks()
                .some((currentTrack) => currentTrack.id === track.id)
            ) {
              nextStream.addTrack(track);
            }
          });

          return {
            ...currentStreams,
            [remoteUserId]: nextStream,
          };
        });
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
        void attachLocalTracks(peerConnection, localStreamRef.current);
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

        const peerConnection = getPeerConnection(remoteUserId, {
          prepareOfferTransceivers: true,
        });

        if (!peerConnection) {
          return;
        }

        await attachLocalTracks(peerConnection, stream);

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

  const sendAnswerToOffer = useCallback(
    async (signal: HermesCallRealtimeSignal, stream: MediaStream) => {
      if (!signal.description) {
        return;
      }

      const peerConnection = getPeerConnection(signal.fromUserId);

      if (!peerConnection) {
        return;
      }

      await peerConnection.setRemoteDescription(signal.description);
      await attachLocalTracks(peerConnection, stream);

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      await flushPendingIceCandidates(signal.fromUserId);

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
    },
    [
      attachLocalTracks,
      flushPendingIceCandidates,
      getPeerConnection,
      onSendSignal,
      session.channelId,
      session.id,
    ],
  );

  const handleCallRealtimeSignal = useCallback(
    async (signal: HermesCallRealtimeSignal) => {
      if (signal.callId !== session.id || signal.fromUserId === currentUserId) {
        return;
      }

      if (
        signal.kind === "screen-share-start" ||
        signal.kind === "screen-share-stop"
      ) {
        setRemoteScreenSharingUserIds((currentUserIds) => {
          if (signal.kind === "screen-share-start") {
            return currentUserIds.includes(signal.fromUserId)
              ? currentUserIds
              : [...currentUserIds, signal.fromUserId];
          }

          return currentUserIds.filter(
            (userId) => userId !== signal.fromUserId,
          );
        });
        return;
      }

      if (signal.kind === "join") {
        await sendOfferToParticipant(signal.fromUserId);
        return;
      }

      if (signal.kind === "offer" && signal.description) {
        try {
          const stream = await waitForLocalStream();

          if (!stream) {
            pendingAnswerSignalsRef.current.set(signal.fromUserId, signal);
            setMediaError("Aguardando microfone para responder a chamada.");
            return;
          }

          await sendAnswerToOffer(signal, stream);
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
          if (!signal.candidate) {
            return;
          }

          const peerConnection = peerConnectionsRef.current.get(
            signal.fromUserId,
          );

          if (!peerConnection || !peerConnection.remoteDescription) {
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
        pendingAnswerSignalsRef.current.delete(signal.fromUserId);
        setRemoteScreenSharingUserIds((currentUserIds) =>
          currentUserIds.filter((userId) => userId !== signal.fromUserId),
        );
        closePeerConnection(signal.fromUserId);
      }
    },
    [
      closePeerConnection,
      currentUserId,
      flushPendingIceCandidates,
      getPeerConnection,
      sendAnswerToOffer,
      sendOfferToParticipant,
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
    onSendSignal({
      callId: session.id,
      channelId: session.channelId,
      kind: "screen-share-stop",
    });
    void restoreCameraAfterScreenShare();
  }, [
    onSendSignal,
    restoreCameraAfterScreenShare,
    session.channelId,
    session.id,
  ]);

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
          onSendSignal({
            callId: session.id,
            channelId: session.channelId,
            kind: "screen-share-stop",
          });
          void restoreCameraAfterScreenShare();
        },
        { once: true },
      );

      replaceLocalVideoTrack(screenTrack);
      setIsScreenSharing(true);
      onSendSignal({
        callId: session.id,
        channelId: session.channelId,
        kind: "screen-share-start",
      });
      setMediaError(null);
    } catch {
      setMediaError("Nao foi possivel compartilhar a tela.");
    }
  }, [
    onSendSignal,
    replaceLocalVideoTrack,
    restoreCameraAfterScreenShare,
    session.channelId,
    session.id,
  ]);

  const handleToggleScreenShare = useCallback(() => {
    if (isScreenSharing) {
      stopScreenSharing();
      return;
    }

    void startScreenSharing();
  }, [isScreenSharing, startScreenSharing, stopScreenSharing]);

  const handleVideoElementChange = useCallback(
    (participantId: string, videoElement: HTMLVideoElement | null) => {
      if (videoElement) {
        videoElementsByParticipantIdRef.current.set(
          participantId,
          videoElement,
        );
        return;
      }

      videoElementsByParticipantIdRef.current.delete(participantId);
    },
    [],
  );

  const getPictureInPictureTarget = useCallback(() => {
    const remoteParticipant = session.participants.find(
      (participant) =>
        participant.userId !== currentUserId &&
        videoElementsByParticipantIdRef.current.has(participant.id),
    );
    const localParticipant = session.participants.find(
      (participant) =>
        participant.userId === currentUserId &&
        videoElementsByParticipantIdRef.current.has(participant.id),
    );
    const fallbackParticipant = session.participants.find((participant) =>
      videoElementsByParticipantIdRef.current.has(participant.id),
    );
    const targetParticipant =
      remoteParticipant ?? localParticipant ?? fallbackParticipant;

    if (!targetParticipant) {
      return null;
    }

    const videoElement = videoElementsByParticipantIdRef.current.get(
      targetParticipant.id,
    ) as PictureInPictureVideoElement | undefined;

    return videoElement
      ? {
          participantId: targetParticipant.id,
          videoElement,
        }
      : null;
  }, [currentUserId, session.participants]);

  const handleTogglePictureInPicture = useCallback(async () => {
    if (typeof document === "undefined") {
      return;
    }

    const pictureInPictureDocument = document as PictureInPictureDocument;

    if (!pictureInPictureDocument.pictureInPictureEnabled) {
      setMediaError("Picture-in-picture indisponivel neste navegador.");
      return;
    }

    if (pictureInPictureDocument.pictureInPictureElement) {
      await pictureInPictureDocument
        .exitPictureInPicture?.()
        .catch(() => undefined);
      setPictureInPictureParticipantId(null);
      return;
    }

    const target = getPictureInPictureTarget();

    if (!target?.videoElement.requestPictureInPicture) {
      setMediaError(
        "Ative a camera ou aguarde um video remoto para abrir picture-in-picture.",
      );
      return;
    }

    try {
      await target.videoElement.play().catch(() => undefined);
      target.videoElement.addEventListener(
        "leavepictureinpicture",
        () => {
          setPictureInPictureParticipantId(null);
        },
        { once: true },
      );
      await target.videoElement.requestPictureInPicture();
      setPictureInPictureParticipantId(target.participantId);
      setMediaError(null);
    } catch {
      setPictureInPictureParticipantId(null);
      setMediaError("Nao foi possivel abrir picture-in-picture.");
    }
  }, [getPictureInPictureTarget]);

  const handleToggleFullScreen = useCallback(() => {
    const panel = panelRef.current;

    if (!isFullScreen) {
      setIsFullScreen(true);
      if (panel?.requestFullscreen) {
        void panel.requestFullscreen().catch(() => undefined);
      }
      return;
    }

    setIsFullScreen(false);

    if (document.fullscreenElement === panel) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, [isFullScreen]);

  const handleClosePanel = useCallback(() => {
    if (document.fullscreenElement === panelRef.current) {
      void document.exitFullscreen().catch(() => undefined);
    }

    setIsFullScreen(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    function handleFullScreenChange() {
      setIsFullScreen(document.fullscreenElement === panelRef.current);
    }

    document.addEventListener("fullscreenchange", handleFullScreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullScreenChange);
    };
  }, []);

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
      void attachLocalTracks(peerConnection, localStream);
    });

    const pendingAnswerSignals = [...pendingAnswerSignalsRef.current.values()];
    pendingAnswerSignalsRef.current.clear();
    pendingAnswerSignals.forEach((signal) => {
      void sendAnswerToOffer(signal, localStream).catch(() => {
        setMediaError("Nao foi possivel responder a chamada.");
      });
    });

    const pendingUserIds = [...pendingOfferUserIdsRef.current];
    pendingOfferUserIdsRef.current.clear();
    pendingUserIds.forEach((userId) => {
      void sendOfferToParticipant(userId);
    });
  }, [
    attachLocalTracks,
    localStream,
    sendAnswerToOffer,
    sendOfferToParticipant,
  ]);

  useEffect(() => {
    localStream?.getAudioTracks().forEach((track) => {
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

  const callParticipants = session.participants.map((participant) => {
    const participantUserId = participant.userId;
    const isLocalParticipant = participantUserId === currentUserId;
    const remoteStream = participantUserId
      ? remoteStreamsByUserId[participantUserId]
      : null;

    return {
      ...participant,
      isCameraOn: isLocalParticipant
        ? cameraEnabled || isScreenSharing
        : Boolean(remoteStream?.getVideoTracks().length) ||
          participant.isCameraOn,
      isLocalParticipant,
      isMuted: isLocalParticipant ? isMuted : participant.isMuted,
      isScreenSharing: isLocalParticipant
        ? isScreenSharing
        : Boolean(
            participantUserId &&
            remoteScreenSharingUserIds.includes(participantUserId),
          ) || participant.isScreenSharing,
      mediaStream: isLocalParticipant ? localStream : remoteStream,
    };
  });
  const screenShareParticipant = callParticipants.find(
    (participant) => participant.isScreenSharing,
  );
  const companionParticipants = screenShareParticipant
    ? callParticipants.filter(
        (participant) => participant.id !== screenShareParticipant.id,
      )
    : callParticipants;
  const standardGridClassName =
    callParticipants.length <= 2
      ? "grid min-h-0 content-center items-center gap-4 overflow-auto p-4 lg:grid-cols-2"
      : "grid min-h-0 auto-rows-min gap-3 overflow-auto p-4 sm:grid-cols-2";

  return (
    <section
      aria-label="Chamada Hermes"
      className={panelClassName}
      ref={panelRef}
      style={panelStyle}
    >
      <header
        className={`flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3 ${
          isFullScreen ? "" : "cursor-move select-none"
        }`}
        onPointerDown={handlePanelDragStart}
      >
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
        <div className="flex items-center gap-1">
          <Tooltip content={isFullScreen ? "Sair de tela cheia" : "Tela cheia"}>
            <button
              aria-label={isFullScreen ? "Sair de tela cheia" : "Tela cheia"}
              className="grid h-8 w-8 place-items-center rounded-md text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onClick={handleToggleFullScreen}
              type="button"
            >
              {isFullScreen ? (
                <Minimize2 aria-hidden="true" size={17} />
              ) : (
                <Maximize2 aria-hidden="true" size={17} />
              )}
            </button>
          </Tooltip>
          <button
            aria-label="Minimizar painel de chamada"
            className="grid h-8 w-8 place-items-center rounded-md text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            onClick={handleClosePanel}
            type="button"
          >
            <X size={17} />
          </button>
        </div>
      </header>
      {screenShareParticipant ? (
        <div className="relative min-h-0 overflow-hidden p-4">
          <div className="relative h-full min-h-0 overflow-hidden">
            <CallParticipantTile
              isLocalMedia={screenShareParticipant.isLocalParticipant}
              layout="spotlight"
              mediaStream={screenShareParticipant.mediaStream}
              onVideoElementChange={handleVideoElementChange}
              participant={screenShareParticipant}
              presentationZoom={screenShareZoom}
            />
            <div className="absolute right-4 top-4 z-20 flex items-center gap-1 rounded-full border border-white/10 bg-black/55 p-1 shadow-xl backdrop-blur">
              <Tooltip content="Diminuir zoom">
                <button
                  aria-label="Diminuir zoom da tela"
                  className="grid h-8 w-8 place-items-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  disabled={screenShareZoom <= 1}
                  onClick={() =>
                    setScreenShareZoom((currentZoom) =>
                      Math.max(1, Number((currentZoom - 0.25).toFixed(2))),
                    )
                  }
                  type="button"
                >
                  <ZoomOut aria-hidden="true" size={16} />
                </button>
              </Tooltip>
              <button
                className="h-8 rounded-full px-2 text-xs font-semibold text-white/85 transition hover:bg-white/10 hover:text-white"
                onClick={() => setScreenShareZoom(1)}
                type="button"
              >
                {Math.round(screenShareZoom * 100)}%
              </button>
              <Tooltip content="Aumentar zoom">
                <button
                  aria-label="Aumentar zoom da tela"
                  className="grid h-8 w-8 place-items-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  disabled={screenShareZoom >= 2.25}
                  onClick={() =>
                    setScreenShareZoom((currentZoom) =>
                      Math.min(2.25, Number((currentZoom + 0.25).toFixed(2))),
                    )
                  }
                  type="button"
                >
                  <ZoomIn aria-hidden="true" size={16} />
                </button>
              </Tooltip>
            </div>
            {companionParticipants.length > 0 ? (
              <div className="pointer-events-none absolute inset-x-4 bottom-4 z-20 flex max-h-40 gap-3 overflow-x-auto pb-1 sm:inset-x-auto sm:right-4 sm:max-h-[calc(100%-6rem)] sm:w-64 sm:flex-col-reverse sm:overflow-x-hidden sm:overflow-y-auto sm:pb-0">
                {companionParticipants.map((participant) => (
                  <div
                    className="pointer-events-auto w-52 shrink-0 sm:w-full"
                    key={participant.id}
                  >
                    <CallParticipantTile
                      isLocalMedia={participant.isLocalParticipant}
                      layout="floating"
                      mediaStream={participant.mediaStream}
                      onVideoElementChange={handleVideoElementChange}
                      participant={participant}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className={standardGridClassName}>
          {callParticipants.map((participant) => (
            <CallParticipantTile
              isLocalMedia={participant.isLocalParticipant}
              key={participant.id}
              layout="standard"
              mediaStream={participant.mediaStream}
              onVideoElementChange={handleVideoElementChange}
              participant={participant}
            />
          ))}
        </div>
      )}
      {mediaError ? (
        <p className="m-0 border-t border-white/10 px-4 py-2 text-xs text-amber-200">
          {mediaError}
        </p>
      ) : null}
      <CallControls
        audioDevices={audioInputs}
        cameraEnabled={cameraEnabled}
        isAudioOnly={session.type === "audio"}
        isMuted={isMuted}
        isPictureInPictureActive={Boolean(pictureInPictureParticipantId)}
        isPictureInPictureAvailable={isPictureInPictureAvailable}
        isScreenSharing={isScreenSharing}
        onEnd={onEnd}
        onSelectAudioDevice={setAudioInputId}
        onSelectVideoDevice={setVideoInputId}
        onTogglePictureInPicture={handleTogglePictureInPicture}
        onToggleCamera={() => setCameraEnabled((current) => !current)}
        onToggleMicrophone={() => setIsMuted((current) => !current)}
        onToggleScreenShare={handleToggleScreenShare}
        selectedAudioDeviceId={audioInputId}
        selectedVideoDeviceId={videoInputId}
        videoDevices={videoInputs}
      />
    </section>
  );
}

function getCallTypeLabel(type: HermesCallSession["type"]) {
  return type === "video" ? "Video" : "Audio";
}

function getCallStatusLabel(status: HermesCallSession["status"]) {
  const labels = {
    active: "Em andamento",
    ended: "Finalizada",
    idle: "Pronta",
    missed: "Perdida",
    ringing: "Chamando",
  } as const satisfies Record<HermesCallSession["status"], string>;

  return labels[status];
}

async function requestCallMedia({
  audioInputId,
  cameraEnabled,
  sessionType,
  videoInputId,
}: {
  audioInputId: string;
  cameraEnabled: boolean;
  sessionType: HermesCallSession["type"];
  videoInputId: string;
}) {
  const needsVideo = sessionType === "video" && cameraEnabled;
  const audioTrack = await requestCallAudioTrack(audioInputId);

  if (!needsVideo) {
    return new MediaStream([audioTrack]);
  }

  try {
    const videoTrack = await requestCallVideoTrack(videoInputId);
    return new MediaStream([audioTrack, videoTrack]);
  } catch {
    return new MediaStream([audioTrack]);
  }
}

async function requestCallAudioTrack(audioInputId: string) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: createDeviceConstraint(audioInputId),
    video: false,
  });

  const audioTrack = stream.getAudioTracks()[0];

  if (!audioTrack) {
    throw new Error("Missing audio track");
  }

  return audioTrack;
}

async function requestCallVideoTrack(videoInputId: string) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: createDeviceConstraint(videoInputId),
    });
    const videoTrack = stream.getVideoTracks()[0];

    if (!videoTrack) {
      throw new Error("Missing video track");
    }

    return videoTrack;
  } catch (error) {
    if (videoInputId === defaultDeviceValue) {
      throw error;
    }

    const fallbackStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: true,
    });
    const fallbackVideoTrack = fallbackStream.getVideoTracks()[0];

    if (!fallbackVideoTrack) {
      throw new Error("Missing fallback video track");
    }

    return fallbackVideoTrack;
  }
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
  const hasTransceiver = peerConnection
    .getTransceivers()
    .some(
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

function createDeviceConstraint(
  deviceId: string,
): boolean | MediaTrackConstraints {
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

function createIceServers(): RTCIceServer[] {
  const configuredTurnUrls = parsePublicEnvList(
    process.env.NEXT_PUBLIC_PULSEX_TURN_URLS,
  );
  const configuredTurnUsername =
    process.env.NEXT_PUBLIC_PULSEX_TURN_USERNAME?.trim();
  const configuredTurnCredential =
    process.env.NEXT_PUBLIC_PULSEX_TURN_CREDENTIAL?.trim();
  const iceServers: RTCIceServer[] = [
    {
      urls: ["stun:stun.l.google.com:19302", "stun:openrelay.metered.ca:80"],
    },
  ];

  if (configuredTurnUrls.length > 0) {
    const configuredTurnServer: RTCIceServer = {
      urls: configuredTurnUrls,
    };

    if (configuredTurnUsername) {
      configuredTurnServer.username = configuredTurnUsername;
    }

    if (configuredTurnCredential) {
      configuredTurnServer.credential = configuredTurnCredential;
    }

    iceServers.push(configuredTurnServer);
    return iceServers;
  }

  iceServers.push({
    credential: "openrelayproject",
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
  });

  return iceServers;
}

function parsePublicEnvList(value: string | undefined) {
  return (
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}
