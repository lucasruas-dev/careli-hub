import type { ReactNode } from "react";

import type { ApoloDocumentSignal } from "@/lib/apolo/types";

// Primitivos visuais compartilhados do Apolo (extraidos do ApoloPage monolitico).
// Sem estado/regra de negocio — apenas apresentacao.

export function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-subtle p-3">
      <p className="m-0 text-xs font-medium text-ink-muted">{label}</p>
      <p className="m-0 mt-2 break-words text-sm font-semibold text-ink">
        {value}
      </p>
    </div>
  );
}

export function InfoButtonTile({
  disabled,
  label,
  onClick,
  value,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
  value: string;
}) {
  return (
    <button
      className="rounded-lg border border-line bg-subtle p-3 text-left transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:bg-subtle"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <p className="m-0 text-xs font-medium text-ink-muted">{label}</p>
      <p className="m-0 mt-2 break-words text-sm font-semibold text-ink">
        {value}
      </p>
    </button>
  );
}

export function ReadonlyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-lg border border-line bg-subtle p-3">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      <span className="break-words text-sm font-semibold text-ink">
        {value}
      </span>
    </div>
  );
}

export function StatusLine({
  label,
  status,
}: {
  label: string;
  status: "attention" | "pending" | "verified";
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-subtle p-3">
      <span className="min-w-0 break-words text-sm font-semibold text-ink">
        {label}
      </span>
      <StatusPill status={status} />
    </div>
  );
}

export function StatusPill({
  status,
}: {
  status: "attention" | "pending" | "verified";
}) {
  const label = {
    attention: "Atencao",
    pending: "Pendente",
    verified: "OK",
  } as const;
  const className = {
    attention: "bg-amber-50 dark:bg-amber-500/12 text-amber-800 dark:text-amber-300 ring-amber-100 dark:ring-amber-500/20",
    pending: "bg-subtle text-ink-soft ring-line",
    verified: "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-100 dark:ring-emerald-500/20",
  } as const;

  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${className[status]}`}
    >
      {label[status]}
    </span>
  );
}

export function DocumentPill({ status }: { status: ApoloDocumentSignal["status"] }) {
  const label = {
    blocked: "Restrito",
    pending_review: "Revisao",
    ready: "Pronto",
  } as const;
  const className = {
    blocked: "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/20",
    pending_review: "bg-amber-50 dark:bg-amber-500/12 text-amber-800 dark:text-amber-300 ring-amber-100 dark:ring-amber-500/20",
    ready: "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-100 dark:ring-emerald-500/20",
  } as const;

  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${className[status]}`}
    >
      {label[status]}
    </span>
  );
}

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-subtle px-2.5 py-1 text-[11px] font-semibold text-ink-soft ring-1 ring-line">
      {children}
    </span>
  );
}

export function PanelTitle({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <div>
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {eyebrow}
      </p>
      <p className="m-0 mt-1 text-base font-semibold text-ink">{title}</p>
    </div>
  );
}

export function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line p-4 text-sm font-semibold text-ink-muted">
      {text}
    </div>
  );
}

export function InsightCard({
  helper,
  icon,
  label,
  value,
}: {
  helper: string;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <article className="rounded-xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-medium text-ink-muted">{label}</p>
          <p className="m-0 mt-2 text-2xl font-semibold leading-none text-ink">
            {value}
          </p>
          <p className="m-0 mt-2 text-xs font-medium text-ink-muted">{helper}</p>
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#7a5e2c] dark:text-[#d9b877] ring-1 ring-[#A07C3B]/15">
          {icon}
        </span>
      </div>
    </article>
  );
}
