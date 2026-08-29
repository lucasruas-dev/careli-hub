import { describe, expect, it } from "vitest";

import {
  calcularParcela,
  fraseDeCorrecao,
  ordenarParaAFolha,
  parcelaNiveladaSacoc,
  type PlanoComercial,
  PLANOS_PADRAO_DA_CASA,
  taxaMensal,
  textoDoSinal,
} from "./planos-comerciais";

// ⚠️ OS NÚMEROS DESTE ARQUIVO NÃO SÃO INVENTADOS. Cada um foi medido no C2X em 29/08/2026,
// cruzando `commercial_plans` com as parcelas REALMENTE EMITIDAS em `payments`. É o que
// impede a regra de voltar a divergir do boleto sem ninguém notar.

function plano(parcial: Partial<PlanoComercial>): PlanoComercial {
  return {
    entradaPercentual: 10,
    indiceCorrecao: "IPCA_ANUAL",
    jurosConvencao: "equivalente",
    jurosPeriodicidade: "anual",
    jurosTaxa: null,
    nome: "TESTE",
    parcelas: 120,
    sistemaAmortizacao: "sacoc",
    slot: "normal",
    ...parcial,
  };
}

describe("converte a taxa contratual para mensal", () => {
  it("a equivalente de 8% ao ano é a que o C2X grava: 0,6434%", () => {
    const i = taxaMensal(plano({ jurosTaxa: 8 }));
    expect(Number((i * 100).toFixed(4))).toBe(0.6434);
  });

  it("a equivalente de 9% ao ano é 0,7207% — a outra que aparece no banco", () => {
    const i = taxaMensal(plano({ jurosTaxa: 9 }));
    expect(Number((i * 100).toFixed(4))).toBe(0.7207);
  });

  it("a proporcional dá 0,6667%, que NÃO aparece uma vez sequer no C2X", () => {
    const i = taxaMensal(plano({ jurosConvencao: "proporcional", jurosTaxa: 8 }));
    expect(Number((i * 100).toFixed(4))).toBe(0.6667);
  });

  it("taxa já mensal passa direto — 0,6434 não vira 0,0536", () => {
    const i = taxaMensal(
      plano({ jurosPeriodicidade: "mensal", jurosTaxa: 0.6434 }),
    );
    expect(Number((i * 100).toFixed(4))).toBe(0.6434);
  });

  it("sem juros é zero, e nulo não vira NaN", () => {
    expect(taxaMensal(plano({ jurosTaxa: null }))).toBe(0);
    expect(taxaMensal(plano({ jurosTaxa: 0 }))).toBe(0);
  });
});

describe("SACOC emite a amortização pura — medido em 9 de 9 empreendimentos", () => {
  it("Villa Paris: R$ 220.000, sinal 10%, 180 parcelas = R$ 1.100,00 exatos", () => {
    const r = calcularParcela(
      plano({ jurosTaxa: 0.6434, jurosPeriodicidade: "mensal", parcelas: 180 }),
      220_000,
    );
    expect(r.sinal).toBe(22_000);
    expect(r.financiado).toBe(198_000);
    expect(r.parcela).toBe(1_100);
    // Sobe de degrau no aniversário: o rodapé da linha precisa dizer isso.
    expect(r.naturezaDaParcela).toBe("inicial");
  });

  it("Lavra do Ouro LOU: financiado R$ 56.129,40 em 144 = R$ 389,79", () => {
    const r = calcularParcela(
      plano({ entradaPercentual: 0, jurosTaxa: 8, parcelas: 144 }),
      56_129.4,
    );
    expect(Number(r.parcela!.toFixed(2))).toBe(389.79);
  });

  it("Vale do Ouro VOC: financiado R$ 131.814,90 em 156 = R$ 844,97", () => {
    const r = calcularParcela(
      plano({ entradaPercentual: 0, jurosTaxa: 9, parcelas: 156 }),
      131_814.9,
    );
    expect(Number(r.parcela!.toFixed(2))).toBe(844.97);
  });

  it("SACOC sem juros é parcela FIXA, não 'inicial' — não há aniversário para subir", () => {
    const r = calcularParcela(plano({ jurosTaxa: null, parcelas: 36 }), 100_000);
    expect(r.naturezaDaParcela).toBe("fixa");
  });
});

