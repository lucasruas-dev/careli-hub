import { beforeEach, describe, expect, it, vi } from "vitest";

// OS EMPREENDIMENTOS DA TÊMIS: O NOME SAI DO CADASTRO DO PANTEON PELO ID (Lucas, 24/09/2026).
//
// O portão (`apolo_enterprise_settings`) guarda a sigla que a tela do empreendimento regravou com o
// código do C2X. Quando a Nivea renomeou o 43 no legado (RDV -> PDI), casar o nome só pela sigla
// deixava a lista mostrando "RDV" no lugar de "Portal do Ibituruna". O id do C2X não muda.

const estado = vi.hoisted(() => ({
  cadastro: [] as Array<Record<string, unknown>>,
  portoes: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: vi.fn(async () => estado.cadastro),
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      for (const metodo of ["select", "eq", "in", "returns"]) q[metodo] = () => q;
      q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve({ data: estado.portoes, error: null }).then(ok, falha);
      return q;
    },
  }),
}));

import type { AtorDoHub } from "./ator";
import { listarEmpreendimentosDaTemis } from "./trabalho-servico";

const HUB: AtorDoHub = { nome: "Jurídico", papel: "leitura", tipo: "hub", userId: "user-hub" };

async function linhas(): Promise<Array<{ code: string; id: string; name: string }>> {
  const r = await listarEmpreendimentosDaTemis(HUB);
  return ((await r.json()) as { data: { rows: Array<{ code: string; id: string; name: string }> } }).data.rows;
}

beforeEach(() => {
  estado.cadastro = [
    { c2xEnterpriseId: "43", codigo: "PDI", id: "pdi", nome: "Portal do Ibituruna", paiId: null },
  ];
  // O portão com a sigla velha, como estava antes do acerto do dado.
  estado.portoes = [{ code: "RDV", enterprise_id: "43" }];
});

describe("listarEmpreendimentosDaTemis", () => {
  it("⚠️ casa pelo id do C2X: a sigla velha do portão não apaga o nome", async () => {
    expect(await linhas()).toEqual([{ code: "PDI", id: "43", name: "Portal do Ibituruna" }]);
  });

  it("linha do cadastro sem id do C2X continua casando pelo código, como antes", async () => {
    estado.cadastro = [{ c2xEnterpriseId: null, codigo: "VOC", id: "voc", nome: "Vale do Ouro", paiId: null }];
    estado.portoes = [{ code: "VOC", enterprise_id: "37" }];
    expect(await linhas()).toEqual([{ code: "VOC", id: "37", name: "Vale do Ouro" }]);
  });

  it("o consolidado continua com o nome do grupo", async () => {
    estado.portoes = [{ code: "LBF + LBR + LBP", enterprise_id: "group:Lagoa Bonita" }];
    expect(await linhas()).toEqual([
      { code: "LBF + LBR + LBP", id: "group:Lagoa Bonita", name: "Lagoa Bonita" },
    ]);
  });
});
