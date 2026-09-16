import { beforeEach, describe, expect, it, vi } from "vitest";

// APROVAR COM RESTRIÇÃO, o serviço das duas portas.
//
// Decisão do Lucas (16/09/2026): no portal que opera sozinho (Cecílio), a equipe deles decide o
// próprio crédito. As regras são as do hub (só sobre reprovado, evidência obrigatória, rastro); o que
// muda é QUEM aparece no rastro. Este arquivo trava as duas metades: o hub grava exatamente o que
// gravava, e o portal não se passa pela "coordenação" da Careli.
//
// (revisão de 16/09/2026) No portal, "revisão" não prova crédito reprovado: o próprio time grava a
// etapa à mão. Sem consulta ao Serasa reprovada do titular desta CAD, a aprovação com restrição é
// recusada antes de subir a evidência (senão um print credenciava sem Serasa).

const m = vi.hoisted(() => ({
  atualizarEtapa: vi.fn(async (_client: unknown, _id: string, etapa: string) => ({
    error: null as null | string,
    etapa,
  })),
  cad: vi.fn(async () => ({ enterprise_id: "39", etapa: "revisao" }) as unknown),
  gerarCad: vi.fn(async () => ({ ok: true })),
  override: vi.fn(async () => ({ auditoria: true, erro: null as null | string, estruturado: true })),
  prevenda: vi.fn(async () => true),
  reprovado: vi.fn(async () => true),
  upload: vi.fn(async () => ({ id: "doc-evidencia", ok: true }) as { error?: string; id?: string; ok: boolean }),
}));

vi.mock("@/lib/apolo/esteira", () => ({ atualizarEtapa: m.atualizarEtapa }));
vi.mock("@/lib/apolo/esteira-cad", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/esteira-cad")>()),
  lerCadDaEsteira: m.cad,
}));
vi.mock("@/lib/apolo/limite-credito", () => ({ resolverPrevendaHabilitada: m.prevenda }));
vi.mock("@/lib/apolo/salvar-cad", () => ({
  comLimiteDeTempo: <T>(promessa: Promise<T>) => promessa,
  gerarESalvarCad: m.gerarCad,
}));
vi.mock("@/lib/apolo/documentos", () => ({ uploadApoloDocument: m.upload }));
vi.mock("@/lib/apolo/credito-override", () => ({ registrarOverrideCredito: m.override }));
vi.mock("./consulta-servico", () => ({ creditoReprovadoDaCad: m.reprovado }));

import { aprovarComRestricao } from "./aprovar-restricao-servico";
import type { AutorDoCredito } from "./consulta-servico";

const HUB_USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const USUARIO_PORTAL = "7b1d2c3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
const ENTIDADE = "11111111-2222-4333-8444-555555555555";

const HUB: AutorDoCredito = { nome: "Coordenadora", papel: "coordenacao", tipo: "hub", userId: HUB_USER };
const PORTAL: AutorDoCredito = {
  incorporadorId: "inc-cecilio",
  nome: "Maria da Cecílio",
  slug: "cecilio-rocha",
  tipo: "portal",
  usuarioId: USUARIO_PORTAL,
};

type Linha = Record<string, unknown>;

function clienteFalso() {
  const estado = { inserts: [] as Array<{ linha: Linha; tabela: string }>, lidas: [] as string[] };
  const client = {
    from(tabela: string) {
      estado.lidas.push(tabela);
      const cadeia: Record<string, unknown> = {};
      Object.assign(cadeia, {
        eq: () => cadeia,
        insert: (linha: Linha) => {
          estado.inserts.push({ linha, tabela });
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle: () =>
          Promise.resolve({ data: { display_name: "Cinthia", email: "c@careli" }, error: null }),
        select: () => cadeia,
      });
      return cadeia;
    },
  } as unknown as Parameters<typeof aprovarComRestricao>[0]["client"];
  return { client, estado };
}

const corpo = (extra: Linha = {}) => ({
  enterpriseId: "39",
  entityId: ENTIDADE,
  fileBase64: "JVBERi0xLjQK",
  fileName: "de-acordo.pdf",
  mimeType: "application/pdf",
  motivo: "Fiador aceito",
  ...extra,
});

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockClear();
  m.cad.mockImplementation(async () => ({ enterprise_id: "39", etapa: "revisao" }));
  m.reprovado.mockImplementation(async () => true);
});

describe("as travas valem para as duas portas", () => {
  for (const autor of [HUB, PORTAL]) {
    it(`${autor.tipo}: ficha fora de revisão é 409, sem subir evidência nem mexer na etapa`, async () => {
      m.cad.mockImplementation(async () => ({ enterprise_id: "39", etapa: "credito" }));
      const { client } = clienteFalso();
      const r = await aprovarComRestricao({ autor, client, corpo: corpo() });
      expect(r.status).toBe(409);
      expect(m.upload).not.toHaveBeenCalled();
      expect(m.atualizarEtapa).not.toHaveBeenCalled();
    });

    it(`${autor.tipo}: sem evidência é 400`, async () => {
      const { client } = clienteFalso();
      const r = await aprovarComRestricao({ autor, client, corpo: corpo({ fileBase64: "" }) });
      expect(r.status).toBe(400);
      expect(m.upload).not.toHaveBeenCalled();
    });
  }
});

