import { beforeEach, describe, expect, it, vi } from "vitest";

import { idsDoC2xDasSiglas } from "@/lib/apolo/c2x-pelo-id";
import type { EmpreendimentoDoCatalogo } from "@/lib/apolo/catalogo-empreendimentos";

// AS VENDAS DO PORTAL PELO ID DO C2X (PAN-124, revisão de 25/09/2026).
//
// A rota tira as siglas do escopo do catálogo em cache e, até aqui, o loader as traduzia DE NOVO pelo
// catálogo do cache. Relido entre as duas traduções logo depois de um renome (o 43, de RDV para PDI,
// em 24/09/2026), o catálogo novo não conhecia mais a sigla do escopo e o funil saía zerado, sem erro.
// Agora a rota traduz UMA vez, pelo catálogo dela, e chama a versão por id.

const m = vi.hoisted(() => ({
  catalogo: vi.fn(),
  compradores: vi.fn(),
  eventos: vi.fn(),
  traduzir: vi.fn(),
  vendasPorIds: vi.fn(),
}));

vi.mock("@/lib/apolo/incorporador/escopo", () => ({
  autorizar: () => ({ ok: true, sessao: { enterpriseIds: ["43"], tipo: "incorporador" } }),
  codigosDaSessao: async () => ["RDV"],
  foraDoEscopo: () => new Response(null, { status: 404 }),
}));
vi.mock("@/lib/apolo/incorporador/codigos-do-pedido", () => ({
  codigosDoPedido: async (e: { codesAutorizados: string[] }) => ({ codes: e.codesAutorizados, ok: true }),
}));
vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({ catalogoDeEmpreendimentos: m.catalogo }));
vi.mock("@/lib/apolo/c2x-pelo-id-servidor", () => ({ idsDoC2xDasSiglasAoVivo: m.traduzir }));
vi.mock("@/lib/apolo/vendas", () => ({
  loadApoloEnterpriseVendas: () => {
    throw new Error("a rota não deve mais pedir as vendas pela sigla");
  },
  loadApoloEnterpriseVendasPorIds: m.vendasPorIds,
}));
vi.mock("@/lib/apolo/incorporador/vendas-bi", () => ({
  lerEventosDeVendas: m.eventos,
  montarIndicadoresDeVendasBI: () => null,
}));
vi.mock("@/lib/apolo/incorporador/perfil-comprador", () => ({
  agregarPerfilDoComprador: () => null,
  lerCompradoresDasVendas: m.compradores,
}));
vi.mock("@/lib/apolo/incorporador/vendas-resumo", () => ({
  resumoDeVendas: () => ({}),
  ritmoDeVendas: () => null,
  unidadesParaOPortal: () => [],
}));
vi.mock("@/lib/apolo/incorporador/contratos", () => ({ clientesUnicos: () => 0 }));
vi.mock("@/lib/apolo/incorporador/empreendimentos-do-portal", () => ({
  empreendimentosDoPortal: () => [],
}));

const { GET } = await import("./route");

/** O catálogo em cache de ANTES do renome: o 43 ainda é RDV. */
const CATALOGO: EmpreendimentoDoCatalogo[] = [
  { codes: ["RDV"], id: "43", name: "RECANTO DO VALE", stageIds: ["43"] },
];

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset();
  m.catalogo.mockResolvedValue(CATALOGO);
  m.eventos.mockResolvedValue({ error: "fora do teste", ok: false });
  m.compradores.mockResolvedValue({ error: "fora do teste", ok: false });
  m.vendasPorIds.mockResolvedValue({ data: { units: [] }, ok: true });
  m.traduzir.mockImplementation(
    async (siglas: Iterable<unknown>, opcoes: { catalogo?: EmpreendimentoDoCatalogo[] } = {}) => ({
      ok: true,
      ...idsDoC2xDasSiglas(siglas, { catalogo: opcoes.catalogo ?? [] }),
    }),
  );
});

const abrir = () => GET(new Request("https://c2x.app.br/api/incorporador/vendas"));

describe("GET /api/incorporador/vendas: o funil pelo id do C2X", () => {
  it("🔴 traduz as siglas UMA vez, pelo catálogo da rota, e pede o funil pelo id", async () => {
    const resposta = await abrir();
    expect(resposta.status).toBe(200);
    expect(m.traduzir).toHaveBeenCalledTimes(1);
    expect(m.traduzir).toHaveBeenCalledWith(["RDV"], { catalogo: CATALOGO });
    expect(m.vendasPorIds).toHaveBeenCalledWith([43]);
  });

  it("o histórico e o perfil do comprador recebem o MESMO catálogo", async () => {
    await abrir();
    expect(m.eventos).toHaveBeenCalledWith(["RDV"], { catalogo: CATALOGO });
    expect(m.compradores).toHaveBeenCalledWith(["RDV"], { catalogo: CATALOGO });
  });

  it("catálogo ilegível (C2X fora) é o 503 de sempre, sem ir ao C2X pelas vendas", async () => {
    m.traduzir.mockResolvedValue({ erro: "catálogo fora", ok: false });
    const resposta = await abrir();
    expect(resposta.status).toBe(503);
    expect(m.vendasPorIds).not.toHaveBeenCalled();
  });

  it("o loader que lança vira o mesmo 503 controlado", async () => {
    m.vendasPorIds.mockRejectedValue(new Error("mysql recusou"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const resposta = await abrir();
    expect(resposta.status).toBe(503);
    erro.mockRestore();
  });
});
