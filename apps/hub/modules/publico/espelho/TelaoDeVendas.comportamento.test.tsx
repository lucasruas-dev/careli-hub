// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GeometriaDaTv } from "@/lib/hercules/espelho/abrir-tela-de-tv";
import type { EstadoDaTv } from "@/lib/hercules/espelho/telas-de-tv";

import { AZUL_DA_TV, INTERVALO_DA_TV_MS, TelaoDeVendas, VERDE_DA_TV } from "./TelaoDeVendas";

// O TELÃO DE VENDAS DO STAND — a TV que fica ligada o dia todo mostrando o mapa do Garden.
//
// Quatro coisas precisam ser verdade nesta tela, e as quatro já custaram defeito em outra tela da
// casa:
//
//   1. a cor sai da situação, e é só isso que ela diz;
//   2. contorno que a régua não conhece sai AZUL, nunca sem cor;
//   3. venda que anda no Hércules muda a cor sem ninguém recarregar;
//   4. rede caindo NÃO apaga o mapa que já está na parede.
//
// O quarto é o que mais importa aqui: [[reference_polling_sem_payload_apaga_tela]] é uma armadilha
// medida nesta casa — atualização sem resposta zerando o que estava desenhado. Numa TV de stand
// isso vira uma tela vazia, no meio do salão, sem ninguém para perceber.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GEOMETRIA: GeometriaDaTv = {
  contornos: [
    { codigo: "GDN0101", d: "M0 0 H10 V10 H0 Z" },
    { codigo: "GDN0102", d: "M20 0 H30 V10 H20 Z" },
    // ⚠️ O TERCEIRO NÃO EXISTE NO CADASTRO. É o "1 label(s) sem unidade" que o import do Garden
    // registrou (405 labels no SVG, 404 unidades no banco), e é o caso do lote vendido antes da
    // carga, da permuta e do nome trocado na arte.
    { codigo: "GDN9999", d: "M40 0 H50 V10 H40 Z" },
  ],
  viewBox: "0 0 2396 2160",
};

const MARCAS = {
  empreendimento: { alt: "Garden Resort Residence", src: "/marcas/garden.png" },
  rodape: { alt: "MMendes Empreendimentos", src: "/marcas/mmendes.svg" },
  topo: { alt: "Cecílio Rocha Construtora", src: "/marcas/cecilio-rocha.svg" },
};

const ESTADO_INICIAL: EstadoDaTv = {
  atualizadoEm: "2026-09-22T12:00:00.000Z",
  lotes: [
    { codigo: "GDN0101", situacao: "disponivel" },
    { codigo: "GDN0102", situacao: "indisponivel" },
  ],
};

let container: HTMLDivElement;
let root: Root;

function montar(estadoInicial: EstadoDaTv = ESTADO_INICIAL) {
  act(() => {
    root.render(
      <TelaoDeVendas
        estadoInicial={estadoInicial}
        geometria={GEOMETRIA}
        marcas={MARCAS}
        slug="garden"
        urlDaArte="/api/publico/espelho/tv/arte?t=garden&v=1"
      />,
    );
  });
}

/**
 * As cores desenhadas, na ordem dos contornos.
 *
 * `MapaDeLotes` desenha DOIS caminhos por lote: o que pinta e uma área de toque transparente por
 * cima (é o conserto do buraco do `evenodd`, de 14/09). Só o primeiro carrega cor.
 */
function coresNaTela(): (null | string)[] {
  return [...container.querySelectorAll("path")]
    .map((p) => p.getAttribute("fill"))
    .filter((fill) => fill !== "transparent");
}

/** Deixa os microtasks do fetch correrem, com os timers falsos ligados. */
async function assentar() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a cor de cada lote", () => {
  it("verde é o que está liberado, azul é o que não está", () => {
    montar();
    expect(coresNaTela()).toEqual([VERDE_DA_TV, AZUL_DA_TV, AZUL_DA_TV]);
  });

  // ⚠️ CONTORNO SEM SITUAÇÃO É OCUPADO, NUNCA SEM COR — a mesma regra do telão do Prometeu (Lucas,
  // 29/08/2026: *"tem alguns lotes que estao sem cor (...) sao lotes ja vendidos"*) e o mesmo
  // fail-closed de `situacao-publica.ts`. Sem cor, o stand lê "livre": o cliente escolhe, o
  // corretor promete, e alguém tem de desdizer.
  it("o contorno que o cadastro não conhece sai azul", () => {
    montar();
    expect(coresNaTela()[2]).toBe(AZUL_DA_TV);
  });

  it("nenhum contorno fica sem tinta", () => {
    montar();
    for (const cor of coresNaTela()) expect(cor).toBeTruthy();
  });
});

