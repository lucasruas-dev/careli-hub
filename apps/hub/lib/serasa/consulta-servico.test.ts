import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// O SERVIÇO DA CONSULTA AO SERASA, com o banco e o Serasa FALSOS.
//
// Decisão do Lucas (16/09/2026): a Cecílio faz a análise de crédito pelo portal, com a consulta PAGA
// na conta da Careli. O que este arquivo trava é o dinheiro e a autoria:
//   • documento com dígito verificador errado não chega ao Serasa (CPF e, desde hoje, CNPJ);
//   • consulta repetida dentro da janela não é cobrada de novo, e no portal nem com `forcar`;
//   • no portal, a guardada só vale da MESMA ficha e do MESMO alvo, sai sem o relatório cru e deixa a
//     leitura na auditoria (senão o cônjuge editável virava um balcão de relatórios de terceiros);
//   • no portal, a consulta nova passa pelo freio de gasto e é reservada antes da chamada (autoria
//     garantida e clique concorrente sem cobrança dupla);
//   • leitura que falha antes de gastar é 503, nas duas portas;
//   • quem consultou pelo portal fica no registro da cobrança (`resumo.autor`);
//   • o hub continua igual na resposta de reaproveitamento sem `forcar` e no registro sem autor; com
//     `forcar` dentro da janela, só a coordenação cobra de novo (decisão do Lucas, 16/09/2026): o
//     analista recebe a guardada com o recado.

const m = vi.hoisted(() => ({
  analise: vi.fn(async () => true),
  atualizarEtapa: vi.fn(async (_client: unknown, _id: string, etapa: string) => ({
    error: null as null | string,
    etapa,
  })),
  avisarImob: vi.fn(async () => undefined),
  cad: vi.fn(async () => ({ enterprise_id: "39", etapa: "credito", ficha: null }) as unknown),
  comprovante: vi.fn(async () => ({ documentId: "doc-comprovante", ok: true }) as unknown),
  consultarPF: vi.fn(),
  consultarPJ: vi.fn(),
  gerarCad: vi.fn(async () => ({ ok: true })),
  limite: vi.fn(async () => 1000 as null | number),
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
  resolverLimiteCredito: m.limite,
  resolverPrevendaHabilitada: m.prevenda,
}));
vi.mock("@/lib/apolo/salvar-cad", () => ({
  comLimiteDeTempo: <T>(promessa: Promise<T>) => promessa,
  gerarESalvarCad: m.gerarCad,
}));
vi.mock("@/lib/serasa/comprovante", () => ({ gerarESalvarComprovante: m.comprovante }));
vi.mock("@/lib/apolo/disparo-imobiliaria", () => ({ avisarImobReprovado: m.avisarImob }));

import exemploPf from "./exemplo-resposta-pf.json";
import {
  type AutorDoCredito,
  consultarCredito,
  creditoDaCad,
  creditoReprovadoDaCad,
  FINALIDADE_CONJUGE,
  MARCA_DESISTIU,
  MARCA_EM_ANDAMENTO,
  MENSAGEM_INDISPONIVEL_NO_PORTAL,
  MENSAGEM_SO_COORDENACAO_FORCA,
  situacaoDoCredito,
  TETO_PORTAL_24H,
  TETO_USUARIO_PORTAL_24H,
} from "./consulta-servico";

const HUB_USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const USUARIO_PORTAL = "7b1d2c3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
const ENTIDADE = "11111111-2222-4333-8444-555555555555";

const HUB: AutorDoCredito = { nome: null, papel: "escrita", tipo: "hub", userId: HUB_USER };
const HUB_COORDENACAO: AutorDoCredito = { ...HUB, papel: "coordenacao" };
const PORTAL: AutorDoCredito = {
  incorporadorId: "inc-cecilio",
  nome: "Maria da Cecílio",
  slug: "cecilio-rocha",
  tipo: "portal",
  usuarioId: USUARIO_PORTAL,
};

const CPF_VALIDO = "529.982.247-25";
const CPF_INVALIDO = "529.982.247-24";
const CNPJ_INVALIDO = "11.222.333/0001-80";
const CNPJ_VALIDO = "11.222.333/0001-81";

type Linha = Record<string, unknown>;
type Filtro = { coluna: string; op: string; valor: unknown };

/** Uma ida ao banco, como o serviço a montou. */
type Pedido = {
  colunas: string;
  filtros: Filtro[];
  head: boolean;
  linha?: Linha;
  operacao: "insert" | "select" | "update";
  tabela: string;
};

type Estado = {
  /** Quantas vezes o update que FINALIZA a reserva falha antes de dar certo. */
  falhasAoFinalizar: number;
  /** A fila da concorrência (select "id, created_at"); por padrão, só a reserva deste pedido. */
  fila: Linha[] | null;
  disparos: Linha[];
  entidade: Linha | null;
  falhar: Partial<
    Record<"auditoria" | "contagemDoFreio" | "fila" | "insertSerasa" | "leitura", boolean>
  >;
  /** O `count` de cada contagem head (o freio do portal e o "hoje"). */
  contar: (pedido: Pedido) => number;
  documentos: Linha[];
  override: Linha | null;
  pedidos: Pedido[];
  recente: Linha | null;
  role: string;
};

function novoEstado(parcial: Partial<Estado> = {}): Estado {
  return {
    contar: () => 0,
    disparos: [{ telefone: "5511999999999", tipo: "coordenador" }],
    documentos: [],
    entidade: {
      display_name: "Cliente",
      document_masked: CPF_VALIDO,
      entity_kind: "pf",
      id: ENTIDADE,
      metadata: null,
    },
    falhar: {},
    falhasAoFinalizar: 0,
    fila: null,
    override: null,
    pedidos: [],
    recente: null,
    role: "admin",
    ...parcial,
  };
}

const filtro = (pedido: Pedido, coluna: string, op = "eq") =>
  pedido.filtros.find((f) => f.coluna === coluna && f.op === op)?.valor;

const falha = { message: "timeout" };

