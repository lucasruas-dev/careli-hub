"use client";

import type { PulseXCallSession } from "@/lib/pulsex";
import { Clock, Phone, Video, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CallControls } from "./call-controls";
import { CallParticipantTile } from "./call-participant-tile";

type CallPanelProps = {
  onClose: () => void;
  onEnd: () => void;
  session: PulseXCallSession;
};

type MediaDeviceOption = {
  deviceId: string;
  label: string;
};

const defaultDeviceValue = "__default__";

export function CallPanel({ onClose, onEnd, session }: CallPanelProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(session.type === "video");
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [audioInputId, setAudioInputId] = useState(defaultDeviceValue);
  const [videoInputId, setVideoInputId] = useState(defaultDeviceValue);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceOption[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceOption[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const CallIcon = session.type === "video" ? Video : Phone;

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
      isKnownDevice(currentId, nextAudioInputs) ? currentId : defaultDeviceValue,
    );
    setVideoInputId((currentId) =>
      isKnownDevice(currentId, nextVideoInputs) ? currentId : defaultDeviceValue,
    );
  }, []);

  useEffect(() => {
    void refreshDevices();

    if (!navigator.mediaDevices?.addEventListener) {
      return;
    }

    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);

    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
    };
  }, [refreshDevices]);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError("Midia indisponivel neste navegador.");
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
    refreshDevices,
    session.type,
    videoInputId,
  ]);

  useEffect(() => {
    localStream
      ?.getAudioTracks()
      .forEach((track) => {
        track.enabled = !isMuted;
      });
  }, [isMuted, localStream]);

  useEffect(() => {
    return () => {
      localStream?.getTracks().forEach((track) => track.stop());
    };
  }, [localStream]);

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
      <div className="grid gap-3 border-b border-white/10 bg-[#0d131d] px-4 py-3 md:grid-cols-2">
        <DeviceSelect
          devices={audioInputs}
          label="Microfone"
          onChange={setAudioInputId}
          value={audioInputId}
        />
        {session.type === "video" ? (
          <DeviceSelect
            devices={videoInputs}
            disabled={!cameraEnabled}
            label="Camera"
            onChange={setVideoInputId}
            value={videoInputId}
          />
        ) : null}
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {session.participants.map((participant) => (
          <CallParticipantTile
            key={participant.id}
            mediaStream={
              participant.userId === session.initiatedByUserId
                ? localStream
                : null
            }
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
      {mediaError ? (
        <p className="m-0 border-t border-white/10 px-4 py-2 text-xs text-amber-200">
          {mediaError}
        </p>
      ) : null}
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

function DeviceSelect({
  devices,
  disabled = false,
  label,
  onChange,
  value,
}: {
  devices: readonly MediaDeviceOption[];
  disabled?: boolean;
  label: string;
  onChange: (deviceId: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[0.68rem] font-semibold uppercase tracking-wide text-white/45">
        {label}
      </span>
      <select
        className="h-9 rounded-md border border-white/10 bg-white/10 px-2 text-sm text-white outline-none transition focus:border-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-45"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option className="text-[#101820]" value={defaultDeviceValue}>
          Padrao do sistema
        </option>
        {devices.map((device) => (
          <option
            className="text-[#101820]"
            key={device.deviceId}
            value={device.deviceId}
          >
            {device.label}
          </option>
        ))}
      </select>
    </label>
  );
}

async function requestCallMedia({
  audioInputId,
  cameraEnabled,
  sessionType,
  videoInputId,
}: {
  audioInputId: string;
  cameraEnabled: boolean;
  sessionType: PulseXCallSession["type"];
  videoInputId: string;
}) {
  const needsVideo = sessionType === "video" && cameraEnabled;

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: createDeviceConstraint(audioInputId),
      video: needsVideo ? createDeviceConstraint(videoInputId) : false,
    });
  } catch (error) {
    if (!needsVideo) {
      throw error;
    }

    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: createDeviceConstraint(audioInputId),
        video: true,
      });
    } catch {
      return navigator.mediaDevices.getUserMedia({
        audio: createDeviceConstraint(audioInputId),
        video: false,
      });
    }
  }
}

function createDeviceConstraint(deviceId: string): boolean | MediaTrackConstraints {
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
