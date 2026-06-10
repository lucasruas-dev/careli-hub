"use client";

import { CallParticipantTile } from "@/components/pulsex/call-participant-tile";
import type {
  ChronosChatMessage,
  ChronosPublicJoinResult,
  ChronosPublicRoom,
} from "@/lib/chronos/types";
import {
  formatChronosDuration,
  getEnabledChronosAudioTracks,
  stopChronosMediaStream,
} from "@/lib/chronos/recording";
import type { HermesCallParticipant } from "@/lib/pulsex";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";
import { Badge } from "@repo/uix";
import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import brightModernWorkspaceBackground from "./assets/backgrounds/bright-modern-workspace.png";
import careliMainBackground from "./assets/backgrounds/careli-main.jpeg";
import contemporaryCorporateBackground from "./assets/backgrounds/contemporary-corporate.png";
import corporateSkylineBackground from "./assets/backgrounds/corporate-skyline.png";
import darkExecutiveSuiteBackground from "./assets/backgrounds/dark-executive-suite.png";
import elegantNeutralBackground from "./assets/backgrounds/elegant-neutral.png";
import executiveLibraryBackground from "./assets/backgrounds/executive-library.png";
import executiveSkylinePrimaryBackground from "./assets/backgrounds/executive-skyline-primary.png";
import modernMinimalistOfficeBackground from "./assets/backgrounds/modern-minimalist-office.png";
import chronosCareliMark from "./assets/chronos-careli-mark.png";
import {
  DataPacket_Kind,
  Room,
  RoomEvent,
  RemoteParticipant,
  ScreenSharePresets,
  Track,
  VideoPresets,
  type AudioProcessorOptions,
  type LocalTrackPublication,
  type Participant as LiveKitParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackPublishOptions,
  type TrackProcessor,
  type TrackPublication,
} from "livekit-client";
import {
  Ban,
  Building2,
  Captions,
  Droplet,
  Droplets,
  FileText,
  ImagePlus,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  PhoneOff,
  PictureInPicture2,
  Radio,
  ScreenShare,
  ScreenShareOff,
  Send,
  SlidersHorizontal,
  Sparkles,
  Square,
  UsersRound,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type RefObject,
  type ReactNode,
  type SetStateAction,
} from "react";

type ChronosExternalRoomPageProps = {
  isLiveKitProviderEnabled: boolean;
  room: ChronosPublicRoom;
};

type ChronosRoomParticipant = {
  cameraStream?: MediaStream | null;
  displayName: string;
  id: string;
  isCameraOn: boolean;
  isHost?: boolean;
  isMuted: boolean;
  isScreenSharing: boolean;
  organization?: string;
  screenStream?: MediaStream | null;
  stream?: MediaStream | null;
};

type ChronosEntryRequest = {
  displayName: string;
  id: string;
  organization?: string;
  requestedAt: string;
};

