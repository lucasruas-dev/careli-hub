// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EntradaDoCard, ParcelaDaEntrada } from "@/lib/hercules/entrada/regra";

// A ENTRADA NO CARD DO PRÉ-FATURAMENTO.
//
// Lucas, 02/10/2026: *"verifica se estamos conseguindo ler o financeiro desses contratos"*. O bloco
// "A entrada" era um aviso de obra; agora mostra as parcelas de Ato e Sinal lidas no C2X, a que conta
// como entrada em destaque, os Avulso pagos à parte (*"Mostrar e eu decido"*) e, quando não há o que
// mostrar, uma de três frases. Sem botão de faturar novo (*"So o passo 1"*).
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

let raiz: Root;
let hospedeiro: HTMLDivElement;
/** O campo `entrada` da rota. `undefined` = a rota não mandou (o portal). */
let entrada: EntradaDoCard | undefined;
let leiturasDoCard: number;

const CARD = () => ({
  arrependimento_inicio: "2026-09-26T12:00:00.000Z",
  cliente_cpf: null,
  cliente_nome: "COMPRADOR DE TESTE",
  contratos: [],
  enterprise_codigo: "VAL",
  enterprise_nome: "Vale",
  estagio: "prazo_legal",
  estagio_desde: "2026-09-26T12:00:00.000Z",
  id: "card-1",
  indeferido_motivo: null,
  indeferido_observacao: null,
  indeferido_por_nome: null,
  observacao: null,
  proposta_id: "venda-1",
  tipo: "contrato",
  unidade: "Quadra C · Lote 22",
});

const parcela = (campos: Partial<ParcelaDaEntrada> & Pick<ParcelaDaEntrada, "id" | "rotulo">): ParcelaDaEntrada => ({
  contaComoEntrada: false,
  pagaPelaMarcacao: false,
  pagoEm: null,
  situacao: "em_aberto",
  tipo: "sinal",
  valor: 2996.67,
  vencimento: "2026-10-10",
  ...campos,
});

/** O VAL C L22 de 02/10/2026: Sinal 1/3 pago em 29/09, os outros dois em aberto. */
const VAL_C_L22: EntradaDoCard = (() => {
  const primeira = parcela({ contaComoEntrada: true, id: 1, pagoEm: "2026-09-29", rotulo: "Sinal 1/3", situacao: "paga", vencimento: "2026-09-29" });
  return {
    avulsosPagos: [],
    entrada: primeira,
    paga: true,
    parcelas: [primeira, parcela({ id: 2, rotulo: "Sinal 2/3" }), parcela({ id: 3, rotulo: "Sinal 3/3", vencimento: "2026-11-10" })],
    pedido: 5021,
    pedidoDesfeito: false,
    regra: "envio_d4sign",
    situacao: "lida",
  };
})();

/** O REP D L163: Ato e Sinal atrasados, dois Avulso pagos em 28/09 no mesmo valor. */
const REP_D_L163: EntradaDoCard = (() => {
  const ato = parcela({ contaComoEntrada: true, id: 1, rotulo: "Ato", situacao: "vencida", tipo: "ato", valor: 1000, vencimento: "2026-09-28" });
  return {
    avulsosPagos: [
      parcela({ id: 3, pagoEm: "2026-09-28", rotulo: "Avulso", situacao: "paga", tipo: "avulso", valor: 1000 }),
      parcela({ id: 4, pagoEm: "2026-09-28", rotulo: "Avulso", situacao: "paga", tipo: "avulso", valor: 8390 }),
    ],
    entrada: ato,
    paga: false,
    parcelas: [ato, parcela({ id: 2, rotulo: "Sinal 1/1", situacao: "vencida", valor: 8390, vencimento: "2026-09-29" })],
    pedido: 5020,
    pedidoDesfeito: false,
    regra: "envio_d4sign",
    situacao: "lida",
  };
})();

