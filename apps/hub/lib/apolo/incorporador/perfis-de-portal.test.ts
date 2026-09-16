import { describe, expect, it } from "vitest";

import {
  ehPortalComercial,
  ehPortalPersonalizado,
  ehPortalSoProdutos,
  portalAssinaPanteon,
  portalOperaVenda,
  type TipoDePortal,
} from "./perfis-de-portal";
import { abasDoPortal } from "@/modules/incorporador/PortalIncorporador";

// As formas de portal que existem hoje, e a garantia de que uma não vira a outra num refactor. O
// Cecílio é o personalizado (regra do Lucas, 17/08) que desde 16/09/2026 opera a própria venda na
// casca do Hércules, e a MMendes é o sócio que só enxerga o produto (28/08) — as listas são
// recortes de negócio, não detalhe técnico.

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

describe("portal personalizado (Cecílio) — a réplica do Hércules", () => {
  it("tem o menu do Hércules sem o Lançamento, mais LSoft e Boletos", () => {
    // Lucas (16/09/2026), olhando o /comercial/gurgel: *"quero replicar esse portal do coordenador
    // (falo de estrutura layout) para o portal da Cecilio. a unica coisa que não teremos é o
    // lançamento"*. As duas últimas vêm de listas próprias, cada uma por pedido DIRETO do Lucas
    // nomeando os dois portais do Cecílio — não por herança do padrão:
    //   • LSoft   (19/08/2026) — `lib/lsoft/portais`;
    //   • Boletos (01/09/2026) — `lib/apolo/boletos/portais`, *"essa tela vai somente no perfil da
    //     CER e Cecilio"*.
    // ⚠️ PERSONALIZADO NÃO É "NUNCA MUDA": é "o padrão não passa por cima". Pedido explícito do
    // Lucas para este portal entra — é ele quem decide o que o cliente dele vê.
    expect(rotulos("cecilio-rocha")).toEqual([
      "CRM",
      "Produtos",
      "Venda",
      "Contratos",
      "Financeiro",
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

describe("quem opera a venda (e veste a casca do Hércules)", () => {
  // Lucas (16/09/2026): *"a Cecilio quem vai fazer é o proprio time deles (...) eles meio que vão
  // andar sozinhos"*. Cada `true` aqui abre escrita (reserva, proposta, board, contratos) para
  // gente de fora da Careli, então o `false` dos outros portais é tão importante quanto.
  it("o comercial sempre opera, qualquer que seja o slug", () => {
    expect(portalOperaVenda("gurgel", "comercial")).toBe(true);
    expect(portalOperaVenda("qualquer-coordenador", "comercial")).toBe(true);
  });

  it("o Cecílio opera, mesmo sendo incorporador", () => {
    expect(portalOperaVenda("cecilio-rocha", "incorporador")).toBe(true);
    // Cookie antigo, sem o campo `tipo`.
    expect(portalOperaVenda("cecilio-rocha", null)).toBe(true);
  });

  it("aceita o slug com espaço ou caixa diferente", () => {
    expect(portalOperaVenda("  CECILIO-ROCHA ", "incorporador")).toBe(true);
  });

  it("o CER (o outro portal do Cecílio, no padrão) NÃO opera", () => {
    expect(portalOperaVenda("cer", "incorporador")).toBe(false);
  });

  it("os incorporadores do padrão e o sócio NÃO operam", () => {
    for (const slug of ["vistaalegre", "lagoabonita", "valedoouro", "mmendes"]) {
      expect(portalOperaVenda(slug, "incorporador"), slug).toBe(false);
    }
  });

  it("slug e tipo ausentes caem no fechado", () => {
    expect(portalOperaVenda(null, null)).toBe(false);
    expect(portalOperaVenda(undefined, undefined)).toBe(false);
    expect(portalOperaVenda("", "incorporador")).toBe(false);
  });

  it("operar a venda NÃO faz do Cecílio um comercial", () => {
    // O que é exclusivo do comercial (Lançamento, Ato e Sinal, porta do coordenador) continua
    // perguntando `ehPortalComercial`, que olha só o tipo.
    expect(ehPortalComercial("incorporador")).toBe(false);
    expect(ehPortalComercial(null)).toBe(false);
  });
});

describe("o menu de cada portal (abasDoPortal)", () => {
  const chaves = (slug: string, tipo?: TipoDePortal) =>
    abasDoPortal(slug, tipo).map((aba) => aba.chave);

  it("comercial (Gurgel): o Hércules inteiro, com o Lançamento, sem LSoft nem Boletos", () => {
    expect(abasDoPortal("gurgel", "comercial").map((aba) => aba.rotulo)).toEqual([
      "CRM",
      "Produtos",
      "Venda",
      "Contratos",
      "Financeiro",
      "Lançamento",
    ]);
  });

  it("o tipo comercial vence as listas de slug", () => {
    // Um coordenador com o slug do Cecílio seria comercial, com Lançamento e sem LSoft.
    expect(chaves("cecilio-rocha", "comercial")).toContain("lancamento");
    expect(chaves("cecilio-rocha", "comercial")).not.toContain("lsoft");
  });

  it("Cecílio: as mesmas chaves do comercial, menos o Lançamento, mais LSoft e Boletos", () => {
    expect(chaves("cecilio-rocha", "incorporador")).toEqual([
      "crm",
      "produtos",
      "venda",
      "contratos",
      "carteira",
      "lsoft",
      "boletos",
    ]);
    expect(chaves("cecilio-rocha", "incorporador")).not.toContain("lancamento");
    expect(chaves("cecilio-rocha", "incorporador")).not.toContain("vendas");
  });

  it("Cecílio: os ícones são os mesmos do comercial, aba por aba", () => {
    const doComercial = new Map(abasDoPortal("gurgel", "comercial").map((aba) => [aba.chave, aba]));
    for (const aba of abasDoPortal("cecilio-rocha", "incorporador")) {
      const par = doComercial.get(aba.chave);
      if (!par) continue; // LSoft e Boletos não existem no comercial.
      expect(aba.icone, aba.chave).toBe(par.icone);
      expect(aba.rotulo, aba.chave).toBe(par.rotulo);
    }
  });

  it("Cecílio: TODA aba tem ícone (recolhida, a lateral só mostra o ícone)", () => {
    for (const aba of abasDoPortal("cecilio-rocha", "incorporador")) {
      expect(aba.icone, aba.chave).toBeDefined();
    }
  });

  it("CER: continua no padrão, com LSoft e Boletos, sem ícone", () => {
    expect(abasDoPortal("cer", "incorporador").map((aba) => aba.rotulo)).toEqual([
      "CRM",
      "Vendas",
      "Carteira",
      "LSoft Integração",
      "Boletos",
    ]);
    for (const aba of abasDoPortal("cer", "incorporador")) {
      expect(aba.icone, aba.chave).toBeUndefined();
    }
  });

  it("Vista Alegre: o padrão de sempre, sem nada do Hércules", () => {
    expect(chaves("vistaalegre", "incorporador")).toEqual(["crm", "vendas", "carteira"]);
    for (const aba of abasDoPortal("vistaalegre", "incorporador")) {
      expect(aba.icone, aba.chave).toBeUndefined();
    }
  });

  it("MMendes: só Produtos, sem a casca", () => {
    expect(chaves("mmendes", "incorporador")).toEqual(["produtos"]);
    expect(abasDoPortal("mmendes", "incorporador")[0]?.icone).toBeUndefined();
  });

  it("nenhum portal de incorporador ganha o Lançamento", () => {
    for (const slug of ["cecilio-rocha", "cer", "vistaalegre", "lagoabonita", "mmendes", ""]) {
      expect(chaves(slug, "incorporador"), slug).not.toContain("lancamento");
    }
  });

  it("Venda e Contratos só existem para quem opera a venda", () => {
    for (const slug of ["cer", "vistaalegre", "lagoabonita", "mmendes"]) {
      expect(chaves(slug, "incorporador"), slug).not.toContain("venda");
      expect(chaves(slug, "incorporador"), slug).not.toContain("contratos");
    }
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
