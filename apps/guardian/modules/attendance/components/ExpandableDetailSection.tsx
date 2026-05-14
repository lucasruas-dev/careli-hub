"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { DetailSection } from "@/modules/attendance/components/DetailSection";
import type { LucideIcon } from "lucide-react";

type InfoItem = {
  label: string;
  value: string;
};

type ExpandableDetailSectionProps = {
  title: string;
  icon: LucideIcon;
  primaryItems: InfoItem[];
  expandedItems: InfoItem[];
  buttonLabel?: string;
  expandedLayout?: "grid" | "list";
  className?: string;
};

export function ExpandableDetailSection({
  title,
  icon,
  primaryItems,
  expandedItems,
  buttonLabel = "Ver mais",
  expandedLayout = "grid",
  className,
}: ExpandableDetailSectionProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <DetailSection title={title} icon={icon} className={className}>
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {primaryItems.map((item) => (
          <InfoBlock key={item.label} label={item.label} value={item.value} />
        ))}
      </div>

      {expanded ? (
        <div className="mt-4 rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
          <div
            className={
              expandedLayout === "list"
                ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
                : "grid gap-3 sm:grid-cols-2"
            }
          >
            {expandedItems.map((item) => (
              <InfoBlock
                key={item.label}
                label={item.label}
                value={item.value}
                truncateValue={item.label === "E-mail"}
              />
            ))}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        title={expanded ? "Ver menos" : buttonLabel}
        aria-label={expanded ? "Ver menos" : buttonLabel}
        className="mt-4 inline-flex size-8 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-700 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
      >
        <ChevronDown
          className={`size-4 text-[#A07C3B] transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>
    </DetailSection>
  );
}

function InfoBlock({
  label,
  value,
  truncateValue = true,
}: {
  label: string;
  value: string;
  truncateValue?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200/70 bg-slate-50/60 px-3 py-2.5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p
        className={`mt-1 text-sm font-semibold text-slate-950 ${
          truncateValue ? "truncate" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