/** Um Supabase de mentira: responde por tabela e anota cada ida ao banco. */
function clienteFalso(estado: Estado) {
  return {
    from(tabela: string) {
      const pedido: Pedido = { colunas: "", filtros: [], head: false, operacao: "select", tabela };
      estado.pedidos.push(pedido);

      const resultado = (): Linha => {
        if (tabela === "serasa_consultas") {
          if (pedido.operacao === "insert") {
            if (estado.falhar.insertSerasa) return { data: null, error: falha };
            const reserva = pedido.linha?.erro === MARCA_EM_ANDAMENTO;
            return {
              data: {
                ambiente: pedido.linha?.ambiente,
                created_at: "2026-09-16T12:00:00.000Z",
                id: reserva ? "reserva-1" : "consulta-nova",
                resumo: pedido.linha?.resumo,
              },
              error: null,
            };
          }
          if (pedido.operacao === "update") {
            if (pedido.linha?.status && estado.falhasAoFinalizar > 0) {
              estado.falhasAoFinalizar -= 1;
              return { data: null, error: falha };
            }
            return {
              data: {
                ambiente: pedido.linha?.ambiente,
                created_at: "2026-09-16T12:00:00.000Z",
                id: filtro(pedido, "id"),
                resumo: pedido.linha?.resumo,
              },
              error: null,
            };
          }
          if (pedido.head) {
            // As contagens do freio filtram o ambiente; a do "hoje" (situacao) não.
            const doFreio = pedido.filtros.some((f) => f.coluna === "ambiente");
            return estado.falhar.contagemDoFreio && doFreio
              ? { count: null, data: null, error: falha }
              : { count: estado.contar(pedido), data: null, error: null };
          }
          if (pedido.colunas === "id, created_at") {
            if (estado.falhar.fila) return { data: null, error: falha };
            return { data: estado.fila ?? [{ id: "reserva-1" }], error: null };
          }
          return estado.falhar.leitura
            ? { data: null, error: falha }
            : { data: estado.recente, error: null };
        }
        if (tabela === "apolo_audit_events") {
          return { data: null, error: estado.falhar.auditoria ? falha : null };
        }
        if (tabela === "apolo_documents") {
          if (pedido.operacao === "update") {
            estado.documentos.push({ id: filtro(pedido, "id"), ...pedido.linha });
            return { data: null, error: null };
          }
          return { data: { metadata: { consultaId: "consulta-nova" } }, error: null };
        }
        if (tabela === "apolo_entities") return { data: estado.entidade, error: null };
        if (tabela === "hub_users") return { data: { role: estado.role }, error: null };
        if (tabela === "apolo_disparos") return { data: estado.disparos, error: null };
        if (tabela === "apolo_credito_overrides") return { data: estado.override, error: null };
        return { data: null, error: null };
      };

      const anotar = (op: string) => (coluna: string, valor: unknown) => {
        pedido.filtros.push({ coluna, op, valor });
        return cadeia;
      };

      const cadeia: Record<string, unknown> = {};
      Object.assign(cadeia, {
        eq: anotar("eq"),
        gte: anotar("gte"),
        in: anotar("in"),
        insert: (linha: Linha) => {
          pedido.operacao = "insert";
          pedido.linha = linha;
          return cadeia;
        },
        limit: () => cadeia,
        lt: anotar("lt"),
        maybeSingle: () => Promise.resolve(resultado()),
        neq: anotar("neq"),
        or: (expressao: string) => {
          pedido.filtros.push({ coluna: "*", op: "or", valor: expressao });
          return cadeia;
        },
        order: () => cadeia,
        select: (colunas?: string, opcoes?: { head?: boolean }) => {
          // O `select` depois de insert/update só escolhe o retorno.
          if (pedido.operacao === "select") pedido.colunas = colunas ?? "";
          if (opcoes?.head) pedido.head = true;
          return cadeia;
        },
        then: (ok: (valor: unknown) => unknown, erro?: (motivo: unknown) => unknown) =>
          Promise.resolve(resultado()).then(ok, erro),
        update: (valores: Linha) => {
          pedido.operacao = "update";
          pedido.linha = valores;
          return cadeia;
        },
      });
      return cadeia;
    },
  } as unknown as Parameters<typeof consultarCredito>[0]["client"];
}

const daTabela = (estado: Estado, tabela: string, operacao?: Pedido["operacao"]) =>
  estado.pedidos.filter((p) => p.tabela === tabela && (!operacao || p.operacao === operacao));

/** A leitura da consulta guardada (situacao), e não as contagens nem a fila. */
const leiturasDaGuardada = (estado: Estado) =>
  daTabela(estado, "serasa_consultas", "select").filter(
    (p) => !p.head && p.colunas.includes("resposta"),
  );

const consultaGuardada = (resposta: unknown = exemploPf): Linha => ({
  ambiente: "homologacao",
  created_at: "2026-09-10T15:00:00.000Z",
  id: "consulta-velha",
  report_name: "RELATORIO_BASICO_PF_PME",
  resposta,
  resumo: { score: 580 },
});

beforeAll(() => {
  vi.stubEnv("SERASA_AUTH_URL", "https://uat-api.serasaexperian.com.br/security/iam/v1/client-identities/login");
  vi.stubEnv("SERASA_CLIENT_ID", "id");
  vi.stubEnv("SERASA_CLIENT_SECRET", "segredo");
  vi.stubEnv("SERASA_PF_URL", "https://uat-api.serasaexperian.com.br/credit-services/person-information-report/v1/creditreport");
  vi.stubEnv("SERASA_PJ_URL", "https://uat-api.serasaexperian.com.br/credit-services/business-information-report/v1/reports");
  vi.stubEnv("SERASA_RETAILER_DOCUMENT_ID", "00000000000000");
  vi.stubEnv("SERASA_AMBIENTE", "homologacao");
  vi.stubEnv("SERASA_REPORT_PF", "");
  vi.stubEnv("SERASA_REPORT_PJ", "RELATORIO_BASICO_PJ");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  m.analise.mockImplementation(async () => true);
  m.limite.mockImplementation(async () => 1000);
  m.prevenda.mockImplementation(async () => false);
  m.cad.mockImplementation(async () => ({ enterprise_id: "39", etapa: "credito", ficha: null }));
  m.comprovante.mockImplementation(async () => ({ documentId: "doc-comprovante", ok: true }));
  m.atualizarEtapa.mockImplementation(async (_c: unknown, _id: string, etapa: string) => ({
    error: null,
    etapa,
  }));
  m.consultarPF.mockResolvedValue({ corpo: exemploPf, httpStatus: 200, ok: true, url: "pf" });
  m.consultarPJ.mockResolvedValue({ corpo: exemploPf, httpStatus: 200, ok: true, url: "pj" });
});

const pedido = (extra: Linha = {}) => ({
  confirmado: true,
  enterpriseId: "39",
  entityId: ENTIDADE,
  ...extra,
});

