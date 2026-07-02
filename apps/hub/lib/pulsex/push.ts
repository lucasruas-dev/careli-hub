import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

let vapidConfigured: boolean | null = null;

function ensureVapidConfigured(): boolean {
  if (vapidConfigured !== null) {
    return vapidConfigured;
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject =
    process.env.VAPID_SUBJECT?.trim() || "mailto:no-reply@careli.adm.br";

  if (!publicKey || !privateKey) {
    vapidConfigured = false;
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

function createPushServiceClient() {
  const { serviceRoleKey, url } = getServerSupabaseConfig();

  if (!url || !serviceRoleKey) {
    return null;
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type PushSubscriptionRow = {
  auth: string;
  endpoint: string;
  id: string;
  p256dh: string;
  user_id: string | null;
};

// Envia Web Push aos membros ativos do canal (exceto o autor) que tem subscription.
// Best-effort e isolado: qualquer falha aqui NUNCA pode afetar o envio da mensagem
// (o caller chama via `after()` com try/catch).
export async function sendHermesMessagePush(input: {
  authorUserId: string | null;
  body: string;
  channelId: string;
  mentionUserIds?: readonly string[];
  messageId: string;
  threadParentMessageId?: string | null;
}): Promise<void> {
  if (!ensureVapidConfigured()) {
    return;
  }

  const client = createPushServiceClient();

  if (!client) {
    return;
  }

  const { data: members } = await client
    .from("pulsex_channel_members")
    .select("user_id")
    .eq("channel_id", input.channelId)
    .eq("status", "active");

  const memberIds = [
    ...new Set(
      ((members ?? []) as { user_id: string | null }[])
        .map((member) => member.user_id)
        .filter(
          (userId): userId is string =>
            Boolean(userId) && userId !== input.authorUserId,
        ),
    ),
  ];

  if (memberIds.length === 0) {
    return;
  }

  const { data: subscriptions } = await client
    .from("hub_push_subscriptions")
    .select("id,endpoint,p256dh,auth,user_id")
    .in("user_id", memberIds);

  const rows = (subscriptions ?? []) as PushSubscriptionRow[];

  if (rows.length === 0) {
    return;
  }

  const [channelResult, authorResult] = await Promise.all([
    client
      .from("pulsex_channels")
      .select("name")
      .eq("id", input.channelId)
      .maybeSingle(),
    input.authorUserId
      ? client
          .from("hub_users")
          .select("display_name,avatar_url")
          .eq("id", input.authorUserId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const channelName =
    (channelResult.data as { name?: string } | null)?.name ?? "Hermes";
  const authorData = authorResult.data as {
    avatar_url?: string | null;
    display_name?: string | null;
  } | null;
  const authorName = authorData?.display_name ?? "Hermes";

  // Link direto: canal + (se for resposta) a thread — mesmo formato do
  // getHermesChannelPath do app, pro clique cair exatamente na conversa.
  const targetUrl = input.threadParentMessageId
    ? `/hermes?channel=${encodeURIComponent(input.channelId)}&thread=${encodeURIComponent(input.threadParentMessageId)}`
    : `/hermes?channel=${encodeURIComponent(input.channelId)}`;
  const mentionedIds = new Set(input.mentionUserIds ?? []);
  const basePayload = {
    body: `${authorName}: ${truncatePushBody(input.body)}`,
    // Avatar de quem enviou (o SW cai na marca do Panteon se vier vazio).
    icon: authorData?.avatar_url ?? undefined,
    url: targetUrl,
  };
  // Notificacao de @mencao e DIFERENTE (pedido do time): titulo proprio e tag
  // propria (nao colapsa com a notificacao generica do canal).
  const regularPayload = JSON.stringify({
    ...basePayload,
    tag: `pulsex-message-${input.messageId}`,
    title: input.threadParentMessageId
      ? `Nova resposta em ${channelName}`
      : `Nova mensagem em ${channelName}`,
  });
  const mentionPayload = JSON.stringify({
    ...basePayload,
    tag: `pulsex-mention-${input.messageId}`,
    title: `${authorName} mencionou voce em ${channelName}`,
  });

  await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { auth: row.auth, p256dh: row.p256dh },
          },
          row.user_id && mentionedIds.has(row.user_id)
            ? mentionPayload
            : regularPayload,
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;

        // Subscription expirada/invalida: remove para nao reenviar.
        if (statusCode === 404 || statusCode === 410) {
          await client
            .from("hub_push_subscriptions")
            .delete()
            .eq("id", row.id);
        }
      }
    }),
  );
}

function truncatePushBody(body: string) {
  const normalized = body.replace(/\s+/g, " ").trim();

  return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized;
}
