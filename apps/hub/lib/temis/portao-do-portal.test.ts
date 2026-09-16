import { beforeEach, describe, expect, it, vi } from "vitest";

// A PORTA DA TÊMIS DO PORTAL — o caminho de SEGURANÇA.
//
// O que está travado aqui: sem sessão responde 401; o portal comercial (Gurgel) e o incorporador
// padrão (`cer`) respondem 404 SEM consultar o cadastro; o Cecílio passa e recebe o ator com os
// empreendimentos expandidos; cadastro inativo, divergente ou fora do ar não deixa passar. Desde a
// revisão da onda 3: a CONTA desativada e o empreendimento revogado no Setup valem na hora, sem
// esperar o cookie de 12 horas vencer.
//
// O cadastro e o catálogo do C2X são mockados: o teste é da REGRA da porta, não da leitura.

const estado = vi.hoisted(() => ({
  carregar: vi.fn(),
  contaAtiva: vi.fn(),
  escopo: vi.fn(),
}));

vi.mock("@/lib/apolo/incorporador/dados", () => ({
  carregarIncorporadorPorSlug: estado.carregar,
  escopoDaConta: estado.escopo,
  usuarioIncorporadorSegueAtivo: estado.contaAtiva,
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({ ok: false }),
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [
    {
      codes: ["LBF", "LBR", "LBP"],
      id: "group:Lagoa Bonita",
      name: "LAGOA BONITA",
      stageIds: ["33", "27", "32"],
    },
    { codes: ["VOC"], id: "37", name: "VALE DO OURO", stageIds: ["37"] },
  ],
}));

import { criarSessaoIncorporador, INCORPORADOR_COOKIE } from "@/lib/apolo/incorporador/sessao";

import { autorizarTemisDoPortal } from "./portao-do-portal";

const CECILIO_ID = "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6";

type Perfil = {
  enterpriseIds?: string[];
  incorporadorId?: string;
  slug: string;
  tipo?: "comercial" | "incorporador";
};

function requisicao(perfil: null | Perfil): Request {
  vi.stubEnv("SESSAO_INCORPORADOR_SECRET", "segredo-de-teste");
  const headers = new Headers();
  if (perfil) {
    const token = criarSessaoIncorporador(
      {
        enterpriseIds: perfil.enterpriseIds ?? ["37", "group:Lagoa Bonita"],
        enterpriseIdsComCarteira: [],
        incorporadorId: perfil.incorporadorId ?? CECILIO_ID,
        incorporadorNome: "Cecílio Rocha",
        slug: perfil.slug,
        tipo: perfil.tipo ?? "incorporador",
        usuarioId: "usuario-portal-1",
        usuarioNome: "Maria do Jurídico",
      },
      Date.now(),
    );
    headers.set("cookie", `${INCORPORADOR_COOKIE}=${token}`);
  }
  return new Request("https://c2x.app.br/api/incorporador/temis/trabalhos", { headers });
}

function cadastroDoCecilio(extra: Record<string, unknown> = {}) {
  return {
    ativo: true,
    empreendimentos: [],
    entityId: null,
    id: CECILIO_ID,
    logoEscuraPath: null,
    logoPath: null,
    nome: "Cecílio Rocha",
    slug: "cecilio-rocha",
    tipo: "incorporador",
    ...extra,
  };
}

