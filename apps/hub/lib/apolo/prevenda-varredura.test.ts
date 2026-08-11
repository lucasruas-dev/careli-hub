import { describe, expect, it } from "vitest";

import {
  ehMotivoDeReprovacao,
  MOTIVO_VARREDURA,
  MOTIVO_VARREDURA_REVISAO,
  varrerPrevendaDesligada,
} from "./prevenda-varredura";

// Fake chainable no mesmo espírito de `esteira-guard.test.ts`. Só interessa `apolo_esteira`:
//   • o SELECT devolve as CADs que estão em pré-venda naquele empreendimento;
//   • cada UPDATE é registrado, com os ids do lote, para o teste conferir para onde cada uma foi.
function fakeClient(linhas: Array<{ entity_id: string; motivo: null | string }>) {
  const updates: Array<{ etapa: string; ids: string[]; motivo: string }> = [];

  const client = {
    from(tabela: string) {
      let operacao: "insert" | "select" | "update" = "select";
      let valores: Record<string, unknown> = {};
      let ids: string[] = [];

      const builder: Record<string, unknown> = {
        // O SELECT da varredura termina em `.returns<...>()`, que é thenable.
        returns: () => builder,
        then: (resolve: (v: unknown) => unknown) => {
          if (operacao === "select" && tabela === "apolo_esteira") {
            return Promise.resolve(resolve({ data: linhas, error: null }));
          }
          if (operacao === "update" && tabela === "apolo_esteira") {
            updates.push({
              etapa: String(valores.etapa),
              ids,
              motivo: String(valores.motivo),
            });
          }
          return Promise.resolve(resolve({ data: null, error: null }));
        },
      };
      for (const m of ["eq", "is", "limit", "not", "order", "select"]) {
        builder[m] = () => builder;
      }
      builder.in = (_coluna: string, lote: string[]) => {
        ids = lote;
        return builder;
      };
      builder.insert = () => {
        operacao = "insert";
        return builder;
      };
      builder.update = (v: Record<string, unknown>) => {
        operacao = "update";
        valores = v;
        return builder;
      };
      return builder;
    },
  };

  return { client: client as never, updates };
}

describe("ehMotivoDeReprovacao", () => {
  it("reconhece o motivo que a própria esteira carimba", () => {
    expect(
      ehMotivoDeReprovacao("Crédito reprovado. Restrições de R$ 74.385,73 acima do limite"),
    ).toBe(true);
  });

  it("aceita sem acento e com caixa diferente (o carimbo variou ao longo do tempo)", () => {
    expect(ehMotivoDeReprovacao("credito REPROVADO pelo Serasa")).toBe(true);
  });

  it("não confunde com outros motivos", () => {
    expect(ehMotivoDeReprovacao("Aprovado com restrição pela coordenação.")).toBe(false);
    expect(ehMotivoDeReprovacao(null)).toBe(false);
  });
});

describe("varrerPrevendaDesligada", () => {
  it("separa reprovados (revisão) de aprovados (credenciado)", async () => {
    const { client, updates } = fakeClient([
      { entity_id: "a", motivo: null },
      { entity_id: "b", motivo: "Crédito reprovado. Restrições de R$ 12.000,00" },
      { entity_id: "c", motivo: "Aprovado com restrição pela coordenação." },
    ]);

    const r = await varrerPrevendaDesligada(client, "35");

    expect(r).toEqual({ credenciado: 2, erro: null, revisao: 1 });

    const paraRevisao = updates.find((u) => u.etapa === "revisao");
    const paraCredenciado = updates.find((u) => u.etapa === "credenciado");
    expect(paraRevisao?.ids).toEqual(["b"]);
    expect(paraRevisao?.motivo).toBe(MOTIVO_VARREDURA_REVISAO);
    expect(paraCredenciado?.ids).toEqual(["a", "c"]);
    expect(paraCredenciado?.motivo).toBe(MOTIVO_VARREDURA);
  });

  it("empreendimento sem ninguém em pré-venda não escreve nada", async () => {
    const { client, updates } = fakeClient([]);

    const r = await varrerPrevendaDesligada(client, "39");

    expect(r).toEqual({ credenciado: 0, erro: null, revisao: 0 });
    expect(updates).toHaveLength(0);
  });

  it("sem empreendimento não varre nada (não sai movendo a esteira inteira)", async () => {
    const { client, updates } = fakeClient([{ entity_id: "a", motivo: null }]);

    const r = await varrerPrevendaDesligada(client, "  ");

    expect(r).toEqual({ credenciado: 0, erro: null, revisao: 0 });
    expect(updates).toHaveLength(0);
  });

  it("quebra em lotes de 100 — a lista de ids vai na URL do PostgREST", async () => {
    const muitas = Array.from({ length: 250 }, (_, i) => ({
      entity_id: `e${i}`,
      motivo: null,
    }));
    const { client, updates } = fakeClient(muitas);

    const r = await varrerPrevendaDesligada(client, "35");

    expect(r.credenciado).toBe(250);
    expect(updates).toHaveLength(3);
    expect(updates.map((u) => u.ids.length)).toEqual([100, 100, 50]);
  });
});
