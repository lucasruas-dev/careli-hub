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
    semFinanceiro: false,
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
    semFinanceiro: false,
    situacao: "lida",
  };
})();

/** Um pedido lido do C2X com as parcelas dadas (o resto como no VAL C L22). */
const lidaCom = (campos: Partial<Extract<EntradaDoCard, { situacao: "lida" }>>): EntradaDoCard => ({
  ...(VAL_C_L22 as Extract<EntradaDoCard, { situacao: "lida" }>),
  ...campos,
});

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
    // O aviso de obra que este bloco substituiu não aparece em lugar nenhum da tela.
    expect(texto(hospedeiro)).not.toContain("A entrada lida do C2X");
    // O selo do cabeçalho diz que a entrada está paga e quando.
    expect(texto(b?.querySelector("[data-selo-da-entrada]"))).toContain("Paga em 29/09/2026");
    // O número do pedido à vista no cabeçalho, para o time procurar no C2X.
    expect(texto(b?.querySelector("[data-pedido-da-entrada]"))).toBe("Pedido 5021");

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

    // Passo 1: nenhum botão de faturar, nem pelo texto nem pelo nome acessível (o botão de ícone só
    // tem o `aria-label`).
    const botoes = Array.from(hospedeiro.querySelectorAll("button"));
    expect(botoes.length).toBeGreaterThan(0);
    expect(botoes.filter((x) => /fatur/i.test(`${x.textContent ?? ""} ${x.getAttribute("aria-label") ?? ""}`))).toEqual([]);
    // Sem travessão nos textos de tela do bloco.
    expect(texto(b)).not.toMatch(/[—–]/);
  });

  it("os gatilhos de tooltip do bloco são botões com nome (o teclado chega neles)", async () => {
    const pelaMarcacao = parcela({
      contaComoEntrada: true,
      id: 1,
      pagaPelaMarcacao: true,
      pagoEm: "2026-09-28",
      rotulo: "Sinal 1/1",
      situacao: "paga",
    });
    entrada = lidaCom({ entrada: pelaMarcacao, parcelas: [pelaMarcacao] });
    await montar();
    const b = bloco();
    // Nenhum gatilho ficou como `span` com papel de imagem.
    expect(b?.querySelectorAll('span[role="img"]')).toHaveLength(0);
    const nomes = Array.from(b?.querySelectorAll<HTMLButtonElement>('button[type="button"]') ?? []).map((x) => x.getAttribute("aria-label") ?? "");
    expect(nomes.some((n) => n.startsWith("Pedido 5021 no C2X, casado pelo envio da D4Sign"))).toBe(true);
    expect(nomes).toContain("A parcela que conta como entrada");
    expect(nomes.some((n) => n.startsWith("pago 28/09/2026: O C2X marcou como paga sem a data do pagamento"))).toBe(true);
  });

  it("Pago sem data: a parcela diz isso, e não 'em aberto' nem 'paga'", async () => {
    const semData = parcela({ contaComoEntrada: true, id: 1, rotulo: "Sinal 1/1", situacao: "pago_sem_data", valor: 4000 });
    entrada = lidaCom({ entrada: semData, paga: false, parcelas: [semData] });
    await montar();
    const b = bloco();
    expect(texto(b?.querySelector("[data-selo-da-entrada]"))).toContain("Pago sem data");
    const linha = b?.querySelector('[data-conta-como-entrada="sim"]');
    expect(texto(linha)).toContain("Pago sem data");
    expect(texto(linha)).not.toContain("Em aberto");
    expect(texto(linha)).not.toContain("pago ");
  });

  it("o pedido lido está desfeito no C2X: o aviso aparece com o número", async () => {
    entrada = lidaCom({ pedidoDesfeito: true });
    await montar();
    expect(texto(bloco())).toContain("O pedido 5021 está desfeito no C2X.");
  });

  it("sem pedido vivo e o do comprador desfeito depois da venda: diz qual pedido", async () => {
    entrada = { motivo: "pedido_desfeito_no_c2x", pedido: 5041, situacao: "sem_pedido_no_c2x" };
    await montar();
    expect(texto(bloco())).toContain("O pedido 5041 deste comprador está cancelado ou distratado no C2X.");
    expect(texto(bloco())).not.toContain("ainda não foi digitada");
  });

  it("o único pedido é de antes da venda (VOR Q14 L01): pede para conferir, com o número", async () => {
    entrada = { motivo: "pedido_anterior_a_venda", pedido: 5032, situacao: "ambiguo" };
    await montar();
    expect(texto(bloco())).toContain(
      "O pedido 5032 do C2X é de antes desta venda: confira se não é o de uma proposta cancelada.",
    );
  });

  it("o pedido vivo no lote é de outro CPF: confira antes de digitar", async () => {
    entrada = { motivo: "pedido_de_outro_comprador", situacao: "sem_pedido_no_c2x" };
    await montar();
    expect(texto(bloco())).toContain("O pedido vivo neste lote no C2X está em outro CPF: confira antes de digitar.");
    expect(texto(bloco())).not.toContain("ainda não foi digitada");
  });

  it("o financeiro não é do C2X (Garden): diz isso, sem mandar digitar e sem 'ler de novo'", async () => {
    entrada = { motivo: "financeiro_no_lsoft", situacao: "fora_do_c2x" };
    await montar();
    expect(texto(bloco())).toContain("O financeiro desta venda não é do C2X.");
    expect(texto(bloco())).not.toMatch(/digitad|digitar/i);
    expect(bloco()?.querySelector('button[aria-label="Ler de novo"]')).toBeNull();
  });

  it("o pedido sem nenhuma parcela lançada tem frase própria, diferente da entrada zerada", async () => {
    entrada = lidaCom({ entrada: null, paga: false, parcelas: [], semFinanceiro: true });
    await montar();
    expect(texto(bloco())).toContain("O C2X ainda não tem o financeiro deste pedido (nenhuma parcela lançada).");
    expect(texto(bloco())).not.toContain("não tem Ato nem Sinal com valor");

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    entrada = lidaCom({ entrada: null, paga: false, parcelas: [], semFinanceiro: false });
    await montar();
    expect(texto(bloco())).toContain("O pedido no C2X não tem Ato nem Sinal com valor.");
  });

  it("o Panteon não respondeu: diz que não leu a venda (e não o C2X)", async () => {
    entrada = { motivo: "panteon", situacao: "falhou" };
    await montar();
    expect(texto(bloco())).toContain("Não consegui ler a venda agora.");
    expect(texto(bloco())).not.toContain("C2X agora");
    expect(bloco()?.querySelector('button[aria-label="Ler de novo"]')).toBeTruthy();
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
