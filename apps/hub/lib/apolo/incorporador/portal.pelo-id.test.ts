import { beforeEach, describe, expect, it, vi } from "vitest";

import { type CatalogoParaId, idsDoC2xDasSiglas } from "@/lib/apolo/c2x-pelo-id";
import {
  empreendimentosDoWhere,
  type EmpreendimentoFalso,
  filtraPelaSigla,
} from "@/lib/apolo/c2x-pelo-id.where-falso";
import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";

// O PORTAL DO INCORPORADOR LÊ O C2X PELO ID DO EMPREENDIMENTO (PAN-124, lote 3).
//
// O que trava: a sigla não vai mais ao C2X. Em 24/09/2026 a Nívea renomeou o 43 de RDV para PDI. O
// catálogo guarda a sigla por 10 minutos, e é dele que o escopo do portal tira os codes: nesses minutos
// a sessão pedia "RDV" a um C2X que já dizia PDI, e com `e.code in (...)` as assinaturas, os contratos,
// a carteira, o corretor, a ficha corrida, o mapa, o perfil e o BI daquele empreendimento voltavam
// VAZIOS, sem erro. Pelo id, o 43 continua sendo o 43. O mesmo vale para a exclusão: a lista por sigla
// não segura um renome do empreendimento de teste (o "LAG" já não casa com nada desde 16/07/2026).
//
// O C2X aqui é de mentira, mas responde ao WHERE que recebe (c2x-pelo-id.where-falso.ts): a consulta
// antiga, pela sigla, recebe o que o MySQL daria a ela, e é por isso que estes testes falham com ela.
//
// ⚠️ O QUE OS TESTES DE RENOME PROVAM, E O QUE NÃO. Aqui a sigla sai do MESMO catálogo que a traduz
// (é o portal: o escopo e a tradução leem o catálogo em cache), e é por isso que "RDV com o catálogo
// velho" dá o mesmo que "PDI com o novo". Não provam que a sigla GUARDADA de antes do renome atravessa:
// com o catálogo já relido, RDV não acha nada (c2x-pelo-id-servidor.test.ts, "O LIMITE").

const m = vi.hoisted(() => ({
  lerC2xUserId: vi.fn(),
  lerCadastroDaPessoa: vi.fn(),
  pessoaNoEscopo: vi.fn(),
  pool: { ok: true as boolean, query: vi.fn() },
  quadro: vi.fn(),
  traduzir: vi.fn(),
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () =>
    m.pool.ok
      ? { ok: true, pool: { query: m.pool.query } }
      : { missing: ["GUARDIAN_DB_HOST"], ok: false },
}));

vi.mock("@/lib/apolo/c2x-pelo-id-servidor", () => ({ idsDoC2xDasSiglasAoVivo: m.traduzir }));

// A D4Sign fica de fora: o que se prova aqui é o que SAI do C2X. O quadro devolve o que recebeu.
vi.mock("@/lib/apolo/d4sign-quadro", () => ({ montarQuadroComD4Sign: m.quadro }));

vi.mock("@/lib/apolo/server", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/server")>()),
  createApoloAdminClient: () => ({}),
}));

vi.mock("@/lib/apolo/incorporador/pessoa-no-escopo", () => ({
  pessoaNoEscopo: m.pessoaNoEscopo,
}));

vi.mock("@/lib/apolo/incorporador/ficha-cadastro", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/incorporador/ficha-cadastro")>()),
  lerC2xUserId: m.lerC2xUserId,
  lerCadastroDaPessoa: m.lerCadastroDaPessoa,
}));

import { lerAssinaturasDoPortal } from "./assinaturas";
import { carteiraLiquidaDoIncorporador } from "./carteira-liquida";
import { lerContratosDoPortal } from "./contratos";
import { linhasSoDoPanteon } from "./escopo";
import { lerCorretorDoContrato } from "./ficha-cadastro";
import {
  idsDoEscopoNoC2x,
  lerPagamentosDoEscopo,
  lerVendasDoEscopo,
  montarHistorico,
} from "./historico";
import { lerLotesDoEscopo } from "./masterplan-estado";
import { lerCompradoresDasVendas } from "./perfil-comprador";
import { lerEventosDeVendas } from "./vendas-bi";

