import type {
  PortfolioUnit,
  QueueClient,
} from "@/modules/guardian/attendance/types";

export type ClientDocumentSummaryItem = {
  detail: string;
  href?: string;
  id: string;
  meta?: string;
  status: string;
  title: string;
  unitBadge?: string;
};

export function buildClientDocumentSummary(
  client: QueueClient,
  unit?: PortfolioUnit,
): ClientDocumentSummaryItem[] {
  const selectedUnit = unit ?? client.carteira.unidades[0];
  const contractCode = selectedUnit?.matricula ?? "Sem cod. unidade";
  const contractDocumentId = selectedUnit?.signedContractDocumentId;
  const contractUrl = contractDocumentId
    ? `/api/hades/d4sign/contracts/${encodeURIComponent(contractDocumentId)}`
    : undefined;
  const unitLabel = selectedUnit
    ? `${selectedUnit.empreendimento} ${selectedUnit.quadra} ${selectedUnit.lote}`.trim()
    : "Unidade não selecionada";
  const agreementDocuments = client.commitments
    .filter((commitment) => commitment.type === "Acordo")
    .filter(
      (agreement) =>
        !selectedUnit || agreement.unitCode === selectedUnit.matricula,
    )
    .map((agreement) => ({
      detail: agreement.protocol,
      id: agreement.id,
      meta: `${agreement.negotiatedValue} · ${agreement.installmentsCount} parcelas`,
      status: agreement.status,
      title: "Acordo",
      unitBadge: agreement.unitCode,
    }));

  return [
    {
      detail: contractCode,
      href: contractUrl,
      id: "contract",
      meta: unitLabel,
      status: contractDocumentId
        ? (selectedUnit?.signedContractStatus ?? "Assinado")
        : "Não localizado",
      title: "Contrato",
      unitBadge: contractCode,
    },
    ...(agreementDocuments.length > 0
      ? agreementDocuments
      : [
          {
            detail: client.agreement.id.toUpperCase(),
            id: "agreement-planned",
            meta: `${client.agreement.negotiatedValue} · ${client.agreement.installmentsCount} parcelas`,
            status: client.agreement.status,
            title: "Acordo",
            unitBadge: contractCode,
          },
        ]),
    {
      detail: client.agreement.id.toUpperCase(),
      id: "boleto-c2x",
      status: client.agreement.status,
      title: "Boleto C2X",
    },
    {
      detail: `${client.timeline.length} eventos`,
      id: "collection-history",
      status: "Registrado",
      title: "Histórico de cobrança",
    },
  ];
}
