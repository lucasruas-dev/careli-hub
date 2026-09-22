import { describe, expect, it } from "vitest";

import {
  acharQuadro,
  baldeDoEstagio,
  colunaDoCard,
  colunasDoQuadro,
  QUADRO_RESUMO,
  QUADROS,
  quadroDoTipo,
} from "./quadros";

// OS QUADROS DA TÊMIS, como o Lucas desenhou em 21/09/2026: um por serviço, com o caminho que cada
// um já tem, e um "Todos" com três seções por cima, só para o panorama.

describe("os quadros", () => {
  it("cancelamento e distrato dividem o mesmo quadro, porque o serviço é o mesmo", () => {
    expect(quadroDoTipo("cancelamento")).toBe("desfazer");
    expect(quadroDoTipo("distrato")).toBe("desfazer");
  });

  it("cada um dos outros tem o seu", () => {
    expect(quadroDoTipo("contrato")).toBe("contrato");
    expect(quadroDoTipo("cessao")).toBe("cessao");
    expect(quadroDoTipo("cancelamento_correcao")).toBe("correcao");
  });

  it("link velho ou aba que não existe cai no resumo, em vez de dar tela branca", () => {
    expect(acharQuadro("aba-que-nao-existe").id).toBe(QUADRO_RESUMO);
    expect(acharQuadro(null).id).toBe(QUADRO_RESUMO);
  });
});

describe("as colunas de cada quadro", () => {
  // ⚠️ A PALAVRA "FATURADO" SÓ FAZ SENTIDO NO CONTRATO. A função que traduz já existia; o quadro é
  // que imprimia o nome cru e mostrava "Faturado" num cancelamento.
  it("o contrato novo mantém as cinco etapas, terminando em Faturado", () => {
    const colunas = colunasDoQuadro(acharQuadro("contrato"));
    expect(colunas.map((c) => c.id)).toEqual([
      "analise",
      "contrato",
      "assinatura",
      "prazo_legal",
      "faturado",
      "indeferido",
    ]);
    expect(colunas.find((c) => c.id === "faturado")?.nome).toBe("Faturado");
  });

  it("desfazer a venda termina em Concluído, e não em Faturado", () => {
    const colunas = colunasDoQuadro(acharQuadro("desfazer"));
    expect(colunas.find((c) => c.id === "faturado")?.nome).toBe("Concluído");
    // Não tem pré-faturamento: nada a faturar.
    expect(colunas.map((c) => c.id)).not.toContain("prazo_legal");
  });

  // ⚠️ A COLUNA DE ASSINATURA EXISTE PORQUE O DISTRATO PASSA POR ELA. O cancelamento pula, e
  // simplesmente nunca tem card ali — o que é diferente de a coluna não existir.
  it("o quadro de desfazer tem assinatura, que é do distrato", () => {
    expect(colunasDoQuadro(acharQuadro("desfazer")).map((c) => c.id)).toEqual([
      "analise",
      "contrato",
      "assinatura",
      "faturado",
      "indeferido",
    ]);
  });

  // ⚠️ MEDIDO EM 21/09/2026: 4 cards indeferidos (2 contratos e 2 cancelamentos) eram carregados
  // pelo servidor e DESCARTADOS no desenho, porque a lista de colunas não tinha indeferido. Eles só
  // abriam por link direto.
  it("todo quadro de serviço tem a coluna de indeferido, no fim", () => {
    for (const quadro of QUADROS.filter((q) => q.id !== QUADRO_RESUMO)) {
      const colunas = colunasDoQuadro(quadro);
      expect(colunas.at(-1)?.id, quadro.nome).toBe("indeferido");
    }
  });

  it("o resumo tem três colunas, e só", () => {
    expect(colunasDoQuadro(acharQuadro(QUADRO_RESUMO)).map((c) => c.nome)).toEqual([
      "Novo",
      "Em andamento",
      "Finalizado",
    ]);
  });
});

describe("onde o card cai", () => {
  it("no quadro do serviço, o card fica no estágio dele", () => {
    const desfazer = acharQuadro("desfazer");
    expect(colunaDoCard(desfazer, "assinatura")).toBe("assinatura");
    expect(colunaDoCard(desfazer, "faturado")).toBe("faturado");
  });

  it("no resumo, o caminho inteiro vira três", () => {
    expect(baldeDoEstagio("analise")).toBe("novo");
    expect(baldeDoEstagio("contrato")).toBe("andamento");
    expect(baldeDoEstagio("assinatura")).toBe("andamento");
    expect(baldeDoEstagio("prazo_legal")).toBe("andamento");
    expect(baldeDoEstagio("faturado")).toBe("finalizado");
  });

  // ⚠️ INDEFERIDO ACABOU, mesmo sem ter feito o serviço. Tirá-lo do resumo esconderia um pedido que
  // alguém ainda vai cobrar; a etiqueta do card continua dizendo o que aconteceu.
  it("indeferido é finalizado, e não some do resumo", () => {
    expect(baldeDoEstagio("indeferido")).toBe("finalizado");
    expect(colunaDoCard(acharQuadro(QUADRO_RESUMO), "indeferido")).toBe("finalizado");
  });
});
