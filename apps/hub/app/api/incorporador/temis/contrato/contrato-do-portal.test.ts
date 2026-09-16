import { beforeEach, describe, expect, it, vi } from "vitest";

// O CONTRATO PELO PORTAL — prévia, geração, abertura e edição à mão.
//
// Decisão do Lucas (16/09/2026): a equipe da Cecílio confecciona a própria venda no portal; a da
// Gurgel continua na Têmis da Careli. O que está travado aqui, rota a rota e verbo a verbo:
//   1. FORA DO ALCANCE (a venda da Gurgel no VOC, card da Careli) responde 404 e NADA é montado,
//      impresso, guardado, lido ou gravado;
//   2. DENTRO DO ALCANCE a mesma função do hub responde, com o autor do portal (origem escrita);
//   3. a porta do portal decide quem entra (401/404 dela passam direto);
//   4. O HUB NÃO MUDA: nenhuma consulta de alcance, e o autor é o do hub, sem sufixo;
//   5. ESCRITA SÓ NO QUE O PORTAL OPERA: o card do portal num produto só consulta (o VOC, da Careli)
//      abre a prévia e o que já foi gerado, e responde 403 a gerar, editar e descartar.
//
// A porta do portal para imprimir HTML em PDF foi apagada em 16/09/2026 (decisão do Lucas): nenhuma
// tela a usava, e ela entregava o Chromium a quem é de fora da Careli.
//
// A montagem, a gaveta, a edição e o Chromium são mockados: o teste é da PORTA e do RECORTE. As
// regras de alcance em si têm teste próprio em `lib/temis/contrato-servico.test.ts`.

const CECILIO = "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6";
const PROPOSTA = "641f22ac-6c4a-4133-afec-49fa7b7e1765";

const estado = vi.hoisted(() => ({
  cards: [] as Array<{ enterprise_id: string; operado_por: null | string }>,
  consultas: [] as Array<{ filtros: unknown[][]; tabela: string }>,
  documento: null as null | { proposta_id: null | string },
  leiturasDoCadastro: 0,
  minuta: null as null | { enterprise_id: string },
  porta: "cecilio" as "cecilio" | "fora" | "sem-sessao",
  produtos: [] as Array<{ c2x: string; operadoPor: null | string; pai?: string }>,
}));

// Só a leitura do cadastro é trocada; a régua de quem opera o produto é a de verdade.
vi.mock("@/lib/hercules/cadastro", async (importOriginal) => {
  const { cadastroDosProdutos } = await import("@/lib/temis/fixtures/produtos-operados");
  return {
    ...(await importOriginal<typeof import("@/lib/hercules/cadastro")>()),
    lerCadastroDeEmpreendimentos: async () => {
      estado.leiturasDoCadastro += 1;
      return { com0170: true, linhas: cadastroDosProdutos(estado.produtos) };
    },
  };
});

