import type { AgreementRisk, AgreementStatus } from "@/modules/attendance/types";

export const agreementStatusStyles: Record<AgreementStatus, string> = {
  "Em negociação": "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/15",
  Formalizando: "bg-indigo-50 text-indigo-700 ring-indigo-100",
  Ativo: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  Pago: "bg-slate-50 text-slate-600 ring-slate-200",
  Quebrado: "bg-rose-50 text-rose-700 ring-rose-100",
  Reativado: "bg-teal-50 text-teal-700 ring-teal-100",
  Cancelado: "bg-zinc-100 text-zinc-700 ring-zinc-200",
};

export const agreementRiskStyles: Record<AgreementRisk, string> = {
  Baixo: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  Moderado: "bg-amber-50 text-amber-700 ring-amber-100",
  Alto: "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/15",
  Crítico: "bg-rose-50 text-rose-700 ring-rose-100",
};

export const agreementDueDateStyles = {
  Pago: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  "A vencer": "bg-slate-50 text-slate-600 ring-slate-200",
  Vencido: "bg-rose-50 text-rose-700 ring-rose-100",
  Reprogramado: "bg-indigo-50 text-indigo-700 ring-indigo-100",
} as const;
