// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A FILA DE ASSINATURA E O LINK PARA O CLIENTE, NA TELA "EM ASSINATURA" (02/10/2026).
//
// Lucas, no mesmo dia:
//   *"Temos que mostrar os assinantes por ordem de assinatura se não tiver ordem de assinatura ordem
//    alfabetica"*;
//   *"vamos editar e vamos informar (na ordem da tela) que aquele cadastro foi para ultima posição"*;
//   *"quero ter esse link para mandar para o cliente, tem hora que ele não acha o link no e-mail"*.
//
// ⚠️ QUEM ORDENA E QUEM SABE DO FIM DA FILA É O SERVIDOR (`naOrdemDaFila`, em
// `lib/assinatura/diario-do-envelope-db.ts`). Estes testes prendem que a tela NÃO reordena o que
// recebeu, que ela mostra a marca e o aviso que vêm prontos, e que o link sai num clique e vai para
// a área de transferência.
//
// A montagem é a de `corrigir-email-sem-noticia.comportamento.test.tsx`.

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
const LINK = "https://app.clicksign.com/notarial/widget/signatures/aaaa-1111/redirect";
const AVISO_YASMIN =
  "Ao corrigir o e-mail, YASMIN L. vai para o fim da fila de assinatura (a Clicksign põe quem é recadastrado depois de todos) e passa a esperar 2 pessoas que ainda não assinaram.";

let raiz: Root;
let hospedeiro: HTMLDivElement;
/** Os corpos dos POST em `/assinatura/signatario`, na ordem. */
let pedidos: Array<Record<string, unknown>>;
/** O que a rota do link responde neste teste. */
let respostaDoLink: { corpo: unknown; status: number };
/** Depois de uma troca de e-mail, a recarga devolve a pessoa com a chave nova E o cadastro antigo. */
let depoisDaTroca: boolean;

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

const pessoa = (chave: string, nome: string, patch: Record<string, unknown> = {}) => ({
  assinouEm: null,
  chave,
  comecouEm: null,
  convite: "sem_noticia",
  conviteDetalhe: null,
  conviteQuando: null,
  email: `${chave}@exemplo.com`,
  foiParaOFimEm: null,
  nome,
  papel: "testemunha",
  reenvioIndisponivel: null,
  trocaVaiParaOFim: null,
  ...patch,
});

// A ordem é a que o servidor manda: a fila. O convite que voltou está no MEIO de propósito, porque a
// tela antiga o puxava para o topo.
const ASSINATURA = () => ({
  assinaram: 1,
  diario: [],
  envelope: {
    documentoId: null,
    envelopeId: ENVELOPE,
    estado: "parcial",
    signatarios: [
      pessoa("s-coord", "COORDENADORA", { assinouEm: "2026-09-29T17:12:00.000Z", papel: "coordenadora" }),
      pessoa("s-yasmin", "YASMIN L.", { trocaVaiParaOFim: AVISO_YASMIN }),
      pessoa("s-voltou", "CONVITE QUE VOLTOU", {
        convite: "nao_entregue",
        conviteDetalhe: "Caixa inexistente",
        conviteQuando: "2026-09-29T17:20:00.000Z",
        papel: "vendedora",
        trocaVaiParaOFim: null,
      }),
      pessoa("s-maura", "MAURA MARIA PASSOS", { foiParaOFimEm: "2026-10-01T15:18:15.332-03:00", papel: "comprador" }),
      // O fantasma dos segundos depois da troca: o último aviso da Clicksign ainda traz o cadastro
      // antigo, e o quadro já traz o novo.
      ...(depoisDaTroca
        ? [pessoa("s-yasmin-nova", "YASMIN L.", { email: "yasmin.certa@exemplo.com", foiParaOFimEm: null })]
        : []),
    ],
  },
  total: depoisDaTroca ? 5 : 4,
});

