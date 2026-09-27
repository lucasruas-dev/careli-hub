// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A TELA NÃO PODE MENTIR: TRÊS ESTADOS DO SELO, E O DO MEIO NASCEU EM 26/09/2026.
//
// Lucas (26/09/2026): *"pode deixar os coordenadores emitirem proposta sem a cad esta credenciada.
// ela pode estar em validacao ou em qualquer outro estagio"*. Sobre o print da CAD do MATEUS COTTA
// SACCHETTO em `validacao` (lote EIRETAMA-14, Aldeia das Cachoeiras das Pedras, empreendimento 42):
// *"essa devia passar"*.
//
// ⚠️ O RISCO QUE ESTE ARQUIVO TRAVA É A TELA MENTIR. Se o afrouxamento tivesse virado
// `credenciado: true`, o selo passaria a escrever "CAD credenciada neste empreendimento / A reserva
// pode virar proposta" em cima de uma CAD em validação — e o coordenador deixaria de saber que o
// cadastro ainda está com a coordenação. A decisão foi outra: `credenciado` continua dizendo a
// verdade sobre a CAD, `podeGerarProposta` decide a porta, e a tela mostra OS DOIS.
//
// ⚠️ E O RODAPÉ É METADE DA MENTIRA. A frase "Sem a CAD credenciada neste empreendimento a proposta
// não pode ser gerada" embaixo de um botão ACESO diz ao coordenador o contrário do que a rota
// responde. Ela só pode aparecer para quem está de fato barrado.
//
// O andaime (React no global, `IS_REACT_ACT_ENVIRONMENT`, simulador dublê) é o mesmo de
// `ModalDeProposta.comportamento.test.tsx`, e está explicado lá.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./SimuladorDeProposta", async () => {
  const react = await import("react");
  return {
    SimuladorDeProposta: () => react.createElement("div", null, "simulador"),
  };
});

const { ModalDeProposta } = await import("./ModalDeProposta");

const CPF_DO_TITULAR = "52998224725";

/**
 * O credenciamento como o GET o entrega — a MESMA forma de `CredenciamentoNaTela`.
 *
 * ⚠️ NOMEADO, e não inferido de um dos fixtures: `typeof CREDENCIADA` daria `motivo: null` e o
 * fixture com frase nem compilaria. O tipo é o CONTRATO da rota, e os fixtures são casos dele.
 */
type CredenciamentoNoGet = {
  credenciado: boolean;
  desde: null | string;
  etapa: null | string;
  motivo: null | string;
  podeGerarProposta: boolean;
};

/** O portão do GET, com o credenciamento que cada teste pedir. */
function portaoCom(credenciamento: CredenciamentoNoGet) {
  return {
    credenciamento,
    entradaMinimaPercentual: 10,
    planos: [
      {
        entradaPercentual: 10,
        id: "plano-1",
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
      codigo: "RES-0042",
      corretor: null,
      criadoEm: "2026-09-26T12:00:00.000Z",
      id: "reserva-1",
      imobiliaria: null,
      titular: {
        cpf: CPF_DO_TITULAR,
        nome: "MATEUS COTTA SACCHETTO",
        telefone: "62999990000",
      },
      validadeEm: null,
    },
    unidade: {
      enterpriseId: "42",
      id: "unidade-1",
      nome: "EIRETAMA 14",
      preco: 200_000,
      produto: "Aldeia das Cachoeiras das Pedras",
    },
  };
}

/** A CAD em validação: a porta abre, e a CAD continua não credenciada. O estado do print. */
const EM_VALIDACAO: CredenciamentoNoGet = {
  credenciado: false,
  desde: "2026-09-26T17:11:31.401Z",
  etapa: "validacao",
  motivo: "A CAD deste cliente está em validação de cadastro desde 26/09/2026.",
  podeGerarProposta: true,
};

/** A CAD indeferida: continua barrada, e é a decisão do Lucas de manter essa recusa. */
const INDEFERIDA: CredenciamentoNoGet = {
  credenciado: false,
  desde: "2026-09-26T17:11:31.401Z",
  etapa: "indeferido",
  motivo: "A CAD deste cliente está com o cadastro indeferido desde 26/09/2026.",
  podeGerarProposta: false,
};

const CREDENCIADA: CredenciamentoNoGet = {
  credenciado: true,
  desde: "2026-09-01T12:00:00.000Z",
  etapa: "credenciado",
  motivo: null,
  podeGerarProposta: true,
};

const RODAPE_QUE_BARRA =
  "Sem a CAD credenciada neste empreendimento a proposta não pode ser gerada.";

let alvo: HTMLDivElement;
let raiz: Root;

function botao(texto: string): HTMLButtonElement {
  const achado = [...alvo.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  );
  if (!achado) throw new Error(`Botão "${texto}" não está na tela.`);
  return achado;
}

async function abrirCom(credenciamento: CredenciamentoNoGet) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ data: portaoCom(credenciamento) }),
    })),
  );
  await act(async () => {
    raiz.render(
      <ModalDeProposta
        onFechar={vi.fn()}
        onGerada={vi.fn()}
        unidade={{ id: "unidade-1", nome: "EIRETAMA 14", produto: "Aldeia" }}
      />,
    );
  });
}

