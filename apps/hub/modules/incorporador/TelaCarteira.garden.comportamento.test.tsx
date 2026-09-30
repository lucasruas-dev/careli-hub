// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O GARDEN DO LSOFT NA CARTEIRA DO FINANCEIRO, NA TELA DE VERDADE (29/09/2026).
//
// Lucas: *"é só copiar e colar na carteira"*. A rota passou a mandar as unidades do Garden com
// `origem: "lsoft"` (lib/lsoft/carteira-no-financeiro.ts); o que se trava aqui é o que a TELA faz
// com elas:
//   • clicar na unidade do Garden abre a ficha do LSoft (com a API do portal), e não o modal de
//     parcelas do C2X, que não tem as parcelas dela;
//   • gravar na ficha (a baixa) só marca; FECHAR a ficha relê a carteira do mesmo recorte, uma vez,
//     e a releitura que falha mantém os números de antes com um aviso (revisão de 29/09/2026);
//   • o cabeçalho não chama o Garden de "carteira administrada pela Careli";
//   • o C2X fora com o Garden lido: a tela mostra o aviso do que ficou de fora;
//   • a unidade do C2X continua abrindo o modal de sempre;
//   • o líquido do Garden é "não apurado", o contrato é "-", e o Excel leva a unidade dele;
//   • a aba Indicadores avisa que os números do Garden ainda não entram lá;
//   • a falha da leitura do LSoft aparece na tela, em vez de um total menor calado.
// Tudo sintético: nenhum nome, CPF ou código de cliente real.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const registro = vi.hoisted(() => ({
  api: [] as unknown[],
  planilhas: [] as Array<{ unidades: readonly { code: string }[] }>,
}));

// A ficha do LSoft de mentira: mostra o código que recebeu e expõe os dois retornos do contrato.
vi.mock("@/modules/lsoft/CarteiraLsoft", () => ({
  PainelDoCliente: (props: { api: unknown; codigo: string; onFechar: () => void; onSalvou: () => void }) => {
    registro.api.push(props.api);
    return (
      <div data-ficha-lsoft={props.codigo}>
        <button onClick={props.onSalvou} type="button">
          Salvar ficha
        </button>
        <button onClick={props.onFechar} type="button">
          Fechar ficha
        </button>
      </div>
    );
  },
}));
vi.mock("@/modules/lsoft/api", () => ({ apiDoPortal: { porta: "portal" } }));

vi.mock("@/lib/apolo/incorporador/planilha-da-carteira-por-unidade", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/incorporador/planilha-da-carteira-por-unidade")>()),
  planilhaDaCarteiraPorUnidade: vi.fn(async (entrada: { unidades: readonly { code: string }[] }) => {
    registro.planilhas.push(entrada);
    return new ArrayBuffer(8);
  }),
}));

Object.assign(URL, { createObjectURL: vi.fn(() => "blob:teste"), revokeObjectURL: vi.fn() });

const { TelaCarteira } = await import("./TelaCarteira");

const RESUMO = {
  clients: 2,
  contracts: 2,
  criticalContracts: 0,
  delinquencyRate: 0,
  expectedToDate: 0,
  overdueAmount: 0,
  overdueClients: 0,
  overdueInstallments: 0,
  paidAmount: 20,
  recoveryAmount: 0,
  toReceiveAmount: 180,
  totalPortfolio: 200,
};

const DO_C2X = {
  block: "01",
  client: "Comprador Alfa",
  code: "VOC0101",
  contractCode: "1",
  empreendimento: "Vale do Ouro",
  faturadoAt: null,
  id: "501",
  imobiliaria: null,
  liquido: { bruto: 10, liquido: 7, parcelasPagas: 1, semLiquido: 0 },
  lot: "01",
  maxOverdueDays: 0,
  overdueAmount: 0,
  overdueInstallments: 0,
  paidAmount: 10,
  temContrato: true,
  toReceiveAmount: 90,
  totalContract: 100,
};

