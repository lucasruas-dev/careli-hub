// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O BOTÃO DE CANCELAR CONTRATO NA TELA DE TRABALHO — o print da MAURA, montado de verdade.
//
// Lucas (23/09/2026): *"coloca por favor um botão de cancelamento de contrato na temis. o time vai
// precisar cancelar"*. O print: contrato da MAURA MARIA PASSOS (VOC, Quadra 03 Lote 06) em "Em
// assinatura", 1 de 11 assinantes já tendo assinado, e UM botão só na tela: "Voltar para análise".
//
// ⚠️ ESTE TESTE É DE TELA PORQUE A REGRESSÃO É DE TELA. Rota e serviço têm testes próprios; o que se
// perde calado é o botão não aparecer (a barra de ícones do topo nem renderizava neste card), aparecer
// no lugar errado (no portal, onde a rota não existe) ou o confirmar liberar sem motivo escrito.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const simulado = vi.hoisted(() => ({
  getApoloAccessToken: vi.fn(async () => "tok-do-hub" as null | string),
}));

vi.mock("@/lib/supabase/client", () => ({
  getHubSupabaseClient: () => null,
  hubSupabaseConfig: { anonKey: "chave-publica", url: "https://projeto.supabase.co" },
}));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: () => simulado.getApoloAccessToken(),
}));

const { TelaDeTrabalho } = await import("./tela-de-trabalho");
const { API_DA_TEMIS_DO_PORTAL, ApiDaTemisProvider } = await import("@/modules/temis/api-da-temis");

type Chamada = { corpo: unknown; metodo: string; url: string };

let raiz: Root;
let hospedeiro: HTMLDivElement;
let chamadas: Chamada[];
let recados: Array<{ pedeAcao?: boolean; recado: string }>;

/** O card do print: contrato em Em assinatura, com envelope vivo parcial. */
const CARD = {
  arrependimento_inicio: null,
  cliente_cpf: "111.222.333-44",
  cliente_nome: "MAURA MARIA PASSOS",
  contratos: [],
  enterprise_codigo: "VOC",
  enterprise_nome: "Vale do Ouro Central",
  estagio: "assinatura",
  estagio_desde: "2026-09-23T12:00:00.000Z",
  id: "card-contrato",
  indeferido_motivo: null,
  indeferido_observacao: null,
  indeferido_por_nome: null,
  observacao: null,
  proposta_id: "venda-maura",
  tipo: "contrato",
  unidade: "Quadra 03 · Lote 06",
};

/** A prévia que a confirmação busca. O teste troca por caso. */
let previa: { corpo: unknown; status: number } = {
  corpo: {
    data: {
      assinaturaCompleta: false,
      codigo: "COD 000021",
      comoSoube: {
        assinatura: "nenhuma assinatura registrada",
        pagamento: "nenhum pagamento registrado",
      },
      devolveValores: false,
      houvePagamento: false,
      pedidoAberto: null,
      porque: "as assinaturas não fecharam e nada foi pago: o contrato não chegou a se formar",
      tipo: "cancelamento",
      vendaDoLegado: false,
    },
  },
  status: 200,
};

/** O que o POST do cancelamento responde. O teste troca por caso. */
let respostaDoCancelamento: { corpo: unknown; status: number } = {
  corpo: {
    avisos: [],
    cardDoPedido: "card-pedido-novo",
    envelopeCancelado: "env-maura",
    ok: true,
    recado: "Cancelamento concluído: a venda COD 000021 foi cancelada e a unidade voltou para a disponibilidade.",
    tipo: "cancelamento",
    unidade: { frase: "a unidade voltou para a disponibilidade", voltou: true },
  },
  status: 200,
};

function responder(url: string, metodo: string): { corpo: unknown; status: number } {
  if (url.includes("/trabalho/cancelar-contrato")) {
    return metodo === "POST" ? respostaDoCancelamento : previa;
  }
  if (url.includes("/trabalho?id=")) {
    return {
      corpo: {
        data: {
          analise: null,
          assinatura: null,
          card: CARD,
          envelopeVivo: {
            conferido: true,
            estado: "parcial",
            id: "env-maura",
            rotulo: "Parcialmente assinado",
          },
          podeEmitir: true,
        },
      },
      status: 200,
    };
  }
  // Conversa, documentos e histórico não são assunto daqui: respondem vazio e saem da frente.
  return { corpo: { data: { documentos: [], historico: [], mensagens: [] } }, status: 200 };
}

function instalarFetch(): void {
  chamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const metodo = init?.method ?? "GET";
      chamadas.push({
        corpo: init?.body ? JSON.parse(String(init.body)) : null,
        metodo,
        url: String(url),
      });
      const { corpo, status } = responder(String(url), metodo);
      return Promise.resolve(
        new Response(JSON.stringify(corpo), {
          headers: { "content-type": "application/json" },
          status,
        }),
      );
    }),
  );
}

