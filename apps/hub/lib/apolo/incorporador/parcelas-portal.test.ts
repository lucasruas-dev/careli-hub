import { describe, expect, it } from "vitest";

import type { ApoloUnitInstallment } from "@/lib/apolo/carteira";

import { parcelaParaOPortal } from "./parcelas-portal";

// A ALLOWLIST DAS PARCELAS DO PORTAL. O que estes testes travam é o CONTORNO do payload: o
// `boletoUrl` que o Lucas mandou expor (18/08/2026: *"temos que trazer o contrato e nas parcelas
// dentro de carteira o link do boleto do asaas"*) ENTRA, e nenhum campo interno do Asaas
// (paymentUrl/invoiceUrl crus, id de cobrança) atravessa por tabela.

function parcela(extra: Partial<ApoloUnitInstallment> = {}): ApoloUnitInstallment {
  return {
    amount: 1000,
    competence: "2026-08-01T00:00:00.000Z",
    dueDate: "2026-08-10T00:00:00.000Z",
    id: "349863",
    invoiceUrl: "https://www.asaas.com/b/pdf/auvj8x9bjdepzl1h",
    number: "1/120",
    overdueDays: 0,
    paidAmount: 0,
    paidAt: null,
    paymentUrl: "https://www.asaas.com/i/auvj8x9bjdepzl1h",
    status: "a_vencer",
    type: "Parcela",
    ...extra,
  };
}

describe("a allowlist do payload de parcelas do portal", () => {
  it("boletoUrl ENTRA (ordem do Lucas, 18/08/2026) e é a FATURA (/i/), não o PDF cru", () => {
    // Medido no C2X em 18/08/2026: payment_asaas_url = fatura (/i/), payment_asaas_invoice_url =
    // PDF do boleto (/b/pdf/). A fatura é o que o C2X mostra como "Fatura/Boleto".
    expect(parcelaParaOPortal(parcela()).boletoUrl).toBe(
      "https://www.asaas.com/i/auvj8x9bjdepzl1h",
    );
  });

  it("sem a fatura, cai para o PDF do boleto; sem nenhum, null (sem URL = sem link)", () => {
    expect(parcelaParaOPortal(parcela({ paymentUrl: null })).boletoUrl).toBe(
      "https://www.asaas.com/b/pdf/auvj8x9bjdepzl1h",
    );
    expect(
      parcelaParaOPortal(parcela({ invoiceUrl: null, paymentUrl: null })).boletoUrl,
    ).toBeNull();
  });

  it("parcela PAGA mantém o link: a fatura vira o comprovante", () => {
    const paga = parcelaParaOPortal(
      parcela({ paidAmount: 1000, paidAt: "2026-08-09T00:00:00.000Z", status: "liquidada" }),
    );
    expect(paga.boletoUrl).toBe("https://www.asaas.com/i/auvj8x9bjdepzl1h");
  });

  it("⚠️ os campos internos do Asaas NÃO atravessam: nada de paymentUrl/invoiceUrl/id de cobrança", () => {
    const chaves = Object.keys(parcelaParaOPortal(parcela())).sort();

    expect(chaves).toEqual([
      "amount",
      "boletoUrl",
      "competence",
      "dueDate",
      "id",
      "number",
      "overdueDays",
      "paidAmount",
      "paidAt",
      "status",
      "type",
    ]);
    expect(chaves).not.toContain("paymentUrl");
    expect(chaves).not.toContain("invoiceUrl");
    expect(chaves.some((chave) => /asaas/i.test(chave))).toBe(false);
  });

  it("campo NOVO na leitura interna não nasce vazando no portal", () => {
    // Simula o dia em que `loadApoloUnitInstallments` ganhar um campo a mais (id Asaas, telefone…):
    // o mapper é allowlist, então o intruso NÃO pode aparecer no payload.
    const comIntruso = {
      ...parcela(),
      asaas_id: "pay_123",
      telefone: "31999999999",
    } as unknown as ApoloUnitInstallment;

    const payload = parcelaParaOPortal(comIntruso) as unknown as Record<string, unknown>;
    expect(payload.asaas_id).toBeUndefined();
    expect(payload.telefone).toBeUndefined();
  });
});
