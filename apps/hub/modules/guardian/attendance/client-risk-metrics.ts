import type { QueueClient } from "@/modules/guardian/attendance/types";

const EMPTY_FIELD = "-";

export type ClientRiskMetrics = {
  aiDiagnostic: string;
  criticalAlert: string;
  evasionTrend: number;
  financialRisk: string;
  hasAgreementRisk: boolean;
};

export function buildClientRiskMetrics(client: QueueClient): ClientRiskMetrics {
  const evasionTrend = Math.min(
    client.scoreRisco + Math.floor(client.atrasoDias / 3),
    96,
  );
  const agreementRisk = client.agreement.risk as string;
  const hasAgreementRisk = agreementRisk !== EMPTY_FIELD;
  const financialRisk = hasAgreementRisk
    ? `${client.agreement.aiSuggestion.breakChance}%`
    : EMPTY_FIELD;
  const criticalAlert = hasAgreementRisk
    ? client.agreement.aiSuggestion.breakChance >= 50
      ? "Acordo exige acompanhamento humano próximo e lembrete antes do vencimento."
      : "Risco sob controle, manter régua preventiva e monitorar compensação."
    : EMPTY_FIELD;
  const aiDiagnostic = hasAgreementRisk
    ? `O cliente combina ${client.atrasoDias} dias de atraso, ${client.parcelas.vencidas} parcela(s) vencida(s), acordo ${client.agreement.status.toLowerCase()} e risco ${agreementRisk.toLowerCase()}.`
    : EMPTY_FIELD;

  return {
    aiDiagnostic,
    criticalAlert,
    evasionTrend,
    financialRisk,
    hasAgreementRisk,
  };
}
