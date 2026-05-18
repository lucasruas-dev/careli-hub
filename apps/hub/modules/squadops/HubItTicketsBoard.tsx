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
  type HubItTicketStatus,
} from "@/lib/hub-it-tickets/types";
import { Badge, Surface } from "@repo/uix";
import type { BadgeVariant } from "@repo/uix";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  Inbox,
  Loader2,
  MessageSquareReply,
  Paperclip,
  RefreshCw,
  Send,
  Sparkles,
  UserRound,
} from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type HubItTicketsBoardProps = {
  accessToken: string | null;
  isActive: boolean;
  onTicketAttentionCountChange?: (count: number) => void;
  onTicketCountChange?: (count: number) => void;
};

type TicketDraft = {
  adminResponse: string;
  resolutionSummary: string;
  status: HubItTicketStatus;
};

const emptyDraft: TicketDraft = {
  adminResponse: "",
  resolutionSummary: "",
  status: "em_analise",
};

export function HubItTicketsBoard({
  accessToken,
  isActive,
  onTicketAttentionCountChange,
  onTicketCountChange,
}: HubItTicketsBoardProps) {
  const [tickets, setTickets] = useState<HubItTicket[]>([]);
  const [selectedProtocol, setSelectedProtocol] = useState<string | null>(null);
  const [draft, setDraft] = useState<TicketDraft>(emptyDraft);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTicket =
    tickets.find((ticket) => ticket.protocol === selectedProtocol) ??
    tickets[0] ??
    null;
  const openTickets = tickets.filter(
    (ticket) => ticket.status !== "resolvido" && ticket.status !== "fechado",
  );
  const ticketsWaitingForSquadOps = tickets.filter(
    (ticket) =>
      ticket.status === "novo" ||
      ticket.status === "em_analise" ||
      ticket.status === "em_revisao",
  );
  const urgentTickets = tickets.filter(
    (ticket) => ticket.priority === "critica" || ticket.priority === "alta",
  );
  const waitingUserTickets = tickets.filter(
    (ticket) => ticket.status === "aguardando_cliente",
  );
  const latestTicket = tickets[0] ?? null;

  const ticketsByStatus = useMemo(() => {
    return hubItTicketStatuses.map((status) => ({
      count: tickets.filter((ticket) => ticket.status === status).length,
      status,
    }));
  }, [tickets]);

  const refreshTickets = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const nextTickets = await loadHubItTickets({
        accessToken,
        scope: "all",
      });
      setTickets(nextTickets);
      setSelectedProtocol((currentProtocol) =>
        currentProtocol &&
        nextTickets.some((ticket) => ticket.protocol === currentProtocol)
          ? currentProtocol
          : (nextTickets[0]?.protocol ?? null),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Nao foi possivel carregar a fila de tickets TI.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (!isActive || !accessToken) {
      return;
    }

    void refreshTickets();
  }, [accessToken, isActive, refreshTickets]);

  useEffect(() => {
    onTicketCountChange?.(openTickets.length);
  }, [onTicketCountChange, openTickets.length]);

  useEffect(() => {
    onTicketAttentionCountChange?.(ticketsWaitingForSquadOps.length);
  }, [onTicketAttentionCountChange, ticketsWaitingForSquadOps.length]);

  useEffect(() => {
    if (!selectedTicket) {
      setDraft(emptyDraft);
      return;
    }

    setDraft({
      adminResponse: selectedTicket.adminResponse ?? "",
      resolutionSummary: selectedTicket.resolutionSummary ?? "",
      status:
        selectedTicket.status === "novo"
          ? "em_analise"
          : selectedTicket.status,
    });
  }, [selectedTicket]);

  async function saveReply() {
    if (!selectedTicket) {
      return;
    }

    if (!draft.adminResponse.trim() && !draft.resolutionSummary.trim()) {
      setError("Escreva uma devolutiva ou resumo do que foi feito.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const updatedTicket = await updateHubItTicket({
        accessToken,
        input: {
          adminResponse: draft.adminResponse,
          protocol: selectedTicket.protocol,
          resolutionSummary: draft.resolutionSummary,
          status: draft.status,
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
          : "Nao foi possivel salvar a devolutiva.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (!accessToken) {
    return (
      <Surface bordered className="border-amber-100 bg-amber-50 p-5">
        <div className="flex items-center gap-3 text-sm font-semibold text-amber-800">
          <AlertTriangle className="size-4" />
          Sessao ausente para abrir a fila de tickets TI.
        </div>
      </Surface>
    );
  }

  return (
    <section className="grid min-w-0 gap-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <MetricTile
          icon={<Inbox className="size-4" />}
          label="Abertos"
          value={openTickets.length}
        />
        <MetricTile
          icon={<AlertTriangle className="size-4" />}
          label="Alta prioridade"
          tone="warning"
          value={urgentTickets.length}
        />
        <MetricTile
          icon={<MessageSquareReply className="size-4" />}
          label="Aguardando cliente"
          tone="info"
          value={waitingUserTickets.length}
        />
        <MetricTile
          icon={<Clock3 className="size-4" />}
          label="Ultimo protocolo"
          value={latestTicket?.protocol ?? "--"}
        />
      </div>

      <Surface
        bordered
        className="overflow-hidden border-slate-200/70 bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      >
        <div className="grid min-h-[34rem] grid-cols-1 xl:grid-cols-[minmax(19rem,0.34fr)_minmax(0,1fr)]">
          <aside className="border-b border-slate-200/70 bg-slate-50/60 xl:border-b-0 xl:border-r">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 p-4">
              <div>
                <p className="m-0 text-xs font-semibold uppercase text-slate-500">
                  Fila SquadOps
                </p>
                <h2 className="m-0 mt-1 text-base font-semibold text-slate-950">
                  Tickets TI
                </h2>
              </div>
              <button
                aria-label="Atualizar fila de tickets"
                className="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-[#A07C3B]/25 hover:text-slate-950"
                onClick={() => void refreshTickets()}
                type="button"
              >
                {isLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 border-b border-slate-200/70 p-3">
              {ticketsByStatus.map((item) => (
                <div
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                  key={item.status}
                >
                  <p className="m-0 text-[0.68rem] font-semibold text-slate-500">
                    {hubItTicketStatusLabels[item.status]}
                  </p>
                  <p className="m-0 mt-1 text-lg font-semibold text-slate-950">
                    {item.count}
                  </p>
                </div>
              ))}
            </div>

            <div className="max-h-[38rem] overflow-y-auto p-3">
              {tickets.length > 0 ? (
                <div className="grid gap-2">
                  {tickets.map((ticket) => (
                    <TicketQueueItem
                      isActive={ticket.protocol === selectedTicket?.protocol}
                      key={ticket.id}
                      onClick={() => setSelectedProtocol(ticket.protocol)}
                      ticket={ticket}
                    />
                  ))}
                </div>
              ) : (
                <EmptyQueue isLoading={isLoading} />
              )}
            </div>
          </aside>

          <div className="min-w-0">
            {error ? (
              <OperationalErrorBanner message={error} />
            ) : null}

            {selectedTicket ? (
              <TicketWorkspace
                draft={draft}
                isSaving={isSaving}
                onDraftChange={setDraft}
                onSave={() => void saveReply()}
                ticket={selectedTicket}
              />
            ) : (
              <div className="grid min-h-[28rem] place-items-center p-6 text-center">
                <div>
                  <Inbox className="mx-auto size-8 text-slate-300" />
                  <p className="m-0 mt-3 text-sm font-semibold text-slate-500">
                    Nenhum ticket TI encontrado.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </Surface>
    </section>
  );
}

function OperationalErrorBanner({ message }: { message: string }) {
  const isMigrationPending = isHubItTicketsMigrationPendingMessage(message);
  const className = isMigrationPending
    ? "border-b border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800"
    : "border-b border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700";

  return <div className={className}>{message}</div>;
}

function MetricTile({
  icon,
  label,
  tone = "neutral",
  value,
}: {
  icon: ReactNode;
  label: string;
  tone?: "info" | "neutral" | "warning";
  value: number | string;
}) {
  const toneClass = {
    info: "bg-sky-50 text-sky-700 ring-sky-100",
    neutral: "bg-slate-50 text-[#A07C3B] ring-slate-200/70",
    warning: "bg-amber-50 text-amber-700 ring-amber-100",
  }[tone];

  return (
    <Surface bordered className="border-slate-200/70 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <span className={`grid size-9 place-items-center rounded-lg ring-1 ${toneClass}`}>
          {icon}
        </span>
        <p className="m-0 text-right text-xl font-semibold text-slate-950">
          {value}
        </p>
      </div>
      <p className="m-0 mt-3 text-xs font-semibold uppercase text-slate-500">
        {label}
      </p>
    </Surface>
  );
}

function TicketQueueItem({
  isActive,
  onClick,
  ticket,
}: {
  isActive: boolean;
  onClick: () => void;
  ticket: HubItTicket;
}) {
  return (
    <button
      className={`w-full rounded-xl border p-3 text-left transition ${
        isActive
          ? "border-[#A07C3B]/35 bg-white shadow-sm"
          : "border-slate-200/70 bg-white/70 hover:border-[#A07C3B]/25 hover:bg-white"
      }`}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 font-mono text-xs font-semibold text-[#7A5E2C]">
            {ticket.protocol}
          </p>
          <p className="m-0 mt-1 line-clamp-2 text-sm font-semibold text-slate-950">
            {ticket.title}
          </p>
        </div>
        <StatusBadge status={ticket.status} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <MiniBadge>{ticket.module}</MiniBadge>
        <MiniBadge>{hubItTicketPriorityLabels[ticket.priority]}</MiniBadge>
        {ticket.attachments.length > 0 ? (
          <MiniBadge>{ticket.attachments.length} anexo(s)</MiniBadge>
        ) : null}
      </div>
    </button>
  );
}

function TicketWorkspace({
  draft,
  isSaving,
  onDraftChange,
  onSave,
  ticket,
}: {
  draft: TicketDraft;
  isSaving: boolean;
  onDraftChange: (draft: TicketDraft) => void;
  onSave: () => void;
  ticket: HubItTicket;
}) {
  return (
    <div className="grid min-w-0 gap-5 p-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-[#7A5E2C]">
              {ticket.protocol}
            </span>
            <StatusBadge status={ticket.status} />
            <Badge variant={priorityVariant(ticket.priority)}>
              {hubItTicketPriorityLabels[ticket.priority]}
            </Badge>
          </div>
          <h2 className="m-0 mt-2 text-2xl font-semibold tracking-normal text-slate-950">
            {ticket.title}
          </h2>
          <p className="m-0 mt-2 text-sm text-slate-500">
            {ticket.module} / {hubItTicketCategoryLabels[ticket.category]} /
            aberto em {formatDateTime(ticket.createdAt)}
          </p>
        </div>
          <div className="flex min-w-[12rem] items-center gap-3 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
          <span className="grid size-10 place-items-center rounded-full bg-[#101820] text-xs font-semibold text-white">
            {getInitials(ticket.requester.name)}
          </span>
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-semibold text-slate-950">
              {ticket.requester.name}
            </p>
            <p className="m-0 truncate text-xs text-slate-500">
              {ticket.requester.email ?? "sem e-mail"}
            </p>
          </div>
        </div>
        <div className="flex min-w-[12rem] items-center gap-3 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
          <span className="grid size-10 place-items-center rounded-full bg-[#A07C3B]/15 text-xs font-semibold text-[#7A5E2C]">
            {ticket.assignedTo ? getInitials(ticket.assignedTo.name) : "--"}
          </span>
          <div className="min-w-0">
            <p className="m-0 truncate text-xs font-semibold uppercase text-slate-500">
              Tratando
            </p>
            <p className="m-0 truncate text-sm font-semibold text-slate-950">
              {ticket.assignedTo?.name ?? "Nao atribuido"}
            </p>
            <p className="m-0 truncate text-xs text-slate-500">
              {ticket.assignedTo?.email ?? "aguardando SquadOps"}
            </p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.38fr)]">
        <div className="grid gap-4">
          <DetailBlock
            icon={<UserRound className="size-4" />}
            label="Relato do usuario"
            value={ticket.userDescription}
          />
          <DetailBlock
            icon={<Sparkles className="size-4" />}
            label="Leitura tecnica da Caca"
            value={ticket.technicalSummary}
          />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <DetailBlock
              icon={<CheckCircle2 className="size-4" />}
              label="Como deveria funcionar"
              value={ticket.expectedResult || "Nao informado."}
            />
            <DetailBlock
              icon={<AlertTriangle className="size-4" />}
              label="O que ocorreu"
              value={ticket.actualResult || "Nao informado."}
            />
          </div>
          <AttachmentsPanel attachments={ticket.attachments} />
        </div>

        <aside className="grid content-start gap-4">
          <Surface bordered className="border-slate-200/70 bg-white p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <MessageSquareReply className="size-4 text-[#A07C3B]" />
              Devolutiva do SquadOps
            </div>
            <label className="mt-4 grid gap-1.5">
              <span className="text-xs font-semibold uppercase text-slate-500">
                Status
              </span>
              <select
                className={fieldClassName}
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    status: event.target.value as HubItTicketStatus,
                  })
                }
                value={draft.status}
              >
                {hubItTicketStatuses.map((status) => (
                  <option key={status} value={status}>
                    {hubItTicketStatusLabels[status]}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 grid gap-1.5">
              <span className="text-xs font-semibold uppercase text-slate-500">
                Resposta para o usuario
              </span>
              <textarea
                className={`${fieldClassName} min-h-32 resize-none py-2 leading-6`}
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    adminResponse: event.target.value,
                  })
                }
                placeholder="Explique o andamento, pedido de validacao ou devolutiva final."
                value={draft.adminResponse}
              />
            </label>
            <label className="mt-3 grid gap-1.5">
              <span className="text-xs font-semibold uppercase text-slate-500">
                O que foi feito
              </span>
              <textarea
                className={`${fieldClassName} min-h-24 resize-none py-2 leading-6`}
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    resolutionSummary: event.target.value,
                  })
                }
                placeholder="Registre ajuste, investigacao, bloqueio ou proxima acao."
                value={draft.resolutionSummary}
              />
            </label>
            <button
              className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#101820] px-4 text-sm font-semibold text-white transition hover:bg-[#1d2634] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving}
              onClick={onSave}
              type="button"
            >
              {isSaving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Enviar devolutiva
            </button>
          </Surface>

          <Surface bordered className="border-slate-200/70 bg-slate-50/70 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <FileText className="size-4 text-[#A07C3B]" />
              Historico visivel
            </div>
            <div className="mt-3 grid gap-2">
              {ticket.events.length > 0 ? (
                ticket.events.map((event) => (
                  <div
                    className="rounded-lg border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600"
                    key={event.id}
                  >
                    <p className="m-0 font-semibold text-slate-950">
                      {formatDateTime(event.createdAt)}
                    </p>
                    <p className="m-0 mt-1">{event.message}</p>
                  </div>
                ))
              ) : (
                <p className="m-0 text-sm text-slate-500">
                  Sem historico registrado.
                </p>
              )}
            </div>
          </Surface>
        </aside>
      </div>
    </div>
  );
}

function DetailBlock({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Surface bordered className="border-slate-200/70 bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
        <span className="text-[#A07C3B]">{icon}</span>
        {label}
      </div>
      <p className="m-0 mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
        {value}
      </p>
    </Surface>
  );
}

function AttachmentsPanel({
  attachments,
}: {
  attachments: HubItTicket["attachments"];
}) {
  return (
    <Surface bordered className="border-slate-200/70 bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
        <Paperclip className="size-4 text-[#A07C3B]" />
        Evidencias anexadas
      </div>
      {attachments.length > 0 ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {attachments.map((attachment) => (
            <div
              className="group overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-left transition hover:border-[#A07C3B]/30"
              key={attachment.id}
            >
              {attachment.type === "image" && attachment.dataUrl ? (
                <Image
                  alt={attachment.fileName}
                  className="h-36 w-full object-cover"
                  height={144}
                  unoptimized
                  width={320}
                  src={attachment.dataUrl}
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
                <div className="grid h-36 place-items-center bg-slate-100 p-3">
                  <audio className="w-full" controls src={attachment.dataUrl} />
                </div>
              ) : null}
              {!attachment.dataUrl || attachment.type === "file" ? (
                <div className="grid h-36 place-items-center bg-slate-100 text-slate-400">
                  <Paperclip className="size-7" />
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
          ))}
        </div>
      ) : (
        <p className="m-0 mt-3 text-sm text-slate-500">
          Nenhum print ou gravacao anexado.
        </p>
      )}
    </Surface>
  );
}

function EmptyQueue({ isLoading }: { isLoading: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white p-5 text-center">
      {isLoading ? (
        <Loader2 className="mx-auto size-5 animate-spin text-slate-400" />
      ) : (
        <Inbox className="mx-auto size-6 text-slate-300" />
      )}
      <p className="m-0 mt-3 text-sm font-semibold text-slate-500">
        {isLoading ? "Carregando tickets TI." : "Fila vazia no SquadOps."}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: HubItTicketStatus }) {
  return (
    <Badge variant={statusVariant(status)}>
      {hubItTicketStatusLabels[status]}
    </Badge>
  );
}

function MiniBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.68rem] font-semibold text-slate-500">
      {children}
    </span>
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

function getInitials(name: string) {
  const [first = "", second = ""] = name.trim().split(/\s+/);

  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase() || "--";
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

const fieldClassName =
  "w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10";
