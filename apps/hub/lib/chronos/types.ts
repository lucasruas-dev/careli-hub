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

export type ChronosRoom = {
  capacity: number;
  id: string;
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
  id: string;
  source: string;
  speakerLabel?: string | null;
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
  durationSeconds?: number | null;
  id: string;
  startedAt?: string | null;
  status: ChronosCaptureStatus;
  stoppedAt?: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
};

export type ChronosMeeting = {
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
  rooms: ChronosRoom[];
  storage: {
    message?: string;
    status: ChronosStorageStatus;
  };
};

export type ChronosCreateMeetingInput = {
  agenda?: string[];
  externalReference?: string;
  meetingType: ChronosMeetingType;
  objective?: string;
  participants?: Array<{
    displayName: string;
    email?: string;
    organization?: string;
    role?: ChronosParticipantRole;
  }>;
  roomId?: string;
  startsAt?: string;
  title: string;
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
