// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArquivoPublicoDoEspelho } from "@/lib/hercules/espelho/arquivos-publicos";
import type { LoteDoEspelho } from "@/lib/hercules/espelho/estado-do-espelho";

import { EspelhoPublico } from "./EspelhoPublico";

// A ABA ARQUIVOS DO ESPELHO PÚBLICO (22/09/2026).
//
// Lucas: a aba que existe no portal do incorporador *"tem que aparecer também no espelho público"*,
// e no mesmo dia, sobre o visualizador: *"quando clicar abrir em full"*, *"o video tem que abrir em
// fulltela"* — o corretor usa isso como APRESENTAÇÃO, com o cliente ao lado.
//
// Cinco coisas precisam ser verdade, e quatro delas já custaram defeito nesta casa:
//
//   1. a aba só nasce quando há arquivo (36 dos 37 empreendimentos não têm nenhum);
//   2. a grade pede MINIATURA, nunca o original — o `Book Garden.pdf` tem 202,9 MB medidos;
//   3. o documento não pede miniatura nenhuma: no banco, nenhum documento tem;
//   4. o clique abre em TELA CHEIA e dá para andar pelos itens sem sair dela;
//   5. ⚠️ a volta de 60 s do polling NÃO apaga a aba — a armadilha
//      [[reference_polling_sem_payload_apaga_tela]], que já apagou tela nesta casa.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID_DO_VIDEO = "e1b1ed1d-7db7-42cc-b937-b8eec954bf1e";
const ID_DO_BOOK = "84fc9e7e-bd30-4795-936e-21a39c2c2901";

/** Os 47 do Garden, na ordem medida no banco. */
const ARQUIVOS: ArquivoPublicoDoEspelho[] = [
  { id: ID_DO_VIDEO, nome: "Video 1.mp4", ordem: 1, tipo: "video" },
  { id: ID_DO_BOOK, nome: "Book Garden.pdf", ordem: 2, tipo: "documento" },
  ...Array.from({ length: 45 }, (_, i) => ({
    id: `0000${String(i + 1).padStart(4, "0")}-0000-4000-8000-000000000000`,
    nome: `Cena ${i + 1}.jpg`,
    ordem: i + 3,
    tipo: "imagem" as const,
  })),
];

const lote = (): LoteDoEspelho =>
  ({
    andar: null,
    apartamento: null,
    area: 420,
    codigo: "GDN1110",
    grupo: "Quadra 11",
    lote: "10",
    numero: "10",
    preco: 435_000,
    quadra: "11",
    rotulo: "Quadra 11 · Lote 10",
    situacao: "disponivel",
    tipoProduto: "loteamento",
  }) as unknown as LoteDoEspelho;

const situacao = (temMapa = false) => ({
  atualizadoEm: "2026-09-22T12:00:00.000Z",
  contagem: { disponivel: 1, indisponivel: 0 },
  empreendimento: { codigo: "GDN", nome: "Garden" },
  entradaMinimaPercentual: 8,
  lotes: [lote()],
  planos: [],
  temMapa,
});

let alvo: HTMLDivElement;
let raiz: Root;
let pedidos: string[];
let telasCheias: number;
let saidasDaTelaCheia: number;

function clicar(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function botao(texto: string): HTMLButtonElement | undefined {
  return [...alvo.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);
}

function cartoes(): HTMLButtonElement[] {
  return [...alvo.querySelectorAll<HTMLButtonElement>("button[aria-label^='Abrir ']")];
}

function popup(): HTMLElement | null {
  return document.body.querySelector("[role='dialog']");
}

function montar(props: Partial<Parameters<typeof EspelhoPublico>[0]> = {}) {
  act(() => {
    raiz.render(
      <EspelhoPublico
        arquivos={ARQUIVOS}
        inicial={situacao() as never}
        token="tok"
        {...props}
      />,
    );
  });
}

beforeEach(() => {
  pedidos = [];
  telasCheias = 0;
  saidasDaTelaCheia = 0;
  vi.stubGlobal("matchMedia", (q: string) => ({
    addEventListener() {},
    matches: false,
    media: q,
    removeEventListener() {},
  }));
  vi.stubGlobal("fetch", async (url: string) => {
    pedidos.push(String(url));
    return new Response(JSON.stringify({ data: situacao() }), { status: 200 });
  });

  // A tela cheia do navegador, de mentira: o visualizador decide DENTRO do clique, e é isso que
  // este teste precisa ver acontecer.
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
  Object.defineProperty(Element.prototype, "requestFullscreen", {
    configurable: true,
    value: () => {
      telasCheias += 1;
      return Promise.resolve();
    },
    writable: true,
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: () => {
      saidasDaTelaCheia += 1;
      return Promise.resolve();
    },
    writable: true,
  });

  alvo = document.createElement("div");
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
});

afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
  vi.unstubAllGlobals();
});

