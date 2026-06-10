"use client";

import { CallParticipantTile } from "@/components/pulsex/call-participant-tile";
import type { HermesCallParticipant } from "@/lib/pulsex";
import { Radio } from "lucide-react";
import {
  Room,
  RoomEvent,
  RemoteParticipant,
  Track,
  type Participant as LiveKitParticipant,
  type TrackPublication,
} from "livekit-client";
import { useEffect, useMemo, useRef, useState } from "react";

import careliMainBackground from "./assets/backgrounds/careli-main.jpeg";
import chronosCareliMark from "./assets/chronos-careli-mark.png";

type ChronosRecordingParticipant = {
  cameraStream: MediaStream | null;
  displayName: string;
  id: string;
  isCameraOn: boolean;
  isMuted: boolean;
  isScreenSharing: boolean;
  organization?: string;
  screenStream: MediaStream | null;
};

type ChronosRecordingTile = {
  mediaStream: MediaStream | null;
  participant: HermesCallParticipant;
  source: ChronosRecordingParticipant;
  tileId: string;
};

declare global {
  interface Window {
    __chronosRecordingEmitStartSignal?: () => void;
    __chronosRecordingEndLogged?: boolean;
    __chronosRecordingStartSignalBooted?: boolean;
    __chronosRecordingStartLogged?: boolean;
  }
}

