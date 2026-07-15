"use client";

import {
  Building2,
  ChevronRight,
  Loader2,
  Store,
  TriangleAlert,
  User,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ApoloCarteiraData, ApoloCarteiraUnit } from "@/lib/apolo/carteira";
import type { ApoloCarteiraRoleKind } from "../../data/apolo-derive";
import { getApoloAccessToken } from "../../data/apolo-operations";

// Carteira por PAPEL (incorporador/imobiliária/corretor). Drill-down navegável em camadas
// terminando no comprador — que abre a ficha detalhada dele. O comprador puro usa o
// PortfolioPanel clássico (unidades). Ver [[project-apolo-empreendimento-tela]].

type Dim = "empreendimento" | "imobiliaria" | "comprador";

// Sequência de camadas por papel. O corretor/imobiliária já são o escopo, então drillam por
// empreendimento e comprador; o incorporador tem a imobiliária no meio. (O C2X não liga
// corretor à venda, então corretor nunca é uma camada.)
const DIMS_BY_ROLE: Record<ApoloCarteiraRoleKind, Dim[]> = {
  comprador: [],
  corretor: ["empreendimento", "comprador"],
  imobiliaria: ["empreendimento", "comprador"],
  incorporador: ["empreendimento", "imobiliaria", "comprador"],
};

const DIM_META: Record<Dim, { icon: typeof Building2; plural: string; singular: string }> = {
  comprador: { icon: User, plural: "Compradores", singular: "Comprador" },
  empreendimento: { icon: Building2, plural: "Empreendimentos", singular: "Empreendimento" },
  imobiliaria: { icon: Store, plural: "Imobiliárias", singular: "Imobiliária" },
};

const NONE_KEY = "__none__";

function brl(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(Number.isFinite(value) ? value : 0);
}

function unitKey(unit: ApoloCarteiraUnit, dim: Dim): string {
  if (dim === "empreendimento") {
    return unit.enterpriseCode || NONE_KEY;
  }

  if (dim === "imobiliaria") {
    return unit.imobiliaria?.entityId ?? NONE_KEY;
  }

  return unit.client?.entityId ?? `unit:${unit.id}`;
}

function unitLabel(unit: ApoloCarteiraUnit, dim: Dim): string {
  if (dim === "empreendimento") {
    return unit.enterpriseName || unit.enterpriseCode || "Empreendimento";
  }

  if (dim === "imobiliaria") {
    return unit.imobiliaria?.name ?? "Sem imobiliária";
  }

  return unit.client?.name ?? "Sem comprador";
}

type Group = {
  compradores: number;
  entityId: string | null;
  inadimplentes: number;
  key: string;
  label: string;
  overdue: number;
  total: number;
  unidades: number;
};

// Agrupa as unidades pela dimensão, somando os números de cada grupo.
function groupUnits(units: ApoloCarteiraUnit[], dim: Dim): Group[] {
  const map = new Map<string, { entityId: string | null; label: string; units: ApoloCarteiraUnit[] }>();

  for (const unit of units) {
    const key = unitKey(unit, dim);
    const existing = map.get(key);
    const entityId =
      dim === "empreendimento"
        ? null
        : dim === "imobiliaria"
          ? (unit.imobiliaria?.entityId ?? null)
          : (unit.client?.entityId ?? null);

    if (existing) {
      existing.units.push(unit);
    } else {
      map.set(key, { entityId, label: unitLabel(unit, dim), units: [unit] });
    }
  }

  return Array.from(map.entries())
    .map(([key, group]) => {
      const buyers = new Set<string>();
      const overdueBuyers = new Set<string>();

      for (const unit of group.units) {
        const buyer = unit.client?.entityId ?? unit.client?.name ?? `unit:${unit.id}`;
        buyers.add(buyer);

        if (unit.overdueInstallments > 0) {
          overdueBuyers.add(buyer);
        }
      }

      return {
        compradores: buyers.size,
        entityId: group.entityId,
        inadimplentes: overdueBuyers.size,
        key,
        label: group.label,
        overdue: group.units.reduce((sum, unit) => sum + unit.overdueAmount, 0),
        total: group.units.reduce((sum, unit) => sum + unit.totalContract, 0),
        unidades: new Set(group.units.map((unit) => unit.id)).size,
      };
    })
    .sort((a, b) => b.overdue - a.overdue || b.total - a.total);
}

type Crumb = { dim: Dim; key: string; label: string };