describe("a aba Arquivos só existe quando há arquivo", () => {
  it("⚠️ EMPREENDIMENTO SEM ARQUIVO NÃO GANHA ABA VAZIA", () => {
    montar({ arquivos: [] });

    expect(botao("Arquivos")).toBeUndefined();
    expect(cartoes()).toHaveLength(0);
  });

  it("com arquivos, a aba entra ao lado de Mapa e Grade", () => {
    montar({ inicial: situacao(true) as never });

    expect(botao("Mapa")).toBeDefined();
    expect(botao("Grade")).toBeDefined();
    expect(botao("Arquivos")).toBeDefined();
  });

  it("sem masterplan, o alternador nasce com Grade e Arquivos (antes não existia alternador)", () => {
    montar();

    expect(botao("Mapa")).toBeUndefined();
    expect(botao("Grade")).toBeDefined();
    expect(botao("Arquivos")).toBeDefined();
  });
});

describe("a grade de miniaturas", () => {
  it("mostra os 47 na ordem do cadastro", () => {
    montar();
    clicar(botao("Arquivos")!);

    const lista = cartoes();
    expect(lista).toHaveLength(47);
    expect(lista[0]?.getAttribute("aria-label")).toBe("Abrir vídeo Video 1.mp4");
    expect(lista[1]?.getAttribute("aria-label")).toBe("Abrir documento Book Garden.pdf");
    expect(lista[2]?.getAttribute("aria-label")).toBe("Abrir foto Cena 1.jpg");
    expect(lista[46]?.getAttribute("aria-label")).toBe("Abrir foto Cena 45.jpg");
  });

  it("⚠️ NENHUMA IMAGEM DA GRADE APONTA PARA O ORIGINAL: todas pedem `m=1`", () => {
    montar();
    clicar(botao("Arquivos")!);

    const imagens = [...alvo.querySelectorAll("img")];
    expect(imagens.length).toBeGreaterThan(0);

    for (const img of imagens) {
      const src = img.getAttribute("src") ?? "";
      expect(src).toContain("/api/publico/espelho/arquivo?");
      expect(src).toContain("m=1");
      // Sem `m=1` esta mesma URL desceria o arquivo inteiro — 5 a 10 MB por cena.
      expect(img.getAttribute("loading")).toBe("lazy");
    }
  });

  it("⚠️ O BOOK DE 202,9 MB NÃO PEDE MINIATURA NENHUMA: documento nasce com ícone", () => {
    montar();
    clicar(botao("Arquivos")!);

    const fontes = [...alvo.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? "");
    expect(fontes.some((s) => s.includes(ID_DO_BOOK))).toBe(false);
    // As outras 46 pedem.
    expect(fontes).toHaveLength(46);
  });

  it("miniatura que não carrega vira ícone, e não um quadrado quebrado", () => {
    montar();
    clicar(botao("Arquivos")!);

    const imagem = [...alvo.querySelectorAll("img")][0]!;
    act(() => {
      imagem.dispatchEvent(new Event("error", { bubbles: false }));
    });

    expect([...alvo.querySelectorAll("img")]).toHaveLength(45);
    expect(cartoes()).toHaveLength(47);
  });
});

describe("o visualizador, que é a apresentação do corretor", () => {
  it("⚠️ O CLIQUE ABRE EM TELA CHEIA, SEM UM SEGUNDO CLIQUE", () => {
    montar();
    clicar(botao("Arquivos")!);
    clicar(cartoes()[0]!);

    expect(popup()).not.toBeNull();
    expect(popup()?.textContent).toContain("Video 1.mp4");
    expect(telasCheias).toBe(1);
  });

  it("anda pelos itens SEM sair da tela cheia", () => {
    montar();
    clicar(botao("Arquivos")!);
    clicar(cartoes()[2]!);

    expect(popup()?.textContent).toContain("Cena 1.jpg");

    const proxima = [...document.body.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Próxima",
    );
    clicar(proxima!);

    expect(popup()?.textContent).toContain("Cena 2.jpg");
    expect(saidasDaTelaCheia).toBe(0);
    expect(telasCheias).toBe(1);
  });

  it("o vídeo toca e o PDF abre: cada um com o elemento que o navegador já sabe usar", () => {
    montar();
    clicar(botao("Arquivos")!);

    clicar(cartoes()[0]!);
    const video = document.body.querySelector("video");
    expect(video?.getAttribute("src")).toContain(ID_DO_VIDEO);
    expect(video?.getAttribute("src")).not.toContain("m=1");
    clicar(document.body.querySelector("button[aria-label='Fechar']")!);

    clicar(cartoes()[1]!);
    const quadro = document.body.querySelector("iframe");
    expect(quadro?.getAttribute("src")).toContain(ID_DO_BOOK);
    expect(quadro?.getAttribute("src")).not.toContain("m=1");
  });
});

describe("a volta de 60 s do polling", () => {
  it("⚠️ NÃO APAGA A ABA: a situação não carrega os arquivos, e não pode zerá-los", async () => {
    vi.useFakeTimers();
    try {
      montar();
      clicar(botao("Arquivos")!);
      expect(cartoes()).toHaveLength(47);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(pedidos.filter((u) => u.includes("/situacao"))).toHaveLength(1);
      expect(botao("Arquivos")).toBeDefined();
      expect(cartoes()).toHaveLength(47);
    } finally {
      vi.useRealTimers();
    }
  });
});