type ChronosLobbySignal =
  | {
      kind: "entry-request";
      request: ChronosEntryRequest;
      roomSlug: string;
    }
  | {
      approved: boolean;
      kind: "entry-decision";
      requestId: string;
      roomSlug: string;
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
  participant?: Omit<
    ChronosRoomParticipant,
    "cameraStream" | "screenStream" | "stream"
  >;
  recordingStartedAt?: string;
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

type ChronosBackgroundEffectInput = {
  dataUrl?: string;
  mode: ChronosVirtualBackgroundMode;
};

type ChronosLiveKitBackgroundSwitchOptions =
  | { mode: "background-blur"; blurRadius?: number }
  | { imagePath: string; mode: "virtual-background" }
  | { mode: "disabled" };

type ChronosLiveKitBackgroundProcessorOptions =
  ChronosLiveKitBackgroundSwitchOptions & {
    maxFps?: number;
  };

type ChronosLiveKitBackgroundProcessor = TrackProcessor<Track.Kind.Video> & {
  destroy?: (options?: { willProcessorRestart: boolean }) => Promise<void>;
  switchTo?: (options: ChronosLiveKitBackgroundSwitchOptions) => Promise<void>;
};

type ChronosLiveKitNoiseProcessor = TrackProcessor<
  Track.Kind.Audio,
  AudioProcessorOptions
> & {
  destroy?: () => Promise<void>;
  isEnabled?: () => boolean;
  setEnabled?: (enabled: boolean) => Promise<boolean | undefined>;
};

type ChronosLiveKitProcessorApplier = (
  publication?: LocalTrackPublication,
) => Promise<void>;

type ChronosPreparedLocalMedia = {
  cleanup: () => void;
  isVirtualBackgroundActive: boolean;
  stream: MediaStream;
};

type ChronosLiveKitJoinResult = ChronosPublicJoinResult & {
  livekit?: {
    provider: "livekit";
    roomName: string;
    token: string;
    url: string;
  };
};

type ChronosLiveKitParticipantAudioEgress = {
  egressId: string;
  organization?: string;
  participantId?: string;
  participantIdentity?: string;
  participantName?: string;
  recordingId?: string;
  storagePath?: string;
  trackId?: string;
  trackMimeType?: string;
  trackName?: string;
};

type ChronosLiveKitParticipantMetadata = {
  displayName?: string;
  isHost?: boolean;
  meetingId?: string;
  organization?: string;
  participantId?: string;
  roomSlug?: string;
};

type HubSupabaseClient = NonNullable<ReturnType<typeof getHubSupabaseClient>>;
type HubRealtimeChannel = ReturnType<HubSupabaseClient["channel"]>;

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
const chronosLobbyEvent = "chronos-room-lobby";
const chronosLiveKitChatTopic = "chronos.chat";
const chronosLiveKitCameraSimulcastLayers = [
  VideoPresets.h180,
  VideoPresets.h360,
];
let chronosLiveKitNoiseProcessorPromise: Promise<ChronosLiveKitNoiseProcessor | null> | null =
  null;
const peerConnectionConfig = {
  iceCandidatePoolSize: 4,
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
} satisfies RTCConfiguration;
const chronosVirtualBackgroundFps = 24;
const chronosVirtualBackgroundPreviewFps = 10;
const chronosVirtualBackgroundPreviewMaxWidth = 640;
const chronosVirtualBackgroundModelUrl =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite";
const chronosVirtualBackgroundWasmUrl =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const chronosLiveKitBackgroundBlurRadius = {
  high: 22,
  low: 9,
} as const;
const chronosLiveKitBackgroundProcessorMaxFps = 24;

async function getChronosLiveKitNoiseProcessor() {
  if (!chronosLiveKitNoiseProcessorPromise) {
    chronosLiveKitNoiseProcessorPromise = import(
      "@livekit/krisp-noise-filter"
    )
      .then(({ KrispNoiseFilter, isKrispNoiseFilterSupported }) => {
        if (!isKrispNoiseFilterSupported()) {
          return null;
        }

        return KrispNoiseFilter() as ChronosLiveKitNoiseProcessor;
      })
      .catch(() => null);
  }

  return chronosLiveKitNoiseProcessorPromise;
}

const chronosBackgroundPresetDefinitions = [
  {
    id: "careli-main",
    image: careliMainBackground,
    label: "Careli",
  },
  {
    id: "executive-skyline-primary",
    image: executiveSkylinePrimaryBackground,
    label: "Executiva",
  },
  {
    id: "bright-modern-workspace",
    image: brightModernWorkspaceBackground,
    label: "Workspace",
  },
  {
    id: "contemporary-corporate",
    image: contemporaryCorporateBackground,
    label: "Corporate",
  },
  {
    id: "corporate-skyline",
    image: corporateSkylineBackground,
    label: "Skyline",
  },
  {
    id: "dark-executive-suite",
    image: darkExecutiveSuiteBackground,
    label: "Suite",
  },
  {
    id: "elegant-neutral",
    image: elegantNeutralBackground,
    label: "Neutral",
  },
  {
    id: "executive-library",
    image: executiveLibraryBackground,
    label: "Library",
  },
  {
    id: "modern-minimalist-office",
    image: modernMinimalistOfficeBackground,
    label: "Minimal",
  },
] as const;
let chronosImageSegmenterPromise: Promise<ImageSegmenter> | null = null;

export function ChronosExternalRoomPage({
  isLiveKitProviderEnabled,
  room,
}: ChronosExternalRoomPageProps) {
  const { authState, hubUser, profileStatus } = useAuth();
  const isChronosLiveKitProvider = isLiveKitProviderEnabled;
  const isHubParticipant = Boolean(hubUser);
  const [displayName, setDisplayName] = useState(hubUser?.name ?? "");
  const [organization, setOrganization] = useState("");
  const [guestBackgroundDataUrl, setGuestBackgroundDataUrl] = useState("");
  const [guestBackgroundMode, setGuestBackgroundMode] =
    useState<ChronosVirtualBackgroundMode>("none");
  const [preJoinPanel, setPreJoinPanel] = useState<
    "background" | "settings" | null
  >(null);
  const [audioInputId, setAudioInputId] = useState(defaultDeviceValue);
  const [videoInputId, setVideoInputId] = useState(defaultDeviceValue);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceOption[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceOption[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [isHdVideoPreferred, setIsHdVideoPreferred] = useState(true);
  const [isWidescreenPreferred, setIsWidescreenPreferred] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [noiseReductionEnabled, setNoiseReductionEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [lastRecordingName, setLastRecordingName] = useState("");
  const [lastRecordingUrl, setLastRecordingUrl] = useState("");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingStorageError, setRecordingStorageError] = useState("");
  const [recordingStorageStatus, setRecordingStorageStatus] = useState<
    "failed" | "idle" | "recording" | "saved" | "starting" | "uploading"
  >("idle");
  const [meetingId, setMeetingId] = useState("");
  const [localParticipant, setLocalParticipant] =
    useState<ChronosRoomParticipant | null>(null);
  const [remoteParticipants, setRemoteParticipants] = useState<
    Record<string, ChronosRoomParticipant>
  >({});
  const [entryRequests, setEntryRequests] = useState<ChronosEntryRequest[]>([]);
  const [entryRequestStatus, setEntryRequestStatus] = useState<
    "approved" | "declined" | "idle" | "waiting"
  >("idle");
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
  const lobbyChannelRef = useRef<HubRealtimeChannel | null>(null);
  const entryRequestApprovedRef = useRef(false);
  const entryRequestIdRef = useRef("");
  const approvedEntryJoinRef = useRef<() => void>(() => undefined);
  const liveKitLocalPublicationsRef = useRef<
    Map<Track.Source, LocalTrackPublication>
  >(new Map());
  const liveKitPublishedTracksRef = useRef<Map<Track.Source, MediaStreamTrack>>(
    new Map(),
  );
  const liveKitRawCameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const liveKitRemoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const liveKitRoomRef = useRef<Room | null>(null);
  const liveKitBackgroundProcessorRef =
    useRef<ChronosLiveKitBackgroundProcessor | null>(null);
  const liveKitBackgroundApplyQueueRef = useRef<Promise<void>>(Promise.resolve());
  const liveKitBackgroundApplyGenerationRef = useRef(0);
  const guestBackgroundDataUrlRef = useRef("");
  const guestBackgroundModeRef =
    useRef<ChronosVirtualBackgroundMode>("none");
  const liveKitNoiseProcessorRef =
    useRef<ChronosLiveKitNoiseProcessor | null>(null);
  const applyChronosLiveKitBackgroundProcessorRef =
    useRef<ChronosLiveKitProcessorApplier | null>(null);
  const applyChronosLiveKitNoiseProcessorRef =
    useRef<ChronosLiveKitProcessorApplier | null>(null);
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
  const settingsPreviewVideoRef = useRef<HTMLVideoElement>(null);
  const recordingStartedAtRef = useRef(0);
  const liveKitEgressIdRef = useRef("");
  const liveKitEgressRecordingIdRef = useRef("");
  const liveKitAudioEgressIdRef = useRef("");
  const liveKitAudioEgressRecordingIdRef = useRef("");
  const liveKitParticipantAudioEgressesRef = useRef<
    ChronosLiveKitParticipantAudioEgress[]
  >([]);
  const lastRecordingUrlRef = useRef("");
  const isRecordingRef = useRef(false);
  const remoteParticipantsRef = useRef<Record<string, ChronosRoomParticipant>>(
    {},
  );
  const sendRecordingStateSignalRef = useRef<
    (status: "available" | "recording", toParticipantId?: string) => void
  >(() => undefined);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
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
    const previousTitle = document.title;

    document.title = "Careli";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    const preference = readChronosBackgroundPreference(backgroundPreferenceKey);

    if (preference) {
      guestBackgroundDataUrlRef.current = preference.dataUrl;
      guestBackgroundModeRef.current = preference.mode;
      setGuestBackgroundDataUrl(preference.dataUrl);
      setGuestBackgroundMode(preference.mode);
    }

    setBackgroundPreferenceLoaded(true);
  }, [backgroundPreferenceKey]);

  useEffect(() => {
    guestBackgroundDataUrlRef.current = guestBackgroundDataUrl;
    guestBackgroundModeRef.current = guestBackgroundMode;
  }, [guestBackgroundDataUrl, guestBackgroundMode]);

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
    const videoElements = [
      previewVideoRef.current,
      settingsPreviewVideoRef.current,
    ].filter((videoElement): videoElement is HTMLVideoElement =>
      Boolean(videoElement),
    );

    if (!videoElements.length) {
      return;
    }

    let cancelled = false;
    let cleanupPreviewStream: (() => void) | null = null;

    const setPreviewStream = (stream: MediaStream | null) => {
      videoElements.forEach((videoElement) => {
        videoElement.srcObject = stream;

        if (stream) {
          void videoElement.play().catch(() => undefined);
        }
      });
    };

    const syncPreviewStream = async () => {
      if (
        !isChronosLiveKitProvider ||
        !localStream ||
        !hasChronosVirtualBackgroundRequest({
          backgroundDataUrl: guestBackgroundDataUrl,
          mode: guestBackgroundMode,
        })
      ) {
        setPreviewStream(localStream);
        return;
      }

      const [sourceVideoTrack] = localStream.getVideoTracks();

      if (!sourceVideoTrack) {
        setPreviewStream(localStream);
        return;
      }

      const previewSourceTrack = sourceVideoTrack.clone();
      const previewSourceStream = new MediaStream([previewSourceTrack]);
      const preparedPreview = await createChronosPreparedLocalMedia({
        backgroundDataUrl: guestBackgroundDataUrl,
        backgroundMode: guestBackgroundMode,
        maxOutputWidth: chronosVirtualBackgroundPreviewMaxWidth,
        targetFps: chronosVirtualBackgroundPreviewFps,
        sourceStream: previewSourceStream,
      });

      cleanupPreviewStream = () => {
        preparedPreview.cleanup();
        previewSourceStream.getTracks().forEach((track) => {
          track.stop();
        });
      };

      if (cancelled) {
        cleanupPreviewStream();
        return;
      }

      setPreviewStream(preparedPreview.stream);
    };

    void syncPreviewStream();

    return () => {
      cancelled = true;
      cleanupPreviewStream?.();
      setPreviewStream(null);
    };
  }, [
    guestBackgroundDataUrl,
    guestBackgroundMode,
    isChronosLiveKitProvider,
    localStream,
    preJoinPanel,
  ]);

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

  const startLocalMedia = useCallback(async (
    overrides: Partial<{
      audioInputId: string;
      cameraEnabled: boolean;
      isHdVideoPreferred: boolean;
      isWidescreenPreferred: boolean;
      noiseReductionEnabled: boolean;
      videoInputId: string;
    }> = {},
  ) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError("Camera e microfone indisponiveis neste navegador.");
      return null;
    }

    try {
      const activeBackgroundDataUrl = guestBackgroundDataUrlRef.current;
      const activeBackgroundMode = guestBackgroundModeRef.current;
      const nextAudioInputId = overrides.audioInputId ?? audioInputId;
      const nextCameraEnabled = overrides.cameraEnabled ?? cameraEnabled;
      const nextHdVideoPreferred =
        overrides.isHdVideoPreferred ?? isHdVideoPreferred;
      const nextNoiseReductionEnabled =
        overrides.noiseReductionEnabled ?? noiseReductionEnabled;
      const nextVideoInputId = overrides.videoInputId ?? videoInputId;
      const nextWidescreenPreferred =
        overrides.isWidescreenPreferred ?? isWidescreenPreferred;
      const stream = await requestChronosRoomMedia({
        audioInputId: nextAudioInputId,
        cameraEnabled: nextCameraEnabled,
        isHdVideoPreferred: nextHdVideoPreferred,
        isWidescreenPreferred: nextWidescreenPreferred,
        noiseReductionEnabled: nextNoiseReductionEnabled,
        videoInputId: nextVideoInputId,
      });
      const shouldUseLocalBackgroundFallback = !isChronosLiveKitProvider;
      const preparedMedia = shouldUseLocalBackgroundFallback
        ? await createChronosPreparedLocalMedia({
            backgroundDataUrl: activeBackgroundDataUrl,
            backgroundMode: activeBackgroundMode,
            sourceStream: stream,
          })
        : {
            cleanup: () => undefined,
            isVirtualBackgroundActive: false,
            stream,
          };
      const nextStream = preparedMedia.stream;
      const hasAudioTrack = nextStream.getAudioTracks().length > 0;
      const hasVideoTrack = nextStream.getVideoTracks().length > 0;

      stopCurrentLocalMedia();
      virtualBackgroundCleanupRef.current = preparedMedia.cleanup;
      localStreamRef.current = nextStream;
      nextStream.getAudioTracks().forEach((track) => {
        track.enabled = !isMutedRef.current;
      });
      if (isChronosLiveKitProvider && liveKitRoomRef.current) {
        const liveKitRoom = liveKitRoomRef.current;
        const [nextAudioTrack] = nextStream.getAudioTracks();
        const [nextVideoTrack] = nextStream.getVideoTracks();
        const republishLiveKitTrack = async (
          track: MediaStreamTrack,
          source: Track.Source,
        ) => {
          const currentTrack = liveKitPublishedTracksRef.current.get(source);

          if (currentTrack?.id === track.id) {
            return;
          }

          if (currentTrack) {
            await liveKitRoom.localParticipant
              .unpublishTrack(currentTrack, false)
              .catch(() => undefined);
          }

          const publication = await liveKitRoom.localParticipant.publishTrack(
            track,
            getChronosLiveKitTrackPublishOptions(source),
          );

          liveKitPublishedTracksRef.current.set(source, track);
          liveKitLocalPublicationsRef.current.set(source, publication);
          if (source === Track.Source.Camera) {
            liveKitRawCameraTrackRef.current = track;
          }

          if (source === Track.Source.Microphone && isMutedRef.current) {
            await publication.mute().catch(() => undefined);
          }

          if (source === Track.Source.Microphone) {
            await applyChronosLiveKitNoiseProcessorRef.current?.(publication);
          }

          if (source === Track.Source.Camera) {
            await applyChronosLiveKitBackgroundProcessorRef.current?.(
              publication,
            );
          }
        };

        if (nextAudioTrack) {
          await republishLiveKitTrack(nextAudioTrack, Track.Source.Microphone);
        }

        if (nextVideoTrack) {
          await republishLiveKitTrack(nextVideoTrack, Track.Source.Camera);
        }
      }
      setLocalStream(nextStream);
      if (nextCameraEnabled && !hasVideoTrack) {
        setCameraEnabled(false);
      }
      if (localParticipantRef.current && meetingIdRef.current && !screenTrackRef.current) {
        const nextParticipant = {
          ...localParticipantRef.current,
          cameraStream: nextStream,
          isCameraOn: hasVideoTrack,
          screenStream: null,
          stream: nextStream,
        };

        replaceVideoTrackForPeers(nextStream.getVideoTracks()[0] ?? null);
        localParticipantRef.current = nextParticipant;
        setLocalParticipant(nextParticipant);
      }

      const backgroundFallbackMessage =
        shouldUseLocalBackgroundFallback &&
        hasChronosVirtualBackgroundRequest({
          backgroundDataUrl: activeBackgroundDataUrl,
          mode: activeBackgroundMode,
        }) &&
        stream.getVideoTracks().length > 0 &&
        !preparedMedia.isVirtualBackgroundActive
          ? "Nao foi possivel aplicar o fundo virtual; usando a camera original."
          : null;

      setMediaError(
        !hasAudioTrack
          ? "Microfone indisponivel; voce esta sem audio local."
          : nextCameraEnabled && !hasVideoTrack
            ? "Camera indisponivel; voce esta sem video local."
            : backgroundFallbackMessage,
      );
      await refreshDevices();

      return nextStream;
    } catch (error) {
      await refreshDevices().catch(() => undefined);
      setMediaError(normalizeChronosMediaError(error));
      return null;
    }
  }, [
    audioInputId,
    cameraEnabled,
    isHdVideoPreferred,
    isChronosLiveKitProvider,
    isWidescreenPreferred,
    noiseReductionEnabled,
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

  const sendLobbySignal = useCallback((signal: ChronosLobbySignal) => {
    const channel = lobbyChannelRef.current;

    if (!channel) {
      return false;
    }

    void channel.send({
      event: chronosLobbyEvent,
      payload: signal,
      type: "broadcast",
    });

    return true;
  }, []);

  const handleLobbySignal = useCallback(
    (payload: unknown) => {
      const signal = payload as Partial<ChronosLobbySignal>;

      if (signal.roomSlug !== room.slug) {
        return;
      }

      if (signal.kind === "entry-request" && signal.request) {
        const participant = localParticipantRef.current;

        if (!participant?.isHost) {
          return;
        }

        setEntryRequests((currentRequests) => {
          if (
            currentRequests.some(
              (currentRequest) => currentRequest.id === signal.request?.id,
            )
          ) {
            return currentRequests;
          }

          return [...currentRequests, signal.request as ChronosEntryRequest];
        });
        return;
      }

      if (
        signal.kind === "entry-decision" &&
        signal.requestId === entryRequestIdRef.current
      ) {
        if (signal.approved) {
          entryRequestApprovedRef.current = true;
          setEntryRequestStatus("approved");
          approvedEntryJoinRef.current();
          return;
        }

        entryRequestApprovedRef.current = false;
        entryRequestIdRef.current = "";
        setEntryRequestStatus("declined");
        setJoining(false);
        setJoinError("Entrada recusada pelo host.");
      }
    },
    [room.slug],
  );

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

  useEffect(() => {
    if (!isChronosLiveKitProvider) {
      return;
    }

    const client = getHubSupabaseClient();

    if (!client) {
      return;
    }

    const channel = client.channel(`chronos:lobby:${room.slug}`, {
      config: {
        broadcast: {
          ack: true,
          self: false,
        },
      },
    });

    lobbyChannelRef.current = channel;
    channel
      .on(
        "broadcast",
        {
          event: chronosLobbyEvent,
        },
        (message: { payload?: unknown }) => {
          handleLobbySignal(message.payload);
        },
      )
      .subscribe();

    return () => {
      if (lobbyChannelRef.current === channel) {
        lobbyChannelRef.current = null;
      }

      void client.removeChannel(channel);
    };
  }, [handleLobbySignal, isChronosLiveKitProvider, room.slug]);

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
        const nextIsRecording = signal.recordingStatus === "recording";

        if (nextIsRecording) {
          const startedAtMs = Date.parse(
            signal.recordingStartedAt || signal.sentAt || "",
          );

          recordingStartedAtRef.current = Number.isFinite(startedAtMs)
            ? startedAtMs
            : Date.now();
          setRecordingSeconds(
            Math.max(
              0,
              Math.floor((Date.now() - recordingStartedAtRef.current) / 1000),
            ),
          );
          setRecordingStorageError("");
          setRecordingStorageStatus("recording");
        } else {
          recordingStartedAtRef.current = 0;
          setRecordingSeconds(0);
          setRecordingStorageStatus("idle");
        }

        setIsRecording(nextIsRecording);
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

    if (isChronosLiveKitProvider) {
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
  }, [
    handleSignal,
    hasJoined,
    isChronosLiveKitProvider,
    localParticipant,
    meetingId,
    room.slug,
    sendSignal,
  ]);

  async function connectChronosLiveKitRoom({
    payload,
    participant,
    stream,
  }: {
    participant: ChronosRoomParticipant;
    payload: ChronosLiveKitJoinResult;
    stream: MediaStream | null;
  }) {
    const livekit = payload.livekit;

    if (!livekit?.token || !livekit.url) {
      throw new Error("Nao foi possivel preparar a sala de reuniao.");
    }

    disconnectChronosLiveKitRoom();
    setRealtimeStatus("syncing");

    const liveKitRoom = new Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: {
        screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
        simulcast: true,
        videoEncoding: VideoPresets.h720.encoding,
        videoSimulcastLayers: chronosLiveKitCameraSimulcastLayers,
      },
      videoCaptureDefaults: {
        resolution: VideoPresets.h720.resolution,
      },
    });

    liveKitRoomRef.current = liveKitRoom;

    const syncRemoteParticipant = (remoteParticipant: RemoteParticipant) => {
      const metadata = parseChronosLiveKitParticipantMetadata(
        remoteParticipant.metadata,
      );
      const participantMedia =
        buildChronosLiveKitRemoteParticipantMedia(remoteParticipant);

      if (participantMedia.stream) {
        liveKitRemoteStreamsRef.current.set(
          remoteParticipant.identity,
          participantMedia.stream,
        );
      } else {
        liveKitRemoteStreamsRef.current.delete(remoteParticipant.identity);
      }
      setRemoteParticipants((currentParticipants) => ({
        ...currentParticipants,
        [remoteParticipant.identity]: {
          cameraStream: participantMedia.cameraStream,
          displayName:
            remoteParticipant.name ||
            metadata.displayName ||
            "Participante Chronos",
          id: remoteParticipant.identity,
          isCameraOn: Boolean(
            participantMedia.cameraStream?.getVideoTracks().length,
          ),
          isHost: metadata.isHost,
          isMuted: !remoteParticipant.isMicrophoneEnabled,
          isScreenSharing: Boolean(
            participantMedia.screenStream?.getVideoTracks().length,
          ),
          organization: metadata.organization,
          screenStream: participantMedia.screenStream,
          stream: participantMedia.stream,
        },
      }));
    };

    const removeRemoteParticipant = (remoteParticipant: RemoteParticipant) => {
      liveKitRemoteStreamsRef.current.delete(remoteParticipant.identity);
      setRemoteParticipants((currentParticipants) => {
        const nextParticipants = { ...currentParticipants };

        delete nextParticipants[remoteParticipant.identity];

        return nextParticipants;
      });
    };

    liveKitRoom
      .on(RoomEvent.Connected, () => {
        setRealtimeStatus("ready");
      })
      .on(RoomEvent.Reconnecting, () => {
        setRealtimeStatus("syncing");
      })
      .on(RoomEvent.SignalReconnecting, () => {
        setRealtimeStatus("syncing");
      })
      .on(RoomEvent.Reconnected, () => {
        setRealtimeStatus("ready");
      })
      .on(RoomEvent.Disconnected, () => {
        setRealtimeStatus("offline");
      })
      .on(RoomEvent.ParticipantConnected, syncRemoteParticipant)
      .on(RoomEvent.ParticipantDisconnected, removeRemoteParticipant)
      .on(
        RoomEvent.TrackSubscribed,
        (
          _track: RemoteTrack,
          _publication: RemoteTrackPublication,
          remoteParticipant: RemoteParticipant,
        ) => {
          syncRemoteParticipant(remoteParticipant);
        },
      )
      .on(
        RoomEvent.TrackUnsubscribed,
        (
          _track: RemoteTrack,
          _publication: RemoteTrackPublication,
          remoteParticipant: RemoteParticipant,
        ) => {
          syncRemoteParticipant(remoteParticipant);
        },
      )
      .on(
        RoomEvent.TrackMuted,
        (_publication: TrackPublication, participant: LiveKitParticipant) => {
          if (participant instanceof RemoteParticipant) {
            syncRemoteParticipant(participant);
          }
        },
      )
      .on(
        RoomEvent.TrackUnmuted,
        (_publication: TrackPublication, participant: LiveKitParticipant) => {
          if (participant instanceof RemoteParticipant) {
            syncRemoteParticipant(participant);
          }
        },
      )
      .on(
        RoomEvent.ParticipantMetadataChanged,
        (_previousMetadata: string | undefined, participant: LiveKitParticipant) => {
          if (participant instanceof RemoteParticipant) {
            syncRemoteParticipant(participant);
          }
        },
      )
      .on(
        RoomEvent.ParticipantNameChanged,
        (_name: string, participant: LiveKitParticipant) => {
          if (participant instanceof RemoteParticipant) {
            syncRemoteParticipant(participant);
          }
        },
      )
      .on(
        RoomEvent.DataReceived,
        (
          data: Uint8Array,
          _participant: LiveKitParticipant | undefined,
          _kind?: DataPacket_Kind,
          topic?: string,
        ) => {
          if (topic !== chronosLiveKitChatTopic) {
            return;
          }

          const message = parseChronosLiveKitChatMessage(data);

          if (!message) {
            return;
          }

          setChatMessages((currentMessages) =>
            appendUniqueChronosChatMessage(currentMessages, message),
          );
        },
      );

    try {
      await liveKitRoom.connect(livekit.url, livekit.token, {
        autoSubscribe: true,
      });
      await publishChronosLiveKitMediaStream(stream);
      liveKitRoom.remoteParticipants.forEach(syncRemoteParticipant);
      const participantIdentity =
        liveKitRoom.localParticipant.identity || participant.id;
      const presenceResponse = await fetch(
        `/api/chronos/public/rooms/${room.slug}/livekit-presence`,
        {
          body: JSON.stringify({
            meetingId: payload.meetingId,
            participantId: participant.id,
            participantIdentity,
            roomName: livekit.roomName,
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
      const presencePayload = (await presenceResponse
        .json()
        .catch(() => null)) as { error?: string; ok?: boolean } | null;

      if (!presenceResponse.ok || !presencePayload?.ok) {
        throw new Error("Nao foi possivel confirmar a sala de reuniao.");
      }
      setLocalParticipant(participant);
      setMeetingId(payload.meetingId);
      setRealtimeStatus("ready");
    } catch (error) {
      disconnectChronosLiveKitRoom();
      setRealtimeStatus("offline");
      throw error;
    }
  }

  function disconnectChronosLiveKitRoom() {
    const liveKitRoom = liveKitRoomRef.current;

    liveKitLocalPublicationsRef.current.clear();
    liveKitPublishedTracksRef.current.clear();
    liveKitRawCameraTrackRef.current = null;
    liveKitRemoteStreamsRef.current.clear();
    void liveKitBackgroundProcessorRef.current?.destroy?.().catch(() => undefined);
    void liveKitNoiseProcessorRef.current
      ?.setEnabled?.(false)
      .catch(() => undefined);
    liveKitBackgroundProcessorRef.current = null;
    liveKitRoomRef.current = null;

    if (liveKitRoom) {
      liveKitRoom.removeAllListeners();
      void liveKitRoom.disconnect();
    }
  }

  async function publishChronosLiveKitMediaStream(stream: MediaStream | null) {
    if (!stream) {
      return;
    }

    const [audioTrack] = stream.getAudioTracks();
    const [videoTrack] = stream.getVideoTracks();

    if (audioTrack) {
      await publishChronosLiveKitTrack(audioTrack, Track.Source.Microphone);
    }

    if (videoTrack) {
      await publishChronosLiveKitTrack(videoTrack, Track.Source.Camera);
    }
  }

  function getChronosLiveKitTrackPublishOptions(
    source: Track.Source,
  ): TrackPublishOptions {
    if (source === Track.Source.Camera) {
      return {
        source,
        simulcast: true,
        videoEncoding: VideoPresets.h720.encoding,
        videoSimulcastLayers: chronosLiveKitCameraSimulcastLayers,
      };
    }

    if (source === Track.Source.ScreenShare) {
      return {
        screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
        source,
      };
    }

    return { source };
  }

  async function publishChronosLiveKitTrack(
    track: MediaStreamTrack,
    source: Track.Source,
  ) {
    const liveKitRoom = liveKitRoomRef.current;

    if (!liveKitRoom) {
      return;
    }

    const currentTrack = liveKitPublishedTracksRef.current.get(source);

    if (currentTrack?.id === track.id) {
      return;
    }

    await unpublishChronosLiveKitTrack(source, false);

    const publication = await liveKitRoom.localParticipant.publishTrack(
      track,
      getChronosLiveKitTrackPublishOptions(source),
    );

    liveKitPublishedTracksRef.current.set(source, track);
    liveKitLocalPublicationsRef.current.set(source, publication);
    if (source === Track.Source.Camera) {
      liveKitRawCameraTrackRef.current = track;
    }

    if (source === Track.Source.Microphone && isMutedRef.current) {
      await publication.mute().catch(() => undefined);
    }

    if (source === Track.Source.Microphone) {
      await applyChronosLiveKitNoiseProcessor(publication);
    }

    if (source === Track.Source.Camera) {
      await applyChronosLiveKitBackgroundProcessor(publication);
    }
  }

  async function applyChronosLiveKitNoiseProcessor(
    publication?: LocalTrackPublication,
  ) {
    const audioTrack =
      publication?.audioTrack ??
      liveKitLocalPublicationsRef.current.get(Track.Source.Microphone)
        ?.audioTrack;

    if (!audioTrack) {
      return;
    }

    if (!noiseReductionEnabled) {
      await audioTrack.stopProcessor().catch(() => undefined);
      await liveKitNoiseProcessorRef.current
        ?.setEnabled?.(false)
        .catch(() => undefined);
      return;
    }

    try {
      const processor =
        liveKitNoiseProcessorRef.current ??
        (await getChronosLiveKitNoiseProcessor());

      if (!processor) {
        return;
      }

      liveKitNoiseProcessorRef.current = processor;
      if (audioTrack.getProcessor?.() !== processor) {
        await audioTrack.setProcessor(processor);
      }
      await processor.setEnabled?.(true);
    } catch {
      // Browser constraints still provide the baseline cancellation fallback.
    }
  }

  async function applyChronosLiveKitBackgroundProcessor(
    publication?: LocalTrackPublication,
  ) {
    const videoTrack =
      publication?.videoTrack ??
      liveKitLocalPublicationsRef.current.get(Track.Source.Camera)?.videoTrack;

    if (!videoTrack) {
      return;
    }

    const activeBackgroundDataUrl = guestBackgroundDataUrlRef.current;
    const activeBackgroundMode = guestBackgroundModeRef.current;
    const currentProcessor = liveKitBackgroundProcessorRef.current;
    const processorOptions = getChronosLiveKitBackgroundProcessorOptions({
      backgroundDataUrl: activeBackgroundDataUrl,
      mode: activeBackgroundMode,
    });

    const getRawCameraTrack = () =>
      liveKitRawCameraTrackRef.current ??
      liveKitPublishedTracksRef.current.get(Track.Source.Camera) ??
      videoTrack.mediaStreamTrack;

    const syncRawCameraTrack = () => {
      syncChronosLocalVideoTrack(getRawCameraTrack());
    };

    const stopCurrentProcessor = async (willProcessorRestart: boolean) => {
      const processorToDestroy = liveKitBackgroundProcessorRef.current;
      await videoTrack.stopProcessor(false).catch(() => undefined);
      await processorToDestroy
        ?.destroy?.({ willProcessorRestart })
        .catch(() => undefined);

      if (liveKitBackgroundProcessorRef.current === processorToDestroy) {
        liveKitBackgroundProcessorRef.current = null;
      }
    };

    if (!processorOptions) {
      await stopCurrentProcessor(false);
      syncRawCameraTrack();
      window.setTimeout(() => {
        syncRawCameraTrack();
      }, 150);
      return;
    }

    try {
      const { BackgroundProcessor, supportsBackgroundProcessors } =
        await import("@livekit/track-processors");

      if (!supportsBackgroundProcessors()) {
        return;
      }

      if (currentProcessor || videoTrack.getProcessor?.()) {
        await stopCurrentProcessor(true);
      }

      const activeProcessor = BackgroundProcessor(processorOptions);

      liveKitBackgroundProcessorRef.current = activeProcessor;
      await videoTrack.setProcessor(activeProcessor, true);

      syncChronosLocalVideoTrack(
        activeProcessor.processedTrack ?? videoTrack.mediaStreamTrack,
      );
      window.setTimeout(() => {
        syncChronosLocalVideoTrack(
          activeProcessor?.processedTrack ?? videoTrack.mediaStreamTrack,
        );
      }, 150);
    } catch {
      setMediaError("Nao foi possivel aplicar o fundo virtual nesta camera.");
      syncRawCameraTrack();
    }
  }

  function queueChronosLiveKitBackgroundProcessorApply() {
    const generation = liveKitBackgroundApplyGenerationRef.current + 1;

    liveKitBackgroundApplyGenerationRef.current = generation;
    liveKitBackgroundApplyQueueRef.current =
      liveKitBackgroundApplyQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (generation !== liveKitBackgroundApplyGenerationRef.current) {
            return;
          }

          await applyChronosLiveKitBackgroundProcessorRef.current?.();
        });

    return liveKitBackgroundApplyQueueRef.current;
  }

  function syncChronosLocalVideoTrack(videoTrack: MediaStreamTrack | null) {
    const currentStream = localStreamRef.current;

    if (!currentStream || !videoTrack) {
      return;
    }

    const audioTracks = currentStream.getAudioTracks();
    const nextStream = new MediaStream([...audioTracks, videoTrack]);

    localStreamRef.current = nextStream;
    setLocalStream(nextStream);

    if (localParticipantRef.current && meetingIdRef.current) {
      const nextParticipant = {
        ...localParticipantRef.current,
        cameraStream: nextStream,
        isCameraOn: true,
        stream: nextStream,
      };

      localParticipantRef.current = nextParticipant;
      setLocalParticipant(nextParticipant);
    }
  }

  applyChronosLiveKitBackgroundProcessorRef.current =
    applyChronosLiveKitBackgroundProcessor;
  applyChronosLiveKitNoiseProcessorRef.current =
    applyChronosLiveKitNoiseProcessor;

  async function unpublishChronosLiveKitTrack(
    source: Track.Source,
    stopOnUnpublish: boolean,
  ) {
    const liveKitRoom = liveKitRoomRef.current;
    const currentTrack = liveKitPublishedTracksRef.current.get(source);

    if (!liveKitRoom || !currentTrack) {
      return;
    }

    await liveKitRoom.localParticipant
      .unpublishTrack(currentTrack, stopOnUnpublish)
      .catch(() => undefined);
    liveKitPublishedTracksRef.current.delete(source);
    liveKitLocalPublicationsRef.current.delete(source);
    if (source === Track.Source.Camera) {
      liveKitRawCameraTrackRef.current = null;
    }
  }

  async function publishChronosLiveKitChatMessage(
    message: ChronosChatMessage,
  ) {
    const liveKitRoom = liveKitRoomRef.current;

    if (!liveKitRoom) {
      return;
    }

    await liveKitRoom.localParticipant
      .publishData(
        new TextEncoder().encode(
          JSON.stringify({
            kind: "chat-message",
            message,
          }),
        ),
        {
          reliable: true,
          topic: chronosLiveKitChatTopic,
        },
      )
      .catch(() => undefined);
  }

  async function handleJoinRoom() {
    const nextDisplayName = participantLabel;

    if (!nextDisplayName) {
      setJoinError("Informe seu nome para participar.");
      return;
    }

    if (!isChronosLiveKitProvider) {
      const message =
        "Sala indisponivel no momento. A chamada foi bloqueada para proteger o registro da reuniao.";

      setJoinError(message);
      setMediaError(message);
      return;
    }

    if (
      isChronosLiveKitProvider &&
      !isHubParticipant &&
      !entryRequestApprovedRef.current
    ) {
      const request = {
        displayName: nextDisplayName,
        id: `chronos-entry-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        organization: participantOrganization || undefined,
        requestedAt: new Date().toISOString(),
      } satisfies ChronosEntryRequest;

      entryRequestIdRef.current = request.id;
      setEntryRequestStatus("waiting");
      setJoining(true);
      setJoinError("Aguardando aprovacao do host para entrar.");

      const sent = sendLobbySignal({
        kind: "entry-request",
        request,
        roomSlug: room.slug,
      });

      if (!sent) {
        setEntryRequestStatus("idle");
        setJoining(false);
        setJoinError("Nao foi possivel avisar o host. Tente novamente.");
      }

      return;
    }

    setJoining(true);
    setJoinError(null);

    const stream = localStreamRef.current ?? (await startLocalMedia());

    try {
      const response = await fetch(
        `/api/chronos/public/rooms/${room.slug}/livekit-token`,
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
        | (ChronosLiveKitJoinResult & { error?: string })
        | null;

      if (!response.ok || !payload?.meetingId || !payload.participant) {
        throw new Error(payload?.error ?? "Nao foi possivel entrar na sala.");
      }

      const participant: ChronosRoomParticipant = {
        cameraStream: stream,
        displayName: payload.participant.displayName,
        id: payload.participant.id,
        isCameraOn: Boolean(stream?.getVideoTracks().length),
        isHost: payload.isHost,
        isMuted,
        isScreenSharing: false,
        organization: payload.participant.organization,
        screenStream: null,
        stream,
      };

      entryRequestApprovedRef.current = false;
      entryRequestIdRef.current = "";
      setEntryRequestStatus("idle");
      await connectChronosLiveKitRoom({
        participant,
        payload,
        stream,
      });
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

  approvedEntryJoinRef.current = () => {
    void handleJoinRoom();
  };

  function handleEntryRequestDecision(
    request: ChronosEntryRequest,
    approved: boolean,
  ) {
    sendLobbySignal({
      approved,
      kind: "entry-decision",
      requestId: request.id,
      roomSlug: room.slug,
    });
    setEntryRequests((currentRequests) =>
      currentRequests.filter((currentRequest) => currentRequest.id !== request.id),
    );
  }

  function handleToggleMicrophone() {
    const nextMuted = !isMuted;

    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    const liveKitMicrophonePublication = liveKitLocalPublicationsRef.current.get(
      Track.Source.Microphone,
    );

    if (isChronosLiveKitProvider && liveKitMicrophonePublication) {
      void (nextMuted
        ? liveKitMicrophonePublication.mute()
        : liveKitMicrophonePublication.unmute()
      ).catch(() => undefined);
    }
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
      if (isChronosLiveKitProvider) {
        await unpublishChronosLiveKitTrack(Track.Source.Camera, false);
      }
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
          cameraStream: nextStream,
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
      const videoTrack = await requestChronosVideoTrack({
        isHdVideoPreferred,
        isWidescreenPreferred,
        videoInputId,
      });
      const currentStream = localStreamRef.current ?? new MediaStream();
      const sourceStream = new MediaStream([
        ...currentStream.getAudioTracks(),
        videoTrack,
      ]);
      const preparedMedia = isChronosLiveKitProvider
        ? {
            cleanup: () => undefined,
            isVirtualBackgroundActive: false,
            stream: sourceStream,
          }
        : await createChronosPreparedLocalMedia({
            backgroundDataUrl: guestBackgroundDataUrl,
            backgroundMode: guestBackgroundMode,
            sourceStream,
          });
      const nextStream = preparedMedia.stream;

      virtualBackgroundCleanupRef.current?.();
      virtualBackgroundCleanupRef.current = preparedMedia.cleanup;
      if (isChronosLiveKitProvider) {
        await publishChronosLiveKitTrack(
          nextStream.getVideoTracks()[0] ?? videoTrack,
          Track.Source.Camera,
        );
      }
      replaceVideoTrackForPeers(nextStream.getVideoTracks()[0] ?? null);
      localStreamRef.current = nextStream;
      setCameraEnabled(true);
      setLocalStream(new MediaStream(nextStream.getTracks()));
      setMediaError(
        !isChronosLiveKitProvider &&
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
          cameraStream: nextStream,
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
      if (isChronosLiveKitProvider) {
        await publishChronosLiveKitTrack(screenTrack, Track.Source.ScreenShare);
      } else {
        replaceVideoTrackForPeers(screenTrack);
      }
      setIsScreenSharing(true);
      const currentParticipant = localParticipantRef.current;
      const currentStream = localStreamRef.current;
      const screenStream = new MediaStream([screenTrack]);
      const nextParticipant = currentParticipant
        ? {
            ...currentParticipant,
            cameraStream: currentStream,
            isCameraOn: true,
            isScreenSharing: true,
            screenStream,
            stream: isChronosLiveKitProvider
              ? currentStream
              : new MediaStream([
                  ...getEnabledChronosAudioTracks(currentStream),
                  screenTrack,
                ]),
          }
        : null;

      localParticipantRef.current = nextParticipant;
      setLocalParticipant(nextParticipant);
      sendScreenShareSignal("screen-share-start");
    } catch {
      setMediaError("Nao foi possivel compartilhar a tela.");
    }
  }

  async function stopScreenShare() {
    if (isChronosLiveKitProvider) {
      await unpublishChronosLiveKitTrack(Track.Source.ScreenShare, false);
    }
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    setIsScreenSharing(false);
    sendScreenShareSignal("screen-share-stop");

    if (isChronosLiveKitProvider) {
      const currentParticipant = localParticipantRef.current;
      const currentStream = localStreamRef.current;
      const nextParticipant = currentParticipant
        ? {
            ...currentParticipant,
            cameraStream: currentStream,
            isCameraOn: Boolean(
              cameraEnabled && currentStream?.getVideoTracks().length,
            ),
            isScreenSharing: false,
            screenStream: null,
            stream: currentStream,
          }
        : null;

      localParticipantRef.current = nextParticipant;
      setLocalParticipant(nextParticipant);
      return;
    }

    if (!cameraEnabled) {
      replaceVideoTrackForPeers(null);
      const currentParticipant = localParticipantRef.current;
      const nextParticipant = currentParticipant
        ? {
            ...currentParticipant,
            cameraStream: null,
            isScreenSharing: false,
            screenStream: null,
            stream: localStreamRef.current,
          }
        : null;

      localParticipantRef.current = nextParticipant;
      setLocalParticipant(nextParticipant);
      return;
    }

    try {
      const videoTrack = await requestChronosVideoTrack({
        isHdVideoPreferred,
        isWidescreenPreferred,
        videoInputId,
      });
      const currentStream = localStreamRef.current ?? new MediaStream();
      const sourceStream = new MediaStream([
        ...currentStream.getAudioTracks(),
        videoTrack,
      ]);
      const preparedMedia = isChronosLiveKitProvider
        ? {
            cleanup: () => undefined,
            isVirtualBackgroundActive: false,
            stream: sourceStream,
          }
        : await createChronosPreparedLocalMedia({
            backgroundDataUrl: guestBackgroundDataUrl,
            backgroundMode: guestBackgroundMode,
            sourceStream,
          });
      const nextStream = preparedMedia.stream;

      virtualBackgroundCleanupRef.current?.();
      virtualBackgroundCleanupRef.current = preparedMedia.cleanup;
      localStreamRef.current = nextStream;
      if (isChronosLiveKitProvider) {
        await publishChronosLiveKitTrack(
          nextStream.getVideoTracks()[0] ?? videoTrack,
          Track.Source.Camera,
        );
      }
      replaceVideoTrackForPeers(nextStream.getVideoTracks()[0] ?? null);
      setLocalStream(new MediaStream(nextStream.getTracks()));
      setMediaError(
        !isChronosLiveKitProvider &&
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
            cameraStream: nextStream,
            isScreenSharing: false,
            screenStream: null,
            stream: nextStream,
          }
        : null;

      localParticipantRef.current = nextParticipant;
      setLocalParticipant(nextParticipant);
    } catch {
      replaceVideoTrackForPeers(null);
      setMediaError("Nao foi possivel restaurar a camera.");
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
      recordingStartedAt:
        status === "recording" && recordingStartedAtRef.current
          ? new Date(recordingStartedAtRef.current).toISOString()
          : undefined,
      recordingStatus: status,
      roomSlug: room.slug,
      toParticipantId,
    });
  }

  async function handleToggleRecording() {
    if (!isChronosLiveKitProvider) {
      const message = "Gravacao indisponivel nesta sala.";

      setRecordingStorageStatus("failed");
      setRecordingStorageError(message);
      setMediaError(message);
      return;
    }

    if (isRecording) {
      await stopLiveKitEgressRecording();
      return;
    }

    await startLiveKitEgressRecording();
  }

  async function startLiveKitEgressRecording(): Promise<"blocked" | "started"> {
    if (!meetingId || !localParticipant) {
      setRecordingStorageStatus("failed");
      setRecordingStorageError("Entre na sala antes de iniciar a gravacao.");
      return "blocked";
    }

    if (!localParticipant.isHost || !authState.session?.accessToken) {
      const message = "Somente o host autenticado pode iniciar a gravacao.";

      setRecordingStorageStatus("failed");
      setRecordingStorageError(message);
      setMediaError(message);
      return "blocked";
    }

    setRecordingStorageError("");
    setRecordingStorageStatus("starting");

    try {
      const response = await fetch(
        `/api/chronos/public/rooms/${room.slug}/egress`,
        {
          body: JSON.stringify({
            action: "start",
            meetingId,
            participantId: localParticipant.id,
          }),
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${authState.session.accessToken}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      const result = (await response.json().catch(() => ({}))) as {
        audioEgressId?: unknown;
        audioFileName?: unknown;
        audioRecordingId?: unknown;
        egressId?: unknown;
        error?: unknown;
        fileName?: unknown;
        participantAudioEgresses?: unknown;
        recordingId?: unknown;
      };

      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "Nao foi possivel iniciar a gravacao.",
        );
      }

      const egressId =
        typeof result.egressId === "string" ? result.egressId : "";
      const recordingId =
        typeof result.recordingId === "string" ? result.recordingId : "";
      const audioEgressId =
        typeof result.audioEgressId === "string" ? result.audioEgressId : "";
      const audioRecordingId =
        typeof result.audioRecordingId === "string"
          ? result.audioRecordingId
          : "";
      const participantAudioEgresses =
        normalizeChronosLiveKitParticipantAudioEgresses(
          result.participantAudioEgresses,
        );

      if (!egressId) {
        throw new Error("Nao foi possivel confirmar o inicio da gravacao.");
      }

      liveKitEgressIdRef.current = egressId;
      liveKitEgressRecordingIdRef.current = recordingId;
      liveKitAudioEgressIdRef.current = audioEgressId;
      liveKitAudioEgressRecordingIdRef.current = audioRecordingId;
      liveKitParticipantAudioEgressesRef.current = participantAudioEgresses;
      recordingStartedAtRef.current = Date.now();
      setRecordingSeconds(0);
      setLastRecordingUrl("");
      setLastRecordingName(
        typeof result.fileName === "string" ? result.fileName : "livekit-egress.mp4",
      );
      setIsRecording(true);
      setRecordingStorageStatus("recording");
      sendRecordingStateSignal("recording");
      return "started";
    } catch (error) {
      liveKitEgressIdRef.current = "";
      liveKitEgressRecordingIdRef.current = "";
      liveKitAudioEgressIdRef.current = "";
      liveKitAudioEgressRecordingIdRef.current = "";
      liveKitParticipantAudioEgressesRef.current = [];
      setIsRecording(false);
      setRecordingStorageStatus("failed");
      setRecordingStorageError(normalizeChronosRecordingStorageError(error));
      setMediaError(normalizeChronosRecordingStorageError(error));
      return "blocked";
    }
  }

  async function stopLiveKitEgressRecording() {
    if (!meetingId || !localParticipant) {
      setRecordingStorageStatus("failed");
      setRecordingStorageError("Entre na sala antes de parar a gravacao.");
      return;
    }

    if (!localParticipant.isHost || !authState.session?.accessToken) {
      const message = "Somente o host autenticado pode parar a gravacao.";

      setRecordingStorageStatus("failed");
      setRecordingStorageError(message);
      setMediaError(message);
      return;
    }

    const egressId = liveKitEgressIdRef.current;
    const recordingId = liveKitEgressRecordingIdRef.current;
    const audioEgressId = liveKitAudioEgressIdRef.current;
    const audioRecordingId = liveKitAudioEgressRecordingIdRef.current;
    const participantAudioEgresses =
      liveKitParticipantAudioEgressesRef.current;

    if (!egressId) {
      setIsRecording(false);
      sendRecordingStateSignal("available");
      liveKitAudioEgressIdRef.current = "";
      liveKitAudioEgressRecordingIdRef.current = "";
      liveKitParticipantAudioEgressesRef.current = [];
      return;
    }

    setRecordingStorageStatus("uploading");
    setRecordingStorageError("");

    try {
      const response = await fetch(
        `/api/chronos/public/rooms/${room.slug}/egress`,
        {
          body: JSON.stringify({
            action: "stop",
            audioEgressId,
            audioRecordingId,
            egressId,
            meetingId,
            participantAudioEgresses,
            participantId: localParticipant.id,
            recordingId,
          }),
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${authState.session.accessToken}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      const result = (await response.json().catch(() => ({}))) as {
        error?: unknown;
        status?: unknown;
      };

      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "Nao foi possivel encerrar a gravacao.",
        );
      }

      setRecordingStorageStatus(
        result.status === "available" ? "saved" : "uploading",
      );
      setIsRecording(false);
      sendRecordingStateSignal("available");
      if (result.status !== "available") {
        void pollLiveKitEgressRecordingStatus({
          audioEgressId,
          audioRecordingId,
          egressId,
          participantAudioEgresses,
          recordingId,
        });
      }
    } catch (error) {
      setRecordingStorageStatus("failed");
      setRecordingStorageError(normalizeChronosRecordingStorageError(error));
      setMediaError(normalizeChronosRecordingStorageError(error));
    } finally {
      liveKitEgressIdRef.current = "";
      liveKitEgressRecordingIdRef.current = "";
      liveKitAudioEgressIdRef.current = "";
      liveKitAudioEgressRecordingIdRef.current = "";
      liveKitParticipantAudioEgressesRef.current = [];
    }
  }

  async function pollLiveKitEgressRecordingStatus({
    audioEgressId,
    audioRecordingId,
    egressId,
    participantAudioEgresses,
    recordingId,
  }: {
    audioEgressId?: string;
    audioRecordingId?: string;
    egressId: string;
    participantAudioEgresses?: ChronosLiveKitParticipantAudioEgress[];
    recordingId: string;
  }) {
    if (!meetingId || !localParticipant || !authState.session?.accessToken) {
      return;
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await wait(3000);

      try {
        const response = await fetch(
          `/api/chronos/public/rooms/${room.slug}/egress`,
          {
            body: JSON.stringify({
              action: "sync",
              audioEgressId,
              audioRecordingId,
              egressId,
              meetingId,
              participantAudioEgresses,
              participantId: localParticipant.id,
              recordingId,
            }),
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${authState.session.accessToken}`,
              "Content-Type": "application/json",
            },
            method: "POST",
          },
        );
        const result = (await response.json().catch(() => ({}))) as {
          error?: unknown;
          status?: unknown;
        };

        if (!response.ok) {
          throw new Error(
            typeof result.error === "string"
              ? result.error
              : "Nao foi possivel sincronizar a gravacao.",
          );
        }

        if (result.status === "available") {
          setRecordingStorageStatus("saved");
          setRecordingStorageError("");
          return;
        }

        if (result.status === "failed") {
          setRecordingStorageStatus("failed");
          setRecordingStorageError("Nao foi possivel salvar a gravacao.");
          return;
        }
      } catch (error) {
        setRecordingStorageStatus("failed");
        setRecordingStorageError(normalizeChronosRecordingStorageError(error));
        return;
      }
    }
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
    if (isChronosLiveKitProvider) {
      void publishChronosLiveKitChatMessage(message);
    }
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

  function handleSelectBackgroundEffect({
    dataUrl,
    mode,
  }: ChronosBackgroundEffectInput) {
    const nextDataUrl = dataUrl ?? "";

    guestBackgroundDataUrlRef.current = nextDataUrl;
    guestBackgroundModeRef.current = mode;
    setGuestBackgroundDataUrl(nextDataUrl);
    setGuestBackgroundMode(mode);
    setMediaError(null);

    if (
      isChronosLiveKitProvider &&
      liveKitRoomRef.current &&
      !isScreenSharing
    ) {
      const hasPublishedCamera = Boolean(
        liveKitLocalPublicationsRef.current.get(Track.Source.Camera)?.videoTrack,
      );

      if (hasPublishedCamera) {
        void queueChronosLiveKitBackgroundProcessorApply();
      } else if (cameraEnabled || mode !== "none") {
        setCameraEnabled(true);
        void startLocalMedia({ cameraEnabled: true });
      }
      return;
    }

    if (!hasJoined) {
      void startLocalMedia();
    }
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
    handleSelectBackgroundEffect({ dataUrl, mode: "image" });
    event.target.value = "";
  }

  function handleSelectAudioInput(deviceId: string) {
    setAudioInputId(deviceId);
    setMediaError(null);
  }

  function handleSelectVideoInput(deviceId: string) {
    setVideoInputId(deviceId);
    setMediaError(null);
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

  async function handleLeaveRoom(
    options: ChronosLeaveRoomOptions = {},
  ) {
    const shouldCloseMeeting = Boolean(options.closeMeeting && localParticipant?.isHost);
    const shouldNotifyPeers = options.notifyPeers !== false;

    if (isRecording) {
      if (isChronosLiveKitProvider) {
        await stopLiveKitEgressRecording();
      } else {
        setIsRecording(false);
        sendRecordingStateSignal("available");
      }
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
    disconnectChronosLiveKitRoom();
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

    return participants.map((participant) =>
      buildChronosCameraTileParticipant(participant),
    );
  }, [localParticipant, remoteParticipants]);
  const screenShareParticipant = useMemo(() => {
    const participants = localParticipant
      ? [localParticipant, ...Object.values(remoteParticipants)]
      : [];

    const participant = participants.find(
      (currentParticipant) =>
        currentParticipant.isScreenSharing &&
        getChronosScreenShareStream(currentParticipant)?.getVideoTracks()
          .length,
    );

    return participant ? buildChronosScreenShareTileParticipant(participant) : null;
  }, [localParticipant, remoteParticipants]);
  const companionParticipants = tileParticipants;
  const participantGridClassName = getChronosParticipantGridClassName(
    tileParticipants.length,
  );
  const localParticipantFallbackBackground =
    !isChronosLiveKitProvider &&
    guestBackgroundMode === "image" &&
    guestBackgroundDataUrl
      ? guestBackgroundDataUrl
      : "";

  return (
    <main
      className="h-[100svh] min-h-[100svh] overflow-hidden bg-[#111820] text-white"
      style={{
        backgroundImage: pageBackgroundImage
          ? `linear-gradient(rgba(9,14,18,0.34), rgba(9,14,18,0.44)), url(${pageBackgroundImage})`
          : "linear-gradient(135deg, #182431, #101820 54%, #211d14)",
        backgroundPosition: "center",
        backgroundSize: "cover",
      }}
    >
      <div className="relative h-full min-h-0 bg-black/10">
        <header
          className={
            hasJoined
              ? "pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-4 py-3"
              : "flex items-center justify-between px-5 py-4"
          }
        >
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-lg bg-black/90 shadow-xl ring-1 ring-white/10">
              <span
                aria-hidden="true"
                className="block h-7 w-7 bg-contain bg-center bg-no-repeat"
                style={{
                  backgroundImage: `url(${chronosCareliMark.src})`,
                }}
              />
              <span className="sr-only">Careli</span>
            </span>
            <div className="rounded-lg bg-black/25 px-2 py-1 backdrop-blur-sm">
              <h1 className="m-0 text-sm font-semibold">{room.name}</h1>
            </div>
          </div>
          <span className="sr-only" aria-live="polite">
            {realtimeStatus === "ready" ? "Sala pronta" : "Sala carregando"}
          </span>
        </header>

        {hasJoined && isRecording ? (
          <div className="pointer-events-none absolute left-1/2 top-16 z-40 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-rose-300/35 bg-[#101820]/88 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] text-white shadow-2xl ring-1 ring-black/35 backdrop-blur-md">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-400" />
            </span>
            Gravando {formatChronosDuration(recordingSeconds)}
          </div>
        ) : null}

        {!hasJoined ? (
          <section className="grid min-h-[calc(100dvh-5rem)] place-items-center overflow-y-auto px-4 pb-10">
            <div className="w-full max-w-[32rem] overflow-hidden rounded-xl border border-white/15 bg-white text-[#101820] shadow-2xl">
              <div
                className="relative aspect-video overflow-hidden rounded-t-xl bg-[#101820] bg-center"
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
                    className="absolute inset-0 h-full w-full rounded-t-xl object-cover"
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
                      onClick={() =>
                        handleSelectBackgroundEffect({ mode: "none" })
                      }
                      type="button"
                    >
                      <Ban aria-hidden="true" size={15} />
                    </button>
                    <button
                      aria-label="Desfoque baixo"
                      aria-pressed={guestBackgroundMode === "blur-low"}
                      className="grid h-8 w-8 place-items-center rounded-full text-white/75 transition hover:bg-white/10 hover:text-white aria-pressed:bg-white aria-pressed:text-[#101820] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                      onClick={() =>
                        handleSelectBackgroundEffect({ mode: "blur-low" })
                      }
                      type="button"
                    >
                      <Droplet aria-hidden="true" size={15} />
                    </button>
                    <button
                      aria-label="Desfoque alto"
                      aria-pressed={guestBackgroundMode === "blur-high"}
                      className="grid h-8 w-8 place-items-center rounded-full text-white/75 transition hover:bg-white/10 hover:text-white aria-pressed:bg-white aria-pressed:text-[#101820] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                      onClick={() =>
                        handleSelectBackgroundEffect({ mode: "blur-high" })
                      }
                      type="button"
                    >
                      <Droplets aria-hidden="true" size={15} />
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      aria-label="Efeitos de fundo"
                      aria-pressed={preJoinPanel === "background"}
                      className="grid h-8 w-8 place-items-center rounded-full bg-black/70 text-white transition hover:bg-black aria-pressed:border aria-pressed:border-[#A07C3B] aria-pressed:text-[#A07C3B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                      onClick={() =>
                        setPreJoinPanel((current) =>
                          current === "background" ? null : "background",
                        )
                      }
                      type="button"
                    >
                      <Sparkles aria-hidden="true" size={13} />
                    </button>
                    <button
                      aria-label="Configuracoes de camera e microfone"
                      aria-pressed={preJoinPanel === "settings"}
                      className="grid h-8 w-8 place-items-center rounded-full bg-black/70 text-white transition hover:bg-black aria-pressed:border aria-pressed:border-[#A07C3B] aria-pressed:text-[#A07C3B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                      onClick={() =>
                        setPreJoinPanel((current) =>
                          current === "settings" ? null : "settings",
                        )
                      }
                      type="button"
                    >
                      <SlidersHorizontal aria-hidden="true" size={13} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid min-w-0 max-w-full gap-3 overflow-hidden p-4">
                <label className="grid min-w-0 gap-1 text-xs font-bold uppercase text-[#667085]">
                  Nome
                  <input
                    className="h-10 w-full min-w-0 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm normal-case text-[#101820] outline-none focus:border-[#A07C3B]"
                    disabled={isHubParticipant}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Seu nome"
                    value={participantLabel}
                  />
                </label>
                <label className="grid min-w-0 gap-1 text-xs font-bold uppercase text-[#667085]">
                  Empresa
                  <div className="relative min-w-0">
                    <Building2
                      aria-hidden="true"
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-[#98a2b3]"
                      size={15}
                    />
                    <input
                      className="h-10 w-full min-w-0 rounded-md border border-[#d9e0e7] bg-white pl-9 pr-3 text-sm normal-case text-[#101820] outline-none focus:border-[#A07C3B]"
                      disabled={isHubParticipant}
                      onChange={(event) => setOrganization(event.target.value)}
                      placeholder="Empresa ou organizacao"
                      value={participantOrganization}
                    />
                  </div>
                </label>
                <select
                  className="h-10 w-full min-w-0 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
                  onChange={(event) => {
                    handleSelectVideoInput(event.target.value);
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
                  className="h-10 w-full min-w-0 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
                  onChange={(event) => {
                    handleSelectAudioInput(event.target.value);
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
                {entryRequestStatus === "waiting" ? (
                  <p className="m-0 rounded-md border border-[#d9e0e7] bg-[#f7f9fb] p-2 text-xs font-semibold text-[#344054]">
                    Pedido enviado. Aguarde o host autorizar sua entrada.
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
            {preJoinPanel ? (
              <ChronosPreJoinSettingsDialog
                activePanel={preJoinPanel}
                audioDevices={audioInputs}
                backgroundDataUrl={guestBackgroundDataUrl}
                backgroundMode={guestBackgroundMode}
                cameraEnabled={cameraEnabled}
                disabled={isScreenSharing}
                isHdVideoPreferred={isHdVideoPreferred}
                isNoiseReductionEnabled={noiseReductionEnabled}
                isWidescreenPreferred={isWidescreenPreferred}
                onBackgroundUpload={handleBackgroundUpload}
                onClose={() => setPreJoinPanel(null)}
                onPanelChange={(panel) => setPreJoinPanel(panel)}
                onSelectAudioDevice={handleSelectAudioInput}
                onSelectBackgroundEffect={handleSelectBackgroundEffect}
                onSelectVideoDevice={handleSelectVideoInput}
                onToggleHdVideo={() =>
                  setIsHdVideoPreferred((current) => !current)
                }
                onToggleNoiseReduction={() =>
                  setNoiseReductionEnabled((current) => !current)
                }
                onToggleWidescreen={() =>
                  setIsWidescreenPreferred((current) => !current)
                }
                participantLabel={participantLabel}
                previewVideoRef={settingsPreviewVideoRef}
                selectedAudioDeviceId={audioInputId}
                selectedVideoDeviceId={videoInputId}
                stream={localStream}
                videoDevices={videoInputs}
              />
            ) : null}
          </section>
        ) : (
          <section className="relative grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-5 px-3 pb-[max(3.5rem,env(safe-area-inset-bottom))] pt-16 sm:px-4 sm:pb-10">
            <div className="pointer-events-none absolute inset-x-3 top-4 z-20 flex flex-wrap items-center justify-end gap-2 sm:inset-x-4">
              <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
                <Badge variant="info">
                  <UsersRound aria-hidden="true" size={13} />{" "}
                  {tileParticipants.length} participantes
                </Badge>
                {localParticipant?.isHost && entryRequests.length > 0 ? (
                  <div className="w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-white/15 bg-[#101820]/90 p-3 text-left text-white shadow-2xl ring-1 ring-black/30 backdrop-blur-md">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <strong className="text-xs uppercase tracking-[0.16em] text-white/65">
                        Porta Chronos
                      </strong>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.68rem] font-semibold text-white/70">
                        {entryRequests.length}
                      </span>
                    </div>
                    <div className="grid gap-2">
                      {entryRequests.map((request) => (
                        <div
                          className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.06] p-2"
                          key={request.id}
                        >
                          <div className="min-w-0">
                            <p className="m-0 truncate text-sm font-semibold">
                              {request.displayName}
                            </p>
                            <p className="m-0 truncate text-xs text-white/65">
                              {request.organization || "Empresa nao informada"}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              className="inline-flex h-8 flex-1 items-center justify-center rounded-md bg-[#A07C3B] px-3 text-xs font-semibold text-white transition hover:bg-[#8f6f35] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f2d79f]"
                              onClick={() =>
                                handleEntryRequestDecision(request, true)
                              }
                              type="button"
                            >
                              Autorizar
                            </button>
                            <button
                              className="inline-flex h-8 flex-1 items-center justify-center rounded-md border border-white/15 bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f2d79f]"
                              onClick={() =>
                                handleEntryRequestDecision(request, false)
                              }
                              type="button"
                            >
                              Recusar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {lastRecordingUrl ? (
                  <a
                    className="rounded-full border border-white/15 bg-[#101820]/75 px-3 py-1.5 text-xs font-semibold text-white shadow-xl transition hover:bg-[#101820] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                    download={lastRecordingName}
                    href={lastRecordingUrl}
                  >
                    Baixar gravacao
                  </a>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 overflow-hidden pt-2">
              {screenShareParticipant ? (
                <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] xl:grid-rows-1">
                  <div className="h-full min-h-0 overflow-hidden rounded-[1rem] border border-white/18 bg-black/40 shadow-[0_24px_80px_rgba(0,0,0,0.34)] ring-1 ring-black/20 [&_article]:h-full [&_article]:rounded-[1rem] [&_article]:border-0 [&_article]:p-0 [&_article]:ring-0 [&_video]:rounded-[0.95rem] [&_video]:object-contain">
                    <div
                      className="relative h-full min-h-0 rounded-[1rem]"
                      style={getChronosParticipantWindowStyle({
                        backgroundDataUrl: localParticipantFallbackBackground,
                        isLocal:
                          screenShareParticipant.source.id ===
                          localParticipant?.id,
                      })}
                    >
                      <CallParticipantTile
                        hideCaption
                        isLocalMedia={
                          screenShareParticipant.source.id ===
                          localParticipant?.id
                        }
                        layout="spotlight"
                        mediaStream={screenShareParticipant.mediaStream}
                        onVideoElementChange={handleVideoElementChange}
                        participant={screenShareParticipant.participant}
                      />
                      <ChronosParticipantIdentityCaption
                        participant={screenShareParticipant.source}
                      />
                    </div>
                  </div>
                  <aside className="min-h-0 overflow-x-auto rounded-[1rem] border border-white/12 bg-black/24 p-2 shadow-[0_18px_60px_rgba(0,0,0,0.22)] xl:overflow-y-auto">
                    <div className="flex min-h-[7.5rem] gap-2 xl:grid xl:min-h-0 xl:grid-cols-1">
                    {companionParticipants.map(
                      ({ mediaStream, participant, source, tileId }) => (
                      <div
                        className="relative aspect-video w-52 shrink-0 overflow-hidden rounded-[0.85rem] border border-white/18 bg-[#111820]/45 p-1 shadow-xl ring-1 ring-black/25 xl:w-full [&_article]:h-full [&_article]:rounded-[0.75rem] [&_article]:border-0 [&_article]:p-0 [&_article]:ring-0 [&_video]:rounded-[0.7rem]"
                        key={tileId}
                        style={getChronosParticipantWindowStyle({
                          backgroundDataUrl: localParticipantFallbackBackground,
                          isLocal: source.id === localParticipant?.id,
                        })}
                      >
                        <CallParticipantTile
                          hideCaption
                          isLocalMedia={source.id === localParticipant?.id}
                          layout="thumbnail"
                          mediaStream={mediaStream}
                          onVideoElementChange={handleVideoElementChange}
                          participant={participant}
                        />
                        <ChronosParticipantIdentityCaption participant={source} />
                      </div>
                      ),
                    )}
                    </div>
                  </aside>
                </div>
              ) : (
                <div className={participantGridClassName}>
                  {tileParticipants.map(
                    ({ mediaStream, participant, source, tileId }) => (
                    <div
                      className="relative min-h-0 overflow-hidden rounded-[1rem] border border-white/18 bg-[#111820]/28 shadow-[0_24px_80px_rgba(0,0,0,0.28)] ring-1 ring-black/20 [&_article]:h-full [&_article]:rounded-[1rem] [&_article]:border-0 [&_article]:p-0 [&_article]:ring-0 [&_video]:rounded-[0.95rem]"
                      key={tileId}
                      style={getChronosParticipantWindowStyle({
                        backgroundDataUrl: localParticipantFallbackBackground,
                        isLocal: source.id === localParticipant?.id,
                        participantCount: tileParticipants.length,
                      })}
                    >
                      <CallParticipantTile
                        hideCaption
                        isLocalMedia={source.id === localParticipant?.id}
                        layout="spotlight"
                        mediaStream={mediaStream}
                        onVideoElementChange={handleVideoElementChange}
                        participant={participant}
                      />
                      <ChronosParticipantIdentityCaption participant={source} />
                    </div>
                    ),
                  )}
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
                    <strong className="text-sm">Transcricao da reuniao</strong>
                  </div>
                  <button
                    aria-label="Ocultar transcricao da reuniao"
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
                      A transcricao pos-gravacao aparece no Drive depois do
                      processamento do audio da reuniao.
                    </div>
                  )}
                </div>
              </aside>
            ) : null}

            {recordingStorageStatus !== "idle" || recordingStorageError ? (
              <div className="absolute bottom-[5.75rem] left-1/2 z-40 flex max-w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-2 rounded-lg border border-white/15 bg-[#101820]/92 px-3 py-2 text-xs font-semibold text-white shadow-2xl ring-1 ring-black/35 backdrop-blur-md">
                <Radio
                  aria-hidden="true"
                  className={
                    recordingStorageStatus === "failed"
                      ? "text-rose-300"
                      : recordingStorageStatus === "saved"
                        ? "text-emerald-300"
                        : "text-[#A07C3B]"
                  }
                  size={14}
                />
                <span className="min-w-0 truncate">
                  {getChronosRecordingStorageLabel({
                    error: recordingStorageError,
                    status: recordingStorageStatus,
                  })}
                </span>
              </div>
            ) : null}

            <div className="relative z-40 flex w-full flex-wrap justify-center gap-2 pb-1">
              <ChronosLiveKitControlBar
                audioDevices={audioInputs}
                backgroundDataUrl={guestBackgroundDataUrl}
                backgroundMode={guestBackgroundMode}
                chatCount={chatMessages.length}
                cameraEnabled={cameraEnabled}
                isHdVideoPreferred={isHdVideoPreferred}
                isChatOpen={isChatOpen}
                isMuted={isMuted}
                isNoiseReductionEnabled={noiseReductionEnabled}
                isPictureInPictureActive={Boolean(pictureInPictureParticipantId)}
                isPictureInPictureAvailable={isPictureInPictureAvailable}
                isRecording={isRecording}
                isRecordingBusy={
                  recordingStorageStatus === "starting" ||
                  recordingStorageStatus === "uploading"
                }
                recordingSeconds={recordingSeconds}
                recordingStorageStatus={recordingStorageStatus}
                isScreenSharing={isScreenSharing}
                isTranscriptOpen={isTranscriptOpen}
                isWidescreenPreferred={isWidescreenPreferred}
                onEnd={() =>
                  void handleLeaveRoom({
                    closeMeeting: Boolean(localParticipant?.isHost),
                  })
                }
                onBackgroundUpload={handleBackgroundUpload}
                onSelectAudioDevice={handleSelectAudioInput}
                onSelectBackgroundEffect={handleSelectBackgroundEffect}
                onSelectVideoDevice={handleSelectVideoInput}
                onToggleCamera={() => void handleToggleCamera()}
                onToggleChat={() => setIsChatOpen((current) => !current)}
                onToggleHdVideo={() =>
                  setIsHdVideoPreferred((current) => !current)
                }
                onToggleMicrophone={handleToggleMicrophone}
                onToggleNoiseReduction={() =>
                  setNoiseReductionEnabled((current) => !current)
                }
                onTogglePictureInPicture={() => void handleTogglePictureInPicture()}
                onToggleRecording={() => void handleToggleRecording()}
                onToggleScreenShare={() => void handleToggleScreenShare()}
                onToggleTranscript={() =>
                  setIsTranscriptOpen((current) => !current)
                }
                onToggleWidescreen={() =>
                  setIsWidescreenPreferred((current) => !current)
                }
                selectedAudioDeviceId={audioInputId}
                selectedVideoDeviceId={videoInputId}
                transcriptCount={transcriptPreview.length}
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

function ChronosParticipantIdentityCaption({
  participant,
}: {
  participant: ChronosRoomParticipant;
}) {
  const organization = participant.organization?.trim() || "Empresa nao informada";

  return (
    <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 z-30 rounded-b-[0.85rem] bg-gradient-to-t from-black/95 via-black/70 to-transparent px-3 pb-3 pt-12 text-white">
      <h3 className="m-0 max-w-full truncate text-sm font-semibold leading-tight">
        {participant.displayName}
      </h3>
      <p className="m-0 mt-1 max-w-full truncate text-xs font-medium leading-tight text-white/78">
        {organization}
      </p>
    </div>
  );
}

type ChronosLiveKitControlBarProps = {
  audioDevices: MediaDeviceOption[];
  backgroundDataUrl: string;
  backgroundMode: ChronosVirtualBackgroundMode;
  cameraEnabled: boolean;
  chatCount: number;
  isChatOpen: boolean;
  isHdVideoPreferred: boolean;
  isMuted: boolean;
  isNoiseReductionEnabled: boolean;
  isPictureInPictureActive: boolean;
  isPictureInPictureAvailable: boolean;
  isRecording: boolean;
  isRecordingBusy: boolean;
  isScreenSharing: boolean;
  isTranscriptOpen: boolean;
  isWidescreenPreferred: boolean;
  onBackgroundUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onEnd: () => void;
  onSelectAudioDevice: (deviceId: string) => void;
  onSelectBackgroundEffect: (input: ChronosBackgroundEffectInput) => void;
  onSelectVideoDevice: (deviceId: string) => void;
  onToggleCamera: () => void;
  onToggleChat: () => void;
  onToggleHdVideo: () => void;
  onToggleMicrophone: () => void;
  onToggleNoiseReduction: () => void;
  onTogglePictureInPicture: () => void;
  onToggleRecording: () => void;
  onToggleScreenShare: () => void;
  onToggleTranscript: () => void;
  onToggleWidescreen: () => void;
  recordingSeconds: number;
  recordingStorageStatus:
    | "failed"
    | "idle"
    | "recording"
    | "saved"
    | "starting"
    | "uploading";
  selectedAudioDeviceId: string;
  selectedVideoDeviceId: string;
  transcriptCount: number;
  videoDevices: MediaDeviceOption[];
};

type ChronosPreJoinSettingsDialogProps = {
  activePanel: "background" | "settings";
  audioDevices: MediaDeviceOption[];
  backgroundDataUrl: string;
  backgroundMode: ChronosVirtualBackgroundMode;
  cameraEnabled: boolean;
  disabled: boolean;
  isHdVideoPreferred: boolean;
  isNoiseReductionEnabled: boolean;
  isWidescreenPreferred: boolean;
  onBackgroundUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onClose: () => void;
  onPanelChange: (panel: "background" | "settings") => void;
  onSelectAudioDevice: (deviceId: string) => void;
  onSelectBackgroundEffect: (input: ChronosBackgroundEffectInput) => void;
  onSelectVideoDevice: (deviceId: string) => void;
  onToggleHdVideo: () => void;
  onToggleNoiseReduction: () => void;
  onToggleWidescreen: () => void;
  participantLabel: string;
  previewVideoRef: RefObject<HTMLVideoElement | null>;
  selectedAudioDeviceId: string;
  selectedVideoDeviceId: string;
  stream: MediaStream | null;
  videoDevices: MediaDeviceOption[];
};

function ChronosPreJoinSettingsDialog({
  activePanel,
  audioDevices,
  backgroundDataUrl,
  backgroundMode,
  cameraEnabled,
  disabled,
  isHdVideoPreferred,
  isNoiseReductionEnabled,
  isWidescreenPreferred,
  onBackgroundUpload,
  onClose,
  onPanelChange,
  onSelectAudioDevice,
  onSelectBackgroundEffect,
  onSelectVideoDevice,
  onToggleHdVideo,
  onToggleNoiseReduction,
  onToggleWidescreen,
  participantLabel,
  previewVideoRef,
  selectedAudioDeviceId,
  selectedVideoDeviceId,
  stream,
  videoDevices,
}: ChronosPreJoinSettingsDialogProps) {
  return (
    <div
      aria-labelledby="chronos-prejoin-settings-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 px-4 py-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
    >
      <section className="relative grid max-h-[min(44rem,calc(100svh-2rem))] w-full max-w-5xl overflow-hidden rounded-2xl bg-white text-[#101820] shadow-2xl ring-1 ring-black/10">
        <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="min-h-0 overflow-y-auto p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-[#667085]">
                  Preferencias da chamada
                </p>
                <h2
                  className="m-0 mt-1 text-2xl font-semibold"
                  id="chronos-prejoin-settings-title"
                >
                  Configuracoes
                </h2>
              </div>
              <button
                aria-label="Fechar configuracoes"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#d9e0e7] bg-white text-[#475467] transition hover:bg-[#f1f5f9] hover:text-[#101820] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={onClose}
                type="button"
              >
                <X aria-hidden="true" size={20} />
              </button>
            </div>

            <div className="mt-5 inline-flex rounded-xl border border-[#d9e0e7] bg-[#f8fafc] p-1">
              <ChronosPreJoinSettingsTab
                active={activePanel === "settings"}
                label="Audio e Video"
                onClick={() => onPanelChange("settings")}
              />
              <ChronosPreJoinSettingsTab
                active={activePanel === "background"}
                label="Efeitos"
                onClick={() => onPanelChange("background")}
              />
            </div>

            <div className="mt-5">
              {activePanel === "background" ? (
                <ChronosPreJoinBackgroundLibrary
                  backgroundDataUrl={backgroundDataUrl}
                  backgroundMode={backgroundMode}
                  disabled={disabled}
                  onBackgroundUpload={onBackgroundUpload}
                  onSelectBackgroundEffect={onSelectBackgroundEffect}
                />
              ) : (
                <ChronosPreJoinDeviceSettingsContent
                  audioDevices={audioDevices}
                  isHdVideoPreferred={isHdVideoPreferred}
                  isNoiseReductionEnabled={isNoiseReductionEnabled}
                  isWidescreenPreferred={isWidescreenPreferred}
                  onSelectAudioDevice={onSelectAudioDevice}
                  onSelectVideoDevice={onSelectVideoDevice}
                  onToggleHdVideo={onToggleHdVideo}
                  onToggleNoiseReduction={onToggleNoiseReduction}
                  onToggleWidescreen={onToggleWidescreen}
                  selectedAudioDeviceId={selectedAudioDeviceId}
                  selectedVideoDeviceId={selectedVideoDeviceId}
                  videoDevices={videoDevices}
                />
              )}
            </div>
          </div>

          <aside className="min-h-0 border-t border-[#d9e0e7] bg-[#101820] p-4 text-white lg:border-l lg:border-t-0">
            <ChronosPreJoinPreview
              backgroundDataUrl={backgroundDataUrl}
              backgroundMode={backgroundMode}
              cameraEnabled={cameraEnabled}
              participantLabel={participantLabel}
              previewVideoRef={previewVideoRef}
              stream={stream}
            />
          </aside>
        </div>
      </section>
    </div>
  );
}

type ChronosPreJoinSettingsTabProps = {
  active: boolean;
  label: string;
  onClick: () => void;
};

function ChronosPreJoinSettingsTab({
  active,
  label,
  onClick,
}: ChronosPreJoinSettingsTabProps) {
  return (
    <button
      aria-pressed={active}
      className={`rounded-lg px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
        active
          ? "bg-[#101820] text-white shadow-sm"
          : "text-[#475467] hover:bg-white hover:text-[#101820]"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

type ChronosPreJoinPreviewProps = {
  backgroundDataUrl: string;
  backgroundMode: ChronosVirtualBackgroundMode;
  cameraEnabled: boolean;
  participantLabel: string;
  previewVideoRef: RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
};

function ChronosPreJoinPreview({
  backgroundDataUrl,
  backgroundMode,
  cameraEnabled,
  participantLabel,
  previewVideoRef,
  stream,
}: ChronosPreJoinPreviewProps) {
  const hasActiveVideo = Boolean(cameraEnabled && stream?.getVideoTracks().length);
  const previewBackground =
    backgroundMode === "image" && backgroundDataUrl
      ? `linear-gradient(rgba(16,24,32,0.08), rgba(16,24,32,0.08)), url(${backgroundDataUrl})`
      : "linear-gradient(135deg, #111820, #182431)";

  return (
    <div className="grid h-full min-h-0 content-start gap-4">
      <div
        className="relative aspect-video overflow-hidden rounded-xl border border-white/15 bg-center shadow-2xl"
        style={{
          backgroundImage: previewBackground,
          backgroundRepeat: "no-repeat",
          backgroundSize: backgroundMode === "image" ? "contain" : "cover",
        }}
      >
        {hasActiveVideo ? (
          <video
            autoPlay
            className="absolute inset-0 h-full w-full rounded-xl object-cover"
            muted
            playsInline
            ref={previewVideoRef}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-center">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-white/12 text-lg font-semibold text-white">
              {getInitials(participantLabel || "Chronos")}
            </span>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4">
          <strong className="block truncate text-sm">
            {participantLabel || "Participante"}
          </strong>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.05] p-4">
        <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-white/55">
          Preview
        </p>
        <p className="m-0 mt-2 text-sm leading-relaxed text-white/72">
          Ajuste camera, microfone e fundo antes de participar.
        </p>
      </div>
    </div>
  );
}

type ChronosPreJoinDeviceSettingsContentProps = {
  audioDevices: MediaDeviceOption[];
  isHdVideoPreferred: boolean;
  isNoiseReductionEnabled: boolean;
  isWidescreenPreferred: boolean;
  onSelectAudioDevice: (deviceId: string) => void;
  onSelectVideoDevice: (deviceId: string) => void;
  onToggleHdVideo: () => void;
  onToggleNoiseReduction: () => void;
  onToggleWidescreen: () => void;
  selectedAudioDeviceId: string;
  selectedVideoDeviceId: string;
  videoDevices: MediaDeviceOption[];
};

function ChronosPreJoinDeviceSettingsContent({
  audioDevices,
  isHdVideoPreferred,
  isNoiseReductionEnabled,
  isWidescreenPreferred,
  onSelectAudioDevice,
  onSelectVideoDevice,
  onToggleHdVideo,
  onToggleNoiseReduction,
  onToggleWidescreen,
  selectedAudioDeviceId,
  selectedVideoDeviceId,
  videoDevices,
}: ChronosPreJoinDeviceSettingsContentProps) {
  return (
    <div className="grid gap-4">
      <ChronosPreJoinSettingsSelect
        icon={<Video aria-hidden="true" size={17} />}
        label="Camera"
        onChange={onSelectVideoDevice}
        options={videoDevices}
        value={selectedVideoDeviceId}
      />
      <ChronosPreJoinSettingsSelect
        icon={<Mic aria-hidden="true" size={17} />}
        label="Microfone"
        onChange={onSelectAudioDevice}
        options={audioDevices}
        value={selectedAudioDeviceId}
      />
      <div className="mt-1 grid gap-2 border-t border-[#d9e0e7] pt-4">
        <ChronosPreJoinSettingsToggle
          checked={isNoiseReductionEnabled}
          description="Reduz ruido de fundo quando o processador estiver disponivel."
          label="Reducao de ruido"
          onClick={onToggleNoiseReduction}
        />
        <ChronosPreJoinSettingsToggle
          checked={isHdVideoPreferred}
          description="Prefere camera em alta definicao quando o navegador permitir."
          label="Video em HD"
          onClick={onToggleHdVideo}
        />
        <ChronosPreJoinSettingsToggle
          checked={isWidescreenPreferred}
          description="Usa enquadramento largo para salas executivas."
          label="Modo widescreen"
          onClick={onToggleWidescreen}
        />
      </div>
    </div>
  );
}

type ChronosPreJoinSettingsSelectProps = {
  icon: ReactNode;
  label: string;
  onChange: (deviceId: string) => void;
  options: MediaDeviceOption[];
  value: string;
};

function ChronosPreJoinSettingsSelect({
  icon,
  label,
  onChange,
  options,
  value,
}: ChronosPreJoinSettingsSelectProps) {
  return (
    <label className="grid gap-1 text-xs font-bold uppercase text-[#667085]">
      {label}
      <span className="flex min-w-0 items-center gap-2 rounded-lg border border-[#d9e0e7] bg-white px-3 text-[#101820] focus-within:border-[#A07C3B]">
        <span className="shrink-0 text-[#667085]">{icon}</span>
        <select
          className="h-11 min-w-0 flex-1 bg-transparent text-sm normal-case outline-none"
          onChange={(event) => onChange(event.target.value)}
          value={value}
        >
          <option value={defaultDeviceValue}>{label} padrao</option>
          {options.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

type ChronosPreJoinSettingsToggleProps = {
  checked: boolean;
  description: string;
  label: string;
  onClick: () => void;
};

function ChronosPreJoinSettingsToggle({
  checked,
  description,
  label,
  onClick,
}: ChronosPreJoinSettingsToggleProps) {
  return (
    <button
      aria-pressed={checked}
      className="flex min-h-16 items-center justify-between gap-4 rounded-xl border border-[#d9e0e7] bg-[#f8fafc] px-4 py-3 text-left transition hover:border-[#A07C3B]/45 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
      onClick={onClick}
      type="button"
    >
      <span className="min-w-0">
        <strong className="block text-sm text-[#101820]">{label}</strong>
        <span className="mt-1 block text-xs leading-relaxed text-[#667085]">
          {description}
        </span>
      </span>
      <span
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${
          checked ? "bg-emerald-500" : "bg-[#cbd5e1]"
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </span>
    </button>
  );
}

type ChronosPreJoinBackgroundLibraryProps = {
  backgroundDataUrl: string;
  backgroundMode: ChronosVirtualBackgroundMode;
  disabled: boolean;
  onBackgroundUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectBackgroundEffect: (input: ChronosBackgroundEffectInput) => void;
};

function ChronosPreJoinBackgroundLibrary({
  backgroundDataUrl,
  backgroundMode,
  disabled,
  onBackgroundUpload,
  onSelectBackgroundEffect,
}: ChronosPreJoinBackgroundLibraryProps) {
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-3 gap-3">
        <ChronosPreJoinBackgroundOptionButton
          active={backgroundMode === "none"}
          disabled={disabled}
          icon={<Ban aria-hidden="true" size={19} />}
          label="Nenhum"
          onClick={() => onSelectBackgroundEffect({ mode: "none" })}
        />
        <ChronosPreJoinBackgroundOptionButton
          active={backgroundMode === "blur-low"}
          disabled={disabled}
          icon={<Droplet aria-hidden="true" size={19} />}
          label="Leve"
          onClick={() => onSelectBackgroundEffect({ mode: "blur-low" })}
        />
        <ChronosPreJoinBackgroundOptionButton
          active={backgroundMode === "blur-high"}
          disabled={disabled}
          icon={<Droplets aria-hidden="true" size={19} />}
          label="Intenso"
          onClick={() => onSelectBackgroundEffect({ mode: "blur-high" })}
        />
      </div>

      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <strong className="text-sm">Biblioteca Chronos</strong>
          <span className="rounded-full bg-[#eef2f6] px-2.5 py-1 text-xs font-semibold text-[#475467]">
            {chronosBackgroundPresetDefinitions.length} fundos
          </span>
        </div>
        <div className="grid max-h-[19rem] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
          {chronosBackgroundPresetDefinitions.map((preset) => {
            const dataUrl = getChronosBackgroundPresetDataUrl(preset);
            const isActive =
              backgroundMode === "image" && backgroundDataUrl === dataUrl;

            return (
              <ChronosPreJoinBackgroundPresetButton
                active={isActive}
                dataUrl={dataUrl}
                disabled={disabled}
                key={preset.id}
                label={preset.label}
                onClick={() =>
                  onSelectBackgroundEffect({
                    dataUrl,
                    mode: "image",
                  })
                }
              />
            );
          })}
        </div>
      </div>

      <label className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#101820] transition hover:border-[#A07C3B]/45 hover:bg-[#f8fafc] focus-within:ring-2 focus-within:ring-[#A07C3B]">
        <ImagePlus aria-hidden="true" size={16} />
        Fundo personalizado
        <input
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={disabled}
          onChange={onBackgroundUpload}
          type="file"
        />
      </label>
    </div>
  );
}

type ChronosPreJoinBackgroundOptionButtonProps = {
  active: boolean;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
};

function ChronosPreJoinBackgroundOptionButton({
  active,
  disabled,
  icon,
  label,
  onClick,
}: ChronosPreJoinBackgroundOptionButtonProps) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className="grid min-h-24 place-items-center gap-2 rounded-xl border border-[#d9e0e7] bg-[#f8fafc] p-3 text-sm font-semibold text-[#475467] transition hover:border-[#A07C3B]/45 hover:bg-white disabled:cursor-not-allowed disabled:opacity-45 aria-pressed:border-[#A07C3B] aria-pressed:bg-[#fff8ea] aria-pressed:text-[#101820] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-[#101820] shadow-sm ring-1 ring-[#d9e0e7]">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

type ChronosPreJoinBackgroundPresetButtonProps = {
  active: boolean;
  dataUrl: string;
  disabled: boolean;
  label: string;
  onClick: () => void;
};

function ChronosPreJoinBackgroundPresetButton({
  active,
  dataUrl,
  disabled,
  label,
  onClick,
}: ChronosPreJoinBackgroundPresetButtonProps) {
  return (
    <button
      aria-label={`Usar fundo ${label}`}
      aria-pressed={active}
      className="grid gap-2 rounded-xl border border-[#d9e0e7] bg-white p-2 text-sm font-semibold text-[#475467] transition hover:border-[#A07C3B]/45 disabled:cursor-not-allowed disabled:opacity-45 aria-pressed:border-[#A07C3B] aria-pressed:bg-[#fff8ea] aria-pressed:text-[#101820] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span
        className="block aspect-video rounded-lg bg-cover bg-center shadow-inner"
        style={{ backgroundImage: `url("${dataUrl}")` }}
      />
      <span className="truncate">{label}</span>
    </button>
  );
}

function ChronosLiveKitControlBar({
  audioDevices,
  backgroundDataUrl,
  backgroundMode,
  cameraEnabled,
  chatCount,
  isChatOpen,
  isHdVideoPreferred,
  isMuted,
  isNoiseReductionEnabled,
  isPictureInPictureActive,
  isPictureInPictureAvailable,
  isRecording,
  isRecordingBusy,
  isScreenSharing,
  isTranscriptOpen,
  isWidescreenPreferred,
  onBackgroundUpload,
  onEnd,
  onSelectAudioDevice,
  onSelectBackgroundEffect,
  onSelectVideoDevice,
  onToggleCamera,
  onToggleChat,
  onToggleHdVideo,
  onToggleMicrophone,
  onToggleNoiseReduction,
  onTogglePictureInPicture,
  onToggleRecording,
  onToggleScreenShare,
  onToggleTranscript,
  onToggleWidescreen,
  recordingSeconds,
  recordingStorageStatus,
  selectedAudioDeviceId,
  selectedVideoDeviceId,
  transcriptCount,
  videoDevices,
}: ChronosLiveKitControlBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  return (
    <div className="relative z-40 flex justify-center">
      <div className="inline-flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-1 overflow-visible rounded-2xl bg-[#101820]/92 p-1.5 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-md">
        <ChronosLiveKitHoverMenu
          menuId="background"
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          panel={
            <ChronosBackgroundEffectsPanel
              backgroundDataUrl={backgroundDataUrl}
              backgroundMode={backgroundMode}
              disabled={isScreenSharing}
              onBackgroundUpload={onBackgroundUpload}
              onSelectBackgroundEffect={onSelectBackgroundEffect}
            />
          }
        >
          <ChronosLiveKitControlButton
            active={backgroundMode !== "none"}
            label="Efeitos de fundo"
            onClick={() =>
              setOpenMenu((currentMenu) =>
                currentMenu === "background" ? null : "background",
              )
            }
          >
            <Sparkles aria-hidden="true" size={18} />
          </ChronosLiveKitControlButton>
        </ChronosLiveKitHoverMenu>
        <ChronosLiveKitHoverMenu
          menuId="microphone"
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          panel={
            <div className="grid gap-2">
              <ChronosLiveKitPanelTitle icon={<Mic size={14} />}>
                Microfone
              </ChronosLiveKitPanelTitle>
              <ChronosLiveKitSelect
                label="Microfone"
                onChange={onSelectAudioDevice}
                options={audioDevices}
                value={selectedAudioDeviceId}
              />
              <ChronosLiveKitMenuToggle
                checked={isNoiseReductionEnabled}
                label="Reducao de ruido"
                onClick={onToggleNoiseReduction}
              />
            </div>
          }
        >
          <ChronosLiveKitControlButton
            danger={isMuted}
            label={isMuted ? "Ativar microfone" : "Silenciar microfone"}
            onClick={onToggleMicrophone}
          >
            {isMuted ? (
              <MicOff aria-hidden="true" size={18} />
            ) : (
              <Mic aria-hidden="true" size={18} />
            )}
          </ChronosLiveKitControlButton>
        </ChronosLiveKitHoverMenu>
        <ChronosLiveKitHoverMenu
          menuId="camera"
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          panel={
            <div className="grid gap-2">
              <ChronosLiveKitPanelTitle icon={<Video size={14} />}>
                Camera
              </ChronosLiveKitPanelTitle>
              <ChronosLiveKitSelect
                label="Camera"
                onChange={onSelectVideoDevice}
                options={videoDevices}
                value={selectedVideoDeviceId}
              />
              <ChronosLiveKitMenuToggle
                checked={cameraEnabled}
                label="Camera ativa"
                onClick={onToggleCamera}
              />
              <ChronosLiveKitMenuToggle
                checked={isHdVideoPreferred}
                label="Video em HD"
                onClick={onToggleHdVideo}
              />
              <ChronosLiveKitMenuToggle
                checked={isWidescreenPreferred}
                label="Widescreen"
                onClick={onToggleWidescreen}
              />
            </div>
          }
        >
          <ChronosLiveKitControlButton
            danger={!cameraEnabled}
            label={cameraEnabled ? "Desligar camera" : "Ligar camera"}
            onClick={onToggleCamera}
          >
            {cameraEnabled ? (
              <Video aria-hidden="true" size={18} />
            ) : (
              <VideoOff aria-hidden="true" size={18} />
            )}
          </ChronosLiveKitControlButton>
        </ChronosLiveKitHoverMenu>
        <ChronosLiveKitControlButton
          active={isScreenSharing}
          label={
            isScreenSharing
              ? "Parar compartilhamento de tela"
              : "Compartilhar tela"
          }
          onClick={onToggleScreenShare}
        >
          {isScreenSharing ? (
            <ScreenShareOff aria-hidden="true" size={18} />
          ) : (
            <ScreenShare aria-hidden="true" size={18} />
          )}
        </ChronosLiveKitControlButton>
        <span className="mx-1 h-7 w-px shrink-0 bg-white/10" />
        <ChronosLiveKitHoverMenu
          menuId="recording"
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          panel={
            <ChronosRecordingStatusPanel
              isRecording={isRecording}
              isRecordingBusy={isRecordingBusy}
              recordingSeconds={recordingSeconds}
              recordingStorageStatus={recordingStorageStatus}
            />
          }
        >
          <ChronosLiveKitControlButton
            danger={isRecording}
            disabled={isRecordingBusy}
            label={isRecording ? "Parar gravacao" : "Iniciar gravacao"}
            onClick={onToggleRecording}
          >
            {isRecordingBusy ? (
              <Loader2 aria-hidden="true" className="animate-spin" size={17} />
            ) : isRecording ? (
              <Square aria-hidden="true" size={17} />
            ) : (
              <Radio aria-hidden="true" size={18} />
            )}
          </ChronosLiveKitControlButton>
        </ChronosLiveKitHoverMenu>
        <ChronosLiveKitControlButton
          active={isChatOpen}
          badge={chatCount}
          label={isChatOpen ? "Ocultar chat" : "Abrir chat"}
          onClick={onToggleChat}
        >
          <MessageSquare aria-hidden="true" size={18} />
        </ChronosLiveKitControlButton>
        <ChronosLiveKitControlButton
          active={isTranscriptOpen}
          badge={transcriptCount}
          label={
            isTranscriptOpen
              ? "Ocultar transcricao da reuniao"
              : "Abrir transcricao da reuniao"
          }
          onClick={onToggleTranscript}
        >
          <Captions aria-hidden="true" size={18} />
        </ChronosLiveKitControlButton>
        <ChronosLiveKitControlButton
          active={isPictureInPictureActive}
          disabled={!isPictureInPictureAvailable}
          label={
            isPictureInPictureActive
              ? "Fechar picture-in-picture"
              : "Abrir picture-in-picture"
          }
          onClick={onTogglePictureInPicture}
        >
          <PictureInPicture2 aria-hidden="true" size={18} />
        </ChronosLiveKitControlButton>
        <ChronosLiveKitHoverMenu
          align="right"
          menuId="settings"
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          panel={
            <ChronosLiveKitDeviceSettingsPanel
              audioDevices={audioDevices}
              isHdVideoPreferred={isHdVideoPreferred}
              isNoiseReductionEnabled={isNoiseReductionEnabled}
              isWidescreenPreferred={isWidescreenPreferred}
              onSelectAudioDevice={onSelectAudioDevice}
              onSelectVideoDevice={onSelectVideoDevice}
              onToggleHdVideo={onToggleHdVideo}
              onToggleNoiseReduction={onToggleNoiseReduction}
              onToggleWidescreen={onToggleWidescreen}
              selectedAudioDeviceId={selectedAudioDeviceId}
              selectedVideoDeviceId={selectedVideoDeviceId}
              videoDevices={videoDevices}
            />
          }
        >
          <ChronosLiveKitControlButton
            label="Configuracoes"
            onClick={() =>
              setOpenMenu((currentMenu) =>
                currentMenu === "settings" ? null : "settings",
              )
            }
          >
            <SlidersHorizontal aria-hidden="true" size={18} />
          </ChronosLiveKitControlButton>
        </ChronosLiveKitHoverMenu>
        <span className="mx-1 h-7 w-px shrink-0 bg-white/10" />
        <ChronosLiveKitControlButton danger label="Encerrar chamada" onClick={onEnd}>
          <PhoneOff aria-hidden="true" size={18} />
        </ChronosLiveKitControlButton>
      </div>
    </div>
  );
}

type ChronosRecordingStatusPanelProps = {
  isRecording: boolean;
  isRecordingBusy: boolean;
  recordingSeconds: number;
  recordingStorageStatus:
    | "failed"
    | "idle"
    | "recording"
    | "saved"
    | "starting"
    | "uploading";
};

function ChronosRecordingStatusPanel({
  isRecording,
  isRecordingBusy,
  recordingSeconds,
  recordingStorageStatus,
}: ChronosRecordingStatusPanelProps) {
  const statusText = isRecordingBusy
    ? "Preparando gravacao"
    : isRecording
      ? "Gravacao em andamento"
      : recordingStorageStatus === "saved"
        ? "Ultima gravacao salva"
        : recordingStorageStatus === "failed"
          ? "Falha na ultima gravacao"
          : "Gravacao parada";

  return (
    <div className="grid gap-3">
      <ChronosLiveKitPanelTitle icon={<Radio size={14} />}>
        Gravacao
      </ChronosLiveKitPanelTitle>
      <div className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.06] p-3">
        <span className="text-xs font-bold uppercase text-white/55">
          Status
        </span>
        <strong className="text-sm text-white">{statusText}</strong>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1 rounded-lg border border-white/10 bg-black/20 p-3">
          <span className="text-xs font-bold uppercase text-white/50">
            Duracao
          </span>
          <strong className="font-mono text-sm text-white">
            {formatChronosDuration(recordingSeconds)}
          </strong>
        </div>
        <div className="grid gap-1 rounded-lg border border-white/10 bg-black/20 p-3">
          <span className="text-xs font-bold uppercase text-white/50">
            Transcricao
          </span>
          <strong className="text-sm text-white">Audio dedicado</strong>
        </div>
      </div>
      <p className="m-0 text-xs leading-relaxed text-white/62">
        O video fica como evidencia no Drive. Um audio separado alimenta a
        transcricao pos-gravacao e reduz o peso das reunioes longas.
      </p>
    </div>
  );
}

type ChronosLiveKitHoverMenuProps = {
  align?: "center" | "right";
  children: ReactNode;
  menuId: string;
  openMenu: string | null;
  panel: ReactNode;
  setOpenMenu: Dispatch<SetStateAction<string | null>>;
};

function ChronosLiveKitHoverMenu({
  align = "center",
  children,
  menuId,
  openMenu,
  panel,
  setOpenMenu,
}: ChronosLiveKitHoverMenuProps) {
  const closeTimerRef = useRef<number | null>(null);
  const isOpen = openMenu === menuId;
  const alignClassName =
    align === "right"
      ? "right-0"
      : "left-1/2 -translate-x-1/2";

  function clearCloseTimer() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function openMenuPanel() {
    clearCloseTimer();
    setOpenMenu(menuId);
  }

  function scheduleCloseMenu() {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpenMenu(null);
      closeTimerRef.current = null;
    }, 160);
  }

  return (
    <div
      className="relative shrink-0"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;

        if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
          scheduleCloseMenu();
        }
      }}
      onFocus={openMenuPanel}
      onMouseEnter={openMenuPanel}
      onMouseLeave={scheduleCloseMenu}
    >
      {children}
      <div
        className={`absolute bottom-full z-50 mb-2 max-h-[min(32rem,calc(100svh-8rem))] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-white/15 bg-[#101820]/96 p-3 text-white shadow-2xl ring-1 ring-black/35 backdrop-blur-md transition duration-150 ${alignClassName} ${
          isOpen
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none translate-y-1 opacity-0"
        }`}
      >
        {panel}
      </div>
    </div>
  );
}

type ChronosLiveKitPanelTitleProps = {
  children: ReactNode;
  icon: ReactNode;
};

function ChronosLiveKitPanelTitle({
  children,
  icon,
}: ChronosLiveKitPanelTitleProps) {
  return (
    <strong className="mb-1 inline-flex items-center gap-2 border-b border-white/10 pb-2 text-xs uppercase tracking-[0.08em] text-white/62">
      {icon}
      {children}
    </strong>
  );
}

type ChronosLiveKitSelectProps = {
  label: string;
  onChange: (deviceId: string) => void;
  options: MediaDeviceOption[];
  value: string;
};

function ChronosLiveKitSelect({
  label,
  onChange,
  options,
  value,
}: ChronosLiveKitSelectProps) {
  return (
    <label className="grid gap-1 text-[0.68rem] font-bold uppercase text-white/55">
      {label}
      <select
        className="h-10 w-full min-w-0 rounded-lg border border-white/15 bg-black/35 px-3 text-sm normal-case text-white outline-none focus:border-[#A07C3B]"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value={defaultDeviceValue}>{label} padrao</option>
        {options.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label}
          </option>
        ))}
      </select>
    </label>
  );
}

type ChronosLiveKitMenuToggleProps = {
  checked: boolean;
  label: string;
  onClick: () => void;
};

function ChronosLiveKitMenuToggle({
  checked,
  label,
  onClick,
}: ChronosLiveKitMenuToggleProps) {
  return (
    <button
      aria-pressed={checked}
      className="flex min-h-10 items-center justify-between gap-4 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-left text-sm font-semibold text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      <span
        className={`relative h-6 w-10 rounded-full transition ${
          checked ? "bg-emerald-500" : "bg-white/25"
        }`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${
            checked ? "left-5" : "left-1"
          }`}
        />
      </span>
    </button>
  );
}

type ChronosLiveKitDeviceSettingsPanelProps = {
  audioDevices: MediaDeviceOption[];
  isHdVideoPreferred: boolean;
  isNoiseReductionEnabled: boolean;
  isWidescreenPreferred: boolean;
  onSelectAudioDevice: (deviceId: string) => void;
  onSelectVideoDevice: (deviceId: string) => void;
  onToggleHdVideo: () => void;
  onToggleNoiseReduction: () => void;
  onToggleWidescreen: () => void;
  selectedAudioDeviceId: string;
  selectedVideoDeviceId: string;
  videoDevices: MediaDeviceOption[];
};

function ChronosLiveKitDeviceSettingsPanel({
  audioDevices,
  isHdVideoPreferred,
  isNoiseReductionEnabled,
  isWidescreenPreferred,
  onSelectAudioDevice,
  onSelectVideoDevice,
  onToggleHdVideo,
  onToggleNoiseReduction,
  onToggleWidescreen,
  selectedAudioDeviceId,
  selectedVideoDeviceId,
  videoDevices,
}: ChronosLiveKitDeviceSettingsPanelProps) {
  return (
    <div className="grid gap-3">
      <ChronosLiveKitPanelTitle icon={<SlidersHorizontal size={14} />}>
        Dispositivos
      </ChronosLiveKitPanelTitle>
      <ChronosLiveKitSelect
        label="Camera"
        onChange={onSelectVideoDevice}
        options={videoDevices}
        value={selectedVideoDeviceId}
      />
      <ChronosLiveKitSelect
        label="Microfone"
        onChange={onSelectAudioDevice}
        options={audioDevices}
        value={selectedAudioDeviceId}
      />
      <div className="grid gap-2 border-t border-white/10 pt-3">
        <ChronosLiveKitMenuToggle
          checked={isNoiseReductionEnabled}
          label="Reducao de ruido"
          onClick={onToggleNoiseReduction}
        />
        <ChronosLiveKitMenuToggle
          checked={isHdVideoPreferred}
          label="Video em HD"
          onClick={onToggleHdVideo}
        />
        <ChronosLiveKitMenuToggle
          checked={isWidescreenPreferred}
          label="Modo widescreen"
          onClick={onToggleWidescreen}
        />
      </div>
    </div>
  );
}

type ChronosBackgroundEffectsPanelProps = {
  backgroundDataUrl: string;
  backgroundMode: ChronosVirtualBackgroundMode;
  disabled: boolean;
  onBackgroundUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectBackgroundEffect: (input: ChronosBackgroundEffectInput) => void;
};

function ChronosBackgroundEffectsPanel({
  backgroundDataUrl,
  backgroundMode,
  disabled,
  onBackgroundUpload,
  onSelectBackgroundEffect,
}: ChronosBackgroundEffectsPanelProps) {
  return (
    <div className="grid gap-3">
      <ChronosLiveKitPanelTitle icon={<Sparkles size={14} />}>
        Efeitos
      </ChronosLiveKitPanelTitle>
      <div className="grid grid-cols-3 gap-2">
        <ChronosBackgroundEffectButton
          active={backgroundMode === "none"}
          disabled={disabled}
          icon={<Ban aria-hidden="true" size={18} />}
          label="Nenhum"
          onClick={() => onSelectBackgroundEffect({ mode: "none" })}
        />
        <ChronosBackgroundEffectButton
          active={backgroundMode === "blur-low"}
          disabled={disabled}
          icon={<Droplet aria-hidden="true" size={18} />}
          label="Leve"
          onClick={() => onSelectBackgroundEffect({ mode: "blur-low" })}
        />
        <ChronosBackgroundEffectButton
          active={backgroundMode === "blur-high"}
          disabled={disabled}
          icon={<Droplets aria-hidden="true" size={18} />}
          label="Intenso"
          onClick={() => onSelectBackgroundEffect({ mode: "blur-high" })}
        />
      </div>
      <div className="grid max-h-[14rem] grid-cols-3 gap-2 overflow-y-auto pr-1">
        {chronosBackgroundPresetDefinitions.map((preset) => {
          const dataUrl = getChronosBackgroundPresetDataUrl(preset);
          const isActive =
            backgroundMode === "image" && backgroundDataUrl === dataUrl;

          return (
            <button
              aria-label={`Usar fundo ${preset.label}`}
              aria-pressed={isActive}
              className="grid gap-1 rounded-lg border border-white/10 bg-white/[0.06] p-1 text-xs font-semibold text-white/72 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45 aria-pressed:border-[#A07C3B] aria-pressed:bg-[#A07C3B]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              disabled={disabled}
              key={preset.id}
              onClick={() =>
                onSelectBackgroundEffect({
                  dataUrl,
                  mode: "image",
                })
              }
              type="button"
            >
              <span
                className="block aspect-video rounded-md bg-cover bg-center"
                style={{ backgroundImage: `url("${dataUrl}")` }}
              />
              <span>{preset.label}</span>
            </button>
          );
        })}
      </div>
      <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 text-sm font-semibold text-white transition hover:bg-white/15 focus-within:ring-2 focus-within:ring-[#A07C3B]">
        <ImagePlus aria-hidden="true" size={16} />
        Fundo personalizado
        <input
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={disabled}
          onChange={onBackgroundUpload}
          type="file"
        />
      </label>
    </div>
  );
}

type ChronosBackgroundEffectButtonProps = {
  active: boolean;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
};

function ChronosBackgroundEffectButton({
  active,
  disabled,
  icon,
  label,
  onClick,
}: ChronosBackgroundEffectButtonProps) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className="grid min-h-20 place-items-center gap-1 rounded-lg border border-white/10 bg-white/[0.06] p-2 text-xs font-semibold text-white/72 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45 aria-pressed:border-[#A07C3B] aria-pressed:bg-[#A07C3B]/20 aria-pressed:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className="grid h-9 w-9 place-items-center rounded-full bg-black/35">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

type ChronosLiveKitControlButtonProps = {
  active?: boolean;
  badge?: number;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
};

function ChronosLiveKitControlButton({
  active = false,
  badge = 0,
  children,
  danger = false,
  disabled = false,
  label,
  onClick,
}: ChronosLiveKitControlButtonProps) {
  const activeClassName = danger
    ? "bg-rose-600 text-white hover:bg-rose-500"
    : active
      ? "bg-white text-[#101820] hover:bg-white"
      : "bg-white/10 text-white hover:bg-white/15";

  return (
    <button
      aria-label={label}
      aria-pressed={active || danger}
      className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-xl transition disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${activeClassName}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
      {badge > 0 ? (
        <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#A07C3B] px-1 text-[0.62rem] font-bold text-white">
          {Math.min(badge, 9)}
        </span>
      ) : null}
    </button>
  );
}

function buildChronosLiveKitRemoteParticipantMedia(
  participant: RemoteParticipant,
) {
  const audioTracks: MediaStreamTrack[] = [];
  let cameraTrack: MediaStreamTrack | null = null;
  let screenShareTrack: MediaStreamTrack | null = null;

  participant.trackPublications.forEach((publication) => {
    const track = publication.track;
    const mediaTrack = track?.mediaStreamTrack;

    if (!track || !mediaTrack || track.isMuted) {
      return;
    }

    if (track.kind === Track.Kind.Audio) {
      audioTracks.push(mediaTrack);
      return;
    }

    if (track.kind !== Track.Kind.Video) {
      return;
    }

    if (publication.source === Track.Source.ScreenShare) {
      screenShareTrack = mediaTrack;
      return;
    }

    cameraTrack ??= mediaTrack;
  });

  const cameraStream = new MediaStream(
    [...audioTracks, cameraTrack].filter(
      (track): track is MediaStreamTrack => Boolean(track),
    ),
  );
  const screenStream = screenShareTrack
    ? new MediaStream([screenShareTrack])
    : null;

  return {
    cameraStream:
      cameraStream.getAudioTracks().length > 0 ||
      cameraStream.getVideoTracks().length > 0
        ? cameraStream
        : null,
    screenStream,
    stream:
      cameraStream.getAudioTracks().length > 0 ||
      cameraStream.getVideoTracks().length > 0
        ? cameraStream
        : screenStream,
  };
}

function parseChronosLiveKitParticipantMetadata(
  metadata?: string,
): ChronosLiveKitParticipantMetadata {
  if (!metadata) {
    return {};
  }

  try {
    const parsedValue = JSON.parse(metadata) as Record<string, unknown>;

    return {
      displayName:
        typeof parsedValue.displayName === "string"
          ? parsedValue.displayName
          : undefined,
      isHost:
        typeof parsedValue.isHost === "boolean" ? parsedValue.isHost : undefined,
      meetingId:
        typeof parsedValue.meetingId === "string"
          ? parsedValue.meetingId
          : undefined,
      organization:
        typeof parsedValue.organization === "string"
          ? parsedValue.organization
          : undefined,
      participantId:
        typeof parsedValue.participantId === "string"
          ? parsedValue.participantId
          : undefined,
      roomSlug:
        typeof parsedValue.roomSlug === "string" ? parsedValue.roomSlug : undefined,
    };
  } catch {
    return {};
  }
}

function normalizeChronosLiveKitParticipantAudioEgresses(
  value: unknown,
): ChronosLiveKitParticipantAudioEgress[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): ChronosLiveKitParticipantAudioEgress | null => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const egressId = normalizeChronosLiveKitText(record.egressId, 120);

      if (!egressId) {
        return null;
      }

      return {
        egressId,
        organization: normalizeChronosLiveKitText(record.organization, 160),
        participantId: normalizeChronosLiveKitText(record.participantId, 120),
        participantIdentity: normalizeChronosLiveKitText(
          record.participantIdentity,
          120,
        ),
        participantName: normalizeChronosLiveKitText(
          record.participantName,
          160,
        ),
        recordingId: normalizeChronosLiveKitText(record.recordingId, 120),
        storagePath: normalizeChronosLiveKitText(record.storagePath, 300),
        trackId: normalizeChronosLiveKitText(record.trackId, 120),
        trackMimeType: normalizeChronosLiveKitText(record.trackMimeType, 120),
        trackName: normalizeChronosLiveKitText(record.trackName, 160),
      } satisfies ChronosLiveKitParticipantAudioEgress;
    })
    .filter(
      (item): item is ChronosLiveKitParticipantAudioEgress => Boolean(item),
    );
}

function normalizeChronosLiveKitText(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : undefined;
}

function parseChronosLiveKitChatMessage(
  data: Uint8Array,
): ChronosChatMessage | null {
  try {
    const parsedValue = JSON.parse(new TextDecoder().decode(data)) as {
      kind?: unknown;
      message?: Partial<ChronosChatMessage>;
    };
    const message = parsedValue.message;

    if (
      parsedValue.kind !== "chat-message" ||
      !message ||
      typeof message.content !== "string" ||
      typeof message.createdAt !== "string" ||
      typeof message.id !== "string" ||
      typeof message.senderName !== "string"
    ) {
      return null;
    }

    return {
      content: message.content,
      createdAt: message.createdAt,
      id: message.id,
      participantId:
        typeof message.participantId === "string" ? message.participantId : null,
      senderName: message.senderName,
    };
  } catch {
    return null;
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
  isHdVideoPreferred,
  isWidescreenPreferred,
  noiseReductionEnabled,
  videoInputId,
}: {
  audioInputId: string;
  cameraEnabled: boolean;
  isHdVideoPreferred: boolean;
  isWidescreenPreferred: boolean;
  noiseReductionEnabled: boolean;
  videoInputId: string;
}) {
  const tracks: MediaStreamTrack[] = [];
  let lastMediaError: unknown = null;

  try {
    tracks.push(
      await requestChronosAudioTrack({
        audioInputId,
        noiseReductionEnabled,
      }),
    );
  } catch (error) {
    lastMediaError = error;
  }

  if (cameraEnabled) {
    try {
      tracks.push(
        await requestChronosVideoTrack({
          isHdVideoPreferred,
          isWidescreenPreferred,
          videoInputId,
        }),
      );
    } catch (error) {
      lastMediaError = error;
    }
  }

  if (!tracks.length) {
    throw lastMediaError ?? new Error("Nenhum dispositivo local disponivel.");
  }

  return new MediaStream(tracks);
}

async function requestChronosAudioTrack({
  audioInputId,
  noiseReductionEnabled,
}: {
  audioInputId: string;
  noiseReductionEnabled: boolean;
}) {
  let stream: MediaStream;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: createAudioDeviceConstraint({
        deviceId: audioInputId,
        noiseReductionEnabled,
      }),
      video: false,
    });
  } catch (error) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: createAudioDeviceConstraint({
          deviceId: defaultDeviceValue,
          noiseReductionEnabled,
        }),
        video: false,
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      }).catch(() => {
        throw error;
      });
    }
  }
  const audioTrack = stream.getAudioTracks()[0];

  if (!audioTrack) {
    throw new Error("Missing audio track");
  }

  return audioTrack;
}

