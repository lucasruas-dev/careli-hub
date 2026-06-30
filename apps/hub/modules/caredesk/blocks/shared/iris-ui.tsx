"use client";

import type { ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { Tooltip } from "@repo/uix";

type IrisTone = "gold" | "green" | "red" | "blue" | "neutral";

export function toneBg(tone: IrisTone) {
  if (tone === "gold") return "bg-[#fbf6ec]";
  if (tone === "green") return "bg-emerald-50";
  if (tone === "red") return "bg-rose-50";
  if (tone === "blue") return "bg-sky-50";
  return "bg-[#f4f6fa]";
}

export function toneText(tone: IrisTone) {
  if (tone === "gold") return "text-[#A07C3B]";
  if (tone === "green") return "text-emerald-600";
  if (tone === "red") return "text-rose-600";
  if (tone === "blue") return "text-sky-600";
  return "text-[#63708a]";
}

function formatIrisCount(value: number) {
  return Number(value ?? 0).toLocaleString("pt-BR");
}

export function IrisNavButton({
  active,
  collapsed,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  collapsed: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip
      className="w-full"
      content={label}
      placement={collapsed ? "right" : "top"}
      triggerClassName="w-full"
    >
      <button
        type="button"
        onClick={onClick}
        className={[
          "group relative flex h-11 w-full items-center rounded-lg text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[#d0ad69]",
          collapsed ? "justify-center px-0" : "gap-3 px-3",
          active
            ? "bg-[#2A2B32] text-[#ECECF1]"
            : "text-[#C5C5D2] hover:bg-[#2A2B32]/80 hover:text-[#ECECF1]",
        ].join(" ")}
      >
        {active ? (
          <span className="absolute left-0 top-2 h-7 w-0.5 rounded-full bg-[#A07C3B]" />
        ) : null}
        <span
          className={[
            "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
            active ? "panteon-module-sidebar__active-icon" : "text-[#8E8EA0]",
          ].join(" ")}
        >
          <Icon className="h-[17px] w-[17px]" aria-hidden="true" />
        </span>
        {!collapsed ? <span>{label}</span> : null}
        {active && !collapsed ? (
          <ChevronRight className="ml-auto h-4 w-4 text-[#8E8EA0]" />
        ) : null}
      </button>
    </Tooltip>
  );
}

export function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.06] p-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-white/45">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

export function HeaderMetric({
  icon: Icon,
  label,
  tone = "neutral",
  value,
}: {
  icon: LucideIcon;
  label: string;
  tone?: IrisTone;
  value: string;
}) {
  return (
    <div className="flex h-10 min-w-[118px] items-center gap-2 rounded-xl border border-[#dbe3ef] bg-white px-3">
      <span
        className={[
          "flex h-7 w-7 items-center justify-center rounded-lg",
          toneBg(tone),
        ].join(" ")}
      >
        <Icon className={["h-4 w-4", toneText(tone)].join(" ")} />
      </span>
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#8a96aa]">
          {label}
        </p>
        <p className="text-sm font-semibold text-[#101820]">{value}</p>
      </div>
    </div>
  );
}

export function SignalCard({
  icon: Icon,
  title,
  tone = "neutral",
  value,
}: {
  icon: LucideIcon;
  title: string;
  tone?: IrisTone;
  value: string;
}) {
  return (
    <div className="flex h-full min-h-[72px] flex-col justify-between rounded-2xl border border-[#dbe3ef] bg-white p-3.5 shadow-sm">
      <div className="flex items-center gap-2">
        <span
          className={[
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            toneBg(tone),
          ].join(" ")}
        >
          <Icon className={["h-4 w-4", toneText(tone)].join(" ")} />
        </span>
        <h3 className="truncate text-[11px] font-semibold uppercase tracking-normal text-slate-400">
          {title}
        </h3>
      </div>
      <p className="mt-2 truncate text-2xl font-semibold leading-none text-slate-950">
        {value}
      </p>
    </div>
  );
}

export function IconOnlySignalCard({
  icon: Icon,
  label,
  tone = "neutral",
  tooltip,
}: {
  icon: LucideIcon;
  label: string;
  tone?: IrisTone;
  tooltip: string;
}) {
  return (
    <Tooltip
      className="h-full w-full"
      content={tooltip}
      placement="top"
      triggerClassName="h-full w-full"
    >
      <div className="flex min-h-[84px] items-center justify-center rounded-2xl border border-[#dbe3ef] bg-white p-4 shadow-sm">
        <span
          className={[
            "flex h-11 w-11 items-center justify-center rounded-xl",
            toneBg(tone),
          ].join(" ")}
        >
          <Icon className={["h-5 w-5", toneText(tone)].join(" ")} />
        </span>
        <span className="sr-only">{label}</span>
      </div>
    </Tooltip>
  );
}