const dados = (r: { corpo: unknown }) => (r.corpo as { data: Linha }).data;
const erro = (r: { corpo: unknown }) => (r.corpo as { error: string }).error;

describe("antes de gastar: o dígito verificador", () => {
  for (const autor of [HUB, PORTAL]) {
    it(`CPF com dígito errado (${autor.tipo}): 412 e o Serasa NÃO é chamado`, async () => {
      const estado = novoEstado({
        entidade: { document_masked: CPF_INVALIDO, entity_kind: "pf", id: ENTIDADE },
      });
      const r = await consultarCredito({ autor, client: clienteFalso(estado), corpo: pedido() });

      expect(r.status).toBe(412);
      expect(erro(r)).toContain("CPF da ficha é inválido");
      expect(m.consultarPF).not.toHaveBeenCalled();
      expect(daTabela(estado, "serasa_consultas", "insert")).toHaveLength(0);
      expect(m.atualizarEtapa).not.toHaveBeenCalled();
    });
  }

  it("CNPJ com dígito errado: 412 e o Serasa NÃO é chamado (regra nova, nas duas portas)", async () => {
    for (const autor of [HUB, PORTAL]) {
      const estado = novoEstado({
        entidade: { document_masked: CNPJ_INVALIDO, entity_kind: "pj", id: ENTIDADE },
      });
      const r = await consultarCredito({ autor, client: clienteFalso(estado), corpo: pedido() });
      expect(r.status).toBe(412);
      expect(erro(r)).toContain("CNPJ da ficha é inválido");
    }
    expect(m.consultarPJ).not.toHaveBeenCalled();
  });

  it("sem confirmação, nem a ficha é lida", async () => {
    const estado = novoEstado();
    const r = await consultarCredito({
      autor: PORTAL,
      client: clienteFalso(estado),
      corpo: { entityId: ENTIDADE },
    });
    expect(r.status).toBe(428);
    expect(estado.pedidos).toHaveLength(0);
  });
});

describe("leitura que falha antes de gastar", () => {
  for (const autor of [HUB, PORTAL]) {
    it(`${autor.tipo}: a consulta guardada não foi lida -> 503, sem Serasa e sem registro`, async () => {
      const estado = novoEstado({ falhar: { leitura: true } });
      const r = await consultarCredito({ autor, client: clienteFalso(estado), corpo: pedido() });
      expect(r.status).toBe(503);
      expect(erro(r)).toContain("Nada foi consultado nem cobrado");
      expect(m.consultarPF).not.toHaveBeenCalled();
      expect(daTabela(estado, "serasa_consultas", "insert")).toHaveLength(0);
    });
  }
});