export function ChronosRecordingViewPage() {
  const [participants, setParticipants] = useState<ChronosRecordingParticipant[]>(
    [],
  );
  const [status, setStatus] = useState<"connecting" | "error" | "recording">(
    "connecting",
  );
  const roomRef = useRef<Room | null>(null);
  const startLoggedRef = useRef(false);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const liveKitUrl =
      searchParams.get("url") ??
      searchParams.get("liveKitUrl") ??
      searchParams.get("wsUrl") ??
      searchParams.get("serverUrl");
    const token =
      searchParams.get("token") ??
      searchParams.get("accessToken") ??
      searchParams.get("access_token");

    if (window.__chronosRecordingStartLogged) {
      startLoggedRef.current = true;
      setStatus("recording");
    }

    if (!liveKitUrl || !token) {
      setStatus("error");
      return;
    }

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    roomRef.current = room;
    let connectionFailed = false;

    const syncParticipants = () => {
      setParticipants(
        Array.from(room.remoteParticipants.values()).map(
          mapLiveKitParticipantToChronosRecordingParticipant,
        ),
      );
    };
    const markRecordingReady = () => {
      if (connectionFailed) {
        return;
      }

      startLoggedRef.current = true;
      setStatus("recording");
      emitChronosRecordingStartSignal();
    };
    const recordingReadyFallback = window.setTimeout(
      markRecordingReady,
      3500,
    );
    const syncRemoteParticipant = (participant: LiveKitParticipant) => {
      if (participant instanceof RemoteParticipant) {
        syncParticipants();
      }
    };

    room
      .on(RoomEvent.Connected, () => {
        syncParticipants();
        window.setTimeout(markRecordingReady, 650);
      })
      .on(RoomEvent.Disconnected, () => {
        if (startLoggedRef.current) {
          emitChronosRecordingEndSignal();
        }
      })
      .on(RoomEvent.ParticipantConnected, syncParticipants)
      .on(RoomEvent.ParticipantDisconnected, syncParticipants)
      .on(RoomEvent.TrackSubscribed, syncParticipants)
      .on(RoomEvent.TrackUnsubscribed, syncParticipants)
      .on(RoomEvent.TrackMuted, (_publication: TrackPublication, participant) =>
        syncRemoteParticipant(participant),
      )
      .on(RoomEvent.TrackUnmuted, (_publication: TrackPublication, participant) =>
        syncRemoteParticipant(participant),
      )
      .on(RoomEvent.ParticipantMetadataChanged, (_metadata, participant) =>
        syncRemoteParticipant(participant),
      )
      .on(RoomEvent.ParticipantNameChanged, (_name, participant) =>
        syncRemoteParticipant(participant),
      );

    void room
      .connect(liveKitUrl, token, { autoSubscribe: true })
      .catch(() => {
        connectionFailed = true;
        window.clearTimeout(recordingReadyFallback);
        setStatus("error");
      });

    return () => {
      window.clearTimeout(recordingReadyFallback);

      if (roomRef.current === room) {
        roomRef.current = null;
      }

      if (startLoggedRef.current) {
        emitChronosRecordingEndSignal();
      }

      room.removeAllListeners();
      void room.disconnect();
    };
  }, []);

  const cameraTiles = useMemo(
    () => participants.map(buildChronosRecordingCameraTile),
    [participants],
  );
  const screenShareTile = useMemo(() => {
    const participant = participants.find(
      (currentParticipant) =>
        currentParticipant.isScreenSharing &&
        currentParticipant.screenStream?.getVideoTracks().length,
    );

    return participant ? buildChronosRecordingScreenTile(participant) : null;
  }, [participants]);

  return (
    <main
      className="relative h-[100vh] min-h-[100vh] overflow-hidden bg-[#050607] p-8 text-white"
      style={{
        backgroundImage: `linear-gradient(rgba(4,6,8,0.62), rgba(4,6,8,0.66)), url(${careliMainBackground.src})`,
        backgroundPosition: "center",
        backgroundSize: "cover",
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(160,124,59,0.16),transparent_28%),radial-gradient(circle_at_80%_84%,rgba(160,124,59,0.18),transparent_24%)]" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-8 right-9 h-32 w-32 bg-contain bg-center bg-no-repeat opacity-85"
        style={{ backgroundImage: `url(${chronosCareliMark.src})` }}
      />

      <header className="relative z-10 mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="h-9 w-9 bg-contain bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${chronosCareliMark.src})` }}
          />
          <div>
            <p className="m-0 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-white/45">
              Chronos
            </p>
            <h1 className="m-0 text-sm font-semibold text-white">
              Sala Careli
            </h1>
          </div>
        </div>

        <div className="inline-flex items-center gap-2 rounded-full border border-rose-300/35 bg-[#101820]/88 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] text-white shadow-2xl ring-1 ring-black/35 backdrop-blur-md">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-70" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-400" />
          </span>
          Gravando
        </div>
      </header>

      <section className="relative z-10 h-[calc(100vh-7rem)] min-h-0">
        {status === "error" ? (
          <div className="grid h-full place-items-center rounded-xl border border-white/10 bg-black/35 text-center text-sm font-semibold text-white/70">
            Nao foi possivel iniciar a composicao Chronos.
          </div>
        ) : screenShareTile ? (
          <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(17rem,23rem)] xl:grid-rows-1">
            <ChronosRecordingTileCard
              mediaStream={screenShareTile.mediaStream}
              participant={screenShareTile.participant}
              source={screenShareTile.source}
              variant="screen"
            />
            <aside className="min-h-0 overflow-x-auto rounded-[1rem] border border-white/12 bg-black/28 p-2 xl:overflow-y-auto">
              <div className="flex min-h-[8rem] gap-2 xl:grid xl:min-h-0 xl:grid-cols-1">
                {cameraTiles.map((tile) => (
                  <ChronosRecordingTileCard
                    key={tile.tileId}
                    mediaStream={tile.mediaStream}
                    participant={tile.participant}
                    source={tile.source}
                    variant="rail"
                  />
                ))}
              </div>
            </aside>
          </div>
        ) : cameraTiles.length > 0 ? (
          <div className={getChronosRecordingGridClassName(cameraTiles.length)}>
            {cameraTiles.map((tile) => (
              <ChronosRecordingTileCard
                key={tile.tileId}
                mediaStream={tile.mediaStream}
                participant={tile.participant}
                source={tile.source}
                variant="grid"
              />
            ))}
          </div>
        ) : (
          <div className="grid h-full place-items-center rounded-xl border border-white/10 bg-black/35">
            <div className="grid gap-3 text-center text-white/65">
              <Radio aria-hidden="true" className="mx-auto text-[#A07C3B]" />
              <p className="m-0 text-sm font-semibold">
                Aguardando participantes.
              </p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function emitChronosRecordingEndSignal() {
  if (window.__chronosRecordingEndLogged) {
    return;
  }

  window.__chronosRecordingEndLogged = true;
  console.log("END_RECORDING");
}

function emitChronosRecordingStartSignal() {
  window.__chronosRecordingStartLogged = true;

  if (typeof window.__chronosRecordingEmitStartSignal === "function") {
    window.__chronosRecordingEmitStartSignal();
    return;
  }

  console.log("START_RECORDING");
}

function ChronosRecordingTileCard({
  mediaStream,
  participant,
  source,
  variant,
}: {
  mediaStream: MediaStream | null;
  participant: HermesCallParticipant;
  source: ChronosRecordingParticipant;
  variant: "grid" | "rail" | "screen";
}) {
  const className =
    variant === "rail"
      ? "relative aspect-video w-56 shrink-0 overflow-hidden rounded-[0.85rem] border border-white/18 bg-[#101820]/54 p-1 shadow-xl ring-1 ring-black/25 xl:w-full [&_article]:h-full [&_article]:rounded-[0.75rem] [&_article]:border-0 [&_article]:p-0 [&_article]:ring-0 [&_video]:rounded-[0.7rem]"
      : "relative min-h-0 overflow-hidden rounded-[1rem] border border-white/18 bg-[#101820]/34 shadow-[0_24px_80px_rgba(0,0,0,0.32)] ring-1 ring-black/20 [&_article]:h-full [&_article]:rounded-[1rem] [&_article]:border-0 [&_article]:p-0 [&_article]:ring-0 [&_video]:rounded-[0.95rem]";

  return (
    <div className={className}>
      <CallParticipantTile
        hideCaption
        layout={variant === "rail" ? "thumbnail" : "spotlight"}
        mediaStream={mediaStream}
        participant={participant}
      />
      <div className="absolute bottom-2 left-2 z-20 max-w-[calc(100%-1rem)] rounded-md bg-black/68 px-2 py-1 text-xs font-semibold text-white shadow-lg">
        <span className="block truncate">{source.displayName}</span>
      </div>
    </div>
  );
}

function mapLiveKitParticipantToChronosRecordingParticipant(
  participant: RemoteParticipant,
): ChronosRecordingParticipant {
  const metadata = parseChronosRecordingParticipantMetadata(
    participant.metadata,
  );
  const media = buildChronosRecordingParticipantMedia(participant);

  return {
    cameraStream: media.cameraStream,
    displayName:
      participant.name || metadata.displayName || "Participante Chronos",
    id: participant.identity,
    isCameraOn: Boolean(media.cameraStream?.getVideoTracks().length),
    isMuted: !participant.isMicrophoneEnabled,
    isScreenSharing: Boolean(media.screenStream?.getVideoTracks().length),
    organization: metadata.organization,
    screenStream: media.screenStream,
  };
}

function buildChronosRecordingParticipantMedia(participant: RemoteParticipant) {
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

  return {
    cameraStream:
      cameraStream.getAudioTracks().length > 0 ||
      cameraStream.getVideoTracks().length > 0
        ? cameraStream
        : null,
    screenStream: screenShareTrack ? new MediaStream([screenShareTrack]) : null,
  };
}

function buildChronosRecordingCameraTile(
  participant: ChronosRecordingParticipant,
): ChronosRecordingTile {
  return {
    mediaStream: participant.cameraStream,
    participant: mapChronosRecordingParticipantToHermesTile(participant, {
      isCameraOn: Boolean(
        participant.isCameraOn &&
          participant.cameraStream?.getVideoTracks().length,
      ),
      isScreenSharing: false,
    }),
    source: participant,
    tileId: `${participant.id}:camera`,
  };
}

function buildChronosRecordingScreenTile(
  participant: ChronosRecordingParticipant,
): ChronosRecordingTile {
  return {
    mediaStream: participant.screenStream,
    participant: mapChronosRecordingParticipantToHermesTile(participant, {
      isCameraOn: true,
      isScreenSharing: true,
    }),
    source: participant,
    tileId: `${participant.id}:screen`,
  };
}

function mapChronosRecordingParticipantToHermesTile(
  participant: ChronosRecordingParticipant,
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

function getChronosRecordingGridClassName(participantCount: number) {
  if (participantCount <= 1) {
    return "grid h-full min-h-0 place-items-center";
  }

  if (participantCount === 2) {
    return "grid h-full min-h-0 grid-cols-2 gap-3";
  }

  if (participantCount <= 4) {
    return "grid h-full min-h-0 grid-cols-2 gap-3";
  }

  return "grid h-full min-h-0 grid-cols-3 gap-3";
}

function parseChronosRecordingParticipantMetadata(metadata?: string) {
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
      organization:
        typeof parsedValue.organization === "string"
          ? parsedValue.organization
          : undefined,
    };
  } catch {
    return {};
  }
}

function getInitials(name: string) {
  const [first = "", second = ""] = name.trim().split(/\s+/);

  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase() || "C";
}
