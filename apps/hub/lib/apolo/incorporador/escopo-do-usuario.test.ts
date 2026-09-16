import { describe, expect, it } from "vitest";

import { escopoDoUsuario } from "./escopo-do-usuario";
import { portalOperaVenda } from "./perfis-de-portal";

const portal = [
  { carteiraAdministrada: true, enterpriseId: "35" },
  { carteiraAdministrada: false, enterpriseId: "39" },
];

describe("escopoDoUsuario", () => {
  it("sem vínculo próprio, herda o recorte do portal (os dez incorporadores seguem iguais)", () => {
    expect(
      escopoDoUsuario({ doPortal: portal, doUsuario: [], operaVenda: false, tipo: "incorporador" }),
    ).toEqual({
      enterpriseIds: ["35", "39"],
      enterpriseIdsComCarteira: ["35"],
    });
  });

  it("com vínculo próprio, o do usuário MANDA e o do portal some", () => {
    expect(
      escopoDoUsuario({ doPortal: portal, doUsuario: ["40"], operaVenda: true, tipo: "comercial" }),
    ).toEqual({
      enterpriseIds: ["40"],
      enterpriseIdsComCarteira: ["40"],
    });
  });

  it("no comercial, Financeiro vale para todo empreendimento do escopo, com ou sem flag", () => {
    expect(
      escopoDoUsuario({
        doPortal: portal,
        doUsuario: ["39", "35"],
        operaVenda: true,
        tipo: "comercial",
      }),
    ).toEqual({
      enterpriseIds: ["39", "35"],
      enterpriseIdsComCarteira: ["39", "35"],
    });
  });

  it("no comercial, conta SEM vínculo próprio NÃO herda o portal: escopo vazio (fail-closed)", () => {
    expect(
      escopoDoUsuario({ doPortal: portal, doUsuario: [], operaVenda: true, tipo: "comercial" }),
    ).toEqual({
      enterpriseIds: [],
      enterpriseIdsComCarteira: [],
    });
  });

  it("no comercial, a regra do comercial vale mesmo que o chamador erre o operaVenda", () => {
    // O tipo decide primeiro: um `operaVenda: false` trocado não pode dar ao coordenador o recorte
    // inteiro do /gurgel.
    expect(
      escopoDoUsuario({ doPortal: portal, doUsuario: [], operaVenda: false, tipo: "comercial" }),
    ).toEqual({ enterpriseIds: [], enterpriseIdsComCarteira: [] });
  });

  it("no incorporador, a carteira segue a flag do portal mesmo com vínculo próprio", () => {
    expect(
      escopoDoUsuario({
        doPortal: portal,
        doUsuario: ["39", "35"],
        operaVenda: false,
        tipo: "incorporador",
      }),
    ).toEqual({ enterpriseIds: ["39", "35"], enterpriseIdsComCarteira: ["35"] });
  });

  it("limpa espaço, vazio e repetido — o cookie não pode carregar lixo", () => {
    expect(
      escopoDoUsuario({
        doPortal: [],
        doUsuario: [" 40 ", "", "40", "41"],
        operaVenda: true,
        tipo: "comercial",
      }),
    ).toEqual({ enterpriseIds: ["40", "41"], enterpriseIdsComCarteira: ["40", "41"] });
  });
});

// O INCORPORADOR QUE OPERA A PRÓPRIA VENDA (Lucas, 16/09/2026, sobre o Cecílio: *"eles meio que vão
// andar sozinhos sem o time administrativo da Careli"*). Os três casos lado a lado, com o recorte
// real do Cecílio: VOC (37) com carteira administrada e Garden (39) sem.
describe("escopoDoUsuario: incorporador que opera a venda", () => {
  const cecilio = [
    { carteiraAdministrada: true, enterpriseId: "37" },
    { carteiraAdministrada: false, enterpriseId: "39" },
  ];

  it("a régua do chamador: o Cecílio opera a venda, o cer e o vistaalegre não", () => {
    expect(portalOperaVenda("cecilio-rocha", "incorporador")).toBe(true);
    expect(portalOperaVenda("cer", "incorporador")).toBe(false);
    expect(portalOperaVenda("vistaalegre", "incorporador")).toBe(false);
    expect(portalOperaVenda("gurgel", "comercial")).toBe(true);
  });

  it("sem vínculo próprio, herda o recorte do PORTAL e vê o Financeiro de TODO o escopo", () => {
    expect(
      escopoDoUsuario({ doPortal: cecilio, doUsuario: [], operaVenda: true, tipo: "incorporador" }),
    ).toEqual({ enterpriseIds: ["37", "39"], enterpriseIdsComCarteira: ["37", "39"] });
  });

  it("NÃO exige vínculo por conta: o escopo nunca sai vazio só por falta de vínculo (sem 403)", () => {
    const escopo = escopoDoUsuario({
      doPortal: cecilio,
      doUsuario: [],
      operaVenda: true,
      tipo: "incorporador",
    });
    expect(escopo.enterpriseIds.length).toBeGreaterThan(0);
  });

  it("com vínculo próprio, o da conta manda (regra do incorporador) e o Financeiro acompanha", () => {
    expect(
      escopoDoUsuario({
        doPortal: cecilio,
        doUsuario: ["39"],
        operaVenda: true,
        tipo: "incorporador",
      }),
    ).toEqual({ enterpriseIds: ["39"], enterpriseIdsComCarteira: ["39"] });
  });

  it("o MESMO portal sem operar a venda volta à flag: o Garden some do Financeiro", () => {
    // É o comportamento de todo incorporador que não está na lista (cer, vistaalegre...).
    expect(
      escopoDoUsuario({ doPortal: cecilio, doUsuario: [], operaVenda: false, tipo: "incorporador" }),
    ).toEqual({ enterpriseIds: ["37", "39"], enterpriseIdsComCarteira: ["37"] });
  });

  it("operar a venda não AMPLIA o recorte: nada entra que não esteja no portal ou na conta", () => {
    const escopo = escopoDoUsuario({
      doPortal: cecilio,
      doUsuario: [],
      operaVenda: true,
      tipo: "incorporador",
    });
    const origem = new Set(cecilio.map((v) => v.enterpriseId));
    expect(escopo.enterpriseIds.every((id) => origem.has(id))).toBe(true);
    expect(escopo.enterpriseIdsComCarteira.every((id) => escopo.enterpriseIds.includes(id))).toBe(
      true,
    );
  });
});