describe("consulta repetida não cobra", () => {
  it("hub sem forcar: a MESMA resposta de sempre, sem Serasa e sem mexer na etapa", async () => {
    const guardada = consultaGuardada();
    const estado = novoEstado({ recente: guardada });
    const r = await consultarCredito({ autor: HUB, client: clienteFalso(estado), corpo: pedido() });

    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({ data: { consultaAnterior: guardada, reaproveitada: true } });
    expect(m.consultarPF).not.toHaveBeenCalled();
    expect(m.atualizarEtapa).not.toHaveBeenCalled();
    // O hub não recorta a guardada por ambiente, ficha nem alvo (a tela interna mostra qualquer uma).
    const [leitura] = leiturasDaGuardada(estado);
    expect(leitura?.filtros.map((f) => f.coluna)).not.toContain("ambiente");
    expect(leitura?.filtros.map((f) => f.coluna)).not.toContain("entity_id");
  });

  // (16/09/2026, D9) No hub, só a coordenação força nova consulta dentro da janela. O papel é a porta
  // pela qual a rota passou (`papel`), e o serviço não lê `hub_users` para decidir.
  it("hub coordenação com forcar: cobra de novo, sem ler o papel", async () => {
    const estado = novoEstado({ recente: consultaGuardada() });
    const r = await consultarCredito({
      autor: HUB_COORDENACAO,
      client: clienteFalso(estado),
      corpo: pedido({ forcar: true }),
    });
    expect(r.status).toBe(200);
    expect(m.consultarPF).toHaveBeenCalledTimes(1);
    expect(dados(r).reaproveitada).toBe(false);
    expect(daTabela(estado, "hub_users")).toHaveLength(0);
  });

  it("hub analista (escrita) com forcar: NÃO cobra, recebe a guardada e o recado da coordenação", async () => {
    const guardada = consultaGuardada();
    const estado = novoEstado({ recente: guardada });
    const r = await consultarCredito({
      autor: HUB,
      client: clienteFalso(estado),
      corpo: pedido({ forcar: true }),
    });
    expect(r.status).toBe(200);
    expect(m.consultarPF).not.toHaveBeenCalled();
    expect(daTabela(estado, "serasa_consultas", "insert")).toHaveLength(0);
    expect(m.atualizarEtapa).not.toHaveBeenCalled();
    expect(r.corpo).toEqual({
      data: {
        consultaAnterior: guardada,
        forcarRecusado: true,
        mensagem: MENSAGEM_SO_COORDENACAO_FORCA,
        reaproveitada: true,
      },
    });
    expect(MENSAGEM_SO_COORDENACAO_FORCA).toBe(
      "Só a coordenação pode pedir uma nova consulta dentro de 30 dias.",
    );
    expect(daTabela(estado, "hub_users")).toHaveLength(0);
  });

  it("hub analista, cônjuge já consultado: o botão manda forcar e o resultado GUARDADO do cônjuge volta", async () => {
    m.cad.mockImplementation(async () => ({
      enterprise_id: "39",
      ficha: { conjugeCpf: "111.444.777-35" },
    }));
    const estado = novoEstado({ recente: consultaGuardada(), role: "operator" });
    const r = await consultarCredito({
      autor: HUB,
      client: clienteFalso(estado),
      corpo: pedido({ alvo: "conjuge", forcar: true }),
    });
    expect(m.consultarPF).not.toHaveBeenCalled();
    expect(dados(r).alvo).toBe("conjuge");
    expect(dados(r).veredito).toBeDefined();
    expect(dados(r).mensagem).toBe(MENSAGEM_SO_COORDENACAO_FORCA);
    // O cônjuge não mexe no titular: sem etapa na resposta, a tela não move o card.
    expect(dados(r).etapa).toBeUndefined();
    expect(m.atualizarEtapa).not.toHaveBeenCalled();
  });

  it("hub coordenação, cônjuge já consultado: cobra de novo e o resultado do cônjuge volta", async () => {
    m.cad.mockImplementation(async () => ({
      enterprise_id: "39",
      ficha: { conjugeCpf: "111.444.777-35" },
    }));
    const estado = novoEstado({ recente: consultaGuardada() });
    const r = await consultarCredito({
      autor: HUB_COORDENACAO,
      client: clienteFalso(estado),
      corpo: pedido({ alvo: "conjuge", forcar: true }),
    });
    expect(m.consultarPF).toHaveBeenCalledTimes(1);
    expect(dados(r).alvo).toBe("conjuge");
    expect(dados(r).veredito).toBeDefined();
  });

  it("portal com forcar: NÃO cobra, aplica o resultado na CAD, sem o relatório cru e com auditoria", async () => {
    const guardada = consultaGuardada();
    const estado = novoEstado({ recente: guardada });
    const r = await consultarCredito({
      autor: PORTAL,
      client: clienteFalso(estado),
      corpo: pedido({ forcar: true }),
    });

    expect(r.status).toBe(200);
    expect(m.consultarPF).not.toHaveBeenCalled();
    expect(daTabela(estado, "serasa_consultas", "insert")).toHaveLength(0);

    const data = dados(r);
    expect(data.reaproveitada).toBe(true);
    expect(data.forcarRecusado).toBe(true);
    // O relatório cru não sai pelo reaproveitamento: só o que identifica a consulta e o resumo.
    expect(data.consultaAnterior).toEqual({
      ambiente: "homologacao",
      created_at: guardada.created_at,
      id: "consulta-velha",
      report_name: "RELATORIO_BASICO_PF_PME",
      resumo: { score: 580 },
    });
    expect(data.alvo).toBe("titular");
    // O fixture tem R$ 5.499,77 de restrição: reprovado no limite de R$ 1.000.
    expect((data.veredito as { aprovado: boolean }).aprovado).toBe(false);
    expect(data.etapa).toBe("revisao");

    const auditoria = daTabela(estado, "apolo_audit_events", "insert")[0]?.linha;
    expect(auditoria).toMatchObject({
      action: "serasa_consulta_reaproveitada",
      actor_user_id: USUARIO_PORTAL,
      entity_id: ENTIDADE,
      metadata: expect.objectContaining({
        alvo: "titular",
        autorNome: "Maria da Cecílio",
        consultaId: "consulta-velha",
        origem: "portal-incorporador",
        slug: "cecilio-rocha",
      }),
    });

    expect(m.atualizarEtapa).toHaveBeenCalledTimes(1);
    const [, id, destino, opcoes] = m.atualizarEtapa.mock.calls[0] as unknown as [
      unknown,
      string,
      string,
      Record<string, unknown>,
    ];
    expect(id).toBe(ENTIDADE);
    expect(destino).toBe("revisao");
    expect(opcoes).toMatchObject({ atualizadoPor: USUARIO_PORTAL, automatico: true, enterpriseId: "39" });
  });

  it("portal: a guardada é recortada ao ambiente, à ficha e ao alvo (titular)", async () => {
    const estado = novoEstado({ recente: consultaGuardada() });
    await consultarCredito({ autor: PORTAL, client: clienteFalso(estado), corpo: pedido() });
    const [leitura] = leiturasDaGuardada(estado);
    expect(leitura?.filtros).toEqual(
      expect.arrayContaining([
        { coluna: "ambiente", op: "eq", valor: "homologacao" },
        { coluna: "entity_id", op: "eq", valor: ENTIDADE },
        { coluna: "finalidade", op: "neq", valor: FINALIDADE_CONJUGE },
        // (16/09/2026, revisão do conjunto) E ao AUTOR: a consulta da Careli na mesma ficha não conta.
        { coluna: "resumo->autor->>incorporadorId", op: "eq", valor: "inc-cecilio" },
      ]),
    );
  });

  it("hub: a guardada não é recortada ao autor (a Careli vê a casa inteira)", async () => {
    const estado = novoEstado({ recente: consultaGuardada() });
    await consultarCredito({ autor: HUB, client: clienteFalso(estado), corpo: pedido() });
    const [leitura] = leiturasDaGuardada(estado);
    expect(leitura?.filtros.some((f) => f.coluna === "resumo->autor->>incorporadorId")).toBe(false);
  });

  it("portal: sem conseguir registrar a leitura na auditoria, não entrega nem aplica (503)", async () => {
    const estado = novoEstado({ falhar: { auditoria: true }, recente: consultaGuardada() });
    const r = await consultarCredito({ autor: PORTAL, client: clienteFalso(estado), corpo: pedido() });
    expect(r.status).toBe(503);
    expect(m.atualizarEtapa).not.toHaveBeenCalled();
    expect(JSON.stringify(r.corpo)).not.toContain("consulta-velha");
  });

  it("portal: guardada sem relatório não é avaliada (somaria zero e aprovaria)", async () => {
    const estado = novoEstado({ recente: consultaGuardada(null) });
    const r = await consultarCredito({ autor: PORTAL, client: clienteFalso(estado), corpo: pedido() });
    expect(r.status).toBe(409);
    expect(m.consultarPF).not.toHaveBeenCalled();
    expect(m.atualizarEtapa).not.toHaveBeenCalled();
  });

  it("portal, cônjuge com guardada: recortada ao alvo cônjuge, devolve o veredito e NÃO mexe no titular", async () => {
    m.cad.mockImplementation(async () => ({
      enterprise_id: "39",
      ficha: { conjugeCpf: "111.444.777-35" },
    }));
    const estado = novoEstado({ recente: consultaGuardada() });
    const r = await consultarCredito({
      autor: PORTAL,
      client: clienteFalso(estado),
      corpo: pedido({ alvo: "conjuge", forcar: true }),
    });
    const data = dados(r);
    expect(data.alvo).toBe("conjuge");
    expect(data.etapa).toBeNull();
    expect(m.atualizarEtapa).not.toHaveBeenCalled();
    expect(m.consultarPF).not.toHaveBeenCalled();
    expect(leiturasDaGuardada(estado)[0]?.filtros).toEqual(
      expect.arrayContaining([
        { coluna: "documento", op: "eq", valor: "11144477735" },
        { coluna: "entity_id", op: "eq", valor: ENTIDADE },
        { coluna: "finalidade", op: "eq", valor: FINALIDADE_CONJUGE },
      ]),
    );
  });
});

