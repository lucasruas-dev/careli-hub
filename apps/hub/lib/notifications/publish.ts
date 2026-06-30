import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createPushServiceClient,
  sendWebPushToUsers,
  type HubWebPushPayload,
} from "@/lib/notifications/push";

// publishHubNotification = ponto UNICO de emissao da central do Panteon.
// Grava uma linha em hub_notifications por destinatario (a central do cliente assina
// por realtime, filtrada pelo proprio usuario) E dispara o Web Push do SO para quem
// estiver com o app fechado/minimizado. Tudo best-effort e isolado: a notificacao
// nunca pode derrubar o fluxo que a originou (mensagem, ticket, alerta...).

export type HubNotificationSeverity =
  | "danger"
  | "info"
  | "neutral"
  | "success"
  | "warning";

export type HubNotificationKind =
  | "agenda"
  | "alerta"
  | "atendimento"
  | "mensagem"
  | "operacao"
  | "sistema"
  | "tarefa";

export type PublishHubNotificationInput = {
  actionHref?: string | null;
  body?: string | null;
  context?: Record<string, unknown>;
  kind: HubNotificationKind;
  moduleId: string;
  // Quem RECEBE. Normalmente os envolvidos MENOS o autor (caller resolve isso).
  recipientUserIds: readonly string[];
  severity?: HubNotificationSeverity;
  title: string;
  workspaceId?: string | null;
  // Push do SO (segundo plano). Por padrao espelha title/body; permite override de
  // icone (avatar), tag (colapsar duplicatas) e url (deep-link). enabled=false pula o push.
  push?: {
    enabled?: boolean;
    icon?: string;
    tag?: string;
    url?: string;
  };
};

type HubNotificationInsertRow = {
  action_href: string | null;
  body: string | null;
  context: Record<string, unknown>;
  kind: string;
  module_id: string;
  recipient_user_id: string;
  severity: HubNotificationSeverity;
  title: string;
  workspace_id: string | null;
};

export async function publishHubNotification(
  input: PublishHubNotificationInput,
  injectedClient?: SupabaseClient | null,
): Promise<void> {
  const recipients = [...new Set(input.recipientUserIds.filter(Boolean))];

  if (recipients.length === 0) {
    return;
  }

  const client = injectedClient ?? createPushServiceClient();

  if (!client) {
    return;
  }

  const severity = input.severity ?? "neutral";
  const rows: HubNotificationInsertRow[] = recipients.map((recipientUserId) => ({
    action_href: input.actionHref ?? null,
    body: input.body ?? null,
    context: input.context ?? {},
    kind: input.kind,
    module_id: input.moduleId,
    recipient_user_id: recipientUserId,
    severity,
    title: input.title,
    workspace_id: input.workspaceId ?? null,
  }));

  const { error } = await client.from("hub_notifications").insert(rows);

  if (error) {
    // A linha e o canal primario da central; se falhar, ainda tentamos o push para
    // nao perder o aviso, mas nao propagamos o erro para o caller.
    logPublishError("insert", error);
  }

  if (input.push?.enabled === false) {
    return;
  }

  const pushPayload: HubWebPushPayload = {
    body: input.body ?? undefined,
    icon: input.push?.icon,
    tag: input.push?.tag ?? `${input.moduleId}:${input.kind}`,
    title: input.title,
    url: input.push?.url ?? input.actionHref ?? undefined,
  };

  await sendWebPushToUsers(recipients, pushPayload, client);
}

function logPublishError(stage: string, error: unknown) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message)
        : String(error);

  console.debug(`[hub-notifications] publish ${stage} error`, message);
}
