"use client";

import {
  isHubItTicketsMigrationPendingMessage,
  loadHubItTickets,
  updateHubItTicket,
} from "@/lib/hub-it-tickets/client";
import {
  hubItTicketCategoryLabels,
  hubItTicketPriorityLabels,
  hubItTicketStatusLabels,
  hubItTicketStatuses,
  type HubItTicket,
  type HubItTicketAttachmentInput,
  type HubItTicketStatus,
} from "@/lib/hub-it-tickets/types";
import { useAuth } from "@/providers/auth-provider";
import { Badge, Surface, Tooltip } from "@repo/uix";
import type { BadgeVariant } from "@repo/uix";
import {
  AlertTriangle,
  Camera,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileAudio,
  FileText,
  FileVideo,
  ImageIcon,
  Loader2,
  MessageSquareReply,
  Mic,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  Video,
  X,
  XCircle,
} from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

type TicketFilter = "todos" | HubItTicketStatus;

type HubUserTicketsPanelProps = {
  compact?: boolean;
  title?: string;
};

export function HubUserTicketsPanel({
  compact = false,
  title = "Historico HelpDesk",
}: HubUserTicketsPanelProps) {
  const { authState } = useAuth();
  const accessToken = authState.session?.accessToken ?? null;
  const [tickets, setTickets] = useState<HubItTicket[]>([]);
  const [selectedProtocol, setSelectedProtocol] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<TicketFilter>("todos");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredTickets = useMemo(() => {
    if (statusFilter === "todos") {
      return tickets;
    }

    return tickets.filter((ticket) => ticket.status === statusFilter);
  }, [statusFilter, tickets]);

  const selectedTicket =
    tickets.find((ticket) => ticket.protocol === selectedProtocol) ?? null;

  const loadTickets = useCallback(async () => {
    if (!accessToken) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const nextTickets = await loadHubItTickets({
        accessToken,
        scope: "mine",
      });
      setTickets(nextTickets);
      setSelectedProtocol((currentProtocol) =>
        currentProtocol &&
        nextTickets.some((ticket) => ticket.protocol === currentProtocol)
          ? currentProtocol
          : null,
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Nao foi possivel carregar seu historico de tickets.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    if (
      selectedProtocol &&
      !filteredTickets.some((ticket) => ticket.protocol === selectedProtocol)
    ) {
      setSelectedProtocol(null);
    }
  }, [filteredTickets, selectedProtocol]);

  async function sendCustomerAction(
    action: "customer_close" | "customer_review",
    payload: {
      attachments?: HubItTicketAttachmentInput[];
      customerResponse?: string;
    } = {},
  ) {
    if (!selectedTicket) {
      return;
    }

    const reviewText = payload.customerResponse?.trim() ?? "";
    const reviewAttachments = payload.attachments ?? [];

    if (
      action === "customer_review" &&
      reviewText.length < 3 &&
      reviewAttachments.length === 0
    ) {
      setError(
        "Descreva rapidamente o que ainda precisa ser revisado ou anexe uma evidencia.",
      );
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const updatedTicket = await updateHubItTicket({
        accessToken,
        input: {
          action,
          attachments:
            action === "customer_review" ? reviewAttachments : undefined,
          customerResponse:
            action === "customer_review" ? reviewText : undefined,
          protocol: selectedTicket.protocol,
        },
      });

      setTickets((currentTickets) =>
        currentTickets.map((ticket) =>
          ticket.id === updatedTicket.id ? updatedTicket : ticket,
        ),
      );
      setSelectedProtocol(updatedTicket.protocol);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Nao foi possivel atualizar o ticket.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (!accessToken) {
    return (
      <Surface bordered className="border-amber-100 bg-amber-50 p-4">
        <div className="flex items-center gap-3 text-sm font-semibold text-amber-800">
          <AlertTriangle className="size-4" />
          Sessao ausente para carregar HelpDesk.
        </div>
      </Surface>
    );
  }

  return (
    <section className={compact ? "grid gap-3" : "grid gap-5"}>
      <Surface bordered className="border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="m-0 text-xs font-semibold uppercase text-slate-500">
              HelpDesk
            </p>
            <h2 className="m-0 mt-1 text-base font-semibold text-slate-950">
              {title}
            </h2>
          </div>
          <button
            aria-label="Atualizar historico de tickets"
            className="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-[#A07C3B]/30 hover:text-slate-950"
            onClick={() => void loadTickets()}
            type="button"
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <FilterButton
            active={statusFilter === "todos"}
            label={`Todos ${tickets.length}`}
            onClick={() => setStatusFilter("todos")}
          />
          {hubItTicketStatuses.map((status) => (
            <FilterButton
              active={statusFilter === status}
              key={status}
              label={`${hubItTicketStatusLabels[status]} ${countByStatus(tickets, status)}`}
              onClick={() => setStatusFilter(status)}
            />
          ))}
        </div>

        {error ? <OperationalErrorNotice message={error} /> : null}
      </Surface>

      <Surface bordered className="border-slate-200 bg-white p-3">
        <div
          className={
            compact
              ? "grid max-h-72 gap-2 overflow-y-auto"
              : "grid gap-3 md:grid-cols-2 xl:grid-cols-3"
          }
        >
          {filteredTickets.length > 0 ? (
            filteredTickets.map((ticket) => (
              <TicketHistoryItem
                active={ticket.protocol === selectedTicket?.protocol}
                key={ticket.id}
                onClick={() => setSelectedProtocol(ticket.protocol)}
                ticket={ticket}
              />
            ))
          ) : (
            <EmptyState isLoading={isLoading} />
          )}
        </div>
      </Surface>

      {selectedTicket ? (
        <TicketModal
          onClose={() => setSelectedProtocol(null)}
          title={selectedTicket.protocol}
        >
          <TicketDetail
            isSaving={isSaving}
            onClose={() => void sendCustomerAction("customer_close")}
            onReview={(payload) =>
              void sendCustomerAction("customer_review", payload)
            }
            ticket={selectedTicket}
          />
        </TicketModal>
      ) : null}
    </section>
  );
}

function OperationalErrorNotice({ message }: { message: string }) {
  const isMigrationPending = isHubItTicketsMigrationPendingMessage(message);
  const className = isMigrationPending
    ? "mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800"
    : "mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700";

  return <div className={className}>{message}</div>;
}

function TicketModal({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4">
      <button
        aria-label="Fechar detalhe do ticket"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <div className="relative max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="font-mono text-sm font-semibold text-[#7A5E2C]">
            {title}
          </span>
          <button
            aria-label="Fechar detalhe do ticket"
            className="grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-950"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function TicketHistoryItem({
  active,
  onClick,
  ticket,
}: {
  active: boolean;
  onClick: () => void;
  ticket: HubItTicket;
}) {
  return (
    <button
      className={`rounded-lg border p-3 text-left transition ${
        active
          ? "border-[#A07C3B]/35 bg-[#A07C3B]/5"
          : "border-slate-200 bg-slate-50/60 hover:border-[#A07C3B]/25 hover:bg-white"
      }`}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 truncate font-mono text-xs font-semibold text-[#7A5E2C]">
            {ticket.protocol}
          </p>
          <p className="m-0 mt-1 line-clamp-2 text-sm font-semibold text-slate-950">
            {ticket.title}
          </p>
        </div>
        <StatusBadge status={ticket.status} />
      </div>
      <div className="mt-2">
        <DeliveryDueBadge ticket={ticket} />
      </div>
      <p className="m-0 mt-2 truncate text-xs text-slate-500">
        {ticket.module} / {formatDateTime(ticket.updatedAt)}
      </p>
    </button>
  );
}

function TicketDetail({
  isSaving,
  onClose,
  onReview,
  ticket,
}: {
  isSaving: boolean;
  onClose: () => void;
  onReview: (payload: {
    attachments: HubItTicketAttachmentInput[];
    customerResponse: string;
  }) => void;
  ticket: HubItTicket;
}) {
  const awaitingClient = ticket.status === "aguardando_cliente";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingTypeRef = useRef<HubItTicketAttachmentInput["type"]>("video");
  const recordingPrefixRef = useRef("gravacao");
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [reviewText, setReviewText] = useState("");
  const [reviewAttachments, setReviewAttachments] = useState<
    HubItTicketAttachmentInput[]
  >([]);
  const [recordingKind, setRecordingKind] = useState<"audio" | "screen" | null>(
    null,
  );
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  useEffect(() => {
    setIsReviewMode(false);
    setReviewText("");
    setReviewAttachments([]);
    setEvidenceError(null);
  }, [ticket.protocol]);

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);

  const canSubmitReview =
    reviewText.trim().length >= 3 || reviewAttachments.length > 0;

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);

    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    await addEvidenceFiles(files);
  }

  async function addEvidenceFiles(files: File[]) {
    const nextAttachments: HubItTicketAttachmentInput[] = [];

    for (const file of files) {
      if (
        reviewAttachments.length + nextAttachments.length >=
        maxReviewEvidenceCount
      ) {
        setEvidenceError(
          `Limite de ${maxReviewEvidenceCount} evidencias por revisao.`,
        );
        break;
      }

      if (file.size > maxReviewEvidenceBytes) {
        setEvidenceError("Arquivo acima de 6 MB.");
        continue;
      }

      nextAttachments.push(
        await createReviewAttachment(file, {
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      );
    }

    if (nextAttachments.length > 0) {
      setReviewAttachments((currentAttachments) => [
        ...currentAttachments,
        ...nextAttachments,
      ]);
      setEvidenceError(null);
    }
  }

  async function handleCapturePrint() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setEvidenceError("Captura de tela indisponivel neste navegador.");
      return;
    }

    let stream: MediaStream | null = null;

    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: true,
      });
      const video = document.createElement("video");

      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      const canvas = document.createElement("canvas");

      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas
        .getContext("2d")
        ?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png", 0.92),
      );

      if (!blob) {
        throw new Error("print-unavailable");
      }

      const attachment = await createReviewAttachment(blob, {
        fileName: `print-revisao-${formatEvidenceFileTime(new Date())}.png`,
        mimeType: "image/png",
        sizeBytes: blob.size,
        type: "image",
      });

      setReviewAttachments((currentAttachments) =>
        [attachment, ...currentAttachments].slice(0, maxReviewEvidenceCount),
      );
      setEvidenceError(null);
    } catch {
      setEvidenceError("Nao foi possivel capturar o print.");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

  async function handleToggleRecording(kind: "audio" | "screen") {
    if (recordingKind === kind) {
      mediaRecorderRef.current?.stop();
      return;
    }

    if (recordingKind) {
      setEvidenceError("Finalize a gravacao atual antes de iniciar outra.");
      return;
    }

    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices) {
      setEvidenceError("Gravacao indisponivel neste navegador.");
      return;
    }

    try {
      const stream =
        kind === "audio"
          ? await navigator.mediaDevices.getUserMedia({ audio: true })
          : await navigator.mediaDevices.getDisplayMedia({
              audio: true,
              video: true,
            });
      const recorder = new MediaRecorder(stream);

      recordingChunksRef.current = [];
      recordingStartedAtRef.current = Date.now();
      recordingTypeRef.current = kind === "audio" ? "audio" : "video";
      recordingPrefixRef.current = kind === "audio" ? "audio" : "video";
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      });
      recorder.addEventListener("stop", () => {
        void finalizeRecording(recorder.mimeType);
      });

      recorder.start();
      setRecordingKind(kind);
      setEvidenceError(null);
    } catch {
      stopRecording();
      setEvidenceError(
        kind === "audio"
          ? "Permita o microfone para gravar audio."
          : "Permita a tela para gravar video.",
      );
    }
  }

  async function finalizeRecording(mimeType: string) {
    const durationSeconds = recordingStartedAtRef.current
      ? Math.max(
          1,
          Math.round((Date.now() - recordingStartedAtRef.current) / 1000),
        )
      : undefined;
    const type = recordingTypeRef.current;
    const blob = new Blob(recordingChunksRef.current, {
      type: mimeType || (type === "audio" ? "audio/webm" : "video/webm"),
    });

    stopRecording();

    if (blob.size > maxReviewEvidenceBytes) {
      setEvidenceError("Gravacao acima de 6 MB.");
      return;
    }

    try {
      const attachment = await createReviewAttachment(blob, {
        durationSeconds,
        fileName: `${recordingPrefixRef.current}-revisao-${formatEvidenceFileTime(new Date())}.webm`,
        mimeType: blob.type,
        sizeBytes: blob.size,
        type,
      });

      setReviewAttachments((currentAttachments) =>
        [attachment, ...currentAttachments].slice(0, maxReviewEvidenceCount),
      );
      setEvidenceError(null);
    } catch {
      setEvidenceError("Nao foi possivel preparar a gravacao.");
    }
  }

  function stopRecording() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    recordingChunksRef.current = [];
    recordingStartedAtRef.current = null;
    setRecordingKind(null);
  }

  function submitReview() {
    if (!canSubmitReview || isSaving) {
      setEvidenceError("Informe uma observacao curta ou anexe uma evidencia.");
      return;
    }

    onReview({
      attachments: reviewAttachments,
      customerResponse: reviewText.trim(),
    });
  }

  return (
    <article className="grid gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-[#7A5E2C]">
              {ticket.protocol}
            </span>
            <StatusBadge status={ticket.status} />
            <Badge variant={priorityVariant(ticket.priority)}>
              {hubItTicketPriorityLabels[ticket.priority]}
            </Badge>
            <DeliveryDueBadge ticket={ticket} />
          </div>
          <h3 className="m-0 mt-2 text-lg font-semibold text-slate-950">
            {ticket.title}
          </h3>
          <p className="m-0 mt-1 text-xs text-slate-500">
            {ticket.module} / {hubItTicketCategoryLabels[ticket.category]} /
            aberto em {formatDateTime(ticket.createdAt)}
          </p>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        <UserInfoCard
          label="Solicitante"
          name={ticket.requester.name}
          email={ticket.requester.email}
        />
        <UserInfoCard
          label="Tratando"
          name={ticket.assignedTo?.name ?? "Zeus ainda nao atribuido"}
          email={ticket.assignedTo?.email}
        />
      </div>

      <DeliveryAgreementBlock ticket={ticket} />

      <DetailBlock label="Relato enviado" value={ticket.userDescription} />
      <DetailBlock
        label="Leitura tecnica da Athena"
        value={ticket.technicalSummary}
      />

      <div className="grid gap-3 md:grid-cols-2">
        <DetailBlock
          label="Como deveria funcionar"
          value={ticket.expectedResult || "Nao informado."}
        />
        <DetailBlock
          label="O que ocorreu"
          value={ticket.actualResult || "Nao informado."}
        />
      </div>

      <AttachmentsPreview attachments={ticket.attachments} />

      {ticket.adminResponse || ticket.resolutionSummary ? (
        <div className="grid gap-3 rounded-lg border border-[#A07C3B]/20 bg-[#fffaf0] p-3">
          {ticket.adminResponse ? (
            <DetailBlock
              label="Devolutiva Zeus"
              value={ticket.adminResponse}
            />
          ) : null}
          {ticket.resolutionSummary ? (
            <DetailBlock
              label="O que foi feito"
              value={ticket.resolutionSummary}
            />
          ) : null}
          {ticket.lastResponseBy ? (
            <p className="m-0 text-xs text-slate-500">
              Ultima resposta: {ticket.lastResponseBy.name}
            </p>
          ) : null}
        </div>
      ) : null}

      {awaitingClient ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <MessageSquareReply className="size-4" />
            Zeus devolveu. Voce decide se encerra ou volta para revisao.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              disabled={isSaving}
              onClick={onClose}
              type="button"
            >
              {isSaving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Encerrar ticket
            </button>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-800 transition hover:border-amber-400 disabled:opacity-60"
              disabled={isSaving}
              onClick={() => setIsReviewMode((currentValue) => !currentValue)}
              type="button"
            >
              <RotateCcw className="size-4" />
              Solicitar revisao
            </button>
          </div>
          {isReviewMode ? (
            <div className="mt-3 grid gap-3 rounded-lg border border-amber-200 bg-white p-3">
              <input
                accept="audio/*,image/*,video/*,.doc,.docx,.pdf,.ppt,.pptx,.xls,.xlsx,.txt"
                className="hidden"
                multiple
                onChange={handleFileChange}
                ref={fileInputRef}
                type="file"
              />
              <textarea
                className="min-h-24 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
                onChange={(event) => setReviewText(event.target.value)}
                placeholder="Descreva o que ainda nao resolveu ou o que precisa revisar."
                value={reviewText}
              />
              <div className="flex flex-wrap gap-2">
                <EvidenceButton
                  icon={<Camera className="size-4" />}
                  label="Print"
                  onClick={() => void handleCapturePrint()}
                />
                <EvidenceButton
                  active={recordingKind === "screen"}
                  icon={
                    recordingKind === "screen" ? (
                      <Square className="size-4" />
                    ) : (
                      <Video className="size-4" />
                    )
                  }
                  label={recordingKind === "screen" ? "Parar" : "Video"}
                  onClick={() => void handleToggleRecording("screen")}
                />
                <EvidenceButton
                  active={recordingKind === "audio"}
                  icon={
                    recordingKind === "audio" ? (
                      <Square className="size-4" />
                    ) : (
                      <Mic className="size-4" />
                    )
                  }
                  label={recordingKind === "audio" ? "Parar" : "Audio"}
                  onClick={() => void handleToggleRecording("audio")}
                />
                <EvidenceButton
                  icon={<Paperclip className="size-4" />}
                  label="Anexar"
                  onClick={() => fileInputRef.current?.click()}
                />
              </div>
              <ReviewEvidenceList
                attachments={reviewAttachments}
                onRemove={(fileName) =>
                  setReviewAttachments((currentAttachments) =>
                    currentAttachments.filter(
                      (attachment) => attachment.fileName !== fileName,
                    ),
                  )
                }
              />
              {evidenceError ? (
                <p className="m-0 text-xs font-semibold text-red-600">
                  {evidenceError}
                </p>
              ) : null}
              <Tooltip content="Enviar revisao" placement="top">
                <button
                  aria-label="Enviar revisao para Zeus"
                  className="grid size-11 place-items-center rounded-lg bg-[#A07C3B] text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                  disabled={!canSubmitReview || isSaving}
                  onClick={submitReview}
                  type="button"
                >
                  {isSaving ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <Send className="size-5" />
                  )}
                </button>
              </Tooltip>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
          <Clock3 className="size-4 text-[#A07C3B]" />
          Historico
        </div>
        <div className="mt-3 grid gap-2">
          {ticket.events.length > 0 ? (
            ticket.events.map((event) => (
              <div
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-600"
                key={event.id}
              >
                <span className="font-semibold text-slate-950">
                  {formatDateTime(event.createdAt)}
                </span>
                {" / "}
                {event.message}
              </div>
            ))
          ) : (
            <p className="m-0 text-sm text-slate-500">
              Sem historico registrado.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function DeliveryAgreementBlock({ ticket }: { ticket: HubItTicket }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
          <CalendarDays className="size-4 text-[#A07C3B]" />
          Data de entrega
        </div>
        <DeliveryDueBadge ticket={ticket} />
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <DeliveryInfo label="Solicitada" value={formatNullableDate(ticket.requestedDeliveryDate)} />
        <DeliveryInfo
          label="Zeus"
          value={formatNullableDate(ticket.approvedDeliveryDate)}
        />
        <DeliveryInfo label="Status" value={getDeliveryDecisionLabel(ticket)} />
      </div>
      {ticket.deliveryDecisionNote ? (
        <p className="m-0 mt-3 text-xs leading-5 text-slate-600">
          {ticket.deliveryDecisionNote}
        </p>
      ) : null}
    </div>
  );
}

function DeliveryInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="m-0 text-[0.68rem] font-semibold uppercase text-slate-500">
        {label}
      </p>
      <p className="m-0 mt-1 text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function AttachmentsPreview({
  attachments,
}: {
  attachments: HubItTicket["attachments"];
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
        <FileText className="size-4 text-[#A07C3B]" />
        Evidencias
      </div>
      {attachments.length > 0 ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {attachments.map((attachment) => (
            <AttachmentPreview attachment={attachment} key={attachment.id} />
          ))}
        </div>
      ) : (
        <p className="m-0 mt-3 text-sm text-slate-500">
          Nenhum print, video ou audio anexado.
        </p>
      )}
    </div>
  );
}

function AttachmentPreview({
  attachment,
}: {
  attachment: HubItTicket["attachments"][number];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {attachment.type === "image" && attachment.dataUrl ? (
        <Image
          alt={attachment.fileName}
          className="h-36 w-full object-cover"
          height={144}
          src={attachment.dataUrl}
          unoptimized
          width={320}
        />
      ) : null}
      {attachment.type === "video" && attachment.dataUrl ? (
        <video
          className="h-36 w-full bg-slate-950 object-contain"
          controls
          src={attachment.dataUrl}
        />
      ) : null}
      {attachment.type === "audio" && attachment.dataUrl ? (
        <div className="grid min-h-28 place-items-center bg-slate-100 p-3">
          <audio className="w-full" controls src={attachment.dataUrl} />
        </div>
      ) : null}
      {!attachment.dataUrl || attachment.type === "file" ? (
        <div className="grid h-28 place-items-center bg-slate-100 text-slate-400">
          {attachment.type === "video" ? (
            <FileVideo className="size-7" />
          ) : null}
          {attachment.type === "audio" ? (
            <FileAudio className="size-7" />
          ) : null}
          {attachment.type === "image" ? (
            <ImageIcon className="size-7" />
          ) : null}
          {attachment.type === "file" ? <FileText className="size-7" /> : null}
        </div>
      ) : null}
      <div className="p-3">
        <p className="m-0 truncate text-sm font-semibold text-slate-950">
          {attachment.fileName}
        </p>
        <p className="m-0 mt-1 text-xs text-slate-500">
          {attachment.type} / {formatBytes(attachment.sizeBytes)}
        </p>
      </div>
    </div>
  );
}

function DetailBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="m-0 text-xs font-semibold uppercase text-slate-500">
        {label}
      </p>
      <p className="m-0 mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
        {value}
      </p>
    </div>
  );
}

