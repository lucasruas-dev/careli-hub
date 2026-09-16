import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O ALCANCE DO CONTRATO E O AUTOR — as regras que decidem se o portal toca numa proposta.
//
// O que está travado aqui:
//   • o hub passa SEM consulta nenhuma (é o que mantém o hub exatamente como era);
//   • o portal só alcança a proposta cujos cards são TODOS dele e estão no escopo da sessão — a
//     venda da Gurgel (card da Careli), a de outro incorporador, o dono misturado, o card fora do
//     escopo e a proposta sem card ficam fora;
//   • a 0172 pendente e o id torto são "fora" (404); qualquer outra falha é "indisponivel" (503);
//   • documento e envelope decidem pela proposta deles; a minuta pedida, pelo empreendimento dela,
//     com a assimetria da divisão (a sessão com a divisão NÃO alcança o consolidado);
//   • o autor do portal leva a origem escrita e nunca vira "Sistema".
//
// O Supabase é um construtor falso que ANOTA a consulta e devolve o que o teste mandou.

const estado = vi.hoisted(() => ({
  consultas: [] as Array<{ filtros: unknown[][]; tabela: string }>,
  leiturasDoCadastro: 0,
  produtos: [] as Array<{ c2x: string; operadoPor: null | string; pai?: string }>,
  respostas: new Map<string, { data: unknown; error: unknown }>(),
}));

// A régua de quem opera o produto é a de verdade; só a leitura do cadastro é trocada.
vi.mock("@/lib/hercules/cadastro", async (importOriginal) => {
  const { cadastroDosProdutos } = await import("./fixtures/produtos-operados");
  return {
    ...(await importOriginal<typeof import("@/lib/hercules/cadastro")>()),
    lerCadastroDeEmpreendimentos: async () => {
      estado.leiturasDoCadastro += 1;
      return { com0170: true, linhas: cadastroDosProdutos(estado.produtos) };
    },
  };
});

function sbFalso() {
  return {
    from(tabela: string) {
      const registro = { filtros: [] as unknown[][], tabela };
      estado.consultas.push(registro);
      const q: Record<string, unknown> = {};
      for (const metodo of ["select", "eq", "in", "is", "limit", "order"]) {
        q[metodo] = (...args: unknown[]) => {
          registro.filtros.push([metodo, ...args]);
          return q;
        };
      }
      const resposta = () => estado.respostas.get(tabela) ?? { data: null, error: null };
      // O pai do cadastro é lido duas vezes (a linha do pai e a lista dos filhos): a lista tem
      // resposta própria, sob a chave "<tabela>:lista".
      q.maybeSingle = async () => resposta();
      q.lista = () => estado.respostas.get(`${tabela}:lista`) ?? resposta();
      q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve((q.lista as () => unknown)()).then(ok, falha);
      return q;
    },
  } as never;
}

import type { AtorDoHub, AtorDoPortal } from "./ator";
import { alcanceDoEnvelope } from "./assinatura-servico";
import {
  alcanceDaMinutaPedida,
  alcanceDaProposta,
  alcanceDaPropostaParaEscrever,
  alcanceDoDocumento,
  autorDoAto,
  registrarAtoDoPortal,
  respostaDoAlcance,
} from "./contrato-servico";
import { PRODUTOS_DE_16_DE_SETEMBRO } from "./fixtures/produtos-operados";

const CECILIO = "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6";
const LINO = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const PROPOSTA = "641f22ac-6c4a-4133-afec-49fa7b7e1765";

const HUB: AtorDoHub = { nome: "Jurídico Careli", papel: "coordenacao", tipo: "hub", userId: "user-hub" };

function portal(extra: Partial<AtorDoPortal> = {}): AtorDoPortal {
  return {
    enterpriseIds: ["37"],
    incorporadorId: CECILIO,
    nome: "Maria do Jurídico",
    slug: "cecilio-rocha",
    tipo: "portal",
    usuarioId: "usuario-portal-1",
    ...extra,
  };
}

function cards(...lista: Array<{ enterprise_id: string; operado_por: null | string }>) {
  estado.respostas.set("temis_trabalhos", { data: lista, error: null });
}

