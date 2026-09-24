import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A TRAVA DO CRÉDITO NA CAD QUE FICOU NO PRODUTO ERRADO (24/09/2026), com o banco FALSO.
//
// O caso do JONATAS: CAD no Veredas do Ouro (19), vínculo do 19 ARQUIVADO e vínculo do Vale do Ouro
// (35) ativo, porque o time trocou só o vínculo. O clique em Consultar leu a configuração do 19
// (análise desligada) e credenciou sem Serasa. O que este arquivo trava:
//   • nesse estado, `consultarCredito` responde 409 ANTES de qualquer régua de empreendimento e de
//     gastar: sem Serasa, sem registro, sem etapa gravada;
//   • `creditoDaCad` (a régua do movimento pelo portal) não aprova, nem pelo atalho da análise
//     desligada;
//   • a regra é ESTREITA: CAD sem vínculo nenhum (as 575 do Asana) segue normal, e vínculo arquivado
//     com outro ativo do MESMO produto (grupo x pai) também;
//   • (terceira rodada, 24/09/2026) só conta o arquivamento feito DEPOIS que a CAD existia: a CAD
//     nova no 35 depois de um Mover 35 -> 19 segue; a do Jonatas, mesmo reenviada, continua travada;
//   • leitura dos vínculos (ou da data da CAD) que falha: 503 antes de gastar (e `creditoDaCad` lança,
//     como o resto dele).

const m = vi.hoisted(() => ({
  analise: vi.fn(async () => false),
  atualizarEtapa: vi.fn(async (_c: unknown, _id: string, etapa: string) => ({ error: null, etapa })),
  cad: vi.fn(async () => ({ enterprise_id: "19" }) as unknown),
  consultarPF: vi.fn(),
  consultarPJ: vi.fn(),
  prevenda: vi.fn(async () => false),
}));

