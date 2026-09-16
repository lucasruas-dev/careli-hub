// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CONTRATOS E MINUTAS DO PORTAL QUE CONFECCIONA, TRAVADOS NO QUE VAI PARA A REDE.
//
// ⚠️ O QUE SE PROVA AQUI E NÃO NA CAMADA (`api-da-temis.test.tsx`): que as TELAS de verdade saem
// pela porta certa. A aba Contratos sem `confecciona` continua no board só-leitura de sempre
// (`/api/incorporador/contratos`); com `confecciona`, o quadro, a tela de trabalho que ele abre, as
// minutas e os anexos falam com `/api/incorporador/temis/*` pelo cookie, sem nunca pedir o token do
// hub. E, do outro lado, que a mesma peça SEM provedor continua no hub, com o Bearer.
//
// Mesma montagem manual dos outros testes de componente (ArquivosDoProduto.comportamento).

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const simulado = vi.hoisted(() => ({
  getApoloAccessToken: vi.fn<() => Promise<null | string>>(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getHubSupabaseClient: () => null,
  hubSupabaseConfig: { anonKey: "chave-publica", url: "https://projeto.supabase.co" },
}));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: () => simulado.getApoloAccessToken(),
}));

const { TelaContratos } = await import("../TelaContratos");
const { MinutasDoProduto } = await import("./MinutasDoProduto");
const { AnexosDoContrato } = await import(
  "@/modules/apolo/blocks/empreendimentos/anexos-do-contrato"
);
const { TemisKanban } = await import("@/modules/temis/blocks/board/temis-kanban");

type Chamada = { authorization: null | string; credentials?: string; method: string; url: string };

let raiz: Root;
let hospedeiro: HTMLDivElement;
let chamadas: Chamada[];

const ESTAGIOS = [{ descricao: "Chegou e ninguém pegou", id: "entrada", nome: "Entrada" }];

const TRABALHO = {
  atividadesFeitas: [],
  canal: "hercules",
  clienteCpf: "12345678901",
  clienteNome: "Maria Compradora",
  contratos: [],
  criadoEm: "2026-09-16T10:00:00Z",
  empreendimentoCodigo: "VOC",
  empreendimentoNome: "Vale do Ouro",
  estagio: "entrada",
  estagioDesde: "2026-09-16T10:00:00Z",
  evidenciaPath: null,
  id: "8b1c7f0e-6a51-4c1e-9d0f-2a3b4c5d6e7f",
  irisTicketId: null,
  observacao: null,
  propostaId: "prop-1",
  tipo: "contrato",
  trabalhoOrigemId: null,
  unidade: "Q01 L04",
};

/** O aviso que o painel de produtos manda quando saiu só pelo cadastro. `null` = o painel falha. */
let avisoDoPainel: null | string = null;

/** O que cada rota devolve. O Resumo (C2X) não é assunto daqui: responde erro e sai da frente. */
function responder(url: string): { corpo: unknown; status: number } {
  if (url.startsWith("/api/incorporador/produtos/painel") && avisoDoPainel) {
    return { corpo: { data: { avisoDaFonte: avisoDoPainel, linhas: [] } }, status: 200 };
  }
  if (url.includes("/trabalhos") || url.startsWith("/api/incorporador/contratos")) {
    return { corpo: { data: { estagios: ESTAGIOS, trabalhos: [TRABALHO] } }, status: 200 };
  }
  if (url.includes("/minutas")) return { corpo: { data: { minutas: [] } }, status: 200 };
  if (url.includes("/anexos")) return { corpo: { anexos: [] }, status: 200 };
  if (url.includes("/assinantes")) return { corpo: { assinantes: [] }, status: 200 };
  if (url.includes("/trabalho?")) return { corpo: { error: "Nao encontrado." }, status: 404 };
  return { corpo: { error: "Fora do teste." }, status: 500 };
}

/** Um fetch de mentira que responde pela rota. */
function instalarFetch() {
  chamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const cabecalhos = (init?.headers ?? {}) as Record<string, string>;
      chamadas.push({
        authorization: cabecalhos.Authorization ?? cabecalhos.authorization ?? null,
        credentials: init?.credentials,
        method: init?.method ?? "GET",
        url,
      });
      const { corpo, status } = responder(url);
      return Promise.resolve(
        new Response(JSON.stringify(corpo), {
          headers: { "content-type": "application/json" },
          status,
        }),
      );
    }),
  );
}

async function esperarPromessas() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function montar(elemento: React.ReactElement) {
  act(() => {
    raiz.render(elemento);
  });
  await esperarPromessas();
}

async function clicar(botao: HTMLButtonElement | undefined) {
  expect(botao).toBeTruthy();
  await act(async () => {
    botao?.click();
  });
  await esperarPromessas();
}

const botao = (rotulo: string) =>
  Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === rotulo,
  );
const botaoQueContem = (trecho: string) =>
  Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    b.textContent?.includes(trecho),
  );

const daTemis = () => chamadas.filter((c) => c.url.includes("/temis"));

