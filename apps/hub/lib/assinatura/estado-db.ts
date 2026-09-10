import type { SupabaseClient } from "@supabase/supabase-js";

import type { EventoDaClicksign } from "./clicksign/webhook";
import { ehTerminal, type EstadoDaAssinatura } from "./tipos";
import { estadoDoEventoClicksign } from "./traduzir";

// O EVENTO DO WEBHOOK VIRA ESTADO — e o card da Têmis anda junto.
//
// ⚠️ SÓ EVENTO CONFERIDO CHEGA AQUI. Quem confere é `conferirAssinaturaDoWebhook`, na rota. Este
// arquivo assume que a assinatura bateu; chamá-lo com um evento não conferido seria o mesmo que não
// ter conferência nenhuma.
//
// ⚠️ ESTADO TERMINAL NÃO REGRIDE, e esta é a proteção que falta na maioria das integrações de
// webhook. Provedor reenvia evento quando não recebe 200, e os reenvios chegam FORA DE ORDEM: um
// `sign` atrasado, entregue depois do `auto_close`, poria um contrato ASSINADO de volta em
// "parcialmente assinado" — e a Têmis mandaria alguém cobrar uma assinatura que já existe. O mesmo
// vale para um `sign` que chega depois de uma recusa.
//
// ⚠️ E `sign` NÃO É CONCLUSÃO. Um `sign` é UMA pessoa; o contrato só fecha em `close` / `auto_close`
// / `document_closed`. Tratar `sign` como fim daria o contrato por concluído no primeiro dos quatro
// compradores. A tradução mora em `traduzir.ts` e é a mesma que a tela usa.

export type AplicacaoDoEvento = {
  aplicado: boolean;
  /** Uma frase para o log: por que aplicou, ou por que não. */
  motivo: string;
  /** O estado que a linha ficou (ou já tinha). */
  estado: null | EstadoDaAssinatura;
};

type LinhaDoEnvelope = {
  estado: string;
  id: string;
  proposta_id: null | string;
};

/**
 * Move o envelope (e o card) conforme o evento.
 *
 * ⚠️ NUNCA LANÇA. Ele roda depois de a rota já ter respondido 200; uma exceção aqui viraria um
 * unhandled rejection no runtime da Vercel, sem ninguém para pegá-la — e sem nada no lugar do
 * estado que deveria ter mudado. Toda falha vira `aplicado: false` com o motivo escrito.
 */
export async function aplicarEventoDaClicksign(
  sb: SupabaseClient,
  evento: EventoDaClicksign,
): Promise<AplicacaoDoEvento> {
  const novo = estadoDoEventoClicksign(evento.evento);
  if (!novo) {
    // Evento de bastidor (`upload`, `add_signer`, as falhas de autenticação do signatário…). Fica
    // registrado e não move o card — ver a nota de `ESTADO_POR_EVENTO`.
    return { aplicado: false, estado: null, motivo: `evento "${evento.evento}" não move o estado` };
  }

  const linha = await acharEnvelope(sb, evento);
  if (!linha) {
    return {
      aplicado: false,
      estado: null,
      motivo: "não achei o envelope no Panteon (documento/envelope desconhecido)",
    };
  }

  const atual = linha.estado as EstadoDaAssinatura;
  if (ehTerminal(atual)) {
    return {
      aplicado: false,
      estado: atual,
      motivo: `a linha já está em "${atual}", que é terminal — evento fora de ordem não regride estado`,
    };
  }

  const agora = new Date().toISOString();
  const { error } = await sb
    .from("temis_envelopes")
    .update({
      atualizado_em: agora,
      estado: novo,
      estado_cru: `clicksign:${evento.evento}`,
      ...(ehTerminal(novo) ? { fechado_em: agora } : {}),
    })
    .eq("id", linha.id);

  if (error) {
    console.error("[clicksign][webhook] falha ao gravar o estado do envelope", error);
    return { aplicado: false, estado: atual, motivo: `falha ao gravar: ${error.message}` };
  }

  // ⚠️ O CARD SÓ ANDA QUANDO O CONTRATO FECHA. Um `sign` isolado deixa o card onde está: ele
  // continua "em assinatura", que é a verdade — falta gente. Mover a cada assinatura faria o board
  // piscar e diria "finalizado" com metade das assinaturas.
  if (novo === "assinado" && linha.proposta_id) {
    await moverCardDaTemis(sb, linha.proposta_id, "finalizado");
  }

  return { aplicado: true, estado: novo, motivo: `${atual} → ${novo}` };
}

/**
 * Acha a linha por qualquer um dos dois ids que o evento possa trazer.
 *
 * ⚠️ O DOCUMENTO VEM PRIMEIRO, e é uma decisão medida: os eventos da Clicksign são de DOCUMENTO
 * (`sign`, `refusal`, `document_closed`), e o id do documento é o que aparece em todos eles. O id do
 * envelope é o que aparece nos de envelope. Procurar só por um deles perderia metade dos eventos —
 * e o formato do corpo entregue ao endpoint NÃO está documentado (a doc da v3 lista os 30 eventos e
 * não mostra um exemplo do payload), então o leitor tenta os dois.
 */
