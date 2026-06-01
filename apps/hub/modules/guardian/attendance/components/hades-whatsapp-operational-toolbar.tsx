"use client";

import { CalendarCheck, FileText, HandCoins, MessageCircle } from "lucide-react";
import { Tooltip } from "@repo/uix";
import type { OperationDrawerMode } from "@/modules/guardian/attendance/hades-whatsapp-types";

export function HadesWhatsAppOperationalToolbar({
  disabled = false,
  disabledTooltip,
  onOpenOperation,
  onUseTemplate,
  vertical = false,
}: {
  disabled?: boolean;
  disabledTooltip: string;
  onOpenOperation: (mode: OperationDrawerMode) => void;
  onUseTemplate: () => void;
  vertical?: boolean;
}) {
  const actions: Array<{
    icon: typeof MessageCircle;
    label: string;
    onClick: () => void;
  }> = [
    { icon: FileText, label: "Template", onClick: onUseTemplate },
    { icon: CalendarCheck, label: "Promessa", onClick: () => onOpenOperation("promise") },
    { icon: HandCoins, label: "Acordo", onClick: () => onOpenOperation("agreement") },
    { icon: FileText, label: "Enviar boleto", onClick: () => onOpenOperation("boleto") },
    { icon: CalendarCheck, label: "Parcelas", onClick: () => onOpenOperation("installments") },
  ];

  return (
    <div
      className={`flex w-fit gap-1 rounded-lg border border-slate-200/70 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
        vertical ? "flex-wrap" : "items-center"
      }`}
      aria-label="Toolbar operacional"
    >
      {actions.map((action) => (
        <HadesWhatsAppToolbarIconButton
          key={action.label}
          disabled={disabled}
          icon={action.icon}
          onClick={action.onClick}
          tooltip={disabled ? disabledTooltip : action.label}
        />
      ))}
    </div>
  );
}

function HadesWhatsAppToolbarIconButton({
  disabled,
  icon: Icon,
  onClick,
  tooltip,
}: {
  disabled: boolean;
  icon: typeof MessageCircle;
  onClick: () => void;
  tooltip: string;
}) {
  return (
    <Tooltip content={tooltip} placement="top">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-label={tooltip}
        className="flex size-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C] disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
      >
        <Icon className="size-4" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
