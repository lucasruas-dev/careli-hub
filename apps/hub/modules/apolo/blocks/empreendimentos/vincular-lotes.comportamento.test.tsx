// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A TELA DO VÍNCULO EM MASSA.
//
// ⚠️ O QUE ESTE ARQUIVO TRAVA:
//   • a prévia vem ANTES de gravar: o botão de aplicar só liga depois de conferir, e qualquer
//     mexida na seleção o desliga de novo (um clique aqui pode carimbar 900 lotes);
//   • a faixa de lotes recorta a lista de verdade, pela MESMA régua do servidor;
//   • a marcação manda os ids escolhidos, com a origem "massa" para o carimbo;
//   • a aba da planilha manda o CSV, e não ids.
//
// Mesma montagem manual dos outros testes de componente da casa.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const simulado = vi.hoisted(() => ({ getApoloAccessToken: vi.fn(async () => "token") }));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: () => simulado.getApoloAccessToken(),
}));

const { VincularLotes } = await import("./vincular-lotes");

const CONDOMINIO = "cat-condominio";

function unidade(id: string, quadra: string, lote: string, extras: Record<string, unknown> = {}) {
  return {
    apartamento: "",
    categoriaId: null,
    codigo: `LBR${quadra}${lote}`,
    enterpriseId: "27",
    id,
    lote,
    quadra,
    situacao: "disponivel",
    torre: "",
    vinculo: null,
    ...extras,
  };
}

const UNIVERSO = {
  categorias: [{ enterpriseId: "31", id: CONDOMINIO, nome: "Condomínio" }],
  divisoes: [
    { codigo: "LAB", enterpriseId: "31", nome: "Lagoa Bonita", pai: true },
    { codigo: "LBR", enterpriseId: "27", nome: "Lagoa Bonita Residencial", pai: false },
  ],
  empreendimento: { ids: ["31", "27"], nome: "Lagoa Bonita" },
  semCarimbo: false,
  unidades: [
    unidade("u1", "C", "01"),
    unidade("u2", "C", "02"),
    unidade("u3", "C", "45"),
  ],
};

const PREVIA = {
  avisos: [],
  categorias: [
    {
      categoriaId: CONDOMINIO,
      nome: "Condomínio",
      previa: {
        ids: ["u1", "u1-pai"],
        jaEstao: 0,
        porParentesco: 1,
        semCategoria: 1,
        terrenos: 1,
        trocamDeCategoria: [],
        vendaAndando: 0,
      },
    },
  ],
  divisoes: [],
  planilha: null,
  recusas: [],
  resumo: { linhas: 2, movem: 0, terrenos: 1 },
};

type Chamada = { corpo: null | Record<string, unknown>; metodo: string; url: string };

const chamadas: Chamada[] = [];

function montarFetch(respostaDoPost: unknown = { data: PREVIA }) {
  globalThis.fetch = vi.fn(async (url: unknown, init?: { body?: string; method?: string }) => {
    const metodo = init?.method ?? "GET";
    chamadas.push({
      corpo: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      metodo,
      url: String(url),
    });
    return {
      json: async () => (metodo === "GET" ? { data: UNIVERSO } : respostaDoPost),
      ok: true,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

let container: HTMLDivElement;
let root: Root;

async function montar() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <VincularLotes
        categoriaId={CONDOMINIO}
        categoriaNome="Condomínio"
        codigo="LBR"
        enterpriseId="27"
        onFechar={() => {}}
        onGravou={() => {}}
      />,
    );
  });
}

function botao(texto: string): HTMLButtonElement {
  const achado = [...container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(texto),
  );
  if (!achado) throw new Error(`Botão "${texto}" não está na tela.`);
  return achado as HTMLButtonElement;
}

async function clicar(texto: string) {
  await act(async () => {
    botao(texto).click();
  });
}

