import { describe, expect, it } from "vitest";

import {
  type CabecalhoDaProposta,
  montarProposta,
  type ParcelaCruaDaProposta,
} from "./venda-proposta";

// A régua destes testes é um contrato REAL do Vista Alegre (ar 4288, unidade G 09, lido do C2X em
// 18/08/2026): tabela R$ 79.900, entrada de Ato R$ 0,01 + 3x Sinal R$ 2.663,33 (= R$ 7.990, 10%),
// financiamento 120x R$ 599,25 (= R$ 71.910). Soma fecha com a tabela ao centavo → desconto zero.

function cabecalho(extras: Partial<CabecalhoDaProposta> = {}): CabecalhoDaProposta {
  return {
    ar_id: 4288,
    bloco: "G",
    codigo: "VAL",
    faturado_em: "2026-08-07",
    imobiliaria: "HUBER NEGOCIOS IMOBILIARIOS LTDA",
    lote: "09",
    plano_entrada_pct: "10.0000",
    plano_parcelas: 120,
    plano_personalizado: 0,
    valor_tabela: "79900.00",
    ...extras,
  };
}

function parcela(
  tipo: string,
  valor: string,
  vencimento: string,
  extras: Partial<ParcelaCruaDaProposta> = {},
): ParcelaCruaDaProposta {
  return { pago: null, pago_em: null, tipo, valor, vencimento, ...extras };
}

/** O contrato do G 09, na íntegra que interessa: entrada + as duas pontas do financiamento. */
function contratoDoVal(): ParcelaCruaDaProposta[] {
  const financiamento = Array.from({ length: 120 }, (_, i) => {
    const mes = new Date(Date.UTC(2026, 9 + i, 20)).toISOString().slice(0, 10);
    return parcela("Parcela", "599.25", mes);
  });

  return [
    parcela("Ato", "0.01", "2026-07-20", { pago: "0.01", pago_em: "2026-07-20" }),
    parcela("Sinal", "2663.33", "2026-07-20", { pago: "2663.33", pago_em: "2026-08-07" }),
    parcela("Sinal", "2663.33", "2026-08-20", { pago: "0.00" }),
    parcela("Sinal", "2663.33", "2026-09-20"),
    ...financiamento,
  ];
}

