"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { uploadHubItTicketAttachment } from "@/lib/hub-it-tickets/attachment-upload";
import type { HubItTicketAttachmentInput } from "@/lib/hub-it-tickets/types";
import {
  extractVideoFrameDataUrls,
  formatAttachmentStamp,
  readBlobAsDataUrl,
  type HubItTicketAttachmentDraft,
} from "@/components/hub-support/hub-ticket-evidence-utils";

export type AthenaTicketRecordingKind = "audio" | "screen";

type AthenaTicketRecordingContextValue = {
  clearRecordingError: () => void;
  consumePendingAttachments: () => HubItTicketAttachmentDraft[];
  error: string | null;
  isProcessingRecording: boolean;
  isRecordingProtected: boolean;
  lastRecordingFileName: string | null;
  nativeTicketFormCount: number;
  pendingAttachmentCount: number;
  pendingAttachmentVersion: number;
  recordingKind: AthenaTicketRecordingKind | null;
  registerTicketFormHost: (host: "global" | "native") => () => void;
  startAudioRecording: () => Promise<void>;
  startScreenRecording: () => Promise<void>;
  stopActiveRecording: () => void;
};

const AthenaTicketRecordingContext =
  createContext<AthenaTicketRecordingContextValue | null>(null);

// O teto de 6MB era o do base64 no Postgres. Agora o arquivo vai pro bucket
// privado (150MB), entao a gravacao pode durar e ter qualidade de leitura.
// 5 min a ~2.6 Mbps dao ~98MB, dentro do bucket.
const maxRecordingAttachmentBytes = 120 * 1024 * 1024;
// Se o upload direto falhar, so um arquivo pequeno volta pro base64 legado
// (o body da function da Vercel morre em ~4.5MB).
const maxLegacyInlineBytes = 3_000_000;
const SCREEN_RECORDING_TIMEOUT_MS = 5 * 60_000;
// O audio avulso e transcrito pelo Whisper via function da Vercel, entao segue
// curto de proposito: 3 min a 96 kbps dao ~2.2MB, abaixo do limite de body.
const VOICE_NOTE_TIMEOUT_MS = 3 * 60_000;
const maxVoiceNoteAttachmentBytes = 3_500_000;

