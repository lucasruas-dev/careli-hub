import { beforeEach, describe, expect, it, vi } from "vitest";

// AS CINCO ROTAS DO "NOVO CLIENTE" DO CRM DO PORTAL — a porta.
//
// Decisão do Lucas (16/09/2026): quem cadastra cliente pelo portal é o incorporador que opera
// sozinho (Cecílio). O comercial (Gurgel) NÃO ganha cadastro nesta onda. Travado aqui, em cada uma
// das cinco rotas: sem sessão 401; comercial 404 sem chegar na regra; Cecílio passa, com o ator
// que o portão monta (ids expandidos, usuário do portal). A regra em si é testada em
// lib/apolo/incorporador/cadastro-do-portal.test.ts.
//
// E a régua de quem OPERA o produto (decisão do Lucas, 16/09/2026), com a régua de verdade e só o
// cadastro do banco de dublê: VOC (37) é só consulta para a Cecílio e é recusado (403) no salvar, na
// checagem do CPF, no upload e nas exigências do produto; o Garden (39) passa. Sem a 0170, 503.

const estado = vi.hoisted(() => ({
  cadastro: vi.fn(),
  carregar: vi.fn(),
  checar: vi.fn(async () => ({ corpo: { data: { conferido: false, conflito: null } }, status: 200 })),
  configuracao: vi.fn(async () => ({ corpo: { data: { produtos: [] } }, status: 200 })),
  most: vi.fn(async () => ({ corpo: { data: { ok: true } }, status: 200 })),
  salvar: vi.fn(async () => ({ corpo: { entityId: "e" }, status: 201 })),
  upload: vi.fn(async () => ({ bucket: "apolo-documents", path: "p", token: "t" })),
}));

vi.mock("@/lib/apolo/incorporador/dados", () => ({
  carregarIncorporadorPorSlug: estado.carregar,
  // O portão confere também a conta e o escopo vigente dela (revisão da onda 3).
  escopoDaConta: async () => ({ enterpriseIds: ["37", "39"], enterpriseIdsComCarteira: [] }),
  usuarioIncorporadorSegueAtivo: async () => true,
}));

vi.mock("@/lib/guardian/db", () => ({ getHadesDbPool: () => ({ ok: false }) }));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [
    { codes: ["VOC", "VOL"], id: "group:Vale do Ouro", name: "VALE DO OURO", stageIds: ["37", "38"] },
  ],
}));

vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: () => ({}) }));

// O cadastro do Panteon com a coluna `operado_por` (0170): o dublê é só a LEITURA do banco.
vi.mock("@/lib/hercules/cadastro", async (original) => ({
  ...(await original<typeof import("@/lib/hercules/cadastro")>()),
  carregarCadastroDeEmpreendimentos: async () => (await estado.cadastro()).linhas,
  lerCadastroDeEmpreendimentos: estado.cadastro,
}));

vi.mock("@/lib/apolo/documentos", () => ({ criarUrlDeUploadApoloDocument: estado.upload }));

vi.mock("@/lib/apolo/incorporador/cadastro-do-portal", async (original) => {
  const real = await original<typeof import("@/lib/apolo/incorporador/cadastro-do-portal")>();
  return {
    ...real,
    checarCpfNoPortal: estado.checar,
    configuracaoDoCadastroNoPortal: estado.configuracao,
    executarMostNoPortal: estado.most,
    produtosDoPanteonDaSessao: async () => [],
    salvarCadastroDoPortal: estado.salvar,
  };
});

import { criarSessaoIncorporador, INCORPORADOR_COOKIE } from "@/lib/apolo/incorporador/sessao";

import { POST as checarCpf } from "./checar-cpf/route";
import { POST as mostqi } from "./mostqi/route";
import { POST as salvar } from "./salvar/route";
import { GET as settings } from "./settings/route";
import { POST as uploadUrl } from "./upload-url/route";

const CECILIO_ID = "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6";
const GURGEL_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const USUARIO = "7b1d2c3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";

type Perfil = { incorporadorId: string; slug: string; tipo: "comercial" | "incorporador" };

const CECILIO: Perfil = { incorporadorId: CECILIO_ID, slug: "cecilio-rocha", tipo: "incorporador" };
const GURGEL: Perfil = { incorporadorId: GURGEL_ID, slug: "gurgel", tipo: "comercial" };

