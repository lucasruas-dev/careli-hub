// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CadastroFlow } from "@/modules/apolo/blocks/cadastro/cadastro-flow";
import { AutonomoPublicoPortal } from "@/modules/publico/autonomo/AutonomoPublicoPortal";
import { ImobiliariaPublicoPortal } from "@/modules/publico/imobiliaria/ImobiliariaPublicoPortal";

// AS TELAS PÚBLICAS, MONTADAS DE VERDADE (01/10/2026).
//
// O link do corretor autônomo reusa o wizard e a vitrine de empreendimentos dos links que já estão no
// ar. A terceira rodada de revisão da Publicação pegou sete mutações nessas peças passando com a suíte
// verde, porque nenhum teste montava a tela. Aqui cada link é desenhado no DOM e o que a pessoa vê é
// conferido: o do autônomo mudou o que devia, e a CAD do cliente e a imobiliária ficaram como estavam.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: null | Root = null;
let palco: HTMLDivElement;

beforeEach(() => {
  palco = document.createElement("div");
  document.body.appendChild(palco);
  // Nenhuma tela pode depender da rede para desenhar; o que ela pedir volta vazio.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200 })),
  );
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  palco.remove();
  vi.unstubAllGlobals();
});

function montar(elemento: React.ReactElement) {
  act(() => {
    raiz = createRoot(palco);
    raiz.render(elemento);
  });
  return palco;
}

const botao = (texto: string) =>
  [...palco.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto) as
    | HTMLButtonElement
    | undefined;

const EMPREENDIMENTOS = [
  { code: "VDO", id: "35", logoUrl: null, name: "Vale do Ouro" },
] as never[];

describe("a vitrine de empreendimentos", () => {
  it("IMOBILIÁRIA: os textos de sempre, e sem empreendimento aberto o botão NÃO segue", () => {
    montar(<ImobiliariaPublicoPortal empreendimentos={[]} />);
    expect(palco.textContent).toContain("Quais empreendimentos você quer trabalhar?");
    expect(palco.textContent).toContain("Nenhum empreendimento aberto para credenciamento");
    expect(botao("Continuar")?.disabled).toBe(true);
  });

  it("IMOBILIÁRIA: com empreendimento, só segue depois de escolher", () => {
    montar(<ImobiliariaPublicoPortal empreendimentos={EMPREENDIMENTOS} />);
    expect(botao("Continuar")?.disabled).toBe(true);
    act(() => {
      [...palco.querySelectorAll("button")].find((b) => b.textContent?.includes("Vale do Ouro"))!.click();
    });
    expect(botao("Continuar")?.disabled).toBe(false);
  });

  it("AUTÔNOMO: é interesse, e sem empreendimento aberto ele segue para o cadastro", () => {
    montar(<AutonomoPublicoPortal empreendimentos={[]} />);
    expect(palco.textContent).toContain("Em quais empreendimentos você quer atuar?");
    expect(palco.textContent).toContain("É um pedido");
    expect(botao("Continuar")?.disabled).toBe(false);
    act(() => botao("Continuar")!.click());
    expect(palco.textContent).toContain("Cadastro de corretor autônomo");
    expect(palco.textContent).toContain("Seu CPF");
    // Nada de vocabulário interno na tela de fora.
    expect(palco.textContent).not.toMatch(/fila|Board|código CA|Apolo/i);
  });
});

describe("o wizard em cada link público", () => {
  it("AUTÔNOMO: fala com a própria pessoa", () => {
    montar(
      <CadastroFlow
        publico={{
          header: "x-autonomo-pre-sessao",
          salvarUrl: "/api/publico/autonomo/cadastro",
          semChecagemCpf: true,
          semEnriquecimento: true,
          sessao: "t",
        }}
        tipo="corretor"
      />,
    );
    expect(palco.textContent).toContain("Seu cadastro de corretor autônomo");
    expect(palco.textContent).toContain("seus dados");
    expect(palco.textContent).toContain("Anexe o seu documento de identificação");
    expect(palco.textContent).not.toContain("do cliente");
  });

  it("CAD DO CLIENTE: o texto de sempre", () => {
    montar(<CadastroFlow publico={{ sessao: "t" }} />);
    expect(palco.textContent).toContain("Cadastro do cliente");
    expect(palco.textContent).toContain("dados do cliente");
    expect(palco.textContent).not.toContain("corretor autônomo");
  });

  it("IMOBILIÁRIA: o texto de sempre", () => {
    montar(
      <CadastroFlow
        publico={{
          header: "x-cad-pre-sessao-imob",
          salvarUrl: "/api/publico/imobiliaria/cadastro",
          sessao: "t",
        }}
        tipo="imobiliaria"
      />,
    );
    expect(palco.textContent).toContain("Cadastro de Imobiliária");
    expect(palco.textContent).toContain("dados da imobiliária");
    expect(palco.textContent).not.toContain("seus dados");
  });
});
