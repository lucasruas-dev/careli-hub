import type { PulseXCallParticipant } from "@/lib/pulsex";
import { Mic, MicOff, MonitorUp, Video, VideoOff } from "lucide-react";

type CallParticipantTileProps = {
  participant: PulseXCallParticipant;
};

export function CallParticipantTile({ participant }: CallParticipantTileProps) {
  return (
    <article className="relative min-h-36 overflow-hidden rounded-lg border border-white/10 bg-[#141923] p-3 text-white shadow-sm">
      <div className="absolute right-3 top-3 flex items-center gap-1">
        <CallStateIcon enabled={!participant.isMuted} type="mic" />
        <CallStateIcon enabled={Boolean(participant.isCameraOn)} type="camera" />
        {participant.isScreenSharing ? (
          <span className="grid h-6 w-6 place-items-center rounded-md bg-[#A07C3B]/20 text-[#f2d79f]">
            <MonitorUp aria-hidden="true" size={13} />
          </span>
        ) : null}
      </div>
      <div className="flex h-full min-h-28 flex-col items-center justify-center gap-3">
        <span className="relative grid h-14 w-14 place-items-center rounded-full bg-[#273142] text-sm font-semibold text-white">
          {participant.initials}
          <span
            aria-hidden="true"
            className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#141923] data-[status=away]:bg-amber-400 data-[status=busy]:bg-indigo-500 data-[status=offline]:bg-zinc-500 data-[status=online]:bg-emerald-500"
            data-status={participant.presenceStatus}
          />
        </span>
        <div className="min-w-0 text-center">
          <h3 className="m-0 truncate text-sm font-semibold">
            {participant.label}
          </h3>
          <p className="m-0 mt-1 text-xs text-white/55">
            {getParticipantStatusLabel(participant.status)} / {participant.role}
          </p>
        </div>
      </div>
    </article>
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
