// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  montarExtratoDoContrato,
  TIPO_ATO,
  TIPO_MENSAL,
  type ExtratoClienteContrato,
  type ExtratoClienteData,
  type ExtratoClienteParcelaBruta,
} from "@/lib/apolo/extrato-cliente";
import type { ApoloEntity } from "@/lib/apolo/types";

import { ExtratoClientePanel } from "./extrato-cliente-panel";

// O PAINEL DO EXTRATO, EXERCITADO DE PONTA A PONTA NA CONFERÊNCIA DA CORRETAGEM (jsdom).
//
// ⚠️ DOIS DEFEITOS QUE SÓ UM TESTE DE COMPORTAMENTO PEGA (01/10/2026, segunda revisão da Publicação):
//   1. "Conferência registrada" ficava na tela ao abrir o CLIENTE seguinte: o estado era limpo só ao
//      trocar de contrato, e o painel reaproveitava o mesmo componente para outro `c2xId`.
//   2. O "Ver ou corrigir" só aparecia depois de gerar a simulação (vinha do header do PDF), e quem
//      acabara de registrar não tinha como conferir o que digitou.
//
// ⚠️ IMPORT ESTÁTICO, E SEM `await import` NO TOPO: o `await import` no topo de um arquivo de teste
// travou o worker do vitest na suíte inteira ("Errors 1", "Timeout calling onTaskUpdate") com todos
// os testes verdes. Os `vi.mock` abaixo são içados pelo vitest e valem para o import estático.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const estado = vi.hoisted(() => ({
  /** Quais pedidos ficam PENDURADOS até o teste resolver ("pdf-termo", "pdf-extrato", "put"). */
  pendurar: new Set<string>(),
  papel: "admin" as string,
  pendentes: [] as Array<{ resolver: (resposta: unknown) => void; signal: AbortSignal | undefined; url: string }>,
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ hubUser: { role: estado.papel } }),
}));

vi.mock("../../data/apolo-operations", () => ({
  getApoloAccessToken: async () => "token-de-teste",
}));

const HOJE = "2026-10-01";

function contratoDe(id: number, codigo: string): ExtratoClienteContrato {
  return {
    area: 400,
    codigo,
    dataAssinatura: null,
    dataAto: "2025-01-10",
    empreendimentoCodigo: "REP",
    empreendimentoNome: "RECANTO DO PARA",
    encerrado: false,
    estagio: 4,
    estagioNome: "Faturado",
    id,
    indiceCorrecao: "IPCA ANUAL",
    jurosContratuais: null,
    lote: "01",
    planoPadraoParcelas: 120,
    planoParcelas: 120,
    planoPersonalizado: false,
    precoTabela: 150000,
    quadra: "01",
    titulares: [{ documentoMascarado: "***.123.456-**", nome: "CLIENTE DE TESTE", ordem: 1, percentual: null }],
  };
}

function parcela(sobre: Partial<ExtratoClienteParcelaBruta> & { id: number }): ExtratoClienteParcelaBruta {
  return {
    aExcluir: false,
    boletoUrl: "https://asaas.test/boleto",
    competencia: null,
    descricao: null,
    faturaUrl: null,
    juros: 0,
    multa: 0,
    pagamento: null,
    parcelaAtual: null,
    parcelaTotal: 120,
    sinalAtual: null,
    sinalTotal: null,
    statusId: 6,
    tipo: "Parcela",
    tipoId: TIPO_MENSAL,
    valorInicial: 0,
    valorPago: 0,
    vencimento: null,
    ...sobre,
  };
}

function extratoDe(c2xId: number, contratoId: number, codigo: string): ExtratoClienteData {
  const relatorio = montarExtratoDoContrato({
    contrato: contratoDe(contratoId, codigo),
    hoje: HOJE,
    parcelas: [
      parcela({
        id: contratoId * 10 + 1,
        pagamento: "2025-01-10",
        statusId: 5,
        tipo: "Ato",
        tipoId: TIPO_ATO,
        valorInicial: 15000,
        valorPago: 15000,
        vencimento: "2025-01-10",
      }),
      parcela({ id: contratoId * 10 + 2, parcelaAtual: 1, statusId: 7, valorInicial: 1200, vencimento: "2026-08-10" }),
      parcela({ id: contratoId * 10 + 3, parcelaAtual: 2, valorInicial: 1200, vencimento: "2026-12-10" }),
    ],
  });

  return {
    cliente: { c2xId, documentoMascarado: "***.123.456-**", nome: `CLIENTE ${c2xId}` },
    contratos: [relatorio],
    posicaoEm: HOJE,
  };
}