// ── O C2X DE MENTIRA ──────────────────────────────────────────────────────────────────────────────

/**
 * O C2X DEPOIS DOS RENOMES: o 43 já é PDI (era RDV até 24/09/2026) e o 34, o TESTE SPLIT CARELI,
 * aparece renomeado de TSC para TSX (hipotético: é o renome que a exclusão por sigla não aguenta).
 */
const C2X: EmpreendimentoFalso[] = [
  { code: "SDT", id: 2, name: "SERVIDOR DE TREINAMENTO" },
  { code: "LAB", id: 31, name: "LAGOA BONITA - MASTERPLAN" },
  { code: "LBF", id: 33, name: "LAGOA BONITA - FERNANDO" },
  { code: "TSX", id: 34, name: "TESTE SPLIT CARELI" },
  { code: "VOL", id: 36, name: "VALE DO OURO - LOTES" },
  { code: "VOC", id: 37, name: "VALE DO OURO - CHACARAS" },
  { code: "PDI", id: 43, name: "PORTAL DO IBITURUNA" },
];

function catalogo(...pares: Array<[string, number]>): CatalogoParaId {
  return pares.map(([code, id]) => ({ codes: [code], id: String(id), stageIds: [String(id)] }));
}

/** O catálogo em cache de ANTES do renome: o 43 ainda se chama RDV. */
const CATALOGO_VELHO = catalogo(["VOC", 37], ["VOL", 36], ["LBF", 33], ["RDV", 43], ["TSX", 34]);
/** O catálogo relido: o 43 já é PDI. */
const CATALOGO_NOVO = catalogo(["VOC", 37], ["VOL", 36], ["LBF", 33], ["PDI", 43], ["TSX", 34]);

/** O catálogo que a casca do servidor leria sozinha (quem chama não passou nenhum). */
let catalogoDoCache: CatalogoParaId = CATALOGO_NOVO;

/** Uma linha por empreendimento que passa no WHERE, com as colunas que cada consulta devolve. */
function linhasDaConsulta(sql: string, emp: EmpreendimentoFalso): Array<Record<string, unknown>> {
  if (sql.includes("as signer_id")) {
    return [
      {
        ar_id: emp.id * 100,
        assinado: 1,
        data_assinatura: "2026-09-01",
        dias_envio: 3,
        email: "comprador@exemplo.com",
        emp: emp.code,
        envio: "2026-08-29",
        id_ass: emp.id * 1000,
        lot: "1",
        papel_no_empreendimento: null,
        perfil_c2x: "Cliente",
        posicao: 0,
        quadra: "A",
        signer_id: emp.id * 10_000,
        status_c2x: 1,
        unidade: `U${emp.id}`,
        usuario: "Comprador",
        usuario_c2x_id: 1,
        uuid_doc: `uuid-${emp.id}`,
        valor: 1000,
      },
    ];
  }
  if (sql.includes("as proposta_em")) {
    return [
      {
        ar_id: emp.id * 100,
        billing_date: null,
        block: "A",
        comprador: "Comprador",
        enterprise_code: emp.code,
        gerado_em: null,
        imobiliaria: null,
        lot: "1",
        price: 1000,
        proposta_em: "2026-08-01T12:00:00.000Z",
        unit_id: emp.id * 10,
        unit_name: `U${emp.id}`,
      },
    ];
  }
  if (sql.includes("p.split_data")) {
    return [
      {
        ar_id: emp.id * 100,
        cliente: "Comprador",
        competence: "09/2026",
        documento: null,
        due_date: "2026-09-01",
        enterprise_code: emp.code,
        entrada_contratada: null,
        imobiliaria: null,
        parcel_type: "Parcela",
        parcela_n: 1,
        parcela_total: 10,
        payment_date: "2026-09-01",
        payment_id: emp.id * 1000 + 1,
        plano_personalizado: 0,
        sinal_n: null,
        sinal_total: null,
        split_data: null,
        status_id: 5,
        unit_block: "A",
        unit_id: emp.id * 10,
        unit_lot: "1",
        unit_price: 1000,
        valor: 100,
        valor_previsto: 100,
      },
    ];
  }
  if (sql.includes("as corretor_name")) return [{ corretor_name: `Corretor do ${emp.id}` }];
  if (sql.includes("as hist_id")) {
    return [
      {
        block: "A",
        enterprise_name: emp.name,
        hist_id: emp.id,
        lot: "1",
        occurred_at: "2026-09-01T10:00:00-03:00",
        stage_id: 3,
        stage_name: "Contrato gerado",
      },
    ];
  }
  if (sql.includes("as payment_day")) {
    return [
      {
        enterprise_name: emp.name,
        paid_value: 100,
        parcel_label: "1/10",
        parcel_type: "Parcela",
        payment_day: "2026-09-01",
        payment_id: emp.id,
      },
    ];
  }
  if (sql.includes("u.updated_at")) {
    return [
      {
        block: "A",
        comprador: "Comprador",
        enterprise_id: emp.id,
        id: emp.id * 10,
        lot: "1",
        name: `U${emp.id}`,
        price: 1000,
        updated_at: new Date("2026-09-01T00:00:00Z"),
      },
    ];
  }
  if (sql.includes("estado_civil")) {
    return [
      {
        cidade: "Belo Horizonte/MG",
        estado_civil: "Casado",
        nascimento: "1980-01-01",
        profissao: "Engenheiro",
        renda: "De 5 a 10 salários",
        sexo: "Masculino",
      },
    ];
  }
  if (sql.includes("as novo_estagio")) {
    return [
      {
        ar_id: emp.id * 100,
        em: new Date("2026-09-01T12:00:00Z"),
        estagio_anterior: 4,
        novo_estagio: 9,
        preco: 1000,
        unit_id: emp.id * 10,
      },
    ];
  }
  return [];
}

