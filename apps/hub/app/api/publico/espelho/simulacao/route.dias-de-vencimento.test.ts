import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PropostaParaPdf } from "@/lib/hercules/proposta-pdf";

// O ESPELHO PÚBLICO SIMULA COM O PRIMEIRO DIA DE VENCIMENTO CADASTRADO (Lucas, 02/10/2026).
//
// Sem cadastro, ou com a leitura falhando, os 10 de sempre. A unidade é de uma divisão (42) e o pai
// do espelho é o 41: a rota tem de perguntar pelos dois, para a divisão sem cadastro herdar o pai.
//
// Mocks copiados de `route.entrada-da-tela.test.ts`, mais o da leitura dos dias.

const estado = vi.hoisted(() => ({
  folhas: [] as unknown[],
  lotes: [] as Array<{
    codigo: string;
    preco: null | number;
    situacao: "disponivel" | "indisponivel";
  }>,
  piso: 8 as null | number,
  recortes: [] as unknown[],
  dias: null as null | { cadastrado: boolean; dias: number[]; origem: null | string },
}));

const BASE_DO_PLANO = {
  indiceCorrecao: "SEM_CORRECAO",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  jurosTaxa: 0,
  sistemaAmortizacao: "sacoc",
} as const;

vi.mock("@/lib/hercules/espelho/abrir-espelho", () => {
  const cadeia = {
    eq: () => cadeia,
    in: () => cadeia,
    maybeSingle: async () => ({
      data: {
        area: 450,
        codigo: "CER0307",
        // A unidade é da DIVISÃO 42; o pai do espelho é o 41. É o que prova a herança.
        enterprise_id: 42,
        lote: "07",
        preco_tabela: 470_000,
        quadra: "03",
        situacao: "disponivel",
      },
      error: null,
    }),
    select: () => cadeia,
  };
  const client = {
    from: () => cadeia,
    storage: {
      from: () => ({
        download: async () => ({ data: null, error: { message: "sem logo" } }),
      }),
    },
  };
  return {
    abrirEspelho: async (token: null | string) =>
      token
        ? {
            espelho: {
              client,
              codigo: "cecilio-rocha",
              filhosC2xIds: [],
              masterplan: null,
              nome: "Cecílio Rocha",
              paiC2xId: "41",
            },
            ok: true,
          }
        : { erro: "sem_token", ok: false },
    ERRO_GENERICO: "Link inválido ou indisponível.",
  };
});

vi.mock("@/lib/hercules/espelho/estado-do-espelho", () => ({
  estadoDoEspelho: async () => ({
    atualizadoEm: "2026-09-22T12:00:00.000Z",
    contagem: { disponivel: 0, indisponivel: 0 },
    lotes: estado.lotes,
  }),
}));

vi.mock("@/lib/hercules/espelho/planos-publicos", () => ({
  pisoDeEntradaPublico: async () => estado.piso,
  planosPublicos: async () => [
    {
      ...BASE_DO_PLANO,
      anuaisQuantidade: 5,
      anuaisValor: 25_000,
      descontoPercentual: 0,
      entradaPercentual: 10,
      nome: "NORMAL",
      parcelas: 60,
    },
    {
      ...BASE_DO_PLANO,
      anuaisQuantidade: 4,
      anuaisValor: 25_000,
      descontoPercentual: 8,
      entradaPercentual: 8,
      nome: "INVESTIDOR PARCELADO",
      parcelas: 84,
    },
  ],
}));

vi.mock("@/lib/hercules/dias-de-vencimento-server", () => ({
  lerDiasDoEmpreendimento: async (_client: unknown, recorte: unknown) => {
    estado.recortes.push(recorte);
    return estado.dias;
  },
}));

vi.mock("@/lib/hercules/proposta-pdf", () => ({
  montarPropostaPdf: async (folha: unknown) => {
    estado.folhas.push(folha);
    return new Uint8Array([37, 80, 68, 70]);
  },
}));

const { POST } = await import("./route");

function pedir(corpo: Record<string, unknown>) {
  return POST(
    new Request("https://c2x.app.br/api/publico/espelho/simulacao?e=tok", {
      body: JSON.stringify(corpo),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

const condicao = (rotulo: string) =>
  (
    estado.folhas.at(-1) as PropostaParaPdf & { condicoes: Array<{ rotulo: string; valor: string }> }
  ).condicoes.find((c) => c.rotulo === rotulo)?.valor;

const PEDIDO = {
  anuaisQuantidade: 4,
  anuaisValor: 25_000,
  codigo: "CER0307",
  entrada: 50_000,
  entradaVezes: 1,
  parcelas: 84,
  plano: "INVESTIDOR PARCELADO",
  valor: 432_400,
};

beforeEach(() => {
  estado.folhas.length = 0;
  estado.recortes.length = 0;
  estado.lotes = [{ codigo: "CER0307", preco: 470_000, situacao: "disponivel" }];
  estado.piso = 8;
  estado.dias = null;
});

describe("o dia de vencimento da simulação pública", () => {
  it("é o PRIMEIRO dia cadastrado", async () => {
    estado.dias = { cadastrado: true, dias: [5, 15], origem: "pai" };
    const r = await pedir(PEDIDO);
    expect(r.status).toBe(200);
    expect(condicao("Vencimento")).toBe("todo dia 5");
    // E o cronograma agenda por ele: a primeira mensal cai no dia 5.
    expect(condicao("Primeira mensal")).toMatch(/^05\//);
  });

  it("pergunta pela unidade da divisão E pelo pai do espelho", async () => {
    await pedir(PEDIDO);
    expect(estado.recortes).toEqual([{ enterpriseId: "42", paiEnterpriseId: "41" }]);
  });

  it("sem cadastro, é o 10", async () => {
    estado.dias = { cadastrado: false, dias: [10, 20], origem: null };
    await pedir(PEDIDO);
    expect(condicao("Vencimento")).toBe("todo dia 10");
  });

  it("com a leitura falhando, também é o 10, e a simulação sai", async () => {
    estado.dias = null;
    const r = await pedir(PEDIDO);
    expect(r.status).toBe(200);
    expect(condicao("Vencimento")).toBe("todo dia 10");
  });
});
