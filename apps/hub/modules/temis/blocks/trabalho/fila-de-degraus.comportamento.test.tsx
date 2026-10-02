// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A FILA DE DEGRAUS NA TELA "EM ASSINATURA" E NO "PRÉ-FATURAMENTO" (02/10/2026, mockup aprovado).
//
// Lucas, no mesmo dia: *"essa tela está ruim... Primeiro melhorar o layout dessa tela a UI está ruim.
// Temos que mostrar os assinantes por ordem de assinatura se não tiver ordem de assinatura ordem
// alfabética."* E, sobre o mockup: *"pode seguir, ficou bom"*.
//
// ⚠️ QUEM NUMERA O DEGRAU É O SERVIDOR (`posicao`, de `naOrdemDaFila`). Estes testes prendem que a
// tela AGRUPA pelo número sem reordenar, que o degrau "na vez" é o primeiro com alguém sem assinar, que
// o cabeçalho conta os compradores pela régua do quadro, e que o silêncio de quem ainda espera a vez
// não se escreve como "Sem notícia".
//
// A montagem é a de `fila-e-link-de-assinatura.comportamento.test.tsx`.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/supabase/client", () => ({
  getHubSupabaseClient: () => null,
  hubSupabaseConfig: { anonKey: "chave-publica", url: "https://projeto.supabase.co" },
}));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: async () => "tok-do-hub",
}));

const { TelaDeTrabalho } = await import("./tela-de-trabalho");

const ENVELOPE = "0384000d-5299-4dcb-abeb-07a9face1545";

let raiz: Root;
let hospedeiro: HTMLDivElement;
/** O que a carga do card devolve neste teste. */
let carga: { assinatura: unknown; estagio: string; estadoDoEnvelope: string };

/** Uma pessoa como a carga do card a manda (a forma de `SignatarioNaTela`). */
type PessoaNaCarga = Record<string, unknown> & { assinouEm: null | string; chave: string; posicao: null | number };

const pessoa = (
  chave: string,
  nome: string,
  papel: string,
  posicao: null | number,
  patch: Record<string, unknown> = {},
): PessoaNaCarga => ({
  assinouEm: null,
  chave,
  comecouEm: null,
  convite: "sem_noticia",
  conviteDetalhe: null,
  conviteQuando: null,
  email: `${chave}@exemplo.com`,
  foiParaOFimEm: null,
  nome,
  papel,
  posicao,
  reenvioIndisponivel: null,
  trocaVaiParaOFim: null,
  ...patch,
});
const assinou = { assinouEm: "2026-10-01T16:54:00.000Z" };

/**
 * O VOC0306 como ele está (nomes trocados): a Maura recadastrada foi do degrau 3 para o 6, o 3 ficou
 * vazio, a testemunha Rafael assinou na frente dela, e o degrau 4 é o que está na vez.
 */
const VOC0306 = (estado = "parcial") => {
  const signatarios = [
    pessoa("s-fab", "FABRICIO G.", "coordenadora", 1, assinou),
    pessoa("s-hub", "HUBER J.", "coordenadora", 1, assinou),
    pessoa("s-niv", "NIVEA A.", "coordenadora", 1, assinou),
    pessoa("s-rom", "ROMULO G.", "corretor", 2, assinou),
    pessoa("s-nor", "NORTHON N.", "testemunha", 4),
    pessoa("s-raf", "RAFAEL O.", "testemunha", 4, assinou),
    pessoa("s-yas", "YASMIN L.", "testemunha", 4, { comecouEm: "2026-10-01T18:02:00.000Z" }),
    pessoa("s-hel", "HELENA A.", "vendedora", 5),
    pessoa("s-mar", "MARCOS P.", "vendedora", 5),
    pessoa("s-vit", "VITOR A.", "vendedora", 5),
    pessoa("s-mau", "MAURA MARIA PASSOS", "comprador", 6, { foiParaOFimEm: "2026-10-01T15:18:15.332-03:00" }),
  ];
  return {
    assinaram: signatarios.filter((s) => s.assinouEm).length,
    diario: [],
    envelope: {
      documentoId: null,
      envelopeId: ENVELOPE,
      estado,
      signatarios,
      venceEm: "2026-10-29T19:25:39.934Z",
    },
    total: signatarios.length,
  };
};

