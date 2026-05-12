"use client";

import {
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Video,
  VideoOff,
} from "lucide-react";
import { Tooltip } from "@repo/uix";

type CallControlsProps = {
  cameraEnabled: boolean;
  isAudioOnly: boolean;
  isMuted: boolean;
  isScreenSharing: boolean;
  onEnd: () => void;
  onToggleCamera: () => void;
  onToggleMicrophone: () => void;
  onToggleScreenShare: () => void;
};

export function CallControls({
  cameraEnabled,
  isAudioOnly,
  isMuted,
  isScreenSharing,
  onEnd,
  onToggleCamera,
  onToggleMicrophone,
  onToggleScreenShare,
}: CallControlsProps) {
  return (
    <div className="flex items-center justify-center gap-2 border-t border-white/10 bg-[#0c1118] px-4 py-3">
      <Tooltip content={isMuted ? "Ativar microfone" : "Mutar microfone"}>
        <button
          aria-pressed={isMuted}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          onClick={onToggleMicrophone}
          type="button"
        >
          {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
      </Tooltip>
      <Tooltip
        content={
          isAudioOnly
            ? "Camera indisponivel em chamada de audio"
            : cameraEnabled
              ? "Desligar camera"
              : "Ligar camera"
        }
      >
        <button
          aria-disabled={isAudioOnly}
          aria-pressed={!cameraEnabled}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B] aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
          disabled={isAudioOnly}
          onClick={onToggleCamera}
          type="button"
        >
          {cameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}
        </button>
      </Tooltip>
      <Tooltip content="Compartilhar tela">
        <button
          aria-pressed={isScreenSharing}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/15 aria-pressed:bg-[#A07C3B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          onClick={onToggleScreenShare}
          type="button"
        >
          <MonitorUp size={18} />
        </button>
      </Tooltip>
      <Tooltip content="Encerrar chamada">
        <button
          className="grid h-10 w-10 place-items-center rounded-full bg-rose-600 text-white transition hover:bg-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
          onClick={onEnd}
          type="button"
        >
          <PhoneOff size={18} />
        </button>
      </Tooltip>
    </div>
  );
}
