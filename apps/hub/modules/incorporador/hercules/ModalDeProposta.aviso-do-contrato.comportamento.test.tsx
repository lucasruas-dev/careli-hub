// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A BARRA NÃO PODE SER SURPRESA NO FIM DO CAMINHO — o selo âmbar avisa ANTES.
//
// Lucas (26/09/2026), nesta ordem, no mesmo dia:
//   1. *"pode deixar os coordenadores emitirem proposta sem a cad esta credenciada. ela pode estar em
//      validacao ou em qualquer outro estagio"*;
//   2. *"faz uma barra, para enviar para contrato precisa da cad validada"*.
//
// ⚠️ OS DOIS PEDIDOS JUNTOS CRIAM UM CAMINHO COM PAREDE NO FIM: a proposta nasce com a CAD em
// andamento e o contrato só sai com a CAD aprovada. Quem monta a proposta precisa LER isso na hora de
// montar, não descobrir num erro vermelho depois de confirmar o envio para contrato. O selo âmbar
// "CAD em andamento" é o lugar natural da frase, porque é exatamente o estado em que a parede existe.
//
// ⚠️ E A FRASE NÃO PODE APARECER NOS OUTROS DOIS ESTADOS. Na CAD credenciada não há parede nenhuma
// (dizer que "o contrato só sai depois da CAD aprovada" para quem já está aprovado é ruído que ensina
// o operador a ignorar avisos). Na CAD barrada a proposta nem é gerada, e a frase falaria de um passo
// que ele não vai alcançar.
//
// ⚠️ MEDIDO EM 26/09/2026 (produção `bxgukywoxgivlrhjkwjx`, só SELECT): são TRÊS pessoas hoje com CAD
// em andamento (`revisao`) e lote vivo antes do contrato, todas no VLO. São elas que o afrouxamento
// da proposta deixa passar e que esta barra para no contrato — é por elas que a frase existe.
//
// O andaime é o mesmo de `ModalDeProposta.cad-em-andamento.comportamento.test.tsx`.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./SimuladorDeProposta", async () => {
  const react = await import("react");
  return {
    SimuladorDeProposta: () => react.createElement("div", null, "simulador"),
  };
});

const { ModalDeProposta } = await import("./ModalDeProposta");

type CredenciamentoNoGet = {
  credenciado: boolean;
  desde: null | string;
  etapa: null | string;
  motivo: null | string;
  podeGerarProposta: boolean;
};

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
        cpf: "52998224725",
        nome: "LETICIA DE OLIVEIRA CAMPOS GOMES",
        telefone: "62999990000",
      },
      validadeEm: null,
    },
    unidade: {
      enterpriseId: "36",
      id: "unidade-1",
      nome: "Q05 L24",
      preco: 200_000,
      produto: "Vale do Ouro",
    },
  };
}

/** A CAD em revisão: o estado medido das três pessoas do VLO. A porta da proposta abre. */
const EM_REVISAO: CredenciamentoNoGet = {
  credenciado: false,
  desde: "2026-09-11T12:00:00.000Z",
  etapa: "revisao",
  motivo: "A CAD deste cliente está em revisão pela coordenação desde 11/09/2026.",
  podeGerarProposta: true,
};

const INDEFERIDA: CredenciamentoNoGet = {
  credenciado: false,
  desde: "2026-09-20T12:00:00.000Z",
  etapa: "indeferido",
  motivo: "A CAD deste cliente está com o cadastro indeferido desde 20/09/2026.",
  podeGerarProposta: false,
};

const CREDENCIADA: CredenciamentoNoGet = {
  credenciado: true,
  desde: "2026-09-01T12:00:00.000Z",
  etapa: "credenciado",
  motivo: null,
  podeGerarProposta: true,
};

let alvo: HTMLDivElement;
let raiz: Root;

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
        unidade={{ id: "unidade-1", nome: "Q05 L24", produto: "Vale do Ouro" }}
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

describe("o selo âmbar avisa que o contrato só sai com a CAD aprovada", () => {
  it("⚠️ CAD em andamento: a tela diz, ANTES de montar a proposta, que o contrato espera a CAD", async () => {
    await abrirCom(EM_REVISAO);

    expect(alvo.textContent).toContain("CAD em andamento");
    // A frase da parede, na hora de montar — não no fim do caminho.
    expect(alvo.textContent).toMatch(/contrato só sai depois que a CAD for aprovada/i);
    // E o que já estava lá continua: a etapa real e a porta aberta da proposta.
    expect(alvo.textContent).toContain(
      "A CAD deste cliente está em revisão pela coordenação desde 11/09/2026.",
    );
    expect(alvo.textContent).toContain("A proposta pode ser gerada");
  });

  it("CAD credenciada: nenhuma frase sobre esperar a CAD, porque não há parede", async () => {
    await abrirCom(CREDENCIADA);

    expect(alvo.textContent).toContain("CAD credenciada neste empreendimento");
    expect(alvo.textContent).not.toMatch(/contrato só sai depois/i);
  });

  it("CAD barrada: não fala do contrato, porque a proposta nem é gerada", async () => {
    await abrirCom(INDEFERIDA);

    expect(alvo.textContent).toContain("CAD não credenciada");
    expect(alvo.textContent).not.toMatch(/contrato só sai depois/i);
  });
});