const DO_GARDEN = {
  avisos: ["O mesmo CPF também tem o lote Q06 L15."],
  block: "06",
  client: "Comprador Beta",
  code: "GDN0614",
  contractCode: null,
  empreendimento: "Garden",
  faturadoAt: null,
  id: "lsoft:C1",
  imobiliaria: null,
  liquido: null,
  lot: "14",
  lsoftCodigo: "C1",
  maxOverdueDays: 0,
  origem: "lsoft" as const,
  overdueAmount: 0,
  overdueInstallments: 0,
  paidAmount: 10,
  temContrato: false,
  toReceiveAmount: 90,
  totalContract: 100,
};

const LIQUIDO = { motivos: [], parcial: false, porSplit: 0, recebido: 0, recebidoBruto: 0, semLiquido: 0, total: 0 };

type Unidade = typeof DO_C2X | typeof DO_GARDEN;

const carteira = (
  units: Unidade[],
  lsoft: null | { aviso: null | string; unidades: number } = null,
  extra: { avisoDoC2x?: string; bruto?: typeof RESUMO } = {},
) => ({
  bruto: RESUMO,
  empreendimentos: [],
  filtro: null,
  indicadores: null,
  liquido: LIQUIDO,
  ...(lsoft ? { lsoft: { ...lsoft, empreendimentos: ["Garden"] } } : null),
  units,
  ...extra,
});

/** O texto do cabeçalho, com o espaço fixo do `toLocaleString` trocado pelo comum. */
const cabecalhoDaTela = () => (hospedeiro.querySelector("header p")?.textContent ?? "").replace(/\u00a0/g, " ");

