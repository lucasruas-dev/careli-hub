"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Barcode,
  Bot,
  Building2,
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock3,
  ExternalLink,
  FileText,
  HandCoins,
  LandPlot,
  Link2,
  Loader2,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Phone,
  ReceiptText,
  Send,
  Ticket,
  User,
  Wallet,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import type { QueueClient } from "@/modules/guardian/attendance/types";
import type {
  IrisApoloContextEntity,
  IrisApoloContextInstallment,
} from "@/modules/caredesk/types/iris-types";

// Painel de CONTEXTO do cockpit de cobranca do Hades (zona direita da tela de
// atendimento). Reaproveita o motor da Iris (conversa) mas com UI propria: puxa
// o cliente Hades pelo metadata.cobranca.clientId do ticket e organiza tudo em
// abas — Cliente, Parcelas, Propostas, Timeline, Tickets. Na aba Parcelas o
// operador insere o LINK do boleto no rascunho da mensagem (a gente nao gera
// boleto; so reenvia o link existente, sem custo).

type CobrancaTab =
  | "carteira"
  | "cliente"
  | "financeiro"
  | "parcelas"
  | "propostas"
  | "timeline"
  | "tickets";

export type IrisCockpitMode = "atendimento" | "cobranca";

export type CockpitTicket = {
  closedAt?: string | null;
  id: string;
  openedAt?: string | null;
  operator?: string | null;
  protocol: string;
  status?: string | null;
  subject: string;
};

type TimelineDisplayEvent = {
  description?: string;
  id: string;
  occurredAt?: string | null;
  operator?: string;
  title: string;
};

// Render-prop injetado pela AttendancePage (guardian) — renderiza o ProposalModal
// do guardian INLINE no cockpit (sem import circular caredesk->guardian).
export type CobrancaProposalRenderArgs = {
  client: QueueClient;
  clientC2xId: number | null;
  kind: "acordo" | "promessa";
  onClose: () => void;
  onCreated: () => void;
  overdue: NonNullable<QueueClient["c2xInstallments"]>;
};

const TABS: { icon: LucideIcon; id: CobrancaTab; label: string }[] = [
  { icon: User, id: "cliente", label: "Cliente" },
  { icon: ReceiptText, id: "parcelas", label: "Parcelas" },
  { icon: FileText, id: "propostas", label: "Propostas" },
  { icon: Clock3, id: "timeline", label: "Timeline" },
  { icon: Ticket, id: "tickets", label: "Tickets" },
];

// Atendimento (Iris): sem Parcelas/Propostas (cobranca); Parcelas -> Carteira (Apolo).
const TABS_ATENDIMENTO: { icon: LucideIcon; id: CobrancaTab; label: string }[] = [
  { icon: User, id: "cliente", label: "Cliente" },
  { icon: Wallet, id: "carteira", label: "Carteira" },
  { icon: HandCoins, id: "financeiro", label: "Financeiro" },
  { icon: Clock3, id: "timeline", label: "Timeline" },
  { icon: Ticket, id: "tickets", label: "Tickets" },
];