describe("portal: o freio de gasto", () => {
  const consultar = (estado: Estado, extra: Linha = {}) =>
    consultarCredito({ autor: PORTAL, client: clienteFalso(estado), corpo: pedido(extra) });

  const contagemCom = (coluna: string, op = "eq") => (p: Pedido) =>
    p.filtros.some((f) => f.coluna === coluna && f.op === op);

  it("CAD que já pagou consulta de OUTRO documento do mesmo alvo na janela: 429, sem Serasa", async () => {
    const estado = novoEstado({ contar: (p) => (contagemCom("documento", "neq")(p) ? 1 : 0) });
    const r = await consultar(estado);
    expect(r.status).toBe(429);
    expect(erro(r)).toContain("feita pela Careli");
    expect(m.consultarPF).not.toHaveBeenCalled();
    expect(daTabela(estado, "serasa_consultas", "insert")).toHaveLength(0);

    const daCad = daTabela(estado, "serasa_consultas").find(contagemCom("documento", "neq"));
    expect(daCad?.filtros).toEqual(
      expect.arrayContaining([
        { coluna: "entity_id", op: "eq", valor: ENTIDADE },
        { coluna: "finalidade", op: "neq", valor: FINALIDADE_CONJUGE },
        { coluna: "*", op: "or", valor: `status.eq.sucesso,erro.eq.${MARCA_EM_ANDAMENTO}` },
      ]),
    );
  });

  it("o laço do cônjuge: outro CPF de cônjuge já consultado nesta CAD fecha a porta", async () => {
    m.cad.mockImplementation(async () => ({
      enterprise_id: "39",
      ficha: { conjugeCpf: "111.444.777-35" },
    }));
    const estado = novoEstado({ contar: (p) => (contagemCom("documento", "neq")(p) ? 1 : 0) });
    const r = await consultar(estado, { alvo: "conjuge" });
    expect(r.status).toBe(429);
    expect(erro(r)).toContain("cônjuge");
    expect(m.consultarPF).not.toHaveBeenCalled();
  });

  it("duas tentativas com erro do mesmo documento em 24 horas: 429", async () => {
    const estado = novoEstado({
      contar: (p) => (filtro(p, "status") === "erro" && filtro(p, "erro", "neq") === MARCA_DESISTIU ? 2 : 0),
    });
    const r = await consultar(estado);
    expect(r.status).toBe(429);
    expect(erro(r)).toContain("Peça à Careli");
    expect(m.consultarPF).not.toHaveBeenCalled();
  });

  it(`o portal no teto de ${TETO_PORTAL_24H} em 24 horas: 429`, async () => {
    const estado = novoEstado({
      contar: (p) => (filtro(p, "resumo->autor->>slug") === "cecilio-rocha" ? TETO_PORTAL_24H : 0),
    });
    const r = await consultar(estado);
    expect(r.status).toBe(429);
    expect(m.consultarPF).not.toHaveBeenCalled();
  });

  it(`a conta no teto de ${TETO_USUARIO_PORTAL_24H} em 24 horas: 429`, async () => {
    const estado = novoEstado({
      contar: (p) =>
        filtro(p, "resumo->autor->>usuarioId") === USUARIO_PORTAL ? TETO_USUARIO_PORTAL_24H : 0,
    });
    const r = await consultar(estado);
    expect(r.status).toBe(429);
    expect(m.consultarPF).not.toHaveBeenCalled();
  });

  // (16/09/2026, revisão do conjunto) ⚠️ A RAJADA. O freio contou 49 antes de cada um de 40 pedidos
  // simultâneos; a recontagem depois da reserva conta só o que foi gravado ANTES dela.
  it("rajada: o freio passou, mas a recontagem depois da reserva acha o teto: desiste sem chamar (429)", async () => {
    const estado = novoEstado({
      contar: (p) =>
        filtro(p, "resumo->autor->>slug") === "cecilio-rocha" && filtro(p, "created_at", "lt")
          ? TETO_PORTAL_24H
          : 0,
    });
    const r = await consultar(estado);
    expect(r.status).toBe(429);
    expect(m.consultarPF).not.toHaveBeenCalled();
    // A reserva existiu e virou "desistiu": não conta como possível cobrança.
    expect(daTabela(estado, "serasa_consultas", "update").map((p) => p.linha?.erro)).toContain(MARCA_DESISTIU);
  });

  it("rajada, conta: a recontagem da conta também segura", async () => {
    const estado = novoEstado({
      contar: (p) =>
        filtro(p, "resumo->autor->>usuarioId") === USUARIO_PORTAL && filtro(p, "created_at", "lt")
          ? TETO_USUARIO_PORTAL_24H
          : 0,
    });
    const r = await consultar(estado);
    expect(r.status).toBe(429);
    expect(m.consultarPF).not.toHaveBeenCalled();
  });

  it("contagem do freio que falha: 503, nunca 'pode'", async () => {
    const estado = novoEstado({ falhar: { contagemDoFreio: true } });
    const r = await consultarCredito({ autor: PORTAL, client: clienteFalso(estado), corpo: pedido() });
    expect(r.status).toBe(503);
    expect(erro(r)).toContain("Nada foi consultado nem cobrado");
    expect(m.consultarPF).not.toHaveBeenCalled();
    expect(daTabela(estado, "serasa_consultas", "insert")).toHaveLength(0);
  });

  it("o hub não passa pelo freio", async () => {
    // Toda contagem do freio estourada (as que filtram ambiente); a do teto de homologação, não.
    const estado = novoEstado({
      contar: (p) => (p.filtros.some((f) => f.coluna === "ambiente") ? 999 : 0),
    });
    const r = await consultarCredito({ autor: HUB, client: clienteFalso(estado), corpo: pedido() });
    expect(r.status).toBe(200);
    expect(m.consultarPF).toHaveBeenCalledTimes(1);
  });
});

