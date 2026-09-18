import type { SupabaseClient } from "@supabase/supabase-js";

import {
  acharUnidade,
  estaLivre,
  lerSituacaoDasUnidades,
  rotuloDaSituacao,
  type SituacaoDasUnidades,
} from "./situacao-da-unidade";
import { type DonoDoLote, fraseDoConflito, outrosDonosDoLote } from "./trava-do-lote";

// CRIAR RESERVA — A PORTA ÚNICA.
//
// Lucas (18/09/2026): *"toda reserva, proposta deve ser criada no hercules"* · *"eu não posso vender
// dois lotes para pessoas diferentes, eu tomo processo por conta disso"*.
//
// ⚠️ UMA FUNÇÃO SÓ PARA TODA RESERVA: a do coordenador na tela Venda, a do portal que opera a
// própria venda e a do tótem no salão do lançamento. Cada porta com a sua conferência foi como a
// casa chegou a ter o tótem oferecendo lote pelo status do C2X enquanto a Venda olhava o Panteon.
//
// A ordem é a regra (ver `trava-do-lote.ts`):
//   1. o terreno está LIVRE pela situação única?        não: recusa, nada é gravado;
//   2. existe outro dono vivo no terreno?                 sim: recusa, nada é gravado;
//   3. INSERT (o índice da 0125 segura a mesma linha);
//   4. existe outro dono vivo no terreno AGORA?           sim: cancela a própria reserva e recusa;
//   5. o cadastro da linha passa a `reservada`.
//
// ⚠️ SEM SABER, NÃO VENDE. Toda leitura que falha termina em recusa, nunca em gravação.

export type NovaReservaNoHercules = {
  corretorEntityId?: null | string;
  criadoPor?: null | string;
  criadoPorNome?: null | string;
  /** `hercules_empreendimentos.id` (o pai do cadastro), que `hercules_reservas.empreendimento_id` referencia. */
  empreendimentoId: string;
  /** O id do C2X que `hercules_unidades.enterprise_id` guarda: é por ele que a situação é lida. */
  enterpriseId: string;
  eventoId?: null | string;
  imobiliariaEntityId?: null | string;
  observacao?: null | string;
  /** `coordenador`, `incorporador`, `salao`... (a CHECK da tabela decide o que vale). */
  origem: string;
  /** A linha do cupom do evento que originou esta reserva, quando veio do tótem. */
  prometeuReservaId?: null | string;
  proponentes: unknown[];
  /** A linha VIVA do Panteon (`hercules_unidades.id`). */
  unidadeId: string;
  validadeEm?: null | string;
};

export type ResultadoDaReserva =
  | { ok: true; reserva: { id: string; protocolo_numero: null | number } }
  | { donos?: DonoDoLote[] | null; motivo: string; ok: false; status: 409 | 500 };

