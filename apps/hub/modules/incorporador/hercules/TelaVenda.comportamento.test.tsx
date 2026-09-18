// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { agregarFluxo, type PropostaDaCarga, type UnidadeDoMapa } from "@/lib/hercules/fluxo-de-venda";

// A FICHA DA UNIDADE OBEDECE À RÉGUA QUE PINTA O LOTE.
//
// Lucas (18/09/2026): *"eu não posso vender dois lotes para pessoas diferentes"*. A grade pinta pela
// régua única, que vê o terreno inteiro e a reserva do salão; os botões e as rotas agem na linha da
// própria unidade. Lote pintado de reserva ou proposta SEM linha na lista (reserva do salão, linha
// antiga do pai) acendia "Gerar proposta" e "Cancelar reserva" para a rota recusar, e a ficha dizia
// que a proposta "veio do C2X" sem ter linha nenhuma para saber.
//
// ⚠️ POR QUE UM TESTE DE TELA, ALÉM DO DA LIB. A decisão mora em `processoDaFicha` e tem teste
// próprio; o que este prova é a LIGAÇÃO: que a ficha passa a lista inteira, que os botões obedecem à
// trava e que a frase aparece. Typecheck verde não prova peça conectada.
//
// A montagem é a de `ModalDeProposta.comportamento.test.tsx` (React no global, `act` na mão). Os
// filhos pesados viram dublês: aqui só interessam a grade, a ficha e os botões.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./EspelhoDoProduto", () => ({ EspelhoDoProduto: () => null }));
vi.mock("./ConversaDaVenda", () => ({ ConversaDaVenda: () => null }));
vi.mock("./DocumentosDaVenda", () => ({ DocumentosDaVenda: () => null }));
vi.mock("./SimuladorDeProposta", () => ({ SimuladorDeProposta: () => null }));
vi.mock("./PreviaDoContrato", () => ({ PreviaDoContrato: () => null }));
vi.mock("./ModalDeCancelamento", () => ({ ModalDeCancelamento: () => null }));
vi.mock("./ModalDeContrato", () => ({ ModalDeContrato: () => null }));
vi.mock("./ModalDePedidoDeCancelamento", () => ({ ModalDePedidoDeCancelamento: () => null }));
vi.mock("./ModalDeProposta", () => ({ ModalDeProposta: () => null }));
vi.mock("./ModalDeReserva", () => ({ ModalDeReserva: () => null }));

import { TelaVenda } from "./TelaVenda";

const unidade = (id: string, lote: string): UnidadeDoMapa => ({
  codigo: `Q01L${lote}`,
  enterprise_id: "39",
  id,
  lote,
  preco_tabela: 100_000,
  quadra: "01",
  situacao: "disponivel",
});

/** A reserva do Hércules como a rota a entrega: `reservaComoLinhaDoFluxo`, com o id prefixado. */
const reservaDoHercules = {
  cliente_documento: null,
  cliente_nome: "MARIA DA SILVA",
  codigo: null,
  contrato_parcelas: null,
  criado_em_c2x: "2026-09-10T10:00:00Z",
  data_assinatura: null,
  data_ato: null,
  data_faturamento: null,
  empreendimento_codigo: null,
  etapa: "reservado",
  etapa_c2x: null,
  etapa_desde: "2026-09-10T10:00:00Z",
  id: "reserva:r-1",
  imobiliaria_nome: "GURGEL",
  motivo: null,
  plano_correcao: null,
  plano_juros: null,
  plano_nome: null,
  plano_parcelas: null,
  plano_personalizado: null,
  protocolo_numero: 123,
  unidade_id: "u-reserva",
  unidade_nome: "01 02",
  valor: 100_000,
} as PropostaDaCarga;

const DADOS = {
  ...agregarFluxo({
    propostas: [reservaDoHercules],
    // A régua única: o salão e a linha do pai pintam lotes que a lista desta tela não tem.
    situacaoPorUnidade: new Map([
      ["u-salao", "reservado"],
      ["u-reserva", "reservado"],
      ["u-pai", "proposta"],
      // Vendida no cadastro, sem proposta que sustente: o texto da régua é "Vendido".
      ["u-vendida", "vendida"],
    ]),
    unidades: [
      unidade("u-salao", "01"),
      unidade("u-reserva", "02"),
      unidade("u-pai", "03"),
      unidade("u-vendida", "04"),
    ],
  }),
  escritaPorEmpreendimento: { "39": true },
};