beforeEach(() => {
  avisoDoPainel = null;
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  simulado.getApoloAccessToken.mockReset();
  simulado.getApoloAccessToken.mockResolvedValue("token-do-hub");
  instalarFetch();
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("TelaContratos — a sub-aba Board", () => {
  it("sem `confecciona` é o board só-leitura de sempre, na rota do comercial", async () => {
    await montar(<TelaContratos />);
    await clicar(botao("Board"));

    const board = chamadas.find((c) => c.url.startsWith("/api/incorporador/contratos"));
    expect(board?.url).toBe("/api/incorporador/contratos");
    expect(board?.authorization).toBeNull();
    expect(daTemis()).toHaveLength(0);
    expect(simulado.getApoloAccessToken).not.toHaveBeenCalled();

    // Só leitura: o card não abre tela de trabalho.
    await clicar(botaoQueContem("Maria Compradora"));
    expect(hospedeiro.querySelector("[data-temis-trabalho]")).toBeNull();
  });

  it("com `confecciona` o quadro vem de /api/incorporador/temis pelo cookie, sem token", async () => {
    await montar(<TelaContratos confecciona />);
    await clicar(botao("Board"));

    expect(chamadas.some((c) => c.url.startsWith("/api/incorporador/contratos"))).toBe(false);
    expect(daTemis()).toEqual([
      {
        authorization: null,
        credentials: "same-origin",
        method: "GET",
        url: "/api/incorporador/temis/trabalhos",
      },
    ]);
    expect(simulado.getApoloAccessToken).not.toHaveBeenCalled();
  });

  it("o card abre a tela de trabalho, e ela também fala com o portal", async () => {
    await montar(<TelaContratos confecciona />);
    await clicar(botao("Board"));
    await clicar(botaoQueContem("Maria Compradora"));

    expect(hospedeiro.querySelector("[data-temis-trabalho]")).not.toBeNull();
    const trabalho = daTemis().find((c) => c.url.includes("/trabalho?"));
    expect(trabalho).toEqual({
      authorization: null,
      credentials: "same-origin",
      method: "GET",
      url: `/api/incorporador/temis/trabalho?id=${TRABALHO.id}`,
    });
    expect(daTemis().every((c) => c.url.startsWith("/api/incorporador/temis/"))).toBe(true);
    expect(simulado.getApoloAccessToken).not.toHaveBeenCalled();
  });

  it("dentro da ficha, o produto vai como `empreendimento` (o parâmetro só reduz)", async () => {
    await montar(<TelaContratos confecciona emp="pai:vlo" />);
    await clicar(botao("Board"));

    expect(daTemis()[0]?.url).toBe("/api/incorporador/temis/trabalhos?empreendimento=pai%3Avlo");
  });
});

describe("TelaContratos — o aviso da fonte do painel", () => {
  it("o painel que saiu só pelo cadastro do Panteon avisa na tela, como a tela Produtos", async () => {
    avisoDoPainel = "O C2X não respondeu agora: a lista saiu pelo cadastro do Panteon.";
    await montar(<TelaContratos confecciona />);
    expect(hospedeiro.querySelector('[role="status"]')?.textContent).toBe(avisoDoPainel);
  });

  it("dentro da ficha do produto (`emp`) o painel nem é lido, e não há aviso", async () => {
    avisoDoPainel = "qualquer aviso";
    await montar(<TelaContratos confecciona emp="39" />);
    expect(chamadas.some((c) => c.url.startsWith("/api/incorporador/produtos/painel"))).toBe(false);
    expect(hospedeiro.textContent).not.toContain("qualquer aviso");
  });
});

describe("MinutasDoProduto", () => {
  it("lista minutas, anexos e o quadro de assinatura do produto pelo portal, sem token", async () => {
    await montar(<MinutasDoProduto enterpriseId="37" nome="Vale do Ouro" />);

    // O quadro de assinatura vem junto (revisão da onda 3, achado 21), pela mesma porta do portal.
    expect(daTemis().map((c) => c.url).sort()).toEqual([
      "/api/incorporador/temis/anexos?enterpriseId=37",
      "/api/incorporador/temis/assinantes?enterpriseId=37",
      "/api/incorporador/temis/minutas?enterpriseId=37&tipo=contrato",
    ]);
    expect(daTemis().every((c) => c.authorization === null && c.credentials === "same-origin")).toBe(
      true,
    );
    expect(simulado.getApoloAccessToken).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toContain("Minutas de Vale do Ouro");
  });

  it("as quatro abas da Têmis: trocar para o distrato pede o tipo distrato", async () => {
    await montar(<MinutasDoProduto enterpriseId="37" />);
    chamadas = [];
    await clicar(botao("Termo de distrato"));

    expect(daTemis().map((c) => c.url)).toContain(
      "/api/incorporador/temis/minutas?enterpriseId=37&tipo=distrato",
    );
    expect(hospedeiro.textContent).toContain("Minutas de seu produto");
  });
});

describe("a mesma peça sem provedor continua no hub", () => {
  it("o quadro da Têmis e a tela de trabalho: /api/temis com o Bearer, como antes", async () => {
    await montar(<TemisKanban enterpriseId={null} />);
    await clicar(botaoQueContem("Maria Compradora"));

    expect(chamadas).toEqual([
      {
        authorization: "Bearer token-do-hub",
        credentials: undefined,
        method: "GET",
        url: "/api/temis/trabalhos",
      },
      {
        authorization: "Bearer token-do-hub",
        credentials: undefined,
        method: "GET",
        url: `/api/temis/trabalho?id=${TRABALHO.id}`,
      },
    ]);
  });

  it("AnexosDoContrato lê /api/temis com o Bearer do hub", async () => {
    await montar(<AnexosDoContrato enterpriseId="37" />);

    expect(chamadas).toEqual([
      {
        authorization: "Bearer token-do-hub",
        credentials: undefined,
        method: "GET",
        url: "/api/temis/anexos?enterpriseId=37",
      },
    ]);
    expect(simulado.getApoloAccessToken).toHaveBeenCalledTimes(1);
  });
});
