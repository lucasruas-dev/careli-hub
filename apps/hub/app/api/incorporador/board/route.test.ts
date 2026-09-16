import { beforeEach, describe, expect, it, vi } from "vitest";

// A FILA DO BOARD PELO PORTAL, NAS DUAS PORTAS QUE OPERAM A VENDA, com COOKIE ASSINADO DE VERDADE.
//
// (16/09/2026, D4) Decisão do Lucas: a Gurgel (comercial) volta a ver os nomes dos analistas da Careli
// como antes da onda 1; a Cecílio (portal que opera sozinho) vê "Equipe Careli". O que se trava aqui:
//   • a rota só pede os nomes (`comAnalistasDoHub`) para o comercial;
//   • o comercial recebe a lista como o servidor montou, com os `analistaId` de sempre;
//   • o Cecílio recebe só a conta dele e "Equipe Careli", sem nome nem e-mail da equipe.
// A montagem da fila é trocada por uma que honra `comAnalistasDoHub` como o servidor (a linha do
// servidor é amarrada em lib/apolo/incorporador/analistas-do-portal.test.ts).

const m = vi.hoisted(() => ({ fila: vi.fn(), recorte: vi.fn() }));

vi.mock("@/lib/apolo/board-do-servidor", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/board-do-servidor")>()),
  montarFilaDoBoard: m.fila,
}));
vi.mock("@/lib/apolo/incorporador/board-do-portal", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/incorporador/board-do-portal")>()),
  adminOu503: () => ({ client: { cliente: "admin" }, ok: true }),
  recorteDoProduto: m.recorte,
}));

import type { RecorteDaFila } from "@/lib/apolo/board-do-servidor";
import { ID_EQUIPE_CARELI } from "@/lib/apolo/incorporador/analistas-do-portal";
import { EQUIPE_CARELI } from "@/lib/apolo/incorporador/historico-do-portal";
import {
  criarSessaoIncorporador,
  INCORPORADOR_COOKIE,
  type SessaoIncorporador,
} from "@/lib/apolo/incorporador/sessao";

import { GET } from "./route";

const USUARIO = "7b1d2c3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
const EQUIPE_DO_HUB = [
  { id: "hub-1", nome: "Ana da Careli" },
  { id: "hub-2", nome: "bruno@careli.adm.br" },
];

type Perfil = Pick<SessaoIncorporador, "slug" | "tipo">;
const CECILIO: Perfil = { slug: "cecilio-rocha", tipo: "incorporador" };
const GURGEL: Perfil = { slug: "gurgel", tipo: "comercial" };

function pedido(perfil: Perfil) {
  vi.stubEnv("SESSAO_INCORPORADOR_SECRET", "segredo-de-teste-da-fila");
  const token = criarSessaoIncorporador(
    {
      enterpriseIds: ["39"],
      enterpriseIdsComCarteira: [],
      incorporadorId: `inc-${perfil.slug}`,
      incorporadorNome: "Portal",
      usuarioId: USUARIO,
      usuarioNome: "Maria",
      ...perfil,
    },
    Date.now(),
  );
  return new Request("https://c2x.app.br/api/incorporador/board?emp=39", {
    headers: new Headers({ cookie: `${INCORPORADOR_COOKIE}=${token}` }),
  });
}

const card = (analistaId: null | string, id: string) => ({
  analistaId,
  c2xErro: null,
  c2xFalha: null,
  corretor: null,
  corretores: 0,
  criadoEm: "2026-09-16T12:00:00Z",
  documento: "529.982.247-25",
  empreendimentos: ["Garden"],
  enterpriseId: "39",
  entidadeStatus: null,
  erroEnvio: false,
  etapa: "validacao",
  id,
  imobiliaria: null,
  motivo: null,
  nome: "Fulano",
  pagoEm: null,
  papel: "prospect",
  papelStatus: null,
  prevendaHabilitada: false,
  semCad: false,
  socios: 0,
});

beforeEach(() => {
  m.recorte.mockReset();
  m.fila.mockReset();
  m.recorte.mockImplementation(async (_request: Request, sessao: unknown) => ({
    ok: true,
    recorte: { ids: new Set(["39"]), nomes: ["Garden"], sessao },
  }));
  // Como o servidor: com o recorte, a lista de `hub_users` só sai quando pedem.
  m.fila.mockImplementation(async (_client: unknown, opts: { recorte: RecorteDaFila }) => ({
    data: {
      analistas: opts.recorte.comAnalistasDoHub === true ? EQUIPE_DO_HUB : [],
      empreendimentos: ["Garden"],
      itens: [card("hub-1", "a"), card(null, "b")],
      usuarioAtual: { id: USUARIO, nome: "Maria" },
    },
    ok: true,
  }));
});

type Fila = {
  data: { analistas: Array<{ id: string; nome: string }>; itens: Array<{ analistaId: null | string }> };
};

describe("GET /api/incorporador/board: os analistas por porta (D4)", () => {
  it("comercial (Gurgel): pede os nomes e recebe a equipe da Careli como antes da onda 1", async () => {
    const r = await GET(pedido(GURGEL));
    expect(r.status).toBe(200);
    expect((m.fila.mock.calls[0] as [unknown, { recorte: RecorteDaFila }])[1].recorte.comAnalistasDoHub).toBe(true);

    const corpo = (await r.json()) as Fila;
    expect(corpo.data.analistas).toEqual(EQUIPE_DO_HUB);
    expect(corpo.data.itens.map((item) => item.analistaId)).toEqual(["hub-1", null]);
  });

  it("portal que opera sozinho (Cecílio): não pede os nomes e vê só a conta dele e 'Equipe Careli'", async () => {
    const r = await GET(pedido(CECILIO));
    expect(r.status).toBe(200);
    expect((m.fila.mock.calls[0] as [unknown, { recorte: RecorteDaFila }])[1].recorte.comAnalistasDoHub).toBe(false);

    const corpo = (await r.json()) as Fila;
    expect(corpo.data.analistas).toEqual([
      { id: USUARIO, nome: "Maria" },
      { id: ID_EQUIPE_CARELI, nome: EQUIPE_CARELI },
    ]);
    expect(corpo.data.itens.map((item) => item.analistaId)).toEqual([ID_EQUIPE_CARELI, null]);
    expect(JSON.stringify(corpo)).not.toMatch(/Ana da Careli|bruno@careli|hub-1/);
  });
});
