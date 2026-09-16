import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA /api/incorporador/produto/cadastro — o caminho de SEGURANÇA e o do produto do Panteon.
//
// O que está travado aqui: sem sessão é 401; sem `emp` é 400; produto fora do escopo é 404 com o
// texto do portal (e o C2X nem é consultado); o produto que só existe no Panteon responde com a
// ficha do cadastro próprio (sem ir ao legado); e o que vem do C2X sai pela allowlist, sem telefone,
// e-mail, documento ou id interno de ninguém.
//
// O C2X (catálogo e loader) e o cadastro do Panteon são mockados: o teste é da REGRA da rota.

const estado = vi.hoisted(() => ({
  cadastroFora: false,
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({ missing: ["C2X_DB"], ok: false }),
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => null,
  deterministicUuid: (semente: string) => `uuid:${semente}`,
}));

vi.mock("@/lib/prometeu/data", () => ({
  createPrometeuClient: () => null,
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [
    { codes: ["VOC"], id: "37", name: "VALE DO OURO", stageIds: ["37"] },
    { codes: ["GDN"], id: "39", name: "GARDEN", stageIds: ["39"] },
  ],
}));

vi.mock("@/lib/hercules/cadastro", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/hercules/cadastro")>();
  const linha = (c2x: string, codigo: string, nome: string) => ({
    c2xEnterpriseId: c2x,
    cidade: "Sete Lagoas",
    codigo,
    id: codigo.toLowerCase(),
    nome,
    ordem: 0,
    paiId: null,
    uf: "MG",
    vendendo: true,
  });
  return {
    ...original,
    carregarCadastroDeEmpreendimentos: async () => {
      if (estado.cadastroFora) throw new Error("supabase fora");
      return [
        linha("37", "VOC", "VALE DO OURO CECILIO"),
        linha("39", "GDN", "GARDEN"),
        linha("9001", "TST", "ZZ TESTE"),
        linha("9002", "OUT", "DE OUTRA SESSAO"),
      ];
    },
  };
});

vi.mock("@/lib/apolo/empreendimentos", () => ({
  loadApoloEnterpriseCadastro: vi.fn(async (codes: string[]) => ({
    cadastros: codes.map((code) => ({
      actValue: 1000,
      city: "SETE LAGOAS",
      code,
      createdAt: "2024-01-01T00:00:00.000Z",
      divulgationName: null,
      expectedDelivery: null,
      focalEmail: "focal@exemplo.com",
      focalName: "MARIA FOCAL",
      focalPhone: "31999990000",
      kind: "LOTEAMENTO",
      name: "VALE DO OURO",
      players: [
        {
          address: "Rua A, 10",
          document: "123.456.789-09",
          email: "captador@exemplo.com",
          entityId: "uuid-do-crm",
          name: "JOAO CAPTADOR",
          phone: "31988880000",
          relation: "captador",
        },
      ],
      state: "MG",
      tableKind: "PRICE",
    })),
    ok: true,
  })),
}));

import { loadApoloEnterpriseCadastro } from "@/lib/apolo/empreendimentos";
import { criarSessaoIncorporador, INCORPORADOR_COOKIE } from "@/lib/apolo/incorporador/sessao";

import { GET } from "./route";

function requisicao(emp: null | string, comCookie = true): Request {
  vi.stubEnv("SESSAO_INCORPORADOR_SECRET", "segredo-de-teste");
  const headers = new Headers();
  if (comCookie) {
    const token = criarSessaoIncorporador(
      {
        // O Cecílio: o VOC do C2X e um produto que só existe no Panteon.
        enterpriseIds: ["37", "9001"],
        enterpriseIdsComCarteira: ["37"],
        incorporadorId: "inc-1",
        incorporadorNome: "Cecílio Rocha",
        slug: "cecilio-rocha",
        usuarioId: "user-1",
        usuarioNome: "Time Cecílio",
      },
      Date.now(),
    );
    headers.set("cookie", `${INCORPORADOR_COOKIE}=${token}`);
  }
  const busca = emp === null ? "" : `?emp=${encodeURIComponent(emp)}`;
  return new Request(`https://c2x.app.br/api/incorporador/produto/cadastro${busca}`, { headers });
}

type Corpo = {
  data?: { cadastros: Array<Record<string, unknown> & { code: string; players: unknown[] }> };
  error?: string;
};

beforeEach(() => {
  estado.cadastroFora = false;
  vi.mocked(loadApoloEnterpriseCadastro).mockClear();
  // A queda do cadastro é registrada no log de propósito; aqui ela é o cenário, não o ruído.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/incorporador/produto/cadastro", () => {
  it("sem sessão: 401, e nada é lido", async () => {
    const resposta = await GET(requisicao("37", false));
    expect(resposta.status).toBe(401);
    expect(loadApoloEnterpriseCadastro).not.toHaveBeenCalled();
  });

  it("sem produto: 400 (a aba é de UM produto)", async () => {
    const resposta = await GET(requisicao(null));
    expect(resposta.status).toBe(400);
  });

  it("⚠️ produto de fora do escopo: 404 com o texto do portal, e o C2X não é consultado", async () => {
    for (const emp of ["39", "9002", "pai:out", "pai:inventado"]) {
      const resposta = await GET(requisicao(emp));
      const corpo = (await resposta.json()) as Corpo;
      expect(resposta.status).toBe(404);
      expect(corpo.error).toBe("Este produto não está mais no seu recorte.");
    }
    expect(loadApoloEnterpriseCadastro).not.toHaveBeenCalled();
  });

  it("produto do C2X no escopo: a ficha sai pela allowlist", async () => {
    const resposta = await GET(requisicao("37"));
    const corpo = (await resposta.json()) as Corpo;

    expect(resposta.status).toBe(200);
    expect(loadApoloEnterpriseCadastro).toHaveBeenCalledWith(["VOC"]);
    expect(corpo.data?.cadastros.map((c) => c.code)).toEqual(["VOC"]);

    const json = JSON.stringify(corpo);
    for (const proibido of [
      "31999990000",
      "focal@exemplo.com",
      "31988880000",
      "captador@exemplo.com",
      "123.456.789-09",
      "uuid-do-crm",
      "Rua A",
    ]) {
      expect(json).not.toContain(proibido);
    }
    expect(json).toContain("JOAO CAPTADOR");
  });

  it("⚠️ produto que só existe no Panteon: responde, pelo id e pelo pai, sem ir ao legado", async () => {
    for (const emp of ["9001", "pai:tst"]) {
      const resposta = await GET(requisicao(emp));
      const corpo = (await resposta.json()) as Corpo;
      expect(resposta.status).toBe(200);
      expect(corpo.data?.cadastros).toEqual([
        expect.objectContaining({ city: "Sete Lagoas", code: "TST", name: "ZZ TESTE", state: "MG" }),
      ]);
    }
    expect(loadApoloEnterpriseCadastro).not.toHaveBeenCalled();
  });

  it("cadastro do Panteon fora do ar: o produto do C2X segue respondendo", async () => {
    estado.cadastroFora = true;
    const resposta = await GET(requisicao("37"));
    expect(resposta.status).toBe(200);
  });

  it("⚠️ cadastro fora do ar: pai e produto do Panteon dão 503, nunca 404", async () => {
    estado.cadastroFora = true;
    for (const emp of ["9001", "pai:tst"]) {
      const resposta = await GET(requisicao(emp));
      expect(resposta.status).toBe(503);
    }
  });
});
