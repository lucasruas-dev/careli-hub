// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PlanoDaVenda } from "@/lib/hercules/fluxo-de-venda";

import { type CondicoesDaProposta, SimuladorDeProposta } from "./SimuladorDeProposta";

// O ID DO PLANO SOBE JUNTO COM AS CONDIÇÕES (22/09/2026).
//
// ⚠️ POR QUE UM TESTE DE TELA. O servidor já sabe casar o plano por `temis_planos.id`
// (`escolherPlanoDaProposta`), e o teste dele passa mandando o id à mão. Isso não prova que ALGUÉM
// manda: a tela montava o corpo do POST só com `planoNome`, e um servidor preparado para uma chave
// que ninguém envia é exatamente o defeito de sempre — typecheck não liga peça nenhuma. Aqui o
// simulador de VERDADE é montado, e o que se mede é o que ele entrega em `aoMudarCondicoes`.
//
// ⚠️ E O QUE ISSO FECHA GRAVA DINHEIRO. Com o plano casado por nome, o rename do Garden (NORMAL →
// INVESTIDOR, INVESTIDOR → PROMOÇÃO À VISTA) fazia uma aba aberta antes pedir o plano de 36
// parcelas sem juros e receber a linha de 60 a 6% ao ano — medido no banco, congelado no
// cronograma que alimenta o contrato.

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

/** Os três planos do Garden como a rota da Mesa os entrega: com o id da linha de `temis_planos`. */
const DO_PANTEON: Array<PlanoDaVenda & { ressalva?: null | string }> = [
  { ...BASE, anuaisQuantidade: 5, anuaisValor: 25_000, descontoPercentual: 0, entradaPercentual: 10, id: "plano-60x", jurosTaxa: 6, nome: "NORMAL", parcelas: 60, ressalva: null },
  { ...BASE, anuaisQuantidade: 4, anuaisValor: 25_000, descontoPercentual: 8, entradaPercentual: 8, id: "plano-84x", jurosTaxa: 6, nome: "INVESTIDOR PARCELADO", parcelas: 84, ressalva: "válido para as próximas 16 unidades" },
  { ...BASE, anuaisQuantidade: 3, anuaisValor: 30_000, descontoPercentual: 12, entradaPercentual: 40, id: "plano-36x", jurosTaxa: 0, nome: "INVESTIDOR", parcelas: 36, ressalva: null },
];

/**
 * Os mesmos planos como o C2X os entrega: SEM id nenhum.
 *
 * ⚠️ NÃO É CASO DE LABORATÓRIO. `commercial_plans` é lido por slot e não tem id que sobreviva à
 * leitura: nos empreendimentos servidos pelo legado o nome é a única chave que existe, e exigir o
 * id pararia a venda deles.
 */
const DO_C2X = DO_PANTEON.map(({ id: _id, ...resto }) => resto);

let alvo: HTMLDivElement;
let raiz: Root;
let ultima: CondicoesDaProposta | null = null;

function montar(planos: Array<PlanoDaVenda & { ressalva?: null | string }>) {
  act(() => {
    raiz.render(
      <SimuladorDeProposta
        aoMudarCondicoes={(c) => {
          ultima = c;
        }}
        entradaMinimaPercentual={8}
        planos={planos}
        unidade="11 10"
        valorDaUnidade={435_000}
      />,
    );
  });
}

/** O cartão de um plano na tabela do empreendimento. */
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

describe("o id do plano sobe com as condições", () => {
  it("o que sobe é o id do plano que a tela está mostrando", () => {
    montar(DO_PANTEON);

    expect(ultima).not.toBeNull();
    const esperado = DO_PANTEON.find((p) => p.nome === ultima!.planoNome)?.id;
    expect(esperado).toBeTruthy();
    expect(ultima!.planoId).toBe(esperado);
  });

  // ⚠️ O ID SEGUE O CLIQUE, e é o que prova que ele não ficou preso no plano de abertura: o
  // corretor troca de cartão antes de gerar, e o corpo do POST tem que trocar junto.
  it("⚠️ clicar no cartão de outro plano leva o id DELE", () => {
    montar(DO_PANTEON);
    clicar(cartao("INVESTIDOR"));

    expect(ultima?.planoNome).toBe("INVESTIDOR");
    expect(ultima?.planoId).toBe("plano-36x");
  });

  // ⚠️ SEM ID, A VENDA CONTINUA. É o estado permanente dos empreendimentos servidos pelo C2X: o
  // campo sobe nulo, a modal o omite do corpo e o servidor casa pelo nome, como sempre casou.
  it("plano sem id (C2X) sobe com `planoId` nulo, e o nome continua subindo", () => {
    montar(DO_C2X as Array<PlanoDaVenda & { ressalva?: null | string }>);

    expect(ultima?.planoNome).toBeTruthy();
    expect(ultima?.planoId).toBeNull();
  });
});
