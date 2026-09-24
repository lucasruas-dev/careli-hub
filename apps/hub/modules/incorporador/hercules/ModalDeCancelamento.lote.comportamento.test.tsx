// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CANCELAR PROPOSTA: A TELA DIZ SE O LOTE VOLTOU, E POR QUE NÃO.
//
// ⚠️ A REVISÃO DE 24/09/2026 ACHOU A RESPOSTA SEM LEITOR. O PATCH de /venda/proposta devolve
// `loteVoltou` e `porque` (a trava pode segurar o lote: outro dono, irmã com dono, bloqueio), e a
// modal ignorava os dois e dizia sempre "A unidade voltou para a disponibilidade". Lucas, 24/09/2026:
// *"lembrando que quando tem cancelamento a unidade tem que ficar disponivel, tem que ter esse
// reflexo"*: quando o reflexo não acontece, quem cancelou precisa saber.
//
// A montagem é a de `TelaVenda.comportamento.test.tsx` (React no global, `act` na mão).

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ModalDeCancelamento } from "./ModalDeCancelamento";

let raiz: null | Root = null;
let palco: HTMLDivElement;

beforeEach(() => {
  palco = document.createElement("div");
  document.body.appendChild(palco);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  palco.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function responder(data: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data }), { headers: { "content-type": "application/json" } })),
  );
}

async function cancelarProposta(): Promise<string> {
  const onCancelada = vi.fn();
  await act(async () => {
    raiz = createRoot(palco);
    raiz.render(
      <ModalDeCancelamento
        alvo="proposta"
        onCancelada={onCancelada}
        onFechar={() => undefined}
        propostaId="venda-31"
        unidade={{ id: "voc-0306", nome: "Q03 L06", produto: "VOC" }}
      />,
    );
  });
  const botoes = () => [...document.querySelectorAll("button")];
  await act(async () => {
    botoes().find((b) => b.textContent === "Cliente desistiu")?.click();
  });
  await act(async () => {
    botoes().find((b) => b.textContent === "Cancelar proposta")?.click();
  });
  expect(onCancelada).toHaveBeenCalledTimes(1);
  return String(onCancelada.mock.calls[0]?.[0] ?? "");
}

describe("ModalDeCancelamento (proposta): o desfecho do lote", () => {
  it("o lote voltou: a frase diz que voltou", async () => {
    responder({ avisos: [], codigo: "000031", id: "venda-31", loteVoltou: true, porque: null });
    const frase = await cancelarProposta();
    expect(frase).toContain("Proposta de Q03 L06 cancelada");
    expect(frase).toContain("A unidade voltou para a disponibilidade");
  });

  it("a trava segurou o lote: a frase NÃO diz que voltou, e diz por quê", async () => {
    responder({
      avisos: [],
      codigo: "000031",
      id: "venda-31",
      loteVoltou: false,
      porque: "a unidade NÃO voltou para a disponibilidade: o lote tem outro dono (reserva ativa)",
    });
    const frase = await cancelarProposta();
    expect(frase).toContain("Proposta de Q03 L06 cancelada");
    expect(frase).not.toContain("A unidade voltou para a disponibilidade");
    expect(frase).toContain("o lote tem outro dono (reserva ativa)");
    expect(frase).not.toMatch(/[—–]/);
  });

  // ⚠️ A NOVA TENTATIVA QUE NÃO AVISA DE NOVO (revisão de 24/09/2026). Quando a primeira tentativa
  // já mandou os WhatsApps, a rota responde `avisos: []` com `avisosJaSairam`. Lendo só a lista
  // vazia, a tela escrevia "O aviso não chegou a ser enviado" — e o coordenador avisava o cliente
  // uma segunda vez, sobre um cancelamento que ele já tinha recebido.
  it("os avisos já tinham saído na primeira tentativa: a frase NÃO diz que ninguém foi avisado", async () => {
    responder({ avisos: [], avisosJaSairam: true, codigo: "000031", id: "venda-31", loteVoltou: true, porque: null });
    const frase = await cancelarProposta();
    expect(frase).toContain("A unidade voltou para a disponibilidade");
    expect(frase).not.toContain("O aviso não chegou a ser enviado");
    expect(frase).toContain("já tinham sido avisados na primeira tentativa");
    expect(frase).not.toMatch(/[—–]/);
  });

  it("servidor antigo, sem loteVoltou: a frase de sempre", async () => {
    responder({ avisos: [], codigo: "000031", id: "venda-31" });
    const frase = await cancelarProposta();
    expect(frase).toContain("A unidade voltou para a disponibilidade");
  });
});
