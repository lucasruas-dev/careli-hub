// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PESQUISA, FILTROS E ORDEM NO QUADRO DA TÊMIS (03/10/2026). Lucas: *"preciso de um prompt para tela
// da temis ter ordenação, filtro, pesquisa"*. O que está travado aqui, na tela:
//   • a pesquisa filtra as colunas e as contagens das abas e das colunas acompanham;
//   • os filtros se somam, viram etiqueta com x, e o "Limpar" desfaz;
//   • a ordem reordena dentro da coluna e fica guardada, a pesquisa não;
//   • "Quem confecciona" só existe na supervisão, e nunca no board só-leitura do comercial;
//   • sem armazenamento no navegador, o quadro abre igual.
// A lógica fina (acento, CPF, unidade, desempate) está em `lib/temis/filtro-do-quadro.test.ts`.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/supabase/client", () => ({
  getHubSupabaseClient: () => null,
  hubSupabaseConfig: { anonKey: "chave-publica", url: "https://projeto.supabase.co" },
}));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: () => Promise.resolve("token-do-hub"),
}));

const { TemisKanban } = await import("./temis-kanban");

const AGORA = new Date().toISOString();

const card = (id: string, clienteNome: string, parcial: Record<string, unknown> = {}) => ({
  atividadesFeitas: [],
  canal: "hercules",
  clienteCpf: null,
  clienteNome,
  contratos: [],
  criadoEm: AGORA,
  empreendimentoCodigo: "VOL",
  empreendimentoNome: "Vale do Ouro",
  estagio: "analise",
  // Entrou agora: dentro do prazo.
  estagioDesde: AGORA,
  evidenciaPath: null,
  id,
  irisTicketId: null,
  observacao: null,
  operadoPor: null,
  propostaId: null,
  tipo: "contrato",
  trabalhoOrigemId: null,
  unidade: "Quadra 01 · Lote 01",
  ...parcial,
});

// Na ordem em que o servidor manda (há mais tempo na etapa primeiro).
const TRABALHOS = [
  card("t-carlos", "Carlos Souza", {
    criadoEm: "2026-09-01T12:00:00Z",
    // Na análise desde janeiro, sem nada marcado: o relógio vermelho.
    estagioDesde: "2026-01-05T12:00:00Z",
    unidade: "Quadra 11 · Lote 20",
  }),
  card("t-andrea", "Ândrea Lima", {
    clienteCpf: "12345678901",
    empreendimentoCodigo: "LGB",
    empreendimentoNome: "Lagoa Bonita",
    unidade: "Quadra 11 · Lote 02",
  }),
  card("t-beatriz", "beatriz Rocha", { operadoPor: "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6" }),
  card("t-cessao", "Davi Cessionário", { tipo: "cessao" }),
];

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  window.localStorage.clear();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { estagios: [], trabalhos: TRABALHOS } }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      ),
    ),
  );
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

const caixa = () => hospedeiro.querySelector<HTMLInputElement>('input[aria-label="Pesquisar no quadro"]')!;

