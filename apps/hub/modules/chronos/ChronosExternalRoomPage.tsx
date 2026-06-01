"use client";

import { CallControls } from "@/components/pulsex/call-controls";
import { CallParticipantTile } from "@/components/pulsex/call-participant-tile";
import type {
  ChronosChatMessage,
  ChronosPublicJoinResult,
  ChronosPublicRoom,
} from "@/lib/chronos/types";
import {
  addMissingChronosRecordingAudioTracks,
  buildChronosRecordingMedia,
  formatChronosDuration,
  getEnabledChronosAudioTracks,
  getSupportedChronosRecordingMimeType,
  stopChronosMediaStream,
} from "@/lib/chronos/recording";
import type { HermesCallParticipant } from "@/lib/pulsex";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";
import { Badge } from "@repo/uix";
import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import {
  Ban,
  Building2,
  Droplet,
  Droplets,
  FileText,
  ImagePlus,
  Loader2,
  LockKeyhole,
  MessageSquare,
  Radio,
  Send,
  Square,
  UsersRound,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

type ChronosExternalRoomPageProps = {
  room: ChronosPublicRoom;
};

type ChronosRoomParticipant = {
  displayName: string;
  id: string;
  isCameraOn: boolean;
  isHost?: boolean;
  isMuted: boolean;
  isScreenSharing: boolean;
  organization?: string;
  stream?: MediaStream | null;
};

type ChronosRoomSignal = {
  candidate?: RTCIceCandidateInit | null;
  description?: RTCSessionDescriptionInit;
  fromParticipantId: string;
  id: string;
  kind:
    | "answer"
    | "chat-message"
    | "ice-candidate"
    | "join"
    | "leave"
    | "media-state"
    | "meeting-closed"
    | "offer"
    | "recording-state"
    | "screen-share-start"
    | "screen-share-stop"
    | "transcript-segment";
  message?: ChronosChatMessage;
  meetingId: string;
  participant?: Omit<ChronosRoomParticipant, "stream">;
  recordingStatus?: "available" | "recording";
  roomSlug: string;
  sentAt: string;
  toParticipantId?: string;
  transcript?: ChronosTranscriptPreview;
};

type ChronosLeaveRoomOptions = {
  closeMeeting?: boolean;
  notifyPeers?: boolean;
};

type ChronosTranscriptPreview = {
  content: string;
  id: string;
  speakerLabel: string;
};

type MediaDeviceOption = {
  deviceId: string;
  label: string;
};

type ChronosVirtualBackgroundMode = "blur-high" | "blur-low" | "image" | "none";

type ChronosPreparedLocalMedia = {
  cleanup: () => void;
  isVirtualBackgroundActive: boolean;
  stream: MediaStream;
};

type HubSupabaseClient = NonNullable<ReturnType<typeof getHubSupabaseClient>>;
type HubRealtimeChannel = ReturnType<HubSupabaseClient["channel"]>;

type ChronosRecordingUploadTarget = {
  bucket: string;
  path: string;
  token: string;
};

type SpeechRecognitionLike = {
  abort: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    0?: {
      confidence?: number;
      transcript?: string;
    };
    isFinal?: boolean;
  }>;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type PictureInPictureDocument = Document & {
  exitPictureInPicture?: () => Promise<void>;
  pictureInPictureElement?: Element | null;
  pictureInPictureEnabled?: boolean;
};

type PictureInPictureVideoElement = HTMLVideoElement & {
  requestPictureInPicture?: () => Promise<unknown>;
};

const defaultDeviceValue = "__default__";
const chronosSignalEvent = "chronos-room-signal";
const peerConnectionConfig = {
  iceCandidatePoolSize: 4,
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
} satisfies RTCConfiguration;
const chronosVirtualBackgroundFps = 24;
const chronosVirtualBackgroundModelUrl =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite";
const chronosVirtualBackgroundWasmUrl =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
let chronosImageSegmenterPromise: Promise<ImageSegmenter> | null = null;

export function ChronosExternalRoomPage({ room }: ChronosExternalRoomPageProps) {
  const { authState, hubUser, profileStatus } = useAuth();
  const isHubParticipant = Boolean(hubUser);
  const [displayName, setDisplayName] = useState(hubUser?.name ?? "");
  const [organization, setOrganization] = useState("");
  const [guestBackgroundDataUrl, setGuestBackgroundDataUrl] = useState("");
  const [guestBackgroundMode, setGuestBackgroundMode] =
    useState<ChronosVirtualBackgroundMode>("none");
  const [audioInputId, setAudioInputId] = useState(defaultDeviceValue);
  const [videoInputId, setVideoInputId] = useState(defaultDeviceValue);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceOption[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceOption[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [lastRecordingName, setLastRecordingName] = useState("");
  const [lastRecordingUrl, setLastRecordingUrl] = useState("");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingStorageStatus, setRecordingStorageStatus] = useState<
    "failed" | "idle" | "saved" | "uploading"
  >("idle");
  const [meetingId, setMeetingId] = useState("");
  const [localParticipant, setLocalParticipant] =
    useState<ChronosRoomParticipant | null>(null);
  const [remoteParticipants, setRemoteParticipants] = useState<
    Record<string, ChronosRoomParticipant>
  >({});
  const [chatMessages, setChatMessages] = useState<ChronosChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [backgroundPreferenceLoaded, setBackgroundPreferenceLoaded] =
    useState(false);
  const [transcriptPreview, setTranscriptPreview] = useState<
    ChronosTranscriptPreview[]
  >([]);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<
    "offline" | "ready" | "syncing"
  >("offline");
  const [isPictureInPictureAvailable, setIsPictureInPictureAvailable] =
    useState(false);
  const [pictureInPictureParticipantId, setPictureInPictureParticipantId] =
    useState<string | null>(null);
  const channelRef = useRef<HubRealtimeChannel | null>(null);
  const handleLeaveRoomRef = useRef<
    (options?: ChronosLeaveRoomOptions) => Promise<void>
  >(async () => undefined);
  const handledSignalsRef = useRef<Set<string>>(new Set());
  const isMutedRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localParticipantRef = useRef<ChronosRoomParticipant | null>(null);
  const meetingIdRef = useRef("");
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingCleanupRef = useRef<(() => void) | null>(null);
  const recordingStartedAtRef = useRef(0);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingMediaRestartPromiseRef = useRef<Promise<void> | null>(null);
  const recordingStopPromiseRef = useRef<Promise<void> | null>(null);
  const resolveRecordingStopRef = useRef<(() => void) | null>(null);
  const lastRecordingUrlRef = useRef("");
  const lastTranscriptSegmentRef = useRef<{
    content: string;
    sentAt: number;
  } | null>(null);
  const athenaTranscriptionActiveRef = useRef(false);
  const isRecordingRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const remoteParticipantsRef = useRef<Record<string, ChronosRoomParticipant>>(
    {},
  );
  const sendRecordingStateSignalRef = useRef<
    (status: "available" | "recording", toParticipantId?: string) => void
  >(() => undefined);
  const startAthenaTranscriptionRef = useRef<() => void>(() => undefined);
  const stopAthenaTranscriptionRef = useRef<() => void>(() => undefined);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const stoppingScreenShareRef = useRef(false);
  const virtualBackgroundCleanupRef = useRef<(() => void) | null>(null);
  const videoElementsByParticipantIdRef = useRef<Map<string, HTMLVideoElement>>(
    new Map(),
  );
  const hasJoined = Boolean(localParticipant && meetingId);
  const pageBackgroundImage = room.backgroundDataUrl || "";
  const participantLabel = isHubParticipant
    ? (hubUser?.name ?? "Colaborador Careli")
    : displayName.trim();
  const participantOrganization = isHubParticipant
    ? "Careli"
    : organization.trim();
  const backgroundPreferenceKey = useMemo(
    () => `chronos:background:${room.slug}:${hubUser?.id ?? "guest"}`,
    [hubUser?.id, room.slug],
  );

  useEffect(() => {
    if (hubUser?.name) {
      setDisplayName(hubUser.name);
    }
  }, [hubUser?.name]);

  useEffect(() => {
    const preference = readChronosBackgroundPreference(backgroundPreferenceKey);

    if (preference) {
      setGuestBackgroundDataUrl(preference.dataUrl);
      setGuestBackgroundMode(preference.mode);
    }

    setBackgroundPreferenceLoaded(true);
  }, [backgroundPreferenceKey]);

  useEffect(() => {
    if (!backgroundPreferenceLoaded) {
      return;
    }

    writeChronosBackgroundPreference(backgroundPreferenceKey, {
      dataUrl: guestBackgroundDataUrl,
      mode: guestBackgroundMode,
    });
  }, [
    backgroundPreferenceKey,
    backgroundPreferenceLoaded,
    guestBackgroundDataUrl,
    guestBackgroundMode,
  ]);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    localParticipantRef.current = localParticipant;
  }, [localParticipant]);

  useEffect(() => {
    remoteParticipantsRef.current = remoteParticipants;
  }, [remoteParticipants]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    if (!isRecording || !recordingStreamRef.current) {
      return;
    }

    addMissingChronosRecordingAudioTracks(recordingStreamRef.current, {
      localStream,
      remoteParticipants,
    });
  }, [isRecording, localStream, remoteParticipants]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    const pictureInPictureDocument = document as PictureInPictureDocument;

    setIsPictureInPictureAvailable(
      Boolean(pictureInPictureDocument.pictureInPictureEnabled),
    );
  }, []);

  useEffect(() => {
    meetingIdRef.current = meetingId;
  }, [meetingId]);

  useEffect(() => {
    const videoElement = previewVideoRef.current;

    if (!videoElement) {
      return;
    }

    videoElement.srcObject = localStream;

    if (localStream) {
      void videoElement.play().catch(() => undefined);
    }
  }, [localStream]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();

    setAudioInputs(createDeviceOptions(devices, "audioinput", "Microfone"));
    setVideoInputs(createDeviceOptions(devices, "videoinput", "Camera"));
  }, []);

  const replaceVideoTrackForPeers = useCallback(
    (track: MediaStreamTrack | null) => {
      peerConnectionsRef.current.forEach((peerConnection) => {
        const sender =
          peerConnection
            .getSenders()
            .find((currentSender) => currentSender.track?.kind === "video") ??
          peerConnection
            .getTransceivers()
            .find((transceiver) => transceiver.receiver.track.kind === "video")
            ?.sender;

        if (sender) {
          void sender.replaceTrack(track);
        }
      });
    },
    [],
  );

  const stopCurrentLocalMedia = useCallback(() => {
    virtualBackgroundCleanupRef.current?.();
    virtualBackgroundCleanupRef.current = null;
    stopChronosMediaStream(localStreamRef.current);
    localStreamRef.current = null;
  }, []);

  const getCurrentOutboundMediaStream = useCallback(() => {
    const currentStream = localStreamRef.current;
    const screenTrack = screenTrackRef.current;

    if (screenTrack && screenTrack.readyState !== "ended") {
      return new MediaStream([
        ...getEnabledChronosAudioTracks(currentStream),
        screenTrack,
      ]);
    }

    return currentStream;
  }, []);

  const startLocalMedia = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError("Camera e microfone indisponiveis neste navegador.");
      return null;
    }

    try {
      const stream = await requestChronosRoomMedia({
        audioInputId,
        cameraEnabled,
        videoInputId,
      });
      const preparedMedia = await createChronosPreparedLocalMedia({
        backgroundDataUrl: guestBackgroundDataUrl,
        backgroundMode: guestBackgroundMode,
        sourceStream: stream,
      });
      const nextStream = preparedMedia.stream;

      stopCurrentLocalMedia();
      virtualBackgroundCleanupRef.current = preparedMedia.cleanup;
      localStreamRef.current = nextStream;
      nextStream.getAudioTracks().forEach((track) => {
        track.enabled = !isMutedRef.current;
      });
      setLocalStream(nextStream);
      if (localParticipantRef.current && meetingIdRef.current && !screenTrackRef.current) {
        const nextParticipant = {
          ...localParticipantRef.current,
          isCameraOn: nextStream.getVideoTracks().length > 0,
          stream: nextStream,
        };

        replaceVideoTrackForPeers(nextStream.getVideoTracks()[0] ?? null);
        localParticipantRef.current = nextParticipant;
        setLocalParticipant(nextParticipant);
      }

      setMediaError(
        hasChronosVirtualBackgroundRequest({
          backgroundDataUrl: guestBackgroundDataUrl,
          mode: guestBackgroundMode,
        }) &&
          stream.getVideoTracks().length > 0 &&
          !preparedMedia.isVirtualBackgroundActive
          ? "Nao foi possivel aplicar o fundo virtual; usando a camera original."
          : null,
      );
      await refreshDevices();

      return nextStream;
    } catch {
      setMediaError("Permita camera e microfone para entrar na sala.");
      return null;
    }
  }, [
    audioInputId,
    cameraEnabled,
    guestBackgroundDataUrl,
    guestBackgroundMode,
    refreshDevices,
    replaceVideoTrackForPeers,
    stopCurrentLocalMedia,
    videoInputId,
  ]);

  useEffect(() => {
    void startLocalMedia();

    return () => {
      stopCurrentLocalMedia();
    };
  }, [startLocalMedia, stopCurrentLocalMedia]);

  useEffect(
    () => () => {
      if (lastRecordingUrlRef.current) {
        URL.revokeObjectURL(lastRecordingUrlRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted;
    });
  }, [isMuted, localStream]);

  useEffect(() => {
    if (!isRecording) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setRecordingSeconds(
        Math.max(
          0,
          Math.floor((Date.now() - recordingStartedAtRef.current) / 1000),
        ),
      );
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isRecording]);

  const sendSignal = useCallback((input: Omit<ChronosRoomSignal, "id" | "sentAt">) => {
    const channel = channelRef.current;

    if (!channel) {
      return;
    }

    const signal = {
      ...input,
      id: `chronos-signal-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      sentAt: new Date().toISOString(),
    } satisfies ChronosRoomSignal;

    void channel.send({
      event: chronosSignalEvent,
      payload: signal,
      type: "broadcast",
    });
  }, []);

  const createPeerConnection = useCallback(
    (remoteParticipantId: string) => {
      const currentConnection = peerConnectionsRef.current.get(
        remoteParticipantId,
      );

      if (currentConnection) {
        return currentConnection;
      }

      const peerConnection = new RTCPeerConnection(peerConnectionConfig);
      const stream = getCurrentOutboundMediaStream();
      const tracks = stream?.getTracks() ?? [];

      tracks.forEach((track) => {
        peerConnection.addTrack(track, stream ?? new MediaStream([track]));
      });

      if (!tracks.some((track) => track.kind === "video")) {
        peerConnection.addTransceiver("video", { direction: "sendrecv" });
      }

      peerConnection.addEventListener("icecandidate", (event) => {
        const participant = localParticipantRef.current;
        const currentMeetingId = meetingIdRef.current;

        if (!participant || !currentMeetingId || !event.candidate) {
          return;
        }

        sendSignal({
          candidate: event.candidate.toJSON(),
          fromParticipantId: participant.id,
          kind: "ice-candidate",
          meetingId: currentMeetingId,
          roomSlug: room.slug,
          toParticipantId: remoteParticipantId,
        });
      });

      peerConnection.addEventListener("track", (event) => {
        const [remoteStream] = event.streams;

        if (!remoteStream) {
          return;
        }

        setRemoteParticipants((currentParticipants) => ({
          ...currentParticipants,
          [remoteParticipantId]: {
            ...(currentParticipants[remoteParticipantId] ?? {
              displayName: "Participante Chronos",
              id: remoteParticipantId,
              isCameraOn: true,
              isMuted: false,
              isScreenSharing: false,
            }),
            stream: remoteStream,
          },
        }));
      });

      peerConnectionsRef.current.set(remoteParticipantId, peerConnection);

      return peerConnection;
    },
    [getCurrentOutboundMediaStream, room.slug, sendSignal],
  );

  const createOfferForParticipant = useCallback(
    async (remoteParticipantId: string) => {
      const participant = localParticipantRef.current;
      const currentMeetingId = meetingIdRef.current;

      if (!participant || !currentMeetingId) {
        return;
      }

      const peerConnection = createPeerConnection(remoteParticipantId);
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      sendSignal({
        description: offer,
        fromParticipantId: participant.id,
        kind: "offer",
        meetingId: currentMeetingId,
        roomSlug: room.slug,
        toParticipantId: remoteParticipantId,
      });
    },
    [createPeerConnection, room.slug, sendSignal],
  );

  const handleSignal = useCallback(
    async (payload: unknown) => {
      const signal = payload as Partial<ChronosRoomSignal>;
      const participant = localParticipantRef.current;
      const currentMeetingId = meetingIdRef.current;

      if (
        !participant ||
        !currentMeetingId ||
        !signal.id ||
        !signal.fromParticipantId ||
        handledSignalsRef.current.has(signal.id) ||
        signal.roomSlug !== room.slug ||
        signal.meetingId !== currentMeetingId ||
        signal.fromParticipantId === participant.id ||
        (signal.toParticipantId && signal.toParticipantId !== participant.id)
      ) {
        return;
      }

      handledSignalsRef.current.add(signal.id);
      const remoteParticipantId = signal.fromParticipantId;

      if (signal.participant) {
        setRemoteParticipants((currentParticipants) => ({
          ...currentParticipants,
          [remoteParticipantId]: {
            ...(currentParticipants[remoteParticipantId] ?? {}),
            ...signal.participant,
          } as ChronosRoomParticipant,
        }));
      }

      if (signal.kind === "join") {
        sendSignal({
          fromParticipantId: participant.id,
          kind: "media-state",
          meetingId: currentMeetingId,
          participant: stripParticipantStream(participant),
          roomSlug: room.slug,
          toParticipantId: remoteParticipantId,
        });

        if (isRecordingRef.current) {
          sendRecordingStateSignalRef.current("recording", remoteParticipantId);
        }

        if (participant.id < remoteParticipantId) {
          await createOfferForParticipant(remoteParticipantId);
        }

        return;
      }

      if (signal.kind === "media-state") {
        return;
      }

      if (signal.kind === "recording-state") {
        if (signal.recordingStatus === "recording") {
          startAthenaTranscriptionRef.current();
          setIsTranscriptOpen(true);
        } else {
          stopAthenaTranscriptionRef.current();
        }

        return;
      }

      if (signal.kind === "chat-message" && signal.message) {
        setChatMessages((currentMessages) =>
          appendUniqueChronosChatMessage(currentMessages, signal.message),
        );
        setIsChatOpen(true);
        return;
      }

      if (signal.kind === "transcript-segment" && signal.transcript) {
        setTranscriptPreview((currentSegments) =>
          appendUniqueChronosTranscriptPreview(
            currentSegments,
            signal.transcript as ChronosTranscriptPreview,
          ),
        );
        return;
      }

      if (signal.kind === "meeting-closed") {
        setMediaError("Chamada encerrada pelo host.");
        void handleLeaveRoomRef.current({ notifyPeers: false });
        return;
      }

      if (signal.kind === "leave") {
        closePeerConnection(remoteParticipantId);
        setRemoteParticipants((currentParticipants) => {
          const nextParticipants = { ...currentParticipants };
          delete nextParticipants[remoteParticipantId];
          return nextParticipants;
        });
        return;
      }

      if (signal.kind === "screen-share-start" || signal.kind === "screen-share-stop") {
        setRemoteParticipants((currentParticipants) => ({
          ...currentParticipants,
          [remoteParticipantId]: {
            ...(currentParticipants[remoteParticipantId] ?? {
              displayName: "Participante Chronos",
              id: remoteParticipantId,
              isCameraOn: true,
              isMuted: false,
            }),
            isScreenSharing: signal.kind === "screen-share-start",
          },
        }));
        return;
      }

      if (signal.kind === "offer" && signal.description) {
        const peerConnection = createPeerConnection(remoteParticipantId);
        await peerConnection.setRemoteDescription(signal.description);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        sendSignal({
          description: answer,
          fromParticipantId: participant.id,
          kind: "answer",
          meetingId: currentMeetingId,
          roomSlug: room.slug,
          toParticipantId: remoteParticipantId,
        });
        return;
      }

      if (signal.kind === "answer" && signal.description) {
        const peerConnection = createPeerConnection(remoteParticipantId);
        await peerConnection.setRemoteDescription(signal.description);
        return;
      }

      if (signal.kind === "ice-candidate" && signal.candidate) {
        const peerConnection = createPeerConnection(remoteParticipantId);
        await peerConnection.addIceCandidate(signal.candidate);
      }
    },
    [
      createOfferForParticipant,
      createPeerConnection,
      room.slug,
      sendSignal,
    ],
  );

  useEffect(() => {
    if (!hasJoined || !localParticipant || !meetingId) {
      return;
    }

    const client = getHubSupabaseClient();

    if (!client) {
      setRealtimeStatus("offline");
      return;
    }

    setRealtimeStatus("syncing");

    const channel = client.channel(`chronos:room:${room.slug}:${meetingId}`, {
      config: {
        broadcast: {
          ack: true,
          self: false,
        },
      },
    });

    channelRef.current = channel;
    channel
      .on(
        "broadcast",
        {
          event: chronosSignalEvent,
        },
        (message: { payload?: unknown }) => {
          void handleSignal(message.payload);
        },
      )
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") {
          return;
        }

        setRealtimeStatus("ready");
        sendSignal({
          fromParticipantId: localParticipant.id,
          kind: "join",
          meetingId,
          participant: stripParticipantStream(localParticipant),
          roomSlug: room.slug,
        });
      });

    return () => {
      sendSignal({
        fromParticipantId: localParticipant.id,
        kind: "leave",
        meetingId,
        participant: stripParticipantStream(localParticipant),
        roomSlug: room.slug,
      });
      channelRef.current = null;
      setRealtimeStatus("offline");
      closeAllPeerConnections();
      void client.removeChannel(channel);
    };
  }, [handleSignal, hasJoined, localParticipant, meetingId, room.slug, sendSignal]);

  async function handleJoinRoom() {
    const nextDisplayName = participantLabel;

    if (!nextDisplayName) {
      setJoinError("Informe seu nome para participar.");
      return;
    }

    setJoining(true);
    setJoinError(null);

    const stream = localStreamRef.current ?? (await startLocalMedia());

    try {
      const response = await fetch(
        `/api/chronos/public/rooms/${room.slug}/join`,
        {
          body: JSON.stringify({
            displayName: nextDisplayName,
            organization: participantOrganization,
          }),
          cache: "no-store",
          headers: {
            ...(authState.session?.accessToken
              ? {
                  Authorization: `Bearer ${authState.session.accessToken}`,
                }
              : {}),
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | (ChronosPublicJoinResult & { error?: string })
        | null;

      if (!response.ok || !payload?.meetingId || !payload.participant) {
        throw new Error(payload?.error ?? "Nao foi possivel entrar na sala.");
      }

      const participant: ChronosRoomParticipant = {
        displayName: payload.participant.displayName,
        id: payload.participant.id,
        isCameraOn: cameraEnabled,
        isHost: payload.isHost,
        isMuted,
        isScreenSharing: false,
        organization: payload.participant.organization,
        stream,
      };

      setMeetingId(payload.meetingId);
      setLocalParticipant(participant);
    } catch (error) {
      setJoinError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel entrar na sala.",
      );
    } finally {
      setJoining(false);
    }
  }

  function handleToggleMicrophone() {
    const nextMuted = !isMuted;

    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);

    const participant = localParticipantRef.current;

    if (participant) {
      const nextParticipant = {
        ...participant,
        isMuted: nextMuted,
      };

      localParticipantRef.current = nextParticipant;
      setLocalParticipant(nextParticipant);
      sendParticipantStateSignal(nextParticipant);
    }
  }

  async function handleToggleCamera() {
    if (cameraEnabled) {
      const stream = localStreamRef.current;
      virtualBackgroundCleanupRef.current?.();
      virtualBackgroundCleanupRef.current = null;
      stream?.getVideoTracks().forEach((track) => {
        track.stop();
        stream.removeTrack(track);
      });
      replaceVideoTrackForPeers(null);
      const nextStream = stream ? new MediaStream(stream.getTracks()) : null;

      localStreamRef.current = nextStream;
      setCameraEnabled(false);
      setLocalStream(nextStream);

      const participant = localParticipantRef.current;

      if (participant) {
        const nextParticipant = {
          ...participant,
          isCameraOn: false,
          stream: nextStream,
        };

        localParticipantRef.current = nextParticipant;
        setLocalParticipant(nextParticipant);
        sendParticipantStateSignal(nextParticipant);
      }
      return;
    }

    try {
      const videoTrack = await requestChronosVideoTrack(videoInputId);
      const currentStream = localStreamRef.current ?? new MediaStream();
      const preparedMedia = await createChronosPreparedLocalMedia({
        backgroundDataUrl: guestBackgroundDataUrl,
        backgroundMode: guestBackgroundMode,
        sourceStream: new MediaStream([
          ...currentStream.getAudioTracks(),
          videoTrack,
        ]),
      });
      const nextStream = preparedMedia.stream;

      virtualBackgroundCleanupRef.current?.();
      virtualBackgroundCleanupRef.current = preparedMedia.cleanup;
      replaceVideoTrackForPeers(nextStream.getVideoTracks()[0] ?? null);
      localStreamRef.current = nextStream;
      setCameraEnabled(true);
      setLocalStream(new MediaStream(nextStream.getTracks()));
      setMediaError(
        hasChronosVirtualBackgroundRequest({
          backgroundDataUrl: guestBackgroundDataUrl,
          mode: guestBackgroundMode,
        }) && !preparedMedia.isVirtualBackgroundActive
          ? "Nao foi possivel aplicar o fundo virtual; usando a camera original."
          : null,
      );

      const participant = localParticipantRef.current;

      if (participant) {
        const nextParticipant = {
          ...participant,
          isCameraOn: true,
          stream: nextStream,
        };

        localParticipantRef.current = nextParticipant;
        setLocalParticipant(nextParticipant);
        sendParticipantStateSignal(nextParticipant);
      }
    } catch {
      setMediaError("Nao foi possivel ligar a camera.");
    }
  }

  async function handleToggleScreenShare() {
    if (isScreenSharing) {
      await stopScreenShare();
      return;
    }

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
        throw new Error("Missing screen track");
      }

      screenTrackRef.current = screenTrack;
      screenTrack.addEventListener("ended", () => {
        void stopScreenShare();
      });
      replaceVideoTrackForPeers(screenTrack);
      setIsScreenSharing(true);
      const currentParticipant = localParticipantRef.current;
      const nextParticipant = currentParticipant
        ? {
            ...currentParticipant,
            isCameraOn: true,
            isScreenSharing: true,
            stream: new MediaStream([
              ...getEnabledChronosAudioTracks(localStreamRef.current),
              screenTrack,
            ]),
          }
        : null;

      localParticipantRef.current = nextParticipant;
      setLocalParticipant(nextParticipant);
      sendScreenShareSignal("screen-share-start");

      if (isRecordingRef.current) {
        await restartRecordingForMediaChange(
          "Gravacao reiniciada para capturar a tela compartilhada.",
        );
      }
    } catch {
      setMediaError("Nao foi possivel compartilhar a tela.");
    }
  }

  async function stopScreenShare() {
    if (stoppingScreenShareRef.current) {
      return;
    }

    stoppingScreenShareRef.current = true;
    const shouldRestartRecording = isRecordingRef.current;

    try {
      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
      setIsScreenSharing(false);
      sendScreenShareSignal("screen-share-stop");

      if (!cameraEnabled) {
        replaceVideoTrackForPeers(null);
        const currentParticipant = localParticipantRef.current;
        const nextParticipant = currentParticipant
          ? {
              ...currentParticipant,
              isScreenSharing: false,
              stream: localStreamRef.current,
            }
          : null;

        localParticipantRef.current = nextParticipant;
        setLocalParticipant(nextParticipant);

        if (shouldRestartRecording) {
          await restartRecordingForMediaChange(
            "Gravacao reiniciada apos encerrar o compartilhamento de tela.",
          );
        }

        return;
      }

      try {
        const videoTrack = await requestChronosVideoTrack(videoInputId);
        const currentStream = localStreamRef.current ?? new MediaStream();
        const preparedMedia = await createChronosPreparedLocalMedia({
          backgroundDataUrl: guestBackgroundDataUrl,
          backgroundMode: guestBackgroundMode,
          sourceStream: new MediaStream([
            ...currentStream.getAudioTracks(),
            videoTrack,
          ]),
        });
        const nextStream = preparedMedia.stream;

        virtualBackgroundCleanupRef.current?.();
        virtualBackgroundCleanupRef.current = preparedMedia.cleanup;
        localStreamRef.current = nextStream;
        replaceVideoTrackForPeers(nextStream.getVideoTracks()[0] ?? null);
        setLocalStream(new MediaStream(nextStream.getTracks()));
        setMediaError(
          hasChronosVirtualBackgroundRequest({
            backgroundDataUrl: guestBackgroundDataUrl,
            mode: guestBackgroundMode,
          }) && !preparedMedia.isVirtualBackgroundActive
            ? "Nao foi possivel aplicar o fundo virtual; usando a camera original."
            : null,
        );
        const currentParticipant = localParticipantRef.current;
        const nextParticipant = currentParticipant
          ? {
              ...currentParticipant,
              isScreenSharing: false,
              stream: nextStream,
            }
          : null;

        localParticipantRef.current = nextParticipant;
        setLocalParticipant(nextParticipant);

        if (shouldRestartRecording) {
          await restartRecordingForMediaChange(
            "Gravacao reiniciada apos encerrar o compartilhamento de tela.",
          );
        }
      } catch {
        replaceVideoTrackForPeers(null);
        setMediaError("Nao foi possivel restaurar a camera.");

        if (shouldRestartRecording) {
          await restartRecordingForMediaChange(
            "Gravacao reiniciada apos encerrar o compartilhamento de tela.",
          );
        }
      }
    } finally {
      stoppingScreenShareRef.current = false;
    }
  }

  function sendScreenShareSignal(kind: "screen-share-start" | "screen-share-stop") {
    const participant = localParticipantRef.current;

    if (!participant || !meetingId) {
      return;
    }

    sendSignal({
      fromParticipantId: participant.id,
      kind,
      meetingId,
      participant: stripParticipantStream({
        ...participant,
        isScreenSharing: kind === "screen-share-start",
      }),
      roomSlug: room.slug,
    });
  }

  function sendParticipantStateSignal(
    participant: ChronosRoomParticipant,
    toParticipantId?: string,
  ) {
    if (!meetingId) {
      return;
    }

    sendSignal({
      fromParticipantId: participant.id,
      kind: "media-state",
      meetingId,
      participant: stripParticipantStream(participant),
      roomSlug: room.slug,
      toParticipantId,
    });
  }

  function sendRecordingStateSignal(
    status: "available" | "recording",
    toParticipantId?: string,
  ) {
    const participant = localParticipantRef.current;
    const currentMeetingId = meetingIdRef.current;

    if (!participant || !currentMeetingId) {
      return;
    }

    sendSignal({
      fromParticipantId: participant.id,
      kind: "recording-state",
      meetingId: currentMeetingId,
      participant: stripParticipantStream(participant),
      recordingStatus: status,
      roomSlug: room.slug,
      toParticipantId,
    });
  }

  async function handleToggleRecording() {
    if (isRecording) {
      await stopRecording();
      return;
    }

    await startRecording();
  }

  async function restartRecordingForMediaChange(message: string) {
    if (!isRecordingRef.current) {
      return;
    }

    if (recordingMediaRestartPromiseRef.current) {
      await recordingMediaRestartPromiseRef.current;
      return;
    }

    const restartPromise = (async () => {
      setMediaError(message);
      await stopRecording();
      await startRecording();
    })().finally(() => {
      recordingMediaRestartPromiseRef.current = null;
    });

    recordingMediaRestartPromiseRef.current = restartPromise;
    await restartPromise;
  }

  async function startRecording() {
    if (!meetingId || !localParticipant) {
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      setMediaError("Gravacao indisponivel neste navegador.");
      return;
    }

    const recordingMedia = buildChronosRecordingMedia({
      getParticipantVideos: getChronosRecordingParticipantVideos,
      localStream: localStreamRef.current,
      remoteParticipants: remoteParticipantsRef.current,
      screenTrack: screenTrackRef.current,
    });
    const stream = recordingMedia?.stream ?? null;

    if (!stream || stream.getTracks().length === 0) {
      setMediaError("Nenhuma midia disponivel para gravar.");
      return;
    }

    recordingChunksRef.current = [];
    setRecordingStorageStatus("idle");
    const mimeType = getSupportedChronosRecordingMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recordingCleanupRef.current = recordingMedia?.cleanup ?? null;
    recordingStreamRef.current = stream;
    recorderRef.current = recorder;
    recordingStopPromiseRef.current = new Promise((resolve) => {
      resolveRecordingStopRef.current = resolve;
    });
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        recordingChunksRef.current.push(event.data);
      }
    });
    recorder.addEventListener("stop", () => {
      const durationSeconds = Math.max(
        0,
        Math.floor((Date.now() - recordingStartedAtRef.current) / 1000),
      );

      void (async () => {
        try {
          if (recordingChunksRef.current.length > 0) {
            const recordingBlob = new Blob(recordingChunksRef.current, {
              type: recorder.mimeType || "video/webm",
            });

            if (recordingBlob.size > 0) {
              if (lastRecordingUrlRef.current) {
                URL.revokeObjectURL(lastRecordingUrlRef.current);
              }

              const recordingUrl = URL.createObjectURL(recordingBlob);

              lastRecordingUrlRef.current = recordingUrl;
              setLastRecordingUrl(recordingUrl);
              const recordingName = `${room.slug}-${new Date()
                .toISOString()
                .replace(/[:.]/g, "-")}.webm`;

              setLastRecordingName(recordingName);
              await uploadChronosRecordingBlob({
                blob: recordingBlob,
                durationSeconds,
                fileName: recordingName,
              });
            } else {
              await postChronosRecordingStatus("failed");
            }
          } else {
            await postChronosRecordingStatus("failed");
          }
        } finally {
          recordingChunksRef.current = [];
          resolveRecordingStopRef.current?.();
          resolveRecordingStopRef.current = null;
          recordingStopPromiseRef.current = null;
        }
      })();
    });
    recorder.start(1000);
    recordingStartedAtRef.current = Date.now();
    setRecordingSeconds(0);
    setIsRecording(true);
    await postChronosRecordingStatus("recording");
    startAthenaTranscription();
    sendRecordingStateSignal("recording");
  }

  async function stopRecording() {
    const recorder = recorderRef.current;
    const stopPromise = recordingStopPromiseRef.current;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }

    recorderRef.current = null;
    recordingStreamRef.current = null;
    stopAthenaTranscription();
    setIsRecording(false);
    sendRecordingStateSignal("available");
    try {
      await stopPromise;
    } finally {
      recordingCleanupRef.current?.();
      recordingCleanupRef.current = null;
    }
  }

  async function uploadChronosRecordingBlob({
    blob,
    durationSeconds,
    fileName,
  }: {
    blob: Blob;
    durationSeconds: number;
    fileName: string;
  }) {
    if (!meetingId || !localParticipant) {
      await postChronosRecordingStatus("failed");
      return;
    }

    setRecordingStorageStatus("uploading");

    try {
      const client = getHubSupabaseClient();
      const recordingFile = new File([blob], fileName, {
        type: blob.type || "video/webm",
      });

      if (!client) {
        throw new Error("Chronos storage client unavailable");
      }

      const uploadTargetResponse = await fetch(
        `/api/chronos/public/rooms/${room.slug}/recording/upload-url`,
        {
          body: JSON.stringify({
            durationSeconds,
            fileName,
            meetingId,
            mimeType: recordingFile.type || "video/webm",
            participantId: localParticipant.id,
            sizeBytes: recordingFile.size,
          }),
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      const uploadTarget = (await uploadTargetResponse
        .json()
        .catch(() => null)) as Partial<ChronosRecordingUploadTarget> | null;

      if (
        !uploadTargetResponse.ok ||
        !uploadTarget?.bucket ||
        !uploadTarget.path ||
        !uploadTarget.token
      ) {
        throw new Error("Chronos recording upload target failed");
      }

      const uploadResult = await client.storage
        .from(uploadTarget.bucket)
        .uploadToSignedUrl(uploadTarget.path, uploadTarget.token, recordingFile, {
          contentType: recordingFile.type || "video/webm",
        });

      if (uploadResult.error) {
        throw uploadResult.error;
      }

      const completeResponse = await fetch(
        `/api/chronos/public/rooms/${room.slug}/recording/upload-complete`,
        {
          body: JSON.stringify({
            durationSeconds,
            fileName,
            meetingId,
            mimeType: recordingFile.type || "video/webm",
            participantId: localParticipant.id,
            sizeBytes: recordingFile.size,
            startedAt: new Date(recordingStartedAtRef.current).toISOString(),
            storageBucket: uploadTarget.bucket,
            storagePath: uploadTarget.path,
          }),
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );

      if (!completeResponse.ok) {
        throw new Error("Chronos recording upload completion failed");
      }

      setRecordingStorageStatus("saved");
    } catch {
      setRecordingStorageStatus("failed");
      await postChronosRecordingStatus("failed");
    }
  }

  async function postChronosRecordingStatus(
    status: "available" | "failed" | "recording",
  ) {
    if (!meetingId || !localParticipant) {
      return;
    }

    await fetch(`/api/chronos/public/rooms/${room.slug}/recording`, {
      body: JSON.stringify({
        durationSeconds:
          status === "available" || status === "failed"
            ? Math.max(
                0,
                Math.floor((Date.now() - recordingStartedAtRef.current) / 1000),
              )
            : undefined,
        meetingId,
        participantId: localParticipant.id,
        status,
      }),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }).catch(() => undefined);
  }

  function startAthenaTranscription() {
    if (athenaTranscriptionActiveRef.current) {
      return;
    }

    const SpeechRecognition = getSpeechRecognitionConstructor();

    if (!SpeechRecognition || !localParticipant) {
      setMediaError(
        "Athena registrou gravacao. Transcricao local depende do navegador.",
      );
      athenaTranscriptionActiveRef.current = false;
      return;
    }

    const recognition = new SpeechRecognition();
    athenaTranscriptionActiveRef.current = true;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "pt-BR";
    recognition.onresult = (event) => {
      const content = collectFinalSpeechTranscript(event);

      if (content) {
        void sendTranscriptSegment(content);
      }
    };
    recognition.onerror = () => undefined;
    recognition.onend = () => {
      if (athenaTranscriptionActiveRef.current) {
        try {
          recognition.start();
        } catch {
          // SpeechRecognition throws when restarted too quickly.
        }
      }
    };
    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      athenaTranscriptionActiveRef.current = false;
      recognitionRef.current = null;
    }
  }

  function stopAthenaTranscription() {
    athenaTranscriptionActiveRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore browser-specific SpeechRecognition shutdown errors.
      }
    }
    recognitionRef.current = null;
  }

  async function sendTranscriptSegment(content: string) {
    if (!meetingId || !localParticipant) {
      return;
    }

    const normalizedContent = normalizeChronosSpeechSegment(content);

    if (!normalizedContent) {
      return;
    }

    const previousSegment = lastTranscriptSegmentRef.current;
    const now = Date.now();

    if (
      previousSegment &&
      previousSegment.content === normalizedContent &&
      now - previousSegment.sentAt < 12_000
    ) {
      return;
    }

    lastTranscriptSegmentRef.current = {
      content: normalizedContent,
      sentAt: now,
    };

    const segment = {
      content: normalizedContent,
      id: `local-transcript-${Date.now().toString(36)}`,
      speakerLabel: localParticipant.displayName,
    } satisfies ChronosTranscriptPreview;

    setTranscriptPreview((currentSegments) =>
      appendUniqueChronosTranscriptPreview(currentSegments, segment),
    );
    sendSignal({
      fromParticipantId: localParticipant.id,
      kind: "transcript-segment",
      meetingId,
      roomSlug: room.slug,
      transcript: segment,
    });

    await fetch(`/api/chronos/public/rooms/${room.slug}/transcript`, {
      body: JSON.stringify({
        content: normalizedContent,
        meetingId,
        participantId: localParticipant.id,
        speakerLabel: localParticipant.displayName,
        startedAt: new Date().toISOString(),
      }),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }).catch(() => undefined);
  }

  async function handleSubmitChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = chatDraft.trim();

    if (!content || !meetingId || !localParticipant) {
      return;
    }

    const message = {
      content,
      createdAt: new Date().toISOString(),
      id: `local-chat-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      participantId: localParticipant.id,
      senderName: localParticipant.displayName,
    } satisfies ChronosChatMessage;

    setChatDraft("");
    setChatMessages((currentMessages) =>
      appendUniqueChronosChatMessage(currentMessages, message),
    );
    sendSignal({
      fromParticipantId: localParticipant.id,
      kind: "chat-message",
      meetingId,
      message,
      roomSlug: room.slug,
    });

    await fetch(`/api/chronos/public/rooms/${room.slug}/chat`, {
      body: JSON.stringify({
        clientMessageId: message.id,
        content,
        meetingId,
        participantId: localParticipant.id,
        senderName: localParticipant.displayName,
      }),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }).catch(() => undefined);
  }

  async function handleBackgroundUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (isScreenSharing) {
      setMediaError("Altere o fundo virtual apos encerrar o compartilhamento.");
      event.target.value = "";
      return;
    }

    if (!file.type.startsWith("image/") || file.size > 5_000_000) {
      setMediaError("Use PNG, JPG ou WebP de ate 5 MB.");
      event.target.value = "";
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    setGuestBackgroundDataUrl(dataUrl);
    setGuestBackgroundMode("image");
    setMediaError(null);
    event.target.value = "";
  }

  async function handleTogglePictureInPicture() {
    const documentWithPip = document as PictureInPictureDocument;

    if (documentWithPip.pictureInPictureElement) {
      await documentWithPip.exitPictureInPicture?.();
      setPictureInPictureParticipantId(null);
      return;
    }

    const target = getPictureInPictureTarget();

    if (!target) {
      setMediaError("Ative a camera ou aguarde um video para picture-in-picture.");
      return;
    }

    await target.video.requestPictureInPicture?.();
    setPictureInPictureParticipantId(target.participantId);
  }

  function getPictureInPictureTarget() {
    const remoteTarget = Object.keys(remoteParticipants).find((participantId) =>
      videoElementsByParticipantIdRef.current.has(participantId),
    );
    const localTarget =
      localParticipant?.id &&
      videoElementsByParticipantIdRef.current.has(localParticipant.id)
        ? localParticipant.id
        : null;
    const participantId = remoteTarget ?? localTarget;
    const video = participantId
      ? (videoElementsByParticipantIdRef.current.get(
          participantId,
        ) as PictureInPictureVideoElement | undefined)
      : undefined;

    return participantId && video ? { participantId, video } : null;
  }

  function handleVideoElementChange(
    participantId: string,
    videoElement: HTMLVideoElement | null,
  ) {
    if (videoElement) {
      videoElementsByParticipantIdRef.current.set(participantId, videoElement);
      return;
    }

    videoElementsByParticipantIdRef.current.delete(participantId);
  }

  function getChronosRecordingParticipantVideos() {
    const localParticipantId = localParticipantRef.current?.id;
    const participants = remoteParticipantsRef.current;

    return Array.from(videoElementsByParticipantIdRef.current.entries())
      .filter(([participantId]) => participantId !== localParticipantId)
      .map(([participantId, video]) => ({
        id: participantId,
        label: participants[participantId]?.displayName ?? "Participante",
        video,
      }));
  }

  async function handleLeaveRoom(
    options: ChronosLeaveRoomOptions = {},
  ) {
    const shouldCloseMeeting = Boolean(options.closeMeeting && localParticipant?.isHost);
    const shouldNotifyPeers = options.notifyPeers !== false;

    if (isRecording) {
      await stopRecording();
    }

    if (shouldCloseMeeting && localParticipant && meetingId) {
      await closeChronosReservationCall();
      sendSignal({
        fromParticipantId: localParticipant.id,
        kind: "meeting-closed",
        meetingId,
        participant: stripParticipantStream(localParticipant),
        roomSlug: room.slug,
      });
    } else if (shouldNotifyPeers && localParticipant && meetingId) {
      sendSignal({
        fromParticipantId: localParticipant.id,
        kind: "leave",
        meetingId,
        participant: stripParticipantStream(localParticipant),
        roomSlug: room.slug,
      });
    }

    closeAllPeerConnections();
    stopCurrentLocalMedia();
    setLocalStream(null);
    setLocalParticipant(null);
    setMeetingId("");
    setRemoteParticipants({});
    setChatMessages([]);
    setChatDraft("");
    setIsChatOpen(false);
    setTranscriptPreview([]);
    setIsTranscriptOpen(false);
  }

  handleLeaveRoomRef.current = handleLeaveRoom;
  sendRecordingStateSignalRef.current = sendRecordingStateSignal;
  startAthenaTranscriptionRef.current = startAthenaTranscription;
  stopAthenaTranscriptionRef.current = stopAthenaTranscription;

  async function closeChronosReservationCall() {
    if (!localParticipant || !meetingId) {
      return;
    }

    await fetch(`/api/chronos/public/rooms/${room.slug}/close`, {
      body: JSON.stringify({
        meetingId,
        participantId: localParticipant.id,
      }),
      cache: "no-store",
      headers: {
        ...(authState.session?.accessToken
          ? {
              Authorization: `Bearer ${authState.session.accessToken}`,
            }
          : {}),
        "Content-Type": "application/json",
      },
      method: "POST",
    }).catch(() => undefined);
  }

  const tileParticipants = useMemo(() => {
    const participants = localParticipant
      ? [localParticipant, ...Object.values(remoteParticipants)]
      : [];

    return participants.map((participant) => ({
      participant: mapChronosParticipantToHermesTile(participant),
      source: participant,
    }));
  }, [localParticipant, remoteParticipants]);
  const screenShareParticipant = tileParticipants.find(
    ({ source }) => source.isScreenSharing,
  );
  const companionParticipants = screenShareParticipant
    ? tileParticipants.filter(
        ({ source }) => source.id !== screenShareParticipant.source.id,
      )
    : tileParticipants;
  const participantGridClassName = getChronosParticipantGridClassName(
    tileParticipants.length,
  );
  const localParticipantFallbackBackground =
    guestBackgroundMode === "image" ? guestBackgroundDataUrl : "";

  return (
    <main
      className="min-h-dvh overflow-hidden bg-[#111820] text-white"
      style={{
        backgroundImage: pageBackgroundImage
          ? `linear-gradient(rgba(9,14,18,0.34), rgba(9,14,18,0.44)), url(${pageBackgroundImage})`
          : "linear-gradient(135deg, #182431, #101820 54%, #211d14)",
        backgroundPosition: "center",
        backgroundSize: "cover",
      }}
    >
      <div className="relative min-h-dvh bg-black/10">
        <header
          className={
            hasJoined
              ? "pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-4 py-3"
              : "flex items-center justify-between px-5 py-4"
          }
        >
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-black/90 text-[#A07C3B] shadow-xl ring-1 ring-white/10">
              <LockKeyhole aria-hidden="true" size={18} />
            </span>
            <div className="rounded-lg bg-black/25 px-2 py-1 backdrop-blur-sm">
              <h1 className="m-0 text-sm font-semibold">{room.name}</h1>
              <p className="m-0 mt-1 text-xs text-white/55">{room.externalPath}</p>
            </div>
          </div>
          <Badge variant={realtimeStatus === "ready" ? "success" : "neutral"}>
            {realtimeStatus === "ready" ? "sala sincronizada" : "sala externa"}
          </Badge>
        </header>

        {!hasJoined ? (
          <section className="grid min-h-[calc(100dvh-5rem)] place-items-center px-4 pb-10">
            <div className="w-full max-w-[25rem] overflow-hidden rounded-xl border border-white/15 bg-white text-[#101820] shadow-2xl">
              <div
                className="relative aspect-video bg-[#101820] bg-center"
                style={{
                  backgroundImage:
                    guestBackgroundMode === "image" && guestBackgroundDataUrl
                    ? `linear-gradient(rgba(16,24,32,0.15), rgba(16,24,32,0.15)), url(${guestBackgroundDataUrl})`
                    : undefined,
                  backgroundRepeat: "no-repeat",
                  backgroundSize: "contain",
                }}
              >
                {localStream?.getVideoTracks().length && cameraEnabled ? (
                  <video
                    autoPlay
                    className="absolute inset-0 h-full w-full object-contain"
                    muted
                    playsInline
                    ref={previewVideoRef}
                  />
                ) : (
                  <div className="grid h-full place-items-center text-center text-white">
                    <span className="grid h-16 w-16 place-items-center rounded-full bg-white/10 text-lg font-semibold">
                      {getInitials(participantLabel || "Chronos")}
                    </span>
                  </div>
                )}
                <div className="absolute inset-x-3 bottom-3 flex items-center justify-between">
                  <div className="inline-flex items-center gap-1 rounded-full bg-black/70 p-1 text-white shadow-lg ring-1 ring-white/10 backdrop-blur-sm">
                    <button
                      aria-label="Sem efeito"
                      aria-pressed={guestBackgroundMode === "none"}
                      className="grid h-8 w-8 place-items-center rounded-full text-white/75 transition hover:bg-white/10 hover:text-white aria-pressed:bg-white aria-pressed:text-[#101820] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                      onClick={() => {
                        setGuestBackgroundMode("none");
                        setMediaError(null);
                      }}
                      title="Sem efeito"
                      type="button"
                    >
                      <Ban aria-hidden="true" size={15} />
                    </button>
                    <button
                      aria-label="Desfoque baixo"
                      aria-pressed={guestBackgroundMode === "blur-low"}
                      className="grid h-8 w-8 place-items-center rounded-full text-white/75 transition hover:bg-white/10 hover:text-white aria-pressed:bg-white aria-pressed:text-[#101820] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                      onClick={() => {
                        setGuestBackgroundMode("blur-low");
                        setMediaError(null);
                      }}
                      title="Desfoque baixo"
                      type="button"
                    >
                      <Droplet aria-hidden="true" size={15} />
                    </button>
                    <button
                      aria-label="Desfoque alto"
                      aria-pressed={guestBackgroundMode === "blur-high"}
                      className="grid h-8 w-8 place-items-center rounded-full text-white/75 transition hover:bg-white/10 hover:text-white aria-pressed:bg-white aria-pressed:text-[#101820] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                      onClick={() => {
                        setGuestBackgroundMode("blur-high");
                        setMediaError(null);
                      }}
                      title="Desfoque alto"
                      type="button"
                    >
                      <Droplets aria-hidden="true" size={15} />
                    </button>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-black/70 px-2 py-1 text-xs font-semibold text-white transition hover:bg-black">
                    <ImagePlus aria-hidden="true" size={13} />
                    Meu fundo
                    <input
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={(event) => void handleBackgroundUpload(event)}
                      type="file"
                    />
                  </label>
                </div>
              </div>

              <div className="grid gap-3 p-4">
                <label className="grid gap-1 text-xs font-bold uppercase text-[#667085]">
                  Nome
                  <input
                    className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm normal-case text-[#101820] outline-none focus:border-[#A07C3B]"
                    disabled={isHubParticipant}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Seu nome"
                    value={participantLabel}
                  />
                </label>
                <label className="grid gap-1 text-xs font-bold uppercase text-[#667085]">
                  Empresa
                  <div className="relative">
                    <Building2
                      aria-hidden="true"
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-[#98a2b3]"
                      size={15}
                    />
                    <input
                      className="h-10 w-full rounded-md border border-[#d9e0e7] bg-white pl-9 pr-3 text-sm normal-case text-[#101820] outline-none focus:border-[#A07C3B]"
                      disabled={isHubParticipant}
                      onChange={(event) => setOrganization(event.target.value)}
                      placeholder="Empresa ou organizacao"
                      value={participantOrganization}
                    />
                  </div>
                </label>
                <select
                  className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
                  onChange={(event) => {
                    setVideoInputId(event.target.value);
                    void startLocalMedia();
                  }}
                  value={videoInputId}
                >
                  <option value={defaultDeviceValue}>Camera padrao</option>
                  {videoInputs.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </option>
                  ))}
                </select>
                <select
                  className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
                  onChange={(event) => {
                    setAudioInputId(event.target.value);
                    void startLocalMedia();
                  }}
                  value={audioInputId}
                >
                  <option value={defaultDeviceValue}>Microfone padrao</option>
                  {audioInputs.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </option>
                  ))}
                </select>
                {profileStatus === "loading" ? (
                  <p className="m-0 text-xs font-semibold text-[#667085]">
                    Verificando login do colaborador...
                  </p>
                ) : null}
                {mediaError || joinError ? (
                  <p className="m-0 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-800">
                    {joinError ?? mediaError}
                  </p>
                ) : null}
              </div>
              <div className="border-t border-[#edf0f4] p-4">
                <button
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-[#A07C3B] bg-[#A07C3B] px-4 text-sm font-semibold text-white transition hover:bg-[#8f6f35] disabled:cursor-not-allowed disabled:opacity-55"
                  disabled={joining || !participantLabel}
                  onClick={() => void handleJoinRoom()}
                  type="button"
                >
                  {joining ? <Loader2 aria-hidden="true" className="animate-spin" size={16} /> : null}
                  Participar
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="relative grid min-h-dvh grid-rows-[minmax(0,1fr)_auto] px-3 pb-3 pt-16 sm:px-4 sm:pb-4">
            <div className="pointer-events-none absolute inset-x-3 top-4 z-20 flex flex-wrap items-center justify-end gap-2 sm:inset-x-4">
              <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
                <Badge variant={isRecording ? "danger" : "neutral"}>
                  {isRecording
                    ? `gravando ${formatChronosDuration(recordingSeconds)}`
                    : "gravacao pronta"}
                </Badge>
                {recordingStorageStatus === "uploading" ? (
                  <Badge variant="warning">salvando no drive</Badge>
                ) : null}
                {recordingStorageStatus === "saved" ? (
                  <Badge variant="success">drive atualizado</Badge>
                ) : null}
                {recordingStorageStatus === "failed" ? (
                  <Badge variant="danger">drive pendente</Badge>
                ) : null}
                <Badge variant="info">
                  <UsersRound aria-hidden="true" size={13} />{" "}
                  {tileParticipants.length} participantes
                </Badge>
                {lastRecordingUrl ? (
                  <span className="inline-flex overflow-hidden rounded-full border border-white/15 bg-[#101820]/75 text-xs font-semibold text-white shadow-xl">
                    <a
                      className="px-3 py-1.5 transition hover:bg-[#101820] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                      href={lastRecordingUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Assistir gravacao
                    </a>
                    <a
                      className="border-l border-white/15 px-3 py-1.5 transition hover:bg-[#101820] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                      download={lastRecordingName}
                      href={lastRecordingUrl}
                    >
                      Baixar
                    </a>
                  </span>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 overflow-hidden pt-12">
              {screenShareParticipant ? (
                <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)]">
                  <div className="h-full min-h-0 rounded-[1.25rem] border border-white/25 bg-[#111820]/30 p-1.5 shadow-[0_24px_80px_rgba(0,0,0,0.34)] ring-1 ring-black/20 backdrop-blur-[2px] [&_video]:object-contain">
                    <div
                      className="h-full min-h-0 rounded-[1rem]"
                      style={getChronosParticipantWindowStyle({
                        backgroundDataUrl: localParticipantFallbackBackground,
                        isLocal:
                          screenShareParticipant.source.id ===
                          localParticipant?.id,
                      })}
                    >
                      <CallParticipantTile
                        isLocalMedia={
                          screenShareParticipant.source.id ===
                          localParticipant?.id
                        }
                        layout="spotlight"
                        mediaStream={screenShareParticipant.source.stream}
                        onVideoElementChange={handleVideoElementChange}
                        participant={screenShareParticipant.participant}
                      />
                    </div>
                  </div>
                  <aside className="min-h-0 overflow-x-auto rounded-[1.25rem] border border-white/20 bg-[#111820]/42 p-1.5 shadow-2xl ring-1 ring-black/25 backdrop-blur-sm lg:h-full lg:overflow-y-auto lg:overflow-x-hidden">
                    <div className="flex min-h-full gap-3 lg:grid lg:content-start lg:gap-3">
                      {companionParticipants.map(({ participant, source }) => (
                        <div
                          className="w-56 shrink-0 rounded-2xl border border-white/25 bg-[#111820]/50 p-1.5 ring-1 ring-black/30 [&_video]:object-contain lg:w-full"
                          key={source.id}
                          style={getChronosParticipantWindowStyle({
                            backgroundDataUrl: localParticipantFallbackBackground,
                            isLocal: source.id === localParticipant?.id,
                          })}
                        >
                          <CallParticipantTile
                            isLocalMedia={source.id === localParticipant?.id}
                            layout="floating"
                            mediaStream={source.stream}
                            onVideoElementChange={handleVideoElementChange}
                            participant={participant}
                          />
                        </div>
                      ))}
                      {companionParticipants.length === 0 ? (
                        <div className="grid min-h-32 place-items-center rounded-2xl border border-dashed border-white/15 px-3 text-center text-xs font-semibold text-white/45">
                          Sem outras janelas
                        </div>
                      ) : null}
                    </div>
                  </aside>
                </div>
              ) : (
                <div className={participantGridClassName}>
                  {tileParticipants.map(({ participant, source }) => (
                    <div
                      className="min-h-0 rounded-[1.25rem] border border-white/25 bg-[#111820]/34 p-1.5 shadow-[0_24px_80px_rgba(0,0,0,0.32)] ring-1 ring-black/20 backdrop-blur-[2px] [&_video]:object-contain"
                      key={source.id}
                      style={getChronosParticipantWindowStyle({
                        backgroundDataUrl: localParticipantFallbackBackground,
                        isLocal: source.id === localParticipant?.id,
                        participantCount: tileParticipants.length,
                      })}
                    >
                      <CallParticipantTile
                        isLocalMedia={source.id === localParticipant?.id}
                        layout="spotlight"
                        mediaStream={source.stream}
                        onVideoElementChange={handleVideoElementChange}
                        participant={participant}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {isChatOpen ? (
              <aside className="absolute bottom-20 right-4 top-16 z-30 flex w-[min(22rem,calc(100vw-2rem))] flex-col rounded-xl border border-white/20 bg-[#101820]/92 p-3 text-white shadow-2xl ring-1 ring-black/35 backdrop-blur-md">
                <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-black/80 text-[#A07C3B]">
                      <MessageSquare aria-hidden="true" size={15} />
                    </span>
                    <strong className="text-sm">Chat</strong>
                  </div>
                  <button
                    aria-label="Fechar chat"
                    className="grid h-8 w-8 place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                    onClick={() => setIsChatOpen(false)}
                    type="button"
                  >
                    <X aria-hidden="true" size={15} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  {chatMessages.length > 0 ? (
                    <div className="grid gap-2">
                      {chatMessages.map((message) => (
                        <div
                          className="rounded-lg border border-white/10 bg-white/[0.06] p-2"
                          key={message.id}
                        >
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <strong className="truncate text-xs text-white">
                              {message.senderName}
                            </strong>
                            <span className="shrink-0 text-[0.68rem] font-semibold text-white/45">
                              {formatTime(message.createdAt)}
                            </span>
                          </div>
                          <p className="m-0 whitespace-pre-wrap text-xs leading-relaxed text-white/78">
                            {message.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid h-full place-items-center rounded-lg border border-dashed border-white/15 text-center text-xs font-semibold text-white/45">
                      Nenhuma mensagem registrada.
                    </div>
                  )}
                </div>
                <form className="mt-3 flex gap-2" onSubmit={handleSubmitChat}>
                  <input
                    className="h-10 min-w-0 flex-1 rounded-lg border border-white/15 bg-black/35 px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#A07C3B]"
                    maxLength={1800}
                    onChange={(event) => setChatDraft(event.target.value)}
                    placeholder="Mensagem"
                    value={chatDraft}
                  />
                  <button
                    aria-label="Enviar mensagem"
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#A07C3B] text-white transition hover:bg-[#8f6f35] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    disabled={!chatDraft.trim()}
                    type="submit"
                  >
                    <Send aria-hidden="true" size={16} />
                  </button>
                </form>
              </aside>
            ) : null}

            {isTranscriptOpen ? (
              <aside
                className={`absolute bottom-20 top-16 z-30 flex w-[min(22rem,calc(100vw-2rem))] flex-col rounded-xl border border-white/20 bg-[#101820]/92 p-3 text-white shadow-2xl ring-1 ring-black/35 backdrop-blur-md ${
                  isChatOpen ? "right-[23.25rem] max-xl:right-4" : "right-4"
                }`}
              >
                <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-black/80 text-[#A07C3B]">
                      <FileText aria-hidden="true" size={15} />
                    </span>
                    <strong className="text-sm">Transcricao ao vivo</strong>
                  </div>
                  <button
                    aria-label="Ocultar transcricao ao vivo"
                    className="grid h-8 w-8 place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                    onClick={() => setIsTranscriptOpen(false)}
                    type="button"
                  >
                    <X aria-hidden="true" size={15} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  {transcriptPreview.length > 0 ? (
                    <div className="grid gap-2">
                      {transcriptPreview.map((segment) => (
                        <div
                          className="rounded-lg border border-white/10 bg-white/[0.06] p-2"
                          key={segment.id}
                        >
                          <strong className="block truncate text-xs uppercase text-white/65">
                            {segment.speakerLabel}
                          </strong>
                          <p className="m-0 mt-1 whitespace-pre-wrap text-xs leading-relaxed text-white/82">
                            {segment.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid h-full place-items-center rounded-lg border border-dashed border-white/15 p-4 text-center text-xs font-semibold text-white/45">
                      A transcricao aparece aqui quando a gravacao iniciar e o
                      navegador liberar captura de fala.
                    </div>
                  )}
                </div>
              </aside>
            ) : null}

            <div className="mt-3 flex w-full flex-wrap justify-center gap-2">
              <div className="inline-flex items-center gap-1 rounded-full bg-[#101820]/85 p-1 text-white shadow-xl ring-1 ring-white/10">
                <button
                  aria-label="Sem fundo virtual"
                  aria-pressed={guestBackgroundMode === "none"}
                  className="grid h-9 w-9 place-items-center rounded-full text-white/75 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-45 aria-pressed:bg-white aria-pressed:text-[#101820] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                  disabled={isScreenSharing}
                  onClick={() => {
                    setGuestBackgroundMode("none");
                    setMediaError(null);
                  }}
                  title="Sem fundo virtual"
                  type="button"
                >
                  <Ban aria-hidden="true" size={16} />
                </button>
                <button
                  aria-label="Desfoque baixo"
                  aria-pressed={guestBackgroundMode === "blur-low"}
                  className="grid h-9 w-9 place-items-center rounded-full text-white/75 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-45 aria-pressed:bg-white aria-pressed:text-[#101820] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                  disabled={isScreenSharing}
                  onClick={() => {
                    setGuestBackgroundMode("blur-low");
                    setMediaError(null);
                  }}
                  title="Desfoque baixo"
                  type="button"
                >
                  <Droplet aria-hidden="true" size={16} />
                </button>
                <button
                  aria-label="Desfoque alto"
                  aria-pressed={guestBackgroundMode === "blur-high"}
                  className="grid h-9 w-9 place-items-center rounded-full text-white/75 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-45 aria-pressed:bg-white aria-pressed:text-[#101820] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                  disabled={isScreenSharing}
                  onClick={() => {
                    setGuestBackgroundMode("blur-high");
                    setMediaError(null);
                  }}
                  title="Desfoque alto"
                  type="button"
                >
                  <Droplets aria-hidden="true" size={16} />
                </button>
                <label className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-white/75 transition hover:bg-white/10 hover:text-white focus-within:ring-2 focus-within:ring-[#A07C3B]">
                  <ImagePlus aria-hidden="true" size={16} />
                  <input
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    disabled={isScreenSharing}
                    onChange={(event) => void handleBackgroundUpload(event)}
                    title="Fundo virtual"
                    type="file"
                  />
                </label>
              </div>
              <button
                aria-pressed={isRecording}
                className="grid h-10 w-10 place-items-center rounded-full bg-[#101820]/85 text-white shadow-xl ring-1 ring-white/10 transition hover:bg-[#101820] aria-pressed:bg-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={() => void handleToggleRecording()}
                type="button"
              >
                {isRecording ? <Square size={17} /> : <Radio size={18} />}
              </button>
              <button
                aria-label="Abrir chat"
                aria-pressed={isChatOpen}
                className="relative grid h-10 w-10 place-items-center rounded-full bg-[#101820]/85 text-white shadow-xl ring-1 ring-white/10 transition hover:bg-[#101820] aria-pressed:bg-white aria-pressed:text-[#101820] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={() => setIsChatOpen((current) => !current)}
                type="button"
              >
                <MessageSquare aria-hidden="true" size={18} />
                {chatMessages.length > 0 ? (
                  <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#A07C3B] px-1 text-[0.62rem] font-bold text-white">
                    {Math.min(chatMessages.length, 9)}
                  </span>
                ) : null}
              </button>
              <button
                aria-label="Abrir transcricao ao vivo"
                aria-pressed={isTranscriptOpen}
                className="relative grid h-10 w-10 place-items-center rounded-full bg-[#101820]/85 text-white shadow-xl ring-1 ring-white/10 transition hover:bg-[#101820] aria-pressed:bg-white aria-pressed:text-[#101820] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={() => setIsTranscriptOpen((current) => !current)}
                type="button"
              >
                <FileText aria-hidden="true" size={18} />
                {transcriptPreview.length > 0 ? (
                  <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#A07C3B] px-1 text-[0.62rem] font-bold text-white">
                    {Math.min(transcriptPreview.length, 9)}
                  </span>
                ) : null}
              </button>
              <CallControls
                audioDevices={audioInputs}
                cameraEnabled={cameraEnabled}
                isAudioOnly={false}
                isMuted={isMuted}
                isPictureInPictureActive={Boolean(pictureInPictureParticipantId)}
                isPictureInPictureAvailable={isPictureInPictureAvailable}
                isScreenSharing={isScreenSharing}
                onEnd={() =>
                  void handleLeaveRoom({
                    closeMeeting: Boolean(localParticipant?.isHost),
                  })
                }
                onSelectAudioDevice={setAudioInputId}
                onSelectVideoDevice={setVideoInputId}
                onToggleCamera={() => void handleToggleCamera()}
                onToggleMicrophone={handleToggleMicrophone}
                onTogglePictureInPicture={() => void handleTogglePictureInPicture()}
                onToggleScreenShare={() => void handleToggleScreenShare()}
                selectedAudioDeviceId={audioInputId}
                selectedVideoDeviceId={videoInputId}
                videoDevices={videoInputs}
              />
            </div>
          </section>
        )}
      </div>
    </main>
  );

  function closePeerConnection(participantId: string) {
    const peerConnection = peerConnectionsRef.current.get(participantId);

    peerConnection?.close();
    peerConnectionsRef.current.delete(participantId);
  }

  function closeAllPeerConnections() {
    peerConnectionsRef.current.forEach((peerConnection) => {
      peerConnection.close();
    });
    peerConnectionsRef.current.clear();
  }
}

function createDeviceOptions(
  devices: MediaDeviceInfo[],
  kind: MediaDeviceKind,
  fallbackLabel: string,
) {
  return devices
    .filter((device) => device.kind === kind)
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `${fallbackLabel} ${index + 1}`,
    }));
}

async function requestChronosRoomMedia({
  audioInputId,
  cameraEnabled,
  videoInputId,
}: {
  audioInputId: string;
  cameraEnabled: boolean;
  videoInputId: string;
}) {
  const audioTrack = await requestChronosAudioTrack(audioInputId);

  if (!cameraEnabled) {
    return new MediaStream([audioTrack]);
  }

  try {
    const videoTrack = await requestChronosVideoTrack(videoInputId);
    return new MediaStream([audioTrack, videoTrack]);
  } catch {
    return new MediaStream([audioTrack]);
  }
}

async function requestChronosAudioTrack(audioInputId: string) {
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

async function requestChronosVideoTrack(videoInputId: string) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: createVideoDeviceConstraint(videoInputId),
  });
  const videoTrack = stream.getVideoTracks()[0];

  if (!videoTrack) {
    throw new Error("Missing video track");
  }

  return videoTrack;
}

async function createChronosPreparedLocalMedia({
  backgroundDataUrl,
  backgroundMode,
  sourceStream,
}: {
  backgroundDataUrl: string;
  backgroundMode: ChronosVirtualBackgroundMode;
  sourceStream: MediaStream;
}): Promise<ChronosPreparedLocalMedia> {
  const [sourceVideoTrack] = sourceStream.getVideoTracks();

  if (
    !hasChronosVirtualBackgroundRequest({
      backgroundDataUrl,
      mode: backgroundMode,
    }) ||
    !sourceVideoTrack ||
    typeof document === "undefined"
  ) {
    return {
      cleanup: () => undefined,
      isVirtualBackgroundActive: false,
      stream: sourceStream,
    };
  }

  try {
    const [backgroundImage, segmenter] = await Promise.all([
      backgroundMode === "image"
        ? loadChronosBackgroundImage(backgroundDataUrl)
        : Promise.resolve(null),
      getChronosImageSegmenter(),
    ]);
    const sourceVideo = document.createElement("video");
    const sourceVideoStream = new MediaStream([sourceVideoTrack]);

    sourceVideo.autoplay = true;
    sourceVideo.muted = true;
    sourceVideo.playsInline = true;
    sourceVideo.srcObject = sourceVideoStream;
    await sourceVideo.play();
    await waitForChronosVideoFrame(sourceVideo);

    const initialWidth = sourceVideo.videoWidth || 1280;
    const initialHeight = sourceVideo.videoHeight || 720;
    const outputCanvas = document.createElement("canvas");
    const sourceCanvas = document.createElement("canvas");
    const outputContext = outputCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    const sourceContext = sourceCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    if (!outputContext || !sourceContext) {
      throw new Error("Canvas indisponivel para fundo virtual.");
    }

    outputCanvas.width = initialWidth;
    outputCanvas.height = initialHeight;
    sourceCanvas.width = initialWidth;
    sourceCanvas.height = initialHeight;

    const outputStream = outputCanvas.captureStream(chronosVirtualBackgroundFps);
    const [outputVideoTrack] = outputStream.getVideoTracks();

    sourceStream.getAudioTracks().forEach((track) => {
      outputStream.addTrack(track);
    });

    let animationFrameId = 0;
    let lastFrameAt = 0;
    let stopped = false;
    const personCategoryIndex = getChronosPersonCategoryIndex(segmenter);

    const renderFrame = (timestamp: number) => {
      if (stopped) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(renderFrame);

      if (
        sourceVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        timestamp - lastFrameAt < 1000 / chronosVirtualBackgroundFps
      ) {
        return;
      }

      lastFrameAt = timestamp;

      const width = sourceVideo.videoWidth || initialWidth;
      const height = sourceVideo.videoHeight || initialHeight;

      if (outputCanvas.width !== width || outputCanvas.height !== height) {
        outputCanvas.width = width;
        outputCanvas.height = height;
        sourceCanvas.width = width;
        sourceCanvas.height = height;
      }

      drawChronosVirtualBackgroundBase({
        backgroundImage,
        context: outputContext,
        mode: backgroundMode,
        sourceVideo,
        width,
        height,
      });
      sourceContext.drawImage(sourceVideo, 0, 0, width, height);

      let result: ReturnType<ImageSegmenter["segmentForVideo"]> | null = null;

      try {
        result = segmenter.segmentForVideo(sourceVideo, timestamp);

        if (!result.categoryMask) {
          outputContext.drawImage(sourceVideo, 0, 0, width, height);
          return;
        }

        const sourceFrame = sourceContext.getImageData(0, 0, width, height);
        const outputFrame = outputContext.getImageData(0, 0, width, height);

        applyChronosPersonMask({
          mask: result.categoryMask,
          outputFrame,
          personCategoryIndex,
          sourceFrame,
          targetHeight: height,
          targetWidth: width,
        });
        outputContext.putImageData(outputFrame, 0, 0);
      } catch {
        outputContext.drawImage(sourceVideo, 0, 0, width, height);
      } finally {
        result?.close();
      }
    };

    animationFrameId = window.requestAnimationFrame(renderFrame);

    return {
      cleanup: () => {
        stopped = true;
        window.cancelAnimationFrame(animationFrameId);
        sourceVideo.pause();
        sourceVideo.srcObject = null;
        outputVideoTrack?.stop();
        sourceVideoTrack.stop();
      },
      isVirtualBackgroundActive: true,
      stream: outputStream,
    };
  } catch {
    return {
      cleanup: () => undefined,
      isVirtualBackgroundActive: false,
      stream: sourceStream,
    };
  }
}

async function getChronosImageSegmenter() {
  if (!chronosImageSegmenterPromise) {
    chronosImageSegmenterPromise = import("@mediapipe/tasks-vision")
      .then(async ({ FilesetResolver, ImageSegmenter: MediaPipeImageSegmenter }) => {
        const visionFileset = await FilesetResolver.forVisionTasks(
          chronosVirtualBackgroundWasmUrl,
        );

        return MediaPipeImageSegmenter.createFromOptions(visionFileset, {
          baseOptions: {
            delegate: "GPU",
            modelAssetPath: chronosVirtualBackgroundModelUrl,
          },
          outputCategoryMask: true,
          outputConfidenceMasks: false,
          runningMode: "VIDEO",
        });
      })
      .catch((error) => {
        chronosImageSegmenterPromise = null;
        throw error;
      });
  }

  return chronosImageSegmenterPromise;
}

function loadChronosBackgroundImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener(
      "error",
      () => reject(new Error("Nao foi possivel carregar o fundo virtual.")),
      { once: true },
    );
    image.src = dataUrl;
  });
}

function waitForChronosVideoFrame(video: HTMLVideoElement) {
  return new Promise<void>((resolve) => {
    const startedAt = performance.now();

    const checkFrame = () => {
      if (
        (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.videoWidth > 0 &&
          video.videoHeight > 0) ||
        performance.now() - startedAt > 1500
      ) {
        resolve();
        return;
      }

      window.requestAnimationFrame(checkFrame);
    };

    checkFrame();
  });
}

function getChronosPersonCategoryIndex(segmenter: ImageSegmenter) {
  const labels = segmenter.getLabels();
  const personIndex = labels.findIndex((label) =>
    /foreground|person|selfie/i.test(label),
  );

  return personIndex >= 0 ? personIndex : 1;
}

function hasChronosVirtualBackgroundRequest({
  backgroundDataUrl,
  mode,
}: {
  backgroundDataUrl: string;
  mode: ChronosVirtualBackgroundMode;
}) {
  return (
    mode === "blur-low" ||
    mode === "blur-high" ||
    (mode === "image" && Boolean(backgroundDataUrl))
  );
}

function drawChronosVirtualBackgroundBase({
  backgroundImage,
  context,
  mode,
  sourceVideo,
  width,
  height,
}: {
  backgroundImage: HTMLImageElement | null;
  context: CanvasRenderingContext2D;
  mode: ChronosVirtualBackgroundMode;
  sourceVideo: HTMLVideoElement;
  width: number;
  height: number;
}) {
  if (mode === "image" && backgroundImage) {
    drawChronosImageCover(context, backgroundImage, width, height);
    return;
  }

  const blurPixels = mode === "blur-high" ? 22 : 9;
  const padding = blurPixels * 2;

  context.save();
  context.filter = `blur(${blurPixels}px)`;
  context.drawImage(
    sourceVideo,
    -padding,
    -padding,
    width + padding * 2,
    height + padding * 2,
  );
  context.restore();
}

function drawChronosImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  const coverScale = Math.max(
    width / image.naturalWidth,
    height / image.naturalHeight,
  );
  const coverWidth = image.naturalWidth * coverScale;
  const coverHeight = image.naturalHeight * coverScale;
  const coverX = (width - coverWidth) / 2;
  const coverY = (height - coverHeight) / 2;
  const fitScale = Math.min(
    width / image.naturalWidth,
    height / image.naturalHeight,
  );
  const drawWidth = image.naturalWidth * fitScale;
  const drawHeight = image.naturalHeight * fitScale;
  const drawX = (width - drawWidth) / 2;
  const drawY = (height - drawHeight) / 2;

  context.save();
  context.filter = "blur(18px)";
  context.drawImage(image, coverX, coverY, coverWidth, coverHeight);
  context.restore();
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

function applyChronosPersonMask({
  mask,
  outputFrame,
  personCategoryIndex,
  sourceFrame,
  targetHeight,
  targetWidth,
}: {
  mask: {
    getAsUint8Array: () => Uint8Array;
    height: number;
    width: number;
  };
  outputFrame: ImageData;
  personCategoryIndex: number;
  sourceFrame: ImageData;
  targetHeight: number;
  targetWidth: number;
}) {
  const maskData = mask.getAsUint8Array();
  const outputData = outputFrame.data;
  const sourceData = sourceFrame.data;
  const hasSameSize =
    mask.width === targetWidth && mask.height === targetHeight;
  const edgePaddingRadius = Math.max(
    1,
    Math.round(Math.min(mask.width, mask.height) / 240),
  );

  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const targetIndex = y * targetWidth + x;
      const maskX = hasSameSize
        ? x
        : Math.floor((x / targetWidth) * mask.width);
      const maskY = hasSameSize
        ? y
        : Math.floor((y / targetHeight) * mask.height);

      if (isChronosPersonMaskPixel({
        maskData,
        maskHeight: mask.height,
        maskWidth: mask.width,
        personCategoryIndex,
        radius: edgePaddingRadius,
        x: maskX,
        y: maskY,
      })) {
        const dataIndex = targetIndex * 4;

        outputData[dataIndex] = sourceData[dataIndex] ?? 0;
        outputData[dataIndex + 1] = sourceData[dataIndex + 1] ?? 0;
        outputData[dataIndex + 2] = sourceData[dataIndex + 2] ?? 0;
        outputData[dataIndex + 3] = 255;
      }
    }
  }
}

function isChronosPersonMaskPixel({
  maskData,
  maskHeight,
  maskWidth,
  personCategoryIndex,
  radius,
  x,
  y,
}: {
  maskData: Uint8Array;
  maskHeight: number;
  maskWidth: number;
  personCategoryIndex: number;
  radius: number;
  x: number;
  y: number;
}) {
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    const currentY = Math.min(maskHeight - 1, Math.max(0, y + offsetY));

    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const currentX = Math.min(maskWidth - 1, Math.max(0, x + offsetX));
      const maskValue = maskData[currentY * maskWidth + currentX] ?? 0;

      if (
        maskValue === personCategoryIndex ||
        (personCategoryIndex > 0 && maskValue > 127)
      ) {
        return true;
      }
    }
  }

  return false;
}

function createDeviceConstraint(deviceId: string) {
  return deviceId && deviceId !== defaultDeviceValue
    ? {
        deviceId: {
          exact: deviceId,
        },
      }
    : true;
}

function createVideoDeviceConstraint(deviceId: string): MediaTrackConstraints {
  const baseConstraint = {
    aspectRatio: {
      ideal: 16 / 9,
    },
    frameRate: {
      ideal: 30,
      max: 30,
    },
    height: {
      ideal: 720,
    },
    width: {
      ideal: 1280,
    },
  } satisfies MediaTrackConstraints;

  return deviceId && deviceId !== defaultDeviceValue
    ? {
        ...baseConstraint,
        deviceId: {
          exact: deviceId,
        },
      }
    : baseConstraint;
}

function stripParticipantStream(participant: ChronosRoomParticipant) {
  return {
    displayName: participant.displayName,
    id: participant.id,
    isCameraOn: participant.isCameraOn,
    isMuted: participant.isMuted,
    isScreenSharing: participant.isScreenSharing,
    organization: participant.organization,
  };
}

function mapChronosParticipantToHermesTile(
  participant: ChronosRoomParticipant,
): HermesCallParticipant {
  return {
    id: participant.id,
    initials: getInitials(participant.displayName),
    isCameraOn: participant.isCameraOn,
    isMuted: participant.isMuted,
    isScreenSharing: participant.isScreenSharing,
    label: participant.displayName,
    presenceStatus: "online",
    role: participant.organization || "Convidado",
    status: "joined",
    userId: participant.id,
  };
}

function getChronosParticipantGridClassName(participantCount: number) {
  if (participantCount <= 1) {
    return "grid h-full min-h-0 place-items-center gap-4";
  }

  if (participantCount === 2) {
    return "grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-2";
  }

  if (participantCount <= 4) {
    return "grid h-full min-h-0 grid-cols-1 gap-4 md:grid-cols-2";
  }

  return "grid h-full min-h-0 grid-cols-1 gap-4 overflow-auto md:grid-cols-2 xl:grid-cols-3";
}

function getChronosParticipantWindowStyle({
  backgroundDataUrl,
  isLocal,
  participantCount,
}: {
  backgroundDataUrl: string;
  isLocal: boolean;
  participantCount?: number;
}) {
  const singleParticipantStyle =
    participantCount === 1
      ? {
          aspectRatio: "16 / 9",
          maxHeight: "100%",
          width: "min(100%, calc((100dvh - 8.5rem) * 16 / 9))",
        }
      : undefined;

  if (!isLocal || !backgroundDataUrl) {
    return singleParticipantStyle;
  }

  return {
    backgroundImage: `linear-gradient(rgba(16,24,32,0.12), rgba(16,24,32,0.2)), url(${backgroundDataUrl})`,
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundSize: "contain",
    ...singleParticipantStyle,
  };
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function getSpeechRecognitionConstructor() {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

function collectFinalSpeechTranscript(event: SpeechRecognitionEventLike) {
  const parts: string[] = [];

  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    const alternative = result?.[0];
    const transcript = alternative?.transcript?.trim();
    const confidence =
      typeof alternative?.confidence === "number"
        ? alternative.confidence
        : null;

    if (
      result?.isFinal &&
      transcript &&
      (confidence === null || confidence >= 0.58)
    ) {
      parts.push(transcript);
    }
  }

  return normalizeChronosSpeechSegment(parts.join(" "));
}

function normalizeChronosSpeechSegment(value: string) {
  const text = value
    .replace(/\s+/g, " ")
    .replace(/\b(uh|hum|aham|hã|é{2,}|né{2,})\b/gi, "")
    .trim();

  if (text.length < 4) {
    return "";
  }

  const words = text.split(/\s+/);
  const uniqueWords = new Set(words.map((word) => word.toLowerCase()));

  if (words.length >= 6 && uniqueWords.size <= 2) {
    return "";
  }

  return text.slice(0, 1_200);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    });
    reader.addEventListener("error", () => {
      reject(new Error("Nao foi possivel ler o fundo."));
    });
    reader.readAsDataURL(file);
  });
}

