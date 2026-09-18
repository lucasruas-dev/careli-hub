// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { valoresDaSimulacaoPublica } from "@/lib/hercules/espelho/simulacao-publica";
import { comoPlano, type LinhaDoPlano } from "@/lib/hercules/planos-do-panteon";
import { sistemaDoCadastro } from "@/lib/hercules/simulacao";

import { type CondicoesDaProposta, SimuladorDeProposta } from "./SimuladorDeProposta";

// REVISÃO DE 18/09/2026, LENTE "REGRESSÃO FORA DO GARDEN" (rodada 3 do fix/planos-como-mmendes).
//
// O simulador de verdade com os três planos reais do empreendimento 20 (SELECT em `temis_planos`,
// 18/09/2026: Investidor 24x 0%, Curto 36x 20%, Normal 120x 10% a 0,6434% a.m.; piso 10%) no lote
// mediano disponível (R$ 92.900). Os números da Mesa abaixo são os que a ORIGIN/MAIN sobe
// (`aoMudarCondicoes`), medidos com o mesmo roteiro contra a origin/main extraída: nos 11
// empreendimentos fora do Garden, abertura, clique em cada cartão, reforço à mão, busca por
// parcela e desconto à mão saíram iguais (193 leituras da Mesa em cada um dos dois conjuntos de
// preço, o mediano e o de um lote real). No espelho, 134 de 135 iguais: a diferença é o 42.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LINHAS_20: LinhaDoPlano[] = [
  { enterprise_id: "20", entrada_percentual: 0, indice_correcao: "SEM_CORRECAO", juros_convencao: "equivalente", juros_periodicidade: "mensal", juros_taxa: 0, nome: "Investidor", ordem: 0, parcelas: 24, sistema_amortizacao: "sacoc", slot: null },
  { enterprise_id: "20", entrada_percentual: 20, indice_correcao: "IPCA_ANUAL", juros_convencao: "equivalente", juros_periodicidade: "mensal", juros_taxa: 0, nome: "Curto", ordem: 0, parcelas: 36, sistema_amortizacao: "sacoc", slot: null },
  { enterprise_id: "20", entrada_percentual: 10, indice_correcao: "IPCA_ANUAL", juros_convencao: "equivalente", juros_periodicidade: "mensal", juros_taxa: 0.6434, nome: "Normal", ordem: 0, parcelas: 120, sistema_amortizacao: "sacoc", slot: null },
];

/** Como a Mesa entrega (`incorporador/venda`): o plano do Panteon com o dono e a ressalva. */
const MESA_20 = LINHAS_20.map((l) => ({ ...comoPlano(l), enterpriseId: "20", ressalva: null }));

/** Como o espelho entrega (`planosPublicos` → `EspelhoPublico`): anuais e desconto zerados. */
const ESPELHO_20 = LINHAS_20.map((l) => ({
  anuaisQuantidade: 0,
  anuaisValor: 0,
  descontoPercentual: 0,
  entradaPercentual: Number(l.entrada_percentual),
  indiceCorrecao: l.indice_correcao,
  jurosConvencao: "efetiva",
  jurosPeriodicidade: "mensal",
  jurosTaxa: Number(l.juros_taxa),
  nome: String(l.nome),
  parcelas: Number(l.parcelas),
  sistemaAmortizacao: sistemaDoCadastro(l.sistema_amortizacao),
  slot: null,
}));

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

