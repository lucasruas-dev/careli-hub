import { describe, expect, it } from "vitest";

import { planejarHabilitacao } from "./credenciamento-aprovacao";
import { canonizador, cobertoPor, idsDoEmpreendimento } from "./empreendimento-equivalencia";
import { filtrarEmpreendimentosHabilitados } from "@/lib/publico/cad/regras";

// Catálogo REAL (lido do C2X em 17/08/2026). Lagoa Bonita é grupo; Jardim das Gerais é simples.
const CATALOGO = [
  { code: "LBF + LBR + LBP", id: "group:Lagoa Bonita", logoUrl: null, name: "LAGOA BONITA", stageIds: ["33", "27", "32"] },
  { code: "JDG", id: "40", logoUrl: null, name: "JARDIM DAS GERAIS", stageIds: ["40"] },
  { code: "VLO", id: "35", logoUrl: null, name: "VALE DO OURO", stageIds: ["35"] },
];

describe("idsDoEmpreendimento", () => {
  it("o grupo vale por ele mesmo e por cada divisão", () => {
    expect(idsDoEmpreendimento(CATALOGO[0]!).sort()).toEqual(
      ["27", "32", "33", "group:Lagoa Bonita"].sort(),
    );
  });

  it("empreendimento simples não duplica o próprio id", () => {
    expect(idsDoEmpreendimento(CATALOGO[1]!)).toEqual(["40"]);
  });
});

describe("canonizador", () => {
  it("qualquer divisão do Lagoa Bonita vira o id do grupo", () => {
    const canon = canonizador(CATALOGO);

    expect(canon("33")).toBe("group:Lagoa Bonita");
    expect(canon("27")).toBe("group:Lagoa Bonita");
    expect(canon("32")).toBe("group:Lagoa Bonita");
    expect(canon("group:Lagoa Bonita")).toBe("group:Lagoa Bonita");
  });

  it("id fora do catálogo volta como veio, em vez de virar equivalência inventada", () => {
    // Empreendimento removido do C2X não pode ser silenciosamente absorvido por um grupo.
    expect(canonizador(CATALOGO)("999")).toBe("999");
  });
});

describe("o bug do botão Habilitar (17/08)", () => {
  it("pedido gravado como GRUPO casa com escolha expandida em divisões", () => {
    // O caso do print: a imobiliária pediu pelo portal público, que grava "group:Lagoa Bonita".
    // A tela mandou o mesmo id; antes o servidor expandia só um lado e devolvia
    // "Empreendimento que esta imobiliaria nao pediu: 33, 27, 32".
    const canon = canonizador(CATALOGO);

    const plano = planejarHabilitacao({
      escolhidos: ["group:Lagoa Bonita"].map(canon),
      pedidos: [
        { enterpriseId: canon("group:Lagoa Bonita"), id: "rel-1", label: "LAGOA BONITA", status: "pending" },
      ],
    });

    expect(plano.desconhecidos).toEqual([]);
    expect(plano.habilitar).toEqual(["rel-1"]);
  });

  it("pedido gravado como DIVISÃO também casa: os dois formatos existem no banco", () => {
    const canon = canonizador(CATALOGO);

    const plano = planejarHabilitacao({
      escolhidos: ["group:Lagoa Bonita"].map(canon),
      pedidos: [{ enterpriseId: canon("33"), id: "rel-2", label: "LAGOA BONITA", status: "pending" }],
    });

    expect(plano.desconhecidos).toEqual([]);
    expect(plano.habilitar).toEqual(["rel-2"]);
  });

  it("empreendimento que ela REALMENTE não pediu continua sendo recusado", () => {
    // A trava não pode ser afrouxada junto: liberar produto não pedido na tela de validação é o
    // que ela existe para impedir.
    const canon = canonizador(CATALOGO);

    const plano = planejarHabilitacao({
      escolhidos: ["group:Lagoa Bonita", "35"].map(canon),
      pedidos: [{ enterpriseId: canon("33"), id: "rel-3", label: "LAGOA BONITA", status: "pending" }],
    });

    expect(plano.desconhecidos).toEqual(["35"]);
  });
});

describe("o caso DANY CASTRO: habilitada no banco e invisível no portal", () => {
  it("vínculo nas TRÊS divisões faz o Lagoa Bonita aparecer para o corretor", () => {
    // Ela está `verified` em 33, 27 e 32 desde sempre. O portal comparava só contra
    // "group:Lagoa Bonita" e filtrava o empreendimento fora: os corretores dela não conseguiam
    // enviar CAD, e a habilitação existia no banco o tempo todo.
    const visiveis = filtrarEmpreendimentosHabilitados(["33", "27", "32"], CATALOGO);

    expect(visiveis.map((emp) => emp.name)).toEqual(["LAGOA BONITA"]);
  });

  it("vínculo em UMA divisão já basta: para o mercado o empreendimento é um só", () => {
    const visiveis = filtrarEmpreendimentosHabilitados(["27"], CATALOGO);

    expect(visiveis.map((emp) => emp.name)).toEqual(["LAGOA BONITA"]);
  });

  it("vínculo no id do GRUPO continua funcionando", () => {
    const visiveis = filtrarEmpreendimentosHabilitados(["group:Lagoa Bonita"], CATALOGO);

    expect(visiveis.map((emp) => emp.name)).toEqual(["LAGOA BONITA"]);
  });

  it("sem vínculo nenhum, não vê nada", () => {
    expect(filtrarEmpreendimentosHabilitados([], CATALOGO)).toEqual([]);
  });

  it("vínculo com OUTRO empreendimento não libera o Lagoa Bonita", () => {
    const visiveis = filtrarEmpreendimentosHabilitados(["40"], CATALOGO);

    expect(visiveis.map((emp) => emp.name)).toEqual(["JARDIM DAS GERAIS"]);
  });
});

describe("cobertoPor", () => {
  it("não deixa vínculo vazio cobrir empreendimento", () => {
    expect(cobertoPor(CATALOGO[0]!, ["", "  "])).toBe(false);
  });
});
