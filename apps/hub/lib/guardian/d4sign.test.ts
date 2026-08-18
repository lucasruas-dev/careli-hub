import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { d4signPdfHeaders, fetchD4SignContract } from "./d4sign";

// O QUE ESTE ARQUIVO PROTEGE: que NENHUMA chamada externa daqui fique sem prazo. `fetch` sem
// `AbortSignal` no Node espera o socket, e o padrão dele é praticamente eterno — numa rota de Next
// isso vira função pendurada até o `maxDuration`, com o usuário olhando um spinner. São duas
// chamadas (gerar o link e baixar o arquivo), e as duas precisam de sinal.
//
// ⚠️ E que a credencial NÃO VAZE no erro: a URL do D4Sign leva `tokenAPI` e `cryptKey` na query
// string, então nem a mensagem de erro nem o que o `catch` devolve podem repassar o erro do fetch.

const CREDENCIAIS = { crypt: "chave-de-teste", token: "token-de-teste" };

describe("fetchD4SignContract", () => {
  const fetchOriginal = globalThis.fetch;
  const envOriginal = {
    crypt: process.env.D4SIGN_CRYPT_KEY,
    token: process.env.D4SIGN_TOKEN_API,
  };

  beforeEach(() => {
    process.env.D4SIGN_TOKEN_API = CREDENCIAIS.token;
    process.env.D4SIGN_CRYPT_KEY = CREDENCIAIS.crypt;
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    process.env.D4SIGN_TOKEN_API = envOriginal.token;
    process.env.D4SIGN_CRYPT_KEY = envOriginal.crypt;
    vi.restoreAllMocks();
  });

  it("as DUAS chamadas levam AbortSignal — nenhuma pode esperar para sempre", async () => {
    const chamadas: (RequestInit | undefined)[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      chamadas.push(init);
      // 1ª chamada: o POST que gera o link. 2ª: o download do arquivo.
      if (chamadas.length === 1) {
        return { json: async () => ({ url: "https://arquivo.exemplo/contrato.pdf" }), ok: true };
      }
      return {
        arrayBuffer: async () => new ArrayBuffer(8),
        headers: new Headers({ "content-length": "8", "content-type": "application/pdf" }),
        ok: true,
      };
    }) as unknown as typeof fetch;

    const resultado = await fetchD4SignContract("5b797156-c96f-4699-9415-733bfbfe2648");

    expect(resultado.ok).toBe(true);
    expect(chamadas).toHaveLength(2);
    for (const init of chamadas) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    // ⚠️ SINAIS DISTINTOS, um por chamada. Reaproveitar o sinal do link no download faria o
    // arquivo herdar um orçamento já gasto: o POST demorou 7 s, o PDF nasceria com 1 s de vida.
    expect(chamadas[0]?.signal).not.toBe(chamadas[1]?.signal);
    expect(chamadas[1]?.signal?.aborted).toBe(false);
  });

  it("timeout responde 504, e não o 502 genérico de 'não conectou'", async () => {
    globalThis.fetch = (async () => {
      // É o formato que `AbortSignal.timeout` produz: um erro com `name` = "TimeoutError".
      const erro = new Error("The operation was aborted due to timeout");
      erro.name = "TimeoutError";
      throw erro;
    }) as unknown as typeof fetch;

    const resultado = await fetchD4SignContract("5b797156");

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.status).toBe(504);
    expect(resultado.error).toBe("O D4Sign demorou demais para responder.");
  });

  it("erro de rede continua 502, e a credencial não vaza na mensagem", async () => {
    globalThis.fetch = (async () => {
      // O erro real do fetch carrega a URL, e a URL carrega o token na query string.
      throw new Error(
        `connect ECONNREFUSED https://secure.d4sign.com.br/api/v1/documents/x/download?cryptKey=${CREDENCIAIS.crypt}&tokenAPI=${CREDENCIAIS.token}`,
      );
    }) as unknown as typeof fetch;

    const resultado = await fetchD4SignContract("5b797156");

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.status).toBe(502);
    expect(resultado.error).not.toContain(CREDENCIAIS.token);
    expect(resultado.error).not.toContain(CREDENCIAIS.crypt);
  });

  it("sem credencial no ambiente, nem toca na rede", async () => {
    delete process.env.D4SIGN_TOKEN_API;
    const espiao = vi.fn();
    globalThis.fetch = espiao as unknown as typeof fetch;

    const resultado = await fetchD4SignContract("5b797156");

    expect(espiao).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.status).toBe(503);
  });

  it("documento vazio nem chega a montar URL", async () => {
    const espiao = vi.fn();
    globalThis.fetch = espiao as unknown as typeof fetch;

    const resultado = await fetchD4SignContract("   ");

    expect(espiao).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.status).toBe(400);
  });
});

describe("d4signPdfHeaders", () => {
  it("força application/pdf e nosniff, e não deixa o navegador adivinhar o tipo", () => {
    const headers = d4signPdfHeaders("doc-1", "application/octet-stream", "1024");

    expect(headers.get("Content-Type")).toBe("application/pdf");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Content-Length")).toBe("1024");
    expect(headers.get("Cache-Control")).toBe("no-store");
  });
});
