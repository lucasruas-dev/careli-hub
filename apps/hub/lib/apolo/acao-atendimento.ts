import type { SupabaseClient } from "@supabase/supabase-js";

import { NOME_TEMPLATE_CONVITE } from "@/lib/apolo/acao-template";
import { buildBrazilianPhoneVariants } from "@/lib/iris/meta-whatsapp";

// Abre um ATENDIMENTO de verdade para o disparo da ação: o mesmo modelo do "contato ativo" da Iris
// (ticket com protocolo AT, mensagem outbound do template, ref para casar a resposta). O ticket
// nasce marcado com metadata.acaoId → some da fila de atendimento e mora na aba "Ações" do Board;
// como é contato ativo (awaiting_customer_reply) SEM cobrança, a Cacá não responde sozinha e o
// humano atende. Ver [[project_apolo_acao_contato]].

const CANAL_SLUG_PADRAO = "whatsapp-careli";
const FILA_SLUG_PADRAO = "atendimento";

function soDigitos(tel: string): string {
  const d = tel.replace(/\D/g, "");
  return d.startsWith("55") ? d : `55${d}`;
}

// Ticket já aberto para este alvo (idempotência: reenvio não cria um segundo atendimento).
async function acharTicketDoAlvo(
  client: SupabaseClient,
  alvoId: string,
): Promise<{ id: string; protocol: string } | null> {
  const { data } = await client
    .from("caredesk_tickets")
    .select("id, protocol")
    .eq("metadata->>alvoId", alvoId)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; protocol: string }>();
  return data ?? null;
}