async function esperarPromessas(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function montar(elemento: React.ReactElement): Promise<void> {
  act(() => {
    raiz.render(elemento);
  });
  await esperarPromessas();
}

const tela = (
  <TelaDeTrabalho
    aoConcluir={(recado, pedeAcao) => recados.push({ pedeAcao, recado })}
    aoFechar={() => undefined}
    aoMudar={() => undefined}
    trabalhoId="card-contrato"
  />
);

function botaoPorRotulo(rotulo: string): HTMLButtonElement | undefined {
  return Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.getAttribute("aria-label") === rotulo,
  );
}

function botaoQueContem(trecho: string): HTMLButtonElement | undefined {
  return Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    b.textContent?.includes(trecho),
  );
}

async function clicar(botao: HTMLButtonElement | undefined): Promise<void> {
  expect(botao).toBeTruthy();
  await act(async () => {
    botao?.click();
  });
  await esperarPromessas();
}

async function digitarOMotivo(texto: string): Promise<void> {
  const campo = hospedeiro.querySelector<HTMLTextAreaElement>("#motivo-cancelamento");
  expect(campo).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      campo,
      texto,
    );
    campo?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function marcarAsDeclaracoes(): Promise<void> {
  const caixas = Array.from(
    hospedeiro.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  );
  expect(caixas.length).toBe(2);
  for (const caixa of caixas) {
    await act(async () => {
      caixa.click();
    });
  }
  await esperarPromessas();
}

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  recados = [];
  instalarFetch();
  previa = {
    corpo: {
      data: {
        assinaturaCompleta: false,
        codigo: "COD 000021",
        comoSoube: {
          assinatura: "nenhuma assinatura registrada",
          pagamento: "nenhum pagamento registrado",
        },
        devolveValores: false,
        houvePagamento: false,
        pedidoAberto: null,
        porque: "as assinaturas não fecharam e nada foi pago: o contrato não chegou a se formar",
        tipo: "cancelamento",
        vendaDoLegado: false,
      },
    },
    status: 200,
  };
  respostaDoCancelamento = {
    corpo: {
      avisos: [],
      cardDoPedido: "card-pedido-novo",
      envelopeCancelado: "env-maura",
      ok: true,
      recado: "Cancelamento concluído: a venda COD 000021 foi cancelada e a unidade voltou para a disponibilidade.",
      tipo: "cancelamento",
      unidade: { frase: "a unidade voltou para a disponibilidade", voltou: true },
    },
    status: 200,
  };
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("o card do print: contrato em Em assinatura", () => {
  it("o botão de cancelar o contrato aparece, ao lado da volta que já existia", async () => {
    await montar(tela);

    expect(botaoPorRotulo("Cancelar o contrato")).toBeTruthy();
    // ⚠️ A VOLTA CONTINUA ONDE ESTAVA: o conserto e a desistência são dois caminhos, não um.
    expect(botaoQueContem("Voltar para análise")).toBeTruthy();
  });

  it("a confirmação diz ENCERRA, nega o parentesco com a volta e conta o preço do envelope", async () => {
    await montar(tela);
    await clicar(botaoPorRotulo("Cancelar o contrato"));

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("ENCERRA");
    expect(texto).toContain("Voltar para análise");
    expect(texto).toContain("CANCELADO na Clicksign");
    // O que o sistema apurou fica na cara de quem clica.
    expect(texto).toContain("nenhuma assinatura registrada");
    expect(texto).toContain("não chegou a se formar");
  });

  it("sem motivo escrito o confirmar fica travado; com o motivo, ele libera e o POST sai", async () => {
    await montar(tela);
    await clicar(botaoPorRotulo("Cancelar o contrato"));

    expect(botaoQueContem("Confirmo: cancelar o contrato")?.disabled).toBe(true);

    await digitarOMotivo("Cliente desistiu da compra");
    expect(botaoQueContem("Confirmo: cancelar o contrato")?.disabled).toBe(false);

    await clicar(botaoQueContem("Confirmo: cancelar o contrato"));

    const post = chamadas.find((c) => c.metodo === "POST");
    expect(post?.url).toBe("/api/temis/trabalho/cancelar-contrato");
    expect(post?.corpo).toEqual({
      declaracoes: {},
      id: "card-contrato",
      motivo: "Cliente desistiu da compra",
    });
    // O recado do servidor sobe inteiro para o quadro.
    expect(recados[0]?.recado).toContain("voltou para a disponibilidade");
    expect(recados[0]?.pedeAcao).toBe(false);
  });

  // ⚠️ O LOTE QUE NÃO VOLTOU PEDE AÇÃO: o recado verde de oito segundos já escondeu esse aviso uma
  // vez (a queixa de 18/09/2026), e aqui ele tem de chegar como pendência.
  it("lote que não voltou sobe como recado que pede ação", async () => {
    respostaDoCancelamento = {
      corpo: {
        avisos: ["O card de contrato continua aberto: indefira por lá."],
        ok: true,
        recado: "Cancelamento concluído: a unidade NÃO voltou para a disponibilidade.",
        unidade: { voltou: false },
      },
      status: 200,
    };
    await montar(tela);
    await clicar(botaoPorRotulo("Cancelar o contrato"));
    await digitarOMotivo("Cliente desistiu");
    await clicar(botaoQueContem("Confirmo: cancelar o contrato"));

    expect(recados[0]?.pedeAcao).toBe(true);
  });

  // ⚠️ A FRASE DO SERVIDOR SOBE LETRA POR LETRA: é ela que manda terminar pelo card do pedido em vez
  // de tentar de novo e abrir o segundo pedido do mesmo contrato.
  it("recusa da Clicksign: a tela escreve o que o servidor disse, e o card não muda", async () => {
    respostaDoCancelamento = {
      corpo: {
        erro: "A Clicksign recusou o cancelamento do envelope env-maura: ele continua valendo. O pedido de cancelamento FICOU ABERTO na fila com o motivo registrado.",
      },
      status: 502,
    };
    await montar(tela);
    await clicar(botaoPorRotulo("Cancelar o contrato"));
    await digitarOMotivo("Cliente desistiu");
    await clicar(botaoQueContem("Confirmo: cancelar o contrato"));

    expect(hospedeiro.textContent ?? "").toContain("FICOU ABERTO");
    expect(recados).toEqual([]);
  });
});

