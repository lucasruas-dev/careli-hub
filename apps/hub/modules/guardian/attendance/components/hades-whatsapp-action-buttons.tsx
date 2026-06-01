"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Tooltip } from "@repo/uix";

export function HadesWhatsAppHeaderToolbarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} placement="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="flex size-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C] focus-visible:ring-2 focus-visible:ring-[#A07C3B]/20"
      >
        <Icon className="size-4" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

export function HadesWhatsAppComposerIconButton({
  children,
  disabled = false,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} placement="top">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-label={label}
        className="flex size-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-white hover:text-[#A07C3B] disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
      >
        {children}
      </button>
    </Tooltip>
  );
}
