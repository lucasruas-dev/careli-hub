import { beforeEach, describe, expect, it, vi } from "vitest";

// AS DUAS ROTAS DE CRÉDITO DO PORTAL: a porta, com COOKIE ASSINADO DE VERDADE.
//
// Decisão do Lucas (16/09/2026): a Cecílio faz a análise de crédito no portal (consulta paga na conta
// da Careli). A Gurgel (comercial) NÃO; os incorporadores padrão (cer...) nem sabem do Serasa. O que
// este arquivo trava, em GET/POST de `consultar` e em `aprovar-restricao`:
//   • sem sessão 401; comercial e padrão 404, sem revalidar conta e sem chegar no serviço;
//   • conta revalidada que caiu: a resposta da revalidação, sem serviço;
//   • CAD fora do escopo: 404, sem serviço (nada é consultado antes de provar que a CAD é dele);
//   • dentro do escopo: o serviço recebe o autor do portal, a ficha do ENDEREÇO e o empreendimento
//     do ESCOPO (nunca os do corpo).
//   • (16/09/2026, D1) as escritas (POST) só na CAD do produto que o portal opera (`operado_por`): a
//     do VOC (37) é 403 `soConsulta` sem chegar no serviço (nada cobrado); o GET (painel) segue.
// A regra em si (dígito verificador, reaproveitamento, rastro) é testada nos serviços, em lib/serasa.

const m = vi.hoisted(() => ({
  aprovar: vi.fn(async () => ({ corpo: { data: { ok: true } }, status: 200 })),
  cadNoEscopo: vi.fn(),
  cadastro: vi.fn(),
  consultar: vi.fn(async () => ({ corpo: { data: { reaproveitada: false } }, status: 200 })),
  recorte: vi.fn(),
  situacao: vi.fn(async () => ({
    corpo: { data: { configurado: true } },
    headers: { "Cache-Control": "no-store" },
    status: 200,
  })),
  temis: vi.fn(),
}));

vi.mock("@/lib/temis/portao-do-portal", () => ({ autorizarTemisDoPortal: m.temis }));
vi.mock("@/lib/apolo/incorporador/board-do-portal", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/incorporador/board-do-portal")>()),
  adminOu503: () => ({ client: { cliente: "admin" }, ok: true }),
  cadNoEscopo: m.cadNoEscopo,
  recorteDoProduto: m.recorte,
}));
vi.mock("@/lib/serasa/consulta-servico", () => ({
  consultarCredito: m.consultar,
  situacaoDoCredito: m.situacao,
}));
vi.mock("@/lib/serasa/aprovar-restricao-servico", () => ({ aprovarComRestricao: m.aprovar }));
// (D1) Quem opera cada produto: o Garden (39) é da Cecílio, o VOC (37) é da Careli.
vi.mock("@/lib/hercules/cadastro", async (original) => ({
  ...(await original<typeof import("@/lib/hercules/cadastro")>()),
  lerCadastroDeEmpreendimentos: m.cadastro,
}));

import { foraDoEscopo } from "@/lib/apolo/incorporador/escopo";
import {
  criarSessaoIncorporador,
  INCORPORADOR_COOKIE,
  type SessaoIncorporador,
} from "@/lib/apolo/incorporador/sessao";

import { POST as aprovar } from "./aprovar-restricao/route";
import { GET as situacao, POST as consultar } from "./consultar/route";

const ENTIDADE = "11111111-2222-4333-8444-555555555555";
const USUARIO = "7b1d2c3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";

type Perfil = Pick<SessaoIncorporador, "incorporadorId" | "slug" | "tipo">;
const CECILIO: Perfil = { incorporadorId: "inc-cecilio", slug: "cecilio-rocha", tipo: "incorporador" };
const GURGEL: Perfil = { incorporadorId: "inc-gurgel", slug: "gurgel", tipo: "comercial" };
const CER: Perfil = { incorporadorId: "inc-cer", slug: "cer", tipo: "incorporador" };

const SESSAO_VIGENTE = {
  enterpriseIds: ["39"],
  incorporadorId: "inc-cecilio",
  slug: "cecilio-rocha",
  tipo: "incorporador",
  usuarioId: USUARIO,
  usuarioNome: "Maria da Cecílio",
};

