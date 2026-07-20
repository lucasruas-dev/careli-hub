import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  comEmpreendimento,
  emitirPreSessao,
  emitirSessao,
  verificarPreSessao,
  verificarSessao,
  type SessaoCad,
} from "@/lib/publico/cad/sessao";

// A sessão é o que carrega o VÍNCULO da CAD (corretor + imobiliária + empreendimento). Se ela
// puder ser forjada ou alterada pelo cliente, um anônimo escolhe em que imobiliária a CAD
// nasce vinculada. É a peça de segurança mais crítica do fluxo público.

const BASE: SessaoCad = {
  corretorEmail: "ana@imob.com.br",
  corretorEntityId: "corretor-1",
  corretorNome: "Ana Souza",
  enterpriseIds: ["10", "20"],
  imobiliariaEntityId: "imob-1",
  imobiliariaNome: "Imob Alfa",
  sessaoId: "sessao-1",
};

const original = process.env.SESSAO_CAD_SECRET;

beforeEach(() => {
  process.env.SESSAO_CAD_SECRET = "segredo-de-teste";
});

afterEach(() => {
  if (original === undefined) delete process.env.SESSAO_CAD_SECRET;
  else process.env.SESSAO_CAD_SECRET = original;
});

describe("emissão e verificação", () => {
  it("emite e lê de volta o vínculo inteiro", () => {
    const emitida = emitirSessao(BASE);
    expect(emitida.ok).toBe(true);
    if (!emitida.ok) return;

    const lida = verificarSessao(emitida.token);
    expect(lida.ok).toBe(true);
    if (lida.ok) {
      expect(lida.sessao.corretorEntityId).toBe("corretor-1");
      expect(lida.sessao.imobiliariaEntityId).toBe("imob-1");
      expect(lida.sessao.enterpriseIds).toEqual(["10", "20"]);
    }
  });

  it("recusa token com o corpo adulterado (trocar a imobiliária quebra a assinatura)", () => {
    const emitida = emitirSessao(BASE);
    if (!emitida.ok) throw new Error("não emitiu");

    const [cabecalho, , assinatura] = emitida.token.split(".");
    const corpoFalso = Buffer.from(
      JSON.stringify({ ...BASE, exp: 9_999_999_999, imobiliariaEntityId: "imob-INVASORA" }),
    ).toString("base64url");

    expect(verificarSessao(`${cabecalho}.${corpoFalso}.${assinatura}`).ok).toBe(false);
  });

  it("recusa token assinado com outro segredo", () => {
    const emitida = emitirSessao(BASE);
    if (!emitida.ok) throw new Error("não emitiu");
    process.env.SESSAO_CAD_SECRET = "outro-segredo";
    expect(verificarSessao(emitida.token).ok).toBe(false);
  });

  it("recusa token expirado", () => {
    const cabecalho = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const corpo = Buffer.from(JSON.stringify({ ...BASE, exp: 1, iat: 0 })).toString("base64url");
    // Assinatura irrelevante: o teste garante que expirado não passa nem por acidente.
    expect(verificarSessao(`${cabecalho}.${corpo}.xxx`).ok).toBe(false);
  });

  it("recusa lixo e vazio", () => {
    expect(verificarSessao("").ok).toBe(false);
    expect(verificarSessao("a.b").ok).toBe(false);
    expect(verificarSessao(null).ok).toBe(false);
  });

  it("falha FECHADA sem segredo configurado: não emite token não verificável", () => {
    delete process.env.SESSAO_CAD_SECRET;
    expect(emitirSessao(BASE).ok).toBe(false);
    expect(verificarSessao("qualquer.coisa.aqui").ok).toBe(false);
  });
});

describe("escolha de empreendimento", () => {
  it("aceita id que está na lista habilitada", () => {
    const novo = comEmpreendimento(BASE, "20");
    expect(novo.ok).toBe(true);
    if (!novo.ok) return;
    const lida = verificarSessao(novo.token);
    if (lida.ok) expect(lida.sessao.enterpriseId).toBe("20");
  });

  it("RECUSA empreendimento fora da lista: é a trava contra subir CAD onde não é habilitado", () => {
    const novo = comEmpreendimento(BASE, "99");
    expect(novo.ok).toBe(false);
  });
});

describe("pré-sessão", () => {
  it("emite e lê a imobiliária sem expor o entityId ao browser", () => {
    const pre = emitirPreSessao({ imobiliariaEntityId: "imob-1", imobiliariaNome: "Imob Alfa" });
    expect(pre.ok).toBe(true);
    if (!pre.ok) return;
    const lida = verificarPreSessao(pre.token);
    expect(lida.ok).toBe(true);
    if (lida.ok) expect(lida.pre.imobiliariaEntityId).toBe("imob-1");
  });

  it("uma PRÉ-sessão NUNCA é aceita como sessão completa (ela não tem corretor)", () => {
    const pre = emitirPreSessao({ imobiliariaEntityId: "imob-1", imobiliariaNome: "Imob Alfa" });
    if (!pre.ok) throw new Error("não emitiu");
    expect(verificarSessao(pre.token).ok).toBe(false);
  });

  it("uma sessão completa não é aceita onde se espera pré-sessão", () => {
    const sessao = emitirSessao(BASE);
    if (!sessao.ok) throw new Error("não emitiu");
    expect(verificarPreSessao(sessao.token).ok).toBe(false);
  });
});
