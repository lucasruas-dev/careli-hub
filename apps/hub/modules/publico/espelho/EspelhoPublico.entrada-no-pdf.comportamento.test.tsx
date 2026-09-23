// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoteDoEspelho } from "@/lib/hercules/espelho/estado-do-espelho";
import type { PlanoPublico } from "@/lib/hercules/espelho/planos-publicos";

import { EspelhoPublico } from "./EspelhoPublico";

// O QUE O BOTÃO "SALVAR EM PDF" MANDA É O QUE ESTÁ NA TELA (22/09/2026).
//
// ⚠️ ESTE ARQUIVO MEDE A CADEIA INTEIRA, e não a régua do servidor: o corpo da requisição é a única
// coisa que liga o que o corretor vê ao que o cliente recebe. Dois campos não estavam nele, e os
// dois produzem a mesma queixa do Lucas (*"mesmo eu alterando o valor de entrada, quando eu mando
// para PDF ele não traz o valor que eu tinha colocado"*):
//
//   • a ENTRADA ZERO ia no corpo, mas o servidor a trocava pela sugestão (ver
//     `lib/hercules/espelho/simulacao-publica.ts` e `route.entrada-da-tela.test.ts`);
//   • as PARCELAS MONTADAS à mão nem chegavam a sair daqui.
//
// Typecheck não pega nenhum dos dois: o corpo é um objeto literal, e um campo que falta nele é um
// corpo válido.

(globalThis as unknown as { React: typeof React }).React = React;
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = {
  indiceCorrecao: "SEM_CORRECAO",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  jurosTaxa: 0,
  sistemaAmortizacao: "sacoc",
} as const;

const planos = (): PlanoPublico[] => [
  {
    ...BASE,
    anuaisQuantidade: 0,
    anuaisValor: 0,
    descontoPercentual: 0,
    entradaPercentual: 10,
    nome: "NORMAL",
    parcelas: 60,
    ressalva: null,
  },
];

const lote = (): LoteDoEspelho =>
  ({
    andar: null,
    apartamento: null,
    area: 420,
    codigo: "CER0307",
    grupo: "Quadra 03",
    lote: "07",
    numero: "07",
    preco: 432_400,
    quadra: "03",
    rotulo: "Quadra 03 · Lote 07",
    situacao: "disponivel",
    tipoProduto: "loteamento",
  }) as unknown as LoteDoEspelho;

const situacao = () => ({
  atualizadoEm: "2026-09-22T12:00:00.000Z",
  contagem: { disponivel: 1, indisponivel: 0 },
  empreendimento: { codigo: "cecilio-rocha", nome: "Cecílio Rocha" },
  entradaMinimaPercentual: 8,
  lotes: [lote()],
  planos: planos(),
  temMapa: false,
});

let alvo: HTMLDivElement;
let raiz: Root;
/** Os corpos que o botão do PDF enviou, na ordem. */
let enviados: Array<Record<string, unknown>>;

function clicar(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function digitar(campo: HTMLInputElement, texto: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const porTexto = (texto: string) =>
  [...alvo.querySelectorAll("button")].find((b) => b.textContent === texto);

/** Abre a janela do lote disponível pelo quadradinho da grade. */
function abrirOLote() {
  const quadradinho = [...alvo.querySelectorAll("button")].find((b) =>
    b.title.endsWith("· Disponível"),
  );
  if (!quadradinho) throw new Error("quadradinho do lote ausente");
  clicar(quadradinho);
}

/**
 * O bloco "Entrada" do cockpit.
 *
 * ⚠️ PELO TÍTULO DA SEÇÃO, E NÃO PELA ORDEM DOS `input`. O cockpit tem outro campo em reais logo
 * acima (a Parcela), e pegar "o primeiro campo em reais" apagava a PARCELA: o comando virava
 * "parcela", a varredura não achava composição nenhuma e o botão do PDF nem chamava a rota — um
 * teste que falha pelo motivo errado.
 */
function blocoDaEntrada(): HTMLElement {
  const bloco = [...alvo.querySelectorAll("section")].find(
    (s) => s.firstElementChild?.textContent === "Entrada",
  );
  if (!bloco) throw new Error("bloco da entrada ausente");
  return bloco;
}

/** Os campos em reais do bloco "Entrada": o do valor e, quando montada, as parcelas. */
const camposDaEntrada = () =>
  [...blocoDaEntrada().querySelectorAll<HTMLInputElement>("input")].filter(
    (c) => c.placeholder === "0,00",
  );

function campoDaEntrada(): HTMLInputElement {
  const campo = camposDaEntrada()[0];
  if (!campo) throw new Error("campo da entrada ausente");
  return campo;
}

async function salvarEmPdf() {
  const botao = porTexto("Salvar em PDF");
  if (!botao) throw new Error("botão do PDF ausente");
  clicar(botao);
  await act(async () => {
    await Promise.resolve();
  });
}

const ultimoEnvio = () => {
  const ultimo = enviados.at(-1);
  if (!ultimo) throw new Error("o botão do PDF não chamou a rota");
  return ultimo;
};

beforeEach(() => {
  enviados = [];
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", (q: string) => ({
    addEventListener() {},
    matches: false,
    media: q,
    removeEventListener() {},
  }));
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:teste",
    revokeObjectURL: () => {},
  });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.includes("/simulacao")) {
      enviados.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(new Blob([new Uint8Array([37, 80, 68, 70])]), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({ data: situacao() }), { status: 200 });
  });
  alvo = document.createElement("div");
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
  act(() => {
    raiz.render(<EspelhoPublico inicial={situacao() as never} token="tok" />);
  });
});

afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("EspelhoPublico: o corpo do PDF carrega o que a tela mostra", () => {
  it("⚠️ campo de entrada APAGADO sobe como zero, e é zero que a folha tem de imprimir", async () => {
    abrirOLote();
    digitar(campoDaEntrada(), "");
    await salvarEmPdf();

    expect(ultimoEnvio().entrada).toBe(0);
  });

  it("⚠️ e em ZERO o aviso vermelho aparece: sem ele, liberar sem trava vira troca silenciosa", () => {
    abrirOLote();
    // Com a entrada sugerida (10% de R$ 432.400) não há o que avisar.
    expect(blocoDaEntrada().textContent).not.toContain("Abaixo do mínimo");

    digitar(campoDaEntrada(), "");

    // ⚠️ ERA AQUI QUE O SILÊNCIO COMEÇAVA. `abaixoDoMinimo` exigia `valor > 0`, então o campo
    // apagado escrevia "Mínimo de 10%: R$ 43.240" em cinza, como se nada estivesse errado — e o
    // Lucas aceitou liberar a entrada sem trava EM TROCA do alerta (*"pode deixar tudo liberado,
    // sem trava, somente com alertas"*). Sem o aviso, o que sobra é só a liberação.
    expect(blocoDaEntrada().textContent).toContain("Abaixo do mínimo de 10%");
    // E o atalho que repõe o piso num clique vem junto.
    expect(porTexto("usar o mínimo")).toBeTruthy();
  });

  it("⚠️ as parcelas MONTADAS à mão sobem no corpo (elas nem existiam nele)", async () => {
    abrirOLote();

    // Duas vezes na entrada: é o que faz o botão "montar valores" aparecer.
    const maisDaEntrada = [
      ...blocoDaEntrada().querySelectorAll("button"),
    ].find((b) => b.getAttribute("aria-label") === "Aumentar");
    if (!maisDaEntrada) throw new Error("contador da entrada ausente");
    clicar(maisDaEntrada);

    const montar = porTexto("montar valores");
    expect(montar).toBeTruthy();
    clicar(montar as Element);

    // A entrada nasce repartida em duas partes iguais; a pessoa fixa a primeira.
    // O campo 0 é o valor da entrada; do 1 em diante são as parcelas montadas.
    const primeiraParcela = camposDaEntrada()[1];
    if (!primeiraParcela) throw new Error("parcela montada ausente");
    digitar(primeiraParcela, "30.000,00");

    await salvarEmPdf();

    const corpo = ultimoEnvio();
    expect(Array.isArray(corpo.entradaParcelas)).toBe(true);
    expect((corpo.entradaParcelas as number[])[0]).toBe(30_000);
    // E a soma das parcelas é a entrada que sobe junto: é o par que a folha precisa para o destaque
    // não brigar com o fluxo.
    const soma = (corpo.entradaParcelas as number[]).reduce((t, v) => t + v, 0);
    expect(Math.round(soma * 100)).toBe(Math.round(Number(corpo.entrada) * 100));
  });

  it("⚠️ e a DATA escolhida para uma parcela da entrada sobe junto", async () => {
    abrirOLote();
    const maisDaEntrada = [
      ...blocoDaEntrada().querySelectorAll("button"),
    ].find((b) => b.getAttribute("aria-label") === "Aumentar");
    if (!maisDaEntrada) throw new Error("contador da entrada ausente");
    clicar(maisDaEntrada);
    clicar(porTexto("montar valores") as Element);

    // ⚠️ O CAMPO DE DATA FICA VISÍVEL AQUI. O bloco "Cobrança" (dia de vencimento e data da
    // primeira mensal) some no modo simulação, mas a data de cada parcela da entrada é parte da
    // montagem — e ela empurra a primeira mensal no cronograma, então muda o fluxo inteiro.
    const datas = [
      ...blocoDaEntrada().querySelectorAll<HTMLInputElement>('input[type="date"]'),
    ];
    expect(datas.length).toBe(2);
    const segunda = datas[1];
    if (!segunda) throw new Error("campo de data ausente");
    digitar(segunda, "2026-12-20");

    await salvarEmPdf();
    expect(ultimoEnvio().entradaDatas).toEqual([null, "2026-12-20"]);
  });

  it("sem montagem, o corpo manda nulo e o servidor reparte igual", async () => {
    abrirOLote();
    await salvarEmPdf();

    expect(ultimoEnvio().entradaParcelas).toBeNull();
    expect(ultimoEnvio().entradaDatas).toBeNull();
  });

  // AS DUAS PEÇAS DE 23/09/2026 NO MESMO CORPO — o desconto e a permuta.
  //
  // ⚠️ ESTE É O ÚNICO TESTE QUE LIGA A TELA À ROTA. O campo existir e a régua do servidor aceitar
  // são duas coisas provadas em outros arquivos; entre elas há um objeto literal montado à mão em
  // `baixarPdf`, e um campo que falta nele é um corpo VÁLIDO — typecheck não diz nada. Foi assim
  // que as parcelas montadas à mão ficaram um mês na tela sem chegar ao papel.
  it("⚠️ o desconto digitado no lote sobe em `valor`", async () => {
    abrirOLote();
    const desconto = [...alvo.querySelectorAll("input")].find(
      (i) => i.getAttribute("placeholder") === "desconto",
    );
    if (!desconto) throw new Error("campo de desconto ausente na página pública");
    digitar(desconto, "10");

    await salvarEmPdf();
    // R$ 432.400 × 0,90.
    expect(ultimoEnvio().valor).toBe(389_160);
  });

  it("⚠️ o bem digitado no espelho sobe em `bensEPermutas`", async () => {
    abrirOLote();

    const acrescentar = porTexto("Acrescentar bem ou permuta");
    if (!acrescentar) throw new Error("botão de acrescentar bem ausente na página pública");
    clicar(acrescentar);

    const valorDoItem = alvo.querySelector<HTMLInputElement>('[aria-label="Valor do item 1"]');
    const descricaoDoItem = alvo.querySelector<HTMLInputElement>(
      '[aria-label="Descrição do item 1"]',
    );
    if (!valorDoItem || !descricaoDoItem) throw new Error("campos do item 1 ausentes");
    digitar(valorDoItem, "80.000");
    digitar(descricaoDoItem, "Ford Ka 2019 placa ABC1D23");

    await salvarEmPdf();
    expect(ultimoEnvio().bensEPermutas).toEqual([
      {
        descricao: "Ford Ka 2019 placa ABC1D23",
        // ⚠️ "ABATIMENTO" É O PADRÃO DE QUEM NASCE (`acrescentarBem`), e vale na página pública do
        // mesmo jeito: o item abate o saldo, mas NÃO cumpre a entrada mínima enquanto ninguém
        // apontar isso à mão. É o lado que não afrouxa a régua sem alguém decidir.
        entraComo: "abatimento",
        tipo: "bem",
        valor: 80_000,
      },
    ]);
  });

  it("sem bem nenhum, `bensEPermutas` sobe nulo, e não como lista vazia", async () => {
    abrirOLote();
    await salvarEmPdf();

    expect(ultimoEnvio().bensEPermutas).toBeNull();
  });
});
