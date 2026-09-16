// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A PORTA QUE O BOARD DO PRODUTO MONTA, POR QUEM OPERA (16/09/2026).
//
// Decisão do Lucas: *"A Cecílio, no portal"* faz a análise de crédito e o credenciamento dos clientes
// dela; a Gurgel (comercial) NÃO, o crédito das vendas dela continua com a Careli no Apolo. O que se
// prova aqui: sem a prop, a porta é EXATAMENTE a de antes (o comercial); com `operaSozinho`, só o
// Serasa sai da lista do que fica escondido e o Board recebe a flag. Nesses casos o BoardView é
// trocado por um espião: o Board de verdade tem os próprios testes, e montar o kanban aqui só provaria
// o kanban.
//
// (16/09/2026, D1) E O PRODUTO SÓ CONSULTA. Decisão do Lucas: no portal que confecciona, a escrita só
// vale no produto que ele opera; VOC e VOR ficam só consulta para a Cecílio. Com `somenteLeitura`, o
// Board DE VERDADE é montado (o espião repassa para ele) e nenhum botão de escrita pode aparecer.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const propsDoBoard: Array<Record<string, unknown>> = [];
const montagem = { deVerdade: false };

vi.mock("@/modules/apolo/blocks/board/board-view", async (original) => {
  const real = await original<typeof import("@/modules/apolo/blocks/board/board-view")>();
  return {
    ...real,
    BoardView: (props: Record<string, unknown>) => {
      propsDoBoard.push(props);
      if (!montagem.deVerdade) return null;
      const BoardDeVerdade = real.BoardView;
      return <BoardDeVerdade {...(props as React.ComponentProps<typeof BoardDeVerdade>)} />;
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({
  getHubSupabaseClient: () => null,
  hubSupabaseConfig: { anonKey: "chave-publica", url: "https://projeto.supabase.co" },
}));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: () => Promise.resolve("token-do-hub"),
}));

vi.mock("../tema", () => ({
  useTemaDoPortal: () => ({ efetivo: "claro" }),
}));

const { BoardDoProduto } = await import("./BoardDoProduto");

let raiz: Root;
let hospedeiro: HTMLDivElement;

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

const ultimo = () => propsDoBoard[propsDoBoard.length - 1];

