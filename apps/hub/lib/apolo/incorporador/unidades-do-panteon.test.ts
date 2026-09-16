import { describe, expect, it } from "vitest";

import {
  estagioDaUnidadeDoPanteon,
  type LinhaDaUnidadeDoPanteon,
  lerUnidadesDoPanteon,
  unidadeDoPanteonNaTela,
} from "./unidades-do-panteon";

// AS UNIDADES DO PRODUTO QUE SÓ EXISTE NO PANTEON (revisão de 16/09/2026): a aba Unidades e o funil
// do Resumo deixam de sair vazios para o produto cadastrado pelo portal.

const linha = (over: Partial<LinhaDaUnidadeDoPanteon> = {}): LinhaDaUnidadeDoPanteon => ({
  area: "312,5",
  codigo: "TST0102",
  enterprise_id: "100001",
  espelho_de: null,
  id: "u-1",
  lote: "02",
  matricula: null,
  preco_tabela: 182000,
  quadra: "01",
  situacao: "disponivel",
  ...over,
});

describe("unidadeDoPanteonNaTela", () => {
  it("monta a linha da UnidadesTab com situação, preço, área e quadra/lote", () => {
    expect(unidadeDoPanteonNaTela(linha(), "TST")).toEqual({
      area: 312.5,
      block: "01",
      bucket: "disponivel",
      code: "TST0102",
      enterpriseCode: "TST",
      id: "u-1",
      kind: null,
      lot: "02",
      movement: null,
      price: 182000,
      registration: null,
      status: expect.any(String),
    });
  });

  it("⚠️ a matrícula da unidade vira a coluna Matrícula (a correção de unidade a edita)", () => {
    expect(unidadeDoPanteonNaTela(linha({ matricula: " 12.345 " }), "GDN").registration).toBe("12.345");
    expect(unidadeDoPanteonNaTela(linha({ matricula: "  " }), "GDN").registration).toBeNull();
    // Linha montada sem o campo (payload antigo) continua saindo sem matrícula, sem quebrar.
    const { matricula: _matricula, ...semMatricula } = linha();
    expect(unidadeDoPanteonNaTela(semMatricula, "GDN").registration).toBeNull();
  });

  it("a situação crua do Panteon cai no balde certo", () => {
    expect(unidadeDoPanteonNaTela(linha({ situacao: "reservada" }), "TST").bucket).toBe("reservado");
    expect(unidadeDoPanteonNaTela(linha({ situacao: "vendida" }), "TST").bucket).toBe("vendido");
    expect(unidadeDoPanteonNaTela(linha({ situacao: "bloqueada" }), "TST").bucket).toBe("bloqueado");
  });

  it("preço ausente vira zero e código ausente cai no id (a linha não some)", () => {
    const saida = unidadeDoPanteonNaTela(linha({ codigo: null, preco_tabela: null }), "TST");
    expect(saida.price).toBe(0);
    expect(saida.code).toBe("u-1");
  });
});

describe("estagioDaUnidadeDoPanteon", () => {
  it("vendida conta como faturada, negociação como proposta, reserva como reserva", () => {
    expect(estagioDaUnidadeDoPanteon("vendida")).toBe("faturado");
    expect(estagioDaUnidadeDoPanteon("em negociação")).toBe("proposta");
    expect(estagioDaUnidadeDoPanteon("reservada")).toBe("reservado");
  });

  it("bloqueada e disponível não são venda", () => {
    expect(estagioDaUnidadeDoPanteon("bloqueada")).toBe("disponivel");
    expect(estagioDaUnidadeDoPanteon("disponivel")).toBe("disponivel");
    expect(estagioDaUnidadeDoPanteon(null)).toBe("disponivel");
  });
});

describe("lerUnidadesDoPanteon", () => {
  function clienteFalso(paginas: LinhaDaUnidadeDoPanteon[][], erro?: string) {
    const chamadas: Array<{ colunas: string; de: number; ids: string[] }> = [];
    const from = () => {
      let ids: string[] = [];
      let colunas = "";
      const cadeia = {
        eq: () => cadeia,
        in: (_coluna: string, valores: string[]) => {
          ids = valores;
          return cadeia;
        },
        order: () => cadeia,
        range: (de: number) => {
          chamadas.push({ colunas, de, ids });
          if (erro) return Promise.resolve({ data: null, error: { message: erro } });
          return Promise.resolve({ data: paginas[de / 1000] ?? [], error: null });
        },
        select: (lista: string) => {
          colunas = lista;
          return cadeia;
        },
      };
      return cadeia;
    };
    return { chamadas, cliente: { from } as unknown as Parameters<typeof lerUnidadesDoPanteon>[0] };
  }

  it("pagina de 1.000 em 1.000 e tira a linha antiga (espelho)", async () => {
    const cheia = Array.from({ length: 1000 }, (_, i) => linha({ id: `u-${i}` }));
    const { chamadas, cliente } = clienteFalso([
      cheia,
      [linha({ id: "viva" }), linha({ espelho_de: "viva", id: "antiga" })],
    ]);
    const saida = await lerUnidadesDoPanteon(cliente, ["100001", " 100001 "]);
    expect(chamadas.map((c) => c.de)).toEqual([0, 1000]);
    expect(chamadas[0]?.ids).toEqual(["100001"]);
    expect(chamadas[0]?.colunas.split(",")).toContain("matricula");
    expect(saida).toHaveLength(1001);
    expect(saida.some((u) => u.id === "antiga")).toBe(false);
  });

  it("sem ids não consulta; erro lança (nunca 'zero unidades')", async () => {
    const vazio = clienteFalso([]);
    expect(await lerUnidadesDoPanteon(vazio.cliente, [])).toEqual([]);
    expect(vazio.chamadas).toHaveLength(0);

    const fora = clienteFalso([], "fora do ar");
    await expect(lerUnidadesDoPanteon(fora.cliente, ["100001"])).rejects.toThrow("fora do ar");
  });
});
