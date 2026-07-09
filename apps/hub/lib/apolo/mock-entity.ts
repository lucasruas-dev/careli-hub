import type { ApoloEntity } from "@/lib/apolo/types";

// Entidade de exemplo para iterar a ficha do Apolo no localhost (o read-model
// real precisa da chave de serviço, que não valida local). Uma pessoa que é
// corretora E compradora, pra exercitar os papéis e as abas adaptativas.
export function mockApoloEntity(): ApoloEntity {
  return {
    addresses: [
      {
        city: "Contagem",
        district: "Portal do Sol",
        label: "Residencial",
        number: "56",
        postalCode: "32183-788",
        state: "MG",
        status: "verified",
        value: "Rua Eridano, 56",
      },
    ],
    audit: [
      { field: "CPF", status: "mapped", updatedAt: "2026-03-10" },
      { field: "Renda", status: "pending", updatedAt: "2026-03-10" },
    ],
    commercialLinks: [
      {
        area: "250 m²",
        block: "Q3",
        brokerAgency: "Careli Imóveis",
        contractStatus: "Ativo",
        enterprise: "Vale do Ouro",
        enterpriseCode: "VDO",
        installments: [
          {
            acquisitionRequestId: "AR-1",
            dueDate: "2026-08-10",
            id: "inst-1",
            number: "12/60",
            overdueDays: 0,
            reference: "Ago/2026",
            status: "A vencer",
            value: "R$ 2.500,00",
            valueNumber: 2500,
          },
          {
            acquisitionRequestId: "AR-1",
            dueDate: "2026-07-10",
            id: "inst-2",
            number: "11/60",
            overdueDays: 0,
            paidAt: "2026-07-09",
            reference: "Jul/2026",
            status: "Liquidada",
            value: "R$ 2.500,00",
            valueNumber: 2500,
          },
        ],
        lot: "56",
        referenceLabel: "Vale do Ouro · Lote 56",
        role: "Comprador",
        stage: "Contrato assinado",
        tableValue: "R$ 180.000,00",
        unit: "Lote 56",
        unitCode: "56",
        unitId: "unit-56",
      },
    ],
    confidenceScore: 92,
    contacts: [
      { label: "WhatsApp", status: "verified", type: "whatsapp", value: "(31) 98681-5697" },
      { label: "E-mail", status: "verified", type: "email", value: "danielle@exemplo.com" },
      { label: "Telefone", status: "pending", type: "phone", value: "(31) 3466-5697" },
    ],
    createdAt: "2026-03-10T12:00:00Z",
    displayName: "Danielle Aguiar Pacheco de Oliveira",
    documentMasked: "041.310.***-22",
    documents: [
      { label: "CNH", status: "ready", updatedAt: "2026-03-10" },
      { label: "Comprovante de endereço", status: "ready", updatedAt: "2026-03-10" },
    ],
    financial: {
      overdueAmount: "R$ 0,00",
      overdueInstallments: 0,
      paidAmount: "R$ 60.000,00",
      paymentBehavior: "Em dia",
      risk: "baixo",
      totalPortfolio: "R$ 180.000,00",
    },
    id: "mock-1",
    kind: "pf",
    locationLabel: "Contagem, MG",
    nextAction: "Revisar contrato da unidade 56",
    profiles: ["corretor", "pessoa_fisica"],
    relationships: [
      { label: "Careli Imóveis", relation: "Imobiliária vinculada", status: "verified" },
      { label: "Vale do Ouro", relation: "Empreendimento", status: "verified" },
      { label: "Pedro Ruas", relation: "Responsável financeiro", status: "pending" },
    ],
    serviceSignals: [
      { channel: "Iris", lastEvent: "2026-07-01", protocol: "AT-2041", status: "Resolvido" },
    ],
    status: "active",
    timeline: [
      {
        date: "2026-07-08",
        description: "Unidade 56 do Vale do Ouro.",
        status: "ok",
        title: "Contrato assinado",
      },
      {
        date: "2026-07-01",
        description: "Dúvida sobre boleto resolvida pela Iris.",
        status: "ok",
        title: "Atendimento",
      },
      {
        date: "2026-03-10",
        description: "Prospect cadastrado por documento.",
        status: "ok",
        title: "Cadastro criado",
      },
    ],
    updatedAt: "2026-07-08T15:30:00Z",
  };
}
