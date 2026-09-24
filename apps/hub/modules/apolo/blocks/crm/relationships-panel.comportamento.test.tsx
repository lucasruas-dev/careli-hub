// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApoloEntity, ApoloProfile } from "@/lib/apolo/types";

// EXCLUIR O VÍNCULO DE EMPREENDIMENTO DE QUEM TEM CAD (24/09/2026).
//
// O caso real: o time trocou o empreendimento do JONATAS por este painel (exclui o VEREDAS DO OURO,
// adiciona o Vale do Ouro) e a CAD ficou no Veredas, porque a CAD mora na esteira e não no vínculo.
// A rota de arquivar passou a recusar com 409 o vínculo que é chave de uma CAD viva, e a troca virou o
// "Mover CAD" do Board. O que se trava aqui:
//   • o 409 aparece com a frase DA ROTA (é ela que aponta o caminho);
//   • 409 de empreendimento sem frase ainda aponta o "Mover CAD", em vez do genérico "tente de novo";
//   • o que não passou não fecha a lista nem recarrega a ficha como se tivesse passado;
//   • a dica do botão de excluir, no empreendimento do prospect, diz onde fica a troca; na imobiliária
//     pura, não (para ela excluir continua sendo o caminho);
//   • a chamada vai com o Bearer do hub.
//
// (Revisão de 24/09/2026, D1 e D7.) A frase diz QUEM troca: o botão Mover CAD só existe para a
// coordenação, e o analista era mandado para uma ação que não vê. E a imobiliária que também é
// prospect (tem CAD) ganha a dica, porque a trava decide pela CAD, não pelo perfil.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: async () => "token-do-hub",
}));

const { FRASE_DO_MOVER_CAD, RelationshipsPanel, dicaDoExcluir, mensagemDaExclusao } = await import(
  "./relationships-panel"
);

// A frase da decisão D1, escrita à mão: se a constante mudar, o teste mostra o que mudou.
const FRASE_D1 = "Para trocar o empreendimento, a coordenação usa Mover CAD no Board.";

type Chamada = { body?: Record<string, unknown>; headers: Record<string, string>; url: string };

let raiz: Root;
let hospedeiro: HTMLDivElement;
let chamadas: Chamada[];

// Só o que o painel lê. O resto da entidade não participa desta tela.
const entidade = (profiles: ApoloProfile[]): ApoloEntity =>
  ({
    id: "c34d4b6c-ac71-43ca-b7c2-6a7ec7f69c29",
    profiles,
    relationships: [
      { label: "Vale do Ouro", relation: "Empreendimento", status: "verified" },
      { entityId: "imob-1", label: "BELTRAO DINIZ IMOVEIS LTDA", relation: "Imobiliária", status: "verified" },
    ],
  }) as unknown as ApoloEntity;

function instalarFetch(status: number, corpo: unknown) {
  chamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      chamadas.push({
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        headers: { ...((init?.headers ?? {}) as Record<string, string>) },
        url,
      });
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

async function clicarEm(elemento: HTMLElement | null | undefined, nome: string) {
  if (!elemento) throw new Error(`"${nome}" não está na tela.`);
  act(() => {
    elemento.click();
  });
  await esperarPromessas();
}

const botaoComTexto = (trecho: string) =>
  Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    (b.textContent ?? "").includes(trecho),
  );
const excluirDoEmpreendimento = () =>
  Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>('button[aria-label="Excluir vínculo"]'))[0];

async function montarEAbrirEmpreendimentos(profiles: ApoloProfile[], onCreated = vi.fn()) {
  act(() => {
    raiz.render(
      <RelationshipsPanel
        entity={entidade(profiles)}
        onCreated={onCreated}
        onOpenEnterprise={vi.fn()}
        onOpenEntity={vi.fn()}
      />,
    );
  });
  await esperarPromessas();
  await clicarEm(botaoComTexto("Empreendimentos"), "grupo Empreendimentos");
  return onCreated;
}

