import { beforeEach, describe, expect, it, vi } from "vitest";

// AS ROTAS DO GRUPO TRABALHO DA TÊMIS — a do hub e o espelho do portal, lado a lado.
//
// O que está travado aqui, verbo por verbo:
//   • PORTAL FORA DO ESCOPO É 404, e o dado nem sai do banco (a tabela do dado não é consultada, a
//     função que grava não é chamada): card da Careli, card de outro incorporador, card dele fora da
//     sessão, proposta sem trabalho dele, empreendimento fora da sessão;
//   • PORTAL DENTRO DO ESCOPO FUNCIONA, com o usuário do portal como autor;
//   • O HUB NÃO MUDOU: sem consulta de dono, mesmas portas (leitura e coordenação), mesma resposta;
//   • o comprovante do Serasa não sai pelo portal, nem na lista nem pelo `?abrir=`.
//
// O Supabase é falso e ANOTA cada consulta (tabela, filtros, insert, update). As portas (hub e
// portal) e as funções de dados de outras camadas são mockadas: o teste é do recorte, não delas.

type Chamada = {
  filtros: unknown[][];
  insert?: Record<string, unknown>;
  tabela: string;
  update?: Record<string, unknown>;
};
type Resposta = { data: unknown; error: unknown };

const CECILIO = "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6";
const OUTRO = "11111111-2222-4333-8444-555555555555";

const estado = vi.hoisted(() => ({
  assinados: [] as string[],
  chamadas: [] as Array<{
    filtros: unknown[][];
    insert?: Record<string, unknown>;
    tabela: string;
    update?: Record<string, unknown>;
  }>,
  documentos: [] as Array<Record<string, unknown>>,
  donos: {} as Record<string, { enterprise_id: string; operado_por: null | string }>,
  hubCoordenacao: true,
  hubLeitura: true,
  leiturasDoCadastro: 0,
  portal: "ok" as "comercial" | "ok" | "sem-sessao",
  produtos: [] as Array<{ c2x: string; operadoPor: null | string; pai?: string }>,
  responder: (() => ({ data: [], error: null })) as (c: {
    filtros: unknown[][];
    tabela: string;
  }) => { data: unknown; error: unknown },
}));

const mocks = vi.hoisted(() => ({
  abrirTrabalho: vi.fn(async () => ({ id: "t-novo", ok: true as const })),
  concluirCancelamentoDoCard: vi.fn(
    async (): Promise<
      | { erro: string; ok: false; status: 409 }
      | {
          avisos: string[];
          cardConcluido: boolean;
          codigo: null | string;
          contratosIndeferidos: string[];
          envelopeCancelado: null | string;
          jaEstavaDesfeita: boolean;
          ok: true;
          recado: string;
          tipo: "cancelamento" | "distrato";
          unidade: { frase: string; voltou: boolean };
        }
    > => ({
      avisos: [],
      cardConcluido: true,
      codigo: "000021",
      contratosIndeferidos: [],
      envelopeCancelado: null,
      jaEstavaDesfeita: false,
      ok: true,
      recado: "Cancelamento concluído: a venda COD 000021 foi cancelada e a unidade voltou para a disponibilidade.",
      tipo: "cancelamento",
      unidade: { frase: "a unidade voltou para a disponibilidade", voltou: true },
    }),
  ),
  devolverVendaNoIndeferimento: vi.fn(async () => ({
    aviso: null,
    feito: "nada" as const,
    recado: null as null | string,
  })),
  marcarAtividade: vi.fn(async () => ({ andou: false, estagio: "analise", ok: true as const })),
  registrarPassagemDeEtapa: vi.fn(async () => undefined),
  retornarParaAnalise: vi.fn(async () => ({
    de: "contrato",
    envelopeCancelado: null,
    ok: true as const,
  })),
  trabalhosDoBoard: vi.fn(async () => []),
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({
    from: (tabela: string) => {
      const chamada: Chamada = { filtros: [], tabela };
      estado.chamadas.push(chamada);
      const q: Record<string, unknown> = {};
      for (const metodo of [
        "eq",
        "in",
        "is",
        "limit",
        "maybeSingle",
        "neq",
        "order",
        "range",
        "returns",
        "select",
        "single",
      ]) {
        q[metodo] = (...args: unknown[]) => {
          chamada.filtros.push([metodo, ...args]);
          return q;
        };
      }
      q.insert = (valores: Record<string, unknown>) => {
        chamada.insert = valores;
        return q;
      };
      q.update = (valores: Record<string, unknown>) => {
        chamada.update = valores;
        return q;
      };
      q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => estado.responder(chamada))
          .then(ok, falha);
      return q;
    },
    storage: {
      from: () => ({
        createSignedUrl: async (caminho: string) => {
          estado.assinados.push(caminho);
          return { data: { signedUrl: `https://assinado/${caminho}` }, error: null };
        },
      }),
    },
  }),
}));

vi.mock("@/lib/apolo/auth", async () => {
  const { NextResponse } = await import("next/server");
  return {
    authorizeApoloRead: async () =>
      estado.hubLeitura
        ? { nome: "Jurídico", ok: true, userId: "user-hub" }
        : { ok: false, response: NextResponse.json({ error: "x" }, { status: 401 }) },
  };
});

vi.mock("@/lib/temis/autorizacao", async () => {
  const { NextResponse } = await import("next/server");
  return {
    autorizarEmissaoDeContrato: async () =>
      estado.hubCoordenacao
        ? { nome: "Jurídico", ok: true, userId: "user-hub" }
        : { ok: false, response: NextResponse.json({ error: "x" }, { status: 403 }) },
    autorizarLeituraDeContrato: async () =>
      estado.hubLeitura
        ? { nome: "Jurídico", ok: true, userId: "user-hub" }
        : { ok: false, response: NextResponse.json({ error: "x" }, { status: 401 }) },
  };
});

vi.mock("@/lib/temis/portao-do-portal", async () => {
  const { NextResponse } = await import("next/server");
  return {
    autorizarTemisDoPortal: async () => {
      if (estado.portal === "sem-sessao") {
        return {
          ok: false,
          response: NextResponse.json({ error: "Sessao expirada." }, { status: 401 }),
        };
      }
      if (estado.portal === "comercial") {
        return {
          ok: false,
          response: NextResponse.json({ error: "Nao encontrado." }, { status: 404 }),
        };
      }
      return {
        ator: {
          enterpriseIds: ["37", "group:Lagoa Bonita", "33", "27", "32"],
          incorporadorId: CECILIO,
          nome: "Maria do Jurídico",
          slug: "cecilio-rocha",
          tipo: "portal",
          usuarioId: "usuario-portal-1",
        },
        ok: true,
        sessao: {},
      };
    },
  };
});

vi.mock("@/lib/temis/trabalhos-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/temis/trabalhos-db")>()),
  abrirTrabalho: mocks.abrirTrabalho,
  donoDoTrabalho: vi.fn(async (id: string) => estado.donos[id] ?? null),
  marcarAtividade: mocks.marcarAtividade,
  trabalhosDoBoard: mocks.trabalhosDoBoard,
}));