/** Dois contratos do mesmo cliente: é o que o seletor de contrato precisa. */
function extratoDeDoisContratos(c2xId: number): ExtratoClienteData {
  const a = extratoDe(c2xId, 3001, "REPE201");
  const b = extratoDe(c2xId, 3002, "REPE202");
  return { ...a, contratos: [...a.contratos, ...b.contratos] };
}

const EXTRATOS: Record<number, ExtratoClienteData> = {
  77: extratoDe(77, 2417, "REPE186"),
  88: extratoDe(88, 2383, "REPE193"),
  99: extratoDeDoisContratos(99),
};

const entidade = (c2xId: number): ApoloEntity =>
  ({
    commercialLinks: [],
    hadesClientId: `hades-${c2xId}`,
    isBuyer: true,
    profiles: ["usuario"],
  }) as unknown as ApoloEntity;

type Chamada = { metodo: string; url: string };

let raiz: Root;
let recipiente: HTMLElement;
let chamadas: Chamada[];

beforeEach(() => {
  estado.papel = "admin";
  estado.pendurar = new Set();
  estado.pendentes = [];
  recipiente = document.createElement("div");
  document.body.appendChild(recipiente);
  raiz = createRoot(recipiente);
  chamadas = [];

  vi.stubGlobal("fetch", async (url: string, init?: { method?: string; signal?: AbortSignal }) => {
    const metodo = init?.method ?? "GET";
    chamadas.push({ metodo, url });

    // Pedido pendurado: só resolve quando o teste mandar (é como se o servidor demorasse).
    const tipo = url.startsWith("/api/apolo/rescisao/pdf")
      ? "pdf-termo"
      : url.startsWith("/api/apolo/extrato-cliente/pdf")
        ? "pdf-extrato"
        : url === "/api/apolo/rescisao/conferencia-corretagem" && metodo === "PUT"
          ? "put"
          : null;
    if (tipo && estado.pendurar.has(tipo)) {
      return new Promise((resolver) => {
        estado.pendentes.push({ resolver, signal: init?.signal, url });
      });
    }

    const extrato = /^\/api\/apolo\/extrato-cliente\?c2xId=(\d+)$/.exec(url);
    if (extrato) {
      return { headers: new Headers(), json: async () => ({ data: EXTRATOS[Number(extrato[1])] }), ok: true };
    }
    if (url.startsWith("/api/apolo/rescisao/pdf")) {
      return {
        headers: new Headers(),
        json: async () => ({
          error: "O termo de rescisão não sai para a unidade REPE186 sem conferência: corretagem zero.",
          motivo: "corretagem_zero",
        }),
        ok: false,
      };
    }
    if (url === "/api/apolo/rescisao/conferencia-corretagem" && metodo === "PUT") {
      return {
        headers: new Headers(),
        json: async () => ({ data: { contrato: 2417, resultado: "com_corretagem", valor: 7000 } }),
        ok: true,
      };
    }
    throw new Error(`fetch inesperado: ${metodo} ${url}`);
  });
});

afterEach(() => {
  act(() => raiz.unmount());
  recipiente.remove();
  vi.unstubAllGlobals();
});

function renderizar(c2xId: number) {
  act(() => {
    raiz.render(<ExtratoClientePanel entity={entidade(c2xId)} />);
  });
}

async function esperar() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function texto(): string {
  return (recipiente.textContent ?? "").replace(/\s+/g, " ").trim();
}

function botao(rotulo: string): HTMLButtonElement {
  const achado = [...recipiente.querySelectorAll("button")].find((b) => b.textContent?.trim() === rotulo);
  if (!achado) throw new Error(`botão "${rotulo}" não encontrado em: ${texto().slice(0, 400)}`);
  return achado as HTMLButtonElement;
}

