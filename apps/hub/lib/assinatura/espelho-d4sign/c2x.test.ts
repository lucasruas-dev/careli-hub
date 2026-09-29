import { describe, expect, it } from "vitest";

import {
  abrirLeituraDoC2x,
  descartarLeituraDoC2x,
  documentosDosCompradores,
  fecharLeituraDoC2x,
  instanteDeBrasilia,
  lerEnviosDoC2x,
  lerPessoasDosEnvios,
  SQL_ABRE_LEITURA,
  SQL_DAS_PESSOAS,
  SQL_DOS_COMPRADORES,
  SQL_DOS_ENVIOS,
  TIMEOUT_DA_CONSULTA_MS,
} from "./c2x";

// O QUE O ESPELHO LÊ NO C2X: SÓ SELECT, UMA CONEXÃO, TRANSAÇÃO READ ONLY, 20 s POR CONSULTA (0.29).

describe("instanteDeBrasilia", () => {
  it("23:30 de Brasília é 02:30Z do dia seguinte", () => {
    const iso = instanteDeBrasilia("2026-09-11 23:30:00");
    expect(iso).toBe("2026-09-11T23:30:00-03:00");
    expect(Date.parse(String(iso))).toBe(Date.parse("2026-09-12T02:30:00Z"));
  });

  it("texto fora da forma vira nulo (nunca new Date do driver)", () => {
    expect(instanteDeBrasilia(null)).toBeNull();
    expect(instanteDeBrasilia("ontem")).toBeNull();
  });
});

describe("só leitura", () => {
  it("as consultas são SELECT (sem for update, insert, update, delete)", () => {
    for (const sql of [SQL_DOS_ENVIOS, SQL_DAS_PESSOAS, SQL_DOS_COMPRADORES]) {
      expect(sql.trim().toLowerCase().startsWith("select")).toBe(true);
      expect(sql).not.toMatch(/\b(for\s+update|insert|update|delete|replace\s+into|lock)\b/i);
    }
  });

  it("nenhuma consulta lê quem assinou do C2X (ss.signed / date_signed)", () => {
    for (const sql of [SQL_DOS_ENVIOS, SQL_DAS_PESSOAS]) expect(sql).not.toMatch(/signed/i);
  });

  it("abre a transação READ ONLY na conexão e, no fim, faz COMMIT e devolve", async () => {
    const chamadas: Array<{ sql: string; timeout: unknown }> = [];
    let devolvida = false;
    const conexao = {
      query: async (opcoes: { sql: string; timeout?: number }) => {
        chamadas.push({ sql: opcoes.sql, timeout: opcoes.timeout });
        return [[], []];
      },
      release: () => {
        devolvida = true;
      },
    };
    const pool = { getConnection: async () => conexao };
    const aberta = await abrirLeituraDoC2x(pool as never);
    await lerEnviosDoC2x(aberta);
    await lerPessoasDosEnvios(aberta, [1, 2]);
    await documentosDosCompradores(aberta, [3]);
    await fecharLeituraDoC2x(aberta);

    expect(chamadas[0]?.sql).toBe(SQL_ABRE_LEITURA);
    expect(SQL_ABRE_LEITURA).toBe("START TRANSACTION READ ONLY");
    expect(chamadas.at(-1)?.sql).toBe("COMMIT");
    expect(devolvida).toBe(true);
    // Toda consulta leva o teto de 20 s.
    for (const c of chamadas) expect(c.timeout).toBe(TIMEOUT_DA_CONSULTA_MS);
    // Fora a abertura e o COMMIT, só SELECT chegou à conexão.
    for (const c of chamadas.slice(1, -1)) expect(c.sql.trim().toLowerCase().startsWith("select")).toBe(true);
  });

  it("START TRANSACTION que falha devolve a conexão e não segue", async () => {
    let devolvida = false;
    const conexao = {
      query: async () => {
        throw Object.assign(new Error("x"), { code: "ER_X" });
      },
      release: () => {
        devolvida = true;
      },
    };
    await expect(abrirLeituraDoC2x({ getConnection: async () => conexao } as never)).rejects.toBeTruthy();
    expect(devolvida).toBe(true);
  });

  it("a conexão cuja consulta falhou é DESTRUÍDA (não volta ao pool com a consulta presa); sem destroy, release", () => {
    const eventos: string[] = [];
    descartarLeituraDoC2x({ destroy: () => eventos.push("destroy"), release: () => eventos.push("release") } as never);
    expect(eventos).toEqual(["destroy"]);
    descartarLeituraDoC2x({
      destroy: () => {
        throw new Error("morta");
      },
      release: () => eventos.push("release"),
    } as never);
    expect(eventos).toEqual(["destroy", "release"]);
    expect(() => descartarLeituraDoC2x(null)).not.toThrow();
  });
});

describe("a forma dos envios", () => {
  it("lê o envio com a data em -03:00, o uuid nulo contado e a ordem", async () => {
    const conexao = {
      query: async () => [
        [
          {
            ar_id: 500,
            criado_em_brasilia: "2026-09-23 10:00:00",
            cs_id: 3805,
            enterprise_c2x_id: 21,
            enterprise_code: "VAL",
            ordenada: 1,
            status_c2x: 3,
            tipo_c2x: "default",
            unidade_c2x_id: 9001,
            uuid_doc: null,
          },
        ],
        [],
      ],
    };
    const [envio] = await lerEnviosDoC2x(conexao as never);
    expect(envio).toEqual({
      arId: 500,
      contractType: "default",
      csId: 3805,
      criadoEm: "2026-09-23T10:00:00-03:00",
      enterpriseCode: "VAL",
      enterpriseId: "21",
      ordenada: true,
      statusC2x: 3,
      unidadeC2xId: 9001,
      uuidDoc: null,
    });
  });

  it("o documento do comprador sai só com dígitos", async () => {
    const conexao = { query: async () => [[{ ar_id: 7, documento: "111.222.333-44" }], []] };
    const mapa = await documentosDosCompradores(conexao as never, [7]);
    expect(mapa.get(7)).toBe("11122233344");
  });

  it("o IN do rol vai em lotes de 500", async () => {
    const lotes: number[] = [];
    const conexao = {
      query: async (_: unknown, params: unknown[]) => {
        lotes.push((params[0] as number[]).length);
        return [[], []];
      },
    };
    await lerPessoasDosEnvios(conexao as never, Array.from({ length: 1200 }, (_, i) => i + 1));
    expect(lotes).toEqual([500, 500, 200]);
  });
});
