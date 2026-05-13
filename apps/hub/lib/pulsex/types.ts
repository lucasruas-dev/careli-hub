import type { ActivityFeedEventStatus } from "@repo/uix";

export type PulseXChannelKind =
  | "direct"
  | "operations"
  | "relation"
  | "system"
  | "technology";

export type PulseXChannel = {
  avatar: string;
  context: {
    filesCount: number;
    owner: string;
    priority?: "baixa" | "media" | "alta";
    status: string;
    unit: string;
  };
  departmentId?: string;
  departmentName?: string;
  description: string;
  id: string;
  kind: PulseXChannelKind;
  lastMessageAt: string;
  memberUserIds?: readonly string[];
  name: string;
  preview: string;
  sectorId?: string;
  sectorName?: string;
  status?: "online" | "away" | "busy" | "offline";
  unreadCount?: number;
};

export type PulseXDepartment = {
  id: string;
  name: string;
  slug: string;
};

export type PulseXSector = {
  departmentId: PulseXDepartment["id"];
  id: string;
  name: string;
  slug: string;
};

export type PulseXPresenceUser = {
  channelIds: readonly PulseXChannel["id"][];
  email?: string;
  id: string;
  initials: string;
  label: string;
  lastInteractionMinutesAgo?: number;
  role: string;
  status: "online" | "away" | "busy" | "offline";
  username?: string;
};

export type PulseXReaction = {
  count: number;
  emoji: string;
  reactedByUserIds: readonly PulseXPresenceUser["id"][];
};

export type PulseXReactionEmoji = string;

export type PulseXMessageTag =
  | "acompanhar"
  | "importante"
  | "pendente"
  | "resolvido"
  | "urgente";

export type PulseXMessageFilter = "all" | PulseXMessageTag;

export type PulseXMessageMention = {
  displayName: string;
  trigger: string;
  userId: PulseXPresenceUser["id"];
};

export type PulseXMessage = {
  attachment?: {
    label: string;
    type: "file" | "image" | "audio";
  };
  authorId: PulseXPresenceUser["id"];
  body: string;
  channelId: PulseXChannel["id"];
  deletedAt?: string;
  deliveredTo?: readonly PulseXPresenceUser["id"][];
  editedAt?: string;
  id: string;
  lastThreadReplyAt?: string;
  mentionAgeMinutes?: number;
  mentionRespondedAt?: string;
  mentionUserIds?: readonly PulseXPresenceUser["id"][];
  mentions?: readonly PulseXMessageMention[];
  readBy?: readonly PulseXPresenceUser["id"][];
  reactions?: readonly PulseXReaction[];
  status?: ActivityFeedEventStatus;
  tags?: readonly PulseXMessageTag[];
  threadCount?: number;
  timestamp: string;
};

export type PulseXThreadReply = {
  authorId: PulseXPresenceUser["id"];
  body: string;
  id: string;
  messageId: PulseXMessage["id"];
  timestamp: string;
};

export type PulseXFutureCapability =
  | "threads"
  | "reactions"
  | "mentions"
  | "uploads"
  | "calls"
  | "ai-assistant";

export type PulseXCallType = "audio" | "video";

export type PulseXCallStatus =
  | "active"
  | "ended"
  | "idle"
  | "missed"
  | "ringing";

export type PulseXCallParticipantStatus =
  | "invited"
  | "joined"
  | "left"
  | "muted";

export type PulseXCallParticipant = {
  avatarUrl?: string;
  id: string;
  initials: string;
  isCameraOn?: boolean;
  isMuted?: boolean;
  isScreenSharing?: boolean;
  label: string;
  presenceStatus: PulseXPresenceUser["status"];
  role: string;
  status: PulseXCallParticipantStatus;
  userId?: PulseXPresenceUser["id"];
};

export type PulseXCallSession = {
  channelId: PulseXChannel["id"];
  durationLabel?: string;
  endedAt?: string;
  id: string;
  initiatedByUserId?: PulseXPresenceUser["id"];
  participants: readonly PulseXCallParticipant[];
  startedAt?: string;
  status: PulseXCallStatus;
  title: string;
  type: PulseXCallType;
};