async function requestChronosVideoTrack({
  isHdVideoPreferred,
  isWidescreenPreferred,
  videoInputId,
}: {
  isHdVideoPreferred: boolean;
  isWidescreenPreferred: boolean;
  videoInputId: string;
}) {
  let stream: MediaStream;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: createVideoDeviceConstraint({
        deviceId: videoInputId,
        isHdVideoPreferred,
        isWidescreenPreferred,
      }),
    });
  } catch (error) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: createVideoDeviceConstraint({
          deviceId: defaultDeviceValue,
          isHdVideoPreferred: false,
          isWidescreenPreferred,
        }),
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: true,
      }).catch(() => {
        throw error;
      });
    }
  }
  const videoTrack = stream.getVideoTracks()[0];

  if (!videoTrack) {
    throw new Error("Missing video track");
  }

  return videoTrack;
}

async function createChronosPreparedLocalMedia({
  backgroundDataUrl,
  backgroundMode,
  maxOutputWidth,
  sourceStream,
  targetFps = chronosVirtualBackgroundFps,
}: {
  backgroundDataUrl: string;
  backgroundMode: ChronosVirtualBackgroundMode;
  maxOutputWidth?: number;
  sourceStream: MediaStream;
  targetFps?: number;
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

    const initialSourceWidth = sourceVideo.videoWidth || 1280;
    const initialSourceHeight = sourceVideo.videoHeight || 720;
    const initialScale = getChronosPreviewCanvasScale({
      maxOutputWidth,
      sourceWidth: initialSourceWidth,
    });
    const initialWidth = Math.max(1, Math.round(initialSourceWidth * initialScale));
    const initialHeight = Math.max(
      1,
      Math.round(initialSourceHeight * initialScale),
    );
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

    const outputStream = outputCanvas.captureStream(targetFps);
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
        timestamp - lastFrameAt < 1000 / targetFps
      ) {
        return;
      }

      lastFrameAt = timestamp;

      const sourceWidth = sourceVideo.videoWidth || initialSourceWidth;
      const sourceHeight = sourceVideo.videoHeight || initialSourceHeight;
      const scale = getChronosPreviewCanvasScale({
        maxOutputWidth,
        sourceWidth,
      });
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));

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

