import { describe, expect, it } from "vitest";

import {
  ehPortalPersonalizado,
  ehPortalSoProdutos,
  portalAssinaPanteon,
} from "./perfis-de-portal";
import { abasDoPortal } from "@/modules/incorporador/PortalIncorporador";

// As três formas de portal que existem hoje, e a garantia de que uma não vira a outra num
// refactor. O Cecílio está no ar e aprovado (regra do Lucas, 17/08) e a MMendes é o sócio que
// só enxerga o produto (28/08) — as duas listas são recortes de negócio, não detalhe técnico.

const rotulos = (slug: string) => abasDoPortal(slug).map((aba) => aba.rotulo);

describe("portal padrão", () => {
  it("tem CRM, Vendas e Carteira", () => {
    expect(rotulos("vistaalegre")).toEqual(["CRM", "Vendas", "Carteira"]);
  });

  it("não é personalizado nem só-produtos", () => {
    expect(ehPortalPersonalizado("vistaalegre")).toBe(false);
    expect(ehPortalSoProdutos("vistaalegre")).toBe(false);
  });
});

describe("portal personalizado (Cecílio) — congelado", () => {
  it("mantém Produtos além das três do padrão, e a aba do LSoft", () => {
    // A do LSoft vem de `lib/lsoft/portais` (lista própria: cecilio-rocha e cer), por isso
    // são CINCO abas — é o que o portal dele mostra hoje em produção.
    expect(rotulos("cecilio-rocha")).toEqual([
      "CRM",
      "Vendas",
      "Carteira",
      "Produtos",
      "LSoft Integração",
    ]);
  });

  it("continua sendo reconhecido como personalizado", () => {
    expect(ehPortalPersonalizado("cecilio-rocha")).toBe(true);
  });

  it("o portal SÓ PRODUTOS não contamina o dele", () => {
    expect(ehPortalSoProdutos("cecilio-rocha")).toBe(false);
  });
});

describe("portal só produtos (MMendes) — o sócio", () => {
  it("tem UMA aba, e é Produtos", () => {
    expect(rotulos("mmendes")).toEqual(["Produtos"]);
  });

  it("não vê CRM, Vendas, Carteira nem LSoft", () => {
    const abas = abasDoPortal("mmendes").map((aba) => aba.chave);
    expect(abas).not.toContain("crm");
    expect(abas).not.toContain("vendas");
    expect(abas).not.toContain("carteira");
    // ⚠️ A base do LSoft é da carteira do Cecílio; o sócio não tem nada com ela.
    expect(abas).not.toContain("lsoft");
  });

  it("é só-produtos, e NÃO herda o congelamento do personalizado", () => {
    expect(ehPortalSoProdutos("mmendes")).toBe(true);
    expect(ehPortalPersonalizado("mmendes")).toBe(false);
  });

  it("aceita o slug com espaço ou caixa diferente", () => {
    expect(ehPortalSoProdutos("  MMendes ")).toBe(true);
  });
});

describe("slug desconhecido cai no padrão, nunca em branco", () => {
  it("portal novo nasce com as três abas", () => {
    expect(rotulos("portal-que-ainda-nao-existe")).toEqual(["CRM", "Vendas", "Carteira"]);
  });

  it("slug vazio não quebra", () => {
    expect(() => abasDoPortal("")).not.toThrow();
    expect(rotulos("")).toEqual(["CRM", "Vendas", "Carteira"]);
  });
});

describe("de quem é a marca na porta do portal", () => {
  // Lucas, 31/08/2026, vendo o login da MMendes com as duas marcas empilhadas: *"nesses perfis
  // que vamos fazer personalizado, pode tirar a logo do panteon por favor"*.
  it("portal PADRÃO leva a assinatura do Panteon em cima da marca do cliente", () => {
    expect(portalAssinaPanteon("lagoa-bonita")).toBe(true);
    expect(portalAssinaPanteon("vistaalegre")).toBe(true);
  });

  it("portal personalizado NÃO leva — a porta é a marca dele", () => {
    expect(portalAssinaPanteon("cecilio-rocha")).toBe(false);
  });

  it("portal só-produtos também não leva", () => {
    expect(portalAssinaPanteon("mmendes")).toBe(false);
  });

  // ⚠️ As duas perguntas são SEPARADAS de propósito. "Assina Panteon" é sobre a porta; "é
  // personalizado" é sobre estar congelado no comportamento aprovado. Amarrar as duas faria um
  // portal novo herdar o congelamento do Cecílio só por querer a própria marca no login.
  it("tirar a assinatura NÃO transforma o portal em personalizado", () => {
    expect(portalAssinaPanteon("mmendes")).toBe(false);
    expect(ehPortalPersonalizado("mmendes")).toBe(false);
  });

  it("aceita espaço e caixa, como as outras regras", () => {
    expect(portalAssinaPanteon("  MMendes ")).toBe(false);
    expect(portalAssinaPanteon("")).toBe(true);
  });
});