function pedido(metodo: "GET" | "POST", caminho: string, perfil: null | Perfil, corpo?: unknown) {
  vi.stubEnv("SESSAO_INCORPORADOR_SECRET", "segredo-de-teste-do-credito");
  const headers = new Headers({ "content-type": "application/json" });
  if (perfil) {
    const token = criarSessaoIncorporador(
      {
        enterpriseIds: ["39"],
        enterpriseIdsComCarteira: [],
        incorporadorNome: "Portal",
        usuarioId: USUARIO,
        usuarioNome: "Maria da Cecílio",
        ...perfil,
      },
      Date.now(),
    );
    headers.set("cookie", `${INCORPORADOR_COOKIE}=${token}`);
  }
  return new Request(`https://c2x.app.br/api/incorporador/board/${ENTIDADE}/serasa/${caminho}?emp=39`, {
    body: metodo === "POST" ? JSON.stringify(corpo ?? {}) : undefined,
    headers,
    method: metodo,
  });
}

const contexto = (id = ENTIDADE) => ({ params: Promise.resolve({ id }) });

type Rota = {
  chamar: (request: Request, ctx: ReturnType<typeof contexto>) => Promise<Response>;
  corpo?: Record<string, unknown>;
  metodo: "GET" | "POST";
  nome: string;
  servico: () => ReturnType<typeof vi.fn>;
  sufixo: string;
};

const ROTAS: Rota[] = [
  { chamar: situacao, metodo: "GET", nome: "GET consultar", servico: () => m.situacao, sufixo: "consultar" },
  {
    chamar: consultar,
    corpo: { confirmado: true, enterpriseId: "33", forcar: true },
    metodo: "POST",
    nome: "POST consultar",
    servico: () => m.consultar,
    sufixo: "consultar",
  },
  {
    chamar: aprovar,
    corpo: { enterpriseId: "33", fileBase64: "x", fileName: "a.pdf", motivo: "ok" },
    metodo: "POST",
    nome: "POST aprovar-restricao",
    servico: () => m.aprovar,
    sufixo: "aprovar-restricao",
  },
];

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockClear();
  m.temis.mockImplementation(async () => ({ ator: {}, ok: true, sessao: SESSAO_VIGENTE }));
  m.recorte.mockImplementation(async (_request: Request, sessao: unknown) => ({
    ok: true,
    recorte: { ids: new Set(["39"]), nomes: ["Garden"], sessao },
  }));
  m.cadNoEscopo.mockImplementation(async () => ({
    escopo: { enterpriseId: "39", imobiliaria: false },
    ok: true,
  }));
  m.cadastro.mockImplementation(async () => CADASTRO);
});

const linhaDoCadastro = (c2x: string, operadoPor: null | string) => ({
  c2xEnterpriseId: c2x,
  cidade: null,
  codigo: `P${c2x}`,
  id: `uuid-${c2x}`,
  nome: `Produto ${c2x}`,
  operadoPor,
  ordem: 0,
  paiId: null,
  uf: null,
  vendendo: true,
});
const CADASTRO = {
  com0170: true,
  linhas: [linhaDoCadastro("39", "inc-cecilio"), linhaDoCadastro("37", null)],
};

