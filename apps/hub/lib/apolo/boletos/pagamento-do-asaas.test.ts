import { describe, expect, it } from "vitest";

import {
  estaPago,
  foiDesfeito,
  mudouDeEstado,
  pagamentoDoAsaas,
} from "./pagamento-do-asaas";

// A cobrança como o Asaas manda (os campos que usamos), com os valores de uma real do Garden.
const cobranca = (extra: Record<string, unknown> = {}) => ({
  billingType: "BOLETO",
  dueDate: "2026-09-10",
  externalReference: "boleto:garden:Q07-L24:2026-09",
  id: "pay_123456",
  status: "PENDING",
  value: 2711.53,
  ...extra,
});

describe("o que conta como pago", () => {
  // ⚠️ ESCRITO POR EXTENSO, E NÃO POR VALOR. Ver o cabeçalho de pagamento-do-asaas.ts.
  it("dinheiro que entrou e continua nosso", () => {
    for (const s of ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]) {
      expect(estaPago(s), s).toBe(true);
    }
  });

  it("em aberto, vencido e cancelado não são pago", () => {
    for (const s of ["PENDING", "OVERDUE", "DELETED", "AWAITING_RISK_ANALYSIS"]) {
      expect(estaPago(s), s).toBe(false);
    }
  });

  it("devolvido e contestado NÃO são pago, e são um estado próprio", () => {
    for (const s of ["REFUNDED", "REFUND_REQUESTED", "CHARGEBACK_REQUESTED"]) {
      expect(estaPago(s), s).toBe(false);
      expect(foiDesfeito(s), s).toBe(true);
    }
    // O que nunca foi pago também não é "desfeito": são perguntas diferentes.
    expect(foiDesfeito("PENDING")).toBe(false);
  });

  it("aceita o status em qualquer caixa e com espaço", () => {
    expect(estaPago(" received ")).toBe(true);
    expect(estaPago(null)).toBe(false);
  });
});

describe("a cobrança virando linha nossa", () => {
  it("lê empreendimento, unidade, competência e sequência da referência", () => {
    const linha = pagamentoDoAsaas(cobranca(), { conta: "garden" });
    expect(linha).toMatchObject({
      cobranca_id: "pay_123456",
      competencia: "2026-09",
      conta: "garden",
      empreendimento: "garden",
      sequencia: 1,
      situacao: "PENDING",
      unidade: "Q07-L24",
      valor_cobrado: 2711.53,
      vencimento: "2026-09-10",
      workspace_id: "careli",
    });
  });

  it("a segunda cobrança do mês (a entrada) vem com sequência 2", () => {
    const linha = pagamentoDoAsaas(
      cobranca({ externalReference: "boleto:vale-do-ouro-2:Q10-L03:2026-09:2" }),
      { conta: "vale-do-ouro" },
    );
    expect(linha?.sequencia).toBe(2);
    expect(linha?.empreendimento).toBe("vale-do-ouro-2");
    // ⚠️ A CONTA NÃO É O EMPREENDIMENTO: os quatro edifícios da CER dividem uma conta só.
    expect(linha?.conta).toBe("vale-do-ouro");
  });

  it("pago: guarda valor e data do pagamento", () => {
    const linha = pagamentoDoAsaas(
      cobranca({ clientPaymentDate: "2026-09-05", paymentDate: "2026-09-08", status: "RECEIVED" }),
      { conta: "garden" },
    );
    expect(linha?.valor_pago).toBe(2711.53);
    expect(linha?.pago_em).toBe("2026-09-08");
    expect(linha?.pago_em_informado).toBe("2026-09-05");
  });

  it("⚠️ devolvido: a data do pagamento NÃO fica, senão a conciliação lê como quitada", () => {
    // O Asaas mantém `paymentDate` preenchido depois do estorno.
    const linha = pagamentoDoAsaas(
      cobranca({ paymentDate: "2026-09-08", status: "REFUNDED" }),
      { conta: "garden" },
    );
    expect(linha?.situacao).toBe("REFUNDED");
    expect(linha?.pago_em).toBeNull();
    expect(linha?.valor_pago).toBeNull();
  });

  it("cobrança que não saiu desta tela fica de fora", () => {
    // Carnê antigo e cobrança avulsa feita no painel não têm a referência `boleto:`.
    expect(pagamentoDoAsaas(cobranca({ externalReference: null }), { conta: "garden" })).toBeNull();
    expect(
      pagamentoDoAsaas(cobranca({ externalReference: "contrato:123" }), { conta: "garden" }),
    ).toBeNull();
    // Referência com formato estranho também não entra.
    expect(
      pagamentoDoAsaas(cobranca({ externalReference: "boleto:garden" }), { conta: "garden" }),
    ).toBeNull();
  });

  it("sem id, sem vencimento ou sem valor não vira linha", () => {
    expect(pagamentoDoAsaas(cobranca({ id: null }), { conta: "garden" })).toBeNull();
    expect(pagamentoDoAsaas(cobranca({ dueDate: null }), { conta: "garden" })).toBeNull();
    expect(pagamentoDoAsaas(cobranca({ value: null }), { conta: "garden" })).toBeNull();
  });
});

describe("quando avisar", () => {
  // ⚠️ O Asaas REENVIA o mesmo evento quando não recebe 200: avisar a cada webhook seria ruído.
  it("estado novo avisa; estado repetido não", () => {
    expect(mudouDeEstado(null, { situacao: "RECEIVED" })).toBe(true);
    expect(mudouDeEstado({ situacao: "PENDING" }, { situacao: "RECEIVED" })).toBe(true);
    expect(mudouDeEstado({ situacao: "RECEIVED" }, { situacao: "RECEIVED" })).toBe(false);
  });
});