describe("hub: o rastro de sempre", () => {
  it("coordenação no rótulo, no motivo e no metadata, nome lido de hub_users, sem linha extra", async () => {
    const { client, estado } = clienteFalso();
    const r = await aprovarComRestricao({ autor: HUB, client, corpo: corpo() });

    expect(r).toEqual({
      corpo: { data: { etapa: "prevenda", evidenciaDocId: "doc-evidencia", ok: true, rastroIncompleto: null } },
      status: 200,
    });
    expect(m.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Aprovação com restrição (coordenação)",
        metadataExtra: { enterpriseId: "39", motivo: "Fiador aceito", origem: "override-credito" },
        uploadedByName: "Cinthia",
      }),
    );
    const [, , , opcoes] = m.atualizarEtapa.mock.calls[0] as unknown as [unknown, string, string, Linha];
    expect(opcoes).toEqual({
      atualizadoPor: HUB_USER,
      enterpriseId: "39",
      motivo: "Aprovado com restrição pela coordenação. Fiador aceito",
      saidaDeRevisaoAutorizada: true,
    });
    expect(estado.lidas).toContain("hub_users");
    expect(estado.inserts).toHaveLength(0);
    // O hub não pede a prova da consulta: lá quem aprova é a coordenação.
    expect(m.reprovado).not.toHaveBeenCalled();
    // (16/09/2026) O hub não manda a origem: o rastro segue com o "override-coordenacao" de sempre.
    const [rastro] = m.override.mock.calls[0] as unknown as [Linha];
    expect(rastro).not.toHaveProperty("origem");
  });
});

describe("portal que opera sozinho", () => {
  it("revisão gravada à mão, sem consulta reprovada: 409, sem evidência e sem mexer na etapa", async () => {
    m.reprovado.mockImplementation(async () => false);
    const { client, estado } = clienteFalso();
    const r = await aprovarComRestricao({ autor: PORTAL, client, corpo: corpo() });

    expect(r.status).toBe(409);
    expect((r.corpo as { error: string }).error).toContain("Não há consulta ao Serasa reprovada");
    // Só a consulta DESTE portal prova a reprovação (a ficha é compartilhada com a Careli, D5).
    expect(m.reprovado).toHaveBeenCalledWith({
      client,
      enterpriseId: "39",
      entityId: ENTIDADE,
      incorporadorId: "inc-cecilio",
    });
    expect(m.upload).not.toHaveBeenCalled();
    expect(m.atualizarEtapa).not.toHaveBeenCalled();
    expect(m.override).not.toHaveBeenCalled();
    expect(estado.inserts).toHaveLength(0);
  });

  it("sem conseguir conferir a consulta: 503, nada alterado", async () => {
    m.reprovado.mockImplementation(async () => {
      throw new Error("serasa_consultas: timeout");
    });
    const { client } = clienteFalso();
    const r = await aprovarComRestricao({ autor: PORTAL, client, corpo: corpo() });
    expect(r.status).toBe(503);
    expect(m.upload).not.toHaveBeenCalled();
    expect(m.atualizarEtapa).not.toHaveBeenCalled();
  });

  it("destrava com o nome da conta do portal e deixa a origem na auditoria", async () => {
    const { client, estado } = clienteFalso();
    const r = await aprovarComRestricao({ autor: PORTAL, client, corpo: corpo() });

    expect(r.status).toBe(200);
    expect(estado.lidas).not.toContain("hub_users");

    const [, , destino, opcoes] = m.atualizarEtapa.mock.calls[0] as unknown as [
      unknown,
      string,
      string,
      Linha,
    ];
    expect(destino).toBe("prevenda");
    expect(opcoes).toMatchObject({
      atualizadoPor: USUARIO_PORTAL,
      motivo: "Aprovado com restrição pelo incorporador. Fiador aceito",
      saidaDeRevisaoAutorizada: true,
    });

    // (16/09/2026) A auditoria do override diz que a decisão foi do portal, não da coordenação.
    expect(m.override).toHaveBeenCalledWith(
      expect.objectContaining({
        aprovadoPor: USUARIO_PORTAL,
        aprovadoPorNome: "Maria da Cecílio",
        origem: "override-portal",
      }),
    );
    expect(m.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Aprovação com restrição (portal do incorporador)",
        metadataExtra: expect.objectContaining({
          autorOrigem: "portal-incorporador",
          slug: "cecilio-rocha",
          usuarioId: USUARIO_PORTAL,
        }),
        uploadedByName: "Maria da Cecílio",
      }),
    );

    const auditoria = estado.inserts.find((i) => i.tabela === "apolo_audit_events")?.linha;
    expect(auditoria).toMatchObject({
      action: "etapa_change",
      actor_user_id: USUARIO_PORTAL,
      entity_id: ENTIDADE,
      metadata: expect.objectContaining({
        autorNome: "Maria da Cecílio",
        origem: "portal-incorporador",
        para: "prevenda",
        slug: "cecilio-rocha",
      }),
    });
  });
});
