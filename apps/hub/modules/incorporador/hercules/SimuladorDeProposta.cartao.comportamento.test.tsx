// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  taxaMensal,
  textoDaTaxa,
  type PlanoComercial,
} from "@/lib/apolo/planos-comerciais";
import { linhaDoAVista, linhasDoCartao } from "@/lib/hercules/cartao-do-plano";
import type { PlanoDaVenda } from "@/lib/hercules/fluxo-de-venda";
import { sistemaDoCadastro } from "@/lib/hercules/simulacao";
import { condicaoDoPlano } from "@/lib/hercules/tabela-do-lote";

import { SimuladorDeProposta } from "./SimuladorDeProposta";

// O CARTÃO DO PLANO IGUAL AO DA MMENDES (revisão 3, 18/09/2026).
//
// Lucas, com o print do cartão INVESTIDOR PARCELADO: *"tem esse escrito. tem que ser igual o
// mmendes"*. O texto da MMendes NÃO é transcrito aqui: o `renderOficial` do próprio
// `masterplans-internos/garden.html` é extraído e rodado como está (com o `$` e as duas ligações de
// clique trocados por dublês), e o HTML que ele escreve é lido cartão a cartão. Do nosso lado, o
// simulador de verdade é montado com os três planos do Garden e o cartão é lido pelo DOM.
//
// As normalizações, uma a uma, são as três diferenças de propósito de `lib/hercules/cartao-do-plano.ts`:
// o nome e o plano do à vista vêm do cadastro em maiúsculas; a entrada leva o "(8%)" do plano (Lucas,
// 05/09/2026); a correção diz o índice do cadastro ("IPCA anual"). A parcela é conferida contra a
// regra da MMendes para parcela (`moedaPa`, com centavos): o `renderOficial` dela ainda arredonda.

(globalThis as unknown as { React: typeof React }).React = React;
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HTML = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "masterplans-internos", "garden.html"),
  "utf8",
);

function trecho(de: string, ate: string): string {
  const i = HTML.indexOf(de);
  const f = HTML.indexOf(ate, i);
  if (i < 0 || f < 0)
    throw new Error(`marcador ausente no garden.html: ${de} / ${ate}`);
  return HTML.slice(i, f);
}

type MMendes = {
  /** O HTML que o `renderOficial` escreve em `#ofMesa` para um lote aberto com este preço. */
  mesa: (preco: number) => string;
  /** A regra dela para parcela (com centavos quando tem). */
  moedaPa: (v: number) => string;
};

const MM: MMendes = new Function(
  [
    trecho("const fM  =", "function curto("),
    trecho("function esc(s)", "\n"),
    trecho("const PLANOS=[", "/* ============================== abrir"),
    trecho("const OF_TOL=1.00;", "/* `mil` liga o separador"),
    trecho("function ofCampo(", "/* ligacoes do cartao"),
    "const alvoDaMesa={innerHTML:''};",
    "const $=id=>id==='ofMesa'?alvoDaMesa:null;",
    "function ofLigar(){} function ofRodape(){}",
    "function mesa(preco){ SIM.preco=preco; SIM.precoTabela=preco; EDIT=[]; ofAberto=null;",
    "  renderOficial(); return alvoDaMesa.innerHTML; }",
    "return {mesa, moedaPa};",
  ].join("\n"),
)() as MMendes;

/** Espaço fino, espaço rígido do `Intl` e quebras viram um espaço só. */
const limpo = (t: null | string | undefined) =>
  (t ?? "").replace(/[  \s]+/g, " ").trim();

type Cartao = {
  correcao: string;
  nome: string;
  origemDoValor: string;
  parcela: string;
  prazo: string;
  ressalva: string;
  resumo: string;
  valorDoLote: string;
};

