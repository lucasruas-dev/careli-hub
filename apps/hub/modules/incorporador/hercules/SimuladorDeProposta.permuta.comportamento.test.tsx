// @vitest-environment jsdom

// A TELA DA PERMUTA — o campo onde a pessoa digita o bem.
//
// Lucas, 22/09/2026, olhando o simulador no ar: *"eu não vi a parte da permuta, bem"*. A conta, a
// régua, a rota, o PDF e o contrato já sabiam de bens e permutas desde a 0187; o que nunca existiu
// foi o CAMPO. Este arquivo trava as cinco coisas que a tela tem de fazer, e a primeira delas é
// existir.
//
// ⚠️ O TESTE É DE TELA PORQUE O DEFEITO É DE TELA. `somarBensEPermutas`, `montarProposta` e
// `conferirProposta` têm os próprios testes e passavam com o bem inteiro — e mesmo assim nenhuma
// proposta do Panteon nascia com um carro dentro, porque ninguém tinha onde digitá-lo.
//
// ⚠️ E ELE OLHA O CARTÃO GRANDE, e não o estado. O número que a pessoa lê quando promete ao
// cliente é o "A financiar" da direita: é ele que tem de mexer quando o bem entra.
//
// ⚠️ EM 23/09/2026 O BLOCO PASSOU A EXISTIR NO ESPELHO PÚBLICO TAMBÉM. Este arquivo nasceu com a
// asserção contrária, escrita por mim: permuta seria negociação, e o espelho, vitrine. Lucas:
// *"permuta tem que entrar, não entendi sua colocação"*. As duas asserções foram invertidas, e o
// que o espelho ganhou está medido em `SimuladorDeProposta.permuta-no-espelho.comportamento`.

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PlanoDaVenda } from "@/lib/hercules/fluxo-de-venda";

import {
  type CondicoesDaProposta,
  SimuladorDeProposta,
} from "./SimuladorDeProposta";

(globalThis as unknown as { React: typeof React }).React = React;
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Um plano sem juros, de propósito: com taxa zero o SACOC é `financiado ÷ prazo`, e o número do
 * cartão pode ser conferido de cabeça. O que está sendo medido é o efeito do BEM sobre o saldo, e
 * não a amortização — essa já tem os testes dela.
 */
const PLANO: PlanoDaVenda = {
  descontoPercentual: 0,
  entradaPercentual: 10,
  id: "plano-1",
  indiceCorrecao: "SEM_CORRECAO",
  jurosConvencao: "efetiva",
  jurosPeriodicidade: "mensal",
  jurosTaxa: 0,
  nome: "NORMAL",
  parcelas: 120,
  sistemaAmortizacao: "sacoc",
  slot: null,
};

/** O lote do exemplo do Lucas: R$ 200.000, com o piso de 10% da casa. */
const VALOR_DO_LOTE = 200_000;

let alvo: HTMLDivElement;
let raiz: Root;
let ultima: CondicoesDaProposta | null = null;

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

