"use client";

import type { PulseXCallSession } from "@/lib/pulsex";
import { Clock, Phone, Video, X } from "lucide-react";
import { useState } from "react";
import { CallControls } from "./call-controls";
import { CallParticipantTile } from "./call-participant-tile";

type CallPanelProps = {
  onClose: () => void;
  onEnd: () => void;
  session: PulseXCallSession;
};

export function CallPanel({ onClose, onEnd, session }: CallPanelProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(session.type === "video");
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const CallIcon = session.type === "video" ? Video : Phone;

  return (
    <section
      aria-label="Chamada PulseX"
      className="absolute inset-x-4 top-20 z-20 overflow-hidden rounded-xl border border-white/10 bg-[#0b1017] text-white shadow-2xl"
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
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {session.participants.map((participant) => (
          <CallParticipantTile
            key={participant.id}
            participant={{
              ...participant,
              isCameraOn:
                participant.userId === session.initiatedByUserId
                  ? cameraEnabled
                  : participant.isCameraOn,
              isMuted:
                participant.userId === session.initiatedByUserId
                  ? isMuted
                  : participant.isMuted,
              isScreenSharing:
                participant.userId === session.initiatedByUserId
                  ? isScreenSharing
                  : participant.isScreenSharing,
            }}
          />
        ))}
      </div>
      <CallControls
        cameraEnabled={cameraEnabled}
        isAudioOnly={session.type === "audio"}
        isMuted={isMuted}
        isScreenSharing={isScreenSharing}
        onEnd={onEnd}
        onToggleCamera={() => setCameraEnabled((current) => !current)}
        onToggleMicrophone={() => setIsMuted((current) => !current)}
        onToggleScreenShare={() => setIsScreenSharing((current) => !current)}
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
