import { describe, expect, it } from "vitest";

import { escopoDoUsuario } from "./escopo-do-usuario";

const portal = [
  { carteiraAdministrada: true, enterpriseId: "35" },
  { carteiraAdministrada: false, enterpriseId: "39" },
];

describe("escopoDoUsuario", () => {
  it("sem vínculo próprio, herda o recorte do portal (os dez incorporadores seguem iguais)", () => {
    expect(escopoDoUsuario({ doPortal: portal, doUsuario: [], tipo: "incorporador" })).toEqual({
      enterpriseIds: ["35", "39"],
      enterpriseIdsComCarteira: ["35"],
    });
  });

  it("com vínculo próprio, o do usuário MANDA e o do portal some", () => {
    expect(escopoDoUsuario({ doPortal: portal, doUsuario: ["40"], tipo: "comercial" })).toEqual({
      enterpriseIds: ["40"],
      enterpriseIdsComCarteira: ["40"],
    });
  });

  it("no comercial, Financeiro vale para todo empreendimento do escopo, com ou sem flag", () => {
    expect(escopoDoUsuario({ doPortal: portal, doUsuario: ["39", "35"], tipo: "comercial" })).toEqual({
      enterpriseIds: ["39", "35"],
      enterpriseIdsComCarteira: ["39", "35"],
    });
  });

  it("no comercial, conta SEM vínculo próprio NÃO herda o portal: escopo vazio (fail-closed)", () => {
    expect(escopoDoUsuario({ doPortal: portal, doUsuario: [], tipo: "comercial" })).toEqual({
      enterpriseIds: [],
      enterpriseIdsComCarteira: [],
    });
  });

  it("no incorporador, a carteira segue a flag do portal mesmo com vínculo próprio", () => {
    expect(
      escopoDoUsuario({ doPortal: portal, doUsuario: ["39", "35"], tipo: "incorporador" }),
    ).toEqual({ enterpriseIds: ["39", "35"], enterpriseIdsComCarteira: ["35"] });
  });

  it("limpa espaço, vazio e repetido — o cookie não pode carregar lixo", () => {
    expect(
      escopoDoUsuario({ doPortal: [], doUsuario: [" 40 ", "", "40", "41"], tipo: "comercial" }),
    ).toEqual({ enterpriseIds: ["40", "41"], enterpriseIdsComCarteira: ["40", "41"] });
  });
});