const espioes = vi.hoisted(() => ({
  abrirContratoGuardado: vi.fn(async () => ({ nome: "Contrato v1.pdf", ok: true, url: "https://x/sign/a" })),
  contratosDaProposta: vi.fn(async () => [{ criadoEm: "2026-09-16", id: "doc-1", nome: "v1", versao: 1 }]),
  descartarEdicao: vi.fn(async () => ({ ok: true })),
  gerarPdfDoHtml: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
  guardarContrato: vi.fn(async () => ({
    documentoId: "doc-2",
    nome: "Contrato v2.pdf",
    ok: true,
    protocolo: 7,
    tamanhoBytes: 4,
    versao: 2,
  })),
  lerEdicao: vi.fn(async () => null),
  montarContratoDaProposta: vi.fn(async () => ({
    avisos: [],
    gerais: {},
    html: "<p>Comprador: Henrique</p>",
    identidade: { comprador: "Henrique", empreendimento: "VOC", unidade: "Q01 L05" },
    minuta: { id: "minuta-voc", nome: "Minuta VOC", versao: 1 },
    ok: true,
    semValor: [],
    vezesDoLaco: 1,
  })),
  moverCardDaTemis: vi.fn(async () => {}),
  salvarEdicao: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/temis/portao-do-portal", async () => {
  const { NextResponse } = await import("next/server");
  return {
    autorizarTemisDoPortal: async () => {
      if (estado.porta === "sem-sessao") {
        return { ok: false, response: NextResponse.json({ error: "Sessao expirada." }, { status: 401 }) };
      }
      if (estado.porta === "fora") {
        return { ok: false, response: NextResponse.json({ error: "Nao encontrado." }, { status: 404 }) };
      }
      return {
        ator: {
          enterpriseIds: ["37", "39"],
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

vi.mock("@/lib/apolo/auth", () => {
  const passa = async () => ({ nome: "Jurídico Careli", ok: true, userId: "user-hub" });
  return { authorizeApoloCoordenacao: passa, authorizeApoloRead: passa };
});

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({
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
      const resposta = () => {
        if (tabela === "temis_trabalhos") return { data: estado.cards, error: null };
        if (tabela === "hercules_documentos") return { data: estado.documento, error: null };
        if (tabela === "temis_minutas") return { data: estado.minuta, error: null };
        return { data: null, error: null };
      };
      q.maybeSingle = async () => resposta();
      q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve(resposta()).then(ok, falha);
      return q;
    },
  }),
}));

vi.mock("@/lib/temis/contrato-da-proposta", () => ({
  montarContratoDaProposta: espioes.montarContratoDaProposta,
}));
vi.mock("@/lib/temis/contrato-editado-db", () => ({
  descartarEdicao: espioes.descartarEdicao,
  lerEdicao: espioes.lerEdicao,
  salvarEdicao: espioes.salvarEdicao,
}));
vi.mock("@/lib/temis/contrato-guardado-db", () => ({
  abrirContratoGuardado: espioes.abrirContratoGuardado,
  contratosDaProposta: espioes.contratosDaProposta,
  guardarContrato: espioes.guardarContrato,
}));
vi.mock("@/lib/temis/html-para-pdf", () => ({ gerarPdfDoHtml: espioes.gerarPdfDoHtml }));
vi.mock("@/lib/assinatura/estado-db", () => ({ moverCardDaTemis: espioes.moverCardDaTemis }));

import {
  DELETE as PORTAL_DESCARTAR,
  PUT as PORTAL_SALVAR,
} from "@/app/api/incorporador/temis/contrato/edicao/route";
import {
  GET as PORTAL_ABRIR,
  POST as PORTAL_GERAR,
} from "@/app/api/incorporador/temis/contrato/gerar/route";
import { POST as PORTAL_PREVIA } from "@/app/api/incorporador/temis/contrato/previa/route";
import { PUT as HUB_SALVAR } from "@/app/api/temis/contrato/edicao/route";
import { GET as HUB_ABRIR, POST as HUB_GERAR } from "@/app/api/temis/contrato/gerar/route";
import { POST as HUB_PREVIA } from "@/app/api/temis/contrato/previa/route";
import {
  PRODUTOS_DE_16_DE_SETEMBRO,
  TUDO_DA_CECILIO,
} from "@/lib/temis/fixtures/produtos-operados";

const BASE = "https://c2x.app.br/api/incorporador/temis";

function json(url: string, method: string, corpo: unknown): Request {
  return new Request(url, {
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
    method,
  });
}

/** Tudo o que monta, imprime, lê ou grava contrato. Fora do alcance, nenhum pode ter sido chamado. */
function nadaFoiTocado() {
  expect(espioes.montarContratoDaProposta).not.toHaveBeenCalled();
  expect(espioes.gerarPdfDoHtml).not.toHaveBeenCalled();
  expect(espioes.guardarContrato).not.toHaveBeenCalled();
  expect(espioes.moverCardDaTemis).not.toHaveBeenCalled();
  expect(espioes.lerEdicao).not.toHaveBeenCalled();
  expect(espioes.salvarEdicao).not.toHaveBeenCalled();
  expect(espioes.descartarEdicao).not.toHaveBeenCalled();
  expect(espioes.contratosDaProposta).not.toHaveBeenCalled();
  expect(espioes.abrirContratoGuardado).not.toHaveBeenCalled();
}

/** Cada verbo do portal, com um pedido que seria válido se a proposta fosse dele. */
const VERBOS: Array<[string, () => Promise<Response>]> = [
  ["prévia POST", () => PORTAL_PREVIA(json(`${BASE}/contrato/previa`, "POST", { propostaId: PROPOSTA }))],
  ["gerar POST", () => PORTAL_GERAR(json(`${BASE}/contrato/gerar`, "POST", { propostaId: PROPOSTA }))],
  ["gerar GET ?proposta", () => PORTAL_ABRIR(new Request(`${BASE}/contrato/gerar?proposta=${PROPOSTA}`))],
  ["gerar GET ?documento", () => PORTAL_ABRIR(new Request(`${BASE}/contrato/gerar?documento=doc-1&modo=ver`))],
  [
    "edição PUT",
    () => PORTAL_SALVAR(json(`${BASE}/contrato/edicao`, "PUT", { html: "<p>novo</p>", propostaId: PROPOSTA })),
  ],
  ["edição DELETE", () => PORTAL_DESCARTAR(new Request(`${BASE}/contrato/edicao?proposta=${PROPOSTA}`, { method: "DELETE" }))],
];

beforeEach(() => {
  estado.cards = [{ enterprise_id: "37", operado_por: CECILIO }];
  estado.consultas = [];
  estado.documento = { proposta_id: PROPOSTA };
  estado.leiturasDoCadastro = 0;
  estado.minuta = null;
  estado.porta = "cecilio";
  estado.produtos = [...TUDO_DA_CECILIO];
  for (const espiao of Object.values(espioes)) espiao.mockClear();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

// ── 1. FORA DO ALCANCE ──────────────────────────────────────────────────────

describe("portal: a venda da Gurgel (card da Careli) não existe para a Cecílio", () => {
  it.each(VERBOS)("%s responde 404 e não toca em nada", async (_nome, chamar) => {
    estado.cards = [{ enterprise_id: "37", operado_por: null }];
    const r = await chamar();
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Nao encontrado." });
    nadaFoiTocado();
  });

  it.each(VERBOS)("%s responde 404 para card de outro incorporador", async (_nome, chamar) => {
    estado.cards = [{ enterprise_id: "37", operado_por: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" }];
    expect((await chamar()).status).toBe(404);
    nadaFoiTocado();
  });

  it.each(VERBOS)("%s responde 404 quando a proposta não tem card", async (_nome, chamar) => {
    estado.cards = [];
    expect((await chamar()).status).toBe(404);
    nadaFoiTocado();
  });

  it("a minuta pedida de empreendimento fora da sessão responde 404 na prévia, na geração e na edição", async () => {
    estado.minuta = { enterprise_id: "36" };
    const corpo = { minutaId: "minuta-vol", propostaId: PROPOSTA };

    expect((await PORTAL_PREVIA(json(`${BASE}/contrato/previa`, "POST", corpo))).status).toBe(404);
    expect((await PORTAL_GERAR(json(`${BASE}/contrato/gerar`, "POST", corpo))).status).toBe(404);
    expect(
      (await PORTAL_SALVAR(json(`${BASE}/contrato/edicao`, "PUT", { ...corpo, html: "<p>x</p>" }))).status,
    ).toBe(404);
    nadaFoiTocado();
  });

  it("documento sem proposta responde 404 sem virar link", async () => {
    estado.documento = null;
    const r = await PORTAL_ABRIR(new Request(`${BASE}/contrato/gerar?documento=doc-x`));
    expect(r.status).toBe(404);
    nadaFoiTocado();
  });
});

// ── 2. DENTRO DO ALCANCE ────────────────────────────────────────────────────

describe("portal: a venda que a Cecílio confecciona", () => {
  it("a prévia responde e traz a edição vigente (quem confecciona é quem edita)", async () => {
    const r = await PORTAL_PREVIA(json(`${BASE}/contrato/previa`, "POST", { propostaId: PROPOSTA }));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { baseImpressao?: string; html: string };
    expect(corpo.html).toContain("Henrique");
    expect(typeof corpo.baseImpressao).toBe("string");
    expect(espioes.lerEdicao).toHaveBeenCalledWith(expect.anything(), PROPOSTA);
  });

  it("a geração guarda com o autor do portal e move o card com a mesma identidade", async () => {
    const r = await PORTAL_GERAR(json(`${BASE}/contrato/gerar`, "POST", { propostaId: PROPOSTA }));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { data: { versao: number } }).data.versao).toBe(2);

    const autor = { id: "usuario-portal-1", nome: "Maria do Jurídico (portal do incorporador)" };
    expect(espioes.guardarContrato).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ geradoPor: autor.id, geradoPorNome: autor.nome, propostaId: PROPOSTA }),
    );
    expect(espioes.moverCardDaTemis).toHaveBeenCalledWith(expect.anything(), PROPOSTA, "contrato", autor);
  });

  it("o GET lista os contratos da proposta e abre o documento dela", async () => {
    const lista = await PORTAL_ABRIR(new Request(`${BASE}/contrato/gerar?proposta=${PROPOSTA}`));
    expect(lista.status).toBe(200);
    expect(lista.headers.get("Cache-Control")).toBe("no-store");

    const aberto = await PORTAL_ABRIR(new Request(`${BASE}/contrato/gerar?documento=doc-1&modo=ver`));
    expect(aberto.status).toBe(200);
    expect(espioes.abrirContratoGuardado).toHaveBeenCalledWith(expect.anything(), "doc-1", "ver");
  });

  it("a edição grava com o usuário do portal e a origem escrita; o descarte responde", async () => {
    estado.minuta = { enterprise_id: "37" };
    const r = await PORTAL_SALVAR(
      json(`${BASE}/contrato/edicao`, "PUT", {
        html: "<p>cláusula nova</p><script>alert(1)</script>",
        minutaId: "minuta-voc",
        propostaId: PROPOSTA,
      }),
    );
    expect(r.status).toBe(200);
    expect(espioes.salvarEdicao).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        editadoPor: "usuario-portal-1",
        editadoPorNome: "Maria do Jurídico (portal do incorporador)",
        minutaId: "minuta-voc",
        propostaId: PROPOSTA,
      }),
    );
    // A faxina é a mesma do hub: o script não chega ao banco.
    const gravado = (espioes.salvarEdicao.mock.calls[0] as unknown as [unknown, { html: string }])[1];
    expect(gravado.html).not.toContain("<script");

    const d = await PORTAL_DESCARTAR(
      new Request(`${BASE}/contrato/edicao?proposta=${PROPOSTA}`, { method: "DELETE" }),
    );
    expect(d.status).toBe(200);
    expect(espioes.descartarEdicao).toHaveBeenCalledWith(expect.anything(), PROPOSTA);
  });
});

