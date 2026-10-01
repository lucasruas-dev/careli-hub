// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O FORMULÁRIO DA CONFERÊNCIA DA CORRETAGEM, EXERCITADO DE VERDADE (jsdom, sem rota).
//
// ⚠️ ALÉM DO TESTE POR TEXTO (`conferencia-corretagem-form.test.ts`), AQUI O FLUXO RODA: o Salvar só
// abre a confirmação, nada vai à rota antes do Confirmar, valor ilegível nem chega ao envio, e a
// mensagem de sucesso usa o valor que a ROTA devolveu (não o digitado). São as promessas do pedido
// de 01/10/2026 (achado da revisão da Publicação: "7.000" gravava R$ 7,00 sem ninguém ver).

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../data/apolo-operations", () => ({
  getApoloAccessToken: async () => "token-de-teste",
}));

const { ConferenciaDaCorretagem } = await import("./conferencia-corretagem-form");

type Chamada = { corpo: null | Record<string, unknown>; metodo: string; url: string };

let raiz: Root;
let recipiente: HTMLElement;
let chamadas: Chamada[];
let respostas: Array<{ corpo: unknown; ok: boolean }>;
let salvas: string[];

beforeEach(() => {
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  chamadas = [];
  respostas = [];
  salvas = [];

  vi.stubGlobal("fetch", async (url: string, init?: { body?: string; method?: string }) => {
    chamadas.push({
      corpo: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      metodo: init?.method ?? "GET",
      url,
    });
    const resposta = respostas.shift() ?? { corpo: {}, ok: true };
    return { json: async () => resposta.corpo, ok: resposta.ok };
  });
});

afterEach(() => {
  act(() => raiz.unmount());
  recipiente.remove();
  vi.unstubAllGlobals();
});

function montar(props: { conferenciaUsada?: "com_corretagem" | "sem_corretagem" | null; recusado?: boolean }) {
  act(() => {
    raiz.render(
      <ConferenciaDaCorretagem
        c2xId={77}
        conferenciaUsada={props.conferenciaUsada ?? null}
        contratoId={2417}
        onSalva={(mensagem) => salvas.push(mensagem)}
        recusado={props.recusado ?? false}
      />,
    );
  });
}

function texto(): string {
  return (recipiente.textContent ?? "").replace(/\s+/g, " ").trim();
}

function botao(rotulo: string): HTMLButtonElement {
  const achado = [...recipiente.querySelectorAll("button")].find((b) => b.textContent?.trim() === rotulo);
  if (!achado) throw new Error(`botão "${rotulo}" não encontrado em: ${texto()}`);
  return achado as HTMLButtonElement;
}

