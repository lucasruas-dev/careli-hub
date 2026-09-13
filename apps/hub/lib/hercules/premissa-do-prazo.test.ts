import { describe, expect, it } from "vitest";

import {
  aplicarPremissa,
  type FaixaDePrazo,
  mudancasDaPremissa,
  premissaDoPrazo,
} from "@/lib/hercules/premissa-do-prazo";

/** A escada do exemplo do Lucas: 1-12 sem nada, 13-36 com IPCA, 37-48 com juros. */
function faixa(
  parcial: Partial<FaixaDePrazo> & { max: number; min: number },
): FaixaDePrazo {
  return {
    defineEntrada: true,
    defineIndice: true,
    defineJuros: true,
    entradaPercentual: 10,
    indiceCorrecao: "SEM_CORRECAO",
    jurosConvencao: "equivalente",
    jurosPeriodicidade: "mensal",
    jurosTaxa: null,
    parcelaMaxima: parcial.max,
    parcelaMinima: parcial.min,
    ...parcial,
  };
}

const ESCADA: FaixaDePrazo[] = [
  faixa({ max: 12, min: 1 }),
  faixa({
    entradaPercentual: 20,
    indiceCorrecao: "IPCA_ANUAL",
    max: 36,
    min: 13,
  }),
  faixa({
    entradaPercentual: 30,
    indiceCorrecao: "IPCA_MENSAL",
    jurosTaxa: 0.6434,
    max: 48,
    min: 37,
  }),
];

describe("a faixa vale pelo PRAZO TOTAL do plano", () => {
  it("um plano de 40 parcelas cai na faixa de 37 a 48", () => {
    const premissa = premissaDoPrazo(ESCADA, 40);
    expect(premissa?.faixa.parcelaMinima).toBe(37);
    expect(premissa?.jurosTaxa).toBe(0.6434);
    expect(premissa?.entradaPercentual).toBe(30);
    expect(premissa?.indiceCorrecao).toBe("IPCA_MENSAL");
  });

  it("⚠️ as pontas são INCLUSIVAS: 12 é da primeira faixa e 13 é da segunda", () => {
    expect(premissaDoPrazo(ESCADA, 12)?.faixa.parcelaMaxima).toBe(12);
    expect(premissaDoPrazo(ESCADA, 13)?.faixa.parcelaMinima).toBe(13);
  });

  it("⚠️ prazo fora de toda faixa não CHUTA a mais próxima — devolve nada", () => {
    // 130 parcelas com a escada indo até 48. Preencher com os juros da faixa de 37-48 seria
    // inventar uma condição que o comercial não escreveu para esse prazo.
    expect(premissaDoPrazo(ESCADA, 130)).toBeNull();
    expect(premissaDoPrazo(ESCADA, 0)).toBeNull();
    expect(premissaDoPrazo([], 40)).toBeNull();
  });

  it("⚠️ sem faixa cadastrada, nada acontece — o empreendimento segue como antes", () => {
    // É o que torna a entrega segura: a tabela nasceu vazia, e enquanto estiver vazia a tela
    // funciona exatamente como funcionava.
    expect(premissaDoPrazo([], 120)).toBeNull();
  });
});

describe("⚠️ 'sem juros' e 'não opino' são coisas diferentes", () => {
  it("faixa com defineJuros e taxa nula manda ZERAR os juros", () => {
    const premissa = premissaDoPrazo(
      [faixa({ jurosTaxa: null, max: 12, min: 1 })],
      10,
    );
    expect(premissa?.faixa.defineJuros).toBe(true);
    expect(premissa?.jurosTaxa).toBeNull();
    // E a mudança é ANUNCIADA: sair de 0,5% para sem juros é uma alteração de verdade.
    expect(
      mudancasDaPremissa(
        {
          entradaPercentual: 10,
          indiceCorrecao: "SEM_CORRECAO",
          jurosTaxa: 0.5,
        },
        premissa,
      ),
    ).toEqual([{ campo: "juros", de: 0.5, para: null }]);
  });

  it("faixa SEM defineJuros não toca nos juros do plano", () => {
    const premissa = premissaDoPrazo(
      [faixa({ defineJuros: false, jurosTaxa: null, max: 12, min: 1 })],
      10,
    );
    expect(premissa?.jurosTaxa).toBeNull();
    // O plano tem 0,5% e a faixa não opina: nada muda. Se o `defineJuros` não existisse, este
    // mesmo caso zeraria os juros do contrato.
    expect(
      mudancasDaPremissa(
        {
          entradaPercentual: 10,
          indiceCorrecao: "SEM_CORRECAO",
          jurosTaxa: 0.5,
        },
        premissa,
      ),
    ).toEqual([]);
  });
});

