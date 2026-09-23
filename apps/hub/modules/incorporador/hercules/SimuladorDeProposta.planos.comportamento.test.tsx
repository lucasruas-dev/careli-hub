// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PlanoDaVenda } from "@/lib/hercules/fluxo-de-venda";
import { ajusteFrenteAoPlano } from "@/lib/hercules/tabela-do-lote";

import { type CondicoesDaProposta, SimuladorDeProposta } from "./SimuladorDeProposta";

// OS PLANOS DO GARDEN NA TELA — rodada 2 de 18/09/2026 ("tem que ser igual o mmendes").
//
// O simulador de verdade, montado com os três planos do Garden (0178 aplicada), conferindo três
// regras que só existem na tela:
//
//   • item 5: a composição de outro plano diz o preço e o desconto dela, e escolhê-la leva os dois
//     para o campo do lote (o mesmo que sobe para a proposta e o PDF);
//   • item 6: o desconto só é "do plano" no prazo do plano; fora dele sobe como exceção, e a
//     `ModalDeProposta` pede a nota (`ajusteFrenteAoPlano`);
//   • item 7: no modo simulação (espelho público, sem login) o desconto ficava preso ao do plano —
//     REABERTO DE PROPÓSITO em 23/09/2026 por decisão do Lucas (**"Liberar para todo mundo"**), e o
//     que ficou no lugar está logo abaixo e em `SimuladorDeProposta.desconto-no-espelho`.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = {
  categoriaId: null,
  enterpriseId: "39",
  indiceCorrecao: "IPCA_ANUAL",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  sistemaAmortizacao: "sacoc",
  slot: null,
};

/** As três linhas de `temis_planos` do Garden, como a rota da Mesa as entrega, com a 0178. */
const GARDEN: Array<PlanoDaVenda & { ressalva?: null | string }> = [
  { ...BASE, anuaisQuantidade: 5, anuaisValor: 25_000, descontoPercentual: 0, entradaPercentual: 10, jurosTaxa: 6, nome: "NORMAL", parcelas: 60, ressalva: null },
  { ...BASE, anuaisQuantidade: 4, anuaisValor: 25_000, descontoPercentual: 8, entradaPercentual: 8, jurosTaxa: 6, nome: "INVESTIDOR PARCELADO", parcelas: 84, ressalva: "válido para as próximas 16 unidades" },
  { ...BASE, anuaisQuantidade: 3, anuaisValor: 30_000, descontoPercentual: 12, entradaPercentual: 40, jurosTaxa: 0, nome: "INVESTIDOR", parcelas: 36, ressalva: null },
];

let alvo: HTMLDivElement;
let raiz: Root;
let ultima: CondicoesDaProposta | null = null;
const aoMudar = (c: CondicoesDaProposta | null) => {
  ultima = c;
};

function montar(vocabulario: "proposta" | "simulacao" = "proposta") {
  act(() => {
    raiz.render(
      <SimuladorDeProposta
        aoMudarCondicoes={aoMudar}
        entradaMinimaPercentual={8}
        planos={GARDEN}
        unidade="11 10"
        valorDaUnidade={435_000}
        vocabulario={vocabulario}
      />,
    );
  });
}

