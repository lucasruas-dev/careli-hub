import { beforeEach, describe, expect, it, vi } from "vitest";

// AS MINUTAS PELO PORTAL — listar, abrir, criar, salvar, publicar, arquivar, mídia do editor e o
// agente. E a prova de que a mesma função, chamada pelo hub, continua igual.
//
// Decisão do Lucas (16/09/2026): a equipe da Cecílio *"também cria e edita os modelos"* dos produtos
// dela. O que está travado aqui, rota a rota e verbo a verbo:
//   1. FORA DO ALCANCE (a minuta do VOL, do Lino; a do consolidado VLO para quem só tem o VOC; um
//      uuid torto) responde 404 e NADA é lido, gravado ou assinado no Storage;
//   2. DENTRO DO ALCANCE responde como o hub, com o autor "(portal do incorporador)";
//   3. a porta do portal decide quem entra (401/404 dela passam direto, sem consulta);
//   4. O HUB NÃO MUDA: abre a minuta de qualquer empreendimento sem consulta de alcance, e o autor é
//      o de `hub_users`, sem sufixo;
//   5. a 0173 pendente não trava ninguém: publicar e arquivar gravam sem o nome do ato;
//   6. ESCRITA SÓ NO QUE O PORTAL OPERA (decisão do Lucas, 16/09/2026): com o cadastro de verdade, a
//      minuta do VOC (Careli) abre e responde 403 só consulta a criar, salvar, publicar, arquivar,
//      subir mídia e chamar o agente, sem gravar nem chamar o modelo; a do Garden (Cecílio) segue.
//
// ⚠️ O CADASTRO DOS PRODUTOS É TROCADO SÓ NA LEITURA (`lerCadastroDeEmpreendimentos`); a régua de
// quem opera é a de verdade. Nos grupos 1 a 5 todos os produtos são da Cecílio (o cenário do
// escopo, anterior à régua); o grupo 6 usa o cadastro de 16/09/2026.
//
// Supabase em memória (`lib/temis/fixtures/supabase-em-memoria.ts`); a IA é falsa. Cadastro medido
// em 16/09/2026: VLO = 35 (pai), VOC = 37, VOL = 36, VOR = 41; a Cecílio tem 37 e 39.

const CECILIO = "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6";
const MINUTA_VOC = "11111111-1111-4111-8111-111111111111";
const MINUTA_VOL = "22222222-2222-4222-8222-222222222222";
const MINUTA_VLO = "33333333-3333-4333-8333-333333333333";

const MINUTA_GDN = "44444444-4444-4444-8444-444444444444";

const estado = vi.hoisted(() => ({
  banco: null as unknown,
  com0170: true,
  leiturasDoCadastro: 0,
  porta: "cecilio" as "cecilio" | "conjunto" | "fora" | "sem-sessao",
  produtos: [] as Array<{ c2x: string; operadoPor: null | string; pai?: string }>,
  stream: null as unknown,
  teto: vi.fn(async () => true),
}));

vi.mock("@/lib/hercules/cadastro", async (importOriginal) => {
  const { cadastroDosProdutos } = await import("@/lib/temis/fixtures/produtos-operados");
  return {
    ...(await importOriginal<typeof import("@/lib/hercules/cadastro")>()),
    lerCadastroDeEmpreendimentos: async () => {
      estado.leiturasDoCadastro += 1;
      return { com0170: estado.com0170, linhas: cadastroDosProdutos(estado.produtos) };
    },
  };
});

// O teto por usuário do portal (revisão da onda 3): o contador em si é o do público, testado lá.
vi.mock("@/lib/apolo/incorporador/teto-do-portal", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/incorporador/teto-do-portal")>()),
  cabeNoTetoDoPortal: estado.teto,
}));

vi.mock("@/lib/guardian/db", () => ({ getHadesDbPool: () => ({ ok: false }) }));

vi.mock("@/lib/apolo/server", async () => {
  const { clienteEmMemoria } = await import("@/lib/temis/fixtures/supabase-em-memoria");
  return {
    createApoloAdminClient: () =>
      clienteEmMemoria(estado.banco as Parameters<typeof clienteEmMemoria>[0]),
  };
});

vi.mock("@/lib/apolo/auth", () => {
  const autorizar = async () => ({ nome: "Jurídico Careli", ok: true, userId: "user-1" });
  return { authorizeApoloRead: autorizar, authorizeApoloWrite: autorizar };
});

