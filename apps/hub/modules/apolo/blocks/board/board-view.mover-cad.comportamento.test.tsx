// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O "MOVER CAD" NO CARD DO BOARD (24/09/2026), TRAVADO NO QUE APARECE E NO QUE VAI PARA A REDE.
//
// O caso real: a CAD do JONATAS nasceu no VEREDAS DO OURO (19) e era do VALE DO OURO (35). Sem uma
// ação de mover, o time trocou só o vínculo, e a CAD ficou no 19. O que se trava aqui:
//   • o botão só aparece quando o servidor manda `moverCad` (coordenação) e só na porta do hub;
//   • o destino oferecido nunca é o empreendimento em que a CAD já está;
//   • a chamada vai com o Bearer do hub (sem ele a rota dá 401: lição da v1.366.0) e com { de, para };
//   • depois do 200, UMA linha: empreendimento novo, etapa nova e, quando a rota avaliou o crédito
//     contra o limite do destino, se passou ou não; e a fila é recarregada;
//   • erro da rota aparece com a frase da rota, e a fila não é recarregada à toa.
//
// E o que a revisão de 24/09/2026 achou (cada um com o teste que falhava antes da correção):
//   • CAD numa divisão (36, Vale do Ouro · VOL): o seletor não oferece o próprio produto (35), pelo id
//     de MERCADO que o servidor manda no item;
//   • 200 com `incompleto`: alerta âmbar no lugar do check verde, e os avisos ESCRITOS (aviso sem
//     `incompleto` é informativo e não vira alerta: ver mover-cad.comportamento.test.tsx);
//   • 5xx sem o corpo da rota (o timeout da Vercel chega em HTML): "Não deu para confirmar", e a fila
//     recarrega, porque a CAD pode já estar no destino;
//   • imobiliária com CAD (D7): o botão aparece, porque quem decide é a CAD, não o papel.
//
// Mesma montagem manual dos outros testes de componente (board-view.credito.comportamento).

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

const API_DO_PORTAL = { base: "/api/incorporador/board", query: "emp=19", semToken: true };
const OCULTOS = ["disparos", "pix", "c2xSync", "avisarLote", "serasa"] as const;

const DESTINOS = [
  { id: "35", nome: "VALE DO OURO" },
  { id: "19", nome: "VEREDAS DO OURO" },
];