/** Os cartões e o à vista que a MMendes escreveu, lidos do HTML dela. */
function cartoesDaMMendes(preco: number) {
  const doc = new DOMParser().parseFromString(
    `<div>${MM.mesa(preco)}</div>`,
    "text/html",
  );
  const cartoes: Cartao[] = [...doc.querySelectorAll(".of-pl")].map((pl) => {
    const b = pl.querySelector(".of-nome b")!;
    const ressalva = limpo(b.querySelector(".of-res")?.textContent);
    const parcelaV = pl.querySelector(".of-pa .of-v")!;
    const prazo = limpo(parcelaV.querySelector("small")?.textContent);
    return {
      correcao: limpo(pl.querySelector(".of-pa .of-de")?.textContent),
      nome: limpo(b.textContent).replace(ressalva, "").trim(),
      origemDoValor: limpo(pl.querySelector(".of-lote .of-de")?.textContent),
      parcela: limpo(parcelaV.textContent).replace(prazo, "").trim(),
      prazo,
      ressalva,
      resumo: limpo(pl.querySelector(".of-nome small")?.textContent),
      valorDoLote: limpo(pl.querySelector(".of-lote .of-v")?.textContent),
    };
  });
  const av = doc.querySelector(".of-avista")!;
  const colunas = [...av.querySelectorAll(".of-col")];
  return {
    aVista: {
      detalhe: limpo(av.querySelector(".of-nome small")?.textContent),
      nome: limpo(av.querySelector(".of-nome b")?.textContent),
      origemDoValor: limpo(colunas[0]?.querySelector(".of-de")?.textContent),
      pagamento: limpo(colunas[1]?.querySelector(".of-v")?.textContent),
      valorDoLote: limpo(colunas[0]?.querySelector(".of-v")?.textContent),
    },
    cartoes,
  };
}

const BASE = {
  categoriaId: null,
  enterpriseId: "39",
  indiceCorrecao: "IPCA_ANUAL",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  sistemaAmortizacao: "sacoc",
  slot: null,
};

/** As três linhas de `temis_planos` do Garden (SELECT de 18/09/2026), com a 0178 e a ressalva. */
const GARDEN: Array<PlanoDaVenda & { ressalva?: null | string }> = [
  {
    ...BASE,
    anuaisQuantidade: 5,
    anuaisValor: 25_000,
    descontoPercentual: 0,
    entradaPercentual: 10,
    jurosTaxa: 6,
    nome: "NORMAL",
    parcelas: 60,
    ressalva: null,
  },
  {
    ...BASE,
    anuaisQuantidade: 4,
    anuaisValor: 25_000,
    descontoPercentual: 8,
    entradaPercentual: 8,
    jurosTaxa: 6,
    nome: "INVESTIDOR PARCELADO",
    parcelas: 84,
    ressalva: "válido para as próximas 16 unidades",
  },
  {
    ...BASE,
    anuaisQuantidade: 3,
    anuaisValor: 30_000,
    descontoPercentual: 12,
    entradaPercentual: 40,
    jurosTaxa: 0,
    nome: "INVESTIDOR",
    parcelas: 36,
    ressalva: null,
  },
];
const PISO_DO_GARDEN = 8;

/** As três normalizações documentadas no cabeçalho, aplicadas ao NOSSO texto. */
const comoAMMendes = (c: Cartao, entradaPercentual: number): Cartao => ({
  ...c,
  correcao: c.correcao.replace("IPCA anual", "IPCA"),
  nome: c.nome.toLowerCase(),
  resumo: c.resumo.replace(` (${entradaPercentual}%)`, ""),
});
const daMMendes = (c: Cartao): Cartao => ({ ...c, nome: c.nome.toLowerCase() });

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

function montar(
  vocabulario: "proposta" | "simulacao",
  valorDaUnidade = 435_000,
) {
  act(() => {
    raiz.render(
      <SimuladorDeProposta
        entradaMinimaPercentual={PISO_DO_GARDEN}
        planos={GARDEN}
        unidade="11 10"
        valorDaUnidade={valorDaUnidade}
        vocabulario={vocabulario}
      />,
    );
  });
}

/** O cartão que a tela desenhou, lido pelos `data-cartao`. */
function cartaoNaTela(nome: string): Cartao {
  const botao = [...alvo.querySelectorAll("button")].find(
    (b) => b.firstElementChild?.textContent?.trim() === nome,
  );
  if (!botao) throw new Error(`cartão ${nome} ausente`);
  const linha = (chave: string) =>
    limpo(botao.querySelector(`[data-cartao="${chave}"]`)?.textContent);
  return {
    correcao: linha("correcao"),
    nome: linha("nome"),
    origemDoValor: linha("origem-do-valor"),
    parcela: linha("parcela"),
    prazo: linha("prazo"),
    ressalva: linha("ressalva"),
    resumo: linha("resumo"),
    valorDoLote: linha("valor-do-lote"),
  };
}