beforeEach(() => {
  propsDoBoard.length = 0;
  montagem.deVerdade = false;
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("BoardDoProduto", () => {
  it("comercial (sem a prop): a porta de sempre, com o Serasa e o resto escondidos", async () => {
    await montar(<BoardDoProduto emp="pai:garden" />);

    expect(ultimo()).toEqual({
      api: { base: "/api/incorporador/board", query: "emp=pai%3Agarden", semToken: true },
      empreendimentosFixos: [],
      ocultar: ["serasa", "c2xSync", "avisarLote", "disparos", "pix"],
      operaSozinho: false,
      somenteLeitura: false,
    });
  });

  it("portal que opera sozinho: o Serasa aparece, PIX, C2X, aviso em lote e disparos seguem fora", async () => {
    await montar(<BoardDoProduto emp="39" operaSozinho />);

    const props = ultimo();
    expect(props?.operaSozinho).toBe(true);
    expect(props?.somenteLeitura).toBe(false);
    expect(props?.ocultar).toEqual(["c2xSync", "avisarLote", "disparos", "pix"]);
    expect(props?.ocultar).not.toContain("serasa");
    // A porta continua sendo a do portal: cookie, sem Bearer, com o emp.
    expect(props?.api).toEqual({ base: "/api/incorporador/board", query: "emp=39", semToken: true });
  });

  it("operaSozinho={false} explícito é o comercial", async () => {
    await montar(<BoardDoProduto emp="39" operaSozinho={false} />);
    expect(ultimo()?.ocultar).toContain("serasa");
    expect(ultimo()?.operaSozinho).toBe(false);
  });

  it("somenteLeitura chega ao BoardView", async () => {
    await montar(<BoardDoProduto emp="37" operaSozinho somenteLeitura />);
    expect(ultimo()?.somenteLeitura).toBe(true);
  });
});

// (16/09/2026, D1) O BOARD DE VERDADE NO PRODUTO SÓ CONSULTA: nenhum botão que grava, em nenhuma
// etapa, nem para a CAD nem para a imobiliária; a faixa explica. E nada sai da tela para a rede
// além das leituras.
describe("BoardDoProduto só consulta (o Board de verdade)", () => {
  type Chamada = { method: string; url: string };
  let chamadas: Chamada[];

  function instalarFetch(item: Record<string, unknown>) {
    chamadas = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        chamadas.push({ method: init?.method ?? "GET", url });
        const caminho = url.split("?")[0] ?? "";
        let corpo: unknown = { data: {} };
        if (caminho === "/api/incorporador/board") {
          corpo = {
            data: {
              analistas: [],
              empreendimentos: ["Vale do Ouro"],
              itens: [item],
              usuarioAtual: { id: "conta", nome: "Maria" },
            },
          };
        } else if (caminho.endsWith("/documentos")) {
          corpo = { documents: [] };
        } else if (caminho.endsWith("/habilitar")) {
          corpo = {
            data: {
              empreendimentos: [{ enterpriseId: "37", habilitado: false, label: "Vale do Ouro" }],
              papelStatus: "review",
              pendencias: [],
            },
          };
        } else if (/\/board\/[^/]+$/.test(caminho)) {
          corpo = {
            data: {
              asana: null,
              cadastro: {},
              conjuge: {},
              contato: { email: "", telefone: "" },
              endereco: null,
              entidade: { criadoEm: "", documento: "529.982.247-25", nome: "Fulano", nomeFantasia: "", papel: "prospect", tipo: "pf" },
            },
          };
        }
        return Promise.resolve(
          new Response(JSON.stringify(corpo), { headers: { "content-type": "application/json" }, status: 200 }),
        );
      }),
    );
  }

  const cad = (over: Record<string, unknown> = {}) => ({
    analistaId: null,
    corretores: 0,
    criadoEm: "2026-09-10T10:00:00Z",
    documento: "529.982.247-25",
    empreendimentos: ["Vale do Ouro"],
    enterpriseId: "37",
    etapa: "validacao",
    id: "e1",
    motivo: null,
    nome: "FULANO DE TAL",
    papel: "prospect",
    prevendaHabilitada: false,
    socios: 0,
    ...over,
  });

  // Tudo o que grava, em qualquer etapa do Board (rótulos exatos dos botões).
  const BOTOES_DE_ESCRITA = [
    "Editar ficha",
    "Salvar alterações",
    "Voltar",
    "Reabrir validação",
    "Reabrir análise",
    "Retomar análise",
    "Enviar para correção",
    "Enviar ao coordenador",
    "Aprovar",
    "Credenciar",
    "Confirmar pagamento",
    "Indeferir",
    "Recusar",
    "Aprovar com restrição",
    "Aprovar com restrição (coordenação)",
    "Consultar Serasa",
    "Consultar de novo (pode gerar cobrança)",
    "Habilitar imobiliária",
    "Avisar coordenador",
  ];

  const texto = () => hospedeiro.textContent ?? "";
  const rotulos = () =>
    Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).map((b) => b.textContent?.trim() ?? "");

  async function abrirFicha() {
    const card = Array.from(hospedeiro.querySelectorAll<HTMLElement>('article[role="button"]')).find((el) =>
      /fulano/i.test(el.textContent ?? ""),
    );
    if (!card) throw new Error("card do Fulano não está na tela");
    act(() => card.click());
    await esperarPromessas();
  }

  const semEscrita = () => {
    for (const rotulo of BOTOES_DE_ESCRITA) {
      expect(rotulos(), `"${rotulo}" apareceu no produto só consulta`).not.toContain(rotulo);
    }
    expect(chamadas.filter((c) => c.method !== "GET")).toEqual([]);
    expect(chamadas.some((c) => c.url.includes("/serasa/"))).toBe(false);
  };

  for (const etapa of ["validacao", "credito", "revisao", "prevenda", "correcao", "indeferido"]) {
    it(`CAD em ${etapa}: nenhum botão de escrita, a faixa aparece, e só leituras vão à rede`, async () => {
      montagem.deVerdade = true;
      instalarFetch(cad({ etapa, prevendaHabilitada: etapa === "prevenda" }));
      await montar(<BoardDoProduto emp="37" operaSozinho somenteLeitura />);

      expect(texto()).toContain("Só consulta neste produto.");
      await abrirFicha();
      // A ficha abriu de verdade (a navegação e a leitura continuam), só sem escrita.
      expect(rotulos()).toContain("Voltar para a fila");
      expect(hospedeiro.querySelector('button[aria-label="Chat e histórico"]')).toBeTruthy();
      expect(texto()).toContain("Só consulta neste produto.");
      semEscrita();
    });
  }

  it("imobiliária em validação: sem habilitar, recusar, corrigir nem reabrir; as caixinhas não mudam", async () => {
    montagem.deVerdade = true;
    instalarFetch(cad({ enterpriseId: null, etapa: null, papel: "imobiliaria", papelStatus: "review" }));
    await montar(<BoardDoProduto emp="37" operaSozinho somenteLeitura />);

    // No kanban o quadro abre nas CADs: a imobiliária está na aba dela.
    const aba = Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      b.textContent?.trim().startsWith("Imobiliárias"),
    );
    act(() => aba?.click());
    await esperarPromessas();
    await abrirFicha();

    expect(texto()).toContain("Empreendimentos a liberar");
    semEscrita();
    const caixas = Array.from(hospedeiro.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(caixas.length).toBeGreaterThan(0);
    expect(caixas.every((caixa) => caixa.disabled)).toBe(true);
  });

  it("sem somenteLeitura (o produto que o portal opera): as ações voltam", async () => {
    montagem.deVerdade = true;
    instalarFetch(cad({ enterpriseId: "39", etapa: "validacao" }));
    await montar(<BoardDoProduto emp="39" operaSozinho />);

    expect(texto()).not.toContain("Só consulta neste produto.");
    await abrirFicha();
    expect(rotulos()).toContain("Enviar para correção");
    expect(rotulos()).toContain("Editar ficha");
  });
});

