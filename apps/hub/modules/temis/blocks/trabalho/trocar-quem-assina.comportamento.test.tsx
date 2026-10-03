// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// TROCAR QUEM ASSINA, NA TELA "EM ASSINATURA" (03/10/2026).
//
// Lucas, 03/10/2026: *"é basicamente eu tirar uma pessoa e colocar outra para assinar, não precisa
// mudar em nada no cadastro"*. Estes testes prendem:
//   - o botão mora ao lado do lápis, só para quem ainda não assinou;
//   - em comprador e cônjuge ele fica DESABILITADO, com o motivo (são as partes do contrato);
//   - o formulário abre vazio, com o aviso do fim da fila e a frase de que o texto não muda;
//   - o pedido vai com `trocar_pessoa`, e o recado fica no painel;
//   - NO PORTAL O BOTÃO NÃO EXISTE (o portal continua só com a correção de e-mail).
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
const { API_DA_TEMIS_DO_PORTAL, ApiDaTemisProvider } = await import("@/modules/temis/api-da-temis");
const { AVISO_DA_TROCA_DE_PESSOA, RECUSA_DE_TROCA_DE_PARTE_DO_CONTRATO } = await import(
  "@/lib/assinatura/recusa-de-reenvio"
);

const ENVELOPE = "0384000d-5299-4dcb-abeb-07a9face1545";
const AVISO_DO_FIM =
  "Quem entrar no lugar de RAFAEL GOMES vai para o fim da fila de assinatura (a Clicksign põe quem entra depois do envio atrás de todos) e passa a esperar 1 pessoa que ainda não assinou.";

let raiz: Root;
let hospedeiro: HTMLDivElement;
/** Os corpos dos POST em `/assinatura/signatario`, na ordem. */
let pedidos: Array<Record<string, unknown>>;
/** O que a troca de pessoa responde neste teste. */
let respostaDaTroca: { corpo: unknown; status: number };
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

const ASSINATURA = () => ({
  assinaram: 1,
  diario: [],
  envelope: {
    documentoId: null,
    envelopeId: ENVELOPE,
    estado: "parcial",
    signatarios: [
      pessoa("s-maura", "MAURA MARIA PASSOS", { papel: "comprador" }),
      pessoa("s-joao", "JOAO PASSOS", { papel: "conjuge" }),
      pessoa("s-rafael", "RAFAEL GOMES", { trocaDePessoaVaiParaOFim: AVISO_DO_FIM }),
      pessoa("s-rita", "RITA ALVES", { assinouEm: "2026-09-30T12:00:00.000Z", papel: "vendedora" }),
      ...(depoisDaTroca
        ? [pessoa("s-ana", "ANA PAULA DIAS", { email: "ana@exemplo.com", foiParaOFimEm: "2026-10-03T13:00:00.000Z" })]
        : []),
    ],
  },
  total: 4,
});

