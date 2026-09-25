// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FaixaDePrazo } from "@/lib/hercules/premissa-do-prazo";
import type { PlanoDaVenda } from "@/lib/hercules/fluxo-de-venda";

import { type CondicoesDaProposta, SimuladorDeProposta } from "./SimuladorDeProposta";

// O CARTÃO QUE DECIDE A VENDA PRECISA CONHECER A PREMISSA (25/09/2026).
//
// ⚠️ AFIRMAÇÃO EM CAIXA ALTA: ATÉ ESTE TESTE A TELA TINHA DOIS NÚMEROS PARA A MESMA VENDA. A rota, a
// prévia da modal e o PDF passaram a usar o plano EFETIVO (cadastro → faixa de prazo → o que o
// corretor escreveu por cima); `planosDaConta` continuou sendo um `map` dos planos CRUS, e é dele que
// saem os CARTÕES da tabela do lote e as COMPOSIÇÕES da busca por parcela. O número grande que o
// coordenador lê antes de clicar em Gerar discordava do papel que sai, dentro da MESMA modal.
//
// ⚠️ É EXATAMENTE A CLASSE DO DEFEITO DE 04/09/2026 — R$ 2.157,44 no cartão e R$ 1.500,00 no papel —
// que `premissa-efetiva.ts`, `premissa-do-prazo.ts` e a própria rota citam três vezes cada.
//
// ⚠️ E O CARTÃO É O CLIQUE: é dele que saem `valorNegociado`, `entradaValor`, `parcela` e
// `parcelasMensais` que sobem para a modal. O número que o coordenador anota e repete ao cliente
// nasce aqui.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = {
  anuaisQuantidade: null,
  anuaisValor: null,
  categoriaId: null,
  descontoPercentual: 0,
  enterpriseId: "33",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "mensal",
  ressalva: null,
  sistemaAmortizacao: "sacoc",
  slot: null,
} as const;

/**
 * O LBF INVESTIDOR 02, como o banco o tem — e é o caso que dói.
 *
 * Medido em 25/09/2026 (`select p.nome, p.parcelas, p.juros_taxa, f.parcela_minima, f.parcela_maxima,
 * f.define_juros, f.juros_taxa from temis_planos p join temis_faixas_de_prazo f on f.enterprise_id =
 * p.enterprise_id and f.ativo and p.parcelas between f.parcela_minima and f.parcela_maxima where
 * p.ativo and p.enterprise_id = '33'`): o plano de 48 parcelas tem `juros_taxa` NULO (SEM JUROS) e a
 * faixa de 37 a 60 tem `define_juros = true` com 0,8000.
 */
const INVESTIDOR_02: PlanoDaVenda & { ressalva?: null | string } = {
  ...BASE,
  entradaPercentual: 20,
  id: "plano-investidor-02",
  indiceCorrecao: "IPCA_ANUAL",
  jurosTaxa: null,
  nome: "INVESTIDOR 02",
  parcelas: 48,
};

/** Um segundo plano, para o cartão NÃO ATIVO ter quem medir. */
const NORMAL_02: PlanoDaVenda & { ressalva?: null | string } = {
  ...BASE,
  entradaPercentual: 12,
  id: "plano-normal-02",
  indiceCorrecao: "IPCA_ANUAL",
  jurosTaxa: 0.8,
  nome: "NORMAL 02",
  parcelas: 120,
};

/** A faixa de 37 a 60 do LBF: ela DEFINE juros de 0,8% ao mês onde o cadastro não tem juros. */
const FAIXA_37_A_60: FaixaDePrazo = {
  defineEntrada: false,
  defineIndice: true,
  defineJuros: true,
  entradaPercentual: null,
  indiceCorrecao: "SEM_CORRECAO",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "mensal",
  jurosTaxa: 0.8,
  parcelaMaxima: 60,
  parcelaMinima: 37,
};

let alvo: HTMLDivElement;
let raiz: Root;
let ultima: CondicoesDaProposta | null = null;

function montar(faixas: FaixaDePrazo[]) {
  act(() => {
    raiz.render(
      <SimuladorDeProposta
        aoMudarCondicoes={(c) => {
          ultima = c;
        }}
        entradaMinimaPercentual={10}
        faixasDePrazo={faixas}
        planos={[INVESTIDOR_02, NORMAL_02]}
        unidade="03 06"
        valorDaUnidade={150_000}
      />,
    );
  });
}

