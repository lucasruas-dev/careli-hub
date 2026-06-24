"use client";

import {
  getHubHomeSnapshot,
  type HubHomeActivityEvent,
  type HubHomeModule,
  type HubHomeSnapshot,
} from "@/lib/hub-home";
import type { HermesChannel } from "@/lib/pulsex";

export const PANTEON_ACTIVITY_NOTIFICATION_PREFIX = "activity:";

export type PanteonNotificationKind =
  | "agenda"
  | "alerta"
  | "atendimento"
  | "mensagem"
  | "operacao"
  | "sistema"
  | "tarefa";

export type PanteonNotificationSeverity =
  | "danger"
  | "info"
  | "neutral"
  | "success"
  | "warning";

export type PanteonNotificationItem = {
  actionLabel?: string;
  createdAt: string;
  description?: string;
  href?: string;
  id: string;
  kind: PanteonNotificationKind;
  moduleId: string;
  moduleLabel: string;
  read: boolean;
  severity: PanteonNotificationSeverity;
  title: string;
  context?: {
    hermesChannelId?: HermesChannel["id"];
    entityId?: string;
    entityType?: string;
    threadParentMessageId?: string;
  };
};

export type PanteonNotificationInput = Omit<
  PanteonNotificationItem,
  "createdAt" | "id" | "read" | "severity"
> & {
  createdAt?: string;
  id?: string;
  read?: boolean;
  severity?: PanteonNotificationSeverity;
};

export async function listPanteonActivityNotifications() {
  const snapshot = await getHubHomeSnapshot();

  return mapHomeActivityEventsToNotifications(snapshot);
}

export function mapHomeActivityEventsToNotifications(
  snapshot: HubHomeSnapshot,
): PanteonNotificationInput[] {
  const modulesById = new Map(
    snapshot.modules.map((module) => [module.id, module]),
  );

  return snapshot.activityEvents
    .filter(isActionableActivityEvent)
    .map((event) =>
      mapHomeActivityEventToNotification({
        event,
        module: event.moduleId ? modulesById.get(event.moduleId) : undefined,
      }),
    );
}

function isActionableActivityEvent(event: HubHomeActivityEvent) {
  if (event.moduleId === "hermes") {
    return false;
  }

  return event.type !== "presence";
}

function mapHomeActivityEventToNotification({
  event,
  module,
}: {
  event: HubHomeActivityEvent;
  module?: HubHomeModule;
}): PanteonNotificationInput {
  const moduleId = event.moduleId ?? "panteon";
  const href = getActivityEventHref(event, module);

  return {
    actionLabel: href ? "Abrir" : "Ver",
    context: {
      entityId: event.id,
      entityType: event.type,
    },
    createdAt: event.createdAt,
    description: event.description,
    href,
    id: `${PANTEON_ACTIVITY_NOTIFICATION_PREFIX}${event.id}`,
    kind: getActivityEventKind(event),
    moduleId,
    moduleLabel: module?.name ?? getFallbackModuleLabel(moduleId),
    read: isReadByDefault(event),
    severity: event.severity,
    title: event.title,
  };
}

function getActivityEventHref(
  event: HubHomeActivityEvent,
  module?: HubHomeModule,
) {
  const metadataHref = event.metadata.href;

  if (typeof metadataHref === "string" && metadataHref.trim()) {
    return metadataHref;
  }

  return module?.basePath;
}

function getActivityEventKind(
  event: HubHomeActivityEvent,
): PanteonNotificationKind {
  if (event.severity === "danger" || event.severity === "warning") {
    return "alerta";
  }

  const kindsByType = {
    module: "operacao",
    notification: "sistema",
    presence: "sistema",
    sync: "operacao",
    system: "sistema",
  } as const satisfies Record<
    HubHomeActivityEvent["type"],
    PanteonNotificationKind
  >;

  return kindsByType[event.type];
}

function isReadByDefault(event: HubHomeActivityEvent) {
  return event.severity === "neutral" || event.severity === "success";
}

function getFallbackModuleLabel(moduleId: string) {
  const labelsByModule: Record<string, string> = {
    apolo: "Apolo",
    atlas: "Atlas",
    chronos: "Chronos",
    hades: "Hades",
    hermes: "Hermes",
    iris: "Iris",
    panteon: "Panteon",
    setup: "Setup",
  };

  return labelsByModule[moduleId] ?? "Panteon";
}

// Renovacao diaria do historico de notificacoes: confere se a notificacao e de HOJE
// (fuso America/Sao_Paulo). Lidas de dias anteriores saem do historico ao virar o dia.
const panteonNotificationDayFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
  year: "numeric",
});

export function isPanteonNotificationFromToday(createdAt: string): boolean {
  const time = Date.parse(createdAt);

  if (Number.isNaN(time)) {
    return false;
  }

  return (
    panteonNotificationDayFormatter.format(new Date(time)) ===
    panteonNotificationDayFormatter.format(new Date())
  );
}
