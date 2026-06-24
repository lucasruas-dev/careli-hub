"use client";

import { useState, type ReactNode } from "react";

import type {
  OperationsCostDailyPoint,
  OperationsCostHistory,
  OperationsCostSnapshot,
} from "@/lib/operations/cost";
import type { OperationsSourceGroup } from "@/lib/operations/data-sources";
import type {
  OperationsAlert,
  OperationsCheckMetric,
  OperationsGeneralStatus,
  OperationsMonitoringSnapshot,
  OperationsRiskLevel,
  OperationsTimeRisk,
  OpsWatcherDecision,
} from "@/lib/operations/monitoring";
import { classifyResponseTime } from "@/lib/operations/monitoring";
import {
  getAverageResponseMs,
  getMaxResponseMs,
} from "@/modules/squadops/blocks/monitoring/performance-utils";
import {
  EmptyState,
  PanelTitle,
} from "@/modules/squadops/blocks/shared/operations-ui";
import { Tooltip } from "@repo/uix";
import {
  Activity,
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  CalendarRange,
  DollarSign,
  EyeOff,
  Gauge,
  Layers,
  Loader2,
  Minus,
  RefreshCcw,
  TrendingDown,
  TrendingUp,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";

const statusTone: Record<
  OperationsGeneralStatus,
  { dot: string; label: string; pill: string }
> = {
  critico: {
    dot: "bg-rose-500",
    label: "Critico",
    pill: "bg-rose-50 text-rose-700 ring-rose-200/70",
  },
  indisponivel: {
    dot: "bg-slate-400",
    label: "Indisponivel",
    pill: "bg-slate-100 text-slate-600 ring-slate-200/70",
  },
  operacional: {
    dot: "bg-emerald-500",
    label: "Operacional",
    pill: "bg-emerald-50 text-emerald-700 ring-emerald-200/70",
  },
  operacional_com_atencao: {
    dot: "bg-amber-500",
    label: "Atencao",
    pill: "bg-amber-50 text-amber-700 ring-amber-200/70",
  },
};

const riskPill: Record<OperationsRiskLevel, string> = {
  alto: "bg-orange-50 text-orange-700 ring-orange-200/70",
  baixo: "bg-emerald-50 text-emerald-700 ring-emerald-200/70",
  critico: "bg-rose-50 text-rose-700 ring-rose-200/70",
  medio: "bg-amber-50 text-amber-700 ring-amber-200/70",
};

// Borda do card de ocorrencia pela severidade (leitura imediata bom/ruim).
const riskCardBorder: Record<OperationsRiskLevel, string> = {
  alto: "border-orange-200/80",
  baixo: "border-emerald-200/70",
  critico: "border-rose-200/80",
  medio: "border-amber-200/80",
};

// Regua de latencia: cores derivam de classifyResponseTime (fonte unica do timeRisk
// e dos alertas). Faixas: bom <=500 / atencao <=1500 / lento <=3000 / critico >3000ms.
const timeRiskTone: Record<
  OperationsTimeRisk,
  { border: string; dot: string; icon: string; label: string; range: string; value: string }
> = {
  atencao: {
    border: "border-amber-200/80",
    dot: "bg-amber-400",
    icon: "bg-amber-50 text-amber-600",
    label: "Atencao",
    range: "500-1500",
    value: "text-amber-700",
  },
  bom: {
    border: "border-emerald-200/80",
    dot: "bg-emerald-500",
    icon: "bg-emerald-50 text-emerald-600",
    label: "Bom",
    range: "<500ms",
    value: "text-emerald-700",
  },
  critico: {
    border: "border-rose-200/80",
    dot: "bg-rose-500",
    icon: "bg-rose-50 text-rose-600",
    label: "Critico",
    range: ">3000ms",
    value: "text-rose-700",
  },
  lento: {
    border: "border-orange-200/80",
    dot: "bg-orange-500",
    icon: "bg-orange-50 text-orange-600",
    label: "Lento",
    range: "1500-3000",
    value: "text-orange-700",
  },
};

// Ordem de leitura da regua (bom -> critico), independente da ordem alfabetica do mapa.
const TIME_RISK_ORDER: OperationsTimeRisk[] = [
  "bom",
  "atencao",
  "lento",
  "critico",
];

// Integracoes externas exibidas como dots, derivadas dos checks do snapshot.
const INTEGRATION_GROUPS: OperationsSourceGroup[] = [
  "asaas",
  "asana",
  "d4sign",
  "meta",
  "openai",
  "vercel",
];

function checkToGeneralStatus(
  check: OperationsCheckMetric,
): OperationsGeneralStatus {
  if (!check.ok) {
    return check.statusCode === 0 ? "indisponivel" : "critico";
  }

  if (check.timeRisk === "critico" || check.timeRisk === "lento") {
    return "operacional_com_atencao";
  }

  return "operacional";
}

type HealthBoardProps = {
  accessToken?: string | null;
  acknowledgingProtocol?: string | null;
  copiedCommandId?: string | null;
  generatedAt?: string;
  ignoringProtocol?: string | null;
  isLoading?: boolean;
  onAcknowledgeProtocol?: (protocol?: string) => void;
  onCopyCommand?: (command: string, id: string) => void;
  onIgnoreProtocol?: (protocol?: string) => void;
  onOpenFullCenter?: () => void;
  onRefresh?: () => void;
  snapshot: OperationsMonitoringSnapshot | null;
  watcher?: OpsWatcherDecision | null;
};

function StatusDot({
  detail,
  label,
  responseMs,
  status,
}: {
  detail: string;
  label: string;
  responseMs?: number;
  status: OperationsGeneralStatus;
}) {
  const tone = statusTone[status];
  const latency =
    typeof responseMs === "number" ? timeRiskTone[classifyResponseTime(responseMs)] : null;

  return (
    <Tooltip
      content={
        latency
          ? `${label}: ${tone.label} - ${detail} · latencia ${latency.label} (${latency.range})`
          : `${label}: ${tone.label} - ${detail}`
      }
      placement="top"
    >
      <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-sm font-medium text-slate-700">
        <span className={`size-2.5 rounded-full ${tone.dot}`} aria-hidden />
        {label}
      </span>
    </Tooltip>
  );
}

function MetricCard({
  icon,
  label,
  timeRisk,
  tone = "default",
  value,
}: {
  icon: ReactNode;
  label: string;
  timeRisk?: OperationsTimeRisk;
  tone?: "alert" | "default";
  value: string;
}) {
  const latency = timeRisk ? timeRiskTone[timeRisk] : null;
  const borderClass = latency
    ? latency.border
    : tone === "alert"
      ? "border-rose-200/70"
      : "border-slate-200/70";
  const iconClass = latency
    ? latency.icon
    : tone === "alert"
      ? "bg-rose-50 text-rose-600"
      : "bg-slate-50 text-[#A07C3B]";
  const valueClass = latency ? latency.value : "text-slate-950";

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${borderClass}`}
      title={latency ? `${label}: ${latency.label} (${latency.range})` : undefined}
    >
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${iconClass}`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className={`m-0 text-xl font-semibold leading-none ${valueClass}`}>
          {value}
        </p>
        <p className="m-0 mt-1 truncate text-xs font-medium text-slate-500">
          {label}
        </p>
      </div>
    </div>
  );
}

