// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O EXCEL DA CARTEIRA POR UNIDADE, NA TELA DE VERDADE (revisão de 29/09/2026).
//
// O botão nasceu com o pedido do Lucas (29/09/2026, *"na tela do financeiro tbm"*), e a revisão
// achou o arquivo saindo com o rótulo de um recorte e as unidades de outro: o nome vinha do chip
// escolhido AGORA, e as linhas vinham da última carteira que chegou. O que se trava aqui:
//   • trocar de empreendimento trava o Excel até a carteira nova chegar, e o arquivo sai com o nome
//     e as unidades do MESMO recorte;
//   • a resposta velha que volta por último não toma a tela (nem o arquivo) do recorte novo;
//   • o "Consultado em" do arquivo é a hora em que AS UNIDADES foram lidas, e não a do cabeçalho,
//     que abrir Indicadores empurra para a frente.
//
// A montagem é a manual dos outros testes de componente (board-view.sem-fila.comportamento). O
// ExcelJS não entra: quem gera o arquivo tem teste próprio; aqui interessa O QUE a tela manda.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type EntradaDaPlanilha = {
  consultadoEm: Date | null | string;
  recorte: null | string;
  unidades: readonly { code: string }[];
};

const planilha = vi.hoisted(() => ({ entradas: [] as EntradaDaPlanilha[] }));

vi.mock("@/lib/apolo/incorporador/planilha-da-carteira-por-unidade", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/apolo/incorporador/planilha-da-carteira-por-unidade")>();
  return {
    ...original,
    planilhaDaCarteiraPorUnidade: vi.fn(async (entrada: EntradaDaPlanilha) => {
      planilha.entradas.push(entrada);
      return new ArrayBuffer(8);
    }),
  };
});

// O jsdom não tem URL de Blob. Fica definido para o arquivo inteiro, e não por teste: o endereço é
// liberado 1 s depois do clique, e um `revokeObjectURL` removido antes disso quebraria fora do teste.
Object.assign(URL, { createObjectURL: vi.fn(() => "blob:teste"), revokeObjectURL: vi.fn() });

const { TelaCarteira } = await import("./TelaCarteira");

const RESUMO = {
  clients: 1,
  contracts: 1,
  criticalContracts: 0,
  delinquencyRate: 0,
  overdueAmount: 0,
  overdueClients: 0,
  overdueInstallments: 0,
  paidAmount: 10,
  recoveryAmount: 0,
  toReceiveAmount: 90,
  totalPortfolio: 100,
};

const unidade = (code: string, empreendimento: string) => ({
  block: "01",
  client: `Comprador ${code}`,
  code,
  contractCode: "1",
  empreendimento,
  faturadoAt: null,
  id: code,
  imobiliaria: null,
  liquido: null,
  lot: "01",
  maxOverdueDays: 0,
  overdueAmount: 0,
  overdueInstallments: 0,
  paidAmount: 10,
  temContrato: false,
  toReceiveAmount: 90,
  totalContract: 100,
});

const ALFA = unidade("ALF Q01 L01", "Alfa");
const BETA = unidade("BET Q02 L02", "Beta");

const dados = (filtro: null | string, units: ReturnType<typeof unidade>[]) => ({
  bruto: RESUMO,
  empreendimentos: [
    { filhos: [], id: "pai:alfa", nome: "Alfa" },
    { filhos: [], id: "pai:beta", nome: "Beta" },
  ],
  filtro,
  indicadores: null,
  liquido: { motivos: [], parcial: false, porSplit: 0, recebido: 0, recebidoBruto: 0, semLiquido: 0, total: 0 },
  units,
});

/** A resposta de cada endereço: o corpo, ou "pendente" (fica esperando `responder`). */
let rota: (url: string) => "pendente" | object;
let pendentes: { responder: (corpo: object) => void; url: string }[];
let baixados: string[];
let raiz: Root;
let hospedeiro: HTMLDivElement;

const resposta = (corpo: object) =>
  new Response(JSON.stringify({ data: corpo }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });

beforeEach(() => {
  planilha.entradas.length = 0;
  pendentes = [];
  baixados = [];
  // Só o relógio de parede: o setTimeout continua de verdade, e a data do nome do arquivo fica fixa.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-29T17:32:00.000Z"));
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => {
          const corpo = rota(url);
          if (corpo === "pendente") {
            pendentes.push({ responder: (c) => resolve(resposta(c)), url });
          } else {
            resolve(resposta(corpo));
          }
        }),
    ),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    baixados.push(this.download);
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function esperar() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function montar() {
  act(() => {
    raiz.render(<TelaCarteira />);
  });
  await esperar();
}

const botao = (texto: string) =>
  Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === texto,
  );

