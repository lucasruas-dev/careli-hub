import { beforeEach, describe, expect, it, vi } from "vitest";

// O CRM DO PORTAL COM O C2X FORA DO AR (achado 14 da revisão da onda 2).
//
// `loadApoloEnterpriseCarteira` e `loadApoloEnterpriseVendas` fazem `pool.query` sem try/catch e
// LANÇAM quando o MySQL recusa a conexão. A rota caía em 500 sem corpo. Travado aqui: a exceção do
// loader vira 503 com a frase acentuada da aba, e nunca lista vazia.

const estado = vi.hoisted(() => ({
  carteira: vi.fn(),
  vendas: vi.fn(),
}));

vi.mock("@/lib/apolo/incorporador/escopo", () => ({
  autorizar: () => ({ ok: true, sessao: { enterpriseIds: ["37"], slug: "gurgel", tipo: "comercial" } }),
  codigosDaSessao: async () => ["VOC"],
  idsDaSessao: async () => ["37"],
}));

vi.mock("@/lib/apolo/carteira", () => ({ loadApoloEnterpriseCarteira: estado.carteira }));
vi.mock("@/lib/apolo/vendas", () => ({ loadApoloEnterpriseVendas: estado.vendas }));
vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({ catalogoDeEmpreendimentos: async () => [] }));
vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: () => ({}) }));
vi.mock("@/lib/apolo/incorporador/crm", () => ({
  agregarCompradores: () => [],
  agregarImobiliarias: () => [],
  anexarIdentidade: (lista: unknown) => lista,
  contarCadsPorImobiliaria: () => new Map(),
  lerEsteiraDoEscopo: async () => ({ linhas: [], ok: true }),
  lerIdentidades: async () => new Map(),
  lerImobiliariasVinculadas: async () => ({ credenciadas: [], ok: true }),
  montarProspects: async () => ({ ok: true, prospects: [] }),
}));

import { GET } from "./route";

const pedido = (aba: string) => new Request(`https://c2x.app.br/api/incorporador/crm?aba=${aba}`);

beforeEach(() => {
  estado.carteira.mockReset();
  estado.carteira.mockRejectedValue(new Error("connect ECONNREFUSED"));
  estado.vendas.mockReset();
  estado.vendas.mockResolvedValue({ data: { units: [] }, ok: true });
});

describe("/api/incorporador/crm com o loader do C2X lançando", () => {
  it("compradores: 503 com a frase da aba", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await GET(pedido("compradores"));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "Não foi possível carregar os compradores agora." });
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it("imobiliárias: 503 com a frase da aba", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await GET(pedido("imobiliarias"));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "Não foi possível carregar as imobiliárias agora." });
    erro.mockRestore();
  });

  it("com o C2X de pé a aba responde como sempre", async () => {
    estado.carteira.mockResolvedValue({ data: { units: [] }, ok: true });
    const r = await GET(pedido("compradores"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ data: { aba: "compradores", compradores: [] } });
  });
});
