import { describe, expect, it } from "vitest";

import { pisoDoEspelho, semPlanosRepetidos, type PlanoPublico } from "./planos-publicos";

// O PISO DO ESPELHO (18/09/2026): o Garden aparecia com "entrada R$ 41.000 (8%)" num lote de
// R$ 410.000 porque o espelho usava o padrão da casa (10%) e não os 8% do empreendimento.
describe("pisoDoEspelho", () => {
  it("o piso cadastrado vale, e chega como o numeric do banco (texto)", () => {
    expect(pisoDoEspelho(["8.00"])).toBe(8);
  });

  it("ninguém cadastrou: nulo, que é o padrão da casa", () => {
    expect(pisoDoEspelho([])).toBeNull();
    expect(pisoDoEspelho([null, undefined, ""])).toBeNull();
  });

  it("⚠️ zero é decisão, não ausência", () => {
    expect(pisoDoEspelho(["0.00"])).toBe(0);
    expect(pisoDoEspelho([null, 0])).toBe(0);
  });

  it("pai e filhos com pisos diferentes: vale o maior, que nenhum filho recusa", () => {
    expect(pisoDoEspelho(["8.00", "10.00", null])).toBe(10);
  });

  it("lixo não vira piso", () => {
    expect(pisoDoEspelho(["abc", -5 as unknown as string])).toBeNull();
  });
});

function plano(parcial: Partial<PlanoPublico>): PlanoPublico {
  return {
    anuaisQuantidade: 0,
    anuaisValor: 0,
    descontoPercentual: 0,
    entradaPercentual: 20,
    indiceCorrecao: "IPCA_ANUAL",
    jurosConvencao: "efetiva",
    jurosPeriodicidade: "anual",
    jurosTaxa: null,
    nome: "CURTO",
    parcelas: 36,
    sistemaAmortizacao: "PRICE",
    ...parcial,
  } as PlanoPublico;
}

// Os tres planos do Vale do Ouro, como estavam cadastrados no VLO e no VOC (15/09/2026).
const DO_VALE = [
  plano({ entradaPercentual: 20, indiceCorrecao: "SEM_CORRECAO", nome: "INVESTIDOR", parcelas: 24 }),
  plano({ entradaPercentual: 20, indiceCorrecao: "IPCA_ANUAL", nome: "CURTO", parcelas: 36 }),
  plano({ entradaPercentual: 10, indiceCorrecao: "IPCA_ANUAL", nome: "NORMAL", parcelas: 156 }),
];

describe("semPlanosRepetidos", () => {
  // ⚠️ O PRINT DO LUCAS: pai e filho com os mesmos tres planos viravam seis cartoes.
  it("pai e filho com os mesmos planos mostram cada plano uma vez", () => {
    const somados = [...DO_VALE, ...DO_VALE];

    expect(semPlanosRepetidos(somados)).toHaveLength(3);
  });

  it("mantem a ordem da primeira ocorrencia", () => {
    expect(semPlanosRepetidos([...DO_VALE, ...DO_VALE]).map((p) => p.nome)).toEqual([
      "INVESTIDOR",
      "CURTO",
      "NORMAL",
    ]);
  });

  // Caixa e espaco nao fazem planos diferentes: "Curto" e "CURTO " e o mesmo plano.
  it("nome com caixa ou espaco diferente e o mesmo plano", () => {
    expect(
      semPlanosRepetidos([plano({ nome: "CURTO" }), plano({ nome: " curto " })]),
    ).toHaveLength(1);
  });

  // ⚠️ SO TIRA REPETICAO. Tudo que muda a conta faz um plano diferente — e plano diferente
  // continua aparecendo, porque esconder condicao comercial real e pior do que repetir.
  it("plano que muda a conta nao some", () => {
    const base = plano({});

    for (const variacao of [
      { parcelas: 48 },
      { entradaPercentual: 30 },
      { indiceCorrecao: "IPCA_MENSAL" },
      { jurosTaxa: 0.5 },
      { jurosPeriodicidade: "mensal" },
      { anuaisQuantidade: 2 },
      { anuaisValor: 15000 },
      { sistemaAmortizacao: "SAC" },
      // O desconto do plano (0178) é preço: dois planos iguais com descontos diferentes são dois.
      { descontoPercentual: 8 },
    ] as Array<Partial<PlanoPublico>>) {
      expect(semPlanosRepetidos([base, plano(variacao)]), JSON.stringify(variacao)).toHaveLength(2);
    }
  });

  // Juros nulo (sem juros) e juros zero sao decisoes diferentes: nulo e ausencia, zero e escolha.
  it("juros nulo e juros zero nao se fundem", () => {
    expect(
      semPlanosRepetidos([plano({ jurosTaxa: null }), plano({ jurosTaxa: 0 })]),
    ).toHaveLength(2);
  });

  it("lista vazia continua vazia", () => {
    expect(semPlanosRepetidos([])).toEqual([]);
  });
});