function botao(texto: string): HTMLButtonElement {
  const achado = [...alvo.querySelectorAll("button")].find(
    (b) => b.textContent?.replace(/\s/g, " ").trim() === texto,
  );
  if (!achado) throw new Error(`botão ${texto} ausente`);
  return achado;
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
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** O campo de texto de um rótulo do cockpit ("Parcela", "Parcelas"). */
function campo(rotulo: string): HTMLInputElement {
  const label = [...alvo.querySelectorAll("label")].find(
    (l) => l.querySelector("span")?.textContent?.trim() === rotulo ||
      l.querySelector("span span")?.textContent?.trim() === rotulo,
  );
  const achado = label?.querySelector("input");
  if (!achado) throw new Error(`campo ${rotulo} ausente`);
  return achado;
}

/** O valor que o campo do lote escreve ao lado de "Proposta" (ou "Valor simulado"). */
function valorNoCampo(rotulo = "Proposta"): string {
  return (
    [...alvo.querySelectorAll("span")]
      .find((s) => s.textContent === rotulo)
      ?.nextElementSibling?.textContent?.replace(/\s/g, " ") ?? ""
  );
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

describe("item 5: o preço que a tela mostra é o preço que sobe", () => {
  it("a recomendada de outro plano diz o valor e o desconto dela no cartão", () => {
    montar();
    // O lote abre no INVESTIDOR PARCELADO (R$ 400.200). Pedindo R$ 5.000, a recomendada é o NORMAL.
    digitar(campo("Parcela"), "5.000");
    expect(ultima?.planoNome).toBe("NORMAL");
    expect(alvo.textContent).toContain("Plano NORMAL · R$ 435.000 (tabela)");
    expect(valorNoCampo()).toBe("R$ 435.000,00");
  });

  it("a recomendada do plano com desconto diz o desconto dela", () => {
    montar();
    clicar(cartao("NORMAL"));
    clicar(botao("R$ 3.000"));
    expect(ultima?.planoNome).toBe("INVESTIDOR PARCELADO");
    expect(alvo.textContent).toContain("Plano INVESTIDOR PARCELADO · R$ 400.200 (desconto de 8%)");
  });

  it("escolher a composição (Editar) leva o valor e o desconto dela para o campo do lote", () => {
    montar();
    clicar(cartao("NORMAL"));
    clicar(botao("R$ 3.000"));
    clicar(botao("Editar"));
    // Agora é o ramo montado, com o plano da composição ativo: o campo é o que sobe.
    expect(ultima).toMatchObject({
      ajuste: { modo: "percentual", valor: -8 },
      descontoDoPlanoPercentual: 8,
      planoNome: "INVESTIDOR PARCELADO",
      valorNegociado: 400_200,
    });
    expect(valorNoCampo()).toBe("R$ 400.200,00");
    expect(alvo.textContent).toContain("Desconto de 8% do plano");
  });

  it("mexer no desconto enquanto o campo mostra a composição de outro plano edita ESSA composição", () => {
    montar();
    // INVESTIDOR PARCELADO ativo; pedindo R$ 5.000, a recomendada é o NORMAL a R$ 435.000.
    digitar(campo("Parcela"), "5.000");
    expect(ultima?.planoNome).toBe("NORMAL");
    const desconto = [...alvo.querySelectorAll("input")].find(
      (i) => i.getAttribute("placeholder") === "desconto",
    )!;
    digitar(desconto, "3");
    // O NORMAL recomendado vai para o cockpit e os 3% valem sobre ele: 435.000 × 0,97.
    expect(ultima).toMatchObject({
      ajuste: { modo: "percentual", valor: -3 },
      descontoDoPlanoPercentual: 0,
      parcelasMensais: 60,
      planoNome: "NORMAL",
      valorNegociado: 421_950,
    });
    expect(valorNoCampo()).toBe("R$ 421.950,00");
    // Desconto num plano sem desconto é exceção: a modal pede a nota.
    expect(
      ajusteFrenteAoPlano({
        ajuste: ultima!.ajuste,
        descontoDoPlanoPercentual: ultima!.descontoDoPlanoPercentual,
        precoDeTabela: 435_000,
        valorNegociado: ultima!.valorNegociado,
      }),
    ).toBe("desconto");
  });

  it("⚠️ desconto à mão no plano ativo vale também para a busca por parcela", () => {
    montar();
    // INVESTIDOR PARCELADO com 10% digitados (R$ 391.500) em vez dos 8% do plano.
    const desconto = [...alvo.querySelectorAll("input")].find(
      (i) => i.getAttribute("placeholder") === "desconto",
    )!;
    digitar(desconto, "10");
    expect(ultima?.valorNegociado).toBe(391_500);
    clicar(botao("R$ 3.000"));
    expect(ultima).toMatchObject({
      ajuste: { modo: "percentual", valor: -10 },
      planoNome: "INVESTIDOR PARCELADO",
      valorNegociado: 391_500,
    });
    expect(valorNoCampo()).toBe("R$ 391.500,00");
  });
});

describe("⚠️ regressão: empreendimento sem desconto de plano (enterprise 20)", () => {
  const BASE_20 = { ...BASE, enterpriseId: "20", jurosPeriodicidade: "mensal" };
  const PLANOS_20: PlanoDaVenda[] = [
    { ...BASE_20, entradaPercentual: 0, jurosTaxa: 0, nome: "Investidor", parcelas: 24 },
    { ...BASE_20, entradaPercentual: 20, jurosTaxa: 0, nome: "Curto", parcelas: 36 },
    { ...BASE_20, entradaPercentual: 10, jurosTaxa: 0.6434, nome: "Normal", parcelas: 120 },
  ];

  it("desconto digitado no modo parcela continua no modo parcela e vale para toda composição", () => {
    act(() => {
      raiz.render(
        <SimuladorDeProposta
          aoMudarCondicoes={aoMudar}
          entradaMinimaPercentual={10}
          planos={PLANOS_20}
          unidade="01 01"
          valorDaUnidade={178_100}
        />,
      );
    });
    clicar(botao("R$ 1.500"));
    const desconto = [...alvo.querySelectorAll("input")].find(
      (i) => i.getAttribute("placeholder") === "desconto",
    )!;
    digitar(desconto, "5");
    // Continua a recomendada (modo parcela), agora sobre 178.100 × 0,95 = 169.195.
    expect(alvo.textContent).toContain("Recomendada · menor entrada");
    expect(ultima).toMatchObject({
      ajuste: { modo: "percentual", valor: -5 },
      descontoDoPlanoPercentual: 0,
      valorNegociado: 169_195,
    });
    expect(valorNoCampo()).toBe("R$ 169.195,00");
    // E o cartão da composição não ganha a linha de preço: ela fecha sobre o preço do campo.
    expect(alvo.textContent).not.toContain("(tabela)");
    expect(alvo.textContent).not.toContain("(desconto de");
  });
});

describe("item 6: o desconto só é do plano no prazo do plano", () => {
  it("INVESTIDOR levado a 84 parcelas: os 12% sobem como exceção, e a modal pede a nota", () => {
    montar();
    clicar(cartao("INVESTIDOR"));
    expect(ultima).toMatchObject({ descontoDoPlanoPercentual: 12, parcelasMensais: 36 });
    expect(alvo.textContent).toContain("Desconto de 12% do plano");

    digitar(campo("Parcelas"), "84");
    expect(ultima).toMatchObject({
      ajuste: { modo: "percentual", valor: -12 },
      descontoDoPlanoPercentual: 0,
      parcelasMensais: 84,
      valorNegociado: 382_800,
    });
    // A tela deixa de chamar de "do plano"…
    expect(alvo.textContent).not.toContain("Desconto de 12% do plano");
    // …e a régua da modal (`ajusteFrenteAoPlano`, a mesma que abre a caixa de nota) diz exceção.
    expect(
      ajusteFrenteAoPlano({
        ajuste: ultima!.ajuste,
        descontoDoPlanoPercentual: ultima!.descontoDoPlanoPercentual,
        precoDeTabela: 435_000,
        valorNegociado: ultima!.valorNegociado,
      }),
    ).toBe("desconto");

    // De volta ao prazo do plano, é a tabela de novo.
    digitar(campo("Parcelas"), "36");
    expect(ultima?.descontoDoPlanoPercentual).toBe(12);
  });
});

// ⚠️ O ITEM 7 FOI REABERTO EM 23/09/2026, DE PROPÓSITO, E COM O RISCO POSTO. Ele media a trava do
// espelho público: campo de desconto escondido, valor preso ao do plano, e o que se digitasse no
// campo oculto não entrava em conta nenhuma. Lucas, perguntado diretamente, com as três opções e o
// risco escrito em cada uma: **"Liberar para todo mundo"**. O que continua valendo é o que este
// bloco passa a medir: o desconto do PLANO segue sendo o ponto de partida do campo, e continua
// sendo reconhecido como desconto de tabela — o que mudou é que agora dá para digitar por cima.
describe("item 7: no espelho público o desconto do plano é o PONTO DE PARTIDA, e não uma trava", () => {
  it("os controles de desconto aparecem, e o campo abre com o desconto do plano", () => {
    montar("simulacao");
    // Até 22/09/2026 esta linha (sentido, moeda e número) vinha com `display: none`.
    const controles = alvo.querySelector<HTMLElement>("[data-controles-do-desconto]");
    expect(controles?.style.display).toBe("flex");
    expect(ultima).toMatchObject({
      ajuste: { modo: "percentual", valor: -8 },
      descontoDoPlanoPercentual: 8,
      planoNome: "INVESTIDOR PARCELADO",
      valorNegociado: 400_200,
    });
    expect(valorNoCampo("Valor simulado")).toBe("R$ 400.200,00");

    clicar(cartao("INVESTIDOR"));
    expect(ultima).toMatchObject({ descontoDoPlanoPercentual: 12, valorNegociado: 382_800 });
    clicar(cartao("NORMAL"));
    expect(ultima).toMatchObject({ ajuste: null, valorNegociado: 435_000 });
  });

  it("fora do prazo do plano o desconto deixa de ser 'do plano', como na Mesa de Venda", () => {
    montar("simulacao");
    clicar(cartao("INVESTIDOR"));
    digitar(campo("Parcelas"), "84");
    // ⚠️ O VALOR NÃO VOLTA MAIS PARA A TABELA. Os 12% ficam no campo como desconto À MÃO (é o mesmo
    // comportamento do comercial), e `descontoDoPlanoPercentual` zera para dizer que já não é
    // tabela. Quem segura o exagero é o teto do servidor, e não mais a tela.
    expect(ultima).toMatchObject({
      ajuste: { modo: "percentual", valor: -12 },
      descontoDoPlanoPercentual: 0,
      parcelasMensais: 84,
      valorNegociado: 382_800,
    });
    expect(valorNoCampo("Valor simulado")).toBe("R$ 382.800,00");
  });

  it("⚠️ e o que se digita no campo VALE: 50% na página sem login chegam à tela", () => {
    // É exatamente o buraco que a revisão de 18/09 fechou, reaberto a pedido do Lucas. A tela não é
    // mais a guarda: quem recusa os 50% é `valoresDaSimulacaoPublica`, e o visitante lê a frase em
    // vez de baixar o PDF (ver `route.desconto-no-espelho.test.ts`).
    montar("simulacao");
    const desconto = [...alvo.querySelectorAll("input")].find(
      (i) => i.getAttribute("placeholder") === "desconto",
    )!;
    digitar(desconto, "50");
    expect(ultima?.valorNegociado).toBe(217_500);
    expect(ultima?.ajuste).toEqual({ modo: "percentual", valor: -50 });
  });
});
