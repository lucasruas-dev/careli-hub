import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";

import type { SessaoIncorporador } from "./sessao";

// A PORTA DE ESCRITA DO PORTAL NO SERVIDOR (decisão do Lucas, 16/09/2026: no portal que confecciona,
// escrita só no produto que ele opera). Tudo o que vai ao banco é mockado; o que se prova aqui é a
// ORDEM e a RESPOSTA de cada caso:
//   • o comercial não toca no banco, nem na revalidação, nem no cadastro;
//   • sem a 0170 ou com o cadastro fora do ar: 503, nunca "pode";
//   • VOC (37) sem dono: 403 com `soConsulta: true`;
//   • Garden (39) da Cecílio: ok com a sessão VIGENTE (a da revalidação, não a do cookie);
//   • revalidação que recusa (404/503) passa adiante; id revogado no Setup: 404.

const mocks = vi.hoisted(() => ({
  idsDaSessao: vi.fn(),
  lerCadastro: vi.fn(),
  revalidar: vi.fn(),
}));

vi.mock("@/lib/hercules/cadastro", () => ({ lerCadastroDeEmpreendimentos: mocks.lerCadastro }));
vi.mock("./board-do-portal", () => ({ autorizarPortalQueOperaSozinho: mocks.revalidar }));
vi.mock("./escopo", () => ({
  foraDoEscopo: () => NextResponse.json({ error: "Nao encontrado." }, { status: 404 }),
  idsDaSessao: mocks.idsDaSessao,
}));

const { autorizarEscritaNoProduto, escritaNoProduto, recorteQueOPortalOpera, respostaDaEscrita } = await import(
  "./operacao-do-produto-servidor"
);

const CECILIO_ID = "inc-cecilio";

function sessao(dados: Partial<SessaoIncorporador> = {}): SessaoIncorporador {
  return {
    enterpriseIds: ["37", "39", "100000"],
    enterpriseIdsComCarteira: [],
    exp: Date.now() + 60_000,
    incorporadorId: CECILIO_ID,
    incorporadorNome: "Cecílio Rocha",
    slug: "cecilio-rocha",
    tipo: "incorporador",
    usuarioId: "u-1",
    usuarioNome: "Pessoa da Cecílio",
    ...dados,
  };
}

function linha(dados: Partial<LinhaDoCadastro> & Pick<LinhaDoCadastro, "codigo" | "id">): LinhaDoCadastro {
  return {
    c2xEnterpriseId: null,
    cidade: null,
    nome: dados.codigo,
    operadoPor: null,
    ordem: 0,
    paiId: null,
    tipoProduto: "loteamento",
    uf: null,
    vendendo: true,
    ...dados,
  };
}

const PAI_GARDEN = "22222222-2222-4222-8222-222222222222";

const LINHAS: LinhaDoCadastro[] = [
  linha({ c2xEnterpriseId: "37", codigo: "VOC", id: "voc" }),
  linha({ c2xEnterpriseId: "39", codigo: "JDG", id: PAI_GARDEN, operadoPor: CECILIO_ID }),
  linha({ c2xEnterpriseId: "100000", codigo: "JAD", id: "jad", operadoPor: CECILIO_ID }),
];

const PEDIDO = new Request("https://c2x.app.br/api/incorporador/qualquer");

beforeEach(() => {
  mocks.idsDaSessao.mockReset();
  mocks.lerCadastro.mockReset();
  mocks.revalidar.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});

  mocks.lerCadastro.mockResolvedValue({ com0170: true, linhas: LINHAS });
  mocks.idsDaSessao.mockImplementation(async (s: SessaoIncorporador) => s.enterpriseIds);
  // A revalidação devolve a sessão VIGENTE: o 100000 foi revogado no Setup desde o login.
  mocks.revalidar.mockImplementation(async (_request: Request, s: SessaoIncorporador) => ({
    ok: true,
    sessao: { ...s, enterpriseIds: ["37", "39"] },
  }));
});