vi.mock("@/lib/temis/retorno-para-correcao", () => ({
  retornarParaAnalise: mocks.retornarParaAnalise,
}));

vi.mock("@/lib/temis/passagem-de-etapa-db", () => ({
  registrarPassagemDeEtapa: mocks.registrarPassagemDeEtapa,
}));

// A conclusão e o efeito do indeferimento na venda têm teste próprio, contra banco em memória
// (`lib/hercules/concluir-cancelamento-server.test.ts`, `indeferimento-na-venda-server.test.ts`).
// Aqui o teste é da PORTA: quem pode chamar, com que autor, e o que a resposta leva.
vi.mock("@/lib/hercules/concluir-cancelamento-server", () => ({
  concluirCancelamentoDoCard: mocks.concluirCancelamentoDoCard,
}));

vi.mock("@/lib/hercules/indeferimento-na-venda-server", () => ({
  devolverVendaNoIndeferimento: mocks.devolverVendaNoIndeferimento,
}));

vi.mock("@/lib/temis/analise-do-trabalho", () => ({
  analiseDoTrabalho: async () => null,
}));

vi.mock("@/lib/temis/contrato-guardado-db", () => ({
  contratosDaProposta: async () => [],
  contratosDasPropostas: async () => new Map(),
}));

vi.mock("@/lib/assinatura/diario-do-envelope-db", () => ({
  diarioDaProposta: async () => null,
}));

vi.mock("@/lib/hercules/cadastro", async () => {
  const { cadastroDosProdutos } = await import("@/lib/temis/fixtures/produtos-operados");
  return {
    carregarCadastroDeEmpreendimentos: vi.fn(async () => [{ codigo: "VOC", nome: "Vale do Ouro" }]),
    // A régua de quem opera o produto (`escritaNoProduto`) lê o cadastro por aqui. Só a leitura é
    // trocada; a régua é a de verdade.
    lerCadastroDeEmpreendimentos: vi.fn(async () => {
      estado.leiturasDoCadastro += 1;
      return { com0170: true, linhas: cadastroDosProdutos(estado.produtos) };
    }),
  };
});

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [
    { codes: ["VOC", "VOL"], id: "group:Vale do Ouro", name: "VALE DO OURO", stageIds: ["37", "36"] },
  ],
}));

vi.mock("@/lib/apolo/documentos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/documentos")>()),
  listApoloDocuments: vi.fn(async () => estado.documentos),
}));

import * as portalBoard from "@/app/api/incorporador/temis/board/route";
import * as portalEmpreendimentos from "@/app/api/incorporador/temis/empreendimentos/route";
import * as portalTrabalho from "@/app/api/incorporador/temis/trabalho/route";
import * as portalConversa from "@/app/api/incorporador/temis/trabalho/conversa/route";
import * as portalDocumentos from "@/app/api/incorporador/temis/trabalho/documentos/route";
import * as portalHistorico from "@/app/api/incorporador/temis/trabalho/historico/route";
import * as portalTrabalhos from "@/app/api/incorporador/temis/trabalhos/route";
import * as hubBoard from "@/app/api/temis/board/route";
import * as hubEmpreendimentos from "@/app/api/temis/empreendimentos/route";
import * as hubTrabalho from "@/app/api/temis/trabalho/route";
import * as hubConversa from "@/app/api/temis/trabalho/conversa/route";
import * as hubDocumentos from "@/app/api/temis/trabalho/documentos/route";
import * as hubHistorico from "@/app/api/temis/trabalho/historico/route";
import * as hubTrabalhos from "@/app/api/temis/trabalhos/route";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";
import {
  PRODUTOS_DE_16_DE_SETEMBRO,
  TUDO_DA_CECILIO,
} from "@/lib/temis/fixtures/produtos-operados";
import { donoDoTrabalho } from "@/lib/temis/trabalhos-db";

// ── APOIO ───────────────────────────────────────────────────────────────────

function get(caminho: string): Request {
  return new Request(`https://c2x.app.br${caminho}`);
}

