import { describe, expect, it } from "vitest";

import { describeInstallment, podeInformarValor } from "./executors";

// `describeInstallment` é o ÚNICO lugar que monta a linha de parcela que a CACÁ lê — os cinco
// caminhos (financeiro do cliente, lista de boletos e os três da imobiliária) passam por aqui.
//
// ⚠️ 27/08/2026: a trava que escondia o valor de parcela sem boleto foi LIBERADA (decisão do
// Lucas), porque o reajuste passou a ser aplicado em massa e o valor gravado deixou de estar
// defasado. Estes testes agora guardam o comportamento NOVO — e o de baixo guarda a fronteira
// que continua valendo: o LINK do boleto não é liberado junto.

const parcela = (patch: Record<string, unknown> = {}) =>
  ({
    dueDate: "20/06/2027",
    number: "35/144",
    reference: "Parcela",
    status: "A vencer",
    value: "R$ 426,81",
    ...patch,
  }) as never;

describe("quem pode ter o valor dito", () => {
  it("parcela PAGA pode — o valor é o que a pessoa realmente pagou", () => {
    expect(podeInformarValor(parcela({ status: "Liquidada" }))).toBe(true);
  });

  it("parcela COM BOLETO pode, pelo link de pagamento", () => {
    expect(podeInformarValor(parcela({ paymentUrl: "https://www.asaas.com/i/abc" }))).toBe(true);
  });

  it("parcela COM BOLETO pode, pelo PDF da fatura", () => {
    expect(podeInformarValor(parcela({ invoiceUrl: "https://www.asaas.com/b/pdf/abc" }))).toBe(true);
  });

  it("parcela futura SEM boleto AGORA pode — o reajuste já está aplicado no valor gravado", () => {
    expect(podeInformarValor(parcela())).toBe(true);
  });

  it("VENCIDA sem boleto também pode", () => {
    expect(podeInformarValor(parcela({ status: "Vencida" }))).toBe(true);
  });
});

describe("o que sai escrito", () => {
  it("sem boleto: o valor sai, junto com número e vencimento", () => {
    const texto = describeInstallment(parcela());
    expect(texto).toContain("parcela 35/144");
    expect(texto).toContain("vence/venceu 20/06/2027");
    expect(texto).toContain("R$ 426,81");
    expect(texto).not.toContain("valor sob atualização");
  });

  it("com boleto: o valor sai normalmente", () => {
    const texto = describeInstallment(parcela({ paymentUrl: "https://www.asaas.com/i/abc" }));
    expect(texto).toContain("R$ 426,81");
    expect(texto).not.toContain("valor sob atualização");
  });

  it("paga: o valor sai normalmente", () => {
    const texto = describeInstallment(parcela({ status: "Liquidada", value: "R$ 535,72" }));
    expect(texto).toContain("R$ 535,72");
    expect(texto).not.toContain("valor sob atualização");
  });

  it("sem valor nenhum na ferramenta: a linha não inventa número", () => {
    const texto = describeInstallment(parcela({ value: "" }));
    expect(texto).toContain("parcela 35/144");
    expect(texto).not.toContain("R$");
  });
});
