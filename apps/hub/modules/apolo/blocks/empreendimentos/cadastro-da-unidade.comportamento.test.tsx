// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApoloEnterpriseUnit } from "@/lib/apolo/empreendimentos";

// O CADASTRO DE UMA UNIDADE — a ficha do lote dentro da aba Unidades.
//
// ⚠️ O QUE ESTE ARQUIVO TRAVA:
//   • QUEM DIZ SE DÁ PARA EDITAR É O SERVIDOR: a tela pergunta (`acao: "modelo"`) e, na recusa,
//     trava os campos mostrando a frase dela. Uma régua escrita na tela diria a mesma coisa hoje e
//     passaria a mentir no dia em que o produto ganhasse dono;
//   • a gravação vai pela DIVISÃO da unidade (o pai é recusado pela porta do cadastro) e manda só o
//     campo que mudou.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const simulado = vi.hoisted(() => ({ getApoloAccessToken: vi.fn(async () => "token") }));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: () => simulado.getApoloAccessToken(),
}));

// Os anexos têm porta própria (a Têmis) e teste próprio: aqui eles só atrapalhariam a leitura.
vi.mock("./anexos-do-contrato", () => ({ AnexosDoContrato: () => null }));

const { CadastroDaUnidade } = await import("./cadastro-da-unidade");

const PANTEON_ID = "aaaaaaaa-0000-4000-8000-000000000001";

const UNIVERSO = {
  categorias: [],
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
      // ⚠️ A DIVISÃO DA UNIDADE, e não o produto da ficha: é ela que vai para a porta do cadastro.
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

const RECUSA_DA_CARGA =
  "Esta unidade veio do sistema anterior, e o cadastro dela ainda não é corrigido por aqui.";

type Chamada = { corpo: null | Record<string, unknown>; url: string };

const chamadas: Chamada[] = [];

/** `modelo` decide se a edição abre; o resto responde o que o teste pedir. */
function montarFetch(modelo: { erro?: string; ok: boolean }) {
  globalThis.fetch = vi.fn(async (url: unknown, init?: { body?: string; method?: string }) => {
    const corpo = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    chamadas.push({ corpo, url: String(url) });

    if (corpo?.acao === "modelo") {
      return {
        json: async () =>
          modelo.ok
            ? { data: { produto: { codigo: "LBR", nome: "Lagoa Bonita Residencial", tipoProduto: "loteamento" } } }
            : { error: modelo.erro ?? RECUSA_DA_CARGA },
        ok: modelo.ok,
      } as unknown as Response;
    }

    if (corpo?.acao === "atualizar") {
      return { json: async () => ({ data: { alterados: ["matricula"], avisos: {} } }), ok: true } as unknown as Response;
    }

    return { json: async () => ({ data: UNIVERSO }), ok: true } as unknown as Response;
  }) as unknown as typeof fetch;
}

let container: HTMLDivElement;
let root: Root;
let recarregou = 0;

async function montar() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <CadastroDaUnidade
        codigo="LBR"
        enterpriseId="31"
        recarregar={() => {
          recarregou += 1;
        }}
        unidade={UNIDADE}
      />,
    );
  });
}

function campo(id: string): HTMLInputElement {
  const achado = document.querySelector<HTMLInputElement>(`#${id}`);
  if (!achado) throw new Error(`O campo #${id} não está na tela.`);
  return achado;
}

async function escrever(id: string, valor: string) {
  const alvo = campo(id);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(alvo, valor);
    alvo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clicar(texto: string) {
  const achado = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === texto,
  );
  if (!achado) throw new Error(`Botão "${texto}" não está na tela.`);
  await act(async () => {
    (achado as HTMLButtonElement).click();
  });
}

beforeEach(() => {
  chamadas.length = 0;
  recarregou = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("CadastroDaUnidade", () => {
  it("o produto que a carga mantém trava os campos com a frase do servidor", async () => {
    montarFetch({ ok: false });
    await montar();

    expect(campo("cadastro-matricula").disabled).toBe(true);
    expect(container.textContent).toContain(RECUSA_DA_CARGA);
  });

  it("salva só o que mudou, pela divisão da unidade", async () => {
    montarFetch({ ok: true });
    await montar();

    expect(campo("cadastro-matricula").disabled).toBe(false);
    // A pergunta foi feita pela DIVISÃO (27), e não pelo produto da ficha (31).
    expect(chamadas.find((c) => c.corpo?.acao === "modelo")?.corpo).toMatchObject({
      enterpriseId: "27",
    });

    await escrever("cadastro-matricula", "12.345");
    await clicar("Salvar dados do lote");

    const gravou = chamadas.find((c) => c.corpo?.acao === "atualizar");
    expect(gravou?.corpo).toMatchObject({
      campos: { matricula: "12.345" },
      enterpriseId: "27",
      unidadeId: PANTEON_ID,
    });
    // Só o campo mexido viaja: área e preço não entram no corpo.
    expect(Object.keys((gravou?.corpo?.campos ?? {}) as Record<string, unknown>)).toEqual([
      "matricula",
    ]);
    expect(recarregou).toBe(1);
  });
});
