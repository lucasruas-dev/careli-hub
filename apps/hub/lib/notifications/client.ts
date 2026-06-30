"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  PanteonNotificationItem,
  PanteonNotificationKind,
  PanteonNotificationSeverity,
} from "@/lib/panteon-notifications";

// Cliente da central unica (hub_notifications). Mapeia a linha do banco para o item
// que a central ja renderiza e expoe a busca inicial + marcar-lida (RLS escopa ao
// proprio destinatario). Hermes continua no seu caminho proprio; aqui entram os
// demais modulos (Zeus, Iris, Hades...).

export const HUB_NOTIFICATION_ITEM_PREFIX = "hub:";
export const HUB_NOTIFICATIONS_REALTIME_TOPIC = "hub-notifications-central";

const HUB_NOTIFICATION_SELECT =
  "id,recipient_user_id,module_id,kind,severity,title,body,action_href,context,read_at,created_at";

const MODULE_LABELS: Record<string, string> = {
  agenda: "Meu dia",
  apolo: "Apolo",
  atlas: "Atlas",
  chronos: "Chronos",
  hades: "Hades",
  hermes: "Hermes",
  iris: "Iris",
  panteon: "Panteon",
  setup: "Setup",
  zeus: "Zeus",
};

const VALID_KINDS = new Set<PanteonNotificationKind>([
  "agenda",
  "alerta",
  "atendimento",
  "mensagem",
  "operacao",
  "sistema",
  "tarefa",
]);

const VALID_SEVERITIES = new Set<PanteonNotificationSeverity>([
  "danger",
  "info",
  "neutral",
  "success",
  "warning",
]);

export type HubNotificationRow = {
  action_href: string | null;
  body: string | null;
  context: Record<string, unknown> | null;
  created_at: string;
  id: string;
  kind: string | null;
  module_id: string | null;
  read_at: string | null;
  recipient_user_id: string;
  severity: string | null;
  title: string;
};

export function getHubNotificationModuleLabel(moduleId: string): string {
  return MODULE_LABELS[moduleId] ?? "Panteon";
}

export function isHubNotificationItemId(id: string): boolean {
  return id.startsWith(HUB_NOTIFICATION_ITEM_PREFIX);
}

export function getHubNotificationRowId(itemId: string): string | null {
  return isHubNotificationItemId(itemId)
    ? itemId.slice(HUB_NOTIFICATION_ITEM_PREFIX.length)
    : null;
}

export function mapHubNotificationRow(
  row: HubNotificationRow,
): PanteonNotificationItem {
  const moduleId = row.module_id ?? "panteon";
  const kind =
    row.kind && VALID_KINDS.has(row.kind as PanteonNotificationKind)
      ? (row.kind as PanteonNotificationKind)
      : "sistema";
  const severity =
    row.severity && VALID_SEVERITIES.has(row.severity as PanteonNotificationSeverity)
      ? (row.severity as PanteonNotificationSeverity)
      : "neutral";

  return {
    actionLabel: row.action_href ? "Abrir" : "Ver",
    context: (row.context ?? {}) as PanteonNotificationItem["context"],
    createdAt: row.created_at,
    description: row.body ?? undefined,
    href: row.action_href ?? undefined,
    id: `${HUB_NOTIFICATION_ITEM_PREFIX}${row.id}`,
    kind,
    moduleId,
    moduleLabel: getHubNotificationModuleLabel(moduleId),
    read: row.read_at !== null,
    severity,
    title: row.title,
  };
}

export async function fetchRecentHubNotifications(
  client: SupabaseClient,
  recipientUserId: string,
): Promise<PanteonNotificationItem[]> {
  const sinceIso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await client
    .from("hub_notifications")
    .select(HUB_NOTIFICATION_SELECT)
    .eq("recipient_user_id", recipientUserId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(150);

  if (error || !data) {
    return [];
  }

  return (data as HubNotificationRow[]).map(mapHubNotificationRow);
}

export async function markHubNotificationRowsRead(
  client: SupabaseClient,
  rowIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(rowIds.filter(Boolean))];

  if (ids.length === 0) {
    return;
  }

  await client
    .from("hub_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .is("read_at", null);
}
