import type { hubModules } from "@repo/shared";

export type RealtimeModuleId = (typeof hubModules)[number]["id"];

export type RealtimeConnectionStatus =
  | "idle"
  | "connected"
  | "syncing"
  | "delayed"
  | "offline";

export type RealtimeEventType =
  | "system"
  | "module"
  | "notification"
  | "presence"
  | "sync";

export type RealtimeEventSeverity =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "processing";

export type RealtimeEvent = {
  description?: string;
  id: string;
  moduleId?: RealtimeModuleId;
  severity: RealtimeEventSeverity;
  timestamp: string;
  title: string;
  type: RealtimeEventType;
};

export type RealtimeNotification = {
  id: string;
  moduleId?: RealtimeModuleId;
  read: boolean;
  severity: RealtimeEventSeverity;
  timestamp: string;
  title: string;
};

export type RealtimePresenceStatus = "online" | "away" | "busy" | "offline";

export type RealtimePresenceUser = {
  id: string;
  initials: string;
  label: string;
  moduleId?: RealtimeModuleId;
  status: RealtimePresenceStatus;
  workspaceId?: string;
};

export type RealtimeChannel = {
  id: string;
  moduleId?: RealtimeModuleId;
  name: string;
  workspaceId?: string;
};

export type RealtimeState = {
  channels: readonly RealtimeChannel[];
  connectionStatus: RealtimeConnectionStatus;
  events: readonly RealtimeEvent[];
  notifications: readonly RealtimeNotification[];
  presence: readonly RealtimePresenceUser[];
};

export type RealtimeAdapter = {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  getState: () => Promise<RealtimeState>;
  subscribe?: (channel: RealtimeChannel) => () => void;
};
