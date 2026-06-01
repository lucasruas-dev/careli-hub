import { Tooltip } from "@repo/uix";

import type { TicketChecklistItem } from "@/modules/guardian/attendance/hades-whatsapp-types";

type HadesWhatsAppTicketChecklistProps = {
  className?: string;
  compact?: boolean;
  items: TicketChecklistItem[];
};

export function HadesWhatsAppTicketChecklist({
  className = "",
  compact = false,
  items,
}: HadesWhatsAppTicketChecklistProps) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {items.map((item) => (
        <Tooltip key={item.id} content={item.ok ? `${item.label} validado` : `${item.label} obrigatório`} placement="top">
          <span
            className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold ring-1 ${
              item.ok
                ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                : "bg-amber-50 text-amber-800 ring-amber-200"
            } ${compact ? "px-1.5" : ""}`}
          >
            <span aria-hidden="true">{item.ok ? "?" : "!"}</span>
            {item.label}
          </span>
        </Tooltip>
      ))}
    </div>
  );
}
