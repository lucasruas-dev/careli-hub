import type { SupabaseClient } from "@supabase/supabase-js";

import { lerSituacaoDasUnidades } from "./situacao-da-unidade";
import { outrosDonosDoLote } from "./trava-do-lote";

// CANCELAR UMA RESERVA DO HÉRCULES QUE VEIO DE FORA DA TELA VENDA.
//
// Lucas (18/09/2026): *"toda reserva, proposta deve ser criada no hercules"* · *"cadastro apolo,
// interações comerciais hercules"*. Desde então o tótem do salão reserva no Hércules
// (`criarReservaNoHercules`), e quem cancela o cupom no Prometeu precisa cancelar a reserva do
// Hércules ligada a ele. Sem isto o cupom caía e o lote seguia preso por uma reserva que ninguém
// mais via no salão; ou, pior, o cupom seguia vivo e o lote era vendido na Venda por baixo dele.
//
// ⚠️ SÓ A RESERVA `ativa` SE CANCELA AQUI. A que já virou proposta (`proposta`) é da tela Venda: lá
// o cancelamento é o da proposta, com as condições comerciais gravadas. É a mesma régua da rota da
// Venda (PATCH de /api/incorporador/venda/reserva). O `.eq("situacao", "ativa")` no UPDATE repete a
// condição de propósito: dois cancelamentos ao mesmo tempo não carimbam duas vezes.
//
// ⚠️ O CADASTRO SÓ VOLTA A `disponivel` SE A TRAVA DISSER QUE NÃO HÁ OUTRO DONO. A rota da Venda
// devolve o cadastro sem perguntar; aqui não. O terreno pode ter outro dono (a proposta importada, a
// reserva na linha do pai, a reserva antiga do salão) e o cadastro dizendo "disponível" seria mais
// uma tela prometendo lote que tem dono. Na dúvida (leitura falhou), o cadastro FICA como está:
// ocupado a mais se corrige com um clique; livre a mais vira processo.
//
// ⚠️ E SÓ SAI DE `reservada`. Se alguém bloqueou a unidade no Apolo enquanto a reserva estava viva,
// o cadastro diz `bloqueada`, e cancelar a reserva não pode desbloquear o lote.

export type PedidoDeCancelamentoNoHercules = {
  canceladoPor: null | string;
  canceladoPorNome: null | string;
  motivo: string;
  /**
   * A linha do cupom do salão ligada a esta reserva. Entra na trava como "minha": sem isto, um
   * cupom ainda vivo (cancelado depois) contaria como outro dono e o cadastro nunca voltaria.
   */
  reservaDoEventoId?: null | string;
  reservaId: string;
};

export type ResultadoDoCancelamentoNoHercules =
  | {
      /** `false` = a reserva não estava `ativa` (já cancelada, ou virou proposta). Nada mudou. */
      cancelada: boolean;
      /** O cadastro da unidade voltou a `disponivel`? */
      liberada: boolean;
      ok: true;
      unidadeId: null | string;
    }
  | { motivo: string; ok: false };

export async function cancelarReservaNoHercules(
  client: SupabaseClient,
  pedido: PedidoDeCancelamentoNoHercules,
): Promise<ResultadoDoCancelamentoNoHercules> {
  const reservaId = String(pedido.reservaId ?? "").trim();
  if (!reservaId) return { motivo: "Informe a reserva do Hércules a cancelar.", ok: false };

  const agora = new Date().toISOString();
  const { data, error } = await client
    .from("hercules_reservas")
    .update({
      atualizado_em: agora,
      cancelada_em: agora,
      cancelada_motivo: pedido.motivo.trim() || "Cancelada no salão do lançamento.",
      cancelada_por: pedido.canceladoPor ?? null,
      cancelada_por_nome: pedido.canceladoPorNome ?? null,
      situacao: "cancelada",
    })
    .eq("id", reservaId)
    .eq("situacao", "ativa")
    .select("id, unidade_id");

  if (error) {
    console.error("[hercules][cancelar-reserva] update falhou", { erro: error.message, reservaId });
    return { motivo: "Não foi possível cancelar a reserva no Hércules agora.", ok: false };
  }

  const linha = ((data ?? []) as Array<{ id: string; unidade_id: null | string }>)[0];
  if (!linha) return { cancelada: false, liberada: false, ok: true, unidadeId: null };

  const unidadeId = linha.unidade_id ? String(linha.unidade_id) : null;
  const liberada = unidadeId
    ? await devolverCadastroSeNaoHaOutroDono(client, unidadeId, {
        reservaDoEventoId: pedido.reservaDoEventoId ?? null,
        reservaId,
      })
    : false;

  return { cancelada: true, liberada, ok: true, unidadeId };
}

/**
 * Devolve o cadastro da linha a `disponivel` quando a trava confirma que o terreno ficou sem dono.
 *
 * `true` = devolveu. `false` = não devolveu: outro dono, leitura que falhou, ou cadastro que não
 * estava em `reservada` (bloqueada no Apolo, vendida por sync). Nunca lança: o cancelamento da
 * reserva já aconteceu, e o cadastro preso a mais é o erro barato.
 */
export async function devolverCadastroSeNaoHaOutroDono(
  client: SupabaseClient,
  unidadeId: string,
  quem: { reservaDoEventoId?: null | string; reservaId?: null | string },
): Promise<boolean> {
  try {
    const { data: unidade, error: erroDaUnidade } = await client
      .from("hercules_unidades")
      .select("id, enterprise_id")
      .eq("id", unidadeId)
      .maybeSingle();
    if (erroDaUnidade || !unidade) return false;

    const enterpriseId = String((unidade as { enterprise_id: number | string }).enterprise_id ?? "").trim();
    if (!enterpriseId) return false;

    const situacoes = await lerSituacaoDasUnidades(client, [enterpriseId]);
    const donos = await outrosDonosDoLote(client, situacoes, unidadeId, {
      reservaDoEventoId: quem.reservaDoEventoId ?? null,
      reservaId: quem.reservaId ?? null,
    });
    if (donos === null || donos.length > 0) return false;

    const { data: devolvidas, error } = await client
      .from("hercules_unidades")
      .update({ atualizado_em: new Date().toISOString(), situacao: "disponivel" })
      .eq("id", unidadeId)
      .eq("situacao", "reservada")
      .select("id");
    if (error) {
      console.error("[hercules][cancelar-reserva] cadastro não voltou a disponível", {
        erro: error.message,
        unidadeId,
      });
      return false;
    }
    return ((devolvidas ?? []) as unknown[]).length > 0;
  } catch (erro) {
    console.error("[hercules][cancelar-reserva] conferência do terreno falhou", { erro, unidadeId });
    return false;
  }
}