let alerta: ReturnType<typeof vi.fn>;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  alerta = vi.fn();
  vi.spyOn(window, "alert").mockImplementation(alerta);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("excluir o empreendimento de quem tem CAD", () => {
  it("⚠️ o 409 da rota aparece com a frase dela, e nada se fecha como se tivesse passado", async () => {
    const frase = `Este empreendimento é o da CAD. ${FRASE_D1}`;
    instalarFetch(409, { error: frase });
    const onCreated = await montarEAbrirEmpreendimentos(["prospect"]);

    await clicarEm(excluirDoEmpreendimento(), "Excluir vínculo");

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.url).toBe("/api/apolo/relationships/archive");
    expect(chamadas[0]?.headers.Authorization).toBe("Bearer token-do-hub");
    expect(chamadas[0]?.body).toEqual({
      entityId: "c34d4b6c-ac71-43ca-b7c2-6a7ec7f69c29",
      label: "Vale do Ouro",
      relatedEntityId: null,
    });
    expect(alerta).toHaveBeenCalledWith(frase);
    expect(onCreated).not.toHaveBeenCalled();
    // A lista continua aberta: o operador vê que o vínculo segue lá.
    expect(hospedeiro.textContent).toContain("Vale do Ouro");
  });

  it("409 de empreendimento sem frase ainda aponta o Mover CAD, não o genérico", async () => {
    instalarFetch(409, {});
    await montarEAbrirEmpreendimentos(["prospect"]);

    await clicarEm(excluirDoEmpreendimento(), "Excluir vínculo");

    expect(alerta).toHaveBeenCalledWith(`Este empreendimento é o da CAD e não sai por aqui. ${FRASE_D1}`);
  });

  it("quando passa, fecha e recarrega a ficha como sempre", async () => {
    instalarFetch(200, { data: { archived: 1 } });
    const onCreated = await montarEAbrirEmpreendimentos(["prospect"]);

    await clicarEm(excluirDoEmpreendimento(), "Excluir vínculo");

    expect(alerta).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("a dica do excluir diz onde fica a troca no prospect, e não na imobiliária pura", async () => {
    instalarFetch(200, {});
    await montarEAbrirEmpreendimentos(["prospect"]);
    expect(excluirDoEmpreendimento()?.getAttribute("title")).toBe(`Excluir vínculo. ${FRASE_D1}`);

    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await montarEAbrirEmpreendimentos(["imobiliaria"]);
    expect(excluirDoEmpreendimento()?.getAttribute("title")).toBe("Excluir vínculo");
  });

  it("⚠️ D7: imobiliária que também é prospect (tem CAD) ganha a dica do Mover CAD", async () => {
    // O caso medido: PJ nascida imobiliária, perfis imobiliaria e prospect, CAD real no Recanto do
    // Pará. A trava do arquivamento responde 409 para ela; a dica não pode dizer só "Excluir vínculo".
    instalarFetch(200, {});
    await montarEAbrirEmpreendimentos(["imobiliaria", "prospect"]);
    expect(excluirDoEmpreendimento()?.getAttribute("title")).toBe(`Excluir vínculo. ${FRASE_D1}`);
  });
});

describe("D1: a frase diz quem troca o empreendimento", () => {
  const empreendimento = { label: "Vale do Ouro", relation: "Empreendimento", status: "verified" } as const;

  it("a constante é a frase da decisão, e as duas saídas do painel usam ela", () => {
    expect(FRASE_DO_MOVER_CAD).toBe(FRASE_D1);
    expect(dicaDoExcluir(empreendimento as never, ["prospect"])).toContain(FRASE_D1);
    expect(mensagemDaExclusao(409, null, true)).toContain(FRASE_D1);
  });

  it("nenhuma saída manda o usuário 'usar' o Mover CAD, nem tem travessão", () => {
    const saidas = [
      dicaDoExcluir(empreendimento as never, ["prospect"]),
      dicaDoExcluir(empreendimento as never, ["imobiliaria"]),
      mensagemDaExclusao(409, null, true),
      mensagemDaExclusao(409, {}, false),
      mensagemDaExclusao(404, null, true),
    ];
    for (const frase of saidas) {
      expect(frase).not.toMatch(/use Mover CAD/i);
      expect(frase).not.toMatch(/[–—]/);
    }
  });

  it("a frase da rota continua vindo primeiro", () => {
    expect(mensagemDaExclusao(409, { error: "Frase da rota." }, true)).toBe("Frase da rota.");
  });
});
