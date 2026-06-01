export type HadesAgreementCalculation = {
  entryRate: number;
  installmentBalance: string;
  installmentValue: string;
  negotiatedValue: string;
  recoveryRate: number;
};

export function calculateAgreement(
  originalValue: string,
  discount: string,
  entry: string,
  installmentsCount: string
): HadesAgreementCalculation {
  const original = parseMoney(originalValue);
  const discountRate = Number.parseFloat(discount.replace(/[^\d,.-]/g, "").replace(",", ".")) / 100 || 0;
  const negotiated = Math.max(original * (1 - discountRate), 0);
  const entryValue = parseMoney(entry);
  const count = Math.max(Number.parseInt(installmentsCount, 10) || 1, 1);
  const balance = Math.max(negotiated - entryValue, 0);

  return {
    entryRate: negotiated > 0 ? Math.round((entryValue / negotiated) * 100) : 0,
    installmentBalance: formatMoney(balance),
    installmentValue: formatMoney(balance / count),
    negotiatedValue: formatMoney(negotiated),
    recoveryRate: original > 0 ? Math.round((negotiated / original) * 100) : 0,
  };
}

function parseMoney(value: string) {
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  return Number.parseFloat(normalized) || 0;
}

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
