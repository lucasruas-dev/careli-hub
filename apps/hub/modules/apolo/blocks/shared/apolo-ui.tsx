import type { ReactNode } from "react";

import type { ApoloDocumentSignal } from "@/lib/apolo/types";

// Primitivos visuais compartilhados do Apolo (extraidos do ApoloPage monolitico).
// Sem estado/regra de negocio — apenas apresentacao.

export function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200/70 bg-slate-50/70 p-3">
      <p className="m-0 text-xs font-medium text-slate-500">{label}</p>
      <p className="m-0 mt-2 break-words text-sm font-semibold text-slate-950">
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
      className="rounded-lg border border-slate-200/70 bg-slate-50/70 p-3 text-left transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 disabled:cursor-not-allowed disabled:hover:border-slate-200/70 disabled:hover:bg-slate-50/70"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <p className="m-0 text-xs font-medium text-slate-500">{label}</p>
      <p className="m-0 mt-2 break-words text-sm font-semibold text-slate-950">
        {value}
      </p>
    </button>
  );
}

export function ReadonlyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-lg border border-slate-200/70 bg-slate-50/70 p-3">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className="break-words text-sm font-semibold text-slate-950">
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/70 bg-slate-50/70 p-3">
      <span className="min-w-0 break-words text-sm font-semibold text-slate-950">
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
    attention: "bg-amber-50 text-amber-800 ring-amber-100",
    pending: "bg-slate-50 text-slate-600 ring-slate-200/70",
    verified: "bg-emerald-50 text-emerald-700 ring-emerald-100",
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
    blocked: "bg-rose-50 text-rose-700 ring-rose-100",
    pending_review: "bg-amber-50 text-amber-800 ring-amber-100",
    ready: "bg-emerald-50 text-emerald-700 ring-emerald-100",
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
    <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/70">
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
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
        {eyebrow}
      </p>
      <p className="m-0 mt-1 text-base font-semibold text-slate-950">{title}</p>
    </div>
  );
}

export function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm font-semibold text-slate-500">
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
    <article className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-medium text-slate-500">{label}</p>
          <p className="m-0 mt-2 text-2xl font-semibold leading-none text-slate-950">
            {value}
          </p>
          <p className="m-0 mt-2 text-xs font-medium text-slate-500">{helper}</p>
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
          {icon}
        </span>
      </div>
    </article>
  );
}
