import { beforeEach, describe, expect, it, vi } from "vitest";

// O RECORTE DO GRUPO TRABALHO DA TÊMIS — a parte que decide, sem rota nenhuma na frente.
//
// O que está travado aqui: o ator do hub; o recorte de empreendimentos (hub sem recorte, portal com
// a lista da sessão, vazio nunca vira "tudo"); o filtro do board (hub igual ao de antes, portal só
// com o próprio dono e com o parâmetro que só reduz); o canal `iris` fora do portal; e as duas
// conferências de alcance que rodam ANTES da leitura (trabalho pelo dono, proposta pelos trabalhos
// dela), inclusive com a 0172 pendente.

const estado = vi.hoisted(() => ({
  donos: {} as Record<string, { enterprise_id: string; operado_por: null | string }>,
}));

vi.mock("@/lib/temis/trabalhos-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/temis/trabalhos-db")>()),
  donoDoTrabalho: vi.fn(async (id: string) => estado.donos[id] ?? null),
}));

// Os documentos do proponente no portal: o que importa aqui é o CONTEXTO que a Têmis passa à régua de
// toda porta de portal. A régua em si tem teste próprio (`documentos-do-portal.test.ts`).
const portaDosDocumentos = vi.hoisted(() => ({
  documentosDoApoloParaPortal: vi.fn(async () => []),
}));
vi.mock("@/lib/apolo/incorporador/documentos-do-portal", () => portaDosDocumentos);

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({
    from: (tabela: string) => {
      const q: Record<string, unknown> = {};
      for (const metodo of ["eq", "in", "is", "limit", "order", "select"]) q[metodo] = () => q;
      const resposta = () => {
        if (tabela === "temis_trabalhos") {
          return { data: [{ enterprise_id: "37", operado_por: CECILIO_DO_MOCK }], error: null };
        }
        if (tabela === "hercules_propostas") return { data: { cliente_entity_id: "pessoa-1" }, error: null };
        return { data: [], error: null };
      };
      q.maybeSingle = async () => resposta();
      q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve(resposta()).then(ok, falha);
      return q;
    },
  }),
}));

const CECILIO_DO_MOCK = "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AtorDoHub, AtorDoPortal } from "./ator";
import {
  atorDoHub,
  canaisDoAtor,
  filtroDoBoard,
  lerDocumentosDoTrabalho,
  propostaAlcancavel,
  recorteDeEmpreendimentos,
  trabalhoAlcancavel,
} from "./trabalho-servico";
import { donoDoTrabalho } from "./trabalhos-db";

const CECILIO = "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6";
const OUTRO = "11111111-2222-4333-8444-555555555555";

const HUB: AtorDoHub = { nome: "Jurídico", papel: "leitura", tipo: "hub", userId: "user-hub" };

const PORTAL: AtorDoPortal = {
  enterpriseIds: ["37", "group:Lagoa Bonita", "33", "27", "32"],
  incorporadorId: CECILIO,
  nome: "Maria do Jurídico",
  slug: "cecilio-rocha",
  tipo: "portal",
  usuarioId: "usuario-portal-1",
};

beforeEach(() => {
  estado.donos = {};
  vi.mocked(donoDoTrabalho).mockClear();
});

describe("atorDoHub", () => {
  it("monta o ator com o nome do portão; nome ausente vira texto vazio", () => {
    expect(atorDoHub({ nome: "Jurídico", userId: "u1" }, "coordenacao")).toEqual({
      nome: "Jurídico",
      papel: "coordenacao",
      tipo: "hub",
      userId: "u1",
    });
    expect(atorDoHub({ nome: null, userId: "u1" }, "leitura").nome).toBe("");
  });
});

describe("recorteDeEmpreendimentos", () => {
  it("hub não tem recorte", () => {
    expect(recorteDeEmpreendimentos(HUB)).toBeNull();
  });

  it("portal devolve a lista aparada e sem repetição; vazia continua vazia", () => {
    expect(
      recorteDeEmpreendimentos({ ...PORTAL, enterpriseIds: [" 37 ", "37", "", "33"] }),
    ).toEqual(["37", "33"]);
    expect(recorteDeEmpreendimentos({ ...PORTAL, enterpriseIds: [] })).toEqual([]);
  });
});

