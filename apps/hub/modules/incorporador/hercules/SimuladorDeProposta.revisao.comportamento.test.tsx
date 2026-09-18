// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type PlanoComercial, taxaMensal } from "@/lib/apolo/planos-comerciais";
import { entradaMinima } from "@/lib/hercules/composicoes";
import type { PlanoDaVenda } from "@/lib/hercules/fluxo-de-venda";
import { montarProposta, sistemaDoCadastro } from "@/lib/hercules/simulacao";
import { condicaoDoPlano } from "@/lib/hercules/tabela-do-lote";

import { type CondicoesDaProposta, SimuladorDeProposta } from "./SimuladorDeProposta";

// REVISÃO (18/09/2026) — o SIMULADOR DE VERDADE, montado com os planos do Garden.
//
// A função pura (`condicaoDoPlano`) pode estar certa e a tela errada: são três caminhos (o cartão,
// o clique e a abertura do lote), mais o efeito que sincroniza o desconto com o valor. Aqui o
// componente real é montado e o que se confere é o que SOBE para a proposta (`aoMudarCondicoes`) e
// o que o cartão escreve.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Os planos do Garden como a rota da Mesa os entrega (comoPlano + ressalva), com a 0178 aplicada. */
function gardenDaRota(comDesconto: boolean): Array<PlanoDaVenda & { ressalva?: null | string }> {
  const base = {
    categoriaId: null,
    enterpriseId: "39",
    indiceCorrecao: "IPCA_ANUAL",
    jurosConvencao: "equivalente",
    jurosPeriodicidade: "anual",
    sistemaAmortizacao: "sacoc",
    slot: null,
  };
  return [
    { ...base, anuaisQuantidade: 5, anuaisValor: 25_000, descontoPercentual: 0, entradaPercentual: 10, jurosTaxa: 6, nome: "NORMAL", parcelas: 60, ressalva: null },
    { ...base, anuaisQuantidade: 4, anuaisValor: 25_000, descontoPercentual: comDesconto ? 8 : 0, entradaPercentual: 8, jurosTaxa: 6, nome: "INVESTIDOR PARCELADO", parcelas: 84, ressalva: "válido para as próximas 16 unidades" },
    { ...base, anuaisQuantidade: 3, anuaisValor: 30_000, descontoPercentual: comDesconto ? 12 : 0, entradaPercentual: 40, jurosTaxa: 0, nome: "INVESTIDOR", parcelas: 36, ressalva: null },
  ];
}

/** A conta pura, para comparar com o que a tela sobe. */
function pura(plano: PlanoDaVenda, preco: number, piso: null | number) {
  return condicaoDoPlano({
    entradaMinimaPercentual: piso,
    plano: {
      anuaisQuantidade: plano.anuaisQuantidade,
      anuaisValor: plano.anuaisValor,
      descontoPercentual: plano.descontoPercentual,
      entradaPercentual: plano.entradaPercentual,
      parcelas: plano.parcelas,
      sistemaAmortizacao: sistemaDoCadastro(plano.sistemaAmortizacao),
      taxaAoMes: taxaMensal(plano as unknown as PlanoComercial),
    },
    precoDeTabela: preco,
  });
}

let alvo: HTMLDivElement;
let raiz: Root;
let ultima: CondicoesDaProposta | null = null;
const aoMudar = (c: CondicoesDaProposta | null) => {
  ultima = c;
};

