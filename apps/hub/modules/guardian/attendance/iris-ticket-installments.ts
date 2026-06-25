import type { QueueClient } from "@/modules/guardian/attendance/types";

export type IrisTicketInstallmentOption = {
  label: string;
  value: string;
};

type C2xInstallment = NonNullable<QueueClient["c2xInstallments"]>[number];

export function buildInstallmentOptions(
  client: QueueClient,
  selectedUnitIds: string[] = [],
): IrisTicketInstallmentOption[] {
  const allowedUnitIds = new Set(selectedUnitIds);

  return (client.c2xInstallments ?? [])
    .filter(
      (installment) =>
        !allowedUnitIds.size || allowedUnitIds.has(installment.unitId),
    )
    .filter(isOverdueC2xInstallment)
    .map((installment) => ({
      label: `${installment.unitCode ?? installment.unitLabel ?? "Unidade"} · ${installment.number} · ${installment.dueDate} · ${installment.value} · ${installment.status}`,
      value: `${installment.id} | ${installment.unitId} | ${installment.number} | ${installment.dueDate} | ${installment.value}`,
    }));
}

export function resolveRelatedInstallmentLabels(
  client: QueueClient,
  selectedUnitIds: string[],
  relatedInstallments: string[],
) {
  const optionByValue = new Map(
    buildInstallmentOptions(client, selectedUnitIds).map((option) => [
      option.value,
      option.label,
    ]),
  );

  return relatedInstallments
    .map((installment) => {
      const mapped = optionByValue.get(installment);

      if (mapped) {
        return mapped;
      }

      const parts = installment
        .split("|")
        .map((value) => value.trim())
        .filter(Boolean);
      const number = parts[2] ?? "";
      const dueDate = parts[3] ?? "";
      const amount = parts[4] ?? "";
      const fallback = [number, dueDate, amount].filter(Boolean).join(" · ");

      return fallback || installment;
    })
    .filter(Boolean);
}

function isOverdueC2xInstallment(installment: C2xInstallment) {
  const status = normalizeInstallmentText(installment.status);

  if (
    status.includes("liquidada") ||
    status.includes("paga") ||
    status.includes("pago") ||
    Boolean(installment.paymentDate) ||
    Boolean(installment.paymentDateInput)
  ) {
    return false;
  }

  if (status.includes("vencida") || Number(installment.overdueDays ?? 0) > 0) {
    return true;
  }

  const dueDateValue =
    parseC2xInstallmentDate(installment.dueDateInput) ??
    parseC2xInstallmentDate(installment.dueDate);

  if (!dueDateValue) return false;

  return dueDateValue < todayStartValue();
}

function normalizeInstallmentText(value?: string | null) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseC2xInstallmentDate(value?: string | null) {
  const raw = String(value ?? "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (iso) {
    return new Date(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
    ).getTime();
  }

  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (br) {
    return new Date(
      Number(br[3]),
      Number(br[2]) - 1,
      Number(br[1]),
    ).getTime();
  }

  return null;
}

function todayStartValue() {
  const today = new Date();

  return new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
}