export function IrisCobrancaContextSidebar({
  apoloEntity,
  clienteFields,
  clientId,
  collapsed,
  currentTicketId,
  formatDateTime,
  mode = "cobranca",
  onInsertDraftText,
  onSelectTicket,
  onToggleCollapsed,
  proposalOpenSignal,
  renderProposal,
  tickets,
}: {
  apoloEntity?: IrisApoloContextEntity | null;
  clienteFields: { label: string; value: string }[];
  clientId: string | null;
  collapsed: boolean;
  currentTicketId: string;
  formatDateTime: (value?: string | null) => string;
  mode?: IrisCockpitMode;
  note?: { text?: string | null; updatedAt?: string | null } | null;
  onInsertDraftText: (text: string) => void;
  onSelectTicket: (ticketId: string) => void;
  onToggleCollapsed: () => void;
  // Sinal (contador) do header pra abrir o popup de registrar proposta.
  proposalOpenSignal?: number;
  renderProposal?: (args: CobrancaProposalRenderArgs) => ReactNode;
  tickets: CockpitTicket[];
}) {
  const [tab, setTab] = useState<CobrancaTab>(
    mode === "atendimento" ? "cliente" : "parcelas",
  );
  const [client, setClient] = useState<QueueClient | null>(null);
  const [loading, setLoading] = useState(false);
  const [inserted, setInserted] = useState<Set<string>>(new Set());
  const [guardianEvents, setGuardianEvents] = useState<TimelineDisplayEvent[]>([]);
  const [proposalChoiceOpen, setProposalChoiceOpen] = useState(false);
  const [proposalKind, setProposalKind] = useState<"acordo" | "promessa" | null>(
    null,
  );
  const [viewCommitment, setViewCommitment] = useState<
    QueueClient["commitments"][number] | null
  >(null);
  const [eventsRefreshTick, setEventsRefreshTick] = useState(0);

  // O icone de propostas no header da conversa dispara este sinal pra abrir o
  // popup de registrar acordo/promessa aqui (onde estao os dados do cliente).
  useEffect(() => {
    if (proposalOpenSignal && proposalOpenSignal > 0) {
      setProposalChoiceOpen(true);
    }
  }, [proposalOpenSignal]);

  useEffect(() => {
    if (!clientId) {
      setClient(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const token = await accessToken();
        const response = await fetch(
          `/api/hades/attendance/client/${encodeURIComponent(clientId)}`,
          {
            cache: "no-store",
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          },
        );
        const payload = (await response.json().catch(() => null)) as {
          client?: QueueClient;
        } | null;
        if (cancelled || !response.ok || !payload?.client) return;
        setClient(payload.client);
      } catch {
        // mantem so o contexto do ticket; as abas de cobranca mostram o aviso.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // Timeline = log central do cliente: acordos/promessas/cancelamentos (gravados
  // pela API de compromissos) + atendimentos (abertura/encerramento/direcionamento),
  // todos em caredesk_ticket_events com source_module "guardian".
  useEffect(() => {
    if (!clientId) {
      setGuardianEvents([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const token = await accessToken();
        const response = await fetch(
          `/api/hades/attendance/manual-events?clientId=${encodeURIComponent(clientId)}`,
          {
            cache: "no-store",
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          },
        );
        const payload = (await response.json().catch(() => null)) as {
          events?: TimelineDisplayEvent[];
        } | null;
        if (cancelled || !response.ok || !payload) return;
        setGuardianEvents(Array.isArray(payload.events) ? payload.events : []);
      } catch {
        // timeline e best-effort.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, eventsRefreshTick]);

  const clientC2xId = useMemo(() => {
    const digits = (clientId ?? "").match(/(\d+)\s*$/);
    return digits ? Number(digits[1]) : null;
  }, [clientId]);

  const overdue = useMemo(
    () =>
      (client?.c2xInstallments ?? []).filter(
        (installment) => installment.status === "Vencida",
      ),
    [client?.c2xInstallments],
  );

  const tabs = mode === "atendimento" ? TABS_ATENDIMENTO : TABS;

  // Timeline do Apolo (modo atendimento) mapeada pro formato da TimelineTab.
  const apoloTimelineEvents = useMemo<TimelineDisplayEvent[]>(() => {
    return (apoloEntity?.timeline ?? []).map((event, index) => ({
      description: event.description ?? undefined,
      id: `apolo-${index}`,
      occurredAt: event.date ?? null,
      title: event.title ?? "Evento",
    }));
  }, [apoloEntity?.timeline]);

  function insertBoleto(installment: NonNullable<QueueClient["c2xInstallments"]>[number]) {
    const url = installment.invoiceUrl ?? installment.paymentUrl ?? "";
    if (!url) return;
    onInsertDraftText(`Boleto ${installment.number} (${installment.reference}): ${url}`);
    setInserted((current) => new Set(current).add(installment.id));
  }

  if (collapsed) {
    return (
      <aside className="hidden w-14 shrink-0 flex-col items-center gap-2 border-l border-slate-100 bg-white p-2 xl:flex">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expandir contexto"
          title="Expandir contexto"
          className="flex size-9 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-500 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]"
        >
          <PanelRightOpen className="size-4" aria-hidden="true" />
        </button>
        <span className="flex size-9 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
          <ReceiptText className="size-4" aria-hidden="true" />
        </span>
        {client ? (
          <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-100">
            {client.parcelas.vencidas}
          </span>
        ) : null}
      </aside>
    );
  }

  return (
    <aside className="hidden w-[340px] shrink-0 flex-col border-l border-slate-100 bg-white xl:flex">
      <div className="border-b border-slate-100 p-3">
        <div className="flex items-center gap-2">
          <div
            className={[
              "grid flex-1 gap-1 rounded-lg bg-slate-100/70 p-1",
              tabs.length >= 5 ? "grid-cols-5" : "grid-cols-4",
            ].join(" ")}
          >
            {tabs.map((option) => (
              <Tooltip content={option.label} key={option.id} placement="bottom">
                <button
                  type="button"
                  onClick={() => setTab(option.id)}
                  aria-label={option.label}
                  className={[
                    "flex h-8 items-center justify-center rounded-md transition-colors",
                    tab === option.id
                      ? "bg-white text-[#7A5E2C] shadow-sm"
                      : "text-slate-500 hover:bg-white hover:text-[#7A5E2C]",
                  ].join(" ")}
                >
                  <option.icon className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            ))}
          </div>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Recolher contexto"
            title="Recolher contexto"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-[#7A5E2C]"
          >
            <PanelRightClose className="size-4" aria-hidden="true" />
          </button>
        </div>

        {mode === "cobranca" && client ? (
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            <Indicator
              tone="danger"
              value={`${client.parcelas.vencidas}`}
              label="vencidas"
            />
            <Indicator
              tone="neutral"
              value={`${client.atrasoDias}`}
              label="dias atraso"
            />
            <Indicator
              tone="warning"
              value={`${client.scoreRisco}`}
              label="risco"
            />
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
        {loading && !client ? (
          <p className="flex items-center gap-2 px-1 py-3 text-xs text-slate-400">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Carregando contexto de cobrança…
          </p>
        ) : null}

        {tab === "parcelas" ? (
          <ParcelasTab
            client={client}
            inserted={inserted}
            loading={loading}
            onInsertAll={() => {
              overdue.forEach((installment) => {
                if (installment.invoiceUrl ?? installment.paymentUrl) {
                  insertBoleto(installment);
                }
              });
            }}
            onInsertBoleto={insertBoleto}
            overdue={overdue}
          />
        ) : null}

        {tab === "cliente" ? (
          <ClienteTab
            atProtocol={
              tickets.find((item) => item.id === currentTicketId)?.protocol ?? ""
            }
            client={client}
            clienteFields={clienteFields}
            clientId={clientId}
          />
        ) : null}

        {tab === "carteira" ? (
          <CarteiraTab
            apoloEntity={apoloEntity ?? null}
            onInsertDraftText={onInsertDraftText}
          />
        ) : null}

        {tab === "financeiro" ? (
          <FinanceiroTab apoloEntity={apoloEntity ?? null} />
        ) : null}

        {tab === "propostas" ? (
          <PropostasTab client={client} onView={setViewCommitment} />
        ) : null}

        {tab === "timeline" ? (
          <TimelineTab
            events={
              mode === "atendimento"
                ? apoloTimelineEvents
                : [...guardianEvents, ...(client?.timeline ?? [])]
            }
            formatDateTime={formatDateTime}
          />
        ) : null}

        {tab === "tickets" ? (
          <TicketsTab
            currentTicketId={currentTicketId}
            formatDateTime={formatDateTime}
            onSelectTicket={onSelectTicket}
            tickets={tickets}
          />
        ) : null}
      </div>

      {proposalChoiceOpen ? (
        <ProposalChoiceModal
          onCancel={() => setProposalChoiceOpen(false)}
          onChoose={(chosen) => {
            setProposalChoiceOpen(false);
            setProposalKind(chosen);
          }}
        />
      ) : null}

      {proposalKind && client && renderProposal
        ? renderProposal({
            client,
            clientC2xId,
            kind: proposalKind,
            onClose: () => setProposalKind(null),
            onCreated: () => {
              setProposalKind(null);
              setEventsRefreshTick((current) => current + 1);
              window.dispatchEvent(new CustomEvent("guardian:motor-changed"));
            },
            overdue,
          })
        : null}

      {viewCommitment ? (
        <ProposalDetailModal
          commitment={viewCommitment}
          onClose={() => setViewCommitment(null)}
        />
      ) : null}
    </aside>
  );
}

function ProposalDetailModal({
  commitment,
  onClose,
}: {
  commitment: QueueClient["commitments"][number];
  onClose: () => void;
}) {
  const rows: { label: string; value: string }[] =
    commitment.type === "Acordo"
      ? [
          { label: "Protocolo", value: commitment.protocol },
          { label: "Status", value: commitment.status },
          { label: "Empreendimento", value: commitment.enterprise },
          { label: "Unidade", value: commitment.unitLabel || commitment.unitCode },
          { label: "Parcelas incluídas", value: commitment.includedInstallments },
          { label: "Valor original", value: commitment.originalValue },
          { label: "Desconto", value: commitment.discount },
          { label: "Valor do acordo", value: commitment.negotiatedValue },
          { label: "Entrada", value: commitment.entry },
          { label: "Vencimento da entrada", value: commitment.entryDueDate },
          { label: "Parcelas", value: `${commitment.installmentsCount}x ${commitment.installmentValue}` },
          { label: "1º vencimento", value: commitment.firstDueDate },
          { label: "Operador", value: commitment.operator },
        ]
      : [
          { label: "Protocolo", value: commitment.protocol },
          { label: "Status", value: commitment.status },
          { label: "Empreendimento", value: commitment.enterprise },
          { label: "Unidade", value: commitment.unitLabel || commitment.unitCode },
          { label: "Parcelas", value: commitment.relatedInstallments },
          { label: "Valor prometido", value: commitment.promisedValue },
          { label: "Data prometida", value: commitment.promisedDate },
          { label: "Canal", value: commitment.contactChannel },
          { label: "Operador", value: commitment.operator },
        ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/30 backdrop-blur-[2px]"
      />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-[#A07C3B] text-white">
              <HandCoins className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                {commitment.type}
              </h2>
              <p className="text-[11px] text-slate-500">{commitment.protocol}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="overflow-hidden rounded-xl border border-slate-200/70 bg-white">
            {rows
              .filter((row) => row.value && row.value.trim())
              .map((row, index) => (
                <div
                  key={row.label}
                  className={`flex items-start justify-between gap-3 px-3 py-2 ${
                    index > 0 ? "border-t border-slate-100" : ""
                  }`}
                >
                  <span className="shrink-0 text-[11px] font-medium text-slate-500">
                    {row.label}
                  </span>
                  <span className="min-w-0 break-words text-right text-xs font-semibold text-slate-900 [overflow-wrap:anywhere]">
                    {row.value}
                  </span>
                </div>
              ))}
          </div>
          {commitment.note ? (
            <div className="mt-2 rounded-xl border border-slate-200/70 bg-slate-50/70 px-3 py-2.5">
              <p className="text-[11px] font-semibold text-slate-500">Observação</p>
              <p className="mt-1 text-xs text-slate-700 [overflow-wrap:anywhere]">
                {commitment.note}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ProposalChoiceModal({
  onCancel,
  onChoose,
}: {
  onCancel: () => void;
  onChoose: (kind: "acordo" | "promessa") => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onCancel}
        className="absolute inset-0 bg-slate-950/30 backdrop-blur-[2px]"
      />
      <div className="relative z-10 w-full max-w-xs rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <h2 className="text-base font-semibold text-slate-950">
          Registrar proposta
        </h2>
        <p className="mt-1 text-[11px] text-slate-500">
          Escolha o que vai registrar para este cliente.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onChoose("promessa")}
            className="flex flex-col items-center gap-1 rounded-xl border border-slate-200/70 bg-white px-3 py-3 text-xs font-semibold text-slate-700 transition-colors hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/5"
          >
            <Clock3 className="size-5 text-[#A07C3B]" aria-hidden="true" />
            Promessa
          </button>
          <button
            type="button"
            onClick={() => onChoose("acordo")}
            className="flex flex-col items-center gap-1 rounded-xl border border-slate-200/70 bg-white px-3 py-3 text-xs font-semibold text-slate-700 transition-colors hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/5"
          >
            <HandCoins className="size-5 text-[#A07C3B]" aria-hidden="true" />
            Acordo
          </button>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 h-9 w-full rounded-lg border border-slate-200/70 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// Aba Carteira (atendimento/Iris): empreendimentos/unidades/contratos do cliente
// vindos do Apolo (commercialLinks). Entra no lugar de Parcelas (que e cobranca).
function apoloInstallmentTone(
  installment: IrisApoloContextInstallment,
): "avencer" | "liquidada" | "vencida" {
  const status = (installment.status ?? "").toLowerCase();
  if (installment.paidAt || status.includes("liquid") || status.includes("pag")) {
    return "liquidada";
  }
  if (status.includes("vencid") || status.includes("atras")) {
    return "vencida";
  }
  return "avencer";
}

function CarteiraStat({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "danger" | "neutral" | "success";
  value: number;
}) {
  const color =
    tone === "success"
      ? "text-emerald-600"
      : tone === "danger"
        ? "text-rose-600"
        : "text-slate-900";

  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
      <p className={`text-sm font-semibold ${color}`}>{value}</p>
      <p className="text-[10px] text-slate-500">{label}</p>
    </div>
  );
}

// Carteira da Iris: cada unidade (commercialLink) é um accordion. Aberta mostra
// resumo (contagem por status) + as parcelas; recolhida só o cabeçalho. Iris vê
// TODAS as parcelas (adimplente + inadimplente). Boleto: a URL ainda nao vem no
// contexto do Apolo — botao de boleto entra quando o sync trouxer o link.
function CarteiraTab({
  apoloEntity,
  onInsertDraftText,
}: {
  apoloEntity: IrisApoloContextEntity | null;
  onInsertDraftText?: (text: string) => void;
}) {
  const links = apoloEntity?.commercialLinks ?? [];
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(links.length === 1 ? [0] : []),
  );

  if (links.length === 0) {
    return (
      <EmptyHint text="Nenhuma unidade/contrato no Apolo para este cliente." />
    );
  }

  return (
    <div className="space-y-2">
      {links.map((link, index) => {
        const isOpen = expanded.has(index);
        const installments = link.installments ?? [];
        const counts = installments.reduce(
          (acc, item) => {
            acc[apoloInstallmentTone(item)] += 1;
            return acc;
          },
          { avencer: 0, liquidada: 0, vencida: 0 },
        );
        const unitLabel = (link.unit ?? link.unitCode ?? "").trim();

        return (
          <div
            key={`${link.enterprise ?? "link"}-${index}`}
            className="overflow-hidden rounded-xl border border-slate-200/70 bg-white"
          >
            <button
              type="button"
              onClick={() =>
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(index)) {
                    next.delete(index);
                  } else {
                    next.add(index);
                  }
                  return next;
                })
              }
              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-slate-50 ${
                isOpen ? "border-b border-slate-100 bg-slate-50/70" : ""
              }`}
            >
              <LandPlot
                className="size-4 shrink-0 text-[#7A5E2C]"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {unitLabel || "Unidade"}
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  <span className="capitalize">
                    {(link.enterprise ?? "").toLowerCase()}
                  </span>
                  {" · "}
                  <span
                    className={`font-medium ${
                      counts.vencida > 0 ? "text-rose-600" : "text-emerald-600"
                    }`}
                  >
                    {counts.vencida > 0
                      ? `${counts.vencida} vencida${counts.vencida > 1 ? "s" : ""}`
                      : "em dia"}
                  </span>
                </p>
              </div>
              {isOpen ? (
                <ChevronUp
                  className="size-4 shrink-0 text-slate-400"
                  aria-hidden="true"
                />
              ) : (
                <ChevronDown
                  className="size-4 shrink-0 text-slate-400"
                  aria-hidden="true"
                />
              )}
            </button>

            {isOpen ? (
              <div className="px-3 py-3">
                {link.contractUrl ? (
                  <a
                    href={link.contractUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mb-3 flex items-center justify-center gap-2 rounded-lg border border-[#A07C3B]/25 bg-white px-3 py-2 text-xs font-semibold text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/5"
                  >
                    <FileText className="size-4" aria-hidden="true" /> Ver contrato
                  </a>
                ) : null}
                <div className="mb-3 grid grid-cols-3 gap-2">
                  <CarteiraStat
                    label="Liquidadas"
                    tone="success"
                    value={counts.liquidada}
                  />
                  <CarteiraStat
                    label="A vencer"
                    tone="neutral"
                    value={counts.avencer}
                  />
                  <CarteiraStat
                    label="Vencidas"
                    tone="danger"
                    value={counts.vencida}
                  />
                </div>

                {installments.length ? (
                  <div className="overflow-hidden rounded-xl border border-slate-200/70">
                    {installments.map((item, itemIndex) => {
                      const tone = apoloInstallmentTone(item);
                      const dotClass =
                        tone === "vencida"
                          ? "bg-rose-500"
                          : tone === "liquidada"
                            ? "bg-emerald-500"
                            : "bg-sky-500";
                      const statusColor =
                        tone === "vencida"
                          ? "text-rose-600"
                          : tone === "liquidada"
                            ? "text-emerald-600"
                            : "text-slate-500";
                      const statusLine =
                        tone === "liquidada"
                          ? `liquidada${item.paidAt ? ` · pago ${item.paidAt}` : ""}`
                          : tone === "vencida"
                            ? `vencida${item.dueDate ? ` · venceu ${item.dueDate}` : ""}`
                            : `a vencer${item.dueDate ? ` · vence ${item.dueDate}` : ""}`;

                      return (
                        <div
                          key={item.id ?? `${index}-${itemIndex}`}
                          className={`flex items-center gap-2.5 px-3 py-2 ${
                            itemIndex > 0 ? "border-t border-slate-100" : ""
                          }`}
                        >
                          <span
                            className={`size-2 shrink-0 rounded-full ${dotClass}`}
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-slate-900">
                              {item.reference ?? "Parcela"}
                              {item.number ? (
                                <span className="font-normal text-slate-400">
                                  {" "}
                                  · {item.number}
                                </span>
                              ) : null}
                            </p>
                            <p className={`truncate text-[11px] ${statusColor}`}>
                              {statusLine}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-xs font-semibold text-slate-900">
                              {item.value ?? "-"}
                            </p>
                            {tone !== "liquidada" &&
                            onInsertDraftText &&
                            (item.invoiceUrl || item.paymentUrl) ? (
                              <button
                                type="button"
                                onClick={() =>
                                  onInsertDraftText(
                                    `Segue o boleto da ${item.reference ?? "parcela"}: ${item.invoiceUrl ?? item.paymentUrl}`,
                                  )
                                }
                                aria-label="Inserir boleto no rascunho"
                                title="Inserir boleto no rascunho"
                                className="mt-0.5 inline-flex size-6 items-center justify-center rounded-md text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10"
                              >
                                <Barcode className="size-4" aria-hidden="true" />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyHint text="Sem parcelas nesta unidade." />
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ParcelasTab({
  client,
  inserted,
  loading,
  onInsertAll,
  onInsertBoleto,
  overdue,
}: {
  client: QueueClient | null;
  inserted: Set<string>;
  loading: boolean;
  onInsertAll: () => void;
  onInsertBoleto: (installment: NonNullable<QueueClient["c2xInstallments"]>[number]) => void;
  overdue: NonNullable<QueueClient["c2xInstallments"]>;
}) {
  if (!client && !loading) {
    return <EmptyHint text="Sem cliente de cobrança vinculado a este atendimento." />;
  }
  const withLink = overdue.filter(
    (installment) => installment.invoiceUrl ?? installment.paymentUrl,
  );
  const groups = groupOverdueByEmpreendimento(client, overdue);
  return (
    <div className="space-y-2.5">
      {client ? (
        <div className="rounded-xl border border-rose-100 bg-rose-50/70 px-3 py-2.5">
          <p className="text-[11px] font-semibold text-rose-700">Saldo devedor</p>
          <p className="mt-0.5 text-lg font-semibold text-rose-700">
            {client.saldoDevedor}
          </p>
          <p className="mt-0.5 text-[11px] text-rose-600/80">
            {client.parcelas.vencidas} vencidas
          </p>
        </div>
      ) : null}

      {withLink.length > 0 ? (
        <button
          type="button"
          onClick={onInsertAll}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#A07C3B] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#8E6F35]"
        >
          <Send className="size-3.5" aria-hidden="true" />
          Inserir boletos na mensagem ({withLink.length})
        </button>
      ) : null}

      {overdue.length === 0 ? (
        <EmptyHint
          text={
            loading
              ? "Carregando parcelas…"
              : "Sem parcelas vencidas carregadas."
          }
        />
      ) : (
        groups.map(([empreendimento, items]) => (
          <div key={empreendimento} className="space-y-1.5">
            <div className="flex items-center gap-1.5 px-0.5">
              <Building2 className="size-3.5 shrink-0 text-[#A07C3B]" aria-hidden="true" />
              <span className="truncate text-[11px] font-semibold text-slate-700">
                {empreendimento}
              </span>
              <span className="shrink-0 text-[10px] text-slate-400">· {items.length}</span>
            </div>
            {items.map((installment) => {
              const url = installment.invoiceUrl ?? installment.paymentUrl ?? "";
              const done = inserted.has(installment.id);
              return (
                <div
                  key={installment.id}
                  className="rounded-lg border border-slate-200/70 bg-white px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-900">
                        {installment.unitCode ? (
                          <span className="text-[#7A5E2C]">{installment.unitCode} · </span>
                        ) : null}
                        {installment.number}
                      </p>
                      <p className="text-[11px] text-slate-500">{installment.reference}</p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-slate-950">
                      {installment.value}
                    </span>
                  </div>
                  {url ? (
                    <button
                      type="button"
                      onClick={() => onInsertBoleto(installment)}
                      className={[
                        "mt-2 inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-md border text-[11px] font-semibold transition-colors",
                        done
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-[#A07C3B]/25 bg-[#A07C3B]/6 text-[#7A5E2C] hover:bg-[#A07C3B]/12",
                      ].join(" ")}
                    >
                      {done ? (
                        <>
                          <Check className="size-3.5" aria-hidden="true" />
                          Link inserido
                        </>
                      ) : (
                        <>
                          <Link2 className="size-3.5" aria-hidden="true" />
                          Inserir link do boleto
                        </>
                      )}
                    </button>
                  ) : (
                    <p className="mt-2 text-[10px] text-slate-400">
                      Sem link de boleto disponível.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}

function groupOverdueByEmpreendimento(
  client: QueueClient | null,
  overdue: NonNullable<QueueClient["c2xInstallments"]>,
): [string, NonNullable<QueueClient["c2xInstallments"]>][] {
  const units = client?.carteira.unidades ?? [];
  const byEmpreendimento = new Map<
    string,
    NonNullable<QueueClient["c2xInstallments"]>
  >();
  for (const installment of overdue) {
    const unit = units.find((item) => item.id === installment.unitId);
    const empreendimento =
      unit?.empreendimento ||
      client?.carteira.empreendimento ||
      installment.unitCode ||
      "Outras unidades";
    const current = byEmpreendimento.get(empreendimento) ?? [];
    current.push(installment);
    byEmpreendimento.set(empreendimento, current);
  }
  return Array.from(byEmpreendimento.entries());
}

function ClienteTab({
  atProtocol,
  client,
  clienteFields,
  clientId,
}: {
  atProtocol: string;
  client: QueueClient | null;
  clienteFields: { label: string; value: string }[];
  clientId: string | null;
}) {
  // Enriquece e-mail/CPF com o cadastro do Hades quando o ticket nao trouxe.
  const fields = clienteFields.map((field) => {
    const empty = !field.value || field.value === "-";
    if (field.label === "E-mail" && empty && client?.dados360?.email) {
      return { ...field, value: client.dados360.email };
    }
    if (field.label === "CPF/CNPJ" && empty && client?.cpf) {
      return { ...field, value: client.cpf };
    }
    return field;
  });
  return (
    <div className="space-y-2.5">
      <div className="overflow-hidden rounded-xl border border-slate-200/70 bg-white">
        {fields.map((field, index) => (
          <div
            key={field.label}
            className={`flex items-start justify-between gap-4 px-4 py-3.5 ${
              index > 0 ? "border-t border-slate-100" : ""
            }`}
          >
            <span className="shrink-0 text-sm font-medium text-slate-500">
              {field.label}
            </span>
            <span className="min-w-0 break-words text-right text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">
              {field.value}
            </span>
          </div>
        ))}
      </div>
      {clientId ? (
        <a
          href={`/hades/cobranca?clientId=${encodeURIComponent(clientId)}&tab=cliente&from=atendimento${
            atProtocol ? `&reopenAt=${encodeURIComponent(atProtocol)}` : ""
          }`}
          className="flex items-center justify-center gap-2 rounded-xl border border-[#A07C3B]/25 bg-white px-3 py-2.5 text-xs font-semibold text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/5"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          Abrir cadastro no Hades
        </a>
      ) : null}
    </div>
  );
}

// Financeiro da Iris: situação financeira (do apoloEntity.financial) + acordos/
// promessas. Os acordos/promessas ainda não vêm no contexto do Apolo (são do
// Hades via commitments) → por ora empty-state; entram quando o dado for ligado.
function FinanceiroTab({
  apoloEntity,
}: {
  apoloEntity: IrisApoloContextEntity | null;
}) {
  const financial = apoloEntity?.financial;

  if (!financial) {
    return (
      <EmptyHint text="Sem situação financeira no Apolo para este cliente." />
    );
  }

  const behavior = financial.paymentBehavior?.trim();
  const risk = financial.risk?.trim();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
          <p className="text-sm font-semibold text-slate-900">
            {financial.totalPortfolio ?? "-"}
          </p>
          <p className="text-[10px] text-slate-500">Carteira</p>
        </div>
        <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
          <p className="text-sm font-semibold text-emerald-600">
            {financial.paidAmount ?? "-"}
          </p>
          <p className="text-[10px] text-slate-500">Pago</p>
        </div>
        <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
          <p className="text-sm font-semibold text-rose-600">
            {financial.overdueAmount ?? "-"}
          </p>
          <p className="text-[10px] text-slate-500">Vencido</p>
        </div>
      </div>

      {behavior || risk ? (
        <div className="flex flex-wrap gap-2">
          {behavior ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium capitalize text-amber-700 ring-1 ring-amber-200">
              {behavior.toLowerCase()}
            </span>
          ) : null}
          {risk ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium capitalize text-slate-600 ring-1 ring-slate-200">
              Risco {risk.toLowerCase()}
            </span>
          ) : null}
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-xs font-semibold text-slate-500">
          Acordos e promessas
        </p>
        <EmptyHint text="Nenhum acordo ou promessa registrado para este cliente." />
      </div>
    </div>
  );
}

function PropostasTab({
  client,
  onView,
}: {
  client: QueueClient | null;
  onView: (commitment: QueueClient["commitments"][number]) => void;
}) {
  const commitments = client?.commitments ?? [];
  if (commitments.length === 0) {
    return <EmptyHint text="Nenhuma proposta (acordo ou promessa) registrada." />;
  }
  return (
    <div className="space-y-2">
      {commitments.map((commitment) => {
        const value =
          commitment.type === "Acordo"
            ? commitment.negotiatedValue
            : commitment.promisedValue;
        const date =
          commitment.type === "Acordo"
            ? commitment.firstDueDate
            : commitment.promisedDate;
        return (
          <button
            type="button"
            key={commitment.id}
            onClick={() => onView(commitment)}
            className="w-full rounded-xl border border-slate-200/70 bg-white px-3 py-2.5 text-left transition-colors hover:border-[#A07C3B]/25 hover:bg-slate-50"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                <Building2 className="size-3.5 text-[#A07C3B]" aria-hidden="true" />
                {commitment.type}
              </span>
              <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200/70">
                {commitment.status}
              </span>
            </div>
            <p className="mt-1.5 text-sm font-semibold text-slate-950">{value}</p>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-slate-500">
                {commitment.protocol} · {date}
              </p>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#7A5E2C]">
                Ver proposta
                <ArrowRight className="size-3" aria-hidden="true" />
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

type TimelineEventType =
  | "atendimento"
  | "acordo"
  | "promessa"
  | "quitacao"
  | "quebra"
  | "retorno"
  | "task"
  | "nota"
  | "outro";

const TIMELINE_VISUAL: Record<
  TimelineEventType,
  { Icon: LucideIcon; cls: string }
> = {
  atendimento: { Icon: MessageSquare, cls: "bg-blue-50 text-blue-600" },
  acordo: { Icon: HandCoins, cls: "bg-emerald-50 text-emerald-700" },
  promessa: { Icon: CalendarCheck, cls: "bg-violet-50 text-violet-700" },
  quitacao: { Icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-700" },
  quebra: { Icon: XCircle, cls: "bg-rose-50 text-rose-600" },
  retorno: { Icon: Phone, cls: "bg-amber-50 text-amber-700" },
  task: { Icon: ClipboardList, cls: "bg-slate-100 text-slate-600" },
  nota: { Icon: FileText, cls: "bg-slate-100 text-slate-600" },
  outro: { Icon: Clock3, cls: "bg-slate-100 text-slate-500" },
};

// Sem campo de tipo/origem na timeline (vem de fontes diferentes), entao
// derivamos por palavra-chave do titulo/descricao — bom o bastante pro visual.
function classifyTimelineEvent(event: TimelineDisplayEvent): {
  origin: "auto" | "manual";
  type: TimelineEventType;
} {
  const text = `${event.title} ${event.description ?? ""}`.toLowerCase();
  let type: TimelineEventType = "outro";
  if (/quebrad|quebra|cancelad|reprovad/.test(text)) {
    type = "quebra";
  } else if (/quitad|liquidad|pagamento confirmad|\bpaga\b|\bpago\b/.test(text)) {
    type = "quitacao";
  } else if (/acordo/.test(text)) {
    type = "acordo";
  } else if (/promessa/.test(text)) {
    type = "promessa";
  } else if (/retorno/.test(text)) {
    type = "retorno";
  } else if (/tarefa|task/.test(text)) {
    type = "task";
  } else if (/\bnota\b/.test(text)) {
    type = "nota";
  } else if (
    /atendimento|iniciad|encerrad|direcionad|mensagem|whatsapp|template|contato/.test(
      text,
    )
  ) {
    type = "atendimento";
  }
  const operator = (event.operator ?? "").toLowerCase();
  const autoByType = type === "quitacao" || type === "quebra";
  const autoByOperator =
    !event.operator || /hades|sistema|cron|autom|cac[áa]|r[ée]gua/.test(operator);
  return { origin: autoByType || autoByOperator ? "auto" : "manual", type };
}

function timelineEventTime(value?: string | null): number {
  if (!value) {
    return Number.NaN;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function timelineDayLabel(time: number): string {
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) {
    return "Hoje";
  }
  if (diff === 1) {
    return "Ontem";
  }
  return new Date(time).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

function timelineTimeLabel(time: number): string {
  return new Date(time).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TimelineTab({
  events,
  formatDateTime,
}: {
  events: TimelineDisplayEvent[];
  formatDateTime: (value?: string | null) => string;
}) {
  const groups = useMemo(() => {
    const sorted = [...events].sort((first, second) => {
      const firstTime = timelineEventTime(first.occurredAt);
      const secondTime = timelineEventTime(second.occurredAt);
      if (Number.isNaN(firstTime) && Number.isNaN(secondTime)) {
        return 0;
      }
      if (Number.isNaN(firstTime)) {
        return 1;
      }
      if (Number.isNaN(secondTime)) {
        return -1;
      }
      return secondTime - firstTime;
    });
    const result: Array<{
      events: TimelineDisplayEvent[];
      key: string;
      label: string;
    }> = [];
    for (const event of sorted.slice(0, 60)) {
      const time = timelineEventTime(event.occurredAt);
      const hasTime = !Number.isNaN(time);
      const key = hasTime
        ? String(new Date(time).setHours(0, 0, 0, 0))
        : "sem-data";
      const label = hasTime ? timelineDayLabel(time) : "Sem data";
      let group = result.find((item) => item.key === key);
      if (!group) {
        group = { events: [], key, label };
        result.push(group);
      }
      group.events.push(event);
    }
    return result;
  }, [events]);

  if (events.length === 0) {
    return <EmptyHint text="Sem eventos na timeline de cobrança." />;
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.key}>
          <p className="mb-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-normal text-slate-400">
            {group.label}
          </p>
          <div className="relative space-y-0.5">
            <span
              aria-hidden="true"
              className="absolute bottom-2 left-[12px] top-2 w-px bg-slate-200"
            />
            {group.events.map((event) => {
              const { origin, type } = classifyTimelineEvent(event);
              const visual = TIMELINE_VISUAL[type];
              const time = timelineEventTime(event.occurredAt);
              return (
                <div key={event.id} className="relative flex gap-2.5 py-1">
                  <span
                    className={`relative z-10 mt-0.5 flex size-[25px] shrink-0 items-center justify-center rounded-full ${visual.cls}`}
                  >
                    <visual.Icon className="size-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-900 [overflow-wrap:anywhere]">
                      {event.title}
                    </p>
                    {event.description ? (
                      <p className="mt-0.5 text-[11px] text-slate-500 [overflow-wrap:anywhere]">
                        {event.description}
                      </p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[10px] text-slate-400">
                        {Number.isNaN(time)
                          ? formatDateTime(event.occurredAt)
                          : timelineTimeLabel(time)}
                      </span>
                      <span
                        className={[
                          "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
                          origin === "auto"
                            ? "bg-[#A07C3B]/10 text-[#7A5E2C]"
                            : "bg-slate-100 text-slate-600",
                        ].join(" ")}
                      >
                        {origin === "auto" ? (
                          <Bot className="size-2.5" aria-hidden="true" />
                        ) : (
                          <User className="size-2.5" aria-hidden="true" />
                        )}
                        {origin === "auto" ? "Auto · Hades" : "Manual · operador"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function TicketsTab({
  currentTicketId,
  formatDateTime,
  onSelectTicket,
  tickets,
}: {
  currentTicketId: string;
  formatDateTime: (value?: string | null) => string;
  onSelectTicket: (ticketId: string) => void;
  tickets: CockpitTicket[];
}) {
  if (tickets.length === 0) {
    return <EmptyHint text="Nenhum atendimento registrado." />;
  }
  return (
    <div className="space-y-2">
      <p className="px-0.5 text-[11px] font-semibold uppercase tracking-normal text-slate-400">
        Atendimentos do cliente
      </p>
      {tickets.map((item) => {
        const current = item.id === currentTicketId;
        return (
          <button
            type="button"
            key={item.id}
            onClick={() => onSelectTicket(item.id)}
            className={[
              "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
              current
                ? "border-[#A07C3B]/30 bg-[#A07C3B]/5"
                : "border-slate-200/70 bg-white hover:border-[#A07C3B]/25 hover:bg-slate-50",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-[#7A5E2C]">
                {item.protocol}
              </span>
              {current ? (
                <span className="rounded-full bg-[#A07C3B]/10 px-2 py-0.5 text-[10px] font-semibold text-[#7A5E2C]">
                  atual
                </span>
              ) : (
                <ArrowRight className="size-3.5 text-slate-300" aria-hidden="true" />
              )}
            </div>
            <p className="mt-0.5 truncate text-xs font-semibold text-slate-900">
              {item.subject || "Sem assunto"}
            </p>
            <p className="mt-1 text-[10px] text-slate-400">
              Aberto {formatDateTime(item.openedAt)}
              {item.closedAt
                ? ` · encerrado ${formatDateTime(item.closedAt)}`
                : ""}
            </p>
            {item.operator ? (
              <p className="mt-0.5 truncate text-[10px] text-slate-400">
                Operador: {item.operator}
              </p>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white px-3 py-6 text-center text-xs font-medium text-slate-400">
      {text}
    </div>
  );
}

function Indicator({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "danger" | "neutral" | "warning";
  value: string;
}) {
  const toneClass =
    tone === "danger"
      ? "text-rose-700"
      : tone === "warning"
        ? "text-amber-700"
        : "text-slate-900";
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
      <p className={`text-base font-semibold leading-none ${toneClass}`}>
        {value}
      </p>
      <p className="mt-1 text-[10px] font-medium text-slate-400">{label}</p>
    </div>
  );
}

async function accessToken() {
  const supabase = getHubSupabaseClient();
  const session = await supabase?.auth.getSession();
  return session?.data.session?.access_token ?? "";
}
