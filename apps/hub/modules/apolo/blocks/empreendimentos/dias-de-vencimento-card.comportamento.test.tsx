// @vitest-environment jsdom

// O BLOCO "DIAS DE VENCIMENTO" DA ABA POLÍTICAS COMERCIAIS (Lucas, 02/10/2026).
//
// Trava o que a tela tem de fazer: mostrar o herdado do principal (e não um campo vazio que convida
// a copiar), avisar quando não há cadastro em lugar nenhum, não deixar entrar dia fora de 1 a 28 nem
// repetido, e salvar a lista inteira, em ordem.

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: async () => "tok",
}));

import { DiasDeVencimentoCard } from "./dias-de-vencimento-card";

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Dados = {
  doPai: null | number[];
  enterpriseId: string;
  paiEnterpriseId: null | string;
  proprios: null | number[];
  valendo: { cadastrado: boolean; dias: number[]; origem: null | string };
};

let alvo: HTMLDivElement;
let raiz: Root;
let resposta: Dados;
let enviados: unknown[];

beforeEach(() => {
  alvo = document.createElement("div");
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
  enviados = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        enviados.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ data: {} }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: resposta }), { status: 200 });
    }),
  );
});
afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
  vi.unstubAllGlobals();
});

async function montar() {
  await act(async () => {
    raiz.render(<DiasDeVencimentoCard codes={["VOC"]} enterpriseId="37" />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const textos = () =>
  [...alvo.querySelectorAll('[data-teste="lista-de-dias"] > span')].map(
    (s) => s.textContent?.trim() ?? "",
  );

function digitar(valor: string) {
  const campo = alvo.querySelector<HTMLInputElement>('[aria-label="Novo dia de vencimento"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const adicionar = () => alvo.querySelector<HTMLButtonElement>('[aria-label="Adicionar o dia"]')!;

describe("o bloco dos dias de vencimento", () => {
  it("o filho sem cadastro mostra o que herda do principal, sem o aviso de 'não cadastrado'", async () => {
    resposta = {
      doPai: [25],
      enterpriseId: "37",
      paiEnterpriseId: "35",
      proprios: null,
      valendo: { cadastrado: true, dias: [25], origem: "pai" },
    };
    await montar();
    expect(textos()).toContain("dia 25");
    expect(alvo.textContent).not.toContain("não cadastrado");
  });

  it("sem cadastro em lugar nenhum: mostra 10 e 20 e o aviso", async () => {
    resposta = {
      doPai: null,
      enterpriseId: "37",
      paiEnterpriseId: "35",
      proprios: null,
      valendo: { cadastrado: false, dias: [10, 20], origem: null },
    };
    await montar();
    expect(textos()).toEqual(expect.arrayContaining(["dia 10", "dia 20", "não cadastrado"]));
  });

  it("não deixa adicionar dia fora de 1 a 28 nem repetido, e salva a lista em ordem", async () => {
    resposta = {
      doPai: null,
      enterpriseId: "37",
      paiEnterpriseId: null,
      proprios: [15],
      valendo: { cadastrado: true, dias: [15], origem: "filho" },
    };
    await montar();

    digitar("31");
    expect(adicionar().disabled).toBe(true);
    digitar("0");
    expect(adicionar().disabled).toBe(true);
    digitar("15");
    expect(adicionar().disabled).toBe(true);

    digitar("5");
    expect(adicionar().disabled).toBe(false);
    act(() => {
      adicionar().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(textos().filter((t) => t.startsWith("dia"))).toEqual(["dia 5", "dia 15"]);

    const salvar = alvo.querySelector<HTMLButtonElement>('[aria-label="Salvar os dias"]')!;
    await act(async () => {
      salvar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(enviados).toEqual([{ codes: ["VOC"], dias: [5, 15], enterpriseId: "37" }]);
  });

  it("tirar o último dia e salvar manda nulo (volta a herdar)", async () => {
    resposta = {
      doPai: [25],
      enterpriseId: "37",
      paiEnterpriseId: "35",
      proprios: [5],
      valendo: { cadastrado: true, dias: [5], origem: "filho" },
    };
    await montar();
    act(() => {
      alvo
        .querySelector('[aria-label="Remover o dia 5"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // O herdado reaparece esmaecido assim que a lista própria fica vazia.
    expect(textos()).toContain("dia 25");
    await act(async () => {
      alvo
        .querySelector('[aria-label="Salvar os dias"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(enviados).toEqual([{ codes: ["VOC"], dias: null, enterpriseId: "37" }]);
  });
});
