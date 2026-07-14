"use client";

import { useState } from "react";
import {
  Ban,
  Building2,
  ChevronRight,
  CircleCheck,
  Handshake,
  Layers,
  Tag,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type {
  ApoloEnterpriseRow,
  ApoloEnterpriseScenario,
  ApoloEnterprisesData,
} from "@/lib/apolo/empreendimentos";

// Tela de Empreendimentos: cenário geral (unidades x status) por empreendimento.
// A linha principal é o produto consolidado (regra ENTERPRISE_GROUPS); o chevron expande as
// etapas (ex.: Lagoa Bonita -> LBR / LBP / LBF). Ver [[project-apolo-crm-grafo]].

type BucketKey = keyof ApoloEnterpriseScenario;

const buckets: Array<{
  icon: LucideIcon;
  key: BucketKey;
  label: string;
  tone: string;
}> = [
  { icon: Layers, key: "total", label: "Total", tone: "text-ink" },
  {
    icon: Building2,
    key: "disponivel",
    label: "Disponível",
    tone: "text-emerald-600 dark:text-emerald-400",
  },
  {
    icon: Tag,
    key: "reservado",
    label: "Reservado",
    tone: "text-amber-600 dark:text-amber-400",
  },
  {
    icon: Handshake,
    key: "negociacao",
    label: "Em negociação",
    tone: "text-sky-600 dark:text-sky-400",
  },
  {
    icon: CircleCheck,
    key: "vendido",
    label: "Vendido",
    tone: "text-[#7A5E2C] dark:text-[#d9b877]",
  },
  {
    icon: Ban,
    key: "bloqueado",
    label: "Bloqueado",
    tone: "text-rose-600 dark:text-rose-400",
  },
];

export function EmpreendimentosScreen({
  data,
  error,
  loading,
}: {
  data: ApoloEnterprisesData | null;
  error: string | null;
  loading: boolean;
}) {
  if (loading && !data) {
    return <SkeletonScreen />;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
        {error}
      </div>
    );
  }

  if (!data?.rows.length) {
    return (
      <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm font-medium text-ink-muted">
        Nenhum empreendimento encontrado.
      </div>
    );
  }

  return (
    <div className="grid min-h-0 gap-3 overflow-y-auto">
      <section className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {buckets.map((bucket) => (
          <KpiCard
            key={bucket.key}
            icon={bucket.icon}
            label={bucket.label}
            tally={data.totals[bucket.key]}
            tone={bucket.tone}
          />
        ))}
      </section>

      <section className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-subtle/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-2.5 font-semibold">Empreendimento</th>
                <th className="px-3 py-2.5 text-right font-semibold">Unidades</th>
                <th className="px-3 py-2.5 text-right font-semibold">Disponível</th>
                <th className="px-3 py-2.5 text-right font-semibold">Reservado</th>
                <th className="px-3 py-2.5 text-right font-semibold">Negociação</th>
                <th className="px-3 py-2.5 text-right font-semibold">Vendido</th>
                <th className="px-3 py-2.5 text-right font-semibold">Bloqueado</th>
                <th className="px-4 py-2.5 text-right font-semibold">VGV</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <EnterpriseRows key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function EnterpriseRows({ row }: { row: ApoloEnterpriseRow }) {
  const [expanded, setExpanded] = useState(false);
  const hasStages = row.stages.length > 0;

  return (
    <>
      <tr
        className={`border-b border-line/70 transition-colors last:border-b-0 ${
          hasStages ? "cursor-pointer hover:bg-subtle/60" : "hover:bg-subtle/40"
        }`}
        onClick={hasStages ? () => setExpanded((value) => !value) : undefined}
      >
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            {hasStages ? (
              <span
                aria-label={expanded ? "Recolher etapas" : "Expandir etapas"}
                className="flex size-5 shrink-0 items-center justify-center rounded-md border border-line bg-subtle text-ink-muted"
              >
                <ChevronRight
                  className={`size-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
                  aria-hidden="true"
                />
              </span>
            ) : (
              <span className="size-5 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="m-0 truncate text-sm font-semibold text-ink">
                {row.name}
                {hasStages ? (
                  <span className="ml-1.5 text-[11px] font-medium text-ink-muted">
                    ({row.stages.length} etapas)
                  </span>
                ) : null}
              </p>
              <p className="m-0 truncate text-xs text-ink-muted">
                {[row.code, locationLabel(row)].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
        </td>
        <ScenarioCells scenario={row.scenario} strong />
      </tr>

      {expanded
        ? row.stages.map((stage) => (
            <tr
              key={stage.id}
              className="border-b border-line/70 bg-subtle/30 last:border-b-0"
            >
              <td className="px-4 py-2 pl-11">
                <p className="m-0 truncate text-sm font-medium text-ink-soft">
                  {stage.code}
                  <span className="ml-1.5 text-xs text-ink-muted">
                    {stage.incorporador ?? locationLabel(stage)}
                  </span>
                </p>
              </td>
              <ScenarioCells scenario={stage.scenario} />
            </tr>
          ))
        : null}
    </>
  );
}

function ScenarioCells({
  scenario,
  strong = false,
}: {
  scenario: ApoloEnterpriseScenario;
  strong?: boolean;
}) {
  const weight = strong ? "font-semibold text-ink" : "font-medium text-ink-soft";

  return (
    <>
      <td className={`px-3 py-2.5 text-right tabular-nums ${weight}`}>
        {scenario.total.units}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-emerald-600 dark:text-emerald-400">
        {scenario.disponivel.units}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-amber-600 dark:text-amber-400">
        {scenario.reservado.units}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-sky-600 dark:text-sky-400">
        {scenario.negociacao.units}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#7A5E2C] dark:text-[#d9b877]">
        {scenario.vendido.units}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-rose-600 dark:text-rose-400">
        {scenario.bloqueado.units}
      </td>
      <td className={`px-4 py-2.5 text-right tabular-nums ${weight}`}>
        {formatCurrency(scenario.total.value)}
      </td>
    </>
  );
}

function KpiCard({
  icon: Icon,
  label,
  tally,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  tally: { units: number; value: number };
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-start justify-between gap-2">
        <span
          className={`flex size-8 items-center justify-center rounded-lg border border-line bg-subtle ${tone}`}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <span className="rounded-full border border-line bg-subtle px-2 py-0.5 text-[10px] font-semibold tabular-nums text-ink-muted">
          {tally.units} unid.
        </span>
      </div>
      <p className="m-0 mt-2.5 truncate text-lg font-semibold tabular-nums text-ink">
        {formatCurrency(tally.value)}
      </p>
      <p className="m-0 text-xs font-medium text-ink-muted">{label}</p>
    </div>
  );
}

function SkeletonScreen() {
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="h-[92px] animate-pulse rounded-xl border border-line bg-subtle"
          />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-xl border border-line bg-subtle" />
    </div>
  );
}

function locationLabel(row: ApoloEnterpriseRow): string {
  return [row.city, row.state].filter(Boolean).join("/");
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}