function post(caminho: string, corpo: unknown): Request {
  return new Request(`https://c2x.app.br${caminho}`, {
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function consultasA(tabela: string): Chamada[] {
  return estado.chamadas.filter((c) => c.tabela === tabela);
}

function temFiltro(chamada: Chamada | undefined, ...filtro: unknown[]): boolean {
  return Boolean(
    chamada?.filtros.some((f) => JSON.stringify(f) === JSON.stringify(filtro)),
  );
}

function valorDoFiltro(chamada: Chamada, metodo: string, coluna: string): unknown {
  return chamada.filtros.find((f) => f[0] === metodo && f[1] === coluna)?.[2];
}

function selecionou(chamada: Chamada, trecho: string): boolean {
  return chamada.filtros.some((f) => f[0] === "select" && String(f[1]).includes(trecho));
}

/** As propostas que têm trabalho da Cecílio no escopo. As outras são da Careli (Gurgel). */
const PROPOSTAS_DA_CECILIO = new Set(["p-cecilio"]);

function responderPorTabela(
  mapa: Record<string, (c: Chamada) => Resposta>,
): void {
  estado.responder = (c) => {
    const chamada = c as Chamada;
    // O dono da proposta, que o portal pergunta antes de qualquer leitura por proposta.
    if (chamada.tabela === "temis_trabalhos" && valorDoFiltro(chamada, "eq", "proposta_id")) {
      const proposta = String(valorDoFiltro(chamada, "eq", "proposta_id"));
      const dono = valorDoFiltro(chamada, "eq", "operado_por");
      return PROPOSTAS_DA_CECILIO.has(proposta) && dono === CECILIO
        ? { data: [{ enterprise_id: "37", operado_por: CECILIO }], error: null }
        : { data: [], error: null };
    }
    return mapa[chamada.tabela]?.(chamada) ?? { data: [], error: null };
  };
}

const CARD = {
  arrependimento_inicio: null,
  cliente_cpf: null,
  cliente_nome: "Cliente",
  enterprise_codigo: "VOC",
  enterprise_nome: "Vale do Ouro",
  estagio: "analise",
  estagio_desde: "2026-09-16T10:00:00Z",
  id: "t-cecilio",
  indeferido_em: null,
  indeferido_motivo: null,
  indeferido_observacao: null,
  indeferido_por_nome: null,
  observacao: null,
  proposta_id: null,
  tipo: "contrato",
  unidade: "Q01 L01",
};

beforeEach(() => {
  estado.assinados = [];
  estado.chamadas = [];
  estado.documentos = [];
  estado.donos = {
    "t-careli": { enterprise_id: "37", operado_por: null },
    "t-cecilio": { enterprise_id: "37", operado_por: CECILIO },
    "t-fora": { enterprise_id: "99", operado_por: CECILIO },
    "t-outro": { enterprise_id: "37", operado_por: OUTRO },
  };
  estado.hubCoordenacao = true;
  estado.hubLeitura = true;
  estado.leiturasDoCadastro = 0;
  estado.portal = "ok";
  estado.produtos = [...TUDO_DA_CECILIO];
  responderPorTabela({});
  for (const mock of Object.values(mocks)) mock.mockClear();
  vi.mocked(donoDoTrabalho).mockClear();
});

// ── /trabalhos ──────────────────────────────────────────────────────────────

describe("GET /trabalhos", () => {
  it("portal: lê só os trabalhos do próprio incorporador, na sessão inteira", async () => {
    const r = await portalTrabalhos.GET(get("/api/incorporador/temis/trabalhos"));
    expect(r.status).toBe(200);
    expect(mocks.trabalhosDoBoard).toHaveBeenCalledWith({
      comAssinaturas: true,
      enterpriseIds: ["37", "group:Lagoa Bonita", "33", "27", "32"],
      operadoPor: CECILIO,
    });
    const corpo = (await r.json()) as { data: Record<string, unknown> };
    expect(Object.keys(corpo.data).sort()).toEqual(["atividades", "estagios", "nomes", "trabalhos"]);
  });

  it("portal: ?incluir=incorporadores não abre a fila da Careli", async () => {
    await portalTrabalhos.GET(
      get("/api/incorporador/temis/trabalhos?incluir=incorporadores&empreendimento=37"),
    );
    expect(mocks.trabalhosDoBoard).toHaveBeenCalledWith({
      comAssinaturas: true,
      enterpriseIds: ["37"],
      operadoPor: CECILIO,
    });
  });

  it("portal: o id do painel (pai:<uuid>) expande pelo cadastro, só dentro da sessão", async () => {
    // VLO é o pai; o VOC (37) é da sessão e o VOL (36) não. A tela manda o id do painel.
    const cadastro = [
      { c2xEnterpriseId: "35", codigo: "VLO", id: "uuid-vlo", nome: "Vale do Ouro", ordem: 0, paiId: null },
      { c2xEnterpriseId: "37", codigo: "VOC", id: "uuid-voc", nome: "VOC", ordem: 1, paiId: "uuid-vlo" },
      { c2xEnterpriseId: "36", codigo: "VOL", id: "uuid-vol", nome: "VOL", ordem: 2, paiId: "uuid-vlo" },
      { c2xEnterpriseId: "99", codigo: "XYZ", id: "uuid-xyz", nome: "Outro", ordem: 0, paiId: null },
    ];
    vi.mocked(carregarCadastroDeEmpreendimentos).mockResolvedValue(cadastro as never);

    const r = await portalTrabalhos.GET(
      get("/api/incorporador/temis/trabalhos?empreendimento=pai%3Auuid-vlo"),
    );
    expect(r.status).toBe(200);
    expect(mocks.trabalhosDoBoard).toHaveBeenCalledWith({
      comAssinaturas: true,
      enterpriseIds: ["37"],
      operadoPor: CECILIO,
    });

    mocks.trabalhosDoBoard.mockClear();
    const fora = await portalTrabalhos.GET(
      get("/api/incorporador/temis/trabalhos?empreendimento=pai%3Auuid-xyz"),
    );
    expect(fora.status).toBe(404);
    expect(mocks.trabalhosDoBoard).not.toHaveBeenCalled();

    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(carregarCadastroDeEmpreendimentos).mockRejectedValueOnce(new Error("fora"));
    const semCadastro = await portalTrabalhos.GET(
      get("/api/incorporador/temis/trabalhos?empreendimento=pai%3Auuid-vlo"),
    );
    expect(semCadastro.status).toBe(503);
    erro.mockRestore();
    vi.mocked(carregarCadastroDeEmpreendimentos).mockResolvedValue([
      { codigo: "VOC", nome: "Vale do Ouro" },
    ] as never);
  });

  it("portal: empreendimento fora da sessão é 404 sem consultar", async () => {
    const r = await portalTrabalhos.GET(get("/api/incorporador/temis/trabalhos?empreendimento=99"));
    expect(r.status).toBe(404);
    expect(mocks.trabalhosDoBoard).not.toHaveBeenCalled();
  });

  it("portal: a porta recusa antes (sem sessão 401, comercial 404)", async () => {
    estado.portal = "sem-sessao";
    expect((await portalTrabalhos.GET(get("/api/incorporador/temis/trabalhos"))).status).toBe(401);
    estado.portal = "comercial";
    expect((await portalTrabalhos.GET(get("/api/incorporador/temis/trabalhos"))).status).toBe(404);
    expect(mocks.trabalhosDoBoard).not.toHaveBeenCalled();
  });

  it("hub: inalterado", async () => {
    const r = await hubTrabalhos.GET(get("/api/temis/trabalhos?empreendimento=37"));
    expect(r.status).toBe(200);
    expect(mocks.trabalhosDoBoard).toHaveBeenCalledWith({
      comAssinaturas: true,
      enterpriseId: "37",
      operadoPor: "careli",
    });
  });
});

describe("POST /trabalhos", () => {
  const ABERTURA = {
    canal: "coordenador",
    clienteNome: "Cliente",
    empreendimentoCodigo: "VOC",
    empreendimentoId: "37",
    empreendimentoNome: "Vale do Ouro",
    tipo: "contrato",
    unidade: "Q01 L01",
  };

  it("portal: marcar atividade em card fora do alcance é 404 e não marca", async () => {
    for (const id of ["t-careli", "t-outro", "t-fora", "nao-existe"]) {
      const r = await portalTrabalhos.POST(
        post("/api/incorporador/temis/trabalhos", { acao: "atividade", atividade: "a", id }),
      );
      expect(r.status).toBe(404);
    }
    expect(mocks.marcarAtividade).not.toHaveBeenCalled();
  });

  it("portal: marcar atividade no próprio card funciona", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const r = await portalTrabalhos.POST(
      post("/api/incorporador/temis/trabalhos", {
        acao: "atividade",
        atividade: "a",
        feita: true,
        id: "t-cecilio",
      }),
    );
    expect(r.status).toBe(200);
    // Quem marcou vai junto, para a passagem de etapa registrar o autor (arrumação da onda 3).
    expect(mocks.marcarAtividade).toHaveBeenCalledWith({
      atividade: "a",
      feita: true,
      id: "t-cecilio",
      quem: "usuario-portal-1",
      quemNome: "Maria do Jurídico",
    });
    expect(info).toHaveBeenCalledWith(
      "[temis][portal] atividade marcada",
      expect.objectContaining({ origem: "portal", trabalhoId: "t-cecilio" }),
    );
    info.mockRestore();
  });

  it("portal: abrir em empreendimento fora da sessão é 404 e não abre", async () => {
    const r = await portalTrabalhos.POST(
      post("/api/incorporador/temis/trabalhos", { ...ABERTURA, empreendimentoId: "99" }),
    );
    expect(r.status).toBe(404);
    expect(mocks.abrirTrabalho).not.toHaveBeenCalled();
  });

  it("portal: contrato de origem da Careli é 404 e não abre", async () => {
    const r = await portalTrabalhos.POST(
      post("/api/incorporador/temis/trabalhos", {
        ...ABERTURA,
        tipo: "cancelamento_correcao",
        trabalhoOrigemId: "t-careli",
      }),
    );
    expect(r.status).toBe(404);
    expect(mocks.abrirTrabalho).not.toHaveBeenCalled();
  });

  it("portal: o canal da Iris não existe aqui", async () => {
    const r = await portalTrabalhos.POST(
      post("/api/incorporador/temis/trabalhos", {
        ...ABERTURA,
        canal: "iris",
        evidenciaPath: "x",
        irisTicketId: "t",
      }),
    );
    expect(r.status).toBe(400);
    expect(mocks.abrirTrabalho).not.toHaveBeenCalled();
  });

  it("portal: o ticket e a evidência da Iris vindos do corpo não entram no card", async () => {
    await portalTrabalhos.POST(
      post("/api/incorporador/temis/trabalhos", {
        ...ABERTURA,
        evidenciaPath: "evidencias/cliente-da-careli.pdf",
        irisTicketId: "ticket-da-careli",
      }),
    );
    expect(mocks.abrirTrabalho).toHaveBeenCalledWith(
      expect.objectContaining({ evidenciaPath: null, irisTicketId: null }),
    );
  });

  it("portal: com a 0172 pendente o card NÃO nasce na fila da Careli: 503", async () => {
    vi.mocked(mocks.abrirTrabalho).mockResolvedValueOnce({
      colunaDoDonoAusente: true,
      erro: "migration 0172 pendente",
      ok: false,
    } as never);
    const r = await portalTrabalhos.POST(post("/api/incorporador/temis/trabalhos", ABERTURA));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "Não foi possível abrir agora." });
  });

  it("portal: abre com o dono e o autor do portal", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const r = await portalTrabalhos.POST(post("/api/incorporador/temis/trabalhos", ABERTURA));
    expect(r.status).toBe(200);
    expect(mocks.abrirTrabalho).toHaveBeenCalledWith(
      expect.objectContaining({
        abertoPor: "usuario-portal-1",
        canal: "coordenador",
        empreendimentoId: "37",
        operadoPor: CECILIO,
      }),
    );
    expect(info).toHaveBeenCalledWith(
      "[temis][portal] trabalho aberto",
      expect.objectContaining({ origem: "portal", usuarioId: "usuario-portal-1" }),
    );
    info.mockRestore();
  });

  it("hub: abre sem dono (a Careli), sem conferir escopo", async () => {
    const r = await hubTrabalhos.POST(post("/api/temis/trabalhos", { ...ABERTURA, canal: "hercules" }));
    expect(r.status).toBe(200);
    expect(mocks.abrirTrabalho).toHaveBeenCalledWith(
      expect.objectContaining({ abertoPor: "user-hub", operadoPor: null }),
    );
    await hubTrabalhos.POST(
      post("/api/temis/trabalhos", { acao: "atividade", atividade: "a", id: "t-careli" }),
    );
    expect(mocks.marcarAtividade).toHaveBeenCalled();
    expect(donoDoTrabalho).not.toHaveBeenCalled();
  });
});

