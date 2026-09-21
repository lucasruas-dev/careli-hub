// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A MINUTA DA CATEGORIA, NA TELA — a outra metade do "também as minutas".
//
// Lucas (21/09/2026): *"preciso garantir que consigamos vincular os anexos por filho, categoria.
// também as minutas"*.
//
// ⚠️ O DEGRAU EXISTIA E NÃO TINHA PORTA. A cadeia do contrato lê `temis_categorias.minuta_id` como
// PRIMEIRO degrau (`lib/temis/cadeia-do-contrato.ts`) e a coluna existe desde a 0140. Medido em
// produção em 21/09/2026: 6 categorias, ZERO com `minuta_id` preenchido, 11 minutas — e
// `editarCategoria` tinha lista branca de campos que não incluía `minuta_id`, ou seja, não havia
// como preencher. O que estava pronto era a HERANÇA (a categoria sem minuta usa a de cima); o que o
// Lucas pediu, APONTAR uma minuta, continuava sem tela.
//
// ⚠️ E VAZIO NÃO É "SEM CONTRATO", É "HERDA". Campo em branco numa tela de herança é lido como "não
// há regra", e aí o operador cadastra uma cópia "por segurança" — a partir daí a categoria para de
// seguir o produto e ninguém percebe, porque no dia em que foi feita a cópia era igual.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: async () => "token",
}));

const { CategoriasTab } = await import("./categorias-tab");

const CONDOMINIO = "cccccccc-0000-4000-8000-000000000001";
const MINUTA = "99999999-9999-4999-8999-000000000035";

const DADOS = {
  categorias: [
    {
      categoriaPaiId: null,
      id: CONDOMINIO,
      minuta: null as null | { id: string; nome: string; versao: null | number },
      nome: "Condomínio",
      ordemHerdada: null,
      ordemPropria: null,
      unidades: 400,
    },
  ],
  divergenciaDoEmpreendimento: null,
  minutasDisponiveis: [{ id: MINUTA, nome: "LAB-COMPRA-E-VENDA", versao: 2 }],
};

type Chamada = { corpo: null | Record<string, unknown>; metodo: string; url: string };

const chamadas: Chamada[] = [];

function montarFetch() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: { body?: string; method?: string }) => {
    const metodo = init?.method ?? "GET";
    chamadas.push({
      corpo: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      metodo,
      url: String(url),
    });
    return { json: async () => ({ data: DADOS }), ok: true } as unknown as Response;
  }) as unknown as typeof fetch;
}

let container: HTMLDivElement;
let root: Root;

async function montar() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<CategoriasTab codigo="LBF" enterpriseId="group:Lagoa Bonita" name="Lagoa Bonita" />);
  });
}

const seletorDaMinuta = (): HTMLSelectElement => {
  const achado = [...container.querySelectorAll("select")].find((s) =>
    [...s.options].some((o) => o.textContent?.includes("LAB-COMPRA-E-VENDA")),
  );
  if (!achado) throw new Error("O seletor de minuta não está na linha da categoria.");
  return achado;
};

beforeEach(() => {
  chamadas.length = 0;
  montarFetch();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("o vínculo categoria → minuta", () => {
  it("a linha da categoria oferece as minutas publicadas, com a versão", async () => {
    await montar();
    const opcoes = [...seletorDaMinuta().options].map((o) => o.textContent);
    // ⚠️ A VERSÃO VAI NO RÓTULO. Duas versões do mesmo nome são a coisa mais comum nesta tabela, e
    // escolher "a minuta" sem saber qual delas é exatamente o erro que a publicação cria.
    expect(opcoes).toEqual(["Herda o modelo do empreendimento", "LAB-COMPRA-E-VENDA · v2"]);
  });

  it("sem minuta própria, a opção escolhida DIZ que herda", async () => {
    await montar();
    expect(seletorDaMinuta().value).toBe("");
    expect(seletorDaMinuta().selectedOptions[0]?.textContent).toContain("Herda");
  });

  it("escolher uma minuta manda PATCH com o id dela, na categoria certa", async () => {
    await montar();
    chamadas.length = 0;

    await act(async () => {
      const campo = seletorDaMinuta();
      campo.value = MINUTA;
      campo.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const envio = chamadas.find((c) => c.metodo === "PATCH");
    expect(envio?.corpo).toEqual({ minutaId: MINUTA });
    expect(envio?.url).toContain(`id=${CONDOMINIO}`);
    // ⚠️ O CÓDIGO VIAJA JUNTO: a ficha consolidada manda `group:Lagoa Bonita`, que é rótulo e não
    // chave, e sem o código a rota não acha a linha — o update casava zero linhas SEM ERRO e a tela
    // dizia "salvo" à toa.
    expect(envio?.url).toContain("codigo=LBF");
  });

  it("voltar para 'herda' manda null, e não uma string vazia", async () => {
    DADOS.categorias[0]!.minuta = { id: MINUTA, nome: "LAB-COMPRA-E-VENDA", versao: 2 };
    await montar();
    chamadas.length = 0;

    await act(async () => {
      const campo = seletorDaMinuta();
      campo.value = "";
      campo.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const envio = chamadas.find((c) => c.metodo === "PATCH");
    // `null` é a ordem explícita de limpar; ausente seria "não mexi na minuta".
    expect(envio?.corpo).toEqual({ minutaId: null });
    DADOS.categorias[0]!.minuta = null;
  });
});
