// @vitest-environment jsdom

// O BEM E A PERMUTA NO CORPO DO PEDIDO (23/09/2026).
//
// O simulador já sabe digitar o bem (`SimuladorDeProposta.permuta.comportamento.test.tsx`); o que
// se prova aqui é o metro final do caminho: o que a tela mostra chega ao POST que a rota grava.
//
// ⚠️ O SIMULADOR É DUBLÊ, como no irmão `ModalDeProposta.comportamento.test.tsx`. O de verdade tem
// cockpit, planos e composições próprias, e já está travado no arquivo dele; aqui o que importa é
// uma coisa só: a modal recebe `bensEPermutas` em `CondicoesDaProposta` e não deixa a lista pelo
// caminho.
//
// ⚠️ E A NOTA. Bem entregue é exceção comercial: a caixa de justificativa passa a abrir por causa
// dele, e o botão não gera sem ela. O porquê está escrito em `ModalDeProposta.tsx`, na definição
// de `precisaDeNota`.

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BemOuPermuta } from "@/lib/hercules/bens-e-permutas";

(globalThis as unknown as { React: typeof React }).React = React;
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const fixo = vi.hoisted(() => {
  const daqui30Dias = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return {
    /** O carro e o lote do exemplo do Lucas, um em cada `entraComo`. */
    bens: [
      {
        descricao: "Ford Ka 2019 placa ABC1D23",
        entraComo: "entrada",
        tipo: "bem",
        valor: 80_000,
      },
      {
        descricao: "Lote 12 da quadra 4 em Anápolis",
        entraComo: "abatimento",
        tipo: "permuta",
        valor: 20_000,
      },
    ],
    condicoes: {
      ajuste: null,
      anuaisQuantidade: 0,
      anuaisValor: 0,
      bensEPermutas: null as null | unknown[],
      descontoDoPlanoPercentual: 0,
      diaDeVencimento: 10,
      entradaDatas: null,
      entradaParcelas: null,
      // ⚠️ R$ 20.000 EM DINHEIRO, que é o piso de 10% do lote SEM contar o bem: assim a régua da
      // entrada mínima passa nos dois casos e o que este arquivo mede é só o caminho da lista.
      entradaValor: 20_000,
      entradaVezes: 2,
      parcela: 1_000,
      parcelasMensais: 120,
      planoId: null as null | string,
      planoNome: "PRICE 120x",
      premissaAlterada: false,
      primeiraParcelaEm: daqui30Dias,
      valorNegociado: 200_000,
    },
    daqui30Dias,
  };
});

/** Troca o que o dublê do simulador vai anunciar na próxima montagem. */
function comBens(bens: null | unknown[]) {
  fixo.condicoes.bensEPermutas = bens;
}

vi.mock("./SimuladorDeProposta", async () => {
  const react = await import("react");
  return {
    SimuladorDeProposta: ({
      aoMudarCondicoes,
    }: {
      aoMudarCondicoes?: (condicoes: unknown) => void;
    }) => {
      react.useEffect(() => {
        aoMudarCondicoes?.(fixo.condicoes);
      }, [aoMudarCondicoes]);
      return react.createElement("div", { "data-teste": "simulador" });
    },
  };
});

// Só o motor de amortização é dublê: ele tem os próprios testes e aqui só precisa devolver uma
// série para o botão deixar de ser impossível. `importOriginal` mantém o resto do módulo real.
vi.mock("@/lib/hercules/cronograma", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  montarCronograma: () => ({
    anuais: [],
    entrada: [
      { numero: 1, total: 2, valor: 10_000, vencimento: fixo.daqui30Dias },
      { numero: 2, total: 2, valor: 10_000, vencimento: fixo.daqui30Dias },
    ],
    mensais: [
      { numero: 1, total: 120, valor: 1_000, vencimento: fixo.daqui30Dias },
    ],
    reajustes: [],
    totais: {
      anuais: 0,
      bensEPermutas: 0,
      entrada: 20_000,
      financiado: 180_000,
      geral: 200_000,
      mensais: 180_000,
    },
  }),
}));

const { ModalDeProposta } = await import("./ModalDeProposta");

const CPF_DO_TITULAR = "52998224725";

const portao = {
  credenciamento: {
    credenciado: true,
    desde: "2026-01-10",
    etapa: null,
    motivo: null,
  },
  entradaMinimaPercentual: 10,
  planos: [
    {
      entradaPercentual: 10,
      indiceCorrecao: "IPCA",
      jurosConvencao: "nominal",
      jurosPeriodicidade: "mensal",
      jurosTaxa: 0.008,
      nome: "PRICE 120x",
      parcelas: 120,
      sistemaAmortizacao: "PRICE",
      slot: null,
    },
  ],
  reserva: {
    codigo: "RES-0001",
    corretor: { id: "c1", nome: "Corretor Teste" },
    criadoEm: "2026-09-01T12:00:00.000Z",
    id: "reserva-1",
    imobiliaria: { id: "i1", nome: "Imobiliária Teste" },
    titular: {
      cpf: CPF_DO_TITULAR,
      nome: "João da Silva",
      telefone: "62999990000",
    },
    validadeEm: null,
  },
  unidade: {
    enterpriseId: "emp-1",
    id: "unidade-1",
    nome: "Q1 L2",
    preco: 200_000,
    produto: "Garden",
  },
};

