import { beforeEach, describe, expect, it, vi } from "vitest";

import { criarBanco } from "@/lib/hercules/banco-em-memoria.para-teste";

// A ROTA DO PDF PELA SEGUNDA PORTA, `?contratoId=` (F4 da fonte única): o id do ENVELOPE do Panteon.
// Trava: escopo pela UNIDADE do envelope antes de baixar; baixa exatamente aquele documento; nenhuma
// consulta ao C2X de unidade/contrato; tudo que não passa é o mesmo 404.

const estado = vi.hoisted(() => ({
  banco: null as null | ReturnType<typeof import("@/lib/hercules/banco-em-memoria.para-teste").criarBanco>,
  consultasAoC2x: [] as string[],
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({
    ok: true,
    pool: {
      query: async (sql: string) => {
        estado.consultasAoC2x.push(sql);
        // Só o catálogo de empreendimentos (o alcance da sessão) pode passar por aqui.
        if (sql.includes("from enterprises e")) {
          return [[
            { code: "VOL", id: 36, name: "VALE DO OURO" },
            { code: "VOC", id: 37, name: "VALE DO OURO" },
          ]];
        }
        return [[]];
      },
    },
  }),
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => estado.banco?.cliente ?? null,
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

const ENVELOPE_DO_VOC = "11111111-1111-4111-8111-111111111111";
const ENVELOPE_DO_VOL = "22222222-2222-4222-8222-222222222222";
const ENVELOPE_CLICKSIGN = "33333333-3333-4333-8333-333333333333";
const UNIDADE_VOC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UNIDADE_VOL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function requisicao(contratoId: string): Request {
  vi.stubEnv("SESSAO_INCORPORADOR_SECRET", "segredo-de-teste");
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
  return new Request(`https://c2x.app.br/api/incorporador/contrato?contratoId=${encodeURIComponent(contratoId)}`, {
    headers: new Headers({ cookie: `${INCORPORADOR_COOKIE}=${token}` }),
  });
}

beforeEach(() => {
  estado.consultasAoC2x = [];
  vi.mocked(fetchD4SignContract).mockClear();
  estado.banco = criarBanco({
    hercules_unidades: [
      { codigo: "VOC0306", enterprise_id: "37", id: UNIDADE_VOC, workspace_id: "careli" },
      { codigo: "VOL1106", enterprise_id: "36", id: UNIDADE_VOL, workspace_id: "careli" },
    ],
    temis_envelopes_de_contrato: [
      { id: ENVELOPE_DO_VOC, provedor: "d4sign", provedor_documento_id: "doc-voc", unidade_id: UNIDADE_VOC, workspace_id: "careli" },
      { id: ENVELOPE_DO_VOL, provedor: "d4sign", provedor_documento_id: "doc-vol", unidade_id: UNIDADE_VOL, workspace_id: "careli" },
      { id: ENVELOPE_CLICKSIGN, provedor: "clicksign", provedor_documento_id: "doc-cs", unidade_id: UNIDADE_VOC, workspace_id: "careli" },
    ],
  });
});

describe("a rota do contrato pelo envelope do Panteon", () => {
  it("⚠️ no caminho feliz baixa EXATAMENTE o documento do envelope, sem ler unidade nem contrato no C2X", async () => {
    const r = await GET(requisicao(ENVELOPE_DO_VOC));
    expect(r.status).toBe(200);
    expect(fetchD4SignContract).toHaveBeenCalledWith("doc-voc");
    expect(r.headers.get("content-disposition")).toBe('inline; filename="Contrato VOC0306.pdf"');
    expect(estado.consultasAoC2x.every((sql) => sql.includes("from enterprises e"))).toBe(true);
    expect(estado.banco?.problemas).toEqual([]);
  });

  it("⚠️ envelope de unidade de OUTRO loteador é 404, sem tocar na D4Sign", async () => {
    const r = await GET(requisicao(ENVELOPE_DO_VOL));
    expect(r.status).toBe(404);
    expect(fetchD4SignContract).not.toHaveBeenCalled();
  });

  it("envelope da Clicksign (PDF não guardado), inexistente ou id que nem é uuid: o mesmo 404", async () => {
    for (const id of [ENVELOPE_CLICKSIGN, "44444444-4444-4444-8444-444444444444", "doc-voc", "1"]) {
      const r = await GET(requisicao(id));
      expect(r.status).toBe(404);
    }
    expect(fetchD4SignContract).not.toHaveBeenCalled();
  });
});
