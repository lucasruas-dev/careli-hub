"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Building2,
  ChartBar,
  Coins,
  ExternalLink,
  FileText,
  Inbox,
  Loader2,
  Lock,
  Pencil,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Undo2,
  X,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import { ProposalChat } from "@/modules/guardian/attendance/components/ProposalChat";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import { hasProposalUpdate } from "@/lib/guardian/proposal-seen";
import { useAuth } from "@/providers/auth-provider";
import type {
  CompromissoDecision,
  GuardianApprovalStatus,
  GuardianCompromissoDetail,
  GuardianFinancialSummary,
} from "@/lib/guardian/compromissos";

const GOLD = "#A07C3B";

type CockpitTab = "overview" | "approvals";

// Filtro unico aplicado a tabela. Os cards (KPI + status) sao interativos e
// setam esse filtro; o card "Por empreendimento" seta o empreendimento.
type TableFilter =
  | "all"
  | "em_negociacao"
  | "a_receber"
  | "recuperado"
  | "quebrado"
  | "pendente"
  | "aprovado"
  | "reprovado"
  | "em_elaboracao";

const FILTER_LABELS: Record<TableFilter, string> = {
  a_receber: "A receber",
  all: "Todas",
  aprovado: "Aprovadas",
  em_elaboracao: "Em elaboração",
  em_negociacao: "Em negociação",
  pendente: "Em aprovação",
  quebrado: "Quebrado",
  recuperado: "Recuperado",
  reprovado: "Reprovadas",
};