function pedido(caminho: string, perfil: null | Perfil, corpo?: unknown): Request {
  vi.stubEnv("SESSAO_INCORPORADOR_SECRET", "segredo-de-teste");
  const headers = new Headers({ "content-type": "application/json" });
  if (perfil) {
    const token = criarSessaoIncorporador(
      {
        enterpriseIds: ["37", "39"],
        enterpriseIdsComCarteira: [],
        incorporadorId: perfil.incorporadorId,
        incorporadorNome: "Portal",
        slug: perfil.slug,
        tipo: perfil.tipo,
        usuarioId: USUARIO,
        usuarioNome: "Maria do Comercial",
      },
      Date.now(),
    );
    headers.set("cookie", `${INCORPORADOR_COOKIE}=${token}`);
  }
  return new Request(`https://c2x.app.br/api/incorporador/crm/cadastro/${caminho}`, {
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers,
    method: corpo === undefined ? "GET" : "POST",
  });
}

const ROTAS: Array<{ chamar: (r: Request) => Promise<Response>; caminho: string; corpo?: unknown }> = [
  { caminho: "mostqi", chamar: mostqi, corpo: { action: "enrich", cpf: "52998224725", enterpriseId: "39" } },
  { caminho: "checar-cpf", chamar: checarCpf, corpo: { cpf: "52998224725", enterpriseId: "39" } },
  { caminho: "settings", chamar: settings },
  { caminho: "upload-url", chamar: uploadUrl, corpo: { enterpriseId: "39", fileName: "rg.pdf" } },
  {
    caminho: "salvar",
    chamar: salvar,
    corpo: { persona: "pf", role: "prospect", vinculo: { enterpriseId: "39" } },
  },
];

const regras = () => [
  estado.checar,
  estado.configuracao,
  estado.most,
  estado.salvar,
  estado.upload,
];

/** Uma linha do cadastro do Panteon: VOC da Careli (sem dono), Garden da Cecílio. */
function linha(c2xEnterpriseId: string, operadoPor: null | string) {
  return {
    c2xEnterpriseId,
    cidade: null,
    codigo: c2xEnterpriseId === "37" ? "VOC" : "GDN",
    id: `linha-${c2xEnterpriseId}`,
    nome: c2xEnterpriseId === "37" ? "VALE DO OURO VOC" : "GARDEN",
    operadoPor,
    ordem: 0,
    paiId: null,
    uf: null,
    vendendo: true,
  };
}

beforeEach(() => {
  estado.cadastro.mockReset();
  estado.cadastro.mockResolvedValue({
    com0170: true,
    linhas: [linha("37", null), linha("39", CECILIO_ID)],
  });
  estado.carregar.mockReset();
  estado.carregar.mockImplementation(async (slug: string) =>
    slug === "cecilio-rocha"
      ? { ativo: true, id: CECILIO_ID, nome: "Cecílio Rocha", slug, tipo: "incorporador" }
      : { ativo: true, id: GURGEL_ID, nome: "Gurgel", slug, tipo: "comercial" },
  );
  for (const regra of regras()) regra.mockClear();
});

describe.each(ROTAS)("/api/incorporador/crm/cadastro/$caminho", ({ caminho, chamar, corpo }) => {
  it("sem sessão: 401", async () => {
    const r = await chamar(pedido(caminho, null, corpo));
    expect(r.status).toBe(401);
    for (const regra of regras()) expect(regra).not.toHaveBeenCalled();
  });

  it("portal comercial (Gurgel): 404, sem tocar no cadastro nem na regra", async () => {
    const r = await chamar(pedido(caminho, GURGEL, corpo));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Nao encontrado." });
    expect(estado.carregar).not.toHaveBeenCalled();
    for (const regra of regras()) expect(regra).not.toHaveBeenCalled();
  });

  it("Cecílio passa e a regra recebe o ator do portal", async () => {
    const r = await chamar(pedido(caminho, CECILIO, corpo));
    expect(r.status).toBeLessThan(300);
    const chamadas = regras().flatMap((regra) => regra.mock.calls);
    expect(chamadas).toHaveLength(1);
  });
});

describe("o ator e o dono do upload", () => {
  it("o salvar recebe o ator com os ids expandidos e o usuário do portal", async () => {
    await salvar(pedido("salvar", CECILIO, { persona: "pf", role: "prospect", vinculo: { enterpriseId: "39" } }));
    const chamada = (estado.salvar.mock.calls[0] as unknown[] | undefined)?.[0] as {
      ator: Record<string, unknown>;
    };
    expect(chamada.ator).toMatchObject({
      enterpriseIds: ["37", "39"],
      incorporadorId: CECILIO_ID,
      nome: "Maria do Comercial",
      slug: "cecilio-rocha",
      tipo: "portal",
      usuarioId: USUARIO,
    });
  });

  it("a URL assinada é amarrada ao usuário do portal (p-), não ao operador do hub", async () => {
    await uploadUrl(pedido("upload-url", CECILIO, { enterpriseId: "39", fileName: "rg.pdf" }));
    expect(estado.upload).toHaveBeenCalledWith({
      adminClient: {},
      dono: `p-${USUARIO}`,
      fileName: "rg.pdf",
    });
  });

  it("a MOST recusa ação de laboratório antes de consultar", async () => {
    const r = await mostqi(pedido("mostqi", CECILIO, { action: "probe", cpf: "52998224725", enterpriseId: "39" }));
    expect(r.status).toBe(400);
    expect(estado.most).not.toHaveBeenCalled();
  });
});