export function ScopedPortfolioPanel({
  c2xId,
  kind,
  onOpenEntity,
  roleSelector,
}: {
  c2xId: number;
  kind: ApoloCarteiraRoleKind;
  onOpenEntity: (label: string, entityId: string) => void;
  roleSelector?: React.ReactNode;
}) {
  const [data, setData] = useState<ApoloCarteiraData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<Crumb[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setPath([]);

    (async () => {
      try {
        const accessToken = await getApoloAccessToken();
        const response = await fetch(
          `/api/apolo/carteira?c2xId=${c2xId}&kind=${kind}`,
          { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const payload = (await response.json().catch(() => null)) as
          | { data?: ApoloCarteiraData; error?: string }
          | null;

        if (!active) {
          return;
        }

        if (!response.ok || !payload?.data) {
          setError(payload?.error ?? "Não foi possível carregar a carteira.");
          setData(null);
          return;
        }

        setData(payload.data);
      } catch {
        if (active) {
          setError("Não foi possível carregar a carteira.");
          setData(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [c2xId, kind]);

  const dims = DIMS_BY_ROLE[kind];

  const filteredUnits = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.units.filter((unit) =>
      path.every((crumb) => unitKey(unit, crumb.dim) === crumb.key),
    );
  }, [data, path]);

  const currentDim = dims[path.length] ?? "comprador";
  const groups = useMemo(
    () => groupUnits(filteredUnits, currentDim),
    [filteredUnits, currentDim],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-line bg-surface p-10 text-sm font-medium text-ink-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Carregando carteira…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-6 text-sm font-medium text-rose-600 dark:text-rose-300">
        <TriangleAlert className="size-4" aria-hidden="true" />
        {error}
      </div>
    );
  }

  const summary = data?.summary;
  const isLeaf = currentDim === "comprador";
  const DimIcon = DIM_META[currentDim].icon;

  return (
    <section className="grid gap-4">
      <header className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Carteira" value={brl(summary?.totalPortfolio ?? 0)} />
          <Kpi label="A receber" value={brl(summary?.toReceiveAmount ?? 0)} />
          <Kpi
            label="Vencido"
            tone={summary && summary.overdueAmount > 0 ? "danger" : "default"}
            value={brl(summary?.overdueAmount ?? 0)}
          />
          <Kpi
            label="Inadimplência"
            tone={summary && summary.delinquencyRate > 0 ? "danger" : "default"}
            value={`${Math.round((summary?.delinquencyRate ?? 0) * 100)}%`}
          />
        </div>
        {roleSelector ? <div className="shrink-0">{roleSelector}</div> : null}
      </header>

      <nav className="flex flex-wrap items-center gap-1 text-sm font-medium text-ink-muted">
        <button
          className="rounded-md px-2 py-1 font-semibold text-ink transition-colors hover:bg-subtle"
          onClick={() => setPath([])}
          type="button"
        >
          Carteira
        </button>
        {path.map((crumb, index) => (
          <span className="flex items-center gap-1" key={`${crumb.dim}:${crumb.key}`}>
            <ChevronRight className="size-3.5 text-ink-muted/60" aria-hidden="true" />
            <button
              className="rounded-md px-2 py-1 transition-colors hover:bg-subtle hover:text-ink"
              onClick={() => setPath((current) => current.slice(0, index + 1))}
              type="button"
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </nav>

      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        <DimIcon className="size-4 text-[#A07C3B]" aria-hidden="true" />
        {DIM_META[currentDim].plural}
        <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
          {groups.length}
        </span>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-6 text-sm font-medium text-ink-muted">
          Nenhuma carteira neste recorte.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => {
            const clickable = isLeaf
              ? Boolean(group.entityId)
              : true;

            const onClick = () => {
              if (isLeaf) {
                if (group.entityId) {
                  onOpenEntity(group.label, group.entityId);
                }
                return;
              }

              setPath((current) => [
                ...current,
                { dim: currentDim, key: group.key, label: group.label },
              ]);
            };

            return (
              <GroupCard
                clickable={clickable}
                dim={currentDim}
                group={group}
                isLeaf={isLeaf}
                key={group.key}
                onClick={clickable ? onClick : undefined}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function Kpi({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "danger" | "default";
  value: string;
}) {
  return (
    <div>
      <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p
        className={`m-0 mt-1 text-lg font-semibold ${
          tone === "danger" ? "text-rose-600 dark:text-rose-300" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function GroupCard({
  clickable,
  dim,
  group,
  isLeaf,
  onClick,
}: {
  clickable: boolean;
  dim: Dim;
  group: Group;
  isLeaf: boolean;
  onClick?: () => void;
}) {
  const Icon = DIM_META[dim].icon;
  const inadimplente = group.overdue > 0 || group.inadimplentes > 0;

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/8 text-[#7a5e2c] ring-1 ring-[#A07C3B]/15 dark:text-[#d9b877]">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <p className="m-0 min-w-0 truncate text-sm font-semibold text-ink">{group.label}</p>
        </div>
        {isLeaf ? (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
              inadimplente
                ? "bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-500/12 dark:text-rose-300 dark:ring-rose-500/20"
                : "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/12 dark:text-emerald-300 dark:ring-emerald-500/20"
            }`}
          >
            {inadimplente ? "Inadimplente" : "Adimplente"}
          </span>
        ) : clickable ? (
          <ChevronRight className="size-4 shrink-0 text-ink-muted/60" aria-hidden="true" />
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-ink-muted">
        {!isLeaf ? <span>{group.compradores} comprador(es)</span> : null}
        <span>{group.unidades} unidade(s)</span>
        {!isLeaf && group.inadimplentes > 0 ? (
          <span className="text-rose-600 dark:text-rose-300">
            {group.inadimplentes} inadimplente(s)
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Carteira
          </p>
          <p className="m-0 mt-0.5 text-sm font-semibold text-ink">{brl(group.total)}</p>
        </div>
        <div>
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Vencido
          </p>
          <p
            className={`m-0 mt-0.5 text-sm font-semibold ${
              group.overdue > 0 ? "text-rose-600 dark:text-rose-300" : "text-ink"
            }`}
          >
            {brl(group.overdue)}
          </p>
        </div>
      </div>
    </>
  );

  if (!clickable) {
    return <div className="rounded-xl border border-line bg-surface p-4">{body}</div>;
  }

  return (
    <button
      className="rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/5"
      onClick={onClick}
      type="button"
    >
      {body}
    </button>
  );
}