function c2xFalso(): void {
  m.pool.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    // Os envios de `lerContratosDoPortal` vêm pelo ar_id, sem filtro de empreendimento.
    if (sql.includes("where arc.acquisition_request_id in (?)")) {
      const arIds = (params[0] as number[]) ?? [];
      return [arIds.map((arId) => ({ ar_id: arId, assinadas: 1, cs_id: arId * 10, linhas: 1, uuid_doc: "u" }))];
    }
    // ⚠️ O `'?'` LITERAL (o perfil do comprador tem `coalesce(st.acronym, '?')`) não é marcador: o
    // mysql2 respeita a aspa, e o WHERE de mentira conta `?` sem olhar aspa. Sem esta troca ele
    // desalinharia os parâmetros e diria que nenhum empreendimento passa.
    const semLiteral = sql.replace(/'\?'/g, "''");
    const passam = empreendimentosDoWhere(semLiteral, params, C2X);
    return [passam.flatMap((emp) => linhasDaConsulta(sql, emp))];
  });
}

/** As consultas ao C2X que filtram empreendimento (as que têm `enterprises e` no FROM). */
function consultasPorEmpreendimento(): Array<{ params: unknown[]; sql: string }> {
  return m.pool.query.mock.calls
    .map(([sql, params]) => ({ params: (params ?? []) as unknown[], sql: String(sql) }))
    .filter((chamada) => /join enterprises e on/.test(chamada.sql));
}

beforeEach(() => {
  m.pool.ok = true;
  m.pool.query.mockReset();
  m.traduzir.mockReset();
  m.quadro.mockReset();
  m.pessoaNoEscopo.mockReset();
  m.lerC2xUserId.mockReset();
  m.lerCadastroDaPessoa.mockReset();
  catalogoDoCache = CATALOGO_NOVO;

  c2xFalso();
  // A casca do servidor, com a régua PURA de verdade por dentro: traduz pelo catálogo que recebeu,
  // ou pelo do cache, e aplica a exclusão por id de sempre.
  m.traduzir.mockImplementation(
    async (
      siglas: Iterable<unknown>,
      opcoes: { catalogo?: CatalogoParaId | null; excluir?: readonly number[] } = {},
    ) => ({
      ok: true,
      ...idsDoC2xDasSiglas(siglas, { catalogo: opcoes.catalogo ?? catalogoDoCache }, opcoes),
    }),
  );
  m.quadro.mockImplementation(async (args: Record<string, unknown>) => ({
    arPorEnvio: [...(args.arPorEnvio as Map<number, number>)],
    linhas: args.linhas,
    semAssinante: args.semAssinante,
    vivos: args.vivos,
  }));
});

