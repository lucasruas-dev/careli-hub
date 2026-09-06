// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  dataEscrita,
  PRAZO_PADRAO_DA_PROPOSTA,
  PRAZOS_DA_PROPOSTA,
} from "@/lib/hercules/proposta";
import { vencimentoEmDias } from "@/lib/hercules/reserva";

// OS TRÊS DEFEITOS DA MODAL DE PROPOSTA, TRAVADOS.
//
// ⚠️ POR QUE UM TESTE DE TELA, E NÃO DE LIB. Os três são de COMPORTAMENTO da modal, e nenhum
// aparece numa função pura: um é a árvore que troca de ramo e mata o simulador, outro é a régua que
// falta antes de a lista de compradores existir, o terceiro é um ouvinte de teclado que dispara no
// meio de um POST. Testar a lib de baixo passaria nos três com o bug em pé.
//
// ⚠️ ESTE É O PRIMEIRO TESTE DE COMPONENTE DO REPO, e por isso ele monta o React na mão. Duas
// ginásticas explicam o que parece firula:
//
//  1. `globalThis.React` — o vitest.config não tem plugin de React, então o esbuild compila o JSX
//     no formato CLÁSSICO (`React.createElement`) e nenhum arquivo do app importa `React` por nome.
//     Publicar o namespace no global é o que faz o componente real renderizar sem tocar na config
//     compartilhada (mexer nela mudaria a compilação de TODOS os testes do hub).
//  2. `IS_REACT_ACT_ENVIRONMENT` — sem ele o `act` avisa a cada render que o ambiente não o suporta.
//
// ⚠️ O SIMULADOR É DUBLÊ, DE PROPÓSITO. O de verdade tem cockpit, planos e composições próprias;
// aqui o que importa é UMA coisa: ele tem estado local, e esse estado tem que sobreviver ao
// "Voltar". O dublê é um campo de texto com `useState` — se a modal desmontar o filho, o campo
// volta vazio, que é exatamente o defeito.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Os dados fixos precisam existir ANTES dos imports, porque a fábrica do `vi.mock` roda na hora em
 * que o módulo mockado é importado — antes do corpo deste arquivo. Sem `vi.hoisted` a constante
 * ainda estaria na zona morta e o dublê explodiria ao montar.
 */
const fixo = vi.hoisted(() => {
  const daqui30Dias = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return {
    condicoes: {
      anuaisQuantidade: 0,
      anuaisValor: 0,
      diaDeVencimento: 10,
      entradaValor: 20_000,
      entradaVezes: 2,
      parcela: 1_000,
      parcelasMensais: 120,
      planoNome: "PRICE 120x",
      primeiraParcelaEm: daqui30Dias,
      valorNegociado: 200_000,
    },
    daqui30Dias,
  };
});

vi.mock("./SimuladorDeProposta", async () => {
  const react = await import("react");
  return {
    SimuladorDeProposta: ({
      aoMudarCondicoes,
    }: {
      aoMudarCondicoes?: (condicoes: unknown) => void;
    }) => {
      const [rascunho, setRascunho] = react.useState("");
      react.useEffect(() => {
        aoMudarCondicoes?.(fixo.condicoes);
      }, [aoMudarCondicoes]);
      return react.createElement("input", {
        "data-teste": "rascunho-do-simulador",
        onChange: (e: { target: { value: string } }) => setRascunho(e.target.value),
        value: rascunho,
      });
    },
  };
});

// ⚠️ SÓ `montarCronograma` É DUBLÊ, E O RESTO DO MÓDULO É O DE VERDADE. Ele é o motor de
// amortização inteiro e tem os próprios testes (`cronograma.test.ts`); aqui só precisa devolver uma
// série qualquer para o botão "Gerar proposta" deixar de ser impossível. O `importOriginal` não é
// capricho: `proposta-na-tela.ts` importa `repartirEmPartesIguais` daqui, e um mock cego derruba a
// divisão de participações — que é justamente o que o portão faz ao adicionar proponente.
vi.mock("@/lib/hercules/cronograma", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  montarCronograma: () => ({
    anuais: [],
    entrada: [
      { numero: 1, total: 2, valor: 10_000, vencimento: fixo.daqui30Dias },
      { numero: 2, total: 2, valor: 10_000, vencimento: fixo.daqui30Dias },
    ],
    mensais: [{ numero: 1, total: 120, valor: 1_000, vencimento: fixo.daqui30Dias }],
    reajustes: [
      {
        ate: fixo.daqui30Dias,
        ciclo: 1,
        de: fixo.daqui30Dias,
        parcelaFinal: 120,
        parcelaInicial: 1,
        temIpca: false,
        valor: 1_000,
      },
    ],
    totais: {
      anuais: 0,
      entrada: 20_000,
      financiado: 180_000,
      geral: 200_000,
      mensais: 180_000,
    },
  }),
}));

const { ModalDeProposta } = await import("./ModalDeProposta");

/** O CPF do titular, cru como o GET entrega. Válido de verdade — `cpfValido` confere o dígito. */
const CPF_DO_TITULAR = "52998224725";

