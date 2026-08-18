import { describe, expect, it } from "vitest";

import {
  agregarPerfilDoComprador,
  type CompradorCru,
  faixaDeIdade,
  NAO_INFORMADO,
  PISO_DE_AGREGACAO,
} from "./perfil-comprador";

const AGORA = Date.parse("2026-08-18T12:00:00.000Z");

function comprador(extras: Partial<CompradorCru> = {}): CompradorCru {
  return {
    cidade: "Desterro de Entre Rios/MG",
    estado_civil: "Solteiro (a)",
    nascimento: "1990-05-10",
    profissao: "MOTORISTA",
    renda: "3 a 6 salários",
    sexo: "Masculino",
    ...extras,
  };
}

describe("a faixa de idade (as mesmas do relatório do Vale do Ouro)", () => {
  it("corta nas bordas exatas, por idade completa", () => {
    expect(faixaDeIdade("2002-08-18", AGORA)).toBe("Até 24"); // faz 24 hoje
    expect(faixaDeIdade("2001-08-19", AGORA)).toBe("Até 24"); // 25 só amanhã
    expect(faixaDeIdade("2001-08-18", AGORA)).toBe("25 a 34"); // faz 25 hoje
    expect(faixaDeIdade("1991-08-19", AGORA)).toBe("25 a 34");
    expect(faixaDeIdade("1991-08-18", AGORA)).toBe("35 a 44");
    expect(faixaDeIdade("1981-08-18", AGORA)).toBe("45 a 54");
    expect(faixaDeIdade("1971-08-18", AGORA)).toBe("55+");
  });

  it("nascimento nulo, mal formado ou absurdo vira 'Não informado'", () => {
    expect(faixaDeIdade(null, AGORA)).toBe(NAO_INFORMADO);
    expect(faixaDeIdade("", AGORA)).toBe(NAO_INFORMADO);
    expect(faixaDeIdade("10/05/1990", AGORA)).toBe(NAO_INFORMADO);
    expect(faixaDeIdade("2030-01-01", AGORA)).toBe(NAO_INFORMADO); // nasce no futuro
    expect(faixaDeIdade("1880-01-01", AGORA)).toBe(NAO_INFORMADO); // 146 anos
  });
});

describe("o perfil do comprador agregado", () => {
  it("conta e calcula percentual por faixa, com o total de vendas como denominador", () => {
    const perfil = agregarPerfilDoComprador(
      [
        comprador(),
        comprador(),
        comprador({ sexo: "Masculino" }),
        comprador({ estado_civil: "Casado (a)", sexo: "Feminino" }),
        comprador({ sexo: "Feminino" }),
      ],
      AGORA,
    )!;

    expect(perfil.vendas).toBe(5);
    expect(perfil.sexo).toEqual([
      { percentual: 60, quantidade: 3, rotulo: "Masculino" },
      { percentual: 40, quantidade: 2, rotulo: "Feminino" },
    ]);
    expect(perfil.estadoCivil[0]).toEqual({
      percentual: 80,
      quantidade: 4,
      rotulo: "Solteiro (a)",
    });
    expect(perfil.idades).toEqual([
      { percentual: 100, quantidade: 5, rotulo: "35 a 44" },
    ]);
  });

  it("campo nulo ou vazio vira 'Não informado' — nunca some da conta", () => {
    const perfil = agregarPerfilDoComprador(
      [comprador({ renda: null, sexo: "  " }), comprador(), comprador(), comprador(), comprador()],
      AGORA,
    )!;

    expect(perfil.rendaFamiliar).toContainEqual({
      percentual: 20,
      quantidade: 1,
      rotulo: NAO_INFORMADO,
    });
    expect(perfil.sexo).toContainEqual({
      percentual: 20,
      quantidade: 1,
      rotulo: NAO_INFORMADO,
    });
  });

  it("profissões cortam no top 6 e cidades no top 5; sem endereço fica fora das cidades", () => {
    const compradores: CompradorCru[] = [
      ...Array.from({ length: 7 }, (_, i) =>
        comprador({ cidade: `Cidade ${i}/MG`, profissao: `Profissao ${i}` }),
      ),
      comprador({ cidade: null }),
    ];

    const perfil = agregarPerfilDoComprador(compradores, AGORA)!;

    expect(perfil.profissoes).toHaveLength(6);
    expect(perfil.cidades).toHaveLength(5);
    // O denominador segue sendo o total de vendas (8), mesmo com o corte do top-N.
    expect(perfil.cidades[0]?.percentual).toBe(12.5);
    // Quem não tem endereço não vira a "cidade" mais comum.
    expect(perfil.cidades.map((c) => c.rotulo)).not.toContain(NAO_INFORMADO);
  });

  it("ordena por frequência com desempate estável por nome", () => {
    const perfil = agregarPerfilDoComprador(
      [
        comprador({ renda: "1 a 3 salários" }),
        comprador({ renda: "3 a 6 salários" }),
        comprador({ renda: "3 a 6 salários" }),
        comprador({ renda: "3 a 6 salários" }),
        comprador({ renda: "6 a 9 salários" }),
      ],
      AGORA,
    )!;

    expect(perfil.rendaFamiliar.map((f) => f.rotulo)).toEqual([
      "3 a 6 salários",
      "1 a 3 salários",
      "6 a 9 salários",
    ]);
  });

  it("idades saem na ordem etária (não por frequência) e faixa zerada não vira linha", () => {
    const perfil = agregarPerfilDoComprador(
      [
        comprador({ nascimento: "1960-01-01" }), // 55+
        comprador({ nascimento: "1960-02-02" }), // 55+
        comprador({ nascimento: "2003-01-01" }), // Até 24
        comprador({ nascimento: "2004-06-15" }), // Até 24
        comprador({ nascimento: null }),
      ],
      AGORA,
    )!;

    expect(perfil.idades.map((f) => f.rotulo)).toEqual(["Até 24", "55+", NAO_INFORMADO]);
  });

  it("🔒 abaixo do piso de agregação NÃO sai perfil: agregado de 1 é a ficha de alguém", () => {
    // Com 1–2 vendas vivas (há empreendimentos assim no C2X), os "baldes" entregariam renda,
    // idade e cidade de uma pessoa que aparece nominalmente na tabela da mesma tela.
    expect(agregarPerfilDoComprador([], AGORA)).toBeNull();
    expect(agregarPerfilDoComprador([comprador()], AGORA)).toBeNull();
    expect(
      agregarPerfilDoComprador(
        Array.from({ length: PISO_DE_AGREGACAO - 1 }, () => comprador()),
        AGORA,
      ),
    ).toBeNull();
    expect(
      agregarPerfilDoComprador(
        Array.from({ length: PISO_DE_AGREGACAO }, () => comprador()),
        AGORA,
      ),
    ).not.toBeNull();
  });

  it("🔒 o agregado não carrega nenhum campo individual (nome, documento, linha crua)", () => {
    const perfil = agregarPerfilDoComprador(
      Array.from({ length: PISO_DE_AGREGACAO }, () => comprador()),
      AGORA,
    )!;

    expect(Object.keys(perfil).sort()).toEqual([
      "cidades",
      "estadoCivil",
      "idades",
      "profissoes",
      "rendaFamiliar",
      "sexo",
      "vendas",
    ]);
    for (const fatia of [
      ...perfil.sexo,
      ...perfil.idades,
      ...perfil.estadoCivil,
      ...perfil.rendaFamiliar,
      ...perfil.profissoes,
      ...perfil.cidades,
    ]) {
      expect(Object.keys(fatia).sort()).toEqual(["percentual", "quantidade", "rotulo"]);
    }
  });
});
