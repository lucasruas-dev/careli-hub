// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O PAINEL DO SERASA NAS DUAS PORTAS, TRAVADO NO QUE VAI PARA A REDE E NO QUE A PESSOA VÊ.
//
// Decisão do Lucas (16/09/2026): *"A Cecílio, no portal"* faz a análise de crédito dos clientes dela.
// O que se prova aqui e não na régua pura: que o hub segue chamando as mesmas rotas com o Bearer, que
// o portal chama as dele SEM o Bearer (o cookie vai sozinho), que o portal não mostra o que só a
// Careli tem (bancada, aviso de reprovação, reenvio, seguir pelo cônjuge, baixar comprovante e CAD) e
// que o recado do servidor (`data.mensagem`) aparece.
//
// Mesma montagem manual dos outros testes de componente (ArquivosDoProduto.comportamento).

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/supabase/client", () => ({
  getHubSupabaseClient: () => null,
  hubSupabaseConfig: { anonKey: "chave-publica", url: "https://projeto.supabase.co" },
}));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: () => Promise.resolve("token-do-hub"),
}));

const { CreditoSerasa } = await import("./credito-serasa");

const PORTAL = { base: "/api/incorporador/board", query: "emp=39", semToken: true };

type Chamada = {
  body?: Record<string, unknown>;
  headers: Record<string, string>;
  method: string;
  url: string;
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
let chamadas: Chamada[];

function instalarFetch(responder: (chamada: Chamada) => { corpo: unknown; status?: number }) {
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
      const { corpo, status = 200 } = responder(chamada);
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

async function clicar(rotulo: string) {
  const alvo = botao(rotulo);
  if (!alvo) throw new Error(`Botão "${rotulo}" não está na tela.`);
  act(() => {
    alvo.click();
  });
  await esperarPromessas();
}

// A situação com uma consulta guardada, cliente casado, CAD em revisão: é onde o hub mostra tudo.
const situacaoCompleta = (over: Record<string, unknown> = {}) => ({
  data: {
    ambiente: "producao",
    avisoAmbiente: null,
    configurado: true,
    conjuge: { nome: "Beltrana", temCpf: true, temConjuge: true },
    consultasHoje: 3,
    disparos: [],
    ehAdmin: true,
    etapa: "revisao",
    tetoDiario: 200,
    ultimaConsulta: {
      ambiente: "producao",
      created_at: "2026-09-10T12:00:00Z",
      id: "c1",
      report_name: "RELATORIO_BASICO_PF_PME",
      resposta: null,
      resumo: { score: 420 },
      veredito: { aprovado: false, limite: 1000, motivo: "Restrições acima do limite", total: 5000 },
    },
    ...over,
  },
});

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

describe("CreditoSerasa no hub (sem a porta): nada muda", () => {
  it("lê e consulta pelas rotas de sempre, com o Bearer do hub", async () => {
    instalarFetch((chamada) =>
      chamada.method === "GET"
        ? { corpo: situacaoCompleta({ etapa: "credito", ultimaConsulta: null }) }
        : { corpo: { data: { consultaAnterior: {}, reaproveitada: true } } },
    );
    await montar(<CreditoSerasa entityId="e1" />);

    expect(chamadas[0]).toMatchObject({
      headers: { Authorization: "Bearer token-do-hub" },
      method: "GET",
      url: "/api/apolo/serasa/consultar?entityId=e1",
    });

    await clicar("Consultar Serasa");
    const post = chamadas.find((c) => c.method === "POST");
    expect(post).toMatchObject({
      headers: { Authorization: "Bearer token-do-hub", "Content-Type": "application/json" },
      url: "/api/apolo/serasa/consultar",
    });
    expect(post?.body).toMatchObject({ alvo: "titular", confirmado: true, entityId: "e1", forcar: false });
  });

  it("mostra o que é da Careli: baixar, aviso de reprovação, reenvio e a frase da coordenação", async () => {
    instalarFetch(() => ({ corpo: situacaoCompleta() }));
    await montar(<CreditoSerasa entityId="e1" />);

    expect(botao("Baixar comprovante")).toBeTruthy();
    expect(botao("Baixar CAD")).toBeTruthy();
    expect(texto()).toContain("Aviso de reprovação");
    expect(botao("Reenviar ao coordenador")).toBeTruthy();
    expect(botao("Consultar de novo (gera nova cobrança)")).toBeTruthy();
    expect(texto()).toContain("o credenciamento segue mesmo com o titular em revisão");
  });

  it("sem integração, a bancada da autenticação continua lá", async () => {
    instalarFetch(() => ({ corpo: { data: { configurado: false, faltando: ["SERASA_CLIENT_ID"] } } }));
    await montar(<CreditoSerasa entityId="e1" />);

    expect(texto()).toContain("Integração com o Serasa ainda não configurada");
    expect(texto()).toContain("Bancada de teste da autenticação");
  });

  // (16/09/2026, D9) Decisão do Lucas: no hub, só a coordenação força nova consulta dentro de 30 dias.
  // O analista recebe a consulta guardada com o recado, e a tela mostra o recado sem mover o card.
  it("analista que pede consultar de novo dentro da janela: o recado da coordenação aparece e nada se move", async () => {
    const onResultado = vi.fn();
    const recado = "Só a coordenação pode pedir uma nova consulta dentro de 30 dias.";
    instalarFetch((chamada) =>
      chamada.method === "GET"
        ? { corpo: situacaoCompleta({ ehAdmin: false }) }
        : {
            corpo: {
              data: {
                consultaAnterior: { id: "c1" },
                forcarRecusado: true,
                mensagem: recado,
                reaproveitada: true,
              },
            },
          },
    );
    await montar(<CreditoSerasa entityId="e1" onResultado={onResultado} />);
    await clicar("Consultar de novo (gera nova cobrança)");

    const post = chamadas.find((c) => c.method === "POST");
    expect(post?.body).toMatchObject({ forcar: true });
    expect(texto()).toContain(recado);
    expect(hospedeiro.querySelector('[role="status"]')?.textContent).toBe(recado);
    expect(onResultado).not.toHaveBeenCalled();
  });

  it("analista no cônjuge já consultado: o resultado guardado do cônjuge e o recado aparecem", async () => {
    const recado = "Só a coordenação pode pedir uma nova consulta dentro de 30 dias.";
    instalarFetch((chamada) =>
      chamada.method === "GET"
        ? { corpo: situacaoCompleta({ ehAdmin: false }) }
        : {
            corpo: {
              data: {
                alvo: "conjuge",
                consultaAnterior: { id: "c2" },
                forcarRecusado: true,
                mensagem: recado,
                reaproveitada: true,
                veredito: { aprovado: true, limite: 1000, motivo: null, total: 0 },
              },
            },
          },
    );
    await montar(<CreditoSerasa entityId="e1" />);
    await clicar("Consultar crédito do cônjuge (gera cobrança)");

    expect(texto()).toContain("Crédito do cônjuge APROVADO.");
    expect(texto()).toContain(recado);
  });

  it("a consulta que saiu sem registro traz o recado do servidor, e o card anda pelo veredito", async () => {
    const onResultado = vi.fn();
    const recado =
      "A consulta foi feita, mas o registro dela não foi gravado. Avise a Careli antes de consultar de novo.";
    instalarFetch((chamada) =>
      chamada.method === "GET"
        ? { corpo: situacaoCompleta() }
        : {
            corpo: {
              data: {
                alvo: "titular",
                consulta: null,
                etapa: "revisao",
                etapaNaoGravada: null,
                mensagem: recado,
                reaproveitada: false,
                registroNaoGravado: true,
                veredito: { aprovado: false, motivo: "Restrições acima do limite." },
              },
            },
          },
    );
    await montar(<CreditoSerasa entityId="e1" onResultado={onResultado} />);
    await clicar("Consultar de novo (gera nova cobrança)");

    expect(texto()).toContain(recado);
    expect(onResultado).toHaveBeenCalledWith({ aprovado: false, etapa: "revisao" });
  });
});

describe("CreditoSerasa no portal que opera sozinho", () => {
  it("lê e consulta pela porta do portal, sem Bearer, com a ficha no endereço e o emp", async () => {
    instalarFetch((chamada) =>
      chamada.method === "GET"
        ? { corpo: situacaoCompleta({ ehAdmin: false, etapa: "credito", ultimaConsulta: null }) }
        : { corpo: { data: { etapa: "credito", reaproveitada: false } } },
    );
    await montar(<CreditoSerasa api={PORTAL} entityId="e1" />);

    expect(chamadas[0]?.url).toBe("/api/incorporador/board/e1/serasa/consultar?emp=39");
    expect(chamadas[0]?.headers).not.toHaveProperty("Authorization");
    expect(texto()).toContain("A consulta é cobrada");

    await clicar("Consultar Serasa");
    const post = chamadas.find((c) => c.method === "POST");
    expect(post?.url).toBe("/api/incorporador/board/e1/serasa/consultar?emp=39");
    expect(post?.headers).toEqual({ "Content-Type": "application/json" });
    expect(post?.body).toMatchObject({ confirmado: true, entityId: "e1" });
  });

  it("não mostra o que só a Careli tem, mesmo se a resposta disser ehAdmin", async () => {
    instalarFetch(() => ({ corpo: situacaoCompleta() }));
    await montar(<CreditoSerasa api={PORTAL} entityId="e1" />);

    expect(botao("Baixar comprovante")).toBeUndefined();
    expect(botao("Baixar CAD")).toBeUndefined();
    expect(texto()).not.toContain("Aviso de reprovação");
    expect(botao("Reenviar ao coordenador")).toBeUndefined();
    expect(botao("Reenviar ao corretor")).toBeUndefined();
    expect(botao("Consultar de novo (pode gerar cobrança)")).toBeTruthy();
    expect(botao("Consultar crédito do cônjuge (pode gerar cobrança)")).toBeTruthy();
    expect(texto()).toContain("o resultado não altera a ficha do titular");
    // Nenhuma chamada saiu para as rotas do hub.
    expect(chamadas.every((c) => c.url.startsWith("/api/incorporador/board/"))).toBe(true);
  });

  it("o resultado guardado reaplicado move o card e diz que não houve cobrança", async () => {
    const onResultado = vi.fn();
    instalarFetch((chamada) =>
      chamada.method === "GET"
        ? { corpo: situacaoCompleta({ ehAdmin: false }) }
        : {
            corpo: {
              data: {
                alvo: "titular",
                consultaAnterior: {},
                disparo: null,
                etapa: "credenciado",
                etapaNaoGravada: null,
                forcarRecusado: true,
                mensagem:
                  "Este documento já foi consultado em 10/09/2026. O resultado guardado foi usado, sem nova cobrança.",
                reaproveitada: true,
                veredito: { aprovado: true, limite: 1000, motivo: "Aprovado", total: 0 },
              },
            },
          },
    );
    await montar(<CreditoSerasa api={PORTAL} entityId="e1" onResultado={onResultado} />);
    await clicar("Consultar de novo (pode gerar cobrança)");

    expect(onResultado).toHaveBeenCalledWith({ aprovado: true, etapa: "credenciado" });
    expect(texto()).toContain("O resultado guardado foi usado, sem nova cobrança.");
    const post = chamadas.find((c) => c.method === "POST");
    expect(post?.headers).not.toHaveProperty("Authorization");
  });

  it("sem integração ou sem resposta da porta: aviso curto, sem bancada nem variável de ambiente", async () => {
    instalarFetch(() => ({ corpo: { error: "Nao encontrado." }, status: 404 }));
    await montar(<CreditoSerasa api={PORTAL} entityId="e1" />);

    expect(texto()).toContain("Análise de crédito indisponível no momento");
    expect(texto()).not.toContain("Bancada de teste");
    expect(texto()).not.toContain("variáveis de ambiente");
  });
});