const CARD = () => ({
  arrependimento_inicio: carga.estagio === "prazo_legal" ? "2026-10-01T13:12:00.000Z" : null,
  cliente_cpf: "111.222.333-44",
  cliente_nome: "MAURA MARIA PASSOS",
  contratos: [],
  enterprise_codigo: "VOC",
  enterprise_nome: "Vale do Ouro",
  estagio: carga.estagio,
  estagio_desde: "2026-09-29T14:20:00.000Z",
  id: "card-maura",
  indeferido_motivo: null,
  indeferido_observacao: null,
  indeferido_por_nome: null,
  observacao: null,
  proposta_id: "venda-maura",
  tipo: "contrato",
  unidade: "Quadra 03 · Lote 06",
});

function responder(url: string): { corpo: unknown; status: number } {
  if (url.includes("/trabalho?id=")) {
    return {
      corpo: {
        data: {
          analise: null,
          assinatura: carga.assinatura,
          card: CARD(),
          envelopeVivo: {
            conferido: true,
            estado: carga.estadoDoEnvelope,
            id: ENVELOPE,
            rotulo: "Parcialmente assinado",
          },
          podeEmitir: true,
        },
      },
      status: 200,
    };
  }
  return { corpo: { data: { documentos: [], eventos: [], mensagens: [] } }, status: 200 };
}

async function esperarPromessas(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function montar(): Promise<void> {
  act(() => {
    raiz.render(
      <TelaDeTrabalho aoFechar={() => undefined} aoMudar={() => undefined} trabalhoId="card-maura" />,
    );
  });
  await esperarPromessas();
}

/** Os degraus da fila, na ordem em que aparecem: o `aria-label` é "rótulo: estado". */
function degraus(): string[] {
  return Array.from(hospedeiro.querySelectorAll<HTMLElement>("section[aria-label]")).map(
    (s) => s.getAttribute("aria-label") ?? "",
  );
}

function degrau(rotulo: string): HTMLElement {
  const achado = Array.from(hospedeiro.querySelectorAll<HTMLElement>("section[aria-label]")).find((s) =>
    s.getAttribute("aria-label")?.startsWith(`${rotulo}:`),
  );
  if (!achado) throw new Error(`degrau ${rotulo} não encontrado`);
  return achado;
}

/** O quadro do cabeçalho pelo rótulo ("Compradores", "Contrato", "Vence"). */
function quadro(rotulo: string): string {
  const titulo = Array.from(hospedeiro.querySelectorAll("header p")).find((p) => p.textContent === rotulo);
  return titulo?.parentElement?.textContent ?? "";
}

function linhaDe(nome: string): HTMLElement {
  const linha = Array.from(hospedeiro.querySelectorAll<HTMLElement>("li")).find((el) =>
    el.textContent?.includes(nome),
  );
  if (!linha) throw new Error(`linha de ${nome} não encontrada`);
  return linha;
}

beforeEach(() => {
  // Só o relógio é falso: as promessas e o `setTimeout` da montagem continuam de verdade.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T15:00:00.000Z"));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  carga = { assinatura: VOC0306(), estadoDoEnvelope: "parcial", estagio: "assinatura" };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        (() => {
          const { corpo, status } = responder(String(url));
          return new Response(JSON.stringify(corpo), {
            headers: { "content-type": "application/json" },
            status,
          });
        })(),
      ),
    ),
  );
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a fila de degraus", () => {
  it("agrupa pelo degrau do servidor, na ordem que veio, com o estado de cada um", async () => {
    await montar();

    expect(degraus()).toEqual([
      "Coordenação: Concluído",
      "Corretor: Concluído",
      "Testemunhas: Na vez",
      "Vendedoras: Aguardando",
      "Comprador: Aguardando",
    ]);
  });

  it("numera os degraus em sequência para quem lê, mesmo com o 3 vazio da Clicksign", async () => {
    await montar();

    const numeros = ["Testemunhas", "Vendedoras", "Comprador"].map(
      (r) => degrau(r).querySelector("span[aria-hidden='true'].rounded-full")?.textContent,
    );
    expect(numeros).toEqual(["3", "4", "5"]);
  });

  it("o degrau na vez é o primeiro com alguém sem assinar, e a faixa diz quem falta nele", async () => {
    await montar();

    const faixa = Array.from(hospedeiro.querySelectorAll("header p")).find((p) =>
      p.textContent?.startsWith("Na vez:"),
    );
    expect(faixa?.textContent).toContain("Na vez: Testemunhas");
    expect(faixa?.textContent).toContain("faltam Northon, Yasmin");
    expect(faixa?.textContent).not.toContain("Rafael");
  });

  it("o degrau concluído nasce fechado, com o resumo, e abre na seta", async () => {
    await montar();

    const coordenacao = degrau("Coordenação");
    expect(coordenacao.querySelector("ul")?.hidden).toBe(true);
    expect(coordenacao.textContent).toContain("FABRICIO G., HUBER J., NIVEA A.");

    await act(async () => {
      coordenacao.querySelector<HTMLButtonElement>('button[aria-label="Ver quem assinou"]')?.click();
    });
    expect(degrau("Coordenação").querySelector("ul")?.hidden).toBe(false);
  });

  it("quem ainda espera a vez aparece como 'Aguarda a vez', e não como 'Sem notícia'", async () => {
    await montar();

    expect(linhaDe("HELENA A.").textContent).toContain("Aguarda a vez");
    expect(linhaDe("HELENA A.").textContent).not.toContain("Sem notícia");
    // No degrau da vez, o silêncio continua sendo silêncio.
    expect(linhaDe("NORTHON N.").textContent).toContain("Sem notícia");
    expect(linhaDe("YASMIN L.").textContent).toContain("Abriu para assinar");
  });

  it("as ações continuam as mesmas na linha de quem espera, com os mesmos rótulos", async () => {
    await montar();

    const linha = linhaDe("HELENA A.");
    expect(linha.querySelector('button[aria-label="Corrigir o e-mail"]')).toBeTruthy();
    expect(linha.querySelector('button[aria-label="Reenviar o convite para este e-mail"]')).toBeTruthy();
    expect(linha.querySelector('button[aria-label="Copiar o link de assinatura"]')).toBeTruthy();
  });

  it("o degrau com papéis iguais não repete o papel em cada linha; o degrau que mistura, repete", async () => {
    await montar();
    expect(linhaDe("NORTHON N.").textContent).not.toContain("Testemunha");

    // Envelope sem ordem: todo mundo no degrau 1, papéis diferentes.
    carga.assinatura = {
      assinaram: 0,
      diario: [],
      envelope: {
        documentoId: null,
        envelopeId: ENVELOPE,
        estado: "aguardando",
        signatarios: [
          pessoa("s-ana", "ANA", "comprador", 1),
          pessoa("s-bia", "BIA", "testemunha", 1),
        ],
      },
      total: 2,
    };
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await montar();

    expect(degraus()).toEqual(["Assinam juntos: Na vez"]);
    expect(linhaDe("ANA").textContent).toContain("Comprador");
    expect(linhaDe("BIA").textContent).toContain("Testemunha");
  });

  it("sem número de degrau nenhum, a lista vira um degrau só, sem inventar fila", async () => {
    const semNumero = VOC0306();
    semNumero.envelope.signatarios = semNumero.envelope.signatarios.map((s) => ({ ...s, posicao: null }));
    carga.assinatura = semNumero;
    await montar();

    expect(degraus()).toEqual(["Quem assina: Na vez"]);
  });
});

