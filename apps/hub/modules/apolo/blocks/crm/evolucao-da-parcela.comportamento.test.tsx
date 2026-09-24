// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// EVOLUÇÃO DA PARCELA — o que esta sub-aba não pode deixar de fazer.
//
// Os números do dublê são os do contrato REAL do print do Lucas (LOS0617, Thiago): contrato de
// R$ 452,43, parcela de hoje R$ 481,94, 6,52% acima, IPCA ANUAL. É o mesmo caso que o extrato
// mostra ao lado, e as duas abas precisam contar a mesma história.
//
// ⚠️ O QUE ESTE ARQUIVO TRAVA:
//   • o valor de contrato e o de hoje aparecem LADO A LADO, que é o que explica a defasagem;
//   • cada linha da projeção diz se é FATO ou ESTIMATIVA — a peça vai para a mão do cliente;
//   • a premissa (% ao mês) fica VISÍVEL, e não escondida no código;
//   • trocar de cenário REFAZ a busca, senão a tela mostra o número do cenário anterior;
//   • contrato sem índice reconhecido DIZ por quê, em vez de sumir com a seção;
//   • manda o Bearer (a lição que custou a v1.366.0, no mesmo dia).

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: async () => "token-de-teste",
}));

vi.mock("@/modules/apolo/data/apolo-derive", () => ({
  entityC2xId: (entity: { c2xId?: null | number }) => entity.c2xId ?? null,
}));

const { EvolucaoDaParcela } = await import("./evolucao-da-parcela");

const CONTRATO = {
  codigo: "LOS0617",
  contratoId: 1066,
  defasagemPct: 6.52,
  empreendimento: "LAVRA DO OURO",
  encerrado: false,
  eventos: [
    {
      competencia: "07/2026",
      de: 452.43,
      parcela: 10,
      para: 481.94,
      persistencia: 3,
      rotulo: "Correção anual aplicada na emissão do boleto",
      tipo: "reajuste" as const,
      variacao: 0.0652,
    },
  ],
  indice: "IPCA" as const,
  indiceDoContrato: "IPCA ANUAL",
  indiceNoAno: 4.22,
  indicePublicadoAte: "202608",
  linhas: [
    { competencia: "202609", origem: "real" as const, valor: 481.94 },
    { competencia: "202709", origem: "projetado" as const, valor: 507.83 },
    { competencia: "202809", origem: "projetado" as const, valor: 535.12 },
  ],
  mensalidadeBase: 452.43,
  mensalidadeVigente: 481.94,
  mesTipicoPct: 0.437,
};

let container: HTMLDivElement;
let root: Root;
let pedidos: { init?: RequestInit; url: string }[] = [];

function texto(): string {
  return container.textContent ?? "";
}

async function montar(payload: unknown = [CONTRATO], entity: unknown = { c2xId: 1398 }) {
  pedidos = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      pedidos.push({ init, url });
      // A rota do PDF devolve blob, não JSON: o dublê precisa das duas formas, senão o teste do
      // botão passaria por um caminho que não existe em produção.
      if (url.includes("/pdf")) {
        return {
          blob: async () => new Blob(["%PDF-1.7"], { type: "application/pdf" }),
          headers: new Headers({
            "content-disposition": 'attachment; filename="Evolucao.pdf"',
          }),
          ok: true,
        };
      }
      return { json: async () => ({ data: payload }), ok: true };
    }),
  );

  await act(async () => {
    root.render(React.createElement(EvolucaoDaParcela, { entity } as never));
  });
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

describe("EvolucaoDaParcela", () => {
  it("mostra o valor de contrato e o de hoje lado a lado, com a defasagem", async () => {
    await montar();
    const t = texto();
    expect(t).toContain("452,43");
    expect(t).toContain("481,94");
    expect(t).toContain("6,5% acima do contrato");
    expect(t).toContain("IPCA ANUAL");
  });

  it("⚠️ cada linha diz se é FATO ou ESTIMATIVA: a peça vai para a mão do cliente", async () => {
    await montar();
    const t = texto();
    expect(t).toContain("O que paga hoje");
    expect(t).toContain("Estimativa");
    // E o aviso de que não é promessa fica no corpo, não numa nota escondida.
    expect(t).toContain("Não é promessa");
  });

  it("⚠️ a premissa fica visível: quem lê sabe de onde saiu o número", async () => {
    await montar();
    expect(texto()).toContain("0,44% ao mês");
  });

  it("mostra até quando o índice está publicado, porque a fonte atrasa um mês", async () => {
    await montar();
    const t = texto();
    expect(t).toContain("ago/2026");
    expect(t).toContain("a fonte atrasa um mês");
  });

  it("⚠️ trocar de cenário REFAZ a busca, e não reaproveita o número do anterior", async () => {
    await montar();
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toContain("cenario=tendencia");

    const botao = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Conservador",
    );
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(pedidos).toHaveLength(2);
    expect(pedidos[1]?.url).toContain("cenario=conservador");
  });

  it("⚠️ manda o Bearer: sem ele a rota devolve 401", async () => {
    await montar();
    const cabecalhos = (pedidos[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(cabecalhos.Authorization).toBe("Bearer token-de-teste");
  });

  it("⚠️ contrato sem índice DIZ por quê, em vez de sumir com a seção", async () => {
    await montar([
      {
        ...CONTRATO,
        indice: null,
        indiceDoContrato: null,
        linhas: [],
        motivo: "O contrato não registra índice de correção, então não dá para projetar.",
      },
    ]);
    const t = texto();
    expect(t).toContain("não registra índice de correção");
    // O que é FATO continua aparecendo: valor de contrato e valor de hoje.
    expect(t).toContain("452,43");
    expect(t).toContain("481,94");
  });

  it("⚠️ o PDF sai no cenário que está na TELA, e não sempre na tendência", async () => {
    await montar();

    const conservador = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Conservador",
    );
    await act(async () => {
      conservador?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const pdf = [...container.querySelectorAll("button")].find((b) => b.textContent === "PDF");
    expect(pdf).toBeDefined();
    await act(async () => {
      pdf?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const doPdf = pedidos.find((p) => p.url.includes("/pdf"));
    expect(doPdf?.url).toContain("cenario=conservador");
    const cabecalhos = (doPdf?.init?.headers ?? {}) as Record<string, string>;
    expect(cabecalhos.Authorization).toBe("Bearer token-de-teste");
  });

  it("cadastro sem ligação com o C2X explica, em vez de girar para sempre", async () => {
    await montar([CONTRATO], { c2xId: null });
    expect(texto()).toContain("não está ligado a um cliente do C2X");
    expect(pedidos).toHaveLength(0);
  });

  it("cliente sem contrato não deixa a aba vazia sem explicação", async () => {
    await montar([]);
    expect(texto()).toContain("não tem contrato com parcelas");
  });

  it("erro da rota aparece, com caminho de volta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({ error: "C2X fora do ar." }), ok: false })),
    );
    await act(async () => {
      root.render(
        React.createElement(EvolucaoDaParcela, { entity: { c2xId: 1398 } } as never),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(texto()).toContain("C2X fora do ar.");
    expect(texto()).toContain("Tentar de novo");
  });
});
