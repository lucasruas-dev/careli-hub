import { describe, expect, it } from "vitest";

import {
  aoClicarNaColuna,
  type LinhaOrdenavel,
  ORDEM_INICIAL,
  ordenarEmpreendimentos,
} from "./ordem-dos-empreendimentos";

const linha = (name: string, n: Partial<Record<string, number>> = {}): LinhaOrdenavel => ({
  name,
  scenario: {
    bloqueado: { units: n.bloqueado ?? 0 },
    disponivel: { units: n.disponivel ?? 0 },
    negociacao: { units: n.negociacao ?? 0 },
    reservado: { units: n.reservado ?? 0 },
    total: { units: n.unidades ?? 0, value: n.vgv ?? 0 },
    vendido: { units: n.vendido ?? 0 },
  },
});

describe("ORDEM_INICIAL", () => {
  it("⚠️ a tabela abre em ordem ALFABÉTICA, e não por tamanho", () => {
    // A ordem antiga era a que o SQL devolvia — unidades decrescente —, então o Cidade Jardim ficava
    // sempre em cima por ter 532 lotes. Para quem procura um empreendimento pelo nome, tamanho é a
    // ordem menos útil que existe.
    expect(ORDEM_INICIAL).toEqual({ coluna: "nome", direcao: "asc" });

    const ordenada = ordenarEmpreendimentos(
      [
        linha("Vale do Ouro", { unidades: 298 }),
        linha("Cidade Jardim", { unidades: 532 }),
        linha("Jardim das Gerais", { unidades: 250 }),
      ],
      ORDEM_INICIAL,
    );
    expect(ordenada.map((l) => l.name)).toEqual([
      "Cidade Jardim",
      "Jardim das Gerais",
      "Vale do Ouro",
    ]);
  });

  it("⚠️ acento não joga o nome para o fim do alfabeto", () => {
    // Sem `localeCompare` com pt-BR, a ordem de bytes põe "Área" depois de "Zona".
    const ordenada = ordenarEmpreendimentos(
      [linha("Zona Norte"), linha("Área Verde"), linha("Bosque")],
      ORDEM_INICIAL,
    );
    expect(ordenada.map((l) => l.name)).toEqual(["Área Verde", "Bosque", "Zona Norte"]);
  });
});

describe("aoClicarNaColuna", () => {
  it("⚠️ coluna numérica nova começa no MAIOR, que é a pergunta que se faz", () => {
    // Clicar em "Vendido" querendo ver quem vendeu MENOS é raro.
    expect(aoClicarNaColuna(ORDEM_INICIAL, "vendido")).toEqual({
      coluna: "vendido",
      direcao: "desc",
    });
  });

  it("o nome começa sempre em A→Z", () => {
    expect(aoClicarNaColuna({ coluna: "vgv", direcao: "desc" }, "nome")).toEqual({
      coluna: "nome",
      direcao: "asc",
    });
  });

  it("clicar de novo na MESMA coluna inverte — aí a intenção é explícita", () => {
    const uma = aoClicarNaColuna(ORDEM_INICIAL, "vgv");
    expect(uma.direcao).toBe("desc");
    expect(aoClicarNaColuna(uma, "vgv").direcao).toBe("asc");
    expect(aoClicarNaColuna({ coluna: "nome", direcao: "asc" }, "nome").direcao).toBe("desc");
  });
});

describe("ordenarEmpreendimentos", () => {
  it("ordena pelos números do cenário", () => {
    const linhas = [
      linha("A", { vendido: 9 }),
      linha("B", { vendido: 474 }),
      linha("C", { vendido: 240 }),
    ];
    expect(
      ordenarEmpreendimentos(linhas, { coluna: "vendido", direcao: "desc" }).map((l) => l.name),
    ).toEqual(["B", "C", "A"]);
  });

  it("o VGV vem do valor, não das unidades", () => {
    const linhas = [
      linha("Pequeno em lotes", { unidades: 10, vgv: 186_151_112 }),
      linha("Grande em lotes", { unidades: 500, vgv: 21_289_081 }),
    ];
    expect(
      ordenarEmpreendimentos(linhas, { coluna: "vgv", direcao: "desc" })[0]?.name,
    ).toBe("Pequeno em lotes");
  });

  it("⚠️ empate desempata pelo NOME, para a tabela não pular na tela", () => {
    // Há muitos empreendimentos com zero reservado: sem desempate estável, eles trocam de lugar
    // entre uma renderização e outra, debaixo do olho de quem está lendo.
    const linhas = [linha("Zeta"), linha("Alfa"), linha("Meio")];
    expect(
      ordenarEmpreendimentos(linhas, { coluna: "reservado", direcao: "desc" }).map((l) => l.name),
    ).toEqual(["Alfa", "Meio", "Zeta"]);
  });

  it("não mexe na lista original", () => {
    const linhas = [linha("Zeta"), linha("Alfa")];
    ordenarEmpreendimentos(linhas, ORDEM_INICIAL);
    expect(linhas.map((l) => l.name)).toEqual(["Zeta", "Alfa"]);
  });

  it("lista vazia não quebra", () => {
    expect(ordenarEmpreendimentos([], ORDEM_INICIAL)).toEqual([]);
  });
});