function responder(url: string): { corpo: unknown; status: number } {
  if (url.includes("/trabalho?id=")) {
    leiturasDoCard += 1;
    return {
      corpo: {
        data: {
          analise: null,
          assinatura: null,
          card: CARD(),
          ...(entrada !== undefined ? { entrada } : {}),
          envelopeVivo: null,
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
    raiz.render(<TelaDeTrabalho aoFechar={() => undefined} aoMudar={() => undefined} trabalhoId="card-1" />);
  });
  await esperarPromessas();
}

const bloco = () => hospedeiro.querySelector<HTMLElement>('section[aria-label="A entrada"]');
/** O texto com os espaços do `Intl` (o NBSP de "R$ 1.000,00") trocados por espaço comum. */
const texto = (el: Element | null | undefined) => String(el?.textContent ?? "").replace(/\s+/g, " ");

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  entrada = VAL_C_L22;
  leiturasDoCard = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const { corpo, status } = responder(String(url));
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

describe("a entrada no Pré-faturamento", () => {
  it("as parcelas com valor, vencimento e pagamento, e a paga em destaque", async () => {
    await montar();
    const b = bloco();
    expect(b, "o bloco da entrada").toBeTruthy();
    expect(texto(b)).not.toContain("O que vem");
    // O selo do cabeçalho diz que a entrada está paga e quando.
    expect(texto(b?.querySelector("[data-selo-da-entrada]"))).toContain("Paga em 29/09/2026");

    const linhas = Array.from(b?.querySelectorAll("li") ?? []);
    expect(linhas).toHaveLength(3);
    expect(texto(linhas[0])).toContain("Sinal 1/3");
    expect(texto(linhas[0])).toContain("R$ 2.996,67");
    expect(texto(linhas[0])).toContain("vence 29/09/2026");
    expect(texto(linhas[0])).toContain("pago 29/09/2026");
    expect(texto(linhas[0])).toContain("Paga");
    expect(texto(linhas[1])).toContain("Em aberto");

    // Só a parcela que conta como entrada fica destacada.
    const destacadas = b?.querySelectorAll('[data-conta-como-entrada="sim"]') ?? [];
    expect(destacadas).toHaveLength(1);
    expect(texto(destacadas[0])).toContain("Sinal 1/3");

    // Passo 1: nenhum botão de faturar.
    expect(Array.from(hospedeiro.querySelectorAll("button")).some((x) => /fatura/i.test(x.textContent ?? ""))).toBe(false);
    // Sem travessão nos textos de tela do bloco.
    expect(texto(b)).not.toMatch(/[—–]/);
  });

  it("Avulso pago numa linha própria, com a frase de que o time decide", async () => {
    entrada = REP_D_L163;
    await montar();
    const b = bloco();
    expect(texto(b?.querySelector("[data-selo-da-entrada]"))).toContain("Vencida");
    const avulsos = b?.querySelector("[data-avulsos]");
    expect(texto(avulsos)).toContain("o time decide se conta como entrada");
    expect(avulsos?.querySelectorAll("li")).toHaveLength(2);
    expect(texto(avulsos)).toContain("R$ 8.390,00");
    expect(texto(avulsos)).toContain("pago 28/09/2026");
    // O Avulso não vira "a entrada": o destaque continua no Ato vencido.
    const destacada = b?.querySelector('[data-conta-como-entrada="sim"]');
    expect(texto(destacada)).toContain("Ato");
    expect(texto(destacada)).toContain("Vencida");
  });

  it("sem pedido no C2X: a venda ainda não foi digitada", async () => {
    entrada = { motivo: "sem_pedido_no_c2x", situacao: "sem_pedido_no_c2x" };
    await montar();
    expect(texto(bloco())).toContain("Sem pedido no C2X: a venda ainda não foi digitada.");
    expect(bloco()?.querySelectorAll("li")).toHaveLength(0);
  });

  it("mais de um pedido candidato: não casa, e diz por quê", async () => {
    entrada = { motivo: "dois_pedidos", situacao: "ambiguo" };
    await montar();
    expect(texto(bloco())).toContain("Não deu para casar a venda com um pedido do C2X (mais de um candidato).");
  });

  it("o C2X não respondeu: diz isso e oferece ler de novo", async () => {
    entrada = { motivo: "c2x", situacao: "falhou" };
    await montar();
    expect(texto(bloco())).toContain("Não consegui ler o C2X agora.");
    const deNovo = bloco()?.querySelector<HTMLButtonElement>('button[aria-label="Ler de novo"]');
    expect(deNovo).toBeTruthy();
    const antes = leiturasDoCard;
    entrada = VAL_C_L22;
    await act(async () => {
      deNovo?.click();
    });
    await esperarPromessas();
    expect(leiturasDoCard).toBe(antes + 1);
    expect(texto(bloco())).toContain("Sinal 1/3");
  });

  it("sem o campo (o portal): o bloco da entrada não aparece", async () => {
    entrada = undefined;
    await montar();
    expect(texto(hospedeiro)).toContain("Prazo de arrependimento");
    expect(bloco()).toBeNull();
  });
});
