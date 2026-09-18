import type { SupabaseClient } from "@supabase/supabase-js";

import { ETAPAS_DO_FLUXO } from "./fluxo-de-venda";
import type { SituacaoDasUnidades } from "./situacao-da-unidade";

// A TRAVA DO LOTE — um lote, um dono.
//
// Lucas (18/09/2026): *"isso é extremamente critico no nosso negocio, eu não posso vender dois
// lotes para pessoas diferentes, eu tomo processo por conta disso. revisa bem revisado e nunca
// permita que isso aconteça"* · *"toda reserva, proposta deve ser criada no hercules"*.
//
// ⚠️ O ÍNDICE DO BANCO NÃO BASTA SOZINHO. `hercules_reservas_uma_viva_por_unidade` (0125) impede
// duas reservas vivas na MESMA LINHA. Mas o mesmo lote tem mais de uma linha: a do pai e a da gleba
// (VLO0305 e VOC0305), às vezes duas glebas (VOC1206 e VOR1206). Duas reservas em linhas diferentes
// do mesmo terreno passam pelo índice. E a proposta importada do legado não tem reserva nenhuma: o
// índice nem a vê.
//
// ⚠️ POR ISSO QUEM GRAVA CONFERE O TERRENO DUAS VEZES:
//   1. ANTES de gravar, pela situação única (`situacao-da-unidade.ts`): lote que não está livre nem
//      chega ao INSERT, com a frase certa para quem clicou.
//   2. DEPOIS de gravar, por esta função: existe OUTRO dono vivo em qualquer linha do terreno? Se
//      existe, quem acabou de gravar desfaz a própria reserva e recusa.
//   A segunda conferência fecha a corrida: se dois gravam ao mesmo tempo em linhas diferentes, cada
//   um enxerga o outro depois do próprio INSERT, e no pior caso os DOIS desistem. Não existe ordem
//   de acontecimentos em que os dois fiquem de pé — e é esse o erro que dá processo.
//
// ⚠️ "DONO" É QUALQUER UM DESTES, EM QUALQUER LINHA DO TERRENO:
//   • reserva do Hércules viva (`ativa` ou `proposta`), inclusive a do salão (origem `salao`);
//   • proposta viva (`hercules_propostas` em etapa do fluxo), importada ou nativa, que NÃO seja
//     filha da reserva de quem está gravando;
//   • reserva antiga do evento (`prometeu_reservas` `reservada`) que ainda não tem reserva do Hércules
//     ligada a ela. Desde 18/09/2026 o tótem grava no Hércules; as antigas continuam valendo até
//     alguém cancelá-las, pelo lado seguro.

export type DonoDoLote = {
  /** O que a tela pode dizer: "reserva do coordenador", "proposta em contrato" etc. */
  descricao: string;
  /** Id da linha que prende o lote (reserva, proposta ou reserva antiga do evento). */
  id: string;
  tipo: "proposta" | "reserva" | "reserva_antiga_do_evento";
};

export type QuemEstaGravando = {
  /**
   * A linha do cupom do salão (`prometeu_reservas`) que está originando esta reserva. O tótem grava
   * o cupom e, em seguida, a reserva do Hércules ligada a ele: sem isto, a trava contaria o próprio
   * cupom como outro dono e recusaria toda reserva feita no salão.
   */
  reservaDoEventoId?: null | string;
  /** A reserva do Hércules que o chamador acabou de gravar (ou que dá origem à proposta). */
  reservaId?: null | string;
};

const ROTULO_DA_ETAPA: Record<string, string> = {
  assinatura: "proposta em assinatura",
  contrato: "proposta em contrato",
  faturado: "venda faturada",
  proposta: "proposta",
  reservado: "reserva",
};

/**
 * Os OUTROS donos vivos do terreno de uma linha.
 *
 * Recebe a situação já lida (`lerSituacaoDasUnidades`) para não reler o empreendimento: quem grava
 * já a leu para a primeira conferência. As consultas daqui são SEMPRE frescas (depois do INSERT), e
 * é isso que a segunda conferência precisa.
 *
 * ⚠️ `null` = NÃO FOI POSSÍVEL SABER (linha fora da leitura, erro de banco). Quem chama trata como
 * conflito: sem saber quem é dono, não se vende.
 */