export function ActionPanel({
  icon: Icon,
  items,
  title,
}: {
  icon: LucideIcon;
  items: Array<{ detail: string; title: string; value: string }>;
  title: string;
}) {
  return (
    <div className="rounded-2xl border border-[#dbe3ef] bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fbf6ec] text-[#A07C3B]">
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.title}
            className="rounded-xl border border-[#e4eaf3] bg-[#fbfcfe] p-3"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8a96aa]">
              {item.title}
            </p>
            <p className="mt-1 text-sm font-semibold">{item.value}</p>
            <p className="mt-1 line-clamp-2 text-xs text-[#63708a]">
              {item.detail}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BuilderCard({
  icon: Icon,
  rows,
  title,
}: {
  icon: LucideIcon;
  rows: Array<[string, string]>;
  title: string;
}) {
  return (
    <div className="rounded-2xl border border-[#dbe3ef] bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fbf6ec] text-[#A07C3B]">
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="divide-y divide-[#edf1f6]">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-4 py-2 text-sm"
          >
            <span className="text-[#63708a]">{label}</span>
            <span className="text-right font-semibold">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SetupSection({
  icon: Icon,
  items,
  title,
}: {
  icon: LucideIcon;
  items: Array<[string, string]>;
  title: string;
}) {
  return (
    <section className="rounded-2xl border border-[#dbe3ef] bg-white p-4">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fbf6ec] text-[#A07C3B]">
          <Icon className="h-5 w-5" />
        </span>
        <h3 className="text-base font-semibold">{title}</h3>
      </div>
      <div className="space-y-2">
        {items.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 rounded-xl border border-[#e4eaf3] bg-[#fbfcfe] px-3 py-3"
          >
            <span className="text-sm font-semibold">{label}</span>
            <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-[#63708a]">
              {value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SetupField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a96aa]">
        {label}
      </span>
      {children}
    </label>
  );
}

export function ProgressLine({
  label,
  total,
  value,
}: {
  label: string;
  total: number;
  value: number;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="text-[#63708a]">
          {formatIrisCount(value)} | {pct}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#edf1f6]">
        <div
          className="h-full rounded-full bg-[#A07C3B]"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function KpiCard({
  icon: Icon,
  label,
  shortLabel,
  tone = "neutral",
  value,
}: {
  icon: LucideIcon;
  label: string;
  shortLabel: string;
  tone?: "danger" | "gold" | "neutral";
  value: string;
}) {
  const toneClass =
    tone === "danger"
      ? "bg-rose-50 text-rose-700 ring-rose-100"
      : tone === "gold"
        ? "bg-[#A07C3B]/5 text-[#7A5E2C] ring-[#A07C3B]/15"
        : "bg-slate-50 text-slate-700 ring-slate-200";

  return (
    <Tooltip
      className="w-full"
      content={`${label}: ${value}`}
      placement="top"
      triggerClassName="w-full"
    >
      <div className="group flex min-h-14 items-center gap-2 rounded-lg border border-slate-200/70 bg-slate-50/55 px-3 py-2 transition-colors hover:border-[#A07C3B]/20 hover:bg-white">
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 transition-transform group-hover:scale-105 ${toneClass}`}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold leading-5 text-slate-950">
            {value}
          </p>
          <p className="truncate text-[11px] font-semibold uppercase tracking-normal text-slate-400">
            {shortLabel}
          </p>
        </div>
      </div>
    </Tooltip>
  );
}

export function InsightCard({
  description,
  title,
  value,
}: {
  description: string;
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">
        {title}
      </p>
      <p className="mt-1 text-base font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}

export function FilterSelect({
  label,
  onChange,
  optionLabels,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  optionLabels?: Record<string, string>;
  options: string[];
  value: string;
}) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-500">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 w-full bg-transparent text-xs font-semibold text-slate-700 outline-none"
        aria-label={label}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabels?.[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function EmptyState({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="flex min-h-48 items-center justify-center p-8 text-center">
      <div>
        <Icon className="mx-auto h-8 w-8 text-[#A07C3B]" />
        <h3 className="mt-3 text-base font-semibold text-slate-950">{title}</h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
          {description}
        </p>
      </div>
    </div>
  );
}
