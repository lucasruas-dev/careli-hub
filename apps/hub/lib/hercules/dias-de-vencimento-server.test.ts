import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  ehColunaDosDiasAusente,
  lerDiasCadastrados,
  lerDiasDoEmpreendimento,
} from "./dias-de-vencimento-server";

// A LEITURA DOS DIAS NO BANCO, com um cliente de mentira que responde como o PostgREST.
//
// ⚠️ O QUE IMPORTA AQUI É A FALHA. A regra (herança, padrão) tem o teste dela; este arquivo prova que
// a leitura que falha devolve NULO, e não "sem cadastro": quem recebe nulo oferece 10 e 20 sem
// afirmar ao coordenador que o empreendimento não tem dia cadastrado.

type Resposta = { data: unknown; error: null | { code?: string; message: string } };

function cliente(responder: (ids: string[]) => Resposta) {
  const pedidos: { colunas: string; ids: string[]; tabela: string }[] = [];
  const client = {
    from: (tabela: string) => ({
      select: (colunas: string) => ({
        in: async (_coluna: string, ids: string[]) => {
          pedidos.push({ colunas, ids, tabela });
          return responder(ids);
        },
      }),
    }),
  };
  return { client: client as unknown as SupabaseClient, pedidos };
}

const RECORTE = { enterpriseId: "37", paiEnterpriseId: "35" };

describe("lerDiasDoEmpreendimento", () => {
  it("lê o empreendimento E o pai, e aplica a herança", async () => {
    const { client, pedidos } = cliente(() => ({
      data: [{ dias_vencimento: [5, 15], enterprise_id: "35" }],
      error: null,
    }));
    const dias = await lerDiasDoEmpreendimento(client, RECORTE, "teste");
    expect(dias).toEqual({ cadastrado: true, dias: [5, 15], origem: "pai" });
    expect(pedidos).toEqual([
      { colunas: "enterprise_id,dias_vencimento", ids: ["37", "35"], tabela: "apolo_enterprise_settings" },
    ]);
  });

  it("sem linha: sem cadastro, 10 e 20", async () => {
    const { client } = cliente(() => ({ data: [], error: null }));
    expect(await lerDiasDoEmpreendimento(client, RECORTE, "teste")).toEqual({
      cadastrado: false,
      dias: [10, 20],
      origem: null,
    });
  });

  it("⚠️ leitura que falha é NULO, e não 'sem cadastro'", async () => {
    const { client } = cliente(() => ({ data: null, error: { message: "timeout" } }));
    expect(await lerDiasDoEmpreendimento(client, RECORTE, "teste")).toBeNull();
  });

  it("a migration 0210 pendente (coluna ausente) também é nulo, e não derruba ninguém", async () => {
    const { client } = cliente(() => ({
      data: null,
      error: { code: "42703", message: 'column apolo_enterprise_settings.dias_vencimento does not exist' },
    }));
    expect(await lerDiasDoEmpreendimento(client, RECORTE, "teste")).toBeNull();
  });

  it("cliente que lança também é nulo", async () => {
    const client = {
      from: () => {
        throw new Error("sem rede");
      },
    } as unknown as SupabaseClient;
    expect(await lerDiasDoEmpreendimento(client, RECORTE, "teste")).toBeNull();
  });
});

describe("lerDiasCadastrados", () => {
  it("pede em lotes de 100, sem repetir id nem mandar vazio", async () => {
    const { client, pedidos } = cliente(() => ({ data: [], error: null }));
    const ids = Array.from({ length: 150 }, (_, i) => String(i + 1));
    await lerDiasCadastrados(client, [...ids, "1", null, "", undefined]);
    expect(pedidos.map((p) => p.ids.length)).toEqual([100, 50]);
  });

  it("sem id, nem vai ao banco", async () => {
    const { client, pedidos } = cliente(() => ({ data: [], error: null }));
    expect(await lerDiasCadastrados(client, [null, ""])).toEqual({ linhas: [], ok: true });
    expect(pedidos).toHaveLength(0);
  });

  it("diz quando é a coluna que falta", async () => {
    const { client } = cliente(() => ({
      data: null,
      error: { code: "PGRST204", message: "Could not find the 'dias_vencimento' column" },
    }));
    expect(await lerDiasCadastrados(client, ["35"])).toMatchObject({ colunaAusente: true, ok: false });
  });
});

describe("ehColunaDosDiasAusente", () => {
  it("não confunde a recusa do CHECK com migration pendente", () => {
    expect(
      ehColunaDosDiasAusente({
        message:
          'Nao foi possivel salvar: new row violates check constraint "apolo_enterprise_settings_dias_vencimento_check"',
      }),
    ).toBe(false);
    expect(
      ehColunaDosDiasAusente({
        message: 'Nao foi possivel salvar: column "dias_vencimento" of relation "x" does not exist',
      }),
    ).toBe(true);
  });
});