beforeEach(() => {
  estado.consultas = [];
  estado.leiturasDoCadastro = 0;
  estado.produtos = [...PRODUTOS_DE_16_DE_SETEMBRO];
  estado.respostas = new Map();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("alcanceDaProposta", () => {
  it("hub: dentro, sem consultar nada", async () => {
    expect(await alcanceDaProposta(sbFalso(), HUB, PROPOSTA)).toBe("dentro");
    expect(estado.consultas).toHaveLength(0);
  });

  it("portal: todos os cards dele, no escopo, entram", async () => {
    cards(
      { enterprise_id: "37", operado_por: CECILIO },
      { enterprise_id: "37", operado_por: CECILIO.toUpperCase() },
    );
    expect(await alcanceDaProposta(sbFalso(), portal(), PROPOSTA)).toBe("dentro");

    // A consulta é por proposta, SEM filtro de workspace: o mesmo conjunto que `moverCardDaTemis` move.
    const consulta = estado.consultas[0]!;
    expect(consulta.tabela).toBe("temis_trabalhos");
    expect(consulta.filtros).toContainEqual(["eq", "proposta_id", PROPOSTA]);
    expect(consulta.filtros.some((f) => f[1] === "workspace_id")).toBe(false);
  });

  it("a venda da Gurgel (card da Careli, operado_por nulo) fica fora", async () => {
    cards({ enterprise_id: "37", operado_por: null });
    expect(await alcanceDaProposta(sbFalso(), portal(), PROPOSTA)).toBe("fora");
  });

  it("card de outro incorporador fica fora", async () => {
    cards({ enterprise_id: "37", operado_por: LINO });
    expect(await alcanceDaProposta(sbFalso(), portal(), PROPOSTA)).toBe("fora");
  });

  it("dono misturado (contrato da Careli, cancelamento do portal) fica fora", async () => {
    cards(
      { enterprise_id: "37", operado_por: null },
      { enterprise_id: "37", operado_por: CECILIO },
    );
    expect(await alcanceDaProposta(sbFalso(), portal(), PROPOSTA)).toBe("fora");
  });

  it("card do próprio incorporador em empreendimento fora da sessão fica fora", async () => {
    cards({ enterprise_id: "36", operado_por: CECILIO });
    expect(await alcanceDaProposta(sbFalso(), portal(), PROPOSTA)).toBe("fora");
  });

  it("proposta sem card nenhum fica fora", async () => {
    cards();
    expect(await alcanceDaProposta(sbFalso(), portal(), PROPOSTA)).toBe("fora");
  });

  it("proposta vazia fica fora sem consultar", async () => {
    expect(await alcanceDaProposta(sbFalso(), portal(), "  ")).toBe("fora");
    expect(estado.consultas).toHaveLength(0);
  });

  it("0172 pendente: fora (sem a coluna, ninguém de fora é dono)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    estado.respostas.set("temis_trabalhos", {
      data: null,
      error: { code: "42703", message: 'column temis_trabalhos.operado_por does not exist' },
    });
    expect(await alcanceDaProposta(sbFalso(), portal(), PROPOSTA)).toBe("fora");
  });

  it("id que não é uuid: fora, calado", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    estado.respostas.set("temis_trabalhos", {
      data: null,
      error: { code: "22P02", message: "invalid input syntax for type uuid" },
    });
    expect(await alcanceDaProposta(sbFalso(), portal(), "abc")).toBe("fora");
    expect(erro).not.toHaveBeenCalled();
  });

  it("outra falha de leitura: indisponível (503), nunca 404", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    estado.respostas.set("temis_trabalhos", {
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });
    expect(await alcanceDaProposta(sbFalso(), portal(), PROPOSTA)).toBe("indisponivel");
  });
});

describe("alcanceDoDocumento", () => {
  it("hub: dentro, sem consultar", async () => {
    expect(await alcanceDoDocumento(sbFalso(), HUB, "doc-1")).toBe("dentro");
    expect(estado.consultas).toHaveLength(0);
  });

  it("portal: decide pela proposta do documento, e só lê documento do tipo contrato", async () => {
    estado.respostas.set("hercules_documentos", { data: { proposta_id: PROPOSTA }, error: null });
    cards({ enterprise_id: "37", operado_por: CECILIO });
    expect(await alcanceDoDocumento(sbFalso(), portal(), "doc-1")).toBe("dentro");

    const doc = estado.consultas[0]!;
    expect(doc.tabela).toBe("hercules_documentos");
    expect(doc.filtros).toContainEqual(["eq", "tipo", "contrato"]);
    expect(doc.filtros).toContainEqual(["is", "removido_em", null]);
  });

  it("documento de proposta da Careli fica fora", async () => {
    estado.respostas.set("hercules_documentos", { data: { proposta_id: PROPOSTA }, error: null });
    cards({ enterprise_id: "37", operado_por: null });
    expect(await alcanceDoDocumento(sbFalso(), portal(), "doc-1")).toBe("fora");
  });

  it("documento inexistente ou sem proposta fica fora", async () => {
    estado.respostas.set("hercules_documentos", { data: null, error: null });
    expect(await alcanceDoDocumento(sbFalso(), portal(), "doc-x")).toBe("fora");
    estado.respostas.set("hercules_documentos", { data: { proposta_id: null }, error: null });
    expect(await alcanceDoDocumento(sbFalso(), portal(), "doc-y")).toBe("fora");
  });
});