/** O que o cartão de um plano escreve, pela posição na tabela do lote. */
function cartao(posicao: number): { correcao: string; parcela: string } {
  const botoes = [...alvo.querySelectorAll("button")].filter((b) =>
    b.querySelector('[data-cartao="nome"]'),
  );
  const botao = botoes[posicao];
  if (!botao) throw new Error(`O cartão ${posicao} não está na tela.`);
  return {
    correcao: botao.querySelector('[data-cartao="correcao"]')?.textContent ?? "",
    parcela: botao.querySelector('[data-cartao="parcela"]')?.textContent ?? "",
  };
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

describe("o cartão do plano conta a mesma história do papel", () => {
  // ⚠️ SEM FAIXA, NADA MUDA. É o estado de metade dos empreendimentos, e a prova de que este lote não
  // mexe no preço de quem não tem faixa cadastrada.
  it("sem faixa cadastrada, o cartão continua escrevendo a premissa do cadastro", () => {
    montar([]);
    expect(cartao(0).correcao).toContain("IPCA anual");
    expect(cartao(1).correcao).toContain("0,8% a.m.");
  });

  // ⚠️ O CARTÃO ATIVO E O CARTÃO AO LADO, os dois. `planosDaConta` é um `map` 1:1 de `planos`, e a
  // sobrescrita do corretor vale só na posição do plano ATIVO — a faixa vale em todas.
  it("⚠️ com faixa, o cartão do plano escreve a correção da FAIXA, e não a do cadastro", () => {
    montar([FAIXA_37_A_60]);
    // O INVESTIDOR 02 tem 48 parcelas: cai na faixa de 37 a 60, que manda SEM_CORRECAO.
    expect(cartao(0).correcao).toContain("sem correção");
    // O NORMAL 02 tem 120: nenhuma faixa o contém, então ele fica como o cadastro manda.
    expect(cartao(1).correcao).toContain("IPCA anual");
  });

  // ⚠️ O NÚMERO, E NÃO SÓ A PALAVRA. `juros_taxa` NULO no cadastro contra 0,8% ao mês na faixa é o
  // que muda a conta do cartão.
  //
  // ⚠️ E O SACOC ESCONDE ISSO NA PRIMEIRA PARCELA, que é justamente o número que o cartão mostra: no
  // SACOC o primeiro ciclo é amortização PURA (`cronograma.ts`, `faixasDeReajuste`), e 120.000 ÷ 48 =
  // R$ 2.500,00 com ou sem juros — a mesma coincidência que fez a corretora conferir R$ 2.595,00 na
  // 000038 e achar que estava certo. Por isso a medição do NÚMERO usa um plano PRICE, onde a taxa
  // entra na primeira parcela, e a medição da PALAVRA usa a linha de correção do cartão.
  it("⚠️ a parcela do cartão muda quando a faixa DEFINE juros que o cadastro não tem", () => {
    const emPrice = { ...INVESTIDOR_02, sistemaAmortizacao: "price" };
    const desenhar = (faixas: FaixaDePrazo[]) => {
      act(() => {
        raiz.render(
          <SimuladorDeProposta
            aoMudarCondicoes={() => {}}
            entradaMinimaPercentual={10}
            faixasDePrazo={faixas}
            planos={[emPrice]}
            unidade="03 06"
            valorDaUnidade={150_000}
          />,
        );
      });
      return cartao(0).parcela;
    };

    const semFaixa = desenhar([]);
    const comFaixa = desenhar([FAIXA_37_A_60]);

    expect(semFaixa).toBe("R$ 2.500");
    expect(comFaixa).not.toBe(semFaixa);
    expect(cartao(0).correcao).toContain("0,8% a.m.");
  });

  // ⚠️ E A FAIXA NÃO É ALTERAÇÃO DO CORRETOR: ela é cadastro aprovado pela diretoria, e por isso não
  // abre a caixa de nota. Confundir os dois faria toda venda do LBF pedir justificativa.
  it("a faixa aplicada aos cartões não carimba o corretor como autor", () => {
    montar([FAIXA_37_A_60]);
    expect(ultima?.premissaAlterada).toBe(false);
    expect(ultima?.jurosEscolhido).toBeNull();
  });
});
