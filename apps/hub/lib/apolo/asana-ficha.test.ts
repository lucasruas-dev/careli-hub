import { describe, expect, it } from "vitest";

import { camposDaFicha, gravarFichaDoLote } from "./asana-import";

// Client falso mínimo: guarda as fichas num Map e responde ao encadeamento que
// `gravarFichaDoLote` usa (select→eq→maybeSingle e update→eq).
function clienteFalso(inicial: Record<string, Record<string, unknown> | null>) {
  const fichas = new Map(Object.entries(inicial));
  const client = {
    from() {
      return {
        select() {
          return {
            eq(_coluna: string, id: string) {
              return {
                maybeSingle: async () =>
                  fichas.has(id) ? { data: { ficha: fichas.get(id) } } : { data: null },
              };
            },
          };
        },
        update(valores: { ficha: Record<string, unknown> }) {
          return {
            eq: async (_coluna: string, id: string) => {
              fichas.set(id, valores.ficha);
              return { error: null };
            },
          };
        },
      };
    },
  };
  return { client: client as never, fichas };
}

describe("gravarFichaDoLote", () => {
  // ⚠️ O invariante que protege o dia inteiro de trabalho do operador: reimportar do Asana
  // NÃO pode desfazer o que ele digitou na validação.
  it("nunca sobrescreve campo que já tem valor", async () => {
    const { client, fichas } = clienteFalso({
      "ent-1": { nomeMae: "MARIA CORRIGIDA PELO OPERADOR", profissaoId: "" },
    });

    await gravarFichaDoLote({
      client,
      itens: [
        {
          campos: { nomeMae: "MARIA LIDA TORTO PELO OCR", profissaoId: "42" },
          entityId: "ent-1",
        },
      ],
    });

    const ficha = fichas.get("ent-1")!;
    expect(ficha.nomeMae).toBe("MARIA CORRIGIDA PELO OPERADOR");
    // Campo vazio, esse sim, é preenchido.
    expect(ficha.profissaoId).toBe("42");
  });

  it("ignora entidade sem linha na esteira, em vez de criar uma solta", async () => {
    const { client, fichas } = clienteFalso({});
    const resultado = await gravarFichaDoLote({
      client,
      itens: [{ campos: { rg: "MG-12.345.678" }, entityId: "sem-esteira" }],
    });

    expect(resultado.atualizados).toBe(0);
    expect(fichas.size).toBe(0);
  });

  it("não grava vazio nem espaço em branco por cima de nada", async () => {
    const { client, fichas } = clienteFalso({ "ent-2": {} });
    await gravarFichaDoLote({
      client,
      itens: [{ campos: { nomePai: "   ", rg: null }, entityId: "ent-2" }],
    });

    expect(fichas.get("ent-2")).toEqual({});
  });
});

describe("camposDaFicha", () => {
  it("converte o texto livre do formulário nos ids das listas do C2X", () => {
    const campos = camposDaFicha({
      escolaridade: "Ensino Médio Completo",
      estadoCivil: "Casado(a)",
      profissao: "Comerciante",
      renda: "4500",
    });

    expect(campos.escolaridadeId).not.toBe("");
    expect(campos.estadoCivilId).not.toBe("");
    expect(campos.profissaoId).not.toBe("");
    expect(campos.rendaId).not.toBe("");
  });

  // REGRA: na dúvida, vazio. Campo em branco o operador resolve em segundos; campo ERRADO
  // ele não percebe — e profissão e renda entram na análise de crédito.
  it("deixa vazio o que não casa com confiança", () => {
    const campos = camposDaFicha({ profissao: "asdfgh", renda: "não informado" });
    expect(campos.profissaoId).toBe("");
    expect(campos.rendaId).toBe("");
  });
});
