import { beforeEach, describe, expect, it, vi } from "vitest";

// A ASSINATURA PELO PORTAL — preparar, enviar e consertar signatário, com a conta da Careli.
//
// Decisão do Lucas (16/09/2026): a equipe da Cecílio manda para assinatura os contratos que ela
// confecciona, pela Clicksign da conta da Careli, com registro de quem enviou. O que está travado:
//   1. FORA DO ALCANCE (contrato da Careli, de outro incorporador, envelope sem dono conferível)
//      responde 404 e NADA fala com a Clicksign nem lista e-mail de comprador;
//   2. DENTRO DO ALCANCE o envio grava o usuário do portal e a origem escrita no nome;
//   3. falha ao conferir o envelope é 503, nunca 404;
//   4. O HUB NÃO MUDA: sem consulta de alcance, autor do portão, sem sufixo;
//   5. ESCRITA SÓ NO QUE O PORTAL OPERA (decisão do Lucas, 16/09/2026): o card dele num produto só
//      consulta (o VOC, da Careli) prepara, e responde 403 a enviar e consertar signatário, sem
//      falar com a Clicksign.
//
// ⚠️ O CADASTRO DOS PRODUTOS É TROCADO SÓ NA LEITURA; a régua de quem opera é a de verdade. Nos
// grupos 1 a 4 tudo é da Cecílio; o grupo 5 usa o cadastro de 16/09/2026.
//
// O envio, o preparo e a troca de signatário são mockados: a guarda contra o segundo envelope e a
// conferência de e-mail têm teste próprio em `lib/assinatura` e `lib/temis/trocar-signatario`.

const CECILIO = "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6";
const PROPOSTA = "641f22ac-6c4a-4133-afec-49fa7b7e1765";
const ENVELOPE = "3e9a331d-ec2f-4eb5-9ae1-aafbeae8b395";

const estado = vi.hoisted(() => ({
  cards: [] as Array<{ enterprise_id: string; operado_por: null | string }>,
  consultas: [] as Array<{ filtros: unknown[][]; tabela: string }>,
  envelopes: [] as Array<{ proposta_id: null | string }>,
  erroEnvelope: null as null | { message: string },
  leiturasDoCadastro: 0,
  porta: "cecilio" as "cecilio" | "fora",
  produtos: [] as Array<{ c2x: string; operadoPor: null | string; pai?: string }>,
}));

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
  enviarContratoParaAssinatura: vi.fn(async () => ({
    envelopeId: "env-novo",
    nome: "Contrato v1.pdf",
    ok: true,
    registroId: "reg-1",
    signatarios: [{ email: "a@b.com", nome: "Henrique", ordem: 1, papel: "comprador" }],
  })),
  prepararEnvio: vi.fn(),
  reenviarConvite: vi.fn(async () => ({ ok: true })),
  trocarEmailDoSignatario: vi.fn(async () => ({
    aviso: null,
    email: "novo@b.com",
    nome: "Cônjuge",
    ok: true,
    signerId: "signer-novo",
  })),
}));

vi.mock("@/lib/temis/portao-do-portal", async () => {
  const { NextResponse } = await import("next/server");
  return {
    autorizarTemisDoPortal: async () =>
      estado.porta === "fora"
        ? { ok: false, response: NextResponse.json({ error: "Nao encontrado." }, { status: 404 }) }
        : {
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
        if (tabela === "temis_envelopes") {
          return estado.erroEnvelope
            ? { data: null, error: estado.erroEnvelope }
            : { data: estado.envelopes, error: null };
        }
        return { data: null, error: null };
      };
      q.maybeSingle = async () => resposta();
      q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve(resposta()).then(ok, falha);
      return q;
    },
  }),
}));

vi.mock("@/lib/assinatura/clicksign/cliente", () => ({
  conferirConfiguracao: () => ({
    ambiente: "https://app.clicksign.com",
    faltando: [],
    presentes: ["CLICKSIGN_API_BASE_URL", "CLICKSIGN_TOKEN_API", "CLICKSIGN_WEBHOOK_SECRET"],
  }),
  pareceSandbox: () => false,
}));
vi.mock("@/lib/assinatura/envio-db", () => ({
  enviarContratoParaAssinatura: espioes.enviarContratoParaAssinatura,
  prepararEnvio: espioes.prepararEnvio,
}));
vi.mock("@/lib/temis/trocar-signatario", () => ({
  reenviarConvite: espioes.reenviarConvite,
  trocarEmailDoSignatario: espioes.trocarEmailDoSignatario,
}));

import { lerRegraDeOrdem } from "@/lib/assinatura/ordem";

import {
  GET as PORTAL_PREPARO,
  POST as PORTAL_ENVIAR,
} from "@/app/api/incorporador/temis/assinatura/enviar/route";
import { POST as PORTAL_SIGNATARIO } from "@/app/api/incorporador/temis/assinatura/signatario/route";
import { POST as HUB_ENVIAR } from "@/app/api/temis/assinatura/enviar/route";
import { POST as HUB_SIGNATARIO } from "@/app/api/temis/assinatura/signatario/route";
import {
  PRODUTOS_DE_16_DE_SETEMBRO,
  TUDO_DA_CECILIO,
} from "@/lib/temis/fixtures/produtos-operados";

