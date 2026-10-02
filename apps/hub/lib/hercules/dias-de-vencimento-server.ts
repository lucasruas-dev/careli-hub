// A LEITURA DOS DIAS DE VENCIMENTO NO BANCO — a regra está em `dias-de-vencimento.ts`; aqui só o
// `select` e o que fazer quando ele falha.
//
// ⚠️ QUEM CHAMA DECIDE O QUE A FALHA SIGNIFICA, e por isso a leitura devolve `ok: false` em vez de
// lista vazia. São dois tipos de leitor:
//   - a ABA DO APOLO, onde a falha vira 503: uma tela que não sabe se há cadastro não pode convidar o
//     operador a cadastrar por cima (o mesmo cuidado das premissas de rescisão);
//   - a PROPOSTA, o ESPELHO e o PORTAL, onde a falha cai nos 10 e 20 de sempre SEM o aviso de "não
//     cadastrado": falha técnica não vira afirmação sobre o cadastro, e a venda não para por isso.
//
// ⚠️ A MIGRATION 0210 PODE NÃO ESTAR APLICADA quando este código subir. A coluna ausente responde
// `42703` (Postgres) ou `PGRST204` (schema cache), e é por isso que `colunaAusente` existe: a aba diz
// o que falta em vez de um erro cru, e os outros leitores seguem como antes da frente.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type DiasDeVencimento,
  diasDoEmpreendimento,
  type LinhaDosDias,
} from "@/lib/hercules/dias-de-vencimento";

const TABELA = "apolo_enterprise_settings";
export const COLUNA_DOS_DIAS = "dias_vencimento";

export type LeituraDosDias =
  | { linhas: LinhaDosDias[]; ok: true }
  | { colunaAusente: boolean; erro: string; ok: false };

/** O erro é "a coluna `dias_vencimento` ainda não existe"? */
export function ehColunaDosDiasAusente(erro: null | { code?: string; message?: string }): boolean {
  if (!erro) return false;
  if (erro.code === "42703" || erro.code === "PGRST204") return true;
  return /dias_vencimento/i.test(erro.message ?? "") && /does not exist|could not find/i.test(erro.message ?? "");
}

/**
 * As linhas de configuração dos empreendimentos pedidos, só com os dias.
 *
 * ⚠️ EM LOTES DE 100: o `.in()` vai na URL, e a casa já caiu por isso (24/07/2026). Hoje são um ou
 * dois ids por chamada; o lote é o que impede a surpresa quando alguém pedir todos.
 */
export async function lerDiasCadastrados(
  client: SupabaseClient,
  enterpriseIds: readonly (null | string | undefined)[],
): Promise<LeituraDosDias> {
  const ids = [...new Set(enterpriseIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (ids.length === 0) return { linhas: [], ok: true };

  const linhas: LinhaDosDias[] = [];
  for (let inicio = 0; inicio < ids.length; inicio += 100) {
    const { data, error } = await client
      .from(TABELA)
      .select(`enterprise_id,${COLUNA_DOS_DIAS}`)
      .in("enterprise_id", ids.slice(inicio, inicio + 100));

    if (error) {
      return {
        colunaAusente: ehColunaDosDiasAusente(error),
        erro: error.message ?? "erro desconhecido",
        ok: false,
      };
    }

    for (const linha of (data ?? []) as { dias_vencimento: unknown; enterprise_id: string }[]) {
      linhas.push({
        dias: Array.isArray(linha.dias_vencimento) ? (linha.dias_vencimento as number[]) : null,
        enterpriseId: String(linha.enterprise_id),
      });
    }
  }
  return { linhas, ok: true };
}

/**
 * Os dias que valem para o empreendimento, ou NULO quando a leitura falhou.
 *
 * Nulo não é "sem cadastro": quem recebe nulo oferece os 10 e 20 de sempre e NÃO diz que falta
 * cadastrar, porque não sabe.
 */
export async function lerDiasDoEmpreendimento(
  client: SupabaseClient,
  recorte: { enterpriseId: null | string; paiEnterpriseId: null | string },
  rotulo: string,
): Promise<DiasDeVencimento | null> {
  try {
    const lido = await lerDiasCadastrados(client, [recorte.enterpriseId, recorte.paiEnterpriseId]);
    if (!lido.ok) {
      // Coluna ausente é a pendência conhecida da 0210: aviso, não erro.
      if (lido.colunaAusente) console.info(`[${rotulo}] dias de vencimento: migration 0210 pendente`);
      else console.error(`[${rotulo}] dias de vencimento`, lido.erro);
      return null;
    }
    return diasDoEmpreendimento(recorte, lido.linhas);
  } catch (erro) {
    console.error(`[${rotulo}] dias de vencimento`, erro);
    return null;
  }
}