function montar(props: {
  entradaMinimaPercentual?: null | number;
  planos: Array<PlanoDaVenda & { ressalva?: null | string }>;
  valorDaUnidade: number;
}) {
  act(() => {
    raiz.render(
      <SimuladorDeProposta
        aoMudarCondicoes={aoMudar}
        entradaMinimaPercentual={props.entradaMinimaPercentual ?? null}
        planos={props.planos}
        unidade="11 10"
        valorDaUnidade={props.valorDaUnidade}
      />,
    );
  });
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

/** Digita num campo controlado do React (o `onChange` escuta o evento `input`). */
function digitar(campo: HTMLInputElement, texto: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** O campo "Parcela" do bloco "Quanto o cliente paga por mês". */
function campoDaParcela(): HTMLInputElement {
  const rotulo = [...alvo.querySelectorAll("label")].find(
    (l) => l.querySelector("span span")?.textContent === "Parcela",
  );
  const campo = rotulo?.querySelector("input");
  if (!campo) throw new Error("campo Parcela ausente");
  return campo;
}

/** O que o campo do lote escreve ao lado de "Proposta". */
function valorNoCampo(): string {
  return (
    [...alvo.querySelectorAll("span")]
      .find((s) => s.textContent === "Proposta")
      ?.nextElementSibling?.textContent?.replace(/\s/g, " ") ?? ""
  );
}

const centavos = (v: number) => Math.round(v * 100);

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

describe("revisão: a Mesa do Garden com a 0178 (lote de R$ 435.000, piso 8%)", () => {
  const planos = gardenDaRota(true);

  it("abre no INVESTIDOR PARCELADO a 92% da tabela, com as 4 anuais, e sobe isso para a proposta", () => {
    montar({ entradaMinimaPercentual: 8, planos, valorDaUnidade: 435_000 });
    const esperado = pura(planos[1]!, 435_000, 8);
    expect(ultima).toMatchObject({
      ajuste: { modo: "percentual", valor: -8 },
      anuaisQuantidade: 4,
      anuaisValor: 25_000,
      descontoDoPlanoPercentual: 8,
      entradaValor: 32_016,
      parcelasMensais: 84,
      planoNome: "INVESTIDOR PARCELADO",
      valorNegociado: 400_200,
    });
    expect(centavos(ultima!.parcela)).toBe(centavos(esperado.parcela));
    // ⚠️ A EXPECTATIVA MUDOU COM A DECISÃO 1 (18/09/2026, anuais pelo valor de face no SACOC): era
    // R$ 3.351,86, e agora é o número da MMendes, (400.200 − 32.016 − 100.000) ÷ 84.
    expect(centavos(ultima!.parcela) / 100).toBe(3_192.67);

    const texto = cartao("INVESTIDOR PARCELADO").textContent ?? "";
    expect(texto).toContain("84x · entrada R$ 32.016 (8%)");
    expect(texto).toContain("desconto 8% · 4 anuais de R$ 25.000");
    // O cartão arredonda para o real: R$ 3.193, onde a MMendes escreve R$ 3.192,67.
    expect(texto).toContain("R$ 3.193");
  });

  it("o clique em cada cartão sobe exatamente o que o cartão anuncia", () => {
    montar({ entradaMinimaPercentual: 8, planos, valorDaUnidade: 435_000 });
    for (const [k, nome, valor, entrada, desconto] of [
      [0, "NORMAL", 435_000, 43_500, 0],
      [2, "INVESTIDOR", 382_800, 153_120, 12],
      [1, "INVESTIDOR PARCELADO", 400_200, 32_016, 8],
      [0, "NORMAL", 435_000, 43_500, 0],
    ] as const) {
      clicar(cartao(nome));
      const esperado = pura(planos[k]!, 435_000, 8);
      expect(ultima).toMatchObject({
        anuaisQuantidade: esperado.anuais.quantidade,
        anuaisValor: esperado.anuais.valor,
        descontoDoPlanoPercentual: desconto,
        entradaValor: entrada,
        planoNome: nome,
        valorNegociado: valor,
      });
      expect(ultima!.ajuste).toEqual(desconto ? { modo: "percentual", valor: -desconto } : null);
      expect(centavos(ultima!.parcela)).toBe(centavos(esperado.parcela));
    }
  });

  it("partindo da parcela (atalho R$ 3.000): o valor e o desconto que sobem são os da composição recomendada", () => {
    montar({ entradaMinimaPercentual: 8, planos, valorDaUnidade: 435_000 });
    const atalho = [...alvo.querySelectorAll("button")].find(
      (b) => b.textContent?.replace(/\s/g, " ").trim() === "R$ 3.000",
    );
    expect(atalho).toBeTruthy();
    clicar(atalho!);
    expect(ultima).not.toBeNull();
    const c = ultima!;
    // A conta da composição fecha sobre o valor que sobe.
    const plano = planos.find((p) => p.nome === c.planoNome)!;
    const conta = montarProposta({
      baloesQuantidade: c.anuaisQuantidade,
      baloesValor: c.anuaisValor,
      entrada: c.entradaValor,
      parcelas: c.parcelasMensais,
      sistemaAmortizacao: sistemaDoCadastro(plano.sistemaAmortizacao),
      taxaAoMes: taxaMensal(plano as unknown as PlanoComercial),
      valor: c.valorNegociado,
    });
    expect(centavos(conta.parcela)).toBe(centavos(c.parcela));
    // E o desconto que sobe é o do plano da composição.
    expect(c.descontoDoPlanoPercentual).toBe(plano.descontoPercentual ?? 0);
    expect(c.entradaValor).toBeGreaterThanOrEqual(entradaMinima(c.valorNegociado, 8));
  });

  // CORRIGIDO EM 18/09/2026 (na revisão, vermelho: "o campo 'Proposta' mostra um valor e a proposta
  // sobe outro"). Medido antes: com o atalho R$ 4.000 a recomendada era o NORMAL a R$ 435.000, que
  // subia para a proposta e para o PDF, enquanto o campo à esquerda continuava em R$ 400.200,00 com
  // "Desconto de 8% do plano". Agora o campo lê o valor e o desconto da leitura principal.
  //
  // ⚠️ A LISTA DE PLANOS MUDOU, E NÃO SÓ O NOME: com as anuais pelo valor de face (decisão 1) e a
  // varredura livre de volta no plano com anual cadastrada (decisão 4), a busca por R$ 4.000 passou a
  // recomendar o INVESTIDOR PARCELADO, como a MMendes (`propor`). Para medir o caso que a revisão
  // pegou (recomendada de OUTRO plano), entram a parcela de R$ 5.000 digitada (NORMAL) e o caminho
  // inverso que a revisão não mediu (NORMAL ativo, recomendada INVESTIDOR PARCELADO).
  it("partindo da parcela, o campo 'Proposta' mostra o valor que sobe para a proposta", () => {
    montar({ entradaMinimaPercentual: 8, planos, valorDaUnidade: 435_000 });
    const atalhos = (rotulo: string) =>
      [...alvo.querySelectorAll("button")].find(
        (b) => b.textContent?.replace(/\s/g, " ").trim() === rotulo,
      )!;
    const medidas: Array<{ atalho: string; campo: string; plano: string; sobe: number }> = [];
    const medir = (atalho: string) =>
      medidas.push({
        atalho,
        campo: valorNoCampo(),
        plano: ultima?.planoNome ?? "",
        sobe: ultima?.valorNegociado ?? 0,
      });
    for (const rotulo of ["R$ 1.500", "R$ 2.000", "R$ 3.000", "R$ 4.000"]) {
      clicar(atalhos(rotulo));
      medir(rotulo);
    }
    digitar(campoDaParcela(), "5.000");
    medir("digitado 5.000");

    expect(medidas.map((m) => `${m.atalho}:${m.plano}:${m.sobe}`)).toEqual([
      "R$ 1.500:INVESTIDOR PARCELADO:400200",
      "R$ 2.000:INVESTIDOR PARCELADO:400200",
      "R$ 3.000:INVESTIDOR PARCELADO:400200",
      "R$ 4.000:INVESTIDOR PARCELADO:400200",
      "digitado 5.000:NORMAL:435000",
    ]);
    for (const m of medidas) {
      expect(m.campo).toBe(
        `R$ ${m.sobe.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`,
      );
    }
    // No NORMAL (sem desconto) o campo não carrega o desconto de 8% do plano ativo.
    expect(alvo.textContent).not.toContain("Desconto de 8% do plano");
    expect(ultima?.ajuste).toBeNull();
  });

  it("o caminho inverso: NORMAL ativo, recomendada o INVESTIDOR PARCELADO com o desconto dele", () => {
    montar({ entradaMinimaPercentual: 8, planos, valorDaUnidade: 435_000 });
    clicar(cartao("NORMAL"));
    expect(valorNoCampo()).toBe("R$ 435.000,00");
    const atalho = [...alvo.querySelectorAll("button")].find(
      (b) => b.textContent?.replace(/\s/g, " ").trim() === "R$ 3.000",
    )!;
    clicar(atalho);
    expect(ultima).toMatchObject({
      ajuste: { modo: "percentual", valor: -8 },
      descontoDoPlanoPercentual: 8,
      planoNome: "INVESTIDOR PARCELADO",
      valorNegociado: 400_200,
    });
    expect(valorNoCampo()).toBe("R$ 400.200,00");
    expect(alvo.textContent).toContain("Desconto de 8% do plano");
  });
});

describe("revisão: a Mesa do Garden SEM a 0178 (código no ar antes da migration)", () => {
  // ⚠️ A EXPECTATIVA MUDOU COM A DECISÃO 1 (anuais pelo valor de face no SACOC): era R$ 3.733,00, e
  // agora é (435.000 − 34.800 − 100.000) ÷ 84 = R$ 3.573,81.
  it("INVESTIDOR PARCELADO sai pelo preço cheio, com as anuais: R$ 3.573,81 e entrada R$ 34.800", () => {
    const planos = gardenDaRota(false);
    montar({ entradaMinimaPercentual: 8, planos, valorDaUnidade: 435_000 });
    expect(ultima).toMatchObject({
      ajuste: null,
      anuaisQuantidade: 4,
      entradaValor: 34_800,
      planoNome: "INVESTIDOR PARCELADO",
      valorNegociado: 435_000,
    });
    expect(centavos(ultima!.parcela) / 100).toBe(3_573.81);
  });
});

describe("revisão: o espelho sem piso cadastrado (falha de leitura) cai nos 10% da casa", () => {
  it("INVESTIDOR PARCELADO: a entrada vira 10% do preço do plano, e o cartão diz (8%)", () => {
    const planos = gardenDaRota(true);
    montar({ entradaMinimaPercentual: null, planos, valorDaUnidade: 410_000 });
    expect(ultima?.entradaValor).toBe(37_720);
    expect(cartao("INVESTIDOR PARCELADO").textContent).toContain("entrada R$ 37.720 (8%)");
  });
});

describe("revisão: regressão num empreendimento sem desconto e sem anuais (enterprise 20)", () => {
  // Os três planos de `temis_planos` do 20 (SELECT de 18/09/2026, via teste do implementador): sem
  // anual e sem desconto. O que sobe tem de ser a conta ANTIGA do simulador (entrada do plano mais
  // longo + montarProposta sem balões).
  const base = {
    categoriaId: null,
    enterpriseId: "20",
    indiceCorrecao: "IPCA_ANUAL",
    jurosConvencao: "equivalente",
    jurosPeriodicidade: "mensal",
    sistemaAmortizacao: "sacoc",
    slot: null,
  };
  const planos: PlanoDaVenda[] = [
    { ...base, entradaPercentual: 0, jurosTaxa: 0, nome: "Investidor", parcelas: 24 },
    { ...base, entradaPercentual: 20, jurosTaxa: 0, nome: "Curto", parcelas: 36 },
    { ...base, entradaPercentual: 10, jurosTaxa: 0.6434, nome: "Normal", parcelas: 120 },
  ];

  for (const preco of [136_521, 178_100, 185_400.5]) {
    it(`lote de R$ ${preco}: abertura e cliques iguais à conta antiga`, () => {
      montar({ entradaMinimaPercentual: 10, planos, valorDaUnidade: preco });
      for (const nome of [null, "Curto", "Investidor", "Normal"] as const) {
        if (nome) clicar(cartao(nome));
        const p = planos.find((x) => x.nome === (nome ?? "Normal"))!;
        const entrada = Math.max(
          entradaMinima(preco, 10),
          Math.ceil((preco * p.entradaPercentual) / 100),
        );
        const antiga = montarProposta({
          baloesQuantidade: 0,
          baloesValor: 0,
          entrada,
          parcelas: p.parcelas,
          sistemaAmortizacao: sistemaDoCadastro(p.sistemaAmortizacao),
          taxaAoMes: taxaMensal(p as unknown as PlanoComercial),
          valor: preco,
        });
        expect(ultima).toMatchObject({
          ajuste: null,
          anuaisQuantidade: 0,
          anuaisValor: 0,
          descontoDoPlanoPercentual: 0,
          entradaValor: entrada,
          planoNome: p.nome,
          valorNegociado: preco,
        });
        expect(ultima!.parcela).toBe(antiga.parcela);
      }
    });
  }
});