let corpo: object;
let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  registro.api.length = 0;
  registro.planilhas.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const dados = url.includes("/api/incorporador/parcelas") ? { installments: [] } : corpo;
      return new Response(JSON.stringify({ data: dados }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function esperar() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Espera a ficha aparecer (ou desiste). A importação é estática desde a revisão de 29/09/2026. */
async function esperarAFicha() {
  for (let i = 0; i < 20 && !hospedeiro.querySelector("[data-ficha-lsoft]"); i += 1) await esperar();
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

async function clicarNoBotao(texto: string) {
  const alvo = botao(texto);
  expect(alvo, `botão "${texto}"`).toBeDefined();
  await act(async () => {
    alvo?.click();
  });
  await esperar();
}

const linha = (codigo: string) =>
  Array.from(hospedeiro.querySelectorAll<HTMLTableRowElement>("tbody tr")).find(
    (tr) => tr.querySelector("td p")?.textContent === codigo,
  );

async function clicarNaLinha(codigo: string) {
  const alvo = linha(codigo);
  expect(alvo, `linha ${codigo}`).toBeDefined();
  await act(async () => {
    alvo?.click();
  });
  await esperar();
}

const leiturasDaCarteira = () =>
  vi
    .mocked(fetch)
    .mock.calls.map(([url]) => String(url))
    .filter((url) => url.startsWith("/api/incorporador/carteira") && !url.includes("indicadores=1"));

const leiturasDeParcelas = () =>
  vi
    .mocked(fetch)
    .mock.calls.map(([url]) => String(url))
    .filter((url) => url.startsWith("/api/incorporador/parcelas"));

describe("a unidade do Garden (LSoft) na Carteira do Financeiro", () => {
  it("abre a ficha do LSoft com a API do portal, e não o modal de parcelas do C2X", async () => {
    corpo = carteira([DO_C2X, DO_GARDEN], { aviso: null, unidades: 1 });
    await montar();

    await clicarNaLinha("GDN0614");
    await esperarAFicha();

    expect(hospedeiro.querySelector("[data-ficha-lsoft]")?.getAttribute("data-ficha-lsoft")).toBe("C1");
    expect(registro.api.at(-1)).toEqual({ porta: "portal" });
    expect(leiturasDeParcelas()).toEqual([]);

    await clicarNoBotao("Fechar ficha");
    expect(hospedeiro.querySelector("[data-ficha-lsoft]")).toBeNull();
  });

  it("⚠️ gravar na ficha não relê a cada gravação; fechar a ficha relê o mesmo recorte UMA vez", async () => {
    corpo = carteira([DO_GARDEN], { aviso: null, unidades: 1 });
    await montar();
    expect(leiturasDaCarteira()).toHaveLength(1);

    await clicarNaLinha("GDN0614");
    await esperarAFicha();
    // Três gravações seguidas (cadastro, duas baixas): nenhuma consulta ao C2X por causa delas.
    await clicarNoBotao("Salvar ficha");
    await clicarNoBotao("Salvar ficha");
    await clicarNoBotao("Salvar ficha");
    expect(leiturasDaCarteira()).toHaveLength(1);
    expect(hospedeiro.querySelector("[data-ficha-lsoft]")).not.toBeNull();

    await clicarNoBotao("Fechar ficha");

    expect(leiturasDaCarteira()).toEqual(["/api/incorporador/carteira", "/api/incorporador/carteira"]);
    expect(hospedeiro.querySelector("[data-ficha-lsoft]")).toBeNull();
  });

  it("fechar a ficha sem gravar nada não relê a carteira", async () => {
    corpo = carteira([DO_GARDEN], { aviso: null, unidades: 1 });
    await montar();

    await clicarNaLinha("GDN0614");
    await esperarAFicha();
    await clicarNoBotao("Fechar ficha");

    expect(leiturasDaCarteira()).toHaveLength(1);
  });

  it("⚠️ a releitura que falha mantém a carteira na tela, com o aviso e o 'Tentar de novo'", async () => {
    corpo = carteira([DO_C2X, DO_GARDEN], { aviso: null, unidades: 1 });
    await montar();

    await clicarNaLinha("GDN0614");
    await esperarAFicha();
    await clicarNoBotao("Salvar ficha");
    // A releitura (no fechamento) cai no 503 do C2X.
    vi.mocked(fetch).mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: "Não foi possível carregar a carteira agora." }), {
          headers: { "content-type": "application/json" },
          status: 503,
        }),
    );
    await clicarNoBotao("Fechar ficha");

    // A tabela continua de pé (não virou a tela de erro), e diz que os números são os de antes.
    expect(linha("GDN0614")).toBeDefined();
    expect(linha("VOC0101")).toBeDefined();
    const alerta = Array.from(hospedeiro.querySelectorAll('[role="alert"]')).map((a) => a.textContent);
    expect(alerta.join(" ")).toContain("Não consegui atualizar a carteira depois da alteração na ficha.");
    expect(hospedeiro.textContent).not.toContain("Não foi possível carregar a carteira agora.");

    // "Tentar de novo" relê o mesmo recorte, e o aviso some quando a leitura volta.
    await clicarNoBotao("Tentar de novo");
    expect(leiturasDaCarteira()).toHaveLength(3);
    expect(hospedeiro.textContent).not.toContain("Não consegui atualizar a carteira");
  });

  it("a unidade do C2X continua abrindo o modal de parcelas de sempre", async () => {
    corpo = carteira([DO_C2X, DO_GARDEN], { aviso: null, unidades: 1 });
    await montar();

    await clicarNaLinha("VOC0101");

    expect(leiturasDeParcelas()).toEqual(["/api/incorporador/parcelas?unitId=501"]);
    expect(hospedeiro.querySelector("[data-ficha-lsoft]")).toBeNull();
  });

  it("líquido 'não apurado', contrato '-', e os avisos da linha à vista", async () => {
    corpo = carteira([DO_C2X, DO_GARDEN], { aviso: null, unidades: 1 });
    await montar();

    const celulas = Array.from(linha("GDN0614")?.querySelectorAll("td") ?? []).map((td) => td.textContent?.trim());
    // Unidade, comprador, faturado, VGV, pago, a receber, vencido, líquido, situação, contrato.
    expect(celulas[7]).toBe("não apurado");
    expect(celulas[9]).toBe("-");
    expect(celulas[0]).toContain("O mesmo CPF também tem o lote Q06 L15.");
    // A unidade do C2X segue com o líquido dela e o botão do contrato.
    expect(linha("VOC0101")?.querySelector('a[href*="/api/incorporador/contrato"]')).not.toBeNull();
    // O bloco do líquido explica por que o Garden não está nele.
    expect(hospedeiro.textContent).toContain("O Garden ainda não entra neste bloco");
  });

  it("recorte só do Garden: o bloco do líquido não mostra R$ 0,00", async () => {
    corpo = carteira([DO_GARDEN], { aviso: null, unidades: 1 });
    await montar();

    expect(hospedeiro.textContent).toContain("O valor líquido do Garden ainda não é apurado aqui.");
    expect(hospedeiro.textContent).not.toContain("Seu líquido recebido");
  });

  it("o Excel da Carteira por unidade leva a unidade do Garden", async () => {
    corpo = carteira([DO_C2X, DO_GARDEN], { aviso: null, unidades: 1 });
    await montar();

    await clicarNoBotao("Excel");

    expect(registro.planilhas[0]?.unidades.map((u) => u.code).sort()).toEqual(["GDN0614", "VOC0101"]);
  });

  it("a falha da leitura do LSoft aparece na tela", async () => {
    const aviso =
      "Não foi possível ler a carteira do Garden agora. Ela ficou fora desta tela; tente de novo em alguns minutos.";
    corpo = carteira([DO_C2X], { aviso, unidades: 0 });
    await montar();

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(aviso);
  });

  it("a aba Indicadores avisa que os números do Garden ainda não entram lá", async () => {
    corpo = carteira([DO_C2X, DO_GARDEN], { aviso: null, unidades: 1 });
    await montar();

    await clicarNoBotao("Indicadores");

    expect(hospedeiro.textContent).toContain("Os indicadores do Garden ainda não entram aqui");
  });

  it("sem o Garden no recorte, nada muda: nem aviso nos Indicadores, nem texto no líquido", async () => {
    corpo = carteira([DO_C2X]);
    await montar();

    expect(hospedeiro.textContent).not.toContain("Garden");
    // O cabeçalho de sempre.
    expect(cabecalhoDaTela()).toContain("2 contratos, R$ 200 de carteira administrada pela Careli.");
    await clicarNoBotao("Indicadores");
    expect(hospedeiro.textContent).not.toContain("Os indicadores do Garden");
  });

  it("⚠️ o cabeçalho separa a parte da Careli da do Garden (que não é administrada pela Careli)", async () => {
    corpo = carteira([DO_C2X, DO_GARDEN], { aviso: null, unidades: 1 });
    await montar();

    expect(cabecalhoDaTela()).toContain(
      "2 contratos, R$ 200 de carteira: R$ 100 administrada pela Careli e R$ 100 do Garden.",
    );
  });

  it("recorte só do Garden: o cabeçalho não fala em carteira administrada pela Careli", async () => {
    corpo = carteira([DO_GARDEN], { aviso: null, unidades: 1 }, {
      bruto: { ...RESUMO, clients: 1, contracts: 1, paidAmount: 10, toReceiveAmount: 90, totalPortfolio: 100 },
    });
    await montar();

    expect(cabecalhoDaTela()).toContain("1 contratos, R$ 100 de carteira do Garden.");
    expect(cabecalhoDaTela()).not.toContain("administrada pela Careli");
  });

  it("o C2X fora com o Garden lido: a tela mostra o Garden e avisa o que ficou de fora", async () => {
    const avisoDoC2x =
      "Não foi possível ler a carteira do Vale do Ouro agora. Ela ficou fora desta tela; tente de novo em alguns minutos.";
    corpo = carteira([DO_GARDEN], { aviso: null, unidades: 1 }, { avisoDoC2x });
    await montar();

    expect(linha("GDN0614")).toBeDefined();
    expect(Array.from(hospedeiro.querySelectorAll('[role="alert"]')).map((a) => a.textContent)).toEqual([
      avisoDoC2x,
    ]);
  });
});