describe("portal: a reserva antes da chamada", () => {
  it("grava a linha com o autor ANTES do Serasa e a transforma no registro (sem segundo insert)", async () => {
    const estado = novoEstado();
    m.consultarPF.mockImplementation(async () => {
      // No instante da chamada, a reserva já existe.
      const reservas = daTabela(estado, "serasa_consultas", "insert");
      expect(reservas).toHaveLength(1);
      expect(reservas[0]?.linha).toMatchObject({
        documento: "52998224725",
        entity_id: ENTIDADE,
        erro: MARCA_EM_ANDAMENTO,
        resumo: { autor: expect.objectContaining({ slug: "cecilio-rocha" }) },
        solicitado_por: USUARIO_PORTAL,
        status: "erro",
      });
      return { corpo: exemploPf, httpStatus: 200, ok: true, url: "pf" };
    });

    const r = await consultarCredito({ autor: PORTAL, client: clienteFalso(estado), corpo: pedido() });
    expect(r.status).toBe(200);
    expect(m.consultarPF).toHaveBeenCalledTimes(1);
    expect(daTabela(estado, "serasa_consultas", "insert")).toHaveLength(1);

    const final = daTabela(estado, "serasa_consultas", "update").find((p) => p.linha?.status);
    expect(filtro(final!, "id")).toBe("reserva-1");
    expect(final?.linha).toMatchObject({ erro: null, http_status: 200, status: "sucesso" });
    expect((dados(r).consulta as Linha).id).toBe("reserva-1");
    expect(dados(r)).not.toHaveProperty("registroNaoGravado");
  });

  it("outra reserva viva do mesmo documento chegou antes: desiste sem chamar o Serasa (409)", async () => {
    const estado = novoEstado({ fila: [{ id: "reserva-de-outra-aba" }] });
    const r = await consultarCredito({ autor: PORTAL, client: clienteFalso(estado), corpo: pedido() });
    expect(r.status).toBe(409);
    expect(erro(r)).toContain("em andamento");
    expect(m.consultarPF).not.toHaveBeenCalled();

    const desistencia = daTabela(estado, "serasa_consultas", "update")[0];
    expect(desistencia?.linha).toEqual({ erro: MARCA_DESISTIU });
    expect(filtro(desistencia!, "id")).toBe("reserva-1");

    const fila = daTabela(estado, "serasa_consultas", "select").find((p) => p.colunas === "id, created_at");
    expect(fila?.filtros).toEqual(
      expect.arrayContaining([
        { coluna: "documento", op: "eq", valor: "52998224725" },
        { coluna: "entity_id", op: "eq", valor: ENTIDADE },
        { coluna: "*", op: "or", valor: `status.eq.sucesso,erro.eq.${MARCA_EM_ANDAMENTO}` },
      ]),
    );
  });

  it("a reserva não gravou: 503 sem chamar", async () => {
    const estado = novoEstado({ falhar: { insertSerasa: true } });
    const r = await consultarCredito({ autor: PORTAL, client: clienteFalso(estado), corpo: pedido() });
    expect(r.status).toBe(503);
    expect(m.consultarPF).not.toHaveBeenCalled();
  });

  it("a fila não foi lida: desiste e responde 503 sem chamar", async () => {
    const estado = novoEstado({ falhar: { fila: true } });
    const r = await consultarCredito({ autor: PORTAL, client: clienteFalso(estado), corpo: pedido() });
    expect(r.status).toBe(503);
    expect(m.consultarPF).not.toHaveBeenCalled();
    expect(daTabela(estado, "serasa_consultas", "update")[0]?.linha).toEqual({ erro: MARCA_DESISTIU });
  });

  it("o registro final falha uma vez: tenta de novo e segue normal", async () => {
    const estado = novoEstado({ falhasAoFinalizar: 1 });
    const r = await consultarCredito({ autor: PORTAL, client: clienteFalso(estado), corpo: pedido() });
    expect(r.status).toBe(200);
    expect(dados(r)).not.toHaveProperty("registroNaoGravado");
    expect(daTabela(estado, "serasa_consultas", "update").filter((p) => p.linha?.status)).toHaveLength(2);
  });

  it("o registro final falha de vez: log, aviso na tela e nada de comprovante", async () => {
    const estado = novoEstado({ falhasAoFinalizar: 2 });
    const r = await consultarCredito({ autor: PORTAL, client: clienteFalso(estado), corpo: pedido() });
    expect(r.status).toBe(200);
    expect(dados(r).registroNaoGravado).toBe(true);
    expect(dados(r).mensagem).toContain("Avise a Careli");
    expect(console.error).toHaveBeenCalled();
    expect(m.comprovante).not.toHaveBeenCalled();
  });
});

