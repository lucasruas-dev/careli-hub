// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PlanoDaVenda } from "@/lib/hercules/fluxo-de-venda";

import { type CondicoesDaProposta, SimuladorDeProposta } from "./SimuladorDeProposta";

// O AJUSTE DE PREÇO PASSA A VALER NO ESPELHO PÚBLICO (23/09/2026).
//
// Lucas, sobre o desconto que o comercial ganhou: *"sabe aquela parte do desconto que incluimos no
// comercial, vamos colocar para cecilio também"*. Medido antes de responder: o PORTAL da Cecílio já
// tinha o ajuste (é esta mesma tela com `ehSimulacao` falso); o print dele dizia "Valor simulado",
// que é o rótulo do ESPELHO PÚBLICO, a página `/e/<apelido>-<selo>` SEM LOGIN. Perguntado
// diretamente, com as três opções e o risco escrito em cada uma, ele respondeu: **"Liberar para
// todo mundo"**.
//
// ⚠️ ENTÃO ISTO REABRE, DE PROPÓSITO, O BURACO QUE A REVISÃO DE 18/09/2026 FECHOU: qualquer pessoa
// com o link pode ajustar o preço e gerar uma folha com a marca da casa e o desconto que ela mesma
// escolheu. O que atenua, e o que este arquivo e o do PDF guardam, é o teto do servidor
// (`DESCONTO_MAXIMO_DA_SIMULACAO`) e a frase que a folha já carrega: "não constitui proposta, não
// reserva a unidade e não vincula as partes".
//
// ⚠️ E `ehSimulacao` GOVERNAVA DUAS COISAS ORTOGONAIS: a PALAVRA (os rótulos "Valor simulado" e
// "Simulação montada") e a AUTORIDADE sobre a negociação. Só a segunda mudou. A palavra continua
// como está, porque ali é simulação mesmo (Lucas, 10/09/2026: *"não é proposta mas sim uma
// simulação de pagamento"*).
//
// ⚠️ E A AUTORIDADE INCLUI A PERMUTA. Eu tinha escrito aqui que o bloco de bens ficaria de fora,
// porque permuta é negociação e o Lucas teria pedido o desconto, não a permuta. Ele respondeu:
// *"permuta tem que entrar, não entendi sua colocação"*. A separação era minha, e está desfeita —
// ver `SimuladorDeProposta.permuta-no-espelho.comportamento.test.tsx`.

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

/** As três linhas de `temis_planos` do Garden, as mesmas de `SimuladorDeProposta.planos`. */
const GARDEN: Array<PlanoDaVenda & { ressalva?: null | string }> = [
  { ...BASE, anuaisQuantidade: 5, anuaisValor: 25_000, descontoPercentual: 0, entradaPercentual: 10, jurosTaxa: 6, nome: "NORMAL", parcelas: 60, ressalva: null },
  { ...BASE, anuaisQuantidade: 4, anuaisValor: 25_000, descontoPercentual: 8, entradaPercentual: 8, jurosTaxa: 6, nome: "INVESTIDOR PARCELADO", parcelas: 84, ressalva: null },
  { ...BASE, anuaisQuantidade: 3, anuaisValor: 30_000, descontoPercentual: 12, entradaPercentual: 40, jurosTaxa: 0, nome: "INVESTIDOR", parcelas: 36, ressalva: null },
];

let alvo: HTMLDivElement;
let raiz: Root;
let ultima: CondicoesDaProposta | null = null;

function montar(vocabulario: "proposta" | "simulacao") {
  act(() => {
    raiz.render(
      <SimuladorDeProposta
        aoMudarCondicoes={(c) => {
          ultima = c;
        }}
        entradaMinimaPercentual={8}
        planos={GARDEN}
        unidade="11 10"
        valorDaUnidade={435_000}
        vocabulario={vocabulario}
      />,
    );
  });
}