describe("o que a tela escreve quando atualiza sozinha", () => {
  it("lista só o que de fato mudou", () => {
    const premissa = premissaDoPrazo(ESCADA, 40);
    const mudancas = mudancasDaPremissa(
      {
        entradaPercentual: 10,
        indiceCorrecao: "SEM_CORRECAO",
        jurosTaxa: null,
      },
      premissa,
    );
    expect(mudancas.map((m) => m.campo).sort()).toEqual([
      "entrada",
      "indice",
      "juros",
    ]);
  });

  it("⚠️ não acusa mudança por casa decimal: 10 e 10.0000 são a mesma entrada", () => {
    const premissa = premissaDoPrazo(
      [faixa({ entradaPercentual: 10, max: 12, min: 1 })],
      10,
    );
    expect(
      mudancasDaPremissa(
        {
          entradaPercentual: 10.00001,
          indiceCorrecao: "SEM_CORRECAO",
          jurosTaxa: null,
        },
        premissa,
      ),
    ).toEqual([]);
  });

  it("sem premissa nenhuma, não há o que anunciar", () => {
    expect(
      mudancasDaPremissa(
        { entradaPercentual: 10, indiceCorrecao: "IPCA_ANUAL", jurosTaxa: 0.5 },
        null,
      ),
    ).toEqual([]);
  });
});

describe("aplicarPremissa troca o objeto, nunca a conta", () => {
  const PLANO = {
    entradaPercentual: 10,
    indiceCorrecao: "SEM_CORRECAO",
    jurosConvencao: "equivalente",
    jurosPeriodicidade: "mensal",
    jurosTaxa: 0.5 as null | number,
    nome: "Normal",
    parcelas: 120,
  };

  it("aplica juros, índice e entrada da faixa", () => {
    const efetivo = aplicarPremissa(PLANO, premissaDoPrazo(ESCADA, 40));
    expect(efetivo?.jurosTaxa).toBe(0.6434);
    expect(efetivo?.indiceCorrecao).toBe("IPCA_MENSAL");
    expect(efetivo?.entradaPercentual).toBe(30);
    // O resto do plano fica: a faixa não opina sobre nome nem prazo.
    expect(efetivo?.nome).toBe("Normal");
    expect(efetivo?.parcelas).toBe(120);
  });

  it("⚠️ faixa SEM JUROS zera a taxa do plano — o caso '1 a 12' do exemplo", () => {
    const efetivo = aplicarPremissa(PLANO, premissaDoPrazo(ESCADA, 10));
    expect(efetivo?.jurosTaxa).toBeNull();
  });

  it("⚠️ sem faixa devolve o MESMO objeto, por identidade", () => {
    expect(aplicarPremissa(PLANO, null)).toBe(PLANO);
    expect(aplicarPremissa(PLANO, premissaDoPrazo(ESCADA, 999))).toBe(PLANO);
  });

  it("⚠️ a convenção viaja com a taxa", () => {
    const proporcional = [
      faixa({
        jurosConvencao: "proporcional",
        jurosTaxa: 0.8,
        max: 60,
        min: 49,
      }),
    ];
    const efetivo = aplicarPremissa(PLANO, premissaDoPrazo(proporcional, 55));
    expect(efetivo?.jurosTaxa).toBe(0.8);
    expect(efetivo?.jurosConvencao).toBe("proporcional");
  });
});