vi.mock("@/lib/ai/claude", () => ({
  CLAUDE_MODEL: { frontier: "modelo-de-teste" },
  getAnthropicClient: () => ({ messages: { stream: estado.stream } }),
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
          enterpriseIds: estado.porta === "conjunto" ? ["group:Vale do Ouro", "37", "36", "41"] : ["37", "39"],
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

import * as hubConversar from "@/app/api/temis/minutas/conversar/route";
import * as hubMarcar from "@/app/api/temis/minutas/marcar/route";
import * as hubMinutas from "@/app/api/temis/minutas/route";
import * as hubUpload from "@/app/api/temis/minutas/upload/route";
import {
  PRODUTOS_DE_16_DE_SETEMBRO,
  TUDO_DA_CECILIO,
} from "@/lib/temis/fixtures/produtos-operados";
import {
  type EstadoDoBanco,
  gravacoesEm,
  novoEstado,
} from "@/lib/temis/fixtures/supabase-em-memoria";

import * as portalConversar from "./conversar/route";
import * as portalMarcar from "./marcar/route";
import * as portalMinutas from "./route";
import * as portalUpload from "./upload/route";

const banco = () => estado.banco as EstadoDoBanco;

const minuta = (id: string, enterpriseId: string, extra: Record<string, unknown> = {}) => ({
  conteudo: null,
  conteudo_html: "<p>Contrato de [nome_cliente]</p>",
  criado_por_nome: "Jurídico Careli",
  enterprise_id: enterpriseId,
  id,
  nome: `Minuta ${enterpriseId}`,
  situacao: "rascunho",
  tipo: "contrato",
  versao: 1,
  workspace_id: "careli",
  ...extra,
});

beforeEach(() => {
  const novo = novoEstado();
  novo.tabelas = {
    hercules_empreendimentos: [
      { c2x_enterprise_id: "35", codigo: "VLO", id: "h-vlo", pai_id: null, workspace_id: "careli" },
      { c2x_enterprise_id: "37", codigo: "VOC", id: "h-voc", pai_id: "h-vlo", workspace_id: "careli" },
      { c2x_enterprise_id: "36", codigo: "VOL", id: "h-vol", pai_id: "h-vlo", workspace_id: "careli" },
      { c2x_enterprise_id: "41", codigo: "VOR", id: "h-vor", pai_id: "h-vlo", workspace_id: "careli" },
    ],
    hub_users: [{ display_name: "Jurídico Careli", email: "juridico@careli.adm.br", id: "user-1" }],
    temis_minutas: [
      minuta(MINUTA_VOC, "37"),
      minuta(MINUTA_VOL, "36"),
      minuta(MINUTA_VLO, "35"),
      minuta(MINUTA_GDN, "39"),
    ],
    temis_planos: [],
  };
  estado.banco = novo;
  estado.com0170 = true;
  estado.leiturasDoCadastro = 0;
  estado.produtos = [...TUDO_DA_CECILIO];
  estado.porta = "cecilio";
  estado.teto.mockReset();
  estado.teto.mockResolvedValue(true);
  estado.stream = vi.fn(() => ({
    finalMessage: async () => ({ content: [{ text: '{"propostas":[]}', type: "text" }] }),
  }));
  vi.spyOn(console, "info").mockImplementation(() => {});
});

const url = (caminho: string) => `https://c2x.app.br/api/incorporador/temis/minutas${caminho}`;
const pedir = (caminho: string, metodo = "GET", corpo?: unknown) =>
  new Request(url(caminho), {
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { "Content-Type": "application/json" },
    method: metodo,
  });

/** O documento (o conteúdo da minuta) foi lido? É o que um 404 honesto nunca deixa acontecer. */
const leuODocumento = () =>
  banco().consultas.some((c) => c.tabela === "temis_minutas" && c.colunas.includes("conteudo"));

const linhaDaMinuta = (id: string) => banco().tabelas.temis_minutas?.find((m) => m.id === id);

describe("a porta do portal decide quem entra", () => {
  it("sem sessão: 401 e nenhuma consulta", async () => {
    estado.porta = "sem-sessao";
    const r = await portalMinutas.GET(pedir(`?id=${MINUTA_VOC}`));
    expect(r.status).toBe(401);
    expect(banco().consultas).toHaveLength(0);
  });

  it("quem não confecciona (comercial, cer): 404 da porta, sem Storage", async () => {
    estado.porta = "fora";
    const r = await portalUpload.POST(
      pedir("/upload", "POST", { contentType: "image/png", fileName: "a.png", minutaId: MINUTA_VOC, size: 10 }),
    );
    expect(r.status).toBe(404);
    expect(banco().storage.signedUpload).toHaveLength(0);
  });
});

describe("GET /minutas pelo portal", () => {
  it("a minuta do VOL (Lino): 404 sem ler o documento", async () => {
    const r = await portalMinutas.GET(pedir(`?id=${MINUTA_VOL}`));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Nao encontrado." });
    expect(leuODocumento()).toBe(false);
  });

  it("a minuta do VOC: abre", async () => {
    const r = await portalMinutas.GET(pedir(`?id=${MINUTA_VOC}`));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { minuta: { id: string } } };
    expect(corpo.data.minuta.id).toBe(MINUTA_VOC);
  });

  it("a minuta do consolidado (VLO): 404 para quem tem só o VOC, abre para o dono do conjunto", async () => {
    expect((await portalMinutas.GET(pedir(`?id=${MINUTA_VLO}`))).status).toBe(404);
    estado.porta = "conjunto";
    expect((await portalMinutas.GET(pedir(`?id=${MINUTA_VLO}`))).status).toBe(200);
  });

  it("uuid torto e minuta inexistente respondem igual à de outro dono", async () => {
    const torto = await portalMinutas.GET(pedir("?id=nao-e-uuid"));
    const inexistente = await portalMinutas.GET(pedir("?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
    expect(torto.status).toBe(404);
    expect(await torto.json()).toEqual({ error: "Nao encontrado." });
    expect(await inexistente.json()).toEqual({ error: "Nao encontrado." });
  });

  it("a lista de outro empreendimento: 404 sem consultar a tabela", async () => {
    const r = await portalMinutas.GET(pedir("?enterpriseId=36"));
    expect(r.status).toBe(404);
    expect(banco().consultas.filter((c) => c.tabela === "temis_minutas")).toHaveLength(0);
  });

  it("a lista do VOC: só as dele", async () => {
    const r = await portalMinutas.GET(pedir("?enterpriseId=37"));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { minutas: Array<{ id: string }> } };
    expect(corpo.data.minutas.map((m) => m.id)).toEqual([MINUTA_VOC]);
  });
});

describe("POST /minutas pelo portal", () => {
  it("em empreendimento de outro dono: 404 e nada gravado", async () => {
    const r = await portalMinutas.POST(pedir("?enterpriseId=36", "POST", { nome: "Nova" }));
    expect(r.status).toBe(404);
    expect(gravacoesEm(banco(), "temis_minutas")).toHaveLength(0);
  });

  it("no VOC: cria com o autor do portal, sem consultar `hub_users`", async () => {
    const r = await portalMinutas.POST(pedir("?enterpriseId=37", "POST", { nome: "Nova do VOC" }));
    expect(r.status).toBe(200);
    const [insert] = gravacoesEm(banco(), "temis_minutas");
    expect(insert?.valores).toMatchObject({
      atualizado_por_nome: "Maria do Jurídico (portal do incorporador)",
      criado_por: "usuario-portal-1",
      criado_por_nome: "Maria do Jurídico (portal do incorporador)",
      enterprise_id: "37",
    });
    expect(banco().consultas.some((c) => c.tabela === "hub_users")).toBe(false);
  });
});

describe("PATCH /minutas pelo portal (salvar e publicar)", () => {
  it("salvar a de outro dono: 404 e nada gravado", async () => {
    const r = await portalMinutas.PATCH(pedir(`?id=${MINUTA_VOL}`, "PATCH", { conteudoHtml: "<p>x</p>" }));
    expect(r.status).toBe(404);
    expect(gravacoesEm(banco(), "temis_minutas")).toHaveLength(0);
    expect(leuODocumento()).toBe(false);
  });

  it("salvar a do VOC: grava quem alterou pelo portal e mantém quem criou", async () => {
    const r = await portalMinutas.PATCH(pedir(`?id=${MINUTA_VOC}`, "PATCH", { conteudoHtml: "<p>novo</p>" }));
    expect(r.status).toBe(200);
    expect(linhaDaMinuta(MINUTA_VOC)).toMatchObject({
      atualizado_por_nome: "Maria do Jurídico (portal do incorporador)",
      conteudo_html: "<p>novo</p>",
      criado_por_nome: "Jurídico Careli",
    });
  });

  it("publicar a de outro dono: 404 e nada gravado", async () => {
    const r = await portalMinutas.PATCH(pedir(`?id=${MINUTA_VOL}&acao=publicar`, "PATCH"));
    expect(r.status).toBe(404);
    expect(gravacoesEm(banco(), "temis_minutas")).toHaveLength(0);
  });

  it("publicar a do VOC: publica e grava quem publicou pelo portal", async () => {
    const r = await portalMinutas.PATCH(pedir(`?id=${MINUTA_VOC}&acao=publicar`, "PATCH"));
    expect(r.status).toBe(200);
    expect(linhaDaMinuta(MINUTA_VOC)).toMatchObject({
      publicada_por_nome: "Maria do Jurídico (portal do incorporador)",
      situacao: "publicada",
    });
  });

  it("publicar com a 0173 pendente: publica mesmo assim, sem o nome do ato", async () => {
    banco().colunasAusentes = ["publicada_por_nome", "arquivada_por_nome"];
    const r = await portalMinutas.PATCH(pedir(`?id=${MINUTA_VOC}&acao=publicar`, "PATCH"));
    expect(r.status).toBe(200);
    const linha = linhaDaMinuta(MINUTA_VOC);
    expect(linha?.situacao).toBe("publicada");
    expect(linha && "publicada_por_nome" in linha).toBe(false);
  });

  it("salvar numa publicada do VOC abre a v2 com o autor do portal", async () => {
    const publicada = linhaDaMinuta(MINUTA_VOC);
    if (publicada) publicada.situacao = "publicada";
    const r = await portalMinutas.PATCH(pedir(`?id=${MINUTA_VOC}`, "PATCH", { conteudoHtml: "<p>v2</p>" }));
    expect(r.status).toBe(200);
    const [insert] = gravacoesEm(banco(), "temis_minutas");
    expect(insert?.tipo).toBe("insert");
    expect(insert?.valores).toMatchObject({
      atualizado_por_nome: "Maria do Jurídico (portal do incorporador)",
      criado_por_nome: "Jurídico Careli",
      enterprise_id: "37",
      versao: 2,
    });
  });
});

describe("DELETE /minutas pelo portal (arquivar)", () => {
  it("a de outro dono: 404 e nada gravado", async () => {
    const r = await portalMinutas.DELETE(pedir(`?id=${MINUTA_VOL}`, "DELETE"));
    expect(r.status).toBe(404);
    expect(gravacoesEm(banco(), "temis_minutas")).toHaveLength(0);
  });

  it("a do VOC: arquiva com quem arquivou", async () => {
    const r = await portalMinutas.DELETE(pedir(`?id=${MINUTA_VOC}`, "DELETE"));
    expect(r.status).toBe(200);
    expect(linhaDaMinuta(MINUTA_VOC)).toMatchObject({
      arquivada_por_nome: "Maria do Jurídico (portal do incorporador)",
      situacao: "arquivada",
    });
  });
});

describe("mídia do editor pelo portal (URL assinada, sem Bearer)", () => {
  const pedido = (minutaId: string) => ({
    contentType: "image/png",
    fileName: "logo.png",
    minutaId,
    size: 2048,
  });

  it("POST na minuta de outro dono: 404 e nenhuma URL assinada", async () => {
    const r = await portalUpload.POST(pedir("/upload", "POST", pedido(MINUTA_VOL)));
    expect(r.status).toBe(404);
    expect(banco().storage.signedUpload).toHaveLength(0);
  });

  it("POST na minuta do VOC: a URL assinada, na pasta da minuta", async () => {
    const r = await portalUpload.POST(pedir("/upload", "POST", pedido(MINUTA_VOC)));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { path: string; token: string };
    expect(corpo.path.startsWith(`temis-minutas/${MINUTA_VOC}/`)).toBe(true);
    expect(corpo.token).toBe("tok-1");
  });

  it("PATCH (confirmar) mídia de outra minuta: 404 sem tocar no Storage", async () => {
    const r = await portalUpload.PATCH(pedir("/upload", "PATCH", { path: `temis-minutas/${MINUTA_VOL}/x-logo.png` }));
    expect(r.status).toBe(404);
    expect(banco().storage.info).toHaveLength(0);
    expect(banco().storage.signedUrl).toHaveLength(0);
  });

  it("PATCH (confirmar) mídia do VOC: confirma e assina a leitura", async () => {
    const r = await portalUpload.PATCH(pedir("/upload", "PATCH", { path: `temis-minutas/${MINUTA_VOC}/x-logo.png` }));
    expect(r.status).toBe(200);
    expect(banco().storage.signedUrl).toHaveLength(1);
  });

  it("GET (re-assinar) mídia de outra minuta: 404; do VOC: a URL nova", async () => {
    const fora = await portalUpload.GET(pedir(`/upload?path=${encodeURIComponent(`temis-minutas/${MINUTA_VOL}/a.png`)}&json=1`));
    expect(fora.status).toBe(404);
    expect(banco().storage.signedUrl).toHaveLength(0);

    const dentro = await portalUpload.GET(pedir(`/upload?path=${encodeURIComponent(`temis-minutas/${MINUTA_VOC}/a.png`)}&json=1`));
    expect(dentro.status).toBe(200);
  });
});

describe("o agente da minuta pelo portal", () => {
  it("marcar: a porta fechada não chama o modelo", async () => {
    estado.porta = "fora";
    const r = await portalMarcar.POST(pedir("/marcar", "POST", { texto: "Contrato de Fulano" }));
    expect(r.status).toBe(404);
    expect(estado.stream).not.toHaveBeenCalled();
  });

  it("marcar: quem confecciona usa o mesmo agente, na minuta aberta", async () => {
    const r = await portalMarcar.POST(
      pedir("/marcar", "POST", { minutaId: MINUTA_VOC, texto: "Contrato de Fulano" }),
    );
    expect(r.status).toBe(200);
    expect(estado.stream).toHaveBeenCalledTimes(1);
  });

  it("marcar e conversar SEM a minuta aberta, ou com a de outro dono: 404 e o modelo não é chamado", async () => {
    expect((await portalMarcar.POST(pedir("/marcar", "POST", { texto: "Contrato" }))).status).toBe(404);
    expect(
      (await portalMarcar.POST(pedir("/marcar", "POST", { minutaId: MINUTA_VOL, texto: "Contrato" })))
        .status,
    ).toBe(404);
    expect(
      (
        await portalConversar.POST(
          pedir("/conversar", "POST", { mensagens: [{ conteudo: "oi", papel: "usuario" }], texto: "x" }),
        )
      ).status,
    ).toBe(404);
    expect(estado.stream).not.toHaveBeenCalled();
    expect(estado.teto).not.toHaveBeenCalled();
  });

  it("a minuta aberta também chega pela URL (`?minutaId=`, o que o editor do portal manda)", async () => {
    const r = await portalMarcar.POST(
      pedir(`/marcar?minutaId=${MINUTA_VOC}`, "POST", { texto: "Contrato de Fulano" }),
    );
    expect(r.status).toBe(200);
  });

  it("teto do usuário do portal batido: 429 e o modelo NÃO é chamado, nas duas ações", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    estado.teto.mockResolvedValue(false);
    const marcar = await portalMarcar.POST(
      pedir("/marcar", "POST", { minutaId: MINUTA_VOC, texto: "Contrato de Fulano" }),
    );
    expect(marcar.status).toBe(429);
    const conversar = await portalConversar.POST(
      pedir("/conversar", "POST", {
        mensagens: [{ conteudo: "oi", papel: "usuario" }],
        minutaId: MINUTA_VOC,
        texto: "x",
      }),
    );
    expect(conversar.status).toBe(429);
    expect(estado.stream).not.toHaveBeenCalled();
    expect(estado.teto).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ usuarioId: "usuario-portal-1" }),
      "agente-da-minuta",
    );
  });

  it("recusa barata (texto vazio) não gasta o teto; o hub nunca passa pelo teto", async () => {
    expect((await portalMarcar.POST(pedir("/marcar", "POST", { texto: "  " }))).status).toBe(400);
    expect(estado.teto).not.toHaveBeenCalled();

    const hub = (caminho: string, corpo: unknown) =>
      new Request(`https://c2x.app.br/api/temis/minutas${caminho}`, {
        body: JSON.stringify(corpo),
        headers: { authorization: "Bearer tok", "Content-Type": "application/json" },
        method: "POST",
      });
    expect((await hubMarcar.POST(hub("/marcar", { texto: "Contrato" }))).status).toBe(200);
    expect(
      (await hubConversar.POST(hub("/conversar", { mensagens: [{ conteudo: "oi", papel: "usuario" }], texto: "x" }))).status,
    ).toBe(200);
    expect(estado.teto).not.toHaveBeenCalled();
  });

  it("conversar: porta fechada 404; aberta responde", async () => {
    estado.porta = "fora";
    expect((await portalConversar.POST(pedir("/conversar", "POST", { mensagens: [{ conteudo: "oi", papel: "usuario" }] }))).status).toBe(404);
    estado.porta = "cecilio";
    const r = await portalConversar.POST(
      pedir("/conversar", "POST", {
        mensagens: [{ conteudo: "oi", papel: "usuario" }],
        minutaId: MINUTA_VOC,
        texto: "x",
      }),
    );
    expect(r.status).toBe(200);
  });
});

