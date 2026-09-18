import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SituacaoDasUnidades, SituacaoDaUnidade } from "@/lib/hercules/situacao-da-unidade";

// A PORTA DA ABA UNIDADES DO APOLO.
//
// O ramo do C2X (id do legado ou sem id) delega tudo para `loadApoloEnterpriseUnits`, cuja régua
// está provada em lib/apolo/empreendimentos-unidades.test.ts. Aqui se prova o OUTRO ramo, o do
// produto nascido no Panteon (id >= 100000): a linha vem de `hercules_unidades`, mas a situação
// vem da régua única (Lucas, 18/09/2026: *"esses status tem que morar em um so lugar"*), e não do
// `hercules_unidades.situacao` cru, que não sabe da proposta nem da reserva do Hércules.

vi.mock("@/lib/apolo/auth", () => ({
  authorizeApoloRead: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/apolo/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/server")>()),
  createApoloAdminClient: vi.fn(() => ({ cliente: "admin" })),
}));

vi.mock("@/lib/apolo/empreendimentos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/empreendimentos")>()),
  loadApoloEnterpriseUnits: vi.fn(),
}));

vi.mock("@/lib/apolo/incorporador/unidades-do-panteon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/incorporador/unidades-do-panteon")>()),
  lerUnidadesDoPanteon: vi.fn(),
}));

vi.mock("@/lib/hercules/situacao-da-unidade", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hercules/situacao-da-unidade")>()),
  lerSituacaoDasUnidades: vi.fn(),
}));

vi.mock("@/lib/prometeu/data", () => ({
  createPrometeuClient: vi.fn(() => null),
  eventoOperavelId: vi.fn(async () => null),
}));

import { loadApoloEnterpriseUnits } from "@/lib/apolo/empreendimentos";
import { lerUnidadesDoPanteon } from "@/lib/apolo/incorporador/unidades-do-panteon";
import { lerSituacaoDasUnidades } from "@/lib/hercules/situacao-da-unidade";

import { GET } from "./route";

const lerSituacao = vi.mocked(lerSituacaoDasUnidades);
const lerLinhas = vi.mocked(lerUnidadesDoPanteon);

function linha(id: string, codigo: string, situacaoCrua: string) {
  return {
    area: 300,
    codigo,
    enterprise_id: "100001",
    espelho_de: null,
    id,
    lote: "01",
    matricula: null,
    preco_tabela: 99000,
    quadra: "A",
    situacao: situacaoCrua,
  };
}

function mapaPorLinha(pares: Array<[string, SituacaoDaUnidade]>): SituacaoDasUnidades {
  const saida: SituacaoDasUnidades = {
    porCodigo: new Map(),
    porLinha: new Map(),
    porOrigemC2x: new Map(),
    unidades: [],
  };
  for (const [id, situacao] of pares) {
    const unidade = {
      codigo: id,
      enterpriseId: "100001",
      id,
      lote: null,
      origemC2xId: null,
      quadra: null,
      situacao,
    };
    saida.unidades.push(unidade);
    saida.porLinha.set(id, unidade);
  }
  return saida;
}

function pedido(query: string): Request {
  return new Request(`https://c2x.app.br/api/apolo/empreendimentos/unidades?${query}`, {
    headers: { authorization: "Bearer token" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/apolo/empreendimentos/unidades, produto nascido no Panteon", () => {
  it("⚠️ a situação é a da régua, e não o `situacao` cru do cadastro", async () => {
    lerLinhas.mockResolvedValue([
      linha("u1", "NOV0101", "disponivel"),
      linha("u2", "NOV0102", "disponivel"),
      linha("u3", "NOV0103", "disponivel"),
    ]);
    lerSituacao.mockResolvedValue(
      mapaPorLinha([
        ["u1", "contrato"],
        ["u2", "reservado"],
        ["u3", "disponivel"],
      ]),
    );

    const resposta = await GET(pedido("codes=NOV&id=100001"));
    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as {
      data: { units: Array<{ bucket: string; code: string; price: number; status: string }> };
    };

    expect(lerSituacao).toHaveBeenCalledWith({ cliente: "admin" }, ["100001"]);
    expect(corpo.data.units.map((u) => [u.code, u.bucket, u.status])).toEqual([
      ["NOV0101", "vendido", "Contrato"],
      ["NOV0102", "reservado", "Reservado"],
      ["NOV0103", "disponivel", "Disponível"],
    ]);
    // O resto da linha segue vindo do cadastro.
    expect(corpo.data.units[0]?.price).toBe(99000);
    expect(loadApoloEnterpriseUnits).not.toHaveBeenCalled();
  });

  it("⚠️ linha sem resposta da régua sai bloqueada, nunca livre", async () => {
    lerLinhas.mockResolvedValue([linha("u9", "NOV0909", "disponivel")]);
    lerSituacao.mockResolvedValue(mapaPorLinha([]));

    const corpo = (await (await GET(pedido("codes=NOV&id=100001"))).json()) as {
      data: { units: Array<{ bucket: string; status: string }> };
    };

    expect(corpo.data.units[0]).toMatchObject({ bucket: "bloqueado", status: "Bloqueado" });
  });

  it("⚠️ falha ao ler a situação é 503 com texto, sem lista", async () => {
    lerLinhas.mockResolvedValue([linha("u1", "NOV0101", "disponivel")]);
    lerSituacao.mockRejectedValue(new Error("timeout"));

    const resposta = await GET(pedido("codes=NOV&id=100001"));

    expect(resposta.status).toBe(503);
    const corpo = (await resposta.json()) as { data?: unknown; error?: string };
    expect(corpo.data).toBeUndefined();
    expect(corpo.error).toMatch(/Não foi possível carregar as unidades/);
  });
});

describe("GET /api/apolo/empreendimentos/unidades, produto do C2X", () => {
  it("delega para loadApoloEnterpriseUnits, e o erro dele (situação ilegível) vira 503", async () => {
    vi.mocked(loadApoloEnterpriseUnits).mockResolvedValue({
      error: "Não foi possível ler a situação das unidades no Panteon agora. Tente de novo em instantes.",
      ok: false,
    });

    const resposta = await GET(pedido("codes=LBP"));

    expect(resposta.status).toBe(503);
    expect(loadApoloEnterpriseUnits).toHaveBeenCalledWith(["LBP"]);
    expect(lerLinhas).not.toHaveBeenCalled();
  });
});
