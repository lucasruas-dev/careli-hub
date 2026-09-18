// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoteDoEspelho } from "@/lib/hercules/espelho/estado-do-espelho";
import type { PlanoPublico } from "@/lib/hercules/espelho/planos-publicos";

import { EspelhoPublico } from "./EspelhoPublico";

// O POLLING DE 60 S DO ESPELHO PÚBLICO, DE PONTA A PONTA (revisão 3, 18/09/2026).
//
// A página relê `/api/publico/espelho/situacao` a cada minuto e troca o estado inteiro pela resposta
// (`setEstado(corpo.data)`): os planos chegam num array novo, com o mesmo conteúdo. Medido antes da
// correção: o painel do lote aberto no NORMAL voltava sozinho para o INVESTIDOR PARCELADO (84 parcelas)
// na primeira volta. Aqui a página de verdade, com o relógio falso e o `fetch` devolvendo a mesma
// situação, como o servidor devolve quando nada mudou.

(globalThis as unknown as { React: typeof React }).React = React;
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = {
  indiceCorrecao: "IPCA_ANUAL",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  sistemaAmortizacao: "sacoc",
} as const;

const planos = (): PlanoPublico[] => [
  {
    ...BASE,
    anuaisQuantidade: 5,
    anuaisValor: 25_000,
    descontoPercentual: 0,
    entradaPercentual: 10,
    jurosTaxa: 6,
    nome: "NORMAL",
    parcelas: 60,
    ressalva: null,
  },
  {
    ...BASE,
    anuaisQuantidade: 4,
    anuaisValor: 25_000,
    descontoPercentual: 8,
    entradaPercentual: 8,
    jurosTaxa: 6,
    nome: "INVESTIDOR PARCELADO",
    parcelas: 84,
    ressalva: "válido para as próximas 16 unidades",
  },
  {
    ...BASE,
    anuaisQuantidade: 3,
    anuaisValor: 30_000,
    descontoPercentual: 12,
    entradaPercentual: 40,
    jurosTaxa: 0,
    nome: "INVESTIDOR",
    parcelas: 36,
    ressalva: null,
  },
];

const lote = (): LoteDoEspelho =>
  ({
    andar: null,
    apartamento: null,
    area: 420,
    codigo: "GDN1110",
    grupo: "Quadra 11",
    lote: "10",
    numero: "10",
    preco: 435_000,
    quadra: "11",
    rotulo: "Quadra 11 · Lote 10",
    situacao: "disponivel",
    tipoProduto: "loteamento",
  }) as unknown as LoteDoEspelho;

/** A situação como a rota a devolve: objetos novos a cada chamada. */
const situacao = () => ({
  atualizadoEm: "2026-09-18T12:00:00.000Z",
  contagem: { disponivel: 1, indisponivel: 0 },
  empreendimento: { codigo: "garden", nome: "Garden" },
  entradaMinimaPercentual: 8,
  lotes: [lote()],
  planos: planos(),
  temMapa: false,
});

let alvo: HTMLDivElement;
let raiz: Root;
let pedidos: string[];

function clicar(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function cartao(nome: string): HTMLButtonElement {
  const achado = [...alvo.querySelectorAll("button")].find(
    (b) => b.firstElementChild?.textContent?.trim() === nome,
  );
  if (!achado) throw new Error(`cartão ${nome} ausente`);
  return achado;
}

function prazoNaTela(): string {
  const label = [...alvo.querySelectorAll("label")].find(
    (l) => l.querySelector("span")?.textContent?.trim() === "Parcelas",
  );
  return label?.querySelector("input")?.value ?? "";
}

beforeEach(() => {
  vi.useFakeTimers();
  pedidos = [];
  vi.stubGlobal("matchMedia", (q: string) => ({
    addEventListener() {},
    matches: false,
    media: q,
    removeEventListener() {},
  }));
  vi.stubGlobal("fetch", async (url: string) => {
    pedidos.push(String(url));
    return new Response(JSON.stringify({ data: situacao() }), { status: 200 });
  });
  alvo = document.createElement("div");
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
});

afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("EspelhoPublico: o polling não reinicia o simulador", () => {
  it("⚠️ escolhido o NORMAL, a volta de 60 s (mesmo conteúdo, array novo) mantém o NORMAL", async () => {
    act(() => {
      raiz.render(<EspelhoPublico inicial={situacao() as never} token="tok" />);
    });

    // Abre o lote pela grade: o simulador abre no plano mais longo.
    const quadradinho = [...alvo.querySelectorAll("button")].find((b) =>
      b.title.includes("Disponível"),
    );
    expect(quadradinho).toBeTruthy();
    clicar(quadradinho!);
    expect(prazoNaTela()).toBe("84");

    clicar(cartao("NORMAL"));
    expect(prazoNaTela()).toBe("60");

    // Duas voltas do polling.
    for (let volta = 1; volta <= 2; volta += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(
        pedidos.filter((u) => u.includes("/api/publico/espelho/situacao")),
      ).toHaveLength(volta);
      expect(prazoNaTela()).toBe("60");
    }
  });
});
