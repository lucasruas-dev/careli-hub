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


// ════════════════════════════════════════════════════════════════════════════════
// REVISÃO ADVERSARIAL (18/09/2026): o indeferimento chegando na venda.
//
// O dublê de Supabase acima é CÓPIA do de `trabalho-rotas.test.ts`. Aqui ele responde como o banco
// de verdade responderia ao `update` do indeferir: o card JÁ indeferido casa com
// `.neq("estagio", "faturado")` e volta como linha gravada.
// Os testes com "DEFEITO" no nome estão VERMELHOS DE PROPÓSITO.
// ════════════════════════════════════════════════════════════════════════════════

describe("REVISÃO: indeferir de novo um card que já estava indeferido", () => {
  it("DEFEITO: aba velha indefere de novo o contrato antigo e devolve para Proposta a venda do contrato NOVO", async () => {
    // O contrato K1 foi indeferido (a venda voltou para Proposta), quem vendeu corrigiu e mandou de
    // novo: a venda está em Contrato com o card K2 aberto. Numa aba aberta desde antes, K1 ainda
    // aparece em Análise com o botão Indeferir.
    const noBanco = { estagio: "indeferido", id: "t-careli", proposta_id: "venda-21", tipo: "contrato" };
    responderPorTabela({
      temis_trabalhos: (c) => {
        if (c.update) {
          const barrado = temFiltro(c, "neq", "estagio", "faturado") && noBanco.estagio === "faturado";
          return { data: barrado ? [] : [{ id: noBanco.id }], error: null };
        }
        return { data: noBanco, error: null };
      },
    });

    const r = await hubTrabalho.POST(
      post("/api/temis/trabalho", { id: "t-careli", motivo: "outro", observacao: "aba velha" }),
    );

    expect(r.status).toBe(200); // hoje: aceita
    // O certo: um card que já estava indeferido não é indeferido de novo, e a venda (que agora é do
    // card K2) não é devolvida para Proposta por ele.
    expect(mocks.devolverVendaNoIndeferimento).not.toHaveBeenCalled();
  });
});