export function AthenaTicketRecordingProvider({
  children,
}: {
  children: ReactNode;
}) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const pendingAttachmentsRef = useRef<HubItTicketAttachmentDraft[]>([]);
  const recordingAttachmentTypeRef =
    useRef<HubItTicketAttachmentInput["type"]>("video");
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingFilePrefixRef = useRef("gravacao");
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isProcessingRecording, setIsProcessingRecording] = useState(false);
  const [lastRecordingFileName, setLastRecordingFileName] = useState<
    string | null
  >(null);
  const [nativeTicketFormCount, setNativeTicketFormCount] = useState(0);
  const [pendingAttachmentVersion, setPendingAttachmentVersion] = useState(0);
  const [recordingKind, setRecordingKind] =
    useState<AthenaTicketRecordingKind | null>(null);

  useEffect(() => {
    return () => {
      stopRecordingStream();
    };
  }, []);

  const clearRecordingError = useCallback(() => {
    setError(null);
  }, []);

  const consumePendingAttachments = useCallback(() => {
    const attachments = pendingAttachmentsRef.current;

    if (attachments.length === 0) {
      return [];
    }

    pendingAttachmentsRef.current = [];
    setPendingAttachmentVersion((currentVersion) => currentVersion + 1);

    return attachments;
  }, []);

  const registerTicketFormHost = useCallback((host: "global" | "native") => {
    if (host !== "native") {
      return () => undefined;
    }

    setNativeTicketFormCount((currentCount) => currentCount + 1);

    return () => {
      setNativeTicketFormCount((currentCount) =>
        Math.max(0, currentCount - 1),
      );
    };
  }, []);

  async function startScreenRecording() {
    if (recordingKind === "screen") {
      stopActiveRecording();
      return;
    }

    if (recordingKind) {
      setError("Finalize a gravacao atual antes de iniciar outra.");
      return;
    }

    setError(null);

    if (
      !navigator.mediaDevices?.getDisplayMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError("Gravacao de tela indisponivel neste navegador.");
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: { frameRate: { ideal: 30, max: 30 } },
      });
      // A narracao e o ponto: a pessoa fala explicando enquanto mostra a tela.
      // Se negar o microfone, a gravacao segue muda em vez de falhar.
      const microphoneStream = await requestMicrophoneStream();
      const stream = new MediaStream([
        ...displayStream.getVideoTracks(),
        ...(microphoneStream?.getAudioTracks() ?? []),
      ]);

      if (!microphoneStream) {
        setError("Microfone indisponivel: a tela sera gravada sem narracao.");
      }

      setLastRecordingFileName(null);
      startRecording(stream, {
        attachmentType: "video",
        filePrefix: "gravacao",
        kind: "screen",
        timeoutMs: SCREEN_RECORDING_TIMEOUT_MS,
      });
    } catch {
      stopRecordingStream();
      setRecordingKind(null);
      setError("Gravacao cancelada ou nao autorizada.");
    }
  }

  async function requestMicrophoneStream() {
    if (!navigator.mediaDevices?.getUserMedia) {
      return null;
    }

    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
    } catch {
      return null;
    }
  }

  async function startAudioRecording() {
    if (recordingKind === "audio") {
      stopActiveRecording();
      return;
    }

    if (recordingKind) {
      setError("Finalize a gravacao atual antes de iniciar outra.");
      return;
    }

    setError(null);

    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError("Audio indisponivel neste navegador.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      setLastRecordingFileName(null);
      startRecording(stream, {
        attachmentType: "audio",
        filePrefix: "audio",
        kind: "audio",
        timeoutMs: VOICE_NOTE_TIMEOUT_MS,
      });
    } catch {
      stopRecordingStream();
      setRecordingKind(null);
      setError("Audio cancelado ou nao autorizado.");
    }
  }

  function startRecording(
    stream: MediaStream,
    options: {
      attachmentType: HubItTicketAttachmentInput["type"];
      filePrefix: string;
      kind: AthenaTicketRecordingKind;
      timeoutMs: number;
    },
  ) {
    const recorder = createMediaRecorder(stream, options.attachmentType);

    recordingChunksRef.current = [];
    recordingStreamRef.current = stream;
    mediaRecorderRef.current = recorder;
    recordingAttachmentTypeRef.current = options.attachmentType;
    recordingFilePrefixRef.current = options.filePrefix;

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        recordingChunksRef.current.push(event.data);
      }
    });
    recorder.addEventListener("stop", () => {
      const attachmentType = recordingAttachmentTypeRef.current;
      const filePrefix = recordingFilePrefixRef.current;
      const fileName = `${filePrefix}-${formatAttachmentStamp()}.webm`;
      const blob = new Blob(recordingChunksRef.current, {
        type:
          recorder.mimeType ||
          (attachmentType === "audio" ? "audio/webm" : "video/webm"),
      });

      stopRecordingStream();
      setRecordingKind(null);
      setIsProcessingRecording(true);
      void enqueueBlobAttachment(blob, {
        fileName,
        type: attachmentType,
      })
        .then((queued) => {
          if (queued) {
            setLastRecordingFileName(fileName);
          }
        })
        .finally(() => {
          setIsProcessingRecording(false);
        });
    });

    stream.getTracks().forEach((track) => {
      track.addEventListener(
        "ended",
        () => {
          stopActiveRecording();
        },
        { once: true },
      );
    });

    recorder.start();
    setRecordingKind(options.kind);
    recordingTimerRef.current = window.setTimeout(() => {
      stopActiveRecording();
    }, options.timeoutMs);
  }

  function stopActiveRecording() {
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }

    stopRecordingStream();
    setRecordingKind(null);
  }

  function stopRecordingStream() {
    if (recordingTimerRef.current) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    mediaRecorderRef.current = null;
  }

  async function enqueueBlobAttachment(
    blob: Blob,
    options: {
      fileName: string;
      type: HubItTicketAttachmentInput["type"];
    },
  ) {
    const isVoiceNote = options.type === "audio";
    const sizeLimit = isVoiceNote
      ? maxVoiceNoteAttachmentBytes
      : maxRecordingAttachmentBytes;

    if (blob.size > sizeLimit) {
      setError(
        isVoiceNote
          ? "Audio muito longo. Grave um recado mais curto."
          : "Gravacao muito grande. Grave um trecho mais curto.",
      );
      return false;
    }

    // O arquivo cheio vai pro Storage. O audio avulso tambem carrega o base64,
    // porque a transcricao do Whisper precisa dos bytes.
    const storagePath = await uploadHubItTicketAttachment({
      blob,
      fileName: options.fileName,
    });

    if (!storagePath && blob.size > maxLegacyInlineBytes) {
      setError("Nao foi possivel enviar a gravacao. Tente de novo.");
      return false;
    }

    const analysisDataUrls = isVoiceNote
      ? []
      : await extractVideoFrameDataUrls(blob);
    const needsInlineBytes = isVoiceNote || !storagePath;
    const attachment: HubItTicketAttachmentDraft = {
      analysisDataUrls,
      capturedAt: new Date().toISOString(),
      fileName: options.fileName,
      mimeType: blob.type || "application/octet-stream",
      previewUrl: URL.createObjectURL(blob),
      sizeBytes: blob.size,
      type: options.type,
      ...(storagePath ? { storagePath } : {}),
      ...(needsInlineBytes ? { dataUrl: await readBlobAsDataUrl(blob) } : {}),
    };

    pendingAttachmentsRef.current = [
      attachment,
      ...pendingAttachmentsRef.current,
    ];
    setPendingAttachmentVersion((currentVersion) => currentVersion + 1);

    return true;
  }

  const pendingAttachmentCount = pendingAttachmentsRef.current.length;
  const isRecordingProtected = Boolean(
    recordingKind || isProcessingRecording || pendingAttachmentCount > 0,
  );

  return (
    <AthenaTicketRecordingContext.Provider
      value={{
        clearRecordingError,
        consumePendingAttachments,
        error,
        isProcessingRecording,
        isRecordingProtected,
        lastRecordingFileName,
        nativeTicketFormCount,
        pendingAttachmentCount,
        pendingAttachmentVersion,
        recordingKind,
        registerTicketFormHost,
        startAudioRecording,
        startScreenRecording,
        stopActiveRecording,
      }}
    >
      {children}
    </AthenaTicketRecordingContext.Provider>
  );
}

