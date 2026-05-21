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
import type { HubItTicketAttachmentInput } from "@/lib/hub-it-tickets/types";
import {
  extractVideoFrameDataUrls,
  formatAttachmentStamp,
  readBlobAsDataUrl,
} from "@/components/hub-support/hub-ticket-evidence-utils";

export type AthenaTicketRecordingKind = "audio" | "screen";

type AthenaTicketRecordingContextValue = {
  clearRecordingError: () => void;
  consumePendingAttachments: () => HubItTicketAttachmentInput[];
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

const maxRecordingAttachmentBytes = 6_000_000;

export function AthenaTicketRecordingProvider({
  children,
}: {
  children: ReactNode;
}) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const pendingAttachmentsRef = useRef<HubItTicketAttachmentInput[]>([]);
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
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: true,
      });

      setLastRecordingFileName(null);
      startRecording(stream, {
        attachmentType: "video",
        filePrefix: "gravacao",
        kind: "screen",
        timeoutMs: 60_000,
      });
    } catch {
      stopRecordingStream();
      setRecordingKind(null);
      setError("Gravacao cancelada ou nao autorizada.");
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
        timeoutMs: 45_000,
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
    const recorder = new MediaRecorder(stream);

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
    if (blob.size > maxRecordingAttachmentBytes) {
      setError("Anexo acima de 6 MB. Envie uma evidencia menor.");
      return false;
    }

    const dataUrl = await readBlobAsDataUrl(blob);
    const analysisDataUrls =
      options.type === "video" ? await extractVideoFrameDataUrls(blob) : [];
    const attachment: HubItTicketAttachmentInput = {
      analysisDataUrls,
      capturedAt: new Date().toISOString(),
      dataUrl,
      fileName: options.fileName,
      mimeType: blob.type || "application/octet-stream",
      sizeBytes: blob.size,
      type: options.type,
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