describe("o cartão do INVESTIDOR PARCELADO no lote de R$ 435.000, contra o texto da MMendes", () => {
  it("a MMendes escreve o que o relato diz (a extração está lendo o arquivo certo)", () => {
    const { cartoes } = cartoesDaMMendes(435_000);
    expect(cartoes[1]).toEqual({
      correcao: "correção: IPCA + 6% a.a.",
      nome: "Investidor Parcelado",
      origemDoValor: "de R$ 435.000 · −8%",
      // O `renderOficial` arredonda a parcela (`moeda`); a regra dela para parcela é `moedaPa`.
      parcela: "R$ 3.193",
      prazo: "× 84",
      ressalva: "válido para as próximas 16 unidades",
      resumo: "entrada R$ 32.016 · 4 × R$ 25.000 · 84 meses",
      valorDoLote: "R$ 400.200",
    });
    expect(limpo(MM.moedaPa(3_192.666_666))).toBe("R$ 3.192,67");
  });

  for (const vocabulario of ["proposta", "simulacao"] as const) {
    it(`⚠️ ${vocabulario === "proposta" ? "Mesa de Venda" : "espelho público"}: linha a linha, na ordem, o texto da MMendes`, () => {
      montar(vocabulario);
      const nosso = cartaoNaTela("INVESTIDOR PARCELADO");
      const dela = cartoesDaMMendes(435_000).cartoes[1]!;

      // O texto EXATO que a tela escreve.
      expect(nosso).toEqual({
        correcao: "correção: IPCA anual + 6% a.a.",
        nome: "INVESTIDOR PARCELADO",
        origemDoValor: "de R$ 435.000 · −8%",
        parcela: "R$ 3.192,67",
        prazo: "× 84",
        ressalva: "válido para as próximas 16 unidades",
        resumo: "entrada R$ 32.016 (8%) · 4 × R$ 25.000 · 84 meses",
        valorDoLote: "R$ 400.200",
      });
      // E o da MMendes, com as três diferenças de propósito desfeitas e a parcela pela regra dela.
      expect(comoAMMendes(nosso, 8)).toEqual(
        daMMendes({ ...dela, parcela: limpo(MM.moedaPa(3_192.666_666)) }),
      );

      // A ordem das linhas dentro do cartão é a da MMendes.
      const botao = [...alvo.querySelectorAll("button")].find(
        (b) =>
          b.firstElementChild?.textContent?.trim() === "INVESTIDOR PARCELADO",
      )!;
      const ordem = [...botao.querySelectorAll("[data-cartao]")].map((e) =>
        e.getAttribute("data-cartao"),
      );
      expect(ordem).toEqual([
        "nome",
        "ressalva",
        "resumo",
        "valor-do-lote",
        "origem-do-valor",
        "parcela",
        "prazo",
        "correcao",
      ]);
    });
  }

  it("⚠️ a linha do À VISTA, depois dos planos, como a da MMendes", () => {
    montar("simulacao");
    const nosso = alvo.querySelector('[data-cartao="a-vista"]');
    expect(nosso).not.toBeNull();
    const texto = limpo(nosso!.textContent);
    const { aVista } = cartoesDaMMendes(435_000);
    expect(aVista).toEqual({
      detalhe: "melhor desconto de tabela: 12% (plano Investidor)",
      nome: "À vista",
      origemDoValor: "de R$ 435.000 · −12%",
      pagamento: "em uma parcela",
      valorDoLote: "R$ 382.800",
    });
    expect(texto).toBe(
      "À vista" +
        "melhor desconto de tabela: 12% (plano INVESTIDOR)" +
        "Valor do lote" +
        "R$ 382.800" +
        "de R$ 435.000 · −12%" +
        "Pagamento" +
        "em uma parcela",
    );
    // Vem depois do último cartão de plano.
    const cartoes = [...alvo.querySelectorAll("button")].filter((b) =>
      b.querySelector('[data-cartao="nome"]'),
    );
    expect(
      cartoes.at(-1)!.compareDocumentPosition(nosso!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("empreendimento sem desconto de plano: sem linha do à vista, e o valor do lote diz 'sem desconto'", () => {
    const semDesconto = GARDEN.map((p) => ({
      ...p,
      anuaisQuantidade: null,
      anuaisValor: null,
      descontoPercentual: 0,
      ressalva: null,
    }));
    act(() => {
      raiz.render(
        <SimuladorDeProposta
          entradaMinimaPercentual={10}
          planos={semDesconto}
          unidade="01 01"
          valorDaUnidade={178_100}
        />,
      );
    });
    expect(alvo.querySelector('[data-cartao="a-vista"]')).toBeNull();
    const normal = cartaoNaTela("NORMAL");
    expect(normal.valorDoLote).toBe("R$ 178.100");
    expect(normal.origemDoValor).toBe("sem desconto");
    expect(normal.resumo).toBe("entrada R$ 17.810 (10%) · 60 meses");
  });
});

// ── A MEDIÇÃO: os 87 lotes disponíveis do Garden × 3 planos ─────────────────────────────────────
//
// Os lotes são os mesmos de `lib/hercules/tabela-do-lote.revisao.test.ts` (hercules_unidades,
// enterprise 39, disponíveis com preço, SELECT de 18/09/2026). Cada cartão nosso sai de `linhasDoCartao`
// sobre `condicaoDoPlano` (a mesma conta que a tela desenha) e é comparado com o que o `renderOficial`
// da MMendes escreve para o mesmo lote, com as normalizações do cabeçalho.
const LOTES_DISPONIVEIS: Record<number, number> = {
  410_000: 17,
  416_000: 19,
  420_000: 1,
  421_500: 13,
  430_000: 16,
  435_000: 10,
  440_000: 1,
  460_000: 1,
  470_000: 3,
  480_000: 1,
  490_000: 1,
  510_000: 1,
  530_000: 1,
  570_000: 1,
  580_000: 1,
};

describe("medição: o texto do cartão nos 87 lotes disponíveis do Garden", () => {
  it("248 dos 261 cartões batem linha a linha; os 13 restantes são o R$ 1 de entrada dos lotes de R$ 421.500", () => {
    let total = 0;
    let iguais = 0;
    const diferentes: string[] = [];
    for (const [precoTexto, quantos] of Object.entries(LOTES_DISPONIVEIS)) {
      const preco = Number(precoTexto);
      const dela = cartoesDaMMendes(preco);
      GARDEN.forEach((p, k) => {
        const conta = condicaoDoPlano({
          entradaMinimaPercentual: PISO_DO_GARDEN,
          plano: {
            anuaisQuantidade: p.anuaisQuantidade,
            anuaisValor: p.anuaisValor,
            descontoPercentual: p.descontoPercentual,
            entradaPercentual: p.entradaPercentual,
            parcelas: p.parcelas,
            sistemaAmortizacao: sistemaDoCadastro(p.sistemaAmortizacao),
            taxaAoMes: taxaMensal(p as unknown as PlanoComercial),
          },
          precoDeTabela: preco,
        });
        const nosso = linhasDoCartao({
          anuais: conta.anuais,
          entrada: conta.entrada,
          entradaPercentual: p.entradaPercentual,
          indiceCorrecao: p.indiceCorrecao,
          nome: p.nome,
          parcela: conta.parcela,
          parcelas: p.parcelas,
          preco: conta.precoDoPlano,
          precoDeTabela: preco,
          ressalva: p.ressalva,
          taxa: textoDaTaxa(p as unknown as PlanoComercial),
        });
        const esperado = daMMendes(dela.cartoes[k]!);
        const obtido = comoAMMendes(
          { ...nosso, ressalva: nosso.ressalva ?? "" },
          p.entradaPercentual,
        );
        // A parcela da MMendes com centavos: o `renderOficial` arredonda, a regra dela é `moedaPa`.
        const parcelaComCentavos = limpo(MM.moedaPa(conta.parcela));
        const igual =
          JSON.stringify({ ...obtido, parcela: "" }) ===
            JSON.stringify({ ...esperado, parcela: "" }) &&
          obtido.parcela === parcelaComCentavos &&
          // e o arredondamento dela é o nosso número arredondado: a mesma parcela, ao centavo.
          esperado.parcela ===
            limpo(
              new Intl.NumberFormat("pt-BR", {
                currency: "BRL",
                maximumFractionDigits: 0,
                style: "currency",
              }).format(conta.parcela),
            );
        total += quantos;
        if (igual) iguais += quantos;
        else
          diferentes.push(
            `${preco} ${p.nome}: ${JSON.stringify(obtido)} x ${JSON.stringify(esperado)}`,
          );
      });
      const avNosso = linhaDoAVista({
        planos: GARDEN.map((p) => ({
          desconto: Number(p.descontoPercentual),
          nome: p.nome,
        })),
        precoDeTabela: preco,
      })!;
      expect({
        ...avNosso,
        detalhe: avNosso.detalhe.replace("INVESTIDOR", "Investidor"),
      }).toEqual({
        detalhe: dela.aVista.detalhe,
        origemDoValor: dela.aVista.origemDoValor,
        pagamento: dela.aVista.pagamento,
        valorDoLote: dela.aVista.valorDoLote,
      });
    }
    expect(total).toBe(261);
    expect(iguais).toBe(248);
    expect(
      diferentes.every((d) => d.startsWith("421500 INVESTIDOR PARCELADO")),
    ).toBe(true);
  });
});