// ── /board ──────────────────────────────────────────────────────────────────

describe("GET /board", () => {
  function comContagens(recebem: string[]) {
    responderPorTabela({
      apolo_enterprise_settings: () => ({
        data: recebem.map((enterprise_id) => ({ enterprise_id })),
        error: null,
      }),
      temis_minutas: () => ({
        data: [
          { enterprise_id: "37", situacao: "publicada" },
          { enterprise_id: "99", situacao: "rascunho" },
        ],
        error: null,
      }),
      temis_planos: () => ({
        data: [
          { ativo: true, enterprise_id: "37", minuta_id: null },
          { ativo: true, enterprise_id: "99", minuta_id: "m" },
        ],
        error: null,
      }),
    });
  }

  it("portal: as três leituras saem recortadas pela sessão", async () => {
    comContagens(["37"]);
    const r = await portalBoard.GET(get("/api/incorporador/temis/board"));
    expect(r.status).toBe(200);
    for (const tabela of ["temis_planos", "temis_minutas", "apolo_enterprise_settings"]) {
      expect(valorDoFiltro(consultasA(tabela)[0]!, "in", "enterprise_id")).toEqual([
        "37",
        "group:Lagoa Bonita",
        "33",
        "27",
        "32",
      ]);
    }
    const corpo = (await r.json()) as {
      data: { contagens: Record<string, unknown>; recebemCad: string[] };
    };
    // A rede em memória: a linha do 99 (que o banco falso devolveu mesmo assim) não conta.
    expect(Object.keys(corpo.data.contagens)).toEqual(["37"]);
    expect(corpo.data.recebemCad).toEqual(["37"]);
  });

  it("portal: nenhum produto dele recebendo CAD é vazio, não falha", async () => {
    comContagens([]);
    const r = await portalBoard.GET(get("/api/incorporador/temis/board"));
    expect(r.status).toBe(200);
  });

  it("hub: inalterado, sem recorte, e o vazio de quem recebe CAD continua falha fechada", async () => {
    comContagens(["37", "99"]);
    const r = await hubBoard.GET(get("/api/temis/board"));
    expect(r.status).toBe(200);
    expect(valorDoFiltro(consultasA("temis_planos")[0]!, "in", "enterprise_id")).toBeUndefined();
    const corpo = (await r.json()) as { data: { contagens: Record<string, unknown> } };
    expect(Object.keys(corpo.data.contagens).sort()).toEqual(["37", "99"]);

    comContagens([]);
    expect((await hubBoard.GET(get("/api/temis/board"))).status).toBe(502);
  });

  it("pagina de mil em mil: a segunda página é pedida quando a primeira vem cheia", async () => {
    const cheia = Array.from({ length: 1000 }, () => ({
      ativo: true,
      enterprise_id: "37",
      minuta_id: null,
    }));
    responderPorTabela({
      apolo_enterprise_settings: () => ({ data: [{ enterprise_id: "37" }], error: null }),
      temis_planos: (c) => {
        const faixa = c.filtros.find((f) => f[0] === "range");
        return { data: faixa?.[1] === 0 ? cheia : cheia.slice(0, 5), error: null };
      },
    });
    const r = await hubBoard.GET(get("/api/temis/board"));
    const corpo = (await r.json()) as {
      data: { contagens: Record<string, { planosAtivos: number }> };
    };
    expect(consultasA("temis_planos")).toHaveLength(2);
    expect(temFiltro(consultasA("temis_planos")[1], "range", 1000, 1999)).toBe(true);
    expect(corpo.data.contagens["37"]?.planosAtivos).toBe(1005);
  });
});

// ── /empreendimentos ────────────────────────────────────────────────────────

