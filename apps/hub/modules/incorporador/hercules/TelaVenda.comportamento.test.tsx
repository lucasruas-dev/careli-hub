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
// ⚠️ A MODAL É DUBLÊ, MAS GUARDA O QUE RECEBEU (revisão de 25/09/2026). `alvoDoCancelamento` é a linha
// que decide para QUAL ROTA o clique vai, e sem isto ela não tinha teste nenhum: quem simplificasse
// `alvo` de volta para `cancelando.etapa === "proposta" ? "proposta" : "reserva"` passaria com toda a
// suíte verde e mandaria as 11 herdadas em `reservado` para a rota da reserva, que não tem o que
// cancelar. A modal em si já tem teste próprio por alvo (`ModalDeCancelamento.lote.comportamento`); o
// que falta é o ELO, e é isso que estes props provam.
const modalDeCancelamento = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));

vi.mock("./ModalDeCancelamento", () => ({
  ModalDeCancelamento: (props: Record<string, unknown>) => {
    modalDeCancelamento.props = props;
    return null;
  },
}));
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
  modalDeCancelamento.props = null;
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

// ── A VENDA HERDADA DO C2X VOLTA A TER BOTÃO (Lucas, 25/09/2026) ────────────────
//
// Lucas, 25/09/2026: *"As reservas que foram herdadas do c2x, nao estamos conseguindo cancelar ou
// dar seguimento na proposta. Essas reservas tem que comportar iguais as outras"*.
//
// ⚠️ A RECUSA ERA DA TELA PRIMEIRO, E DA ROTA ATRÁS. `processoDaFicha` devolvia
// `{ causa: "reserva-do-legado", tipo: "apagado" }` para a herdada em `reservado`, isso virava
// `travaDaFicha`, e a trava reescreve TODAS as ações com `ativo: false`. Acender o botão sem mexer no
// alvo da modal mandaria o clique para a rota da RESERVA, que é justamente a que não tem o que
// cancelar (a carga nunca criou linha em `hercules_reservas`): trocaria botão apagado por 409.
//
// ⚠️ E A TELA NÃO PROMETE O QUE A ROTA RECUSA. "Gerar proposta" sobre a herdada continua apagado, com
// o motivo verdadeiro, porque a rota que gera proposta ainda exige reserva do Hércules.

const herdadaReservada = {
  ...reservaDoHercules,
  cliente_nome: "NIVEA CARELI PEREIRA DE AVELAR",
  etapa: "reservado",
  id: "p-herdada",
  origem: "c2x",
  protocolo_numero: null,
  unidade_id: "u-herdada",
  unidade_nome: "01 05",
} as PropostaDaCarga;

const herdadaProposta = {
  ...herdadaReservada,
  etapa: "proposta",
  id: "p-herdada-proposta",
  unidade_id: "u-herdada-proposta",
  unidade_nome: "01 06",
} as PropostaDaCarga;

const DADOS_HERDADA = {
  ...agregarFluxo({
    propostas: [herdadaReservada, herdadaProposta],
    situacaoPorUnidade: new Map([
      ["u-herdada", "reservado"],
      ["u-herdada-proposta", "proposta"],
    ]),
    unidades: [unidade("u-herdada", "05"), unidade("u-herdada-proposta", "06")],
  }),
  escritaPorEmpreendimento: { "39": true },
};

