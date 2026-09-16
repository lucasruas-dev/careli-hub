// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApoloEnterpriseUnit } from "@/lib/apolo/empreendimentos";

// A CORREÇÃO DE UMA UNIDADE PELA LINHA DA ABA UNIDADES (D2 do Lucas, 16/09/2026).
//
// O que se prova, no que a pessoa vê e no que vai para a rede:
//   • a janela abre com o preço, a área e a matrícula da linha;
//   • só o que MUDOU vai no corpo (mandar o preço de sempre travaria a matrícula de lote reservado);
//   • o corpo é o contrato da rota do cadastro: `?emp=`, `acao: "atualizar"`, `unidadeId`, `campos`;
//   • sucesso fecha a janela e recarrega a tabela; recusa da rota (409, 422) fica à vista, e a
//     tabela não recarrega;
//   • na porta do hub vai o Bearer do Apolo.
// A regra (trava da venda, situação intocável, quem pode) está provada na rota e no servidor.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/supabase/client", () => ({
  getHubSupabaseClient: () => null,
  hubSupabaseConfig: { anonKey: "chave-publica", url: "https://projeto.supabase.co" },
}));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: () => Promise.resolve("token-do-hub"),
}));

const { BotaoDeEditarUnidade } = await import("./EdicaoDaUnidade");
const { lerRespostaDaAtualizacao, mudancasDaEdicao, camposDaEdicao } = await import("./cadastro-na-tela");
const { unidadeCorrigivelNoPortal } = await import("./UnidadesDoProduto");

const UNIDADE: ApoloEnterpriseUnit = {
  area: 360,
  block: "01",
  bucket: "disponivel",
  code: "GDN0101",
  enterpriseCode: "GDN",
  id: "aaaaaaaa-0000-4000-8000-000000000007",
  kind: null,
  lot: "01",
  movement: null,
  price: 210000,
  registration: "45.678",
  status: "Disponível",
};

type Chamada = { body: Record<string, unknown>; headers: Record<string, string>; url: string };

let raiz: Root;
let hospedeiro: HTMLDivElement;
let chamadas: Chamada[];

function instalarRota(status: number, corpo: unknown) {
  chamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push({
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        headers: (init?.headers ?? {}) as Record<string, string>,
        url,
      });
      return new Response(JSON.stringify(corpo), { headers: { "Content-Type": "application/json" }, status });
    }),
  );
}

