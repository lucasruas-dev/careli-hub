"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpDown,
  Bot,
  ChevronDown,
  Clock3,
  Filter,
  MessageCircle,
  Search,
  ShieldAlert,
  Sparkles,
  TicketCheck,
  UserRoundCheck,
} from "lucide-react";
import type { AttendancePriority, QueueClient } from "@/modules/attendance/types";

type TicketQueueStatus =
  | "Pendente"
  | "Aguardando operador"
  | "Em atendimento"
  | "Aguardando cliente"
  | "SLA crítico"
  | "Encerrado"
  | "Reaberto";

type SlaFilter = "Todos" | "Crítico" | "Atenção" | "Dentro do SLA";
type PeriodFilter = "Todos" | "Hoje" | "Últimos 7 dias" | "Este mês";

type ResponseTone = "Excelente" | "Atenção" | "Crítico";

type OperationalTicket = {
  id: string;
  protocol: string;
  clientId: string;
  client: string;
  profile: string;
  operator: string;
  enterprise: string;
  unitCode: string;
  priority: AttendancePriority;
  sla: string;
  slaState: Exclude<SlaFilter, "Todos">;
  status: TicketQueueStatus;
  openedAt: string;
  handlingTime: string;
  lastContact: string;
  nextFollowUp: string;
  smartReason: string;
  balanceScore: number;
  promiseDue: boolean;
  hasNewMessage: boolean;
  responseWait: string;
  unansweredMinutes: number;
  firstResponseTime: string;
  averageResponseTime: string;
  conversationSla: string;
  responseTone: ResponseTone;
};

type TicketOperationsQueueProps = {
  clients: QueueClient[];
  onOpenWhatsApp: (clientId: string) => void;
  onSelectClient: (clientId: string) => void;
};

const statusOptions: Array<TicketQueueStatus | "Todos"> = [
  "Todos",
  "Pendente",
  "Aguardando operador",
  "Em atendimento",
  "Aguardando cliente",
  "SLA crítico",
  "Encerrado",
  "Reaberto",
];

const priorityOptions: Array<AttendancePriority | "Todas"> = ["Todas", "Crítica", "Alta", "Média", "Baixa"];

const profileOptions = [
  "Todos",
  "Primeiro contato",
  "Cobrança",
  "Lembrete de pagamento",
  "Enviar boleto C2X",
  "Negociação",
  "Promessa de pagamento",
  "Formalização de acordo",
  "Quebra de promessa",
  "Reativação de acordo",
  "Atualização cadastral",
  "Dúvida financeira",
  "Encaminhamento jurídico",
];

const statusStyles: Record<TicketQueueStatus, string> = {
  Pendente: "bg-slate-50 text-slate-600 ring-slate-200",
  "Aguardando operador": "bg-amber-50 text-amber-700 ring-amber-100",
  "Em atendimento": "bg-emerald-50 text-emerald-700 ring-emerald-100",
  "Aguardando cliente": "bg-sky-50 text-sky-700 ring-sky-100",
  "SLA crítico": "bg-rose-50 text-rose-700 ring-rose-100",
  Encerrado: "bg-slate-100 text-slate-500 ring-slate-200",
  Reaberto: "bg-[#A07C3B]/5 text-[#7A5E2C] ring-[#A07C3B]/15",
};

const priorityStyles: Record<AttendancePriority, string> = {
  Crítica: "bg-rose-50 text-rose-700 ring-rose-100",
  Alta: "bg-orange-50 text-orange-700 ring-orange-100",
  Média: "bg-amber-50 text-amber-700 ring-amber-100",
  Baixa: "bg-emerald-50 text-emerald-700 ring-emerald-100",
};

const slaStyles: Record<OperationalTicket["slaState"], string> = {
  Crítico: "bg-rose-50 text-rose-700 ring-rose-100",
  Atenção: "bg-amber-50 text-amber-700 ring-amber-100",
  "Dentro do SLA": "bg-emerald-50 text-emerald-700 ring-emerald-100",
};

const responseToneStyles: Record<ResponseTone, string> = {
  Excelente: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  Atenção: "bg-amber-50 text-amber-700 ring-amber-100",
  Crítico: "bg-rose-50 text-rose-700 ring-rose-100",
};

