import type { WorkflowStage } from "@/modules/attendance/types";

export const workflowStages: WorkflowStage[] = [
  "Novo atraso",
  "Primeiro contato",
  "Sem retorno",
  "Em negociação",
  "Promessa realizada",
  "Aguardando pagamento",
  "Pago",
  "Quebra de promessa",
  "Crítico",
  "Jurídico",
  "Distrato/Evasão",
];

export const workflowStageStyles: Record<WorkflowStage, string> = {
  "Novo atraso": "bg-sky-50 text-sky-700 ring-sky-100",
  "Primeiro contato": "bg-indigo-50 text-indigo-700 ring-indigo-100",
  "Sem retorno": "bg-slate-50 text-slate-600 ring-slate-200",
  "Em negociação": "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/15",
  "Promessa realizada": "bg-teal-50 text-teal-700 ring-teal-100",
  "Aguardando pagamento": "bg-amber-50 text-amber-700 ring-amber-100",
  Pago: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  "Quebra de promessa": "bg-rose-50 text-rose-700 ring-rose-100",
  Crítico: "bg-red-50 text-red-700 ring-red-100",
  Jurídico: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  "Distrato/Evasão": "bg-stone-100 text-stone-700 ring-stone-200",
};

export const workflowStageDots: Record<WorkflowStage, string> = {
  "Novo atraso": "bg-sky-500",
  "Primeiro contato": "bg-indigo-500",
  "Sem retorno": "bg-slate-400",
  "Em negociação": "bg-[#A07C3B]",
  "Promessa realizada": "bg-teal-500",
  "Aguardando pagamento": "bg-amber-500",
  Pago: "bg-emerald-500",
  "Quebra de promessa": "bg-rose-500",
  Crítico: "bg-red-500",
  Jurídico: "bg-zinc-500",
  "Distrato/Evasão": "bg-stone-500",
};