async function esperarPromessas(voltas = 3) {
  for (let v = 0; v < voltas; v += 1) {
    await act(async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function montar(elemento: React.ReactElement) {
  act(() => {
    raiz.render(elemento);
  });
  await esperarPromessas(1);
}

const botao = (rotulo: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === rotulo || b.getAttribute("aria-label") === rotulo,
  );
const campo = (nome: string) => document.querySelector<HTMLInputElement>(`[data-campo="${nome}"]`);
const janela = () => document.querySelector('[role="dialog"]');
const texto = () => document.body.textContent ?? "";

function digitar(el: HTMLInputElement | null, valor: string) {
  if (!el) throw new Error("campo não encontrado");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clicar(el: HTMLElement | null | undefined) {
  if (!el) throw new Error("botão não encontrado");
  await act(async () => {
    el.click();
  });
  await esperarPromessas();
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
});

describe("BotaoDeEditarUnidade", () => {
  it("⚠️ abre com os valores da linha e manda SÓ o que mudou, no contrato da rota", async () => {
    instalarRota(200, { data: { alterados: ["preco_tabela"], avisos: {}, unidade: { codigo: "GDN0101", id: UNIDADE.id } } });
    const aoSalvar = vi.fn();
    await montar(<BotaoDeEditarUnidade aoSalvar={aoSalvar} emp="39" unidade={UNIDADE} />);

    await clicar(botao("Corrigir a unidade GDN0101"));
    expect(janela()).not.toBeNull();
    expect(campo("preco")?.value).toBe("210.000,00");
    expect(campo("area")?.value).toBe("360,00");
    expect(campo("matricula")?.value).toBe("45.678");
    // Sem mudança, nada a salvar.
    expect(botao("Salvar")?.disabled).toBe(true);

    digitar(campo("preco"), "225.000,00");
    expect(botao("Salvar")?.disabled).toBe(false);
    await clicar(botao("Salvar"));

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.url).toBe("/api/incorporador/produto/unidades/cadastrar?emp=39");
    expect(chamadas[0]?.body).toEqual({
      acao: "atualizar",
      campos: { preco: "225.000,00" },
      enterpriseId: "39",
      unidadeId: UNIDADE.id,
    });
    // Portal: vai pelo cookie, sem token.
    expect(chamadas[0]?.headers).not.toHaveProperty("Authorization");
    expect(aoSalvar).toHaveBeenCalledTimes(1);
    expect(janela()).toBeNull();
  });

  it("⚠️ a recusa da rota fica à vista, a janela continua aberta e a tabela não recarrega", async () => {
    instalarRota(409, { error: "Esta unidade tem uma reserva em andamento: preço e área ficam travados." });
    const aoSalvar = vi.fn();
    await montar(<BotaoDeEditarUnidade aoSalvar={aoSalvar} emp="39" unidade={UNIDADE} />);

    await clicar(botao("Corrigir a unidade GDN0101"));
    digitar(campo("area"), "380");
    await clicar(botao("Salvar"));

    expect(texto()).toContain("Esta unidade tem uma reserva em andamento: preço e área ficam travados.");
    expect(janela()).not.toBeNull();
    expect(aoSalvar).not.toHaveBeenCalled();
  });

  it("o erro de campo do 422 vai para baixo do campo", async () => {
    instalarRota(422, {
      data: { erros: { preco: "O valor precisa ser um número maior que zero." } },
      error: "O valor precisa ser um número maior que zero.",
    });
    await montar(<BotaoDeEditarUnidade aoSalvar={() => {}} emp="39" unidade={UNIDADE} />);

    await clicar(botao("Corrigir a unidade GDN0101"));
    digitar(campo("preco"), "abc");
    await clicar(botao("Salvar"));

    expect(campo("preco")?.getAttribute("aria-invalid")).toBe("true");
    expect(texto()).toContain("O valor precisa ser um número maior que zero.");
  });

  it("na porta do hub vai o Bearer do Apolo, na rota do hub", async () => {
    instalarRota(200, { data: { alterados: ["matricula"] } });
    await montar(
      <BotaoDeEditarUnidade
        aoSalvar={() => {}}
        emp="39"
        endpoint="/api/apolo/empreendimentos/unidades/panteon"
        semToken={false}
        unidade={UNIDADE}
      />,
    );

    await clicar(botao("Corrigir a unidade GDN0101"));
    digitar(campo("matricula"), "99.999");
    await clicar(botao("Salvar"));

    expect(chamadas[0]?.url).toBe("/api/apolo/empreendimentos/unidades/panteon?emp=39");
    expect(chamadas[0]?.headers).toMatchObject({ Authorization: "Bearer token-do-hub" });
    expect(chamadas[0]?.body).toMatchObject({ campos: { matricula: "99.999" }, enterpriseId: "39" });
  });
});

describe("as peças puras da correção", () => {
  it("⚠️ só o que mudou vai no corpo (matrícula sozinha não leva o preço junto)", () => {
    const inicial = camposDaEdicao(UNIDADE);
    expect(mudancasDaEdicao(inicial, { ...inicial, matricula: " 1.000 " })).toEqual({ matricula: "1.000" });
    expect(mudancasDaEdicao(inicial, { ...inicial })).toEqual({});
  });

  it("linha sem preço, área ou matrícula abre com os campos vazios", () => {
    expect(camposDaEdicao({ area: null, price: 0, registration: null })).toEqual({ area: "", matricula: "", preco: "" });
  });

  it("a resposta: sucesso, erro de campo (área privativa vira área) e a mensagem padrão sem corpo", () => {
    expect(lerRespostaDaAtualizacao(200, { data: { alterados: ["matricula", 3] } })).toEqual({
      alterados: ["matricula"],
      ok: true,
    });
    expect(lerRespostaDaAtualizacao(422, { data: { erros: { areaPrivativa: "Área inválida." } }, error: "Área inválida." })).toEqual({
      erros: { area: "Área inválida." },
      mensagem: "Área inválida.",
      ok: false,
    });
    expect(lerRespostaDaAtualizacao(503, null)).toMatchObject({
      mensagem: "Não foi possível corrigir a unidade agora. Tente de novo em instantes.",
      ok: false,
    });
    expect(lerRespostaDaAtualizacao(403, null)).toMatchObject({
      mensagem: "Seu acesso não permite corrigir unidades neste produto.",
    });
  });

  it("⚠️ só a linha do Panteon (uuid) ganha o botão: a do C2X tem id numérico do legado", () => {
    expect(unidadeCorrigivelNoPortal(UNIDADE)).toBe(true);
    expect(unidadeCorrigivelNoPortal({ id: "51234" })).toBe(false);
  });
});