export async function abrirAtendimentoDaAcao(
  client: SupabaseClient,
  input: {
    acaoId: string;
    acaoNome: string;
    alvoId: string;
    entityId: string | null;
    metaRaw?: unknown;
    nome: string | null;
    phoneNumberId: string;
    previewTexto: string;
    telefone: string;
    waMessageId: string | null;
  },
): Promise<{ protocol: string; ticketId: string } | null> {
  try {
    // canal do disparo (4143 = whatsapp-careli); fallback no canal padrão
    let channelId: string | null = null;
    const { data: canal } = await client
      .from("caredesk_channels")
      .select("id")
      .eq("provider", "meta")
      .eq("external_account_id", input.phoneNumberId)
      .maybeSingle<{ id: string }>();
    channelId = canal?.id ?? null;
    if (!channelId) {
      const { data: fb } = await client
        .from("caredesk_channels")
        .select("id")
        .eq("slug", CANAL_SLUG_PADRAO)
        .maybeSingle<{ id: string }>();
      channelId = fb?.id ?? null;
    }

    const { data: ws } = await client
      .from("hub_workspaces")
      .select("id")
      .eq("slug", "careli")
      .maybeSingle<{ id: string }>();
    const workspaceId = ws?.id ?? null;

    // contato: casa por variantes do número (com/sem 9, com/sem 55); cria se novo
    const wa = soDigitos(input.telefone);
    const variantes = buildBrazilianPhoneVariants(wa);
    const lista = (variantes.length ? variantes : [wa]).join(",");
    const { data: contatos } = await client
      .from("caredesk_contacts")
      .select("id")
      .or(`whatsapp_phone.in.(${lista}),phone.in.(${lista})`)
      .limit(1);
    let contactId = ((contatos ?? [])[0] as { id?: string } | undefined)?.id ?? null;
    if (!contactId) {
      const { data: novo } = await client
        .from("caredesk_contacts")
        .insert({
          display_name: input.nome ?? wa,
          metadata: { entityId: input.entityId, source: "apolo_acao" },
          person_type: "whatsapp",
          phone: wa,
          whatsapp_phone: wa,
          workspace_id: workspaceId,
        })
        .select("id")
        .single<{ id: string }>();
      contactId = novo?.id ?? null;
    }
    if (!contactId) return null;

    // fila + profile (só para o SLA/priority; a aba é decidida pelo metadata.acaoId)
    const { data: fila } = await client
      .from("caredesk_queues")
      .select("id, default_priority, sla_first_response_minutes, sla_resolution_minutes")
      .eq("slug", FILA_SLUG_PADRAO)
      .maybeSingle<{
        default_priority: string | null;
        id: string;
        sla_first_response_minutes: number | null;
        sla_resolution_minutes: number | null;
      }>();
    const { data: profile } = fila
      ? await client
          .from("caredesk_ticket_profiles")
          .select("id, priority, sla_first_response_minutes, sla_resolution_minutes")
          .eq("queue_id", fila.id)
          .eq("status", "active")
          .order("name", { ascending: true })
          .limit(1)
          .maybeSingle<{
            id: string;
            priority: string | null;
            sla_first_response_minutes: number | null;
            sla_resolution_minutes: number | null;
          }>()
      : { data: null };

    const agora = new Date();
    const iso = agora.toISOString();
    const emMin = (m: number) => new Date(agora.getTime() + m * 60000).toISOString();

    // ticket: reusa o do alvo (reenvio) ou cria um novo com protocolo AT
    let ticketId: string | null = null;
    let protocol = "";
    const existente = await acharTicketDoAlvo(client, input.alvoId);
    if (existente) {
      ticketId = existente.id;
      protocol = existente.protocol;
      // reabre para o operador quando o reenvio acontece num ticket já fechado
      await client
        .from("caredesk_tickets")
        .update({ status: "waiting_customer", updated_at: iso })
        .eq("id", ticketId);
    } else {
      const { data: prot } = await client.rpc("next_caredesk_ticket_protocol");
      protocol = typeof prot === "string" ? prot : "";
      const firstMin =
        profile?.sla_first_response_minutes ?? fila?.sla_first_response_minutes ?? 60;
      const resMin = profile?.sla_resolution_minutes ?? fila?.sla_resolution_minutes ?? 480;
      const { data: ticket } = await client
        .from("caredesk_tickets")
        .insert({
          channel_id: channelId,
          contact_id: contactId,
          first_response_due_at: emMin(firstMin),
          metadata: {
            acaoId: input.acaoId,
            acaoOrigem: "apolo_acao",
            activeContactConsent: "awaiting_customer_reply",
            alvoId: input.alvoId,
            // 🔴 `customerServiceWindowOpenedAt` NÃO É GRAVADO AQUI, e a ausência é proposital.
            //
            // Este ponto é o disparo do TEMPLATE de convite: o cliente ainda não falou nada (o
            // `activeContactConsent` logo acima diz isso com todas as letras). Pela regra da Meta
            // quem abre a janela de 24h é a RESPOSTA do cliente, não a nossa mensagem.
            //
            // Gravar aqui fazia a tela do atendente acreditar em janela aberta, liberar o campo
            // de texto e só descobrir no envio, com "Re-engagement message" vindo da Meta. Quem
            // grava esse campo de verdade é o inbound (lib/iris/meta-inbound-processor.ts),
            // quando a mensagem do cliente chega.
            initialTemplateName: NOME_TEMPLATE_CONVITE,
            source: "apolo_acao",
          },
          opened_at: iso,
          priority: profile?.priority ?? fila?.default_priority ?? "medium",
          profile_id: profile?.id ?? null,
          protocol,
          queue_id: fila?.id ?? null,
          resolution_due_at: emMin(resMin),
          source_context: {
            acaoId: input.acaoId,
            alvoId: input.alvoId,
            contactOrigin: "active",
            provider: "meta",
          },
          source_entity_id: input.waMessageId,
          source_entity_type: "meta-whatsapp-message",
          source_module: "iris",
          status: "waiting_customer",
          // Assunto = nome da ação (aparece no card e no topo da conversa).
          subject: input.acaoNome,
          workspace_id: workspaceId,
        })
        .select("id, protocol")
        .single<{ id: string; protocol: string }>();
      ticketId = ticket?.id ?? null;
      protocol = ticket?.protocol ?? protocol;
    }
    if (!ticketId) return null;

    // Idempotência: se essa mensagem (wa_message_id) já está registrada, não duplica. Protege o
    // reenvio e o backfill (criar o atendimento a partir de um disparo já feito, sem inserir a
    // mensagem duas vezes).
    if (input.waMessageId) {
      const { data: jaTem } = await client
        .from("caredesk_messages")
        .select("id")
        .eq("external_message_id", input.waMessageId)
        .limit(1)
        .maybeSingle<{ id: string }>();
      if (jaTem) return { protocol, ticketId };
    }

    // mensagem outbound (o template que saiu) — external_message_id = wa_message_id é o que casa a
    // resposta do cliente de volta a este atendimento (findTicketByReplyContextMessageId no inbound).
    const { data: msg } = await client
      .from("caredesk_messages")
      .insert({
        body: input.previewTexto,
        channel_id: channelId,
        delivery_status: input.waMessageId ? "sent" : "queued",
        direction: "outbound",
        external_message_id: input.waMessageId,
        message_type: "template",
        provider_payload: {
          acaoId: input.acaoId,
          meta: input.metaRaw ?? null,
          template: { name: NOME_TEMPLATE_CONVITE },
        },
        sender_type: "operator",
        sent_at: input.waMessageId ? iso : null,
        ticket_id: ticketId,
      })
      .select("id")
      .single<{ id: string }>();

    if (input.waMessageId && msg?.id) {
      await client.from("caredesk_whatsapp_message_refs").upsert(
        {
          channel_id: channelId,
          delivery_status: "sent",
          direction: "outbound",
          message_id: msg.id,
          payload: input.metaRaw ?? null,
          phone_number_id: input.phoneNumberId,
          provider: "meta",
          wa_message_id: input.waMessageId,
        },
        { onConflict: "provider,wa_message_id" },
      );
    }

    return { protocol, ticketId };
  } catch (e) {
    console.error(
      "[apolo/acao] abrirAtendimentoDaAcao falhou",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
