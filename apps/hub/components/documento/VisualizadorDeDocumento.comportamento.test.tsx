// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type DocumentoParaVer, VisualizadorDeDocumento } from "./VisualizadorDeDocumento";

// O QUE O LUCAS PEDIU (18/09/2026): *"os documentos não precisam abrir em uma nova tela para ser
// visto, pode abrir em pop up e ter um botão de baixar"*. E o que uma janela por cima de OUTRA
// modal precisa para não derrubar a de baixo: o Esc e o clique no fundo param nela.
//
// Mesma montagem manual do teste do `VisualizadorDeMidia`.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  // O jsdom não implementa `createObjectURL`.
  URL.createObjectURL = vi.fn(() => "blob:local/1");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

function documentoPdf(): DocumentoParaVer {
  return {
    carregar: async () => ({
      blob: new Blob(["%PDF-1.4"], { type: "application/pdf" }),
      nome: "Proposta 000016.pdf",
    }),
    nomeDoArquivo: "Proposta.pdf",
    titulo: "Prévia da proposta",
  };
}

async function montar(documento: DocumentoParaVer | null, aoFechar = vi.fn(), aoFecharDeBaixo = vi.fn()) {
  await act(async () => {
    raiz.render(
      // A "modal de baixo": fecha no clique, como a da proposta e a do contrato.
      <div onClick={aoFecharDeBaixo}>
        <VisualizadorDeDocumento aoFechar={aoFechar} documento={documento} />
      </div>,
    );
  });
  // Deixa a promessa do `carregar` resolver.
  await act(async () => {
    await Promise.resolve();
  });
  return { aoFechar, aoFecharDeBaixo };
}

describe("a janela do documento", () => {
  it("fechada, não desenha nada", async () => {
    await montar(null);
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("mostra o PDF dentro da página, sem abrir aba", async () => {
    const abrirAba = vi.spyOn(window, "open");
    await montar(documentoPdf());

    const quadro = document.querySelector("iframe");
    expect(quadro?.getAttribute("src")).toBe("blob:local/1");
    expect(abrirAba).not.toHaveBeenCalled();
  });

  it("o botão Baixar leva o nome que o servidor deu ao arquivo", async () => {
    await montar(documentoPdf());
    const baixar = [...document.querySelectorAll("a")].find((a) => a.textContent?.includes("Baixar"));
    expect(baixar?.getAttribute("download")).toBe("Proposta 000016.pdf");
    expect(baixar?.getAttribute("href")).toBe("blob:local/1");
  });

  it("erro ao carregar vira recado dentro da janela", async () => {
    await montar({
      carregar: async () => {
        throw new Error("Não foi possível abrir o contrato.");
      },
      nomeDoArquivo: "Contrato.pdf",
      titulo: "Contrato",
    });
    expect(document.querySelector("[role=dialog]")?.textContent).toContain(
      "Não foi possível abrir o contrato.",
    );
  });

  it("⚠️ o Esc fecha o documento e NÃO chega à modal de baixo", async () => {
    const deBaixo = vi.fn();
    window.addEventListener("keydown", deBaixo);
    const { aoFechar } = await montar(documentoPdf());

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });

    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(deBaixo).not.toHaveBeenCalled();
    window.removeEventListener("keydown", deBaixo);
  });

  it("⚠️ o clique no fundo fecha o documento e NÃO fecha a modal de baixo", async () => {
    const { aoFechar, aoFecharDeBaixo } = await montar(documentoPdf());
    const fundo = document.querySelector("[role=dialog]") as HTMLElement;

    act(() => {
      fundo.click();
    });

    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(aoFecharDeBaixo).not.toHaveBeenCalled();
  });

  it("libera o PDF da memória ao fechar", async () => {
    await montar(documentoPdf());
    await act(async () => {
      raiz.render(<VisualizadorDeDocumento aoFechar={vi.fn()} documento={null} />);
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local/1");
  });
});
