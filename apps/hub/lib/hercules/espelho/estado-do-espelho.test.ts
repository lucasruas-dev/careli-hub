import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { estadoDoEspelho } from "./estado-do-espelho";

// O QUE ESTE TESTE PROTEGE: o espelho público de um PRÉDIO (Lucas, 16/09/2026: apartamento nunca é
// quadra/lote) e o de um loteamento, que não pode mudar em nada por causa do prédio. O cliente é
// falso e só responde às três leituras que o espelho faz: unidades, propostas abertas e reservas.

type Linha = Record<string, unknown>;

type Respostas = {
  /** Erro para a PRIMEIRA leitura de unidades que pedir as colunas do prédio. */
  erroComColunasDoPredio?: { code: string; message: string };
  propostas?: { unidade_id: string }[];
  reservas?: { unidade_id: string }[];
  unidades: Linha[];
};

function clienteFalso(respostas: Respostas) {
  const selects: string[] = [];
  const client = {
    from(tabela: string) {
      return {
        select(colunas: string) {
          if (tabela === "hercules_unidades") selects.push(colunas);
          const responder = async (de: number) => {
            if (tabela === "hercules_unidades") {
              if (respostas.erroComColunasDoPredio && colunas.includes("apartamento")) {
                return { data: null, error: respostas.erroComColunasDoPredio };
              }
              // Sem as colunas pedidas, a linha volta sem elas, como o PostgREST devolveria.
              const pedidas = colunas.split(",").map((c) => c.trim());
              const linhas = respostas.unidades.map((u) =>
                Object.fromEntries(Object.entries(u).filter(([k]) => pedidas.includes(k))),
              );
              return { data: de === 0 ? linhas : [], error: null };
            }
            const linhas = tabela === "hercules_propostas" ? respostas.propostas : respostas.reservas;
            return { data: de === 0 ? (linhas ?? []) : [], error: null };
          };
          const cadeia = {
            eq: () => cadeia,
            in: () => cadeia,
            range: (de: number) => responder(de),
          };
          return cadeia;
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, selects };
}

const lote = (u: Linha): Linha => ({
  area: "300.00",
  codigo: "VOC0105",
  enterprise_id: "37",
  id: String(u.codigo ?? "VOC0105"),
  lote: "05",
  preco_tabela: "150000.00",
  quadra: "01",
  situacao: "disponivel",
  ...u,
});

const apto = (u: Linha): Linha => ({
  andar: null,
  area: "68.45",
  enterprise_id: "100001",
  lote: null,
  preco_tabela: "480000.00",
  quadra: null,
  situacao: "disponivel",
  tipologia: null,
  torre: null,
  vagas: null,
  ...u,
  id: String(u.codigo),
});

describe("estadoDoEspelho: loteamento continua igual", () => {
  it("pai e filho viram um lote só, com o código do pai, e o rótulo de quadra e lote", async () => {
    const { client } = clienteFalso({
      unidades: [
        lote({ codigo: "VLO0105", enterprise_id: "1", situacao: "vendida" }),
        lote({ codigo: "VOC0105", enterprise_id: "37" }),
        lote({ codigo: "VOC0210", enterprise_id: "37", lote: "10", quadra: "02" }),
        lote({ codigo: "VOC0102", enterprise_id: "37", lote: "02", quadra: "01" }),
      ],
    });

    const estado = await estadoDoEspelho(client, {
      enterpriseIdDoPai: "1",
      enterpriseIdsDosFilhos: ["37"],
    });

    expect(estado.lotes.map((l) => l.codigo)).toEqual(["VOC0102", "VLO0105", "VOC0210"]);
    // Quem vende é o filho: o pai parado dizendo "vendida" não esconde o lote.
    expect(estado.contagem).toEqual({ disponivel: 3, indisponivel: 0 });
    expect(estado.lotes[1]).toMatchObject({
      andar: null,
      apartamento: null,
      area: 300,
      grupo: "01",
      lote: "05",
      numero: "05",
      preco: 150000,
      quadra: "01",
      rotulo: "Quadra 01 · Lote 05",
      tipoProduto: "loteamento",
      torre: null,
    });
  });

  it("lote sem quadra cai no grupo 'Sem quadra', o mesmo que a grade pública já usava", async () => {
    const { client } = clienteFalso({
      unidades: [lote({ codigo: "AVULSA", lote: null, quadra: null })],
    });
    const estado = await estadoDoEspelho(client, { enterpriseIdDoPai: null, enterpriseIdsDosFilhos: ["37"] });
    expect(estado.lotes[0]).toMatchObject({ grupo: "Sem quadra", numero: "", rotulo: "AVULSA" });
  });
});

describe("estadoDoEspelho: o prédio", () => {
  it("com torre: agrupa por torre, do andar mais alto para o mais baixo, e escreve Torre e Apto", async () => {
    const { client } = clienteFalso({
      reservas: [{ unidade_id: "JAD-A-1201" }],
      unidades: [
        apto({ andar: 1, apartamento: "101", codigo: "JAD-B-101", torre: "B" }),
        apto({ andar: 1, apartamento: "102", codigo: "JAD-A-102", torre: "A" }),
        apto({ andar: 12, apartamento: "1202", codigo: "JAD-A-1202", torre: "A", vagas: 2 }),
        apto({ andar: 12, apartamento: "1201", codigo: "JAD-A-1201", tipologia: "3 quartos", torre: "A" }),
      ],
    });

    const estado = await estadoDoEspelho(client, {
      enterpriseIdDoPai: "100001",
      enterpriseIdsDosFilhos: [],
    });

    expect(estado.lotes.map((l) => [l.grupo, l.numero])).toEqual([
      ["Torre A", "1201"],
      ["Torre A", "1202"],
      ["Torre A", "102"],
      ["Torre B", "101"],
    ]);
    expect(estado.lotes[0]).toMatchObject({
      andar: 12,
      apartamento: "1201",
      area: 68.45,
      lote: null,
      quadra: null,
      rotulo: "Torre A · Apto 1201",
      // Reserva viva: indisponível, como no loteamento.
      situacao: "indisponivel",
      tipologia: "3 quartos",
      tipoProduto: "vertical",
      torre: "A",
    });
    expect(estado.lotes[1]?.vagas).toBe(2);
    expect(estado.contagem).toEqual({ disponivel: 3, indisponivel: 1 });
    // ⚠️ Nenhum apartamento escrito como quadra e lote.
    expect(estado.lotes.some((l) => l.rotulo.includes("Quadra"))).toBe(false);
  });

  it("sem torre (torre única): grupo Unidades e só o apartamento", async () => {
    const { client } = clienteFalso({
      unidades: [
        apto({ andar: 3, apartamento: "304", codigo: "RUB-304" }),
        apto({ andar: 0, apartamento: "1", codigo: "RUB-1" }),
        apto({ andar: 3, apartamento: "303", codigo: "RUB-303", situacao: "bloqueada" }),
      ],
    });

    const estado = await estadoDoEspelho(client, { enterpriseIdDoPai: "100002", enterpriseIdsDosFilhos: [] });

    expect(estado.lotes.map((l) => [l.grupo, l.rotulo, l.situacao])).toEqual([
      ["Unidades", "Apto 303", "indisponivel"],
      ["Unidades", "Apto 304", "disponivel"],
      ["Unidades", "Apto 1", "disponivel"],
    ]);
  });

  it("⚠️ o mesmo apartamento no pai e no filho vira um só, pela torre e pelo apartamento", async () => {
    const { client } = clienteFalso({
      unidades: [
        apto({ andar: 3, apartamento: "304", codigo: "GTX-A-304", enterprise_id: "100010", situacao: "vendida", torre: "A" }),
        apto({ andar: 3, apartamento: "0304", codigo: "GT1-A-304", enterprise_id: "100011", torre: "a" }),
      ],
    });
    const estado = await estadoDoEspelho(client, {
      enterpriseIdDoPai: "100010",
      enterpriseIdsDosFilhos: ["100011"],
    });
    expect(estado.lotes).toHaveLength(1);
    expect(estado.lotes[0]).toMatchObject({ codigo: "GTX-A-304", situacao: "disponivel" });
  });

  it("produto vertical informado por quem chama, unidade sem as colunas: decompõe o código", async () => {
    const { client } = clienteFalso({
      unidades: [apto({ codigo: "JAD-C-501" })],
    });
    const estado = await estadoDoEspelho(client, {
      enterpriseIdDoPai: "100001",
      enterpriseIdsDosFilhos: [],
      tipoProduto: "vertical",
    });
    expect(estado.lotes[0]).toMatchObject({ grupo: "Unidades", rotulo: "Torre C · Apto 501", tipoProduto: "vertical" });
  });
});

describe("estadoDoEspelho sem a migration 0171", () => {
  it("⚠️ repete a leitura sem as colunas do prédio, e o loteamento sai igual", async () => {
    const { client, selects } = clienteFalso({
      erroComColunasDoPredio: {
        code: "42703",
        message: "column hercules_unidades.andar does not exist",
      },
      unidades: [lote({ codigo: "VOC0105" })],
    });

    const estado = await estadoDoEspelho(client, { enterpriseIdDoPai: null, enterpriseIdsDosFilhos: ["37"] });

    expect(selects).toHaveLength(2);
    expect(selects[0]).toContain("apartamento");
    expect(selects[1]).not.toContain("apartamento");
    expect(estado.lotes[0]).toMatchObject({ rotulo: "Quadra 01 · Lote 05", tipoProduto: "loteamento" });
  });

  it("erro que não é das colunas do prédio continua derrubando, sem repetir", async () => {
    const { client, selects } = clienteFalso({
      erroComColunasDoPredio: { code: "42501", message: "permission denied for table hercules_unidades" },
      unidades: [],
    });
    await expect(
      estadoDoEspelho(client, { enterpriseIdDoPai: "37", enterpriseIdsDosFilhos: [] }),
    ).rejects.toThrow("permission denied");
    expect(selects).toHaveLength(1);
  });
});