function montar(vocabulario: "proposta" | "simulacao") {
  act(() => {
    raiz.render(
      <SimuladorDeProposta
        aoMudarCondicoes={(c) => {
          ultima = c;
        }}
        entradaMinimaPercentual={10}
        planos={(vocabulario === "proposta" ? MESA_20 : ESPELHO_20) as never}
        unidade="Q 01 L 01"
        valorDaUnidade={92_900}
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
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function cartao(nome: string): HTMLButtonElement {
  const achado = [...alvo.querySelectorAll("button")].find(
    (b) => b.firstElementChild?.textContent?.trim() === nome,
  );
  if (!achado) throw new Error(`cartão ${nome} ausente`);
  return achado;
}
function campo(rotulo: string): HTMLInputElement {
  const label = [...alvo.querySelectorAll("label")].find(
    (l) =>
      l.querySelector("span")?.textContent?.trim() === rotulo ||
      l.querySelector("span span")?.textContent?.trim() === rotulo,
  );
  const achado = label?.querySelector("input");
  if (!achado) throw new Error(`campo ${rotulo} ausente`);
  return achado;
}
/** O campo em reais da entrada (o bloco que tem o rótulo "Valor" e o alternador R$/%). */
function campoDaEntrada(): HTMLInputElement {
  const rotulo = [...alvo.querySelectorAll("span")].find((s) => s.textContent?.trim() === "Valor");
  const achado = rotulo?.parentElement?.parentElement?.querySelector("input");
  if (!achado) throw new Error("campo da entrada ausente");
  return achado as HTMLInputElement;
}
/** O que sobe, sem a data (ela depende do dia em que o teste roda). */
const semData = (c: CondicoesDaProposta | null) =>
  c ? { ...c, descontoDoPlanoPercentual: undefined, primeiraParcelaEm: undefined } : c;

describe("Mesa do 20: o que sobe é o da origin/main", () => {
  it("abre no Normal e o clique em cada cartão sobe o mesmo que a origin/main", () => {
    montar("proposta");
    expect(ultima).toMatchObject({ entradaValor: 9_290, parcela: 696.75, parcelasMensais: 120, planoNome: "Normal", valorNegociado: 92_900 });
    clicar(cartao("Investidor"));
    expect(ultima).toMatchObject({ entradaValor: 9_290, parcela: 3_483.75, parcelasMensais: 24, planoNome: "Investidor" });
    clicar(cartao("Curto"));
    expect(ultima?.entradaValor).toBe(18_580);
    expect(ultima?.parcela).toBeCloseTo(2_064.4444444444443, 8);
  });

  it("busca por R$ 2.500: Investidor, 2 × R$ 15.000, entrada R$ 10.000 (origin/main)", () => {
    montar("proposta");
    digitar(campo("Parcela"), "2.500");
    expect(semData(ultima)).toMatchObject({
      ajuste: null,
      anuaisQuantidade: 2,
      anuaisValor: 15_000,
      entradaValor: 10_000,
      parcelasMensais: 24,
      planoNome: "Investidor",
      valorNegociado: 92_900,
    });
    expect(ultima?.parcela).toBeCloseTo(2_204.1666666666665, 8);
  });
});

describe("espelho do 20: o PDF tem de sair com o que a tela mostra", () => {
  // ⚠️ ERA DEFEITO NA PRIMEIRA VERSÃO DA RODADA 3: a régua da tela e a da rota do PDF não eram a
  // mesma nos empreendimentos de escada irregular (20, 29, 38 e 42: um plano mais curto com entrada
  // MENOR que a de um mais longo). A tela exige a entrada da faixa do prazo (`pisoDaEntradaNoPrazo`: o
  // Curto encurtado para 24 cai na faixa do Investidor, 0%, e o piso do empreendimento, 10%, vale); a
  // rota (`valoresDaSimulacaoPublica`) exigia também a entrada do plano escolhido (20% do Curto) e
  // subia a entrada calada. CORRIGIDO (18/09/2026): a rota usa a régua da tela, e o PDF sai com o que
  // a tela mostra, como na origin/main.
  it("Curto em 24x com 10% de entrada: a tela aceita sem aviso e o PDF sai com os mesmos 10%", () => {
    montar("simulacao");
    clicar(cartao("Curto"));
    digitar(campo("Parcelas"), "24");
    digitar(campoDaEntrada(), "9.290");

    // A tela aceita: nenhum "Abaixo do mínimo", e é isto que o botão do PDF manda.
    expect(alvo.textContent).not.toContain("Abaixo do mínimo");
    expect(ultima).toMatchObject({ entradaValor: 9_290, parcelasMensais: 24, planoNome: "Curto", valorNegociado: 92_900 });

    // O que a rota do PDF faz com esse pedido (mesma função, mesmos planos e o mesmo piso).
    const curto = ESPELHO_20[1]!;
    const aceita = valoresDaSimulacaoPublica({
      anuaisPedidas: { quantidade: ultima?.anuaisQuantidade, valor: ultima?.anuaisValor },
      entradaMinimaPercentual: 10,
      entradaPedida: ultima?.entradaValor,
      parcelasPedidas: ultima?.parcelasMensais,
      plano: curto,
      planos: ESPELHO_20,
      precoDeTabela: 92_900,
      valorPedido: ultima?.valorNegociado,
    });
    expect(aceita.ok).toBe(true);
    // Na primeira versão da rodada 3 saía 18.580 (20% do Curto) no papel, contra 9.290 na tela.
    expect(aceita.ok && aceita.entrada).toBe(9_290);
  });
});
