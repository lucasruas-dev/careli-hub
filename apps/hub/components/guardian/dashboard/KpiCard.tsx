/* eslint-disable */
// @ts-nocheck
import type { LucideIcon } from "lucide-react";
import { Tooltip } from "@repo/uix";

type KpiAccent = "brand" | "danger" | "ok" | "warn" | "neutral";

type KpiCardProps = {
  title: string;
  value: string;
  valueTitle?: string;
  variation: string;
  description: string;
  icon: LucideIcon;
  accent?: KpiAccent;
  onClick?: () => void;
};

// Acento "metalico" (Lucas 12/jul): so o ICONE ganha cor propria (tile) pra quebrar a
// monotonia; o VALOR fica neutro (Lucas nao quis a escrita colorida). No claro usa a
// cor de intencao; no escuro usa o tom vibrante do Prometeu (coral/verde/ambar/gold).
const ACCENT_ICON: Record<KpiAccent, string> = {
  brand:
    "bg-[#A07C3B]/8 text-[#A07C3B] ring-[#A07C3B]/20 dark:text-[#d9b877] dark:ring-[#A07C3B]/30",
  danger:
    "bg-rose-50 text-rose-600 ring-rose-100 dark:bg-rose-500/12 dark:text-[#e0655a] dark:ring-rose-500/25",
  ok: "bg-emerald-50 text-emerald-600 ring-emerald-100 dark:bg-emerald-500/12 dark:text-[#3fae74] dark:ring-emerald-500/25",
  warn: "bg-amber-50 text-amber-600 ring-amber-100 dark:bg-amber-500/12 dark:text-[#d69a3d] dark:ring-amber-500/25",
  neutral: "bg-subtle text-[#A07C3B] dark:text-[#d9b877] ring-line",
};

export function KpiCard({
  title,
  value,
  valueTitle,
  variation,
  description,
  icon: Icon,
  accent = "neutral",
  onClick,
}: KpiCardProps) {
  const isPositive = variation.startsWith("+");
  const isNegative = variation.startsWith("-");
  const variationColor = isPositive
    ? "text-emerald-600 dark:text-[#3fae74]"
    : isNegative
      ? "text-rose-600 dark:text-[#e0655a]"
      : "text-[#A07C3B] dark:text-[#d9b877]";
  const Wrapper = onClick ? "button" : "article";

  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`w-full rounded-xl border border-line bg-surface p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.45)] ${
        onClick
          ? "cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:border-[#A07C3B]/20 hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)] dark:hover:border-[#A07C3B]/35 dark:hover:shadow-[0_14px_34px_rgba(0,0,0,0.55)]"
          : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-normal text-ink-muted">{title}</p>
          <Tooltip content={valueTitle ?? value} placement="top">
            <span className="mt-2 block text-xl font-semibold tracking-normal text-ink">
              {value}
            </span>
          </Tooltip>
        </div>
        <div className={`flex size-8 items-center justify-center rounded-lg ring-1 ${ACCENT_ICON[accent]}`}>
          <Icon className="size-4 stroke-[1.8]" aria-hidden="true" />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs">
        <span
          className={`font-medium ${variationColor}`}
        >
          {variation}
        </span>
        <span className="truncate text-ink-muted">{description}</span>
      </div>
    </Wrapper>
  );
}
