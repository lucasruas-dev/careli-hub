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
  it("mantém Produtos além das três do padrão, mais LSoft e Boletos", () => {
    // As duas últimas vêm de listas próprias, cada uma por pedido DIRETO do Lucas nomeando os dois
    // portais do Cecílio — não por herança do padrão:
    //   • LSoft   (19/08/2026) — `lib/lsoft/portais`;
    //   • Boletos (01/09/2026) — `lib/apolo/boletos/portais`, *"essa tela vai somente no perfil da
    //     CER e Cecilio"*.
    // ⚠️ O CONGELAMENTO NÃO É "NUNCA MUDA": é "o padrão não passa por cima". Pedido explícito do
    // Lucas para este portal entra — é ele quem decide o que o cliente dele vê.
    expect(rotulos("cecilio-rocha")).toEqual([
      "CRM",
      "Vendas",
      "Carteira",
      "Produtos",
      "LSoft Integração",
      "Boletos",
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

describe("a aba de boletos", () => {
  it("aparece nos dois portais do Cecílio, e só neles", () => {
    // Pedido do Lucas (01/09/2026): *"essa tela vai somente no perfil da CER e Cecilio"*, com o
    // print dos dois portais.
    expect(abasDoPortal("cer").map((a) => a.chave)).toContain("boletos");
    expect(abasDoPortal("cecilio-rocha").map((a) => a.chave)).toContain("boletos");
  });

  it("NÃO aparece no portal padrão nem no do sócio", () => {
    // ⚠️ Vista Alegre e Lagoa Bonita não têm nada com estas carteiras, e a MMendes é sócia só do
    // Garden. Um botão de emitir cobrança num portal errado cria dívida em nome de outra empresa.
    for (const slug of ["vistaalegre", "lagoabonita", "mmendes"]) {
      expect(abasDoPortal(slug).map((a) => a.chave), slug).not.toContain("boletos");
    }
  });

  it("entra DEPOIS do LSoft, no fim da lista", () => {
    // A ordem é a do menu lateral: as três de negócio primeiro, as ferramentas no fim.
    const abas = abasDoPortal("cer").map((a) => a.chave);
    expect(abas[abas.length - 1]).toBe("boletos");
  });
});