// ── 3. A PORTA DO PORTAL ────────────────────────────────────────────────────

describe("a porta do portal decide quem entra", () => {
  it("sem sessão: 401 da porta, nada consultado", async () => {
    estado.porta = "sem-sessao";
    const r = await PORTAL_GERAR(json(`${BASE}/contrato/gerar`, "POST", { propostaId: PROPOSTA }));
    expect(r.status).toBe(401);
    expect(estado.consultas).toHaveLength(0);
    nadaFoiTocado();
  });

  it("portal que não confecciona (Gurgel, cer): 404 da porta em todo verbo", async () => {
    estado.porta = "fora";
    for (const [, chamar] of VERBOS) expect((await chamar()).status).toBe(404);
    expect(estado.consultas).toHaveLength(0);
    nadaFoiTocado();
  });

});

// ── 5. ESCRITA SÓ NO QUE O PORTAL OPERA ─────────────────────────────────────────────────────

describe("portal: o card dele num produto só consulta (decisão do Lucas, 16/09/2026)", () => {
  const SO_CONSULTA = {
    erro: "Este produto está disponível só para consulta no seu portal.",
    soConsulta: true,
  };

  beforeEach(() => {
    estado.produtos = [...PRODUTOS_DE_16_DE_SETEMBRO];
  });

  it("gerar, editar e descartar no VOC (da Careli): 403 com `erro`, e nada montado nem gravado", async () => {
    const gerar = await PORTAL_GERAR(json(`${BASE}/contrato/gerar`, "POST", { propostaId: PROPOSTA }));
    expect(gerar.status).toBe(403);
    expect(await gerar.json()).toEqual(SO_CONSULTA);

    expect(
      (await PORTAL_SALVAR(json(`${BASE}/contrato/edicao`, "PUT", { html: "<p>x</p>", propostaId: PROPOSTA })))
        .status,
    ).toBe(403);
    expect(
      (await PORTAL_DESCARTAR(new Request(`${BASE}/contrato/edicao?proposta=${PROPOSTA}`, { method: "DELETE" })))
        .status,
    ).toBe(403);
    nadaFoiTocado();
  });

  it("ler continua: a prévia e o que já foi gerado abrem no VOC", async () => {
    expect((await PORTAL_PREVIA(json(`${BASE}/contrato/previa`, "POST", { propostaId: PROPOSTA }))).status).toBe(
      200,
    );
    expect((await PORTAL_ABRIR(new Request(`${BASE}/contrato/gerar?proposta=${PROPOSTA}`))).status).toBe(200);
  });

  it("o card no Garden, operado pela Cecílio: gera", async () => {
    estado.cards = [{ enterprise_id: "39", operado_por: CECILIO }];
    const r = await PORTAL_GERAR(json(`${BASE}/contrato/gerar`, "POST", { propostaId: PROPOSTA }));
    expect(r.status).toBe(200);
    expect(espioes.guardarContrato).toHaveBeenCalled();
  });

  it("proposta com um card no Garden e outro no VOC: só consulta (um card basta para recusar)", async () => {
    estado.cards = [
      { enterprise_id: "39", operado_por: CECILIO },
      { enterprise_id: "37", operado_por: CECILIO },
    ];
    expect((await PORTAL_GERAR(json(`${BASE}/contrato/gerar`, "POST", { propostaId: PROPOSTA }))).status).toBe(
      403,
    );
    nadaFoiTocado();
  });

  it("o hub gera no VOC sem ler o cadastro", async () => {
    const r = await HUB_GERAR(
      new Request("https://c2x.app.br/api/temis/contrato/gerar", {
        body: JSON.stringify({ propostaId: PROPOSTA }),
        headers: { authorization: "Bearer tok", "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(r.status).toBe(200);
    expect(estado.leiturasDoCadastro).toBe(0);
  });
});

// ── 4. O HUB NÃO MUDA ───────────────────────────────────────────────────────

describe("hub: mesma função, sem recorte e com o autor de sempre", () => {
  const HUB = "https://c2x.app.br/api/temis";
  const BEARER = { authorization: "Bearer tok", "content-type": "application/json" };

  it("a venda da Gurgel continua abrindo no hub, sem consulta de alcance", async () => {
    estado.cards = [{ enterprise_id: "37", operado_por: null }];

    const previa = await HUB_PREVIA(
      new Request(`${HUB}/contrato/previa`, { body: JSON.stringify({ propostaId: PROPOSTA }), headers: BEARER, method: "POST" }),
    );
    expect(previa.status).toBe(200);

    const gerado = await HUB_GERAR(
      new Request(`${HUB}/contrato/gerar`, { body: JSON.stringify({ propostaId: PROPOSTA }), headers: BEARER, method: "POST" }),
    );
    expect(gerado.status).toBe(200);

    const aberto = await HUB_ABRIR(new Request(`${HUB}/contrato/gerar?documento=doc-1`, { headers: BEARER }));
    expect(aberto.status).toBe(200);

    // ⚠️ NENHUMA leitura de alcance: nem cards, nem documento, nem minuta, nem `hub_users`.
    expect(estado.consultas).toHaveLength(0);
  });

  it("o autor do hub é o do portão, sem sufixo de origem", async () => {
    await HUB_GERAR(
      new Request(`${HUB}/contrato/gerar`, { body: JSON.stringify({ propostaId: PROPOSTA }), headers: BEARER, method: "POST" }),
    );
    const autor = { id: "user-hub", nome: "Jurídico Careli" };
    expect(espioes.guardarContrato).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ geradoPor: autor.id, geradoPorNome: autor.nome }),
    );
    expect(espioes.moverCardDaTemis).toHaveBeenCalledWith(expect.anything(), PROPOSTA, "contrato", autor);

    await HUB_SALVAR(
      new Request(`${HUB}/contrato/edicao`, {
        body: JSON.stringify({ html: "<p>x</p>", minutaId: "qualquer", propostaId: PROPOSTA }),
        headers: BEARER,
        method: "PUT",
      }),
    );
    expect(espioes.salvarEdicao).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ editadoPor: "user-hub", editadoPorNome: "Jurídico Careli", minutaId: "qualquer" }),
    );
    expect(estado.consultas).toHaveLength(0);
  });

  it("o hub não deixa log de portal", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await HUB_GERAR(
      new Request(`${HUB}/contrato/gerar`, { body: JSON.stringify({ propostaId: PROPOSTA }), headers: BEARER, method: "POST" }),
    );
    expect(info).not.toHaveBeenCalled();
  });
});
