"use client";

import {
  CircleDollarSign,
  Handshake,
  History,
  Home,
  Loader2,
  MessageCircle,
  PenLine,
  Plus,
  TriangleAlert,
  Video,
  X,
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

// Histórico = ficha corrida da entidade: registra TODOS os eventos do Panteon (venda, pagamento,
// atendimento, negociação, reunião) + registros manuais, agrupados por dia numa linha do tempo.
// A premissa é exaustividade. Ver [[project_apolo_timeline]].

// Cor por FONTE (bater o olho e saber do que se trata).
const SOURCE_META: Record<
  ApoloTimelineSource,
  { color: string; icon: LucideIcon; label: string }
> = {
  chronos: {
    color: "bg-indigo-500/10 text-indigo-600 ring-indigo-500/25 dark:text-indigo-400",
    icon: Video,
    label: "Reuniões",
  },
  hades: {
    color: "bg-amber-500/10 text-amber-600 ring-amber-500/25 dark:text-amber-400",
    icon: Handshake,
    label: "Negociações",
  },
  iris: {
    color: "bg-violet-500/10 text-violet-600 ring-violet-500/25 dark:text-violet-400",
    icon: MessageCircle,
    label: "Atendimentos",
  },
  manual: {
    color: "bg-[#A07C3B]/12 text-[#7a5e2c] ring-[#A07C3B]/25 dark:text-[#d9b877]",
    icon: PenLine,
    label: "Manuais",
  },
  pagamento: {
    color: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400",
    icon: CircleDollarSign,
    label: "Pagamentos",
  },
  venda: {
    color: "bg-sky-500/10 text-sky-600 ring-sky-500/25 dark:text-sky-400",
    icon: Home,
    label: "Vendas",
  },
};

const MANUAL_CATEGORIES = [
  "Ligação",
  "E-mail",
  "WhatsApp",
  "Reunião",
  "Visita",
  "Nota interna",
  "Outro",
];

function isoDay(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(day: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (day === today) {
    return "Hoje";
  }
  if (day === yesterday) {
    return "Ontem";
  }
  const date = new Date(`${day}T12:00:00`);
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export function EntityTimelinePanel({ entity }: { entity: ApoloEntity }) {
  const c2xId = entityC2xId(entity);
  const entityId = entity.id;
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
  const [reloadKey, setReloadKey] = useState(0);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const token = await getApoloAccessToken();
        const query = new URLSearchParams({ entityId });
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
          setError(payload?.error ?? "Não foi possível carregar o histórico.");
          setData(null);
          return;
        }

        setData(payload.data);
      } catch {
        if (active) {
          setError("Não foi possível carregar o histórico.");
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
  }, [c2xId, entityId, emails, phones, reloadKey]);

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

  // Agrupa por dia, preservando a ordem (mais recente primeiro).
  const groups = useMemo(() => {
    const map = new Map<string, ApoloTimelineEntry[]>();
    for (const entry of entries) {
      const day = isoDay(entry.date);
      const list = map.get(day);
      if (list) {
        list.push(entry);
      } else {
        map.set(day, [entry]);
      }
    }
    return Array.from(map.entries());
  }, [entries]);

  const counts = data?.counts ?? {
    chronos: 0,
    hades: 0,
    iris: 0,
    manual: 0,
    pagamento: 0,
    venda: 0,
  };
  const totalCount = data?.entries.length ?? 0;

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
          <button
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[#A07C3B] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#8a6a33]"
            onClick={() => setAdding(true)}
            type="button"
          >
            <Plus className="size-4" aria-hidden="true" />
            Registrar
          </button>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-surface p-10 text-sm font-medium text-ink-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Montando o histórico…
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-6 text-sm font-medium text-rose-600 dark:text-rose-300">
          <TriangleAlert className="size-4" aria-hidden="true" />
          {error}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-surface p-10 text-center text-sm font-medium text-ink-muted">
          <History className="size-6 opacity-40" aria-hidden="true" />
          Nenhum registro no período. Use “Registrar” pra lançar um evento manual.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-surface px-4 py-1">
          {groups.map(([day, items]) => (
            <div key={day}>
              <p className="sticky top-0 z-10 m-0 bg-surface/95 py-2.5 text-[11px] font-bold uppercase tracking-wide text-ink-muted backdrop-blur">
                {dayLabel(day)}
              </p>
              <ol className="m-0 list-none border-l border-line p-0">
                {items.map((entry) => (
                  <TimelineRow entry={entry} key={entry.id} />
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <AddEventModal
          entityId={entityId}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setReloadKey((key) => key + 1);
          }}
        />
      ) : null}
    </section>
  );
}

function TimelineRow({ entry }: { entry: ApoloTimelineEntry }) {
  const meta = SOURCE_META[entry.source];
  const Icon = meta.icon;

  return (
    <li className="relative flex items-start gap-3 py-3 pl-7">
      <span
        className={`absolute -left-[15px] top-3 flex size-7 items-center justify-center rounded-full ring-4 ring-surface ${meta.color}`}
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="m-0 truncate text-sm font-semibold text-ink">{entry.title}</p>
          <p className="m-0 shrink-0 text-xs font-medium text-ink-muted">{formatTime(entry.date)}</p>
        </div>
        <p className="m-0 mt-0.5 truncate text-xs font-medium text-ink-muted">
          {entry.description}
          {entry.reference ? ` · ${entry.reference}` : ""}
        </p>
        {entry.manual && entry.author ? (
          <p className="m-0 mt-1 text-[11px] font-semibold text-[#7a5e2c] dark:text-[#d9b877]">
            Manual · {entry.author}
          </p>
        ) : null}
      </div>
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
  const iconColor = active
    ? ""
    : (color ?? "").split(" ").filter((c) => c.startsWith("text-")).join(" ");

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

function AddEventModal({
  entityId,
  onClose,
  onSaved,
}: {
  entityId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [category, setCategory] = useState(MANUAL_CATEGORIES[0]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => {
    const now = new Date();
    const off = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - off).toISOString().slice(0, 16);
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const save = async () => {
    if (!title.trim()) {
      setFormError("Informe um título.");
      return;
    }
    setSaving(true);
    setFormError(null);

    try {
      const token = await getApoloAccessToken();
      const response = await fetch("/api/apolo/timeline", {
        body: JSON.stringify({
          category,
          description,
          entityId,
          occurredAt: new Date(occurredAt).toISOString(),
          title,
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setFormError(payload?.error ?? "Não foi possível registrar.");
        return;
      }

      onSaved();
    } catch {
      setFormError("Não foi possível registrar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="m-0 text-base font-semibold text-ink">Registrar evento</h3>
          <button
            aria-label="Fechar"
            className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-subtle"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <p className="m-0 mt-1 text-xs font-medium text-ink-muted">
          Uma ação que o hub não capturou (ligação, visita, nota…).
        </p>

        <div className="mt-4 grid gap-3">
          <Field label="Tipo">
            <select
              className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onChange={(event) => setCategory(event.target.value)}
              value={category}
            >
              {MANUAL_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Título">
            <input
              className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: Liguei para confirmar o pagamento"
              value={title}
            />
          </Field>
          <Field label="Descrição">
            <textarea
              className="min-h-[72px] w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Detalhes do que aconteceu (opcional)"
              value={description}
            />
          </Field>
          <Field label="Data e hora">
            <input
              className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onChange={(event) => setOccurredAt(event.target.value)}
              type="datetime-local"
              value={occurredAt}
            />
          </Field>
        </div>

        {formError ? (
          <p className="m-0 mt-3 text-xs font-semibold text-rose-600 dark:text-rose-300">
            {formError}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="h-9 rounded-lg border border-line px-4 text-sm font-semibold text-ink-soft hover:bg-subtle"
            onClick={onClose}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#A07C3B] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#8a6a33] disabled:opacity-60"
            disabled={saving}
            onClick={save}
            type="button"
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Registrar
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
