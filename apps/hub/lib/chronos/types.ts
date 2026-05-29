export const chronosMeetingTypes = [
  "executive",
  "external",
  "client",
  "results",
  "alignment",
  "formal",
] as const;

export const chronosMeetingStatuses = [
  "scheduled",
  "lobby",
  "live",
  "review",
  "closed",
  "cancelled",
] as const;

export const chronosCaptureStatuses = [
  "not_started",
  "pending",
  "recording",
  "processing",
  "available",
  "failed",
] as const;

export const chronosMinutesStatuses = [
  "not_started",
  "draft",
  "in_review",
  "approved",
  "rejected",
] as const;

export const chronosParticipantRoles = [
  "host",
  "presenter",
  "participant",
  "external",
  "reviewer",
] as const;

export const chronosFollowUpStatuses = [
  "open",
  "in_progress",
  "done",
  "cancelled",
] as const;

export const chronosEventTypes = [
  "created",
  "scheduled",
  "joined",
  "left",
  "screen_shared",
  "recording_started",
  "recording_stopped",
  "transcript_added",
  "summary_generated",
  "minutes_drafted",
  "minutes_submitted",
  "minutes_approved",
  "followup_created",
  "followup_done",
  "note",
] as const;

export type ChronosMeetingType = (typeof chronosMeetingTypes)[number];
export type ChronosMeetingStatus = (typeof chronosMeetingStatuses)[number];
export type ChronosCaptureStatus = (typeof chronosCaptureStatuses)[number];
export type ChronosMinutesStatus = (typeof chronosMinutesStatuses)[number];
export type ChronosParticipantRole = (typeof chronosParticipantRoles)[number];
export type ChronosFollowUpStatus = (typeof chronosFollowUpStatuses)[number];
export type ChronosEventType = (typeof chronosEventTypes)[number];
export type ChronosMeetingLocationMode = "offline" | "online";

export const chronosMinutesProfiles = [
  "comunicado",
  "resultado",
  "alinhamento",
] as const;

export type ChronosMinutesProfile = (typeof chronosMinutesProfiles)[number];

export const chronosMinutesProfileLabels = {
  comunicado: "Comunicado",
  resultado: "Resultado",
  alinhamento: "Alinhamento",
} as const satisfies Record<ChronosMinutesProfile, string>;

export type ChronosMeetingProfile = {
  createdAt?: string;
  description: string;
  id: string;
  isDefault: boolean;
  label: string;
  meetingType: ChronosMeetingType;
  status: "active" | "archived";
  updatedAt?: string;
};

export type ChronosMeetingProfileInput = {
  description?: string;
  label: string;
  meetingType?: ChronosMeetingType;
};

export type ChronosMeetingProfileDeleteInput = {
  profileId: string;
};

export const defaultChronosMeetingProfiles = [
  {
    description: "Reunioes de alinhamento interno ou externo com rastreabilidade formal.",
    id: "alignment",
    isDefault: true,
    label: "Alinhamento",
    meetingType: "alignment",
    status: "active",
  },
  {
    description: "Apresentacoes de resultado com gravacao, transcricao e ata revisada.",
    id: "results",
    isDefault: true,
    label: "Resultado",
    meetingType: "results",
    status: "active",
  },
  {
    description: "Comunicados formais com registro, participantes e memoria executiva.",
    id: "announcement",
    isDefault: true,
    label: "Comunicado",
    meetingType: "formal",
    status: "active",
  },
] as const satisfies ChronosMeetingProfile[];

export type ChronosApoloInvitee = {
  displayName: string;
  email?: string;
  entityId: string;
  organization?: string;
  phone?: string;
};

export type ChronosGoogleCalendarEnvClassification =
  | "identifier"
  | "operational"
  | "server_secret";

export type ChronosGoogleCalendarEnvRequirement = {
  classification: ChronosGoogleCalendarEnvClassification;
  name: string;
  required: boolean;
};

export type ChronosGoogleCalendarConnectionStatus = {
  calendarId?: string;
  connected: boolean;
  connectedAt?: string | null;
  lastError?: string | null;
  lastSyncedAt?: string | null;
  push?: {
    active: boolean;
    expiresAt?: string | null;
    lastError?: string | null;
    lastNotificationAt?: string | null;
    status: "active" | "error" | "expired" | "missing";
  };
  storageReady: boolean;
  syncTokenPresent?: boolean;
};