function UserInfoCard({
  email,
  label,
  name,
}: {
  email?: string | null;
  label: string;
  name: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <p className="m-0 text-xs font-semibold uppercase text-slate-500">
        {label}
      </p>
      <p className="m-0 mt-2 truncate text-sm font-semibold text-slate-950">
        {name}
      </p>
      <p className="m-0 mt-1 truncate text-xs text-slate-500">
        {email ?? "sem e-mail registrado"}
      </p>
    </div>
  );
}

function EvidenceButton({
  active = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active || undefined}
      className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition ${
        active
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-slate-200 bg-white text-slate-600 hover:border-[#A07C3B]/30 hover:text-slate-950"
      }`}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function ReviewEvidenceList({
  attachments,
  onRemove,
}: {
  attachments: HubItTicketAttachmentInput[];
  onRemove: (fileName: string) => void;
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-2">
      {attachments.map((attachment) => (
        <div
          className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
          key={attachment.fileName}
        >
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-semibold text-slate-950">
              {attachment.fileName}
            </p>
            <p className="m-0 text-xs text-slate-500">
              {attachment.type} / {formatBytes(attachment.sizeBytes)}
            </p>
          </div>
          <button
            aria-label="Remover evidencia"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-white hover:text-slate-950"
            onClick={() => onRemove(attachment.fileName)}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

function FilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`h-8 rounded-full border px-3 text-xs font-semibold transition ${
        active
          ? "border-[#A07C3B]/45 bg-[#A07C3B]/10 text-[#7A5E2C]"
          : "border-slate-200 bg-white text-slate-500 hover:border-[#A07C3B]/30"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function EmptyState({ isLoading }: { isLoading: boolean }) {
  return (
    <div className="grid min-h-36 place-items-center rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-center">
      <div>
        {isLoading ? (
          <Loader2 className="mx-auto size-5 animate-spin text-slate-400" />
        ) : (
          <XCircle className="mx-auto size-5 text-slate-300" />
        )}
        <p className="m-0 mt-2 text-sm font-semibold text-slate-500">
          {isLoading ? "Carregando tickets." : "Nenhum ticket neste filtro."}
        </p>
      </div>
    </div>
  );
}

function DeliveryDueBadge({ ticket }: { ticket: HubItTicket }) {
  const deliveryState = getTicketDeliveryState(ticket);

  if (!deliveryState.date) {
    return (
      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[0.68rem] font-semibold text-slate-500">
        Sem data
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold ${deliveryState.className}`}
    >
      <CalendarDays className="size-3" />
      {deliveryState.label}
    </span>
  );
}

function StatusBadge({ status }: { status: HubItTicketStatus }) {
  return (
    <Badge variant={statusVariant(status)}>
      {hubItTicketStatusLabels[status]}
    </Badge>
  );
}

function statusVariant(status: HubItTicketStatus): BadgeVariant {
  if (status === "resolvido" || status === "fechado") {
    return "success";
  }

  if (status === "em_producao") {
    return "success";
  }

  if (
    status === "em_analise" ||
    status === "em_execucao" ||
    status === "em_homologacao" ||
    status === "em_revisao" ||
    status === "em_tratativa"
  ) {
    return "info";
  }

  if (status === "aguardando_cliente") {
    return "warning";
  }

  return "neutral";
}

function priorityVariant(priority: HubItTicket["priority"]): BadgeVariant {
  if (priority === "critica") {
    return "danger";
  }

  if (priority === "alta") {
    return "warning";
  }

  if (priority === "baixa") {
    return "neutral";
  }

  return "info";
}

function countByStatus(
  tickets: readonly HubItTicket[],
  status: HubItTicketStatus,
) {
  return tickets.filter((ticket) => ticket.status === status).length;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function formatNullableDate(value?: string | null) {
  return value ? formatDateOnly(value) : "pendente";
}

function formatDateOnly(value: string) {
  const [year, month, day] = value.split("-");

  if (!year || !month || !day) {
    return value;
  }

  return `${day}/${month}/${year}`;
}

function getTicketEffectiveDeliveryDate(ticket: HubItTicket) {
  return ticket.approvedDeliveryDate ?? ticket.requestedDeliveryDate ?? null;
}

function getTicketDeliveryState(ticket: HubItTicket) {
  const date = getTicketEffectiveDeliveryDate(ticket);

  if (!date) {
    return {
      className: "",
      date: null,
      days: Number.POSITIVE_INFINITY,
      label: "Sem data",
    };
  }

  const days = getDaysUntilDate(date);

  if (days <= 0) {
    return {
      className: "bg-red-50 text-red-700 ring-1 ring-red-100",
      date,
      days,
      label: days < 0 ? `Atrasado ${Math.abs(days)}d` : "Hoje",
    };
  }

  if (days <= 2) {
    return {
      className: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
      date,
      days,
      label: `${days} dia${days > 1 ? "s" : ""}`,
    };
  }

  return {
    className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
    date,
    days,
    label: `${days} dias`,
  };
}

function getDaysUntilDate(value: string) {
  const date = parseDateOnly(value);

  if (!date) {
    return Number.POSITIVE_INFINITY;
  }

  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  return Math.round((date.getTime() - todayStart.getTime()) / 86_400_000);
}

function parseDateOnly(value: string) {
  const [year = 0, month = 0, day = 0] = value
    .split("-")
    .map((part) => Number(part));
  const date = new Date(year, month - 1, day);

  return Number.isNaN(date.getTime()) ? null : date;
}

function getDeliveryDecisionLabel(ticket: HubItTicket) {
  if (ticket.deliveryDecisionStatus === "aprovada") {
    return "data aprovada";
  }

  if (ticket.deliveryDecisionStatus === "reprogramada") {
    return "reprogramada por Zeus";
  }

  return "aguardando Zeus";
}

const maxReviewEvidenceBytes = 6_000_000;
const maxReviewEvidenceCount = 4;

async function createReviewAttachment(
  blob: Blob,
  options: {
    durationSeconds?: number;
    fileName: string;
    mimeType?: string;
    sizeBytes?: number;
    type?: HubItTicketAttachmentInput["type"];
  },
): Promise<HubItTicketAttachmentInput> {
  const mimeType = options.mimeType || blob.type || "application/octet-stream";

  return {
    capturedAt: new Date().toISOString(),
    dataUrl: await readBlobAsDataUrl(blob),
    fileName: options.fileName,
    mimeType,
    sizeBytes: options.sizeBytes ?? blob.size,
    type: options.type ?? getAttachmentTypeFromMime(mimeType),
  };
}

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

function getAttachmentTypeFromMime(
  mimeType: string,
): HubItTicketAttachmentInput["type"] {
  if (mimeType.startsWith("audio/")) {
    return "audio";
  }

  if (mimeType.startsWith("image/")) {
    return "image";
  }

  if (mimeType.startsWith("video/")) {
    return "video";
  }

  return "file";
}

function formatEvidenceFileTime(value: Date) {
  return value
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "-")
    .slice(0, 19);
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
