"use client";

import type { OperationsCheckMetric } from "@/lib/operations/monitoring";
import {
  EmptyState,
  PanelTitle,
} from "@/modules/squadops/blocks/shared/operations-ui";
import {
  performanceChartColors,
  performancePillClass,
  responsePerformanceBarClass,
  responsePerformanceTone,
} from "@/modules/squadops/blocks/monitoring/performance-utils";
import { Badge, Surface, type BadgeVariant } from "@repo/uix";
import { TrendingUp } from "lucide-react";
import { useMemo } from "react";

type MonitoringPeakPanelProps = {
  checks: OperationsCheckMetric[];
  formatDateTime: (value: string) => string;
  formatPayload: (bytes: number) => string;
  getRiskVariant: (risk: OperationsCheckMetric["risk"]) => BadgeVariant;
  isTvMode: boolean;
};

type PerformanceLineChartProps = {
  checks: OperationsCheckMetric[];
  isTvMode: boolean;
};

export function MonitoringPeakPanel({
  checks,
  formatDateTime,
  formatPayload,
  getRiskVariant,
  isTvMode,
}: MonitoringPeakPanelProps) {
  const series = useMemo(
    () =>
      checks
        .slice(0, isTvMode ? 48 : 72)
        .sort(
          (first, second) =>
            new Date(first.checkedAt).getTime() -
            new Date(second.checkedAt).getTime(),
        ),
    [checks, isTvMode],
  );
  const peaks = useMemo(
    () =>
      checks
        .slice(0, 160)
        .sort((first, second) => second.responseMs - first.responseMs)
        .slice(0, isTvMode ? 3 : 5),
    [checks, isTvMode],
  );
  const maxResponse = Math.max(1, ...peaks.map((check) => check.responseMs));
  const maxPayloadCheck = checks
    .slice(0, 160)
    .sort((first, second) => second.payloadBytes - first.payloadBytes)[0];

  return (
    <Surface
      bordered
      className={`min-w-0 border-line bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
        isTvMode ? "min-h-0 overflow-hidden p-4" : "p-5"
      }`}
    >
      <PanelTitle
        eyebrow="picos recentes"
        icon={<TrendingUp size={18} />}
        title="Picos de performance"
      />
      <div className="mt-4">
        <PerformanceLineChart checks={series} isTvMode={isTvMode} />
      </div>
      <div className={`mt-4 grid gap-3 ${isTvMode ? "grid-cols-3" : ""}`}>
        {peaks.length > 0 ? (
          peaks.map((check) => (
            <div
              className="rounded-xl border border-line bg-subtle p-3"
              key={`${check.id}-${check.checkedAt}-peak`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm font-semibold text-ink">
                    {check.label}
                  </p>
                  <p className="m-0 mt-1 text-xs text-ink-muted">
                    {check.module} / {formatDateTime(check.checkedAt)}
                  </p>
                </div>
                <Badge variant={getRiskVariant(check.risk)}>{check.risk}</Badge>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface ring-1 ring-line">
                <div
                  className={`h-full rounded-full ${responsePerformanceBarClass(check.responseMs)}`}
                  style={{
                    width: `${Math.max(8, (check.responseMs / maxResponse) * 100)}%`,
                  }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs font-semibold text-ink-soft">
                <span>{check.responseMs}ms</span>
                <span>{formatPayload(check.payloadBytes)}</span>
              </div>
            </div>
          ))
        ) : (
          <EmptyState message="Sem picos registrados nesta sessao." />
        )}
      </div>
      {maxPayloadCheck && !isTvMode ? (
        <p className="m-0 mt-4 rounded-xl bg-yellow-50 dark:bg-yellow-500/12 p-3 text-xs leading-5 text-ink-soft ring-1 ring-yellow-200 dark:ring-yellow-500/25">
          Maior payload recente:{" "}
          <strong className="text-ink">{maxPayloadCheck.label}</strong>{" "}
          com {formatPayload(maxPayloadCheck.payloadBytes)}.
        </p>
      ) : null}
    </Surface>
  );
}

function PerformanceLineChart({ checks, isTvMode }: PerformanceLineChartProps) {
  const visibleChecks = checks.filter((check) =>
    Number.isFinite(check.responseMs),
  );
  const maxResponse = Math.max(
    1,
    ...visibleChecks.map((check) => check.responseMs),
  );
  const minResponse = Math.min(
    maxResponse,
    ...visibleChecks.map((check) => check.responseMs),
  );
  const range = Math.max(1, maxResponse - minResponse);
  const tone = responsePerformanceTone(maxResponse);
  const colors = performanceChartColors(tone);
  const points = visibleChecks.map((check, index) => {
    const x =
      visibleChecks.length === 1
        ? 50
        : (index / (visibleChecks.length - 1)) * 100;
    const y = 48 - ((check.responseMs - minResponse) / range) * 38;

    return { check, x, y };
  });
  const linePoints = points
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
  const firstPoint = points[0] ?? null;
  const lastPoint = points[points.length - 1] ?? null;
  const areaPath =
    firstPoint && lastPoint
      ? `M ${firstPoint.x.toFixed(2)} 54 L ${points
          .map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
          .join(" L ")} L ${lastPoint.x.toFixed(2)} 54 Z`
      : "";
  const latestCheck = visibleChecks[visibleChecks.length - 1] ?? null;
  const previousCheck = visibleChecks[visibleChecks.length - 2] ?? null;
  const delta =
    latestCheck && previousCheck
      ? latestCheck.responseMs - previousCheck.responseMs
      : 0;

  if (visibleChecks.length === 0) {
    return <EmptyState message="Aguardando serie temporal de performance." />;
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="m-0 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-ink-muted">
            Curva de resposta
          </p>
          <p className="m-0 mt-1 text-2xl font-semibold text-ink">
            {maxResponse}ms
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2 text-xs font-semibold">
          <span
            className={`rounded-full px-2.5 py-1 ring-1 ${performancePillClass(tone)}`}
          >
            pico {maxResponse}ms
          </span>
          <span className="rounded-full bg-subtle px-2.5 py-1 text-ink-muted ring-1 ring-line">
            {visibleChecks.length} checks
          </span>
          {latestCheck ? (
            <span className="rounded-full bg-subtle px-2.5 py-1 text-ink-muted ring-1 ring-line">
              ultimo {latestCheck.responseMs}ms
            </span>
          ) : null}
        </div>
      </div>
      <div className={`mt-4 ${isTvMode ? "h-28" : "h-40"}`}>
        <svg
          aria-label="Grafico de linha dos picos de performance"
          className="h-full w-full overflow-visible"
          preserveAspectRatio="none"
          role="img"
          viewBox="0 0 100 56"
        >
          <defs>
            <linearGradient id="performance-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={colors.area} stopOpacity="0.28" />
              <stop offset="100%" stopColor={colors.area} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {[10, 22, 34, 46].map((y) => (
            <line
              key={y}
              stroke="#e2e8f0"
              strokeDasharray="2 3"
              strokeWidth="0.35"
              x1="0"
              x2="100"
              y1={y}
              y2={y}
            />
          ))}
          {areaPath ? <path d={areaPath} fill="url(#performance-area)" /> : null}
          <polyline
            fill="none"
            points={linePoints}
            stroke={colors.stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            vectorEffect="non-scaling-stroke"
          />
          {points.map((point, index) => {
            const isPeak = point.check.responseMs === maxResponse;
            const isLatest = index === points.length - 1;

            return (
              <circle
                cx={point.x}
                cy={point.y}
                fill={isPeak || isLatest ? colors.stroke : "#ffffff"}
                key={`${point.check.id}-${point.check.checkedAt}-${index}`}
                r={isPeak ? 1.9 : isLatest ? 1.6 : 1.1}
                stroke={colors.stroke}
                strokeWidth="0.7"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-ink-muted">
        <span>
          menor {minResponse}ms / maior {maxResponse}ms
        </span>
        <span className={delta > 0 ? "text-yellow-700 dark:text-yellow-300" : "text-emerald-700 dark:text-emerald-300"}>
          {delta > 0 ? "+" : ""}
          {delta}ms no ultimo check
        </span>
      </div>
    </div>
  );
}