const BASE = "https://c2x.app.br/api/incorporador/temis/assinatura";

function post(url: string, corpo: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });
}

function nadaSaiuParaAClicksign() {
  expect(espioes.prepararEnvio).not.toHaveBeenCalled();
  expect(espioes.enviarContratoParaAssinatura).not.toHaveBeenCalled();
  expect(espioes.reenviarConvite).not.toHaveBeenCalled();
  expect(espioes.trocarEmailDoSignatario).not.toHaveBeenCalled();
}

const VERBOS: Array<[string, () => Promise<Response>]> = [
  ["enviar GET", () => PORTAL_PREPARO(new Request(`${BASE}/enviar?proposta=${PROPOSTA}`))],
  ["enviar POST", () => PORTAL_ENVIAR(post(`${BASE}/enviar`, { propostaId: PROPOSTA }))],
  [
    "signatário reenviar",
    () => PORTAL_SIGNATARIO(post(`${BASE}/signatario`, { acao: "reenviar", envelopeId: ENVELOPE, signerId: "s1" })),
  ],
  [
    "signatário trocar_email",
    () =>
      PORTAL_SIGNATARIO(
        post(`${BASE}/signatario`, {
          acao: "trocar_email",
          email: "novo@b.com",
          envelopeId: ENVELOPE,
          signerId: "s1",
        }),
      ),
  ],
];

beforeEach(() => {
  estado.cards = [{ enterprise_id: "37", operado_por: CECILIO }];
  estado.consultas = [];
  estado.envelopes = [{ proposta_id: PROPOSTA }];
  estado.erroEnvelope = null;
  estado.leiturasDoCadastro = 0;
  estado.porta = "cecilio";
  estado.produtos = [...TUDO_DA_CECILIO];
  for (const espiao of Object.values(espioes)) espiao.mockClear();
  espioes.prepararEnvio.mockImplementation(async () => ({
    avisos: [],
    contrato: { criadoEm: "2026-09-16", documentoId: "doc-1", nome: "Contrato v1.pdf", unidadeId: "uni-1", versao: 1 },
    identidade: { comprador: "Henrique", empreendimento: "VOC", unidade: "Q01 L05" },
    impedimento: null,
    ok: true,
    origemDaRegra: "padrao",
    origemDescrita: "o padrão da casa",
    regra: lerRegraDeOrdem({}),
    signatarios: [{ email: "a@b.com", nome: "Henrique", ordem: 1, papel: "comprador" }],
  }));
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ── 1. FORA DO ALCANCE ──────────────────────────────────────────────────────

describe("portal: contrato da Careli não sai pela porta do portal", () => {
  it.each(VERBOS)("%s responde 404 e nada fala com a Clicksign", async (_nome, chamar) => {
    estado.cards = [{ enterprise_id: "37", operado_por: null }];
    const r = await chamar();
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Nao encontrado." });
    nadaSaiuParaAClicksign();
  });

  it.each(VERBOS)("%s responde 404 para contrato de outro incorporador", async (_nome, chamar) => {
    estado.cards = [{ enterprise_id: "37", operado_por: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" }];
    expect((await chamar()).status).toBe(404);
    nadaSaiuParaAClicksign();
  });

  it("envelope que o Panteon não conhece, ou sem proposta, responde 404", async () => {
    estado.envelopes = [];
    const r1 = await PORTAL_SIGNATARIO(
      post(`${BASE}/signatario`, { acao: "reenviar", envelopeId: "outro", signerId: "s1" }),
    );
    expect(r1.status).toBe(404);

    estado.envelopes = [{ proposta_id: null }];
    const r2 = await PORTAL_SIGNATARIO(
      post(`${BASE}/signatario`, { acao: "reenviar", envelopeId: ENVELOPE, signerId: "s1" }),
    );
    expect(r2.status).toBe(404);
    nadaSaiuParaAClicksign();
  });

  it("não conseguir ler o envelope é 503, e nada sai", async () => {
    estado.erroEnvelope = { message: "timeout" };
    const r = await PORTAL_SIGNATARIO(
      post(`${BASE}/signatario`, { acao: "reenviar", envelopeId: ENVELOPE, signerId: "s1" }),
    );
    expect(r.status).toBe(503);
    nadaSaiuParaAClicksign();
  });

  it("portal que não confecciona: 404 da porta, sem consulta nenhuma", async () => {
    estado.porta = "fora";
    for (const [, chamar] of VERBOS) expect((await chamar()).status).toBe(404);
    expect(estado.consultas).toHaveLength(0);
    nadaSaiuParaAClicksign();
  });
});

// ── 2. DENTRO DO ALCANCE ────────────────────────────────────────────────────

describe("portal: o contrato que a Cecílio confecciona", () => {
  it("o preparo lista quem assina, sem cache", async () => {
    const r = await PORTAL_PREPARO(new Request(`${BASE}/enviar?proposta=${PROPOSTA}`));
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const corpo = (await r.json()) as { data: { signatarios: Array<{ nome: string }> } };
    expect(corpo.data.signatarios[0]!.nome).toBe("Henrique");
    expect(espioes.prepararEnvio).toHaveBeenCalledWith(expect.anything(), PROPOSTA);
  });

  it("o envio usa a mesma função do hub e registra quem enviou, com a origem", async () => {
    const r = await PORTAL_ENVIAR(post(`${BASE}/enviar`, { propostaId: PROPOSTA, semCpf: true }));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { data: { envelopeId: string } }).data.envelopeId).toBe("env-novo");
    expect(espioes.enviarContratoParaAssinatura).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        propostaId: PROPOSTA,
        semCpf: true,
        usuarioId: "usuario-portal-1",
        usuarioNome: "Maria do Jurídico (portal do incorporador)",
      }),
    );
  });

  it("reenviar e trocar o e-mail respondem para o envelope da proposta dele", async () => {
    const reenvio = await PORTAL_SIGNATARIO(
      post(`${BASE}/signatario`, { acao: "reenviar", envelopeId: ENVELOPE, signerId: "s1" }),
    );
    expect(reenvio.status).toBe(200);
    expect(espioes.reenviarConvite).toHaveBeenCalledWith(expect.anything(), {
      envelopeId: ENVELOPE,
      signerId: "s1",
    });

    const troca = await PORTAL_SIGNATARIO(
      post(`${BASE}/signatario`, { acao: "trocar_email", email: "novo@b.com", envelopeId: ENVELOPE, signerId: "s1" }),
    );
    expect(troca.status).toBe(200);
    expect(((await troca.json()) as { data: { signerId: string } }).data.signerId).toBe("signer-novo");
  });

  it("e-mail torto é recusado com 400 antes da troca, como no hub", async () => {
    const r = await PORTAL_SIGNATARIO(
      post(`${BASE}/signatario`, { acao: "trocar_email", email: "sem-arroba", envelopeId: ENVELOPE, signerId: "s1" }),
    );
    expect(r.status).toBe(400);
    expect(espioes.trocarEmailDoSignatario).not.toHaveBeenCalled();
  });
});

