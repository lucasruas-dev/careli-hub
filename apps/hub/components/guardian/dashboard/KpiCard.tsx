/* eslint-disable */
// @ts-nocheck
import type { LucideIcon } from "lucide-react";
import { Tooltip } from "@repo/uix";

type KpiCardProps = {
  title: string;
  value: string;
  valueTitle?: string;
  variation: string;
  description: string;
  icon: LucideIcon;
  onClick?: () => void;
};

export function KpiCard({
  title,
  value,
  valueTitle,
  variation,
  description,
  icon: Icon,
  onClick,
}: KpiCardProps) {
  const isPositive = variation.startsWith("+");
  const isNegative = variation.startsWith("-");
  const variationColor = isPositive
    ? "text-emerald-600"
    : isNegative
      ? "text-rose-600"
      : "text-[#A07C3B]";
  const Wrapper = onClick ? "button" : "article";

  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`w-full rounded-xl border border-slate-200/70 bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
        onClick
          ? "cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:border-[#A07C3B]/20 hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)]"
          : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">{title}</p>
          <Tooltip content={valueTitle ?? value} placement="top">
            <span className="mt-2 block text-xl font-semibold tracking-normal text-slate-950">
              {value}
            </span>
          </Tooltip>
        </div>
        <div className="flex size-8 items-center justify-center rounded-lg bg-slate-50 text-[#A07C3B] ring-1 ring-slate-200/70">
          <Icon className="size-4 stroke-[1.8]" aria-hidden="true" />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs">
        <span
          className={`font-medium ${variationColor}`}
        >
          {variation}
        </span>
        <span className="truncate text-slate-500">{description}</span>
      </div>
    </Wrapper>
  );
}




