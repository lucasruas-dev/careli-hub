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
};

// Envia Web Push aos membros ativos do canal (exceto o autor) que tem subscription.
// Best-effort e isolado: qualquer falha aqui NUNCA pode afetar o envio da mensagem
// (o caller chama via `after()` com try/catch).
export async function sendHermesMessagePush(input: {
  authorUserId: string | null;
  body: string;
  channelId: string;
  messageId: string;
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
    .select("id,endpoint,p256dh,auth")
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
          .select("display_name")
          .eq("id", input.authorUserId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const channelName =
    (channelResult.data as { name?: string } | null)?.name ?? "Hermes";
  const authorName =
    (authorResult.data as { display_name?: string } | null)?.display_name ??
    "Hermes";

  const payload = JSON.stringify({
    body: `${authorName}: ${truncatePushBody(input.body)}`,
    tag: `pulsex-message-${input.messageId}`,
    title: `Nova mensagem em ${channelName}`,
    url: `/hermes?channel=${encodeURIComponent(input.channelId)}`,
  });

  await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { auth: row.auth, p256dh: row.p256dh },
          },
          payload,
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
