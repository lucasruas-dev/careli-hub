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
/** O que a rota dos pagamentos a conferir responde (30/09/2026). Vazia = o bloco não aparece. */
let aConferir: { conferidoDisponivel: boolean; conferir: object[]; integracao: object[] };
let raiz: Root;
let hospedeiro: HTMLDivElement;

const ROTA_DE_CONFERIR = "/api/incorporador/carteira/conferir";

beforeEach(() => {
  registro.api.length = 0;
  registro.planilhas.length = 0;
  aConferir = { conferidoDisponivel: true, conferir: [], integracao: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, opcoes?: RequestInit) => {
      const dados = url.startsWith(ROTA_DE_CONFERIR)
        ? opcoes?.method === "POST"
          ? { ok: true }
          : aConferir
        : url.includes("/api/incorporador/parcelas")
          ? { installments: [] }
          : corpo;
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
    .filter(
      (url) =>
        url.startsWith("/api/incorporador/carteira") &&
        !url.startsWith(ROTA_DE_CONFERIR) &&
        !url.includes("indicadores=1"),
    );

/** As chamadas à rota dos pagamentos a conferir, com o método e o corpo. */
const chamadasDeConferir = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).startsWith(ROTA_DE_CONFERIR))
    .map(([, opcoes]) => ({
      corpo: typeof opcoes?.body === "string" ? (JSON.parse(opcoes.body) as unknown) : null,
      metodo: opcoes?.method ?? "GET",
    }));

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

// ── PAGAMENTOS A CONFERIR (Lucas, 30/09/2026: "pode fazer a lista de pagamentos a conferir") ──
// O bloco do que a baixa do hub não resolveu sozinha. A régua da lista tem teste próprio em
// lib/lsoft/pagamentos-a-conferir.test.ts; aqui se trava o que a TELA faz com ela.

const A_CONFERIR = {
  clienteCodigo: "C9",
  clienteNome: "CLIENTE DO LOTE TROCADO",
  cobrancaId: "pay_lote",
  competencia: "2026-09",
  conferidoAntes: null as null | { em: string; observacao: string; por: string },
  detalhe: null,
  impressao: "0123456789abcdef",
  motivo: "Não há parcela deste lote vencendo neste mês na ficha do cliente.",
  pagoEm: "2026-09-21",
  parcela: null,
  unidade: "Q13 L10",
  valorPago: 2201.02,
};

const NA_INTEGRACAO = {
  ...A_CONFERIR,
  clienteCodigo: null,
  clienteNome: null,
  cobrancaId: "pay_rotina",
  impressao: "fedcba9876543210",
  motivo: "Boleto pago, e a parcela está em aberto na ficha. Falta dar a baixa.",
  unidade: "Q15 L20",
};

const textoDaTela = () => (hospedeiro.textContent ?? "").replace(/\u00a0/g, " ");

describe("pagamentos a conferir no Financeiro do Garden", () => {
  it("sem nada a conferir, o bloco não aparece (a tela fica como era)", async () => {
    corpo = carteira([DO_GARDEN], { aviso: null, unidades: 1 });
    await montar();

    expect(chamadasDeConferir()).toEqual([{ corpo: null, metodo: "GET" }]);
    expect(textoDaTela()).not.toContain("Pagamentos a conferir");
  });

  it("sem o Garden do LSoft no recorte, a lista nem é pedida", async () => {
    corpo = carteira([DO_C2X], null);
    await montar();

    expect(chamadasDeConferir()).toEqual([]);
  });

  it("mostra os dois grupos com a contagem, o valor, a data e o motivo", async () => {
    corpo = carteira([DO_GARDEN], { aviso: null, unidades: 1 });
    aConferir = { conferidoDisponivel: true, conferir: [A_CONFERIR], integracao: [NA_INTEGRACAO] };
    await montar();

    const texto = textoDaTela();
    expect(texto).toContain("Pagamentos a conferir (1)");
    expect(texto).toContain("Boletos pagos com a parcela em aberto na LSoft Integração (1)");
    expect(texto).toContain("CLIENTE DO LOTE TROCADO");
    expect(texto).toContain("Q13 L10");
    expect(texto).toContain("09/2026");
    expect(texto).toContain("21/09/2026");
    expect(texto).toContain("R$ 2.201,02");
    expect(texto).toContain(A_CONFERIR.motivo);
    // Sem dono único do lote, a linha não promete um nome nem uma ficha.
    expect(texto).toContain("Cliente não identificado");
    expect(texto).not.toContain("—");
  });

  it("o botão Ficha abre a ficha do cliente da lista", async () => {
    corpo = carteira([DO_GARDEN], { aviso: null, unidades: 1 });
    aConferir = { conferidoDisponivel: true, conferir: [A_CONFERIR], integracao: [] };
    await montar();

    await clicarNoBotao("Ficha");
    await esperarAFicha();

    expect(hospedeiro.querySelector("[data-ficha-lsoft]")?.getAttribute("data-ficha-lsoft")).toBe("C9");
  });

  it("⚠️ Conferido manda SÓ a cobrança, a observação e a impressão do motivo visto, e tira a linha sem reler", async () => {
    corpo = carteira([DO_GARDEN], { aviso: null, unidades: 1 });
    aConferir = { conferidoDisponivel: true, conferir: [A_CONFERIR], integracao: [] };
    await montar();

    await clicarNoBotao("Conferido");
    const campo = hospedeiro.querySelector<HTMLInputElement>('input[aria-label="O que foi conferido"]');
    expect(campo).not.toBeNull();
    // Sem observação, o Confirmar não grava.
    expect(botao("Confirmar")?.disabled).toBe(true);

    await act(async () => {
      const definir = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      definir?.call(campo, "baixa dada na ficha");
      campo?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clicarNoBotao("Confirmar");

    // Sem segundo GET: a linha sai do estado da tela (reler custava a lista inteira a cada clique).
    expect(chamadasDeConferir()).toEqual([
      { corpo: null, metodo: "GET" },
      {
        corpo: { cobrancaId: "pay_lote", impressao: "0123456789abcdef", observacao: "baixa dada na ficha" },
        metodo: "POST",
      },
    ]);
    expect(textoDaTela()).not.toContain("Pagamentos a conferir");
  });

  it("antes da migration 0200, a lista aparece sem o botão Conferido", async () => {
    corpo = carteira([DO_GARDEN], { aviso: null, unidades: 1 });
    aConferir = { conferidoDisponivel: false, conferir: [A_CONFERIR], integracao: [] };
    await montar();

    expect(textoDaTela()).toContain("Pagamentos a conferir (1)");
    expect(botao("Conferido")).toBeUndefined();
    expect(botao("Ficha")).toBeDefined();
  });

  it("⚠️ resposta fora do formato não derruba o Financeiro: o bloco some e a carteira fica", async () => {
    corpo = carteira([DO_GARDEN], { aviso: null, unidades: 1 });
    aConferir = { qualquer: "coisa" } as never;
    await montar();

    expect(linha("GDN0614")).toBeDefined();
    expect(textoDaTela()).not.toContain("Pagamentos a conferir");
  });
});

describe("pagamentos a conferir: o que mudou no servidor e o que já foi conferido", () => {
  it("⚠️ o servidor recusa (409) quando o motivo mudou: a tela mostra o aviso e relê a lista", async () => {
    corpo = carteira([DO_GARDEN], { aviso: null, unidades: 1 });
    aConferir = { conferidoDisponivel: true, conferir: [A_CONFERIR], integracao: [] };
    await montar();

    await clicarNoBotao("Conferido");
    const campo = hospedeiro.querySelector<HTMLInputElement>('input[aria-label="O que foi conferido"]');
    await act(async () => {
      const definir = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      definir?.call(campo, "lote corrigido");
      campo?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    vi.mocked(fetch).mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: "Este pagamento mudou desde que a lista foi aberta. Confira de novo." }), {
          headers: { "content-type": "application/json" },
          status: 409,
        }),
    );
    await clicarNoBotao("Confirmar");

    expect(chamadasDeConferir().map((chamada) => chamada.metodo)).toEqual(["GET", "POST", "GET"]);
    expect(textoDaTela()).toContain("Este pagamento mudou desde que a lista foi aberta.");
    // A linha continua na lista: nada foi conferido.
    expect(textoDaTela()).toContain("Pagamentos a conferir (1)");
  });

  it("a cobrança que voltou por outro motivo diz quem conferiu antes, e o quê", async () => {
    corpo = carteira([DO_GARDEN], { aviso: null, unidades: 1 });
    aConferir = {
      conferidoDisponivel: true,
      conferir: [
        {
          ...A_CONFERIR,
          conferidoAntes: { em: "2026-09-30T11:00:00Z", observacao: "lote corrigido na ficha", por: "Usuária Teste (cecilio-rocha)" },
        },
      ],
      integracao: [],
    };
    await montar();

    expect(textoDaTela()).toContain("Já conferido em 30/09/2026 por Usuária Teste (cecilio-rocha): lote corrigido na ficha");
  });
});
