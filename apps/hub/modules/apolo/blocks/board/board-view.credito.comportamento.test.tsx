// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O BOARD NAS TRÊS PORTAS DO CRÉDITO (16/09/2026), TRAVADO NO QUE APARECE E NO QUE VAI PARA A REDE.
//
// Decisão do Lucas: *"A Cecílio, no portal"* faz a análise de crédito e o credenciamento dos clientes
// dela; a Gurgel (comercial) NÃO, o crédito das vendas dela continua com a Careli no Apolo. Os casos:
//   • hub (sem props): a revisão espera a coordenação, sem "Indeferir" para a CAD;
//   • comercial (portal com o Serasa escondido): sem aprovar, sem indeferir, sem credenciar;
//   • portal que opera sozinho: aprovar com restrição e indeferir na revisão, credenciar na
//     pré-venda, e o vocabulário sem a coordenação da Careli. As gravações vão pela porta do portal.
//
// Mesma montagem manual dos outros testes de componente (ArquivosDoProduto.comportamento).

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/supabase/client", () => ({
  getHubSupabaseClient: () => null,
  hubSupabaseConfig: { anonKey: "chave-publica", url: "https://projeto.supabase.co" },
}));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: () => Promise.resolve("token-do-hub"),
}));

const { BoardView } = await import("./board-view");

const API_DO_PORTAL = { base: "/api/incorporador/board", query: "emp=39", semToken: true };
const OCULTOS_DO_COMERCIAL = ["serasa", "c2xSync", "avisarLote", "disparos", "pix"] as const;
const OCULTOS_DO_SOZINHO = ["c2xSync", "avisarLote", "disparos", "pix"] as const;

