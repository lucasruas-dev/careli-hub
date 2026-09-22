import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { empresasDoEmpreendimento } from "./quadro-db";

// QUEM O ENVELOPE CONVIDA PARA O PAPEL DA COORDENADORA.
//
// Lucas, 22/09/2026, depois de ver que o contrato imprime "(Assinado eletronicamente)
// [nome_fantasia_coordenadora_vendas] COORDENADORA DE VENDAS" e que ninguém era convidado para
// aquela linha: *"a gurgel assina sim"*.
//
// ⚠️ O QUE ESTE ARQUIVO TRAVA: o nome IMPRESSO e o CONVIDADO saem da mesma coluna. Até esta data o
// texto usava `coordenadora_entity_id` e o envelope usava `coordenador_entity_id` — medido em
// produção no dia: 16 linhas com a primeira, todas a Gurgel; 24 com a segunda, em 7 empresas
// diferentes; linhas em que as duas coincidiam: ZERO.

type Linha = Record<string, unknown>;

function cliente(linha: Linha | null): SupabaseClient {
  const consulta = {
    eq: () => consulta,
    maybeSingle: async () => ({ data: linha, error: null }),
    select: () => consulta,
  };
  return { from: () => consulta } as unknown as SupabaseClient;
}

describe("empresasDoEmpreendimento", () => {
  it("⚠️ com as duas colunas preenchidas, quem assina é a COORDENADORA do texto", async () => {
    const r = await empresasDoEmpreendimento(
      cliente({
        coordenador_entity_id: "huber",
        coordenadora_entity_id: "gurgel",
        vendedor_entity_id: "lino-e-cecilio",
      }),
      "36",
    );

    expect(r.coordenador).toBe("gurgel");
    expect(r.vendedora).toBe("lino-e-cecilio");
  });

  // ⚠️ A QUEDA EXISTE PARA O PRODUTO QUE AINDA NÃO TEM A COLUNA NOVA (o ACP e o LOS, medidos em
  // 22/09/2026): sem ela, esses contratos passariam a sair sem ninguém no papel da coordenação.
  it("sem a coordenadora apontada, vale o coordenador do empreendimento", async () => {
    const r = await empresasDoEmpreendimento(
      cliente({
        coordenador_entity_id: "matheus-guedes",
        coordenadora_entity_id: null,
        vendedor_entity_id: "wlm",
      }),
      "38",
    );

    expect(r.coordenador).toBe("matheus-guedes");
  });

  it("empreendimento sem ajuste nenhum não inventa empresa", async () => {
    const r = await empresasDoEmpreendimento(cliente(null), "99");
    expect(r).toEqual({ coordenador: null, vendedora: null });
  });
});