describe("filtroDoBoard", () => {
  it("hub: o mesmo pedido de antes, com o dono padrão careli", () => {
    expect(filtroDoBoard(HUB, {})).toEqual({
      comAssinaturas: true,
      enterpriseId: undefined,
      operadoPor: "careli",
    });
    expect(filtroDoBoard(HUB, { empreendimento: " 37 ", incluir: "incorporadores" })).toEqual({
      comAssinaturas: true,
      enterpriseId: "37",
      operadoPor: "todos",
    });
  });

  it("portal: só o próprio dono, dentro da sessão inteira", () => {
    expect(filtroDoBoard(PORTAL, {})).toEqual({
      comAssinaturas: true,
      enterpriseIds: PORTAL.enterpriseIds,
      operadoPor: CECILIO,
    });
  });

  it("portal: o parâmetro só reduz, e ?incluir= não abre nada", () => {
    expect(filtroDoBoard(PORTAL, { empreendimento: "33", incluir: "incorporadores" })).toEqual({
      comAssinaturas: true,
      enterpriseIds: ["33"],
      operadoPor: CECILIO,
    });
  });

  it("portal: empreendimento fora da sessão é fora do alcance", () => {
    expect(filtroDoBoard(PORTAL, { empreendimento: "99" })).toBeNull();
  });

  it("portal: sessão com só a divisão não alcança o consolidado", () => {
    const soDivisao: AtorDoPortal = { ...PORTAL, enterpriseIds: ["33"] };
    expect(filtroDoBoard(soDivisao, { empreendimento: "group:Lagoa Bonita" })).toBeNull();
  });

  it("portal sem empreendimento nenhum não vira board inteiro", () => {
    expect(filtroDoBoard({ ...PORTAL, enterpriseIds: [] }, {})).toBeNull();
  });

  it("portal: os ids expandidos de um pai:<uuid> só reduzem, e nada sobrando é 404", () => {
    expect(filtroDoBoard(PORTAL, { empreendimento: "pai:x", expandidos: ["33", "99"] })).toEqual({
      comAssinaturas: true,
      enterpriseIds: ["33"],
      operadoPor: CECILIO,
    });
    expect(filtroDoBoard(PORTAL, { empreendimento: "pai:x", expandidos: ["99"] })).toBeNull();
    expect(filtroDoBoard(PORTAL, { empreendimento: "pai:x", expandidos: [] })).toBeNull();
  });
});

describe("canaisDoAtor", () => {
  it("o portal não abre pelo canal da Iris", () => {
    expect(canaisDoAtor(HUB)).toContain("iris");
    expect(canaisDoAtor(PORTAL)).toEqual(["coordenador", "hercules"]);
  });
});

describe("trabalhoAlcancavel", () => {
  it("hub: sim, sem consultar o dono", async () => {
    await expect(trabalhoAlcancavel(HUB, "qualquer")).resolves.toBe(true);
    expect(donoDoTrabalho).not.toHaveBeenCalled();
  });

  it("portal: só o card do próprio incorporador, dentro do escopo", async () => {
    estado.donos = {
      "t-careli": { enterprise_id: "37", operado_por: null },
      "t-cecilio": { enterprise_id: "37", operado_por: CECILIO },
      "t-fora": { enterprise_id: "99", operado_por: CECILIO },
      "t-outro": { enterprise_id: "37", operado_por: OUTRO },
    };
    await expect(trabalhoAlcancavel(PORTAL, "t-cecilio")).resolves.toBe(true);
    await expect(trabalhoAlcancavel(PORTAL, "t-careli")).resolves.toBe(false);
    await expect(trabalhoAlcancavel(PORTAL, "t-outro")).resolves.toBe(false);
    await expect(trabalhoAlcancavel(PORTAL, "t-fora")).resolves.toBe(false);
    await expect(trabalhoAlcancavel(PORTAL, "nao-existe")).resolves.toBe(false);
  });
});