// ── AS LEITURAS, UMA A UMA ────────────────────────────────────────────────────────────────────────

type Caso = {
  /** O que a consulta devolvia quando o C2X respondia sem linha nenhuma (sigla que não casa). */
  vazioDeHoje: "sem-codigo" | "sem-linha";
  /** A leitura, com o catálogo que a rota passaria (quando ela aceita um). */
  ler: (codes: string[], catalogo: CatalogoParaId) => Promise<unknown>;
  /** O catálogo chega à tradução? (as leituras que aceitam o da rota) */
  repassaCatalogo: boolean;
  nome: string;
};

const HOJE_MS = Date.parse("2026-09-25T12:00:00Z");

const CASOS: Caso[] = [
  {
    ler: (codes, cat) => lerAssinaturasDoPortal(codes, { catalogo: cat }),
    nome: "assinaturas (lerAssinaturasDoPortal + lerContratosVivos)",
    repassaCatalogo: true,
    // Recorte sem id não tem documento para conferir: o quadro vazio, sem ir à D4Sign.
    vazioDeHoje: "sem-codigo",
  },
  {
    ler: (codes, cat) => lerContratosDoPortal(codes, { catalogo: cat }),
    nome: "contratos (lerContratosDoPortal + lerContratosVivos)",
    repassaCatalogo: true,
    vazioDeHoje: "sem-linha",
  },
  {
    ler: (codes, cat) =>
      carteiraLiquidaDoIncorporador({
        catalogo: cat,
        codes,
        indicadores: { agoraMs: HOJE_MS },
        politicaPorCode: new Map(),
      }),
    nome: "carteira líquida (lerLinhasDaCarteira)",
    repassaCatalogo: true,
    vazioDeHoje: "sem-linha",
  },
  {
    ler: (codes, cat) => lerCorretorDoContrato(4242, codes, { catalogo: cat }),
    nome: "corretor da ficha (lerCorretorDoContrato)",
    repassaCatalogo: true,
    vazioDeHoje: "sem-linha",
  },
  {
    ler: async (codes, cat) => {
      // A ficha corrida não recebe catálogo: a casca lê o do cache.
      catalogoDoCache = cat;
      const ids = await idsDoEscopoNoC2x(codes);
      return {
        pagamentos: await lerPagamentosDoEscopo(4242, ids),
        vendas: await lerVendasDoEscopo(4242, ids),
      };
    },
    nome: "ficha corrida (lerVendasDoEscopo + lerPagamentosDoEscopo)",
    repassaCatalogo: false,
    vazioDeHoje: "sem-linha",
  },
  {
    ler: (codes, cat) => lerLotesDoEscopo(codes, { catalogo: cat }),
    nome: "masterplan (lerLotesDoEscopo)",
    repassaCatalogo: true,
    vazioDeHoje: "sem-linha",
  },
  {
    ler: (codes, cat) => lerCompradoresDasVendas(codes, { catalogo: cat }),
    nome: "perfil do comprador (lerCompradoresDasVendas)",
    repassaCatalogo: true,
    vazioDeHoje: "sem-linha",
  },
  {
    ler: (codes, cat) => lerEventosDeVendas(codes, { catalogo: cat }),
    nome: "BI de vendas (lerEventosDeVendas)",
    repassaCatalogo: true,
    vazioDeHoje: "sem-linha",
  },
];

