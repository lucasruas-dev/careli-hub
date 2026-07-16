"use client";

import {
  CircleDollarSign,
  Handshake,
  History,
  Home,
  Loader2,
  MessageCircle,
  TriangleAlert,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  ApoloTimelineData,
  ApoloTimelineEntry,
  ApoloTimelineSource,
} from "@/lib/apolo/timeline";
import type { ApoloEntity } from "@/lib/apolo/types";

import { entityC2xId } from "../../data/apolo-derive";
import { getApoloAccessToken } from "../../data/apolo-operations";

// Histórico = ficha corrida da entidade: registra TODOS os eventos do Panteon num só lugar
// (venda, pagamento, atendimento, negociação, reunião), ordenados do mais recente. A premissa
// é exaustividade — puxa tudo, não uma lista curada. Ver [[project_apolo_timeline]].

// Cor por FONTE (bater o olho e saber do que se trata). Ícones distintos, sem bolinha de status.
const SOURCE_META: Record<
  ApoloTimelineSource,
  { color: string; icon: LucideIcon; label: string }
> = {
  chronos: {
    color: "bg-indigo-500/10 text-indigo-600 ring-indigo-500/20 dark:text-indigo-400",
    icon: Video,
    label: "Reuniões",
  },
  hades: {
    color: "bg-amber-500/10 text-amber-600 ring-amber-500/20 dark:text-amber-400",
    icon: Handshake,
    label: "Negociações",
  },
  iris: {
    color: "bg-violet-500/10 text-violet-600 ring-violet-500/20 dark:text-violet-400",
    icon: MessageCircle,
    label: "Atendimentos",
  },
  pagamento: {
    color: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400",
    icon: CircleDollarSign,
    label: "Pagamentos",
  },
  venda: {
    color: "bg-sky-500/10 text-sky-600 ring-sky-500/20 dark:text-sky-400",
    icon: Home,
    label: "Vendas",
  },
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function isoDay(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function EntityTimelinePanel({ entity }: { entity: ApoloEntity }) {
  const c2xId = entityC2xId(entity);
  // Identidade = contatos da entidade + os relacionamentos "contato" (cônjuge, representante…).
  // Se um contato falar com a gente pela Iris, o ticket dele entra no histórico da entidade.
  const emails = useMemo(
    () =>
      unique([
        ...entity.contacts.filter((c) => c.type === "email").map((c) => c.value),
        ...entity.relationships.map((r) => r.email ?? ""),
      ].map((value) => value.trim().toLowerCase())),
    [entity.contacts, entity.relationships],
  );
  const phones = useMemo(
    () =>
      unique([
        ...entity.contacts
          .filter((c) => c.type === "phone" || c.type === "whatsapp")
          .map((c) => c.value),
        ...entity.relationships.map((r) => r.phone ?? ""),
      ].map((value) => value.replace(/\D/g, ""))),
    [entity.contacts, entity.relationships],
  );

  const [data, setData] = useState<ApoloTimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<ApoloTimelineSource | "all">("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    if (c2xId == null && emails.length === 0 && phones.length === 0) {
      setLoading(false);
      setData({ counts: { chronos: 0, hades: 0, iris: 0, pagamento: 0, venda: 0 }, entries: [] });
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const token = await getApoloAccessToken();
        const query = new URLSearchParams();
        if (c2xId != null) {
          query.set("c2xId", String(c2xId));
        }
        if (emails.length) {
          query.set("emails", emails.join(","));
        }
        if (phones.length) {
          query.set("phones", phones.join(","));
        }

        const response = await fetch(`/api/apolo/timeline?${query.toString()}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = (await response.json().catch(() => null)) as
          | { data?: ApoloTimelineData; error?: string }
          | null;

        if (!active) {
          return;
        }

        if (!response.ok || !payload?.data) {
          setError(payload?.error ?? "Não foi possível carregar a timeline.");
          setData(null);
          return;
        }

        setData(payload.data);
      } catch {
        if (active) {
          setError("Não foi possível carregar a timeline.");
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
  }, [c2xId, emails, phones]);

  const entries = useMemo(() => {
    return (data?.entries ?? []).filter((entry) => {
      if (sourceFilter !== "all" && entry.source !== sourceFilter) {
        return false;
      }
      const day = isoDay(entry.date);
      if (fromDate && day < fromDate) {
        return false;
      }
      if (toDate && day > toDate) {
        return false;
      }
      return true;
    });
  }, [data, sourceFilter, fromDate, toDate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-line bg-surface p-10 text-sm font-medium text-ink-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Montando a ficha corrida…
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

  const counts = data?.counts ?? { chronos: 0, hades: 0, iris: 0, pagamento: 0, venda: 0 };
  const totalCount = data?.entries.length ?? 0;

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <FilterChip
            active={sourceFilter === "all"}
            count={totalCount}
            label="Tudo"
            onClick={() => setSourceFilter("all")}
          />
          {(Object.keys(SOURCE_META) as ApoloTimelineSource[]).map((source) => (
            <FilterChip
              active={sourceFilter === source}
              color={SOURCE_META[source].color}
              count={counts[source]}
              icon={SOURCE_META[source].icon}
              key={source}
              label={SOURCE_META[source].label}
              onClick={() => setSourceFilter(source)}
            />
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            aria-label="De"
            className="h-9 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            max={toDate || undefined}
            onChange={(event) => setFromDate(event.target.value)}
            type="date"
            value={fromDate}
          />
          <span className="text-xs text-ink-muted">até</span>
          <input
            aria-label="Até"
            className="h-9 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            min={fromDate || undefined}
            onChange={(event) => setToDate(event.target.value)}
            type="date"
            value={toDate}
          />
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-6 text-sm font-medium text-ink-muted">
          <History className="size-4" aria-hidden="true" />
          Nenhum registro no período.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-surface px-4">
          <ol className="m-0 list-none p-0">
            {entries.map((entry) => (
              <TimelineRow entry={entry} key={entry.id} />
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function TimelineRow({ entry }: { entry: ApoloTimelineEntry }) {
  const meta = SOURCE_META[entry.source];
  const Icon = meta.icon;

  return (
    <li className="flex items-start justify-between gap-3 border-b border-line/60 py-3 last:border-0">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ${meta.color}`}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="m-0 text-sm font-semibold text-ink">{entry.title}</p>
          <p className="m-0 mt-0.5 truncate text-xs font-medium text-ink-muted">
            {entry.description}
            {entry.reference ? ` · ${entry.reference}` : ""}
          </p>
        </div>
      </div>
      <p className="m-0 shrink-0 whitespace-nowrap text-xs font-medium text-ink-muted">
        {formatDate(entry.date)}
      </p>
    </li>
  );
}

function FilterChip({
  active,
  color,
  count,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  color?: string;
  count: number;
  icon?: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  // A cor da fonte fica no ÍCONE (identifica visualmente); o chip ativo ganha o realce dourado.
  const iconColor = active ? "" : (color ?? "").split(" ").filter((c) => c.startsWith("text-")).join(" ");

  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? "border-[#A07C3B]/30 bg-[#A07C3B]/8 text-[#7a5e2c] dark:text-[#d9b877]"
          : "border-line bg-surface text-ink-muted hover:text-ink"
      }`}
      onClick={onClick}
      type="button"
    >
      {Icon ? <Icon className={`size-3.5 ${iconColor}`} aria-hidden="true" /> : null}
      {label}
      <span className="rounded-full bg-subtle px-1.5 text-[11px] font-semibold text-ink-muted">
        {count}
      </span>
    </button>
  );
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
