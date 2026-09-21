// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApoloEnterpriseUnit } from "@/lib/apolo/empreendimentos";

// A CATEGORIA NA FICHA DA UNIDADE — o caminho UNITÁRIO.
//
// ⚠️ O QUE ESTE ARQUIVO TRAVA:
//   • a unidade sem linha no Panteon não oferece o botão (não há o que vincular);
//   • a ficha chama a MESMA rota do vínculo em massa, com UM id e a origem "ficha";
//   • a prévia vem antes de salvar;
//   • RECUSA NÃO FECHA A JANELA: o operador precisa ler o motivo, senão descobriria no contrato.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const simulado = vi.hoisted(() => ({ getApoloAccessToken: vi.fn(async () => "token") }));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: () => simulado.getApoloAccessToken(),
}));

const { AcaoDeCategoria } = await import("./categoria-da-unidade");

const PANTEON_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const CONDOMINIO = "cat-condominio";

const UNIVERSO = {
  categorias: [{ enterpriseId: "31", id: CONDOMINIO, nome: "Condomínio" }],
  divisoes: [
    { codigo: "LAB", enterpriseId: "31", nome: "Lagoa Bonita", pai: true },
    { codigo: "LBR", enterpriseId: "27", nome: "Lagoa Bonita Residencial", pai: false },
  ],
  empreendimento: { ids: ["31", "27"], nome: "Lagoa Bonita" },
  semCarimbo: false,
  unidades: [
    {
      apartamento: "",
      categoriaId: null,
      codigo: "LBRC01",
      enterpriseId: "27",
      id: PANTEON_ID,
      lote: "01",
      quadra: "C",
      situacao: "disponivel",
      torre: "",
      vinculo: null,
    },
  ],
};

const PREVIA = {
  avisos: [],
  categorias: [
    {
      categoriaId: CONDOMINIO,
      nome: "Condomínio",
      previa: {
        ids: [PANTEON_ID, "gemea"],
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

const UNIDADE = {
  area: 300,
  block: "C",
  bucket: "disponivel",
  code: "LBRC01",
  enterpriseCode: "LBR",
  id: "c2x-1",
  kind: "lote",
  lot: "01",
  movement: null,
  panteonId: PANTEON_ID,
  price: 100000,
  registration: null,
  status: "Livre",
} as unknown as ApoloEnterpriseUnit;

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
let recarregou = 0;

async function montar(unidade: ApoloEnterpriseUnit = UNIDADE) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <AcaoDeCategoria
        codigo="LBR"
        enterpriseId="27"
        recarregar={() => {
          recarregou += 1;
        }}
        unidade={unidade}
      />,
    );
  });
}

function botao(texto: string): HTMLButtonElement {
  const achado = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === texto,
  );
  if (!achado) throw new Error(`Botão "${texto}" não está na tela.`);
  return achado as HTMLButtonElement;
}

async function clicar(texto: string) {
  await act(async () => {
    botao(texto).click();
  });
}

async function escolherCategoria(valor: string) {
  const campo = document.querySelector<HTMLSelectElement>("#categoria-da-unidade");
  if (!campo) throw new Error("O campo da categoria não está na tela.");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(campo, valor);
    campo.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  chamadas.length = 0;
  recarregou = 0;
  vi.clearAllMocks();
  montarFetch();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("AcaoDeCategoria", () => {
  // ⚠️ SEM LINHA NO PANTEON NÃO HÁ O QUE VINCULAR: a unidade nem existe no cadastro.
  it("a unidade sem cadastro no Panteon não oferece o botão", async () => {
    await montar({ ...UNIDADE, panteonId: null } as ApoloEnterpriseUnit);
    expect(container.querySelector("button")).toBeNull();
  });

  it("abre mostrando a divisão e a categoria de hoje", async () => {
    await montar();
    await clicar("Categoria");
    expect(chamadas[0]?.metodo).toBe("GET");
    expect(document.body.textContent).toContain("Lagoa Bonita Residencial · sem categoria");
  });

  it("salvar só liga depois de conferir, e manda UM id com a origem ficha", async () => {
    await montar();
    await clicar("Categoria");
    expect(botao("Salvar").disabled).toBe(true);

    await escolherCategoria(CONDOMINIO);
    expect(botao("Conferir").disabled).toBe(false);
    expect(botao("Salvar").disabled).toBe(true);

    await clicar("Conferir");
    expect(chamadas.at(-1)?.corpo).toMatchObject({
      acao: "previa",
      categoriaId: CONDOMINIO,
      origem: "ficha",
      unidadeIds: [PANTEON_ID],
    });
    expect(botao("Salvar").disabled).toBe(false);

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
    await clicar("Salvar");
    expect(chamadas.at(-1)?.corpo).toMatchObject({ acao: "aplicar", origem: "ficha" });
    expect(recarregou).toBe(1);
  });

  // ⚠️ RECUSA NÃO É SUCESSO: fechar a janela faria a tela parecer que deu certo.
  it("recusa do servidor mantém a janela aberta com o motivo", async () => {
    await montar();
    await clicar("Categoria");
    await escolherCategoria(CONDOMINIO);
    await clicar("Conferir");

    montarFetch({
      data: {
        avisos: [],
        gravadas: 0,
        movidas: 0,
        naoMovidas: 0,
        planilha: null,
        porParentesco: 0,
        recusas: [
          {
            motivo: "LBRC01 tem venda em andamento: mudar a divisão trocaria a minuta.",
            rotulo: "LBRC01",
            unidadeId: PANTEON_ID,
          },
        ],
        semCarimbo: false,
        terrenos: 0,
      },
    });
    await clicar("Salvar");

    expect(recarregou).toBe(0);
    expect(document.body.textContent).toContain("venda em andamento");
  });
});