function responder(url: string, init?: RequestInit): { corpo: unknown; status: number } {
  if (url.includes("/assinatura/signatario")) {
    const corpo = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    pedidos.push(corpo);
    if (corpo.acao === "trocar_pessoa") {
      if (respostaDaTroca.status === 200) depoisDaTroca = true;
      return respostaDaTroca;
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

function linhaDe(nome: string): HTMLElement {
  const linha = Array.from(hospedeiro.querySelectorAll<HTMLElement>("li")).find((el) =>
    el.querySelector("p")?.textContent?.startsWith(nome),
  );
  if (!linha) throw new Error(`linha de ${nome} não encontrada`);
  return linha;
}

const botaoDeTrocar = (nome: string): HTMLButtonElement | null =>
  linhaDe(nome).querySelector<HTMLButtonElement>('button[aria-label="Trocar quem assina"]');

async function montar(noPortal = false): Promise<void> {
  const tela = <TelaDeTrabalho aoFechar={() => undefined} aoMudar={() => undefined} trabalhoId="card-maura" />;
  act(() => {
    raiz.render(noPortal ? <ApiDaTemisProvider {...API_DA_TEMIS_DO_PORTAL}>{tela}</ApiDaTemisProvider> : tela);
  });
  await esperarPromessas();
}

/** Digita num campo controlado do React (o setter nativo, para o `onChange` disparar). */
function digitar(campo: HTMLInputElement, valor: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const campo = (rotulo: string): HTMLInputElement => {
  const achado = hospedeiro.querySelector<HTMLInputElement>(`input[aria-label="${rotulo}"]`);
  if (!achado) throw new Error(`campo ${rotulo} não encontrado`);
  return achado;
};

async function abrirATrocaDoRafael(): Promise<HTMLElement> {
  await act(async () => {
    botaoDeTrocar("RAFAEL GOMES")?.click();
  });
  const grupo = hospedeiro.querySelector<HTMLElement>('[role="group"][aria-label^="Trocar quem assina"]');
  if (!grupo) throw new Error("o formulário não abriu");
  return grupo;
}

const confirmar = (grupo: HTMLElement): HTMLButtonElement => {
  const botao = Array.from(grupo.querySelectorAll("button")).find((b) => b.textContent?.includes("Confirmo"));
  if (!botao) throw new Error("botão de confirmar não encontrado");
  return botao;
};

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  pedidos = [];
  depoisDaTroca = false;
  respostaDaTroca = {
    corpo: { data: { aviso: null, email: "ana@exemplo.com", nome: "ANA PAULA DIAS", signerId: "s-ana" } },
    status: 200,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const { corpo, status } = responder(String(url), init);
      return Promise.resolve(
        new Response(JSON.stringify(corpo), { headers: { "content-type": "application/json" }, status }),
      );
    }),
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

describe("o botão de trocar quem assina", () => {
  it("aparece habilitado na testemunha que não assinou, ao lado do lápis", async () => {
    await montar();

    const botao = botaoDeTrocar("RAFAEL GOMES");
    expect(botao).not.toBeNull();
    expect(botao?.disabled).toBe(false);
    expect(linhaDe("RAFAEL GOMES").querySelector('button[aria-label="Corrigir o e-mail"]')).not.toBeNull();
  });

  it("em comprador e cônjuge fica desabilitado, com o motivo", async () => {
    await montar();

    for (const nome of ["MAURA MARIA PASSOS", "JOAO PASSOS"]) {
      const botao = botaoDeTrocar(nome);
      expect(botao?.disabled).toBe(true);
      expect(botao?.title).toBe(RECUSA_DE_TROCA_DE_PARTE_DO_CONTRATO);
    }
  });

  it("some para quem já assinou", async () => {
    await montar();
    expect(botaoDeTrocar("RITA ALVES")).toBeNull();
  });

  // ⚠️ DECISÃO DO LUCAS (03/10/2026): o portal continua só com a correção de e-mail.
  it("no portal ele não existe, e o lápis continua", async () => {
    await montar(true);

    expect(hospedeiro.querySelector('button[aria-label="Trocar quem assina"]')).toBeNull();
    expect(linhaDe("RAFAEL GOMES").querySelector('button[aria-label="Corrigir o e-mail"]')).not.toBeNull();
  });
});

describe("o formulário de trocar quem assina", () => {
  it("abre vazio, com o aviso do fim da fila e a frase de que o texto não muda, antes dos campos", async () => {
    await montar();
    const grupo = await abrirATrocaDoRafael();

    const texto = grupo.textContent ?? "";
    expect(texto).toContain(AVISO_DO_FIM);
    expect(texto).toContain(AVISO_DA_TROCA_DE_PESSOA);
    expect(texto).toContain("o card volta para a análise");

    // Os avisos vêm antes do primeiro campo.
    const primeiroCampo = grupo.querySelector("input");
    const aviso = Array.from(grupo.querySelectorAll("p")).find((p) => p.textContent === AVISO_DA_TROCA_DE_PESSOA);
    expect(aviso && primeiroCampo && aviso.compareDocumentPosition(primeiroCampo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    for (const rotulo of ["Nome de quem entra", "E-mail de quem entra", "CPF de quem entra"]) {
      expect(campo(rotulo).value).toBe("");
    }
    // Sem nome e e-mail não há o que confirmar.
    expect(confirmar(grupo).disabled).toBe(true);
  });

  it("manda trocar_pessoa com nome, e-mail e CPF, e o recado fica no painel", async () => {
    await montar();
    const grupo = await abrirATrocaDoRafael();

    digitar(campo("Nome de quem entra"), "  ANA   PAULA DIAS ");
    digitar(campo("E-mail de quem entra"), "ana@exemplo.com");
    digitar(campo("CPF de quem entra"), "529.982.247-25");
    expect(confirmar(grupo).disabled).toBe(false);

    await act(async () => {
      confirmar(grupo).click();
    });
    await esperarPromessas();

    expect(pedidos.at(-1)).toEqual({
      acao: "trocar_pessoa",
      cpf: "529.982.247-25",
      email: "ana@exemplo.com",
      envelopeId: ENVELOPE,
      nome: "ANA PAULA DIAS",
      signerId: "s-rafael",
    });

    // O formulário fechou (e o CPF saiu da tela), e o recado conta quem saiu e quem entrou.
    expect(hospedeiro.querySelector('[role="group"][aria-label^="Trocar quem assina"]')).toBeNull();
    expect(hospedeiro.textContent).toContain("RAFAEL GOMES saiu da assinatura e ANA PAULA DIAS entrou no lugar");
    expect(hospedeiro.textContent).toContain("ANA PAULA DIAS foi para o fim da fila de assinatura");
    expect(hospedeiro.textContent).not.toContain("529.982.247-25");
    // A linha de quem entrou diz por que ela está no fim.
    expect(linhaDe("ANA PAULA DIAS").textContent).toContain("Foi para o fim da fila ao entrar depois do envio");
  });

  it("a recusa do servidor aparece inteira, e o formulário fica aberto para corrigir", async () => {
    respostaDaTroca = {
      corpo: {
        erro: "RAFAEL GOMES assina este contrato com CPF, e quem entra no lugar precisa entrar do mesmo jeito. Informe o CPF de ANA PAULA DIAS. Nada foi mexido.",
        removido: false,
      },
      status: 400,
    };
    await montar();
    const grupo = await abrirATrocaDoRafael();
    digitar(campo("Nome de quem entra"), "ANA PAULA DIAS");
    digitar(campo("E-mail de quem entra"), "ana@exemplo.com");

    await act(async () => {
      confirmar(grupo).click();
    });
    await esperarPromessas();

    expect(linhaDe("RAFAEL GOMES").textContent).toContain("Informe o CPF de ANA PAULA DIAS");
    expect(hospedeiro.querySelector('[role="group"][aria-label^="Trocar quem assina"]')).not.toBeNull();
    expect(campo("Nome de quem entra").value).toBe("ANA PAULA DIAS");
  });

  it("cancelar fecha e limpa os campos", async () => {
    await montar();
    const grupo = await abrirATrocaDoRafael();
    digitar(campo("CPF de quem entra"), "529.982.247-25");

    await act(async () => {
      Array.from(grupo.querySelectorAll("button"))
        .find((b) => b.textContent === "Cancelar")
        ?.click();
    });
    expect(hospedeiro.querySelector('[role="group"][aria-label^="Trocar quem assina"]')).toBeNull();

    await abrirATrocaDoRafael();
    expect(campo("CPF de quem entra").value).toBe("");
    expect(pedidos).toEqual([]);
  });
});