async function digitar(placeholder: string, valor: string) {
  const campo = container.querySelector<HTMLInputElement>(`input[placeholder^="${placeholder}"]`);
  if (!campo) throw new Error(`Campo "${placeholder}" não está na tela.`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Os rótulos dos lotes visíveis na grade. */
function lotesVisiveis(): string[] {
  return [...container.querySelectorAll("button")]
    .map((b) => (b.textContent ?? "").trim())
    .filter((t) => /^(01|02|45)LBR$/.test(t.replace(/\s+/g, "")));
}

beforeEach(() => {
  chamadas.length = 0;
  vi.clearAllMocks();
  montarFetch();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("VincularLotes", () => {
  it("carrega o universo pela rota do vínculo, com o código da etapa", async () => {
    await montar();
    expect(chamadas[0]?.metodo).toBe("GET");
    expect(chamadas[0]?.url).toContain("/api/apolo/empreendimentos/unidades/vinculo");
    expect(chamadas[0]?.url).toContain("enterpriseId=27");
    expect(chamadas[0]?.url).toContain("codigo=LBR");
    expect(container.textContent).toContain("3 lotes em Lagoa Bonita");
  });

  // ⚠️ A FAIXA É A MESMA RÉGUA DO SERVIDOR: a tela e o motor não podem discordar sobre o que
  // "do 01 ao 40" quer dizer.
  it("a faixa de lotes recorta a grade", async () => {
    await montar();
    expect(lotesVisiveis()).toHaveLength(3);
    await digitar("Faixa", "1-40");
    expect(lotesVisiveis()).toHaveLength(2);
  });

  it("faixa que não dá para ler avisa e não abre a lista inteira", async () => {
    await montar();
    await digitar("Faixa", "do começo ao fim");
    expect(container.textContent).toContain("Não entendi a faixa");
    expect(lotesVisiveis()).toHaveLength(0);
  });

  // ⚠️ A PRÉVIA VEM ANTES DE GRAVAR, SEMPRE.
  it("o botão de vincular só liga depois de conferir", async () => {
    await montar();
    expect(botao("Vincular a Condomínio").disabled).toBe(true);

    await clicar("Marcar quadra C");
    expect(botao("Vincular a Condomínio").disabled).toBe(true);

    await clicar("Conferir o que vai mudar");
    expect(chamadas.at(-1)?.corpo).toMatchObject({ acao: "previa", origem: "massa" });
    expect(container.textContent).toContain("O que vai mudar");
    expect(botao("Vincular a Condomínio").disabled).toBe(false);
  });

  // ⚠️ MEXER NA SELEÇÃO INVALIDA A PRÉVIA: confirmar a antiga seria confirmar outra coisa.
  it("mexer na seleção desliga o botão de novo", async () => {
    await montar();
    await clicar("Marcar quadra C");
    await clicar("Conferir o que vai mudar");
    expect(botao("Vincular a Condomínio").disabled).toBe(false);

    await digitar("Faixa", "1-2");
    expect(botao("Vincular a Condomínio").disabled).toBe(true);
  });

  it("aplicar manda os ids marcados e a origem do carimbo", async () => {
    await montar();
    await clicar("Marcar quadra C");
    await clicar("Conferir o que vai mudar");

    montarFetch({
      data: {
        avisos: [],
        gravadas: 2,
        movidas: 0,
        naoMovidas: 0,
        planilha: null,
        porParentesco: 1,
        recusas: [],
        semCarimbo: false,
        terrenos: 1,
      },
    });
    await clicar("Vincular a Condomínio");

    const envio = chamadas.find((c) => c.corpo?.acao === "aplicar");
    expect(envio?.corpo).toMatchObject({ categoriaId: CONDOMINIO, origem: "massa" });
    expect(envio?.corpo?.unidadeIds).toEqual(["u1", "u2", "u3"]);
    expect(container.textContent).toContain("O registro antigo do mesmo terreno foi junto");
  });

  // ⚠️ TIRAR TAMBÉM ALCANÇA O LOTEAMENTO INTEIRO: era um botão direto, e agora passa pela prévia.
  it("tirar a categoria passa pela mesma prévia e manda null", async () => {
    await montar();
    const escolha = [...container.querySelectorAll("select")].find((s) =>
      (s.textContent ?? "").includes("Tirar a categoria"),
    );
    if (!escolha) throw new Error("A escolha da ação não está na tela.");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(escolha, "tirar");
      escolha.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await clicar("Marcar quadra C");
    expect(botao("Tirar a categoria").disabled).toBe(true);

    await clicar("Conferir o que vai mudar");
    expect(chamadas.at(-1)?.corpo).toMatchObject({ acao: "previa", categoriaId: null });
    expect(botao("Tirar a categoria").disabled).toBe(false);
  });

  // ⚠️ A PLANILHA VAI COMO LINHAS, E EM BLOCOS (21/09/2026). Até essa data a tela mandava o texto
  // cru do CSV numa chamada só: acima de 500 linhas casadas a porta recusava tudo, com uma frase
  // mandando dividir "por quadra ou por faixa de lotes" — filtros que a aba da planilha não tem.
  // Quem lê o arquivo agora é `lerCsvDeVinculo`, a MESMA do servidor, no navegador.
  it("a aba da planilha manda as LINHAS lidas do arquivo, e não ids", async () => {
    await montar();
    await clicar("Subir planilha");
    await clicar("Usar o modelo de exemplo");
    await clicar("Conferir o que vai mudar");

    const envio = chamadas.at(-1);
    expect(envio?.corpo).toMatchObject({ acao: "previa", origem: "planilha" });
    expect(envio?.corpo).not.toHaveProperty("unidadeIds");
    expect(envio?.corpo).not.toHaveProperty("csv");

    const linhas = envio?.corpo?.linhas as Array<Record<string, unknown>>;
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas[0]).toMatchObject({ lote: expect.any(String), quadra: expect.any(String) });
  });
});