// ── 6. ESCRITA SÓ NO QUE O PORTAL OPERA ─────────────────────────────────────────────────────
//
// O cadastro de 16/09/2026: VOC (37) e VOR (41) da Careli, Garden (39) da Cecílio.

describe("escrita só no produto que o portal opera (decisão do Lucas, 16/09/2026)", () => {
  const SO_CONSULTA = {
    error: "Este produto está disponível só para consulta no seu portal.",
    soConsulta: true,
  };

  beforeEach(() => {
    estado.produtos = [...PRODUTOS_DE_16_DE_SETEMBRO];
  });

  it("a minuta do VOC continua abrindo e listando: ler não passa pela régua", async () => {
    expect((await portalMinutas.GET(pedir(`?id=${MINUTA_VOC}`))).status).toBe(200);
    expect((await portalMinutas.GET(pedir("?enterpriseId=37"))).status).toBe(200);
    expect(estado.leiturasDoCadastro).toBe(0);
  });

  it("criar, salvar, publicar e arquivar no VOC: 403 só consulta e nada gravado", async () => {
    const criar = await portalMinutas.POST(pedir("?enterpriseId=37", "POST", { nome: "Nova" }));
    expect(criar.status).toBe(403);
    expect(await criar.json()).toEqual(SO_CONSULTA);

    const salvar = await portalMinutas.PATCH(
      pedir(`?id=${MINUTA_VOC}`, "PATCH", { conteudoHtml: "<p>x</p>" }),
    );
    expect(salvar.status).toBe(403);
    expect((await portalMinutas.PATCH(pedir(`?id=${MINUTA_VOC}&acao=publicar`, "PATCH"))).status).toBe(
      403,
    );
    expect((await portalMinutas.DELETE(pedir(`?id=${MINUTA_VOC}`, "DELETE"))).status).toBe(403);

    expect(gravacoesEm(banco(), "temis_minutas")).toHaveLength(0);
    expect(leuODocumento()).toBe(false);
  });

  it("mídia do editor na minuta do VOC: 403 e nenhuma URL assinada nem confirmação", async () => {
    const pedido = await portalUpload.POST(
      pedir("/upload", "POST", { contentType: "image/png", fileName: "a.png", minutaId: MINUTA_VOC, size: 10 }),
    );
    expect(pedido.status).toBe(403);
    const confirmar = await portalUpload.PATCH(
      pedir("/upload", "PATCH", { path: `temis-minutas/${MINUTA_VOC}/x-logo.png` }),
    );
    expect(confirmar.status).toBe(403);
    expect(banco().storage.signedUpload).toHaveLength(0);
    expect(banco().storage.info).toHaveLength(0);

    // Re-assinar para ABRIR a mídia é leitura: continua.
    const abrir = await portalUpload.GET(
      pedir(`/upload?path=${encodeURIComponent(`temis-minutas/${MINUTA_VOC}/a.png`)}&json=1`),
    );
    expect(abrir.status).toBe(200);
  });

  it("o agente na minuta do VOC: 403 e o modelo não é chamado nem conta no teto", async () => {
    const marcar = await portalMarcar.POST(
      pedir("/marcar", "POST", { minutaId: MINUTA_VOC, texto: "Contrato" }),
    );
    expect(marcar.status).toBe(403);
    const conversar = await portalConversar.POST(
      pedir("/conversar", "POST", {
        mensagens: [{ conteudo: "oi", papel: "usuario" }],
        minutaId: MINUTA_VOC,
      }),
    );
    expect(conversar.status).toBe(403);
    expect(estado.stream).not.toHaveBeenCalled();
    expect(estado.teto).not.toHaveBeenCalled();
  });

  it("no Garden, operado pela Cecílio: cria, salva, sobe mídia e usa o agente", async () => {
    expect((await portalMinutas.POST(pedir("?enterpriseId=39", "POST", { nome: "Nova" }))).status).toBe(
      200,
    );
    expect(
      (await portalMinutas.PATCH(pedir(`?id=${MINUTA_GDN}`, "PATCH", { conteudoHtml: "<p>novo</p>" })))
        .status,
    ).toBe(200);
    expect(
      (
        await portalUpload.POST(
          pedir("/upload", "POST", { contentType: "image/png", fileName: "a.png", minutaId: MINUTA_GDN, size: 10 }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await portalMarcar.POST(pedir("/marcar", "POST", { minutaId: MINUTA_GDN, texto: "Contrato" })))
        .status,
    ).toBe(200);
  });

  it("sem a 0170 não se prova quem opera: 503, e nada gravado", async () => {
    estado.com0170 = false;
    const r = await portalMinutas.POST(pedir("?enterpriseId=39", "POST", { nome: "Nova" }));
    expect(r.status).toBe(503);
    expect(gravacoesEm(banco(), "temis_minutas")).toHaveLength(0);
  });

  it("o hub escreve no VOC como sempre, sem ler o cadastro", async () => {
    const r = await hubMinutas.PATCH(
      new Request(`https://c2x.app.br/api/temis/minutas?id=${MINUTA_VOC}`, {
        body: JSON.stringify({ conteudoHtml: "<p>hub</p>" }),
        headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
        method: "PATCH",
      }),
    );
    expect(r.status).toBe(200);
    expect(estado.leiturasDoCadastro).toBe(0);
  });
});

describe("O HUB NÃO MUDA", () => {
  const hub = (caminho: string, metodo = "GET", corpo?: unknown) =>
    new Request(`https://c2x.app.br/api/temis/minutas${caminho}`, {
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      method: metodo,
    });

  it("abre a minuta de qualquer empreendimento, sem consulta de alcance antes do documento", async () => {
    const r = await hubMinutas.GET(hub(`?id=${MINUTA_VOL}`));
    expect(r.status).toBe(200);
    const primeira = banco().consultas[0];
    expect(primeira?.tabela).toBe("temis_minutas");
    expect(primeira?.colunas).toContain("conteudo_html");
  });

  it("cria em qualquer empreendimento com o autor de `hub_users`, sem sufixo", async () => {
    const r = await hubMinutas.POST(hub("?enterpriseId=36", "POST", { nome: "Do hub" }));
    expect(r.status).toBe(200);
    const [insert] = gravacoesEm(banco(), "temis_minutas");
    expect(insert?.valores).toMatchObject({
      criado_por: "user-1",
      criado_por_nome: "Jurídico Careli",
      enterprise_id: "36",
    });
  });

  it("publica com a 0173 pendente, como antes", async () => {
    banco().colunasAusentes = ["publicada_por_nome", "arquivada_por_nome"];
    const r = await hubMinutas.PATCH(hub(`?id=${MINUTA_VOL}&acao=publicar`, "PATCH"));
    expect(r.status).toBe(200);
    expect(linhaDaMinuta(MINUTA_VOL)?.situacao).toBe("publicada");
  });

  it("a mídia de qualquer minuta: URL assinada sem conferência de empreendimento", async () => {
    const r = await hubUpload.POST(
      hub("/upload", "POST", { contentType: "image/png", fileName: "a.png", minutaId: MINUTA_VOL, size: 10 }),
    );
    expect(r.status).toBe(200);
    expect(hubUpload.TTL_LEITURA_MIDIA).toBe(7 * 24 * 60 * 60);
  });
});
