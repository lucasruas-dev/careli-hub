// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O SELO "SEM FILA" NO BOARD (Lucas, 24/09/2026, "3 - Isso ae").
//
// A imobiliária habilitada sem decisão no Board (automática, pela página pública, ou pelo cadastro
// interno) aparece na coluna Habilitada por 30 dias, com um selo curto que diz de onde veio. O caso
// real: a CONECTTA IMOVEIS, ficha do C2X com a entidade em `review` e o papel ativo, aprovada sozinha
// no 43. O que se trava aqui: o card cai em Habilitada (a entidade em `review` não a puxa para
// Validação), o selo aparece com o porquê no hover e sem travessão, e o card sem o campo não ganha selo.
//
// Mesma montagem manual dos outros testes de componente (board-view.mover-cad.comportamento).

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

const imobiliaria = (over: Record<string, unknown>) => ({
  analistaId: null,
  corretores: 0,
  criadoEm: "2026-09-24T19:55:00Z",
  documento: "37.716.144/0001-59",
  empreendimentos: ["PORTAL DO IBITURUNA"],
  enterpriseId: null,
  entidadeStatus: "review",
  etapa: null,
  habilitadaSemFila: null,
  id: "x",
  motivo: null,
  nome: "X",
  papel: "imobiliaria",
  papelStatus: "active",
  prevendaHabilitada: false,
  semCad: true,
  socios: 0,
  ...over,
});

const ITENS = [
  imobiliaria({
    habilitadaSemFila: { em: "2026-09-24T19:55:00Z", origem: "automatica" },
    id: "conectta",
    nome: "CONECTTA IMOVEIS",
  }),
  imobiliaria({
    habilitadaSemFila: { em: "2026-09-24T16:09:35Z", origem: "interna" },
    id: "vida",
    nome: "VIDA IMOVEIS LTDA",
  }),
  // Habilitada no Board (passou pela fila): mesma coluna, sem selo.
  imobiliaria({ entidadeStatus: "active", id: "morvian", nome: "MORVIAN TRANSACOES IMOBILIARIAS LTDA" }),
];

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const caminho = url.split("?")[0] ?? "";
      const corpo =
        caminho === "/api/apolo/board"
          ? {
              data: {
                analistas: [],
                empreendimentos: ["PORTAL DO IBITURUNA"],
                itens: ITENS,
                usuarioAtual: { id: "conta", nome: "Nivea" },
              },
            }
          : { data: {} };
      return Promise.resolve(
        new Response(JSON.stringify(corpo), { headers: { "content-type": "application/json" }, status: 200 }),
      );
    }),
  );
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

async function montar() {
  act(() => {
    raiz.render(<BoardView />);
  });
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const card = (nome: RegExp) =>
  Array.from(hospedeiro.querySelectorAll<HTMLElement>('article[role="button"]')).find((el) =>
    nome.test(el.textContent ?? ""),
  );

const colunaHabilitada = () =>
  Array.from(hospedeiro.querySelectorAll<HTMLElement>("span"))
    .find((el) => el.textContent?.trim() === "Habilitada")
    ?.closest<HTMLElement>('div[class*="w-[264px]"]');

describe("Board: o selo da habilitação sem fila", () => {
  it("⚠️ a CONECTTA (entidade em review, papel ativo) cai em Habilitada, com o selo automático", async () => {
    await montar();

    const conectta = card(/conectta/i);
    expect(conectta).toBeDefined();
    expect(colunaHabilitada()?.contains(conectta ?? null)).toBe(true);

    const selo = conectta?.querySelector<HTMLElement>('[data-testid="selo-sem-fila"]');
    expect(selo?.textContent?.trim().toLowerCase()).toBe("sem fila");
    expect(selo?.title).toContain("página pública");
    expect(selo?.title).toContain("24/09/2026");
    expect(selo?.title).not.toMatch(/[—–]/);
  });

  it("a do cadastro interno ganha o selo com o porquê dela", async () => {
    await montar();
    const selo = card(/vida imoveis/i)?.querySelector<HTMLElement>('[data-testid="selo-sem-fila"]');
    expect(selo?.title).toContain("cadastro interno");
  });

  it("a habilitada pelo Board, na mesma coluna, não tem selo", async () => {
    await montar();
    const morvian = card(/morvian/i);
    expect(colunaHabilitada()?.contains(morvian ?? null)).toBe(true);
    expect(morvian?.querySelector('[data-testid="selo-sem-fila"]')).toBeNull();
  });
});
