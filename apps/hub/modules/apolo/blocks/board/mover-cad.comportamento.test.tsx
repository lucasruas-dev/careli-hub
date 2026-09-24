// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O "MOVER CAD" MONTADO SOZINHO (terceira rodada da revisão, 24/09/2026). O Board inteiro está em
// board-view.mover-cad.comportamento.test.tsx; aqui fica o que a tela do Mover mostra, travado nos
// achados da rodada (cada teste falhava antes da correção, menos os de 503/409, que travam o contrato):
//   • lista de destinos VAZIA é falha de carga (catálogo ou portão fora do ar): o seletor diz "Não foi
//     possível carregar os empreendimentos agora.", e não "Nenhum destino recebendo CAD";
//   • aviso repetido pela rota não duplica a key da lista (o React avisava e a lista podia sumir item);
//   • alerta âmbar só com `incompleto`; aviso sem ele é texto neutro, e o ícone é o de sempre;
//   • 503 do portão e 409 da cobrança de pré-venda aparecem com a frase da rota, como veio.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../data/apolo-operations", () => ({
  getApoloAccessToken: () => Promise.resolve("token-do-hub"),
}));

const { MoverCad } = await import("./mover-cad");

const DESTINOS = [
  { id: "35", nome: "VALE DO OURO" },
  { id: "19", nome: "VEREDAS DO OURO" },
];

let raiz: Root;
let hospedeiro: HTMLDivElement;

function responder(status: number, corpo: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(corpo), {
          headers: { "content-type": "application/json" },
          status,
        }),
      ),
    ),
  );
}

async function esperarPromessas() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function montar(destinos: ReadonlyArray<{ id: string; nome: string }>, de = "19", mercado?: string) {
  act(() => {
    raiz.render(
      <MoverCad de={de} destinos={destinos} entityId="e1" mercado={mercado} onMovida={() => undefined} />,
    );
  });
  await esperarPromessas();
}

const botao = (rotulo: string) =>
  Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === rotulo,
  );
const seletor = () =>
  hospedeiro.querySelector<HTMLSelectElement>('select[aria-label="Empreendimento de destino"]');

async function clicarEm(elemento: HTMLElement | undefined, nome: string) {
  if (!elemento) throw new Error(`"${nome}" não está na tela.`);
  act(() => {
    elemento.click();
  });
  await esperarPromessas();
}

async function moverPara(valor: string) {
  await clicarEm(botao("Mover CAD"), "Mover CAD");
  const select = seletor();
  if (!select) throw new Error("O seletor de destino não está na tela.");
  act(() => {
    select.value = valor;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperarPromessas();
  await clicarEm(botao("Mover"), "Mover");
}

const RESULTADO = (extra: Record<string, unknown>) => ({
  data: {
    avisos: [],
    credito: { avaliado: false, motivo: null, passou: null },
    de: "19",
    empreendimentoNovo: "VALE DO OURO",
    etapaAnterior: "credenciado",
    etapaNova: "credenciado",
    para: "35",
    ...extra,
  },
});

const bloco = () => hospedeiro.querySelector<HTMLElement>('[role="status"]');
const listaDeAvisos = () => bloco()?.querySelector<HTMLUListElement>("ul") ?? null;
const avisosEscritos = () =>
  Array.from(bloco()?.querySelectorAll("li") ?? []).map((li) => li.textContent ?? "");

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

describe("o seletor sem destino", () => {
  it("⚠️ lista vazia do servidor (catálogo ou portão fora do ar): diz que não carregou", async () => {
    await montar([]);
    await clicarEm(botao("Mover CAD"), "Mover CAD");

    const primeira = seletor()?.options[0]?.textContent ?? "";
    expect(primeira).toBe("Não foi possível carregar os empreendimentos agora.");
    expect(hospedeiro.textContent).not.toMatch(/Nenhum destino recebendo CAD/);
    expect(seletor()?.disabled).toBe(true);
    expect(botao("Mover")?.disabled).toBe(true);
  });

  it("a lista veio, mas o único destino é o próprio produto: diz que não há outro", async () => {
    await montar([{ id: "35", nome: "VALE DO OURO" }], "36", "35");
    await clicarEm(botao("Mover CAD"), "Mover CAD");

    expect(seletor()?.options[0]?.textContent).toBe("Nenhum outro empreendimento recebe CAD.");
  });
});

describe("os avisos do 200", () => {
  it("⚠️ aviso repetido pela rota: aparece uma vez, sem key duplicada", async () => {
    const erroDoConsole = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repetido = "O vínculo com o empreendimento anterior não foi arquivado.";
    responder(200, RESULTADO({ avisos: [repetido, repetido], incompleto: true }));
    await montar(DESTINOS);
    await moverPara("35");

    expect(avisosEscritos()).toEqual([repetido]);
    const chaveDuplicada = erroDoConsole.mock.calls.some((chamada) =>
      chamada.some((parte) => /same key/i.test(String(parte))),
    );
    expect(chaveDuplicada).toBe(false);
  });

  it("⚠️ aviso SEM `incompleto`: texto neutro, sem alerta âmbar, e o check de sempre", async () => {
    const informativo =
      "O Lagoa Bonita está sem coordenador de vendas no C2X. Confira o cadastro do empreendimento.";
    responder(200, RESULTADO({ avisos: [informativo], incompleto: false }));
    await montar(DESTINOS);
    await moverPara("35");

    expect(bloco()?.dataset.tom).toBe("ok");
    expect(avisosEscritos()).toEqual([informativo]);
    expect(listaDeAvisos()?.dataset.avisos).toBe("informativo");
    expect(listaDeAvisos()?.className).not.toMatch(/amber/);
    expect(bloco()?.querySelector(".text-amber-600")).toBeNull();
  });

  it("com `incompleto`: alerta âmbar, e os avisos em âmbar", async () => {
    const falha = "O PDF da CAD não foi regenerado agora; sai na próxima troca de etapa.";
    responder(200, RESULTADO({ avisos: [falha], incompleto: true }));
    await montar(DESTINOS);
    await moverPara("35");

    expect(bloco()?.dataset.tom).toBe("atencao");
    expect(avisosEscritos()).toEqual([falha]);
    expect(listaDeAvisos()?.dataset.avisos).toBe("alerta");
    expect(listaDeAvisos()?.className).toMatch(/amber/);
  });
});

describe("as frases de erro da rota", () => {
  it("503 do portão de CAD: a frase da rota", async () => {
    const frase =
      "Não foi possível conferir os empreendimentos que recebem CAD agora. Nada foi alterado.";
    responder(503, { error: frase });
    await montar(DESTINOS);
    await moverPara("35");

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(frase);
    expect(bloco()).toBeNull();
  });

  it("409 da cobrança de pré-venda: a frase da rota, como veio", async () => {
    // A frase literal da rota (lib/apolo/mover-cad.ts, a recusa da CAD com `pagamento_ref`/`pago_em`).
    const frase =
      "Esta CAD já tem cobrança de pré-venda no empreendimento atual. Mover levaria a cobrança para outro empreendimento. Resolva a cobrança antes de mover.";
    responder(409, { error: frase });
    await montar(DESTINOS);
    await moverPara("35");

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(frase);
    expect(bloco()).toBeNull();
  });
});
