import type { SupabaseClient } from "@supabase/supabase-js";

import { ESTAGIOS_ENCERRADOS, type TipoDeTrabalho } from "./trabalhos";

// OS CARDS AINDA ABERTOS DE UMA VENDA — a pergunta que três lugares fazem.
//
// ⚠️ UMA RÉGUA SÓ PARA "ABERTO". O pedido de cancelamento procura o card que já está na fila antes
// de abrir outro; a conclusão do cancelamento procura o card de CONTRATO que ainda anda para
// indeferi-lo; o indeferimento do pedido confere se não sobrou outro pedido aberto antes de limpar o
// carimbo da venda. Os três perguntavam de jeitos diferentes, e um deles perguntava por um estágio
// (`finalizado`) que não existe desde a 0150. Aberto = fora de `ESTAGIOS_ENCERRADOS`.

export type CardAberto = { estagio: string; id: string; tipo: string };

/**
 * Os cards da proposta, dos tipos pedidos, que ainda não acabaram.
 *
 * ⚠️ LEITURA QUE FALHA DEVOLVE `ok: false`, E NUNCA LISTA VAZIA. "Não há card aberto" autoriza
 * abrir um pedido novo ou limpar uma marca; dizer isso sem ter conseguido perguntar é abrir o
 * segundo pedido do mesmo contrato.
 */
export async function cardsAbertosDaProposta(
  sb: SupabaseClient,
  filtro: { exceto?: null | string; propostaId: string; tipos: readonly TipoDeTrabalho[] },
): Promise<{ cards: CardAberto[]; ok: true } | { ok: false }> {
  try {
    const { data, error } = await sb
      .from("temis_trabalhos")
      .select("id, tipo, estagio")
      .eq("workspace_id", "careli")
      .eq("proposta_id", filtro.propostaId)
      .in("tipo", [...filtro.tipos])
      .not("estagio", "in", `(${ESTAGIOS_ENCERRADOS.join(",")})`)
      .order("criado_em", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[temis][cards-abertos] falha ao ler os cards da proposta", error.message);
      return { ok: false };
    }

    const exceto = String(filtro.exceto ?? "").trim();
    const cards = ((data ?? []) as CardAberto[]).filter((c) => !exceto || c.id !== exceto);
    return { cards, ok: true };
  } catch (erro) {
    console.error("[temis][cards-abertos] falha ao ler os cards da proposta", erro);
    return { ok: false };
  }
}
