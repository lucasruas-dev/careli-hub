// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type MidiaDoVisualizador, VisualizadorDeMidia } from "./VisualizadorDeMidia";

// O COMPORTAMENTO DO POPUP, TRAVADO: o que o Lucas pediu ("abre como um popup mesmo", "opção de ver
// em tela cheia") e o que um popup precisa para não atrapalhar a conversa com o cliente (Esc, setas,
// foco preso, página parada atrás). Nada disso aparece numa função pura.
//
// Mesma montagem manual do primeiro teste de componente do repo (ModalDeProposta.comportamento):
// `globalThis.React` porque o vitest compila JSX no formato clássico, e o `IS_REACT_ACT_ENVIRONMENT`
// para o `act` não avisar a cada render.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ITENS: MidiaDoVisualizador[] = [
  { id: "a", nome: "portaria.jpg", tipo: "imagem", url: "https://x/a.jpg" },
  { id: "b", legenda: "Área de lazer", nome: "lazer.jpg", tipo: "imagem", url: "https://x/b.jpg" },
  { id: "c", miniaturaUrl: "https://x/c.thumb.jpg", nome: "tour.mp4", tipo: "video", url: "https://x/c.mp4" },
];

let raiz: Root;
let hospedeiro: HTMLDivElement;

function Harness({
  inicial,
  onFechar,
  onIndice,
}: {
  inicial: null | number;
  onFechar?: () => void;
  onIndice?: (i: number) => void;
}) {
  const [indice, setIndice] = React.useState<null | number>(inicial);
  return (
    <>
      <button data-teste="gatilho" onClick={() => setIndice(0)} type="button">
        abrir
      </button>
      <VisualizadorDeMidia
        indice={indice}
        itens={ITENS}
        onFechar={() => {
          onFechar?.();
          setIndice(null);
        }}
        onIndice={(i) => {
          onIndice?.(i);
          setIndice(i);
        }}
      />
    </>
  );
}

function montar(elemento: React.ReactElement) {
  act(() => {
    raiz.render(elemento);
  });
}

function teclar(tecla: string, opcoes: KeyboardEventInit = {}) {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: tecla, ...opcoes }),
    );
  });
}

const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');
const contador = () => document.querySelector(".vdm-contador")?.textContent;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.style.overflow = "";
  vi.restoreAllMocks();
});

