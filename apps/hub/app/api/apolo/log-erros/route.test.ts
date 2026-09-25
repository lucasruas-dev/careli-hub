import { beforeEach, describe, expect, it, vi } from "vitest";

// O CÓDIGO DO EMPREENDIMENTO NO LOG DE ERROS SAI DO CADASTRO DO PANTEON, PELO ID (Lucas, 24/09/2026).
//
// A sigla de `apolo_enterprise_settings` é uma cópia que a tela do empreendimento regrava com o
// código que o C2X mostra na hora, e ficou velha quando a Nivea renomeou o 43 no legado (RDV ->
// PDI). O cadastro (`hercules_empreendimentos`) é casado pelo id do C2X, que não muda.

const estado = vi.hoisted(() => ({
  cadastro: [] as Array<Record<string, unknown>> | Error,
  settings: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/apolo/auth", () => ({
  authorizeApoloRead: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: vi.fn(async () => {
    if (estado.cadastro instanceof Error) throw estado.cadastro;
    return estado.cadastro;
  }),
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({
    from: (tabela: string) => {
      const q: Record<string, unknown> = {};
      for (const metodo of ["select", "gte", "order", "limit", "in"]) q[metodo] = () => q;
      const resposta =
        tabela === "apolo_cad_log_erros"
          ? {
              count: 1,
              data: [
                {
                  created_at: "2026-09-24T19:55:00Z",
                  enterprise_id: "43",
                  enterprise_nome: null,
                  id: "log-1",
                  imobiliaria_nome: "CONECTTA IMOVEIS",
                  mensagem: "Escolha ao menos um empreendimento.",
                  rota: "/api/publico/imobiliaria/credenciar",
                  status: 400,
                },
              ],
              error: null,
            }
          : { data: estado.settings, error: null };
      q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve(resposta).then(ok, falha);
      return q;
    },
  }),
}));

import { GET } from "./route";

beforeEach(() => {
  // O Panteon depois do acerto do Zeus: cadastro PDI; o settings ainda com a sigla velha.
  estado.cadastro = [
    { c2xEnterpriseId: "43", codigo: "PDI", id: "pdi", nome: "Portal do Ibituruna", paiId: null },
  ];
  estado.settings = [{ code: "RDV", enterprise_id: "43" }];
});

async function nomeDoEmpreendimento(): Promise<unknown> {
  const r = await GET(new Request("http://localhost/api/apolo/log-erros"));
  const corpo = (await r.json()) as { data: { itens: Array<{ enterprise_nome: unknown }> } };
  return corpo.data.itens[0]?.enterprise_nome;
}

describe("GET /api/apolo/log-erros", () => {
  it("⚠️ o código vem do cadastro do Panteon pelo id, não da sigla velha do settings", async () => {
    expect(await nomeDoEmpreendimento()).toBe("PDI");
  });

  it("sem linha no cadastro, a sigla do settings continua valendo", async () => {
    estado.cadastro = [];
    expect(await nomeDoEmpreendimento()).toBe("RDV");
  });

  it("cadastro fora do ar não derruba o log: volta a sigla do settings", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    estado.cadastro = new Error("fora");
    expect(await nomeDoEmpreendimento()).toBe("RDV");
    erro.mockRestore();
  });
});
