// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CORRIGIR O E-MAIL DE QUEM AINDA NÃO ASSINOU, MESMO SEM O CONVITE TER VOLTADO.
//
// Lucas, 01/10/2026, no card da MAURA MARIA PASSOS (Vale do Ouro VOC, Quadra 03 · Lote 06), com a
// linha dela em "Sem notícia": *"preciso alterar o e-mail da Maura e reenviar"*.
//
// ⚠️ AFIRMAÇÃO EM CAIXA ALTA: ATÉ AQUI O LÁPIS SÓ APARECIA NO CONVITE QUE VOLTOU
// (`convite === "nao_entregue"`). Em "sem notícia" a linha oferecia só o reenvio, que manda o
// convite para o MESMO endereço. O e-mail errado que não volta (de outra pessoa, ou um que a cliente
// não usa) ficava sem caminho na tela, embora o servidor sempre tenha aceitado a troca.
//
// A montagem é a de `contrato-em-assinatura.comportamento.test.tsx`.

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
/** Os corpos dos POST em `/assinatura/signatario`, na ordem. */
let pedidos: Array<Record<string, unknown>>;

const CARD = () => ({
  arrependimento_inicio: null,
  cliente_cpf: "111.222.333-44",
  cliente_nome: "MAURA MARIA PASSOS",
  contratos: [],
  enterprise_codigo: "VOC",
  enterprise_nome: "Vale do Ouro",
  estagio: "assinatura",
  estagio_desde: "2026-09-29T16:06:51.000Z",
  id: "card-maura",
  indeferido_motivo: null,
  indeferido_observacao: null,
  indeferido_por_nome: null,
  observacao: null,
  proposta_id: "venda-maura",
  tipo: "contrato",
  unidade: "Quadra 03 · Lote 06",
});

const ASSINATURA = () => ({
  assinaram: 1,
  diario: [],
  envelope: {
    documentoId: null,
    envelopeId: ENVELOPE,
    estado: "parcial",
    signatarios: [
      {
        assinouEm: "2026-09-29T17:12:00.000Z",
        chave: "s-assinou",
        comecouEm: null,
        convite: "sem_noticia",
        conviteDetalhe: null,
        conviteQuando: null,
        email: "coordenadora@exemplo.com",
        nome: "QUEM JÁ ASSINOU",
        papel: "coordenadora",
      },
      {
        assinouEm: null,
        chave: "s-maura",
        comecouEm: null,
        convite: "sem_noticia",
        conviteDetalhe: null,
        conviteQuando: null,
        email: "maura@exemplo.com",
        nome: "MAURA MARIA PASSOS",
        papel: "comprador",
      },
      {
        assinouEm: null,
        chave: "s-voltou",
        comecouEm: null,
        convite: "nao_entregue",
        conviteDetalhe: "Caixa inexistente",
        conviteQuando: "2026-09-29T17:20:00.000Z",
        email: "voltou@exemplo.com",
        nome: "CONVITE QUE VOLTOU",
        papel: "vendedora",
      },
    ],
  },
  total: 3,
});

function responder(url: string, init?: RequestInit): { corpo: unknown; status: number } {
  if (url.includes("/assinatura/signatario")) {
    pedidos.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return { corpo: { data: { ok: true } }, status: 200 };
  }
  if (url.includes("/trabalho?id=")) {
    return {
      corpo: {
        data: {
          analise: null,
          assinatura: ASSINATURA(),
          card: CARD(),
          envelopeVivo: { conferido: true, estado: "parcial", id: ENVELOPE, rotulo: "Parcialmente assinado" },
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

/** A linha de uma pessoa: o `<li>` da lista de quem assina (`LinhaDoSignatario`). */
function linhaDe(nome: string): HTMLElement {
  const linha = Array.from(hospedeiro.querySelectorAll<HTMLElement>("li")).find((el) =>
    el.textContent?.includes(nome),
  );
  if (!linha) throw new Error(`linha de ${nome} não encontrada`);
  return linha;
}

function lapisDe(nome: string): HTMLButtonElement | null {
  return linhaDe(nome).querySelector<HTMLButtonElement>('button[aria-label="Corrigir o e-mail"]');
}

function botaoQueContem(trecho: string): HTMLButtonElement | undefined {
  return Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    b.textContent?.includes(trecho),
  );
}

function digitar(campo: HTMLInputElement, valor: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

async function montar(): Promise<void> {
  act(() => {
    raiz.render(
      <TelaDeTrabalho aoFechar={() => undefined} aoMudar={() => undefined} trabalhoId="card-maura" />,
    );
  });
  await esperarPromessas();
}

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  pedidos = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve(
        (() => {
          const { corpo, status } = responder(String(url), init);
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("corrigir o e-mail de quem ainda não assinou", () => {
  it("em 'sem notícia' a linha ganha o lápis, e quem já assinou não ganha nada", async () => {
    await montar();

    expect(lapisDe("MAURA MARIA PASSOS"), "o lápis da Maura, em sem notícia").toBeTruthy();
    expect(lapisDe("QUEM JÁ ASSINOU"), "quem assinou não tem o que corrigir").toBeNull();
  });

  it("o convite que voltou continua com o botão escrito, e não ganha um lápis a mais", async () => {
    await montar();

    const linha = linhaDe("CONVITE QUE VOLTOU");
    const escrito = Array.from(linha.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Corrigir o e-mail"),
    );
    expect(escrito, "o botão escrito do convite que voltou").toBeTruthy();
    expect(lapisDe("CONVITE QUE VOLTOU"), "sem lápis duplicado").toBeNull();
  });

  it("o lápis abre o campo com o e-mail atual, e confirmar manda a troca só daquela pessoa", async () => {
    await montar();

    await act(async () => {
      lapisDe("MAURA MARIA PASSOS")?.click();
    });

    const campo = hospedeiro.querySelector<HTMLInputElement>('input[type="email"]');
    expect(campo, "o campo do e-mail novo").toBeTruthy();
    expect(campo?.value).toBe("maura@exemplo.com");

    await act(async () => {
      if (campo) digitar(campo, "maura.certo@exemplo.com");
    });

    await act(async () => {
      botaoQueContem("Confirmo: trocar e enviar")?.click();
    });
    await esperarPromessas();

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({
      acao: "trocar_email",
      email: "maura.certo@exemplo.com",
      envelopeId: ENVELOPE,
      signerId: "s-maura",
    });
  });
});
