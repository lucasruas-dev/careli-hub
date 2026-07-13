/* eslint-disable */
// @ts-nocheck
import type { AttendancePriority } from "@/modules/guardian/attendance/types";

export const priorityStyles: Record<AttendancePriority, string> = {
  Crítica: "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/25",
  Alta: "bg-[#A07C3B]/8 text-[#7A5E2C] dark:text-[#d9b877] ring-[#A07C3B]/15",
  Média: "bg-slate-50 dark:bg-white/[0.06] text-slate-700 dark:text-ink ring-slate-200 dark:ring-white/10",
  Baixa: "bg-slate-50 dark:bg-white/[0.06] text-slate-500 dark:text-ink-muted ring-slate-200 dark:ring-white/10",
};




