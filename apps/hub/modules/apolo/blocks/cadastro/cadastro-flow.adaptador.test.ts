// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { criarApiCadastro, salvarPublico } from "./cadastro-flow";

// O ADAPTADOR PÚBLICO DO WIZARD (01/10/2026): é aqui que a CAD do cliente, o auto-cadastro da
// imobiliária e o link do corretor autônomo se separam. Uma troca aqui muda os dois links que já estão
// no ar sem tela nenhuma acusar, e foi isso que a terceira rodada de revisão da Publicação pegou: sete
// mutações no wizard passavam com a suíte verde. Este arquivo chama o adaptador DE VERDADE e confere,
// pelo `fetch`, o que cada modo manda para o servidor.

type Chamada = { body: Record<string, unknown>; headers: Record<string, string>; url: string };
const chamadas: Chamada[] = [];

beforeEach(() => {
  chamadas.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push({
        body: JSON.parse(String(init?.body ?? "{}")),
        headers: (init?.headers ?? {}) as Record<string, string>,
        url,
      });
      return new Response(
        JSON.stringify({ conflito: null, conferido: true, data: {}, entityId: "e1", url: "u" }),
        { status: 200 },
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a CAD do cliente (o link que já está no ar)", () => {
  const api = criarApiCadastro({ sessao: "tok-cad" });

  it("consulta o CPF pela rota da CAD, com o token no header dela", async () => {
    await api.ocr({ action: "enrich", cpf: "11144477735" });
    expect(chamadas[0]).toMatchObject({
      body: { action: "enrich", cpf: "11144477735" },
      headers: { "x-cad-sessao": "tok-cad" },
      url: "/api/publico/cad/ocr",
    });
  });

  it("confere o CPF duplicado pela rota da CAD", async () => {
    await api.checarCpf({ cpf: "11144477735", cpfConjuge: "" });
    expect(chamadas[0]!.url).toBe("/api/publico/cad/checar-cpf");
  });

  it("salva na rota da CAD com o corpo do wizard, sem nada acrescentado", async () => {
    await api.salvar({ identidade: { nome: "X" } });
    expect(chamadas[0]).toMatchObject({ body: { identidade: { nome: "X" } }, url: "/api/publico/cad/salvar" });
    expect(Object.keys(chamadas[0]!.body)).toEqual(["identidade"]);
  });
});

describe("o auto-cadastro da imobiliária (o outro link no ar)", () => {
  const api = criarApiCadastro({
    header: "x-cad-pre-sessao-imob",
    salvarUrl: "/api/publico/imobiliaria/cadastro",
    sessao: "tok-imob",
  });

  it("consulta CNPJ e CPF de sócio, com o token dela", async () => {
    await api.ocr({ action: "enrich-company", cnpj: "12345678000195" });
    await api.ocr({ action: "enrich", cpf: "11144477735" });
    expect(chamadas.map((c) => [c.url, c.headers["x-cad-pre-sessao-imob"]])).toEqual([
      ["/api/publico/cad/ocr", "tok-imob"],
      ["/api/publico/cad/ocr", "tok-imob"],
    ]);
  });

  it("salva na rota dela, sem nada acrescentado", async () => {
    await api.salvar({ empresa: { cnpj: "1" } });
    expect(chamadas[0]!.url).toBe("/api/publico/imobiliaria/cadastro");
    expect(Object.keys(chamadas[0]!.body)).toEqual(["empresa"]);
  });
});

describe("o link do corretor autônomo", () => {
  const extras = vi.fn(() => ({ empreendimentosDeInteresse: ["35"] }));
  const api = criarApiCadastro({
    extrasDoEnvio: extras,
    header: "x-autonomo-pre-sessao",
    salvarUrl: "/api/publico/autonomo/cadastro",
    semChecagemCpf: true,
    semEnriquecimento: true,
    sessao: "tok-aut",
  });

  it("lê a foto, e NÃO pede consulta de CPF nem de CNPJ (nem chega a chamar o servidor)", async () => {
    await api.ocr({ action: "extract", fileBase64: "QUJD" });
    await expect(api.ocr({ action: "enrich", cpf: "52998224725" })).rejects.toThrow();
    await expect(api.ocr({ action: "enrich-company", cnpj: "1" })).rejects.toThrow();
    expect(chamadas.map((c) => c.body.action)).toEqual(["extract"]);
  });

  it("não confere CPF duplicado pela rota da CAD", async () => {
    expect(await api.checarCpf({ cpf: "52998224725", cpfConjuge: "" })).toEqual({
      conferido: false,
      conflito: null,
    });
    expect(chamadas).toHaveLength(0);
  });

  it("salva na rota dele, com os extras lidos NA HORA do envio", async () => {
    await api.salvar({ identidade: { nome: "J" } });
    expect(extras).toHaveBeenCalledTimes(1);
    expect(chamadas[0]).toMatchObject({
      body: { empreendimentosDeInteresse: ["35"], identidade: { nome: "J" } },
      headers: { "x-autonomo-pre-sessao": "tok-aut" },
      url: "/api/publico/autonomo/cadastro",
    });
  });
});

describe("a resposta do envio público", () => {
  const responder = (corpo: unknown, status = 201) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(corpo), { status })));

  it("CAD e imobiliária: com o id da ficha, como sempre", async () => {
    responder({ autenticacao: "CAD-1", entityId: "e1" });
    expect(await salvarPublico("/x", {}, {})).toMatchObject({ autenticacao: "CAD-1", entityId: "e1" });
  });

  it("autônomo: `recebido`, sem id e sem código", async () => {
    responder({ autenticacao: "", cadBase64: null, recebido: true, savedDocs: [], warnings: [] });
    expect(await salvarPublico("/x", {}, {})).toMatchObject({ autenticacao: "", entityId: "" });
  });

  it("sem id, sem código e sem `recebido`, é falha", async () => {
    responder({ ok: true });
    await expect(salvarPublico("/x", {}, {})).rejects.toThrow();
  });

  it("erro do servidor chega com a frase dele", async () => {
    responder({ error: "Confira o CPF." }, 400);
    await expect(salvarPublico("/x", {}, {})).rejects.toThrow("Confira o CPF.");
  });
});
