import type { SupabaseClient } from "@supabase/supabase-js";

import { lerSituacaoDasUnidades, type SituacaoDasUnidades } from "./situacao-da-unidade";
import { type DonoDoLote, outrosDonosDoLote } from "./trava-do-lote";

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
  /** A situação já lida nesta requisição (o desfazer do tótem). A conferência de dono é fresca. */
  situacoes?: SituacaoDasUnidades;
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
    ? await devolverCadastroSeNaoHaOutroDono(
        client,
        unidadeId,
        { reservaDoEventoId: pedido.reservaDoEventoId ?? null, reservaId },
        pedido.situacoes,
      )
    : false;

  return { cancelada: true, liberada, ok: true, unidadeId };
}

/**
 * Devolve o cadastro da linha a `disponivel` quando a trava confirma que o terreno ficou sem dono.
 *
 * `true` = devolveu. `false` = não devolveu: outro dono, leitura que falhou, ou cadastro que não
 * estava num dos estados aceitos (bloqueada no Apolo, vendida por sync). Nunca lança: o
 * cancelamento da reserva já aconteceu, e o cadastro preso a mais é o erro barato.
 *
 * `aceitos` são os estados de onde o cadastro pode sair. O padrão continua sendo só `reservada`:
 * é o que a reserva e a proposta da tela Venda prendem. A conclusão de um cancelamento na Têmis
 * aceita também `vendida`, porque a venda importada do C2X chega com o cadastro `vendida` pela
 * carga. `bloqueada` NUNCA sai daqui, nem pedida (ver `devolverCadastroDaUnidade`).
 */
export async function devolverCadastroSeNaoHaOutroDono(
  client: SupabaseClient,
  unidadeId: string,
  quem: { reservaDoEventoId?: null | string; reservaId?: null | string },
  jaLida?: SituacaoDasUnidades,
  aceitos: readonly string[] = ["reservada"],
): Promise<boolean> {
  const desfecho = await devolverCadastroDaUnidade(client, unidadeId, quem, { aceitos, jaLida });
  return desfecho.devolvida;
}

/**
 * Por que o cadastro NÃO voltou, para quem precisa contar à pessoa que clicou.
 *
 * • `outro_dono`: a trava achou outro dono vivo no terreno (a descrição é a da trava);
 * • `bloqueada`: o lote foi bloqueado no Apolo, e desbloquear não é consequência de cancelar venda;
 * • `ja_disponivel`: o cadastro já dizia disponível, e não havia o que devolver;
 * • `cadastro`: o cadastro estava num estado que este chamador não devolve;
 * • `leitura_falhou`: sem conseguir ler a unidade ou o terreno, não se afirma que está livre.
 */
export type DevolucaoDoCadastro =
  | { devolvida: true }
  | { devolvida: false; donos: DonoDoLote[]; porque: "outro_dono" }
  | { devolvida: false; porque: "bloqueada" | "ja_disponivel" | "leitura_falhou" }
  | { devolvida: false; porque: "cadastro"; situacao: null | string };

/**
 * A MESMA DEVOLUÇÃO, DIZENDO O PORQUÊ. `devolverCadastroSeNaoHaOutroDono` é esta função sem o
 * motivo: as duas rotas da Venda só precisam do sim ou não, e a conclusão do cancelamento na Têmis
 * precisa contar à tela por que o lote não voltou.
 *
 * ⚠️ A ORDEM É: LER O CADASTRO, CONFERIR O TERRENO, GRAVAR COM A CONDIÇÃO. O estado lido na
 * primeira leitura só serve para o motivo e para poupar a trava quando o cadastro nem é devolvível;
 * quem decide de verdade é a condição do UPDATE (`.in("situacao", aceitos)`), que repete a régua
 * no instante da escrita.
 *
 * ⚠️ `bloqueada` E `disponivel` SAEM DOS ACEITOS MESMO PEDIDOS. Bloqueio é decisão do Apolo sobre o
 * lote, não efeito da venda; e "disponível para disponível" não é devolução.
 */
export async function devolverCadastroDaUnidade(
  client: SupabaseClient,
  unidadeId: string,
  quem: { reservaDoEventoId?: null | string; reservaId?: null | string },
  opcoes: { aceitos?: readonly string[]; jaLida?: SituacaoDasUnidades } = {},
): Promise<DevolucaoDoCadastro> {
  const aceitos = (opcoes.aceitos ?? ["reservada"]).filter(
    (s) => s !== "bloqueada" && s !== "disponivel",
  );
  try {
    const { data: unidade, error: erroDaUnidade } = await client
      .from("hercules_unidades")
      .select("id, enterprise_id, situacao")
      .eq("id", unidadeId)
      .maybeSingle();
    if (erroDaUnidade || !unidade) return { devolvida: false, porque: "leitura_falhou" };

    const linha = unidade as { enterprise_id: number | string; situacao: null | string };
    const situacao = linha.situacao === null || linha.situacao === undefined ? null : String(linha.situacao);
    if (situacao === "bloqueada") return { devolvida: false, porque: "bloqueada" };
    if (situacao === "disponivel") return { devolvida: false, porque: "ja_disponivel" };
    if (situacao === null || !aceitos.includes(situacao)) {
      return { devolvida: false, porque: "cadastro", situacao };
    }

    const enterpriseId = String(linha.enterprise_id ?? "").trim();
    if (!enterpriseId) return { devolvida: false, porque: "leitura_falhou" };

    const jaLida = opcoes.jaLida;
    const situacoes =
      jaLida && jaLida.terreno(unidadeId) ? jaLida : await lerSituacaoDasUnidades(client, [enterpriseId]);
    const donos = await outrosDonosDoLote(client, situacoes, unidadeId, {
      reservaDoEventoId: quem.reservaDoEventoId ?? null,
      reservaId: quem.reservaId ?? null,
    });
    if (donos === null) return { devolvida: false, porque: "leitura_falhou" };
    if (donos.length > 0) return { devolvida: false, donos, porque: "outro_dono" };

    const { data: devolvidas, error } = await client
      .from("hercules_unidades")
      .update({ atualizado_em: new Date().toISOString(), situacao: "disponivel" })
      .eq("id", unidadeId)
      .in("situacao", aceitos)
      .select("id");
    if (error) {
      console.error("[hercules][cancelar-reserva] cadastro não voltou a disponível", {
        erro: error.message,
        unidadeId,
      });
      return { devolvida: false, porque: "leitura_falhou" };
    }
    if (((devolvidas ?? []) as unknown[]).length > 0) return { devolvida: true };
    // Entre a leitura e a escrita o cadastro mudou (bloqueado, vendido por outra tela): quem
    // responde é a condição da escrita, e o motivo é o estado que já não é mais o lido.
    return { devolvida: false, porque: "cadastro", situacao };
  } catch (erro) {
    console.error("[hercules][cancelar-reserva] conferência do terreno falhou", { erro, unidadeId });
    return { devolvida: false, porque: "leitura_falhou" };
  }
}
