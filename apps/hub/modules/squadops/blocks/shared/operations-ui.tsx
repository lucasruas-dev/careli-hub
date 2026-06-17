import type { ReactNode } from "react";

type PanelTitleProps = {
  eyebrow: string;
  icon: ReactNode;
  title: string;
};

type DetailValueProps = {
  label: string;
  value: string;
};

type EmptyStateProps = {
  message: string;
};

export function PanelTitle({ eyebrow, icon, title }: PanelTitleProps) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-[#A07C3B] ring-1 ring-slate-200/70">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="m-0 text-xs font-semibold text-slate-500">{eyebrow}</p>
        <h2 className="m-0 mt-1 line-clamp-2 text-base font-semibold text-slate-950">
          {title}
        </h2>
      </div>
    </div>
  );
}

export function DetailField({ label, value }: DetailValueProps) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <p className="m-0 text-xs font-semibold text-slate-500">{label}</p>
      <p className="m-0 mt-1 text-sm font-semibold leading-5 text-slate-950">
        {value}
      </p>
    </div>
  );
}

export function DetailBlock({ label, value }: DetailValueProps) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <p className="m-0 text-xs font-semibold text-slate-500">{label}</p>
      <p className="m-0 mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
        {value}
      </p>
    </div>
  );
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <p className="m-0 rounded-xl bg-slate-50/70 p-4 text-sm text-slate-500 ring-1 ring-slate-200/70">
      {message}
    </p>
  );
}
