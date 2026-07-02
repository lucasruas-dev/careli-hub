// Ordenação de parcelas por vencimento — extraída pura de executors.ts para
// ser coberta por teste de regressão (bug 30/jun/2026: a Cacá apontava a
// próxima parcela errada).
//
// ATENÇÃO: ordenar pelo campo ISO `dueDateInput` (AAAA-MM-DD), NUNCA por
// `dueDate` (formato BR DD/MM/AAAA). O localeCompare em DD/MM/AAAA ordena por
// dia→mês→ano, então "20/01/2027" vinha ANTES de "20/07/2026". O ISO ordena
// cronologicamente como texto.

export type InstallmentDueDateFields = {
  dueDate?: string | null;
  dueDateInput?: string | null;
};

export function compareInstallmentsByDueDate(
  first: InstallmentDueDateFields,
  second: InstallmentDueDateFields,
): number {
  return String(first.dueDateInput ?? first.dueDate ?? "").localeCompare(
    String(second.dueDateInput ?? second.dueDate ?? ""),
  );
}

// Devolve uma cópia ordenada do vencimento mais próximo ao mais distante.
export function sortInstallmentsByDueDate<T extends InstallmentDueDateFields>(
  items: readonly T[],
): T[] {
  return [...items].sort(compareInstallmentsByDueDate);
}