function appendUniqueChronosChatMessage(
  currentMessages: ChronosChatMessage[],
  nextMessage?: ChronosChatMessage,
) {
  if (!nextMessage) {
    return currentMessages;
  }

  const messagesById = new Map(
    currentMessages.map((message) => [message.id, message]),
  );

  messagesById.set(nextMessage.id, nextMessage);

  return Array.from(messagesById.values()).sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

function appendUniqueChronosTranscriptPreview(
  currentSegments: ChronosTranscriptPreview[],
  nextSegment?: ChronosTranscriptPreview,
) {
  if (!nextSegment) {
    return currentSegments;
  }

  return [
    nextSegment,
    ...currentSegments.filter((segment) => segment.id !== nextSegment.id),
  ].slice(0, 8);
}

function readChronosBackgroundPreference(key: string): {
  dataUrl: string;
  mode: ChronosVirtualBackgroundMode;
} | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storedValue = window.localStorage.getItem(key);

    if (!storedValue) {
      return null;
    }

    const parsedValue = JSON.parse(storedValue) as {
      dataUrl?: unknown;
      mode?: unknown;
    };
    const mode =
      parsedValue.mode === "blur-high" ||
      parsedValue.mode === "blur-low" ||
      parsedValue.mode === "image" ||
      parsedValue.mode === "none"
        ? parsedValue.mode
        : "none";
    const dataUrl =
      typeof parsedValue.dataUrl === "string" ? parsedValue.dataUrl : "";

    return {
      dataUrl: mode === "image" ? dataUrl : "",
      mode,
    };
  } catch {
    return null;
  }
}

function writeChronosBackgroundPreference(
  key: string,
  preference: {
    dataUrl: string;
    mode: ChronosVirtualBackgroundMode;
  },
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(preference));
  } catch {
    // Persistencia local de preferencia e best-effort para nao bloquear a chamada.
  }
}

function formatTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