describe("o cabeçalho do painel", () => {
  it("conta os compradores pela régua do quadro, o contrato inteiro e o vencimento", async () => {
    await montar();

    expect(quadro("Compradores")).toContain("0 de 1");
    expect(quadro("Compradores")).toContain("falta MAURA MARIA PASSOS");
    expect(quadro("Contrato")).toContain("5 de 11");
    expect(quadro("Vence")).toContain("29/10");
    expect(quadro("Vence")).toContain("em 27 dias");
  });

  it("no Pré-faturamento, com os compradores assinados, o painel continua e o quadro fecha", async () => {
    const pre = VOC0306();
    pre.envelope.signatarios = pre.envelope.signatarios.map((s) =>
      s.chave === "s-mau" ? { ...s, assinouEm: "2026-10-01T13:12:00.000Z" } : s,
    );
    pre.assinaram += 1;
    carga = { assinatura: pre, estadoDoEnvelope: "parcial", estagio: "prazo_legal" };
    await montar();

    expect(hospedeiro.textContent).toContain("Prazo de arrependimento");
    expect(quadro("Compradores")).toContain("1 de 1");
    expect(quadro("Compradores")).toContain("todos assinaram");
    expect(quadro("Contrato")).toContain("6 de 11");
    expect(degraus()).toContain("Testemunhas: Na vez");
  });

  it("envelope encerrado não tem vez de ninguém nem prazo", async () => {
    carga = { assinatura: VOC0306("cancelado"), estadoDoEnvelope: "cancelado", estagio: "assinatura" };
    await montar();

    expect(degraus()).toContain("Testemunhas: Não concluído");
    expect(hospedeiro.textContent).not.toContain("Na vez:");
    expect(quadro("Vence")).toBe("");
  });
});
