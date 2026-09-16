// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A JANELA DE PRODUTO NOVO, TRAVADA NO QUE A PESSOA VÊ E NO QUE VAI PARA A REDE.
//
// ⚠️ O QUE SE PROVA AQUI E NÃO NA LIB: que nada sai sem o tipo escolhido, que o corpo é o produto
// NORMALIZADO pela mesma régua da rota, que o 422 cai no campo certo, e que a janela é acessível
// de fato (foco entra, fica preso, Esc fecha, e não fecha enquanto envia). A régua tem o próprio
// teste (lib/hercules/produto-novo.test.ts).
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

const { NovoProduto } = await import("./NovoProduto");

type Chamada = { body?: unknown; headers?: HeadersInit; method: string; url: string };

let raiz: Root;
let hospedeiro: HTMLDivElement;
let chamadas: Chamada[];

function instalarFetch(responder: (chamada: Chamada) => { corpo: unknown; status?: number } | Promise<{ corpo: unknown; status?: number }>) {
  chamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const chamada: Chamada = {
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        headers: init?.headers,
        method: init?.method ?? "GET",
        url,
      };
      chamadas.push(chamada);
      const { corpo, status = 200 } = await responder(chamada);
      return new Response(JSON.stringify(corpo), { headers: { "content-type": "application/json" }, status });
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

const botao = (rotulo: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === rotulo || b.getAttribute("aria-label") === rotulo,
  );
const campo = <T extends HTMLElement = HTMLInputElement>(nome: string) =>
  document.querySelector<T>(`[data-campo="${nome}"]`);
const texto = () => document.body.textContent ?? "";

function digitar(el: HTMLInputElement | HTMLSelectElement | null, valor: string) {
  if (!el) throw new Error("campo não encontrado");
  act(() => {
    const prototipo = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototipo, "value")?.set?.call(el, valor);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

function teclar(alvo: Element | null, key: string, shiftKey = false) {
  act(() => {
    (alvo ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key, shiftKey }));
  });
}

async function clicar(el: HTMLElement | undefined | null) {
  if (!el) throw new Error("botão não encontrado");
  await act(async () => {
    el.click();
  });
  await esperarPromessas();
}

function preencherJade() {
  act(() => {
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
      .find((b) => b.textContent?.includes("Prédio"))
      ?.click();
  });
  digitar(campo("nome"), "Ed. Jade");
  act(() => {
    botao("Usar o código sugerido JAD")?.click();
  });
  digitar(campo("cidade"), "Ipatinga");
  digitar(campo<HTMLSelectElement>("uf"), "MG");
}

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

describe("NovoProduto", () => {
  it("fechada não monta nada; aberta é um diálogo modal com o foco no tipo", async () => {
    instalarFetch(() => ({ corpo: {} }));
    await montar(<NovoProduto aberto={false} aoCriar={() => {}} aoFechar={() => {}} />);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await montar(<NovoProduto aberto aoCriar={() => {}} aoFechar={() => {}} />);
    const dialogo = document.querySelector('[role="dialog"]');
    expect(dialogo?.getAttribute("aria-modal")).toBe("true");
    const titulo = document.getElementById(dialogo?.getAttribute("aria-labelledby") ?? "");
    expect(titulo?.textContent).toBe("Novo produto");
    // Nenhum tipo vem marcado, e o foco começa no primeiro.
    const radios = Array.from(document.querySelectorAll('[role="radio"]'));
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "false"]);
    expect(document.activeElement).toBe(radios[0]);
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("sem tipo e sem campos não envia: mostra as mensagens da régua e foca o tipo", async () => {
    instalarFetch(() => ({ corpo: {} }));
    await montar(<NovoProduto aberto aoCriar={() => {}} aoFechar={() => {}} />);

    act(() => {
      campo("nome")?.focus();
    });
    await clicar(botao("Criar produto"));

    expect(chamadas).toHaveLength(0);
    expect(texto()).toContain("Confira os campos marcados.");
    expect(texto()).toContain("Escolha o tipo: Loteamento ou Vertical (prédio).");
    expect(texto()).toContain("Informe o nome do produto.");
    expect(texto()).toContain("Informe o código do produto (ex.: JAD).");
    expect(campo("nome")?.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement?.getAttribute("role")).toBe("radio");
  });

  it("envia o produto normalizado, pelo cookie, e devolve o id criado", async () => {
    instalarFetch(() => ({ corpo: { data: { codigo: "JAD", enterpriseId: "100000" } }, status: 201 }));
    const aoCriar = vi.fn();
    await montar(<NovoProduto aberto aoCriar={aoCriar} aoFechar={() => {}} />);

    preencherJade();
    // O código limpa na digitação: minúscula, espaço e acento não chegam a existir no campo.
    digitar(campo("codigo"), "já d");
    expect(campo("codigo")?.value).toBe("JAD");
    expect(texto()).toContain("JAD-A-304");

    await clicar(botao("Criar produto"));

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.url).toBe("/api/incorporador/produtos/novo");
    expect(chamadas[0]?.method).toBe("POST");
    expect(chamadas[0]?.body).toEqual({
      cidade: "Ipatinga",
      codigo: "JAD",
      nome: "Ed. Jade",
      paiCodigo: null,
      tipoProduto: "vertical",
      uf: "MG",
    });
    expect(chamadas[0]?.headers).toEqual({ "Content-Type": "application/json" });
    expect(aoCriar).toHaveBeenCalledWith({ codigo: "JAD", enterpriseId: "100000" });
  });

  it("⚠️ a rota do portal pede para recarregar a sessão: a tela relê o cookie ANTES de avisar quem chamou", async () => {
    const ordem: string[] = [];
    instalarFetch((chamada) => {
      ordem.push(chamada.url);
      return chamada.url === "/api/incorporador/sessao"
        ? { corpo: { data: {} } }
        : { corpo: { data: { codigo: "JAD", enterpriseId: "100000", recarregarSessao: true } }, status: 201 };
    });
    const aoCriar = vi.fn(() => ordem.push("aoCriar"));
    await montar(<NovoProduto aberto aoCriar={aoCriar} aoFechar={() => {}} />);

    preencherJade();
    digitar(campo("codigo"), "JAD");
    await clicar(botao("Criar produto"));
    await esperarPromessas();

    expect(ordem).toEqual(["/api/incorporador/produtos/novo", "/api/incorporador/sessao", "aoCriar"]);
    expect(chamadas[1]?.method).toBe("GET");
    expect(aoCriar).toHaveBeenCalledWith({ codigo: "JAD", enterpriseId: "100000", sessaoRecarregada: true });
  });

  it("a releitura da sessão falhou: quem chama fica sabendo (sessaoRecarregada false)", async () => {
    instalarFetch((chamada) =>
      chamada.url === "/api/incorporador/sessao"
        ? { corpo: { error: "Sessao expirada." }, status: 401 }
        : { corpo: { data: { codigo: "JAD", enterpriseId: "100000", recarregarSessao: true } }, status: 201 },
    );
    const aoCriar = vi.fn();
    await montar(<NovoProduto aberto aoCriar={aoCriar} aoFechar={() => {}} />);
    preencherJade();
    digitar(campo("codigo"), "JAD");
    await clicar(botao("Criar produto"));
    await esperarPromessas();
    expect(aoCriar).toHaveBeenCalledWith({ codigo: "JAD", enterpriseId: "100000", sessaoRecarregada: false });
  });

  it("código repetido que a tela conhece nem sai; o 422 da rota cai no campo e some ao editar", async () => {
    instalarFetch(() => ({
      corpo: { erros: { codigo: "O código JAD já está em uso por outro empreendimento. Escolha outro." } },
      status: 422,
    }));
    const aoCriar = vi.fn();
    await montar(<NovoProduto aberto aoCriar={aoCriar} aoFechar={() => {}} codigosExistentes={["gdn"]} />);

    preencherJade();
    digitar(campo("codigo"), "GDN");
    await clicar(botao("Criar produto"));
    expect(chamadas).toHaveLength(0);
    expect(texto()).toContain("O código GDN já está em uso por outro empreendimento. Escolha outro.");

    digitar(campo("codigo"), "JAD");
    await clicar(botao("Criar produto"));
    expect(chamadas).toHaveLength(1);
    expect(aoCriar).not.toHaveBeenCalled();
    expect(texto()).toContain("O código JAD já está em uso por outro empreendimento. Escolha outro.");
    expect(campo("codigo")?.getAttribute("aria-invalid")).toBe("true");
    // O foco volta para o campo errado depois que os campos reabilitam.
    expect(document.activeElement).toBe(campo("codigo"));

    digitar(campo("codigo"), "JADE");
    expect(texto()).not.toContain("já está em uso");
  });

  it("Esc fecha; enquanto envia, nem Esc nem X fecham", async () => {
    let responder: (valor: { corpo: unknown; status?: number }) => void = () => {};
    instalarFetch(() => new Promise((resolve) => (responder = resolve)));
    const aoFechar = vi.fn();
    await montar(<NovoProduto aberto aoCriar={() => {}} aoFechar={aoFechar} />);

    preencherJade();
    await act(async () => {
      botao("Criar produto")?.click();
    });
    expect(botao("Criando…")?.disabled).toBe(true);
    expect(botao("Fechar")?.disabled).toBe(true);
    teclar(document.querySelector('[role="dialog"]'), "Escape");
    teclar(document.body, "Escape");
    expect(aoFechar).not.toHaveBeenCalled();

    await act(async () => {
      responder({ corpo: { error: "Falhou." }, status: 500 });
    });
    await esperarPromessas();
    expect(texto()).toContain("Falhou.");
    // Sem campo errado, o foco volta para o botão de criar (e não se perde no <body>).
    expect(document.activeElement).toBe(botao("Criar produto"));

    teclar(document.activeElement, "Escape");
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("o Esc da lista de cidades fecha só a lista; Tab fica preso na janela", async () => {
    instalarFetch(() => ({ corpo: {} }));
    const aoFechar = vi.fn();
    await montar(<NovoProduto aberto aoCriar={() => {}} aoFechar={aoFechar} />);

    const cidade = campo("cidade");
    act(() => cidade?.focus());
    digitar(cidade, "ipat");
    // A lista de municípios chega por import dinâmico.
    for (let i = 0; i < 20 && !document.querySelector('[role="listbox"]'); i += 1) await esperarPromessas();
    // A lista chega depois do primeiro caractere; a próxima tecla já filtra com ela.
    digitar(cidade, "ipatinga");
    await esperarPromessas();
    const opcoes = Array.from(document.querySelectorAll('[role="option"]'));
    expect(opcoes.some((o) => o.textContent?.includes("Ipatinga"))).toBe(true);

    teclar(cidade, "Escape");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(aoFechar).not.toHaveBeenCalled();

    // Escolher pela seta e Enter preenche a UF junto.
    digitar(cidade, "Ipatinga");
    await esperarPromessas();
    teclar(cidade, "ArrowDown");
    teclar(cidade, "Enter");
    expect(campo<HTMLSelectElement>("uf")?.value).toBe("MG");

    const criar = botao("Criar produto");
    act(() => criar?.focus());
    teclar(criar ?? null, "Tab");
    // O último da janela é o Criar; o primeiro é o X do topo.
    expect(document.activeElement).toBe(botao("Fechar"));
    teclar(document.activeElement, "Tab", true);
    expect(document.activeElement).toBe(criar);
  });

  it("com a lista de pais, o pai é um seletor e vai no corpo; pela porta do hub vai o Bearer", async () => {
    instalarFetch(() => ({ corpo: { data: { codigo: "VOC2", enterpriseId: "100002" } } }));
    const aoCriar = vi.fn();
    await montar(
      <NovoProduto
        aberto
        aoCriar={aoCriar}
        aoFechar={() => {}}
        endpoint="/api/apolo/empreendimentos/novo"
        pais={[{ codigo: "vlo", nome: "Vale do Ouro" }]}
        semToken={false}
      />,
    );

    preencherJade();
    act(() => {
      botao("É etapa de outro empreendimento?")?.click();
    });
    const pai = campo<HTMLSelectElement>("paiCodigo");
    expect(pai?.tagName).toBe("SELECT");
    digitar(pai, "VLO");
    await clicar(botao("Criar produto"));

    expect(chamadas[0]?.url).toBe("/api/apolo/empreendimentos/novo");
    expect(chamadas[0]?.body).toMatchObject({ paiCodigo: "VLO" });
    expect(chamadas[0]?.headers).toEqual({ Authorization: "Bearer token-do-hub", "Content-Type": "application/json" });
    expect(aoCriar).toHaveBeenCalledWith({ codigo: "VOC2", enterpriseId: "100002" });
  });

  it("pelo hub, 'Quem opera' vai no corpo como slug; em branco é a Careli; o 422 do operador cai no campo", async () => {
    instalarFetch((chamada) =>
      (chamada.body as { operadoPorIncorporadorSlug?: string }).operadoPorIncorporadorSlug === "portal-desligado"
        ? {
            corpo: {
              error: "Confira os campos destacados.",
              erros: { operadoPorIncorporadorSlug: "Esse portal não existe ou está desativado." },
            },
            status: 422,
          }
        : { corpo: { data: { codigo: "ESM", enterpriseId: "100004" } }, status: 201 },
    );
    const aoCriar = vi.fn();
    await montar(
      <NovoProduto
        aberto
        aoCriar={aoCriar}
        aoFechar={() => {}}
        endpoint="/api/apolo/empreendimentos/novo"
        operadores={[
          { nome: "Cecílio Rocha", slug: "cecilio-rocha" },
          { nome: "Portal desligado", slug: "portal-desligado" },
        ]}
        semToken={false}
      />,
    );

    preencherJade();
    digitar(campo("codigo"), "ESM");
    const operador = campo<HTMLSelectElement>("operadoPorIncorporadorSlug");
    expect(operador?.value).toBe("");
    expect(texto()).toContain("Quem opera");

    digitar(operador, "portal-desligado");
    await clicar(botao("Criar produto"));
    expect(chamadas[0]?.body).toMatchObject({ operadoPorIncorporadorSlug: "portal-desligado" });
    expect(texto()).toContain("Esse portal não existe ou está desativado.");
    expect(operador?.getAttribute("aria-invalid")).toBe("true");
    expect(aoCriar).not.toHaveBeenCalled();

    digitar(operador, "cecilio-rocha");
    await clicar(botao("Criar produto"));
    expect(chamadas[1]?.body).toMatchObject({ operadoPorIncorporadorSlug: "cecilio-rocha" });
    // A porta do hub não pede recarregar sessão: o campo nem vem.
    expect(aoCriar).toHaveBeenCalledWith({ codigo: "ESM", enterpriseId: "100004" });
  });

  it("sem a lista de operadores (portal), o seletor não existe e o slug nunca vai no corpo", async () => {
    instalarFetch(() => ({ corpo: { data: { codigo: "JAD", enterpriseId: "100000" } }, status: 201 }));
    await montar(<NovoProduto aberto aoCriar={() => {}} aoFechar={() => {}} />);
    expect(campo("operadoPorIncorporadorSlug")).toBeNull();
    preencherJade();
    digitar(campo("codigo"), "JAD");
    await clicar(botao("Criar produto"));
    expect(chamadas[0]?.body).not.toHaveProperty("operadoPorIncorporadorSlug");
  });
});
