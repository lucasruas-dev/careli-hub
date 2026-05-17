"use client";

import {
  Check,
  Mic,
  MicOff,
  MonitorUp,
  PictureInPicture2,
  PhoneOff,
  Video,
  VideoOff,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import type { ReactNode } from "react";

type CallControlsProps = {
  audioDevices: readonly CallDeviceOption[];
  cameraEnabled: boolean;
  isAudioOnly: boolean;
  isMuted: boolean;
  isPictureInPictureActive: boolean;
  isPictureInPictureAvailable: boolean;
  isScreenSharing: boolean;
  onEnd: () => void;
  onSelectAudioDevice: (deviceId: string) => void;
  onSelectVideoDevice: (deviceId: string) => void;
  onTogglePictureInPicture: () => void;
  onToggleCamera: () => void;
  onToggleMicrophone: () => void;
  onToggleScreenShare: () => void;
  selectedAudioDeviceId: string;
  selectedVideoDeviceId: string;
  videoDevices: readonly CallDeviceOption[];
};

type CallDeviceOption = {
  deviceId: string;
  label: string;
};

const defaultDeviceValue = "__default__";

export function CallControls({
  audioDevices,
  cameraEnabled,
  isAudioOnly,
  isMuted,
  isPictureInPictureActive,
  isPictureInPictureAvailable,
  isScreenSharing,
  onEnd,
  onSelectAudioDevice,
  onSelectVideoDevice,
  onTogglePictureInPicture,
  onToggleCamera,
  onToggleMicrophone,
  onToggleScreenShare,
  selectedAudioDeviceId,
  selectedVideoDeviceId,
  videoDevices,
}: CallControlsProps) {
  return (
    <div className="flex items-center justify-center gap-2 border-t border-white/10 bg-[#0c1118] px-4 py-3">
      <div className="group relative">
        <button
          aria-label={isMuted ? "Ativar microfone" : "Mutar microfone"}
          aria-haspopup="menu"
          aria-pressed={isMuted}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          onClick={onToggleMicrophone}
          type="button"
        >
          {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        <CallDeviceMenu
          actionLabel={isMuted ? "Ativar microfone" : "Desativar microfone"}
          actionTone={isMuted ? "default" : "danger"}
          devices={audioDevices}
          icon={<Mic aria-hidden="true" size={14} />}
          onAction={onToggleMicrophone}
          onSelectDevice={onSelectAudioDevice}
          selectedDeviceId={selectedAudioDeviceId}
          title="Microfone"
        />
      </div>
      <div className="group relative">
        <button
          aria-label={
            isAudioOnly
              ? "Camera indisponivel em chamada de audio"
              : cameraEnabled
                ? "Desligar camera"
                : "Ligar camera"
          }
          aria-haspopup="menu"
          aria-disabled={isAudioOnly}
          aria-pressed={!cameraEnabled}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B] aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
          disabled={isAudioOnly}
          onClick={onToggleCamera}
          type="button"
        >
          {cameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}
        </button>
        {!isAudioOnly ? (
          <CallDeviceMenu
            actionLabel={cameraEnabled ? "Desligar camera" : "Ligar camera"}
            actionTone={cameraEnabled ? "danger" : "default"}
            devices={videoDevices}
            icon={<Video aria-hidden="true" size={14} />}
            onAction={onToggleCamera}
            onSelectDevice={onSelectVideoDevice}
            selectedDeviceId={selectedVideoDeviceId}
            title="Camera"
          />
        ) : null}
      </div>
      <Tooltip
        content={isScreenSharing ? "Parar compartilhamento" : "Compartilhar tela"}
      >
        <button
          aria-label={
            isScreenSharing
              ? "Parar compartilhamento de tela"
              : "Compartilhar tela"
          }
          aria-pressed={isScreenSharing}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/15 aria-pressed:bg-[#A07C3B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          onClick={onToggleScreenShare}
          type="button"
        >
          <MonitorUp size={18} />
        </button>
      </Tooltip>
      <Tooltip
        content={
          isPictureInPictureActive
            ? "Fechar picture-in-picture"
            : "Picture-in-picture"
        }
      >
        <button
          aria-label={
            isPictureInPictureActive
              ? "Fechar picture-in-picture"
              : "Abrir picture-in-picture"
          }
          aria-disabled={!isPictureInPictureAvailable || isAudioOnly}
          aria-pressed={isPictureInPictureActive}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/15 aria-pressed:bg-[#A07C3B] aria-disabled:cursor-not-allowed aria-disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          disabled={!isPictureInPictureAvailable || isAudioOnly}
          onClick={onTogglePictureInPicture}
          type="button"
        >
          <PictureInPicture2 size={18} />
        </button>
      </Tooltip>
      <Tooltip content="Encerrar chamada">
        <button
          aria-label="Encerrar chamada"
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

function CallDeviceMenu({
  actionLabel,
  actionTone,
  devices,
  icon,
  onAction,
  onSelectDevice,
  selectedDeviceId,
  title,
}: {
  actionLabel: string;
  actionTone: "danger" | "default";
  devices: readonly CallDeviceOption[];
  icon: ReactNode;
  onAction: () => void;
  onSelectDevice: (deviceId: string) => void;
  selectedDeviceId: string;
  title: string;
}) {
  const deviceOptions = [
    {
      deviceId: defaultDeviceValue,
      label: "Padrao do sistema",
    },
    ...devices,
  ];

  return (
    <div
      className="pointer-events-none absolute bottom-full left-1/2 z-20 w-72 -translate-x-1/2 translate-y-2 overflow-hidden rounded-lg border border-slate-200 bg-white py-2 text-[#101820] opacity-0 shadow-2xl transition duration-150 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100"
      role="menu"
    >
      <div className="flex items-center gap-2 px-3 pb-2 text-sm font-semibold">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-[#f4f6f8] text-[#101820]">
          {icon}
        </span>
        <span>{title}</span>
      </div>
      <div className="max-h-44 overflow-auto border-y border-slate-100 py-1">
        {deviceOptions.map((device) => {
          const isSelected = device.deviceId === selectedDeviceId;

          return (
            <button
              aria-checked={isSelected}
              className="grid w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-[#f4f6f8] focus-visible:bg-[#f4f6f8] focus-visible:outline-none"
              key={device.deviceId}
              onClick={() => onSelectDevice(device.deviceId)}
              role="menuitemradio"
              type="button"
            >
              <span className="text-[#A07C3B]">
                {isSelected ? <Check aria-hidden="true" size={14} /> : null}
              </span>
              <span className="truncate">{device.label}</span>
            </button>
          );
        })}
      </div>
      <button
        className={`w-full px-3 py-2 text-left text-sm font-medium transition hover:bg-[#f4f6f8] focus-visible:bg-[#f4f6f8] focus-visible:outline-none ${
          actionTone === "danger" ? "text-rose-600" : "text-[#101820]"
        }`}
        onClick={onAction}
        role="menuitem"
        type="button"
      >
        {actionLabel}
      </button>
    </div>
  );
}
