// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A PORTA DAS TELAS DA TÊMIS, TRAVADA NO QUE VAI PARA A REDE.
//
// ⚠️ O QUE SE PROVA AQUI: que o HUB SEM PROVEDOR continua mandando exatamente o que mandava (a
// mesma URL `/api/temis/...`, o Bearer pedido a `getApoloAccessToken` a cada chamada, as mesmas
// opções), que o PORTAL nunca manda token (nem se a tela mandar um) e vai com o cookie, e que a
// função entregue às telas é ESTÁVEL entre renders — ela entra nas dependências dos efeitos, e uma
// função nova por render refaria as buscas (no editor, chamaria o agente de novo).

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const simulado = vi.hoisted(() => ({
  getApoloAccessToken: vi.fn<() => Promise<null | string>>(),
}));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: () => simulado.getApoloAccessToken(),
}));

const {
  API_DA_TEMIS_DO_HUB,
  API_DA_TEMIS_DO_PORTAL,
  ApiDaTemisProvider,
  cabecalhosDaIaDoEditor,
  MENSAGEM_DA_IA_NO_PORTAL,
  montarTemisFetch,
  sessaoDisponivel,
  subcaminhoComMinutaAberta,
  urlDaTemis,
  useApiDaTemis,
} = await import("./api-da-temis");

type Chamada = { init: RequestInit; url: string };

