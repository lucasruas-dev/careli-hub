import type { AttendancePriority } from "@/modules/attendance/types";

export const priorityStyles: Record<AttendancePriority, string> = {
  Crítica: "bg-rose-50 text-rose-700 ring-rose-100",
  Alta: "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/15",
  Média: "bg-slate-50 text-slate-700 ring-slate-200",
  Baixa: "bg-slate-50 text-slate-500 ring-slate-200",
};