export type ChronosGoogleCalendarStatus = {
  authorizationPath: string;
  callbackPath: string;
  configured: boolean;
  connection: ChronosGoogleCalendarConnectionStatus;
  missingEnvNames: string[];
  provider: "google-calendar";
  redirectUriEnvName: string;
  requiredEnvNames: string[];
  scopes: string[];
  status:
    | "blocked"
    | "connected"
    | "ready_to_authorize"
    | "ready_to_configure"
    | "storage_pending";
  syncPath: string;
};

export type ChronosGoogleCalendarSyncDirection = "both" | "pull" | "push";

export type ChronosGoogleCalendarSyncResult = {
  direction: ChronosGoogleCalendarSyncDirection;
  error?: string;
  processed: number;
  skipped: number;
  status: "failed" | "skipped" | "success";
  synced: number;
};

export type ChronosRoom = {
  capacity: number;
  id: string;
  metadata: Record<string, unknown>;
  minutesRequired: boolean;
  name: string;
  recordingRequired: boolean;
  roomType: string;
  slug: string;
  status: "active" | "archived" | "disabled";
  transcriptionRequired: boolean;
};

export type ChronosParticipant = {
  attendanceStatus: string;
  displayName: string;
  email?: string | null;
  id: string;
  organization?: string | null;
  role: ChronosParticipantRole;
  userId?: string | null;
};

export type ChronosTimelineEvent = {
  description?: string | null;
  eventAt: string;
  eventType: ChronosEventType;
  id: string;
  title: string;
};

export type ChronosTranscriptSegment = {
  content: string;
  createdAt: string;
  endedAt?: string | null;
  id: string;
  source: string;
  speakerLabel?: string | null;
  startedAt?: string | null;
};

export type ChronosChatMessage = {
  content: string;
  createdAt: string;
  id: string;
  participantId?: string | null;
  senderName: string;
};

export type ChronosMinutes = {
  approvedAt?: string | null;
  approvedByUserId?: string | null;
  content: string;
  createdAt: string;
  id: string;
  status: ChronosMinutesStatus;
  version: number;
};

export type ChronosFollowUp = {
  completedAt?: string | null;
  dueAt?: string | null;
  id: string;
  ownerName?: string | null;
  ownerUserId?: string | null;
  status: ChronosFollowUpStatus;
  title: string;
};

export type ChronosRecording = {
  downloadUrl?: string | null;
  durationSeconds?: number | null;
  fileName?: string | null;
  id: string;
  mimeType?: string | null;
  playbackUrl?: string | null;
  sizeBytes?: number | null;
  startedAt?: string | null;
  status: ChronosCaptureStatus;
  stoppedAt?: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
};

export type ChronosMeeting = {
  chatMessages?: ChronosChatMessage[];
  createdAt: string;
  endsAt?: string | null;
  executiveSummary?: string | null;
  externalReference?: string | null;
  followUps: ChronosFollowUp[];
  hostName?: string | null;
  hostUserId?: string | null;
  id: string;
  meetingType: ChronosMeetingType;
  metadata: Record<string, unknown>;
  minutes: ChronosMinutes[];
  minutesStatus: ChronosMinutesStatus;
  objective?: string | null;
  participants: ChronosParticipant[];
  protocol: string;
  recordingStatus: ChronosCaptureStatus;
  recordings: ChronosRecording[];
  room?: ChronosRoom | null;
  roomId?: string | null;
  startsAt?: string | null;
  status: ChronosMeetingStatus;
  timeline: ChronosTimelineEvent[];
  title: string;
  transcriptionStatus: ChronosCaptureStatus;
  transcript: ChronosTranscriptSegment[];
  updatedAt: string;
};

export type ChronosStorageStatus =
  | "local"
  | "migration_pendente"
  | "offline"
  | "supabase";

export type ChronosSnapshot = {
  meetings: ChronosMeeting[];
  profiles: ChronosMeetingProfile[];
  rooms: ChronosRoom[];
  storage: {
    message?: string;
    status: ChronosStorageStatus;
  };
};

