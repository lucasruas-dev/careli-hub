import type { ApoloDashboardData, ApoloProfile } from "@/lib/apolo/types";

// Helpers de dados compartilhados do Apolo (extraidos do ApoloPage monolitico).

export function profileCount(
  dashboard: ApoloDashboardData | null,
  profile: ApoloProfile,
) {
  return (
    dashboard?.profileSummaries.find((item) => item.profile === profile)?.count ??
    0
  );
}

export function formatCount(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 0,
  }).format(value);
}