export function TicketOperationsQueue({
  clients,
  onOpenWhatsApp,
  onSelectClient,
}: TicketOperationsQueueProps) {
  const [operator, setOperator] = useState("Todos");
  const [profile, setProfile] = useState("Todos");
  const [status, setStatus] = useState<TicketQueueStatus | "Todos">("Todos");
  const [priority, setPriority] = useState<AttendancePriority | "Todas">("Todas");
  const [enterprise, setEnterprise] = useState("Todos");
  const [unit, setUnit] = useState("Todos");
  const [sla, setSla] = useState<SlaFilter>("Todos");
  const [period, setPeriod] = useState<PeriodFilter>("Todos");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState("SLA mais crítico");
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const tickets = useMemo(() => buildOperationalTickets(clients), [clients]);
  const operators = useMemo(() => ["Todos", ...unique(tickets.map((ticket) => ticket.operator))], [tickets]);
  const enterprises = useMemo(() => ["Todos", ...unique(tickets.map((ticket) => ticket.enterprise))], [tickets]);
  const units = useMemo(() => ["Todos", ...unique(tickets.map((ticket) => ticket.unitCode))], [tickets]);

  const filteredTickets = useMemo(() => {
    const normalized = search.trim().toLowerCase();

    return tickets
      .filter((ticket) => {
        const matchesSearch =
          normalized.length === 0 ||
          ticket.protocol.toLowerCase().includes(normalized) ||
          ticket.client.toLowerCase().includes(normalized) ||
          ticket.unitCode.toLowerCase().includes(normalized);

        return (
          matchesSearch &&
          (operator === "Todos" || ticket.operator === operator) &&
          (profile === "Todos" || ticket.profile === profile) &&
          (status === "Todos" || ticket.status === status) &&
          (priority === "Todas" || ticket.priority === priority) &&
          (enterprise === "Todos" || ticket.enterprise === enterprise) &&
          (unit === "Todos" || ticket.unitCode === unit) &&
          (sla === "Todos" || ticket.slaState === sla) &&
          (period === "Todos" || matchesPeriod(ticket, period))
        );
      })
      .sort((a, b) => sortTickets(a, b, sortMode));
  }, [enterprise, operator, period, priority, profile, search, sla, sortMode, status, tickets, unit]);

  const kpis = buildTicketKpis(tickets);
  const activeFilters = [
    operator !== "Todos" ? { label: "Operador", value: operator, clear: () => setOperator("Todos") } : null,
    profile !== "Todos" ? { label: "Perfil", value: profile, clear: () => setProfile("Todos") } : null,
    status !== "Todos" ? { label: "Status", value: status, clear: () => setStatus("Todos") } : null,
    priority !== "Todas" ? { label: "Prioridade", value: priority, clear: () => setPriority("Todas") } : null,
    enterprise !== "Todos" ? { label: "Empreendimento", value: enterprise, clear: () => setEnterprise("Todos") } : null,
    unit !== "Todos" ? { label: "Unidade", value: unit, clear: () => setUnit("Todos") } : null,
    sla !== "Todos" ? { label: "SLA", value: sla, clear: () => setSla("Todos") } : null,
    period !== "Todos" ? { label: "Período", value: period, clear: () => setPeriod("Todos") } : null,
  ].filter(Boolean) as Array<{ label: string; value: string; clear: () => void }>;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = window.localStorage.getItem("guardian-desk-filters-expanded");
      if (stored) setFiltersExpanded(stored === "true");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function toggleFilters() {
    setFiltersExpanded((current) => {
      const next = !current;
      window.localStorage.setItem("guardian-desk-filters-expanded", String(next));
      return next;
    });
  }

  return (
    <section className="rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="border-b border-slate-100 px-4 py-3">
        <div className="flex flex-col gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">Fila operacional de tickets</p>
            <h2 className="mt-1 text-base font-semibold text-slate-950">Inbox operacional</h2>
            <p className="hidden">
              Gestão consolidada de tickets, WhatsApp, promessas, acordos, SLA e follow-ups auditáveis.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <KpiCard icon={TicketCheck} label="Tickets abertos" shortLabel="Tickets" value={`${kpis.open}`} />
            <KpiCard icon={ShieldAlert} label="SLA crítico" shortLabel="SLA" value={`${kpis.critical}`} tone="danger" />
            <KpiCard icon={Clock3} label="Tempo de primeira resposta" shortLabel="1ª resp." value={kpis.firstResponse} />
            <KpiCard icon={Clock3} label="Média de resposta" shortLabel="Média" value={kpis.averageResponse} />
            <KpiCard icon={UserRoundCheck} label="Encerrados hoje" shortLabel="Hoje" value={`${kpis.closedToday}`} />
            <KpiCard icon={Sparkles} label="Sem resposta" shortLabel="Sem resp." value={`${kpis.unanswered}`} tone={kpis.unanswered > 0 ? "danger" : "gold"} />
          </div>
        </div>
      </header>

      <div className="grid gap-3 p-3 2xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-col gap-2 rounded-xl border border-slate-200/70 bg-slate-50/60 p-2">
            <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-sm text-slate-500">
              <Search className="size-4 text-[#A07C3B]" aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar protocolo, cliente ou unidade..."
                className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
              />
            </label>
            <FilterSummaryBar activeFilters={activeFilters} expanded={filtersExpanded} onToggle={toggleFilters} />
            <div className={`grid transition-all duration-300 ease-out ${filtersExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
              <div className="min-h-0 overflow-hidden">
                <div className="grid gap-2 pt-1 lg:grid-cols-4 xl:grid-cols-5">
                  <FilterSelect label="Operador" value={operator} options={operators} onChange={setOperator} />
                  <FilterSelect label="Perfil" value={profile} options={profileOptions} onChange={setProfile} />
                  <FilterSelect label="Status" value={status} options={statusOptions} onChange={(value) => setStatus(value as TicketQueueStatus | "Todos")} />
                  <FilterSelect label="Prioridade" value={priority} options={priorityOptions} onChange={(value) => setPriority(value as AttendancePriority | "Todas")} />
                  <FilterSelect label="Empreendimento" value={enterprise} options={enterprises} onChange={setEnterprise} />
                  <FilterSelect label="Unidade" value={unit} options={units} onChange={setUnit} />
                  <FilterSelect label="SLA" value={sla} options={["Todos", "Crítico", "Atenção", "Dentro do SLA"]} onChange={(value) => setSla(value as SlaFilter)} />
                  <FilterSelect label="Período" value={period} options={["Todos", "Hoje", "Últimos 7 dias", "Este mês"]} onChange={(value) => setPeriod(value as PeriodFilter)} />
                  <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-500">
                    <ArrowUpDown className="size-4 text-[#A07C3B]" aria-hidden="true" />
                    <select
                      value={sortMode}
                      onChange={(event) => setSortMode(event.target.value)}
                      className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-slate-700 outline-none"
                    >
                      <option>SLA mais crítico</option>
                      <option>Aguardando cliente</option>
                      <option>Sem resposta</option>
                      <option>Promessa vencendo</option>
                      <option>Alto saldo</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200/70">
            <div className="hidden grid-cols-[1.05fr_0.85fr_0.75fr_0.8fr_0.8fr_0.9fr_0.75fr_0.65fr] gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-2 text-xs font-semibold uppercase tracking-normal text-slate-400 xl:grid">
              <span>Ticket</span>
              <span>Perfil</span>
              <span>Operador</span>
              <span>SLA</span>
              <span>Status</span>
              <span>Resposta</span>
              <span>Follow-up</span>
              <span className="text-right">Ação</span>
            </div>
            <div className="max-h-[430px] overflow-y-auto [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
              {filteredTickets.map((ticket) => (
                <TicketQueueRow
                  key={ticket.id}
                  ticket={ticket}
                  onOpenWhatsApp={onOpenWhatsApp}
                  onSelectClient={onSelectClient}
                />
              ))}
            </div>
          </div>
        </div>

        <aside className="space-y-3">
          <div title="Priorizar tickets com SLA crítico, promessa vencendo e alto saldo." className="rounded-xl border border-[#A07C3B]/15 bg-[#A07C3B]/5 p-3">
            <div className="flex items-center gap-2">
              <Bot className="size-4 text-[#A07C3B]" aria-hidden="true" />
              <p className="text-sm font-semibold text-slate-950">IA da fila</p>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-700">
              Priorizar tickets com SLA crítico, promessa vencendo e alto saldo. Há risco operacional concentrado em
              negociações com cliente sem resposta após 24h.
            </p>
          </div>

          <InsightCard title="Tickets prioritários" value={`${kpis.critical + kpis.promiseDue}`} description="SLA crítico ou promessa vencendo hoje." />
          <InsightCard title="Previsão de atraso" value="18%" description="Baseada em status, saldo e tempo sem resposta." />
          <InsightCard title="Produtividade" value="Gustavo Freitas" description="Maior volume de encerramentos mockados no dia." />
          <InsightCard title="Follow-ups recomendados" value={`${kpis.followUps}`} description="Ações sugeridas pela régua operacional." />
        </aside>
      </div>
    </section>
  );
}

function TicketQueueRow({
  onOpenWhatsApp,
  onSelectClient,
  ticket,
}: {
  onOpenWhatsApp: (clientId: string) => void;
  onSelectClient: (clientId: string) => void;
  ticket: OperationalTicket;
}) {
  return (
    <article
      className={`grid gap-3 border-b border-slate-100 px-4 py-3 transition-colors last:border-b-0 hover:bg-slate-50/70 xl:grid-cols-[1.05fr_0.85fr_0.75fr_0.8fr_0.8fr_0.9fr_0.75fr_0.65fr] xl:items-center ${
        ticket.hasNewMessage ? "bg-[#A07C3B]/5 shadow-[inset_3px_0_0_#A07C3B]" : ""
      }`}
    >
      <button type="button" onClick={() => onSelectClient(ticket.clientId)} className="min-w-0 text-left">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-[#7A5E2C]">{ticket.protocol}</span>
          {ticket.hasNewMessage ? (
            <span className="rounded-full bg-[#A07C3B] px-2 py-0.5 text-[11px] font-semibold text-white shadow-[0_0_0_3px_rgba(160,124,59,0.12)]">
              nova
            </span>
          ) : null}
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${priorityStyles[ticket.priority]}`}>
            {ticket.priority}
          </span>
        </div>
        <p className="mt-1 truncate text-sm font-semibold text-slate-950">{ticket.client}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {ticket.enterprise} · {ticket.unitCode}
        </p>
      </button>

      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-800">{ticket.profile}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">{ticket.smartReason}</p>
      </div>

      <div className="text-sm font-medium text-slate-600">
        <p className="truncate">{ticket.operator}</p>
        <p className="mt-0.5 text-xs text-slate-400">{ticket.openedAt}</p>
      </div>

      <div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${slaStyles[ticket.slaState]}`}>
          {ticket.sla}
        </span>
        <p className="mt-1 text-xs text-slate-400">{ticket.handlingTime}</p>
      </div>

      <div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusStyles[ticket.status]}`}>
          {ticket.status}
        </span>
        <p className={`mt-1 text-xs ${ticket.hasNewMessage ? "font-semibold text-[#7A5E2C]" : "text-slate-400"}`}>
          {ticket.hasNewMessage ? ticket.responseWait : ticket.lastContact}
        </p>
      </div>

      <div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${responseToneStyles[ticket.responseTone]}`}>
          {ticket.responseTone}
        </span>
        <p className="mt-1 text-xs text-slate-500">
          1ª {ticket.firstResponseTime} · média {ticket.averageResponseTime}
        </p>
      </div>

      <p className="text-sm font-medium text-slate-600">{ticket.nextFollowUp}</p>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onOpenWhatsApp(ticket.clientId)}
          title="Abrir conversa WhatsApp"
          aria-label="Abrir conversa WhatsApp"
          className="inline-flex size-8 items-center justify-center rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10"
        >
          <MessageCircle className="size-4" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function KpiCard({
  icon: Icon,
  label,
  shortLabel,
  tone = "neutral",
  value,
}: {
  icon: typeof TicketCheck;
  label: string;
  shortLabel: string;
  tone?: "neutral" | "danger" | "gold";
  value: string;
}) {
  const toneClass =
    tone === "danger"
      ? "bg-rose-50 text-rose-700 ring-rose-100"
      : tone === "gold"
        ? "bg-[#A07C3B]/5 text-[#7A5E2C] ring-[#A07C3B]/15"
        : "bg-slate-50 text-slate-700 ring-slate-200";

  return (
    <div
      title={`${label}: ${value}`}
      className="group flex min-h-14 items-center gap-2 rounded-lg border border-slate-200/70 bg-slate-50/55 px-3 py-2 transition-colors hover:border-[#A07C3B]/20 hover:bg-white"
    >
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 transition-transform group-hover:scale-105 ${toneClass}`}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-base font-semibold leading-5 text-slate-950">{value}</p>
        <p className="truncate text-[11px] font-semibold uppercase tracking-normal text-slate-400">{shortLabel}</p>
      </div>
    </div>
  );
}

