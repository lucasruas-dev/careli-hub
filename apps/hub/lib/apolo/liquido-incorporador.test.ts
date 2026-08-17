import { describe, expect, it } from "vitest";

import { liquidoDaParcela, somarLiquido } from "./liquido-incorporador";

// A política do cenário que o Lucas explicou ao time em 16/01/2026: lote de 100.000, comissão 7%.
const POLITICA_7 = { comissaoPct: 7, entradaPct: 10, gestaoCarteiraPct: 97 };

describe("os três cenários do Lucas", () => {
  // "os 7% é sobre o valor do lote. Só que temos que fazer o cálculo acima pois o Loteador recebe
  // o complemento." A comissão em reais é sempre 7.000; o que muda é a fatia da entrada.
  it("entrada de 10%: a cadeia leva 70%, o incorporador fica com 3.000", () => {
    const r = liquidoDaParcela(
      { perfil: "sinal", valor: 10_000, valorUnidade: 100_000 },
      { ...POLITICA_7, entradaPct: 10 },
    );

    expect(r.fonte).toBe("calculado");
    expect(r.liquido).toBeCloseTo(3_000, 2);
  });

  it("entrada de 20%: a cadeia leva 35%, o incorporador fica com 13.000", () => {
    const r = liquidoDaParcela(
      { perfil: "sinal", valor: 20_000, valorUnidade: 100_000 },
      { ...POLITICA_7, entradaPct: 20 },
    );

    expect(r.liquido).toBeCloseTo(13_000, 2);
  });

  it("entrada de 33%: a cadeia leva 21,21%, o incorporador fica com 26.000", () => {
    const r = liquidoDaParcela(
      { perfil: "sinal", valor: 33_000, valorUnidade: 100_000 },
      { ...POLITICA_7, entradaPct: 33 },
    );

    // 7/33 = 21,2121% para a cadeia -> 78,7879% de 33.000
    expect(r.liquido).toBeCloseTo(26_000, 0);
  });

  it("a comissão em reais é a MESMA nos três: 7.000", () => {
    for (const [entradaPct, entrada] of [
      [10, 10_000],
      [20, 20_000],
      [33, 33_000],
    ] as const) {
      const r = liquidoDaParcela(
        { perfil: "sinal", valor: entrada, valorUnidade: 100_000 },
        { ...POLITICA_7, entradaPct },
      );
      expect(entrada - (r.liquido ?? 0)).toBeCloseTo(7_000, 0);
    }
  });
});

describe("o ato entra na mesma conta do sinal", () => {
  // A explicação do Lucas aplica o percentual à ENTRADA INTEIRA (ato + sinal). O BI dava fator 0
  // ao ato e concentrava no sinal: o total fecha, mas por parcela não — e a carteira é caixa.
  it("ato e sinal têm a mesma fatia, e a soma bate com a entrada inteira", () => {
    const politica = { ...POLITICA_7, entradaPct: 10 };
    const ato = liquidoDaParcela(
      { perfil: "ato", valor: 1_500, valorUnidade: 100_000 },
      politica,
    );
    const sinal = liquidoDaParcela(
      { perfil: "sinal", valor: 8_500, valorUnidade: 100_000 },
      politica,
    );

    expect(ato.liquido).toBeCloseTo(450, 2); // 30% de 1.500
    expect(sinal.liquido).toBeCloseTo(2_550, 2); // 30% de 8.500
    expect((ato.liquido ?? 0) + (sinal.liquido ?? 0)).toBeCloseTo(3_000, 2);
  });
});

describe("parcelas do financiamento", () => {
  it("usa a % de gestão de carteira do empreendimento, não um valor fixo", () => {
    // REP fechou 97%, Vista Alegre 97,5%, Lavra do Ouro 96%: o mesmo valor dá líquidos diferentes.
    const parcela = { perfil: "parcela" as const, valor: 1_000 };

    expect(
      liquidoDaParcela(parcela, { ...POLITICA_7, gestaoCarteiraPct: 97 }).liquido,
    ).toBeCloseTo(970, 2);
    expect(
      liquidoDaParcela(parcela, { ...POLITICA_7, gestaoCarteiraPct: 97.5 }).liquido,
    ).toBeCloseTo(975, 2);
    expect(
      liquidoDaParcela(parcela, { ...POLITICA_7, gestaoCarteiraPct: 96 }).liquido,
    ).toBeCloseTo(960, 2);
  });

  it("aceita o percentual como fração ou como número inteiro", () => {
    const parcela = { perfil: "parcela" as const, valor: 1_000 };

    expect(liquidoDaParcela(parcela, { ...POLITICA_7, gestaoCarteiraPct: 0.97 }).liquido)
      .toBeCloseTo(970, 2);
  });
});