function responder(url: string, init?: RequestInit): { corpo: unknown; status: number } {
  if (url.includes("/assinatura/signatario")) {
    const corpo = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    pedidos.push(corpo);
    if (corpo.acao === "link") return respostaDoLink;
    if (corpo.acao === "trocar_email") {
      depoisDaTroca = true;
      return { corpo: { data: { aviso: null, email: corpo.email, nome: "YASMIN L.", signerId: "s-yasmin-nova" } }, status: 200 };
    }
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

/** As linhas da lista de quem assina, na ordem em que aparecem. */
function linhas(): HTMLElement[] {
  return Array.from(hospedeiro.querySelectorAll<HTMLElement>("li")).filter((el) =>
    ["COORDENADORA", "YASMIN L.", "CONVITE QUE VOLTOU", "MAURA MARIA PASSOS"].some((n) => el.textContent?.includes(n)),
  );
}

function linhaDe(nome: string): HTMLElement {
  const linha = linhas().find((el) => el.textContent?.includes(nome));
  if (!linha) throw new Error(`linha de ${nome} não encontrada`);
  return linha;
}

async function montar(): Promise<void> {
  act(() => {
    raiz.render(
      <TelaDeTrabalho aoFechar={() => undefined} aoMudar={() => undefined} trabalhoId="card-maura" />,
    );
  });
  await esperarPromessas();
}

async function clicarNoLinkDe(nome: string): Promise<void> {
  await act(async () => {
    linhaDe(nome).querySelector<HTMLButtonElement>('button[aria-label="Copiar o link de assinatura"]')?.click();
  });
  await esperarPromessas();
}

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  pedidos = [];
  depoisDaTroca = false;
  respostaDoLink = { corpo: { data: { link: LINK, signerId: "s-yasmin" } }, status: 200 };
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

describe("a fila de assinatura na tela", () => {
  it("a lista fica na ordem que o servidor mandou: o convite que voltou não sobe mais para o topo", async () => {
    await montar();

    const nomes = linhas().map((l) =>
      ["COORDENADORA", "YASMIN L.", "CONVITE QUE VOLTOU", "MAURA MARIA PASSOS"].find((n) => l.textContent?.includes(n)),
    );
    expect(nomes).toEqual(["COORDENADORA", "YASMIN L.", "CONVITE QUE VOLTOU", "MAURA MARIA PASSOS"]);
  });

  it("quem foi recadastrado mostra que foi para o fim da fila, e só ele", async () => {
    await montar();

    expect(linhaDe("MAURA MARIA PASSOS").textContent).toContain("Foi para o fim da fila ao entrar depois do envio");
    expect(linhaDe("YASMIN L.").textContent).not.toContain("fim da fila");
  });

  it("antes de corrigir, o aviso do fim da fila aparece junto do campo; sem aviso, não aparece", async () => {
    await montar();

    await act(async () => {
      linhaDe("YASMIN L.").querySelector<HTMLButtonElement>('button[aria-label="Corrigir o e-mail"]')?.click();
    });
    expect(linhaDe("YASMIN L.").textContent).toContain(AVISO_YASMIN);
    expect(linhaDe("YASMIN L.").textContent).toContain("entra no envelope antes de o antigo sair");

    await act(async () => {
      Array.from(linhaDe("CONVITE QUE VOLTOU").querySelectorAll("button"))
        .find((b) => b.textContent?.includes("Corrigir o e-mail"))
        ?.click();
    });
    expect(linhaDe("CONVITE QUE VOLTOU").textContent).not.toContain("fim da fila");
  });
});

describe("o link de assinatura para mandar ao cliente", () => {
  it("o clique pede o link daquela pessoa e copia para a área de transferência", async () => {
    const escrever = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: escrever } });
    await montar();

    await clicarNoLinkDe("YASMIN L.");

    expect(pedidos).toEqual([{ acao: "link", envelopeId: ENVELOPE, signerId: "s-yasmin" }]);
    expect(escrever).toHaveBeenCalledWith(LINK);
    expect(linhaDe("YASMIN L.").textContent).toContain("Link de assinatura copiado");
  });

  it("quem já assinou não tem botão de link", async () => {
    await montar();

    expect(
      linhaDe("COORDENADORA").querySelector('button[aria-label="Copiar o link de assinatura"]'),
    ).toBeNull();
  });

  it("o link que ainda não chegou vira recado com a frase do servidor, e não erro", async () => {
    respostaDoLink = {
      corpo: { erro: "A Clicksign ainda não mandou para o Panteon o link desta pessoa." },
      status: 404,
    };
    await montar();

    await clicarNoLinkDe("YASMIN L.");

    const recado = Array.from(linhaDe("YASMIN L.").querySelectorAll("p")).find((p) =>
      p.textContent?.includes("ainda não mandou"),
    );
    expect(recado, "a frase do servidor").toBeTruthy();
    expect(recado?.className).not.toContain("rose");
  });

  it("se o navegador negar a cópia, o link aparece num campo para copiar à mão", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        writeText: async () => {
          throw new Error("negado");
        },
      },
    });
    await montar();

    await clicarNoLinkDe("YASMIN L.");

    const campo = linhaDe("YASMIN L.").querySelector<HTMLInputElement>('input[aria-label="Link de assinatura"]');
    expect(campo?.value).toBe(LINK);
  });
});

describe("o que a revisão de 02/10/2026 pediu na tela", () => {
  function digitar(campo: HTMLInputElement, valor: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("depois da troca, o recado sobrevive à recarga e o cadastro antigo some da lista", async () => {
    await montar();

    await act(async () => {
      linhaDe("YASMIN L.").querySelector<HTMLButtonElement>('button[aria-label="Corrigir o e-mail"]')?.click();
    });
    const campo = hospedeiro.querySelector<HTMLInputElement>('input[type="email"]');
    await act(async () => {
      if (campo) digitar(campo, "yasmin.certa@exemplo.com");
    });
    await act(async () => {
      Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button"))
        .find((b) => b.textContent?.includes("Confirmo: trocar e enviar"))
        ?.click();
    });
    await esperarPromessas();

    const yasmins = linhas().filter((l) => l.textContent?.includes("YASMIN L."));
    expect(yasmins, "uma Yasmin só, a do e-mail novo").toHaveLength(1);
    expect(yasmins[0]?.textContent).toContain("yasmin.certa@exemplo.com");
    expect(hospedeiro.textContent).toContain("YASMIN L.: E-mail corrigido");
    expect(hospedeiro.textContent).toContain("foi para o fim da fila de assinatura");
    // O total do cabeçalho não conta o cadastro antigo.
    expect(hospedeiro.textContent).toContain("1 de 4");
  });

  it("no convite que voltou o link fica desabilitado, e a frase manda corrigir o e-mail antes", async () => {
    await montar();

    const botao = linhaDe("CONVITE QUE VOLTOU").querySelector<HTMLButtonElement>(
      'button[aria-label="Copiar o link de assinatura"]',
    );
    expect(botao?.disabled).toBe(true);
    expect(botao?.title).toContain("corrija o e-mail antes de mandar o link");
  });

  it("dois cliques seguidos no link fazem um pedido só", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => undefined) } });
    await montar();

    await act(async () => {
      const botao = linhaDe("YASMIN L.").querySelector<HTMLButtonElement>('button[aria-label="Copiar o link de assinatura"]');
      botao?.click();
      botao?.click();
    });
    await esperarPromessas();

    expect(pedidos.filter((p) => p.acao === "link")).toHaveLength(1);
  });
});