export async function criarReservaNoHercules(
  client: SupabaseClient,
  nova: NovaReservaNoHercules,
  opcoes?: {
    /**
     * Quando o INSERT é recusado pela CHECK de origem (banco sem a migration que aceita a origem
     * nova), a origem para tentar de novo. É a rede da rota da Venda para a 0167.
     */
    origemSeRecusada?: (erro: { code?: string; message?: string }) => null | string;
    /**
     * A situação já lida por quem chama, NESTA requisição (o tótem lê uma vez para o cupom inteiro).
     * Serve ao passo 1 e ao mapa do terreno; as duas conferências de dono (passos 2 e 4) continuam
     * indo ao banco na hora, e são elas que seguram a venda dupla.
     */
    situacoes?: SituacaoDasUnidades;
  },
): Promise<ResultadoDaReserva> {
  // ── 1. A situação única do terreno ──
  let situacoes: SituacaoDasUnidades;
  try {
    situacoes = opcoes?.situacoes ?? (await lerSituacaoDasUnidades(client, [nova.enterpriseId]));
  } catch (erro) {
    console.error("[hercules][reserva] leitura da situação falhou", erro);
    return { motivo: fraseDoConflito(null), ok: false, status: 500 };
  }

  const unidade = acharUnidade(situacoes, { linhaId: nova.unidadeId });
  if (!unidade || unidade.id !== nova.unidadeId) {
    // Reserva sempre na linha VIVA. Linha antiga (do pai) ou fora do cadastro não se reserva.
    return {
      motivo: "Esta linha não é a unidade que se vende. Reserve pela unidade da gleba.",
      ok: false,
      status: 409,
    };
  }
  if (!estaLivre(unidade.situacao)) {
    return {
      motivo: `Esta unidade está ${rotuloDaSituacao(unidade.situacao)}. Só unidade livre pode ser reservada.`,
      ok: false,
      status: 409,
    };
  }

  // ── 2. Outro dono no terreno, antes de gravar ──
  const antes = await outrosDonosDoLote(client, situacoes, nova.unidadeId, {
    reservaDoEventoId: nova.prometeuReservaId,
  });
  if (antes === null || antes.length > 0) {
    return { donos: antes, motivo: fraseDoConflito(antes), ok: false, status: antes === null ? 500 : 409 };
  }

  // ── 3. O INSERT ──
  const linha = (origem: string) => ({
    corretor_entity_id: nova.corretorEntityId || null,
    criado_por: nova.criadoPor ?? null,
    criado_por_nome: nova.criadoPorNome ?? null,
    empreendimento_id: nova.empreendimentoId,
    evento_id: nova.eventoId ?? null,
    imobiliaria_entity_id: nova.imobiliariaEntityId || null,
    observacao: nova.observacao?.trim() || null,
    origem,
    prometeu_reserva_id: nova.prometeuReservaId ?? null,
    proponentes: nova.proponentes,
    situacao: "ativa",
    unidade_id: nova.unidadeId,
    validade_em: nova.validadeEm ?? null,
    workspace_id: "careli",
  });
  const inserir = (origem: string) =>
    client.from("hercules_reservas").insert(linha(origem)).select("id, protocolo_numero").maybeSingle();

  let { data: criada, error } = await inserir(nova.origem);
  const outraOrigem = error ? opcoes?.origemSeRecusada?.(error) : null;
  if (error && outraOrigem) {
    ({ data: criada, error } = await inserir(outraOrigem));
  }

  if (error) {
    // 23505 = o índice da 0125: alguém reservou esta mesma linha primeiro.
    if (error.code === "23505") {
      return { motivo: "Esta unidade acabou de ser reservada por outra pessoa.", ok: false, status: 409 };
    }
    console.error("[hercules][reserva] insert falhou", error.message);
    return { motivo: "Não foi possível gravar a reserva agora.", ok: false, status: 500 };
  }

  const reserva = criada as null | { id: string; protocolo_numero: null | number };
  if (!reserva?.id) {
    return { motivo: "Não foi possível gravar a reserva agora.", ok: false, status: 500 };
  }

  // ── 4. A segunda conferência: alguém gravou em outra linha do terreno ao mesmo tempo? ──
  const depois = await outrosDonosDoLote(client, situacoes, nova.unidadeId, {
    reservaDoEventoId: nova.prometeuReservaId,
    reservaId: reserva.id,
  });
  if (depois === null || depois.length > 0) {
    const agora = new Date().toISOString();
    const { error: erroAoDesfazer } = await client
      .from("hercules_reservas")
      .update({
        atualizado_em: agora,
        cancelada_em: agora,
        cancelada_motivo: "Conflito: o lote ganhou outro dono no mesmo instante. Desfeita pelo sistema.",
        cancelada_por_nome: "Sistema",
        situacao: "cancelada",
      })
      .eq("id", reserva.id);
    if (erroAoDesfazer) {
      // ⚠️ É o único caminho em que a trava depende de uma segunda escrita. Grita no log com os ids:
      // se isto acontecer, alguém precisa olhar o lote na hora.
      console.error("[hercules][reserva] CONFLITO NÃO DESFEITO", {
        erro: erroAoDesfazer.message,
        reserva: reserva.id,
        unidade: nova.unidadeId,
      });
    }
    return { donos: depois, motivo: fraseDoConflito(depois), ok: false, status: 409 };
  }

  // ── 5. O cadastro acompanha: é o que a carga e as telas antigas ainda leem ──
  await client
    .from("hercules_unidades")
    .update({ atualizado_em: new Date().toISOString(), situacao: "reservada" })
    .eq("id", nova.unidadeId)
    .eq("situacao", "disponivel");

  return { ok: true, reserva };
}
