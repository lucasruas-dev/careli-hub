// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O MAPA NO CELULAR: a pinça e o arraste com o dedo.
//
// Lucas (18/09/2026): *"eu não consigo mover com o dedo, dar zoom, deitar a tela, isso tudo tem que
// está disponivel"*. O motor desligava os gestos do navegador (`touchAction: none`) e não punha nada
// no lugar: zoom só pela roda do mouse. O zoom no celular é pela pinça, sem botões (Lucas, mesmo dia:
// *"deixa o zoom na pinça"*). Estes testes montam o motor de verdade e mandam os eventos de
// ponteiro que o toque produz.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { limitarDeslocamento, MapaDeLotes } from "./MapaDeLotes";

const AREA = { bottom: 800, height: 800, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 };

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // O jsdom não mede nada: a cena passa a ter o tamanho de um celular.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ ...AREA, toJSON: () => AREA } as DOMRect);
  // O jsdom não tem captura de ponteiro.
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function montar(props: Partial<React.ComponentProps<typeof MapaDeLotes>> = {}) {
  const aoClicar = vi.fn();
  act(() => {
    root.render(
      React.createElement(MapaDeLotes, {
        aoClicar,
        corDoLote: () => "#00ff00",
        geometria: { contornos: [{ codigo: "GDN0101", d: "M 0 0 L 10 0 L 10 10 Z" }], viewBox: "0 0 2396 2160" },
        urlDaArte: "/arte.png",
        ...props,
      }),
    );
  });
  const cena = host.firstElementChild as HTMLDivElement;
  return { aoClicar, cena };
}

/** O elemento que carrega o `transform` (o zoom e o deslocamento). */
function transformacao(): string {
  const alvo = [...host.querySelectorAll<HTMLDivElement>("div")].find((d) => d.style.transform);
  return alvo?.style.transform ?? "";
}

function zoomAtual(): number {
  const m = /scale\(([\d.]+)\)/.exec(transformacao());
  return m ? Number(m[1]) : Number.NaN;
}

function ponteiro(tipo: string, id: number, x: number, y: number): PointerEvent {
  // O jsdom não tem PointerEvent: um MouseEvent com `pointerId` é o que o React lê.
  const ev = new MouseEvent(tipo, { bubbles: true, clientX: x, clientY: y }) as unknown as PointerEvent;
  Object.defineProperty(ev, "pointerId", { value: id });
  return ev;
}

describe("a pinça com dois dedos", () => {
  it("afastar os dedos aproxima o mapa; aproximar os dedos afasta", () => {
    const { cena } = montar();
    expect(zoomAtual()).toBe(1);

    act(() => {
      cena.dispatchEvent(ponteiro("pointerdown", 1, 150, 400));
      cena.dispatchEvent(ponteiro("pointerdown", 2, 250, 400));
    });
    // A distância entre os dedos triplica: o zoom vai a 3.
    act(() => {
      cena.dispatchEvent(ponteiro("pointermove", 1, 50, 400));
      cena.dispatchEvent(ponteiro("pointermove", 2, 350, 400));
    });
    expect(zoomAtual()).toBeCloseTo(3, 5);

    // Os dedos se aproximam de novo até a distância do começo: volta ao mapa inteiro.
    act(() => {
      cena.dispatchEvent(ponteiro("pointermove", 1, 150, 400));
      cena.dispatchEvent(ponteiro("pointermove", 2, 250, 400));
    });
    expect(zoomAtual()).toBe(1);
  });

  it("a pinça nunca abre o lote que estava sob os dedos", () => {
    const { aoClicar, cena } = montar();
    act(() => {
      cena.dispatchEvent(ponteiro("pointerdown", 1, 150, 400));
      cena.dispatchEvent(ponteiro("pointerdown", 2, 250, 400));
      cena.dispatchEvent(ponteiro("pointermove", 2, 350, 400));
      cena.dispatchEvent(ponteiro("pointerup", 2, 350, 400));
      cena.dispatchEvent(ponteiro("pointerup", 1, 150, 400));
    });
    const alvo = host.querySelectorAll("path")[1];
    act(() => {
      alvo?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(aoClicar).not.toHaveBeenCalled();
  });

  it("um dedo arrasta o mapa aproximado, e nunca para fora da tela", () => {
    const { cena } = montar();
    act(() => {
      cena.dispatchEvent(ponteiro("pointerdown", 1, 150, 400));
      cena.dispatchEvent(ponteiro("pointerdown", 2, 250, 400));
      cena.dispatchEvent(ponteiro("pointermove", 1, 100, 400));
      cena.dispatchEvent(ponteiro("pointermove", 2, 300, 400));
      cena.dispatchEvent(ponteiro("pointerup", 2, 300, 400));
      cena.dispatchEvent(ponteiro("pointerup", 1, 100, 400));
    });
    expect(zoomAtual()).toBeCloseTo(2, 5);

    // Um dedo puxa o mapa 5.000 px para a direita: o deslocamento para na borda da arte.
    act(() => {
      cena.dispatchEvent(ponteiro("pointerdown", 3, 200, 400));
      cena.dispatchEvent(ponteiro("pointermove", 3, 5200, 400));
    });
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(transformacao());
    // Com zoom 2 numa cena de 400 px, a folga horizontal é 200 px de cada lado.
    expect(Number(m?.[1])).toBe(200);
  });
});

describe("limitarDeslocamento", () => {
  it("com o mapa inteiro na tela (zoom 1) não há para onde arrastar", () => {
    expect(limitarDeslocamento({ x: 90, y: -40 }, 1, { height: 800, width: 400 })).toEqual({ x: 0, y: 0 });
  });

  it("a folga cresce com o zoom, a partir do centro", () => {
    expect(limitarDeslocamento({ x: 999, y: -999 }, 3, { height: 800, width: 400 })).toEqual({ x: 400, y: -800 });
    expect(limitarDeslocamento({ x: 50, y: 50 }, 3, { height: 800, width: 400 })).toEqual({ x: 50, y: 50 });
  });
});
