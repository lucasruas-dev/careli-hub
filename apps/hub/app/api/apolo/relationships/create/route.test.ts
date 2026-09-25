import { beforeEach, describe, expect, it, vi } from "vitest";

// O MODAL DE RELACIONAMENTO DA FICHA TAMBÉM HABILITA IMOBILIÁRIA (revisão de 24/09/2026).
//
// O ramo "Empreendimento" desta rota grava o vínculo já `verified`, com `source: "apolo"` e o autor.
// Para a imobiliária credenciada é habilitação pelo cadastro interno: vale na hora no portal do
// corretor e o Board mostra o selo "cadastro interno". Só o wizard avisava o coordenador; pelo modal
// (CONECTTA e RICAJ no 35, RAIANE no 40 e no 38) a coordenação não sabia de nada. O que se trava aqui:
//   • imobiliária credenciada + empreendimento novo: grava e avisa (auditoria + coordenador), com o autor;
//   • o que ela já tem não é gravado de novo nem avisado;
//   • prospect/cliente (sem papel ativo): grava como sempre, sem aviso;
//   • o aviso sai depois da resposta.

const m = vi.hoisted(() => ({
  after: vi.fn(),
  cadastro: vi.fn(),
  registrar: vi.fn(),
  tabelas: {} as Record<string, unknown>,
  inserts: [] as Array<{ tabela: string; valores: Record<string, unknown> }>,
}));

vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: m.after,
}));
vi.mock("@/lib/hercules/cadastro", () => ({ carregarCadastroDeEmpreendimentos: m.cadastro }));
vi.mock("@/lib/apolo/habilitacao-pelo-cadastro", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/habilitacao-pelo-cadastro")>()),
  registrarHabilitacaoPeloCadastro: m.registrar,
}));

const OPERADOR = "766e2df4-c404-472e-9c33-bd65cbf150d8";

function clienteFalso() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: OPERADOR } }, error: null }) },
    from(tabela: string) {
      const q: Record<string, unknown> = {};
      let inserindo: null | Record<string, unknown> = null;
      for (const metodo of ["select", "eq", "limit"]) q[metodo] = () => q;
      q.insert = (valores: Record<string, unknown>) => {
        inserindo = valores;
        m.inserts.push({ tabela, valores });
        return q;
      };
      const resposta = () => {
        if (inserindo) return { data: { id: "rel-novo" }, error: null };
        if (tabela === "hub_users") return { data: { id: OPERADOR, role: "operator", status: "active" }, error: null };
        return { data: m.tabelas[tabela] ?? null, error: null };
      };
      q.single = async () => resposta();
      q.maybeSingle = async () => resposta();
      q.then = (ok: (r: unknown) => unknown) => Promise.resolve(resposta()).then(ok);
      return q;
    },
  };
}

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => clienteFalso(),
  createApoloUserClient: () => clienteFalso(),
}));

import { POST } from "./route";

const pedir = (corpo: Record<string, unknown>) =>
  POST(
    new Request("http://localhost/api/apolo/relationships/create", {
      body: JSON.stringify(corpo),
      headers: { Authorization: "Bearer token", "content-type": "application/json" },
      method: "POST",
    }),
  );

const LIGAR_O_43 = {
  enterpriseId: "43",
  entityId: "conectta",
  kind: "trabalho",
  label: "PORTAL DO IBITURUNA",
  relationshipType: "Empreendimento",
};

const vinculosGravados = () =>
  m.inserts.filter((i) => i.tabela === "apolo_relationships").map((i) => i.valores);

beforeEach(() => {
  m.inserts = [];
  m.registrar.mockReset();
  m.registrar.mockResolvedValue({ auditou: true, coordenadores: { avisados: 1, falharam: 0 } });
  m.after.mockReset();
  m.after.mockImplementation(() => {
    throw new Error("`after` was called outside a request scope.");
  });
  m.cadastro.mockReset();
  m.cadastro.mockResolvedValue([
    { c2xEnterpriseId: "35", codigo: "VLO", id: "h-vlo", nome: "Vale do Ouro", paiId: null },
    { c2xEnterpriseId: "36", codigo: "VOL", id: "h-vol", nome: "Vale do Ouro · VOL", paiId: "h-vlo" },
    { c2xEnterpriseId: "43", codigo: "PDI", id: "h-pdi", nome: "Portal do Ibituruna", paiId: null },
  ]);
  m.tabelas = {
    apolo_entities: {
      display_name: "CONECTTA IMOVEIS",
      document_masked: "37.716.144/0001-59",
      entity_kind: "pj",
      legal_name: "CONECTTA LTDA",
    },
    // A CONECTTA: credenciada, com o Vale do Ouro desde 02/08.
    apolo_entity_profiles: { status: "active" },
    apolo_relationships: [{ metadata: { enterpriseId: "35" } }],
  };
});

describe("POST /api/apolo/relationships/create: empreendimento pelo modal da ficha", () => {
  it("⚠️ imobiliária credenciada ligada ao 43: grava e avisa o coordenador, com o autor", async () => {
    const r = await pedir(LIGAR_O_43);
    expect(r.status).toBe(200);
    expect(vinculosGravados()).toHaveLength(1);
    expect(vinculosGravados()[0]).toMatchObject({ relationship_type: "empreendimento", status: "verified" });

    expect(m.registrar).toHaveBeenCalledTimes(1);
    expect(m.registrar.mock.calls[0]?.[1]).toEqual({
      autorUserId: OPERADOR,
      cnpj: "37.716.144/0001-59",
      empreendimentos: [{ enterpriseId: "43", label: "PORTAL DO IBITURUNA" }],
      entityId: "conectta",
      imobiliaria: "CONECTTA IMOVEIS",
      primeiraVez: false,
    });
  });

  it("⚠️ o que ela já tem (o 36 com o 35 habilitado): nem linha repetida, nem aviso", async () => {
    const r = await pedir({ ...LIGAR_O_43, enterpriseId: "36", label: "VALE DO OURO" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id: null, jaHabilitada: true, ok: true });
    expect(vinculosGravados()).toEqual([]);
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it("prospect ou cliente (sem papel de imobiliária ativo): grava como sempre, sem aviso", async () => {
    m.tabelas.apolo_entity_profiles = null;
    const r = await pedir(LIGAR_O_43);
    expect(r.status).toBe(200);
    expect(vinculosGravados()).toHaveLength(1);
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it("o aviso sai depois da resposta", async () => {
    const depois: Array<() => Promise<unknown>> = [];
    m.after.mockImplementation((tarefa: () => Promise<unknown>) => {
      depois.push(tarefa);
    });
    const r = await pedir(LIGAR_O_43);
    expect(r.status).toBe(200);
    expect(m.registrar).not.toHaveBeenCalled();
    await depois[0]?.();
    expect(m.registrar).toHaveBeenCalledTimes(1);
  });
});
