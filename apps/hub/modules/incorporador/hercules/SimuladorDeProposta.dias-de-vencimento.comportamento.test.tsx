// @vitest-environment jsdom

// OS DIAS DE VENCIMENTO DO EMPREENDIMENTO NO BLOCO COBRANÇA (Lucas, 02/10/2026).
//
// O que a tela tem de fazer: oferecer como atalho os dias cadastrados no empreendimento da unidade,
// já nascer marcando o primeiro (com a primeira parcela calculada por ele), e, sem cadastro, oferecer
// os 10 e 20 de sempre COM o aviso. Sem a prop (leitura que falhou), 10 e 20 SEM aviso.

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DiasDeVencimento } from "@/lib/hercules/dias-de-vencimento";
import type { PlanoDaVenda } from "@/lib/hercules/fluxo-de-venda";
import { proximoVencimento } from "@/lib/hercules/proposta-na-tela";

import { type CondicoesDaProposta, SimuladorDeProposta } from "./SimuladorDeProposta";

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function montar(diasDeVencimento?: DiasDeVencimento | null) {
  act(() => {
    raiz.render(
      <SimuladorDeProposta
        aoMudarCondicoes={(c) => {
          ultima = c;
        }}
        diasDeVencimento={diasDeVencimento}
        entradaMinimaPercentual={10}
        planos={[PLANO]}
        unidade="Q 01 L 02"
        valorDaUnidade={200_000}
      />,
    );
  });
}

/** Os atalhos do bloco Cobrança, na ordem da tela. */
const atalhos = () =>
  [...alvo.querySelectorAll("button")]
    .map((b) => b.textContent?.trim() ?? "")
    .filter((texto) => /^dia \d+$/.test(texto));

const aviso = () => alvo.querySelector('[role="note"]')?.textContent ?? null;

describe("os atalhos do dia de vencimento", () => {
  it("são os dias cadastrados no empreendimento, e o primeiro já nasce marcado", () => {
    montar({ cadastrado: true, dias: [5, 15, 25], origem: "filho" });
    expect(atalhos()).toEqual(["dia 5", "dia 15", "dia 25"]);
    expect(ultima?.diaDeVencimento).toBe(5);
    expect(aviso()).toBeNull();
  });

  it("a primeira parcela calculada sai do primeiro dia da lista", () => {
    montar({ cadastrado: true, dias: [5, 15], origem: "pai" });
    expect(ultima?.primeiraParcelaEm).toBe(proximoVencimento(new Date().toISOString(), 5));
    expect(ultima?.primeiraParcelaEm.endsWith("-05")).toBe(true);
  });

  it("clicar em outro dia troca o dia e a data da primeira parcela", () => {
    montar({ cadastrado: true, dias: [5, 15], origem: "filho" });
    const quinze = [...alvo.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "dia 15",
    )!;
    act(() => {
      quinze.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(ultima?.diaDeVencimento).toBe(15);
    expect(ultima?.primeiraParcelaEm.endsWith("-15")).toBe(true);
  });

  it("sem cadastro: 10 e 20, com o aviso de que falta cadastrar (e nada trava)", () => {
    montar({ cadastrado: false, dias: [10, 20], origem: null });
    expect(atalhos()).toEqual(["dia 10", "dia 20"]);
    expect(ultima?.diaDeVencimento).toBe(10);
    expect(aviso()).toContain("não cadastrados");
  });

  it("sem a informação (leitura falhou): 10 e 20, SEM aviso", () => {
    montar(null);
    expect(atalhos()).toEqual(["dia 10", "dia 20"]);
    expect(ultima?.diaDeVencimento).toBe(10);
    expect(aviso()).toBeNull();
  });
});
