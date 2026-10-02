import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA DOS DIAS DE VENCIMENTO DA ABA POLÍTICAS COMERCIAIS, por comportamento.
//
// Os mocks são fábricas inteiras (sem `importOriginal`): auth, cliente do Supabase, cadastro do
// Panteon e o setter. A regra e a leitura rodam de verdade, que é o que este arquivo protege.

const estado = vi.hoisted(() => ({
  gravados: [] as Array<{ dias: null | number[]; enterpriseId: string }>,
  linhas: [] as Array<{ dias_vencimento: null | number[]; enterprise_id: string }>,
  pedidos: [] as string[][],
}));

vi.mock("@/lib/apolo/auth", () => ({
  authorizeApoloRead: async () => ({ nome: "Teste", ok: true, userId: "u-1" }),
  authorizeApoloWrite: async () => ({ nome: "Teste", ok: true, userId: "u-1" }),
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({
    from: () => ({
      select: () => ({
        in: async (_coluna: string, ids: string[]) => {
          estado.pedidos.push(ids);
          return {
            data: estado.linhas.filter((l) => ids.includes(l.enterprise_id)),
            error: null,
          };
        },
      }),
    }),
  }),
}));

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => [
    { c2xEnterpriseId: "35", codigo: "VLO", id: "u-vlo", paiId: null },
    { c2xEnterpriseId: "37", codigo: "VOC", id: "u-voc", paiId: "u-vlo" },
    { c2xEnterpriseId: "31", codigo: "LAB", id: "u-lab", paiId: null },
    { c2xEnterpriseId: "33", codigo: "LBF", id: "u-lbf", paiId: "u-lab" },
    { c2xEnterpriseId: "27", codigo: "LBR", id: "u-lbr", paiId: "u-lab" },
  ],
}));

vi.mock("@/lib/apolo/enterprise-settings", () => ({
  setEnterpriseDiasDeVencimento: async (input: { dias: null | number[]; enterpriseId: string }) => {
    estado.gravados.push({ dias: input.dias, enterpriseId: input.enterpriseId });
    return { ok: true };
  },
}));

const { GET, PUT } = await import("./route");

const URL_BASE = "https://c2x.app.br/api/apolo/empreendimentos/dias-de-vencimento";

const ler = async (consulta: string) => {
  const r = await GET(new Request(`${URL_BASE}?${consulta}`));
  return { corpo: (await r.json()) as { data?: Record<string, unknown>; error?: string }, status: r.status };
};

const gravar = async (corpo: unknown) => {
  const r = await PUT(
    new Request(URL_BASE, {
      body: JSON.stringify(corpo),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    }),
  );
  return { corpo: (await r.json()) as { data?: Record<string, unknown>; error?: string }, status: r.status };
};

beforeEach(() => {
  estado.gravados.length = 0;
  estado.linhas = [];
  estado.pedidos.length = 0;
});

describe("GET", () => {
  it("com cadastro no próprio empreendimento", async () => {
    estado.linhas = [{ dias_vencimento: [5, 15], enterprise_id: "37" }];
    const { corpo, status } = await ler("enterprise=37");
    expect(status).toBe(200);
    expect(corpo.data).toMatchObject({
      doPai: null,
      enterpriseId: "37",
      paiEnterpriseId: "35",
      proprios: [5, 15],
      valendo: { cadastrado: true, dias: [5, 15], origem: "filho" },
    });
  });

  it("sem cadastro: 10 e 20, marcado como não cadastrado", async () => {
    const { corpo } = await ler("enterprise=37");
    expect(corpo.data).toMatchObject({
      proprios: null,
      valendo: { cadastrado: false, dias: [10, 20], origem: null },
    });
  });

  it("o filho sem cadastro mostra o que herda do pai, lido pelo cadastro do Panteon", async () => {
    estado.linhas = [{ dias_vencimento: [25], enterprise_id: "35" }];
    const { corpo } = await ler("enterprise=37");
    expect(estado.pedidos).toEqual([["37", "35"]]);
    expect(corpo.data).toMatchObject({
      doPai: [25],
      proprios: null,
      valendo: { cadastrado: true, dias: [25], origem: "pai" },
    });
  });

  it("o agrupamento `group:` lê e responde pelo pai das divisões", async () => {
    estado.linhas = [{ dias_vencimento: [8], enterprise_id: "31" }];
    const { corpo, status } = await ler("enterprise=group%3ALagoa%20Bonita&codes=LBF,LBR");
    expect(status).toBe(200);
    expect(corpo.data).toMatchObject({ enterpriseId: "31", proprios: [8] });
  });

  it("agrupamento sem pai comum responde 422 com a frase", async () => {
    const { status } = await ler("enterprise=group%3AX&codes=LBF,VOC");
    expect(status).toBe(422);
  });
});

describe("PUT", () => {
  it("grava a lista em ordem", async () => {
    const { corpo, status } = await gravar({ dias: [20, 5], enterpriseId: "37" });
    expect(status).toBe(200);
    expect(corpo.data).toEqual({ dias: [5, 20], enterpriseId: "37" });
    expect(estado.gravados).toEqual([{ dias: [5, 20], enterpriseId: "37" }]);
  });

  it.each([[[10, 29]], [[0]], [[31]], [[10, 10]], [["10"]]])(
    "recusa %j com 422, sem gravar nada",
    async (dias) => {
      const { corpo, status } = await gravar({ dias, enterpriseId: "37" });
      expect(status).toBe(422);
      expect(corpo.error).toBeTruthy();
      expect(estado.gravados).toHaveLength(0);
    },
  );

  it("lista vazia grava nulo (volta a herdar)", async () => {
    await gravar({ dias: [], enterpriseId: "37" });
    expect(estado.gravados).toEqual([{ dias: null, enterpriseId: "37" }]);
  });

  it("corpo sem `dias` é recusado, e não lido como 'apagar'", async () => {
    const { status } = await gravar({ enterpriseId: "37" });
    expect(status).toBe(400);
    expect(estado.gravados).toHaveLength(0);
  });

  it("corpo que não é objeto é recusado", async () => {
    expect((await gravar(null)).status).toBe(400);
    expect((await gravar([5])).status).toBe(400);
  });

  it("o agrupamento grava no pai das divisões", async () => {
    await gravar({ codes: ["LBF", "LBR"], dias: [8], enterpriseId: "group:Lagoa Bonita" });
    expect(estado.gravados).toEqual([{ dias: [8], enterpriseId: "31" }]);
  });
});
