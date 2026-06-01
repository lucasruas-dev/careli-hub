import type {
  PortfolioUnit,
  QueueClient,
} from "@/modules/guardian/attendance/types";

const EMPTY_FIELD = "-";

export type ClientPortfolioSummary = {
  mainEnterprise: string;
  mainTableValue: string;
  unitsCount: string;
};

export function resolvePortfolioUnit(
  client: QueueClient,
  unitId: string,
): PortfolioUnit | undefined {
  return (
    client.carteira.unidades.find((unit) => unit.id === unitId) ??
    client.carteira.unidades[0]
  );
}

export function buildPortfolioSummary(
  client: QueueClient,
): ClientPortfolioSummary {
  const mainUnit = client.carteira.unidades[0];

  return {
    mainEnterprise: mainUnit?.empreendimento ?? EMPTY_FIELD,
    mainTableValue: mainUnit?.valorTabela ?? EMPTY_FIELD,
    unitsCount: `${client.carteira.unidades.length}`,
  };
}

export function formatPortfolioLot(lot: string) {
  return lot.replace(/^L/i, "");
}
