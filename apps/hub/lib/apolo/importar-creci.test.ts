import { describe, expect, it, vi } from "vitest";

import {
  creciLimpo,
  creciParaGravar,
  emLotes,
  importarCreciDoC2x,
  validadeLimpa,
} from "./importar-creci";

describe("o número do CRECI que vale gravar", () => {
  it("passa o número como o legado escreveu", () => {
    // O CRECI da FLAT IMOBILIARIA, o caso que abriu a frente (contrato do Vale do Ouro).
    expect(creciLimpo("53964")).toBe("53964");
    expect(creciLimpo(" 8.015 ")).toBe("8.015");
    expect(creciLimpo("CRECI 12345-F")).toBe("CRECI 12345-F");
  });

  // ⚠️ O CAMPO DO LEGADO TEM LIXO, e gravar lixo é pior do que não gravar: o contrato imprimiria um
  // CRECI que não existe, em vez do colchete que avisa.
  it("não grava o vazio do legado", () => {
    expect(creciLimpo(null)).toBeNull();
    expect(creciLimpo("")).toBeNull();
    expect(creciLimpo("   ")).toBeNull();
    expect(creciLimpo("-")).toBeNull();
    expect(creciLimpo("NAO TEM")).toBeNull();
    expect(creciLimpo("0")).toBeNull();
    expect(creciLimpo("000")).toBeNull();
  });
});

describe("a validade", () => {
  it("aceita o que o MySQL devolve", () => {
    expect(validadeLimpa(new Date("2027-05-10T00:00:00Z"))).toBe("2027-05-10");
    expect(validadeLimpa("2027-05-10")).toBe("2027-05-10");
    expect(validadeLimpa("2027-05-10T03:00:00.000Z")).toBe("2027-05-10");
    expect(validadeLimpa("10/05/2027")).toBe("2027-05-10");
  });

  it("sem data, nulo — e nunca hoje", () => {
    expect(validadeLimpa(null)).toBeNull();
    expect(validadeLimpa("")).toBeNull();
    expect(validadeLimpa("sei la")).toBeNull();
  });
});

describe("o que sai do C2X para gravação", () => {
  it("fica só quem tem CRECI de verdade", () => {
    const saida = creciParaGravar([
      { creci_number: "53964", creci_validate: "2027-05-10", id: 4321 },
      { creci_number: "  ", creci_validate: null, id: 999 },
      { creci_number: null, creci_validate: null, id: 1000 },
    ]);

    expect(saida).toEqual([
      { creci: "53964", creciValidade: "2027-05-10", sourceId: "4321" },
    ]);
  });
});

// ⚠️ LOTES DE 100 porque `.in()` com centenas de ids estoura o tamanho da URL do PostgREST — já
// derrubou a Iris inteira em produção uma vez.
describe("os lotes", () => {
  it("quebra de 100 em 100", () => {
    const itens = Array.from({ length: 250 }, (_, i) => i);
    const lotes = emLotes(itens);
    expect(lotes.map((l) => l.length)).toEqual([100, 100, 50]);
  });

  it("lista vazia não vira lote", () => {
    expect(emLotes([])).toEqual([]);
  });
});

describe("a importação", () => {
  function clienteFalso(vinculos: { entity_id: string; source_id: string }[]) {
    const updates: { creci: string; id: string }[] = [];
    const client = {
      from: (tabela: string) => {
        if (tabela === "apolo_source_links") {
          const query = {
            eq: () => query,
            in: () => Promise.resolve({ data: vinculos, error: null }),
            select: () => query,
          };
          return query;
        }
        const update = (valores: { creci: string }) => ({
          eq: (_coluna: string, id: string) => ({
            is: () => {
              updates.push({ creci: valores.creci, id });
              return Promise.resolve({ error: null });
            },
          }),
        });
        return { update };
      },
    };
    return { client, updates };
  }

  it("grava o CRECI na entidade ligada àquele usuário do C2X", async () => {
    const { client, updates } = clienteFalso([
      { entity_id: "entidade-da-flat", source_id: "4321" },
    ]);

    const resultado = await importarCreciDoC2x({
      adminClient: client as never,
      consultarC2x: async () => [
        { creci_number: "53964", creci_validate: null, id: 4321 },
      ],
    });

    expect(updates).toEqual([{ creci: "53964", id: "entidade-da-flat" }]);
    expect(resultado.entidadesAtualizadas).toBe(1);
    expect(resultado.semVinculo).toBe(0);
  });

  it("usuário do C2X sem entidade no Panteon é contado, não perdido em silêncio", async () => {
    const { client } = clienteFalso([]);

    const resultado = await importarCreciDoC2x({
      adminClient: client as never,
      consultarC2x: async () => [
        { creci_number: "53964", creci_validate: null, id: 4321 },
      ],
    });

    expect(resultado).toEqual({ comCreciNoC2x: 1, entidadesAtualizadas: 0, semVinculo: 1 });
  });

  it("C2X sem ninguém com CRECI não faz nenhuma leitura no Panteon", async () => {
    const from = vi.fn();
    const resultado = await importarCreciDoC2x({
      adminClient: { from } as never,
      consultarC2x: async () => [],
    });

    expect(from).not.toHaveBeenCalled();
    expect(resultado.comCreciNoC2x).toBe(0);
  });
});
