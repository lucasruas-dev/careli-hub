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

// PROFISSÃO A PADRONIZAR (27/08). O envio ao C2X é de MÃO ÚNICA: só POST, e a entidade sai das
// candidatas assim que recebe `c2xSynced`. Subir antes de alguém escolher a profissão equivalente
// grava "PROFISSÃO NÃO DECLARADA" no legado para sempre — a profissão do cliente ficaria só no
// Apolo. Por isso o diagnóstico segura o lote automático (com `tentarTodas` ainda dá para forçar).
describe("diagnosticarCadastro e a profissão digitada à mão", () => {
  const pfCompleta = {
    dataNascimento: "1980-05-02",
    escolaridadeId: "3",
    estadoCivilId: "1",
    nacionalidade: "BRASILEIRA",
    naturalidade: "BELO HORIZONTE",
    nomeMae: "MARIA DA SILVA",
    rendaId: "2",
  };

  it("só texto livre: segura, com nome próprio", () => {
    expect(
      diagnosticarCadastro({ ...pfCompleta, profissaoOutro: "piloto de drone agrícola" }, true),
    ).toEqual(["Profissão a padronizar"]);
  });

  it("padronizada (id do catálogo): libera, mesmo com o texto declarado guardado", () => {
    expect(
      diagnosticarCadastro(
        { ...pfCompleta, profissaoId: "9", profissaoOutro: "piloto de drone agrícola" },
        true,
      ),
    ).toEqual([]);
  });

  it("🔴 o 25 do C2X NÃO conta como padronização (é o default da FK, o vazio dele)", () => {
    expect(
      diagnosticarCadastro(
        { ...pfCompleta, profissaoId: "25", profissaoOutro: "piloto de drone agrícola" },
        true,
      ),
    ).toEqual(["Profissão a padronizar"]);
  });

  it("ficha sem profissão nenhuma continua passando: profissão é opcional no C2X", () => {
    expect(diagnosticarCadastro(pfCompleta, true)).toEqual([]);
  });
});
