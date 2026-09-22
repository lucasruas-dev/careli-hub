// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O ALCANCE DO ANEXO — a metade do pedido do Lucas que não tinha tela.
//
// Lucas (21/09/2026): *"preciso garantir que consigamos vincular os anexos por filho, categoria"*.
//
// ⚠️ O QUE ESTE ARQUIVO TRAVA:
//   • a tela OFERECE os três alcances que a rota já aceitava (empreendimento, divisão, categoria);
//   • a categoria vai como `categoriaId` (uuid) e o produto como `enterpriseId` (id do C2X) — no
//     campo trocado o banco grava um alcance que a cadeia do contrato nunca leria, sem erro nenhum;
//   • trocar o alcance RELÊ a lista, senão o operador sobe a peça olhando as peças de outro nível;
//   • a tela diz que os níveis SOMAM: até 21/09/2026 a regra escrita era a oposta ("só o mais
//     específico vale"), e quem cadastrou sob ela espera substituição.
//
// Medido em produção em 21/09/2026: `temis_anexos` tinha ZERO linhas, e continuaria sem nenhuma de
// categoria — `anexos-do-contrato.tsx` era o único escritor de `/anexos` do aplicativo e mandava
// somente `enterpriseId`.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ⚠️ O `temisFetch` DO DÚBLÊ É ESTÁVEL, como o de verdade (o provedor o memoriza). Uma função nova
// a cada render trocaria a identidade do `useCallback` que lê a lista, e o efeito recarregaria para
// sempre — um laço que só existiria no teste.
vi.mock("@/modules/temis/api-da-temis", () => {
  const temisFetch = (subcaminho: string, init?: RequestInit) =>
    globalThis.fetch(`/api/temis${subcaminho}`, init);
  return { useApiDaTemis: () => ({ temisFetch }) };
});

const { AnexosDoContrato } = await import("./anexos-do-contrato");

const CONDOMINIO = "cccccccc-0000-4000-8000-000000000001";

const ALCANCES = [
  { id: "31", nome: "Lagoa Bonita", tipo: "empreendimento" },
  { id: "33", nome: "Lagoa Bonita · LBF", tipo: "empreendimento" },
  { id: CONDOMINIO, nome: "Condomínio", tipo: "categoria" },
];

type Chamada = { corpo: null | Record<string, unknown>; metodo: string; url: string };

const chamadas: Chamada[] = [];

function montarFetch() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: { body?: string; method?: string }) => {
    const metodo = init?.method ?? "GET";
    chamadas.push({
      corpo: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      metodo,
      url: String(url),
    });
    return {
      json: async () => ({ alcances: ALCANCES, anexos: [] }),
      ok: true,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

let container: HTMLDivElement;
let root: Root;

async function montar() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<AnexosDoContrato codigo="LBF" enterpriseId="group:Lagoa Bonita" />);
  });
}

const seletor = (): HTMLSelectElement => {
  const achado = container.querySelector("select");
  if (!achado) throw new Error("O seletor de alcance não está na tela.");
  return achado;
};

beforeEach(() => {
  chamadas.length = 0;
  montarFetch();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("o seletor de alcance dos anexos", () => {
  it("oferece o empreendimento, a divisão e a categoria, com a categoria separada", async () => {
    await montar();

    const opcoes = [...seletor().querySelectorAll("option")].map((o) => o.textContent);
    expect(opcoes).toEqual(["Lagoa Bonita", "Lagoa Bonita · LBF", "Condomínio"]);
    // A categoria não se confunde com produto: ela vive num grupo próprio na lista.
    expect(container.querySelector("optgroup")?.getAttribute("label")).toBe("Categorias");
  });

  it("a tela diz que os níveis SOMAM, e não que um substitui o outro", async () => {
    await montar();
    expect(container.textContent).toContain("somadas");
  });

  it("escolher a categoria manda `categoriaId`, e não `enterpriseId`", async () => {
    await montar();
    chamadas.length = 0;

    await act(async () => {
      const campo = seletor();
      campo.value = CONDOMINIO;
      campo.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // ⚠️ RELÊ A LISTA. Sem isto o operador escolheria a categoria e continuaria olhando as peças do
    // empreendimento — e subiria a planta do condomínio achando que ela já estava lá.
    const leitura = chamadas.find((c) => c.metodo === "GET");
    expect(leitura?.url).toContain(`categoriaId=${CONDOMINIO}`);
    // E o id da categoria NÃO vai no campo do produto: são colunas diferentes em `temis_anexos`.
    expect(leitura?.url).not.toContain("enterpriseId=");
  });

  it("escolher a divisão manda `enterpriseId` com o id do C2X dela", async () => {
    await montar();
    chamadas.length = 0;

    await act(async () => {
      const campo = seletor();
      campo.value = "33";
      campo.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const leitura = chamadas.find((c) => c.metodo === "GET");
    expect(leitura?.url).toContain("enterpriseId=33");
    expect(leitura?.url).not.toContain("categoriaId=");
  });

  // ⚠️ A TELA MOSTRAVA UM NÍVEL E GRAVAVA OUTRO. Lucas, 22/09/2026: *"não estamos conseguindo
  // colocar os anexos"*. Enquanto ninguém mexia no select, `alcance` era nulo: o campo exibia
  // `alcances[0]` e a requisição levava o `enterpriseId` da ficha — que na consolidada é um
  // `group:<nome>`, justamente o que a gravação recusa com "escolha a divisão".
  it("⚠️ depois de carregar, o que está NA TELA é o que vai ser gravado", async () => {
    await montar();

    // O seletor adotou um alcance de verdade, e não o rótulo da ficha consolidada.
    expect(seletor().value).toBe("31");
    expect(seletor().value).not.toContain("group:");

    // E a leitura seguinte já vai com esse mesmo id: tela e requisição leem a mesma variável.
    const ultima = [...chamadas].reverse().find((c) => c.metodo === "GET");
    expect(ultima?.url).toContain("enterpriseId=31");
  });

  it("no primeiro carregamento manda a ficha como veio, com o código que resolve o consolidado", async () => {
    await montar();

    const primeira = chamadas.find((c) => c.metodo === "GET");
    // ⚠️ `group:Lagoa Bonita` É RÓTULO, E NÃO CHAVE. Quem o resolve é o servidor, com o código de
    // uma das etapas — e é por isso que o código viaja junto. A gravação recusa o que não resolver.
    expect(primeira?.url).toContain("enterpriseId=group%3ALagoa+Bonita");
    expect(primeira?.url).toContain("codigo=LBF");
  });
});