describe("GET /empreendimentos", () => {
  beforeEach(() => {
    responderPorTabela({
      apolo_enterprise_settings: () => ({
        data: [
          { code: "VOC", enterprise_id: "37" },
          { code: "VOL", enterprise_id: "38" },
        ],
        error: null,
      }),
    });
  });

  it("portal: só os empreendimentos da sessão", async () => {
    const r = await portalEmpreendimentos.GET(get("/api/incorporador/temis/empreendimentos"));
    expect(r.status).toBe(200);
    expect(valorDoFiltro(consultasA("apolo_enterprise_settings")[0]!, "in", "enterprise_id")).toEqual(
      ["37", "group:Lagoa Bonita", "33", "27", "32"],
    );
    const corpo = (await r.json()) as { data: { rows: Array<{ id: string }> } };
    expect(corpo.data.rows.map((l) => l.id)).toEqual(["37"]);
  });

  it("hub: inalterado", async () => {
    const r = await hubEmpreendimentos.GET(get("/api/temis/empreendimentos"));
    const corpo = (await r.json()) as { data: { rows: Array<{ id: string; name: string }> } };
    expect(corpo.data.rows.map((l) => l.id).sort()).toEqual(["37", "38"]);
    expect(corpo.data.rows.find((l) => l.id === "37")?.name).toBe("Vale do Ouro");
    expect(
      valorDoFiltro(consultasA("apolo_enterprise_settings")[0]!, "in", "enterprise_id"),
    ).toBeUndefined();
  });
});

// ── /trabalho ───────────────────────────────────────────────────────────────

describe("GET /trabalho", () => {
  beforeEach(() => {
    responderPorTabela({ temis_trabalhos: () => ({ data: CARD, error: null }) });
  });

  it("portal: card fora do alcance é 404 sem ler o card", async () => {
    for (const id of ["t-careli", "t-outro", "t-fora", "nao-existe"]) {
      const r = await portalTrabalho.GET(get(`/api/incorporador/temis/trabalho?id=${id}`));
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: "Nao encontrado." });
    }
    expect(consultasA("temis_trabalhos")).toHaveLength(0);
  });

  it("portal: o próprio card abre, e o time pode emitir", async () => {
    const r = await portalTrabalho.GET(get("/api/incorporador/temis/trabalho?id=t-cecilio"));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { card: { id: string }; podeEmitir: boolean } };
    expect(corpo.data.card.id).toBe("t-cecilio");
    expect(corpo.data.podeEmitir).toBe(true);
  });

  it("portal: erro de leitura não devolve o texto do banco", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    responderPorTabela({
      temis_trabalhos: () => ({ data: null, error: { message: "column x does not exist" } }),
    });
    const r = await portalTrabalho.GET(get("/api/incorporador/temis/trabalho?id=t-cecilio"));
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toContain("column x");
    erro.mockRestore();
  });

  it("hub: inalterado (sem dono, podeEmitir da coordenação, erro com o texto do banco)", async () => {
    estado.hubCoordenacao = false;
    const r = await hubTrabalho.GET(get("/api/temis/trabalho?id=t-careli"));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { data: { podeEmitir: boolean } }).data.podeEmitir).toBe(false);
    expect(donoDoTrabalho).not.toHaveBeenCalled();

    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    responderPorTabela({
      temis_trabalhos: () => ({ data: null, error: { message: "column x does not exist" } }),
    });
    const falha = await hubTrabalho.GET(get("/api/temis/trabalho?id=t-careli"));
    expect(await falha.json()).toEqual({ error: "Não foi possível abrir: column x does not exist" });
    erro.mockRestore();
  });
});

describe("POST /trabalho", () => {
  beforeEach(() => {
    responderPorTabela({
      temis_trabalhos: (c) =>
        c.update
          ? { data: [{ id: "t-cecilio" }], error: null }
          : { data: { estagio: "analise", id: "t-cecilio", proposta_id: null, tipo: "contrato" }, error: null },
    });
  });

  it("portal: fora do alcance é 404 nas duas ações, sem ler nem gravar", async () => {
    for (const acao of ["indeferir", "voltar_para_analise"]) {
      const r = await portalTrabalho.POST(
        post("/api/incorporador/temis/trabalho", {
          acao,
          id: "t-careli",
          motivo: "documento_faltando",
        }),
      );
      expect(r.status).toBe(404);
    }
    expect(consultasA("temis_trabalhos")).toHaveLength(0);
    expect(mocks.retornarParaAnalise).not.toHaveBeenCalled();
    expect(mocks.registrarPassagemDeEtapa).not.toHaveBeenCalled();
  });

  it("portal: indeferir o próprio card grava o usuário do portal como autor", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const r = await portalTrabalho.POST(
      post("/api/incorporador/temis/trabalho", { id: "t-cecilio", motivo: "documento_faltando" }),
    );
    expect(r.status).toBe(200);
    const update = consultasA("temis_trabalhos").find((c) => c.update)?.update;
    expect(update).toMatchObject({
      estagio: "indeferido",
      indeferido_por: "usuario-portal-1",
      indeferido_por_nome: "Maria do Jurídico",
    });
    expect(mocks.registrarPassagemDeEtapa).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quem: "usuario-portal-1", quemNome: "Maria do Jurídico" }),
    );
    info.mockRestore();
  });

  it("portal: voltar para análise o próprio card passa o autor do portal", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const r = await portalTrabalho.POST(
      post("/api/incorporador/temis/trabalho", { acao: "voltar_para_analise", id: "t-cecilio" }),
    );
    expect(r.status).toBe(200);
    expect(mocks.retornarParaAnalise).toHaveBeenCalledWith(expect.anything(), {
      observacao: null,
      trabalhoId: "t-cecilio",
      usuarioId: "usuario-portal-1",
      usuarioNome: "Maria do Jurídico",
    });
    info.mockRestore();
  });

  it("hub: inalterado (coordenação decide; autor do hub; sem conferir dono)", async () => {
    const r = await hubTrabalho.POST(
      post("/api/temis/trabalho", { id: "t-careli", motivo: "documento_faltando" }),
    );
    expect(r.status).toBe(200);
    expect(consultasA("temis_trabalhos").find((c) => c.update)?.update).toMatchObject({
      indeferido_por: "user-hub",
      indeferido_por_nome: "Jurídico",
    });
    expect(donoDoTrabalho).not.toHaveBeenCalled();

    estado.hubCoordenacao = false;
    mocks.retornarParaAnalise.mockClear();
    const recusa = await hubTrabalho.POST(
      post("/api/temis/trabalho", { acao: "voltar_para_analise", id: "t-careli" }),
    );
    expect(recusa.status).toBe(403);
    expect(mocks.retornarParaAnalise).not.toHaveBeenCalled();
  });
});

// ── POST /trabalho: concluir, e o indeferimento chegando na venda (18/09/2026) ──

