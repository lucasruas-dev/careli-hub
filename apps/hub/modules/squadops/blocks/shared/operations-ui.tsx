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
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-subtle text-[#A07C3B] ring-1 ring-line">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="m-0 text-xs font-semibold text-ink-muted">{eyebrow}</p>
        <h2 className="m-0 mt-1 line-clamp-2 text-base font-semibold text-ink">
          {title}
        </h2>
      </div>
    </div>
  );
}

export function DetailField({ label, value }: DetailValueProps) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <p className="m-0 text-xs font-semibold text-ink-muted">{label}</p>
      <p className="m-0 mt-1 text-sm font-semibold leading-5 text-ink">
        {value}
      </p>
    </div>
  );
}

export function DetailBlock({ label, value }: DetailValueProps) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <p className="m-0 text-xs font-semibold text-ink-muted">{label}</p>
      <p className="m-0 mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">
        {value}
      </p>
    </div>
  );
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <p className="m-0 rounded-xl bg-subtle p-4 text-sm text-ink-muted ring-1 ring-line">
      {message}
    </p>
  );
}