export function ManagerApprovalCenter() {
  const { hubUser } = useAuth();
  const isAdmin = hubUser?.role === "admin";
  const currentUserId = hubUser?.id ?? null;

  const [tab, setTab] = useState<CockpitTab>("overview");
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  return (
    <section className="overflow-hidden rounded-xl border border-[#d9e0e7] bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.45)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf1f5] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-[#A07C3B] text-white">
            <Coins className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-ink">
              Central de Propostas
            </h2>
            <p className="text-[11px] text-ink-muted">
              {isAdmin
                ? "Cobrança · saúde financeira da recuperação"
                : "Cobrança · minhas propostas"}
            </p>
          </div>
        </div>
        <nav className="inline-flex gap-1 rounded-lg bg-subtle/80 p-1">
          <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
            Visão geral
          </TabButton>
          {isAdmin ? (
            <TabButton
              active={tab === "approvals"}
              onClick={() => setTab("approvals")}
            >
              Aprovações
              {pendingCount ? (
                <span className="ml-1 rounded-full bg-[#A07C3B] px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {pendingCount}
                </span>
              ) : null}
            </TabButton>
          ) : null}
        </nav>
      </div>

      <div className="p-4">
        {tab === "overview" ? (
          <OverviewTab
            isAdmin={Boolean(isAdmin)}
            currentUserId={currentUserId}
            onPendingCount={setPendingCount}
            onGoToApprovals={() => setTab("approvals")}
          />
        ) : (
          <ApprovalsTab
            isAdmin={Boolean(isAdmin)}
            onPendingCount={setPendingCount}
          />
        )}
      </div>
    </section>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
        active ? "bg-[#A07C3B] text-white" : "text-ink-soft hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

// ============================ VISÃO GERAL ============================

function OverviewTab({
  isAdmin,
  currentUserId,
  onPendingCount,
  onGoToApprovals,
}: {
  isAdmin: boolean;
  currentUserId: string | null;
  onPendingCount: (count: number) => void;
  onGoToApprovals: () => void;
}) {
  const [summary, setSummary] = useState<GuardianFinancialSummary | null>(null);
  const [items, setItems] = useState<GuardianCompromissoDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TableFilter>("all");
  const [empreendimento, setEmpreendimento] = useState<string | null>(null);
  const [term, setTerm] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await accessToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const [summaryRes, listRes] = await Promise.all([
        isAdmin
          ? fetch("/api/guardian/compromissos/summary", {
              cache: "no-store",
              headers,
            })
          : Promise.resolve(null),
        fetch("/api/guardian/compromissos/pending?status=all", {
          cache: "no-store",
          headers,
        }),
      ]);

      if (summaryRes) {
        const payload = (await summaryRes.json().catch(() => null)) as {
          data?: GuardianFinancialSummary;
        } | null;
        if (summaryRes.ok && payload?.data) {
          setSummary(payload.data);
          onPendingCount(payload.data.pendentes.count);
        }
      }

      const listPayload = (await listRes.json().catch(() => null)) as {
        data?: GuardianCompromissoDetail[];
      } | null;
      const all = listRes.ok ? listPayload?.data ?? [] : [];
      setItems(
        isAdmin
          ? all
          : all.filter((item) => item.createdByUserId === currentUserId),
      );
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, currentUserId, onPendingCount]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => statusCounts(items), [items]);

  function toggleFilter(next: TableFilter) {
    setFilter((current) => (current === next ? "all" : next));
  }

  return (
    <div className="flex flex-col gap-3.5">
      {isAdmin ? (
        <>
          <button
            type="button"
            onClick={onGoToApprovals}
            className="flex items-center justify-between rounded-lg border border-[#A07C3B]/35 bg-[#FFF9EF] dark:bg-[#A07C3B]/10 px-4 py-2.5 text-left transition-colors hover:bg-[#FCF3E2] dark:hover:bg-[#A07C3B]/15"
          >
            <span className="flex items-center gap-2 text-xs text-[#7A5E2C] dark:text-[#d9b877]">
              <Inbox className="size-4" aria-hidden="true" />
              Fila de aprovação:{" "}
              <strong className="font-semibold">
                {counts.pendente} pendente(s)
              </strong>{" "}
              aguardando decisão
            </span>
            <span className="flex items-center gap-1 text-xs font-semibold text-[#7A5E2C] dark:text-[#d9b877]">
              Abrir <ArrowRight className="size-3.5" aria-hidden="true" />
            </span>
          </button>

          {summary ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
              <KpiCard
                label="Em negociação"
                value={formatMoneyShort(summary.emNegociacao.value)}
                hint={`${summary.emNegociacao.count} acordos/promessas`}
                tone="gold"
                active={filter === "em_negociacao"}
                onClick={() => toggleFilter("em_negociacao")}
              />
              <KpiCard
                label="A receber (acordado)"
                value={formatMoneyShort(summary.aReceber.value)}
                hint={`${summary.aReceber.count} parcelas`}
                tone="blue"
                active={filter === "a_receber"}
                onClick={() => toggleFilter("a_receber")}
              />
              <KpiCard
                label="Recuperado (30d)"
                value={formatMoneyShort(summary.recuperado30d.value)}
                hint={`${summary.recuperado30d.count} parcelas pagas`}
                tone="green"
                active={filter === "recuperado"}
                onClick={() => toggleFilter("recuperado")}
              />
              <KpiCard
                label="Quebrado (30d)"
                value={formatMoneyShort(summary.quebrado30d.value)}
                hint={`${summary.quebrado30d.count} acordos`}
                tone="red"
                active={filter === "quebrado"}
                onClick={() => toggleFilter("quebrado")}
              />
              <KpiCard
                label="Cumprimento"
                value={`${summary.fulfillmentRate}%`}
                hint="previsibilidade"
                tone="neutral"
              />
            </div>
          ) : null}
        </>
      ) : null}

      <StatusCard
        counts={counts}
        active={filter}
        onSelect={toggleFilter}
      />

      {isAdmin && summary ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-line/70 bg-surface p-4">
            <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-sky-500/10 text-sky-600 ring-1 ring-sky-500/20 dark:bg-sky-500/12 dark:text-sky-300 dark:ring-sky-500/25">
                <TrendingUp className="size-3.5" aria-hidden="true" />
              </span>
              Previsibilidade
            </p>
            <div className="grid gap-2.5">
              <PrevisaoBar
                label="Próx. 7 dias"
                value={summary.previsao.d7}
                max={Math.max(summary.previsao.d7, summary.previsao.d15, summary.previsao.d30, 1)}
              />
              <PrevisaoBar
                label="8–15 dias"
                value={summary.previsao.d15}
                max={Math.max(summary.previsao.d7, summary.previsao.d15, summary.previsao.d30, 1)}
              />
              <PrevisaoBar
                label="16–30 dias"
                value={summary.previsao.d30}
                max={Math.max(summary.previsao.d7, summary.previsao.d15, summary.previsao.d30, 1)}
              />
            </div>
            <div className="mt-3 flex items-baseline justify-between border-t border-line/70 pt-2.5">
              <span className="text-xs text-ink-muted">A vencer (30d)</span>
              <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                {formatMoney(summary.previsao.total)}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-line/70 bg-surface p-4">
            <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[#A07C3B]/10 text-[#A07C3B] ring-1 ring-[#A07C3B]/20 dark:text-[#d9b877] dark:ring-[#A07C3B]/30">
                <Building2 className="size-3.5" aria-hidden="true" />
              </span>
              Por empreendimento
            </p>
            {summary.porEmpreendimento.length === 0 ? (
              <p className="px-1 py-3 text-xs text-ink-muted">
                Sem propostas registradas ainda.
              </p>
            ) : (
              <div className="grid gap-3">
                {summary.porEmpreendimento.map((entry) => (
                  <EmpreendimentoRow
                    key={entry.empreendimento}
                    entry={entry}
                    active={empreendimento === entry.empreendimento}
                    onClick={() =>
                      setEmpreendimento((current) =>
                        current === entry.empreendimento
                          ? null
                          : entry.empreendimento,
                      )
                    }
                  />
                ))}
                <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-ink-muted">
                  <Legend color={GOLD} label="em negociação" />
                  <Legend color="#378ADD" label="promessa" />
                  <Legend color="#1D9E75" label="recuperado" />
                  <Legend color="#E24B4A" label="quebrado" />
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <ProposalsTable
        items={items}
        loading={loading}
        filter={filter}
        empreendimento={empreendimento}
        term={term}
        onTerm={setTerm}
        onChanged={load}
        onClearFilter={() => {
          setFilter("all");
          setEmpreendimento(null);
          setTerm("");
        }}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "gold" | "blue" | "green" | "red" | "neutral";
  active?: boolean;
  onClick?: () => void;
}) {
  const tones: Record<typeof tone, { bg: string; label: string; ring: string; value: string }> = {
    blue: { bg: "bg-[#E6F1FB] dark:bg-[#5b8def]/12", label: "text-[#185FA5] dark:text-[#8fb4f0]", ring: "ring-[#185FA5] dark:ring-[#5b8def]", value: "text-[#0C447C] dark:text-[#b9d2f5]" },
    gold: { bg: "bg-[#A07C3B]/8", label: "text-[#7A5E2C] dark:text-[#d9b877]", ring: "ring-[#A07C3B]", value: "text-[#7A5E2C] dark:text-[#d9b877]" },
    green: { bg: "bg-[#E1F5EE] dark:bg-[#3fae74]/12", label: "text-[#0F6E56] dark:text-[#5fc79a]", ring: "ring-[#0F6E56] dark:ring-[#3fae74]", value: "text-[#0F6E56] dark:text-[#8adcb8]" },
    neutral: { bg: "bg-subtle/80", label: "text-ink-muted", ring: "ring-line", value: "text-ink" },
    red: { bg: "bg-[#FCEBEB] dark:bg-[#e0655a]/12", label: "text-[#A32D2D] dark:text-[#eb8a82]", ring: "ring-[#A32D2D] dark:ring-[#e0655a]", value: "text-[#A32D2D] dark:text-[#f0a59e]" },
  };
  const style = tones[tone];
  const interactive = Boolean(onClick);

  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={onClick}
      className={`min-w-0 rounded-lg ${style.bg} px-3 py-2.5 text-left transition ${
        interactive ? "cursor-pointer hover:brightness-95" : "cursor-default"
      } ${active ? `ring-2 ${style.ring}` : ""}`}
    >
      <p className={`truncate text-[11px] ${style.label}`}>{label}</p>
      <p className={`mt-0.5 truncate text-xl font-semibold ${style.value}`}>
        {value}
      </p>
      <p className="truncate text-[10px] text-ink-muted">{hint}</p>
    </button>
  );
}

function StatusCard({
  counts,
  active,
  onSelect,
}: {
  counts: ReturnType<typeof statusCounts>;
  active: TableFilter;
  onSelect: (filter: TableFilter) => void;
}) {
  const stats: { filter: TableFilter; label: string; value: number; tone: string }[] = [
    { filter: "pendente", label: "Em aprovação", tone: "text-blue-700 dark:text-[#8fb4f0]", value: counts.pendente },
    { filter: "aprovado", label: "Aprovadas", tone: "text-emerald-700 dark:text-emerald-300", value: counts.aprovado },
    { filter: "reprovado", label: "Reprovadas", tone: "text-rose-700 dark:text-rose-300", value: counts.reprovado },
    { filter: "em_elaboracao", label: "Em elaboração", tone: "text-ink-soft", value: counts.em_elaboracao },
  ];

  return (
    <div className="grid gap-2 rounded-xl border border-line/70 bg-surface p-3 sm:grid-cols-[160px_minmax(0,1fr)]">
      <button
        type="button"
        onClick={() => onSelect("all")}
        className={`rounded-lg bg-[#A07C3B]/8 px-3 py-2.5 text-left transition hover:brightness-95 ${
          active === "all" ? "ring-2 ring-[#A07C3B]" : ""
        }`}
      >
        <p className="text-[11px] text-[#7A5E2C] dark:text-[#d9b877]">Total de propostas</p>
        <p className="mt-0.5 text-2xl font-semibold text-[#7A5E2C] dark:text-[#d9b877]">{counts.total}</p>
      </button>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((stat) => (
          <button
            key={stat.filter}
            type="button"
            onClick={() => onSelect(stat.filter)}
            className={`rounded-lg bg-subtle/80 px-3 py-2 text-left transition hover:bg-subtle ${
              active === stat.filter ? "ring-2 ring-line" : ""
            }`}
          >
            <p className={`text-lg font-semibold ${stat.tone}`}>{stat.value}</p>
            <p className="truncate text-[11px] text-ink-muted">{stat.label}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function PrevisaoBar({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-ink-muted">{label}</span>
        <span className="text-ink">{formatMoney(value)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-subtle">
        <div
          className="h-1.5 rounded-full bg-sky-500"
          style={{ width: `${Math.round((value / max) * 100)}%` }}
        />
      </div>
    </div>
  );
}

function EmpreendimentoRow({
  entry,
  active,
  onClick,
}: {
  entry: GuardianFinancialSummary["porEmpreendimento"][number];
  active: boolean;
  onClick: () => void;
}) {
  const total =
    entry.acordo + entry.promessa + entry.recuperado + entry.quebrado || 1;
  const seg = (value: number) => `${Math.round((value / total) * 100)}%`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full rounded-lg p-1 text-left transition ${
        active ? "bg-[#A07C3B]/5 ring-1 ring-[#A07C3B]/30" : "hover:bg-subtle"
      }`}
    >
      <div className="mb-1 flex justify-between text-xs">
        <span className="font-semibold text-ink">{entry.empreendimento}</span>
        <span className="text-ink-muted">
          {formatMoneyShort(entry.acordo + entry.promessa)} em neg.
        </span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-subtle">
        <div style={{ background: GOLD, width: seg(entry.acordo) }} />
        <div style={{ background: "#378ADD", width: seg(entry.promessa) }} />
        <div style={{ background: "#1D9E75", width: seg(entry.recuperado) }} />
        <div style={{ background: "#E24B4A", width: seg(entry.quebrado) }} />
      </div>
    </button>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block size-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

// ============================ TABELA DE PROPOSTAS ============================

function ProposalsTable({
  items,
  loading,
  filter,
  empreendimento,
  term,
  onTerm,
  onClearFilter,
  onChanged,
}: {
  items: GuardianCompromissoDetail[];
  loading: boolean;
  filter: TableFilter;
  empreendimento: string | null;
  term: string;
  onTerm: (value: string) => void;
  onClearFilter: () => void;
  onChanged: () => void;
}) {
  const filtered = useMemo(
    () =>
      items.filter((item) => {
        if (!tablePredicate(item, filter)) return false;
        if (
          empreendimento &&
          compromissoEmpreendimento(item.metadata) !== empreendimento
        )
          return false;
        if (!matchesTerm(item, term)) return false;
        return true;
      }),
    [items, filter, empreendimento, term],
  );
  const hasFilter = filter !== "all" || Boolean(empreendimento) || Boolean(term.trim());
  const [openId, setOpenId] = useState<string | null>(null);
  const openItem = filtered.find((item) => item.id === openId) ?? null;

  return (
    <div className="rounded-xl border border-line/70 bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <div className="relative flex-1 min-w-48">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden="true"
          />
          <input
            value={term}
            onChange={(event) => onTerm(event.target.value)}
            placeholder="Buscar cliente, protocolo, operador, empreendimento ou unidade"
            className="h-9 w-full rounded-lg border border-line/70 bg-surface pl-9 pr-3 text-sm text-ink outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
          />
        </div>
        {hasFilter ? (
          <button
            type="button"
            onClick={onClearFilter}
            className="inline-flex h-8 items-center gap-1 rounded-full bg-[#A07C3B]/10 px-3 text-xs font-semibold text-[#7A5E2C] dark:text-[#d9b877] hover:bg-[#A07C3B]/15"
          >
            {empreendimento ?? FILTER_LABELS[filter]}
            <X className="size-3" aria-hidden="true" />
          </button>
        ) : null}
        <span className="ml-auto text-xs text-ink-muted">
          {filtered.length} proposta(s)
        </span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 px-4 py-8 text-sm text-ink-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Carregando propostas...
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-ink-muted">
          Nenhuma proposta encontrada.
        </div>
      ) : (
        <div className="divide-y divide-line">
          <div className="hidden grid-cols-[minmax(0,1.5fr)_80px_minmax(0,1.1fr)_88px_88px_100px_104px_92px_36px] gap-3 px-4 py-2 text-[11px] font-semibold text-ink-muted xl:grid">
            <span>Cliente</span>
            <span>Tipo</span>
            <span>Empreendimento</span>
            <span>Vencimento</span>
            <span>Pagamento</span>
            <span className="text-right">Valor</span>
            <span>Status</span>
            <span>Execução</span>
            <span />
          </div>
          {filtered.map((item) => (
            <ProposalTableRow
              key={item.id}
              item={item}
              onOpen={() => setOpenId(item.id)}
            />
          ))}
        </div>
      )}
      {openItem ? (
        <ProposalDetailModal
          item={openItem}
          onClose={() => setOpenId(null)}
          onDeleted={onChanged}
        />
      ) : null}
    </div>
  );
}

function ProposalTableRow({
  item,
  onOpen,
}: {
  item: GuardianCompromissoDetail;
  onOpen: () => void;
}) {
  const isAcordo = item.kind === "acordo";
  const clientName = metaString(item.metadata, "client_name") ?? "Cliente C2X";
  const operator = metaString(item.metadata, "submitted_by_name");
  const unidade = contractMatriculas(item.metadata)[0] ?? null;
  const status = statusBadge(item.approvalStatus);
  const exec = proposalExecution(item);
  const novidade = hasProposalUpdate(item);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen();
      }}
      className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle xl:grid-cols-[minmax(0,1.5fr)_80px_minmax(0,1.1fr)_88px_88px_100px_104px_92px_36px]"
    >
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          {novidade ? (
            <Tooltip content="Novidade nesta proposta" placement="top">
              <span className="size-2 shrink-0 rounded-full bg-[#A07C3B]" />
            </Tooltip>
          ) : null}
          <span className="truncate">{clientName}</span>
        </span>
        <span className="block truncate text-[11px] text-ink-muted">
          {operator ? `${operator} · ` : ""}
          {item.protocol}
        </span>
        <span className="block truncate text-[11px] text-ink-muted xl:hidden">
          {isAcordo ? "Acordo" : "Promessa"} · {formatMoney(item.totalAmount)}
        </span>
      </span>
      <span className="hidden text-xs text-ink-soft xl:block">
        {isAcordo ? "Acordo" : "Promessa"}
      </span>
      <span className="hidden min-w-0 xl:block">
        <span className="block truncate text-xs text-ink-soft">
          {compromissoEmpreendimento(item.metadata)}
        </span>
        {unidade ? (
          <span className="block truncate text-[11px] text-ink-muted">{unidade}</span>
        ) : null}
      </span>
      <span className="hidden text-xs text-ink-soft xl:block">
        {exec.dueDate ? formatBrDate(exec.dueDate) : "—"}
      </span>
      <span className="hidden text-xs text-ink-soft xl:block">
        {exec.paidDate ? formatDateOnly(exec.paidDate) : "—"}
      </span>
      <span className="hidden text-right text-sm font-semibold text-ink xl:block">
        {formatMoney(item.totalAmount)}
      </span>
      <span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${status.cls}`}
        >
          {status.label}
        </span>
      </span>
      <span className="hidden xl:block">
        {exec.status ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${exec.status.cls}`}
          >
            {exec.status.label}
          </span>
        ) : (
          <span className="text-[11px] text-ink-muted">—</span>
        )}
      </span>
      <span className="hidden justify-end xl:flex">
        <Tooltip content="Abrir propostas do cliente" placement="left">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openClientDetail(item);
            }}
            aria-label="Abrir propostas do cliente"
            className="flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C] dark:text-[#d9b877]"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </button>
        </Tooltip>
      </span>
    </div>
  );
}

function ProposalDetailModal({
  item,
  onClose,
  onDeleted,
}: {
  item: GuardianCompromissoDetail;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const isAcordo = item.kind === "acordo";
  const clientName = metaString(item.metadata, "client_name") ?? "Cliente C2X";
  const operator = metaString(item.metadata, "submitted_by_name");
  const status = statusBadge(item.approvalStatus);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    const reason = window.prompt(
      `Motivo da exclusão da proposta ${item.protocol} (obrigatório):`,
    );
    if (!reason || !reason.trim()) {
      return;
    }
    setBusy(true);
    const ok = await deleteProposal(item, reason.trim());
    setBusy(false);
    if (ok) {
      onDeleted();
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
      />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line/70 bg-surface shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                isAcordo
                  ? "bg-[#A07C3B]/8 text-[#7A5E2C] dark:text-[#d9b877] ring-[#A07C3B]/15"
                  : "bg-subtle text-ink ring-line"
              }`}
            >
              {isAcordo ? "Acordo" : "Promessa"}
            </span>
            <span className="rounded-full bg-[#A07C3B]/5 px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] dark:text-[#d9b877] ring-1 ring-inset ring-[#A07C3B]/15">
              {item.protocol}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${status.cls}`}
            >
              {status.label}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip content="Abrir propostas do cliente" placement="bottom">
              <button
                type="button"
                onClick={() => openClientDetail(item)}
                aria-label="Abrir propostas do cliente"
                className="flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-[#7A5E2C] dark:text-[#d9b877]"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip content="Editar no cliente" placement="bottom">
              <button
                type="button"
                onClick={() => editProposalInClient(item)}
                aria-label="Editar no cliente"
                className="flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-[#7A5E2C] dark:text-[#d9b877]"
              >
                <Pencil className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip content="Excluir proposta" placement="bottom">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDelete()}
                aria-label="Excluir proposta"
                className="flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-rose-50 dark:bg-rose-500/12 hover:text-rose-600 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="size-4" aria-hidden="true" />
                )}
              </button>
            </Tooltip>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-subtle"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="border-b border-line px-5 py-2 text-xs text-ink-muted">
          <span className="font-semibold text-ink">{clientName}</span>
          {operator ? ` · enviado por ${operator}` : ""} ·{" "}
          {formatWhen(item.submittedAt ?? item.createdAt)}
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            {isAcordo ? (
              <AcordoBreakdown item={item} />
            ) : (
              <PromessaBreakdown item={item} />
            )}
            {item.notes ? (
              <div className="rounded-lg bg-subtle/70 px-3 py-2">
                <p className="text-[10px] font-semibold text-ink-muted">Observação</p>
                <p className="mt-0.5 text-xs text-ink-soft">{item.notes}</p>
              </div>
            ) : null}
            {item.approvalReason ? (
              <div className="rounded-lg bg-subtle/70 px-3 py-2">
                <p className="text-[10px] font-semibold text-ink-muted">
                  Decisão do gestor
                </p>
                <p className="mt-0.5 text-xs text-ink-soft">{item.approvalReason}</p>
              </div>
            ) : null}
          </div>
          <ProposalChat compromissoId={item.id} />
        </div>
      </div>
    </div>
  );
}

// ============================ APROVAÇÕES ============================

function ApprovalsTab({
  isAdmin,
  onPendingCount,
}: {
  isAdmin: boolean;
  onPendingCount: (count: number) => void;
}) {
  const [items, setItems] = useState<GuardianCompromissoDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [term, setTerm] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await accessToken();
      const response = await fetch(
        "/api/guardian/compromissos/pending?status=pendente",
        {
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        data?: GuardianCompromissoDetail[];
      } | null;
      const data = payload?.data ?? [];
      setItems(data);
      onPendingCount(data.length);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [onPendingCount]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => items.filter((item) => matchesTerm(item, term)),
    [items, term],
  );
  const selected =
    filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  function handleDecided(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
    setSelectedId(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          aria-hidden="true"
        />
        <input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Buscar cliente, protocolo, operador, empreendimento ou unidade"
          className="h-9 w-full rounded-lg border border-line/70 bg-surface pl-9 pr-3 text-sm text-ink outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="lg:border-r lg:border-[#edf1f5] lg:pr-3">
          {loading ? (
            <div className="flex items-center gap-2 px-1 py-8 text-sm text-ink-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Carregando...
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-1 py-10 text-center text-sm text-ink-muted">
              Nenhuma proposta pendente.
            </div>
          ) : (
            <div className="flex max-h-[calc(100dvh-22rem)] flex-col gap-2 overflow-y-auto pr-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
              {filtered.map((item) => (
                <ProposalQueueRow
                  key={item.id}
                  item={item}
                  active={item.id === selected?.id}
                  onSelect={() => setSelectedId(item.id)}
                />
              ))}
            </div>
          )}
        </div>

        <div>
          {selected ? (
            <ProposalDecisionPanel
              key={selected.id}
              item={selected}
              isAdmin={isAdmin}
              onDecided={() => handleDecided(selected.id)}
            />
          ) : (
            <div className="flex h-full min-h-48 items-center justify-center rounded-xl border border-dashed border-line/80 bg-subtle/60 px-4 py-10 text-center text-sm text-ink-muted">
              Selecione uma proposta para revisar.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProposalQueueRow({
  item,
  active,
  onSelect,
}: {
  item: GuardianCompromissoDetail;
  active: boolean;
  onSelect: () => void;
}) {
  const isAcordo = item.kind === "acordo";
  const clientName = metaString(item.metadata, "client_name") ?? "Cliente C2X";
  const submittedBy = metaString(item.metadata, "submitted_by_name");
  const risk = riskHeuristic(item);
  const novidade = hasProposalUpdate(item);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border px-3 py-2.5 text-left transition focus:outline-none focus:ring-2 focus:ring-[#A07C3B]/25 ${
        active
          ? "border-[#A07C3B]/45 bg-[#FFF9EF] dark:bg-[#A07C3B]/10"
          : "border-[#edf1f5] bg-surface hover:border-[#d9e0e7] hover:bg-subtle"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink">
          {novidade ? (
            <span
              className="size-2 shrink-0 rounded-full bg-[#A07C3B]"
              title="Novidade nesta proposta"
            />
          ) : null}
          <span className="truncate">{clientName}</span>
        </span>
        <RiskPill risk={risk} />
      </div>
      <p className="mt-1 flex items-center justify-between gap-2 text-[11px] text-ink-muted">
        <span className="truncate">
          {isAcordo ? "Acordo" : "Promessa"} · {item.protocol}
          {submittedBy ? ` · ${submittedBy}` : ""}
        </span>
        <span className="shrink-0 font-semibold text-ink">
          {formatMoney(item.totalAmount)}
        </span>
      </p>
    </button>
  );
}

function ProposalDecisionPanel({
  item,
  isAdmin,
  onDecided,
}: {
  item: GuardianCompromissoDetail;
  isAdmin: boolean;
  onDecided: () => void;
}) {
  const isAcordo = item.kind === "acordo";
  const clientName = metaString(item.metadata, "client_name") ?? "Cliente C2X";
  const submittedBy = metaString(item.metadata, "submitted_by_name");
  const contract = contractFrom(item.metadata);
  const risk = riskHeuristic(item);

  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<null | "reprovado" | "devolvido">(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  async function decide(decision: CompromissoDecision, motive?: string) {
    setBusy(true);
    setActionError(null);
    try {
      const token = await accessToken();
      const response = await fetch(
        `/api/guardian/compromissos/${item.id}/approval`,
        {
          body: JSON.stringify({ decision, reason: motive }),
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          method: "PATCH",
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Falha ao decidir.");
      }
      onDecided();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Falha ao decidir.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line/70 bg-surface p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
              isAcordo
                ? "bg-[#A07C3B]/8 text-[#7A5E2C] dark:text-[#d9b877] ring-[#A07C3B]/15"
                : "bg-subtle text-ink ring-line"
            }`}
          >
            {isAcordo ? "Acordo" : "Promessa"}
          </span>
          <span className="rounded-full bg-[#A07C3B]/5 px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] dark:text-[#d9b877] ring-1 ring-inset ring-[#A07C3B]/15">
            {item.protocol}
          </span>
        </div>
        <RiskPill risk={risk} />
      </div>

      <div>
        <p className="text-sm font-semibold text-ink">{clientName}</p>
        <p className="text-[11px] text-ink-muted">
          <Send className="mr-1 inline size-3 align-[-1px]" aria-hidden="true" />
          {submittedBy ? `enviado por ${submittedBy} · ` : ""}
          {formatWhen(item.submittedAt ?? item.createdAt)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-subtle/80 px-2.5 py-2">
          <p className="text-[10px] text-ink-muted">Contrato</p>
          <p className="truncate text-xs text-ink">
            {contract.empreendimento}
            {contract.matriculas ? ` · ${contract.matriculas}` : ""}
          </p>
          <button
            type="button"
            onClick={() =>
              contract.contractDocumentId
                ? void openHadesContract(contract.contractDocumentId)
                : openClientDetail(item)
            }
            className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 dark:text-sky-300 hover:underline"
          >
            <FileText className="size-3" aria-hidden="true" /> ver contrato
          </button>
        </div>
        <div className="rounded-lg bg-subtle/80 px-2.5 py-2">
          <p className="text-[10px] text-ink-muted">Em atraso</p>
          <p className="text-xs text-ink">
            {contract.parcelasVencidas ?? "—"} parcelas
            {contract.atrasoDias ? ` · ${contract.atrasoDias}d` : ""}
          </p>
          {contract.saldoDevedor ? (
            <p className="text-[11px] text-rose-700 dark:text-rose-300">saldo {contract.saldoDevedor}</p>
          ) : null}
        </div>
      </div>

      {isAcordo ? <AcordoBreakdown item={item} /> : <PromessaBreakdown item={item} />}

      {item.notes ? (
        <p className="rounded-lg bg-subtle/70 px-3 py-2 text-xs text-ink-soft">
          {item.notes}
        </p>
      ) : null}

      {risk.reason ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-[#FAEEDA]/70 dark:bg-amber-500/12 px-3 py-2 text-[11px] text-[#854F0B] dark:text-amber-300">
          <ChartBar className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold">Risco (regra):</span> {risk.reason}
          </span>
        </p>
      ) : null}

      {isAdmin ? (
        mode ? (
          <div className="rounded-lg border border-line/70 bg-subtle/60 p-3">
            <p className="mb-1.5 text-xs font-semibold text-ink">
              Motivo da {mode === "reprovado" ? "reprovação" : "devolução"}{" "}
              (obrigatório)
            </p>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                mode === "reprovado"
                  ? "Por que está reprovando..."
                  : "O que o operador precisa ajustar..."
              }
              className="min-h-16 w-full resize-none rounded-lg border border-line/70 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode(null);
                  setReason("");
                }}
                className="inline-flex h-8 items-center rounded-lg border border-line/70 bg-surface px-3 text-xs font-medium text-ink hover:bg-subtle"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy || !reason.trim()}
                onClick={() => void decide(mode, reason.trim())}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                  mode === "reprovado"
                    ? "bg-rose-600 hover:bg-rose-700"
                    : "bg-amber-600 hover:bg-amber-700"
                }`}
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : null}
                Confirmar {mode === "reprovado" ? "reprovação" : "devolução"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide("aprovado")}
              className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck className="size-4" aria-hidden="true" />
              )}
              Aprovar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode("reprovado")}
              className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-rose-200 dark:border-rose-500/25 px-3 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-50 dark:bg-rose-500/12 disabled:opacity-50"
            >
              <X className="size-4" aria-hidden="true" />
              Reprovar
            </button>
            <Tooltip content="Devolver para ajuste" placement="left">
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode("devolvido")}
                aria-label="Devolver para ajuste"
                className="flex size-9 items-center justify-center rounded-lg border border-line/70 text-ink-muted transition-colors hover:bg-subtle hover:text-amber-700 dark:text-amber-300 disabled:opacity-50"
              >
                <Undo2 className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        )
      ) : (
        <p className="flex items-center gap-1.5 rounded-lg bg-subtle/70 px-3 py-2 text-[11px] text-ink-muted">
          <Lock className="size-3.5" aria-hidden="true" />
          Aguardando decisão do Admin. Você pode conversar abaixo.
        </p>
      )}

      {actionError ? (
        <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">{actionError}</p>
      ) : null}

      <ProposalChat
        compromissoId={item.id}
        heading="Conversa com o operador"
        placeholder="Responder o operador..."
        note={
          submittedBy ? (
            <span className="rounded-full bg-emerald-50 dark:bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
              {submittedBy}
            </span>
          ) : undefined
        }
      />
    </div>
  );
}

// ============================ breakdown (financeiro) ============================

function AcordoBreakdown({ item }: { item: GuardianCompromissoDetail }) {
  const meta = item.metadata;
  const original = metaNumber(meta, "original_amount");
  const discount = metaComputed(meta, "discount");
  const interest = metaComputed(meta, "interest");
  const fine = metaComputed(meta, "fine");
  const paymentMode = meta.payment_mode === "a_vista" ? "À vista" : "Parcelado";
  const entry = metaEntryAmount(meta);

  return (
    <div className="rounded-lg bg-subtle/70 px-3 py-2.5">
      <Line label="Valor original" value={formatMoney(original ?? item.totalAmount)} />
      {discount ? (
        <Line label="Desconto" value={`− ${formatMoney(discount)}`} tone="danger" />
      ) : null}
      {interest || fine ? (
        <Line
          label="Juros + multa"
          value={`+ ${formatMoney((interest ?? 0) + (fine ?? 0))}`}
          tone="success"
        />
      ) : null}
      <div className="mt-1 flex items-center justify-between border-t border-line/70 pt-1.5 text-sm font-semibold">
        <span className="text-[#7A5E2C] dark:text-[#d9b877]">Valor do acordo</span>
        <span className="text-[#7A5E2C] dark:text-[#d9b877]">{formatMoney(item.totalAmount)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-ink-muted">
        <span>
          {paymentMode}
          {entry ? ` · entrada ${formatMoney(entry)}` : ""}
        </span>
        <span>{item.installmentsCount} parcela(s)</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {item.parcelas.map((parcela) => (
          <span
            key={parcela.id}
            className="rounded-md border border-line/70 bg-surface px-2 py-1 text-[11px] text-ink-soft"
          >
            {parcela.sequence}/{item.installmentsCount} ·{" "}
            {formatBrDate(parcela.dueDate)} · {formatMoney(parcela.amount)}
          </span>
        ))}
      </div>
    </div>
  );
}

function PromessaBreakdown({ item }: { item: GuardianCompromissoDetail }) {
  return (
    <div className="rounded-lg bg-subtle/70 px-3 py-2.5">
      <Line label="Valor prometido" value={formatMoney(item.totalAmount)} />
      <Line label="Nova data" value={formatBrDate(item.promisedDate)} />
    </div>
  );
}

function Line({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger" | "success";
}) {
  return (
    <div className="flex items-center justify-between py-0.5 text-xs">
      <span className="text-ink-muted">{label}</span>
      <span
        className={
          tone === "danger"
            ? "text-rose-600"
            : tone === "success"
              ? "text-emerald-600"
              : "text-ink"
        }
      >
        {value}
      </span>
    </div>
  );
}

// ============================ risco (heurística explicável) ============================

type Risk = { pct: number; tone: "low" | "mid" | "high"; reason: string };

function riskHeuristic(item: GuardianCompromissoDetail): Risk {
  const contract = contractFrom(item.metadata);
  const score = contract.scoreRiscoNum;
  const discount = metaComputed(item.metadata, "discount") ?? 0;
  const original = metaNumber(item.metadata, "original_amount") ?? item.totalAmount;
  const discountPct = original > 0 ? (discount / original) * 100 : 0;

  let pct = score ?? Math.min(95, Math.round((contract.atrasoDias ?? 0) / 10));
  const reasons: string[] = [];
  if (score != null) reasons.push(`score C2X ${score}`);
  if (contract.atrasoDias) reasons.push(`${contract.atrasoDias}d de atraso`);
  if (discountPct >= 15) {
    pct = Math.min(99, pct + 10);
    reasons.push(`desconto ${Math.round(discountPct)}%`);
  }
  pct = Math.max(0, Math.min(99, pct));

  const tone: Risk["tone"] = pct >= 60 ? "high" : pct >= 35 ? "mid" : "low";
  return { pct, reason: reasons.join(" · "), tone };
}

function RiskPill({ risk }: { risk: Risk }) {
  const styles: Record<Risk["tone"], string> = {
    high: "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/25",
    low: "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-100 dark:ring-emerald-500/25",
    mid: "bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-amber-100 dark:ring-amber-500/25",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${styles[risk.tone]}`}
    >
      risco {risk.pct}%
    </span>
  );
}

// ============================ helpers ============================

function statusCounts(items: GuardianCompromissoDetail[]) {
  return {
    aprovado: items.filter((item) => item.approvalStatus === "aprovado").length,
    em_elaboracao: items.filter((item) => item.approvalStatus === "em_elaboracao")
      .length,
    pendente: items.filter((item) => item.approvalStatus === "pendente").length,
    reprovado: items.filter((item) => item.approvalStatus === "reprovado").length,
    total: items.length,
  };
}

function statusBadge(status: GuardianApprovalStatus): { cls: string; label: string } {
  switch (status) {
    case "aprovado":
      return { cls: "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-100 dark:ring-emerald-500/25", label: "Aprovada" };
    case "reprovado":
      return { cls: "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/25", label: "Reprovada" };
    case "em_elaboracao":
      return { cls: "bg-subtle text-ink-soft ring-line", label: "Em elaboração" };
    default:
      return { cls: "bg-blue-50 text-blue-700 ring-blue-100 dark:bg-[#5b8def]/12 dark:text-[#8fb4f0] dark:ring-[#5b8def]/25", label: "Em aprovação" };
  }
}

function tablePredicate(item: GuardianCompromissoDetail, filter: TableFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "pendente":
    case "aprovado":
    case "reprovado":
    case "em_elaboracao":
      return item.approvalStatus === filter;
    case "em_negociacao":
      return (
        item.status === "ativo" &&
        (item.approvalStatus === "pendente" || item.approvalStatus === "aprovado")
      );
    case "a_receber":
      return item.approvalStatus === "aprovado" && item.status === "ativo";
    case "recuperado":
      return item.parcelas.some((parcela) => parcela.status === "paga");
    case "quebrado":
      return item.status === "quebrado";
    default:
      return true;
  }
}

function matchesTerm(item: GuardianCompromissoDetail, term: string): boolean {
  const value = term.trim().toLowerCase();
  if (!value) return true;
  const haystack = [
    metaString(item.metadata, "client_name"),
    item.protocol,
    metaString(item.metadata, "submitted_by_name"),
    compromissoEmpreendimento(item.metadata),
    ...contractMatriculas(item.metadata),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(value);
}

function openClientDetail(item: GuardianCompromissoDetail) {
  // Mesma aba: o botao "Voltar a Central de Propostas" leva de volta (e o voltar
  // do navegador tambem).
  window.location.assign(
    `/hades/cobranca?clientId=${item.clientC2xId}&tab=propostas`,
  );
}

// Editar = abre o cliente na aba Propostas JA com o modal de edicao daquela
// proposta aberto (via ?editProposal=<id>).
function editProposalInClient(item: GuardianCompromissoDetail) {
  window.location.assign(
    `/hades/cobranca?clientId=${item.clientC2xId}&tab=propostas&editProposal=${item.id}`,
  );
}

async function deleteProposal(
  item: GuardianCompromissoDetail,
  reason: string,
): Promise<boolean> {
  const token = await accessToken();
  const response = await fetch(`/api/guardian/compromissos/${item.id}`, {
    body: JSON.stringify({ reason }),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method: "DELETE",
  });
  return response.ok;
}

// Abre o contrato assinado (D4Sign) direto: a rota devolve o PDF (Bearer), entao
// baixamos o blob e abrimos num popup — sem passar pela tela do cliente.
async function openHadesContract(documentId: string) {
  const popup = window.open("about:blank", "_blank");
  if (popup) {
    popup.document.write(
      '<!doctype html><meta charset="utf-8"><title>Carregando contrato…</title><body style="margin:0;display:flex;height:100vh;align-items:center;justify-content:center;font-family:system-ui;color:#101820">Carregando contrato…</body>',
    );
    popup.document.close();
  }
  try {
    const token = await accessToken();
    const response = await fetch(
      `/api/hades/d4sign/contracts/${encodeURIComponent(documentId)}`,
      {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
    );
    if (!response.ok) {
      throw new Error("falha ao abrir o contrato");
    }
    const url = URL.createObjectURL(await response.blob());
    if (popup) {
      popup.location.href = url;
    } else {
      window.open(url, "_blank", "noreferrer");
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    popup?.close();
  }
}

function contractMatriculas(metadata: Record<string, unknown>): string[] {
  const contract = metadata.contract;
  if (contract && typeof contract === "object") {
    const value = (contract as Record<string, unknown>).matriculas;
    if (Array.isArray(value)) {
      return value.filter((m): m is string => typeof m === "string" && Boolean(m));
    }
  }
  return [];
}

type ContractInfo = {
  atrasoDias: number | null;
  contractDocumentId: string | null;
  empreendimento: string;
  matriculas: string;
  parcelasVencidas: number | null;
  saldoDevedor: string | null;
  scoreRiscoNum: number | null;
};

function contractFrom(metadata: Record<string, unknown>): ContractInfo {
  const raw =
    metadata.contract && typeof metadata.contract === "object"
      ? (metadata.contract as Record<string, unknown>)
      : {};
  const matriculas = Array.isArray(raw.matriculas)
    ? raw.matriculas.filter((m): m is string => typeof m === "string").join(", ")
    : "";
  return {
    atrasoDias: numberOrNull(raw.atrasoDias),
    contractDocumentId:
      typeof raw.contractDocumentId === "string" && raw.contractDocumentId
        ? raw.contractDocumentId
        : null,
    empreendimento: compromissoEmpreendimento(metadata),
    matriculas,
    parcelasVencidas: numberOrNull(raw.parcelasVencidas),
    saldoDevedor: typeof raw.saldoDevedor === "string" ? raw.saldoDevedor : null,
    scoreRiscoNum: numberOrNull(raw.scoreRisco),
  };
}

function compromissoEmpreendimento(metadata: Record<string, unknown>): string {
  const direct = metadata.empreendimento;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const contract = metadata.contract;
  if (contract && typeof contract === "object") {
    const value = (contract as Record<string, unknown>).empreendimento;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Sem empreendimento";
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function accessToken() {
  const supabase = getHubSupabaseClient();
  const session = await supabase?.auth.getSession();
  return session?.data.session?.access_token ?? "";
}

function metaString(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metaNumber(meta: Record<string, unknown>, key: string): number | null {
  const value = Number(meta[key]);
  return Number.isFinite(value) ? value : null;
}

function metaComputed(meta: Record<string, unknown>, key: string): number | null {
  const value = meta[key];
  if (value && typeof value === "object") {
    const computed = Number((value as Record<string, unknown>).computed);
    return Number.isFinite(computed) && computed !== 0 ? computed : null;
  }
  return null;
}

function metaEntryAmount(meta: Record<string, unknown>): number | null {
  const entry = meta.entry;
  if (entry && typeof entry === "object") {
    const amount = Number((entry as Record<string, unknown>).amount);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }
  return null;
}

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

function formatMoneyShort(value: number) {
  if (Math.abs(value) >= 1000000) {
    return `R$ ${(value / 1000000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  }
  if (Math.abs(value) >= 1000) {
    return `R$ ${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  }
  return formatMoney(value);
}

function formatBrDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value ?? "-";
  }
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatDateOnly(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// Execucao da proposta (2o status): so para acordo/promessa APROVADO. Antes
// disso (em negociacao/pendente) nao tem nada. Vencimento = proxima parcela em
// aberto; Pagamento = ultima parcela paga.
function proposalExecution(item: GuardianCompromissoDetail): {
  dueDate: string | null;
  paidDate: string | null;
  status: { cls: string; label: string } | null;
} {
  if (item.approvalStatus !== "aprovado" || item.parcelas.length === 0) {
    return { dueDate: null, paidDate: null, status: null };
  }

  const today = new Date().toISOString().slice(0, 10);
  const unpaid = item.parcelas.filter((parcela) => parcela.status !== "paga");
  const paid = item.parcelas.filter((parcela) => parcela.status === "paga");
  const allPaid = unpaid.length === 0;
  const overdue = unpaid.some((parcela) => parcela.dueDate < today);
  const nextDue =
    [...unpaid].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]?.dueDate ??
    null;
  const lastDue =
    [...item.parcelas].sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0]
      ?.dueDate ?? null;
  const lastPaid =
    paid
      .map((parcela) => parcela.paidAt)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => b.localeCompare(a))[0] ?? null;

  const status = allPaid
    ? { cls: "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-100 dark:ring-emerald-500/25", label: "Liquidada" }
    : overdue
      ? { cls: "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/25", label: "Vencida" }
      : { cls: "bg-blue-50 text-blue-700 ring-blue-100 dark:bg-[#5b8def]/12 dark:text-[#8fb4f0] dark:ring-[#5b8def]/25", label: "A vencer" };

  return { dueDate: allPaid ? lastDue : nextDue, paidDate: lastPaid, status };
}

function formatWhen(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  });
}
