import type {
  OperationsCheckMetric,
  OperationsMonitoringSnapshot,
  OperationsRiskLevel,
} from "@/lib/operations/monitoring";
import { EmptyState } from "@/modules/squadops/blocks/shared/operations-ui";
import {
  monitoringSourceTone,
  performanceCardBorderClass,
  performanceIconClass,
  performancePillClass,
  responsePerformanceBarClass,
} from "@/modules/squadops/blocks/monitoring/performance-utils";
import { Badge, type BadgeVariant } from "@repo/uix";
import {
  Activity,
  Database,
  LayoutGrid,
  Rocket,
  ServerCog,
  ShieldAlert,
  Wifi,
} from "lucide-react";

export type MonitoringSourceSummary = {
  alertCount: number;
  averageResponseMs: number;
  checks: OperationsCheckMetric[];
  currentChecks: OperationsCheckMetric[];
  description: string;
  endpointCount: number;
  errorCount: number;
  healthyCount: number;
  id: string;
  label: string;
  lastCheckAt: string | null;
  peakPayloadBytes: number;
  peakResponseMs: number;
  payloadBytes: number;
  responseMs: number;
  risk: OperationsRiskLevel | "nenhum";
  status?: OperationsMonitoringSnapshot["cards"]["status"]["value"];
  trend: number[];
};

type MonitoringSourceGridProps = {
  formatPayload: (bytes: number) => string;
  formatStatus: (
    status?: OperationsMonitoringSnapshot["cards"]["status"]["value"],
  ) => string;
  getStatusVariant: (
    status?: OperationsMonitoringSnapshot["cards"]["status"]["value"],
  ) => BadgeVariant;
  isTvMode: boolean;
  onSelectSource: (sourceId: string) => void;
  sources: MonitoringSourceSummary[];
};

type MonitoringSourceCardProps = {
  formatPayload: (bytes: number) => string;
  formatStatus: (
    status?: OperationsMonitoringSnapshot["cards"]["status"]["value"],
  ) => string;
  getStatusVariant: (
    status?: OperationsMonitoringSnapshot["cards"]["status"]["value"],
  ) => BadgeVariant;
  onSelect: () => void;
  source: MonitoringSourceSummary;
};

const monitoringSourceOrder = [
  "page",
  "c2x",
  "supabase",
  "guardian-queue",
  "protected-api",
  "vercel",
  "api",
] as const;

export function MonitoringSourceGrid({
  formatPayload,
  formatStatus,
  getStatusVariant,
  isTvMode,
  onSelectSource,
  sources,
}: MonitoringSourceGridProps) {
  return (
    <div className="mt-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-[#A07C3B]">
            Instancias monitoradas
          </p>
          <p className="m-0 mt-1 text-sm text-ink-muted">
            Clique em uma fonte para abrir tempo, payload, endpoint e picos.
          </p>
        </div>
        <Badge variant="neutral">
          {sources.length || 0} fonte(s) em leitura
        </Badge>
      </div>
      {sources.length > 0 ? (
        <div
          className={`grid grid-cols-1 gap-3 md:grid-cols-2 ${
            isTvMode ? "xl:grid-cols-5" : "xl:grid-cols-3 2xl:grid-cols-6"
          }`}
        >
          {sources.map((source) => (
            <MonitoringSourceCard
              formatPayload={formatPayload}
              formatStatus={formatStatus}
              getStatusVariant={getStatusVariant}
              key={source.id}
              onSelect={() => onSelectSource(source.id)}
              source={source}
            />
          ))}
        </div>
      ) : (
        <EmptyState message="Aguardando primeiro snapshot das fontes reais." />
      )}
    </div>
  );
}

