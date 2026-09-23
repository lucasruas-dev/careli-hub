// @vitest-environment jsdom

// O CARTÃO "TOTAL PAGO" DA SIMULAÇÃO, NA TELA — os dois prints que o Lucas mandou em 22/09/2026.
//
// *"o valor pago tem que ser o valor do lote, está cobrando juros errado. não calculamos juros
// nessa etapa, é somente informativo."*
//
// ⚠️ O TESTE É DE TELA, E NÃO DE CONTA. A conta está travada em `lib/hercules/total-pago-sem-juros
// .test.ts`; o que se prova aqui é que o número que o cliente LÊ mudou junto — no cartão grande e em
// cada linha de "Outras composições", que leem o mesmo `total` e imprimiam o mesmo erro.

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PlanoDaVenda } from "@/lib/hercules/fluxo-de-venda";
import { comoPlano, type LinhaDoPlano } from "@/lib/hercules/planos-do-panteon";

import { SimuladorDeProposta } from "./SimuladorDeProposta";

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** As três linhas de `temis_planos` do Garden (emp. 39), com o desconto da 0178. */
const LINHAS: LinhaDoPlano[] = [
  { anuais_quantidade: 5, anuais_valor: "25000.00", categoria_id: null, desconto_percentual: "0", enterprise_id: "39", entrada_percentual: "10.000", indice_correcao: "IPCA_ANUAL", juros_convencao: "equivalente", juros_periodicidade: "anual", juros_taxa: "6.000000", nome: "NORMAL", ordem: 1, parcelas: 60, ressalva: null, sistema_amortizacao: "sacoc", slot: null },
  { anuais_quantidade: 4, anuais_valor: "25000.00", categoria_id: null, desconto_percentual: "8", enterprise_id: "39", entrada_percentual: "8.000", indice_correcao: "IPCA_ANUAL", juros_convencao: "equivalente", juros_periodicidade: "anual", juros_taxa: "6.000000", nome: "INVESTIDOR PARCELADO", ordem: 2, parcelas: 84, ressalva: null, sistema_amortizacao: "sacoc", slot: null },
  { anuais_quantidade: 3, anuais_valor: "30000.00", categoria_id: null, desconto_percentual: "12", enterprise_id: "39", entrada_percentual: "40.000", indice_correcao: "IPCA_ANUAL", juros_convencao: "equivalente", juros_periodicidade: "anual", juros_taxa: "0.000000", nome: "INVESTIDOR", ordem: 3, parcelas: 36, ressalva: null, sistema_amortizacao: "sacoc", slot: null },
];
const planosDoGarden = () =>
  LINHAS.map((l) => comoPlano(l)) as unknown as Array<PlanoDaVenda & { ressalva?: null | string }>;

let alvo: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  alvo = document.createElement("div");
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
});
afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
});

function montar(valorDaUnidade: number, unidade = "04 16") {
  act(() => {
    raiz.render(
      <SimuladorDeProposta
        entradaMinimaPercentual={8}
        planos={planosDoGarden()}
        unidade={unidade}
        valorDaUnidade={valorDaUnidade}
        vocabulario="simulacao"
      />,
    );
  });
}

/** O bloco "Total pago" do cartão grande: o rótulo, o valor e a nota de baixo. */
function totalPago(): { nota: string; valor: string } {
  const rotulo = [...alvo.querySelectorAll("div")].find(
    (d) => d.textContent === "Total pago" && d.childElementCount === 0,
  );
  const bloco = rotulo?.parentElement;
  if (!bloco) throw new Error("cartão 'Total pago' ausente");
  return {
    nota: bloco.children[2]?.textContent ?? "",
    valor: bloco.children[1]?.textContent ?? "",
  };
}

/**
 * Os "total R$ ..." das linhas de "Outras composições".
 *
 * ⚠️ SÓ DENTRO DE BOTÃO, e a diferença importa: cada alternativa era um `<button>` clicável, mas o
 * cockpit também imprime um "total R$ 100.000" solto (a soma dos reforços anuais). Procurando em
 * todos os `<span>`, o teste da ausência encontrava o cockpit e acusava lista que não existe mais.
 */
function totaisDasAlternativas(): string[] {
  return [...alvo.querySelectorAll("button")]
    .flatMap((b) => [...b.querySelectorAll("span")])
    .map((s) => s.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .filter((t) => t.startsWith("total R$"));
}

describe("Quadra 04 Lote 16 do Garden, tabela R$ 416.000 (o print do Lucas)", () => {
  it("⚠️ o cartão imprime R$ 382.720 — o valor do lote —, e não os R$ 425.937 com o degrau do SACOC", () => {
    montar(416_000);
    expect(totalPago().valor).toBe("R$ 382.720");
  });

  it("a nota de baixo diz que a soma fecha com o valor negociado, em vez de um % sobre a tabela", () => {
    montar(416_000);
    expect(totalPago().nota).toBe("igual ao valor negociado");
  });
});

describe("Quadra 03 Lote 07 do Garden, tabela R$ 470.000 (o segundo print)", () => {
  it("⚠️ o cartão imprime R$ 432.400, e não os R$ 487.668 de antes", () => {
    montar(470_000, "03 07");
    expect(totalPago().valor).toBe("R$ 432.400");
  });
});

describe("⚠️ a lista de outras composições SAIU da tela", () => {
  // Lucas, 22/09/2026, com o print da lista aberta: *"pode tirar isso aqui"*, e perguntado de onde,
  // *"De todo lugar"*. Ela já tinha saído da modal de proposta em 05/09 (*"deixa somente no
  // simulador"*); agora sai do simulador também, e não sobra lugar nenhum que a desenhe.
  //
  // ⚠️ O CÁLCULO CONTINUA: `composicoesQueFecham` é quem acha a composição RECOMENDADA, a do cartão
  // grande. O que saiu é a lista de alternativas embaixo dele, não a busca por parcela.
  it("não existe mais o título nem nenhuma linha de alternativa", () => {
    montar(416_000);
    expect(alvo.textContent ?? "").not.toContain("Outras composições");
    expect(totaisDasAlternativas()).toHaveLength(0);
  });

  it("e o cartão grande continua lá, com o total certo", () => {
    montar(416_000);
    expect(totalPago().valor).toBe("R$ 382.720");
  });
});
