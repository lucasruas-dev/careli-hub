import type { QueueClient } from "@/modules/guardian/attendance/types";

type ClientCommitment = QueueClient["commitments"][number];
type PaymentPromiseCommitment = Extract<
  ClientCommitment,
  { type: "Promessa de pagamento" }
>;
type AgreementCommitment = Extract<ClientCommitment, { type: "Acordo" }>;

export type ClientCommitmentOverviewMetrics = {
  activeAgreements: number;
  broken: number;
  fulfilled: number;
  fulfillmentRate: number;
  hasCommitmentData: boolean;
  open: number;
  promisedValue: string;
};

const openPromiseStatuses: PaymentPromiseCommitment["status"][] = [
  "Promessa realizada",
  "Aguardando pagamento",
  "Reagendada",
];

const activeAgreementStatuses: AgreementCommitment["status"][] = [
  "Ativo",
  "Formalizando",
  "Em negociação",
  "Reativado",
];

export function buildCommitmentOverviewMetrics(
  client: QueueClient,
): ClientCommitmentOverviewMetrics {
  const promises = client.commitments.filter(isPaymentPromiseCommitment);
  const agreements = client.commitments.filter(isAgreementCommitment);
  const fulfilled = promises.filter(
    (promise) => promise.status === "Cumprida",
  ).length;
  const broken = promises.filter(
    (promise) => promise.status === "Quebrada",
  ).length;
  const open = promises.filter((promise) =>
    openPromiseStatuses.includes(promise.status),
  ).length;
  const activeAgreements = agreements.filter((agreement) =>
    activeAgreementStatuses.includes(agreement.status),
  ).length;
  const concluded = fulfilled + broken;
  const fulfillmentRate =
    concluded > 0 ? Math.round((fulfilled / concluded) * 100) : 0;
  const promisedValue = promises.reduce(
    (total, promise) => total + parseMoney(promise.promisedValue),
    0,
  );

  return {
    activeAgreements,
    broken,
    fulfilled,
    fulfillmentRate,
    hasCommitmentData: client.commitments.length > 0,
    open,
    promisedValue: formatMoney(promisedValue),
  };
}

function isPaymentPromiseCommitment(
  commitment: ClientCommitment,
): commitment is PaymentPromiseCommitment {
  return commitment.type === "Promessa de pagamento";
}

function isAgreementCommitment(
  commitment: ClientCommitment,
): commitment is AgreementCommitment {
  return commitment.type === "Acordo";
}

function parseMoney(value: string) {
  const normalized = value
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  return Number.parseFloat(normalized) || 0;
}

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