// ── 3. O HUB NÃO MUDA ───────────────────────────────────────────────────────

describe("hub: mesma função, sem recorte e com o autor de sempre", () => {
  const HUB = "https://c2x.app.br/api/temis/assinatura";
  const BEARER = { authorization: "Bearer tok" };

  it("envia contrato da Careli sem consulta de alcance, com o autor do portão", async () => {
    estado.cards = [{ enterprise_id: "37", operado_por: null }];
    const r = await HUB_ENVIAR(post(`${HUB}/enviar`, { propostaId: PROPOSTA }, BEARER));
    expect(r.status).toBe(200);
    expect(espioes.enviarContratoParaAssinatura).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ usuarioId: "user-hub", usuarioNome: "Jurídico Careli" }),
    );
    expect(estado.consultas).toHaveLength(0);
  });

  it("conserta signatário sem ler o envelope por conta própria (quem lê é trocar-signatario)", async () => {
    estado.envelopes = [];
    const r = await HUB_SIGNATARIO(
      post(`${HUB}/signatario`, { acao: "reenviar", envelopeId: ENVELOPE, signerId: "s1" }, BEARER),
    );
    expect(r.status).toBe(200);
    expect(estado.consultas).toHaveLength(0);
    expect(estado.leiturasDoCadastro).toBe(0);
  });
});

// ── 4. ESCRITA SÓ NO QUE O PORTAL OPERA ─────────────────────────────────────

describe("portal: o card dele num produto só consulta (decisão do Lucas, 16/09/2026)", () => {
  beforeEach(() => {
    estado.produtos = [...PRODUTOS_DE_16_DE_SETEMBRO];
  });

  it("enviar e consertar signatário no VOC: 403 com `erro` e nada sai para a Clicksign", async () => {
    const enviar = await PORTAL_ENVIAR(post(`${BASE}/enviar`, { propostaId: PROPOSTA }));
    expect(enviar.status).toBe(403);
    expect(await enviar.json()).toEqual({
      erro: "Este produto está disponível só para consulta no seu portal.",
      soConsulta: true,
    });

    const reenviar = await PORTAL_SIGNATARIO(
      post(`${BASE}/signatario`, { acao: "reenviar", envelopeId: ENVELOPE, signerId: "s1" }),
    );
    expect(reenviar.status).toBe(403);
    nadaSaiuParaAClicksign();
  });

  it("o preparo (leitura) continua respondendo no VOC", async () => {
    expect((await PORTAL_PREPARO(new Request(`${BASE}/enviar?proposta=${PROPOSTA}`))).status).toBe(200);
  });

  it("no Garden, operado pela Cecílio: envia", async () => {
    estado.cards = [{ enterprise_id: "39", operado_por: CECILIO }];
    const r = await PORTAL_ENVIAR(post(`${BASE}/enviar`, { propostaId: PROPOSTA }));
    expect(r.status).toBe(200);
    expect(espioes.enviarContratoParaAssinatura).toHaveBeenCalled();
  });
});
