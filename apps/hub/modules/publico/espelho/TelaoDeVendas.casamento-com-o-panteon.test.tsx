// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mapaDoEspelho, separarEspelho } from "@/lib/apolo/incorporador/espelho-svg";
import type { EstadoDaTv } from "@/lib/hercules/espelho/telas-de-tv";
import { estadoParaTv } from "@/lib/hercules/espelho/telas-de-tv";
import { situacaoPublicaDoLote } from "@/lib/hercules/espelho/situacao-publica";
import type {
  SituacaoDaUnidade,
  SituacaoDasUnidades,
  UnidadeComSituacao,
} from "@/lib/hercules/situacao-da-unidade";

import { AZUL_DA_TV, TelaoDeVendas, VERDE_DA_TV } from "./TelaoDeVendas";

// O CASAMENTO DO DESENHO COM O CADASTRO — a corrente inteira, do `inkscape:label` até a tinta.
//
// Este arquivo existe porque a TV do stand não tem ninguém olhando e não tem onde reclamar: se o
// contorno do SVG deixar de casar com a unidade do Panteon, o lote muda de cor sozinho na parede, e
// só um corretor conferindo lote por lote descobriria. A corrente tem quatro elos, e cada um já
// quebrou em alguma tela desta casa:
//
//   SVG (`inkscape:label="GDN0101"`)
//     → separarEspelho          filtra pelo CADASTRO, nunca por formato do código
//     → situacaoPublicaDoLote   traduz a régua única em duas cores, fail-closed
//     → estadoParaTv            leva só código e cor pelo fio
//     → TelaoDeVendas           procura o contorno pelo código e pinta
//
// ⚠️ O ELO FRACO CONHECIDO É A RENUMERAÇÃO. O Garden já renumerou lote
// ([[reference_garden_lote_renumerado]]): renumerar muda `hercules_unidades.codigo`, o label do SVG
// fica órfão e o lote SOME do mapa. Sumir é o lado seguro (melhor que ficar sem cor, que o stand
// lê como livre), mas é um lote invisível na parede — e é isto que o último teste prende.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Um SVG no formato do Garden: dois lotes, uma rua e um label que o cadastro não conhece.
 *
 * Medido no arquivo real: 405 labels no SVG para 404 unidades no banco — o import gravou
 * "1 label(s) sem unidade". `GDN0404` aqui é esse órfão.
 */
const SVG = `<svg viewBox="0 0 2396 2160" xmlns="http://www.w3.org/2000/svg">
  <path inkscape:label="GDN0101" id="path1" d="M0 0 H10 V10 H0 Z" />
  <path inkscape:label="GDN0102" id="path2" d="M20 0 H30 V10 H20 Z" />
  <path inkscape:label="Rua das Palmeiras" id="path3" d="M40 0 H50 V10 H40 Z" />
  <path inkscape:label="GDN0404" id="path4" d="M60 0 H70 V10 H60 Z" />
</svg>`;

function unidade(codigo: string, id: string, situacao: SituacaoDaUnidade): UnidadeComSituacao {
  return {
    codigo,
    enterpriseId: "39",
    id,
    lote: codigo.slice(-2),
    origemC2xId: null,
    quadra: codigo.slice(3, 5),
    situacao,
  };
}

/** A resposta da régua única, na forma que `situacaoPublicaDoLote` consome. */
function regua(linhas: UnidadeComSituacao[]): SituacaoDasUnidades {
  return {
    porCodigo: new Map(linhas.map((u) => [u.codigo, u])),
    porLinha: new Map(linhas.map((u) => [u.id, u])),
    porOrigemC2x: new Map(),
    terreno: () => undefined,
    unidades: linhas,
  };
}

/** O caminho inteiro: régua única → duas cores → o que viaja para a TV. */
function estadoDaTv(linhas: UnidadeComSituacao[]): EstadoDaTv {
  const lotes = linhas.map((u) => ({
    codigo: u.codigo,
    situacao: situacaoPublicaDoLote([{ doPai: true, id: u.id }], regua(linhas)),
    // O resto do lote do espelho não importa aqui — `estadoParaTv` é quem o descarta, e é isso
    // que [[telas-de-tv.test.ts]] prende.
  }));
  return estadoParaTv({
    atualizadoEm: "2026-09-22T12:00:00.000Z",
    contagem: { disponivel: 0, indisponivel: 0 },
    lotes: lotes as never,
  });
}

let container: HTMLDivElement;
let root: Root;

function pintar(estado: EstadoDaTv, codigosNoCadastro: string[]) {
  const geometria = mapaDoEspelho(separarEspelho(SVG, new Set(codigosNoCadastro)));
  act(() => {
    root.render(
      <TelaoDeVendas
        estadoInicial={estado}
        geometria={geometria}
        marcas={{
          empreendimento: { alt: "Garden", src: "/marcas/garden.png" },
          rodape: null,
          topo: null,
        }}
        slug="garden"
        urlDaArte="/api/publico/espelho/tv/arte?t=garden&v=1"
      />,
    );
  });
  return geometria;
}

