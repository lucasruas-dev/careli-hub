"use client";

import type { HermesMessage } from "@/lib/pulsex";

// Cache em memoria das ultimas mensagens por canal, alimentado pelo realtime
// GLOBAL do provider. Mata o delay "a notificacao chega antes da mensagem"
// (decisao Lucas 7/jul): ao abrir o canal, o workspace SEMEIA a conversa com o
// que o realtime ja entregou — a mensagem aparece na hora — e o fetch da API
// reconcilia logo atras. Escopo de modulo = sobrevive a navegacao client-side.

const MAX_MESSAGES_PER_CHANNEL = 30;

const recentMessagesByChannelId = new Map<string, HermesMessage[]>();

export function rememberRecentHermesMessage(message: HermesMessage) {
  if (!message.channelId || !message.id) {
    return;
  }

  const current = recentMessagesByChannelId.get(message.channelId) ?? [];
  const withoutDuplicate = current.filter((item) => item.id !== message.id);

  withoutDuplicate.push(message);
  recentMessagesByChannelId.set(
    message.channelId,
    withoutDuplicate.slice(-MAX_MESSAGES_PER_CHANNEL),
  );
}

export function readRecentHermesMessages(
  channelId: string,
): readonly HermesMessage[] {
  return recentMessagesByChannelId.get(channelId) ?? [];
}