function montar(vocabulario: "proposta" | "simulacao" = "proposta") {
  act(() => {
    raiz.render(
      <SimuladorDeProposta
        aoMudarCondicoes={(c) => {
          ultima = c;
        }}
        entradaMinimaPercentual={10}
        planos={[PLANO]}
        unidade="Q 01 L 02"
        valorDaUnidade={VALOR_DO_LOTE}
        vocabulario={vocabulario}
      />,
    );
  });
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

function escolher(campo: HTMLSelectElement, valor: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function porRotulo<T extends Element>(rotulo: string): T {
  const achado = alvo.querySelector<T>(`[aria-label="${rotulo}"]`);
  if (!achado) throw new Error(`"${rotulo}" não está na tela.`);
  return achado;
}

function botao(texto: string): HTMLButtonElement {
  const achado = [...alvo.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  );
  if (!achado) throw new Error(`Botão "${texto}" não está na tela.`);
  return achado;
}

/** O campo em reais da ENTRADA (o bloco com o rótulo "Valor" e o alternador R$/%). */
function campoDaEntrada(): HTMLInputElement {
  const rotulo = [...alvo.querySelectorAll("span")].find(
    (s) => s.textContent?.trim() === "Valor",
  );
  const achado = rotulo?.parentElement?.parentElement?.querySelector("input");
  if (!achado) throw new Error("campo da entrada ausente");
  return achado;
}

/** Acrescenta um item e o preenche, como a pessoa faria. */
function acrescentarBem(item: {
  descricao: string;
  entraComo: "abatimento" | "entrada";
  posicao: number;
  tipo: "bem" | "permuta";
  valor: string;
}) {
  clicar(botao("Acrescentar bem ou permuta"));
  escolher(
    porRotulo<HTMLSelectElement>(`Tipo do item ${item.posicao}`),
    item.tipo,
  );
  digitar(porRotulo<HTMLInputElement>(`Valor do item ${item.posicao}`), item.valor);
  digitar(
    porRotulo<HTMLInputElement>(`Descrição do item ${item.posicao}`),
    item.descricao,
  );
  clicar(
    porRotulo(
      item.entraComo === "entrada"
        ? `O item ${item.posicao} entra na entrada`
        : `O item ${item.posicao} só abate o valor negociado`,
    ),
  );
}

/** O valor de um bloco do cartão grande ("A financiar", "Entrada", "Total pago"). */
function doCartao(rotulo: string): string {
  const achado = [...alvo.querySelectorAll("div")].find(
    (d) => d.textContent === rotulo && d.childElementCount === 0,
  );
  const bloco = achado?.parentElement;
  if (!bloco) throw new Error(`o cartão não tem "${rotulo}"`);
  return bloco.children[1]?.textContent ?? "";
}

describe("o bloco existe nos DOIS, no portal e no espelho público", () => {
  // ⚠️ ESTE BLOCO DIZIA O CONTRÁRIO ATÉ 23/09/2026, e a asserção invertida está registrada aqui de
  // propósito. Eu havia decidido que permuta é negociação e não vitrine, e prendido o bloco em
  // `ehSimulacao`; Lucas, lendo isso: *"permuta tem que entrar, não entendi sua colocação"*. A
  // separação era minha, não dele. O que cada lado ganha e o que isso custa está em
  // `SimuladorDeProposta.permuta-no-espelho.comportamento.test.tsx`.
  it("no simulador do portal o bloco está lá, com o botão de acrescentar", () => {
    montar("proposta");
    expect(alvo.textContent ?? "").toContain("Bens e permutas");
    expect(botao("Acrescentar bem ou permuta")).toBeTruthy();
  });

  it("⚠️ e no espelho público também, desde que o Lucas mandou a permuta entrar", () => {
    montar("simulacao");
    expect(alvo.textContent ?? "").toContain("Bens e permutas");
    expect(botao("Acrescentar bem ou permuta")).toBeTruthy();
  });
});

describe("o carro de R$ 80.000 num lote de R$ 200.000 com R$ 5.000 em dinheiro", () => {
  // Lucas (22/09/2026): *"Abate, como uma entrada"* e, sobre a entrada mínima, *"pode ser um ou
  // outro, pode apontar na entrada ou somente no valor negociado"*.
  it("apontado NA ENTRADA: o cartão passa a dizer R$ 115.000 a financiar", () => {
    montar();
    digitar(campoDaEntrada(), "5.000");
    expect(doCartao("A financiar")).toBe("R$ 195.000");

    acrescentarBem({
      descricao: "Ford Ka 2019 placa ABC1D23",
      entraComo: "entrada",
      posicao: 1,
      tipo: "bem",
      valor: "80.000",
    });

    expect(doCartao("A financiar")).toBe("R$ 115.000");
  });

  it("apontado NA ENTRADA ele cumpre o piso de 10%, e a tela para de acusar", () => {
    montar();
    digitar(campoDaEntrada(), "5.000");
    expect(alvo.textContent ?? "").toContain("Abaixo do mínimo");

    acrescentarBem({
      descricao: "Ford Ka 2019 placa ABC1D23",
      entraComo: "entrada",
      posicao: 1,
      tipo: "bem",
      valor: "80.000",
    });

    expect(alvo.textContent ?? "").not.toContain("Abaixo do mínimo");
  });

  it("⚠️ apontado como ABATIMENTO abate igual, mas NÃO cumpre o piso", () => {
    montar();
    digitar(campoDaEntrada(), "5.000");

    acrescentarBem({
      descricao: "Ford Ka 2019 placa ABC1D23",
      entraComo: "abatimento",
      posicao: 1,
      tipo: "bem",
      valor: "80.000",
    });

    expect(doCartao("A financiar")).toBe("R$ 115.000");
    expect(alvo.textContent ?? "").toContain("Abaixo do mínimo");
  });

  it("dois itens somam: mais uma permuta de R$ 20.000 deixa R$ 95.000 a financiar", () => {
    montar();
    digitar(campoDaEntrada(), "5.000");
    acrescentarBem({
      descricao: "Ford Ka 2019 placa ABC1D23",
      entraComo: "entrada",
      posicao: 1,
      tipo: "bem",
      valor: "80.000",
    });
    acrescentarBem({
      descricao: "Lote 12 da quadra 4 em Anápolis",
      entraComo: "entrada",
      posicao: 2,
      tipo: "permuta",
      valor: "20.000",
    });

    expect(doCartao("A financiar")).toBe("R$ 95.000");
  });

  it("⚠️ removendo o PRIMEIRO de dois, o que sobra não herda os números do apagado", () => {
    // A chave da linha é a posição, então remover a primeira faz a segunda ocupar o lugar dela.
    // Se o campo de valor guardasse o texto da linha antiga, a tela mostraria R$ 80.000 num item
    // que vale R$ 20.000 — e o que sobe seria o de baixo, calado.
    montar();
    digitar(campoDaEntrada(), "5.000");
    acrescentarBem({
      descricao: "Ford Ka 2019 placa ABC1D23",
      entraComo: "entrada",
      posicao: 1,
      tipo: "bem",
      valor: "80.000",
    });
    acrescentarBem({
      descricao: "Lote 12 da quadra 4 em Anápolis",
      entraComo: "entrada",
      posicao: 2,
      tipo: "permuta",
      valor: "20.000",
    });

    clicar(porRotulo("Remover o item 1"));

    expect(doCartao("A financiar")).toBe("R$ 175.000");
    // ⚠️ COM CENTAVOS: o campo reescreve o texto quando o valor vem DE FORA (`valorParaOCampo`), e
    // aqui ele veio — o item que sobrou ocupou a posição do apagado. O que se prova é que não
    // sobrou "80.000" de pé.
    expect(porRotulo<HTMLInputElement>("Valor do item 1").value).toBe(
      "20.000,00",
    );
    expect(porRotulo<HTMLInputElement>("Descrição do item 1").value).toBe(
      "Lote 12 da quadra 4 em Anápolis",
    );
    expect(ultima?.bensEPermutas).toHaveLength(1);
    expect(ultima?.bensEPermutas?.[0]?.valor).toBe(20_000);
  });

  it("e remover o item devolve a conta ao que era", () => {
    montar();
    digitar(campoDaEntrada(), "5.000");
    acrescentarBem({
      descricao: "Ford Ka 2019 placa ABC1D23",
      entraComo: "entrada",
      posicao: 1,
      tipo: "bem",
      valor: "80.000",
    });
    expect(doCartao("A financiar")).toBe("R$ 115.000");

    clicar(porRotulo("Remover o item 1"));
    expect(doCartao("A financiar")).toBe("R$ 195.000");
  });
});

describe("⚠️ o que está na tela SOBE para quem vai gerar a proposta", () => {
  // ⚠️ ESTE É O DEFEITO QUE JÁ ACONTECEU DUAS VEZES AQUI (13/09 e 22/09/2026): a composição sobe
  // por um efeito com lista de dependências explícita, e campo que não entra nela fica na tela sem
  // chegar ao pedido. O silêncio é o problema: a tela mostra o carro, a proposta nasce sem ele, e o
  // cliente que entregou o Ford Ka recebe boleto do valor cheio.
  it("a lista inteira viaja em `bensEPermutas`, com tipo, valor, descrição e onde entra", () => {
    montar();
    expect(ultima?.bensEPermutas ?? null).toBeNull();

    acrescentarBem({
      descricao: "Ford Ka 2019 placa ABC1D23",
      entraComo: "entrada",
      posicao: 1,
      tipo: "bem",
      valor: "80.000",
    });
    acrescentarBem({
      descricao: "Lote 12 da quadra 4 em Anápolis",
      entraComo: "abatimento",
      posicao: 2,
      tipo: "permuta",
      valor: "20.000",
    });

    expect(ultima?.bensEPermutas).toEqual([
      {
        descricao: "Ford Ka 2019 placa ABC1D23",
        entraComo: "entrada",
        tipo: "bem",
        valor: 80_000,
      },
      {
        descricao: "Lote 12 da quadra 4 em Anápolis",
        entraComo: "abatimento",
        tipo: "permuta",
        valor: 20_000,
      },
    ]);
  });

  it("e trocar SÓ o `entraComo` sobe de novo: o abatimento não muda o saldo, mas muda a régua", () => {
    montar();
    acrescentarBem({
      descricao: "Ford Ka 2019 placa ABC1D23",
      entraComo: "entrada",
      posicao: 1,
      tipo: "bem",
      valor: "80.000",
    });
    expect(ultima?.bensEPermutas?.[0]?.entraComo).toBe("entrada");

    clicar(porRotulo("O item 1 só abate o valor negociado"));
    expect(ultima?.bensEPermutas?.[0]?.entraComo).toBe("abatimento");
  });

  it("no espelho público, enquanto ninguém acrescenta nada, a lista continua nula", () => {
    // ⚠️ NULO, E NÃO `[]`, NOS DOIS VOCABULÁRIOS. Um array vazio em toda simulação faria
    // `bensEPermutas != null` deixar de significar "tem permuta" para quem lê o corpo depois.
    montar("simulacao");
    expect(ultima?.bensEPermutas ?? null).toBeNull();
  });
});
