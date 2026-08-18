import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA /api/incorporador/contrato — o caminho de SEGURANÇA, não o feliz.
//
// O que está travado aqui: a ordem autorizar → unidadeNoEscopo → contratoDaUnidade →
// fetchD4SignContract, e que TODO caso de recusa responde 404 idêntico (unidade de outro
// loteador, unidade sem contrato, id inválido). O D4Sign não pode ser chamado em NENHUM deles —
// chamar já seria gastar o token num documento que não é do cliente.
//
// O C2X e o D4Sign são mockados: o teste é da REGRA da rota, não da integração.

const estado = vi.hoisted(() => ({
  // O dono real da unidade no "C2X" mockado. 36 = VOL (outro loteador); 37 = VOC (o da sessão).
  donoDaUnidade: 36 as number,
  // O uuidDoc que o "C2X" devolve para a unidade. null = sem contrato assinado.
  uuidDoc: null as null | string,
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({
    ok: true,
    pool: {
      query: async (sql: string) => {
        // O catálogo de empreendimentos (catalogoDeEmpreendimentos).
        if (sql.includes("from enterprises e")) {
          return [[
            { code: "VOL", id: 36, name: "VALE DO OURO" },
            { code: "VOC", id: 37, name: "VALE DO OURO" },
          ]];
        }
        // A conferência de escopo (unidadeNoEscopo).
        if (sql.includes("select u.enterprise_id")) {
          return [[{ enterprise_id: estado.donoDaUnidade }]];
        }
        // O contrato da unidade (contratoDaUnidade).
        if (sql.includes("uuid_doc")) {
          return [[{ block: "A", enterprise_code: "VOC", lot: "01", uuid_doc: estado.uuidDoc }]];
        }
        return [[]];
      },
    },
  }),
}));

vi.mock("@/lib/guardian/d4sign", () => ({
  fetchD4SignContract: vi.fn(async () => ({
    body: new TextEncoder().encode("%PDF-1.7 fake").buffer,
    contentLength: null,
    contentType: "application/pdf",
    ok: true,
  })),
}));

import { fetchD4SignContract } from "@/lib/guardian/d4sign";
import { GET } from "@/app/api/incorporador/contrato/route";
import { criarSessaoIncorporador, INCORPORADOR_COOKIE } from "./sessao";

function requisicao(unitId: string, comCookie = true): Request {
  process.env.SESSAO_INCORPORADOR_SECRET = "segredo-de-teste";
  const headers = new Headers();
  if (comCookie) {
    const token = criarSessaoIncorporador(
      {
        enterpriseIds: ["37"],
        enterpriseIdsComCarteira: ["37"],
        incorporadorId: "inc-1",
        incorporadorNome: "Bill",
        slug: "bill",
        usuarioId: "user-1",
        usuarioNome: "Bill",
      },
      Date.now(),
    );
    headers.set("cookie", `${INCORPORADOR_COOKIE}=${token}`);
  }
  return new Request(
    `https://c2x.app.br/api/incorporador/contrato?unitId=${unitId}`,
    { headers },
  );
}

beforeEach(() => {
  estado.donoDaUnidade = 36;
  estado.uuidDoc = null;
  vi.mocked(fetchD4SignContract).mockClear();
});

describe("a rota do contrato do incorporador", () => {
  it("sem sessão, 401 e o D4Sign nem é consultado", async () => {
    const r = await GET(requisicao("4213", false));
    expect(r.status).toBe(401);
    expect(fetchD4SignContract).not.toHaveBeenCalled();
  });

  it("⚠️ unidade de OUTRO loteador responde 404, igual a inexistente, sem tocar no D4Sign", async () => {
    estado.donoDaUnidade = 36; // VOL — a sessão só tem o VOC (37).
    estado.uuidDoc = "5bebac28-9bc8-43b2-a14d-6dc79e2bb6c0"; // Existe contrato; não importa.

    const r = await GET(requisicao("4213"));
    expect(r.status).toBe(404);
    expect(fetchD4SignContract).not.toHaveBeenCalled();
  });

  it("unidade do escopo mas SEM contrato assinado também é 404 idêntico", async () => {
    estado.donoDaUnidade = 37;
    estado.uuidDoc = null;

    const r = await GET(requisicao("4213"));
    expect(r.status).toBe(404);
    expect(fetchD4SignContract).not.toHaveBeenCalled();
  });

  it("id que nem é id responde como unidade que não existe", async () => {
    for (const cru of ["abc", "-1", "0", "1.5", ""]) {
      const r = await GET(requisicao(cru));
      expect(r.status).toBe(404);
    }
    expect(fetchD4SignContract).not.toHaveBeenCalled();
  });

  it("no caminho feliz o PDF sai proxiado, com o uuid resolvido no C2X (nunca da URL)", async () => {
    estado.donoDaUnidade = 37;
    estado.uuidDoc = "5bebac28-9bc8-43b2-a14d-6dc79e2bb6c0";

    const r = await GET(requisicao("4213"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("content-disposition")).toBe('inline; filename="Contrato VOCA01.pdf"');
    expect(fetchD4SignContract).toHaveBeenCalledWith("5bebac28-9bc8-43b2-a14d-6dc79e2bb6c0");
    expect(new TextDecoder().decode(await r.arrayBuffer())).toContain("%PDF");
  });
});