describe("a régua de quem opera o produto: VOC só consulta, Garden cadastra", () => {
  const SO_CONSULTA = {
    error: "Este produto está disponível só para consulta no seu portal.",
    soConsulta: true,
  };

  const ESCRITAS: Array<{
    caminho: string;
    chamar: (r: Request) => Promise<Response>;
    corpo: (enterpriseId: string) => unknown;
  }> = [
    {
      caminho: "salvar",
      chamar: salvar,
      corpo: (id) => ({ persona: "pf", role: "prospect", vinculo: { enterpriseId: id } }),
    },
    {
      caminho: "checar-cpf",
      chamar: checarCpf,
      corpo: (id) => ({ cpf: "52998224725", enterpriseId: id }),
    },
    { caminho: "upload-url", chamar: uploadUrl, corpo: (id) => ({ enterpriseId: id, fileName: "rg.pdf" }) },
    // (16/09/2026, revisão do conjunto) A MOST paga também só no produto que o portal opera.
    {
      caminho: "mostqi",
      chamar: mostqi,
      corpo: (id) => ({ action: "enrich", cpf: "52998224725", enterpriseId: id }),
    },
  ];

  it.each(ESCRITAS)("$caminho: VOC (37) é recusado com 403 só consulta, sem chegar na regra", async ({ caminho, chamar, corpo }) => {
    const r = await chamar(pedido(caminho, CECILIO, corpo("37")));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual(SO_CONSULTA);
    for (const regra of regras()) expect(regra).not.toHaveBeenCalled();
  });

  it.each(ESCRITAS)("$caminho: Garden (39) passa", async ({ caminho, chamar, corpo }) => {
    const r = await chamar(pedido(caminho, CECILIO, corpo("39")));
    expect(r.status).toBeLessThan(300);
    expect(regras().flatMap((regra) => regra.mock.calls)).toHaveLength(1);
  });

  it.each(ESCRITAS)("$caminho: sem a 0170 ninguém cadastra (503)", async ({ caminho, chamar, corpo }) => {
    estado.cadastro.mockResolvedValue({
      com0170: false,
      linhas: [linha("37", null), linha("39", null)],
    });
    const r = await chamar(pedido(caminho, CECILIO, corpo("39")));
    expect(r.status).toBe(503);
    for (const regra of regras()) expect(regra).not.toHaveBeenCalled();
  });

  it("as exigências do produto: VOC 403, Garden segue", async () => {
    const voc = await settings(pedido("settings?enterpriseId=37", CECILIO));
    expect(voc.status).toBe(403);
    expect(await voc.json()).toEqual(SO_CONSULTA);
    expect(estado.configuracao).not.toHaveBeenCalled();

    const garden = await settings(pedido("settings?enterpriseId=39", CECILIO));
    expect(garden.status).toBe(200);
    expect(estado.configuracao).toHaveBeenCalledWith(expect.objectContaining({ enterpriseId: "39" }));
  });

  it("a lista do Novo cliente recebe o cadastro com a 0170 para filtrar o que o portal opera", async () => {
    await settings(pedido("settings", CECILIO));
    expect(estado.configuracao).toHaveBeenCalledWith(
      expect.objectContaining({
        cadastro: { com0170: true, linhas: [linha("37", null), linha("39", CECILIO_ID)] },
        enterpriseId: null,
      }),
    );
  });

  it("MOST sem produto é 400 e produto de fora da sessão é 404, antes da régua e sem consultar", async () => {
    const sem = await mostqi(pedido("mostqi", CECILIO, { action: "enrich", cpf: "52998224725" }));
    expect(sem.status).toBe(400);
    const fora = await mostqi(pedido("mostqi", CECILIO, { action: "enrich", cpf: "52998224725", enterpriseId: "38" }));
    expect(fora.status).toBe(404);
    expect(estado.cadastro).not.toHaveBeenCalled();
    expect(estado.most).not.toHaveBeenCalled();
  });

  it("upload sem produto é 400 e produto de fora da sessão é 404, antes da régua", async () => {
    const sem = await uploadUrl(pedido("upload-url", CECILIO, { fileName: "rg.pdf" }));
    expect(sem.status).toBe(400);
    const fora = await uploadUrl(pedido("upload-url", CECILIO, { enterpriseId: "38", fileName: "rg.pdf" }));
    expect(fora.status).toBe(404);
    expect(estado.cadastro).not.toHaveBeenCalled();
    expect(estado.upload).not.toHaveBeenCalled();
  });
});