function FilterSummaryBar({
  activeFilters,
  expanded,
  onToggle,
}: {
  activeFilters: Array<{ label: string; value: string; clear: () => void }>;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        title={expanded ? "Recolher filtros" : "Expandir filtros"}
        className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-2.5 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
        aria-expanded={expanded}
      >
        <Filter className="size-3.5 text-[#A07C3B]" aria-hidden="true" />
        Filtros{activeFilters.length > 0 ? ` (${activeFilters.length})` : ""}
        <ChevronDown className={`size-3.5 text-[#A07C3B] transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {activeFilters.map((filter) => (
        <button
          key={`${filter.label}-${filter.value}`}
          type="button"
          onClick={filter.clear}
          title={`Remover ${filter.label}`}
          className="inline-flex h-7 max-w-44 items-center gap-1 rounded-full bg-[#A07C3B]/5 px-2 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15"
        >
          <span className="truncate">{filter.value}</span>
          <span aria-hidden="true">×</span>
        </button>
      ))}
    </div>
  );
}

function InsightCard({ description, title, value }: { description: string; title: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">{title}</p>
      <p className="mt-1 text-base font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}

function FilterSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-500">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 w-full bg-transparent text-xs font-semibold text-slate-700 outline-none"
        aria-label={label}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function buildOperationalTickets(clients: QueueClient[]): OperationalTicket[] {
  const profiles = [
    "Negociação",
    "Promessa de pagamento",
    "Cobrança",
    "Enviar boleto C2X",
    "Quebra de promessa",
    "Formalização de acordo",
    "Dúvida financeira",
    "Reativação de acordo",
  ];
  const statuses: TicketQueueStatus[] = [
    "SLA crítico",
    "Em atendimento",
    "Aguardando cliente",
    "Pendente",
    "Aguardando operador",
    "Reaberto",
    "Encerrado",
  ];

  return clients.map((client, index) => {
    const unit = client.carteira.unidades[index % client.carteira.unidades.length] ?? client.carteira.unidades[0];
    const profile = profiles[index % profiles.length];
    const status = statuses[index % statuses.length];
    const critical = status === "SLA crítico" || client.prioridade === "Crítica";
    const warning = !critical && (client.prioridade === "Alta" || status === "Aguardando cliente");
    const promiseDue = client.commitments.some(
      (commitment) => commitment.type === "Promessa de pagamento" && commitment.status !== "Cumprida"
    );
    const unansweredMinutes = index % 4 === 0 ? 12 : status === "Aguardando cliente" ? 31 : index % 3 === 0 ? 4 : 7;
    const responseTone = responseToneForMinutes(unansweredMinutes);

    return {
      id: `${client.id}-ticket-queue`,
      protocol: guardianProtocol(184 + index),
      clientId: client.id,
      client: client.nome,
      profile,
      operator: client.responsavel,
      enterprise: unit?.empreendimento ?? client.carteira.empreendimento,
      unitCode: unit?.matricula ?? "-",
      priority: client.prioridade,
      sla: critical ? "01h 20m" : warning ? "04h 10m" : "18h 00m",
      slaState: critical ? "Crítico" : warning ? "Atenção" : "Dentro do SLA",
      status,
      openedAt: index % 3 === 0 ? "Hoje, 08:45" : index % 3 === 1 ? "Ontem, 16:20" : "09/05, 14:10",
      handlingTime: index % 2 === 0 ? "32 min em atendimento" : "1h 08m em fila",
      lastContact: index % 2 === 0 ? "WhatsApp há 18 min" : "Sem resposta há 22h",
      nextFollowUp: promiseDue ? "Promessa vence hoje" : warning ? "Retomar em 2h" : "Acompanhar SLA",
      smartReason: critical ? "SLA e saldo pedem ação imediata" : warning ? "Sem resposta recente" : "Dentro da régua",
      balanceScore: parseMoney(client.saldoDevedor),
      promiseDue,
      hasNewMessage: index % 4 === 0 || status === "Aguardando cliente",
      responseWait: index % 4 === 0 ? "Aguardando resposta há 12 min" : "Aguardando resposta há 31 min",
      unansweredMinutes,
      firstResponseTime: index % 3 === 0 ? "3m 42s" : index % 3 === 1 ? "8m 15s" : "17m 08s",
      averageResponseTime: index % 3 === 0 ? "4m 18s" : index % 3 === 1 ? "9m 30s" : "16m 44s",
      conversationSla: responseTone === "Crítico" ? "SLA vencendo" : responseTone === "Atenção" ? "SLA em atenção" : "Dentro do SLA",
      responseTone,
    };
  });
}

function buildTicketKpis(tickets: OperationalTicket[]) {
  const open = tickets.filter((ticket) => ticket.status !== "Encerrado").length;
  const critical = tickets.filter((ticket) => ticket.slaState === "Crítico").length;
  const closedToday = tickets.filter((ticket) => ticket.status === "Encerrado").length;
  const promises = tickets.filter((ticket) => ticket.profile === "Promessa de pagamento").length;
  const agreements = tickets.filter((ticket) => ticket.profile === "Formalização de acordo" || ticket.profile === "Negociação").length;
  const promiseDue = tickets.filter((ticket) => ticket.promiseDue).length;
  const unanswered = tickets.filter((ticket) => ticket.hasNewMessage && ticket.unansweredMinutes >= 5).length;

  return {
    agreements,
    averageTime: "42 min",
    averageResponse: "7m 48s",
    closedToday,
    critical,
    firstResponse: "5m 12s",
    followUps: tickets.filter((ticket) => ticket.status !== "Encerrado").length,
    open,
    promiseDue,
    promises,
    unanswered,
  };
}

function sortTickets(a: OperationalTicket, b: OperationalTicket, mode: string) {
  if (mode === "Aguardando cliente") return scoreStatus(b, "Aguardando cliente") - scoreStatus(a, "Aguardando cliente");
  if (mode === "Sem resposta") return Number(b.lastContact.includes("Sem resposta")) - Number(a.lastContact.includes("Sem resposta"));
  if (mode === "Promessa vencendo") return Number(b.promiseDue) - Number(a.promiseDue);
  if (mode === "Alto saldo") return b.balanceScore - a.balanceScore;

  return slaRank(a.slaState) - slaRank(b.slaState);
}

function matchesPeriod(ticket: OperationalTicket, period: PeriodFilter) {
  if (period === "Hoje") return ticket.openedAt.includes("Hoje");
  if (period === "Últimos 7 dias") return !ticket.openedAt.includes("Este mês");
  if (period === "Este mês") return true;
  return true;
}

function scoreStatus(ticket: OperationalTicket, status: TicketQueueStatus) {
  return ticket.status === status ? 1 : 0;
}

function slaRank(state: OperationalTicket["slaState"]) {
  if (state === "Crítico") return 0;
  if (state === "Atenção") return 1;
  return 2;
}

function responseToneForMinutes(minutes: number): ResponseTone {
  if (minutes <= 5) return "Excelente";
  if (minutes <= 15) return "Atenção";
  return "Crítico";
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseMoney(value: string) {
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  return Number.parseFloat(normalized) || 0;
}

function guardianProtocol(seed: number) {
  return `GDN-${String(Math.max(seed, 1)).padStart(6, "0")}`;
}