describe("a proposta da venda (contrato real do VAL, G 09)", () => {
  it("monta entrada, financiamento, negociado e desconto como no contrato", () => {
    const proposta = montarProposta(cabecalho(), contratoDoVal());

    expect(proposta.unidade).toBe("VALG09");
    expect(proposta.valorTabela).toBe(79_900);
    // 0,01 + 3 × 2.663,33 + 120 × 599,25 = 79.900,00 — fecha com a tabela ao centavo.
    expect(proposta.valorNegociado).toBe(79_900);
    expect(proposta.desconto).toBe(0);

    expect(proposta.entrada.total).toBe(7_990);
    expect(proposta.entrada.percentual).toBe(10);
    expect(proposta.entrada.parcelas).toHaveLength(4);
    // Ordem de vencimento, numeração 1..N, e a régua de "paga" é a da carteira
    // (valor pago > 0 E data): a sinal de 20/08 tem pago = 0.00 e NÃO conta como paga.
    expect(proposta.entrada.parcelas[0]).toEqual({
      n: 1,
      paga: true,
      valor: 0.01,
      vencimento: "2026-07-20",
    });
    expect(proposta.entrada.parcelas[1]).toEqual({
      n: 2,
      paga: true,
      valor: 2_663.33,
      vencimento: "2026-07-20",
    });
    expect(proposta.entrada.parcelas[2]?.paga).toBe(false);
    expect(proposta.entrada.parcelas[3]?.paga).toBe(false);

    expect(proposta.financiamento).toEqual({
      parcelas: 120,
      primeiroVencimento: "2026-10-20",
      valorParcela: 599.25,
    });

    expect(proposta.faturadoEm).toBe("2026-08-07");
    expect(proposta.imobiliaria).toBe("HUBER NEGOCIOS IMOBILIARIOS LTDA");
  });

  it("calcula desconto quando o negociado fica abaixo da tabela", () => {
    const proposta = montarProposta(cabecalho({ valor_tabela: "82000.00" }), contratoDoVal());

    expect(proposta.valorNegociado).toBe(79_900);
    expect(proposta.desconto).toBe(2_100);
  });

  it("⚠️ financiamento não gerado: negociado e desconto saem NULOS, nunca um número errado", () => {
    // O caso real do VOC/VOL recém-vendido: só a entrada emitida (10% do preço). Somar isso e
    // publicar como "negociado" diria ao dono que o lote saiu por um décimo.
    const soEntrada = contratoDoVal().slice(0, 4);
    const proposta = montarProposta(cabecalho(), soEntrada);

    expect(proposta.valorNegociado).toBeNull();
    expect(proposta.desconto).toBeNull();
    // O prazo cai no plano comercial; o valor da parcela ninguém inventa.
    expect(proposta.financiamento).toEqual({
      parcelas: 120,
      primeiroVencimento: null,
      valorParcela: null,
    });
    // Sem negociado, o percentual da entrada usa a tabela.
    expect(proposta.entrada.percentual).toBe(10);
  });

  it("⚠️ juros embutidos (planos antigos, soma acima da tabela) não viram desconto negativo", () => {
    // LOS/LOU: as parcelas carregam juros do plano e a soma passa do preço de tabela.
    const proposta = montarProposta(
      cabecalho({ valor_tabela: "70000.00" }),
      contratoDoVal(),
    );

    expect(proposta.valorNegociado).toBe(79_900);
    expect(proposta.desconto).toBe(0);
  });

  it("parcela Avulso (perfil 'outro') fica fora da entrada, do financiamento e do negociado", () => {
    const proposta = montarProposta(cabecalho(), [
      ...contratoDoVal(),
      parcela("Avulso", "150.00", "2026-11-05"),
    ]);

    expect(proposta.entrada.total).toBe(7_990);
    expect(proposta.financiamento.parcelas).toBe(120);
    expect(proposta.valorNegociado).toBe(79_900);
  });

  it("unidade sem bloco/lote e sem imobiliária degrada para os nulos da tela", () => {
    const proposta = montarProposta(
      cabecalho({ bloco: null, imobiliaria: "  ", lote: null, plano_parcelas: null }),
      [],
    );

    expect(proposta.unidade).toBe("—");
    expect(proposta.imobiliaria).toBeNull();
    expect(proposta.entrada.total).toBe(0);
    expect(proposta.entrada.parcelas).toEqual([]);
    expect(proposta.financiamento).toEqual({
      parcelas: null,
      primeiroVencimento: null,
      valorParcela: null,
    });
    expect(proposta.valorNegociado).toBeNull();
    expect(proposta.desconto).toBeNull();
  });

  it("🔒 o payload não carrega nada do combinado interno (plano, juros, corretor, split)", () => {
    const proposta = montarProposta(cabecalho(), contratoDoVal());
    const chaves = new Set([
      ...Object.keys(proposta),
      ...Object.keys(proposta.entrada),
      ...Object.keys(proposta.financiamento),
    ]);

    for (const proibida of [
      "plano",
      "planName",
      "juros",
      "interestRate",
      "correctionRate",
      "corretor",
      "split",
    ]) {
      expect(chaves.has(proibida)).toBe(false);
    }
  });
});

describe("previsão pelo plano (venda sem parcela emitida)", () => {
  // Régua REAL: contrato 4283 da Lagoa Bonita (LBF C12 lote 10, Em assinatura, lido do C2X em
  // 18/08/2026): tabela R$ 378.216, plano padrão "10% ENTRADA + 120 VEZES", ZERO parcelas.
  const semParcelas = cabecalho({
    ar_id: 4283,
    bloco: "C12",
    codigo: "LBF",
    faturado_em: null,
    lote: "10",
    plano_entrada_pct: "10.0000",
    valor_tabela: "378216.00",
  });

  it("plano PADRÃO: prevê entrada, negociado igual à tabela e desconto zero", () => {
    const p = montarProposta(semParcelas, []);
    expect(p.previsao).toEqual({
      desconto: 0,
      entradaPercentual: 10,
      entradaTotal: 37821.6,
      negociado: 378216,
    });
    // O emitido continua honesto: nada foi gerado.
    expect(p.valorNegociado).toBeNull();
    expect(p.entrada.total).toBe(0);
    expect(p.financiamento.parcelas).toBe(120);
  });

  it("plano PERSONALIZADO: prevê a entrada, mas negociado e desconto ficam sem número", () => {
    const p = montarProposta({ ...semParcelas, plano_personalizado: 1 }, []);
    expect(p.previsao?.entradaTotal).toBe(37821.6);
    expect(p.previsao?.negociado).toBeNull();
    expect(p.previsao?.desconto).toBeNull();
  });

  it("com QUALQUER parcela emitida a previsão sai de cena", () => {
    const p = montarProposta(semParcelas, [parcela("Sinal", "37821.60", "2026-08-20")]);
    expect(p.previsao).toBeNull();
  });

  it("o rótulo é o compacto dos cards: código + bloco + lote", () => {
    expect(montarProposta(semParcelas, []).unidade).toBe("LBFC1210");
    expect(montarProposta(cabecalho(), []).unidade).toBe("VALG09");
  });
});
