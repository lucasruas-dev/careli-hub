// DISPAROS DE TEMPLATE NA CONVERSA DA IRIS.
//
// O problema (Lucas, 23/08): "enviamos a mensagem e só vemos a resposta do cliente". Medido em
// produção: 48 envios de template em 7 dias sem NENHUM registro na Iris — são os disparos
// automáticos (ação de contato do Apolo, cobrança, reprovação, boas-vindas do Prometeu...), que
// chamam a Graph API direto e não criam mensagem em `caredesk_messages`. Quando o cliente
// responde, o ticket nasce só com a resposta, e o operador atende sem saber o que a Careli
// mandou. Só 10 dos 48 estavam em `apolo_disparos` — remendar fluxo a fluxo não fecha o buraco.
//
// A solução tem duas pontas:
//  1. O TRANSPORTE (`sendMetaWhatsAppTemplateMessage`) registra TODO envio de template como
//     referência em `caredesk_whatsapp_message_refs` (payload guarda template + parâmetros —
//     é o que permite renderizar o corpo real depois). Ponto único: qualquer disparador novo
//     ganha o registro de graça. Os caminhos da própria Iris (conversa/abertura), que já criam
//     a mensagem antes do envio, fazem opt-out para não duplicar.
//  2. O INBOUND materializa as referências órfãs do contato como mensagens do ticket na hora em
//     que a resposta chega — com `created_at` do envio original, a conversa fica na ordem certa.
//     Se o contato já tem ticket aberto no momento do disparo, a materialização acontece na hora.
import type { SupabaseClient } from "@supabase/supabase-js";

import { createIrisMetaAdminClient } from "./meta-server";

// O client genérico do Supabase: este módulo é chamado tanto pelo transporte (client próprio)
// quanto pelo processador de inbound (que injeta o dele).
type Client = SupabaseClient;

export type DisparoDeTemplate = {
  bodyParameters: string[];
  language: string;
  name: string;
  phoneNumberId: string | null;
  to: string;
  wamid: string;
};

const digitos = (valor: string): string => valor.replace(/\D/g, "");

// O 9º dígito brasileiro: o número gravado no contato e o usado no envio podem divergir nele.
export function variantesDoTelefone(valor: string): string[] {
  const d = digitos(valor);
  const comPais = d.length === 10 || d.length === 11 ? `55${d}` : d;
  const saida = new Set([comPais]);
  const comNono = /^55(\d{2})9(\d{8})$/.exec(comPais);
  if (comNono) saida.add(`55${comNono[1]}${comNono[2]}`);
  const semNono = /^55(\d{2})(\d{8})$/.exec(comPais);
  if (semNono) saida.add(`55${semNono[1]}9${semNono[2]}`);
  return [...saida];
}

// O {{n}} do corpo aprovado vira o parâmetro n do envio; placeholder sem parâmetro fica como
// está (melhor o operador ver o {{2}} do que um buraco no texto).
export function preencherCorpoDoTemplate(body: string, bodyParameters: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (todo, n: string) => {
    const valor = bodyParameters[Number(n) - 1];
    return typeof valor === "string" && valor ? valor : todo;
  });
}

// O corpo REAL da mensagem: o body aprovado do template local com {{n}} substituído pelos
// parâmetros enviados. Sem template local, ao menos o nome + parâmetros — nunca balão vazio.
async function renderizarCorpo(
  client: Client,
  name: string,
  bodyParameters: string[],
): Promise<string> {
  const { data } = await client
    .from("caredesk_templates")
    .select("body")
    .eq("metadata->>metaTemplateName", name)
    .limit(1);
  const body = ((data ?? [])[0] as { body: null | string } | undefined)?.body;

  if (body && body.trim()) {
    return preencherCorpoDoTemplate(body, bodyParameters);
  }

  const params = bodyParameters.filter(Boolean).join(" · ");
  return params ? `[${name}] ${params}` : `[${name}]`;
}

async function materializarUmaRef(
  client: Client,
  ref: {
    created_at: string;
    delivery_status: null | string;
    id: string;
    payload: Record<string, unknown> | null;
    wa_message_id: string;
  },
  ticketId: string,
): Promise<boolean> {
  // Corrida com outro gravador do mesmo wamid (ex.: retry do webhook): a mensagem já existe?
  const { data: jaExiste } = await client
    .from("caredesk_messages")
    .select("id")
    .eq("external_message_id", ref.wa_message_id)
    .limit(1);
  if ((jaExiste ?? []).length > 0) return false;

  const payload = (ref.payload ?? {}) as Record<string, unknown>;
  const name = typeof payload.name === "string" ? payload.name : "";
  const parametros = Array.isArray(payload.bodyParameters)
    ? (payload.bodyParameters as unknown[]).filter(
        (p): p is string => typeof p === "string",
      )
    : [];

  const corpo = await renderizarCorpo(client, name || "template", parametros);

  const { data: inserida, error } = await client
    .from("caredesk_messages")
    .insert({
      body: corpo,
      // O relógio do ENVIO, não o da materialização: a mensagem entra na conversa na posição
      // em que foi mandada, antes da resposta do cliente.
      created_at: ref.created_at,
      delivery_status: ref.delivery_status ?? "sent",
      direction: "outbound",
      external_message_id: ref.wa_message_id,
      message_type: "template",
      provider_payload: {
        origem: "disparo-automatico",
        source_module: "iris",
        template: name,
      },
      sender_type: "system",
      sent_at: ref.created_at,
      ticket_id: ticketId,
    })
    .select("id")
    .single();
  if (error || !inserida) return false;

  // A ref aponta para a mensagem: é o que a tira do conjunto das órfãs.
  await client
    .from("caredesk_whatsapp_message_refs")
    .update({ message_id: (inserida as { id: string }).id })
    .eq("id", ref.id);

  return true;
}

