import { describe, expect, it } from "vitest";

import {
  conferirPlano,
  ehColunaDaRessalvaAusente,
  type EntradaDePlano,
  limparRessalva,
  RESSALVA_MAXIMA,
} from "./planos";

// A RESSALVA DE DISPONIBILIDADE (migration 0168): a etiqueta âmbar ao lado do nome do plano, que a
// Careli escreve no Apolo e o portal do incorporador mostra. Arquivo separado de `planos.test.ts`
// só para esta frente não disputar o mesmo arquivo com outra.

const base: EntradaDePlano = {
  entradaPercentual: 8,
  indiceCorrecao: "IPCA_ANUAL",
  jurosTaxa: 6,
  nome: "Investidor Parcelado",
  parcelas: 84,
  sistemaAmortizacao: "sacoc",
};

describe("limparRessalva", () => {
  it("apara, colapsa espaços (inclusive o não separável) e troca vazio por nulo", () => {
    expect(limparRessalva("  válido para as\u00A0\u00A0próximas 16 unidades ")).toBe(
      "válido para as próximas 16 unidades",
    );
    expect(limparRessalva("   ")).toBeNull();
    expect(limparRessalva("")).toBeNull();
    expect(limparRessalva(null)).toBeNull();
    expect(limparRessalva(undefined)).toBeNull();
    expect(limparRessalva(16)).toBeNull();
  });
});

describe("conferirPlano com ressalva", () => {
  it("aceita plano sem ressalva, com ressalva nula e com a frase do Garden", () => {
    expect(conferirPlano(base)).toEqual([]);
    expect(conferirPlano({ ...base, ressalva: null })).toEqual([]);
    expect(conferirPlano({ ...base, ressalva: "válido para as próximas 16 unidades" })).toEqual([]);
  });

  it("recusa ressalva maior que a etiqueta, contando depois de aparar", () => {
    const noLimite = "x".repeat(RESSALVA_MAXIMA);
    expect(conferirPlano({ ...base, ressalva: `   ${noLimite}   ` })).toEqual([]);

    const problemas = conferirPlano({ ...base, ressalva: "x".repeat(RESSALVA_MAXIMA + 1) });
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain(`${RESSALVA_MAXIMA} caracteres`);
  });

  it("recusa ressalva que não é texto (corpo montado à mão)", () => {
    const entrada = { ...base, ressalva: 16 } as unknown as EntradaDePlano;
    expect(conferirPlano(entrada)).toEqual(["A ressalva de disponibilidade precisa ser um texto."]);
  });
});

describe("ehColunaDaRessalvaAusente", () => {
  it("reconhece o 42703 do Postgres e o PGRST204 do PostgREST citando a ressalva", () => {
    expect(
      ehColunaDaRessalvaAusente({
        code: "42703",
        message: "column temis_planos.ressalva does not exist",
      }),
    ).toBe(true);
    expect(
      ehColunaDaRessalvaAusente({
        code: "PGRST204",
        message: "Could not find the 'ressalva' column of 'temis_planos' in the schema cache",
      }),
    ).toBe(true);
  });

  it("não engole coluna ausente de OUTRO nome, nem outros erros", () => {
    expect(
      ehColunaDaRessalvaAusente({
        code: "42703",
        message: "column temis_planos.anuais_valor does not exist",
      }),
    ).toBe(false);
    expect(
      ehColunaDaRessalvaAusente({ code: "23514", message: "violates check temis_planos_ressalva_etiqueta" }),
    ).toBe(false);
    expect(ehColunaDaRessalvaAusente(null)).toBe(false);
    expect(ehColunaDaRessalvaAusente("ressalva")).toBe(false);
  });
});
