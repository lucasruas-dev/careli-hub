import { beforeEach, describe, expect, it, vi } from "vitest";

// A TELA CONTRATOS DO APOLO CONSULTA O C2X PELO ID DO EMPREENDIMENTO (PAN-124, 25/09/2026).
//
// A tela continua mandando a SIGLA (`?emp=VOC`), e a sigla continua passando pela allowlist da lista
// viva (`resolverCodes`). O que mudou é o WHERE das duas consultas do recorte (linhas de assinatura e
// contratos vivos): `e.id in (...)` com o id que a MESMA lista dá à sigla, em vez de `e.code in`. Um
// renome no C2X (o 43 foi de RDV para PDI em 24/09/2026) com a lista em cache deixava o painel vazio.
//
// O C2X aqui é de mentira: responde a lista de empreendimentos e registra o SQL e os parâmetros das
// consultas do recorte. A D4Sign fica de fora (o quadro sai só do C2X).

type Chamada = { params: unknown[]; sql: string };

const m = vi.hoisted(() => ({
  chamadas: [] as Chamada[],
  lista: [] as Array<{ code: string; contratos: number; id: number; nome: string }>,
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({
    ok: true,
    pool: {
      query: async (sql: string, params: unknown[] = []) => {
        m.chamadas.push({ params, sql });
        if (sql.includes("as contratos from (")) return [m.lista];
        return [[]];
      },
    },
  }),
}));

vi.mock("@/lib/apolo/d4sign-quadro", () => ({
  montarQuadroComD4Sign: async (args: {
    arPorEnvio: Map<number, number>;
    linhas: never[];
    semAssinante?: never[];
    vivos: never[];
  }) => {
    const { montarQuadroDeAssinaturas } = await import("@/lib/apolo/incorporador/assinaturas");
    return {
      ...montarQuadroDeAssinaturas(args.linhas, args.vivos, args.arPorEnvio, args.semAssinante ?? []),
      cancelados: [],
      conciliando: false,
    };
  },
}));

// Os ids do C2X de 25/09/2026 (lib/apolo/c2x-pelo-id.fixture.ts).
const LISTA_DE_HOJE = [
  { code: "VAL", contratos: 39, id: 29, nome: "VISTA ALEGRE" },
  { code: "VLO", contratos: 15, id: 35, nome: "VALE DO OURO" },
  { code: "VOC", contratos: 93, id: 37, nome: "VALE DO OURO" },
  { code: "VOL", contratos: 93, id: 36, nome: "VALE DO OURO" },
  { code: "VOR", contratos: 2, id: 41, nome: "VALE DO OURO" },
];

/** O painel com o estado de módulo zerado (os caches da lista e do recorte são do processo). */
async function carregar(pedidos: string[]) {
  vi.resetModules();
  const { carregarPainelDeContratos } = await import("./painel-contratos");
  return carregarPainelDeContratos(pedidos);
}

const doRecorte = () => m.chamadas.filter((c) => !c.sql.includes("as contratos from ("));
const daLista = () => m.chamadas.find((c) => c.sql.includes("as contratos from ("));

/** Uma consulta do recorte filtra por `e.code in`/`e.code =`? (era assim antes do PAN-124). */
const SIGLA_FILTRADA = /e\.code\s+in\s*\(|e\.code\s*=\s*\?/i;

beforeEach(() => {
  m.chamadas = [];
  m.lista = LISTA_DE_HOJE;
});

describe("a lista de empreendimentos traz o id junto da sigla", () => {
  it("os dois ramos do UNION e o GROUP BY levam o `e.id`", async () => {
    await carregar([]);
    const sql = daLista()?.sql ?? "";
    expect(sql).toContain("select e.id as id, e.code as code, e.name as nome");
    expect(sql).toContain("select e.id, e.code, e.name, ar.id");
    expect(sql).toContain("group by id, code, nome");
    // A ordem da lista (a do seletor da tela) não mudou.
    expect(sql).toContain("order by nome, code");
  });

  it("o id chega à tela em cada item do filtro", async () => {
    const r = await carregar([]);
    expect(r.ok && r.dados.empreendimentos.find((e) => e.code === "VOC")?.id).toBe(37);
  });
});

describe("o recorte vai ao C2X pelo id", () => {
  it("🔴 o padrão (VOC + VOL) consulta os ids 36 e 37, e nenhuma consulta filtra pela sigla", async () => {
    const r = await carregar([]);

    expect(r.ok && r.dados.codes).toEqual(["VOC", "VOL"]);
    const recorte = doRecorte();
    expect(recorte).toHaveLength(2);
    for (const chamada of recorte) {
      expect(chamada.sql).toContain("e.id in (?, ?)");
      expect(chamada.sql).not.toMatch(SIGLA_FILTRADA);
      expect(chamada.params).toEqual(expect.arrayContaining([36, 37]));
      expect(chamada.params).not.toContain("VOC");
      expect(chamada.params).not.toContain("VOL");
    }
    // As linhas de assinatura recebem SÓ os ids.
    expect(recorte[0]?.params).toEqual([36, 37]);
  });

  it("a sigla pedida pela tela vira o id da mesma lista (VOR = 41)", async () => {
    await carregar(["vor"]);
    expect(doRecorte()[0]?.params).toEqual([41]);
  });

  it("'*' consulta todos os ids da lista", async () => {
    await carregar(["*"]);
    expect(doRecorte()[0]?.params).toEqual([29, 35, 36, 37, 41]);
  });

  it("🔴 renome no C2X: o padrão continua sendo o 37 e o 36, com a sigla que a lista der hoje", async () => {
    // Pela sigla fixa ["VOC", "VOL"], o 37 renomeado sumia do padrão e a carteira do Cecílio junto.
    m.lista = LISTA_DE_HOJE.map((e) => (e.id === 37 ? { ...e, code: "VCX" } : e));

    const r = await carregar([]);

    expect(r.ok && r.dados.codes).toEqual(["VCX", "VOL"]);
    expect(doRecorte()[0]?.params).toEqual([36, 37]);
  });

  it("sem nenhum empreendimento na lista, não vai ao C2X com `in ()`", async () => {
    m.lista = [];
    const r = await carregar(["VOC"]);
    expect(r.ok && r.dados.total).toBe(0);
    expect(doRecorte()).toHaveLength(0);
  });
});