describe("quando a apuração diz distrato", () => {
  it("as duas declarações aparecem e travam o botão até serem marcadas", async () => {
    previa = {
      corpo: {
        data: {
          assinaturaCompleta: true,
          codigo: "COD 000021",
          comoSoube: {
            assinatura: "contrato assinado por todos na Clicksign",
            pagamento: "nenhum pagamento registrado",
          },
          devolveValores: false,
          houvePagamento: false,
          pedidoAberto: null,
          porque: "o contrato foi assinado por todos e nada foi pago: exige distrato, sem devolução",
          tipo: "distrato",
          vendaDoLegado: false,
        },
      },
      status: 200,
    };
    await montar(tela);
    await clicar(botaoPorRotulo("Cancelar o contrato"));
    await digitarOMotivo("Cliente desistiu da compra");

    expect(hospedeiro.textContent ?? "").toContain("Distrato");
    expect(botaoQueContem("Confirmo: cancelar o contrato")?.disabled).toBe(true);

    await marcarAsDeclaracoes();

    expect(botaoQueContem("Confirmo: cancelar o contrato")?.disabled).toBe(false);
    await clicar(botaoQueContem("Confirmo: cancelar o contrato"));
    expect(chamadas.find((c) => c.metodo === "POST")?.corpo).toMatchObject({
      declaracoes: { devolucaoAcertada: true, termoAssinado: true },
    });
  });
});

describe("o que a tela não oferece", () => {
  // ⚠️ ESCONDER O BOTÃO NÃO FECHA A PORTA (quem fecha é a régua nominal no servidor), mas oferecer o
  // que a porta recusa é ensinar o time a ler recusa como defeito.
  it("sem a permissão, a recusa do servidor aparece e o confirmar não libera", async () => {
    previa = {
      corpo: { erro: "Cancelar o contrato é do time de contratos. Peça o cancelamento a quem tem esse acesso." },
      status: 403,
    };
    await montar(tela);
    await clicar(botaoPorRotulo("Cancelar o contrato"));
    // Não há campo de motivo para preencher: a confirmação nem chega a oferecer o formulário.
    expect(hospedeiro.querySelector("#motivo-cancelamento")).toBeNull();
    expect(hospedeiro.textContent ?? "").toContain("time de contratos");
    expect(botaoQueContem("Confirmo: cancelar o contrato")?.disabled).toBe(true);
  });

  it("pedido já na fila: a confirmação manda concluir por ele e não oferece o cancelamento", async () => {
    previa = {
      corpo: {
        data: {
          assinaturaCompleta: false,
          codigo: "COD 000021",
          comoSoube: { assinatura: "a", pagamento: "b" },
          devolveValores: false,
          houvePagamento: false,
          pedidoAberto: "card-pedido-velho",
          porque: "x",
          tipo: "cancelamento",
          vendaDoLegado: false,
        },
      },
      status: 200,
    };
    await montar(tela);
    await clicar(botaoPorRotulo("Cancelar o contrato"));

    expect(hospedeiro.textContent ?? "").toContain("já tem um pedido de cancelamento na fila");
    expect(botaoQueContem("Confirmo: cancelar o contrato")?.disabled).toBe(true);
  });

  // ⚠️ NO PORTAL A ROTA NÃO EXISTE: a régua é nominal e essas pessoas não existem na sessão do
  // portal. Botão ali seria 404 na cara de quem clicasse.
  it("no portal que confecciona, o botão não aparece", async () => {
    await montar(
      <ApiDaTemisProvider {...API_DA_TEMIS_DO_PORTAL}>{tela}</ApiDaTemisProvider>,
    );

    expect(botaoPorRotulo("Cancelar o contrato")).toBeUndefined();
    // E a volta para análise, que é do portal também, continua lá.
    expect(botaoQueContem("Voltar para análise")).toBeTruthy();
  });
});