function getChronosLiveKitBackgroundProcessorOptions({
  backgroundDataUrl,
  mode,
}: {
  backgroundDataUrl: string;
  mode: ChronosVirtualBackgroundMode;
}): ChronosLiveKitBackgroundProcessorOptions | null {
  if (mode === "none") {
    return null;
  }

  if (mode === "blur-low") {
    return {
      blurRadius: chronosLiveKitBackgroundBlurRadius.low,
      maxFps: chronosLiveKitBackgroundProcessorMaxFps,
      mode: "background-blur",
    };
  }

  if (mode === "blur-high") {
    return {
      blurRadius: chronosLiveKitBackgroundBlurRadius.high,
      maxFps: chronosLiveKitBackgroundProcessorMaxFps,
      mode: "background-blur",
    };
  }

  if (mode === "image" && backgroundDataUrl) {
    return {
      imagePath: backgroundDataUrl,
      maxFps: chronosLiveKitBackgroundProcessorMaxFps,
      mode: "virtual-background",
    };
  }

  return null;
}

function getChronosBackgroundPresetDataUrl(
  preset: (typeof chronosBackgroundPresetDefinitions)[number],
) {
  return preset.image.src;
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

function getChronosPreviewCanvasScale({
  maxOutputWidth,
  sourceWidth,
}: {
  maxOutputWidth?: number;
  sourceWidth: number;
}) {
  if (!maxOutputWidth || sourceWidth <= maxOutputWidth) {
    return 1;
  }

  return maxOutputWidth / sourceWidth;
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

function createAudioDeviceConstraint({
  deviceId,
  noiseReductionEnabled,
}: {
  deviceId: string;
  noiseReductionEnabled: boolean;
}): MediaTrackConstraints {
  const baseConstraint = {
    autoGainControl: noiseReductionEnabled,
    echoCancellation: noiseReductionEnabled,
    noiseSuppression: noiseReductionEnabled,
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

function createVideoDeviceConstraint({
  deviceId,
  isHdVideoPreferred,
  isWidescreenPreferred,
}: {
  deviceId: string;
  isHdVideoPreferred: boolean;
  isWidescreenPreferred: boolean;
}): MediaTrackConstraints {
  const width = isHdVideoPreferred ? 1280 : 960;
  const height = isHdVideoPreferred ? 720 : 540;
  const baseConstraint = {
    aspectRatio: {
      ideal: isWidescreenPreferred ? 16 / 9 : 4 / 3,
    },
    frameRate: {
      ideal: 30,
      max: 30,
    },
    height: {
      ideal: height,
    },
    width: {
      ideal: width,
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

function normalizeChronosMediaError(error: unknown) {
  if (
    error instanceof DOMException &&
    /NotAllowedError|PermissionDeniedError|SecurityError/i.test(error.name)
  ) {
    return "Nao foi possivel acessar camera ou microfone nesta aba. Verifique permissoes ou dispositivo em uso.";
  }

  if (
    error instanceof DOMException &&
    /NotFoundError|DevicesNotFoundError/i.test(error.name)
  ) {
    return "Nenhuma camera ou microfone foi encontrado neste dispositivo.";
  }

  if (
    error instanceof DOMException &&
    /NotReadableError|TrackStartError/i.test(error.name)
  ) {
    return "Camera ou microfone ja esta em uso por outro aplicativo.";
  }

  if (
    error instanceof DOMException &&
    /OverconstrainedError|ConstraintNotSatisfiedError/i.test(error.name)
  ) {
    return "Nao foi possivel usar a camera selecionada. Tente camera padrao ou reduza HD.";
  }

  return "Nao foi possivel iniciar camera ou microfone nesta sala.";
}

function normalizeChronosRecordingStorageError(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (/Supabase server-side/i.test(message)) {
    return "Configuracao de storage pendente";
  }

  if (/LiveKit Egress storage nao configurado/i.test(message)) {
    return "Configuracao de gravacao pendente";
  }

  if (/bucket|storage/i.test(message)) {
    return "Storage Chronos nao confirmou";
  }

  if (/row-level|policy|permission|unauthorized|forbidden/i.test(message)) {
    return "Permissao de storage pendente";
  }

  if (/egress/i.test(message)) {
    return "Gravacao pendente";
  }

  return "Upload da gravacao nao confirmado";
}

function getChronosRecordingStorageLabel({
  error,
  status,
}: {
  error: string;
  status: "failed" | "idle" | "recording" | "saved" | "starting" | "uploading";
}) {
  if (error) {
    return error;
  }

  if (status === "saved") {
    return "Gravacao salva no Chronos";
  }

  if (status === "recording") {
    return "Gravacao em andamento";
  }

  if (status === "starting") {
    return "Iniciando gravacao";
  }

  if (status === "uploading") {
    return "Finalizando gravacao no Chronos";
  }

  if (status === "failed") {
    return "Nao foi possivel confirmar a gravacao";
  }

  return "Gravacao pronta";
}

function wait(milliseconds: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
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

type ChronosRoomTileParticipant = {
  mediaStream: MediaStream | null;
  participant: HermesCallParticipant;
  source: ChronosRoomParticipant;
  tileId: string;
};

function buildChronosCameraTileParticipant(
  participant: ChronosRoomParticipant,
): ChronosRoomTileParticipant {
  const mediaStream =
    participant.cameraStream ??
    (!participant.isScreenSharing ? participant.stream ?? null : null);

  return {
    mediaStream,
    participant: mapChronosParticipantToHermesTile(participant, {
      isCameraOn: Boolean(
        participant.isCameraOn && mediaStream?.getVideoTracks().length,
      ),
      isScreenSharing: false,
    }),
    source: participant,
    tileId: `${participant.id}:camera`,
  };
}

function buildChronosScreenShareTileParticipant(
  participant: ChronosRoomParticipant,
): ChronosRoomTileParticipant {
  return {
    mediaStream: getChronosScreenShareStream(participant),
    participant: mapChronosParticipantToHermesTile(participant, {
      isCameraOn: true,
      isScreenSharing: true,
    }),
    source: participant,
    tileId: `${participant.id}:screen`,
  };
}

function getChronosScreenShareStream(participant: ChronosRoomParticipant) {
  return participant.screenStream ?? (participant.isScreenSharing
    ? participant.stream ?? null
    : null);
}

function mapChronosParticipantToHermesTile(
  participant: ChronosRoomParticipant,
  overrides: {
    isCameraOn?: boolean;
    isScreenSharing?: boolean;
  } = {},
): HermesCallParticipant {
  return {
    id: participant.id,
    initials: getInitials(participant.displayName),
    isCameraOn: overrides.isCameraOn ?? participant.isCameraOn,
    isMuted: participant.isMuted,
    isScreenSharing: overrides.isScreenSharing ?? participant.isScreenSharing,
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
