// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PARCELAS A CORRIGIR — o que esta tela não pode deixar de fazer.
//
// ⚠️ O QUE ESTE ARQUIVO TRAVA:
//   • o dinheiro parado aparece no topo, formatado em reais, porque é o número que faz alguém agir;
//   • só CONTRATO DEFASADO entra na lista — quem está em dia não é trabalho, e listá-lo faria a
//     operação procurar agulha no palheiro;
//   • o que NÃO deu para apurar é contado à parte, e nunca somado com "em dia": são coisas
//     diferentes, e misturá-las esconderia contrato sem boleto nenhum;
//   • o total do RECORTE acompanha o filtro, senão a pessoa filtra um empreendimento e lê o número
//     da carteira inteira achando que é daquele;
//   • a leitura parcial AVISA, em vez de entregar lista incompleta com cara de completa.
//
// ⚠️ NÃO EXISTE VALIDAÇÃO NO NAVEGADOR AQUI, e é por um motivo medido em 23/09/2026: o dev server
// do preview sobe a partir do CHECKOUT PRINCIPAL, não do worktree, então toda página criada num
// worktree dá 404 nele. Este teste é a prova que resta, e é melhor: fica no repo.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: async () => "token-de-teste",
}));

const { PainelDefasagem } = await import("./painel-defasagem");

type Defasagem = {
  apurada: boolean;
  cobrado: number;
  contratual: number;
  futurasDefasadas: number;
  motivo?: string;
  percentual: number;
  porParcela: number;
  ultimoBoletoEm: null | string;
};

function linha(
  contratoId: number,
  code: string,
  cliente: string,
  defasagem: Partial<Defasagem>,
) {
  return {
    cliente,
    code,
    contratoId,
    defasagem: {
      apurada: true,
      cobrado: 657.27,
      contratual: 535.99,
      futurasDefasadas: 135,
      percentual: 22.63,
      porParcela: 121.28,
      ultimoBoletoEm: "2026-12-20",
      ...defasagem,
    },
    unidade: "Q01 L01",
  };
}

const PAYLOAD = {
  linhas: [
    linha(206, "LOU", "MARIA DA SILVA", {}),
    linha(417, "LOS", "RAFAEL CAETANO", {
      cobrado: 672.8,
      contratual: 452.43,
      percentual: 48.71,
      porParcela: 220.37,
    }),
    // Em dia: NÃO pode aparecer na lista.
    linha(900, "REP", "EM DIA", {
      cobrado: 600,
      contratual: 600,
      futurasDefasadas: 0,
      percentual: 0,
      porParcela: 0,
    }),
    // Não apurado: também fora da lista, mas contado à parte.
    linha(901, "REP", "SEM BOLETO", {
      apurada: false,
      cobrado: 0,
      contratual: 0,
      futurasDefasadas: 0,
      motivo: "Nenhum boleto emitido ainda",
      percentual: 0,
      porParcela: 0,
    }),
  ],
  parcial: false,
  resumo: {
    comDefasagem: 2,
    emDia: 1,
    medianaPct: 35.67,
    naoApurados: 1,
    porMes: 341.65,
    total: 4,
  },
};

let container: HTMLDivElement;
let root: Root;

function texto(): string {
  return container.textContent ?? "";
}

let ultimoPedido: null | { init?: RequestInit; url: string } = null;

async function montar(payload: unknown = PAYLOAD) {
  ultimoPedido = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      ultimoPedido = { init, url };
      return { json: async () => ({ data: payload }), ok: true };
    }),
  );

  await act(async () => {
    root.render(React.createElement(PainelDefasagem));
  });
  // Deixa o efeito de carga resolver.
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("PainelDefasagem", () => {
  it("mostra o dinheiro parado em reais, que é o número que faz alguém agir", async () => {
    await montar();
    expect(texto()).toContain("341,65");
    expect(texto()).toContain("Deixa de cobrar por mês");
  });

  it("⚠️ lista SÓ o que está defasado: quem está em dia não é trabalho", async () => {
    await montar();
    const t = texto();
    expect(t).toContain("MARIA DA SILVA");
    expect(t).toContain("RAFAEL CAETANO");
    expect(t).not.toContain("EM DIA");
    expect(t).not.toContain("SEM BOLETO");
  });

  it("⚠️ conta 'sem apurar' à parte, e nunca junto com 'em dia'", async () => {
    await montar();
    const t = texto();
    expect(t).toContain("Sem apurar");
    expect(t).toContain("sem boleto ou sem parcela futura");
  });

  it("mostra os dois valores lado a lado: o do sistema e o que já se cobra", async () => {
    await montar();
    const t = texto();
    expect(t).toContain("535,99");
    expect(t).toContain("657,27");
    expect(t).toContain("Hoje no sistema");
    expect(t).toContain("Já cobrado");
  });

  it("⚠️ o total do RECORTE acompanha o filtro, e não repete o da carteira", async () => {
    await montar();
    // Sem filtro: os dois defasados somam 341,65.
    expect(texto()).toContain("341,65");

    const busca = container.querySelector("input");
    expect(busca).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(busca, "RAFAEL");
      busca?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const t = texto();
    expect(t).toContain("RAFAEL CAETANO");
    expect(t).not.toContain("MARIA DA SILVA");
    // Agora o recorte soma só o do Rafael.
    expect(t).toContain("220,37");
    expect(t).toContain("1 contrato(s) neste recorte");
  });

  it("⚠️ leitura parcial AVISA que a lista não está completa", async () => {
    await montar({ ...PAYLOAD, parcial: true });
    expect(texto()).toContain("não é completa");
  });

  it("carteira sem defasagem nenhuma diz isso, em vez de tabela vazia sem explicação", async () => {
    await montar({
      linhas: [],
      parcial: false,
      resumo: { comDefasagem: 0, emDia: 0, medianaPct: 0, naoApurados: 0, porMes: 0, total: 0 },
    });
    expect(texto()).toContain("Nenhum contrato defasado");
  });

  it("erro da rota não deixa a tela em branco", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({ error: "C2X fora do ar." }),
        ok: false,
      })),
    );
    await act(async () => {
      root.render(React.createElement(PainelDefasagem));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(texto()).toContain("C2X fora do ar.");
    expect(texto()).toContain("Tentar de novo");
  });

  it("⚠️ manda o Bearer: sem ele a rota devolve 401 e a tela nunca carrega", async () => {
    await montar();
    // Este teste existe porque o defeito ACONTECEU: a primeira versão chamava a rota sem header
    // nenhum, e `authorizeApoloRead` recusa antes de qualquer coisa — inclusive em ambiente local.
    // Typecheck não pega, porque é só um fetch.
    const cabecalhos = (ultimoPedido?.init?.headers ?? {}) as Record<string, string>;
    expect(ultimoPedido?.url).toBe("/api/apolo/defasagem");
    expect(cabecalhos.Authorization).toBe("Bearer token-de-teste");
  });

  it("⚠️ a tela NÃO oferece botão de corrigir: o legado é read-only e a decisão é da operação", async () => {
    await montar();
    const botoes = [...container.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(botoes.some((b) => /corrigir|aplicar|reajustar/i.test(b))).toBe(false);
  });
});