async function acharEnvelope(
  sb: SupabaseClient,
  evento: EventoDaClicksign,
): Promise<LinhaDoEnvelope | null> {
  const tentativas: Array<[string, string]> = [];
  if (evento.documentoId) tentativas.push(["provedor_documento_id", evento.documentoId]);
  if (evento.envelopeId) tentativas.push(["envelope_id", evento.envelopeId]);
  // ⚠️ O `metadata` É A REDE DE SEGURANÇA, e ele é NOSSO: foi o Panteon que o gravou no documento
  // no momento do envio, e a Clicksign o devolve inteiro no webhook (conferido no primeiro evento
  // real, 09/09/2026 — voltaram `proposta_id`, `documento_id`, `unidade`, `comprador` e `teste`).
  //
  // ⚠️ E ELE VEM POR ÚLTIMO DE PROPÓSITO. O id do provedor é mais específico: identifica ESTE
  // envelope. A proposta pode ter mais de um envelope ao longo da vida (um recusado e um reenviado),
  // e aí a busca por proposta pegaria o mais recente — que é o certo quando não há id nenhum, e o
  // errado quando há. Primeiro o preciso, depois o que salva.
  const propostaDoMetadata = String(evento.metadados?.proposta_id ?? "").trim();
  if (propostaDoMetadata) tentativas.push(["proposta_id", propostaDoMetadata]);

  for (const [coluna, valor] of tentativas) {
    const { data, error } = await sb
      .from("temis_envelopes")
      .select("id, estado, proposta_id")
      .eq("provedor", "clicksign")
      .eq(coluna, valor)
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[clicksign][webhook] falha ao procurar o envelope", error);
      continue;
    }
    if (data) return data as LinhaDoEnvelope;
  }

  return null;
}

/**
 * Move o card da Têmis desta proposta.
 *
 * ⚠️ SÓ PARA A FRENTE. `estagio_desde` é de onde os prazos das atividades contam; puxar um card de
 * volta reiniciaria o relógio de um trabalho que já andou, e o board passaria a cobrar prazo de uma
 * etapa vencida há semanas. Como a única transição automática hoje é "assinatura → finalizado", a
 * guarda é simples: não mexe em card já finalizado.
 *
 * ⚠️ E FALHA AQUI NÃO É FALHA DO EVENTO. O estado do envelope — que é o fato — já está gravado. O
 * card é a apresentação daquele fato no board, e um board desatualizado se conserta na próxima
 * leitura; desfazer o estado por causa dele seria trocar o certo pelo cosmético.
 */
export async function moverCardDaTemis(
  sb: SupabaseClient,
  propostaId: string,
  estagio: "assinatura" | "finalizado",
): Promise<void> {
  const { error } = await sb
    .from("temis_trabalhos")
    .update({ atualizado_em: new Date().toISOString(), estagio, estagio_desde: new Date().toISOString() })
    .eq("proposta_id", propostaId)
    .neq("estagio", "finalizado");

  if (error) console.error("[temis][card] falha ao mover o card da proposta", error);
}

/**
 * Guarda o evento cru — inclusive o que NÃO passou na conferência.
 *
 * ⚠️ O QUE NÃO PASSA É JUSTAMENTE O QUE INTERESSA GUARDAR, por dois motivos opostos: um POST forjado
 * é a informação de segurança mais útil que este endpoint produz, e um evento LEGÍTIMO que não bate
 * é o sinal de que o cabeçalho do HMAC não é o que supomos — o nome dele não está documentado (ver
 * `lib/assinatura/clicksign/webhook.ts`). Descartar os dois deixaria as duas descobertas invisíveis.
 *
 * ⚠️ FALHA AQUI NÃO DERRUBA A RESPOSTA. Provedor reenvia o evento quando não recebe 200, e
 * retentativa em cima de rota que falha vira tempestade.
 */
export async function registrarEventoDeAssinatura(
  sb: SupabaseClient,
  linha: {
    aplicado: boolean;
    assinaturaCabecalho: null | string;
    assinaturaConferida: boolean;
    evento: EventoDaClicksign;
    headers: Record<string, string>;
    payload: unknown;
  },
): Promise<void> {
  const { error } = await sb.from("temis_assinatura_eventos").insert({
    aplicado: linha.aplicado,
    assinatura_cabecalho: linha.assinaturaCabecalho,
    assinatura_conferida: linha.assinaturaConferida,
    envelope_id: linha.evento.envelopeId,
    evento: linha.evento.evento || null,
    headers: linha.headers,
    payload: linha.payload,
    provedor: "clicksign",
    provedor_documento_id: linha.evento.documentoId,
  });

  if (error) console.error("[clicksign][webhook] falha ao registrar o evento", error);
}
