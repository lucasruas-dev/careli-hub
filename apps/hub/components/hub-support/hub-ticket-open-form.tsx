"use client";

import {
  analyzeHubItTicketEvidence,
  createHubItTicket,
  isHubItTicketsMigrationPendingMessage,
} from "@/lib/hub-it-tickets/client";
import { useAthenaTicketRecording } from "@/components/hub-support/athena-ticket-recording-provider";
import {
  dataUrlToBytes,
  extractVideoFrameDataUrls,
  formatAttachmentStamp,
  formatBytes,
  getAttachmentLabel,
  getAttachmentTypeFromMime,
  readBlobAsDataUrl,
} from "@/components/hub-support/hub-ticket-evidence-utils";
import {
  hubItTicketCategoryLabels,
  hubItTicketPriorityLabels,
  type HubItTicketAttachmentInput,
  type HubItTicketCategory,
  type HubItTicketPriority,
} from "@/lib/hub-it-tickets/types";
import { useAuth } from "@/providers/auth-provider";
import {
  AlertTriangle,
  Camera,
  CalendarDays,
  CheckCircle2,
  FileAudio,
  FileText,
  FileVideo,
  ImageIcon,
  Loader2,
  Mic,
  Paperclip,
  Send,
  Sparkles,
  Square,
  Video,
  X,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

type HubTicketOpenFormProps = {
  compactRecordingMode?: boolean;
  defaultModule?: string;
  onCreated?: (protocol: string) => void;
  onRecordingStateChange?: (isRecording: boolean) => void;
  onRestoreRequest?: () => void;
  recordingHost?: "global" | "native";
  sourcePath?: string;
};

const maxAttachmentBytes = 6_000_000;
const maxAttachmentCount = 3;

export function HubTicketOpenForm({
  compactRecordingMode = false,
  defaultModule,
  onCreated,
  onRecordingStateChange,
  onRestoreRequest,
  recordingHost = "global",
  sourcePath,
}: HubTicketOpenFormProps) {
  const { authState } = useAuth();
  const pathname = usePathname();
  const currentPath = sourcePath ?? pathname;
  const {
    clearRecordingError,
    consumePendingAttachments,
    error: recordingError,
    isProcessingRecording,
    isRecordingProtected,
    lastRecordingFileName,
    pendingAttachmentVersion,
    recordingKind,
    registerTicketFormHost,
    startAudioRecording,
    startScreenRecording,
    stopActiveRecording,
  } = useAthenaTicketRecording();
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<HubItTicketCategory>("erro");
  const [priority, setPriority] = useState<HubItTicketPriority>("media");
  const [moduleName, setModuleName] = useState(
    () => defaultModule ?? getModuleFromPath(currentPath),
  );
  const [technicalSummary, setTechnicalSummary] = useState("");
  const [expectedResult, setExpectedResult] = useState("");
  const [actualResult, setActualResult] = useState("");
  const [attachments, setAttachments] = useState<HubItTicketAttachmentInput[]>(
    [],
  );
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState("");
  const hasTicketContext =
    description.trim().length >= 3 || attachments.length > 0;
  const canSubmit = hasTicketContext && requestedDeliveryDate.length > 0;
  const [isAnalyzingEvidence, setIsAnalyzingEvidence] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const submitNeedsContext = !canSubmit && !isSaving;
  const submitTooltip = canSubmit
    ? "Enviar HelpDesk para Zeus"
    : requestedDeliveryDate
      ? "Descreva o que aconteceu ou anexe uma evidencia"
      : "Informe a data de entrega desejada";
  const [error, setError] = useState<string | null>(null);
  const visibleError = error ?? recordingError;
  const [successProtocol, setSuccessProtocol] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const accessToken = authState.session?.accessToken ?? null;

  useEffect(() => {
    setModuleName(defaultModule ?? getModuleFromPath(currentPath));
  }, [currentPath, defaultModule]);

  useEffect(() => {
    return registerTicketFormHost(recordingHost);
  }, [recordingHost, registerTicketFormHost]);

  useEffect(() => {
    const ticketDescription = buildUserDescription(description, attachments);

    if (!ticketDescription) {
      setTechnicalSummary("");
      setExpectedResult("");
      setActualResult("");
      return;
    }

    const nextCategory = inferCategory(ticketDescription);
    const nextPriority = inferPriority(ticketDescription);

    setCategory(nextCategory);
    setPriority(nextPriority);
    setTechnicalSummary(
      buildTechnicalSummary({
        attachments,
        category: nextCategory,
        description: ticketDescription,
        moduleName,
        pathname: currentPath,
        priority: nextPriority,
        requestedDeliveryDate,
      }),
    );
    setExpectedResult(inferExpectedResult(ticketDescription));
    setActualResult(inferActualResult(ticketDescription));
  }, [attachments, currentPath, description, moduleName, requestedDeliveryDate]);

  useEffect(() => {
    if (!canSubmit) {
      setIsAnalyzingEvidence(false);
      return;
    }

    let isCurrentAnalysis = true;
    const timer = window.setTimeout(() => {
      const ticketDescription = buildUserDescription(description, attachments);

      setIsAnalyzingEvidence(true);
      void analyzeHubItTicketEvidence({
        accessToken,
        input: {
          attachments,
          category,
          module: moduleName,
          pathname: currentPath,
          priority,
          userDescription: ticketDescription,
        },
      })
        .then((analysis) => {
          if (!isCurrentAnalysis) {
            return;
          }

          setTechnicalSummary(analysis.technicalSummary);
          setExpectedResult(analysis.expectedResult ?? "");
          setActualResult(analysis.actualResult ?? "");
        })
        .catch(() => undefined)
        .finally(() => {
          if (isCurrentAnalysis) {
            setIsAnalyzingEvidence(false);
          }
        });
    }, 800);

    return () => {
      isCurrentAnalysis = false;
      window.clearTimeout(timer);
    };
  }, [
    accessToken,
    attachments,
    canSubmit,
    category,
    currentPath,
    description,
    moduleName,
    priority,
  ]);

  useEffect(() => {
    if (compactRecordingMode) {
      return;
    }

    const pendingAttachments = consumePendingAttachments();

    if (pendingAttachments.length === 0) {
      return;
    }

    setError(null);
    clearRecordingError();
    setAttachments((currentAttachments) =>
      [...pendingAttachments, ...currentAttachments].slice(
        0,
        maxAttachmentCount,
      ),
    );
  }, [
    clearRecordingError,
    compactRecordingMode,
    consumePendingAttachments,
    pendingAttachmentVersion,
  ]);

  useEffect(() => {
    onRecordingStateChange?.(isRecordingProtected);
  }, [isRecordingProtected, onRecordingStateChange]);

  async function handleSubmit() {
    const ticketDescription = buildUserDescription(description, attachments);

    if (!canSubmit || ticketDescription.length < 3) {
      setError(
        requestedDeliveryDate
          ? "Descreva em poucas palavras ou anexe uma evidencia."
          : "Informe a data de entrega desejada.",
      );
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const ticket = await createHubItTicket({
        accessToken,
        input: {
          actualResult,
          attachments,
          category,
          expectedResult,
          module: moduleName,
          priority,
          requestedDeliveryDate,
          sourcePath: currentPath,
          sourceUrl:
            typeof window !== "undefined" ? window.location.href : undefined,
          technicalSummary:
            technicalSummary ||
            buildTechnicalSummary({
              attachments,
              category,
              description: ticketDescription,
              requestedDeliveryDate,
              moduleName,
              pathname: currentPath,
              priority,
            }),
          title: buildTicketTitle(ticketDescription, moduleName),
          userDescription: ticketDescription,
        },
      });

      setSuccessProtocol(ticket.protocol);
      onCreated?.(ticket.protocol);
      resetForm();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Nao foi possivel enviar o ticket.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function captureScreenFrame() {
    setError(null);
    clearRecordingError();

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Captura de tela indisponivel neste navegador.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: true,
      });
      const video = document.createElement("video");

      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 500);
      });

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const context = canvas.getContext("2d");
      context?.drawImage(video, 0, 0, canvas.width, canvas.height);
      stream.getTracks().forEach((track) => track.stop());

      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      addAttachment({
        capturedAt: new Date().toISOString(),
        dataUrl,
        fileName: `print-${formatAttachmentStamp()}.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: dataUrlToBytes(dataUrl),
        type: "image",
      });
    } catch {
      setError("Captura cancelada ou nao autorizada.");
    }
  }

  async function toggleScreenRecording() {
    if (recordingKind === "screen") {
      stopActiveRecording();
      return;
    }

    setError(null);
    clearRecordingError();
    await startScreenRecording();
  }

  async function toggleAudioRecording() {
    if (recordingKind === "audio") {
      stopActiveRecording();
      return;
    }

    setError(null);
    clearRecordingError();
    await startAudioRecording();
  }

  async function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);

    for (const file of files.slice(0, maxAttachmentCount)) {
      await addBlobAttachment(file, {
        fileName: file.name,
        type: getAttachmentTypeFromMime(file.type),
      });
    }

    event.target.value = "";
  }

  async function addBlobAttachment(
    blob: Blob,
    options: {
      fileName: string;
      type: HubItTicketAttachmentInput["type"];
    },
  ) {
    if (blob.size > maxAttachmentBytes) {
      setError("Anexo acima de 6 MB. Envie uma evidencia menor.");
      return;
    }

    const dataUrl = await readBlobAsDataUrl(blob);
    const analysisDataUrls =
      options.type === "video" ? await extractVideoFrameDataUrls(blob) : [];

    addAttachment({
      analysisDataUrls,
      capturedAt: new Date().toISOString(),
      dataUrl,
      fileName: options.fileName,
      mimeType: blob.type || "application/octet-stream",
      sizeBytes: blob.size,
      type: options.type,
    });
  }

  function addAttachment(attachment: HubItTicketAttachmentInput) {
    setError(null);
    setAttachments((currentAttachments) =>
      [attachment, ...currentAttachments].slice(0, maxAttachmentCount),
    );
  }

  function removeAttachment(fileName: string) {
    setAttachments((currentAttachments) =>
      currentAttachments.filter(
        (attachment) => attachment.fileName !== fileName,
      ),
    );
  }

  function resetForm() {
    setDescription("");
    setRequestedDeliveryDate("");
    setTechnicalSummary("");
    setExpectedResult("");
    setActualResult("");
    setAttachments([]);
  }

  function restoreFromCompactRecording() {
    onRestoreRequest?.();
  }

  function finishCompactRecording() {
    if (recordingKind) {
      stopActiveRecording();
    }

    restoreFromCompactRecording();
  }

  if (compactRecordingMode) {
    const recordingLabel =
      recordingKind === "audio"
        ? "audio"
        : recordingKind === "screen"
          ? "tela"
          : "evidencia";
    const compactStatus = recordingKind
      ? `Gravando ${recordingLabel}.`
      : isProcessingRecording
        ? "Preparando evidencia."
        : lastRecordingFileName
          ? "Gravacao salva."
          : "Athena minimizada.";

    return (
      <div className="rounded-xl border border-[#A07C3B]/25 bg-white p-3 shadow-[0_18px_55px_rgba(15,23,42,0.22)]">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#101820] text-[#A07C3B]">
            {recordingKind === "audio" ? (
              <Mic className="size-4" aria-hidden="true" />
            ) : (
              <Video className="size-4" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-semibold text-[#101820]">
              {compactStatus}
            </p>
            <p className="m-0 mt-1 text-xs leading-5 text-slate-500">
              {recordingKind
                ? "A janela foi minimizada para manter a gravacao ativa."
                : "Volte para a Athena para revisar a evidencia e enviar o ticket."}
            </p>
            {lastRecordingFileName ? (
              <p className="m-0 mt-1 truncate text-xs font-semibold text-slate-600">
                {lastRecordingFileName}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {recordingKind ? (
            <button
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 transition hover:bg-red-100"
              onClick={stopActiveRecording}
              type="button"
            >
              <Square className="size-3.5" aria-hidden="true" />
              Stop
            </button>
          ) : null}
          <button
            className="inline-flex h-8 items-center gap-2 rounded-lg bg-[#101820] px-3 text-xs font-semibold text-white transition hover:bg-[#1b2835] disabled:cursor-wait disabled:opacity-60"
            disabled={isProcessingRecording}
            onClick={
              recordingKind ? finishCompactRecording : restoreFromCompactRecording
            }
            type="button"
          >
            {isProcessingRecording ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
            )}
            Finalizar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {visibleError ? (
        <InlineNotice
          tone={
            isHubItTicketsMigrationPendingMessage(visibleError)
              ? "warning"
              : "danger"
          }
          icon={<AlertTriangle className="size-4" />}
        >
          {visibleError}
        </InlineNotice>
      ) : null}

      {successProtocol ? (
        <InlineNotice tone="success" icon={<CheckCircle2 className="size-4" />}>
          Ticket {successProtocol} enviado para Zeus.
        </InlineNotice>
      ) : null}

      <label className="grid gap-1.5">
        <span className="text-xs font-semibold uppercase text-slate-400">
          O que aconteceu?
        </span>
        <textarea
          className="min-h-28 resize-none rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm leading-6 text-slate-800 outline-none transition focus:border-[#A07C3B]/50 focus:bg-white focus:ring-2 focus:ring-[#A07C3B]/10"
          onChange={(event) => {
            setDescription(event.target.value);
            setError(null);
            clearRecordingError();
          }}
          placeholder="Escreva em poucas palavras. Ex.: tela lenta, erro ao salvar, botao nao abriu."
          value={description}
        />
      </label>

      <label className="grid gap-1.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-400">
          <CalendarDays className="size-3.5 text-[#A07C3B]" />
          Data de entrega desejada
        </span>
        <input
          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#A07C3B]/45 focus:ring-2 focus:ring-[#A07C3B]/10"
          min={getTodayDateInput()}
          onChange={(event) => {
            setRequestedDeliveryDate(event.target.value);
            setError(null);
          }}
          type="date"
          value={requestedDeliveryDate}
        />
      </label>

      <div className="grid grid-cols-3 gap-2">
        <SelectField
          label="Modulo"
          onChange={setModuleName}
          options={[
            "Hub",
            "Hades",
            "Iris",
            "Hermes",
            "Setup",
            "Zeus",
          ]}
          value={moduleName}
        />
        <SelectField
          label="Tipo"
          onChange={(value) => setCategory(value as HubItTicketCategory)}
          options={Object.entries(hubItTicketCategoryLabels).map(
            ([value, label]) => ({ label, value }),
          )}
          value={category}
        />
        <SelectField
          label="Impacto"
          onChange={(value) => setPriority(value as HubItTicketPriority)}
          options={Object.entries(hubItTicketPriorityLabels).map(
            ([value, label]) => ({ label, value }),
          )}
          value={priority}
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <EvidenceButton
            icon={<Camera className="size-3.5" />}
            label="Print"
            onClick={() => void captureScreenFrame()}
          />
          <EvidenceButton
            icon={
              recordingKind === "screen" ? (
                <Square className="size-3.5 text-red-600" />
              ) : (
                <Video className="size-3.5" />
              )
            }
            label={recordingKind === "screen" ? "Parar tela" : "Gravar tela"}
            onClick={() => void toggleScreenRecording()}
          />
          <EvidenceButton
            icon={
              recordingKind === "audio" ? (
                <Square className="size-3.5 text-red-600" />
              ) : (
                <Mic className="size-3.5" />
              )
            }
            label={recordingKind === "audio" ? "Parar audio" : "Audio"}
            onClick={() => void toggleAudioRecording()}
          />
          <EvidenceButton
            icon={<Paperclip className="size-3.5" />}
            label="Anexar"
            onClick={() => fileInputRef.current?.click()}
          />
          <input
            accept="audio/*,image/*,video/webm,video/mp4"
            className="hidden"
            multiple
            onChange={(event) => void handleFileInputChange(event)}
            ref={fileInputRef}
            type="file"
          />
        </div>

        <EvidencePreviewList
          attachments={attachments}
          isAnalyzing={isAnalyzingEvidence}
          onRemove={removeAttachment}
        />
      </div>

      <label className="grid gap-1.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-400">
          <Sparkles className="size-3.5 text-[#A07C3B]" />
          Athena organizou tecnicamente
        </span>
        <textarea
          className="min-h-28 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs leading-5 text-slate-700 outline-none transition focus:border-[#A07C3B]/50 focus:ring-2 focus:ring-[#A07C3B]/10"
          onChange={(event) => setTechnicalSummary(event.target.value)}
          value={technicalSummary}
        />
      </label>

      <div className="flex justify-end">
        <Tooltip content={submitTooltip} placement="top">
          <button
            aria-label="Enviar para Zeus"
            aria-disabled={isSaving || submitNeedsContext}
            className={`grid size-11 place-items-center rounded-xl text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
              submitNeedsContext
                ? "bg-[#A07C3B]/55 hover:bg-[#A07C3B]/70"
                : "bg-[#A07C3B] hover:bg-[#8f6f35]"
            }`}
            disabled={isSaving}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function EvidenceButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition hover:border-[#A07C3B]/30 hover:text-[#7A5E2C]"
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function SelectField({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<string | { label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[0.68rem] font-semibold uppercase text-slate-400">
        {label}
      </span>
      <select
        className="h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 outline-none focus:border-[#A07C3B]/45 focus:ring-2 focus:ring-[#A07C3B]/10"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => {
          const optionValue =
            typeof option === "string" ? option : option.value;
          const optionLabel =
            typeof option === "string" ? option : option.label;

          return (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function InlineNotice({
  children,
  icon,
  tone,
}: {
  children: ReactNode;
  icon: ReactNode;
  tone: "danger" | "success" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <div
      className={`flex items-start gap-2 rounded-lg border p-3 text-sm font-semibold ${toneClass}`}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function EvidencePreviewList({
  attachments,
  isAnalyzing,
  onRemove,
}: {
  attachments: HubItTicketAttachmentInput[];
  isAnalyzing: boolean;
  onRemove: (fileName: string) => void;
}) {
  if (attachments.length === 0) {
    return (
      <p className="m-0 mt-3 text-xs text-slate-500">
        Athena le print, audio e quadros do video quando houver anexo.
      </p>
    );
  }

  return (
    <div className="mt-3 grid gap-2">
      <p className="m-0 text-xs font-semibold text-slate-500">
        {isAnalyzing
          ? "Athena analisando evidencias..."
          : "Evidencias lidas pela Athena."}
      </p>
      {attachments.map((attachment) => (
        <AttachmentPreviewCard
          attachment={attachment}
          key={attachment.fileName}
          onRemove={() => onRemove(attachment.fileName)}
        />
      ))}
    </div>
  );
}

function AttachmentPreviewCard({
  attachment,
  onRemove,
}: {
  attachment: HubItTicketAttachmentInput;
  onRemove: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {attachment.type === "image" && attachment.dataUrl ? (
        <Image
          alt={attachment.fileName}
          className="h-32 w-full object-cover"
          height={128}
          src={attachment.dataUrl}
          unoptimized
          width={480}
        />
      ) : null}
      {attachment.type === "video" && attachment.dataUrl ? (
        <video
          className="h-32 w-full bg-slate-950 object-contain"
          controls
          src={attachment.dataUrl}
        />
      ) : null}
      {attachment.type === "audio" && attachment.dataUrl ? (
        <div className="grid min-h-24 place-items-center bg-slate-100 p-3">
          <audio className="w-full" controls src={attachment.dataUrl} />
        </div>
      ) : null}
      {!attachment.dataUrl || attachment.type === "file" ? (
        <div className="grid h-24 place-items-center bg-slate-100 text-slate-400">
          {attachment.type === "image" ? (
            <ImageIcon className="size-6" />
          ) : null}
          {attachment.type === "video" ? (
            <FileVideo className="size-6" />
          ) : null}
          {attachment.type === "audio" ? (
            <FileAudio className="size-6" />
          ) : null}
          {attachment.type === "file" ? <FileText className="size-6" /> : null}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-semibold text-slate-950">
            {attachment.fileName}
          </p>
          <p className="m-0 mt-1 text-xs text-slate-500">
            {attachment.type} / {formatBytes(attachment.sizeBytes)}
          </p>
        </div>
        <button
          aria-label="Remover evidencia"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-50 hover:text-slate-900"
          onClick={onRemove}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

function getModuleFromPath(pathname: string) {
  if (pathname.startsWith("/hades")) return "Hades";
  if (pathname.startsWith("/iris")) return "Iris";
  if (pathname.startsWith("/hermes")) return "Hermes";
  if (pathname.startsWith("/setup")) return "Setup";
  if (pathname.startsWith("/zeus")) return "Zeus";

  return "Hub";
}

function inferCategory(description: string): HubItTicketCategory {
  const text = normalize(description);

  if (text.includes("melhor") || text.includes("evolu")) return "melhoria";
  if (text.includes("sugest")) return "sugestao";
  if (text.includes("lento") || text.includes("trav")) return "performance";
  if (text.includes("acesso") || text.includes("login")) return "acesso";
  if (text.includes("bug")) return "bug";

  return "erro";
}

function inferPriority(description: string): HubItTicketPriority {
  const text = normalize(description);

  if (
    text.includes("parou") ||
    text.includes("nao consigo trabalhar") ||
    text.includes("critico") ||
    text.includes("urgente")
  ) {
    return "critica";
  }

  if (text.includes("erro") || text.includes("falha") || text.includes("bug")) {
    return "alta";
  }

  return "media";
}

function buildTicketTitle(description: string, moduleName: string) {
  const firstSentence = description
    .split(/[.!?\n]/)
    .map((item) => item.trim())
    .find(Boolean);
  const summary = firstSentence ?? "Solicitacao HelpDesk";

  return `[${moduleName}] ${summary}`.slice(0, 120);
}

function buildTechnicalSummary({
  attachments,
  category,
  description,
  moduleName,
  pathname,
  priority,
  requestedDeliveryDate,
}: {
  attachments: HubItTicketAttachmentInput[];
  category: HubItTicketCategory;
  description: string;
  moduleName: string;
  pathname: string;
  priority: HubItTicketPriority;
  requestedDeliveryDate: string;
}) {
  const lines = [
    `Modulo afetado: ${moduleName}`,
    `Rota/tela: ${pathname}`,
    `Tipo classificado: ${hubItTicketCategoryLabels[category]}`,
    `Impacto estimado: ${hubItTicketPriorityLabels[priority]}`,
    `Data de entrega solicitada: ${formatDateOnly(requestedDeliveryDate)}`,
    `Relato original: ${description.trim()}`,
    "Evidencias consideradas:",
    buildEvidenceSummary(attachments),
    "Triagem Athena: revisar rota, reproduzir fluxo informado, validar evidencias anexadas e devolver status ao usuario pelo Zeus.",
  ];

  return lines.join("\n");
}

function buildUserDescription(
  description: string,
  attachments: HubItTicketAttachmentInput[],
) {
  const trimmedDescription = description.trim();

  if (trimmedDescription) {
    return trimmedDescription;
  }

  return attachments.length > 0 ? "Evidencia anexada pelo usuario." : "";
}

function buildEvidenceSummary(attachments: HubItTicketAttachmentInput[]) {
  if (attachments.length === 0) {
    return "- Sem print, video ou audio anexado.";
  }

  return attachments
    .map(
      (attachment, index) =>
        `- ${index + 1}. ${getAttachmentLabel(attachment.type)} ${attachment.fileName} (${formatBytes(attachment.sizeBytes)})`,
    )
    .join("\n");
}

function inferExpectedResult(description: string) {
  const match = description.match(/esperava(?: que)?(.+?)(?:\.|\n|$)/i);
  return match?.[1]?.trim() ?? "";
}

function inferActualResult(description: string) {
  const match = description.match(
    /(?:aconteceu|ocorreu|erro)(.+?)(?:\.|\n|$)/i,
  );
  return match?.[1]?.trim() ?? "";
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function getTodayDateInput() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDateOnly(value: string) {
  const [year, month, day] = value.split("-");

  if (!year || !month || !day) {
    return "nao informada";
  }

  return `${day}/${month}/${year}`;
}
