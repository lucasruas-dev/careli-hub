import { describe, expect, it } from "vitest";

import { ehTabelaAusente } from "./tabela-ausente";

// O que este teste protege é a DIFERENÇA entre duas falhas parecidas: a migration que ainda não foi
// aplicada (normal, e o lugar dela é um aviso) e a coluna que não existe (defeito, e o lugar dela é
// um erro). O guard antigo testava só `42P01` e `does not exist` — e o caso de hoje, que é a
// resposta do schema cache da Supabase, não casava com nenhum dos dois.

const TABELA = "temis_trabalho_etapas";

describe("erro de tabela ausente", () => {
  it("o 42P01 do Postgres é tabela ausente", () => {
    const erro = { code: "42P01", message: 'relation "temis_trabalho_etapas" does not exist' };
    expect(ehTabelaAusente(erro, TABELA)).toBe(true);
  });

  // ⚠️ O CASO DE HOJE. A tabela não está no schema cache, a Supabase responde 404 e a query nem
  // chega ao Postgres: não há `42P01` nenhum para encontrar.
  it("o PGRST205 do schema cache é tabela ausente", () => {
    const erro = {
      code: "PGRST205",
      message: "Could not find the table 'public.temis_trabalho_etapas' in the schema cache",
    };
    expect(ehTabelaAusente(erro, TABELA)).toBe(true);
  });

  it("a mensagem do schema cache basta, mesmo sem código", () => {
    const erro = {
      message: "Could not find the table 'public.temis_trabalho_etapas' in the schema cache",
    };
    expect(ehTabelaAusente(erro, TABELA)).toBe(true);
  });

  // ⚠️ COLUNA AUSENTE NÃO É TABELA AUSENTE, e é por isso que o `42703` ficou de fora. Engolir este
  // caso faria o histórico nunca ser gravado, calado — e as duas mensagens abaixo citam a tabela e
  // uma das frases, então é o ramo da mensagem que precisa recusá-las.
  it("coluna que não existe NÃO é tabela ausente (Postgres)", () => {
    const erro = {
      code: "42703",
      message: 'column "quem_nome" of relation "temis_trabalho_etapas" does not exist',
    };
    expect(ehTabelaAusente(erro, TABELA)).toBe(false);
  });

  it("coluna que não existe NÃO é tabela ausente (PostgREST)", () => {
    const erro = {
      code: "PGRST204",
      message:
        "Could not find the 'quem_nome' column of 'temis_trabalho_etapas' in the schema cache",
    };
    expect(ehTabelaAusente(erro, TABELA)).toBe(false);
  });

  // ⚠️ `does not exist` SOLTO NÃO PASSA: a frase aparece em erro de papel, de função e de tipo, e
  // aceitá-la sem o nome da tabela transformaria qualquer um deles em silêncio.
  it("a frase sem o nome da tabela não passa", () => {
    expect(ehTabelaAusente({ message: 'role "anon" does not exist' }, TABELA)).toBe(false);
  });

  it("erro comum de banco continua sendo erro", () => {
    const erro = { code: "23514", message: 'new row violates check constraint "etapa_origem"' };
    expect(ehTabelaAusente(erro, TABELA)).toBe(false);
  });

  it("o que não é objeto não derruba a leitura", () => {
    expect(ehTabelaAusente(null, TABELA)).toBe(false);
    expect(ehTabelaAusente("relation does not exist", TABELA)).toBe(false);
    expect(ehTabelaAusente(undefined, TABELA)).toBe(false);
  });
});
