import type {
  RealtimeConnectionStatus,
  RealtimeEvent,
  RealtimeEventSeverity,
  RealtimeModuleId,
  RealtimePresenceUser,
  RealtimeState,
} from "./types";

export type RealtimePulseState = "idle" | "live" | "syncing" | "delayed" | "offline";

export function createMockRealtimeState(): RealtimeState {
  return {
    channels: [
      {
        id: "hub",
        name: "Hub Central",
        workspaceId: "careli",
      },
      {
        id: "guardian-live",
        moduleId: "guardian",
        name: "Guardian Live",
        workspaceId: "careli",
      },
    ],
    connectionStatus: "connected",
    events: [
      {
        description: "Contrato realtime mockado ativo no Hub.",
        id: "evt-sync",
        moduleId: "pulsex",
        severity: "processing",
        timestamp: "agora",
        title: "Realtime layer conectado",
        type: "sync",
      },
      {
        description: "Registry, auth e permissoes prontos para eventos vivos.",
        id: "evt-registry",
        moduleId: "guardian",
        severity: "success",
        timestamp: "2 min",
        title: "Base operacional sincronizada",
        type: "module",
      },
      {
        description: "Notificacoes ainda sem backend real.",
        id: "evt-notification",
        severity: "info",
        timestamp: "5 min",
        title: "Canal de notificacoes preparado",
        type: "notification",
      },
    ],
    notifications: [
      {
        id: "ntf-guardian",
        moduleId: "guardian",
        read: false,
        severity: "success",
        timestamp: "agora",
        title: "Guardian pronto para eventos",
      },
      {
        id: "ntf-pulsex",
        moduleId: "pulsex",
        read: false,
        severity: "info",
        timestamp: "2 min",
        title: "PulseX aguardando backend",
      },
      {
        id: "ntf-drive",
        moduleId: "drive",
        read: true,
        severity: "neutral",
        timestamp: "10 min",
        title: "Drive registrado",
      },
    ],
    presence: [
      {
        id: "ana",
        initials: "AN",
        label: "Ana",
        status: "online",
        workspaceId: "careli",
      },
      {
        id: "leo",
        initials: "LS",
        label: "Leo",
        status: "away",
        workspaceId: "careli",
      },
      {
        id: "mia",
        initials: "MR",
        label: "Mia",
        status: "online",
        workspaceId: "careli",
      },
      {
        id: "rui",
        initials: "RS",
        label: "Rui",
        status: "busy",
        workspaceId: "careli",
      },
      {
        id: "bia",
        initials: "BC",
        label: "Bia",
        status: "offline",
        workspaceId: "careli",
      },
    ],
  };
}

export function getUnreadNotificationsCount(state: RealtimeState): number {
  return state.notifications.filter((notification) => !notification.read).length;
}

export function filterEventsByModule(
  events: readonly RealtimeEvent[],
  moduleId: RealtimeModuleId,
): RealtimeEvent[] {
  return events.filter((event) => event.moduleId === moduleId);
}

export function filterEventsBySeverity(
  events: readonly RealtimeEvent[],
  severity: RealtimeEventSeverity,
): RealtimeEvent[] {
  return events.filter((event) => event.severity === severity);
}

export function getOnlinePresenceUsers(
  presence: readonly RealtimePresenceUser[],
): RealtimePresenceUser[] {
  return presence.filter((user) => user.status === "online");
}

export function mapConnectionStatusToPulseState(
  status: RealtimeConnectionStatus,
): RealtimePulseState {
  const statusMap: Record<RealtimeConnectionStatus, RealtimePulseState> = {
    connected: "live",
    delayed: "delayed",
    idle: "idle",
    offline: "offline",
    syncing: "syncing",
  };

  return statusMap[status];
}