export type ChronosCreateMeetingInput = {
  agenda?: string[];
  apoloInvitees?: ChronosApoloInvitee[];
  endsAt?: string;
  externalReference?: string;
  locationAddress?: string;
  locationMode?: ChronosMeetingLocationMode;
  meetingType: ChronosMeetingType;
  objective?: string;
  participants?: Array<{
    displayName: string;
    email?: string;
    organization?: string;
    role?: ChronosParticipantRole;
  }>;
  profileId?: string;
  roomId?: string;
  startsAt?: string;
  title: string;
};

export type ChronosRoomInput = {
  backgroundDataUrl?: string;
  backgroundName?: string;
  capacity?: number;
  minutesRequired?: boolean;
  name: string;
  recordingRequired?: boolean;
  roomType?: string;
  slug?: string;
  transcriptionRequired?: boolean;
};

export type ChronosRoomUpdateInput = Partial<ChronosRoomInput> & {
  roomId: string;
};

export type ChronosRoomDeleteInput = {
  roomId: string;
};

export type ChronosPublicRoom = {
  backgroundDataUrl?: string;
  backgroundName?: string;
  capacity: number;
  externalPath: string;
  id: string;
  minutesRequired: boolean;
  name: string;
  recordingRequired: boolean;
  roomType: string;
  slug: string;
  transcriptionRequired: boolean;
};

export type ChronosPublicParticipantInput = {
  displayName?: string;
  organization?: string;
};

export type ChronosPublicJoinResult = {
  athenaNotice: string;
  isHost: boolean;
  meetingId: string;
  reservation: {
    endsAt?: string | null;
    protocol: string;
    startsAt?: string | null;
    title: string;
  };
  participant: {
    displayName: string;
    id: string;
    organization?: string;
    role: ChronosParticipantRole;
    userId?: string;
  };
  room: ChronosPublicRoom;
};

export type ChronosUpdateInput =
  | {
      action: "set_status";
      meetingId: string;
      status: ChronosMeetingStatus;
    }
  | {
      action: "mark_recording";
      durationSeconds?: number;
      meetingId: string;
      status: ChronosCaptureStatus;
    }
  | {
      action: "add_transcript";
      content: string;
      meetingId: string;
      source?: "athena" | "browser" | "manual" | "openai";
      speakerLabel?: string;
    }
  | {
      action: "save_summary";
      meetingId: string;
      summary: string;
    }
  | {
      action: "save_minutes";
      content: string;
      meetingId: string;
      status: ChronosMinutesStatus;
    }
  | {
      action: "create_followup";
      dueAt?: string;
      meetingId: string;
      ownerName?: string;
      title: string;
    }
  | {
      action: "complete_followup";
      followUpId: string;
      meetingId: string;
    }
  | {
      action: "add_timeline_event";
      description?: string;
      eventType?: ChronosEventType;
      meetingId: string;
      title: string;
    };

export const chronosMeetingTypeLabels = {
  alignment: "Alinhamento",
  client: "Cliente",
  executive: "Executiva",
  external: "Externa",
  formal: "Formal",
  results: "Resultado",
} as const satisfies Record<ChronosMeetingType, string>;

export const chronosMeetingStatusLabels = {
  cancelled: "Cancelada",
  closed: "Fechada",
  live: "Ao vivo",
  lobby: "Entrada",
  review: "Revisao",
  scheduled: "Agendada",
} as const satisfies Record<ChronosMeetingStatus, string>;

export const chronosCaptureStatusLabels = {
  available: "Disponivel",
  failed: "Falha",
  not_started: "Nao iniciada",
  pending: "Pendente",
  processing: "Processando",
  recording: "Gravando",
} as const satisfies Record<ChronosCaptureStatus, string>;

export const chronosMinutesStatusLabels = {
  approved: "Aprovada",
  draft: "Rascunho",
  in_review: "Revisao humana",
  not_started: "Nao iniciada",
  rejected: "Rejeitada",
} as const satisfies Record<ChronosMinutesStatus, string>;

export const chronosFollowUpStatusLabels = {
  cancelled: "Cancelado",
  done: "Concluido",
  in_progress: "Em andamento",
  open: "Aberto",
} as const satisfies Record<ChronosFollowUpStatus, string>;