describe("POST /trabalho: concluir cancelamento ou distrato", () => {
  const DECLAROU = { devolucaoAcertada: true, termoAssinado: true };

  it("portal: fora do alcance é 404, sem concluir nada", async () => {
    for (const id of ["t-careli", "t-outro", "t-fora"]) {
      const r = await portalTrabalho.POST(
        post("/api/incorporador/temis/trabalho", { acao: "concluir", declaracoes: DECLAROU, id }),
      );
      expect(r.status).toBe(404);
    }
    expect(mocks.concluirCancelamentoDoCard).not.toHaveBeenCalled();
  });

  it("portal: o próprio card conclui com o autor do portal, e a resposta leva o recado e a unidade", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const r = await portalTrabalho.POST(
      post("/api/incorporador/temis/trabalho", { acao: "concluir", declaracoes: DECLAROU, id: "t-cecilio" }),
    );
    expect(r.status).toBe(200);
    expect(mocks.concluirCancelamentoDoCard).toHaveBeenCalledWith(expect.anything(), {
      declaracoes: DECLAROU,
      trabalhoId: "t-cecilio",
      usuarioId: "usuario-portal-1",
      usuarioNome: "Maria do Jurídico",
    });
    const corpo = (await r.json()) as { recado: string; unidade: { voltou: boolean } };
    expect(corpo.recado).toContain("a unidade voltou para a disponibilidade");
    expect(corpo.unidade.voltou).toBe(true);
    info.mockRestore();
  });

  it("portal: produto só de consulta (VOC operado pela Careli) é 403, sem concluir", async () => {
    estado.produtos = [...PRODUTOS_DE_16_DE_SETEMBRO];
    const r = await portalTrabalho.POST(
      post("/api/incorporador/temis/trabalho", { acao: "concluir", declaracoes: DECLAROU, id: "t-cecilio" }),
    );
    expect(r.status).toBe(403);
    expect(mocks.concluirCancelamentoDoCard).not.toHaveBeenCalled();
  });

  it("hub: a coordenação conclui; a recusa do servidor chega com o status e a frase dele", async () => {
    mocks.concluirCancelamentoDoCard.mockResolvedValueOnce({
      erro: "A situação mudou: agora exige distrato.",
      ok: false,
      status: 409,
    });
    const r = await hubTrabalho.POST(post("/api/temis/trabalho", { acao: "concluir", id: "t-careli" }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "A situação mudou: agora exige distrato." });
    expect(mocks.concluirCancelamentoDoCard).toHaveBeenCalledWith(expect.anything(), {
      declaracoes: undefined,
      trabalhoId: "t-careli",
      usuarioId: "user-hub",
      usuarioNome: "Jurídico",
    });

    estado.hubCoordenacao = false;
    mocks.concluirCancelamentoDoCard.mockClear();
    const recusa = await hubTrabalho.POST(post("/api/temis/trabalho", { acao: "concluir", id: "t-careli" }));
    expect(recusa.status).toBe(403);
    expect(mocks.concluirCancelamentoDoCard).not.toHaveBeenCalled();
  });

  it("indeferir leva a decisão para a venda, e a resposta traz o recado dela", async () => {
    responderPorTabela({
      temis_trabalhos: (c) =>
        c.update
          ? { data: [{ id: "t-careli" }], error: null }
          : {
              data: { estagio: "analise", id: "t-careli", proposta_id: "venda-21", tipo: "cancelamento" },
              error: null,
            },
    });
    mocks.devolverVendaNoIndeferimento.mockResolvedValueOnce({
      aviso: null,
      feito: "nada",
      recado: "Pedido de cancelamento indeferido. A venda continua como estava, e o Hércules volta a oferecer o pedido de cancelamento.",
    });

    const r = await hubTrabalho.POST(
      post("/api/temis/trabalho", { id: "t-careli", motivo: "outro", observacao: "Cliente desistiu de desistir" }),
    );

    expect(r.status).toBe(200);
    expect(mocks.devolverVendaNoIndeferimento).toHaveBeenCalledWith(
      expect.anything(),
      { estagio: "analise", id: "t-careli", proposta_id: "venda-21", tipo: "cancelamento" },
      { motivo: "outro", observacao: "Cliente desistiu de desistir", usuarioNome: "Jurídico" },
    );
    expect(((await r.json()) as { recado: string }).recado).toContain("volta a oferecer o pedido");
  });

  it("indeferimento que o banco barrou (card faturado) não mexe na venda", async () => {
    responderPorTabela({
      temis_trabalhos: (c) =>
        c.update
          ? { data: [], error: null }
          : { data: { estagio: "faturado", id: "t-careli", proposta_id: "venda-21", tipo: "contrato" }, error: null },
    });
    const r = await hubTrabalho.POST(post("/api/temis/trabalho", { id: "t-careli", motivo: "documento_faltando" }));
    expect(r.status).toBe(409);
    expect(mocks.devolverVendaNoIndeferimento).not.toHaveBeenCalled();
  });
});

// ── /trabalho/conversa ──────────────────────────────────────────────────────

describe("/trabalho/conversa", () => {
  beforeEach(() => {
    responderPorTabela({
      hercules_conversas: () => ({ data: [], error: null }),
      hercules_propostas: () => ({
        data: { empreendimento_codigo: "VOC", protocolo_numero: 12, unidade_id: "u-1" },
        error: null,
      }),
    });
  });

  it("portal GET: proposta sem trabalho dele é 404 sem ler a conversa", async () => {
    const r = await portalConversa.GET(get("/api/incorporador/temis/trabalho/conversa?proposta=p-gurgel"));
    expect(r.status).toBe(404);
    expect(consultasA("hercules_conversas")).toHaveLength(0);
  });

  it("portal GET: a proposta do próprio trabalho lê", async () => {
    const r = await portalConversa.GET(get("/api/incorporador/temis/trabalho/conversa?proposta=p-cecilio"));
    expect(r.status).toBe(200);
    expect(consultasA("hercules_conversas")).toHaveLength(1);
  });

  it("portal POST: fora é 404 sem gravar; dentro grava com o autor do portal", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fora = await portalConversa.POST(
      post("/api/incorporador/temis/trabalho/conversa", { proposta: "p-gurgel", texto: "oi" }),
    );
    expect(fora.status).toBe(404);
    expect(consultasA("hercules_conversas")).toHaveLength(0);
    expect(consultasA("hercules_propostas")).toHaveLength(0);

    const dentro = await portalConversa.POST(
      post("/api/incorporador/temis/trabalho/conversa", { proposta: "p-cecilio", texto: "oi" }),
    );
    expect(dentro.status).toBe(200);
    expect(consultasA("hercules_conversas")[0]?.insert).toMatchObject({
      autor: "usuario-portal-1",
      autor_nome: "Maria do Jurídico",
      proposta_id: "p-cecilio",
      unidade_id: "u-1",
    });
    info.mockRestore();
  });

  it("portal: com a 0172 pendente, nenhuma proposta é dele", async () => {
    estado.responder = (c) =>
      c.tabela === "temis_trabalhos"
        ? { data: null, error: { code: "42703", message: "column temis_trabalhos.operado_por does not exist" } }
        : { data: [], error: null };
    const r = await portalConversa.GET(get("/api/incorporador/temis/trabalho/conversa?proposta=p-cecilio"));
    expect(r.status).toBe(404);
  });

  it("hub: inalterado (sem pergunta de dono; nota com o autor do hub)", async () => {
    expect((await hubConversa.GET(get("/api/temis/trabalho/conversa?proposta=p-gurgel"))).status).toBe(200);
    const r = await hubConversa.POST(
      post("/api/temis/trabalho/conversa", { proposta: "p-gurgel", texto: "oi" }),
    );
    expect(r.status).toBe(200);
    expect(consultasA("temis_trabalhos")).toHaveLength(0);
    expect(consultasA("hercules_conversas")[1]?.insert).toMatchObject({
      autor: "user-hub",
      autor_nome: "Jurídico",
    });
  });
});

