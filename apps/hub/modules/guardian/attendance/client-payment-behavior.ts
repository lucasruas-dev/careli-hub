import {
  Clock3,
  ThumbsDown,
  ThumbsUp,
  type LucideIcon,
} from "lucide-react";

import type { QueueClient } from "@/modules/guardian/attendance/types";

type ClientPaymentBehavior = {
  className: string;
  icon: LucideIcon;
  label: string;
  tooltip: string;
};

export function buildPaymentBehavior(
  client: QueueClient,
): ClientPaymentBehavior {
  const paidInstallments = (client.c2xInstallments ?? []).filter(
    (installment) =>
      installment.status === "Liquidada" &&
      installment.paymentDateInput &&
      (installment.dueDateOriginalInput || installment.dueDateInput),
  );

  if (client.c2xInstallmentsLoaded === false) {
    return {
      className: "bg-slate-50 text-slate-600 ring-slate-200",
      icon: Clock3,
      label: "Calculando histórico",
      tooltip:
        "As parcelas reais ainda estao carregando para calcular o comportamento de pagamento.",
    };
  }

  if (paidInstallments.length === 0) {
    return {
      className: "bg-slate-50 text-slate-600 ring-slate-200",
      icon: Clock3,
      label: "Sem histórico pago",
      tooltip:
        "Ainda nao ha parcelas liquidadas com data de pagamento para calcular a media.",
    };
  }

  const averageDelay =
    paidInstallments.reduce((total, installment) => {
      const dueDateInput =
        installment.dueDateOriginalInput || installment.dueDateInput;

      if (!dueDateInput || !installment.paymentDateInput) {
        return total;
      }

      return (
        total + daysBetweenDateOnly(dueDateInput, installment.paymentDateInput)
      );
    }, 0) / paidInstallments.length;
  const roundedDays = Math.round(Math.abs(averageDelay));
  const baseTooltip = `${paidInstallments.length} parcela(s) liquidada(s) consideradas no historico.`;

  if (averageDelay <= -1) {
    return {
      className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
      icon: ThumbsUp,
      label:
        roundedDays === 1 ? "Antecipa 1 dia" : `Antecipa ${roundedDays} dias`,
      tooltip: `${baseTooltip} Em media, paga antes do vencimento.`,
    };
  }

  if (averageDelay >= 1) {
    return {
      className: "bg-rose-50 text-rose-700 ring-rose-200",
      icon: ThumbsDown,
      label: roundedDays === 1 ? "Atrasa 1 dia" : `Atrasa ${roundedDays} dias`,
      tooltip: `${baseTooltip} Em media, paga apos o vencimento.`,
    };
  }

  return {
    className: "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/20",
    icon: Clock3,
    label: "Paga no vencimento",
    tooltip: `${baseTooltip} Historico medio muito proximo do vencimento.`,
  };
}

function daysBetweenDateOnly(startInput: string, endInput: string) {
  const start = parseDateOnly(startInput);
  const end = parseDateOnly(endInput);

  if (!start || !end) {
    return 0;
  }

  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

function parseDateOnly(value?: string) {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day));
}