vi.mock("@/lib/serasa/client", () => ({ consultarPF: m.consultarPF, consultarPJ: m.consultarPJ }));
vi.mock("@/lib/apolo/esteira", () => ({ atualizarEtapa: m.atualizarEtapa }));
vi.mock("@/lib/apolo/esteira-cad", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/esteira-cad")>()),
  lerCadDaEsteira: m.cad,
}));
vi.mock("@/lib/apolo/limite-credito", () => ({
  resolverAnaliseHabilitada: m.analise,
  resolverLimiteCredito: vi.fn(async () => 1000),
  resolverPrevendaHabilitada: m.prevenda,
}));
vi.mock("@/lib/apolo/salvar-cad", () => ({
  comLimiteDeTempo: <T>(promessa: Promise<T>) => promessa,
  gerarESalvarCad: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/serasa/comprovante", () => ({ gerarESalvarComprovante: vi.fn() }));
vi.mock("@/lib/apolo/disparo-imobiliaria", () => ({ avisarImobReprovado: vi.fn() }));

import { type AutorDoCredito, consultarCredito, creditoDaCad } from "./consulta-servico";

type Linha = Record<string, unknown>;
type Filtro = [coluna: string, op: string, valor: unknown];

function bancoFalso(tabelas: Record<string, Linha[]>, falhas: Record<string, Linha> = {}) {
  const pedidos: Array<{ op: string; tabela: string }> = [];
  const client = {
    from(tabela: string) {
      const q = { de: 0, filtros: [] as Filtro[], limite: Infinity, op: "select" };
      const executar = () => {
        pedidos.push({ op: q.op, tabela });
        const falha = falhas[`${tabela}:${q.op}`];
        if (falha) return { data: null, error: falha };
        const linhas = (tabelas[tabela] ?? []).filter((linha) =>
          q.filtros.every(([coluna, op, valor]) =>
            op === "eq" ? String(linha[coluna] ?? "") === String(valor) : true,
          ),
        );
        return { data: linhas.slice(q.de, q.de + q.limite), error: null };
      };
      const cadeia: Record<string, unknown> = {};
      const nada = () => cadeia;
      Object.assign(cadeia, {
        eq: (coluna: string, valor: unknown) => {
          q.filtros.push([coluna, "eq", valor]);
          return cadeia;
        },
        gte: nada,
        insert: () => {
          q.op = "insert";
          return cadeia;
        },
        limit: (n: number) => {
          q.limite = n;
          return cadeia;
        },
        maybeSingle: () => {
          const r = executar();
          return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error });
        },
        neq: nada,
        order: nada,
        range: (de: number, ate: number) => {
          q.de = de;
          q.limite = ate - de + 1;
          return cadeia;
        },
        select: nada,
        then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
          Promise.resolve(executar()).then(ok, erro),
        update: () => {
          q.op = "update";
          return cadeia;
        },
      });
      return cadeia;
    },
  };
  return { client: client as unknown as Parameters<typeof consultarCredito>[0]["client"], pedidos };
}

const ENTIDADE = "c34d4b6c-ac71-43ca-b7c2-6a7ec7f69c29";
const HUB: AutorDoCredito = { nome: null, papel: "escrita", tipo: "hub", userId: "c9451037-f47e-4039-a531-4231dfb5cae9" };
const PORTAL: AutorDoCredito = {
  incorporadorId: "inc-1",
  nome: "Coordenador",
  slug: "gurgel",
  tipo: "portal",
  usuarioId: "7b1d2c3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
};

const HERCULES: Linha[] = [
  { c2x_enterprise_id: "35", codigo: "VLO", id: "h-vlo", nome: "Vale do Ouro", pai_id: null },
  { c2x_enterprise_id: "37", codigo: "VOC", id: "h-voc", nome: "Vale do Ouro · VOC", pai_id: "h-vlo" },
  { c2x_enterprise_id: "36", codigo: "VOL", id: "h-vol", nome: "Vale do Ouro · VOL", pai_id: "h-vlo" },
  { c2x_enterprise_id: "41", codigo: "VOR", id: "h-vor", nome: "Vale do Ouro · VOR", pai_id: "h-vlo" },
  { c2x_enterprise_id: "19", codigo: "VDO", id: "h-vdo", nome: "Veredas do Ouro", pai_id: null },
].map((l) => ({ ...l, workspace_id: "careli" }));

/**
 * As datas do Jonatas, medidas em produção em 24/09/2026: a CAD nasceu em 21/09 (chegou_em e
 * created_at) e o vínculo do 19 foi arquivado em 24/09 (metadata.arquivadoEm e updated_at). A trava só
 * conta o arquivamento feito DEPOIS que a CAD existia (terceira rodada da revisão).
 */
const CAD_DO_JONATAS = "2026-09-21T18:14:52.208+00:00";
const ARQUIVADO_DO_JONATAS = "2026-09-24T15:50:13.602Z";

const vinculo = (enterpriseId: string, status: string, arquivadoEm = ARQUIVADO_DO_JONATAS): Linha => ({
  entity_id: ENTIDADE,
  id: `v-${enterpriseId}-${status}`,
  metadata: status === "archived" ? { arquivadoEm, enterpriseId } : { enterpriseId },
  relationship_type: "empreendimento",
  status,
  updated_at: status === "archived" ? arquivadoEm : "2026-09-01T00:00:00.000Z",
});

/** A linha da esteira que a trava lê para saber desde quando a CAD existe. */
const linhaDaCad = (enterpriseId: string, desde = CAD_DO_JONATAS): Linha => ({
  chegou_em: desde,
  created_at: desde,
  entity_id: ENTIDADE,
  enterprise_id: enterpriseId,
});

const tabelas = (vinculos: Linha[], esteira: Linha[] = [linhaDaCad("19")]) => ({
  apolo_entities: [
    {
      display_name: "JONATAS",
      document_masked: "529.982.247-25",
      entity_kind: "pf",
      id: ENTIDADE,
    },
  ],
  apolo_esteira: esteira,
  apolo_relationships: vinculos,
  hercules_empreendimentos: HERCULES,
});

/** O estado do Jonatas: CAD no 19 (de 21/09), vínculo do 19 arquivado em 24/09, vínculo do 35 ativo. */
const JONATAS = () => tabelas([vinculo("19", "archived"), vinculo("35", "verified")]);

/**
 * Depois de um Mover do 35 para o 19 (o Mover arquiva o vínculo do 35 em 24/09), uma CAD NOVA no 35
 * pelo portal ou pelo wizard, em 25/09. Nenhum dos dois cria vínculo de empreendimento para prospect.
 */
const CAD_NOVA_DEPOIS_DO_MOVER = () =>
  tabelas(
    [vinculo("35", "archived", "2026-09-24T16:00:00.000Z"), vinculo("19", "verified")],
    [linhaDaCad("19"), linhaDaCad("35", "2026-09-25T10:00:00.000Z")],
  );

const pedido = { confirmado: true, entityId: ENTIDADE };
const erro = (r: { corpo: unknown }) => (r.corpo as { error: string }).error;

beforeAll(() => {
  vi.stubEnv("SERASA_AUTH_URL", "https://uat-api.serasaexperian.com.br/security/iam/v1/client-identities/login");
  vi.stubEnv("SERASA_CLIENT_ID", "id");
  vi.stubEnv("SERASA_CLIENT_SECRET", "segredo");
  vi.stubEnv("SERASA_PF_URL", "https://uat-api.serasaexperian.com.br/credit-services/person-information-report/v1/creditreport");
  vi.stubEnv("SERASA_PJ_URL", "https://uat-api.serasaexperian.com.br/credit-services/business-information-report/v1/reports");
  vi.stubEnv("SERASA_RETAILER_DOCUMENT_ID", "00000000000000");
  vi.stubEnv("SERASA_AMBIENTE", "homologacao");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockClear();
  // O Veredas do Ouro tem a análise DESLIGADA: é o atalho que credenciou o Jonatas sem Serasa.
  m.analise.mockImplementation(async () => false);
  m.cad.mockImplementation(async () => ({ enterprise_id: "19" }));
});

describe("consultarCredito: a CAD que ficou no produto errado não vai ao crédito", () => {
  for (const autor of [HUB, PORTAL]) {
    it(`o caso do Jonatas (${autor.tipo}): 409 sem consultar, sem registrar e sem gravar etapa`, async () => {
      const banco = bancoFalso(JONATAS());
      const r = await consultarCredito({ autor, client: banco.client, corpo: pedido });

      expect(r.status).toBe(409);
      expect(erro(r)).toContain("Nada foi consultado nem cobrado");
      expect(erro(r)).not.toMatch(/[—–]/);
      expect(m.consultarPF).not.toHaveBeenCalled();
      expect(m.atualizarEtapa).not.toHaveBeenCalled();
      // A trava vem ANTES de qualquer régua do empreendimento: nem a análise é lida.
      expect(m.analise).not.toHaveBeenCalled();
      expect(banco.pedidos.filter((p) => p.tabela === "serasa_consultas")).toHaveLength(0);
    });
  }

  it("a frase do hub aponta o Mover CAD; a do portal não expõe o detalhe interno", async () => {
    const hub = await consultarCredito({ autor: HUB, client: bancoFalso(JONATAS()).client, corpo: pedido });
    // (24/09/2026, revisão) A frase diz que é a COORDENAÇÃO quem move: o analista chega aqui e não
    // tem o botão. É a mesma frase do 409 do arquivamento do vínculo, literal por literal.
    expect(erro(hub)).toContain("Para trocar o empreendimento, a coordenação usa Mover CAD no Board.");
    expect(erro(hub)).not.toContain("Use Mover CAD");
    expect(erro(hub)).not.toMatch(/[—–]/);
    const portal = await consultarCredito({ autor: PORTAL, client: bancoFalso(JONATAS()).client, corpo: pedido });
    expect(erro(portal)).toContain("Fale com a Careli");
    expect(erro(portal)).not.toContain("Mover CAD");
  });

  it("CAD sem vínculo nenhum (as do Asana): segue o fluxo normal", async () => {
    const banco = bancoFalso(tabelas([]));
    const r = await consultarCredito({ autor: HUB, client: banco.client, corpo: pedido });
    // Segue até a régua do empreendimento (aqui, a análise desligada do 19).
    expect(r.status).toBe(200);
    expect(m.analise).toHaveBeenCalled();
    // Sem vínculo arquivado, nem o cadastro de empreendimentos é lido.
    expect(banco.pedidos.filter((p) => p.tabela === "hercules_empreendimentos")).toHaveLength(0);
  });

  it("vínculo arquivado mas outro ATIVO do mesmo produto (grupo x pai): segue", async () => {
    m.cad.mockImplementation(async () => ({ enterprise_id: "35" }));
    const banco = bancoFalso(
      tabelas([vinculo("35", "archived"), vinculo("group:Vale do Ouro", "verified")]),
    );
    const r = await consultarCredito({ autor: HUB, client: banco.client, corpo: pedido });
    expect(r.status).toBe(200);
    expect(m.analise).toHaveBeenCalled();
  });

  it("vínculo arquivado de OUTRO produto, com o da CAD ativo: segue", async () => {
    const banco = bancoFalso(tabelas([vinculo("35", "archived"), vinculo("19", "verified")]));
    expect((await consultarCredito({ autor: HUB, client: banco.client, corpo: pedido })).status).toBe(200);
  });

  it("a leitura dos vínculos falha: 503 antes de gastar", async () => {
    const banco = bancoFalso(JONATAS(), { "apolo_relationships:select": { message: "timeout" } });
    const r = await consultarCredito({ autor: HUB, client: banco.client, corpo: pedido });
    expect(r.status).toBe(503);
    expect(m.consultarPF).not.toHaveBeenCalled();
    expect(m.atualizarEtapa).not.toHaveBeenCalled();
  });

  it("a leitura da data da CAD falha: 503 antes de gastar", async () => {
    const banco = bancoFalso(JONATAS(), { "apolo_esteira:select": { message: "timeout" } });
    const r = await consultarCredito({ autor: HUB, client: banco.client, corpo: pedido });
    expect(r.status).toBe(503);
    expect(m.consultarPF).not.toHaveBeenCalled();
  });

  it("CAD NOVA no 35 depois de um Mover do 35 para o 19: segue (o arquivamento é ANTERIOR a ela)", async () => {
    // Sem o critério de tempo, esta CAD respondia 409 mandando usar o Mover, e o Mover 35 -> 19
    // respondia 409 também (o 19 já tem CAD): beco sem saída.
    m.cad.mockImplementation(async () => ({ enterprise_id: "35" }));
    const banco = bancoFalso(CAD_NOVA_DEPOIS_DO_MOVER());
    const r = await consultarCredito({ autor: HUB, client: banco.client, corpo: pedido });
    expect(r.status).toBe(200);
    expect(m.analise).toHaveBeenCalled();
  });

  it("a CAD do Jonatas reenviada depois do arquivamento (chegou_em novo, created_at antigo): continua 409", async () => {
    const banco = bancoFalso(
      tabelas(
        [vinculo("19", "archived"), vinculo("35", "verified")],
        [{ ...linhaDaCad("19"), chegou_em: "2026-09-26T09:00:00.000Z" }],
      ),
    );
    const r = await consultarCredito({ autor: HUB, client: banco.client, corpo: pedido });
    expect(r.status).toBe(409);
    expect(m.consultarPF).not.toHaveBeenCalled();
  });
});

describe("creditoDaCad: a mesma trava, antes do atalho da análise desligada", () => {
  const perguntar = (banco: ReturnType<typeof bancoFalso>, etapaAtual = "credito") =>
    creditoDaCad({ client: banco.client, enterpriseId: "19", entityId: ENTIDADE, etapaAtual });

  it("o caso do Jonatas: não aprova, e o atalho da análise desligada nem é consultado", async () => {
    expect(await perguntar(bancoFalso(JONATAS()))).toEqual({
      aprovado: false,
      fonte: "vinculo-arquivado",
    });
    expect(m.analise).not.toHaveBeenCalled();
  });

  it("CAD sem vínculo nenhum: segue a régua de sempre (análise desligada aprova)", async () => {
    expect(await perguntar(bancoFalso(tabelas([])))).toEqual({
      aprovado: true,
      fonte: "analise-desligada",
    });
  });

  it("leitura dos vínculos que falha: lança (a porta traduz em 503)", async () => {
    await expect(
      perguntar(bancoFalso(JONATAS(), { "apolo_relationships:select": { message: "timeout" } })),
    ).rejects.toThrow();
  });

  it("CAD NOVA no 35 depois de um Mover do 35 para o 19: a régua de sempre, e não 'vinculo-arquivado'", async () => {
    const r = await creditoDaCad({
      client: bancoFalso(CAD_NOVA_DEPOIS_DO_MOVER()).client,
      enterpriseId: "35",
      entityId: ENTIDADE,
      etapaAtual: "credito",
    });
    expect(r).toEqual({ aprovado: true, fonte: "analise-desligada" });
  });
});