export function useAthenaTicketRecording() {
  const context = useContext(AthenaTicketRecordingContext);

  if (!context) {
    throw new Error(
      "useAthenaTicketRecording precisa estar dentro de AthenaTicketRecordingProvider.",
    );
  }

  return context;
}

// Antes: video a 450 kbps, escolhido pra caber nos 6MB de base64 do Postgres.
// Texto de interface fica ilegivel nesse bitrate. Agora o arquivo vai pro
// Storage, entao gravamos em qualidade de leitura: ~2.5 Mbps de video e 128 kbps
// de audio (a narracao). VP9 preserva texto melhor que VP8.
const SCREEN_VIDEO_BITS_PER_SECOND = 2_500_000;
const NARRATION_AUDIO_BITS_PER_SECOND = 128_000;
const VOICE_NOTE_AUDIO_BITS_PER_SECOND = 96_000;

function createMediaRecorder(
  stream: MediaStream,
  attachmentType: HubItTicketAttachmentInput["type"],
) {
  const isAudioOnly = attachmentType === "audio";
  const recorderOptions: MediaRecorderOptions = isAudioOnly
    ? { audioBitsPerSecond: VOICE_NOTE_AUDIO_BITS_PER_SECOND }
    : {
        audioBitsPerSecond: NARRATION_AUDIO_BITS_PER_SECOND,
        videoBitsPerSecond: SCREEN_VIDEO_BITS_PER_SECOND,
      };
  const preferredMimeTypes = isAudioOnly
    ? ["audio/webm;codecs=opus", "audio/webm"]
    : ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

  for (const mimeType of preferredMimeTypes) {
    if (
      typeof MediaRecorder.isTypeSupported === "function" &&
      MediaRecorder.isTypeSupported(mimeType)
    ) {
      try {
        return new MediaRecorder(stream, { ...recorderOptions, mimeType });
      } catch {
        // Segue pro proximo candidato.
      }
    }
  }

  try {
    return new MediaRecorder(stream, recorderOptions);
  } catch {
    return new MediaRecorder(stream);
  }
}