function MonitoringSourceCard({
  formatPayload,
  formatStatus,
  getStatusVariant,
  onSelect,
  source,
}: MonitoringSourceCardProps) {
  const tone = monitoringSourceTone(source.risk, source.status);

  return (
    <button
      className={`group min-w-0 rounded-xl border bg-surface p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_24px_rgba(15,23,42,0.08)] ${performanceCardBorderClass(tone)}`}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-semibold text-ink">
            {source.label}
          </p>
          <p className="m-0 mt-1 line-clamp-2 text-xs leading-5 text-ink-muted">
            {source.description}
          </p>
        </div>
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ${performanceIconClass(tone)}`}
        >
          {getMonitoringSourceIcon(source.id)}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-subtle p-2 ring-1 ring-line">
          <p className="m-0 text-[0.65rem] font-semibold uppercase text-ink-muted">
            Tempo
          </p>
          <p className="m-0 mt-1 text-base font-semibold text-ink">
            {source.responseMs}ms
          </p>
        </div>
        <div className="rounded-lg bg-subtle p-2 ring-1 ring-line">
          <p className="m-0 text-[0.65rem] font-semibold uppercase text-ink-muted">
            Payload
          </p>
          <p className="m-0 mt-1 truncate text-base font-semibold text-ink">
            {formatPayload(source.payloadBytes)}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant={getStatusVariant(source.status)}>
          {formatStatus(source.status)}
        </Badge>
        <span className="rounded-full bg-subtle px-2 py-1 text-[0.68rem] font-semibold text-ink-muted ring-1 ring-line">
          {source.healthyCount}/{source.endpointCount} ok
        </span>
        {source.alertCount > 0 ? (
          <span
            className={`rounded-full px-2 py-1 text-[0.68rem] font-semibold ring-1 ${performancePillClass(tone)}`}
          >
            {source.alertCount} alerta(s)
          </span>
        ) : null}
      </div>
      <div className="mt-4">
        <MiniTrendBars values={source.trend} />
      </div>
    </button>
  );
}

export function MiniTrendBars({
  tall = false,
  values,
}: {
  tall?: boolean;
  values: number[];
}) {
  const visibleValues = values.slice(-18);
  const maxValue = Math.max(1, ...visibleValues);

  if (visibleValues.length === 0) {
    return (
      <div
        className={`flex ${tall ? "h-20" : "h-11"} items-center justify-center rounded-lg bg-subtle text-xs font-semibold text-ink-muted ring-1 ring-line`}
      >
        sem historico
      </div>
    );
  }

  return (
    <div
      className={`flex ${tall ? "h-20" : "h-11"} items-end gap-1 rounded-lg bg-subtle p-2 ring-1 ring-line`}
    >
      {visibleValues.map((value, index) => (
        <span
          aria-label={`${value}ms`}
          className={`min-w-1 flex-1 rounded-t ${responsePerformanceBarClass(value)}`}
          key={`${value}-${index}`}
          style={{
            height: `${Math.max(12, (value / maxValue) * 100)}%`,
          }}
        />
      ))}
    </div>
  );
}

export function getMonitoringSourceMeta(sourceId: string) {
  if (sourceId === "page") {
    return {
      description: "Abertura HTML do Login e Zeus.",
      label: "Paginas",
    };
  }

  if (sourceId === "c2x") {
    return {
      description: "Banco e healthcheck do legado C2X.",
      label: "C2X Legado",
    };
  }

  if (sourceId === "supabase") {
    return {
      description: "Auth, REST e Realtime.",
      label: "Supabase",
    };
  }

  if (sourceId === "guardian-queue") {
    return {
      description: "Fila operacional segura do Hades.",
      label: "Hades Queue",
    };
  }

  if (sourceId === "protected-api") {
    return {
      description: "APIs protegidas e comportamento 401 esperado.",
      label: "APIs protegidas",
    };
  }

  if (sourceId === "vercel") {
    return {
      description: "Disponibilidade do dominio publicado.",
      label: "Vercel",
    };
  }

  return {
    description: "Endpoints internos monitorados.",
    label: "Hub APIs",
  };
}

export function getMonitoringSourceIcon(sourceId: string) {
  if (sourceId === "page") {
    return <LayoutGrid size={17} />;
  }

  if (sourceId === "c2x") {
    return <ServerCog size={17} />;
  }

  if (sourceId === "supabase") {
    return <Wifi size={17} />;
  }

  if (sourceId === "guardian-queue") {
    return <Database size={17} />;
  }

  if (sourceId === "protected-api") {
    return <ShieldAlert size={17} />;
  }

  if (sourceId === "vercel") {
    return <Rocket size={17} />;
  }

  return <Activity size={17} />;
}

export function getMonitoringSourceOrder(sourceId: string) {
  const index = monitoringSourceOrder.findIndex((item) => item === sourceId);

  if (index >= 0) {
    return index;
  }

  return monitoringSourceOrder.length;
}