const portao = {
  credenciamento: { credenciado: true, desde: "2026-01-10", etapa: null, motivo: null },
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
    titular: { cpf: CPF_DO_TITULAR, nome: "João da Silva", telefone: "62999990000" },
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

/** Responde ao GET do portão; o POST cada teste arma como precisa. */
function fetchDoPortao(aoPostar?: () => Promise<{ corpo: string; ok: boolean }>) {
  return vi.fn(async (_url: string, opcoes?: { method?: string }) => {
    if (opcoes?.method === "POST") {
      const r = aoPostar
        ? await aoPostar()
        : { corpo: JSON.stringify({ data: { avisos: [], codigo: "PRP-1" } }), ok: true };
      return { ok: r.ok, text: async () => r.corpo };
    }
    return { ok: true, text: async () => JSON.stringify({ data: portao }) };
  });
}

/** O clique como o React o recebe: evento borbulhando até a raiz, dentro de `act`. */
function clicar(elemento: Element) {
  act(() => {
    elemento.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function botao(texto: string): HTMLButtonElement {
  const achado = [...alvo.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  );
  if (!achado) throw new Error(`Botão "${texto}" não está na tela.`);
  return achado;
}

/** Monta a modal e espera o GET do portão pousar. */
async function abrir(aoFechar = vi.fn(), aoGerar = vi.fn()) {
  await act(async () => {
    raiz.render(<ModalDeProposta onFechar={aoFechar} onGerada={aoGerar} unidade={unidade} />);
  });
  return { aoFechar, aoGerar };
}

beforeEach(() => {
  alvo = document.createElement("div");
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
  vi.stubGlobal("fetch", fetchDoPortao());
});

afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
  vi.unstubAllGlobals();
});


// ATÉ QUANDO A PROPOSTA VALE.
//
// ⚠️ O RELÓGIO É CONGELADO, E SÓ ELE. `vencimentoEmDias` responde em função de "hoje", e um teste
// que calcula o esperado depois do clique erraria na virada da meia-noite de Brasília — uma falha
// que aparece uma vez por ano, de madrugada, e some quando alguém vai olhar. `toFake: ["Date"]`
// deixa `setTimeout` e o scheduler do React reais: falsificá-los junto trava o `act` esperando um
// tempo que ninguém adianta.
describe("até quando a proposta vale", () => {
  beforeEach(() => {
    // O instante REAL, congelado: a primeira parcela do dublê é "daqui a 30 dias" de verdade, e
    // mover o relógio para uma data inventada faria a régua recusá-la por estar no passado.
    vi.useFakeTimers({ now: new Date(), toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** O que a tela promete para um prazo — "11/09/2026", pela mesma conta da reserva. */
  const dataDe = (dias: number) => dataEscrita(vencimentoEmDias(new Date().toISOString(), dias));

  it("oferece os prazos da lib com o padrão já marcado", async () => {
    await abrir();
    clicar(botao("Montar as condições"));

    // ⚠️ A LISTA É LIDA DA LIB, e não escrita à mão aqui. Um `[3, 5, 7, 10]` no teste passaria a
    // aprovar a tela velha no dia em que o Lucas trocar os prazos: os dois lados têm que sair da
    // MESMA constante para o teste ter alguma opinião sobre a tela.
    expect(PRAZOS_DA_PROPOSTA.map((d) => botao(`${d} dias`).getAttribute("aria-pressed"))).toEqual(
      PRAZOS_DA_PROPOSTA.map((d) => String(d === PRAZO_PADRAO_DA_PROPOSTA)),
    );
    expect(alvo.textContent).toContain(`Vence em ${dataDe(PRAZO_PADRAO_DA_PROPOSTA)}`);
  });

  it("manda no POST a data do prazo escolhido, e não a do padrão", async () => {
    const enviados: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, opcoes?: { body?: string; method?: string }) => {
        if (opcoes?.method === "POST") {
          enviados.push(String(opcoes.body ?? ""));
          return {
            ok: true,
            text: async () => JSON.stringify({ data: { avisos: [], codigo: "PRP-9" } }),
          };
        }
        return { ok: true, text: async () => JSON.stringify({ data: portao }) };
      }),
    );

    await abrir();
    clicar(botao("Montar as condições"));
    clicar(botao("3 dias"));

    expect(botao("3 dias").getAttribute("aria-pressed")).toBe("true");
    expect(botao(`${PRAZO_PADRAO_DA_PROPOSTA} dias`).getAttribute("aria-pressed")).toBe("false");
    expect(alvo.textContent).toContain(`Vence em ${dataDe(3)}`);

    await act(async () => {
      clicar(botao("Gerar proposta"));
    });

    // ⚠️ O QUE VAI NO CORPO É O NÚMERO DE DIAS, NÃO A DATA. Com a data pronta, quem decidia o
    // vencimento era o relógio do NAVEGADOR: abrir a modal às 23h55 e enviar às 00h05 gravava o
    // prazo contado a partir de ontem, e o chip de 3 dias entregava dois e pouco ao cliente. O
    // servidor conta com o relógio dele; a data ao lado dos chips é prévia.
    const corpo = JSON.parse(enviados[0] ?? "{}") as {
      prazoEmDias?: number;
      validadeEm?: string;
    };
    expect(corpo.prazoEmDias).toBe(3);
    expect(corpo.validadeEm).toBeUndefined();
  });
});
