import { describe, expect, it } from "vitest";

import {
  COLUNAS_DO_APARTAMENTO,
  ehUnidadeVertical,
  escritaCurtaDaUnidade,
  lerComColunasDoApartamento,
  nomeDaUnidade,
  nomeDaUnidadeNaTela,
  rotuloCurtoDoAndar,
  rotuloDoAndar,
  tipoDaUnidade,
} from "./nome-da-unidade";

describe("nomeDaUnidade", () => {
  it("quadra e lote preenchidos mandam", () => {
    expect(nomeDaUnidade({ codigo: "JDG0617", lote: "07", quadra: "03" })).toBe(
      "Quadra 03 · Lote 07",
    );
  });

  it("sem as colunas, decompõe o código do empreendimento", () => {
    expect(nomeDaUnidade({ codigo: "JDG0617", lote: null, quadra: null })).toBe(
      "Quadra 06 · Lote 17",
    );
    // Sigla de duas letras também: o C2X grava as duas formas.
    expect(nomeDaUnidade({ codigo: "VP0102", lote: null, quadra: null })).toBe(
      "Quadra 01 · Lote 02",
    );
  });

  it("⚠️ código fora do padrão sai como está, e não vira 'Quadra undefined'", () => {
    expect(nomeDaUnidade({ codigo: "APTO-101", lote: null, quadra: null })).toBe("APTO-101");
    expect(nomeDaUnidade({ codigo: "  A1  ", lote: null, quadra: null })).toBe("A1");
  });

  it("quadra sem lote não decide sozinha", () => {
    // Meia informação sairia como "Quadra 03 · Lote null" se a condição fosse por OU.
    expect(nomeDaUnidade({ codigo: "JDG0617", lote: null, quadra: "03" })).toBe(
      "Quadra 06 · Lote 17",
    );
  });
});

// ── O PRÉDIO ─────────────────────────────────────────────────────────────────
// Lucas (16/09/2026): apartamento nunca vira quadra/lote. O texto destas funções vai no WhatsApp e
// no PDF do comprador; "Quadra · Lote" para um apartamento é o erro que estes testes seguram.

describe("nomeDaUnidade no prédio", () => {
  it("com torre, sai Torre e Apto", () => {
    expect(
      nomeDaUnidade({
        apartamento: "304",
        codigo: "JAD-A-304",
        lote: null,
        quadra: null,
        tipoProduto: "vertical",
        torre: "A",
      }),
    ).toBe("Torre A · Apto 304");
  });

  it("sem torre (prédio de torre única), sai só o apartamento", () => {
    expect(
      nomeDaUnidade({
        apartamento: "1203",
        codigo: "JAD-1203",
        lote: null,
        quadra: null,
        tipoProduto: "vertical",
        torre: null,
      }),
    ).toBe("Apto 1203");
  });

  it("⚠️ sem o tipo do produto, o apartamento preenchido basta", () => {
    // A rota que não cruzou com o cadastro do produto ainda escreve certo: loteamento nunca grava
    // apartamento.
    expect(
      nomeDaUnidade({ apartamento: "0304", codigo: "JAD-B-304", lote: null, quadra: null, torre: "b" }),
    ).toBe("Torre B · Apto 304");
  });

  it("produto vertical sem as colunas na leitura: decompõe o código da fundação", () => {
    const base = { codigo: "JAD-A-304", lote: null, quadra: null, tipoProduto: "vertical" };
    expect(nomeDaUnidade(base)).toBe("Torre A · Apto 304");
    expect(nomeDaUnidade({ ...base, codigo: "ONSKY-1203" })).toBe("Apto 1203");
  });

  it("⚠️ com a coluna do apartamento, torre nula é torre única, e não a do código", () => {
    expect(
      nomeDaUnidade({
        apartamento: "304",
        codigo: "JAD-A-304",
        lote: null,
        quadra: null,
        tipoProduto: "vertical",
        torre: null,
      }),
    ).toBe("Apto 304");
  });

  it("vertical sem apartamento e com código fora do padrão sai o código, sem inventar", () => {
    expect(nomeDaUnidade({ codigo: "X1", lote: null, quadra: null, tipoProduto: "vertical" })).toBe("X1");
  });

  it("⚠️ o loteamento não muda: código com hífen sem tipo vertical continua como está", () => {
    expect(nomeDaUnidade({ codigo: "APTO-101", lote: null, quadra: null })).toBe("APTO-101");
    expect(
      nomeDaUnidade({ codigo: "JDG0617", lote: "07", quadra: "03", tipoProduto: "loteamento" }),
    ).toBe("Quadra 03 · Lote 07");
    // Quadra e lote preenchidos: apartamento perdido na linha não transforma o lote em prédio.
    expect(nomeDaUnidade({ apartamento: "304", codigo: "JDG0617", lote: "07", quadra: "03" })).toBe(
      "Quadra 03 · Lote 07",
    );
  });
});