describe("VisualizadorDeMidia", () => {
  it("fechado não desenha nada", () => {
    montar(<Harness inicial={null} />);
    expect(dialogo()).toBeNull();
  });

  it("abre como popup no <body> (fora da árvore de CSS da tela), com contador e foco no fechar", () => {
    montar(<Harness inicial={1} />);
    const modal = dialogo();
    expect(modal).not.toBeNull();
    expect(modal?.getAttribute("aria-modal")).toBe("true");
    expect(hospedeiro.contains(modal)).toBe(false);
    expect(modal?.parentElement).toBe(document.body);
    expect(contador()).toBe("2 de 3");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Fechar");
    expect(document.querySelector(".vdm-titulo")?.textContent).toBe("Área de lazer");
  });

  it("setas andam e dão a volta; botões também", () => {
    const onIndice = vi.fn();
    montar(<Harness inicial={0} onIndice={onIndice} />);

    teclar("ArrowLeft");
    expect(contador()).toBe("3 de 3");
    expect(document.querySelector("video")).not.toBeNull();

    teclar("ArrowRight");
    expect(contador()).toBe("1 de 3");

    act(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="Próxima"]')?.click();
    });
    expect(contador()).toBe("2 de 3");
    expect(onIndice.mock.calls.map((c) => c[0])).toEqual([2, 0, 1]);
  });

  it("a seta dentro do player é do vídeo, não da galeria", () => {
    montar(<Harness inicial={2} />);
    const video = document.querySelector("video");
    expect(video?.hasAttribute("playsinline")).toBe(true);
    act(() => {
      video?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    });
    expect(contador()).toBe("3 de 3");
  });

  it("Esc fecha, e a página volta a rolar", () => {
    const onFechar = vi.fn();
    document.body.style.overflow = "auto";
    montar(<Harness inicial={0} onFechar={onFechar} />);
    expect(document.body.style.overflow).toBe("hidden");

    teclar("Escape");
    expect(onFechar).toHaveBeenCalledTimes(1);
    expect(dialogo()).toBeNull();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("o Esc não vaza para a tela de baixo", () => {
    const deBaixo = vi.fn();
    window.addEventListener("keydown", deBaixo);
    montar(<Harness inicial={0} />);
    teclar("Escape");
    window.removeEventListener("keydown", deBaixo);
    expect(deBaixo).not.toHaveBeenCalled();
  });

  it("clicar no fundo fecha", () => {
    const onFechar = vi.fn();
    montar(<Harness inicial={0} onFechar={onFechar} />);
    act(() => {
      document.querySelector<HTMLElement>(".vdm-fundo")?.click();
    });
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it("o foco fica preso no popup (Tab no último volta ao primeiro, Shift+Tab no primeiro vai ao último)", () => {
    montar(<Harness inicial={0} />);
    const botoes = Array.from(
      dialogo()?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    // jsdom não calcula layout (`offsetParent` é sempre nulo) e o popup ignora o que não está
    // visível; aqui todo botão conta como visível. O descritor original volta no fim.
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
    Object.defineProperty(HTMLElement.prototype, "offsetParent", {
      configurable: true,
      get() {
        return document.body;
      },
    });

    const ultimo = botoes[botoes.length - 1];
    const primeiro = botoes[0];
    expect(primeiro && ultimo).toBeTruthy();

    act(() => ultimo?.focus());
    teclar("Tab");
    expect(document.activeElement).toBe(primeiro);

    teclar("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(ultimo);

    // Foco fora do popup (um clique perdido na página) volta para dentro no próximo Tab.
    act(() => document.querySelector<HTMLButtonElement>('[data-teste="gatilho"]')?.focus());
    teclar("Tab");
    expect(document.activeElement).toBe(primeiro);

    if (original) Object.defineProperty(HTMLElement.prototype, "offsetParent", original);
  });

  it("devolve o foco a quem abriu", () => {
    montar(<Harness inicial={null} />);
    const gatilho = document.querySelector<HTMLButtonElement>('[data-teste="gatilho"]');
    act(() => gatilho?.focus());
    act(() => gatilho?.click());
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Fechar");

    teclar("Escape");
    expect(dialogo()).toBeNull();
    expect(document.activeElement).toBe(gatilho);
  });

  it("tela cheia usa a Fullscreen API quando existe", () => {
    const pedir = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "requestFullscreen");
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: pedir,
    });

    // ⚠️ A PRIMEIRA CHAMADA É DA ABERTURA (22/09/2026). O visualizador pede tela cheia sozinho ao
    // montar — Lucas: *"quando clicar abrir em full, estou tendo que clicar"* —, então o clique no
    // botão é a SEGUNDA. Ver o efeito `jaPediuTelaCheia`.
    montar(<Harness inicial={0} />);
    expect(pedir).toHaveBeenCalledTimes(1);

    act(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="Ver em tela cheia"]')?.click();
    });
    expect(pedir).toHaveBeenCalledTimes(2);
    expect(dialogo()?.classList.contains("vdm--imersiva")).toBe(false);

    if (original) Object.defineProperty(HTMLElement.prototype, "requestFullscreen", original);
    else delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown }).requestFullscreen;
    delete (document as unknown as { fullscreenEnabled?: unknown }).fullscreenEnabled;
  });

  // ── ABRIR JÁ EM TELA CHEIA (Lucas, 22/09/2026) ──────────────────────────────────────────────
  //
  // *"quando clicar abrir em full, estou tendo que clicar"* e *"o video tem que abrir em
  // fulltela"*. Quem está com o cliente na frente não quer dois cliques para ver a foto grande.
  it("abre JÁ em tela cheia, sem ninguém clicar", () => {
    const pedir = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "requestFullscreen");
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: pedir,
    });

    montar(<Harness inicial={0} />);
    expect(pedir).toHaveBeenCalledTimes(1);

    if (original) Object.defineProperty(HTMLElement.prototype, "requestFullscreen", original);
    else delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown }).requestFullscreen;
    delete (document as unknown as { fullscreenEnabled?: unknown }).fullscreenEnabled;
  });

  // ⚠️ E NÃO CAI NO MODO IMERSIVO QUANDO NÃO DÁ. O imersivo é o consolo de quem PEDIU tela cheia
  // num navegador que não a dá; na abertura automática ele tiraria os botões de cena e exigiria
  // DOIS Esc para fechar, sem ninguém ter pedido nada.
  it("sem tela cheia disponível, a abertura NÃO deixa o visualizador imersivo", () => {
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false });

    montar(<Harness inicial={0} />);
    expect(dialogo()?.classList.contains("vdm--imersiva")).toBe(false);
    expect(document.querySelector('[aria-label="Fechar"]')).not.toBeNull();

    delete (document as unknown as { fullscreenEnabled?: unknown }).fullscreenEnabled;
  });

  it("pedido de tela cheia que nunca responde (navegador embutido) cai no modo imersivo", () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "requestFullscreen");
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: () => new Promise(() => undefined),
    });

    montar(<Harness inicial={0} />);
    act(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="Ver em tela cheia"]')?.click();
    });
    expect(dialogo()?.classList.contains("vdm--imersiva")).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(dialogo()?.classList.contains("vdm--imersiva")).toBe(true);

    vi.useRealTimers();
    if (original) Object.defineProperty(HTMLElement.prototype, "requestFullscreen", original);
    else delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown }).requestFullscreen;
    delete (document as unknown as { fullscreenEnabled?: unknown }).fullscreenEnabled;
  });

  it("sem a API (iPhone): foto entra no modo imersivo e Esc sai dele sem fechar o popup", () => {
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false });
    const onFechar = vi.fn();

    montar(<Harness inicial={0} onFechar={onFechar} />);
    act(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="Ver em tela cheia"]')?.click();
    });
    expect(dialogo()?.classList.contains("vdm--imersiva")).toBe(true);

    teclar("Escape");
    expect(onFechar).not.toHaveBeenCalled();
    expect(dialogo()?.classList.contains("vdm--imersiva")).toBe(false);

    delete (document as unknown as { fullscreenEnabled?: unknown }).fullscreenEnabled;
  });

  it("sem a API (iPhone): vídeo abre o player nativo", () => {
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false });
    const nativo = vi.fn();
    Object.defineProperty(HTMLVideoElement.prototype, "webkitEnterFullscreen", {
      configurable: true,
      value: nativo,
    });

    montar(<Harness inicial={2} />);
    act(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="Ver em tela cheia"]')?.click();
    });
    expect(nativo).toHaveBeenCalledTimes(1);

    delete (HTMLVideoElement.prototype as unknown as { webkitEnterFullscreen?: unknown })
      .webkitEnterFullscreen;
    delete (document as unknown as { fullscreenEnabled?: unknown }).fullscreenEnabled;
  });

  it("arquivo que o navegador não exibe mostra o aviso, sem quebrar a navegação", () => {
    montar(<Harness inicial={0} />);
    act(() => {
      document.querySelector("img.vdm-midia")?.dispatchEvent(new Event("error"));
    });
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "Não foi possível exibir este arquivo",
    );
    teclar("ArrowRight");
    expect(contador()).toBe("2 de 3");
    expect(document.querySelector("img.vdm-midia")).not.toBeNull();
  });
});