// ── ESCRITA SÓ NO QUE O PORTAL OPERA ────────────────────────────────────────
//
// Decisão do Lucas (16/09/2026). O card do portal no VOC (37), que é da Careli no cadastro de
// 16/09/2026, continua abrindo; mexer nele responde 403 só consulta, sem gravar nada.

describe("escrita só no produto que o portal opera", () => {
  const SO_CONSULTA = {
    error: "Este produto está disponível só para consulta no seu portal.",
    soConsulta: true,
  };

  beforeEach(() => {
    estado.produtos = [...PRODUTOS_DE_16_DE_SETEMBRO];
    responderPorTabela({
      hercules_conversas: () => ({ data: [], error: null }),
      hercules_propostas: () => ({
        data: { empreendimento_codigo: "VOC", protocolo_numero: 12, unidade_id: "u-1" },
        error: null,
      }),
      temis_trabalhos: (c) =>
        c.update
          ? { data: [{ id: "t-cecilio" }], error: null }
          : { data: { estagio: "analise", id: "t-cecilio", proposta_id: null, tipo: "contrato" }, error: null },
    });
  });

  it("marcar atividade e abrir solicitação no VOC: 403, e nada marcado nem aberto", async () => {
    const marcar = await portalTrabalhos.POST(
      post("/api/incorporador/temis/trabalhos", { acao: "atividade", atividade: "a", id: "t-cecilio" }),
    );
    expect(marcar.status).toBe(403);
    expect(await marcar.json()).toEqual(SO_CONSULTA);

    const abrir = await portalTrabalhos.POST(
      post("/api/incorporador/temis/trabalhos", {
        canal: "coordenador",
        clienteNome: "Cliente",
        empreendimentoCodigo: "VOC",
        empreendimentoId: "37",
        empreendimentoNome: "Vale do Ouro",
        tipo: "contrato",
        unidade: "Q01 L01",
      }),
    );
    expect(abrir.status).toBe(403);
    expect(mocks.marcarAtividade).not.toHaveBeenCalled();
    expect(mocks.abrirTrabalho).not.toHaveBeenCalled();
  });

  it("indeferir e voltar para análise no VOC: 403 sem ler nem gravar o card", async () => {
    for (const acao of ["indeferir", "voltar_para_analise"]) {
      const r = await portalTrabalho.POST(
        post("/api/incorporador/temis/trabalho", { acao, id: "t-cecilio", motivo: "documento_faltando" }),
      );
      expect(r.status).toBe(403);
    }
    expect(consultasA("temis_trabalhos").some((c) => c.update)).toBe(false);
    expect(mocks.retornarParaAnalise).not.toHaveBeenCalled();
    expect(mocks.registrarPassagemDeEtapa).not.toHaveBeenCalled();
  });

  it("escrever na conversa da venda do VOC: 403 sem gravar; ler continua", async () => {
    const escrever = await portalConversa.POST(
      post("/api/incorporador/temis/trabalho/conversa", { proposta: "p-cecilio", texto: "oi" }),
    );
    expect(escrever.status).toBe(403);
    expect(consultasA("hercules_conversas").some((c) => c.insert)).toBe(false);

    const ler = await portalConversa.GET(get("/api/incorporador/temis/trabalho/conversa?proposta=p-cecilio"));
    expect(ler.status).toBe(200);
  });

  it("o card do VOC continua abrindo na tela de trabalho", async () => {
    expect((await portalTrabalho.GET(get("/api/incorporador/temis/trabalho?id=t-cecilio"))).status).toBe(200);
  });

  it("o hub mexe no VOC como sempre, sem ler o cadastro", async () => {
    await hubTrabalhos.POST(
      post("/api/temis/trabalhos", { acao: "atividade", atividade: "a", id: "t-careli" }),
    );
    expect(mocks.marcarAtividade).toHaveBeenCalledWith(
      expect.objectContaining({ quem: "user-hub", quemNome: "Jurídico" }),
    );
    expect(estado.leiturasDoCadastro).toBe(0);
  });
});

// ── /trabalho/historico ─────────────────────────────────────────────────────

describe("GET /trabalho/historico", () => {
  beforeEach(() => {
    responderPorTabela({
      hercules_propostas: () => ({ data: null, error: null }),
      temis_trabalho_etapas: () => ({ data: [], error: null }),
      temis_trabalhos: () => ({
        data: {
          estagio: "analise",
          estagio_desde: "2026-09-16T10:00:00Z",
          id: "t-cecilio",
          proposta_id: null,
          tipo: "contrato",
        },
        error: null,
      }),
    });
  });

  it("portal: trabalho fora ou proposta fora é 404 sem ler nada", async () => {
    const trabalhoFora = await portalHistorico.GET(
      get("/api/incorporador/temis/trabalho/historico?trabalho=t-outro"),
    );
    expect(trabalhoFora.status).toBe(404);
    const propostaFora = await portalHistorico.GET(
      get("/api/incorporador/temis/trabalho/historico?trabalho=t-cecilio&proposta=p-gurgel"),
    );
    expect(propostaFora.status).toBe(404);
    expect(consultasA("temis_trabalho_etapas")).toHaveLength(0);
    expect(consultasA("hercules_propostas")).toHaveLength(0);
  });

  it("portal: o próprio card monta a linha do tempo", async () => {
    const r = await portalHistorico.GET(
      get("/api/incorporador/temis/trabalho/historico?trabalho=t-cecilio"),
    );
    expect(r.status).toBe(200);
    expect(consultasA("temis_trabalho_etapas")).toHaveLength(1);
  });

  it("portal: a proposta do próprio trabalho chega à leitura", async () => {
    const r = await portalHistorico.GET(
      get("/api/incorporador/temis/trabalho/historico?proposta=p-cecilio"),
    );
    // O banco falso não tem a proposta: 404 com a frase DA LEITURA, não a do escopo.
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Proposta não encontrada." });
    expect(consultasA("hercules_propostas")).toHaveLength(1);
  });

  it("hub: inalterado", async () => {
    const r = await hubHistorico.GET(get("/api/temis/trabalho/historico?trabalho=t-outro"));
    expect(r.status).toBe(200);
    expect(donoDoTrabalho).not.toHaveBeenCalled();
  });
});

// ── /trabalho/documentos ────────────────────────────────────────────────────