describe("o registro da cobrança", () => {
  it("portal: grava QUEM consultou em resumo.autor e usa o relatório do servidor", async () => {
    const estado = novoEstado();
    const r = await consultarCredito({
      autor: PORTAL,
      client: clienteFalso(estado),
      corpo: pedido({
        finalidade: "outra",
        optionalFeatures: ["OPCIONAL_CARO"],
        reportName: "RELATORIO_COMPLETO_CARO",
      }),
    });
    expect(r.status).toBe(200);

    const [, entrada] = m.consultarPF.mock.calls[0] as unknown as [unknown, Linha];
    expect(entrada).toMatchObject({ optionalFeatures: [], reportName: "RELATORIO_BASICO_PF_PME" });

    const registro = daTabela(estado, "serasa_consultas", "update").find((p) => p.linha?.status)?.linha;
    expect(registro).toMatchObject({
      finalidade: "analise-credito-cad",
      optional_features: [],
      report_name: "RELATORIO_BASICO_PF_PME",
      solicitado_por: USUARIO_PORTAL,
    });
    expect((registro?.resumo as Linha).autor).toEqual({
      incorporadorId: "inc-cecilio",
      nome: "Maria da Cecílio",
      origem: "portal-incorporador",
      slug: "cecilio-rocha",
      usuarioId: USUARIO_PORTAL,
    });

    // O veredito congelado não apaga o autor.
    const carimbo = daTabela(estado, "serasa_consultas", "update").find(
      (p) => !p.linha?.status && p.linha?.resumo,
    )?.linha;
    expect((carimbo?.resumo as Linha).autor).toBeDefined();
    expect((carimbo?.resumo as Linha).veredito).toBeDefined();
  });

  // (16/09/2026) A marca vai NA gravação do comprovante (`metadataExtra`), e não num update depois:
  // o update deixava o comprovante sem dono quando falhava.
  it("portal: o comprovante nasce marcado com o empreendimento da CAD, na mesma gravação", async () => {
    const estado = novoEstado();
    const client = clienteFalso(estado);
    await consultarCredito({ autor: PORTAL, client, corpo: pedido() });
    expect(m.comprovante).toHaveBeenCalledTimes(1);
    expect(m.comprovante).toHaveBeenCalledWith(client, "reserva-1", {
      metadataExtra: { enterpriseId: "39" },
      uploadedByName: "Análise de crédito",
    });
    expect(estado.documentos).toHaveLength(0);
  });

  it("portal sem empreendimento no corpo: a marca sai da CAD lida no servidor", async () => {
    m.cad.mockImplementation(async () => ({ enterprise_id: "41", etapa: "credito", ficha: null }));
    const estado = novoEstado();
    await consultarCredito({
      autor: PORTAL,
      client: clienteFalso(estado),
      corpo: pedido({ enterpriseId: undefined }),
    });
    expect(m.comprovante).toHaveBeenCalledWith(expect.anything(), expect.any(String), {
      metadataExtra: { enterpriseId: "41" },
      uploadedByName: "Análise de crédito",
    });
  });

  it("hub: o registro de sempre, sem autor no resumo, sem reserva e com o override da tela", async () => {
    const estado = novoEstado();
    const r = await consultarCredito({
      autor: HUB,
      client: clienteFalso(estado),
      corpo: pedido({ reportName: "RELATORIO_DA_TELA" }),
    });
    const inserts = daTabela(estado, "serasa_consultas", "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.linha).toMatchObject({
      report_name: "RELATORIO_DA_TELA",
      solicitado_por: HUB_USER,
      status: "sucesso",
    });
    expect((inserts[0]?.linha?.resumo as Linha).autor).toBeUndefined();
    // O comprovante do hub não ganha marca (mudaria o que o comercial vê).
    expect(estado.documentos).toHaveLength(0);
    expect((m.comprovante.mock.calls[0] as unknown[] | undefined)?.[2]).toEqual({
      uploadedByName: "Análise de crédito",
    });
    expect(Object.keys(dados(r)).sort()).toEqual(
      ["alvo", "consulta", "disparo", "etapa", "etapaNaoGravada", "reaproveitada", "veredito"].sort(),
    );
  });

  it("hub: o insert que falha não é mais descartado em silêncio", async () => {
    const estado = novoEstado({ falhar: { insertSerasa: true } });
    const r = await consultarCredito({ autor: HUB, client: clienteFalso(estado), corpo: pedido() });
    expect(r.status).toBe(200);
    expect(dados(r).registroNaoGravado).toBe(true);
    expect(console.error).toHaveBeenCalled();
    // Uma tentativa só: um insert que gravou e respondeu erro duplicaria a linha da cobrança.
    expect(daTabela(estado, "serasa_consultas", "insert")).toHaveLength(1);
  });

  it("erro do Serasa: o hub devolve o erro cru e o status; o portal, a frase e 502", async () => {
    const falhou = { erro: "Sem permissao (403). O relatorio pode nao estar no contrato.", httpStatus: 403, ok: false, url: "pf" };

    m.consultarPF.mockResolvedValue(falhou);
    const hub = await consultarCredito({ autor: HUB, client: clienteFalso(novoEstado()), corpo: pedido() });
    expect(hub.status).toBe(403);
    expect(hub.corpo).toEqual({ error: falhou.erro, registroId: "consulta-nova" });

    const estado = novoEstado();
    const portal = await consultarCredito({ autor: PORTAL, client: clienteFalso(estado), corpo: pedido() });
    expect(portal.status).toBe(502);
    expect(erro(portal)).not.toContain("contrato");
    expect(erro(portal)).toContain("fale com a Careli");
    expect((portal.corpo as Linha).registroId).toBe("reserva-1");
    const final = daTabela(estado, "serasa_consultas", "update").find((p) => p.linha?.status);
    expect(final?.linha).toMatchObject({ erro: falhou.erro, http_status: 403, status: "erro" });
  });
});

describe("portal: mensagens sem configuração interna", () => {
  it("relatório PJ sem nome: a frase curta, sem a variável de ambiente (o hub segue explicando)", async () => {
    vi.stubEnv("SERASA_REPORT_PJ", "");
    try {
      const pj = { document_masked: CNPJ_VALIDO, entity_kind: "pj", id: ENTIDADE };
      const portal = await consultarCredito({
        autor: PORTAL,
        client: clienteFalso(novoEstado({ entidade: pj })),
        corpo: pedido(),
      });
      expect(portal.status).toBe(412);
      expect(erro(portal)).toBe(MENSAGEM_INDISPONIVEL_NO_PORTAL);

      const hub = await consultarCredito({
        autor: HUB,
        client: clienteFalso(novoEstado({ entidade: pj })),
        corpo: pedido(),
      });
      expect(erro(hub)).toContain("SERASA_REPORT_PJ");
    } finally {
      vi.stubEnv("SERASA_REPORT_PJ", "RELATORIO_BASICO_PJ");
    }
  });

  it("integração sem configuração: 503 com a frase curta no portal", async () => {
    vi.stubEnv("SERASA_CLIENT_ID", "");
    try {
      const r = await consultarCredito({ autor: PORTAL, client: clienteFalso(novoEstado()), corpo: pedido() });
      expect(r.status).toBe(503);
      expect(erro(r)).toBe(MENSAGEM_INDISPONIVEL_NO_PORTAL);

      const painel = await situacaoDoCredito({
        autor: PORTAL,
        client: clienteFalso(novoEstado()),
        enterpriseId: "39",
        entityId: ENTIDADE,
      });
      expect(dados(painel)).toEqual({ configurado: false, faltando: [] });
    } finally {
      vi.stubEnv("SERASA_CLIENT_ID", "id");
    }
  });
});

