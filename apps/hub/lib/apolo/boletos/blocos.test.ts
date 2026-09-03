import { describe, expect, it } from "vitest";

import { blocosDaEmissao, totalDeUnidades, UNIDADES_POR_REQUISICAO } from "./blocos";

const unidades = (n: number, empreendimento = "garden") =>
  Array.from({ length: n }, (_, i) => ({
    empreendimento,
    unidade: `Q1 L${String(i + 1).padStart(3, "0")}`,
  }));

describe("blocosDaEmissao", () => {
  it("parte a carteira do Garden em blocos que cabem no tempo da função", () => {
    // O caso real: 141 parcelas prontas em 03/09/2026, que numa requisição só passaram dos 300s.
    const blocos = blocosDaEmissao({ alvos: ["garden"], escolhidas: unidades(141) });

    expect(blocos).toHaveLength(8);
    expect(blocos.at(-1)?.unidades).toHaveLength(1);
    expect(blocos.every((b) => (b.unidades?.length ?? 0) <= UNIDADES_POR_REQUISICAO)).toBe(true);
  });

  it("não perde nem repete nenhuma unidade", () => {
    // ⚠️ O TESTE QUE IMPORTA. Fatiar errado emite duas vezes (cliente recebe dois boletos do mês) ou
    // deixa alguém de fora sem ninguém perceber, que é o pior dos dois: não aparece em lugar nenhum.
    const pedidas = unidades(141);
    const emitidas = blocosDaEmissao({ alvos: ["garden"], escolhidas: pedidas }).flatMap(
      (b) => b.unidades ?? [],
    );

    expect(emitidas).toHaveLength(141);
    expect(new Set(emitidas).size).toBe(141);
    expect(emitidas).toEqual(pedidas.map((p) => p.unidade));
  });

  it("separa por empreendimento, porque a conta do Asaas vem dele", () => {
    // A aba de teste tem seis carteiras com a MESMA unidade `TESTE-01`, uma por conta.
    const blocos = blocosDaEmissao({
      alvos: ["teste-garden", "teste-guaimbe"],
      escolhidas: [
        { empreendimento: "teste-garden", unidade: "TESTE-01" },
        { empreendimento: "teste-guaimbe", unidade: "TESTE-01" },
      ],
    });

    expect(blocos).toEqual([
      { slug: "teste-garden", unidades: ["TESTE-01"] },
      { slug: "teste-guaimbe", unidades: ["TESTE-01"] },
    ]);
  });

  it("cada empreendimento tem os seus blocos, sem misturar unidades", () => {
    const blocos = blocosDaEmissao({
      alvos: [],
      escolhidas: [...unidades(25, "garden"), ...unidades(3, "vale-do-sol")],
      tamanho: 10,
    });

    expect(blocos.map((b) => [b.slug, b.unidades?.length])).toEqual([
      ["garden", 10],
      ["garden", 10],
      ["garden", 5],
      ["vale-do-sol", 3],
    ]);
  });

  it("sem seleção, pede a carteira inteira de cada alvo", () => {
    const blocos = blocosDaEmissao({ alvos: ["garden", "on-sky"], escolhidas: [] });

    expect(blocos).toEqual([
      { slug: "garden", unidades: undefined },
      { slug: "on-sky", unidades: undefined },
    ]);
  });

  it("um tamanho inválido não vira laço infinito nem bloco vazio", () => {
    const blocos = blocosDaEmissao({ alvos: [], escolhidas: unidades(3), tamanho: 0 });

    expect(blocos.map((b) => b.unidades)).toEqual([["Q1 L001"], ["Q1 L002"], ["Q1 L003"]]);
  });
});

describe("totalDeUnidades", () => {
  it("conta o lote inteiro para a tela mostrar o progresso", () => {
    expect(totalDeUnidades(blocosDaEmissao({ alvos: [], escolhidas: unidades(141) }))).toBe(141);
  });

  it("devolve zero quando algum bloco não diz o tamanho", () => {
    // Zero é "não dá para contar", e a tela usa isso para não inventar um denominador.
    expect(totalDeUnidades([{ slug: "garden", unidades: undefined }])).toBe(0);
    expect(
      totalDeUnidades([
        { slug: "garden", unidades: ["Q1 L001"] },
        { slug: "on-sky", unidades: undefined },
      ]),
    ).toBe(0);
  });
});
