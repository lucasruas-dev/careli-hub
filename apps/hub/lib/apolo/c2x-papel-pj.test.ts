import { describe, expect, it } from "vitest";

import { diagnosticarCadastro, perfilDaFicha } from "./c2x-write-server";

// QUEM SOBE, COM QUE PERFIL, E O QUE FALTA — as duas decisões que faziam o cliente PJ ficar mudo.
//
// Antes: o perfil saía da persona (`entity_kind === "pj" ? "imobiliaria" : "cliente"`) e o filtro
// da fila era `entity_kind = 'pf'`. Com o filtro liberado sem trocar o perfil, os 6 clientes PJ
// credenciados nasceriam como IMOBILIÁRIA (profile 6) no C2X de produção — e o POST genérico
// cria de novo a cada chamada, sem desfazer.

const cadastroPjCompleto = {
  dataAbertura: "2013-09-19",
  porte: "ME",
  socios: [
    { cpf: "086.167.966-06", nome: "RENATA BRAGA DA CRUZ", representanteLegal: true },
  ],
};

describe("perfilDaFicha (papel -> perfil no C2X)", () => {
  it("prospect é CLIENTE, seja PF ou PJ", () => {
    expect(perfilDaFicha({ bornRole: "prospect" }, "pf")).toBe("cliente");
    expect(perfilDaFicha({ bornRole: "prospect" }, "pj")).toBe("cliente");
  });

  it("PJ nunca é imobiliária só por ser PJ", () => {
    expect(perfilDaFicha({ bornRole: "imobiliaria" }, "pj")).toBe("imobiliaria");
    expect(perfilDaFicha({ bornRole: "incorporador" }, "pj")).toBe("incorporador");
  });

  it("corretor e os demais papéis NÃO sobem", () => {
    // O corretor mora só no Apolo; no C2X o cliente é vinculado à IMOBILIÁRIA.
    expect(perfilDaFicha({ bornRole: "corretor" }, "pf")).toBeNull();
    expect(perfilDaFicha({ bornRole: "fornecedor" }, "pj")).toBeNull();
    expect(perfilDaFicha({ bornRole: "colaborador" }, "pf")).toBeNull();
  });

  it("sem papel: PF segue cliente (comportamento de hoje), PJ não sobe", () => {
    expect(perfilDaFicha({}, "pf")).toBe("cliente");
    expect(perfilDaFicha(null, "pf")).toBe("cliente");
    expect(perfilDaFicha({}, "pj")).toBeNull();
  });
});

describe("diagnosticarCadastro numa PJ", () => {
  it("não cobra campo de pessoa física (a ficha de empresa não tem nenhum)", () => {
    const faltam = diagnosticarCadastro({}, true, {
      cadastro: cadastroPjCompleto,
      cnpj: "18.915.155/0001-13",
      razaoSocial: "VOVO BRAGA PADARIA E MERCEARIA LTDA",
    });
    // Sem lista própria, uma PJ cairia em "Estado civil / Escolaridade / Renda / Nome da mãe..."
    // e o silêncio só mudaria de lugar: sairia do filtro e entraria no diagnóstico.
    expect(faltam).toEqual([]);
  });

  it("cobra o que o cliente PJ do C2X sempre tem: porte, abertura e representante legal", () => {
    const faltam = diagnosticarCadastro({}, true, {
      cadastro: {},
      cnpj: "20.869.966/0001-77",
      razaoSocial: "DIEGO MONTEIRO SOARES",
    });
    expect(faltam).toEqual(["Porte", "Data de abertura", "Representante legal"]);
  });

  it("sócio sem CPF não vira assinante silenciosamente", () => {
    const faltam = diagnosticarCadastro({}, true, {
      cadastro: { ...cadastroPjCompleto, socios: [{ nome: "FULANO", representanteLegal: true }] },
      cnpj: "18.915.155/0001-13",
      razaoSocial: "EMPRESA LTDA",
    });
    expect(faltam).toEqual(["CPF do representante legal"]);
  });

  it("sem imobiliária a PJ também não sobe (o cliente não entra solto)", () => {
    const faltam = diagnosticarCadastro({}, false, {
      cadastro: cadastroPjCompleto,
      cnpj: "18.915.155/0001-13",
      razaoSocial: "EMPRESA LTDA",
    });
    expect(faltam).toEqual(["Imobiliária"]);
  });

  it("a lista da PESSOA FÍSICA continua igual", () => {
    expect(diagnosticarCadastro({}, true)).toEqual([
      "Estado civil",
      "Escolaridade",
      "Renda",
      "Naturalidade",
      "Nacionalidade",
      "Nome da mãe",
      "Nascimento",
    ]);
  });
});
