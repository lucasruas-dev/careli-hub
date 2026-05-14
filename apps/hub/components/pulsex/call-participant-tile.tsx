"use client";

import type { PulseXCallParticipant } from "@/lib/pulsex";
import { Mic, MicOff, MonitorUp, Video, VideoOff } from "lucide-react";
import { useEffect, useRef } from "react";

type CallParticipantTileProps = {
  isLocalMedia?: boolean;
  mediaStream?: MediaStream | null;
  participant: PulseXCallParticipant;
};

export function CallParticipantTile({
  isLocalMedia = false,
  mediaStream,
  participant,
}: CallParticipantTileProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const showVideo = Boolean(
    mediaStream?.getVideoTracks().length && participant.isCameraOn,
  );

  useEffect(() => {
    const audioElement = audioRef.current;

    if (!audioElement) {
      return;
    }

    audioElement.srcObject = isLocalMedia ? null : (mediaStream ?? null);
    audioElement.muted = false;

    if (mediaStream && !isLocalMedia) {
      void audioElement.play().catch(() => undefined);
    }
  }, [isLocalMedia, mediaStream]);

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }

    videoRef.current.srcObject = mediaStream ?? null;
  }, [mediaStream]);

  return (
    <article className="relative min-h-36 overflow-hidden rounded-lg border border-white/10 bg-[#141923] p-3 text-white shadow-sm">
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
      {showVideo ? (
        <video
          autoPlay
          className="absolute inset-0 h-full w-full object-cover"
          muted
          playsInline
          ref={videoRef}
        />
      ) : null}
      {showVideo ? (
        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-3 pb-3 pt-10">
          <ParticipantCaption participant={participant} compact />
        </div>
      ) : (
        <div className="relative flex h-full min-h-28 flex-col items-center justify-center gap-3">
          <ParticipantAvatar participant={participant} />
          <ParticipantCaption participant={participant} />
        </div>
      )}
    </article>
  );
}

function ParticipantAvatar({
  participant,
}: {
  participant: PulseXCallParticipant;
}) {
  return (
    <span className="relative grid h-14 w-14 place-items-center rounded-full bg-[#273142] text-sm font-semibold text-white">
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
