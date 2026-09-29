// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A RESERVA ACEITA PESSOA FÍSICA E PESSOA JURÍDICA.
//
// Lucas (26/09/2026): *"na hora da reserva, dentro do hercules, temos que habilitar pessoa fisica e
// pessoa juridica, hoje só atende pessoa fisica"*.
//
// ⚠️ ATÉ 26/09/2026 O 12º DÍGITO NEM ENTRAVA NO CAMPO. `ModalDeReserva.tsx` cortava a digitação em
// onze dígitos (`soDigitos(v).slice(0, 11)`): quem colava um CNPJ de catorze via "123.456.780-00"
// aparecer no campo. É a falha que se vê na tela, antes de qualquer régua de servidor.
//
// A montagem é a de `TelaVenda.comportamento.test.tsx` (React no global, `act` na mão).

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ModalDeReserva } from "./ModalDeReserva";

let raiz: null | Root = null;
let palco: HTMLDivElement;
let enviados: Array<{ corpo: unknown; url: string }>;

const LISTA = {
  corretores: [
    {
      documento: null,
      id: "cor-1",
      imobiliariaId: "imo-1",
      imobiliariaNome: "Gurgel Imóveis",
      nome: "João Souza",
      verificado: true,
    },
  ],
  imobiliarias: [{ documento: null, id: "imo-1", nome: "Gurgel Imóveis", verificada: true }],
};

beforeEach(() => {
  palco = document.createElement("div");
  document.body.appendChild(palco);
  enviados = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        enviados.push({ corpo: JSON.parse(String(init.body)), url: String(url) });
        return new Response(JSON.stringify({ data: { avisos: [], codigo: "000123" } }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ data: LISTA }), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  palco.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const campos = () => [...document.querySelectorAll("input")] as HTMLInputElement[];
const botoes = () => [...document.querySelectorAll("button")] as HTMLButtonElement[];

function digitar(campo: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

async function abrir() {
  await act(async () => {
    raiz = createRoot(palco);
    raiz.render(
      <ModalDeReserva
        onFechar={() => undefined}
        onReservado={() => undefined}
        unidade={{ id: "u-1", nome: "Q12 L06", produto: "VOC" }}
        valorDaUnidade={136_521}
      />,
    );
  });
  // Escolher a imobiliária: a reserva pode sair só no nome dela.
  await act(async () => {
    botoes().find((b) => b.textContent?.includes("Gurgel Imóveis"))?.click();
  });
}

/** Os campos do cliente, na ordem em que a modal os desenha: nome, documento, telefone. */
function camposDoCliente() {
  const todos = campos();
  const documento = todos.find((c) => /CPF/i.test(c.placeholder ?? ""));
  const nome = todos.find((c) => /Nome|social/i.test(c.placeholder ?? ""));
  const telefone = todos.find((c) => /telefone|9|número/i.test(c.placeholder ?? ""));
  return { documento, nome, telefone };
}

describe("ModalDeReserva: o documento do cliente", () => {
  it("⚠️ o CNPJ entra inteiro, com os 14 dígitos formatados", async () => {
    await abrir();
    const { documento } = camposDoCliente();
    expect(documento).toBeTruthy();
    await act(async () => digitar(documento!, "12345678000195"));
    expect(documento!.value).toBe("12.345.678/0001-95");
  });

  it("o campo diz que aceita os dois", async () => {
    await abrir();
    const { documento } = camposDoCliente();
    expect(documento!.placeholder).toContain("CNPJ");
  });

  it("⚠️ com CNPJ e razão social de UMA palavra, o botão Reservar dispara o POST", async () => {
    await abrir();
    const { documento, nome, telefone } = camposDoCliente();
    await act(async () => digitar(nome!, "Construtora"));
    await act(async () => digitar(documento!, "12345678000195"));
    await act(async () => digitar(telefone!, "62991234567"));
    await act(async () => {
      botoes().find((b) => b.textContent?.trim() === "Reservar")?.click();
    });
    expect(enviados).toHaveLength(1);
    expect(enviados[0]?.corpo).toMatchObject({
      proponente: { documento: "12.345.678/0001-95", nome: "Construtora" },
    });
  });

  it("com CPF, a reserva sai como sempre saiu", async () => {
    await abrir();
    const { documento, nome, telefone } = camposDoCliente();
    await act(async () => digitar(nome!, "Maria da Silva"));
    await act(async () => digitar(documento!, "52998224725"));
    await act(async () => digitar(telefone!, "62991234567"));
    expect(documento!.value).toBe("529.982.247-25");
    await act(async () => {
      botoes().find((b) => b.textContent?.trim() === "Reservar")?.click();
    });
    expect(enviados).toHaveLength(1);
    expect(enviados[0]?.corpo).toMatchObject({
      proponente: { documento: "529.982.247-25", nome: "Maria da Silva" },
    });
  });
});
