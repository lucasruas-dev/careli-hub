// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// A ÚLTIMA TELA ANTES DO ATO NÃO PODE FICAR MUDA SOBRE A CAD.
//
// Lucas (26/09/2026), nesta ordem, no mesmo dia:
//   1. *"pode deixar os coordenadores emitirem proposta sem a cad esta credenciada. ela pode estar em
//      validacao ou em qualquer outro estagio"*;
//   2. *"faz uma barra, para enviar para contrato precisa da cad validada"*.
//
// ⚠️ O AVISO NASCEU SÓ ONDE A PROPOSTA É MONTADA, E ISSO NÃO ALCANÇA QUEM CLICA. O selo âmbar "CAD em
// andamento" vive em `ModalDeProposta.tsx` e só aparece durante a geração da proposta. A proposta pode
// ter sido montada dias antes, ou por outra pessoa da equipe: quem abre a ficha do lote na quinta,
// clica "Enviar para contrato" (`TelaVenda.tsx:3465` a `:3472`, cujo botão só olha `ativo: proposta`) e
// confirma aqui NÃO viu nada do que foi escrito na segunda. Sem esta frase, a barra era surpresa no fim
// do caminho — e uma barra que surpreende é a que a régua da casa proíbe.
//
// ⚠️ ELA DIZ A REGRA, E NÃO A ETAPA DESTE CLIENTE — porque a etapa não está aqui. O payload do GET de
// `/venda` carrega só o contador agregado do escopo (`CadsDoEscopo`, `lib/hercules/fluxo-de-venda.ts:272`
// a `:278`), e nenhum veredito por LINHA VIVA. Levar o veredito por linha (para escrever a etapa real e
// marcar o botão) é lote próprio, relatado ao Lucas. Dizer a regra é o que dá para dizer com verdade
// hoje, e é melhor que o silêncio que havia.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ModalDeContrato } from "./ModalDeContrato";

const PROPOSTA = {
  cliente: "MAURA MARIA PASSOS",
  codigo: "VOC0306",
  imobiliaria: "MORVIAN",
  plano: "180x",
  produto: "Vale do Ouro Cristalina",
  unidade: "Q03 L06",
  valor: 185000,
};

let alvo: HTMLDivElement;
let raiz: Root;

function abrir() {
  act(() => {
    raiz.render(
      React.createElement(ModalDeContrato, {
        aoConfirmar: () => {},
        aoFechar: () => {},
        enviando: false,
        proposta: PROPOSTA,
      }),
    );
  });
  return alvo.textContent ?? "";
}

beforeEach(() => {
  alvo = document.createElement("div");
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
});

afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
});

describe("a confirmação do envio para contrato avisa da CAD", () => {
  it("⚠️ diz que a CAD do titular precisa estar aprovada, e o que fazer se não estiver", () => {
    const texto = abrir();

    expect(texto).toContain("A CAD do titular precisa estar aprovada");
    expect(texto).toContain("Credenciado");
    // ⚠️ DIZ O QUE FAZER, e nunca só "não permitido" — a mesma régua da frase da recusa.
    expect(texto).toMatch(/coordenação/);
    expect(texto).toContain("a proposta continua de pé");
  });

  // ⚠️ E NÃO PERDE O QUE JÁ ESTAVA LÁ: a modal existe para mostrar a proposta, e é ver o COD, o cliente
  // e o lote que faz alguém dizer "não era essa" (Lucas, 05/09/2026).
  it("continua mostrando o COD, o cliente e o lote", () => {
    const texto = abrir();

    expect(texto).toContain("VOC0306");
    expect(texto).toContain("MAURA MARIA PASSOS");
    expect(texto).toContain("Q03 L06");
  });
});
