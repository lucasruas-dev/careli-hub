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
      className={`rounded-xl border border-line/70 bg-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.45)] ${className}`}
    >
      <div className="mb-3 flex items-center gap-2.5">
        <div
          className={`flex size-8 items-center justify-center rounded-lg ring-1 ${
            accent
              ? "bg-[#A07C3B]/5 text-[#A07C3B] ring-[#A07C3B]/15"
              : "bg-subtle text-ink-soft ring-line/70"
          }`}
        >
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
      </div>
      {children}
    </section>
  );
}




