import type { ActivityFeedEventStatus } from "@repo/uix";

export type HermesChannelKind =
  | "direct"
  | "operations"
  | "relation"
  | "system"
  | "technology";

export type HermesChannel = {
  accessType?: "department_channel" | "private_group" | "sector_channel";
  avatar: string;
  avatarUrl?: string;
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
  kind: HermesChannelKind;
  lastMessageAt: string;
  memberReadAtByUserId?: Readonly<Record<string, string>>;
  memberUserIds?: readonly string[];
  name: string;
  preview: string;
  sectorId?: string;
  sectorName?: string;
  status?: "online" | "away" | "busy" | "lunch" | "agenda" | "offline";
  unreadCount?: number;
};

export type HermesDepartment = {
  id: string;
  name: string;
  slug: string;
};

export type HermesSector = {
  departmentId: HermesDepartment["id"];
  id: string;
  name: string;
  slug: string;
};

export type HermesPresenceUser = {
  avatarUrl?: string;
  channelIds: readonly HermesChannel["id"][];
  departmentId?: string;
  departmentName?: string;
  email?: string;
  id: string;
  initials: string;
  label: string;
  lastInteractionMinutesAgo?: number;
  role: string;
  sectorId?: string;
  sectorName?: string;
  status: "online" | "away" | "busy" | "lunch" | "agenda" | "offline";
  username?: string;
};

export type HermesReaction = {
  count: number;
  emoji: string;
  reactedByUserIds: readonly HermesPresenceUser["id"][];
};

export type HermesReactionEmoji = string;

export type HermesMessageTag =
  | "acompanhar"
  | "importante"
  | "pendente"
  | "resolvido"
  | "urgente";

export type HermesMessageFilter = "all" | "mentions" | HermesMessageTag;

export type HermesMessageMention = {
  displayName: string;
  trigger: string;
  userId: HermesPresenceUser["id"];
};

export type HermesMessageAttachment = {
  durationSeconds?: number;
  emoji?: string;
  label: string;
  mimeType?: string;
  sizeBytes?: number;
  stickerId?: string;
  type: "audio" | "file" | "image" | "sticker" | "video";
  url?: string;
};

export type HermesMessage = {
  attachment?: HermesMessageAttachment;
  authorAvatarUrl?: string;
  authorId: HermesPresenceUser["id"];
  authorName?: string;
  body: string;
  channelId: HermesChannel["id"];
  clientMessageId?: string;
  createdAt?: string;
  deletedAt?: string;
  deliveryStatus?: "pending" | "sent" | "delivered" | "read" | "failed";
  deliveredTo?: readonly HermesPresenceUser["id"][];
  editedAt?: string;
  id: string;
  lastThreadReplyAt?: string;
  mentionAgeMinutes?: number;
  mentionRespondedAt?: string;
  mentionUserIds?: readonly HermesPresenceUser["id"][];
  mentions?: readonly HermesMessageMention[];
  readBy?: readonly HermesPresenceUser["id"][];
  reactions?: readonly HermesReaction[];
  status?: ActivityFeedEventStatus;
  tags?: readonly HermesMessageTag[];
  threadParentMessageId?: string;
  threadCount?: number;
  timestamp: string;
};

export type HermesThreadReply = {
  attachment?: HermesMessageAttachment;
  authorAvatarUrl?: string;
  authorId: HermesPresenceUser["id"];
  authorName?: string;
  body: string;
  channelId: HermesChannel["id"];
  createdAt?: string;
  id: string;
  mentionUserIds?: readonly HermesPresenceUser["id"][];
  mentions?: readonly HermesMessageMention[];
  messageId: HermesMessage["id"];
  reactions?: readonly HermesReaction[];
  tags?: readonly HermesMessageTag[];
  timestamp: string;
};

export type HermesFutureCapability =
  | "threads"
  | "reactions"
  | "mentions"
  | "uploads"
  | "calls"
  | "ai-assistant";

export type HermesCallType = "audio" | "video";

export type HermesCallStatus =
  | "active"
  | "ended"
  | "idle"
  | "missed"
  | "ringing";

export type HermesCallHistoryDirection = "incoming" | "outgoing";

export type HermesCallHistoryStatus =
  | "answered"
  | "declined"
  | "ended"
  | "missed"
  | "ringing";

export type HermesCallParticipantStatus =
  | "invited"
  | "joined"
  | "left"
  | "muted";

export type HermesCallParticipant = {
  avatarUrl?: string;
  id: string;
  initials: string;
  isCameraOn?: boolean;
  isMuted?: boolean;
  isScreenSharing?: boolean;
  label: string;
  presenceStatus: HermesPresenceUser["status"];
  role: string;
  status: HermesCallParticipantStatus;
  userId?: HermesPresenceUser["id"];
};

export type HermesCallSession = {
  channelId: HermesChannel["id"];
  durationLabel?: string;
  endedAt?: string;
  id: string;
  initiatedByUserId?: HermesPresenceUser["id"];
  participants: readonly HermesCallParticipant[];
  startedAt?: string;
  status: HermesCallStatus;
  title: string;
  type: HermesCallType;
};

export type HermesCallHistoryEntry = {
  callId: HermesCallSession["id"];
  callerAvatarUrl?: string;
  callerName: string;
  callerUserId?: HermesPresenceUser["id"];
  channelId: HermesChannel["id"];
  channelName: string;
  direction: HermesCallHistoryDirection;
  durationLabel?: string;
  endedAt?: string;
  id: string;
  isUnread?: boolean;
  participantNames: readonly string[];
  startedAt: string;
  status: HermesCallHistoryStatus;
  type: HermesCallType;
};

export type HermesCallSignalKind =
  | "answer"
  | "decline"
  | "end"
  | "ice-candidate"
  | "invite"
  | "join"
  | "leave"
  | "offer"
  | "screen-share-start"
  | "screen-share-stop";

export type HermesCallRealtimeSignal = {
  callId: HermesCallSession["id"];
  candidate?: RTCIceCandidateInit | null;
  channelId: HermesChannel["id"];
  description?: RTCSessionDescriptionInit;
  fromUserId: HermesPresenceUser["id"];
  id: string;
  kind: HermesCallSignalKind;
  participant?: HermesCallParticipant;
  sentAt: string;
  session?: HermesCallSession;
  targetUserIds?: readonly HermesPresenceUser["id"][];
  toUserId?: HermesPresenceUser["id"];
};

export type HermesCallRealtimeSignalInput = Omit<
  HermesCallRealtimeSignal,
  "fromUserId" | "id" | "sentAt"
> & {
  fromUserId?: HermesPresenceUser["id"];
};
