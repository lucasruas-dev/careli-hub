export type HadesCustomerServiceWindow = {
  contextLabel?: string | null;
  expiresAt?: string | null;
  label?: string | null;
  lastCustomerMessageAt?: string | null;
  open: boolean;
  reason?: string | null;
};

export function mapHadesCustomerServiceWindow(
  payload: unknown,
): HadesCustomerServiceWindow | null {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  if (typeof record.open !== "boolean") return null;

  return {
    contextLabel: readHadesOptionalString(record.contextLabel),
    expiresAt: readHadesOptionalString(record.expiresAt),
    label: readHadesOptionalString(record.label),
    lastCustomerMessageAt: readHadesOptionalString(
      record.lastCustomerMessageAt,
    ),
    open: record.open,
    reason: readHadesOptionalString(record.reason),
  };
}

export function hadesCustomerServiceWindowLabel(
  window: HadesCustomerServiceWindow,
) {
  if (window.label) return window.label;

  return window.open
    ? "Janela WhatsApp aberta para mensagem livre."
    : "Janela de 24h fechada. Envie um template aprovado pela Iris e aguarde resposta do cliente.";
}

function readHadesOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
