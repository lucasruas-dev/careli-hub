import { describe, expect, it } from "vitest";

import { idsDosCodigosNoCadastro } from "./escopo";

// O ID DE CADA CÓDIGO, PARA A LEITURA ÚNICA (F4 da fonte única): o cadastro primeiro, o catálogo do C2X
// só de reserva (ACT, SDT e TSC não têm linha com id no cadastro, medido em 28/09/2026), e o catálogo
// fora do ar não derruba a tela.

const cadastro = [
  { c2xEnterpriseId: "37", codigo: "VOC" },
  { c2xEnterpriseId: "36", codigo: "VOL" },
  { c2xEnterpriseId: "100001", codigo: "TST" },
];
const catalogo = [
  { codes: ["VOC", "VOL"], stageIds: ["37", "36"] },
  { codes: ["ACT"], stageIds: ["41"] },
];

describe("idsDosCodigosNoCadastro", () => {
  it("⚠️ o cadastro dá o id; o catálogo só entra para quem não tem linha nele", () => {
    expect(idsDosCodigosNoCadastro(cadastro, catalogo, ["voc", "ACT", "TST"], ["37", "41", "100001"])).toEqual({
      ids: ["37", "41", "100001"],
      semId: [],
    });
  });

  it("⚠️ catálogo fora do ar: segue com o cadastro, e o que só o catálogo traduzia sai com aviso", () => {
    expect(idsDosCodigosNoCadastro(cadastro, [], ["VOC", "ACT"], ["37", "41"])).toEqual({ ids: ["37"], semId: ["ACT"] });
  });

  it("⚠️ é tradução, não permissão: id fora do alcance da sessão não entra", () => {
    expect(idsDosCodigosNoCadastro(cadastro, catalogo, ["VOC", "VOL"], ["37"])).toEqual({ ids: ["37"], semId: ["VOL"] });
  });

  it("sem trava (null) só para o script de paridade; cadastro fora do ar cai no catálogo", () => {
    expect(idsDosCodigosNoCadastro(null, catalogo, ["VOL", "ACT"], null)).toEqual({ ids: ["36", "41"], semId: [] });
  });
});
