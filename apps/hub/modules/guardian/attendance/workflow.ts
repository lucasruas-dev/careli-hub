/* eslint-disable */
// @ts-nocheck
import type { WorkflowStage } from "@/modules/guardian/attendance/types";

export const workflowStages: WorkflowStage[] = [
  "A acionar",
  "Contato",
  "Negociação",
  "Promessa de pagamento",
  "Acordo",
  "Quebra",
  "Jurídico",
];

export const workflowStageStyles: Record<WorkflowStage, string> = {
  "A acionar": "bg-sky-50 dark:bg-sky-500/12 text-sky-700 dark:text-sky-300 ring-sky-100 dark:ring-sky-500/25",
  Contato: "bg-indigo-50 dark:bg-indigo-500/12 dark:bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 dark:text-indigo-300 ring-indigo-100 dark:ring-indigo-500/25 dark:ring-indigo-500/25",
  Negociação: "bg-[#A07C3B]/8 text-[#7A5E2C] dark:text-[#d9b877] ring-[#A07C3B]/15",
  "Promessa de pagamento": "bg-teal-50 dark:bg-teal-500/12 dark:bg-teal-500/12 text-teal-700 dark:text-teal-300 dark:text-teal-300 ring-teal-100 dark:ring-teal-500/25 dark:ring-teal-500/25",
  Acordo: "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-100 dark:ring-emerald-500/25",
  Quebra: "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/25",
  Jurídico: "bg-zinc-100 dark:bg-white/[0.08] text-zinc-700 dark:text-ink ring-zinc-200 dark:ring-white/10",
  "Novo atraso": "bg-sky-50 dark:bg-sky-500/12 text-sky-700 dark:text-sky-300 ring-sky-100 dark:ring-sky-500/25",
  "Primeiro contato": "bg-indigo-50 dark:bg-indigo-500/12 dark:bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 dark:text-indigo-300 ring-indigo-100 dark:ring-indigo-500/25 dark:ring-indigo-500/25",
  "Sem retorno": "bg-slate-50 dark:bg-white/[0.06] text-slate-600 ring-slate-200 dark:ring-white/10",
  "Em negociação": "bg-[#A07C3B]/8 text-[#7A5E2C] dark:text-[#d9b877] ring-[#A07C3B]/15",
  "Promessa realizada": "bg-teal-50 dark:bg-teal-500/12 dark:bg-teal-500/12 text-teal-700 dark:text-teal-300 dark:text-teal-300 ring-teal-100 dark:ring-teal-500/25 dark:ring-teal-500/25",
  "Aguardando pagamento": "bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-amber-100 dark:ring-amber-500/25",
  Pago: "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-100 dark:ring-emerald-500/25",
  "Quebra de promessa": "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/25",
  "Crítico": "bg-red-50 text-red-700 ring-red-100",
  "Distrato/Evasão": "bg-stone-100 text-stone-700 ring-stone-200",
};

export const workflowStageDots: Record<WorkflowStage, string> = {
  "A acionar": "bg-sky-500",
  Contato: "bg-indigo-500",
  Negociação: "bg-[#A07C3B]",
  "Promessa de pagamento": "bg-teal-500",
  Acordo: "bg-emerald-500",
  Quebra: "bg-rose-500",
  Jurídico: "bg-zinc-500",
  "Novo atraso": "bg-sky-500",
  "Primeiro contato": "bg-indigo-500",
  "Sem retorno": "bg-slate-400",
  "Em negociação": "bg-[#A07C3B]",
  "Promessa realizada": "bg-teal-500",
  "Aguardando pagamento": "bg-amber-500",
  Pago: "bg-emerald-500",
  "Quebra de promessa": "bg-rose-500",
  "Crítico": "bg-red-500",
  "Distrato/Evasão": "bg-stone-500",
};




