import { describe, expect, it } from "vitest";

import { describeInstallment, podeInformarValor } from "./executors";

// A trava no ponto onde o valor de fato é escrito. `describeInstallment` é o ÚNICO lugar que monta
// a linha de parcela que a CACÁ lê — os cinco caminhos (financeiro do cliente, lista de boletos e
// os três da imobiliária) passam por aqui, então uma regra só cobre todos.

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

  it("parcela futura SEM boleto NÃO pode", () => {
    expect(podeInformarValor(parcela())).toBe(false);
  });

  it("VENCIDA sem boleto também não pode — é o caso mais sensível, 1.201 parcelas hoje", () => {
    // A tentação é liberar a vencida "porque já venceu". Mas o reajuste dela também não foi
    // aplicado: quem não tem boleto não passou pela atualização, vencida ou não.
    expect(podeInformarValor(parcela({ status: "Vencida" }))).toBe(false);
  });
});

describe("o que sai escrito", () => {
  it("sem boleto: mantém número e vencimento, e troca o valor pela marca", () => {
    const texto = describeInstallment(parcela());
    expect(texto).toContain("parcela 35/144");
    expect(texto).toContain("vence/venceu 20/06/2027");
    expect(texto).not.toContain("426,81");
    expect(texto).toContain("valor sob atualização");
  });

  it("com boleto: o valor sai normalmente", () => {
    const texto = describeInstallment(parcela({ paymentUrl: "https://www.asaas.com/i/abc" }));
    expect(texto).toContain("R$ 426,81");
    expect(texto).not.toContain("valor sob atualização");
  });

  it("paga: o valor sai normalmente", () => {
    const texto = describeInstallment(parcela({ status: "Liquidada", value: "R$ 535,72" }));
    expect(texto).toContain("R$ 535,72");
  });

  it("a marca é explícita, não uma omissão silenciosa", () => {
    // Omitir sem dizer nada faz o modelo preencher a lacuna sozinho — ou o cliente perguntar
    // "quanto é?" e ele inventar. A marca diz que o número existe e quando fica pronto.
    expect(describeInstallment(parcela())).toMatch(/confirmado na emissão do boleto/);
  });
});
