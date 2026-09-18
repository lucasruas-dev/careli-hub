// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PlanoDaVenda } from "@/lib/hercules/fluxo-de-venda";

import {
  type CondicoesDaProposta,
  SimuladorDeProposta,
} from "./SimuladorDeProposta";

// O POLLING DO ESPELHO NÃO REINICIA O SIMULADOR (revisão 3, 18/09/2026).
//
// O espelho público relê a situação a cada 60 s, e a resposta traz os planos num ARRAY NOVO, com o
// mesmo conteúdo. Medido antes da correção: o cliente escolhia o NORMAL e, no minuto seguinte, o
// simulador voltava para o INVESTIDOR PARCELADO (o plano mais longo, onde o lote abre), com a entrada
// e o prazo dele. Aqui o simulador de verdade, no modo simulação (o do espelho), recebe a lista nova
// como o `PainelDoLote` a entrega a cada volta do polling.

(globalThis as unknown as { React: typeof React }).React = React;
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = {
  categoriaId: null,
  enterpriseId: "39",
  indiceCorrecao: "IPCA_ANUAL",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  sistemaAmortizacao: "sacoc",
  slot: null,
};

/** Os três planos do Garden como o espelho os entrega (PlanoPublico → PlanoDaVenda), com a 0178. */
const garden = (
  descontoDoParcelado = 8,
): Array<PlanoDaVenda & { ressalva?: null | string }> => [
  {
    ...BASE,
    anuaisQuantidade: 5,
    anuaisValor: 25_000,
    descontoPercentual: 0,
    entradaPercentual: 10,
    jurosTaxa: 6,
    nome: "NORMAL",
    parcelas: 60,
  },
  {
    ...BASE,
    anuaisQuantidade: 4,
    anuaisValor: 25_000,
    descontoPercentual: descontoDoParcelado,
    entradaPercentual: 8,
    jurosTaxa: 6,
    nome: "INVESTIDOR PARCELADO",
    parcelas: 84,
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
  },
];

let alvo: HTMLDivElement;
let raiz: Root;
let ultima: CondicoesDaProposta | null = null;
const aoMudar = (c: CondicoesDaProposta | null) => {
  ultima = c;
};

function montar(
  planos: Array<PlanoDaVenda & { ressalva?: null | string }>,
  unidade = "11 10",
  valor = 435_000,
) {
  act(() => {
    raiz.render(
      <SimuladorDeProposta
        aoMudarCondicoes={aoMudar}
        entradaMinimaPercentual={8}
        planos={planos}
        unidade={unidade}
        valorDaUnidade={valor}
        vocabulario="simulacao"
      />,
    );
  });
}

function cartao(nome: string): HTMLButtonElement {
  const achado = [...alvo.querySelectorAll("button")].find(
    (b) => b.firstElementChild?.textContent?.trim() === nome,
  );
  if (!achado) throw new Error(`cartão ${nome} ausente`);
  return achado;
}

function clicar(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function digitar(campo: HTMLInputElement, texto: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function campoParcelas(): HTMLInputElement {
  const label = [...alvo.querySelectorAll("label")].find(
    (l) => l.querySelector("span")?.textContent?.trim() === "Parcelas",
  );
  const achado = label?.querySelector("input");
  if (!achado) throw new Error("campo Parcelas ausente");
  return achado;
}

beforeEach(() => {
  alvo = document.createElement("div");
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
  ultima = null;
});

afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
});

describe("o polling de 60 s não reinicia o simulador do espelho", () => {
  it("⚠️ escolhido o NORMAL, a lista nova com o MESMO conteúdo mantém o NORMAL (e o resto da tela)", () => {
    montar(garden());
    // O lote abre no plano mais longo.
    expect(ultima?.planoNome).toBe("INVESTIDOR PARCELADO");

    clicar(cartao("NORMAL"));
    expect(ultima?.planoNome).toBe("NORMAL");
    const antes = ultima;

    // Três voltas do polling: um array novo a cada vez, objetos novos, conteúdo igual.
    for (let volta = 0; volta < 3; volta += 1)
      montar(garden().map((p) => ({ ...p })));

    expect(ultima?.planoNome).toBe("NORMAL");
    expect(ultima).toEqual(antes);
  });

  it("o que foi digitado também fica: o prazo de 48 no NORMAL sobrevive à volta do polling", () => {
    montar(garden());
    clicar(cartao("NORMAL"));
    digitar(campoParcelas(), "48");
    expect(ultima?.parcelasMensais).toBe(48);

    montar(garden().map((p) => ({ ...p })));

    expect(ultima?.planoNome).toBe("NORMAL");
    expect(ultima?.parcelasMensais).toBe(48);
  });

  it("plano que mudou DE VERDADE atualiza os números sem trocar a escolha", () => {
    montar(garden());
    clicar(cartao("INVESTIDOR PARCELADO"));
    expect(ultima?.valorNegociado).toBe(400_200);

    // O desconto do INVESTIDOR PARCELADO passou de 8% para 10% no cadastro, com a tela aberta.
    montar(garden(10));

    expect(ultima?.planoNome).toBe("INVESTIDOR PARCELADO");
    // O preço do plano no modo simulação acompanha o desconto novo: 435.000 × 0,90.
    expect(ultima?.valorNegociado).toBe(391_500);
    expect(ultima?.descontoDoPlanoPercentual).toBe(10);
  });

  it("escolhido o NORMAL, o desconto novo do outro plano muda o cartão dele e deixa o NORMAL", () => {
    montar(garden());
    clicar(cartao("NORMAL"));

    montar(garden(10));

    expect(ultima?.planoNome).toBe("NORMAL");
    expect(ultima?.valorNegociado).toBe(435_000);
    // O cartão do outro plano já é o da lista nova: 8% de entrada sobre 435.000 × 0,90 = R$ 31.320.
    expect(cartao("INVESTIDOR PARCELADO").textContent).toContain("R$ 31.320");
  });

  it("o plano escolhido que SAIU da lista faz o lote abrir de novo, no mais longo", () => {
    montar(garden());
    clicar(cartao("NORMAL"));

    montar(garden().filter((p) => p.nome !== "NORMAL"));

    expect(ultima?.planoNome).toBe("INVESTIDOR PARCELADO");
  });

  it("outro lote abre do zero, no plano mais longo, como sempre", () => {
    montar(garden());
    clicar(cartao("NORMAL"));

    montar(garden(), "11 11", 430_000);

    expect(ultima?.planoNome).toBe("INVESTIDOR PARCELADO");
    expect(ultima?.valorNegociado).toBe(395_600);
  });
});