async function clicar(texto: string) {
  const alvo = botao(texto);
  expect(alvo, `botão "${texto}"`).toBeDefined();
  await act(async () => {
    alvo?.click();
  });
  await esperar();
}

async function responder(trecho: string, corpo: object) {
  const pendente = pendentes.find((p) => p.url.includes(trecho));
  expect(pendente, `leitura pendente com "${trecho}"`).toBeDefined();
  pendentes = pendentes.filter((p) => p !== pendente);
  await act(async () => {
    pendente?.responder(corpo);
  });
  await esperar();
}

const unidadesNaTabela = () =>
  Array.from(hospedeiro.querySelectorAll("tbody tr")).map(
    (tr) => tr.querySelector("td p")?.textContent ?? "",
  );

describe("Carteira por unidade: o Excel sai do mesmo recorte que está na tabela", () => {
  it("⚠️ trocar de empreendimento trava o Excel até a carteira nova chegar", async () => {
    rota = (url) => (url.includes("code=") ? "pendente" : dados(null, [ALFA]));
    await montar();
    expect(unidadesNaTabela()).toEqual([ALFA.code]);

    await clicar("Beta");

    // A tabela ainda é a de antes (a leitura de Beta não voltou) e a tela diz isso.
    expect(unidadesNaTabela()).toEqual([ALFA.code]);
    expect(hospedeiro.textContent).toContain("atualizando…");
    expect(botao("Excel")?.disabled).toBe(true);
    await act(async () => {
      botao("Excel")?.click();
    });
    await esperar();
    expect(planilha.entradas).toHaveLength(0);

    await responder("code=pai%3Abeta", dados("pai:beta", [BETA]));

    expect(unidadesNaTabela()).toEqual([BETA.code]);
    expect(hospedeiro.textContent).not.toContain("atualizando…");
    expect(botao("Excel")?.disabled).toBe(false);

    await clicar("Excel");

    expect(planilha.entradas).toHaveLength(1);
    expect(planilha.entradas[0]?.recorte).toBe("Beta");
    expect(planilha.entradas[0]?.unidades.map((u) => u.code)).toEqual([BETA.code]);
    expect(baixados).toEqual(["carteira-beta-2026-09-29.xlsx"]);
  });

  it("⚠️ a resposta velha que volta por último não toma a tela nem o arquivo", async () => {
    rota = (url) => (url.includes("code=") ? "pendente" : dados(null, [ALFA, BETA]));
    await montar();

    await clicar("Alfa");
    await clicar("Beta");
    // Beta volta primeiro; Alfa, pedida antes, chega depois e tem de ser descartada.
    await responder("code=pai%3Abeta", dados("pai:beta", [BETA]));
    await responder("code=pai%3Aalfa", dados("pai:alfa", [ALFA]));

    expect(unidadesNaTabela()).toEqual([BETA.code]);
    expect(hospedeiro.textContent).not.toContain("atualizando…");

    await clicar("Excel");

    expect(planilha.entradas[0]?.recorte).toBe("Beta");
    expect(planilha.entradas[0]?.unidades.map((u) => u.code)).toEqual([BETA.code]);
    expect(baixados).toEqual(["carteira-beta-2026-09-29.xlsx"]);
  });

  it("sem empreendimento escolhido, o arquivo é de Todos e leva todas as unidades", async () => {
    rota = () => dados(null, [ALFA, BETA]);
    await montar();

    await clicar("Excel");

    expect(planilha.entradas[0]?.recorte).toBeNull();
    expect(planilha.entradas[0]?.unidades).toHaveLength(2);
    expect(baixados).toEqual(["carteira-2026-09-29.xlsx"]);
  });

  it("⚠️ o 'Consultado em' do arquivo é a hora da lista de unidades, e não a dos Indicadores", async () => {
    rota = () => dados(null, [ALFA]);
    await montar(); // 17:32 UTC = 14:32 em São Paulo.

    vi.setSystemTime(new Date("2026-09-29T18:10:00.000Z")); // 15:10 em São Paulo.
    await clicar("Indicadores");
    await clicar("Carteira");

    // O cabeçalho continua dizendo a última consulta de qualquer aba (é o combinado da tela)...
    expect(hospedeiro.textContent).toContain("Consultado às 15:10");

    await clicar("Excel");

    // ...e o arquivo leva a hora em que as unidades dele foram lidas, que não foram relidas.
    const listas = vi
      .mocked(fetch)
      .mock.calls.map(([url]) => String(url))
      .filter((url) => !url.includes("indicadores=1"));
    expect(listas).toHaveLength(1);
    const consultadoEm = planilha.entradas[0]?.consultadoEm;
    expect(consultadoEm instanceof Date ? consultadoEm.toISOString() : consultadoEm).toBe(
      "2026-09-29T17:32:00.000Z",
    );
  });
});
