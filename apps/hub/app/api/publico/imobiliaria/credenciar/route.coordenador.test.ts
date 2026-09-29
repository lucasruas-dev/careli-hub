import { beforeEach, describe, expect, it, vi } from "vitest";

// A HABILITAÇÃO SEM FILA AVISA O COORDENADOR ACHADO PELO ID (Lucas, 24/09/2026).
//
// O caso real: às 16:47 de 24/09 a Nivea renomeou o 43 no C2X de RECANTO DO VALE/RDV para PORTAL DO
// IBITURUNA/PDI. Às 16:55 a CONECTTA IMOVEIS, já credenciada, pediu o 43 por esta rota e foi
// habilitada sem fila. O aviso à coordenação, que é a contenção da auto-aprovação pública, ia ao C2X
// pela sigla RDV guardada no Panteon: voltou vazio e a LUNA não soube de nada.

const estado = vi.hoisted(() => ({
  avisos: [] as Array<Record<string, unknown>>,
  pedidosPorId: [] as string[][],
  pedidosPorSigla: [] as string[][],
}));

vi.mock("@/lib/publico/cad/rotas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/publico/cad/rotas")>()),
  prepararRota: vi.fn(async () => ({ adminClient: clienteFalso(), inicio: 0, ok: true })),
  responder: vi.fn(async (_request: Request, _inicio: number, resposta: Response) => resposta),
}));

vi.mock("@/lib/publico/cad/sessao", () => ({
  preSessaoImobDoRequest: () => ({ ok: true, pre: { cnpj: "11222333000181" } }),
}));

vi.mock("@/lib/publico/cad/log-erros", () => ({ anotarContexto: () => undefined }));

vi.mock("@/lib/publico/cad/dados", () => ({
  consultarImobiliariaCredenciada: vi.fn(async () => ({
    credenciada: true,
    entityId: "conectta",
    nome: "CONECTTA IMOVEIS",
  })),
}));

vi.mock("@/lib/apolo/credenciamento", () => ({
  listEmpreendimentosParaImobiliaria: vi.fn(async () => [
    { id: "43", name: "PORTAL DO IBITURUNA", stageIds: [] },
  ]),
}));

vi.mock("@/lib/apolo/cadastro-persist", () => ({ createApoloEntity: vi.fn() }));

vi.mock("@/lib/apolo/disparo-imobiliaria", () => ({
  contatoDaEntidadeImobiliaria: vi.fn(async () => ({
    email: null,
    entityId: "conectta",
    nome: "CONECTTA IMOVEIS",
    telefone: "(33) 98303-3877",
  })),
}));

// O C2X: pela SIGLA velha não acha nada (é o que ele respondeu com RDV depois do renome); pelo ID,
// acha a LUNA.
vi.mock("@/lib/apolo/empreendimentos", () => ({
  loadApoloEnterpriseCadastro: vi.fn(async (codes: string[]) => {
    estado.pedidosPorSigla.push(codes);
    return { cadastros: [], ok: true };
  }),
  loadApoloEnterpriseCadastroPorId: vi.fn(async (ids: string[]) => {
    estado.pedidosPorId.push(ids);
    return {
      cadastros: ids.includes("43")
        ? [
            {
              enterpriseId: "43",
              players: [
                {
                  entityId: "luna",
                  name: "LUNA NEGOCIOS IMOBILIARIOS",
                  phone: "(31) 99596-0000",
                  relation: "coordenador_vendas",
                },
              ],
            },
          ]
        : [],
      ok: true,
    };
  }),
}));

// O aviso em si é espião: o que se prova aqui é PARA QUEM ele iria.
vi.mock("@/lib/apolo/disparo-credenciamento", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/disparo-credenciamento")>()),
  avisarCredenciamentoAprovado: vi.fn(async (_client: unknown, input: Record<string, unknown>) => {
    estado.avisos.push(input);
    return { coordenador: { ok: true }, corretores: { avisados: 0, falharam: 0 }, imobiliaria: { ok: true } };
  }),
  representanteDaImobiliaria: vi.fn(async () => ({ nome: null, telefone: null })),
}));

/** O banco como estava: o vínculo ainda não existe, e o settings do 43 com a sigla velha. */
function clienteFalso() {
  return {
    from: (tabela: string) => {
      const q: Record<string, unknown> = {};
      for (const metodo of ["select", "eq", "in", "limit", "order"]) q[metodo] = () => q;
      q.insert = async () => ({ error: null });
      q.update = () => q;
      const dados =
        tabela === "apolo_enterprise_settings"
          ? [{ code: "RDV", coordenador_entity_id: null, enterprise_id: "43" }]
          : [];
      q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve({ data: dados, error: null }).then(ok, falha);
      return q;
    },
  };
}

import { POST } from "./route";

beforeEach(() => {
  estado.avisos = [];
  estado.pedidosPorId = [];
  estado.pedidosPorSigla = [];
});

describe("POST /api/publico/imobiliaria/credenciar (já credenciada)", () => {
  it("⚠️ renome RDV -> PDI no C2X não tira a LUNA do aviso: o coordenador é achado pelo id", async () => {
    const r = await POST(
      new Request("http://localhost/api/publico/imobiliaria/credenciar", {
        body: JSON.stringify({ corretores: [], empreendimentos: ["43"] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(r.status).toBe(201);
    expect(estado.avisos).toHaveLength(1);
    expect(estado.avisos[0]?.coordenadores).toEqual([
      {
        empreendimentos: [{ label: "PORTAL DO IBITURUNA" }],
        nome: "LUNA NEGOCIOS IMOBILIARIOS",
        telefone: "(31) 99596-0000",
      },
    ]);
    expect(estado.pedidosPorId).toEqual([["43"]]);
    expect(estado.pedidosPorSigla).toEqual([]);
  });
});