function clicar(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Escreve num campo controlado do React (o valor tem de passar pelo setter nativo). */
function digitar(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function campoDoValor() {
  return recipiente.querySelector('input[aria-label="Valor da corretagem em reais"]') as HTMLInputElement;
}
function campoDaObservacao() {
  return recipiente.querySelector("textarea") as HTMLTextAreaElement;
}
function radio(indice: number) {
  return recipiente.querySelectorAll('input[type="radio"]')[indice] as HTMLInputElement;
}

async function esperar() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function preencherHouve(valor: string) {
  clicar(radio(1));
  digitar(campoDoValor(), valor);
  digitar(campoDaObservacao(), "Cláusula 3.2 do contrato assinado.");
}

describe("quando abre", () => {
  it("sem recusa e sem conferência usada, não aparece nada", () => {
    montar({});
    expect(texto()).toBe("");
  });

  it("recusado pela corretagem zero: abre o formulário sozinho", () => {
    montar({ recusado: true });
    expect(texto()).toContain("Registrar conferência da corretagem");
    expect(texto()).toContain("Não houve corretagem");
    expect(texto()).toContain("Houve corretagem de R$");
  });

  it("com conferência usada: só a linha discreta com 'Ver ou corrigir'", () => {
    montar({ conferenciaUsada: "com_corretagem" });
    expect(texto()).toContain("Corretagem conferida no contrato assinado.");
    expect(texto()).toContain("Ver ou corrigir");
    expect(texto()).not.toContain("Registrar conferência");
  });

  it("o Salvar começa apagado e só acende com resultado e observação", () => {
    montar({ recusado: true });
    expect(botao("Salvar").disabled).toBe(true);

    clicar(radio(0));
    expect(botao("Salvar").disabled).toBe(true);

    digitar(campoDaObservacao(), "Não prevê intermediação.");
    expect(botao("Salvar").disabled).toBe(false);
  });

  it("o contador acompanha a observação e o campo tem teto de 1000", () => {
    montar({ recusado: true });
    expect(campoDaObservacao().maxLength).toBe(1000);
    expect(texto()).toContain("0/1000");

    digitar(campoDaObservacao(), "abcde");
    expect(texto()).toContain("5/1000");
  });
});

describe("a confirmação antes de enviar", () => {
  it("'houve': mostra o valor formatado e por extenso, e NADA vai à rota antes do Confirmar", () => {
    montar({ recusado: true });
    preencherHouve("7.000");
    clicar(botao("Salvar"));

    expect(texto()).toContain("Confirmar: houve corretagem de R$ 7.000,00 (sete mil reais)");
    expect(chamadas).toHaveLength(0);
  });

  it("'não houve': a confirmação diz 'não houve corretagem'", () => {
    montar({ recusado: true });
    clicar(radio(0));
    digitar(campoDaObservacao(), "Não prevê intermediação.");
    clicar(botao("Salvar"));

    expect(texto()).toContain("Confirmar: não houve corretagem");
    expect(chamadas).toHaveLength(0);
  });

  it("Voltar desfaz a confirmação e não envia nada", () => {
    montar({ recusado: true });
    preencherHouve("7.000");
    clicar(botao("Salvar"));
    clicar(botao("Voltar"));

    expect(texto()).not.toContain("Confirmar: houve");
    expect(botao("Salvar")).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it.each(["7.5", "7.00", "7000.50", "7,000.50", "1.0000", "abc"])(
    "valor ilegível %j: mostra a frase do formato e NÃO chega à confirmação",
    (valor) => {
      montar({ recusado: true });
      preencherHouve(valor);
      clicar(botao("Salvar"));

      expect(texto()).toContain("Use o formato brasileiro, ex.: 7.000,50");
      expect(texto()).not.toContain("Confirmar: houve");
      expect(chamadas).toHaveLength(0);
    },
  );
});

describe("a gravação", () => {
  it("Confirmar envia o PUT com o NÚMERO lido (7.000 vira 7000, e não 7)", async () => {
    respostas = [{ corpo: { data: { contrato: 2417, resultado: "com_corretagem", valor: 7000 } }, ok: true }];
    montar({ recusado: true });
    preencherHouve("7.000");
    clicar(botao("Salvar"));
    clicar(botao("Confirmar"));
    await esperar();

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({
      corpo: {
        c2xId: 77,
        contrato: 2417,
        observacao: "Cláusula 3.2 do contrato assinado.",
        resultado: "com_corretagem",
        valor: 7000,
      },
      metodo: "PUT",
      url: "/api/apolo/rescisao/conferencia-corretagem",
    });
  });

  it("'não houve' envia sem a chave valor", async () => {
    respostas = [{ corpo: { data: { contrato: 2417, resultado: "sem_corretagem", valor: null } }, ok: true }];
    montar({ recusado: true });
    clicar(radio(0));
    digitar(campoDaObservacao(), "Não prevê intermediação.");
    clicar(botao("Salvar"));
    clicar(botao("Confirmar"));
    await esperar();

    expect(chamadas[0]?.corpo).not.toHaveProperty("valor");
    expect(salvas).toEqual([
      "Conferência registrada: não houve corretagem. Clique em Rescisão para gerar a simulação.",
    ]);
  });

  // ⚠️ A MENSAGEM USA O QUE A ROTA DEVOLVEU, e não o que a tela digitou. A rota devolve 7000,50 aqui
  // de propósito: se a mensagem saísse do campo, diria R$ 7.000,00.
  it("a mensagem de sucesso usa o valor DEVOLVIDO pela rota, formatado e por extenso", async () => {
    respostas = [{ corpo: { data: { contrato: 2417, resultado: "com_corretagem", valor: 7000.5 } }, ok: true }];
    montar({ recusado: true });
    preencherHouve("7.000");
    clicar(botao("Salvar"));
    clicar(botao("Confirmar"));
    await esperar();

    expect(salvas).toEqual([
      "Conferência registrada: houve corretagem de R$ 7.000,50 (sete mil reais e cinquenta centavos). Clique em Rescisão para gerar a simulação.",
    ]);
  });

  it("erro da rota aparece escrito, volta para o formulário e não avisa sucesso", async () => {
    respostas = [{ corpo: { error: "O valor da corretagem informado não é menor que o valor de tabela da unidade." }, ok: false }];
    montar({ recusado: true });
    preencherHouve("7.000");
    clicar(botao("Salvar"));
    clicar(botao("Confirmar"));
    await esperar();

    expect(texto()).toContain("não é menor que o valor de tabela da unidade");
    expect(salvas).toHaveLength(0);
    expect(botao("Salvar")).toBeTruthy();
  });
});

describe("ver e corrigir", () => {
  const atual = {
    conferido_em: "2026-10-01T15:00:00.000Z",
    conferido_por_nome: "Coordenadora",
    observacao: "Cláusula 3.2.",
    resultado: "com_corretagem",
    valor: 7000.5,
  };
  const antiga = {
    conferido_em: "2026-09-30T15:00:00.000Z",
    conferido_por_nome: "Líder Antigo",
    observacao: "Primeira leitura.",
    resultado: "sem_corretagem",
    valor: null,
  };

  it("carrega o GET, abre o formulário PREENCHIDO com o atual e mostra o histórico", async () => {
    respostas = [{ corpo: { data: { atual, historico: [atual, antiga] } }, ok: true }];
    montar({ conferenciaUsada: "com_corretagem" });
    clicar(botao("Ver ou corrigir"));
    await esperar();

    expect(chamadas[0]?.metodo).toBe("GET");
    expect(chamadas[0]?.url).toBe("/api/apolo/rescisao/conferencia-corretagem?c2xId=77&contrato=2417");
    expect(radio(1).checked).toBe(true);
    expect(campoDoValor().value).toBe("7.000,50");
    expect(campoDaObservacao().value).toBe("Cláusula 3.2.");
    expect(texto()).toContain("Histórico");
    expect(texto()).toContain("01/10/2026 · Coordenadora · houve corretagem de R$ 7.000,50");
    expect(texto()).toContain("30/09/2026 · Líder Antigo · não houve corretagem");
  });

  it("o valor preenchido volta pelo mesmo parser (corrigir sem mexer no número não o deturpa)", async () => {
    respostas = [
      { corpo: { data: { atual, historico: [atual] } }, ok: true },
      { corpo: { data: { contrato: 2417, resultado: "com_corretagem", valor: 7000.5 } }, ok: true },
    ];
    montar({ conferenciaUsada: "com_corretagem" });
    clicar(botao("Ver ou corrigir"));
    await esperar();

    clicar(botao("Salvar"));
    expect(texto()).toContain("Confirmar: houve corretagem de R$ 7.000,50");
    clicar(botao("Confirmar"));
    await esperar();

    expect(chamadas[1]).toMatchObject({ corpo: { valor: 7000.5 }, metodo: "PUT" });
  });

  it("Fechar volta para a linha discreta, sem gravar", async () => {
    respostas = [{ corpo: { data: { atual, historico: [atual] } }, ok: true }];
    montar({ conferenciaUsada: "com_corretagem" });
    clicar(botao("Ver ou corrigir"));
    await esperar();
    clicar(botao("Fechar"));

    expect(texto()).toContain("Ver ou corrigir");
    expect(texto()).not.toContain("Registrar conferência");
    expect(chamadas).toHaveLength(1);
  });

  it("falha ao ler: a frase da rota aparece e o formulário não abre", async () => {
    respostas = [{ corpo: { error: "A tabela da conferência ainda não foi criada." }, ok: false }];
    montar({ conferenciaUsada: "sem_corretagem" });
    clicar(botao("Ver ou corrigir"));
    await esperar();

    expect(texto()).toContain("A tabela da conferência ainda não foi criada.");
    expect(texto()).not.toContain("Registrar conferência");
  });
});