type Filtro = unknown[];

/** Um Supabase falso que anota os filtros e responde o que o teste mandar. */
function supabaseFalso(resposta: { data: unknown; error: unknown }) {
  const filtros: Filtro[] = [];
  const q: Record<string, unknown> = {};
  for (const metodo of ["select", "eq", "limit"]) {
    q[metodo] = (...args: unknown[]) => {
      filtros.push([metodo, ...args]);
      return q;
    };
  }
  q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
    Promise.resolve(resposta).then(ok, falha);
  const sb = { from: vi.fn(() => q) };
  return { filtros, sb: sb as unknown as SupabaseClient & { from: typeof sb.from } };
}

describe("propostaAlcancavel", () => {
  it("hub: sim, sem consulta", async () => {
    const { sb } = supabaseFalso({ data: [], error: null });
    await expect(propostaAlcancavel(HUB, sb, "p-1")).resolves.toBe(true);
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("portal: pergunta com o dono NA CONSULTA e aceita o trabalho no escopo", async () => {
    const { filtros, sb } = supabaseFalso({
      data: [{ enterprise_id: "37", operado_por: CECILIO }],
      error: null,
    });
    await expect(propostaAlcancavel(PORTAL, sb, " p-1 ")).resolves.toBe(true);
    expect(sb.from).toHaveBeenCalledWith("temis_trabalhos");
    expect(filtros).toContainEqual(["eq", "proposta_id", "p-1"]);
    expect(filtros).toContainEqual(["eq", "operado_por", CECILIO]);
    expect(filtros).toContainEqual(["eq", "workspace_id", "careli"]);
  });

  it("portal: nenhum trabalho dele (a venda da Gurgel) é não", async () => {
    const { sb } = supabaseFalso({ data: [], error: null });
    await expect(propostaAlcancavel(PORTAL, sb, "p-gurgel")).resolves.toBe(false);
  });

  it("portal: trabalho dele fora do escopo da sessão é não", async () => {
    const { sb } = supabaseFalso({
      data: [{ enterprise_id: "99", operado_por: CECILIO }],
      error: null,
    });
    await expect(propostaAlcancavel(PORTAL, sb, "p-1")).resolves.toBe(false);
  });

  it("portal: proposta vazia nem consulta", async () => {
    const { sb } = supabaseFalso({ data: [], error: null });
    await expect(propostaAlcancavel(PORTAL, sb, "  ")).resolves.toBe(false);
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("portal: 0172 pendente, id torto e erro de leitura são não", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const error of [
      { code: "42703", message: "column temis_trabalhos.operado_por does not exist" },
      { code: "22P02", message: "invalid input syntax for type uuid" },
      { code: "XX000", message: "caiu" },
    ]) {
      const { sb } = supabaseFalso({ data: null, error });
      await expect(propostaAlcancavel(PORTAL, sb, "p-1")).resolves.toBe(false);
    }
    // Só o erro inesperado grita no log; os dois conhecidos ficam calados.
    expect(erro).toHaveBeenCalledTimes(1);
    erro.mockRestore();
  });
});

describe("os documentos do proponente no card do portal (crédito no portal)", () => {
  it("a Têmis do portal pede a régua de quem opera sozinho: o comprovante do Serasa do escopo sai", async () => {
    portaDosDocumentos.documentosDoApoloParaPortal.mockClear();
    const r = await lerDocumentosDoTrabalho(
      PORTAL,
      new Request("https://c2x.app.br/api/incorporador/temis/trabalho/documentos?proposta=p-1"),
    );
    expect(r.status).toBe(200);
    expect(portaDosDocumentos.documentosDoApoloParaPortal).toHaveBeenCalledWith(
      expect.anything(),
      "pessoa-1",
      expect.objectContaining({ comercial: false, imobiliaria: false, operaSozinho: true }),
    );
  });
});