describe.each(ROTAS)("$nome", ({ chamar, corpo, metodo, servico, sufixo }) => {
  it("sem sessão: 401, sem serviço", async () => {
    const r = await chamar(pedido(metodo, sufixo, null, corpo), contexto());
    expect(r.status).toBe(401);
    expect(servico()).not.toHaveBeenCalled();
  });

  for (const perfil of [GURGEL, CER]) {
    it(`${perfil.slug} (${perfil.tipo}): 404 "Nao encontrado.", sem revalidar conta nem chegar no serviço`, async () => {
      const r = await chamar(pedido(metodo, sufixo, perfil, corpo), contexto());
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual(await foraDoEscopo().json());
      expect(m.temis).not.toHaveBeenCalled();
      expect(m.cadNoEscopo).not.toHaveBeenCalled();
      expect(servico()).not.toHaveBeenCalled();
    });
  }

  it("Cecílio com a conta que caiu (revalidação 404): 404, sem serviço", async () => {
    m.temis.mockImplementation(async () => ({ ok: false, response: foraDoEscopo() }));
    const r = await chamar(pedido(metodo, sufixo, CECILIO, corpo), contexto());
    expect(r.status).toBe(404);
    expect(m.cadNoEscopo).not.toHaveBeenCalled();
    expect(servico()).not.toHaveBeenCalled();
  });

  it("Cecílio com CAD fora do escopo: 404, sem serviço", async () => {
    m.cadNoEscopo.mockImplementation(async () => ({ ok: false, response: foraDoEscopo() }));
    const r = await chamar(pedido(metodo, sufixo, CECILIO, corpo), contexto());
    expect(r.status).toBe(404);
    expect(servico()).not.toHaveBeenCalled();
  });

  it("Cecílio com ficha de imobiliária: 409, sem serviço", async () => {
    m.cadNoEscopo.mockImplementation(async () => ({
      escopo: { enterpriseId: null, imobiliaria: true },
      ok: true,
    }));
    const r = await chamar(pedido(metodo, sufixo, CECILIO, corpo), contexto());
    expect(r.status).toBe(409);
    expect(servico()).not.toHaveBeenCalled();
  });

  it("Cecílio no escopo: o serviço recebe o autor do portal, a ficha do endereço e o empreendimento do escopo", async () => {
    const r = await chamar(pedido(metodo, sufixo, CECILIO, corpo), contexto());
    expect(r.status).toBe(200);
    expect(m.temis).toHaveBeenCalledTimes(1);
    // O recorte é feito com a sessão VIGENTE (a que a revalidação devolveu), não a do cookie.
    expect(m.recorte.mock.calls[0]?.[1]).toBe(SESSAO_VIGENTE);
    expect(servico()).toHaveBeenCalledTimes(1);

    const argumento = servico().mock.calls[0]?.[0] as {
      autor: Record<string, unknown>;
      corpo?: Record<string, unknown>;
      enterpriseId?: string;
      entityId?: string;
    };
    expect(argumento.autor).toEqual({
      incorporadorId: "inc-cecilio",
      nome: "Maria da Cecílio",
      slug: "cecilio-rocha",
      tipo: "portal",
      usuarioId: USUARIO,
    });
    if (metodo === "GET") {
      expect(argumento).toMatchObject({ enterpriseId: "39", entityId: ENTIDADE });
    } else {
      // O corpo pedia o empreendimento 33; quem manda é o escopo.
      expect(argumento.corpo).toMatchObject({ enterpriseId: "39", entityId: ENTIDADE });
    }
  });

  if (metodo === "POST") {
    it("Cecílio com outra ficha no corpo: 400, sem serviço", async () => {
      const r = await chamar(
        pedido(metodo, sufixo, CECILIO, { ...corpo, entityId: "99999999-2222-4333-8444-555555555555" }),
        contexto(),
      );
      expect(r.status).toBe(400);
      expect(servico()).not.toHaveBeenCalled();
    });
  }
});

describe("GET consultar", () => {
  it("devolve o cabeçalho no-store do serviço", async () => {
    const r = await situacao(pedido("GET", "consultar", CECILIO), contexto());
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
});

// (16/09/2026, D1) Decisão do Lucas: escrita só no que a Cecílio opera. O VOC (37) está no escopo
// dela, mas o crédito é da Careli.
describe("(D1) a CAD do produto que o portal não opera é só consulta", () => {
  const cadDoVoc = () =>
    m.cadNoEscopo.mockImplementation(async () => ({
      escopo: { enterpriseId: "37", imobiliaria: false },
      ok: true,
    }));

  it.each(ROTAS.filter((rota) => rota.metodo === "POST"))(
    "$nome na CAD do VOC (37): 403 soConsulta, sem chegar no serviço e com uma revalidação só",
    async ({ chamar, corpo, servico, sufixo }) => {
      cadDoVoc();
      const r = await chamar(pedido("POST", sufixo, CECILIO, corpo), contexto());
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({
        error: "Este produto está disponível só para consulta no seu portal.",
        soConsulta: true,
      });
      expect(servico()).not.toHaveBeenCalled();
      expect(m.temis).toHaveBeenCalledTimes(1);
    },
  );

  it("GET consultar na CAD do VOC (37): o painel é leitura e segue, sem ler o cadastro", async () => {
    cadDoVoc();
    const r = await situacao(pedido("GET", "consultar", CECILIO), contexto());
    expect(r.status).toBe(200);
    expect(m.situacao).toHaveBeenCalledTimes(1);
    expect(m.cadastro).not.toHaveBeenCalled();
  });

  it.each(ROTAS.filter((rota) => rota.metodo === "POST"))(
    "$nome sem a 0170: 503, sem chegar no serviço",
    async ({ chamar, corpo, servico, sufixo }) => {
      m.cadastro.mockImplementation(async () => ({ ...CADASTRO, com0170: false }));
      const r = await chamar(pedido("POST", sufixo, CECILIO, corpo), contexto());
      expect(r.status).toBe(503);
      expect(servico()).not.toHaveBeenCalled();
    },
  );
});
