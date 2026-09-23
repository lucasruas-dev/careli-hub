// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoteDoEspelho } from "@/lib/hercules/espelho/estado-do-espelho";
import type { PlanoPublico } from "@/lib/hercules/espelho/planos-publicos";

import { EspelhoPublico } from "./EspelhoPublico";

// A JANELA DO LOTE NO iPAD (Lucas, 22/09/2026: *"no ipad, a tela da simulação está cortando essa
// parte de sugestão de plano e quando tento subir quem sobe é a tela do fundo"*).
//
// ⚠️ OS DOIS DEFEITOS SÃO O MESMO: A JANELA NÃO TINHA ALTURA. O `aside` do pop-up tinha só
// `max-height: 92dvh`, sem `height`. Altura indefinida faz o `height: 100%` da raiz do
// SimuladorDeProposta virar `auto`, e aí as duas colunas dele nunca ligam a rolagem interna.
// Medido no navegador a 768 × 1024 (iPad retrato), com a réplica fiel desta cadeia de estilos:
//
//   moldura (flex:1, min-height:0, overflow:hidden) → clientHeight 851, scrollHeight 1372
//   raiz do simulador (height:100%)                 → altura calculada 1372px, e não 851px
//   coluna da leitura                               → scrollHeight === clientHeight (NÃO ROLA)
//   "Outras composições"                            → base em 1504px, moldura termina em 983px
//
// São 521 px cortados sem barra de rolagem, e o gesto de arrastar, sem nada para rolar ali dentro,
// vaza para o documento: "quem sobe é a tela do fundo".
//
// Com `height` de verdade na janela a mesma réplica mede: raiz 851,406px, coluna rolando por dentro
// com 521px de curso, "Outras composições" alcançável rolando. Layout de verdade o jsdom não mede;
// o que este arquivo prende é a CAUSA (a janela declarar altura) e a peça que impede o vazamento
// (`overscroll-behavior: contain` nos dois roladores).

(globalThis as unknown as { React: typeof React }).React = React;
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = {
  indiceCorrecao: "IPCA_ANUAL",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  sistemaAmortizacao: "sacoc",
} as const;

const planos = (): PlanoPublico[] => [
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
];

const disponivel = (): LoteDoEspelho =>
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

const vendido = (): LoteDoEspelho =>
  ({
    ...disponivel(),
    codigo: "GDN1111",
    lote: "11",
    numero: "11",
    rotulo: "Quadra 11 · Lote 11",
    situacao: "indisponivel",
  }) as unknown as LoteDoEspelho;

const situacao = () => ({
  atualizadoEm: "2026-09-22T12:00:00.000Z",
  contagem: { disponivel: 1, indisponivel: 1 },
  empreendimento: { codigo: "garden", nome: "Garden" },
  entradaMinimaPercentual: 8,
  lotes: [disponivel(), vendido()],
  planos: planos(),
  temMapa: false,
});

let alvo: HTMLDivElement;
let raiz: Root;

function clicar(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Abre a janela do lote pelo quadradinho da grade. */
function abrir(rotuloDaSituacao: "Disponível" | "Indisponível") {
  const quadradinho = [...alvo.querySelectorAll("button")].find((b) =>
    b.title.endsWith(`· ${rotuloDaSituacao}`),
  );
  if (!quadradinho) throw new Error(`quadradinho ${rotuloDaSituacao} ausente`);
  clicar(quadradinho);
}

function janela(): HTMLElement {
  const el = alvo.querySelector<HTMLElement>('[data-esp-popup="painel"]');
  if (!el) throw new Error("janela do lote ausente");
  return el;
}

/** A moldura que abriga o simulador dentro da janela. */
function moldura(): HTMLElement {
  const el = alvo.querySelector<HTMLElement>("[data-esp-simulador]");
  if (!el) throw new Error("moldura do simulador ausente");
  return el;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", (q: string) => ({
    addEventListener() {},
    matches: false,
    media: q,
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "fetch",
    async () => new Response(JSON.stringify({ data: situacao() }), { status: 200 }),
  );
  alvo = document.createElement("div");
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
  act(() => {
    raiz.render(<EspelhoPublico inicial={situacao() as never} token="tok" />);
  });
});

afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("EspelhoPublico: a janela do lote rola por dentro no iPad", () => {
  it("⚠️ a janela tem TETO, e não altura travada: 92dvh é limite, não tamanho", () => {
    abrir("Disponível");
    const painel = janela();

    expect(painel.style.maxHeight).toBe("92dvh");
    // ⚠️ `height: 92dvh` ERA A PRIMEIRA CORREÇÃO DO iPAD, e ela sobrecorrigiu. Medido no navegador
    // a 1920 × 1080 com a réplica desta cadeia e um empreendimento de conteúdo curto: a janela
    // abria com 993,6px para um conteúdo de 389px — 604,6px de vazio embaixo. Com o teto, a mesma
    // réplica mede 389px de janela; com conteúdo longo, 993,6px e as colunas rolando por dentro.
    expect(painel.style.height).toBe("");
  });

  it("⚠️ quem dá altura de verdade ao simulador é a MOLDURA, e é ela que encolhe no teto", () => {
    abrir("Disponível");
    const m = moldura();

    // ⚠️ SEM ESTA CADEIA NÃO HÁ ROLAGEM INTERNA. A raiz do `SimuladorDeProposta` pede
    // `height: 100%`, e percentual contra pai de altura INDEFINIDA vira `auto`: as duas colunas
    // crescem até o conteúdo, a moldura corta com `overflow: hidden` e o arrasto vaza para a
    // página de trás (o "quem sobe é a tela do fundo" do Lucas). A linha `minmax(0, 1fr)` é o que
    // torna a altura da moldura definida para o filho sem travá-la num número: medido na réplica a
    // 768 × 1024, moldura 843,1px, raiz 843,1px (era 1430px, com 587px cortados) e a coluna da
    // leitura com 587px de curso.
    expect(m.style.display).toBe("grid");
    expect(m.style.gridTemplateRows).toBe("minmax(0, 1fr)");
    // `min-height: 0` é o par obrigatório do `flex`: sem ele um filho de flex não encolhe abaixo
    // do próprio conteúdo, e a janela voltaria a transbordar em vez de rolar.
    expect(m.style.minHeight).toBe("0px");
    expect(m.style.overflow).toBe("hidden");
  });

  it("⚠️ os dois roladores do simulador estão dentro da janela e prendem o gesto", () => {
    abrir("Disponível");
    const painel = janela();
    const roladores = [...painel.querySelectorAll<HTMLElement>("[data-sim-rolagem]")];

    expect(roladores.map((r) => r.dataset.simRolagem)).toEqual([
      "comandos",
      "leitura",
    ]);
    for (const rolador of roladores) {
      // ⚠️ AS DUAS COLUNAS DECLARAM O EIXO VERTICAL DE FORMAS DIFERENTES, de propósito: a dos
      // comandos corta o horizontal (`overflowX: hidden`) e a da leitura deixa os dois em `auto`,
      // porque a prévia do cronograma é uma tabela larga. O jsdom não decompõe o atalho `overflow`
      // em `overflowY`, então a leitura é pelas duas formas.
      expect(rolador.style.overflowY || rolador.style.overflow).toBe("auto");
      // Sem isto o arrasto que chega ao fim do rolador continua na página de trás.
      expect(rolador.style.overscrollBehavior).toBe("contain");
    }
  });

  // ⚠️ A LISTA DE "OUTRAS COMPOSIÇÕES" NÃO EXISTE MAIS (Lucas, 22/09/2026: *"pode tirar isso aqui"*,
  // *"De todo lugar"*). O que este teste guarda continua valendo: o conteúdo comprido da leitura
  // mora DENTRO do rolador, e não vaza para a página atrás. Quem faz esse papel agora é a simulação
  // montada, que é o último bloco da coluna.
  it("os cartões de plano e a simulação montada ficam DENTRO do rolador da leitura", () => {
    abrir("Disponível");
    const leitura = janela().querySelector<HTMLElement>('[data-sim-rolagem="leitura"]');
    expect(leitura).toBeTruthy();

    const texto = leitura?.textContent ?? "";
    expect(texto).toContain("Tabela do empreendimento, aplicada a este lote");
    expect(texto).toContain("Simulação montada");
    expect(texto).not.toContain("Outras composições");
  });

  it("sem simulador a janela continua pequena, como sempre esteve", () => {
    abrir("Indisponível");
    const painel = janela();

    expect(painel.querySelector("[data-sim-rolagem]")).toBeNull();
    expect(painel.style.height).toBe("");
    expect(painel.style.maxHeight).toBe("92dvh");
  });
});
