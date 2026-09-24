import type { SupabaseClient } from "@supabase/supabase-js";

import { VENDA_DESFEITA } from "./acao-de-cancelamento";
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
 * • `leitura_falhou`: sem conseguir ler a unidade ou o terreno, não se afirma que está livre;
 * • `irma_com_dono`: o cadastro desta linha voltou (ou já dizia disponível), mas a irmã de outra
 *   gleba do mesmo chão tem cadastro `reservada` ou `vendida`, e a régua segura o lote. Só
 *   `soltarLoteDaVendaDesfeita` devolve este, depois da prova pela régua;
 * • `regua_ocupada`: a régua ainda mostra o lote ocupado por outra razão que não a irmã (um dono que
 *   chegou entre a devolução e a releitura). Também só a prova pela régua devolve este.
 */
export type DevolucaoDoCadastro =
  | { devolvida: true }
  | { devolvida: false; donos: DonoDoLote[]; porque: "outro_dono" }
  | { devolvida: false; irma: string; porque: "irma_com_dono" }
  | { devolvida: false; porque: "bloqueada" | "ja_disponivel" | "leitura_falhou" }
  | { devolvida: false; porque: "cadastro"; situacao: null | string }
  | { devolvida: false; porque: "regua_ocupada"; situacao: string };

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
    const jaDisponivel = situacao === "disponivel";
    if (!jaDisponivel && (situacao === null || !aceitos.includes(situacao))) {
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
    // ⚠️ "JÁ DISPONÍVEL" SÓ DEPOIS DA TRAVA (revisão de 18/09/2026). O cadastro dizer disponível não
    // prova que o lote está livre: outro dono no terreno (a linha do pai, a gleba irmã) deixa o lote
    // ocupado na régua, e contar isso como "voltou" faria a tela prometer um lote que a porta recusa.
    if (jaDisponivel) return { devolvida: false, porque: "ja_disponivel" };

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

// ── A VENDA DESFEITA SOLTA O LOTE ─────────────────────────────────────────────────
//
// Lucas, 24/09/2026: *"lembrando que quando tem cancelamento a unidade tem que ficar disponivel, tem
// que ter esse reflexo"*. E a regra de ouro, Lucas 18/09/2026: *"eu não posso vender dois lotes para
// pessoas diferentes"*.
//
// ⚠️ A REGRA DE SOLTURA CONTINUA SENDO UMA SÓ: `devolverCadastroDaUnidade` com a trava
// `outrosDonosDoLote`. Esta função é a sucessora FINA para os caminhos que desfazem VENDA (o motor da
// Têmis e o Cancelar proposta do Hércules): ela junta o que os dois faziam à mão (a reserva ligada
// cai antes, e o erro PARA) e acrescenta duas coisas que nenhum dos dois fazia:
//   1. a reserva esquecida em `proposta` no terreno cujas propostas (por `reserva_id`) estão TODAS
//      mortas e incluem esta venda. É a armadilha registrada: reserva em `proposta` que perdeu a
//      proposta continua prendendo o lote na régua e na trava. Medido em 24/09/2026: 0 reservas nesse
//      estado em produção.
//      ⚠️ E O QUE ELE ALCANÇA É SÓ ISTO (revisão de 24/09/2026): o elo é o `reserva_id` da PROPOSTA
//      NO BANCO, então a única candidata possível é a reserva que a LINHA DA VENDA aponta agora. O
//      passo 2 serve quando ela não é a que o chamador trouxe: `reserva_id` vazio ou velho na mão de
//      quem chamou. Coincidindo as duas, o passo 1 já a derrubou e ela nem entra aqui. Reserva em
//      OUTRA linha do mesmo chão, e reserva sem proposta ligada nenhuma, este passo NÃO pega — não há
//      como provar que são desta venda, e elas seguram o lote de propósito (`soltar-lote-da-venda-
//      desfeita.test.ts`). Reserva de outra pessoa nunca é tocada: basta UMA proposta ligada viva, ou
//      nenhuma desta venda, e ela fica;
//   2. a PROVA PELA RÉGUA: depois de devolver, relê `lerSituacaoDasUnidades` e, se o lote ainda não
//      sai `disponivel` (a irmã de outra gleba com cadastro `reservada` ou `vendida`,
//      situacao-da-unidade.ts), o desfecho diz qual irmã em vez de "voltou". A irmã NÃO é soltada:
//      decisão pendente do Lucas.
//
// ⚠️ A ORDEM É A DA CASA: reserva ligada, reservas esquecidas, cadastro por último. Soltar por último
// é o que garante que nenhuma falha no meio deixe lote livre com dono.

/** A venda que caiu, com o que a soltura precisa dela. */
export type VendaQueCaiu = { id: string; reserva_id: null | string; unidade_id: null | string };

export type SolturaDoLote =
  | { ok: false; porque: "reserva_nao_caiu" }
  | {
      desfecho: DevolucaoDoCadastro;
      ok: true;
      /** As reservas que caíram nesta chamada (a ligada e as esquecidas). */
      reservasCaidas: string[];
    };

export async function soltarLoteDaVendaDesfeita(
  client: SupabaseClient,
  pedido: {
    /** De onde o cadastro pode sair (`reservada`, e `vendida` fora da retomada do distrato). */
    aceitos: readonly string[];
    agora?: string;
    /** O terreno já lido nesta requisição (o motor lê uma vez só). A trava continua fresca. */
    jaLida?: SituacaoDasUnidades;
    /**
     * O chamador já derrubou a reserva ligada, com o erro lido (o motor faz isso no passo 2, antes de
     * mexer nos cards). Aqui ela não é gravada de novo.
     */
    reservaLigadaJaCaiu?: boolean;
    venda: VendaQueCaiu;
  },
): Promise<SolturaDoLote> {
  const agora = pedido.agora ?? new Date().toISOString();
  const { venda } = pedido;
  const reservasCaidas: string[] = [];

  // ── 1. A RESERVA LIGADA CAI ANTES, E O ERRO PARA ──────────────────────────
  //
  // ⚠️ SÓ A SITUAÇÃO, SEM OS CAMPOS `cancelada_*`: a reserva não foi cancelada por ninguém, foi
  // CONSUMIDA pela venda e cai com ela (a ficha do lote não conta um ato que ninguém praticou).
  if (venda.reserva_id && !pedido.reservaLigadaJaCaiu) {
    const { data, error } = await client
      .from("hercules_reservas")
      .update({ atualizado_em: agora, situacao: "cancelada" })
      .eq("id", venda.reserva_id)
      .in("situacao", ["ativa", "proposta"])
      .select("id");
    if (error) {
      console.error("[hercules][soltura] a reserva da venda desfeita não caiu; o lote fica preso", {
        erro: error.message,
        reserva: venda.reserva_id,
        venda: venda.id,
      });
      return { ok: false, porque: "reserva_nao_caiu" };
    }
    if (((data ?? []) as unknown[]).length > 0) reservasCaidas.push(venda.reserva_id);
  }

  const unidadeId = String(venda.unidade_id ?? "").trim();
  if (!unidadeId) {
    return { desfecho: { devolvida: false, porque: "leitura_falhou" }, ok: true, reservasCaidas };
  }

  // O terreno, lido uma vez: serve às reservas esquecidas e à trava.
  const terreno = await lerTerreno(client, unidadeId, pedido.jaLida);
  if (!terreno) {
    return { desfecho: { devolvida: false, porque: "leitura_falhou" }, ok: true, reservasCaidas };
  }

  // ── 2. AS RESERVAS ESQUECIDAS EM `proposta` DESTA VENDA ───────────────────
  const jaCaidas = new Set(reservasCaidas);
  if (pedido.reservaLigadaJaCaiu && venda.reserva_id) jaCaidas.add(venda.reserva_id);
  reservasCaidas.push(
    ...(await derrubarReservasEsquecidas(client, {
      agora,
      jaCaidas,
      linhas: terreno.situacoes.terreno(unidadeId)?.linhas ?? [],
      vendaId: venda.id,
    })),
  );

  // ── 3. O CADASTRO, PELA TRAVA ─────────────────────────────────────────────
  //
  // ⚠️ SEM `reservaId` COMO "MINHA": a reserva desta venda já caiu acima; se por algum motivo ainda
  // estiver viva, a trava PRECISA contá-la como dona.
  const desfecho = await devolverCadastroDaUnidade(client, unidadeId, {}, {
    aceitos: pedido.aceitos,
    jaLida: terreno.situacoes,
  });

  // ── 4. A PROVA PELA RÉGUA, só quando o desfecho promete lote livre ────────
  if (!desfecho.devolvida && desfecho.porque !== "ja_disponivel") {
    return { desfecho, ok: true, reservasCaidas };
  }
  return {
    desfecho: await provarPelaRegua(client, unidadeId, terreno.enterpriseId, desfecho),
    ok: true,
    reservasCaidas,
  };
}

async function lerTerreno(
  client: SupabaseClient,
  unidadeId: string,
  jaLida?: SituacaoDasUnidades,
): Promise<null | { enterpriseId: string; situacoes: SituacaoDasUnidades }> {
  try {
    const { data, error } = await client
      .from("hercules_unidades")
      .select("id, enterprise_id")
      .eq("id", unidadeId)
      .maybeSingle();
    if (error || !data) return null;
    const enterpriseId = String((data as { enterprise_id: number | string }).enterprise_id ?? "").trim();
    if (!enterpriseId) return null;
    const situacoes =
      jaLida && jaLida.terreno(unidadeId) ? jaLida : await lerSituacaoDasUnidades(client, [enterpriseId]);
    return { enterpriseId, situacoes };
  } catch (erro) {
    console.error("[hercules][soltura] falha ao ler o terreno", { erro, unidadeId });
    return null;
  }
}

/**
 * As reservas em `proposta` do terreno cujas propostas ligadas estão TODAS mortas e incluem esta
 * venda. Devolve as que caíram. Falha de leitura ou de escrita não para nada: a reserva fica viva, a
 * trava a conta como dona e o lote fica preso, que é o erro barato.
 *
 * ⚠️ `incluiEsta` É O QUE LIMITA O ALCANCE, e é de propósito: sem ele, uma reserva de outra pessoa
 * com propostas mortas cairia junto. Com ele, a candidata só pode ser a reserva que a linha desta
 * venda aponta — ver o aviso de `soltarLoteDaVendaDesfeita`.
 */
async function derrubarReservasEsquecidas(
  client: SupabaseClient,
  args: { agora: string; jaCaidas: Set<string>; linhas: string[]; vendaId: string },
): Promise<string[]> {
  if (args.linhas.length === 0) return [];
  const { data: reservas, error } = await client
    .from("hercules_reservas")
    .select("id")
    .eq("workspace_id", "careli")
    .in("unidade_id", args.linhas)
    .eq("situacao", "proposta");
  if (error) {
    console.error("[hercules][soltura] não deu para procurar reserva esquecida no terreno", error.message);
    return [];
  }
  const candidatas = ((reservas ?? []) as Array<{ id: string }>)
    .map((r) => String(r.id))
    .filter((id) => !args.jaCaidas.has(id));
  if (candidatas.length === 0) return [];

  const { data: ligadas, error: erroDasLigadas } = await client
    .from("hercules_propostas")
    .select("id, etapa, reserva_id")
    .eq("workspace_id", "careli")
    .in("reserva_id", candidatas);
  if (erroDasLigadas) {
    console.error("[hercules][soltura] não deu para ler as propostas das reservas do terreno", erroDasLigadas.message);
    return [];
  }

  const porReserva = new Map<string, Array<{ etapa: string; id: string }>>();
  for (const p of (ligadas ?? []) as Array<{ etapa: null | string; id: string; reserva_id: null | string }>) {
    const chave = String(p.reserva_id ?? "");
    const lista = porReserva.get(chave) ?? [];
    lista.push({ etapa: String(p.etapa ?? "").trim(), id: String(p.id) });
    porReserva.set(chave, lista);
  }

  const caidas: string[] = [];
  for (const reservaId of candidatas) {
    const propostas = porReserva.get(reservaId) ?? [];
    const todasMortas = propostas.length > 0 && propostas.every((p) => VENDA_DESFEITA.has(p.etapa));
    const incluiEsta = propostas.some((p) => p.id === args.vendaId);
    if (!todasMortas || !incluiEsta) continue;
    const { data: mexidas, error: erroDaEscrita } = await client
      .from("hercules_reservas")
      .update({ atualizado_em: args.agora, situacao: "cancelada" })
      .eq("id", reservaId)
      // A condição repetida: se a reserva mudou entre a leitura e aqui, nada se grava.
      .eq("situacao", "proposta")
      .select("id");
    if (erroDaEscrita) {
      console.error("[hercules][soltura] a reserva esquecida não caiu", { erro: erroDaEscrita.message, reservaId });
      continue;
    }
    if (((mexidas ?? []) as unknown[]).length > 0) caidas.push(reservaId);
  }
  return caidas;
}

/**
 * Relê a régua e confirma que o lote saiu `disponivel`. Se não saiu, diz por quê: a irmã de outra
 * gleba com dono no cadastro (a regra de situacao-da-unidade.ts), ou a régua ocupada por outra razão.
 * Leitura que falha mantém o desfecho da trava (o cadastro já foi gravado) e grita no log.
 */
async function provarPelaRegua(
  client: SupabaseClient,
  unidadeId: string,
  enterpriseId: string,
  desfecho: DevolucaoDoCadastro,
): Promise<DevolucaoDoCadastro> {
  try {
    const regua = await lerSituacaoDasUnidades(client, [enterpriseId]);
    const viva = regua.porLinha.get(unidadeId);
    if (viva?.situacao === "disponivel") return desfecho;

    const linhas = regua.terreno(unidadeId)?.linhas ?? [unidadeId];
    const { data, error } = await client
      .from("hercules_unidades")
      .select("id, codigo, situacao, espelho_de")
      .in("id", linhas);
    if (error) throw new Error(error.message);
    const irma = (
      (data ?? []) as Array<{ codigo: null | string; espelho_de: null | string; id: string; situacao: null | string }>
    ).find(
      (l) =>
        l.id !== unidadeId &&
        l.id !== viva?.id &&
        !l.espelho_de &&
        ["reservada", "vendida"].includes(String(l.situacao ?? "").trim().toLowerCase()),
    );
    if (irma) return { devolvida: false, irma: String(irma.codigo ?? irma.id), porque: "irma_com_dono" };
    return { devolvida: false, porque: "regua_ocupada", situacao: String(viva?.situacao ?? "desconhecida") };
  } catch (erro) {
    console.error("[hercules][soltura] não deu para conferir a régua depois de soltar o lote", { erro, unidadeId });
    return desfecho;
  }
}

/** O que aconteceu com a unidade, pronto para a tela e para o histórico. */
export type DesfechoDaUnidade = { frase: string; voltou: boolean };

/**
 * A frase do que aconteceu com a unidade, a partir do desfecho da trava.
 *
 * ⚠️ "NÃO VOLTOU" SEMPRE COM O PORQUÊ. Quem concluiu um cancelamento e vê o lote ocupado precisa
 * saber se é outro dono (e qual), um bloqueio do Apolo, a irmã de outra gleba ou uma leitura que
 * falhou: são conversas diferentes, com pessoas diferentes.
 *
 * ⚠️ MORAVA EM concluir-cancelamento-server.ts, e veio para cá (24/09/2026) porque o Cancelar
 * proposta do Hércules passou a dizer o mesmo à tela. Aquele arquivo a reexporta.
 */
export function desfechoDaUnidade(d: DevolucaoDoCadastro): DesfechoDaUnidade {
  if (d.devolvida) return { frase: "a unidade voltou para a disponibilidade", voltou: true };
  switch (d.porque) {
    case "ja_disponivel":
      return { frase: "o cadastro da unidade já dizia disponível", voltou: true };
    case "outro_dono":
      return {
        frase: `a unidade NÃO voltou para a disponibilidade: o lote tem outro dono (${d.donos[0]?.descricao ?? "outro processo vivo"})`,
        voltou: false,
      };
    case "irma_com_dono":
      return {
        frase: `a unidade NÃO voltou para a disponibilidade: o cadastro desta venda foi liberado, mas a irmã ${d.irma} do mesmo lote ainda tem dono no cadastro`,
        voltou: false,
      };
    case "regua_ocupada":
      return {
        frase: `a unidade NÃO voltou para a disponibilidade: o lote ainda aparece como "${d.situacao}"`,
        voltou: false,
      };
    case "bloqueada":
      return {
        frase: "a unidade NÃO voltou para a disponibilidade: ela está bloqueada no cadastro",
        voltou: false,
      };
    case "cadastro":
      return {
        frase: `a unidade NÃO voltou para a disponibilidade: o cadastro dela está "${d.situacao ?? "sem situação"}"`,
        voltou: false,
      };
    default:
      return {
        frase:
          "a unidade NÃO voltou para a disponibilidade: não deu para conferir se o lote tem outro dono, e ela fica ocupada até alguém conferir",
        voltou: false,
      };
  }
}
