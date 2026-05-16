/* eslint-disable */
// @ts-nocheck
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type DetailSectionProps = {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  accent?: boolean;
  className?: string;
};

export function DetailSection({
  title,
  icon: Icon,
  children,
  accent = false,
  className = "",
}: DetailSectionProps) {
  return (
    <section
      className={`rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}
    >
      <div className="mb-3 flex items-center gap-2.5">
        <div
          className={`flex size-8 items-center justify-center rounded-lg ring-1 ${
            accent
              ? "bg-[#A07C3B]/5 text-[#A07C3B] ring-[#A07C3B]/15"
              : "bg-slate-50 text-slate-600 ring-slate-200/70"
          }`}
        >
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      </div>
      {children}
    </section>
  );
}




