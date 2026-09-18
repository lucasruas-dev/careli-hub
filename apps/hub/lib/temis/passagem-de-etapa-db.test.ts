import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registrarPassagemDeEtapa } from "./passagem-de-etapa-db";

// A ORIGEM NOVA (`conclusao`) ANTES DA MIGRATION DELA.
//
// A conclusão do cancelamento na Têmis (18/09/2026) grava a passagem do card com `origem =
// 'conclusao'`, e o check da 0153 não conhece a palavra até a 0177 ser aplicada (medido em produção
// no mesmo dia: o check tem as sete origens antigas). Sem a troca, a passagem que a auditoria procura
// sumiria calada, porque esta função não lança. Com ela, a linha entra com a origem antiga mais
// próxima (`atividade`), uma tentativa só, e só quando o banco recusou a ORIGEM.

const RECUSA_DA_ORIGEM = {
  code: "23514",
  message: 'new row for relation "temis_trabalho_etapas" violates check constraint "temis_trabalho_etapas_origem_valida"',
};

function bancoQueResponde(respostas: Array<{ code: string; message: string } | null>) {
  const inseridas: Array<Record<string, unknown>> = [];
  const from = () => ({
    insert: async (linha: Record<string, unknown>) => {
      inseridas.push(linha);
      return { error: respostas.shift() ?? null };
    },
  });
  return { inseridas, sb: { from } as unknown as SupabaseClient };
}

const passagem = {
  de: "analise",
  origem: "conclusao" as const,
  para: "faturado",
  propostaId: "venda-21",
  quem: "u-1",
  quemNome: "Nivea",
  trabalhoId: "card-1",
  trabalhoTipo: "cancelamento",
};

afterEach(() => vi.restoreAllMocks());

describe("a origem `conclusao` sem a 0177", () => {
  it("o check recusa a palavra: a mesma passagem entra como `atividade`, uma vez", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { inseridas, sb } = bancoQueResponde([RECUSA_DA_ORIGEM, null]);

    await registrarPassagemDeEtapa(sb, passagem);

    expect(inseridas.map((l) => l.origem)).toEqual(["conclusao", "atividade"]);
    expect(inseridas[1]).toMatchObject({ de: "analise", para: "faturado", quem: "u-1", trabalho_id: "card-1" });
    expect(erro).not.toHaveBeenCalled();
  });

  it("com a 0177 aplicada, entra na primeira, com a palavra certa", async () => {
    const { inseridas, sb } = bancoQueResponde([null]);
    await registrarPassagemDeEtapa(sb, passagem);
    expect(inseridas.map((l) => l.origem)).toEqual(["conclusao"]);
  });

  it("outro erro não é a origem: não tenta de novo, e vai para o log", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { inseridas, sb } = bancoQueResponde([{ code: "08006", message: "conexão perdida" }]);
    await registrarPassagemDeEtapa(sb, passagem);
    expect(inseridas).toHaveLength(1);
    expect(erro).toHaveBeenCalled();
  });

  it("origem antiga recusada não ganha substituta (não há o que trocar)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { inseridas, sb } = bancoQueResponde([RECUSA_DA_ORIGEM]);
    await registrarPassagemDeEtapa(sb, { ...passagem, origem: "indeferimento", para: "indeferido" });
    expect(inseridas).toHaveLength(1);
  });
});