/**
 * Chamada pelo INBOUND quando o ticket do contato nasce ou é reaproveitado: pega os disparos
 * órfãos do telefone (até 30 dias) e os coloca na conversa. Best-effort — quem chama embrulha
 * em try/catch; falhar aqui NUNCA pode derrubar o recebimento da mensagem do cliente.
 */
export async function materializarDisparosNaConversa(
  client: Client,
  { telefone, ticketId }: { telefone: string; ticketId: string },
): Promise<number> {
  const variantes = variantesDoTelefone(telefone);
  if (variantes.length === 0) return 0;

  const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await client
    .from("caredesk_whatsapp_message_refs")
    .select("id, wa_message_id, payload, delivery_status, created_at")
    .is("message_id", null)
    .eq("direction", "outbound")
    .eq("provider", "meta")
    .in("wa_contact_id", variantes)
    .gte("created_at", desde)
    .order("created_at", { ascending: true })
    .limit(20);

  const refs = (data ?? []) as {
    created_at: string;
    delivery_status: null | string;
    id: string;
    payload: Record<string, unknown> | null;
    wa_message_id: string;
  }[];

  // Só as refs de DISPARO (kind marcado no registro do transporte). Refs órfãs de outras
  // origens (ex.: mensagem da conversa cujo insert local falhou) ficam fora: materializá-las
  // sem o corpo original colocaria texto errado na boca do operador.
  const deDisparo = refs.filter(
    (ref) => ((ref.payload ?? {}) as Record<string, unknown>).kind === "disparo-template",
  );

  let materializadas = 0;
  for (const ref of deDisparo) {
    if (await materializarUmaRef(client, ref, ticketId)) materializadas += 1;
  }
  return materializadas;
}

/**
 * Chamada pelo TRANSPORTE após todo envio de template bem-sucedido (fora dos caminhos da Iris
 * que já registram a própria mensagem). Grava a referência e, se o contato tem ticket aberto,
 * já materializa a mensagem na conversa — sem esperar a resposta do cliente.
 */
export async function registrarDisparoDeTemplate(disparo: DisparoDeTemplate): Promise<void> {
  const client = createIrisMetaAdminClient();
  if (!client) return;

  // Canal do número que enviou (external_account_id = phone_number_id da Meta).
  const { data: canal } = disparo.phoneNumberId
    ? await client
        .from("caredesk_channels")
        .select("id")
        .eq("external_account_id", disparo.phoneNumberId)
        .limit(1)
    : { data: null };

  // `ignoreDuplicates`: se a rota da Iris já registrou este wamid (com message_id), a ref dela
  // fica intacta — este registro é só para quem não tem nenhum.
  const { error } = await client.from("caredesk_whatsapp_message_refs").upsert(
    {
      channel_id: ((canal ?? [])[0] as { id: string } | undefined)?.id ?? null,
      delivery_status: "sent",
      direction: "outbound",
      message_id: null,
      payload: {
        bodyParameters: disparo.bodyParameters,
        kind: "disparo-template",
        language: disparo.language,
        name: disparo.name,
        to: disparo.to,
      },
      phone_number_id: disparo.phoneNumberId,
      provider: "meta",
      wa_contact_id: digitos(disparo.to),
      wa_message_id: disparo.wamid,
    },
    { ignoreDuplicates: true, onConflict: "provider,wa_message_id" },
  );
  if (error) {
    // Engolir o erro calado aqui deixava disparos sem registro e sem NENHUMA pista no log.
    console.error("[iris] registro da ref do disparo falhou", error);
    return;
  }

  // Ticket aberto AGORA? Materializa na hora — o operador vê o disparo cair na conversa.
  const variantes = variantesDoTelefone(disparo.to);
  const { data: contatos } = await client
    .from("caredesk_contacts")
    .select("id")
    .or(
      variantes
        .flatMap((v) => [`whatsapp_phone.eq.${v}`, `phone.eq.${v}`])
        .join(","),
    )
    .limit(3);

  for (const contato of (contatos ?? []) as { id: string }[]) {
    const { data: tickets } = await client
      .from("caredesk_tickets")
      .select("id, status")
      .eq("contact_id", contato.id)
      .neq("status", "closed")
      .order("opened_at", { ascending: false })
      .limit(1);
    const ticket = ((tickets ?? [])[0] as { id: string } | undefined) ?? null;
    if (ticket) {
      await materializarDisparosNaConversa(client, {
        telefone: disparo.to,
        ticketId: ticket.id,
      });
      break;
    }
  }
}
