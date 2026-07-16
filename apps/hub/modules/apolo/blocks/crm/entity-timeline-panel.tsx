"use client";

import {
  CircleDollarSign,
  Clock3,
  Handshake,
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

// Timeline = ficha corrida da entidade: agrega Iris/Hades/Chronos + pagamentos num só lugar,
// ordenado do mais recente. Ver [[project_apolo_timeline]].

const SOURCE_META: Record<
  ApoloTimelineSource,
  { icon: LucideIcon; label: string }
> = {
  chronos: { icon: Video, label: "Reuniões" },
  hades: { icon: Handshake, label: "Negociações" },
  iris: { icon: MessageCircle, label: "Atendimentos" },
  pagamento: { icon: CircleDollarSign, label: "Pagamentos" },
};

const STATUS_DOT: Record<ApoloTimelineEntry["status"], string> = {
  attention: "bg-amber-500",
  blocked: "bg-rose-500",
  info: "bg-slate-400",
  ok: "bg-emerald-500",
};

function brl(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function EntityTimelinePanel({ entity }: { entity: ApoloEntity }) {
  const c2xId = entityC2xId(entity);
  const emails = useMemo(
    () =>
      entity.contacts
        .filter((contact) => contact.type === "email")
        .map((contact) => contact.value.trim().toLowerCase())
        .filter(Boolean),
    [entity.contacts],
  );
  const phones = useMemo(
    () =>
      entity.contacts
        .filter((contact) => contact.type === "phone" || contact.type === "whatsapp")
        .map((contact) => contact.value.replace(/\D/g, ""))
        .filter(Boolean),
    [entity.contacts],
  );

  const [data, setData] = useState<ApoloTimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<ApoloTimelineSource | "all">("all");

  useEffect(() => {
    if (c2xId == null && emails.length === 0 && phones.length === 0) {
      setLoading(false);
      setData({ counts: { chronos: 0, hades: 0, iris: 0, pagamento: 0 }, entries: [] });
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
    const all = data?.entries ?? [];
    return sourceFilter === "all"
      ? all
      : all.filter((entry) => entry.source === sourceFilter);
  }, [data, sourceFilter]);

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

  const counts = data?.counts ?? { chronos: 0, hades: 0, iris: 0, pagamento: 0 };
  const totalCount = data?.entries.length ?? 0;

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
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
            count={counts[source]}
            icon={SOURCE_META[source].icon}
            key={source}
            label={SOURCE_META[source].label}
            onClick={() => setSourceFilter(source)}
          />
        ))}
      </div>

      {entries.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-6 text-sm font-medium text-ink-muted">
          <Clock3 className="size-4" aria-hidden="true" />
          Nenhum registro na ficha corrida ainda.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-surface p-4">
          <ol className="relative ml-2 border-l border-line">
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
  const Icon = SOURCE_META[entry.source].icon;

  return (
    <li className="relative mb-5 ml-6 last:mb-0">
      <span
        className={`absolute -left-[1.9rem] top-1 size-3 rounded-full ring-4 ring-surface ${STATUS_DOT[entry.status]}`}
        aria-hidden="true"
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/8 text-[#7a5e2c] ring-1 ring-[#A07C3B]/15 dark:text-[#d9b877]">
            <Icon className="size-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-sm font-semibold text-ink">{entry.title}</p>
            <p className="m-0 mt-0.5 truncate text-xs font-medium text-ink-muted">
              {entry.description}
              {entry.reference ? ` · ${entry.reference}` : ""}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          {entry.amount != null ? (
            <p className="m-0 text-sm font-semibold text-ink">{brl(entry.amount)}</p>
          ) : null}
          <p className="m-0 text-xs font-medium text-ink-muted">{formatDate(entry.date)}</p>
        </div>
      </div>
    </li>
  );
}

function FilterChip({
  active,
  count,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  icon?: LucideIcon;
  label: string;
  onClick: () => void;
}) {
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
      {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
      {label}
      <span className="rounded-full bg-subtle px-1.5 text-[11px] font-semibold text-ink-muted">
        {count}
      </span>
    </button>
  );
}