function clicar(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function digitar(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function campoPorRotulo(rotulo: string) {
  const label = [...recipiente.querySelectorAll("label")].find((l) => l.textContent?.trim() === rotulo)!;
  return document.getElementById(label.htmlFor) as HTMLInputElement & HTMLTextAreaElement;
}

/** Abre o painel do cliente 77, pede a simulação e registra "houve corretagem de R$ 7.000,00". */
async function registrarConferenciaDoCliente77() {
  renderizar(77);
  await esperar();
  clicar(botao("Rescisão"));
  await esperar();

  clicar(recipiente.querySelectorAll('input[type="radio"]')[1]!);
  digitar(campoPorRotulo("Valor da corretagem em reais"), "7.000");
  digitar(campoPorRotulo("Observação da conferência"), "Cláusula 3.2 do contrato assinado.");
  clicar(botao("Salvar"));
  clicar(botao("Confirmar"));
  await esperar();
}

describe("a conferência no painel, para a coordenação", () => {
  it("a recusa da corretagem zero abre o formulário (pelo código da rota)", async () => {
    renderizar(77);
    await esperar();
    expect(texto()).not.toContain("Registrar conferência da corretagem");

    clicar(botao("Rescisão"));
    await esperar();

    expect(texto()).toContain("Registrar conferência da corretagem");
    expect(texto()).toContain("sem conferência: corretagem zero.");
  });

  // ⚠️ ITEM 2: o link aparece logo depois de registrar, SEM gerar o PDF de novo.
  it("depois de registrar, 'Ver ou corrigir' já aparece, sem gerar a simulação", async () => {
    await registrarConferenciaDoCliente77();

    const status = recipiente.querySelector('[role="status"]')!;
    expect(status.textContent).toContain(
      "Conferência registrada: houve corretagem de R$ 7.000,00 (sete mil reais). Clique em Rescisão para gerar a simulação.",
    );
    expect(texto()).toContain("Corretagem conferida no contrato assinado.");
    expect(texto()).toContain("Ver ou corrigir");
    expect(texto()).not.toContain("Registrar conferência da corretagem");
    // Um só pedido de PDF: o da recusa. O link não dependeu de gerar outro.
    expect(chamadas.filter((c) => c.url.startsWith("/api/apolo/rescisao/pdf"))).toHaveLength(1);
  });

  // ⚠️ ITEM 1: trocar de CLIENTE limpa a mensagem, o link e o formulário.
  it("ao abrir o cliente seguinte, a mensagem, o link e o formulário do anterior somem", async () => {
    await registrarConferenciaDoCliente77();
    expect(texto()).toContain("Conferência registrada");

    renderizar(88);
    await esperar();

    // O contrato do cliente 88 (REPE193) é a prova de que o extrato novo carregou.
    expect(texto()).toContain("REPE193");
    expect(texto()).not.toContain("REPE186");
    expect(texto()).not.toContain("Conferência registrada");
    expect(texto()).not.toContain("Corretagem conferida no contrato assinado.");
    expect(texto()).not.toContain("Ver ou corrigir");
    expect(texto()).not.toContain("Registrar conferência da corretagem");
    expect(recipiente.querySelector('[role="status"]')?.textContent).toBe("");
  });

  it("a região de status fica na tela desde o começo (é o que o leitor de tela anuncia)", async () => {
    renderizar(77);
    await esperar();
    expect(recipiente.querySelector('[role="status"]')).toBeTruthy();
  });
});

// ⚠️ DEPOIS DE GRAVAR, O FOCO NÃO PODE CAIR NO body (01/10/2026, achado da revisão da Publicação da
// 1.403.1). O Confirmar sai da tela junto com o formulário, e quem usa teclado perdia o lugar. O foco
// vai para a mensagem de sucesso (role=status), que diz o que aconteceu e o próximo passo.
describe("o foco depois de gravar", () => {
  it("vai para a região de status com a mensagem de sucesso, e não para o body", async () => {
    await registrarConferenciaDoCliente77();

    const status = recipiente.querySelector('[role="status"]') as HTMLElement;
    expect(status.textContent).toContain("Conferência registrada");
    expect(document.activeElement).toBe(status);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("o 'Ver ou corrigir' vem logo depois na ordem da tela (um Tab chega nele)", async () => {
    await registrarConferenciaDoCliente77();

    const status = recipiente.querySelector('[role="status"]') as HTMLElement;
    const link = botao("Ver ou corrigir");
    expect(status.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ⚠️ CANCELAR AO TROCAR (decisão do Lucas, 01/10/2026: "cancelar ao trocar"). Antes, o PDF pedido para
// o cliente A e ainda a caminho, com o cliente B aberto, tinha dois defeitos: a FALHA de A sumia e o
// SUCESSO de A baixava o arquivo com a tela de B na frente, e o operador entregaria o papel do cliente
// errado. Cada teste prende o pedido de A (fetch pendurado), troca a tela e só então resolve.
describe("cancelar ao trocar de cliente", () => {
  const criarUrl = vi.fn(() => "blob:teste");

  beforeEach(() => {
    criarUrl.mockClear();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: criarUrl });
  });

  afterEach(() => {
    Reflect.deleteProperty(URL, "createObjectURL");
  });

  const pdfOk = () => ({
    blob: async () => new Blob(["%PDF"]),
    headers: new Headers({ "Content-Disposition": 'attachment; filename="Simulacao.pdf"' }),
    ok: true,
  });

  async function pedirTermoDeA() {
    estado.pendurar.add("pdf-termo");
    renderizar(77);
    await esperar();
    clicar(botao("Rescisão"));
    await esperar();
    expect(estado.pendentes).toHaveLength(1);
  }

  it("controle: sem trocar de cliente, o sucesso baixa (o teste enxerga o download)", async () => {
    await pedirTermoDeA();
    await act(async () => {
      estado.pendentes[0]!.resolver(pdfOk());
    });
    await esperar();

    expect(criarUrl).toHaveBeenCalledTimes(1);
  });

  it("o SUCESSO de A, resolvido depois da troca para B, não baixa nada", async () => {
    await pedirTermoDeA();
    const pedido = estado.pendentes[0]!;

    renderizar(88);
    await esperar();
    expect(pedido.signal?.aborted).toBe(true);

    await act(async () => {
      pedido.resolver(pdfOk());
    });
    await esperar();

    expect(criarUrl).not.toHaveBeenCalled();
    expect(texto()).toContain("REPE193");
  });

  // ⚠️ O CABEÇALHO JÁ CHEGOU, O CORPO AINDA NÃO: o `fetch` resolveu (não abortado), a troca de cliente
  // acontece enquanto o `blob()` lê o PDF, e é o `salvarPdf` que não pode baixar. É a segunda trava,
  // depois da checagem logo após o `fetch`.
  it("o corpo do PDF de A ainda chegando quando B abre: não baixa", async () => {
    await pedirTermoDeA();
    const pedido = estado.pendentes[0]!;

    let liberarCorpo: (blob: Blob) => void = () => undefined;
    const corpo = new Promise<Blob>((resolver) => {
      liberarCorpo = resolver;
    });
    await act(async () => {
      pedido.resolver({ blob: () => corpo, headers: new Headers(), ok: true });
    });

    renderizar(88);
    await esperar();
    await act(async () => {
      liberarCorpo(new Blob(["%PDF"]));
    });
    await esperar();

    expect(criarUrl).not.toHaveBeenCalled();
  });

  it("a FALHA de A, resolvida depois da troca para B, não aparece na tela de B", async () => {
    await pedirTermoDeA();
    const pedido = estado.pendentes[0]!;

    renderizar(88);
    await esperar();

    await act(async () => {
      pedido.resolver({
        headers: new Headers(),
        json: async () => ({ error: "Falha exclusiva do cliente A." }),
        ok: false,
      });
    });
    await esperar();

    expect(texto()).not.toContain("Falha exclusiva do cliente A.");
    expect(texto()).not.toContain("Registrar conferência da corretagem");
  });

  it("uma falha de REDE de A (fetch rejeitado) também some", async () => {
    await pedirTermoDeA();
    const pedido = estado.pendentes[0]!;

    renderizar(88);
    await esperar();
    await act(async () => {
      pedido.resolver(Promise.reject(new DOMException("aborted", "AbortError")));
    });
    await esperar();

    expect(texto()).not.toContain("Não foi possível gerar o termo de rescisão.");
  });

  it("o PDF do EXTRATO de A também é cancelado ao abrir B", async () => {
    estado.pendurar.add("pdf-extrato");
    renderizar(77);
    await esperar();
    clicar(botao("PDF"));
    await esperar();
    const pedido = estado.pendentes[0]!;

    renderizar(88);
    await esperar();
    expect(pedido.signal?.aborted).toBe(true);

    await act(async () => {
      pedido.resolver(pdfOk());
    });
    await esperar();
    expect(criarUrl).not.toHaveBeenCalled();
  });

  it("a gravação da conferência de A, resolvida em B, não escreve 'Conferência registrada' na tela de B", async () => {
    estado.pendurar.add("put");
    renderizar(77);
    await esperar();
    clicar(botao("Rescisão"));
    await esperar();
    clicar(recipiente.querySelectorAll('input[type="radio"]')[0]!);
    digitar(campoPorRotulo("Observação da conferência"), "Não prevê intermediação.");
    clicar(botao("Salvar"));
    clicar(botao("Confirmar"));
    await esperar();
    const pedido = estado.pendentes[0]!;

    renderizar(88);
    await esperar();
    expect(pedido.signal?.aborted).toBe(true);

    await act(async () => {
      pedido.resolver({
        headers: new Headers(),
        json: async () => ({ data: { contrato: 2417, resultado: "sem_corretagem", valor: null } }),
        ok: true,
      });
    });
    await esperar();

    expect(texto()).not.toContain("Conferência registrada");
    expect(recipiente.querySelector('[role="status"]')?.textContent).toBe("");
  });
});

describe("cancelar ao trocar de contrato (mesmo cliente)", () => {
  const criarUrl = vi.fn(() => "blob:teste");

  beforeEach(() => {
    criarUrl.mockClear();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: criarUrl });
  });

  afterEach(() => {
    Reflect.deleteProperty(URL, "createObjectURL");
  });

  function trocarContratoPara(id: number) {
    const seletor = recipiente.querySelector("select") as HTMLSelectElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    act(() => {
      setter.call(seletor, String(id));
      seletor.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("o sucesso do contrato anterior, resolvido depois da troca, não baixa; e o botão volta a servir", async () => {
    estado.pendurar.add("pdf-termo");
    renderizar(99);
    await esperar();
    clicar(botao("Rescisão"));
    await esperar();
    const pedido = estado.pendentes[0]!;
    expect(pedido.url).toContain("contrato=3001");
    expect(botao("Rescisão").disabled).toBe(true);

    trocarContratoPara(3002);
    await esperar();
    expect(pedido.signal?.aborted).toBe(true);
    expect(botao("Rescisão").disabled).toBe(false);

    await act(async () => {
      pedido.resolver({
        blob: async () => new Blob(["%PDF"]),
        headers: new Headers(),
        ok: true,
      });
    });
    await esperar();

    expect(criarUrl).not.toHaveBeenCalled();
  });

  it("a falha do contrato anterior não aparece sobre o contrato novo", async () => {
    estado.pendurar.add("pdf-termo");
    renderizar(99);
    await esperar();
    clicar(botao("Rescisão"));
    await esperar();
    const pedido = estado.pendentes[0]!;

    trocarContratoPara(3002);
    await esperar();
    await act(async () => {
      pedido.resolver({
        headers: new Headers(),
        json: async () => ({ error: "Falha exclusiva do contrato 3001." }),
        ok: false,
      });
    });
    await esperar();

    expect(texto()).not.toContain("Falha exclusiva do contrato 3001.");
  });
});

describe("a conferência no painel, para quem não é coordenação", () => {
  it.each(["operator", "viewer"])("%s: lê a frase de pedir à coordenação e não vê o formulário", async (papel) => {
    estado.papel = papel;
    renderizar(77);
    await esperar();
    clicar(botao("Rescisão"));
    await esperar();

    expect(texto()).toContain(
      "Peça à coordenação (admin ou líder) para registrar a conferência da corretagem deste contrato.",
    );
    expect(texto()).not.toContain("Registrar conferência da corretagem");
    expect(recipiente.querySelector('[role="status"]')).toBeNull();
  });

  it("líder é coordenação: vê o formulário", async () => {
    estado.papel = "leader";
    renderizar(77);
    await esperar();
    clicar(botao("Rescisão"));
    await esperar();

    expect(texto()).toContain("Registrar conferência da corretagem");
    expect(texto()).not.toContain("Peça à coordenação");
  });
});