describe.each(CASOS)("$nome", (caso) => {
  it("🔴 o SQL vai pelo id (`e.id in`), nunca pela sigla", async () => {
    await caso.ler(["PDI"], CATALOGO_NOVO);

    const consultas = consultasPorEmpreendimento();
    expect(consultas.length).toBeGreaterThan(0);
    for (const { params, sql } of consultas) {
      expect(filtraPelaSigla(sql)).toBe(false);
      expect(sql).toMatch(/e\.id in \(\?\)/);
      expect(params).toContain(43);
      expect(params).not.toContain("PDI");
    }
  });

  it("🔴 o renome não muda o resultado: com o catálogo em cache ainda dizendo RDV, sai o mesmo que com PDI", async () => {
    const comSiglaVelha = await caso.ler(["RDV"], CATALOGO_VELHO);
    m.pool.query.mockClear();
    const comSiglaNova = await caso.ler(["PDI"], CATALOGO_NOVO);
    const semNada = await caso.ler(["TST"], CATALOGO_NOVO);

    expect(comSiglaVelha).toEqual(comSiglaNova);
    // E não é o "igual porque os dois vieram vazios": com a sigla antiga no WHERE, sairia `semNada`.
    expect(comSiglaNova).not.toEqual(semNada);
  });

  if (caso.repassaCatalogo) {
    it("usa o catálogo que a rota já tem, sem reler", async () => {
      await caso.ler(["RDV"], CATALOGO_VELHO);
      expect(m.traduzir).toHaveBeenCalledWith(
        ["RDV"],
        expect.objectContaining({ catalogo: CATALOGO_VELHO }),
      );
    });
  }

  it("sigla sem id no C2X (produto nascido no Panteon) não vai ao legado e dá o vazio de hoje", async () => {
    const semId = await caso.ler(["TST"], CATALOGO_NOVO);
    expect(m.pool.query).not.toHaveBeenCalled();

    // O vazio de hoje: o que a consulta pela sigla dava quando não casava com nada (o C2X sem linha),
    // ou, no quadro de assinaturas, o recorte vazio (que já não ia à D4Sign).
    let deHoje: unknown;
    if (caso.vazioDeHoje === "sem-codigo") {
      deHoje = await caso.ler([], CATALOGO_NOVO);
    } else {
      m.pool.query.mockResolvedValue([[]]);
      deHoje = await caso.ler(["PDI"], CATALOGO_NOVO);
    }
    expect(semId).toEqual(deHoje);
  });

  it("catálogo indisponível (C2X fora) é a falha de sempre, sem consulta e sem resultado zerado", async () => {
    m.traduzir.mockResolvedValue({ erro: "catálogo fora", ok: false });
    const semCatalogo = await caso.ler(["PDI"], CATALOGO_NOVO);
    expect(m.pool.query).not.toHaveBeenCalled();

    // A mesma resposta de quando a consulta ao C2X cai.
    m.traduzir.mockImplementation(async () => ({ ids: [43], ok: true, semId: [] }));
    m.pool.query.mockRejectedValue(new Error("ECONNREFUSED"));
    const c2xFora = await caso.ler(["PDI"], CATALOGO_NOVO);

    if (caso.nome.startsWith("carteira")) {
      // A carteira devolve o motivo cru; a rota não o repassa ao portal (vira `liquido: null`).
      expect(semCatalogo).toMatchObject({ ok: false });
      expect(c2xFora).toMatchObject({ ok: false });
    } else {
      expect(semCatalogo).toEqual(c2xFora);
    }
  });
});

// ── A EXCLUSÃO, AGORA PELO ID ─────────────────────────────────────────────────────────────────────

describe("a exclusão sai do filtro por sigla e vai para o id", () => {
  it("🔴 assinaturas: o teste renomeado (TSC -> TSX, id 34) continua fora, sem ir ao C2X", async () => {
    const r = await lerAssinaturasDoPortal(["TSX"], { catalogo: CATALOGO_NOVO });
    expect(m.pool.query).not.toHaveBeenCalled();
    expect(r).toEqual(await lerAssinaturasDoPortal([]));
  });

  it("🔴 contratos: idem", async () => {
    const r = await lerContratosDoPortal(["TSX"], { catalogo: CATALOGO_NOVO });
    expect(m.pool.query).not.toHaveBeenCalled();
    expect(r).toEqual(await lerContratosDoPortal([]));
  });

  it("o resto do recorte segue: VOC + TSX lê só o VOC", async () => {
    await lerContratosDoPortal(["VOC", "TSX"], { catalogo: CATALOGO_NOVO });
    const [consulta] = consultasPorEmpreendimento();
    expect(consulta?.params).toContain(37);
    expect(consulta?.params).not.toContain(34);
  });
});