describe("situacaoDoCredito (o painel, custo zero)", () => {
  it("portal: sem selo de admin, sem disparos e com a guardada recortada à ficha e ao titular", async () => {
    const estado = novoEstado();
    const r = await situacaoDoCredito({
      autor: PORTAL,
      client: clienteFalso(estado),
      enterpriseId: "39",
      entityId: ENTIDADE,
    });
    const data = dados(r);
    expect(data.ehAdmin).toBe(false);
    expect(data.disparos).toEqual([]);
    expect(daTabela(estado, "hub_users")).toHaveLength(0);
    expect(daTabela(estado, "apolo_disparos")).toHaveLength(0);
    expect(r.headers).toEqual({ "Cache-Control": "no-store" });
    expect(leiturasDaGuardada(estado)[0]?.filtros).toEqual(
      expect.arrayContaining([
        { coluna: "entity_id", op: "eq", valor: ENTIDADE },
        { coluna: "finalidade", op: "neq", valor: FINALIDADE_CONJUGE },
        { coluna: "resumo->autor->>incorporadorId", op: "eq", valor: "inc-cecilio" },
      ]),
    );
  });

  it("leitura que falha: 503 no portal; no hub, o painel de sempre sem consulta", async () => {
    const portal = await situacaoDoCredito({
      autor: PORTAL,
      client: clienteFalso(novoEstado({ falhar: { leitura: true } })),
      enterpriseId: "39",
      entityId: ENTIDADE,
    });
    expect(portal.status).toBe(503);

    const hub = await situacaoDoCredito({
      autor: HUB,
      client: clienteFalso(novoEstado({ falhar: { leitura: true } })),
      enterpriseId: null,
      entityId: ENTIDADE,
    });
    expect(hub.status).toBe(200);
    expect(dados(hub).ultimaConsulta).toBeNull();
  });

  it("hub: admin e disparos como sempre", async () => {
    const estado = novoEstado();
    const r = await situacaoDoCredito({
      autor: HUB,
      client: clienteFalso(estado),
      enterpriseId: null,
      entityId: ENTIDADE,
    });
    const data = dados(r);
    expect(data.ehAdmin).toBe(true);
    expect(data.disparos).toEqual(estado.disparos);
  });
});

describe("creditoDaCad (a régua da etapa de decisão)", () => {
  const perguntar = (estado: Estado, etapaAtual: null | string = "credito") =>
    creditoDaCad({ client: clienteFalso(estado), enterpriseId: "39", entityId: ENTIDADE, etapaAtual });

  it("CAD que já passou pelo crédito (pré-venda/credenciado): aprovado pela etapa", async () => {
    expect(await perguntar(novoEstado(), "prevenda")).toEqual({ aprovado: true, fonte: "etapa" });
  });

  it("sem consulta nem override: não aprovado", async () => {
    expect(await perguntar(novoEstado())).toEqual({ aprovado: false, fonte: "sem-decisao" });
  });

  it("só conta a consulta do titular DESTA ficha", async () => {
    const estado = novoEstado();
    await perguntar(estado);
    expect(leiturasDaGuardada(estado)[0]?.filtros).toEqual(
      expect.arrayContaining([
        { coluna: "entity_id", op: "eq", valor: ENTIDADE },
        { coluna: "finalidade", op: "neq", valor: FINALIDADE_CONJUGE },
      ]),
    );
  });

  it("com o portal que decide, só a consulta DELE conta", async () => {
    const estado = novoEstado();
    await creditoDaCad({
      client: clienteFalso(estado),
      enterpriseId: "39",
      entityId: ENTIDADE,
      etapaAtual: "credito",
      incorporadorId: "inc-cecilio",
    });
    expect(leiturasDaGuardada(estado)[0]?.filtros).toContainEqual({
      coluna: "resumo->autor->>incorporadorId",
      op: "eq",
      valor: "inc-cecilio",
    });
  });

  it("consulta reprovada no limite do empreendimento: não aprovado", async () => {
    expect(await perguntar(novoEstado({ recente: consultaGuardada() }))).toEqual({
      aprovado: false,
      fonte: "consulta",
    });
  });

  it("consulta aprovada no limite do empreendimento: aprovado", async () => {
    m.limite.mockImplementation(async () => 10_000);
    expect(await perguntar(novoEstado({ recente: consultaGuardada() }))).toEqual({
      aprovado: true,
      fonte: "consulta",
    });
  });

  it("override MAIS NOVO que a consulta reprovada: aprovado; mais velho: vale a consulta", async () => {
    const novo = novoEstado({
      override: { created_at: "2026-09-12T10:00:00.000Z" },
      recente: consultaGuardada(),
    });
    expect(await perguntar(novo)).toEqual({ aprovado: true, fonte: "override" });

    const velho = novoEstado({
      override: { created_at: "2026-09-01T10:00:00.000Z" },
      recente: consultaGuardada(),
    });
    expect(await perguntar(velho)).toEqual({ aprovado: false, fonte: "consulta" });
  });

  it("a leitura da consulta falha: LANÇA, e o override antigo não vence por falta de leitura", async () => {
    const estado = novoEstado({
      falhar: { leitura: true },
      override: { created_at: "2026-08-01T10:00:00.000Z" },
    });
    await expect(perguntar(estado)).rejects.toThrow();
  });

  it("Serasa sem configuração: LANÇA (sem ambiente, homologação contaria como aprovação)", async () => {
    vi.stubEnv("SERASA_CLIENT_ID", "");
    try {
      await expect(perguntar(novoEstado({ recente: consultaGuardada() }))).rejects.toThrow();
    } finally {
      vi.stubEnv("SERASA_CLIENT_ID", "id");
    }
  });

  it("análise desligada: aprova só com documento válido", async () => {
    m.analise.mockImplementation(async () => false);
    expect(await perguntar(novoEstado())).toEqual({ aprovado: true, fonte: "analise-desligada" });
    expect(
      await perguntar(
        novoEstado({ entidade: { document_masked: CPF_INVALIDO, entity_kind: "pf", id: ENTIDADE } }),
      ),
    ).toEqual({ aprovado: false, fonte: "sem-decisao" });
  });
});

describe("creditoReprovadoDaCad (a prova da aprovação com restrição no portal)", () => {
  const perguntar = (estado: Estado) =>
    creditoReprovadoDaCad({ client: clienteFalso(estado), enterpriseId: "39", entityId: ENTIDADE });

  it("consulta do titular reprovada na janela: sim", async () => {
    const estado = novoEstado({ recente: consultaGuardada() });
    expect(await perguntar(estado)).toBe(true);
    expect(leiturasDaGuardada(estado)[0]?.filtros).toEqual(
      expect.arrayContaining([
        { coluna: "ambiente", op: "eq", valor: "homologacao" },
        { coluna: "entity_id", op: "eq", valor: ENTIDADE },
        { coluna: "finalidade", op: "neq", valor: FINALIDADE_CONJUGE },
      ]),
    );
  });

  it("sem consulta, com consulta aprovada ou sem relatório: não", async () => {
    expect(await perguntar(novoEstado())).toBe(false);
    expect(await perguntar(novoEstado({ recente: consultaGuardada(null) }))).toBe(false);
    m.limite.mockImplementation(async () => 10_000);
    expect(await perguntar(novoEstado({ recente: consultaGuardada() }))).toBe(false);
  });

  it("leitura que falha: LANÇA", async () => {
    await expect(perguntar(novoEstado({ falhar: { leitura: true } }))).rejects.toThrow();
  });
});