beforeEach(() => {
  alvo = document.createElement("div");
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
});

afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
  vi.unstubAllGlobals();
});

describe("o selo da CAD na modal de proposta", () => {
  it("CAD em andamento: o coordenador LÊ a etapa e o botão fica LIBERADO", async () => {
    await abrirCom(EM_VALIDACAO);

    // O terceiro estado, que não é o verde nem o vermelho.
    expect(alvo.textContent).toContain("CAD em andamento");
    // ⚠️ A FRASE DA ETAPA CONTINUA NA TELA. É ela que diz ao coordenador a quem cobrar.
    expect(alvo.textContent).toContain(
      "A CAD deste cliente está em validação de cadastro desde 26/09/2026.",
    );
    // ⚠️ E O SELO NÃO MENTE: não pode dizer que a CAD está credenciada.
    expect(alvo.textContent).not.toContain("CAD credenciada neste empreendimento");
    // ⚠️ NEM O RODAPÉ: a frase que barra não aparece por baixo de um botão aceso.
    expect(alvo.textContent).not.toContain(RODAPE_QUE_BARRA);
    expect(botao("Montar as condições").disabled).toBe(false);
  });

  it("CAD indeferida: o botão TRAVA e o rodapé volta a dizer que a proposta não sai", async () => {
    await abrirCom(INDEFERIDA);

    expect(alvo.textContent).toContain("CAD não credenciada");
    expect(alvo.textContent).toContain(
      "A CAD deste cliente está com o cadastro indeferido desde 26/09/2026.",
    );
    expect(alvo.textContent).toContain(RODAPE_QUE_BARRA);
    expect(alvo.textContent).not.toContain("CAD em andamento");
    expect(botao("Montar as condições").disabled).toBe(true);
  });

  it("CAD credenciada: o selo verde de sempre, sem virar o estado novo", async () => {
    await abrirCom(CREDENCIADA);

    expect(alvo.textContent).toContain("CAD credenciada neste empreendimento");
    expect(alvo.textContent).toContain("A reserva pode virar proposta.");
    expect(alvo.textContent).not.toContain("CAD em andamento");
    expect(alvo.textContent).not.toContain(RODAPE_QUE_BARRA);
    expect(botao("Montar as condições").disabled).toBe(false);
  });

  it("o botão obedece a PORTA que o servidor mandou, e não a etapa que a tela vê", async () => {
    // ⚠️ É O PORTAL DO CECÍLIO: a MESMA CAD em validação, com a porta FECHADA pelo servidor (Lucas,
    // 26/09/2026: o afrouxamento é do coordenador). Se a tela recalculasse a regra a partir da
    // etapa, ela acenderia o botão aqui e ofereceria um clique que a rota responde com 403.
    await abrirCom({ ...EM_VALIDACAO, podeGerarProposta: false });

    expect(alvo.textContent).toContain(
      "A CAD deste cliente está em validação de cadastro desde 26/09/2026.",
    );
    expect(alvo.textContent).not.toContain("CAD em andamento");
    expect(alvo.textContent).toContain(RODAPE_QUE_BARRA);
    expect(botao("Montar as condições").disabled).toBe(true);
  });
});