describe("autorizarTemisDoPortal", () => {
  beforeEach(() => {
    estado.carregar.mockReset();
    estado.carregar.mockResolvedValue(cadastroDoCecilio());
    estado.contaAtiva.mockReset();
    estado.contaAtiva.mockResolvedValue(true);
    estado.escopo.mockReset();
    estado.escopo.mockResolvedValue({
      enterpriseIds: ["37", "group:Lagoa Bonita", "33"],
      enterpriseIdsComCarteira: [],
    });
  });

  it("sem sessão responde 401", async () => {
    const r = await autorizarTemisDoPortal(requisicao(null));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(401);
    expect(estado.carregar).not.toHaveBeenCalled();
    expect(estado.contaAtiva).not.toHaveBeenCalled();
  });

  it("o portal COMERCIAL (Gurgel) responde 404: opera a venda, não confecciona", async () => {
    const r = await autorizarTemisDoPortal(requisicao({ slug: "gurgel", tipo: "comercial" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(404);
    expect(await r.response.json()).toEqual({ error: "Nao encontrado." });
    expect(estado.carregar).not.toHaveBeenCalled();
    expect(estado.contaAtiva).not.toHaveBeenCalled();
    expect(estado.escopo).not.toHaveBeenCalled();
  });

  it("o comercial com o slug do Cecílio também responde 404 (o tipo manda)", async () => {
    const r = await autorizarTemisDoPortal(
      requisicao({ slug: "cecilio-rocha", tipo: "comercial" }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(404);
  });

  it("o incorporador padrão (cer) responde 404", async () => {
    const r = await autorizarTemisDoPortal(requisicao({ slug: "cer" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(404);
    expect(estado.carregar).not.toHaveBeenCalled();
  });

  it("o Cecílio passa e recebe o ator com os empreendimentos expandidos", async () => {
    const r = await autorizarTemisDoPortal(requisicao({ slug: "cecilio-rocha" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(estado.carregar).toHaveBeenCalledWith("cecilio-rocha");
    expect(estado.contaAtiva).toHaveBeenCalledWith("usuario-portal-1");
    expect(estado.escopo).toHaveBeenCalledWith(cadastroDoCecilio(), "usuario-portal-1");
    expect(r.ator).toMatchObject({
      incorporadorId: CECILIO_ID,
      nome: "Maria do Jurídico",
      slug: "cecilio-rocha",
      tipo: "portal",
      usuarioId: "usuario-portal-1",
    });
    // O grupo abre as divisões; o VOC vale por ele.
    expect([...r.ator.enterpriseIds].sort()).toEqual(
      ["27", "32", "33", "37", "group:Lagoa Bonita"].sort(),
    );
    expect(r.sessao.slug).toBe("cecilio-rocha");
  });

  it("sessão com UMA divisão não ganha o grupo nem as outras divisões", async () => {
    const r = await autorizarTemisDoPortal(
      requisicao({ enterpriseIds: ["33"], slug: "cecilio-rocha" }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ator.enterpriseIds).toEqual(["33"]);
  });

  it("incorporador inativo ou fora do cadastro responde 404", async () => {
    estado.carregar.mockResolvedValueOnce(null);
    const semCadastro = await autorizarTemisDoPortal(requisicao({ slug: "cecilio-rocha" }));
    expect(semCadastro.ok).toBe(false);
    if (!semCadastro.ok) expect(semCadastro.response.status).toBe(404);

    estado.carregar.mockResolvedValueOnce(cadastroDoCecilio({ ativo: false }));
    const inativo = await autorizarTemisDoPortal(requisicao({ slug: "cecilio-rocha" }));
    expect(inativo.ok).toBe(false);
    if (!inativo.ok) expect(inativo.response.status).toBe(404);
  });

  it("cookie de outro incorporador com o mesmo slug responde 404", async () => {
    const r = await autorizarTemisDoPortal(
      requisicao({ incorporadorId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", slug: "cecilio-rocha" }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(404);
  });

  it("cadastro que virou comercial depois do login responde 404", async () => {
    estado.carregar.mockResolvedValueOnce(cadastroDoCecilio({ tipo: "comercial" }));
    const r = await autorizarTemisDoPortal(requisicao({ slug: "cecilio-rocha" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(404);
  });

  it("cadastro fora do ar responde 503, nunca deixa passar", async () => {
    const silencio = vi.spyOn(console, "error").mockImplementation(() => undefined);
    estado.carregar.mockRejectedValueOnce(new Error("banco fora"));
    const r = await autorizarTemisDoPortal(requisicao({ slug: "cecilio-rocha" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(503);
    silencio.mockRestore();
  });

  it("conta desativada depois do login responde 404, com o incorporador ativo", async () => {
    estado.contaAtiva.mockResolvedValueOnce(false);
    const r = await autorizarTemisDoPortal(requisicao({ slug: "cecilio-rocha" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(404);
    expect(estado.escopo).not.toHaveBeenCalled();
  });

  it("conta que não deu para conferir responde 503, nunca deixa passar", async () => {
    estado.contaAtiva.mockResolvedValueOnce(null);
    const r = await autorizarTemisDoPortal(requisicao({ slug: "cecilio-rocha" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(503);
  });

  it("empreendimento revogado no Setup sai na hora: o cookie é cruzado com o escopo da conta", async () => {
    // O cookie ainda traz o VOC e o Lagoa Bonita; no banco a conta só tem o Lagoa Bonita.
    estado.escopo.mockResolvedValueOnce({
      enterpriseIds: ["group:Lagoa Bonita"],
      enterpriseIdsComCarteira: [],
    });
    const r = await autorizarTemisDoPortal(requisicao({ slug: "cecilio-rocha" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.ator.enterpriseIds].sort()).toEqual(
      ["27", "32", "33", "group:Lagoa Bonita"].sort(),
    );
    expect(r.ator.enterpriseIds).not.toContain("37");
    expect(r.sessao.enterpriseIds).toEqual(["group:Lagoa Bonita"]);
  });

  it("empreendimento acrescentado no banco NÃO entra pelo portão: o parâmetro do cookie só reduz", async () => {
    estado.escopo.mockResolvedValueOnce({
      enterpriseIds: ["37", "group:Lagoa Bonita", "41"],
      enterpriseIdsComCarteira: [],
    });
    const r = await autorizarTemisDoPortal(requisicao({ slug: "cecilio-rocha" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ator.enterpriseIds).not.toContain("41");
  });

  it("escopo da conta vazio responde 404; leitura do escopo que falhou responde 503", async () => {
    estado.escopo.mockResolvedValueOnce({ enterpriseIds: [], enterpriseIdsComCarteira: [] });
    const vazio = await autorizarTemisDoPortal(requisicao({ slug: "cecilio-rocha" }));
    expect(vazio.ok).toBe(false);
    if (!vazio.ok) expect(vazio.response.status).toBe(404);

    const silencio = vi.spyOn(console, "error").mockImplementation(() => undefined);
    estado.escopo.mockRejectedValueOnce(new Error("banco fora"));
    const falhou = await autorizarTemisDoPortal(requisicao({ slug: "cecilio-rocha" }));
    expect(falhou.ok).toBe(false);
    if (!falhou.ok) expect(falhou.response.status).toBe(503);
    silencio.mockRestore();
  });
});
