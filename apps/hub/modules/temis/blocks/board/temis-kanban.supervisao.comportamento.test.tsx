// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A SUPERVISÃO DA CARELI NO QUADRO DA TÊMIS — "Ver também os do incorporador".
//
// Decisão do Lucas (16/09/2026): o board da Careli esconde, por padrão, o que o time de um
// incorporador confecciona no portal dele (`operado_por`, 0172). O que está travado aqui, no que vai
// para a rede e no que aparece no card:
//   • desligado: `/api/temis/trabalhos` como sempre, e nenhum selo;
//   • ligado: `?incluir=incorporadores`, e o card de fora ganha o selo "Incorporador" (o da Careli não);
//   • o board só-leitura do comercial (`rota`) nunca manda o parâmetro nem pinta selo.

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

const { TemisKanban } = await import("./temis-kanban");

const ESTAGIOS = [{ descricao: "Chegou e ninguém pegou", id: "entrada", nome: "Entrada" }];

const card = (id: string, clienteNome: string, operadoPor: null | string) => ({
  atividadesFeitas: [],
  canal: "hercules",
  clienteCpf: null,
  clienteNome,
  contratos: [],
  criadoEm: "2026-09-16T10:00:00Z",
  empreendimentoCodigo: "GDN",
  empreendimentoNome: "Garden",
  estagio: "entrada",
  estagioDesde: "2026-09-16T10:00:00Z",
  evidenciaPath: null,
  id,
  irisTicketId: null,
  observacao: null,
  operadoPor,
  propostaId: null,
  tipo: "contrato",
  trabalhoOrigemId: null,
  unidade: "Q01 L01",
});

let raiz: Root;
let hospedeiro: HTMLDivElement;
let urls: string[];

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  urls = [];
  simulado.getApoloAccessToken.mockReset();
  simulado.getApoloAccessToken.mockResolvedValue("token-do-hub");
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      urls.push(url);
      const trabalhos = [
        card("t-careli", "Cliente da Careli", null),
        card("t-cecilio", "Cliente da Cecília", "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6"),
      ];
      return Promise.resolve(
        new Response(JSON.stringify({ data: { estagios: ESTAGIOS, trabalhos } }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    }),
  );
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

async function montar(elemento: React.ReactElement) {
  act(() => {
    raiz.render(elemento);
  });
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** O card (o botão) de um cliente. */
const cardDe = (cliente: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find((b) => b.textContent?.includes(cliente));

describe("TemisKanban — supervisão dos cards do incorporador", () => {
  it("desligado: a rota de sempre, sem parâmetro e sem selo", async () => {
    await montar(<TemisKanban enterpriseId={null} />);

    expect(urls).toEqual(["/api/temis/trabalhos"]);
    expect(hospedeiro.textContent).not.toContain("Incorporador");
  });

  it("ligado: pede os do incorporador e pinta o selo só no card de fora", async () => {
    await montar(<TemisKanban enterpriseId={null} incluirIncorporadores />);

    expect(urls).toEqual(["/api/temis/trabalhos?incluir=incorporadores"]);
    expect(cardDe("Cliente da Cecília")?.textContent).toContain("Incorporador");
    expect(cardDe("Cliente da Careli")?.textContent).not.toContain("Incorporador");
  });

  it("o parâmetro soma ao filtro de empreendimento", async () => {
    await montar(<TemisKanban enterpriseId="39" incluirIncorporadores />);
    expect(urls).toEqual(["/api/temis/trabalhos?empreendimento=39&incluir=incorporadores"]);
  });

  it("o board só-leitura do comercial (`rota`) nunca manda o parâmetro nem pinta selo", async () => {
    await montar(
      <TemisKanban
        enterpriseId={null}
        incluirIncorporadores
        rota="/api/incorporador/contratos"
        semToken
        somenteLeitura
      />,
    );
    expect(urls).toEqual(["/api/incorporador/contratos"]);
    expect(hospedeiro.textContent).not.toContain("Incorporador");
  });
});