const resposta = (corpo: unknown, ok = true) => ({
  json: async () => corpo,
  ok,
  status: ok ? 200 : 404,
  text: async () => JSON.stringify(corpo),
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  window.localStorage.setItem(
    "hercules:venda:lugar",
    JSON.stringify({ etapa: "reservado", visao: "mesa" }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (/^\/api\/incorporador\/venda(\?|$)/.test(url)) return resposta({ data: DADOS });
      if (url.startsWith("/api/incorporador/produtos/painel")) return resposta({ data: { linhas: [] } });
      if (url.startsWith("/api/incorporador/produtos")) return resposta({ data: { produtos: [] } });
      if (url.startsWith("/api/incorporador/espelho")) return resposta({ data: { produtos: [] } });
      return resposta({}, false);
    }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

async function montar() {
  await act(async () => {
    root.render(React.createElement(TelaVenda));
  });
  // A carga do fluxo e as das listas de produto: promessas encadeadas, e cada uma renderiza.
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function clicarNoLote(codigo: string) {
  const quadrado = [...container.querySelectorAll("button")].find((b) =>
    (b.getAttribute("title") ?? "").includes(`código ${codigo}`),
  );
  expect(quadrado, `lote ${codigo} na grade`).toBeTruthy();
  await act(async () => {
    quadrado!.click();
  });
}

const botao = (rotulo: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === rotulo) as
    | HTMLButtonElement
    | undefined;

describe("TelaVenda: a ficha obedece à régua", () => {
  it("⚠️ lote reservado pela régua sem linha na lista: botões apagados, com a frase à vista", async () => {
    await montar();
    await clicarNoLote("Q01L01");

    const texto = container.textContent ?? "";
    expect(texto).toContain("Reserva que esta tela não mostra");
    expect(texto).toContain("Fale com a coordenação");
    // A ficha não contradiz a cor: lote amarelo não diz "nenhuma proposta em andamento".
    expect(texto).not.toContain("Nenhuma proposta em andamento nesta unidade.");

    expect(botao("Gerar proposta")?.disabled).toBe(true);
    expect(botao("Cancelar reserva")?.disabled).toBe(true);
    expect(botao("Reservar")?.disabled).toBe(true);
    expect(botao("Gerar proposta")?.getAttribute("title")).toContain("Reserva que esta tela não mostra");
  });

  it("⚠️ proposta pela régua sem linha na lista NÃO vira \"veio do C2X\"", async () => {
    await montar();
    await clicarNoLote("Q01L03");

    const texto = container.textContent ?? "";
    expect(texto).toContain("Proposta que esta tela não mostra");
    const titulos = [...container.querySelectorAll("button")].map((b) => b.getAttribute("title") ?? "");
    expect(titulos.some((t) => t.includes("C2X"))).toBe(false);
    expect(botao("Enviar para contrato")?.disabled).toBe(true);
    expect(botao("Cancelar proposta")?.disabled).toBe(true);
  });

  it("⚠️ o texto é o da régua, e o \"sem proposta\" não some: vai para a dica", async () => {
    // Lucas (18/09/2026): *"quero é dentro do panteon tem que ter o mesmo status"*. A grade dizia
    // "Vendida sem proposta" do lote que a aba Unidades chama de "Vendido".
    await montar();

    const quadrado = [...container.querySelectorAll("button")].find((b) =>
      (b.getAttribute("title") ?? "").includes("código Q01L04"),
    );
    expect(quadrado?.getAttribute("title")).toContain("Vendido sem proposta");

    await clicarNoLote("Q01L04");
    const selo = [...container.querySelectorAll("span")].find((s) => s.textContent === "Vendido");
    expect(selo, "selo da unidade em foco").toBeTruthy();
    expect(selo?.getAttribute("title")).toContain("sem proposta");
    expect(container.textContent ?? "").not.toContain("Vendida sem proposta");
  });

  it("a reserva do Hércules da própria unidade continua operável", async () => {
    await montar();
    await clicarNoLote("Q01L02");

    expect(container.textContent ?? "").not.toContain("que esta tela não mostra");
    expect(botao("Gerar proposta")?.disabled).toBe(false);
    expect(botao("Cancelar reserva")?.disabled).toBe(false);
    expect(botao("Reservar")?.disabled).toBe(true);
  });
});
