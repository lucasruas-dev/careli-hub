import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { consumir } from "@/lib/publico/cad/rate-limit";
import {
  assinarPreSessaoAutonomo,
  assinarPreSessaoImob,
  donoUploadPreAutonomo,
  emitirSessao,
  HEADER_PRE_SESSAO_AUTONOMO,
  preSessaoAutonomoDoRequest,
  verificarPreSessao,
  verificarPreSessaoAutonomo,
  verificarPreSessaoImob,
  verificarSessao,
} from "@/lib/publico/cad/sessao";

// A PRÉ-SESSÃO DO LINK DO CORRETOR AUTÔNOMO (01/10/2026).
//
// É o comprovante de que o portão do CPF foi vencido NO SERVIDOR, e é a chave anti-troca do cadastro:
// o CPF sai daqui, nunca do corpo. Se ela pudesse ser forjada, alterada ou trocada por outro token,
// um anônimo pagaria o OCR do cadastro de outra pessoa e gravaria a ficha com o CPF que quisesse.

const CPF = "52998224725";
const original = process.env.SESSAO_CAD_SECRET;

beforeEach(() => {
  process.env.SESSAO_CAD_SECRET = "segredo-de-teste";
});

afterEach(() => {
  if (original === undefined) delete process.env.SESSAO_CAD_SECRET;
  else process.env.SESSAO_CAD_SECRET = original;
});

function trocarCorpo(token: string, novo: Record<string, unknown>): string {
  const [cabecalho, , assinatura] = token.split(".");
  const corpo = Buffer.from(JSON.stringify(novo)).toString("base64url");
  return `${cabecalho}.${corpo}.${assinatura}`;
}

describe("a pré-sessão do autônomo", () => {
  it("emite e lê de volta o CPF conferido, só com dígitos", () => {
    const emitido = assinarPreSessaoAutonomo({ cpf: "529.982.247-25" });
    expect(emitido.ok).toBe(true);
    if (!emitido.ok) return;
    const lido = verificarPreSessaoAutonomo(emitido.token);
    expect(lido).toEqual({ ok: true, pre: { cpf: CPF } });
  });

  it("chega pelo header próprio, e só por ele", () => {
    const emitido = assinarPreSessaoAutonomo({ cpf: CPF });
    if (!emitido.ok) throw new Error("não emitiu");
    const comHeader = new Request("https://c2x.app.br/api/publico/autonomo/cadastro", {
      headers: { [HEADER_PRE_SESSAO_AUTONOMO]: emitido.token },
    });
    expect(preSessaoAutonomoDoRequest(comHeader).ok).toBe(true);
    const emOutroHeader = new Request("https://c2x.app.br/api/publico/autonomo/cadastro", {
      headers: { "x-cad-pre-sessao-imob": emitido.token },
    });
    expect(preSessaoAutonomoDoRequest(emOutroHeader).ok).toBe(false);
  });

  it("recusa o token com o CPF trocado depois de assinado", () => {
    const emitido = assinarPreSessaoAutonomo({ cpf: CPF });
    if (!emitido.ok) throw new Error("não emitiu");
    const adulterado = trocarCorpo(emitido.token, {
      cpf: "11144477735",
      exp: Math.floor(Date.now() / 1000) + 600,
      preAutonomo: true,
    });
    expect(verificarPreSessaoAutonomo(adulterado).ok).toBe(false);
  });

  it("recusa o token vencido", () => {
    const emitido = assinarPreSessaoAutonomo({ cpf: CPF });
    if (!emitido.ok) throw new Error("não emitiu");
    process.env.SESSAO_CAD_SECRET = "segredo-de-teste";
    const agora = Date.now;
    try {
      Date.now = () => agora() + 2 * 60 * 60 * 1000;
      expect(verificarPreSessaoAutonomo(emitido.token)).toEqual({
        error: "Sessão expirada.",
        ok: false,
      });
    } finally {
      Date.now = agora;
    }
  });

  it("falha FECHADA sem o segredo: não emite nem aceita", () => {
    const emitido = assinarPreSessaoAutonomo({ cpf: CPF });
    if (!emitido.ok) throw new Error("não emitiu");
    delete process.env.SESSAO_CAD_SECRET;
    expect(assinarPreSessaoAutonomo({ cpf: CPF }).ok).toBe(false);
    expect(verificarPreSessaoAutonomo(emitido.token).ok).toBe(false);
  });

  it("não aceita os tokens dos outros links, e o dele não vale nos outros", () => {
    const imob = assinarPreSessaoImob({ cnpj: "12345678000195" });
    const cad = emitirSessao({
      corretorEmail: "ana@imob.com.br",
      corretorEntityId: "corretor-1",
      corretorNome: "Ana",
      enterpriseIds: ["10"],
      imobiliariaEntityId: "imob-1",
      imobiliariaNome: "Imob",
      sessaoId: "s-1",
    });
    const autonomo = assinarPreSessaoAutonomo({ cpf: CPF });
    if (!imob.ok || !cad.ok || !autonomo.ok) throw new Error("não emitiu");

    expect(verificarPreSessaoAutonomo(imob.token).ok).toBe(false);
    expect(verificarPreSessaoAutonomo(cad.token).ok).toBe(false);
    expect(verificarPreSessaoImob(autonomo.token).ok).toBe(false);
    expect(verificarSessao(autonomo.token).ok).toBe(false);
    expect(verificarPreSessao(autonomo.token).ok).toBe(false);
  });

  it("o dono do upload é estável e não carrega o CPF em claro", () => {
    const dono = donoUploadPreAutonomo({ cpf: CPF });
    expect(dono).toBe(donoUploadPreAutonomo({ cpf: CPF }));
    expect(dono).not.toContain(CPF);
    expect(dono).not.toBe(donoUploadPreAutonomo({ cpf: "11144477735" }));
  });
});

