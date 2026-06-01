import type { LocalRecording } from "@/lib/chronos/drive";
import {
  formatChronosDuration,
  getSupportedChronosRecordingMimeType,
  stopChronosMediaStream,
} from "@/lib/chronos/recording";
import {
  chronosMeetingStatusLabels,
  type ChronosMeeting,
  type ChronosUpdateInput,
} from "@/lib/chronos/types";
import { Badge, Surface } from "@repo/uix";
import {
  AlertTriangle,
  MonitorUp,
  Radio,
  ScreenShare,
  Square,
  Video,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { chronosMeetingStatusVariant } from "./chronos-meeting-status";
import {
  CaptureStatusPanel,
  PanelTitle,
  ParticipantMiniPanel,
  RoomButton,
  RoomProtocolPanel,
} from "./chronos-panels";

type ExecutiveRoomPanelProps = {
  meeting: ChronosMeeting | null;
  onLocalRecording: (recording: LocalRecording) => void;
  onUpdate: (input: ChronosUpdateInput) => Promise<void>;
  saving: boolean;
};

export function ExecutiveRoomPanel({
  meeting,
  onLocalRecording,
  onUpdate,
  saving,
}: ExecutiveRoomPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number>(0);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingActive, setRecordingActive] = useState(false);
  const activeStream = screenStream ?? cameraStream;

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = activeStream;
    }
  }, [activeStream]);

  useEffect(() => () => stopChronosMediaStream(cameraStream), [cameraStream]);
  useEffect(() => () => stopChronosMediaStream(screenStream), [screenStream]);

  useEffect(() => {
    if (!recordingActive) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setRecordingSeconds(
        Math.max(0, Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)),
      );
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [recordingActive]);

  async function startCamera() {
    setMediaError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });

      setCameraStream(stream);
    } catch {
      setMediaError("Camera ou microfone indisponivel.");
    }
  }

  async function startScreenShare() {
    setMediaError(null);

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true,
      });

      setScreenStream(stream);
      if (meeting) {
        await onUpdate({
          action: "add_timeline_event",
          eventType: "screen_shared",
          meetingId: meeting.id,
          title: "Compartilhamento de tela iniciado",
        });
      }
    } catch {
      setMediaError("Compartilhamento de tela nao iniciado.");
    }
  }

  async function startRecording() {
    if (!meeting || !activeStream) {
      setMediaError("Ative camera ou tela antes de gravar.");
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      setMediaError("Gravacao indisponivel neste navegador.");
      return;
    }

    recordingChunksRef.current = [];
    const mimeType = getSupportedChronosRecordingMimeType();
    const recorder = mimeType
      ? new MediaRecorder(activeStream, { mimeType })
      : new MediaRecorder(activeStream);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordingChunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
      const blob = new Blob(recordingChunksRef.current, {
        type: recorder.mimeType || "video/webm",
      });
      const url = URL.createObjectURL(blob);
      const durationSeconds = Math.max(
        1,
        Math.floor((Date.now() - recordingStartedAtRef.current) / 1000),
      );

      onLocalRecording({
        blob,
        downloadUrl: url,
        durationSeconds,
        id: `local-recording-${Date.now().toString(36)}`,
        meetingId: meeting.id,
        mimeType: blob.type,
        name: `${meeting.protocol}.webm`,
        sizeBytes: blob.size,
        startedAt: new Date(recordingStartedAtRef.current).toISOString(),
        status: "available",
        stoppedAt: new Date().toISOString(),
        url,
      });
      void onUpdate({
        action: "mark_recording",
        durationSeconds,
        meetingId: meeting.id,
        status: "available",
      });
    };
    mediaRecorderRef.current = recorder;
    recordingStartedAtRef.current = Date.now();
    setRecordingSeconds(0);
    setRecordingActive(true);
    recorder.start(1000);
    await onUpdate({
      action: "mark_recording",
      meetingId: meeting.id,
      status: "recording",
    });
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecordingActive(false);
  }

  function stopAllMedia() {
    stopChronosMediaStream(cameraStream);
    stopChronosMediaStream(screenStream);
    setCameraStream(null);
    setScreenStream(null);
  }

  return (
    <Surface bordered className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border-[#d9e0e7] bg-[#101820] text-white">
      <div className="flex items-start justify-between gap-3 border-b border-white/[0.08] p-4">
        <PanelTitle
          dark
          eyebrow={meeting?.protocol ?? "Chronos"}
          title={meeting?.title ?? "Sala executiva"}
        />
        {meeting ? (
          <Badge variant={chronosMeetingStatusVariant[meeting.status] ?? "neutral"}>
            {chronosMeetingStatusLabels[meeting.status] ?? "Agendada"}
          </Badge>
        ) : null}
      </div>
      <div className="grid min-h-0 gap-3 p-4">
        <div className="relative grid min-h-[23rem] place-items-center overflow-hidden rounded-md border border-white/[0.08] bg-[#161d27]">
          {activeStream ? (
            <video
              autoPlay
              className="h-full max-h-[31rem] w-full object-contain"
              muted
              playsInline
              ref={videoRef}
            />
          ) : (
            <div className="grid justify-items-center gap-3 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-md border border-white/[0.08] bg-white/[0.05] text-[#D6B56F]">
                <Video aria-hidden="true" size={28} />
              </span>
              <span className="text-sm font-semibold text-[#d7dee8]">
                {meeting ? "Entrada da reuniao" : "Selecione uma reuniao"}
              </span>
            </div>
          )}
          {recordingActive ? (
            <span className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
              {formatChronosDuration(recordingSeconds)}
            </span>
          ) : null}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <ParticipantMiniPanel meeting={meeting} />
          <RoomProtocolPanel meeting={meeting} />
          <CaptureStatusPanel meeting={meeting} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <RoomButton
            disabled={!meeting}
            icon={<Video size={16} />}
            label="Camera"
            onClick={() => void startCamera()}
          />
          <RoomButton
            disabled={!meeting}
            icon={<ScreenShare size={16} />}
            label="Tela"
            onClick={() => void startScreenShare()}
          />
          <RoomButton
            disabled={!meeting || !activeStream || recordingActive || saving}
            icon={<Radio size={16} />}
            label="Gravar"
            onClick={() => void startRecording()}
          />
          <RoomButton
            disabled={!recordingActive}
            icon={<Square size={15} />}
            label="Parar"
            onClick={stopRecording}
          />
          <RoomButton
            disabled={!cameraStream && !screenStream}
            icon={<MonitorUp size={16} />}
            label="Encerrar midia"
            onClick={stopAllMedia}
          />
        </div>
        {mediaError ? (
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-amber-200">
            <AlertTriangle aria-hidden="true" size={14} />
            {mediaError}
          </span>
        ) : null}
      </div>
    </Surface>
  );
}