export async function outrosDonosDoLote(
  client: SupabaseClient,
  situacoes: SituacaoDasUnidades,
  linhaId: string,
  quem: QuemEstaGravando,
): Promise<DonoDoLote[] | null> {
  const terreno = situacoes.terreno(linhaId);
  if (!terreno || terreno.linhas.length === 0) return null;

  const minha = String(quem.reservaId ?? "").trim();

  const [reservas, propostas] = await Promise.all([
    client
      .from("hercules_reservas")
      .select("id,origem,situacao,prometeu_reserva_id")
      .eq("workspace_id", "careli")
      .in("unidade_id", terreno.linhas)
      .in("situacao", ["ativa", "proposta"]),
    client
      .from("hercules_propostas")
      .select("id,etapa,reserva_id")
      .eq("workspace_id", "careli")
      .in("unidade_id", terreno.linhas)
      .in("etapa", [...ETAPAS_DO_FLUXO]),
  ]);
  if (reservas.error || propostas.error) return null;

  const donos: DonoDoLote[] = [];

  const reservasVivas = (reservas.data ?? []) as Array<{
    id: string;
    origem: null | string;
    prometeu_reserva_id: null | string;
    situacao: string;
  }>;
  for (const r of reservasVivas) {
    if (r.id === minha) continue;
    donos.push({
      descricao: r.origem === "salao" ? "reserva feita no salão do lançamento" : "reserva",
      id: r.id,
      tipo: "reserva",
    });
  }

  for (const p of (propostas.data ?? []) as Array<{ etapa: string; id: string; reserva_id: null | string }>) {
    // A proposta que nasceu da MINHA reserva é a mesma venda, não outro dono.
    if (minha && p.reserva_id === minha) continue;
    donos.push({ descricao: ROTULO_DA_ETAPA[p.etapa] ?? "proposta", id: p.id, tipo: "proposta" });
  }

  // As reservas antigas do evento: só contam as que NENHUMA reserva do Hércules absorveu (viva ou não).
  // Cupom ligado a reserva do Hércules segue a reserva do Hércules: cancelada lá, o lote fica livre.
  const ligados = await client
    .from("hercules_reservas")
    .select("prometeu_reserva_id")
    .eq("workspace_id", "careli")
    .not("prometeu_reserva_id", "is", null);
  if (ligados.error) return null;
  const jaNoHercules = new Set(
    ((ligados.data ?? []) as Array<{ prometeu_reserva_id: null | string }>)
      .map((r) => String(r.prometeu_reserva_id ?? ""))
      .filter(Boolean),
  );
  const filtros: string[] = [];
  if (terreno.origens.length > 0) filtros.push(`unidade_c2x_id.in.(${terreno.origens.join(",")})`);
  if (terreno.codigos.length > 0) {
    filtros.push(`codigo.in.(${terreno.codigos.map((c) => `"${c.replace(/"/g, "")}"`).join(",")})`);
  }
  if (filtros.length > 0) {
    const doEvento = await client
      .from("prometeu_reservas")
      .select("id")
      .eq("situacao", "reservada")
      .or(filtros.join(","));
    if (doEvento.error) return null;
    const meuCupom = String(quem.reservaDoEventoId ?? "").trim();
    for (const r of (doEvento.data ?? []) as Array<{ id: string }>) {
      if (jaNoHercules.has(r.id) || r.id === meuCupom) continue;
      donos.push({ descricao: "reserva antiga do salão do lançamento", id: r.id, tipo: "reserva_antiga_do_evento" });
    }
  }

  return donos;
}

/** A frase para quem clicou, a partir dos donos encontrados. */
export function fraseDoConflito(donos: DonoDoLote[] | null): string {
  if (donos === null) {
    return "Não foi possível confirmar que o lote está livre. Nada foi gravado; tente de novo em instantes.";
  }
  const primeiro = donos[0];
  return primeiro
    ? `Este lote já tem dono: ${primeiro.descricao}. Nada foi gravado.`
    : "Este lote já tem dono. Nada foi gravado.";
}
