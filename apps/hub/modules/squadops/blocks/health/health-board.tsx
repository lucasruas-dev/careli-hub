"use client";

import type { ReactNode } from "react";

import type {
  OperationsGeneralStatus,
  OperationsMonitoringSnapshot,
  OperationsRiskLevel,
  OpsWatcherDecision,
} from "@/lib/operations/monitoring";
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
  Clock,
  Gauge,
  Layers,
  RefreshCcw,
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

type HealthBoardProps = {
  generatedAt?: string;
  isLoading?: boolean;
  onRefresh?: () => void;
  snapshot: OperationsMonitoringSnapshot | null;
  watcher?: OpsWatcherDecision | null;
};

function StatusDot({
  detail,
  label,
  status,
}: {
  detail: string;
  label: string;
  status: OperationsGeneralStatus;
}) {
  const tone = statusTone[status];

  return (
    <Tooltip content={`${label}: ${tone.label} - ${detail}`} placement="top">
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
  tone = "default",
  value,
}: {
  icon: ReactNode;
  label: string;
  tone?: "alert" | "default";
  value: string;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
        tone === "alert" ? "border-rose-200/70" : "border-slate-200/70"
      }`}
    >
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
          tone === "alert"
            ? "bg-rose-50 text-rose-600"
            : "bg-slate-50 text-[#A07C3B]"
        }`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="m-0 text-xl font-semibold leading-none text-slate-950">
          {value}
        </p>
        <p className="m-0 mt-1 truncate text-xs font-medium text-slate-500">
          {label}
        </p>
      </div>
    </div>
  );
}

export function HealthBoard({
  generatedAt,
  isLoading,
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
          value={`${avgMs}ms`}
        />
        <MetricCard
          icon={<Clock className="size-4" />}
          label="Maior latencia"
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

      <div className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <p className="m-0 mb-3 text-xs font-semibold text-slate-500">
          Integracoes
        </p>
        <div className="flex flex-wrap gap-2">
          <StatusDot
            detail={`${cards.supabase.responseMs}ms`}
            label="Supabase Auth"
            status={cards.supabase.auth}
          />
          <StatusDot
            detail={`${cards.supabase.responseMs}ms`}
            label="Supabase Realtime"
            status={cards.supabase.realtime}
          />
          <StatusDot
            detail={`${cards.supabase.responseMs}ms`}
            label="Supabase REST"
            status={cards.supabase.rest}
          />
          <StatusDot
            detail={`${cards.c2x.database} - ${cards.c2x.responseMs}ms`}
            label="Banco C2X"
            status={cards.c2x.status}
          />
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
        <div className="mb-3 flex items-center gap-2">
          {activeAlerts.length > 0 ? (
            <AlertTriangle className="size-4 text-amber-500" />
          ) : (
            <CheckCircle2 className="size-4 text-emerald-500" />
          )}
          <p className="m-0 text-xs font-semibold text-slate-500">
            {activeAlerts.length > 0
              ? `${activeAlerts.length} alerta(s) ativo(s)`
              : "Nenhum alerta ativo"}
          </p>
        </div>
        {activeAlerts.length === 0 ? (
          <EmptyState message="Tudo operacional. Sem riscos detectados na ultima leitura." />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {activeAlerts.map((alert) => (
              <li
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200/70 bg-white p-3"
                key={alert.id}
              >
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${riskPill[alert.level]}`}
                >
                  {alert.level}
                </span>
                <Tooltip
                  content={`${alert.impact} - ${alert.recommendation}`}
                  placement="top"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                    {alert.title}
                  </span>
                </Tooltip>
                <code className="rounded bg-slate-50 px-1.5 py-0.5 text-xs text-slate-500">
                  {alert.endpoint}
                </code>
              </li>
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