function coresNaTela(): (null | string)[] {
  return [...container.querySelectorAll("path")]
    .map((p) => p.getAttribute("fill"))
    .filter((fill) => fill !== "transparent");
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("o contorno do SVG encontra a unidade do Panteon", () => {
  const LINHAS = [
    unidade("GDN0101", "u-1", "disponivel"),
    unidade("GDN0102", "u-2", "vendida"),
  ];
  const CADASTRO = ["GDN0101", "GDN0102"];

  it("o label do desenho é, letra por letra, o código da unidade", () => {
    const geometria = pintar(estadoDaTv(LINHAS), CADASTRO);
    expect(geometria.contornos.map((c) => c.codigo)).toEqual(["GDN0101", "GDN0102"]);
    expect(estadoDaTv(LINHAS).lotes.map((l) => l.codigo)).toEqual(["GDN0101", "GDN0102"]);
  });

  it("a unidade livre pinta de verde e a vendida de azul", () => {
    pintar(estadoDaTv(LINHAS), CADASTRO);
    expect(coresNaTela()).toEqual([VERDE_DA_TV, AZUL_DA_TV]);
  });

  // ⚠️ A RUA NÃO PODE VIRAR LOTE VERDE. O arquivo do projetista traz rua, praça, moldura e legenda
  // como `<path>` igual aos lotes; quem separa é o CADASTRO, e não uma regex de formato — a
  // primeira versão do separador adivinhava por formato e devolveu zero contornos em três
  // loteamentos cujos códigos têm letra no meio.
  it("a rua não entra no mapa", () => {
    const geometria = pintar(estadoDaTv(LINHAS), CADASTRO);
    expect(geometria.contornos.map((c) => c.codigo)).not.toContain("Rua das Palmeiras");
    expect(coresNaTela()).toHaveLength(2);
  });

  // ⚠️ O LABEL ÓRFÃO DO GARDEN. São 405 labels para 404 unidades: um contorno sem cadastro. Ele é
  // descartado pelo separador, então some do mapa em vez de ficar sem cor — e SUMIR é o lado
  // seguro, porque contorno sem cor na parede se lê como lote livre.
  it("o label sem unidade some do mapa, e não fica sem cor", () => {
    const geometria = pintar(estadoDaTv(LINHAS), CADASTRO);
    expect(geometria.contornos.map((c) => c.codigo)).not.toContain("GDN0404");
    for (const cor of coresNaTela()) expect([VERDE_DA_TV, AZUL_DA_TV]).toContain(cor);
  });
});

describe("a régua única é quem decide a cor", () => {
  // Nenhuma etapa do processo vira cor própria: proposta, contrato, assinatura, reserva, faturado,
  // vendido e bloqueado saem todos azul. Verde é só `disponivel`.
  it.each<[SituacaoDaUnidade, string]>([
    ["disponivel", VERDE_DA_TV],
    ["reservada", AZUL_DA_TV],
    ["proposta", AZUL_DA_TV],
    ["contrato", AZUL_DA_TV],
    ["vendida", AZUL_DA_TV],
    ["bloqueada", AZUL_DA_TV],
  ])("unidade %s pinta %s", (situacao, esperada) => {
    const linhas = [unidade("GDN0101", "u-1", situacao)];
    pintar(estadoDaTv(linhas), ["GDN0101"]);
    expect(coresNaTela()[0]).toBe(esperada);
  });

  // ⚠️ FAIL-CLOSED ATÉ O FIM DA CORRENTE. Linha que a régua não conhece (lida noutro workspace,
  // criada entre as duas leituras) sai azul em `situacaoPublicaDoLote`; e contorno que o estado da
  // TV não menciona sai azul no componente. São duas portas, e as duas fecham para o mesmo lado.
  it("linha que a régua não conhece não vira verde", () => {
    const orfa = { codigo: "GDN0101", situacao: situacaoPublicaDoLote([{ doPai: true, id: "u-sumida" }], regua([])) };
    expect(orfa.situacao).toBe("indisponivel");

    pintar({ atualizadoEm: "2026-09-22T12:00:00.000Z", lotes: [orfa] }, ["GDN0101"]);
    expect(coresNaTela()[0]).toBe(AZUL_DA_TV);
  });

  // ⚠️ A RENUMERAÇÃO, PRENDIDA. O Garden já renumerou lote: se `hercules_unidades.codigo` virar
  // GDN0103 e o SVG continuar dizendo GDN0102, o contorno fica órfão. O que NÃO pode acontecer é o
  // lote aparecer verde por causa disso.
  it("lote renumerado some do mapa em vez de aparecer livre", () => {
    const renumerada = [unidade("GDN0103", "u-2", "vendida")];
    const geometria = pintar(estadoDaTv(renumerada), ["GDN0101", "GDN0103"]);

    expect(geometria.contornos.map((c) => c.codigo)).toEqual(["GDN0101"]);
    expect(coresNaTela()).toHaveLength(1);
    expect(coresNaTela()[0]).toBe(AZUL_DA_TV);
  });
});