describe("o split do C2X ganha da fórmula", () => {
  it("usa o valor que foi para o Asaas quando ele existe", () => {
    // Caso real: parcela de 856,16 com o incorporador levando 829,47 (Vale do Ouro).
    const r = liquidoDaParcela(
      {
        perfil: "parcela",
        split: [
          { perfil: "Incorporador", valor: 829.47 },
          { perfil: "Gestora de recebíveis", valor: 24.69 },
        ],
        valor: 856.16,
      },
      { ...POLITICA_7, gestaoCarteiraPct: 50 }, // política errada de propósito
    );

    expect(r.fonte).toBe("split");
    // Ignora os 50% da política: o que valeu foi o rateio real.
    expect(r.liquido).toBeCloseTo(829.47, 2);
  });

  it("reconhece 'Loteador' como o mesmo papel", () => {
    const r = liquidoDaParcela(
      { perfil: "parcela", split: [{ perfil: "loteador", valor: 700 }], valor: 1_000 },
      POLITICA_7,
    );

    expect(r.fonte).toBe("split");
    expect(r.liquido).toBe(700);
  });

  it("cai na fórmula quando o split existe mas NÃO tem linha do incorporador", () => {
    // Acontece: o `fee_breakdown` da cadeia (Captador, Gerente, Imobiliária) não cita o loteador.
    const r = liquidoDaParcela(
      {
        perfil: "parcela",
        split: [{ perfil: "Imobiliária", valor: 56.98 }],
        valor: 1_000,
      },
      { ...POLITICA_7, gestaoCarteiraPct: 97 },
    );

    expect(r.fonte).toBe("calculado");
    expect(r.liquido).toBeCloseTo(970, 2);
  });
});

describe("o que NÃO dá para calcular aparece, em vez de virar zero", () => {
  it("sem gestão de carteira cadastrada, devolve motivo", () => {
    // O caso do Garden e do Jardim das Gerais, que não têm política nenhuma no C2X.
    const r = liquidoDaParcela(
      { perfil: "parcela", valor: 1_000 },
      { comissaoPct: null, entradaPct: null, gestaoCarteiraPct: null },
    );

    expect(r.liquido).toBeNull();
    expect(r.motivo).toMatch(/não cadastrada/i);
    expect(r.bruto).toBe(1_000);
  });

  it("sem política no C2X, a entrada não é calculada", () => {
    const r = liquidoDaParcela(
      { perfil: "sinal", valor: 5_000, valorUnidade: 100_000 },
      { comissaoPct: null, entradaPct: null, gestaoCarteiraPct: 97 },
    );

    expect(r.liquido).toBeNull();
    expect(r.motivo).toMatch(/incompleta/i);
  });

  it("comissão maior que a entrada é inconsistência, não fatia negativa", () => {
    // A trava do Lucas: "nunca vou ter uma % mínima de entrada menor que a % dos comissionados".
    const r = liquidoDaParcela(
      { perfil: "sinal", valor: 5_000, valorUnidade: 100_000 },
      { comissaoPct: 12, entradaPct: 10, gestaoCarteiraPct: 97 },
    );

    expect(r.liquido).toBeNull();
    expect(r.motivo).toMatch(/inconsistente/i);
  });
});

describe("somarLiquido", () => {
  it("conta quantas parcelas ficaram sem líquido, em vez de somar só o que deu", () => {
    const politica = { comissaoPct: 7, entradaPct: 10, gestaoCarteiraPct: null };
    const r = somarLiquido(
      [
        { perfil: "parcela", split: [{ perfil: "Incorporador", valor: 900 }], valor: 1_000 },
        { perfil: "parcela", valor: 1_000 },
        { perfil: "parcela", valor: 1_000 },
      ],
      politica,
    );

    expect(r.bruto).toBe(3_000);
    expect(r.liquido).toBe(900);
    // As duas sem split e sem gestão cadastrada ficam à vista.
    expect(r.semLiquido).toBe(2);
    expect(r.porSplit).toBe(1);
    expect(r.motivos).toHaveLength(1);
  });
});