// ── A FICHA CORRIDA INTEIRA ───────────────────────────────────────────────────────────────────────

describe("montarHistorico", () => {
  beforeEach(() => {
    m.pessoaNoEscopo.mockResolvedValue({
      codes: ["RDV"],
      enterpriseIdDaCad: null,
      enterpriseIds: ["43"],
      entityId: "ent-1",
      ok: true,
      unidadesDaPessoa: [],
    });
    m.lerC2xUserId.mockResolvedValue(4242);
    m.lerCadastroDaPessoa.mockResolvedValue({ c2xUserId: 4242, conjugeNome: null, emails: [], grupos: [] });
  });

  it("🔴 traduz os codes da sessão UMA vez e as duas leituras vão pelo id (catálogo ainda com RDV)", async () => {
    catalogoDoCache = CATALOGO_VELHO;

    const r = await montarHistorico({ id: "ent-1", sessao: {} as never, tipo: "comprador" });

    expect(m.traduzir).toHaveBeenCalledTimes(1);
    expect(m.traduzir).toHaveBeenCalledWith(["RDV"]);
    const consultas = consultasPorEmpreendimento();
    expect(consultas).toHaveLength(2);
    for (const { params, sql } of consultas) {
      expect(filtraPelaSigla(sql)).toBe(false);
      expect(params).toEqual([4242, 43]);
    }
    expect(r.ok && r.eventos.map((e) => e.categoria).sort()).toEqual(["pagamento", "venda"]);
  });

  it("sem c2xUserId não traduz nem consulta", async () => {
    m.lerC2xUserId.mockResolvedValue(null);
    const r = await montarHistorico({ id: "ent-1", sessao: {} as never, tipo: "comprador" });
    expect(m.traduzir).not.toHaveBeenCalled();
    expect(m.pool.query).not.toHaveBeenCalled();
    expect(r).toEqual({ eventos: [], ok: true });
  });
});

// ── A TRAVA DO LAB NO ESCOPO ──────────────────────────────────────────────────────────────────────

function linha(dados: Partial<LinhaDoCadastro> & Pick<LinhaDoCadastro, "c2xEnterpriseId" | "codigo">): LinhaDoCadastro {
  return {
    cidade: null,
    id: `uuid-${dados.codigo}`,
    nome: dados.codigo,
    ordem: null,
    paiId: null,
    uf: null,
    vendendo: true,
    ...dados,
  } as LinhaDoCadastro;
}

describe("linhasSoDoPanteon: a trava do excluído é pelo id", () => {
  const catalogoSemOExcluido = [{ stageIds: ["37", "36", "41"] }];

  it("o LAB (31) da sessão do /gurgel continua fora, como antes", () => {
    const cadastro = [linha({ c2xEnterpriseId: "31", codigo: "LAB" })];
    expect(linhasSoDoPanteon({ cadastro, catalogo: catalogoSemOExcluido, permitidos: ["31"] })).toEqual([]);
  });

  it("🔴 o 31 renomeado no cadastro continua fora (a trava por sigla deixava passar)", () => {
    const cadastro = [linha({ c2xEnterpriseId: "31", codigo: "LBM" })];
    expect(linhasSoDoPanteon({ cadastro, catalogo: catalogoSemOExcluido, permitidos: ["31"] })).toEqual([]);
  });

  it("produto nascido no Panteon passa, mesmo batizado com sigla de excluído", () => {
    const cadastro = [linha({ c2xEnterpriseId: "100007", codigo: "LAB" })];
    const r = linhasSoDoPanteon({ cadastro, catalogo: catalogoSemOExcluido, permitidos: ["100007"] });
    expect(r.map((l) => l.c2xEnterpriseId)).toEqual(["100007"]);
  });

  it("o ZZ TESTE (9001, TST) passa, como passava", () => {
    const cadastro = [linha({ c2xEnterpriseId: "9001", codigo: "TST" })];
    const r = linhasSoDoPanteon({ cadastro, catalogo: catalogoSemOExcluido, permitidos: ["9001"] });
    expect(r.map((l) => l.codigo)).toEqual(["TST"]);
  });
});