function digitar(texto: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(caixa(), texto);
    caixa().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const botao = (rotulo: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.getAttribute("aria-label") === rotulo || b.textContent?.trim() === rotulo,
  );

function clicar(alvo: HTMLElement | undefined) {
  if (!alvo) throw new Error("botão não encontrado");
  act(() => alvo.click());
}

/** A aba de um quadro, com o número que ela mostra. */
const aba = (nome: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find((b) => b.textContent?.startsWith(nome))?.textContent;

/** Os clientes de uma coluna, na ordem da tela. */
const coluna = (nome: string) => {
  const secao = Array.from(hospedeiro.querySelectorAll("section")).find((s) =>
    s.querySelector("h3")?.textContent?.startsWith(nome),
  );
  return {
    clientes: Array.from(secao?.querySelectorAll("article p.text-sm") ?? []).map((p) => p.textContent),
    contagem: secao?.querySelector("h3 span")?.textContent,
    texto: secao?.textContent ?? "",
  };
};

describe("TemisKanban: pesquisa, filtros e ordem", () => {
  it("sem nada escolhido, a ordem é a do servidor (há mais tempo na etapa)", async () => {
    await montar(<TemisKanban enterpriseId={null} />);

    expect(coluna("Novo").clientes).toEqual(["CARLOS SOUZA", "ÂNDREA LIMA", "BEATRIZ ROCHA", "DAVI CESSIONÁRIO"]);
    expect(aba("Todos")).toBe("Todos4");
  });

  it("a pesquisa filtra a coluna e as contagens das abas e das colunas acompanham", async () => {
    await montar(<TemisKanban enterpriseId={null} />);

    digitar("andrea");

    expect(coluna("Novo").clientes).toEqual(["ÂNDREA LIMA"]);
    expect(coluna("Novo").contagem).toBe("1");
    expect(aba("Todos")).toBe("Todos1");
    expect(aba("Contrato novo")).toBe("Contrato novo1");
    expect(aba("Cessão de direitos")).toBe("Cessão de direitos0");
    // A coluna que ficou vazia diz que está vazia.
    expect(coluna("Em andamento").texto).toContain("Nada aqui.");
  });

  it("a pesquisa acha pela unidade, e Lote 02 não traz Lote 20; pelo CPF com pontuação também", async () => {
    await montar(<TemisKanban enterpriseId={null} />);

    digitar("q11 l02");
    expect(coluna("Novo").clientes).toEqual(["ÂNDREA LIMA"]);

    digitar("123.456.789-01");
    expect(coluna("Novo").clientes).toEqual(["ÂNDREA LIMA"]);

    clicar(botao("Limpar a pesquisa"));
    expect(caixa().value).toBe("");
    expect(coluna("Novo").clientes).toHaveLength(4);
  });

  it("os filtros se somam, viram etiqueta, e o Limpar desfaz", async () => {
    await montar(<TemisKanban enterpriseId={null} />);

    clicar(botao("Filtros"));
    clicar(botao("Prazo vencido"));
    expect(coluna("Novo").clientes).toEqual(["CARLOS SOUZA"]);
    expect(botao("Filtros (1 ligados)")).toBeDefined();
    expect(botao("Tirar o filtro Prazo vencido")).toBeDefined();

    // Somado a um empreendimento que o card vencido não é: nada.
    clicar(botao("Lagoa Bonita"));
    expect(coluna("Novo").clientes).toEqual([]);
    expect(aba("Todos")).toBe("Todos0");

    clicar(botao("Limpar"));
    expect(coluna("Novo").clientes).toHaveLength(4);
    expect(botao("Tirar o filtro Prazo vencido")).toBeUndefined();
  });

  it("a ordem reordena dentro da coluna, e volta guardada na próxima abertura; a pesquisa não", async () => {
    await montar(<TemisKanban enterpriseId={null} />);

    digitar("a");
    clicar(botao("Ordem: Há mais tempo na etapa"));
    clicar(botao("Nome de A a Z"));
    expect(coluna("Novo").clientes).toEqual(["ÂNDREA LIMA", "BEATRIZ ROCHA", "CARLOS SOUZA", "DAVI CESSIONÁRIO"]);

    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await montar(<TemisKanban enterpriseId={null} />);

    expect(caixa().value).toBe("");
    expect(botao("Ordem: Nome de A a Z")).toBeDefined();
    expect(coluna("Novo").clientes).toEqual(["ÂNDREA LIMA", "BEATRIZ ROCHA", "CARLOS SOUZA", "DAVI CESSIONÁRIO"]);
  });

  it("o filtro guardado volta na próxima abertura, com a etiqueta à vista", async () => {
    window.localStorage.setItem(
      "temis.quadro.preferencias.v1:operacao",
      JSON.stringify({ filtros: { empreendimentos: ["LGB", "SUMIU"] }, ordem: "etapa" }),
    );
    await montar(<TemisKanban enterpriseId={null} />);

    expect(coluna("Novo").clientes).toEqual(["ÂNDREA LIMA"]);
    expect(botao("Tirar o filtro Lagoa Bonita")).toBeDefined();
    // O empreendimento guardado que não tem card nenhum não filtra nem vira etiqueta.
    expect(botao("Tirar o filtro SUMIU")).toBeUndefined();
  });

  it("'Quem confecciona' só existe na supervisão, e separa Careli de incorporador", async () => {
    await montar(<TemisKanban enterpriseId={null} />);
    clicar(botao("Filtros"));
    expect(hospedeiro.textContent).not.toContain("Quem confecciona");

    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await montar(<TemisKanban enterpriseId={null} incluirIncorporadores />);
    clicar(botao("Filtros"));
    expect(hospedeiro.textContent).toContain("Quem confecciona");

    clicar(botao("Incorporador"));
    expect(coluna("Novo").clientes).toEqual(["BEATRIZ ROCHA"]);
    clicar(botao("Careli"));
    expect(coluna("Novo").clientes).toEqual(["CARLOS SOUZA", "ÂNDREA LIMA", "DAVI CESSIONÁRIO"]);
  });

  it("no board só-leitura do comercial: a mesma pesquisa, sem 'Quem confecciona', e a aba não some com a pesquisa", async () => {
    await montar(
      <TemisKanban
        enterpriseId={null}
        incluirIncorporadores
        rota="/api/incorporador/contratos"
        semToken
        somenteLeitura
      />,
    );

    digitar("carlos");
    expect(coluna("Novo").clientes).toEqual(["CARLOS SOUZA"]);
    // A aba de cessão existe pelo total, mesmo com a pesquisa zerando a contagem dela.
    expect(aba("Cessão de direitos")).toBe("Cessão de direitos0");

    clicar(botao("Filtros"));
    expect(hospedeiro.textContent).not.toContain("Quem confecciona");
  });

  it("sem armazenamento no navegador (janela anônima, site bloqueado), o quadro abre e filtra igual", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    await montar(<TemisKanban enterpriseId={null} />);

    expect(coluna("Novo").clientes).toHaveLength(4);
    clicar(botao("Ordem: Há mais tempo na etapa"));
    clicar(botao("Nome de A a Z"));
    expect(coluna("Novo").clientes[0]).toBe("ÂNDREA LIMA");
  });
});