function OccurrenceCard({
  acknowledgingProtocol,
  alert,
  copiedCommandId,
  ignoringProtocol,
  onAcknowledgeProtocol,
  onCopyCommand,
  onIgnoreProtocol,
}: {
  acknowledgingProtocol?: string | null;
  alert: OperationsAlert;
  copiedCommandId?: string | null;
  ignoringProtocol?: string | null;
  onAcknowledgeProtocol?: (protocol?: string) => void;
  onCopyCommand?: (command: string, id: string) => void;
  onIgnoreProtocol?: (protocol?: string) => void;
}) {
  const latency = timeRiskTone[classifyResponseTime(alert.responseMs)];
  const isAcknowledging = acknowledgingProtocol === alert.protocol;
  const isIgnoring = ignoringProtocol === alert.protocol;

  return (
    <li
      className={`flex flex-col gap-2 rounded-xl border bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${riskCardBorder[alert.level]}`}
    >
      {/* Problema: nivel + titulo + acoes */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${riskPill[alert.level]}`}
          >
            {alert.level}
          </span>
          <span
            className="min-w-0 truncate text-sm font-semibold text-slate-900"
            title={alert.title}
          >
            {alert.title}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onAcknowledgeProtocol ? (
            <Tooltip content="Confirmar leitura" placement="top">
              <button
                aria-label={`Confirmar leitura do protocolo ${alert.protocol}`}
                className="inline-flex size-8 items-center justify-center rounded-lg border border-emerald-200 bg-white text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isAcknowledging}
                onClick={() => onAcknowledgeProtocol(alert.protocol)}
                type="button"
              >
                {isAcknowledging ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ClipboardCheck className="size-4" />
                )}
              </button>
            </Tooltip>
          ) : null}
          {onIgnoreProtocol ? (
            <Tooltip content="Silenciar / ignorar" placement="top">
              <button
                aria-label={`Silenciar protocolo ${alert.protocol}`}
                className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isIgnoring}
                onClick={() => onIgnoreProtocol(alert.protocol)}
                type="button"
              >
                {isIgnoring ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <EyeOff className="size-4" />
                )}
              </button>
            </Tooltip>
          ) : null}
          {onCopyCommand ? (
            <Tooltip
              content={`Acionar ${alert.recommendedAgent} (gerar prompt)`}
              placement="top"
            >
              <button
                aria-label={`Acionar ${alert.recommendedAgent}`}
                className={`inline-flex size-8 items-center justify-center rounded-lg border border-[#A07C3B]/20 bg-white text-[#7A5E2C] transition hover:bg-[#A07C3B]/5 ${
                  copiedCommandId === alert.id ? "bg-[#A07C3B]/10" : ""
                }`}
                onClick={() => onCopyCommand(alert.command, alert.id)}
                type="button"
              >
                <WandSparkles className="size-4" />
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {/* Causa: impacto + endpoint + latencia (regua) */}
      <p className="m-0 text-xs leading-5 text-slate-600">
        <span className="font-semibold text-slate-500">Causa:</span>{" "}
        {alert.impact}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <code className="rounded bg-slate-50 px-1.5 py-0.5 text-slate-500">
          {alert.endpoint}
        </code>
        <span className="inline-flex items-center gap-1">
          <span className={`size-2 rounded-full ${latency.dot}`} aria-hidden />
          {alert.responseMs}ms · {latency.label}
        </span>
      </div>

      {/* O que fazer: recomendacao + agente */}
      <p className="m-0 rounded-lg bg-slate-50/80 p-2 text-xs leading-5 text-slate-600 ring-1 ring-slate-200/60">
        <span className="font-semibold text-slate-500">Fazer:</span>{" "}
        {alert.recommendation}
        <span className="ml-1 font-semibold text-[#7A5E2C]">
          · {alert.recommendedAgent}
        </span>
      </p>
    </li>
  );
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

// Padrao de data do modulo: dd/mm/aa. Recebe "YYYY-MM-DD".
function formatBrDate(dayKey: string) {
  const [year, month, day] = dayKey.split("-");

  return day && month && year ? `${day}/${month}/${year.slice(2)}` : dayKey;
}

const costTrendVisual = {
  down: { Icon: TrendingDown, className: "text-emerald-600", label: "abaixo da média" },
  flat: { Icon: Minus, className: "text-slate-400", label: "na média" },
  up: { Icon: TrendingUp, className: "text-rose-600", label: "acima da média" },
} as const;

function costBarColor(cost: number) {
  if (cost >= 40) {
    return "bg-rose-400";
  }

  if (cost >= 15) {
    return "bg-orange-400";
  }

  if (cost >= 5) {
    return "bg-amber-400";
  }

  return "bg-emerald-400";
}

// Histórico diário do uso variável (mini gráfico de barras, cor pela régua de risco).
// Alturas em PIXELS (porcentagem nao resolve dentro do flex sem altura definida).
const COST_BARS_HEIGHT = 48;

function CostDailyBars({
  points,
}: {
  points: readonly OperationsCostDailyPoint[];
}) {
  const max = Math.max(...points.map((point) => point.cost), 0.01);

  return (
    <div className="flex items-end gap-1">
      {points.map((point) => {
        const barHeight = Math.max(
          Math.round((point.cost / max) * COST_BARS_HEIGHT),
          3,
        );

        return (
          // title nativo (o Tooltip do uix e inline e era cortado pelo overflow do card).
          <div
            className="flex flex-1 flex-col items-center gap-1"
            key={point.day}
            title={`${formatBrDate(point.day)}: ${formatUsd(point.cost)}`}
          >
            <div
              className="flex w-full items-end"
              style={{ height: COST_BARS_HEIGHT }}
            >
              <div
                className={`w-full rounded-sm ${costBarColor(point.cost)}`}
                style={{ height: barHeight }}
              />
            </div>
            <span className="text-[9px] tabular-nums text-slate-400">
              {point.day.slice(8)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function localDateKey(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Popup de histórico: filtro por período (datas) que busca o custo faturado por dia.
function CostHistoryModal({
  accessToken,
  onClose,
}: {
  accessToken?: string;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(() => localDateKey(-30));
  const [to, setTo] = useState(() => localDateKey(0));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<OperationsCostHistory | null>(null);

  async function loadHistory() {
    if (!from || !to) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {};

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch(
        `/api/operations/cost/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { cache: "no-store", headers },
      );
      const data = (await response.json()) as OperationsCostHistory & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data?.error ?? "Falha ao carregar histórico.");
      }

      setHistory(data);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Falha ao carregar histórico.",
      );
      setHistory(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[var(--uix-z-modal)] flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <p className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <CalendarRange className="size-4 text-[#A07C3B]" />
            Histórico de custo (Vercel · faturado)
          </p>
          <button
            aria-label="Fechar"
            className="grid size-8 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
            De
            <input
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-[#A07C3B]"
              onChange={(event) => setFrom(event.target.value)}
              type="date"
              value={from}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
            Até
            <input
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-[#A07C3B]"
              onChange={(event) => setTo(event.target.value)}
              type="date"
              value={to}
            />
          </label>
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#A07C3B] px-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading}
            onClick={() => void loadHistory()}
            type="button"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            Buscar
          </button>
        </div>

        {error ? (
          <p className="m-0 mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 ring-1 ring-rose-200">
            {error}
          </p>
        ) : null}

        {history ? (
          <div className="mt-4">
            <p className="m-0 mb-2 text-xs text-slate-500">
              {formatBrDate(history.from)} – {formatBrDate(history.to)} ·{" "}
              <span className="font-semibold text-slate-900">
                total {formatUsd(history.total)}
              </span>
            </p>
            {history.days.length > 1 ? (
              <CostDailyBars points={history.days} />
            ) : (
              <p className="m-0 text-xs text-slate-400">Sem dados no período.</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Custo D-1 (trilho anti-Hermes): Vercel = uso variavel real (EffectiveCost);
// Supabase = estimativa pelo plano. Regua de cor pelo risco do custo do dia.
function CostPanel({
  accessToken,
  cost,
}: {
  accessToken?: string;
  cost: OperationsCostSnapshot;
}) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const { monthAccumulated, monthLabel, monthProjection, supabase, vercel } =
    cost;
  const fixedMonthly = vercel.monthlyFixedCost + supabase.estimateMonthlyCost;
  const trend = costTrendVisual[vercel.trend];
  const TrendIcon = trend.Icon;

  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <DollarSign className="size-4 text-[#A07C3B]" />
          <p className="m-0 text-xs font-semibold text-slate-500">
            Custo · ciclo {monthLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
            onClick={() => setIsHistoryOpen(true)}
            type="button"
          >
            <CalendarRange className="size-3.5" />
            Histórico
          </button>
          <Tooltip
            content="Risco pelo uso variável de ontem na Vercel (o que dispara em abuso). Verde dentro do normal, vermelho se estourar o teto."
            placement="top"
          >
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${riskPill[vercel.risk]}`}
            >
              {vercel.risk}
            </span>
          </Tooltip>
        </div>
      </div>

      {/* Destaque: acumulado do mes + expectativa final (projecao ate o fim do mes) */}
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200/70 bg-slate-50/50 p-3">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Acumulado no ciclo
          </p>
          <p className="m-0 mt-1 text-3xl font-bold leading-none text-slate-950">
            {formatUsd(monthAccumulated)}
          </p>
          <p className="m-0 mt-1 text-[11px] text-slate-500">
            Vercel + Supabase · ciclo até agora
          </p>
        </div>
        <div className="rounded-lg border border-[#A07C3B]/30 bg-[#A07C3B]/[0.06] p-3">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-[#7A5E2C]">
            Expectativa final
          </p>
          <p className="m-0 mt-1 text-3xl font-bold leading-none text-[#7A5E2C]">
            {formatUsd(monthProjection)}
          </p>
          <p className="m-0 mt-1 text-[11px] text-slate-500">
            projeção até o fim do ciclo
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200/70 bg-slate-50/40 p-3">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Vercel · uso variável{vercel.day ? ` · ${formatBrDate(vercel.day)}` : ""}
          </p>
          {vercel.configured ? (
            <>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-2xl font-semibold leading-none text-slate-950">
                  {formatUsd(vercel.variableCost)}
                </span>
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-medium ${trend.className}`}
                >
                  <TrendIcon className="size-3.5" />
                  {trend.label}
                </span>
              </div>
              <p className="m-0 mt-1 text-[11px] text-slate-500">
                típico/dia: {formatUsd(vercel.typicalDailyCost)}
              </p>
              {vercel.topServices.length > 0 ? (
                <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
                  {vercel.topServices.map((item) => (
                    <li
                      className="flex items-center justify-between gap-2 text-[11px] text-slate-600"
                      key={item.service}
                    >
                      <span className="min-w-0 truncate">{item.service}</span>
                      <span className="shrink-0 font-medium text-slate-700">
                        {formatUsd(item.cost)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 mt-2 text-[11px] text-slate-400">
                  Sem uso variável no dia.
                </p>
              )}
            </>
          ) : (
            <p className="m-0 mt-1 text-[11px] text-slate-400">
              Configure VERCEL_API_TOKEN para ler o custo real da Vercel.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-slate-200/70 bg-slate-50/40 p-3">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Supabase · estimativa
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold leading-none text-slate-950">
              {formatUsd(supabase.estimateDailyCost)}
            </span>
            <span className="text-[11px] text-slate-500">/dia</span>
          </div>
          <p className="m-0 mt-1 text-[11px] text-slate-500">{supabase.note}</p>
        </div>
      </div>

      {vercel.configured && vercel.dailySeries.length > 1 ? (
        <div className="mt-3">
          <p className="m-0 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Custo por dia (Vercel · faturado)
          </p>
          <CostDailyBars points={vercel.dailySeries} />
        </div>
      ) : null}

      <p className="m-0 mt-3 text-[11px] text-slate-400">
        Plano fixo: Vercel {formatUsd(vercel.monthlyFixedCost)} + Supabase{" "}
        {formatUsd(supabase.estimateMonthlyCost)} ≈ {formatUsd(fixedMonthly)}/mês
      </p>

      {isHistoryOpen ? (
        <CostHistoryModal
          accessToken={accessToken}
          onClose={() => setIsHistoryOpen(false)}
        />
      ) : null}
    </div>
  );
}

export function HealthBoard({
  accessToken,
  acknowledgingProtocol,
  copiedCommandId,
  generatedAt,
  ignoringProtocol,
  isLoading,
  onAcknowledgeProtocol,
  onCopyCommand,
  onIgnoreProtocol,
  onOpenFullCenter,
  onRefresh,
  snapshot,
  watcher,
}: HealthBoardProps) {
  if (!snapshot) {
    return (
      <EmptyState message="Sem leitura de saude ainda. Atualize para coletar o estado das APIs e integracoes." />
    );
  }

  const { cards, checks, metrics } = snapshot;
  const overall = statusTone[cards.status.value];
  const avgMs = getAverageResponseMs(checks);
  const maxMs = getMaxResponseMs(checks);
  const activeAlerts = snapshot.alerts;
  const watcherCritical = watcher?.status === "notificar";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PanelTitle
          eyebrow="Operations Center"
          icon={<Activity className="size-5" />}
          title="Saude do HUB"
        />
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ring-1 ${overall.pill}`}
          >
            <span className={`size-2 rounded-full ${overall.dot}`} aria-hidden />
            {cards.status.label}
          </span>
          {onRefresh ? (
            <Tooltip content="Atualizar leitura" placement="top">
              <button
                aria-label="Atualizar leitura"
                className="flex size-9 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-600 transition hover:bg-slate-50"
                onClick={onRefresh}
                type="button"
              >
                <RefreshCcw
                  className={`size-4 ${isLoading ? "animate-spin" : ""}`}
                />
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard
          icon={<Gauge className="size-4" />}
          label="Latencia media"
          timeRisk={classifyResponseTime(avgMs)}
          value={`${avgMs}ms`}
        />
        <MetricCard
          icon={<Clock className="size-4" />}
          label="Maior latencia"
          timeRisk={classifyResponseTime(maxMs)}
          value={`${maxMs}ms`}
        />
        <MetricCard
          icon={<BellRing className="size-4" />}
          label="Alertas ativos"
          tone={cards.activeAlerts.total > 0 ? "alert" : "default"}
          value={String(cards.activeAlerts.total)}
        />
        <MetricCard
          icon={<Zap className="size-4" />}
          label="Checks lentos"
          tone={metrics.slowChecks > 0 ? "alert" : "default"}
          value={String(metrics.slowChecks)}
        />
        <MetricCard
          icon={<Layers className="size-4" />}
          label="Payload pesado"
          tone={metrics.payloadCritical > 0 ? "alert" : "default"}
          value={String(metrics.payloadCritical)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Tooltip
          content="Faixa de latencia das respostas. Mesma regua que classifica risco e alertas."
          placement="top"
        >
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <Gauge className="size-3.5" />
            Regua latencia
          </span>
        </Tooltip>
        {TIME_RISK_ORDER.map((risk) => {
          const tone = timeRiskTone[risk];

          return (
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500"
              key={risk}
            >
              <span className={`size-2 rounded-full ${tone.dot}`} aria-hidden />
              {tone.label}
              <span className="text-slate-400">{tone.range}</span>
            </span>
          );
        })}
      </div>

      {snapshot.cost ? (
        <CostPanel accessToken={accessToken ?? undefined} cost={snapshot.cost} />
      ) : null}

      <div className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <p className="m-0 mb-3 text-xs font-semibold text-slate-500">
          Integracoes
        </p>
        <div className="flex flex-wrap gap-2">
          <StatusDot
            detail={`${cards.supabase.responseMs}ms`}
            label="Supabase Auth"
            responseMs={cards.supabase.responseMs}
            status={cards.supabase.auth}
          />
          <StatusDot
            detail={`${cards.supabase.responseMs}ms`}
            label="Supabase Realtime"
            responseMs={cards.supabase.responseMs}
            status={cards.supabase.realtime}
          />
          <StatusDot
            detail={`${cards.supabase.responseMs}ms`}
            label="Supabase REST"
            responseMs={cards.supabase.responseMs}
            status={cards.supabase.rest}
          />
          <StatusDot
            detail={`${cards.c2x.database} - ${cards.c2x.responseMs}ms`}
            label="Banco C2X"
            responseMs={cards.c2x.responseMs}
            status={cards.c2x.status}
          />
          {checks
            .filter((check) => INTEGRATION_GROUPS.includes(check.group))
            .map((check) => {
              const configured = check.endpoint !== "not-configured";

              return (
                <StatusDot
                  detail={configured ? `${check.responseMs}ms` : "nao configurado"}
                  key={check.id}
                  label={check.label}
                  responseMs={configured ? check.responseMs : undefined}
                  status={checkToGeneralStatus(check)}
                />
              );
            })}
        </div>
      </div>

      {watcherCritical && watcher ? (
        <div className="rounded-xl border-2 border-rose-200 bg-rose-50/60 p-4">
          <div className="flex items-center gap-2">
            <BellRing className="size-4 text-rose-600" />
            <p className="m-0 text-sm font-semibold text-rose-700">
              Ops Watcher - risco {watcher.risk}
            </p>
          </div>
          <p className="m-0 mt-2 text-sm text-slate-700">{watcher.impact}</p>
          <p className="m-0 mt-1 text-sm text-slate-500">{watcher.reason}</p>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {activeAlerts.length > 0 ? (
              <AlertTriangle className="size-4 text-amber-500" />
            ) : (
              <CheckCircle2 className="size-4 text-emerald-500" />
            )}
            <p className="m-0 text-xs font-semibold text-slate-500">
              {activeAlerts.length > 0
                ? `${activeAlerts.length} ocorrencia(s) ativa(s)`
                : "Nenhuma ocorrencia ativa"}
            </p>
          </div>
          {onOpenFullCenter ? (
            <Tooltip
              content="Historico, protocolos e devolutivas tecnicas"
              placement="top"
            >
              <button
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                onClick={onOpenFullCenter}
                type="button"
              >
                Ver na Central
                <ChevronRight className="size-3.5" />
              </button>
            </Tooltip>
          ) : null}
        </div>
        {activeAlerts.length === 0 ? (
          <EmptyState message="Tudo operacional. Sem riscos detectados na ultima leitura." />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {activeAlerts.map((alert) => (
              <OccurrenceCard
                acknowledgingProtocol={acknowledgingProtocol}
                alert={alert}
                copiedCommandId={copiedCommandId}
                ignoringProtocol={ignoringProtocol}
                key={alert.id}
                onAcknowledgeProtocol={onAcknowledgeProtocol}
                onCopyCommand={onCopyCommand}
                onIgnoreProtocol={onIgnoreProtocol}
              />
            ))}
          </ul>
        )}
      </div>

      {generatedAt ? (
        <p className="m-0 text-right text-xs text-slate-400">
          Ultima leitura: {generatedAt}
        </p>
      ) : null}
    </div>
  );
}
