"use client";

import type { PulseXCallParticipant } from "@/lib/pulsex";
import { Mic, MicOff, MonitorUp, Video, VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type CallParticipantTileProps = {
  isLocalMedia?: boolean;
  layout?: "floating" | "spotlight" | "standard" | "thumbnail";
  mediaStream?: MediaStream | null;
  onVideoElementChange?: (
    participantId: PulseXCallParticipant["id"],
    videoElement: HTMLVideoElement | null,
  ) => void;
  participant: PulseXCallParticipant;
  presentationZoom?: number;
};

export function CallParticipantTile({
  isLocalMedia = false,
  layout = "standard",
  mediaStream,
  onVideoElementChange,
  participant,
  presentationZoom = 1,
}: CallParticipantTileProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const showVideo = Boolean(
    mediaStream?.getVideoTracks().length && participant.isCameraOn,
  );
  const isPresentation = Boolean(participant.isScreenSharing);
  const articleClassName =
    layout === "spotlight"
      ? "relative h-full min-h-[20rem] overflow-hidden rounded-xl border border-white/10 bg-[#101720] p-3 text-white shadow-sm"
      : layout === "floating"
        ? "relative aspect-video min-h-0 overflow-hidden rounded-xl border border-white/20 bg-[#141923] p-2 text-white shadow-2xl ring-1 ring-black/20"
      : layout === "thumbnail"
        ? "relative aspect-video min-h-0 overflow-hidden rounded-lg border border-white/15 bg-[#141923] p-2 text-white shadow-sm"
        : "relative aspect-video min-h-0 overflow-hidden rounded-lg border border-white/10 bg-[#141923] p-3 text-white shadow-sm";
  const avatarClassName =
    layout === "thumbnail" || layout === "floating"
      ? "h-11 w-11 text-xs"
      : "h-14 w-14 text-sm";
  const emptyMediaClassName =
    layout === "thumbnail" || layout === "floating"
      ? "relative flex h-full min-h-0 flex-col items-center justify-center gap-2 px-2 text-center"
      : "relative flex h-full min-h-64 flex-col items-center justify-center gap-3";

  useEffect(() => {
    const audioElement = audioRef.current;

    if (!audioElement) {
      return;
    }

    audioElement.srcObject = isLocalMedia ? null : (mediaStream ?? null);
    audioElement.muted = false;

    if (mediaStream && !isLocalMedia) {
      void audioElement
        .play()
        .then(() => setNeedsAudioUnlock(false))
        .catch(() => setNeedsAudioUnlock(true));
    }
  }, [isLocalMedia, mediaStream]);

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }

    videoRef.current.srcObject = mediaStream ?? null;
  }, [mediaStream]);

  useEffect(() => {
    if (!onVideoElementChange) {
      return;
    }

    onVideoElementChange(
      participant.id,
      showVideo ? videoRef.current : null,
    );

    return () => {
      onVideoElementChange(participant.id, null);
    };
  }, [onVideoElementChange, participant.id, showVideo]);

  return (
    <article className={articleClassName}>
      {!isLocalMedia ? <audio autoPlay ref={audioRef} /> : null}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
        <CallStateIcon enabled={!participant.isMuted} type="mic" />
        <CallStateIcon enabled={Boolean(participant.isCameraOn)} type="camera" />
        {participant.isScreenSharing ? (
          <span className="grid h-6 w-6 place-items-center rounded-md bg-[#A07C3B]/20 text-[#f2d79f]">
            <MonitorUp aria-hidden="true" size={13} />
          </span>
        ) : null}
      </div>
      {!isLocalMedia && needsAudioUnlock ? (
        <button
          className="absolute left-3 top-3 z-20 rounded-md bg-[#A07C3B] px-2 py-1 text-[0.68rem] font-semibold text-white shadow-lg transition hover:bg-[#8f6f35] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f2d79f]"
          onClick={() => {
            void audioRef.current
              ?.play()
              .then(() => setNeedsAudioUnlock(false))
              .catch(() => setNeedsAudioUnlock(true));
          }}
          type="button"
        >
          Ativar audio
        </button>
      ) : null}
      {showVideo ? (
        <video
          autoPlay
          className={`absolute inset-0 h-full w-full transform-gpu bg-black ${
            isPresentation ? "object-contain" : "object-cover"
          }`}
          disablePictureInPicture={false}
          muted
          playsInline
          ref={videoRef}
          style={
            isPresentation && presentationZoom > 1
              ? {
                  transform: `scale(${presentationZoom})`,
                }
              : undefined
          }
        />
      ) : null}
      {showVideo ? (
        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-3 pb-3 pt-10">
          <ParticipantCaption participant={participant} compact />
        </div>
      ) : (
        <div className={emptyMediaClassName}>
          <ParticipantAvatar className={avatarClassName} participant={participant} />
          <ParticipantCaption
            compact={layout === "thumbnail" || layout === "floating"}
            participant={participant}
          />
        </div>
      )}
    </article>
  );
}

function ParticipantAvatar({
  className,
  participant,
}: {
  className: string;
  participant: PulseXCallParticipant;
}) {
  return (
    <span
      className={`relative grid place-items-center rounded-full bg-[#273142] font-semibold text-white ${className}`}
    >
      {participant.initials}
      <span
        aria-hidden="true"
        className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#141923] data-[status=agenda]:bg-sky-500 data-[status=away]:bg-red-500 data-[status=busy]:bg-sky-500 data-[status=lunch]:bg-yellow-400 data-[status=offline]:bg-zinc-500 data-[status=online]:bg-emerald-500"
        data-status={participant.presenceStatus}
      />
    </span>
  );
}

function ParticipantCaption({
  compact = false,
  participant,
}: {
  compact?: boolean;
  participant: PulseXCallParticipant;
}) {
  return (
    <div className={compact ? "min-w-0" : "min-w-0 text-center"}>
      <h3 className="m-0 truncate text-sm font-semibold">
        {participant.label}
      </h3>
      <p
        className={`m-0 mt-1 truncate text-xs ${
          compact ? "text-white/75" : "text-white/55"
        }`}
      >
        {getParticipantStatusLabel(participant.status)} / {participant.role}
      </p>
    </div>
  );
}

function CallStateIcon({
  enabled,
  type,
}: {
  enabled: boolean;
  type: "camera" | "mic";
}) {
  const Icon = type === "mic" ? (enabled ? Mic : MicOff) : enabled ? Video : VideoOff;

  return (
    <span
      className="grid h-6 w-6 place-items-center rounded-md bg-white/10 text-white/75 data-[enabled=false]:text-rose-200"
      data-enabled={enabled}
    >
      <Icon aria-hidden="true" size={13} />
    </span>
  );
}

function getParticipantStatusLabel(status: PulseXCallParticipant["status"]) {
  const labels = {
    invited: "Convidado",
    joined: "Na chamada",
    left: "Saiu",
    muted: "Mutado",
  } as const satisfies Record<PulseXCallParticipant["status"], string>;

  return labels[status];
}
