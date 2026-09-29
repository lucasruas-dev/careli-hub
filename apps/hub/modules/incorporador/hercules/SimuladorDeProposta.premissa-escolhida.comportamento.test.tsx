// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PlanoDaVenda } from "@/lib/hercules/fluxo-de-venda";

import { type CondicoesDaProposta, SimuladorDeProposta } from "./SimuladorDeProposta";

// A TAXA E O ÍNDICE QUE O CORRETOR ESCREVEU SOBEM COM AS CONDIÇÕES (25/09/2026).
//
// Nívea (24/09/2026), sobre a proposta 000038 (Vale do Ouro VOC, Quadra 12 · Lote 22, compradora
// TAISA FERNANDA BATISTA): *"Na proposta não está saindo o novo cenário de juros e correção."* Lucas,
// no mesmo dia: *"vamos corrigir isso ae"*.
//
// ⚠️ AFIRMAÇÃO EM CAIXA ALTA: A ESCOLHA DELA MORRIA NO NAVEGADOR. O objeto que este simulador entrega
// carregava só o booleano `premissaAlterada` — o que abre a caixa de nota na modal. O servidor sabia
// que ALGUÉM mexeu e não sabia no quê, e seguia calculando, gravando e imprimindo pelo cadastro.
// Medido em 25/09/2026 (`select plano_juros, plano_correcao, condicoes->'totais' from
// hercules_propostas where protocolo_numero = 38`): 0,7207, "IPCA anual" e `totais.mensais`
// 138.130,32, onde o cenário escolhido daria 48 × R$ 2.595,00 = R$ 124.560,00. São R$ 13.570,32.
//
// ⚠️ POR QUE UM TESTE DE TELA, E NÃO DE LIB. `premissa-efetiva.ts` já compõe cadastro → faixa →
// corretor, e tem teste próprio; isso não prova que ALGUÉM manda os valores. Um servidor preparado
// para campos que ninguém envia é o defeito de sempre — typecheck não liga peça nenhuma. Aqui o
// simulador de VERDADE é montado, e o que se mede é o que ele entrega em `aoMudarCondicoes`.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** O plano NORMAL do VOC, como o banco o tem (SELECT de 25/09/2026): 156x, 0,7207% a.m., IPCA anual. */
const NORMAL: PlanoDaVenda & { ressalva?: null | string } = {
  anuaisQuantidade: null,
  anuaisValor: null,
  categoriaId: null,
  descontoPercentual: 0,
  enterpriseId: "37",
  entradaPercentual: 10,
  id: "21b694ed-13d7-47ef-a983-bb09145b79c7",
  indiceCorrecao: "IPCA_ANUAL",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "mensal",
  jurosTaxa: 0.7207,
  nome: "NORMAL",
  parcelas: 156,
  ressalva: null,
  sistemaAmortizacao: "sacoc",
  slot: null,
};

let alvo: HTMLDivElement;
let raiz: Root;
let ultima: CondicoesDaProposta | null = null;

function montar() {
  act(() => {
    raiz.render(
      <SimuladorDeProposta
        aoMudarCondicoes={(c) => {
          ultima = c;
        }}
        entradaMinimaPercentual={10}
        planos={[NORMAL]}
        unidade="12 22"
        valorDaUnidade={148_401}
      />,
    );
  });
}

/** O campo "Juros % a.m." do bloco PRAZO, JUROS E REAJUSTE. */
function campoDosJuros(): HTMLInputElement {
  const achado = alvo.querySelector<HTMLInputElement>(
    'input[placeholder="em branco = o do cadastro"]',
  );
  if (!achado) throw new Error("O campo de juros não está na tela.");
  return achado;
}

/** O seletor "Correção" do mesmo bloco: é o que tem a opção "o do cadastro". */
function campoDaCorrecao(): HTMLSelectElement {
  const achado = [...alvo.querySelectorAll("select")].find((s) =>
    [...s.options].some((o) => o.textContent === "o do cadastro"),
  );
  if (!achado) throw new Error("O seletor de correção não está na tela.");
  return achado;
}

function escrever(campo: HTMLInputElement, valor: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function escolher(campo: HTMLSelectElement, valor: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(campo, valor);
    campo.dispatchEvent(new Event("change", { bubbles: true }));
  });
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

describe("a premissa escolhida sobe com as condições", () => {
  it("sem ninguém mexer, os dois campos sobem nulos — é o estado normal", () => {
    montar();

    expect(ultima).not.toBeNull();
    expect(ultima?.premissaAlterada).toBe(false);
    expect(ultima?.jurosEscolhido).toBeNull();
    expect(ultima?.indiceEscolhido).toBeNull();
  });

  // ⚠️ O CENÁRIO DA NÍVEA, TECLA POR TECLA: zerar os juros e escolher poupança anual.
  it("⚠️ juros 0 e poupança anual: os dois valores sobem, e não só o aviso", () => {
    montar();
    escrever(campoDosJuros(), "0");
    escolher(campoDaCorrecao(), "POUPANCA");

    expect(ultima?.premissaAlterada).toBe(true);
    expect(ultima?.jurosEscolhido).toBe(0);
    expect(ultima?.indiceEscolhido).toBe("POUPANCA");
  });

  // ⚠️ TAXA VAZIA VOLTA À PREMISSA, NÃO A ZERO — a regra mais fácil de quebrar deste caminho.
  // Apagar o campo é DESFAZER a alteração; para dizer "sem juros" ele escreve 0. `Number("")` é 0, e
  // confundir os dois zeraria os juros de um contrato porque alguém limpou um campo.
  it("⚠️ apagar o campo de juros volta à premissa: sobe nulo, e não zero", () => {
    montar();
    escrever(campoDosJuros(), "0");
    expect(ultima?.jurosEscolhido).toBe(0);

    escrever(campoDosJuros(), "");
    expect(ultima?.jurosEscolhido).toBeNull();
    expect(ultima?.premissaAlterada).toBe(false);
  });

  it("voltar a correção para 'o do cadastro' também sobe nulo", () => {
    montar();
    escolher(campoDaCorrecao(), "POUPANCA");
    expect(ultima?.indiceEscolhido).toBe("POUPANCA");

    escolher(campoDaCorrecao(), "");
    expect(ultima?.indiceEscolhido).toBeNull();
    expect(ultima?.premissaAlterada).toBe(false);
  });

  // ⚠️ SÓ O QUE ELE MEXEU. Zerar a taxa não pode carimbar o índice do cadastro como "escolhido": o
  // servidor grava a origem de cada campo (`condicoes.premissa`), e um carimbo errado aqui faria a
  // proposta dizer que o corretor escolheu o IPCA que ele nunca tocou.
  it("mexer só nos juros deixa o índice nulo", () => {
    montar();
    escrever(campoDosJuros(), "0,5");

    expect(ultima?.jurosEscolhido).toBe(0.5);
    expect(ultima?.indiceEscolhido).toBeNull();
  });
});
