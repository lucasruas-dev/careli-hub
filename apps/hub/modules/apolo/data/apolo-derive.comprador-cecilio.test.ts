import { describe, expect, it } from "vitest";

import type { ApoloEntity, ApoloProfile } from "@/lib/apolo/types";

import {
  businessRoleProfiles,
  buyerFinancialBadge,
  buyerStatusLabel,
  isApoloTabUnavailableForEntity,
  matchesApoloFilters,
  primaryBusinessProfile,
} from "./apolo-derive";

// O CLIENTE DA CECÍLIO NÃO É O "COMPRADOR" DO C2X (02/10/2026).
//
// ⚠️ O QUE ESTE ARQUIVO TRAVA: o "Comprador" do Apolo é calculado da carteira do C2X, e a Cecílio não
// tem vínculo com o legado. Se o papel novo fosse tratado como comprador, o financeiro do C2X chegaria
// zerado e o chip ficaria VERDE, "Adimplente", para quem está em atraso; e as abas Carteira e
// Financeiro abririam vazias. O papel aparece como chip próprio, e mais nada muda.

function ficha(profiles: ApoloProfile[], extra: Partial<ApoloEntity> = {}): ApoloEntity {
  return {
    addresses: [],
    audit: [],
    commercialLinks: [],
    confidenceScore: 60,
    contacts: [],
    createdAt: "02/10/2026",
    displayName: "CLIENTE DE TESTE",
    documentMasked: "***.***.***-00",
    documents: [],
    financial: {
      overdueAmount: "R$ 0,00",
      overdueInstallments: 0,
      paidAmount: "R$ 0,00",
      paymentBehavior: "-",
      risk: "baixo",
      totalPortfolio: "R$ 0,00",
    },
    id: "00000000-0000-5000-8000-000000000001",
    kind: "pf",
    locationLabel: "Pará de Minas / MG",
    nextAction: "Contato de cobrança",
    profiles,
    relationships: [],
    serviceSignals: [],
    status: "active",
    timeline: [],
    updatedAt: "02/10/2026",
    ...extra,
  };
}

describe("o comprador da Cecílio no CRM", () => {
  const cliente = ficha(["comprador_cecilio", "pessoa_fisica"]);

  it("não vira Comprador nem Prospect do C2X, e não ganha selo de adimplência", () => {
    expect(buyerStatusLabel(cliente)).toBe("Nao aplicavel");
    expect(buyerFinancialBadge(cliente)).toBeNull();
  });

  it("não abre Carteira nem Financeiro, que seriam do C2X e viriam vazios", () => {
    expect(isApoloTabUnavailableForEntity("carteira", cliente)).toBe(true);
    expect(isApoloTabUnavailableForEntity("financeiro", cliente)).toBe(true);
  });

  it("aparece como chip de papel e como perfil principal, e não como 'Pessoa fisica'", () => {
    expect(businessRoleProfiles(cliente)).toEqual(["comprador_cecilio"]);
    expect(primaryBusinessProfile(cliente)).toBe("comprador_cecilio");
  });

  it("o filtro 'Comprador Cecílio' acha quem tem o papel e só ele", () => {
    expect(matchesApoloFilters(cliente, "", "comprador_cecilio")).toBe(true);
    expect(matchesApoloFilters(ficha(["usuario"]), "", "comprador_cecilio")).toBe(false);
    expect(matchesApoloFilters(cliente, "", "comprador")).toBe(false);
  });
});

describe("quem é comprador do C2X E da Cecílio continua lido pelo C2X", () => {
  it("o Comprador do C2X, com o selo dele, não muda por ter também o papel novo", () => {
    const duplo = ficha(["usuario", "comprador_cecilio", "pessoa_fisica"], { isBuyer: true });

    expect(buyerStatusLabel(duplo)).toBe("Comprador");
    expect(buyerFinancialBadge(duplo)?.label).toBe("Adimplente");
    expect(primaryBusinessProfile(duplo)).toBe("usuario");
    expect(businessRoleProfiles(duplo)).toEqual(["comprador_cecilio"]);
  });
});