describe("ehUnidadeVertical e tipoDaUnidade", () => {
  it("o tipo do produto manda; sem ele, as colunas", () => {
    expect(ehUnidadeVertical({ lote: null, quadra: null, tipoProduto: "vertical" })).toBe(true);
    expect(ehUnidadeVertical({ apartamento: "304", lote: null, quadra: null })).toBe(true);
    expect(ehUnidadeVertical({ apartamento: "  ", lote: null, quadra: null })).toBe(false);
    expect(ehUnidadeVertical({ lote: "07", quadra: "03" })).toBe(false);
    expect(tipoDaUnidade({ lote: "07", quadra: "03", tipoProduto: null })).toBe("loteamento");
    expect(tipoDaUnidade({ apartamento: "12", lote: null, quadra: null })).toBe("vertical");
  });
});

describe("escritaCurtaDaUnidade (a tela Venda)", () => {
  it("loteamento igual ao que a TelaVenda escrevia", () => {
    expect(escritaCurtaDaUnidade({ codigo: "VOL0307", lote: "07", quadra: "03" })).toEqual({
      recorte: "VOL",
      unidade: "03 07",
    });
    expect(escritaCurtaDaUnidade({ codigo: "VOL0307", lote: null, quadra: null })).toEqual({
      recorte: "VOL",
      unidade: "03 07",
    });
    expect(escritaCurtaDaUnidade({ codigo: "AVULSA-9", lote: null, quadra: null })).toEqual({
      recorte: null,
      unidade: "AVULSA-9",
    });
  });

  it("⚠️ código de produto com 5 letras não é cortado", () => {
    expect(escritaCurtaDaUnidade({ codigo: "SOLAR0101", lote: "01", quadra: "01" }).recorte).toBe(
      "SOLAR",
    );
    expect(
      escritaCurtaDaUnidade({
        apartamento: "1203",
        codigo: "ONSKY-A-1203",
        lote: null,
        quadra: null,
        tipoProduto: "vertical",
        torre: "A",
      }),
    ).toEqual({ recorte: "ONSKY", unidade: "Torre A · Apto 1203" });
  });

  it("vertical sem torre e com sigla que tem número", () => {
    expect(
      escritaCurtaDaUnidade({ apartamento: "71", codigo: "GT2-71", lote: null, quadra: null, torre: null }),
    ).toEqual({ recorte: "GT2", unidade: "Apto 71" });
  });
});

describe("nomeDaUnidadeNaTela", () => {
  it("loteamento como a modal escrevia, inclusive no código fora do padrão", () => {
    expect(nomeDaUnidadeNaTela({ codigo: "VOL0307", lote: "07", quadra: "03" })).toBe(
      "Quadra 03 · Lote 07",
    );
    expect(nomeDaUnidadeNaTela({ codigo: "Q07 L12", lote: null, quadra: null })).toBe(
      "Quadra Q07 · Lote L12",
    );
    expect(nomeDaUnidadeNaTela({ codigo: "302", lote: null, quadra: null })).toBe("302");
  });

  it("prédio por extenso, com e sem torre", () => {
    const apto = {
      apartamento: "304",
      codigo: "JAD-A-304",
      lote: null,
      quadra: null,
      tipoProduto: "vertical",
    };
    expect(nomeDaUnidadeNaTela({ ...apto, torre: "A" })).toBe("Torre A · Apto 304");
    expect(nomeDaUnidadeNaTela({ ...apto, torre: null })).toBe("Apto 304");
  });
});

describe("rótulo do andar", () => {
  it("longo e curto, com térreo e subsolo", () => {
    expect(rotuloDoAndar(3)).toBe("3º andar");
    expect(rotuloDoAndar(0)).toBe("Térreo");
    expect(rotuloDoAndar(-1)).toBe("1º subsolo");
    expect(rotuloDoAndar(null)).toBe("");
    expect(rotuloCurtoDoAndar(12)).toBe("12º");
    expect(rotuloCurtoDoAndar(0)).toBe("T");
    expect(rotuloCurtoDoAndar(-2)).toBe("S2");
    expect(rotuloCurtoDoAndar(undefined)).toBe("");
  });
});

describe("lerComColunasDoApartamento", () => {
  it("com a 0171 aplicada, uma leitura só, com as colunas", async () => {
    const pedidos: string[] = [];
    const r = await lerComColunasDoApartamento(async (extras) => {
      pedidos.push(extras);
      return { data: [{ id: "u1" }], error: null };
    });
    expect(pedidos).toEqual([COLUNAS_DO_APARTAMENTO]);
    expect(r).toEqual({ data: [{ id: "u1" }], error: null, semColunasDoApartamento: false });
  });

  it("⚠️ sem a 0171, repete sem as colunas e não derruba a leitura", async () => {
    const pedidos: string[] = [];
    const r = await lerComColunasDoApartamento(async (extras) => {
      pedidos.push(extras);
      return extras
        ? {
            data: null,
            error: { code: "42703", message: "column hercules_unidades.andar does not exist" },
          }
        : { data: [{ id: "u1" }], error: null };
    });
    expect(pedidos).toEqual([COLUNAS_DO_APARTAMENTO, ""]);
    expect(r.data).toEqual([{ id: "u1" }]);
    expect(r.semColunasDoApartamento).toBe(true);
  });

  it("erro de outra coluna volta para quem chamou, sem repetir", async () => {
    let chamadas = 0;
    const erro = { code: "42703", message: "column hercules_unidades.qudra does not exist" };
    const r = await lerComColunasDoApartamento(async () => {
      chamadas += 1;
      return { data: null, error: erro };
    });
    expect(chamadas).toBe(1);
    expect(r.error).toBe(erro);
  });
});