describe("PRICE cobra os juros na parcela — o único caso em que a Price se aplica", () => {
  it("MDS: financiado R$ 111.699 em 144 a 0,6434% a.m. = R$ 1.192,05", () => {
    const r = calcularParcela(
      plano({
        entradaPercentual: 0,
        jurosPeriodicidade: "mensal",
        jurosTaxa: 0.6434,
        parcelas: 144,
        sistemaAmortizacao: "price",
      }),
      111_699,
    );
    expect(Number(r.parcela!.toFixed(2))).toBe(1_192.05);
  });

  it("a folha antiga do Villa Paris: 120× de R$ 2.402,29 — 2,18× o boleto real", () => {
    const r = calcularParcela(
      plano({
        jurosConvencao: "proporcional",
        jurosTaxa: 8,
        parcelas: 120,
        sistemaAmortizacao: "price",
      }),
      220_000,
    );
    expect(Number(r.parcela!.toFixed(2))).toBe(2_402.29);
  });

  // ⚠️ A ESCOLHA DA CONVENÇÃO CUSTA R$ 29,11 POR PARCELA — R$ 3.492,88 no contrato inteiro,
  // neste exemplo. Não é arredondamento: é a diferença entre 8÷12 e (1,08)^(1/12)−1.
  //
  // Já partir da taxa anual (0,00643403…) ou da mensal que o C2X grava truncada em quatro
  // casas (0,006434) muda quatro DÉCIMOS de centavo na parcela. Essa, sim, é ruído.
  it("com a convenção equivalente, que é a do C2X: R$ 2.373,18", () => {
    const r = calcularParcela(
      plano({ jurosTaxa: 8, parcelas: 120, sistemaAmortizacao: "price" }),
      220_000,
    );
    expect(Number(r.parcela!.toFixed(2))).toBe(2_373.18);
  });

  it("a taxa mensal gravada no C2X chega ao mesmo lugar", () => {
    const r = calcularParcela(
      plano({
        jurosPeriodicidade: "mensal",
        jurosTaxa: 0.6434,
        parcelas: 120,
        sistemaAmortizacao: "price",
      }),
      220_000,
    );
    expect(Number(r.parcela!.toFixed(2))).toBe(2_373.18);
  });

  it("Price sem juros vira divisão simples, não NaN nem divisão por zero", () => {
    const r = calcularParcela(
      plano({ jurosTaxa: null, parcelas: 12, sistemaAmortizacao: "price" }),
      120_000,
    );
    expect(r.parcela).toBe(9_000);
    expect(r.naturezaDaParcela).toBe("fixa");
  });
});

describe("SAC clássico é outra coisa, e a folha precisa dizer", () => {
  it("a primeira é a maior: amortização mais juros sobre o saldo cheio", () => {
    const r = calcularParcela(
      plano({
        entradaPercentual: 0,
        jurosPeriodicidade: "mensal",
        jurosTaxa: 1,
        parcelas: 100,
        sistemaAmortizacao: "sac",
      }),
      100_000,
    );
    expect(r.parcela).toBe(2_000);
    expect(r.naturezaDaParcela).toBe("primeira");
  });
});

describe("a parcela nivelada do SACOC, para a escolha comercial em aberto", () => {
  it("fica ACIMA da amortização pura, porque embute os juros do 1º ciclo", () => {
    const nivelada = parcelaNiveladaSacoc(198_000, 0.006434, 180);
    expect(nivelada).toBeGreaterThan(1_100);
    expect(nivelada).toBeLessThan(1_150);
  });

  it("sem juros as duas coincidem", () => {
    expect(parcelaNiveladaSacoc(120_000, 0, 12)).toBe(10_000);
  });
});

describe("sem preço de tabela a linha sai em branco, e o plano não some", () => {
  it("devolve nulos mantendo o número de parcelas", () => {
    const r = calcularParcela(plano({ parcelas: 156 }), null);
    expect(r.parcela).toBeNull();
    expect(r.sinal).toBeNull();
    expect(r.parcelas).toBe(156);
  });
});

describe("a frase miúda sai do mesmo objeto que faz a conta", () => {
  it("Price com juros e índice", () => {
    expect(
      fraseDeCorrecao(plano({ jurosTaxa: 8, sistemaAmortizacao: "price" })),
    ).toBe("Price, 8% a.a., com IPCA anual");
  });

  it("SACOC com juros avisa do reajuste no aniversário", () => {
    expect(fraseDeCorrecao(plano({ jurosTaxa: 8 }))).toBe(
      "8% a.a., reajuste no aniversário, com IPCA anual",
    );
  });

  it("sem juros e sem correção", () => {
    expect(
      fraseDeCorrecao(plano({ indiceCorrecao: "SEM_CORRECAO", jurosTaxa: null })),
    ).toBe("sem juros, sem correção");
  });

  it("taxa mensal aparece como a.m., não como a.a.", () => {
    expect(
      fraseDeCorrecao(
        plano({ jurosPeriodicidade: "mensal", jurosTaxa: 0.6434 }),
      ),
    ).toBe("0,6434% a.m., reajuste no aniversário, com IPCA anual");
  });
});

describe("rótulo do sinal", () => {
  it("redondo sai sem casas", () => {
    expect(textoDoSinal(plano({ entradaPercentual: 20 }))).toBe("20%");
  });

  it("quebrado sai com vírgula, não com ponto", () => {
    expect(textoDoSinal(plano({ entradaPercentual: 13.15 }))).toBe("13,15%");
  });
});

describe("ordem na folha", () => {
  it("investidor, curto, normal — como no documento oficial", () => {
    const fora = [
      plano({ nome: "N", slot: "normal" }),
      plano({ nome: "I", slot: "investidor" }),
      plano({ nome: "C", slot: "curto" }),
    ];
    expect(ordenarParaAFolha(fora).map((p) => p.nome)).toEqual(["I", "C", "N"]);
  });

  it("plano sem slot vai para o fim, e não some", () => {
    const fora = [
      plano({ nome: "AVULSO", slot: null }),
      plano({ nome: "I", slot: "investidor" }),
    ];
    expect(ordenarParaAFolha(fora).map((p) => p.nome)).toEqual(["I", "AVULSO"]);
  });
});

describe("os planos de último recurso continuam calculando", () => {
  it("os três saem com sinal e parcela sobre um preço qualquer", () => {
    for (const p of PLANOS_PADRAO_DA_CASA) {
      const r = calcularParcela(p, 200_000);
      expect(r.parcela).toBeGreaterThan(0);
      expect(r.sinal).toBeGreaterThan(0);
    }
  });
});