function digitar(campo: HTMLInputElement, texto: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clicar(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** O botão de sentido do ajuste, se ele estiver na tela: "Desconto" (−) ou "Acréscimo" (+). */
function sentido(rotulo: "Acréscimo" | "Desconto"): HTMLButtonElement | null {
  return alvo.querySelector<HTMLButtonElement>(`[aria-label="${rotulo}"]`);
}

/** O campo de desconto do bloco do lote (o que `somenteLeitura` escondia). */
function campoDeDesconto(): HTMLInputElement {
  const achado = [...alvo.querySelectorAll("input")].find(
    (i) => i.getAttribute("placeholder") === "desconto",
  );
  if (!achado) throw new Error("campo de desconto ausente");
  return achado;
}

/** A linha inteira dos controles de desconto: sentido, moeda e número. */
function controlesDoDesconto(): HTMLElement {
  const achado = alvo.querySelector<HTMLElement>("[data-controles-do-desconto]");
  if (!achado) throw new Error("controles do desconto ausentes");
  return achado;
}

/** O valor que o campo do lote escreve ao lado de "Valor simulado" (ou "Proposta"). */
function valorNoCampo(rotulo: string): string {
  return (
    [...alvo.querySelectorAll("span")]
      .find((s) => s.textContent === rotulo)
      ?.nextElementSibling?.textContent?.replace(/\s/g, " ") ?? ""
  );
}

/**
 * O rodapé da coluna da leitura.
 *
 * Os TRÊS ramos do ternário terminam na mesma frase sobre os planos cadastrados, então ela é a
 * âncora que acha o parágrafo sem depender de qual ramo está no ar.
 */
function rodape(): string {
  const achado = [...alvo.querySelectorAll("p")].find((p) =>
    p.textContent?.includes("planos cadastrados do empreendimento"),
  );
  if (!achado) throw new Error("rodapé ausente");
  return achado.textContent ?? "";
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

describe("peça 1: o preço passa a ser editável no espelho público", () => {
  it("⚠️ os controles de desconto aparecem, e o que se digita neles MOVE o valor negociado", () => {
    montar("simulacao");
    // Abre no plano mais longo (INVESTIDOR PARCELADO, 84x, 8%): 435.000 × 0,92 = 400.200.
    expect(ultima).toMatchObject({
      ajuste: { modo: "percentual", valor: -8 },
      planoNome: "INVESTIDOR PARCELADO",
      valorNegociado: 400_200,
    });

    // Até 22/09/2026 esta linha ficava com `display: none` no espelho.
    expect(controlesDoDesconto().style.display).not.toBe("none");

    // 10% de desconto à mão, digitados na página sem login: 435.000 × 0,90 = 391.500.
    digitar(campoDeDesconto(), "10");
    expect(ultima).toMatchObject({
      ajuste: { modo: "percentual", valor: -10 },
      valorNegociado: 391_500,
    });
    expect(valorNoCampo("Valor simulado")).toBe("R$ 391.500,00");
  });

  it("⚠️ a PALAVRA não muda junto com a autoridade: o rótulo continua 'Valor simulado'", () => {
    montar("simulacao");
    expect(valorNoCampo("Valor simulado")).toBe("R$ 400.200,00");
    expect(valorNoCampo("Proposta")).toBe("");
    expect(alvo.textContent).toContain("Simulação montada");
    expect(alvo.textContent).not.toContain("Proposta montada");
  });

  it("⚠️ e o bloco de bens e permutas entrou JUNTO, nos dois vocabulários", () => {
    // ⚠️ ESTA ASSERÇÃO ERA A CONTRÁRIA NO MESMO DIA. Eu havia separado as duas coisas — desconto
    // sim, permuta não, porque permuta é negociação e o espelho é vitrine — e o Lucas desfez a
    // separação: *"permuta tem que entrar, não entendi sua colocação"*. Ela era minha, não dele.
    montar("simulacao");
    expect(alvo.textContent).toContain("Bens e permutas");
    act(() => raiz.unmount());
    raiz = createRoot(alvo);
    montar("proposta");
    expect(alvo.textContent).toContain("Bens e permutas");
  });
});

// O BOTÃO DE ACRÉSCIMO NÃO EXISTE NO ESPELHO (23/09/2026).
//
// ⚠️ A LINHA DE CONTROLES FOI SOLTA INTEIRA E LEVOU O `+` JUNTO, E ISSO ERA DEFEITO. Medido em
// 23/09/2026 na página sem login: clicar em "Acréscimo" e digitar 10 leva o cartão a mostrar
// R$ 478.500, e a rota do PDF responde 422 ("Esta simulação não passa do valor de tabela da
// unidade"), SEMPRE. A tela oferecia um caminho que o servidor nunca aceita.
//
// ⚠️ E A RECUSA DO SERVIDOR NÃO É O TETO QUE SAIU: desconto de qualquer tamanho é decisão do Lucas
// (*"Liberar para todo mundo"*, *"pode liberar tudo"*); anunciar a unidade MAIS CARA do que a casa
// vende, numa página sem login, não é desconto, é a página mentindo para cima. O conserto é a tela
// parar de oferecer, e não o servidor passar a aceitar.
describe("peça 4: o acréscimo não é oferecido no espelho", () => {
  it("⚠️ o par −/+ vira só o −, porque o + o servidor recusa sempre", () => {
    montar("simulacao");
    expect(sentido("Desconto")).toBeTruthy();
    expect(sentido("Acréscimo")).toBeNull();
  });

  it("a Mesa de Venda continua com os dois: lá o acréscimo é venda de verdade", () => {
    montar("proposta");
    expect(sentido("Desconto")).toBeTruthy();
    expect(sentido("Acréscimo")).toBeTruthy();
  });

  it("⚠️ e é ele que produzia os R$ 478.500: na Mesa de Venda o caminho continua vivo", () => {
    // O número que o defeito produzia no espelho, medido aqui no vocabulário em que ele é legítimo:
    // 435.000 × 1,10 = 478.500. No espelho não há mais botão para chegar nele.
    montar("proposta");
    // ⚠️ O CAMPO É O MESMO, E SÓ O PLACEHOLDER MUDA ("desconto" vira "acréscimo" quando o sentido
    // é +). Por isso a busca aqui é pelo campo, antes do clique no botão.
    const campo = campoDeDesconto();
    clicar(sentido("Acréscimo")!);
    digitar(campo, "10");
    expect(ultima).toMatchObject({
      ajuste: { modo: "percentual", valor: 10 },
      valorNegociado: 478_500,
    });
  });

  it("⚠️ no espelho o número digitado só desce: 10 é desconto, e o valor fica abaixo da tabela", () => {
    montar("simulacao");
    digitar(campoDeDesconto(), "10");
    expect(ultima).toMatchObject({
      ajuste: { modo: "percentual", valor: -10 },
      valorNegociado: 391_500,
    });
  });
});

describe("peça 3: o rodapé do espelho não fala em proposta", () => {
  it("⚠️ o espelho manda `aoMudarCondicoes`, e caía no ramo que diz 'vão para a proposta'", () => {
    // Lucas (10/09/2026): *"não é proposta mas sim uma simulação de pagamento"*. O PDF já acertava
    // (`proposta-para-pdf.ts`, bandeira `simulacao`), e a tela dizia o contrário do papel.
    montar("simulacao");
    expect(rodape()).not.toContain("proposta");
    expect(rodape()).toContain("Simulação de pagamento");
  });

  it("a Mesa de Venda continua dizendo que as condições vão para a proposta", () => {
    montar("proposta");
    expect(rodape()).toContain("Estas são as condições que vão para a proposta");
  });
});
