import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";

import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

// Sender generico de Web Push do HUB. Entrega a notificacao do SO mesmo com o app
// fechado/minimizado, para QUALQUER modulo (nao so o Hermes). Best-effort e isolado:
// qualquer falha aqui NUNCA pode afetar o fluxo que originou a notificacao.

export type HubWebPushPayload = {
  body?: string;
  icon?: string;
  tag?: string;
  title: string;
  url?: string;
};

type PushSubscriptionRow = {
  auth: string;
  endpoint: string;
  id: string;
  p256dh: string;
};

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

export function createPushServiceClient(): SupabaseClient | null {
  const { serviceRoleKey, url } = getServerSupabaseConfig();

  if (!url || !serviceRoleKey) {
    return null;
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Envia um Web Push a TODOS os dispositivos inscritos dos usuarios informados.
// Aceita um client opcional para reaproveitar a conexao do caller.
export async function sendWebPushToUsers(
  userIds: readonly string[],
  payload: HubWebPushPayload,
  injectedClient?: SupabaseClient | null,
): Promise<void> {
  if (!ensureVapidConfigured()) {
    return;
  }

  const recipients = [...new Set(userIds.filter(Boolean))];

  if (recipients.length === 0) {
    return;
  }

  const client = injectedClient ?? createPushServiceClient();

  if (!client) {
    return;
  }

  const { data: subscriptions } = await client
    .from("hub_push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .in("user_id", recipients);

  const rows = (subscriptions ?? []) as PushSubscriptionRow[];

  if (rows.length === 0) {
    return;
  }

  const serializedPayload = JSON.stringify({
    body: payload.body,
    icon: payload.icon,
    tag: payload.tag,
    title: payload.title,
    url: payload.url,
  });

  await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { auth: row.auth, p256dh: row.p256dh },
          },
          serializedPayload,
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;

        // Subscription expirada/invalida: remove para nao reenviar.
        if (statusCode === 404 || statusCode === 410) {
          await client.from("hub_push_subscriptions").delete().eq("id", row.id);
        }
      }
    }),
  );
}