function dependenciasFalsas(token: () => Promise<null | string> = () => Promise.resolve("tk")) {
  const chamadas: Chamada[] = [];
  const obterToken = vi.fn(token);
  const buscar = vi.fn((url: string, init: RequestInit) => {
    chamadas.push({ init, url });
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  return { buscar, chamadas, obterToken };
}

describe("urlDaTemis", () => {
  it("junta a base e o subcaminho", () => {
    expect(urlDaTemis("/api/temis", "/trabalho?id=1")).toBe("/api/temis/trabalho?id=1");
    expect(urlDaTemis("/api/incorporador/temis", "/minutas/upload")).toBe(
      "/api/incorporador/temis/minutas/upload",
    );
  });

  it("garante a barra: subcaminho sem barra não gruda na base", () => {
    expect(urlDaTemis("/api/temis", "trabalhos")).toBe("/api/temis/trabalhos");
  });
});

describe("montarTemisFetch — hub", () => {
  it("manda o Bearer por cima dos cabeçalhos da tela e preserva método, corpo e cache", async () => {
    const d = dependenciasFalsas();
    const temisFetch = montarTemisFetch(API_DA_TEMIS_DO_HUB, d);

    await temisFetch("/contrato/gerar", {
      body: JSON.stringify({ propostaId: "p1" }),
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(d.chamadas).toHaveLength(1);
    expect(d.chamadas[0]?.url).toBe("/api/temis/contrato/gerar");
    expect(d.chamadas[0]?.init).toEqual({
      body: JSON.stringify({ propostaId: "p1" }),
      cache: "no-store",
      headers: { Authorization: "Bearer tk", "Content-Type": "application/json" },
      method: "POST",
    });
    // Nada de `credentials` no hub: a chamada é a de antes, e não ganha opção nova.
    expect(d.chamadas[0]?.init).not.toHaveProperty("credentials");
  });

  it("sem `init`, sai só o Bearer (o GET de sempre)", async () => {
    const d = dependenciasFalsas();
    await montarTemisFetch(API_DA_TEMIS_DO_HUB, d)("/trabalho?id=abc");

    expect(d.chamadas[0]).toEqual({
      init: { headers: { Authorization: "Bearer tk" } },
      url: "/api/temis/trabalho?id=abc",
    });
  });

  it("pede o token A CADA chamada, como cada tela fazia", async () => {
    const d = dependenciasFalsas();
    const temisFetch = montarTemisFetch(API_DA_TEMIS_DO_HUB, d);

    await temisFetch("/a");
    await temisFetch("/b");

    expect(d.obterToken).toHaveBeenCalledTimes(2);
  });

  it("sem sessão do hub, rejeita com o erro de `getApoloAccessToken` e não chama a rede", async () => {
    const d = dependenciasFalsas(() => Promise.reject(new Error("Sessao administrativa ausente.")));

    await expect(montarTemisFetch(API_DA_TEMIS_DO_HUB, d)("/board")).rejects.toThrow(
      "Sessao administrativa ausente.",
    );
    expect(d.buscar).not.toHaveBeenCalled();
  });

  it("aceita cabeçalhos em `Headers` e em lista, e devolve objeto simples", async () => {
    const d = dependenciasFalsas();
    const temisFetch = montarTemisFetch(API_DA_TEMIS_DO_HUB, d);

    await temisFetch("/x", { headers: new Headers({ "Content-Type": "application/json" }) });
    await temisFetch("/y", { headers: [["X-Teste", "1"]] });

    expect(d.chamadas[0]?.init.headers).toEqual({
      Authorization: "Bearer tk",
      "content-type": "application/json",
    });
    expect(d.chamadas[1]?.init.headers).toEqual({ Authorization: "Bearer tk", "X-Teste": "1" });
  });
});

describe("montarTemisFetch — portal (cookie)", () => {
  it("vai para /api/incorporador/temis com o cookie, sem pedir token", async () => {
    const d = dependenciasFalsas();
    await montarTemisFetch(API_DA_TEMIS_DO_PORTAL, d)("/trabalhos?empreendimento=37", {
      cache: "no-store",
    });

    expect(d.obterToken).not.toHaveBeenCalled();
    expect(d.chamadas[0]).toEqual({
      init: { cache: "no-store", credentials: "same-origin", headers: {} },
      url: "/api/incorporador/temis/trabalhos?empreendimento=37",
    });
  });

  it("o token do hub nunca sai pela porta do portal, nem se a tela mandar um", async () => {
    const d = dependenciasFalsas();
    await montarTemisFetch(API_DA_TEMIS_DO_PORTAL, d)("/assinatura/enviar", {
      body: "{}",
      credentials: "include",
      headers: { authorization: "Bearer vazado", "Content-Type": "application/json" },
      method: "POST",
    });

    expect(d.chamadas[0]?.init.headers).toEqual({ "Content-Type": "application/json" });
    // A credencial do portal é o cookie da mesma origem, e a tela não a troca.
    expect(d.chamadas[0]?.init.credentials).toBe("same-origin");
  });

  it("o agente da minuta leva a minuta aberta no editor (a rota confere quem opera o produto)", async () => {
    const d = { ...dependenciasFalsas(), minutaAberta: () => "minuta-39" };
    const temisFetch = montarTemisFetch(API_DA_TEMIS_DO_PORTAL, d);

    await temisFetch("/minutas/marcar", { body: "{}", method: "POST" });
    await temisFetch("/minutas/conversar", { body: "{}", method: "POST" });
    // O resto da Têmis passa intacto.
    await temisFetch("/minutas?enterpriseId=39");

    expect(d.chamadas.map((c) => c.url)).toEqual([
      "/api/incorporador/temis/minutas/marcar?minutaId=minuta-39",
      "/api/incorporador/temis/minutas/conversar?minutaId=minuta-39",
      "/api/incorporador/temis/minutas?enterpriseId=39",
    ]);
  });

  it("no hub o agente não ganha parâmetro nenhum: a chamada é a de antes", async () => {
    const d = { ...dependenciasFalsas(), minutaAberta: () => "minuta-39" };
    await montarTemisFetch(API_DA_TEMIS_DO_HUB, d)("/minutas/marcar", { method: "POST" });
    expect(d.chamadas[0]?.url).toBe("/api/temis/minutas/marcar");
  });
});

describe("subcaminhoComMinutaAberta", () => {
  it("só nos subcaminhos do agente, e só com minuta aberta", () => {
    expect(subcaminhoComMinutaAberta("/minutas/marcar", "m1")).toBe("/minutas/marcar?minutaId=m1");
    expect(subcaminhoComMinutaAberta("minutas/conversar", " m1 ")).toBe(
      "/minutas/conversar?minutaId=m1",
    );
    expect(subcaminhoComMinutaAberta("/minutas/marcar", null)).toBe("/minutas/marcar");
    expect(subcaminhoComMinutaAberta("/minutas/marcar", "  ")).toBe("/minutas/marcar");
    expect(subcaminhoComMinutaAberta("/minutas/upload", "m1")).toBe("/minutas/upload");
  });

  it("não troca a minuta que já veio na URL e preserva os outros parâmetros", () => {
    expect(subcaminhoComMinutaAberta("/minutas/marcar?minutaId=m2", "m1")).toBe(
      "/minutas/marcar?minutaId=m2",
    );
    expect(subcaminhoComMinutaAberta("/minutas/marcar?x=1", "m1")).toBe(
      "/minutas/marcar?x=1&minutaId=m1",
    );
  });
});

describe("cabecalhosDaIaDoEditor (a IA do Plate no editor de minutas)", () => {
  it("hub: pede o token e manda o Bearer com o JSON, como antes", async () => {
    const obterToken = vi.fn(() => Promise.resolve("tk"));
    const headers = await cabecalhosDaIaDoEditor("hub", { "X-Teste": "1" }, obterToken);

    expect(obterToken).toHaveBeenCalledTimes(1);
    expect(headers.get("Authorization")).toBe("Bearer tk");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Teste")).toBe("1");
  });

  it("portal: recusa antes de qualquer coisa, sem pedir o token do hub", async () => {
    const obterToken = vi.fn(() => Promise.resolve("tk"));

    await expect(cabecalhosDaIaDoEditor("cookie", undefined, obterToken)).rejects.toThrow(
      MENSAGEM_DA_IA_NO_PORTAL,
    );
    expect(MENSAGEM_DA_IA_NO_PORTAL).toBe("A IA do editor não está disponível no portal.");
    expect(obterToken).not.toHaveBeenCalled();
  });
});

describe("sessaoDisponivel", () => {
  it("portal: sim, sem perguntar token (o cookie é conferido pela rota)", async () => {
    const obterToken = vi.fn(() => Promise.resolve(null));
    await expect(sessaoDisponivel(API_DA_TEMIS_DO_PORTAL, obterToken)).resolves.toBe(true);
    expect(obterToken).not.toHaveBeenCalled();
  });

  it("hub: segue o token — presente sim, nulo não, lançamento não", async () => {
    await expect(sessaoDisponivel(API_DA_TEMIS_DO_HUB, () => Promise.resolve("tk"))).resolves.toBe(
      true,
    );
    await expect(sessaoDisponivel(API_DA_TEMIS_DO_HUB, () => Promise.resolve(null))).resolves.toBe(
      false,
    );
    await expect(
      sessaoDisponivel(API_DA_TEMIS_DO_HUB, () => Promise.reject(new Error("sem sessão"))),
    ).resolves.toBe(false);
  });
});

describe("useApiDaTemis", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let chamadas: { init?: RequestInit; url: string }[];

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    chamadas = [];
    simulado.getApoloAccessToken.mockReset();
    simulado.getApoloAccessToken.mockResolvedValue("token-do-hub");
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        chamadas.push({ init, url });
        return Promise.resolve(new Response("{}", { status: 200 }));
      }),
    );
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  /** Um componente que guarda a porta que recebeu, a cada render. */
  function Espiao({ vistas }: { vistas: ReturnType<typeof useApiDaTemis>[] }) {
    vistas.push(useApiDaTemis());
    return null;
  }

  it("sem provedor é o hub: /api/temis com o Bearer de getApoloAccessToken", async () => {
    const vistas: ReturnType<typeof useApiDaTemis>[] = [];
    act(() => raiz.render(<Espiao vistas={vistas} />));

    const api = vistas.at(-1);
    expect(api?.autenticacao).toBe("hub");
    expect(api?.base).toBe("/api/temis");

    await act(async () => {
      await api?.temisFetch("/board", { cache: "no-store" });
    });

    expect(simulado.getApoloAccessToken).toHaveBeenCalledTimes(1);
    expect(chamadas).toEqual([
      {
        init: { cache: "no-store", headers: { Authorization: "Bearer token-do-hub" } },
        url: "/api/temis/board",
      },
    ]);
  });

  it("com o provedor do portal: /api/incorporador/temis, cookie e nenhum token pedido", async () => {
    const vistas: ReturnType<typeof useApiDaTemis>[] = [];
    act(() =>
      raiz.render(
        <ApiDaTemisProvider {...API_DA_TEMIS_DO_PORTAL}>
          <Espiao vistas={vistas} />
        </ApiDaTemisProvider>,
      ),
    );

    const api = vistas.at(-1);
    expect(api?.autenticacao).toBe("cookie");

    await act(async () => {
      await api?.temisFetch("/minutas?enterpriseId=37&tipo=contrato", { cache: "no-store" });
    });

    expect(simulado.getApoloAccessToken).not.toHaveBeenCalled();
    expect(chamadas).toEqual([
      {
        init: { cache: "no-store", credentials: "same-origin", headers: {} },
        url: "/api/incorporador/temis/minutas?enterpriseId=37&tipo=contrato",
      },
    ]);
  });

  it("a função é a MESMA entre renders, com e sem provedor", () => {
    const semProvedor: ReturnType<typeof useApiDaTemis>[] = [];
    act(() => raiz.render(<Espiao vistas={semProvedor} />));
    act(() => raiz.render(<Espiao vistas={semProvedor} />));
    expect(semProvedor).toHaveLength(2);
    expect(semProvedor[0]?.temisFetch).toBe(semProvedor[1]?.temisFetch);

    const comProvedor: ReturnType<typeof useApiDaTemis>[] = [];
    const arvore = () => (
      <ApiDaTemisProvider {...API_DA_TEMIS_DO_PORTAL}>
        <Espiao vistas={comProvedor} />
      </ApiDaTemisProvider>
    );
    act(() => raiz.render(arvore()));
    act(() => raiz.render(arvore()));
    expect(comProvedor).toHaveLength(2);
    expect(comProvedor[0]).toBe(comProvedor[1]);
  });
});