describe("TelaVenda: a herdada do C2X se cancela aqui", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (/^\/api\/incorporador\/venda(\?|$)/.test(url)) return resposta({ data: DADOS_HERDADA });
        if (url.startsWith("/api/incorporador/produtos/painel")) return resposta({ data: { linhas: [] } });
        if (url.startsWith("/api/incorporador/produtos")) return resposta({ data: { produtos: [] } });
        if (url.startsWith("/api/incorporador/espelho")) return resposta({ data: { produtos: [] } });
        return resposta({}, false);
      }),
    );
  });

  it("⚠️ reserva herdada: Cancelar ATIVO, com o rótulo da reserva e sem falar do C2X", async () => {
    await montar();
    await clicarNoLote("Q01L05");

    expect(container.textContent ?? "").not.toContain("Fale com a coordenação");
    expect(botao("Cancelar reserva")?.disabled).toBe(false);
    // ⚠️ O MOTIVO DO CANCELAR NÃO MANDA MAIS NINGUÉM AO LEGADO. A única frase da ficha que ainda diz
    // "C2X" é a do Gerar proposta, e ali ela é a verdade: essa porta continua fechada (ver o caso
    // abaixo). Reservar fica apagado porque o lote está reservado, como em qualquer reserva.
    expect(botao("Cancelar reserva")?.getAttribute("title") ?? "").not.toContain("C2X");
    expect(botao("Reservar")?.disabled).toBe(true);
  });

  it("⚠️ no mesmo lote, Gerar proposta continua APAGADO e o motivo diz por quê", async () => {
    await montar();
    await clicarNoLote("Q01L05");

    const gerar = botao("Gerar proposta");
    expect(gerar?.disabled).toBe(true);
    expect(gerar?.getAttribute("title") ?? "").toContain("veio do C2X");
    // ⚠️ E O MOTIVO NÃO DÁ CONSELHO QUE NÃO FUNCIONA (revisão de 25/09/2026). Ele mandava "Cancele e
    // reserve de novo", e em 6 das 11 esse caminho está fechado: para SDT, MDB, CDJ e HDP há ZERO
    // imobiliárias vinculadas em `apolo_relationships` (medido em 25/09/2026 no projeto
    // bxgukywoxgivlrhjkwjx, só SELECT), então a modal de reserva sairia vazia. Quem seguisse perderia a
    // reserva herdada sem conseguir criar a nova.
    expect(gerar?.getAttribute("title") ?? "").not.toContain("reserve de novo");
  });

  it("⚠️ proposta herdada: Enviar para contrato ATIVO e Cancelar proposta ATIVO", async () => {
    await montar();
    await clicarNoLote("Q01L06");

    expect(botao("Enviar para contrato")?.disabled).toBe(false);
    expect(botao("Cancelar proposta")?.disabled).toBe(false);
    const titulos = [...container.querySelectorAll("button")].map((b) => b.getAttribute("title") ?? "");
    expect(titulos.some((t) => t.includes("C2X"))).toBe(false);
  });
});

// ── O ELO ENTRE O BOTÃO E A ROTA (revisão de 25/09/2026) ─────────────────────────
//
// ⚠️ `alvoDoCancelamento` É "A ARMADILHA QUE MATARIA TUDO", E NÃO TINHA TESTE. Ela decide se o clique
// vai para a rota da proposta ou para a da reserva. Os casos acima só olham `disabled` e `title`, e os da
// modal recebem o alvo pronto: quem trocasse a linha por `cancelando.etapa === "proposta" ? "proposta" :
// "reserva"` (a forma mais curta, e a que o arquivo tinha antes) passaria com tudo verde e mandaria as 11
// herdadas em `reservado` para `/api/incorporador/venda/reserva`, que exige linha viva em
// `hercules_reservas` e não acha nenhuma (ZERO para as 13, medido em 25/09/2026 no projeto
// bxgukywoxgivlrhjkwjx): botão apagado com explicação viraria 409 sem explicação.

describe("TelaVenda: para qual rota o Cancelar vai", () => {
  it("⚠️ herdada em `reservado`: alvo `reserva_do_legado`, com o id da linha da proposta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (/^\/api\/incorporador\/venda(\?|$)/.test(url)) return resposta({ data: DADOS_HERDADA });
        if (url.startsWith("/api/incorporador/produtos/painel")) return resposta({ data: { linhas: [] } });
        if (url.startsWith("/api/incorporador/produtos")) return resposta({ data: { produtos: [] } });
        if (url.startsWith("/api/incorporador/espelho")) return resposta({ data: { produtos: [] } });
        return resposta({}, false);
      }),
    );
    await montar();
    await clicarNoLote("Q01L05");

    await act(async () => {
      botao("Cancelar reserva")?.click();
    });

    expect(modalDeCancelamento.props?.alvo).toBe("reserva_do_legado");
    expect(modalDeCancelamento.props?.propostaId).toBe("p-herdada");
  });

  it("herdada em `proposta`: alvo `proposta`", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (/^\/api\/incorporador\/venda(\?|$)/.test(url)) return resposta({ data: DADOS_HERDADA });
        if (url.startsWith("/api/incorporador/produtos/painel")) return resposta({ data: { linhas: [] } });
        if (url.startsWith("/api/incorporador/produtos")) return resposta({ data: { produtos: [] } });
        if (url.startsWith("/api/incorporador/espelho")) return resposta({ data: { produtos: [] } });
        return resposta({}, false);
      }),
    );
    await montar();
    await clicarNoLote("Q01L06");

    await act(async () => {
      botao("Cancelar proposta")?.click();
    });

    expect(modalDeCancelamento.props?.alvo).toBe("proposta");
    expect(modalDeCancelamento.props?.propostaId).toBe("p-herdada-proposta");
  });

  it("reserva DO HÉRCULES: alvo `reserva`, como sempre", async () => {
    await montar();
    await clicarNoLote("Q01L02");

    await act(async () => {
      botao("Cancelar reserva")?.click();
    });

    expect(modalDeCancelamento.props?.alvo).toBe("reserva");
  });
});