type Chamada = {
  body?: Record<string, unknown>;
  headers: Record<string, string>;
  method: string;
  url: string;
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
let chamadas: Chamada[];

const cad = (over: Record<string, unknown> = {}) => ({
  analistaId: null,
  corretores: 0,
  criadoEm: "2026-09-10T10:00:00Z",
  documento: "529.982.247-25",
  empreendimentos: ["Garden"],
  enterpriseId: "39",
  etapa: "revisao",
  id: "e1",
  motivo: "Crédito reprovado. Restrições de R$ 12.480,00 acima do limite de R$ 1.000,00.",
  nome: "FULANO DE TAL",
  papel: "prospect",
  prevendaHabilitada: true,
  socios: 0,
  ...over,
});

function instalarFetch(item: Record<string, unknown>) {
  chamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const chamada: Chamada = {
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        headers: { ...((init?.headers ?? {}) as Record<string, string>) },
        method: init?.method ?? "GET",
        url,
      };
      chamadas.push(chamada);
      const caminho = url.split("?")[0] ?? "";
      let corpo: unknown = { data: {} };
      if (caminho === "/api/incorporador/board" || caminho === "/api/apolo/board") {
        corpo = {
          data: {
            analistas: [],
            empreendimentos: ["Garden"],
            itens: [item],
            usuarioAtual: { id: "conta", nome: "Maria" },
          },
        };
      } else if (caminho.endsWith("/etapa")) {
        corpo = { data: { etapa: chamada.body?.etapa, ok: true } };
      } else if (caminho.includes("/serasa/consultar")) {
        corpo = { data: { configurado: true, ambiente: "producao", etapa: item.etapa } };
      }
      return Promise.resolve(
        new Response(JSON.stringify(corpo), {
          headers: { "content-type": "application/json" },
          status: 200,
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

const texto = () => hospedeiro.textContent ?? "";
const botao = (rotulo: string) =>
  Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === rotulo,
  );

async function clicarEm(elemento: HTMLElement | undefined, nome: string) {
  if (!elemento) throw new Error(`"${nome}" não está na tela.`);
  act(() => {
    elemento.click();
  });
  await esperarPromessas();
}

/** Abre a ficha do único card da fila. */
async function abrirFicha() {
  const card = Array.from(hospedeiro.querySelectorAll<HTMLElement>('article[role="button"]')).find(
    (el) => /fulano/i.test(el.textContent ?? ""),
  );
  await clicarEm(card, "card do Fulano");
}

beforeEach(() => {
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

describe("CAD com crédito reprovado (revisão)", () => {
  it("hub: aprova a coordenação, e a CAD não tem Indeferir", async () => {
    instalarFetch(cad());
    await montar(<BoardView ocultar={["disparos", "pix", "c2xSync", "avisarLote"]} />);

    expect(texto()).toContain("Crédito indeferido");
    await abrirFicha();

    expect(texto()).toContain("Aguardando o coordenador");
    expect(botao("Aprovar com restrição (coordenação)")).toBeTruthy();
    expect(botao("Indeferir")).toBeUndefined();
    // O painel do Serasa lê pela rota do hub, com o Bearer.
    const situacao = chamadas.find((c) => c.url.includes("/serasa/consultar"));
    expect(situacao?.url).toBe("/api/apolo/serasa/consultar?entityId=e1");
    expect(situacao?.headers.Authorization).toBe("Bearer token-do-hub");
  });

  it("comercial: nem aprovar, nem indeferir; o crédito é da Careli", async () => {
    instalarFetch(cad());
    await montar(<BoardView api={API_DO_PORTAL} empreendimentosFixos={[]} ocultar={[...OCULTOS_DO_COMERCIAL]} />);

    expect(texto()).toContain("Crédito indeferido");
    await abrirFicha();

    expect(texto()).toContain("Aguardando o coordenador");
    expect(botao("Aprovar com restrição")).toBeUndefined();
    expect(botao("Aprovar com restrição (coordenação)")).toBeUndefined();
    expect(botao("Indeferir")).toBeUndefined();
    expect(texto()).toContain("A análise de crédito é feita pela Careli.");
    expect(chamadas.some((c) => c.url.includes("/serasa/"))).toBe(false);
  });

  it("portal que opera sozinho: aprova com restrição, indefere pela porta dele e fala sem a coordenação", async () => {
    instalarFetch(cad());
    await montar(
      <BoardView
        api={API_DO_PORTAL}
        empreendimentosFixos={[]}
        ocultar={[...OCULTOS_DO_SOZINHO]}
        operaSozinho
      />,
    );

    expect(texto()).toContain("CAD indeferida");
    expect(texto()).not.toContain("Crédito indeferido");
    await abrirFicha();

    expect(texto()).toContain("Aguardando decisão");
    expect(texto()).not.toMatch(/coordena/i);
    expect(botao("Aprovar com restrição")).toBeTruthy();
    const situacao = chamadas.find((c) => c.url.includes("/serasa/consultar"));
    expect(situacao?.url).toBe("/api/incorporador/board/e1/serasa/consultar?emp=39");
    expect(situacao?.headers).not.toHaveProperty("Authorization");

    await clicarEm(botao("Indeferir"), "Indeferir");
    expect(texto()).toContain("Indeferir a CAD");
    const motivo = Array.from(hospedeiro.querySelectorAll<HTMLLabelElement>("label")).find((l) =>
      l.textContent?.includes("Documentação inconsistente"),
    );
    await clicarEm(motivo?.querySelector("input") ?? undefined, "motivo");
    await clicarEm(botao("Confirmar"), "Confirmar");

    const gravacao = chamadas.find((c) => c.method === "PATCH");
    expect(gravacao?.url).toBe("/api/incorporador/board/e1/etapa?emp=39");
    expect(gravacao?.headers).not.toHaveProperty("Authorization");
    expect(gravacao?.body).toMatchObject({
      enterpriseId: "39",
      etapa: "indeferido",
      motivo: "Documentação inconsistente",
    });
  });
});

describe("CAD na pré-venda", () => {
  it("portal que opera sozinho: Credenciar grava credenciado sem rebaixar, e a frase explica o PIX", async () => {
    instalarFetch(cad({ etapa: "prevenda", motivo: null }));
    await montar(
      <BoardView
        api={API_DO_PORTAL}
        empreendimentosFixos={[]}
        ocultar={[...OCULTOS_DO_SOZINHO]}
        operaSozinho
      />,
    );
    await abrirFicha();

    expect(texto()).toContain("A cobrança do PIX da pré-venda não sai por este portal.");
    await clicarEm(botao("Credenciar"), "Credenciar");

    const gravacao = chamadas.find((c) => c.method === "PATCH");
    expect(gravacao?.url).toBe("/api/incorporador/board/e1/etapa?emp=39");
    expect(gravacao?.body).toMatchObject({ etapa: "credenciado", nuncaRebaixar: true });
  });

  it("comercial e hub: sem Credenciar nem a frase (o PIX é o painel da Careli)", async () => {
    instalarFetch(cad({ etapa: "prevenda", motivo: null }));
    await montar(<BoardView api={API_DO_PORTAL} empreendimentosFixos={[]} ocultar={[...OCULTOS_DO_COMERCIAL]} />);
    await abrirFicha();
    expect(botao("Credenciar")).toBeUndefined();
    expect(botao("Gerar PIX")).toBeUndefined();
    expect(texto()).not.toContain("não sai por este portal");

    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    instalarFetch(cad({ etapa: "prevenda", motivo: null }));
    await montar(<BoardView ocultar={["disparos", "pix", "c2xSync", "avisarLote"]} />);
    await abrirFicha();
    expect(botao("Credenciar")).toBeUndefined();
    expect(botao("Gerar PIX")).toBeUndefined();
  });
});
