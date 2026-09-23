// @vitest-environment jsdom

// A PERMUTA ENTRA NO ESPELHO PÚBLICO (23/09/2026).
//
// Na rodada do desconto eu escrevi, no código e nos testes, que a permuta continuaria fora do
// espelho, porque permuta é negociação e o espelho é vitrine. Lucas, em resposta direta: *"permuta
// tem que entrar, não entendi sua colocação"*. A separação era MINHA, não dele, e está desfeita —
// `SimuladorDeProposta.desconto-no-espelho` e `SimuladorDeProposta.permuta.comportamento` traziam a
// asserção contrária, e ela foi invertida junto com esta mudança.
//
// ⚠️ ENTÃO O ESPELHO PASSA A TER AS DUAS AUTORIDADES: o preço ajustado à mão e a lista de bens.
// `vocabulario` volta a ser só a PALAVRA (os rótulos "Valor simulado" e "Simulação montada"), que é
// o que o Lucas pediu em 10/09/2026 (*"não é proposta mas sim uma simulação de pagamento"*).
//
// ⚠️ E O TESTE OLHA O CARTÃO GRANDE, como o de `SimuladorDeProposta.permuta.comportamento`: o
// número que a pessoa lê quando decide é o "A financiar" da direita. Campo que aparece na tela sem
// mexer na conta é o defeito de 22/09 do Lucas (*"mesmo eu alterando o valor de entrada (...) ele
// não traz o valor que eu tinha colocado"*) com outro nome.

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PlanoDaVenda } from "@/lib/hercules/fluxo-de-venda";

import { type CondicoesDaProposta, SimuladorDeProposta } from "./SimuladorDeProposta";

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Um plano sem juros, de propósito: com taxa zero o SACOC é `financiado ÷ prazo`, e o número do
 * cartão se confere de cabeça. O que está sendo medido é o efeito do BEM sobre o saldo.
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

