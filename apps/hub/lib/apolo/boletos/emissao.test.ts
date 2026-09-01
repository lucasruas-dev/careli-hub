import { describe, expect, it } from "vitest";

import {
  diferencaDoArredondamento,
  referenciaDaCobranca,
  valorParaOAsaas,
} from "./emissao";

// ⚠️ ISTO É DINHEIRO INDO PARA O BOLETO DE UMA PESSOA. Cada caso aqui é um centavo que sai errado
// na conta de alguém — para mais ou para menos — e ninguém confere 142 boletos à mão.

describe("o arredondamento para cima", () => {
  it("sobe o centavo quando há casas além da segunda", () => {
    // Decisão do Lucas (01/09/2026): "arredonda para cima". Os valores da planilha vêm com 13 casas.
    expect(valorParaOAsaas(2207.1729284232347)).toBe(2207.18);
    expect(valorParaOAsaas(2231.973092376779)).toBe(2231.98);
    expect(valorParaOAsaas(10.001)).toBe(10.01);
  });

  it("NÃO mexe em valor que já tem duas casas", () => {
    // ⚠️ ESTE É O TESTE QUE IMPEDE O CENTAVO A MAIS DE GRAÇA. Sem limpar o ruído de ponto flutuante
    // antes, `1.09 * 100` dá 109.00000000000001 e o arredondamento para cima o transformaria em
    // R$ 1,10. Achei seis casos assim só entre R$ 0,01 e R$ 50,00.
    for (const v of [0.07, 0.14, 0.28, 0.55, 0.56, 1.09, 8.11, 1.15, 100.1, 2207.17]) {
      expect(valorParaOAsaas(v), `${v} não devia subir`).toBe(v);
    }
  });

  it("nunca devolve valor MENOR que o da planilha", () => {
    // É o que "para cima" garante: a diferença nunca é contra a empresa.
    for (const v of [1.001, 99.999, 1234.5678, 0.011, 7.4999999]) {
      expect(valorParaOAsaas(v)).toBeGreaterThanOrEqual(v);
    }
  });

  it("a diferença nunca passa de um centavo", () => {
    // Se passar, o arredondamento está errado, não generoso.
    for (const v of [2207.1729284232347, 1.001, 99.999, 0.011, 33.077777]) {
      expect(valorParaOAsaas(v) - v).toBeLessThan(0.01);
    }
  });

  it("valor com duas casas exatas atravessa sem toque, do centavo ao milhão", () => {
    for (let centavos = 1; centavos <= 2000; centavos += 1) {
      const v = centavos / 100;
      expect(valorParaOAsaas(v), `R$ ${v}`).toBe(v);
    }
    expect(valorParaOAsaas(1_000_000.99)).toBe(1_000_000.99);
  });

  it("zero continua zero", () => {
    expect(valorParaOAsaas(0)).toBe(0);
  });
});

describe("o que a tela mostra antes do clique", () => {
  it("soma a planilha e o emitido, e conta quantas linhas subiram", () => {
    const valores = [100.005, 200.5, 300.12];
    const d = diferencaDoArredondamento(valores);

    expect(d.planilha).toBe(600.63);
    // 100.005 -> 100.01 | 200.5 -> 200.5 | 300.12 -> 300.12
    expect(d.emitido).toBe(600.63);
    expect(d.linhasAjustadas).toBe(1);
  });

  it("com os valores reais da planilha, a diferença aparece", () => {
    const d = diferencaDoArredondamento([2207.1729284232347, 2231.973092376779]);
    expect(d.linhasAjustadas).toBe(2);
    expect(d.emitido).toBeGreaterThan(d.planilha);
    // Dois boletos, no máximo dois centavos.
    expect(d.emitido - d.planilha).toBeLessThan(0.02);
  });

  it("lote sem nenhuma casa sobrando não acusa ajuste", () => {
    const d = diferencaDoArredondamento([100.5, 200.25, 300.1]);
    expect(d.linhasAjustadas).toBe(0);
    expect(d.emitido).toBe(d.planilha);
  });
});

describe("a referência que identifica a cobrança", () => {
  it("junta empreendimento, unidade e competência", () => {
    // ⚠️ É por ela que a próxima rodada descobre que o boleto já existe. Sem isso, a única saída
    // seria casar por nome e valor — que é como se emite o mesmo boleto duas vezes.
    expect(
      referenciaDaCobranca({ competencia: "2026-09", empreendimento: "guaimbe", unidade: "307" }),
    ).toBe("boleto:guaimbe:307:2026-09");
  });

  it("unidade com espaço não quebra a referência", () => {
    // O Vale do Sol traz unidades como "00000430"; outras abas trazem "QD 3 LT 10".
    expect(
      referenciaDaCobranca({ competencia: "2026-09", empreendimento: "vale-do-sol", unidade: "QD 3 LT 10" }),
    ).toBe("boleto:vale-do-sol:QD-3-LT-10:2026-09");
  });

  it("a mesma unidade em meses diferentes gera referências diferentes", () => {
    const a = referenciaDaCobranca({ competencia: "2026-09", empreendimento: "on-sky", unidade: "101" });
    const b = referenciaDaCobranca({ competencia: "2026-10", empreendimento: "on-sky", unidade: "101" });
    expect(a).not.toBe(b);
  });
});