describe("a tela reflete a venda sozinha", () => {
  it("lote que deixou de estar livre muda de cor sem recarregar", async () => {
    const fetchFalso = vi.fn().mockResolvedValue({
      json: async () => ({
        data: {
          atualizadoEm: "2026-09-22T12:01:00.000Z",
          lotes: [
            { codigo: "GDN0101", situacao: "indisponivel" },
            { codigo: "GDN0102", situacao: "indisponivel" },
          ],
        } satisfies EstadoDaTv,
      }),
      ok: true,
    });
    vi.stubGlobal("fetch", fetchFalso);

    montar();
    expect(coresNaTela()[0]).toBe(VERDE_DA_TV);

    await act(async () => {
      vi.advanceTimersByTime(INTERVALO_DA_TV_MS);
    });
    await assentar();

    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(String(fetchFalso.mock.calls[0]?.[0])).toContain(
      "/api/publico/espelho/tv/situacao?t=garden",
    );
    // ⚠️ `no-store` NO FETCH TAMBÉM. O header da resposta é quem barra a CDN, mas sem isto o
    // próprio navegador da TV pode servir a resposta anterior do seu cache.
    expect(fetchFalso.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store" });
    expect(coresNaTela()[0]).toBe(AZUL_DA_TV);
  });
});

describe("a rede caindo não apaga a parede", () => {
  it.each([
    ["o fetch estoura", () => vi.fn().mockRejectedValue(new Error("sem rede"))],
    [
      "a rota responde 503",
      () => vi.fn().mockResolvedValue({ json: async () => ({ error: "x" }), ok: false }),
    ],
    [
      "a resposta vem sem lotes",
      () => vi.fn().mockResolvedValue({ json: async () => ({}), ok: true }),
    ],
    [
      "a resposta vem com lista vazia",
      () =>
        vi.fn().mockResolvedValue({
          json: async () => ({ data: { atualizadoEm: "x", lotes: [] } }),
          ok: true,
        }),
    ],
  ])("%s: o último mapa bom continua desenhado", async (_nome, criar) => {
    vi.stubGlobal("fetch", criar());

    montar();
    const antes = coresNaTela();

    await act(async () => {
      vi.advanceTimersByTime(INTERVALO_DA_TV_MS * 3);
    });
    await assentar();

    expect(coresNaTela()).toEqual(antes);
    expect(coresNaTela()[0]).toBe(VERDE_DA_TV);
  });
});

describe("o que a parede mostra, e o que ela não mostra", () => {
  // ⚠️ A BUSCA É NO HTML INTEIRO, e não numa lista de campos. Lucas (22/09/2026): *"não teria os
  // dados de disponivel, nem a parte de unidades"*. É a lição do Garden, onde uma página interna
  // sem senha mostrou nome e preço juntos — e esta tela é pública num endereço sem selo.
  it("nem preço, nem comprador, nem contagem de disponíveis", () => {
    montar();
    const html = container.innerHTML;

    expect(html).not.toMatch(/R\$/);
    expect(html).not.toMatch(/\bdisponíveis\b/i);
    expect(html).not.toMatch(/\bvendido\b/i);
    expect(html).not.toMatch(/\breserva/i);
    expect(html).not.toMatch(/\bproposta\b/i);
    expect(html).not.toMatch(/\bcomprador\b/i);
    expect(html).not.toMatch(/\bcorretor\b/i);
    expect(html).not.toMatch(/\bm²/);
    // Nenhum número de lote solto: o número já está impresso na planta, por baixo da cor.
    expect(html).not.toContain("GDN0101");
  });

  it("mostra a legenda das duas cores, porque cor sozinha não informa quem olha de longe", () => {
    montar();
    expect(container.textContent).toContain("Disponível");
    expect(container.textContent).toContain("Indisponível");
  });

  it("mostra as marcas do empreendimento", () => {
    montar();
    const fontes = [...container.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(fontes).toContain("/marcas/garden.png");
    expect(fontes).toContain("/marcas/cecilio-rocha.svg");
    expect(fontes).toContain("/marcas/mmendes.svg");
  });

  // ⚠️ A HORA É A ÚNICA DEFESA CONTRA MAPA CONGELADO NA PAREDE. Uma TV que perdeu a rede continua
  // bonita mostrando o mapa de ontem, e ninguém percebe olhando. O relógio é o que denuncia.
  it("mostra a hora da última leitura", () => {
    montar();
    expect(container.textContent).toMatch(/\d{2}:\d{2}/);
  });
});