type Chamada = {
  body?: Record<string, unknown>;
  headers: Record<string, string>;
  method: string;
  url: string;
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
let chamadas: Chamada[];

// O card do JONATAS: CAD no 19, credenciado (pela configuração do Veredas, sem Serasa).
const cad = (over: Record<string, unknown> = {}) => ({
  analistaId: null,
  corretores: 0,
  criadoEm: "2026-09-21T18:14:52Z",
  documento: "062.570.696-02",
  empreendimentos: ["VEREDAS DO OURO"],
  enterpriseId: "19",
  etapa: "credenciado",
  id: "e1",
  motivo: null,
  nome: "JONATAS BRUCE DE OLIVEIRA",
  papel: "prospect",
  prevendaHabilitada: false,
  socios: 0,
  ...over,
});

// `cru` = o corpo vai como texto, sem JSON (o HTML de um 504 da Vercel). `falhaDeRede` = o fetch rejeita.
type RespostaDoMover = { corpo?: unknown; cru?: string; falhaDeRede?: boolean; status: number };

function instalarFetch(opcoes: {
  item: Record<string, unknown>;
  moverCad?: { destinos: typeof DESTINOS };
  resposta?: RespostaDoMover;
}) {
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
      let status = 200;
      if (caminho === "/api/incorporador/board" || caminho === "/api/apolo/board") {
        corpo = {
          data: {
            analistas: [],
            empreendimentos: ["VALE DO OURO", "VEREDAS DO OURO"],
            itens: [opcoes.item],
            ...(opcoes.moverCad ? { moverCad: opcoes.moverCad } : {}),
            usuarioAtual: { id: "conta", nome: "Nivea" },
          },
        };
      } else if (caminho.endsWith("/mover-empreendimento")) {
        if (opcoes.resposta?.falhaDeRede) return Promise.reject(new TypeError("Failed to fetch"));
        if (opcoes.resposta?.cru !== undefined) {
          return Promise.resolve(
            new Response(opcoes.resposta.cru, {
              headers: { "content-type": "text/html" },
              status: opcoes.resposta.status,
            }),
          );
        }
        corpo = opcoes.resposta?.corpo ?? { data: {} };
        status = opcoes.resposta?.status ?? 200;
      }
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

const texto = () => hospedeiro.textContent ?? "";
const botao = (rotulo: string) =>
  Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === rotulo,
  );
const seletor = () =>
  hospedeiro.querySelector<HTMLSelectElement>('select[aria-label="Empreendimento de destino"]');
const leiturasDaFila = () => chamadas.filter((c) => c.method === "GET" && c.url === "/api/apolo/board");

async function clicarEm(elemento: HTMLElement | undefined, nome: string) {
  if (!elemento) throw new Error(`"${nome}" não está na tela.`);
  act(() => {
    elemento.click();
  });
  await esperarPromessas();
}

async function escolher(valor: string) {
  const select = seletor();
  if (!select) throw new Error("O seletor de destino não está na tela.");
  act(() => {
    select.value = valor;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperarPromessas();
}

async function abrirFicha() {
  const card = Array.from(hospedeiro.querySelectorAll<HTMLElement>('article[role="button"]')).find(
    (el) => /jonatas/i.test(el.textContent ?? ""),
  );
  await clicarEm(card, "card do Jonatas");
}

/** Abre a ficha, abre o seletor, escolhe o Vale do Ouro e confirma. */
async function moverParaValeDoOuro() {
  await abrirFicha();
  await clicarEm(botao("Mover CAD"), "Mover CAD");
  await escolher("35");
  await clicarEm(botao("Mover"), "Mover");
}

const RESULTADO = (
  credito: { avaliado: boolean; motivo: null | string; passou: boolean | null },
  avisos: string[] = [],
  extra: Record<string, unknown> = {},
) => ({
  corpo: {
    data: {
      avisos,
      credito,
      de: "19",
      empreendimentoNovo: "VALE DO OURO",
      etapaAnterior: "credenciado",
      etapaNova: credito.avaliado ? "credenciado" : "credito",
      para: "35",
      ...extra,
    },
  },
  status: 200,
});

const FRASE_SEM_CONFIRMACAO =
  "Não deu para confirmar. Recarregue o Board para conferir onde a CAD está.";

// A linha do resultado: o bloco role="status", a frase de cima e os avisos escritos embaixo.
const bloco = () => hospedeiro.querySelector<HTMLElement>('[role="status"]');
const linhaDoResumo = () => bloco()?.querySelector("p") ?? null;
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

describe("quem vê o Mover CAD", () => {
  it("hub sem `moverCad` na fila (analista): o botão não aparece", async () => {
    instalarFetch({ item: cad() });
    await montar(<BoardView ocultar={[...OCULTOS]} />);
    await abrirFicha();

    expect(texto()).toContain("Veredas do Ouro");
    expect(botao("Mover CAD")).toBeUndefined();
  });

  it("hub com `moverCad` (coordenação): o botão aparece, e o destino nunca é o empreendimento atual", async () => {
    instalarFetch({ item: cad(), moverCad: { destinos: DESTINOS } });
    await montar(<BoardView ocultar={[...OCULTOS]} />);
    await abrirFicha();

    await clicarEm(botao("Mover CAD"), "Mover CAD");
    const opcoes = Array.from(seletor()?.options ?? []).map((o) => [o.value, o.textContent]);
    expect(opcoes).toEqual([
      ["", "Destino"],
      ["35", "Vale do Ouro"],
    ]);
    // Sem destino escolhido, não há o que confirmar.
    expect(botao("Mover")?.disabled).toBe(true);
  });

  it("portal: nem com `moverCad` na resposta o botão aparece (a rota é do hub)", async () => {
    instalarFetch({ item: cad(), moverCad: { destinos: DESTINOS } });
    await montar(<BoardView api={API_DO_PORTAL} empreendimentosFixos={[]} ocultar={[...OCULTOS]} />);
    await abrirFicha();

    expect(botao("Mover CAD")).toBeUndefined();
  });

  it("imobiliária não tem CAD: sem o botão", async () => {
    // Habilitada (papel `active`): a ficha abre concluída, sem a validação lado a lado.
    instalarFetch({
      item: cad({ enterpriseId: null, etapa: null, papel: "imobiliaria", papelStatus: "active" }),
      moverCad: { destinos: DESTINOS },
    });
    await montar(<BoardView ocultar={[...OCULTOS]} />);
    await abrirFicha();

    expect(botao("Mover CAD")).toBeUndefined();
  });

  it("⚠️ D7: imobiliária COM CAD tem o botão (quem decide é a CAD, não o papel)", async () => {
    // O caso medido: PJ nascida imobiliária, com CAD real no Recanto do Pará (20). O crédito dela
    // manda usar o Mover CAD; esconder o botão pelo papel deixava a CAD travada sem saída.
    instalarFetch({
      item: cad({
        empreendimentos: ["RECANTO DO PARÁ"],
        enterpriseId: "20",
        papel: "imobiliaria",
        papelStatus: "active",
      }),
      moverCad: { destinos: [...DESTINOS, { id: "20", nome: "RECANTO DO PARÁ" }] },
    });
    await montar(<BoardView ocultar={[...OCULTOS]} />);
    await abrirFicha();

    expect(texto()).toContain("Recanto do Pará");
    await clicarEm(botao("Mover CAD"), "Mover CAD");
    const opcoes = Array.from(seletor()?.options ?? []).map((o) => o.value);
    expect(opcoes).toEqual(["", "35", "19"]);
  });

  it("⚠️ CAD numa divisão (36 = Vale do Ouro · VOL): o próprio produto (35) não é destino", async () => {
    // O card diz VALE DO OURO; a rota sobe o 36 para o 35 e responderia 400 sempre. O servidor manda
    // o id de mercado no item, e é por ele que o destino sai da lista.
    instalarFetch({
      item: cad({ empreendimentos: ["VALE DO OURO"], enterpriseId: "36", enterpriseIdDeMercado: "35" }),
      moverCad: { destinos: DESTINOS },
    });
    await montar(<BoardView ocultar={[...OCULTOS]} />);
    await abrirFicha();

    await clicarEm(botao("Mover CAD"), "Mover CAD");
    const opcoes = Array.from(seletor()?.options ?? []).map((o) => [o.value, o.textContent]);
    expect(opcoes).toEqual([
      ["", "Destino"],
      ["19", "Veredas do Ouro"],
    ]);
  });
});

describe("mover a CAD", () => {
  it("manda o Bearer do hub e { de, para }, e mostra que o crédito NÃO passou no limite do destino", async () => {
    instalarFetch({
      item: cad(),
      moverCad: { destinos: DESTINOS },
      resposta: RESULTADO({
        avaliado: true,
        motivo: "Restrições de R$ 12.480,00 acima do limite de R$ 1.000,00.",
        passou: false,
      }),
    });
    await montar(<BoardView ocultar={[...OCULTOS]} />);
    const antes = leiturasDaFila().length;
    await moverParaValeDoOuro();

    const envio = chamadas.find((c) => c.url.endsWith("/mover-empreendimento"));
    expect(envio?.url).toBe("/api/apolo/board/e1/mover-empreendimento");
    expect(envio?.method).toBe("POST");
    expect(envio?.headers.Authorization).toBe("Bearer token-do-hub");
    expect(envio?.body).toEqual({ de: "19", para: "35" });

    expect(linhaDoResumo()?.textContent).toBe(
      "Vale do Ouro · Credenciado · Crédito não passou no limite do destino",
    );
    expect(linhaDoResumo()?.getAttribute("title")).toContain("acima do limite");
    expect(bloco()?.dataset.tom).toBe("reprovado");
    // A fila é recarregada: a etapa e o rótulo novos vêm do banco.
    expect(leiturasDaFila().length).toBeGreaterThan(antes);
  });

  it("crédito que passou no limite do destino diz que passou", async () => {
    instalarFetch({
      item: cad(),
      moverCad: { destinos: DESTINOS },
      resposta: RESULTADO({ avaliado: true, motivo: null, passou: true }),
    });
    await montar(<BoardView ocultar={[...OCULTOS]} />);
    await moverParaValeDoOuro();

    expect(bloco()?.textContent).toBe("Vale do Ouro · Credenciado · Crédito passou no limite do destino");
    // Tudo certo e sem aviso: o check verde, e nada escrito embaixo.
    expect(bloco()?.dataset.tom).toBe("ok");
    expect(avisosEscritos()).toEqual([]);
  });

  it("⚠️ passou, mas com aviso: alerta no lugar do check verde, e o aviso ESCRITO, não só no hover", async () => {
    // O caso da revisão: a consulta passou no limite do destino, a etapa não subiu, e a linha dizia
    // "Crédito passou" com o verde de tudo certo; o porquê ficava num title que o celular não mostra.
    instalarFetch({
      item: cad(),
      moverCad: { destinos: DESTINOS },
      resposta: RESULTADO(
        { avaliado: true, motivo: null, passou: true },
        ["A etapa não foi atualizada. A CAD ficou na análise de crédito do novo empreendimento."],
        { incompleto: true },
      ),
    });
    await montar(<BoardView ocultar={[...OCULTOS]} />);
    await moverParaValeDoOuro();

    expect(linhaDoResumo()?.textContent).toBe(
      "Vale do Ouro · Credenciado · Crédito passou no limite do destino",
    );
    expect(bloco()?.dataset.tom).toBe("atencao");
    expect(avisosEscritos()).toEqual([
      "A etapa não foi atualizada. A CAD ficou na análise de crédito do novo empreendimento.",
    ]);
  });

  it("`incompleto` sem aviso nenhum ainda explica o alerta", async () => {
    instalarFetch({
      item: cad(),
      moverCad: { destinos: DESTINOS },
      resposta: RESULTADO({ avaliado: false, motivo: null, passou: null }, [], { incompleto: true }),
    });
    await montar(<BoardView ocultar={[...OCULTOS]} />);
    await moverParaValeDoOuro();

    expect(bloco()?.dataset.tom).toBe("atencao");
    expect(avisosEscritos()).toEqual(["A troca não terminou. Confira a etapa da CAD no Board."]);
  });

  it("sem análise para avaliar, a CAD vai para a Análise de crédito e a linha não fala de 'passou'", async () => {
    instalarFetch({
      item: cad(),
      moverCad: { destinos: DESTINOS },
      resposta: RESULTADO(
        {
          avaliado: false,
          motivo: "Sem consulta de crédito recente. A CAD voltou para a análise de crédito do novo empreendimento.",
          passou: null,
        },
        ["O PDF da CAD não foi regenerado agora; sai na próxima troca de etapa."],
        { incompleto: true },
      ),
    });
    await montar(<BoardView ocultar={[...OCULTOS]} />);
    await moverParaValeDoOuro();

    const linha = linhaDoResumo()?.textContent ?? "";
    expect(linha).toBe("Vale do Ouro · Análise de crédito");
    expect(linha).not.toMatch(/passou/);
    // O porquê do crédito fica no hover; o aviso da rota fica ESCRITO embaixo, com o alerta.
    expect(linhaDoResumo()?.getAttribute("title")).toBe(
      "Sem consulta de crédito recente. A CAD voltou para a análise de crédito do novo empreendimento.",
    );
    expect(avisosEscritos()).toEqual([
      "O PDF da CAD não foi regenerado agora; sai na próxima troca de etapa.",
    ]);
    expect(bloco()?.dataset.tom).toBe("atencao");
  });

  it("erro da rota aparece com a frase dela, e a fila não é recarregada à toa", async () => {
    instalarFetch({
      item: cad(),
      moverCad: { destinos: DESTINOS },
      resposta: {
        corpo: { error: "Esta pessoa já tem CAD no VALE DO OURO. Resolva a duplicada antes de mover." },
        status: 409,
      },
    });
    await montar(<BoardView ocultar={[...OCULTOS]} />);
    await abrirFicha();
    const antes = leiturasDaFila().length;
    await clicarEm(botao("Mover CAD"), "Mover CAD");
    await escolher("35");
    await clicarEm(botao("Mover"), "Mover");

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      "Esta pessoa já tem CAD no VALE DO OURO. Resolva a duplicada antes de mover.",
    );
    expect(hospedeiro.querySelector('[role="status"]')).toBeNull();
    expect(leiturasDaFila().length).toBe(antes);
  });

  it("⚠️ 504 em HTML (timeout da Vercel): não afirma que falhou, manda conferir e recarrega a fila", async () => {
    // A rota grava a esteira no passo 1; o corte pode vir depois. Dizer "Não foi possível mover" e
    // deixar o card com o `de` antigo levava a nova tentativa a um 404.
    instalarFetch({
      item: cad(),
      moverCad: { destinos: DESTINOS },
      resposta: { cru: "<html><body>An error occurred with your deployment</body></html>", status: 504 },
    });
    await montar(<BoardView ocultar={[...OCULTOS]} />);
    await abrirFicha();
    const antes = leiturasDaFila().length;
    await clicarEm(botao("Mover CAD"), "Mover CAD");
    await escolher("35");
    await clicarEm(botao("Mover"), "Mover");

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(FRASE_SEM_CONFIRMACAO);
    expect(leiturasDaFila().length).toBeGreaterThan(antes);
    // O seletor fecha (o `de` dele pode estar velho), e nada de linha de sucesso.
    expect(seletor()).toBeNull();
    expect(bloco()).toBeNull();
  });

  it("5xx com corpo que não é objeto (uma string solta) também é incerto", async () => {
    instalarFetch({
      item: cad(),
      moverCad: { destinos: DESTINOS },
      resposta: { corpo: "Internal Server Error", status: 500 },
    });
    await montar(<BoardView ocultar={[...OCULTOS]} />);
    await moverParaValeDoOuro();

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(FRASE_SEM_CONFIRMACAO);
  });

  it("queda de rede: a mesma frase, e a fila recarrega", async () => {
    instalarFetch({ item: cad(), moverCad: { destinos: DESTINOS }, resposta: { falhaDeRede: true, status: 0 } });
    await montar(<BoardView ocultar={[...OCULTOS]} />);
    await abrirFicha();
    const antes = leiturasDaFila().length;
    await clicarEm(botao("Mover CAD"), "Mover CAD");
    await escolher("35");
    await clicarEm(botao("Mover"), "Mover");

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(FRASE_SEM_CONFIRMACAO);
    expect(leiturasDaFila().length).toBeGreaterThan(antes);
  });

  it("503 COM a frase da rota (saiu antes de escrever): a frase dela, sem recarregar", async () => {
    instalarFetch({
      item: cad(),
      moverCad: { destinos: DESTINOS },
      resposta: { corpo: { error: "Não deu para ler o cadastro agora. Nada foi alterado." }, status: 503 },
    });
    await montar(<BoardView ocultar={[...OCULTOS]} />);
    await abrirFicha();
    const antes = leiturasDaFila().length;
    await clicarEm(botao("Mover CAD"), "Mover CAD");
    await escolher("35");
    await clicarEm(botao("Mover"), "Mover");

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      "Não deu para ler o cadastro agora. Nada foi alterado.",
    );
    expect(leiturasDaFila().length).toBe(antes);
  });

  it("4xx sem corpo não fica mudo: diz o status, sem recarregar", async () => {
    instalarFetch({ item: cad(), moverCad: { destinos: DESTINOS }, resposta: { cru: "", status: 413 } });
    await montar(<BoardView ocultar={[...OCULTOS]} />);
    await abrirFicha();
    const antes = leiturasDaFila().length;
    await clicarEm(botao("Mover CAD"), "Mover CAD");
    await escolher("35");
    await clicarEm(botao("Mover"), "Mover");

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      "Não foi possível mover a CAD (413).",
    );
    expect(leiturasDaFila().length).toBe(antes);
  });
});
