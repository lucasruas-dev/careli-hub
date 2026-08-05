import { beforeAll, describe, expect, it } from "vitest";

import {
  criarTokenSessao,
  hashSenha,
  normalizarUsername,
  validarTokenSessao,
  verificarSenha,
  type PrometeuOperadorSessao,
} from "./operador-auth";

// Cada caso abaixo é uma forma de a autenticação falhar de um jeito perigoso.
beforeAll(() => {
  process.env.PROMETEU_SESSION_SECRET = "segredo-de-teste-nao-usar-em-prod";
});

const AGORA = 1_800_000_000_000; // instante fixo (Date.now não é usado na lib)

const sessaoBase: Omit<PrometeuOperadorSessao, "exp"> = {
  eventoId: "ev-1",
  mesaId: null,
  operadorId: "op-1",
  perfil: "organizador",
  username: "joao.silva",
  zona: "recepcao",
};

describe("hash de senha", () => {
  it("nunca guarda a senha em texto", async () => {
    const hash = await hashSenha("MinhaSenha123");
    expect(hash).not.toContain("MinhaSenha123");
    expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  });

  it("gera hash DIFERENTE para a mesma senha (sal aleatório)", async () => {
    const a = await hashSenha("igual");
    const b = await hashSenha("igual");
    expect(a).not.toBe(b);
  });

  it("aceita a senha certa e recusa a errada", async () => {
    const hash = await hashSenha("Correta!2026");
    expect(await verificarSenha("Correta!2026", hash)).toBe(true);
    expect(await verificarSenha("correta!2026", hash)).toBe(false);
    expect(await verificarSenha("", hash)).toBe(false);
  });

  it("não quebra com hash malformado", async () => {
    expect(await verificarSenha("x", "lixo")).toBe(false);
    expect(await verificarSenha("x", "")).toBe(false);
  });
});

describe("token de sessão", () => {
  it("valida um token recém-criado", () => {
    const token = criarTokenSessao(sessaoBase, AGORA);
    const sessao = validarTokenSessao(token, AGORA);
    expect(sessao?.operadorId).toBe("op-1");
    expect(sessao?.zona).toBe("recepcao");
    expect(sessao?.perfil).toBe("organizador");
  });

  it("recusa token EXPIRADO", () => {
    const token = criarTokenSessao(sessaoBase, AGORA);
    // 15h depois (TTL é 14h)
    const sessao = validarTokenSessao(token, AGORA + 15 * 60 * 60 * 1000);
    expect(sessao).toBeNull();
  });

  it("recusa token ADULTERADO (payload trocado)", () => {
    const token = criarTokenSessao(sessaoBase, AGORA);
    const [corpo, assinatura] = token.split(".");
    const outroCorpo = Buffer.from(
      JSON.stringify({ ...sessaoBase, operadorId: "op-INTRUSO", exp: AGORA + 1000 }),
    ).toString("base64url");
    const forjado = `${outroCorpo}.${assinatura}`;
    expect(validarTokenSessao(forjado, AGORA)).toBeNull();
    // sanidade: o original ainda vale
    expect(validarTokenSessao(`${corpo}.${assinatura}`, AGORA)).not.toBeNull();
  });

  it("recusa token assinado com OUTRO segredo", () => {
    const token = criarTokenSessao(sessaoBase, AGORA);
    process.env.PROMETEU_SESSION_SECRET = "outro-segredo";
    const sessao = validarTokenSessao(token, AGORA);
    process.env.PROMETEU_SESSION_SECRET = "segredo-de-teste-nao-usar-em-prod";
    expect(sessao).toBeNull();
  });

  it("recusa lixo e vazio sem lançar", () => {
    expect(validarTokenSessao(null, AGORA)).toBeNull();
    expect(validarTokenSessao("", AGORA)).toBeNull();
    expect(validarTokenSessao("sem-ponto", AGORA)).toBeNull();
    expect(validarTokenSessao(".abc", AGORA)).toBeNull();
  });
});

describe("normalizarUsername", () => {
  it("baixa a caixa e apara as pontas", () => {
    expect(normalizarUsername("  Joao.Silva ")).toBe("joao.silva");
  });
});