async function corpo(response: NextResponse): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("escritaNoProduto", () => {
  const CECILIO = { incorporadorId: CECILIO_ID, slug: "cecilio-rocha", tipo: "incorporador" };

  it("comercial: 'pode' sem ler o cadastro", async () => {
    expect(await escritaNoProduto({ incorporadorId: "g", slug: "gurgel", tipo: "comercial" }, ["37"])).toBe("pode");
    expect(mocks.lerCadastro).not.toHaveBeenCalled();
  });

  it("portal que não confecciona: 'fora' sem ler o cadastro", async () => {
    expect(await escritaNoProduto({ ...CECILIO, slug: "cer" }, ["39"])).toBe("fora");
    expect(mocks.lerCadastro).not.toHaveBeenCalled();
  });

  it("Garden da Cecílio: 'pode'; VOC: 'so-consulta'", async () => {
    expect(await escritaNoProduto(CECILIO, ["39"])).toBe("pode");
    expect(await escritaNoProduto(CECILIO, ["37"])).toBe("so-consulta");
  });

  it("⚠️ sem a 0170 ou com o cadastro fora do ar: 'indisponivel'", async () => {
    mocks.lerCadastro.mockResolvedValueOnce({ com0170: false, linhas: LINHAS });
    expect(await escritaNoProduto(CECILIO, ["39"])).toBe("indisponivel");
    mocks.lerCadastro.mockRejectedValueOnce(new Error("fora do ar"));
    expect(await escritaNoProduto(CECILIO, ["39"])).toBe("indisponivel");
  });
});

// (16/09/2026, revisão do conjunto) As travas de dado global da ficha perguntam "a pessoa tem algo
// fora do que este portal pode mexer?", e o VOC e o VOR (só consulta) não podem contar como dentro.
describe("recorteQueOPortalOpera", () => {
  const CECILIO = { incorporadorId: CECILIO_ID, slug: "cecilio-rocha", tipo: "incorporador" };

  it("Cecílio: do recorte {37, 39, 100000, group:X} fica só o que ela opera", async () => {
    const operados = await recorteQueOPortalOpera(CECILIO, ["37", "39", "100000", "group:Vale do Ouro"]);
    expect([...(operados ?? [])].sort()).toEqual(["100000", "39"]);
  });

  it("comercial: o recorte inteiro, sem ler o cadastro", async () => {
    const operados = await recorteQueOPortalOpera({ ...CECILIO, slug: "gurgel", tipo: "comercial" }, ["37", "39"]);
    expect([...(operados ?? [])].sort()).toEqual(["37", "39"]);
    expect(mocks.lerCadastro).not.toHaveBeenCalled();
  });

  it("sem a 0170 ou com o cadastro fora do ar: null (quem chama responde 503)", async () => {
    mocks.lerCadastro.mockResolvedValueOnce({ com0170: false, linhas: LINHAS });
    expect(await recorteQueOPortalOpera(CECILIO, ["39"])).toBeNull();
    mocks.lerCadastro.mockRejectedValueOnce(new Error("fora"));
    expect(await recorteQueOPortalOpera(CECILIO, ["39"])).toBeNull();
  });

  it("portal padrão: vazio", async () => {
    expect([...((await recorteQueOPortalOpera({ ...CECILIO, slug: "cer" }, ["39"])) ?? ["x"])]).toEqual([]);
  });
});

describe("respostaDaEscrita", () => {
  it("só consulta: 403 com soConsulta e a mensagem da régua", async () => {
    const resposta = respostaDaEscrita("so-consulta");
    expect(resposta.status).toBe(403);
    expect(await corpo(resposta)).toEqual({
      error: "Este produto está disponível só para consulta no seu portal.",
      soConsulta: true,
    });
  });

  it("indisponível: 503 com texto acentuado", async () => {
    const resposta = respostaDaEscrita("indisponivel");
    expect(resposta.status).toBe(503);
    expect(await corpo(resposta)).toEqual({
      error: "Não foi possível conferir o produto agora. Tente de novo em instantes.",
    });
  });

  it("fora: o 404 de sempre", () => {
    expect(respostaDaEscrita("fora").status).toBe(404);
  });
});

