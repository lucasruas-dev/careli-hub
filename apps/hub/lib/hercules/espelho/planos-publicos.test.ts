import { describe, expect, it } from "vitest";

import { semPlanosRepetidos, type PlanoPublico } from "./planos-publicos";

function plano(parcial: Partial<PlanoPublico>): PlanoPublico {
  return {
    anuaisQuantidade: 0,
    anuaisValor: 0,
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