// QUEM MONTA. A flag nasce do modo da ficha: o "incorporador" é o portal que opera a própria venda
// (`portalOperaVenda` sem ser comercial, que é `portalConfeccionaContrato`). O Board do comercial (a
// aba Cadastro dele) não recebe `operaSozinho`, e por isso fica exatamente como era.
// (16/09/2026, D1) As duas montagens passam `somenteLeitura` pelo `podeEscrever` do painel; para o
// comercial ele é sempre verdadeiro, então nada muda para a Gurgel.
describe("a FichaDoProduto repassa o modo", () => {
  const ficha = readFileSync(join(__dirname, "FichaDoProduto.tsx"), "utf8");

  it("a aba Board (só do incorporador) liga operaSozinho pelo modo e somenteLeitura pelo podeEscrever", () => {
    expect(ficha).toMatch(
      /aba === "board" \? \(\s*<BoardDoProduto\s+emp=\{linha\.id\}\s+operaSozinho=\{incorporador\}\s+somenteLeitura=\{linha\.podeEscrever !== true\}\s*\/>/,
    );
    expect(ficha).toMatch(/const incorporador = modo === "incorporador";/);
  });

  it("o Board do comercial segue sem operaSozinho, com somenteLeitura pelo podeEscrever", () => {
    expect(ficha).toMatch(
      /\) : \(\s*<BoardDoProduto emp=\{linha\.id\} somenteLeitura=\{linha\.podeEscrever !== true\} \/>\s*\)/,
    );
  });
});