const unidade = { id: "unidade-1", nome: "Q1 L2", produto: "Garden" };

let alvo: HTMLDivElement;
let raiz: Root;
/** O corpo cru de cada POST que a modal disparou. */
let enviados: string[] = [];

function clicar(elemento: Element) {
  act(() => {
    elemento.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function digitar(campo: HTMLTextAreaElement, texto: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function botao(texto: string): HTMLButtonElement {
  const achado = [...alvo.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  );
  if (!achado) throw new Error(`Botão "${texto}" não está na tela.`);
  return achado;
}

async function abrir() {
  await act(async () => {
    raiz.render(
      <ModalDeProposta
        onFechar={vi.fn()}
        onGerada={vi.fn()}
        unidade={unidade}
      />,
    );
  });
}

/** Abre, vai para as condições e clica em Gerar. Devolve o corpo do POST, quando houve POST. */
async function gerar(): Promise<null | Record<string, unknown>> {
  await abrir();
  clicar(botao("Montar as condições"));
  await act(async () => {
    clicar(botao("Gerar proposta"));
  });
  return enviados.length > 0
    ? (JSON.parse(enviados[enviados.length - 1] ?? "{}") as Record<
        string,
        unknown
      >)
    : null;
}

beforeEach(() => {
  alvo = document.createElement("div");
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
  enviados = [];
  comBens(null);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, opcoes?: { body?: string; method?: string }) => {
      if (opcoes?.method === "POST") {
        enviados.push(String(opcoes.body ?? ""));
        return {
          ok: true,
          text: async () =>
            JSON.stringify({ data: { avisos: [], codigo: "PRP-7" } }),
        };
      }
      return { ok: true, text: async () => JSON.stringify({ data: portao }) };
    }),
  );
});

afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
  vi.unstubAllGlobals();
});

describe("a lista de bens e permutas chega ao POST", () => {
  it("⚠️ vai inteira, com tipo, valor, descrição e onde entra", async () => {
    comBens(fixo.bens);
    await abrir();
    clicar(botao("Montar as condições"));
    digitar(
      alvo.querySelector<HTMLTextAreaElement>("#nota-do-ajuste")!,
      "Carro avaliado pela tabela FIPE com o Northon.",
    );
    await act(async () => {
      clicar(botao("Gerar proposta"));
    });

    const corpo = JSON.parse(enviados[0] ?? "{}") as {
      bensEPermutas?: BemOuPermuta[];
    };
    expect(corpo.bensEPermutas).toEqual(fixo.bens);
  });

  it("sem bem nenhum o campo sobe nulo, e a proposta de sempre não muda", async () => {
    const corpo = await gerar();
    expect(corpo?.bensEPermutas ?? null).toBeNull();
  });
});

describe("⚠️ bem entregue exige a nota de justificativa", () => {
  // A decisão e o porquê estão em `ModalDeProposta.tsx`, em `precisaDeNota`: o valor de um carro
  // não tem tabela por trás, e a nota é o único lugar onde fica escrito quem avaliou.
  it("a caixa abre por causa do bem, mesmo sem desconto e sem premissa alterada", async () => {
    comBens(fixo.bens);
    await abrir();
    clicar(botao("Montar as condições"));

    expect(alvo.querySelector("#nota-do-ajuste")).toBeTruthy();
    expect(alvo.textContent ?? "").toContain("Por que o bem entra na conta?");
  });

  it("e sem a nota escrita o clique NÃO manda nada ao servidor", async () => {
    comBens(fixo.bens);
    const corpo = await gerar();

    expect(corpo).toBeNull();
    expect(alvo.textContent ?? "").toContain(
      "Escreva o motivo da alteração antes de gerar a proposta.",
    );
  });

  it("escrita a nota, ela sobe em `observacao` junto com a lista", async () => {
    comBens(fixo.bens);
    await abrir();
    clicar(botao("Montar as condições"));
    digitar(
      alvo.querySelector<HTMLTextAreaElement>("#nota-do-ajuste")!,
      "Ford Ka avaliado em R$ 80.000 pela FIPE, aprovado pelo Northon.",
    );
    await act(async () => {
      clicar(botao("Gerar proposta"));
    });

    const corpo = JSON.parse(enviados[0] ?? "{}") as { observacao?: string };
    expect(corpo.observacao).toBe(
      "Ford Ka avaliado em R$ 80.000 pela FIPE, aprovado pelo Northon.",
    );
  });

  it("sem bem nenhum a caixa continua fechada, como sempre esteve", async () => {
    await abrir();
    clicar(botao("Montar as condições"));
    expect(alvo.querySelector("#nota-do-ajuste")).toBeNull();
  });
});