describe("alcanceDaMinutaPedida", () => {
  it("hub: dentro, sem consultar", async () => {
    expect(await alcanceDaMinutaPedida(sbFalso(), HUB, "minuta-1")).toBe("dentro");
    expect(estado.consultas).toHaveLength(0);
  });

  it("sem minuta pedida não há o que conferir", async () => {
    expect(await alcanceDaMinutaPedida(sbFalso(), portal(), "")).toBe("dentro");
    expect(estado.consultas).toHaveLength(0);
  });

  it("minuta de empreendimento da sessão entra", async () => {
    estado.respostas.set("temis_minutas", { data: { enterprise_id: "37" }, error: null });
    expect(await alcanceDaMinutaPedida(sbFalso(), portal(), "minuta-1")).toBe("dentro");
  });

  it("a divisão NÃO alcança a minuta do consolidado nem a de outra divisão", async () => {
    estado.respostas.set("temis_minutas", { data: { enterprise_id: "group:Vale do Ouro" }, error: null });
    expect(await alcanceDaMinutaPedida(sbFalso(), portal(), "minuta-1")).toBe("fora");
    estado.respostas.set("temis_minutas", { data: { enterprise_id: "36" }, error: null });
    expect(await alcanceDaMinutaPedida(sbFalso(), portal(), "minuta-2")).toBe("fora");
  });

  it("minuta inexistente fica fora", async () => {
    estado.respostas.set("temis_minutas", { data: null, error: null });
    expect(await alcanceDaMinutaPedida(sbFalso(), portal(), "minuta-x")).toBe("fora");
  });

  it("a MESMA régua de quem edita: a minuta do pai entra para o dono do conjunto inteiro", async () => {
    // VLO (35) é o pai do VOC (37) e do VOL (36) no cadastro. Quem tem os dois gera com a minuta
    // gravada no pai, que ele também edita pelo portal; quem tem só o VOC, não.
    estado.respostas.set("temis_minutas", { data: { enterprise_id: "35" }, error: null });
    estado.respostas.set("hercules_empreendimentos", { data: { id: "uuid-vlo" }, error: null });
    estado.respostas.set("hercules_empreendimentos:lista", {
      data: [{ c2x_enterprise_id: "37" }, { c2x_enterprise_id: "36" }],
      error: null,
    });
    expect(
      await alcanceDaMinutaPedida(sbFalso(), portal({ enterpriseIds: ["37", "36"] }), "minuta-pai"),
    ).toBe("dentro");
    expect(await alcanceDaMinutaPedida(sbFalso(), portal(), "minuta-pai")).toBe("fora");
  });

  it("falha ao ler a minuta é indisponível (503), nunca fora", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    estado.respostas.set("temis_minutas", { data: null, error: { code: "08006", message: "rede" } });
    expect(await alcanceDaMinutaPedida(sbFalso(), portal(), "minuta-1")).toBe("indisponivel");
  });
});

describe("alcanceDoEnvelope", () => {
  it("hub: dentro, sem consultar", async () => {
    expect(await alcanceDoEnvelope(sbFalso(), HUB, "env-1")).toBe("dentro");
    expect(estado.consultas).toHaveLength(0);
  });

  it("portal: decide pela proposta do envelope", async () => {
    estado.respostas.set("temis_envelopes", { data: [{ proposta_id: PROPOSTA }], error: null });
    cards({ enterprise_id: "37", operado_por: CECILIO });
    expect(await alcanceDoEnvelope(sbFalso(), portal(), "env-1")).toBe("dentro");
  });

  it("envelope de contrato da Careli fica fora", async () => {
    estado.respostas.set("temis_envelopes", { data: [{ proposta_id: PROPOSTA }], error: null });
    cards({ enterprise_id: "37", operado_por: null });
    expect(await alcanceDoEnvelope(sbFalso(), portal(), "env-1")).toBe("fora");
  });

  it("envelope sem registro, sem proposta ou com duas propostas fica fora", async () => {
    estado.respostas.set("temis_envelopes", { data: [], error: null });
    expect(await alcanceDoEnvelope(sbFalso(), portal(), "env-x")).toBe("fora");

    estado.respostas.set("temis_envelopes", { data: [{ proposta_id: null }], error: null });
    expect(await alcanceDoEnvelope(sbFalso(), portal(), "env-y")).toBe("fora");

    estado.respostas.set("temis_envelopes", {
      data: [{ proposta_id: PROPOSTA }, { proposta_id: "outra" }],
      error: null,
    });
    expect(await alcanceDoEnvelope(sbFalso(), portal(), "env-z")).toBe("fora");
  });

  it("falha ao ler o envelope: indisponível", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    estado.respostas.set("temis_envelopes", { data: null, error: { message: "timeout" } });
    expect(await alcanceDoEnvelope(sbFalso(), portal(), "env-1")).toBe("indisponivel");
  });
});

