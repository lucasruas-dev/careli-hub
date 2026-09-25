// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O CRONOGRAMA DA MODAL SAI DO PLANO ESCOLHIDO, E NÃO DO PRIMEIRO COM AQUELE NOME.
//
// ⚠️ AFIRMAÇÃO EM CAIXA ALTA: A MODAL CASAVA O PLANO POR NOME, QUE NÃO É CHAVE. A linha era
// `portao?.planos.find((p) => p.nome === condicoes?.planoNome)` (`ModalDeProposta.tsx:437-440`), e
// era dela que saía o cronograma que a tela desenha. A ROTA já parou de fazer isso em 22/09/2026 e
// casa por `planoId` (`escolherPlanoDaProposta`, em `app/api/incorporador/venda/proposta/
// route.ts:398-425), justamente porque o nome é texto que o cadastro edita. A modal ficou para trás.
//
// ⚠️ E OS NOMES SE REPETEM DE VERDADE, MEDIDO EM PRODUÇÃO (24/09/2026): `select enterprise_id,
// upper(btrim(nome)), count(*) from temis_planos group by 1,2 having count(*) > 1` devolve três
// pares, e um deles é o Jardim das Gerais (enterprise 40) com DOIS planos chamados NORMAL, um com
// índice IPCA_ANUAL e outro com POUPANCA. Hoje, no JDG, a tela pode desenhar o cronograma de um
// plano e o servidor gravar o do outro.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixo = vi.hoisted(() => {
  const daqui30Dias = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return {
    condicoes: {
      ajuste: null,
      anuaisQuantidade: 0,
      anuaisValor: 0,
      bensEPermutas: null,
      descontoDoPlanoPercentual: 0,
      diaDeVencimento: 10,
      entradaDatas: null,
      entradaParcelas: null,
      entradaValor: 13_840,
      entradaVezes: 1,
      parcela: 2_595,
      parcelasMensais: 48,
      premissaAlterada: false,
      // ⚠️ O ID DO SEGUNDO NORMAL, o da POUPANÇA. O nome é o mesmo dos dois.
      planoId: "plano-poupanca",
      planoNome: "NORMAL",
      primeiraParcelaEm: daqui30Dias,
      valorNegociado: 138_401,
    },
    daqui30Dias,
  };
});

// ⚠️ O SIMULADOR É DUBLÊ, mas ele RENDERIZA A PRÉVIA. É dentro dela que mora a tabela "Reajuste da
// parcela" — o painel que o print da Nívea mostra —, e é ela que este teste lê.
vi.mock("./SimuladorDeProposta", async () => {
  const react = await import("react");
  return {
    SimuladorDeProposta: ({
      aoMudarCondicoes,
      previa,
    }: {
      aoMudarCondicoes?: (condicoes: unknown) => void;
      previa?: React.ReactNode;
    }) => {
      react.useEffect(() => {
        aoMudarCondicoes?.(fixo.condicoes);
      }, [aoMudarCondicoes]);
      return react.createElement("div", { "data-teste": "simulador" }, previa);
    },
  };
});

const { ModalDeProposta } = await import("./ModalDeProposta");

const CPF_DO_TITULAR = "52998224725";

/** O molde dos dois NORMAL: SACOC com juros, que é o que abre os degraus anuais. */
const NORMAL = {
  entradaPercentual: 10,
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "mensal",
  jurosTaxa: 0.7207,
  nome: "NORMAL",
  parcelas: 48,
  sistemaAmortizacao: "sacoc",
  slot: null,
};

const portao = {
  credenciamento: { credenciado: true, desde: "2026-01-10", etapa: null, motivo: null },
  entradaMinimaPercentual: 10,
  faixasDePrazo: [],
  planos: [
    // O PRIMEIRO da lista é o do IPCA — o que o `find` por nome escolhia.
    { ...NORMAL, id: "plano-ipca", indiceCorrecao: "IPCA_ANUAL" },
    { ...NORMAL, id: "plano-poupanca", indiceCorrecao: "POUPANCA" },
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
    enterpriseId: "emp-40",
    id: "unidade-1",
    nome: "Q1 L2",
    preco: 138_401,
    produto: "Jardim das Gerais",
  },
};

const unidade = { id: "unidade-1", nome: "Q1 L2", produto: "Jardim das Gerais" };

let alvo: HTMLDivElement;
let raiz: Root;

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

beforeEach(() => {
  alvo = document.createElement("div");
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({ data: portao }) })),
  );
});

afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
  vi.unstubAllGlobals();
});

describe("dois planos de mesmo nome no mesmo produto", () => {
  it("o cronograma da modal usa o do ID escolhido, e não o primeiro da lista", async () => {
    await act(async () => {
      raiz.render(
        <ModalDeProposta onFechar={vi.fn()} onGerada={vi.fn()} unidade={unidade} />,
      );
    });
    clicar(botao("Montar as condições"));
    await act(async () => {
      await Promise.resolve();
    });

    // A prévia existe: o cronograma foi montado.
    expect(alvo.textContent).toContain("Reajuste da parcela");
    // E ele saiu do plano da POUPANÇA, que é o do id escolhido.
    expect(alvo.textContent).toContain("poupança anual");
    expect(alvo.textContent).not.toContain("IPCA");
  });
});
