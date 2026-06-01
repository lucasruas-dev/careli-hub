"use client";

import { Inbox, MapPinned, MessageCircle, type LucideIcon } from "lucide-react";
import { Tooltip } from "@repo/uix";

import type { AttendanceSection } from "@/modules/guardian/attendance/attendance-routing";

type AttendanceNavigationItem = {
  id: AttendanceSection;
  label: string;
  badge?: string;
  icon: LucideIcon;
};

const attendanceSections: AttendanceNavigationItem[] = [
  { id: "queue", label: "Fila operacional", icon: Inbox },
  { id: "desk", label: "Iris", badge: "3", icon: MessageCircle },
  { id: "portfolio", label: "Carteira", icon: MapPinned },
];

type AttendanceSectionNavigationProps = {
  activeSection: AttendanceSection;
  onSectionChange: (section: AttendanceSection) => void;
};

export function AttendanceSectionNavigation({
  activeSection,
  onSectionChange,
}: AttendanceSectionNavigationProps) {
  return (
    <nav
      className="flex w-fit gap-1 overflow-x-auto rounded-xl border border-slate-200/70 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      aria-label="Modulos de cobranca"
    >
      {attendanceSections.map((section) => {
        const Icon = section.icon;
        const active = activeSection === section.id;

        return (
          <Tooltip key={section.id} content={section.label} placement="bottom">
            <button
              type="button"
              onClick={() => onSectionChange(section.id)}
              aria-label={section.label}
              className={`relative inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                active
                  ? "bg-[#A07C3B]/10 text-[#7A5E2C] ring-1 ring-[#A07C3B]/20"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon className="size-4" aria-hidden="true" />
              {section.badge ? (
                <span className="absolute -right-1 -top-1 rounded-full bg-[#A07C3B] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                  {section.badge}
                </span>
              ) : null}
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );
}