describe("alcanceDaPropostaParaEscrever (escrita só no que o portal opera)", () => {
  it("hub: dentro, sem consultar nem o card nem o cadastro", async () => {
    expect(await alcanceDaPropostaParaEscrever(sbFalso(), HUB, PROPOSTA)).toBe("dentro");
    expect(estado.consultas).toHaveLength(0);
    expect(estado.leiturasDoCadastro).toBe(0);
  });

  it("card dele no VOC (da Careli): só consulta; no Garden (dele): dentro", async () => {
    cards({ enterprise_id: "37", operado_por: CECILIO });
    expect(await alcanceDaPropostaParaEscrever(sbFalso(), portal(), PROPOSTA)).toBe("so-consulta");
    // A leitura continua dentro: a prévia abre.
    expect(await alcanceDaProposta(sbFalso(), portal(), PROPOSTA)).toBe("dentro");

    cards({ enterprise_id: "39", operado_por: CECILIO });
    expect(
      await alcanceDaPropostaParaEscrever(sbFalso(), portal({ enterpriseIds: ["37", "39"] }), PROPOSTA),
    ).toBe("dentro");
  });

  it("fora do alcance continua fora, sem perguntar ao cadastro", async () => {
    cards({ enterprise_id: "37", operado_por: null });
    expect(await alcanceDaPropostaParaEscrever(sbFalso(), portal(), PROPOSTA)).toBe("fora");
    expect(estado.leiturasDoCadastro).toBe(0);
  });

  it("envelope para consertar signatário segue a proposta dele na régua da escrita", async () => {
    cards({ enterprise_id: "37", operado_por: CECILIO });
    estado.respostas.set("temis_envelopes", { data: [{ proposta_id: PROPOSTA }], error: null });
    expect(await alcanceDoEnvelope(sbFalso(), portal(), "env-1")).toBe("dentro");
    expect(await alcanceDoEnvelope(sbFalso(), portal(), "env-1", "escrever")).toBe("so-consulta");
  });
});

describe("respostaDoAlcance", () => {
  it("dentro segue; fora é o 404 de todo o portal; indisponível é 503", async () => {
    expect(respostaDoAlcance("dentro")).toBeNull();

    const fora = respostaDoAlcance("fora")!;
    expect(fora.status).toBe(404);
    expect(await fora.json()).toEqual({ error: "Nao encontrado." });

    const indisponivel = respostaDoAlcance("indisponivel")!;
    expect(indisponivel.status).toBe(503);
  });

  it("só consulta é 403 com `erro` (a chave que as telas do contrato leem) e `soConsulta`", async () => {
    const resposta = respostaDoAlcance("so-consulta")!;
    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toEqual({
      erro: "Este produto está disponível só para consulta no seu portal.",
      soConsulta: true,
    });
  });
});

describe("autorDoAto", () => {
  it("hub: o usuário e o nome do hub, sem nada a mais", () => {
    expect(autorDoAto(HUB)).toEqual({ id: "user-hub", nome: "Jurídico Careli" });
  });

  it("hub sem nome: nulo, nunca inventado", () => {
    expect(autorDoAto({ ...HUB, nome: "  " })).toEqual({ id: "user-hub", nome: null });
  });

  it("portal: o usuário do portal e a origem escrita no nome", () => {
    expect(autorDoAto(portal())).toEqual({
      id: "usuario-portal-1",
      nome: "Maria do Jurídico (portal do incorporador)",
    });
  });

  it("portal sem nome: só a origem, sem inventar pessoa", () => {
    expect(autorDoAto(portal({ nome: "" }))).toEqual({
      id: "usuario-portal-1",
      nome: "Portal do incorporador",
    });
  });
});

describe("registrarAtoDoPortal", () => {
  it("hub não deixa log novo; portal registra incorporador, usuário e origem", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    registrarAtoDoPortal(HUB, "gerou o contrato", { propostaId: PROPOSTA });
    expect(info).not.toHaveBeenCalled();

    registrarAtoDoPortal(portal(), "gerou o contrato", { propostaId: PROPOSTA });
    expect(info).toHaveBeenCalledWith("[temis][portal] gerou o contrato", {
      incorporadorId: CECILIO,
      origem: "portal",
      propostaId: PROPOSTA,
      slug: "cecilio-rocha",
      usuarioId: "usuario-portal-1",
    });
  });
});
