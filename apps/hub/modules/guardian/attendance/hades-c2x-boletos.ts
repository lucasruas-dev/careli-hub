import type { QueueClient } from "@/modules/guardian/attendance/types";

type C2xInstallment = NonNullable<QueueClient["c2xInstallments"]>[number];

export type C2xBoleto = {
  id: string;
  parcela: string;
  vencimento: string;
  valor: string;
  status: C2xInstallment["status"];
  linhaDigitavel: string;
};

export function buildC2xBoletos(client: QueueClient): C2xBoleto[] {
  return (client.c2xInstallments ?? []).map((installment) => ({
    id: installment.id,
    linhaDigitavel: "-",
    parcela: installment.number,
    status: installment.status,
    valor: installment.value,
    vencimento: installment.dueDate,
  }));
}
