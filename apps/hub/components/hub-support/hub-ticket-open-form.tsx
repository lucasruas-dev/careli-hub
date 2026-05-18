"use client";

import {
  analyzeHubItTicketEvidence,
  createHubItTicket,
  isHubItTicketsMigrationPendingMessage,
} from "@/lib/hub-it-tickets/client";
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
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

type RecordingKind = "audio" | "screen";

type HubTicketOpenFormProps = {
  defaultModule?: string;
  onCreated?: (protocol: string) => void;
  sourcePath?: string;
};

const maxAttachmentBytes = 6_000_000;
const maxAttachmentCount = 3;

export function HubTicketOpenForm({
  defaultModule,
  onCreated,
  sourcePath,
}: HubTicketOpenFormProps) {
  const { authState } = useAuth();
  const pathname = usePathname();
  const currentPath = sourcePath ?? pathname;
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
  const canSubmit = description.trim().length >= 3 || attachments.length > 0;
  const [isAnalyzingEvidence, setIsAnalyzingEvidence] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [recordingKind, setRecordingKind] = useState<RecordingKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successProtocol, setSuccessProtocol] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingAttachmentTypeRef =
    useRef<HubItTicketAttachmentInput["type"]>("video");
  const recordingFilePrefixRef = useRef("gravacao");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const accessToken = authState.session?.accessToken ?? null;

  useEffect(() => {
    setModuleName(defaultModule ?? getModuleFromPath(currentPath));
  }, [currentPath, defaultModule]);

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
      }),
    );
    setExpectedResult(inferExpectedResult(ticketDescription));
    setActualResult(inferActualResult(ticketDescription));
  }, [attachments, currentPath, description, moduleName]);

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
    return () => {
      stopRecordingStream();
    };
  }, []);

  async function handleSubmit() {
    const ticketDescription = buildUserDescription(description, attachments);

    if (!canSubmit || ticketDescription.length < 3) {
      setError("Descreva em poucas palavras ou anexe uma evidencia.");
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
          sourcePath: currentPath,
          sourceUrl:
            typeof window !== "undefined" ? window.location.href : undefined,
          technicalSummary:
            technicalSummary ||
            buildTechnicalSummary({
              attachments,
              category,
              description: ticketDescription,
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

      startRecording(stream, {
        attachmentType: "video",
        filePrefix: "gravacao",
        kind: "screen",
        timeoutMs: 15_000,
      });
    } catch {
      stopRecordingStream();
      setRecordingKind(null);
      setError("Gravacao cancelada ou nao autorizada.");
    }
  }

  async function toggleAudioRecording() {
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
      kind: RecordingKind;
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
      const blob = new Blob(recordingChunksRef.current, {
        type:
          recorder.mimeType ||
          (attachmentType === "audio" ? "audio/webm" : "video/webm"),
      });

      stopRecordingStream();
      setRecordingKind(null);
      void addBlobAttachment(blob, {
        fileName: `${filePrefix}-${formatAttachmentStamp()}.webm`,
        type: attachmentType,
      });
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
    setAttachments((currentAttachments) => [
      attachment,
      ...currentAttachments,
    ].slice(0, maxAttachmentCount));
  }

  function removeAttachment(fileName: string) {
    setAttachments((currentAttachments) =>
      currentAttachments.filter((attachment) => attachment.fileName !== fileName),
    );
  }

  function resetForm() {
    setDescription("");
    setTechnicalSummary("");
    setExpectedResult("");
    setActualResult("");
    setAttachments([]);
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

  return (
    <div className="grid gap-3">
      {error ? (
        <InlineNotice
          tone={
            isHubItTicketsMigrationPendingMessage(error) ? "warning" : "danger"
          }
          icon={<AlertTriangle className="size-4" />}
        >
          {error}
        </InlineNotice>
      ) : null}

      {successProtocol ? (
        <InlineNotice tone="success" icon={<CheckCircle2 className="size-4" />}>
          Ticket {successProtocol} enviado para HubOps.
        </InlineNotice>
      ) : null}

      <label className="grid gap-1.5">
        <span className="text-xs font-semibold uppercase text-slate-400">
          O que aconteceu?
        </span>
        <textarea
          className="min-h-28 resize-none rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm leading-6 text-slate-800 outline-none transition focus:border-[#A07C3B]/50 focus:bg-white focus:ring-2 focus:ring-[#A07C3B]/10"
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Escreva em poucas palavras. Ex.: tela lenta, erro ao salvar, botao nao abriu."
          value={description}
        />
      </label>

      <div className="grid grid-cols-3 gap-2">
        <SelectField
          label="Modulo"
          onChange={setModuleName}
          options={["Hub", "Guardian", "CareDesk", "PulseX", "Setup", "HubOps"]}
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
          Caca organizou tecnicamente
        </span>
        <textarea
          className="min-h-28 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs leading-5 text-slate-700 outline-none transition focus:border-[#A07C3B]/50 focus:ring-2 focus:ring-[#A07C3B]/10"
          onChange={(event) => setTechnicalSummary(event.target.value)}
          value={technicalSummary}
        />
      </label>

      <div className="flex justify-end">
        <button
          aria-label="Enviar para HubOps"
          className="grid size-11 place-items-center rounded-xl bg-[#A07C3B] text-white transition hover:bg-[#8f6f35] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isSaving || !canSubmit}
          onClick={() => void handleSubmit()}
          title="Enviar para HubOps"
          type="button"
        >
          {isSaving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </button>
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
          const optionValue = typeof option === "string" ? option : option.value;
          const optionLabel = typeof option === "string" ? option : option.label;

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
    <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm font-semibold ${toneClass}`}>
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
        Caca le print, audio e quadros do video quando houver anexo.
      </p>
    );
  }

  return (
    <div className="mt-3 grid gap-2">
      <p className="m-0 text-xs font-semibold text-slate-500">
        {isAnalyzing ? "Caca analisando evidencias..." : "Evidencias lidas pela Caca."}
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
        <video className="h-32 w-full bg-slate-950 object-contain" controls src={attachment.dataUrl} />
      ) : null}
      {attachment.type === "audio" && attachment.dataUrl ? (
        <div className="grid min-h-24 place-items-center bg-slate-100 p-3">
          <audio className="w-full" controls src={attachment.dataUrl} />
        </div>
      ) : null}
      {!attachment.dataUrl || attachment.type === "file" ? (
        <div className="grid h-24 place-items-center bg-slate-100 text-slate-400">
          {attachment.type === "image" ? <ImageIcon className="size-6" /> : null}
          {attachment.type === "video" ? <FileVideo className="size-6" /> : null}
          {attachment.type === "audio" ? <FileAudio className="size-6" /> : null}
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
  if (pathname.startsWith("/guardian")) return "Guardian";
  if (pathname.startsWith("/caredesk")) return "CareDesk";
  if (pathname.startsWith("/pulsex")) return "PulseX";
  if (pathname.startsWith("/setup")) return "Setup";
  if (pathname.startsWith("/squadops")) return "HubOps";

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
  const summary = firstSentence ?? "Solicitacao TI";

  return `[${moduleName}] ${summary}`.slice(0, 120);
}

function buildTechnicalSummary({
  attachments,
  category,
  description,
  moduleName,
  pathname,
  priority,
}: {
  attachments: HubItTicketAttachmentInput[];
  category: HubItTicketCategory;
  description: string;
  moduleName: string;
  pathname: string;
  priority: HubItTicketPriority;
}) {
  const lines = [
    `Modulo afetado: ${moduleName}`,
    `Rota/tela: ${pathname}`,
    `Tipo classificado: ${hubItTicketCategoryLabels[category]}`,
    `Impacto estimado: ${hubItTicketPriorityLabels[priority]}`,
    `Relato original: ${description.trim()}`,
    "Evidencias consideradas:",
    buildEvidenceSummary(attachments),
    "Triagem Caca: revisar rota, reproduzir fluxo informado, validar evidencias anexadas e devolver status ao usuario pelo HubOps.",
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

async function extractVideoFrameDataUrls(blob: Blob) {
  if (typeof document === "undefined") {
    return [];
  }

  const videoUrl = URL.createObjectURL(blob);
  const video = document.createElement("video");

  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = videoUrl;

  try {
    await waitForVideoMetadata(video);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const frameTimes = Array.from(
      new Set(
        [duration > 1 ? Math.min(0.8, duration * 0.25) : 0, duration > 2 ? duration * 0.75 : 0]
          .map((time) => Math.max(0, Math.min(time, Math.max(0, duration - 0.1))))
          .map((time) => Number(time.toFixed(2))),
      ),
    );
    const frames: string[] = [];

    for (const frameTime of frameTimes) {
      await seekVideo(video, frameTime);
      const frame = captureVideoFrame(video);

      if (frame) {
        frames.push(frame);
      }
    }

    return frames.slice(0, 2);
  } catch {
    return [];
  } finally {
    URL.revokeObjectURL(videoUrl);
  }
}

function waitForVideoMetadata(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("timeout")), 4_000);

    video.addEventListener(
      "loadedmetadata",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    video.addEventListener(
      "error",
      () => {
        window.clearTimeout(timeout);
        reject(new Error("video"));
      },
      { once: true },
    );
  });
}

function seekVideo(video: HTMLVideoElement, currentTime: number) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("timeout")), 4_000);

    video.addEventListener(
      "seeked",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    video.currentTime = currentTime;
  });
}

function captureVideoFrame(video: HTMLVideoElement) {
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    return "";
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(video, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", 0.72);
}

function inferExpectedResult(description: string) {
  const match = description.match(/esperava(?: que)?(.+?)(?:\.|\n|$)/i);
  return match?.[1]?.trim() ?? "";
}

function inferActualResult(description: string) {
  const match = description.match(/(?:aconteceu|ocorreu|erro)(.+?)(?:\.|\n|$)/i);
  return match?.[1]?.trim() ?? "";
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function getAttachmentTypeFromMime(
  mimeType: string,
): HubItTicketAttachmentInput["type"] {
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";

  return "file";
}

function getAttachmentLabel(type: HubItTicketAttachmentInput["type"]) {
  const labels = {
    audio: "Audio",
    file: "Arquivo",
    image: "Print",
    video: "Video",
  } as const satisfies Record<HubItTicketAttachmentInput["type"], string>;

  return labels[type];
}

function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Math.ceil((base64.length * 3) / 4);
}

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

function formatAttachmentStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes = bytes / 1024;

  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(kilobytes >= 100 ? 0 : 1)} KB`;
  }

  const megabytes = kilobytes / 1024;

  return `${megabytes.toFixed(megabytes >= 10 ? 1 : 2)} MB`;
}