describe("GET /trabalho/documentos", () => {
  const RG = {
    createdAt: "2026-09-10T10:00:00Z",
    documentType: "rg",
    fileName: "rg.pdf",
    hasFile: true,
    id: "doc-rg",
    label: "RG",
    sizeBytes: 10,
    status: "ok",
    uploadedBy: "Analista da Careli",
  };
  const SERASA = { ...RG, documentType: "comprovante-credito", id: "doc-serasa", label: "Serasa" };

  beforeEach(() => {
    estado.documentos = [RG, SERASA];
    responderPorTabela({
      apolo_documents: (c) =>
        selecionou(c, "storage_path")
          ? { data: { storage_path: `entidade/pessoa-1/${String(valorDoFiltro(c, "eq", "id"))}.pdf` }, error: null }
          : {
              data: [
                { document_type: "rg", enterpriseId: null, id: "doc-rg" },
                { document_type: "comprovante-credito", enterpriseId: null, id: "doc-serasa" },
              ],
              error: null,
            },
      apolo_esteira: () => ({ data: [{ enterprise_id: "37" }], error: null }),
      apolo_relationships: () => ({ data: [], error: null }),
      hercules_documentos: (c) =>
        selecionou(c, "caminho")
          ? {
              data:
                valorDoFiltro(c, "eq", "proposta_id") === "p-cecilio" &&
                valorDoFiltro(c, "eq", "id") === "doc-venda"
                  ? { caminho: "venda/contrato.pdf" }
                  : null,
              error: null,
            }
          : {
              data: [
                { criado_em: "2026-09-11T10:00:00Z", enviado_por_nome: "X", id: "doc-venda", nome: "Contrato", tipo: "contrato" },
              ],
              error: null,
            },
      hercules_propostas: () => ({ data: { cliente_entity_id: "pessoa-1" }, error: null }),
    });
  });

  it("portal: proposta sem trabalho dele é 404 sem ler documento nenhum", async () => {
    const r = await portalDocumentos.GET(
      get("/api/incorporador/temis/trabalho/documentos?proposta=p-gurgel"),
    );
    expect(r.status).toBe(404);
    expect(consultasA("hercules_documentos")).toHaveLength(0);
    expect(consultasA("hercules_propostas")).toHaveLength(0);
  });

  // ⚠️ A CECÍLIO FAZ A ANÁLISE DE CRÉDITO DOS CLIENTES DELA (decisão do Lucas, 16/09/2026): o portal
  // que confecciona é o que opera sozinho, e o comprovante do Serasa sai no card DELE, mas só quando
  // a CAD da pessoa é do escopo (a régua de `documentoVisivelNoPortal`, a mesma do CRM e do board).

  // (16/09/2026, revisão do conjunto) O comprovante que sai é o que o PORTAL pagou, marcado com o
  // empreendimento da CAD. O sem marca é da Careli e não sai (documentos-do-portal.ts, passo 2).
  it("portal: o comprovante do Serasa (marcado, pago pelo portal) sai quando a CAD da pessoa é do escopo", async () => {
    const anterior = estado.responder;
    estado.responder = (c) =>
      c.tabela === "apolo_documents" && !selecionou(c, "storage_path")
        ? {
            data: [
              { document_type: "rg", enterpriseId: null, id: "doc-rg" },
              { document_type: "comprovante-credito", enterpriseId: "37", id: "doc-serasa" },
            ],
            error: null,
          }
        : anterior(c);

    const r = await portalDocumentos.GET(
      get("/api/incorporador/temis/trabalho/documentos?proposta=p-cecilio"),
    );
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { documentos: Array<{ fonte: string; id: string }> } };
    expect(corpo.data.documentos.map((d) => d.id)).toEqual(["doc-venda", "doc-rg", "doc-serasa"]);

    const aberto = await portalDocumentos.GET(
      get("/api/incorporador/temis/trabalho/documentos?proposta=p-cecilio&abrir=doc-serasa&fonte=proponente"),
    );
    expect(aberto.status).toBe(200);
  });

  it("portal: com CAD em produto de fora do escopo, o comprovante não sai nem abre pelo id", async () => {
    const anterior = estado.responder;
    estado.responder = (c) =>
      c.tabela === "apolo_esteira"
        ? { data: [{ enterprise_id: "37" }, { enterprise_id: "36" }], error: null }
        : anterior(c);

    const r = await portalDocumentos.GET(
      get("/api/incorporador/temis/trabalho/documentos?proposta=p-cecilio"),
    );
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { documentos: Array<{ id: string }> } };
    expect(corpo.data.documentos.map((d) => d.id)).not.toContain("doc-serasa");

    const aberto = await portalDocumentos.GET(
      get("/api/incorporador/temis/trabalho/documentos?proposta=p-cecilio&abrir=doc-serasa&fonte=proponente"),
    );
    expect(aberto.status).toBe(404);
    expect(estado.assinados).toEqual([]);
  });

  it("portal: abrir o RG e o contrato da própria venda assina o link", async () => {
    const rg = await portalDocumentos.GET(
      get("/api/incorporador/temis/trabalho/documentos?proposta=p-cecilio&abrir=doc-rg&fonte=proponente"),
    );
    expect(rg.status).toBe(200);
    const venda = await portalDocumentos.GET(
      get("/api/incorporador/temis/trabalho/documentos?proposta=p-cecilio&abrir=doc-venda"),
    );
    expect(venda.status).toBe(200);
    expect(estado.assinados).toEqual(["entidade/pessoa-1/doc-rg.pdf", "venda/contrato.pdf"]);
  });

  it("abrir documento da venda confere a proposta na consulta", async () => {
    const r = await portalDocumentos.GET(
      get("/api/incorporador/temis/trabalho/documentos?proposta=p-cecilio&abrir=doc-de-outra-venda"),
    );
    expect(r.status).toBe(404);
    const consulta = consultasA("hercules_documentos")[0]!;
    expect(temFiltro(consulta, "eq", "proposta_id", "p-cecilio")).toBe(true);
    expect(temFiltro(consulta, "is", "removido_em", null)).toBe(true);
  });

  it("hub: leitura dos documentos da pessoa que falha é 503, e não lista vazia calada", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    responderPorTabela({
      apolo_documents: () => ({ data: null, error: { message: "timeout" } }),
      hercules_documentos: () => ({ data: [], error: null }),
      hercules_propostas: () => ({ data: { cliente_entity_id: "pessoa-1" }, error: null }),
    });
    const lista = await hubDocumentos.GET(get("/api/temis/trabalho/documentos?proposta=p-gurgel"));
    expect(lista.status).toBe(503);

    const abrir = await hubDocumentos.GET(
      get("/api/temis/trabalho/documentos?proposta=p-gurgel&abrir=doc-rg&fonte=proponente"),
    );
    expect(abrir.status).toBe(503);
    expect(estado.assinados).toEqual([]);
    erro.mockRestore();
  });

  it("hub: inalterado, a lista inteira da pessoa (com o comprovante) e sem pergunta de dono", async () => {
    const r = await hubDocumentos.GET(get("/api/temis/trabalho/documentos?proposta=p-gurgel"));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { documentos: Array<{ id: string }> } };
    expect(corpo.data.documentos.map((d) => d.id)).toEqual(["doc-venda", "doc-rg", "doc-serasa"]);
    expect(consultasA("temis_trabalhos")).toHaveLength(0);

    const serasa = await hubDocumentos.GET(
      get("/api/temis/trabalho/documentos?proposta=p-gurgel&abrir=doc-serasa&fonte=proponente"),
    );
    expect(serasa.status).toBe(200);
  });
});