describe("autorizarEscritaNoProduto", () => {
  it("⚠️ comercial: ok com a sessão recebida, sem revalidar e sem banco", async () => {
    const gurgel = sessao({ slug: "gurgel", tipo: "comercial" });
    const resultado = await autorizarEscritaNoProduto(PEDIDO, gurgel, ["37"]);
    expect(resultado).toEqual({ ok: true, sessao: gurgel });
    expect(mocks.revalidar).not.toHaveBeenCalled();
    expect(mocks.idsDaSessao).not.toHaveBeenCalled();
    expect(mocks.lerCadastro).not.toHaveBeenCalled();
  });

  it("portal padrão: 404 sem revalidar", async () => {
    const resultado = await autorizarEscritaNoProduto(PEDIDO, sessao({ slug: "cer" }), ["39"]);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.response.status).toBe(404);
    expect(mocks.revalidar).not.toHaveBeenCalled();
  });

  it("Garden (39) operado pela Cecílio: ok com a sessão VIGENTE", async () => {
    const resultado = await autorizarEscritaNoProduto(PEDIDO, sessao(), ["39"]);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.sessao.enterpriseIds).toEqual(["37", "39"]);
    expect(mocks.revalidar).toHaveBeenCalledTimes(1);
    // O escopo conferido é o da sessão vigente, não o do cookie.
    expect(mocks.idsDaSessao.mock.calls[0]?.[0].enterpriseIds).toEqual(["37", "39"]);
  });

  it("'pai:<uuid>' do Garden vale quando o pai alcança a sessão", async () => {
    const resultado = await autorizarEscritaNoProduto(PEDIDO, sessao(), [`pai:${PAI_GARDEN}`]);
    expect(resultado.ok).toBe(true);
  });

  it("⚠️ VOC (37) sem dono: 403 só consulta", async () => {
    const resultado = await autorizarEscritaNoProduto(PEDIDO, sessao(), ["37"]);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.response.status).toBe(403);
    expect(await corpo(resultado.response)).toEqual({
      error: "Este produto está disponível só para consulta no seu portal.",
      soConsulta: true,
    });
  });

  it("⚠️ sem a 0170: 503", async () => {
    mocks.lerCadastro.mockResolvedValueOnce({ com0170: false, linhas: LINHAS });
    const resultado = await autorizarEscritaNoProduto(PEDIDO, sessao(), ["39"]);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.response.status).toBe(503);
  });

  it("⚠️ cadastro que lança: 503", async () => {
    mocks.lerCadastro.mockRejectedValueOnce(new Error("fora do ar"));
    const resultado = await autorizarEscritaNoProduto(PEDIDO, sessao(), ["39"]);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.response.status).toBe(503);
  });

  it("revalidação que recusa (404 ou 503) passa adiante, sem ler o cadastro", async () => {
    for (const status of [404, 503]) {
      const recusa = NextResponse.json({ error: "x" }, { status });
      mocks.revalidar.mockResolvedValueOnce({ ok: false, response: recusa });
      const resultado = await autorizarEscritaNoProduto(PEDIDO, sessao(), ["39"]);
      expect(resultado).toEqual({ ok: false, response: recusa });
    }
    expect(mocks.lerCadastro).not.toHaveBeenCalled();
  });

  it("⚠️ id revogado desde o login (100000 fora da sessão vigente): 404", async () => {
    const resultado = await autorizarEscritaNoProduto(PEDIDO, sessao(), ["100000"]);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.response.status).toBe(404);
  });

  it("um id fora do escopo no meio de ids dele: 404", async () => {
    const resultado = await autorizarEscritaNoProduto(PEDIDO, sessao(), ["39", "999"]);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.response.status).toBe(404);
  });

  it("'pai:<uuid>' que não existe: 404", async () => {
    const resultado = await autorizarEscritaNoProduto(PEDIDO, sessao(), ["pai:nao-existe"]);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.response.status).toBe(404);
  });

  it("pedido sem alvo (vazio ou só grupo): 404", async () => {
    for (const ids of [[], ["group:Vale do Ouro"], ["", null]]) {
      const resultado = await autorizarEscritaNoProduto(PEDIDO, sessao(), ids);
      expect(resultado.ok).toBe(false);
      if (!resultado.ok) expect(resultado.response.status).toBe(404);
    }
  });

  it("escopo que lança: 503", async () => {
    mocks.idsDaSessao.mockRejectedValueOnce(new Error("catálogo"));
    const resultado = await autorizarEscritaNoProduto(PEDIDO, sessao(), ["39"]);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.response.status).toBe(503);
  });
});