/** O espelho público monta este mesmo componente, com `vocabulario="simulacao"`. */
function montarOEspelho() {
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
        vocabulario="simulacao"
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
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function escolher(campo: HTMLSelectElement, valor: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(campo, valor);
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

/** O valor de um bloco do cartão grande ("A financiar", "Entrada", "Total pago"). */
function doCartao(rotulo: string): string {
  const achado = [...alvo.querySelectorAll("div")].find(
    (d) => d.textContent === rotulo && d.childElementCount === 0,
  );
  const bloco = achado?.parentElement;
  if (!bloco) throw new Error(`o cartão não tem "${rotulo}"`);
  return bloco.children[1]?.textContent ?? "";
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
  escolher(porRotulo<HTMLSelectElement>(`Tipo do item ${item.posicao}`), item.tipo);
  digitar(porRotulo<HTMLInputElement>(`Valor do item ${item.posicao}`), item.valor);
  digitar(porRotulo<HTMLInputElement>(`Descrição do item ${item.posicao}`), item.descricao);
  clicar(
    porRotulo(
      item.entraComo === "entrada"
        ? `O item ${item.posicao} entra na entrada`
        : `O item ${item.posicao} só abate o valor negociado`,
    ),
  );
}

describe("o bloco de bens e permutas existe no espelho público", () => {
  it("⚠️ o bloco e o botão de acrescentar estão na página sem login", () => {
    montarOEspelho();
    expect(alvo.textContent ?? "").toContain("Bens e permutas");
    expect(botao("Acrescentar bem ou permuta")).toBeTruthy();
  });

  it("⚠️ o carro de R$ 80.000 ABATE o saldo na hora, e não só aparece na lista", () => {
    // A trava de verdade nunca foi o desenho do bloco, e sim a conta (`bensDaNegociacao`): enquanto
    // ela zerava a lista no modo simulação, o campo podia estar na tela e o cartão não se mexia.
    montarOEspelho();
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

  it("apontado na entrada ele cumpre o piso de 10%, como no portal", () => {
    montarOEspelho();
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
});

// O BEM INCOMPLETO É AVISADO NA HORA (23/09/2026).
//
// ⚠️ A TELA ABATIA O DINHEIRO E O SERVIDOR RECUSAVA DEPOIS DO CLIQUE. Medido em 23/09/2026: a tela
// não exigia descrição nenhuma, mas `conferirBensEPermutasDoCorpo` exige — então um carro de
// R$ 80.000 sem descrição baixava o "A financiar" no cartão, a pessoa lia o número novo, clicava em
// "Salvar em PDF" e só ali recebia "Descreva o bem ou permuta na posição 1". Na página sem login não
// há ninguém para explicar isso ao visitante.
//
// ⚠️ O PADRÃO É O DA ENTRADA ABAIXO DO MÍNIMO: vermelho, na hora, e SEM TRAVAR A DIGITAÇÃO. Lucas
// (22/09/2026): *"na cecilio pode deixar tudo liberado, sem trava, somente com alertas (...) somente
// garante essa visão"*. Quem confere de verdade continua sendo o servidor, com a MESMA régua das
// duas rotas; a tela só para de deixar a pessoa descobrir no clique.
describe("⚠️ o bem incompleto avisa antes do clique em Gerar", () => {
  it("o item recém-acrescentado já diz o que falta, sem esperar o servidor", () => {
    montarOEspelho();
    clicar(botao("Acrescentar bem ou permuta"));
    expect(alvo.textContent ?? "").toContain("Descreva o bem ou permuta");
  });

  it("⚠️ os R$ 80.000 sem descrição: o cartão abate E a tela avisa, as duas coisas juntas", () => {
    montarOEspelho();
    digitar(campoDaEntrada(), "5.000");
    expect(doCartao("A financiar")).toBe("R$ 195.000");

    clicar(botao("Acrescentar bem ou permuta"));
    digitar(porRotulo<HTMLInputElement>("Valor do item 1"), "80.000");

    // O abatimento continua acontecendo: o aviso não é uma trava, é uma leitura a mais.
    expect(doCartao("A financiar")).toBe("R$ 115.000");
    expect(alvo.textContent ?? "").toContain("Descreva o bem ou permuta");
  });

  it("com a descrição escrita o aviso some, e é a MESMA régua do servidor", () => {
    montarOEspelho();
    clicar(botao("Acrescentar bem ou permuta"));
    digitar(porRotulo<HTMLInputElement>("Valor do item 1"), "80.000");
    digitar(porRotulo<HTMLInputElement>("Descrição do item 1"), "Ford Ka 2019 placa ABC1D23");
    expect(alvo.textContent ?? "").not.toContain("Descreva o bem ou permuta");
    expect(alvo.textContent ?? "").not.toContain("Informe o valor do bem ou permuta");
  });

  it("⚠️ espaço em branco não é descrição, do mesmo jeito que no servidor (`descricao.trim()`)", () => {
    montarOEspelho();
    clicar(botao("Acrescentar bem ou permuta"));
    digitar(porRotulo<HTMLInputElement>("Valor do item 1"), "80.000");
    digitar(porRotulo<HTMLInputElement>("Descrição do item 1"), "   ");
    expect(alvo.textContent ?? "").toContain("Descreva o bem ou permuta");
  });

  it("⚠️ e o valor zerado também avisa: `Number('')` é 0, e o servidor recusa zero", () => {
    // ⚠️ VALOR VAZIO É ERRO, NUNCA ZERO — a mesma frase que `conferirBensEPermutasDoCorpo` carrega.
    // Nesta casa `Number("")` virando 0 já emitiu cobrança de R$ 0,00; aqui viraria uma permuta de
    // zero reais impressa como se tivesse sido combinada com alguém.
    montarOEspelho();
    clicar(botao("Acrescentar bem ou permuta"));
    digitar(porRotulo<HTMLInputElement>("Descrição do item 1"), "Ford Ka 2019 placa ABC1D23");
    expect(alvo.textContent ?? "").toContain("Informe o valor do bem ou permuta");
  });
});

describe("⚠️ o que está na tela do espelho SOBE para quem monta o PDF", () => {
  it("a lista inteira viaja em `bensEPermutas`, com tipo, valor, descrição e onde entra", () => {
    // É por `aoMudarCondicoes` que o espelho (`EspelhoPublico`) monta o corpo do POST da folha.
    // Sem esta lista lá, a tela abate R$ 80.000 e o papel imprime o valor cheio, calado.
    montarOEspelho();
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

  it("⚠️ o desconto à mão e o bem andam juntos: 10% no lote E o carro no mesmo pedido", () => {
    montarOEspelho();
    const desconto = [...alvo.querySelectorAll("input")].find(
      (i) => i.getAttribute("placeholder") === "desconto",
    );
    if (!desconto) throw new Error("campo de desconto ausente");
    digitar(desconto, "10");

    acrescentarBem({
      descricao: "Ford Ka 2019 placa ABC1D23",
      entraComo: "entrada",
      posicao: 1,
      tipo: "bem",
      valor: "80.000",
    });

    expect(ultima).toMatchObject({
      ajuste: { modo: "percentual", valor: -10 },
      valorNegociado: 180_000,
    });
    expect(ultima?.bensEPermutas).toHaveLength(1);
  });

  it("a PALAVRA continua a da simulação: o rótulo é 'Valor simulado'", () => {
    // O que mudou foi a AUTORIDADE, e não a palavra: ali é simulação mesmo (Lucas, 10/09/2026).
    montarOEspelho();
    expect(alvo.textContent ?? "").toContain("Simulação montada");
    expect(alvo.textContent ?? "").not.toContain("Proposta montada");
  });
});