// O LIMITE DE TENTATIVAS DO PORTÃO DO CPF: "este CPF já é autônomo?" é um oráculo apontado para a
// internet. Quem erra três vezes não sente nada; quem varre cai no atraso e depois no bloqueio.
function bancoSimples() {
  const linhas: Array<{ balde: string; chave_hash: string; contador: number; janela_inicio: string }> = [];
  return {
    from() {
      const filtros: Array<[string, unknown]> = [];
      let valores: Record<string, unknown> = {};
      let atualizando = false;
      const casa = (linha: Record<string, unknown>) =>
        filtros.every(([coluna, valor]) => linha[coluna] === valor);
      const cadeia: Record<string, unknown> = {};
      Object.assign(cadeia, {
        eq: (coluna: string, valor: unknown) => {
          filtros.push([coluna, valor]);
          return cadeia;
        },
        insert: async (linha: (typeof linhas)[number]) => {
          linhas.push({ ...linha });
          return { error: null };
        },
        maybeSingle: async () => {
          const achada = linhas.find((l) => casa(l));
          return { data: achada ? { contador: achada.contador } : null, error: null };
        },
        select: () => {
          if (!atualizando) return cadeia;
          const alvo = linhas.filter((l) => casa(l));
          for (const linha of alvo) Object.assign(linha, valores);
          return Promise.resolve({ data: alvo.map((l) => ({ contador: l.contador })), error: null });
        },
        update: (novos: Record<string, unknown>) => {
          atualizando = true;
          valores = novos;
          return cadeia;
        },
      });
      return cadeia;
    },
  };
}

describe("o balde do portão do autônomo", () => {
  it("deixa 24 tentativas, atrasa as três seguintes e depois barra", async () => {
    const client = bancoSimples() as never;
    const vereditos = [];
    for (let i = 0; i < 28; i += 1) vereditos.push(await consumir(client, "autonomo", "ip-1"));

    expect(vereditos.slice(0, 24).every((v) => v.permitido && v.esperaMs === 0)).toBe(true);
    expect(vereditos.slice(24, 27).every((v) => v.permitido && v.esperaMs > 0)).toBe(true);
    expect(vereditos[27]?.permitido).toBe(false);
  });

  it("é um balde próprio: não gasta o teto do credenciamento de imobiliária", async () => {
    const client = bancoSimples() as never;
    for (let i = 0; i < 28; i += 1) await consumir(client, "autonomo", "ip-1");
    const imobiliaria = await consumir(client, "imobiliaria", "ip-1");
    expect(imobiliaria).toEqual({ esperaMs: 0, permitido: true, teto: 24 });
  });
});
