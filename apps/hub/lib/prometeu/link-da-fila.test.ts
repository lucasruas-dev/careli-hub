import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  emitirTokenDaFila,
  linkDaFilaDoCliente,
  verificarTokenDaFila,
} from "./link-da-fila";

// O QUE ESTE TESTE PROTEGE: a pagina publica da fila autoriza pelo TOKEN, nao por sessao. Se a
// assinatura deixar de ser conferida, trocar um uuid na barra de enderecos passa a abrir a
// posicao — e o nome — de outra pessoa do lancamento.
//
// O segredo vai por `vi.stubEnv` (e nao mexendo em process.env na mao) para o teste nao vazar
// ambiente entre casos e para nao repetir o nome da env em toda linha.
const SEGREDO = "segredo-de-teste";

beforeEach(() => {
  vi.stubEnv("SESSAO_CAD_SECRET", SEGREDO);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function token(credenciadoId = "cred-1", eventoId = "evento-1"): string {
  const emitido = emitirTokenDaFila({ credenciadoId, eventoId });
  if (!emitido.ok) throw new Error(emitido.error);

  return emitido.token;
}

describe("link da fila do cliente", () => {
  it("emite e verifica, devolvendo credenciado e evento", () => {
    const r = verificarTokenDaFila(token("cred-1", "evento-1"));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.c).toBe("cred-1");
    expect(r.payload.e).toBe("evento-1");
  });

  // O ATAQUE OBVIO: o id do credenciado circula no QR do cracha, entao o proximo passo de quem
  // recebe um link legitimo e' colar o id de outra pessoa dentro dele.
  it("recusa o token com o credenciado trocado", () => {
    const [cabecalho, , assinatura] = token().split(".");
    const corpoForjado = Buffer.from(
      JSON.stringify({ c: "cred-de-outra-pessoa", e: "evento-1", iat: 1 }),
    ).toString("base64url");

    const r = verificarTokenDaFila(`${cabecalho}.${corpoForjado}.${assinatura}`);

    expect(r.ok).toBe(false);
  });

  it("recusa token sem as tres partes, vazio ou nulo", () => {
    expect(verificarTokenDaFila("").ok).toBe(false);
    expect(verificarTokenDaFila(null).ok).toBe(false);
    expect(verificarTokenDaFila("abc.def").ok).toBe(false);
  });

  it("recusa token assinado com outro segredo", () => {
    const deOutroAmbiente = token();
    vi.stubEnv("SESSAO_CAD_SECRET", "outro-segredo");

    expect(verificarTokenDaFila(deOutroAmbiente).ok).toBe(false);
  });

  it("exige credenciado e evento na emissao", () => {
    expect(emitirTokenDaFila({ credenciadoId: "", eventoId: "evento-1" }).ok).toBe(false);
    expect(emitirTokenDaFila({ credenciadoId: "cred-1", eventoId: " " }).ok).toBe(false);
  });

  it("monta a URL publica com o token na query", () => {
    const link = linkDaFilaDoCliente({ credenciadoId: "cred-1", eventoId: "evento-1" });

    expect(link.startsWith("https://c2x.app.br/publico/fila?t=")).toBe(true);
    const t = decodeURIComponent(new URL(link).searchParams.get("t") ?? "");
    expect(verificarTokenDaFila(t).ok).toBe(true);
  });

  // FALHA FECHADA: sem segredo nao existe link assinado, e mandar um link que nao abre e' pior
  // que nao mandar link nenhum.
  it("sem segredo no ambiente nao emite link nem verifica", () => {
    vi.stubEnv("SESSAO_CAD_SECRET", "");

    expect(emitirTokenDaFila({ credenciadoId: "cred-1", eventoId: "evento-1" }).ok).toBe(false);
    expect(linkDaFilaDoCliente({ credenciadoId: "cred-1", eventoId: "evento-1" })).toBe("");
    expect(verificarTokenDaFila("qualquer.coisa.aqui").ok).toBe(false);
  });
});
