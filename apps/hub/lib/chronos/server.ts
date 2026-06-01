import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getPermissionsForRole } from "@repo/shared";

import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import {
  chronosCaptureStatuses,
  chronosCalendarEventKinds,
  chronosEventTypes,
  chronosMeetingStatuses,
  chronosMeetingTypes,
  chronosMinutesStatuses,
  chronosParticipantRoles,
  defaultChronosMeetingProfiles,
  type ChronosApoloInvitee,
  type ChronosCalendarEventKind,
  type ChronosCaptureStatus,
  type ChronosChatMessage,
  type ChronosCreateMeetingInput,
  type ChronosEventType,
  type ChronosFollowUp,
  type ChronosFollowUpStatus,
  type ChronosHubInvitee,
  type ChronosMeeting,
  type ChronosMeetingDeleteInput,
  type ChronosMeetingProfile,
  type ChronosMeetingStatus,
  type ChronosMeetingType,
  type ChronosMinutes,
  type ChronosMinutesStatus,
  type ChronosParticipant,
  type ChronosParticipantRole,
  type ChronosPublicJoinResult,
  type ChronosPublicParticipantInput,
  type ChronosPublicRoom,
  type ChronosRecording,
  type ChronosRoom,
  type ChronosRoomDeleteInput,
  type ChronosRoomInput,
  type ChronosRoomUpdateInput,
  type ChronosSnapshot,
  type ChronosTimelineEvent,
  type ChronosTranscriptSegment,
  type ChronosUpdateInput,
} from "./types";
import { normalizeChronosDateTime } from "./datetime";
import { syncChronosMeetingToGoogleCalendar } from "./google-calendar";

type ChronosUserRow = {
  avatar_url?: string | null;
  display_name: string;
  email: string;
  id: string;
  operational_profile?: string | null;
  role: "admin" | "leader" | "operator" | "viewer";
  status: "active" | "archived" | "disabled";
};

type AuthorizedChronosUser = {
  email: string;
  id: string;
  name: string;
  operationalProfile?: string | null;
  role: ChronosUserRow["role"];
};

export class ChronosForbiddenError extends Error {
  constructor(message = "Usuario sem permissao para gerenciar o Chronos.") {
    super(message);
    this.name = "ChronosForbiddenError";
  }
}

type ChronosRoomRow = {
  capacity: number;
  created_by_user_id: string | null;
  id: string;
  metadata: Record<string, unknown>;
  minutes_required: boolean;
  name: string;
  recording_required: boolean;
  room_type: string;
  slug: string;
  status: "active" | "archived" | "disabled";
  transcription_required: boolean;
};

type ChronosMeetingRow = {
  created_at: string;
  ends_at: string | null;
  executive_summary: string | null;
  external_reference: string | null;
  host_name: string | null;
  host_user_id: string | null;
  id: string;
  meeting_type: ChronosMeetingType;
  metadata: Record<string, unknown>;
  minutes_status: ChronosMinutesStatus;
  objective: string | null;
  protocol: string;
  recording_status: ChronosCaptureStatus;
  room_id: string | null;
  starts_at: string | null;
  status: ChronosMeetingStatus;
  title: string;
  transcription_status: ChronosCaptureStatus;
  updated_at: string;
};

type ChronosParticipantRow = {
  attendance_status: string;
  created_at: string;
  display_name: string;
  email: string | null;
  id: string;
  joined_at: string | null;
  left_at: string | null;
  meeting_id: string;
  metadata: Record<string, unknown>;
  organization: string | null;
  role: ChronosParticipantRole;
  updated_at: string;
  user_id: string | null;
};

type ChronosTimelineEventRow = {
  actor_user_id: string | null;
  created_at: string;
  description: string | null;
  event_at: string;
  event_type: ChronosEventType;
  id: string;
  meeting_id: string;
  metadata: Record<string, unknown>;
  title: string;
};

type ChronosTranscriptSegmentRow = {
  content: string;
  created_at: string;
  created_by_user_id: string | null;
  ended_at: string | null;
  id: string;
  meeting_id: string;
  metadata: Record<string, unknown>;
  source: string;
  speaker_label: string | null;
  started_at: string | null;
};

type ChronosChatMessageRow = {
  content: string;
  created_at: string;
  id: string;
  meeting_id: string;
  metadata: Record<string, unknown>;
  participant_id: string | null;
  sender_name: string;
};

type ChronosMinutesRow = {
  approved_at: string | null;
  approved_by_user_id: string | null;
  content: string;
  created_at: string;
  created_by_user_id: string | null;
  id: string;
  meeting_id: string;
  metadata: Record<string, unknown>;
  reviewed_at: string | null;
  reviewer_user_id: string | null;
  status: ChronosMinutesStatus;
  updated_at: string;
  version: number;
};

type ChronosFollowUpRow = {
  completed_at: string | null;
  created_at: string;
  created_by_user_id: string | null;
  due_at: string | null;
  id: string;
  meeting_id: string;
  metadata: Record<string, unknown>;
  owner_name: string | null;
  owner_user_id: string | null;
  status: ChronosFollowUpStatus;
  title: string;
  updated_at: string;
};

type ChronosRecordingRow = {
  created_at: string;
  created_by_user_id: string | null;
  duration_seconds: number | null;
  file_name?: string | null;
  id: string;
  meeting_id: string;
  metadata: Record<string, unknown>;
  mime_type?: string | null;
  size_bytes?: number | null;
  started_at: string | null;
  status: ChronosCaptureStatus;
  stopped_at: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  uploaded_at?: string | null;
  updated_at: string;
};

type ChronosDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: {
      chronos_capture_status: ChronosCaptureStatus;
      chronos_event_type: ChronosEventType;
      chronos_followup_status: ChronosFollowUpStatus;
      chronos_meeting_status: ChronosMeetingStatus;
      chronos_meeting_type: ChronosMeetingType;
      chronos_minutes_status: ChronosMinutesStatus;
      chronos_participant_role: ChronosParticipantRole;
    };
    Functions: Record<string, never>;
    Tables: {
      chronos_chat_messages: {
        Insert: Partial<ChronosChatMessageRow> & {
          content: string;
          meeting_id: string;
          sender_name: string;
        };
        Relationships: [];
        Row: ChronosChatMessageRow;
        Update: never;
      };
      chronos_followups: {
        Insert: Partial<ChronosFollowUpRow> & {
          meeting_id: string;
          title: string;
        };
        Relationships: [];
        Row: ChronosFollowUpRow;
        Update: Partial<ChronosFollowUpRow>;
      };
      chronos_meetings: {
        Insert: Partial<ChronosMeetingRow> & {
          protocol: string;
          title: string;
        };
        Relationships: [];
        Row: ChronosMeetingRow;
        Update: Partial<ChronosMeetingRow>;
      };
      chronos_minutes: {
        Insert: Partial<ChronosMinutesRow> & {
          content: string;
          meeting_id: string;
          version: number;
        };
        Relationships: [];
        Row: ChronosMinutesRow;
        Update: Partial<ChronosMinutesRow>;
      };
      chronos_participants: {
        Insert: Partial<ChronosParticipantRow> & {
          display_name: string;
          meeting_id: string;
        };
        Relationships: [];
        Row: ChronosParticipantRow;
        Update: Partial<ChronosParticipantRow>;
      };
      chronos_recordings: {
        Insert: Partial<ChronosRecordingRow> & {
          meeting_id: string;
        };
        Relationships: [];
        Row: ChronosRecordingRow;
        Update: Partial<ChronosRecordingRow>;
      };
      chronos_rooms: {
        Insert: Partial<ChronosRoomRow> & {
          name: string;
          room_type: string;
          slug: string;
        };
        Relationships: [];
        Row: ChronosRoomRow;
        Update: Partial<ChronosRoomRow>;
      };
      chronos_timeline_events: {
        Insert: Partial<ChronosTimelineEventRow> & {
          meeting_id: string;
          title: string;
        };
        Relationships: [];
        Row: ChronosTimelineEventRow;
        Update: never;
      };
      chronos_transcript_segments: {
        Insert: Partial<ChronosTranscriptSegmentRow> & {
          content: string;
          meeting_id: string;
        };
        Relationships: [];
        Row: ChronosTranscriptSegmentRow;
        Update: never;
      };
      hub_users: {
        Insert: never;
        Relationships: [];
        Row: ChronosUserRow;
        Update: never;
      };
    };
    Views: Record<string, never>;
  };
};

type ChronosClient = ReturnType<typeof createClient<ChronosDatabase>>;

type ChronosAuthorization =
  | {
      client: ChronosClient | null;
      ok: true;
      user: AuthorizedChronosUser;
    }
  | {
      ok: false;
      response: NextResponse<{ error: string }>;
    };

type NormalizedChronosPublicParticipantInput = {
  displayName?: string;
  organization?: string;
};

type NormalizedChronosPublicRecordingInput = {
  durationSeconds?: number;
  meetingId: string;
  participantId: string;
  status: Extract<ChronosCaptureStatus, "available" | "failed" | "recording">;
};

type NormalizedChronosPublicRecordingUploadInput = {
  durationSeconds?: number;
  file: File;
  fileName: string;
  meetingId: string;
  mimeType: string;
  participantId: string;
  sizeBytes: number;
};

type NormalizedChronosPublicRecordingUploadUrlInput = {
  durationSeconds?: number;
  fileName: string;
  meetingId: string;
  mimeType: string;
  participantId: string;
  sizeBytes: number;
  startedAt?: string;
};

type NormalizedChronosPublicRecordingUploadCompletionInput =
  NormalizedChronosPublicRecordingUploadUrlInput & {
    storageBucket: string;
    storagePath: string;
  };

type NormalizedChronosPublicChatInput = {
  clientMessageId?: string;
  content: string;
  meetingId: string;
  participantId: string;
  senderName: string;
};

type NormalizedChronosPublicCloseInput = {
  meetingId: string;
  participantId: string;
};

type NormalizedChronosPublicTranscriptInput = {
  content: string;
  endedAt?: string;
  meetingId: string;
  participantId: string;
  speakerLabel: string;
  startedAt?: string;
};

type ChronosLocalStore = {
  meetings: ChronosMeeting[];
  profiles?: ChronosMeetingProfile[];
  rooms: ChronosRoom[];
};

const chronosLocalStorePath = path.join(
  process.cwd(),
  ".next",
  "cache",
  "chronos-meetings.json",
);
const chronosLocalFallbackFlag = "CHRONOS_ENABLE_LOCAL_FALLBACK";
const chronosProfileRegistrySlug = "__chronos-profile-registry";
const chronosDriveStorageBucket = "chronos-drive";
const maxTextLength = 8_000;
const maxChronosMinutesContentLength = 40_000;
const maxChronosTranscriptContentLength = 40_000;
const maxRoomBackgroundDataUrlLength = 7_000_000;
const maxChronosRecordingUploadBytes = 500_000_000;

const defaultChronosRooms: ChronosRoom[] = [
  {
    capacity: 12,
    id: "local-room-executiva",
    metadata: {
      externalAccess: { mode: "request_entry", path: "/chronos/sala-executiva" },
    },
    minutesRequired: true,
    name: "Sala Executiva",
    recordingRequired: true,
    roomType: "alignment",
    slug: "sala-executiva",
    status: "active",
    transcriptionRequired: true,
  },
  {
    capacity: 16,
    id: "local-room-cliente",
    metadata: {
      externalAccess: { mode: "request_entry", path: "/chronos/sala-cliente" },
    },
    minutesRequired: true,
    name: "Sala Cliente",
    recordingRequired: true,
    roomType: "alignment",
    slug: "sala-cliente",
    status: "active",
    transcriptionRequired: true,
  },
  {
    capacity: 20,
    id: "local-room-resultado",
    metadata: {
      externalAccess: { mode: "request_entry", path: "/chronos/sala-resultado" },
    },
    minutesRequired: true,
    name: "Sala Resultado",
    recordingRequired: true,
    roomType: "results",
    slug: "sala-resultado",
    status: "active",
    transcriptionRequired: true,
  },
];

export async function authorizeChronosRequest(
  request: NextRequest,
): Promise<ChronosAuthorization> {
  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sessao ausente para Chronos." },
        { status: 401 },
      ),
    };
  }

  const client = createChronosClient();

  if (!client) {
    if (!canUseChronosLocalFallback()) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error:
              "Chronos requer Supabase server-side configurado para persistencia segura.",
          },
          { status: 503 },
        ),
      };
    }

    return {
      client: null,
      ok: true,
      user: {
        email: "local@careli.local",
        id: "local-chronos-user",
        name: "Lucas",
        operationalProfile: "adm",
        role: "admin",
      },
    };
  }

  const { data: authData, error: authError } =
    await client.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sessao invalida para Chronos." },
        { status: 401 },
      ),
    };
  }

  const { data: user, error: userError } = await client
    .from("hub_users")
    .select("id,email,display_name,role,status,operational_profile")
    .eq("id", authData.user.id)
    .maybeSingle<ChronosUserRow>();

  if (userError || !user || user.status !== "active") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Usuario sem acesso ativo ao Hub." },
        { status: 403 },
      ),
    };
  }

  return {
    client,
    ok: true,
    user: {
      email: user.email,
      id: user.id,
      name: user.display_name,
      operationalProfile: user.operational_profile,
      role: user.role,
    },
  };
}

export async function listChronosSnapshot(
  authorization: Extract<ChronosAuthorization, { ok: true }>,
): Promise<ChronosSnapshot> {
  if (!authorization.client) {
    return {
      ...(await readLocalChronosSnapshot()),
      storage: {
        message: "Chronos em persistencia local porque Supabase server-side nao esta configurado.",
        status: "local",
      },
    };
  }

  const client = authorization.client;

  try {
    const roomsResult = await client
      .from("chronos_rooms")
      .select("*")
      .eq("status", "active")
      .order("name", { ascending: true });

    if (roomsResult.error) {
      throw roomsResult.error;
    }

    const participantMeetingsResult = await client
      .from("chronos_participants")
      .select("meeting_id")
      .eq("user_id", authorization.user.id);

    if (participantMeetingsResult.error) {
      throw participantMeetingsResult.error;
    }

    const participantMeetingIds = Array.from(
      new Set(
        (participantMeetingsResult.data ?? [])
          .map((participant) => participant.meeting_id)
          .filter(Boolean),
      ),
    );
    let meetingsQuery = client
      .from("chronos_meetings")
      .select("*")
      .neq("status", "cancelled");

    meetingsQuery =
      participantMeetingIds.length > 0
        ? meetingsQuery.or(
            `host_user_id.eq.${authorization.user.id},id.in.(${participantMeetingIds.join(",")})`,
          )
        : meetingsQuery.eq("host_user_id", authorization.user.id);

    const meetingsResult = await meetingsQuery
      .order("updated_at", { ascending: false })
      .limit(1000);

    if (meetingsResult.error) {
      throw meetingsResult.error;
    }

    const meetings = (meetingsResult.data ?? []).filter((meeting) =>
      isChronosMeetingVisibleInUserAgenda(meeting, authorization.user),
    );
    const meetingIds = meetings.map((meeting) => meeting.id);

    const [
      participantsResult,
      timelineResult,
      transcriptResult,
      minutesResult,
      followUpsResult,
      recordingsResult,
    ] =
      meetingIds.length > 0
        ? await Promise.all([
            client
              .from("chronos_participants")
              .select("*")
              .in("meeting_id", meetingIds),
            client
              .from("chronos_timeline_events")
              .select("*")
              .in("meeting_id", meetingIds)
              .order("event_at", { ascending: false }),
            client
              .from("chronos_transcript_segments")
              .select("*")
              .in("meeting_id", meetingIds)
              .order("created_at", { ascending: true }),
            client
              .from("chronos_minutes")
              .select("*")
              .in("meeting_id", meetingIds)
              .order("created_at", { ascending: false }),
            client
              .from("chronos_followups")
              .select("*")
              .in("meeting_id", meetingIds)
              .order("created_at", { ascending: false }),
            client
              .from("chronos_recordings")
              .select("*")
              .in("meeting_id", meetingIds)
              .order("created_at", { ascending: false }),
          ])
        : [
            emptySupabaseList<ChronosParticipantRow>(),
            emptySupabaseList<ChronosTimelineEventRow>(),
            emptySupabaseList<ChronosTranscriptSegmentRow>(),
            emptySupabaseList<ChronosMinutesRow>(),
            emptySupabaseList<ChronosFollowUpRow>(),
            emptySupabaseList<ChronosRecordingRow>(),
          ];

    const possibleError = [
      participantsResult.error,
      timelineResult.error,
      transcriptResult.error,
      minutesResult.error,
      followUpsResult.error,
      recordingsResult.error,
    ].find(Boolean);

    if (possibleError) {
      throw possibleError;
    }

    const rooms = (roomsResult.data ?? []).map(mapRoomRow);
    const profiles = await readChronosProfilesFromSupabase(client);
    const roomsById = new Map(rooms.map((room) => [room.id, room]));
    let driveSchemaPending = false;
    let chatMessages: ChronosChatMessageRow[] = [];

    if (meetingIds.length > 0) {
      const chatMessagesResult = await client
        .from("chronos_chat_messages")
        .select("*")
        .in("meeting_id", meetingIds)
        .order("created_at", { ascending: true });

      if (chatMessagesResult.error) {
        if (isChronosSchemaMissingError(chatMessagesResult.error)) {
          driveSchemaPending = true;
        } else {
          throw chatMessagesResult.error;
        }
      } else {
        chatMessages = chatMessagesResult.data ?? [];
      }
    }

    const recordingsByMeetingId = new Map<string, ChronosRecording[]>();

    await Promise.all(
      meetings.map(async (meeting) => {
        recordingsByMeetingId.set(
          meeting.id,
          await hydrateChronosRecordingUrls(
            client,
            groupRows(recordingsResult.data ?? [], meeting.id).map(
              mapRecordingRow,
            ),
          ),
        );
      }),
    );

    return {
      meetings: meetings.map((meeting) =>
        mapMeetingRow({
          chatMessages: groupRows(chatMessages, meeting.id).map(
            mapChatMessageRow,
          ),
          followUps: groupRows(followUpsResult.data ?? [], meeting.id).map(
            mapFollowUpRow,
          ),
          meeting,
          minutes: groupRows(minutesResult.data ?? [], meeting.id).map(
            mapMinutesRow,
          ),
          participants: groupRows(
            participantsResult.data ?? [],
            meeting.id,
          ).map(mapParticipantRow),
          recordings: recordingsByMeetingId.get(meeting.id) ?? [],
          room: meeting.room_id ? roomsById.get(meeting.room_id) ?? null : null,
          timeline: groupRows(timelineResult.data ?? [], meeting.id).map(
            mapTimelineRow,
          ),
          transcript: groupRows(transcriptResult.data ?? [], meeting.id).map(
            mapTranscriptRow,
          ),
        }),
      ),
      profiles,
      rooms,
      storage: {
        message: driveSchemaPending
          ? "Chronos Drive aguarda migration complementar de chat/storage."
          : undefined,
        status: driveSchemaPending ? "migration_pendente" : "supabase",
      },
    };
  } catch (error) {
    if (isChronosSchemaMissingError(error) && canUseChronosLocalFallback()) {
      return {
        ...(await readLocalChronosSnapshot()),
        storage: {
          message:
            "Chronos aguarda aplicacao da migration Supabase 0019_chronos_core.sql.",
          status: "migration_pendente",
        },
      };
    }

    throw error;
  }
}

export async function createChronosMeeting({
  authorization,
  input,
}: {
  authorization: Extract<ChronosAuthorization, { ok: true }>;
  input: unknown;
}) {
  assertCanManageChronos(authorization.user);

  const normalizedInput = normalizeCreateMeetingInput(input);

  if (!authorization.client) {
    return createLocalChronosMeeting({
      input: normalizedInput,
      user: authorization.user,
    });
  }

  try {
    const roomsResult = await authorization.client
      .from("chronos_rooms")
      .select("*")
      .eq("status", "active")
      .order("name", { ascending: true });

    if (roomsResult.error) {
      throw roomsResult.error;
    }

    const selectedRoom =
      normalizedInput.locationMode === "offline"
        ? null
        : (roomsResult.data ?? []).find(
            (room) => room.id === normalizedInput.roomId,
          ) ??
          roomsResult.data?.[0] ??
          null;
    const selectedProfile = await resolveChronosMeetingProfileForInput({
      client: authorization.client,
      input: normalizedInput,
    });
    const protocol = await generateChronosProtocol(authorization.client);
    const { data: meeting, error } = await authorization.client
      .from("chronos_meetings")
      .insert({
        ends_at: normalizedInput.endsAt ?? null,
        external_reference: normalizedInput.externalReference ?? null,
        host_name: authorization.user.name,
        host_user_id: authorization.user.id,
        meeting_type: selectedProfile.meetingType,
        metadata: {
          agenda: normalizedInput.agenda ?? [],
          apoloInvitees: normalizedInput.apoloInvitees ?? [],
          calendarEventKind: normalizedInput.calendarEventKind ?? "event",
          hubInvitees: normalizedInput.hubInvitees ?? [],
          location: {
            address: normalizedInput.locationAddress ?? null,
            mode: normalizedInput.locationMode ?? "online",
          },
          meetingProfile: {
            id: selectedProfile.id,
            label: selectedProfile.label,
            meetingType: selectedProfile.meetingType,
          },
          source: "chronos-v1",
        },
        objective: normalizedInput.objective ?? null,
        protocol,
        room_id: selectedRoom?.id ?? null,
        starts_at: normalizedInput.startsAt ?? null,
        status: "scheduled",
        title: normalizedInput.title,
      })
      .select("*")
      .single<ChronosMeetingRow>();

    if (error) {
      throw error;
    }

    const participants = normalizeParticipantsForInsert({
      input: normalizedInput,
      meetingId: meeting.id,
      user: authorization.user,
    });

    if (participants.length > 0) {
      const participantResult = await authorization.client
        .from("chronos_participants")
        .insert(participants);

      if (participantResult.error) {
        throw participantResult.error;
      }
    }

    await insertTimelineEvent(authorization.client, {
      actorUserId: authorization.user.id,
      eventType: "created",
      meetingId: meeting.id,
      title: "Reuniao formal criada",
    });
    await syncChronosMeetingToGoogleCalendar({
      meetingId: meeting.id,
      trigger: "chronos_create",
      userId: authorization.user.id,
    }).catch(() => null);

    const snapshot = await listChronosSnapshot(authorization);
    const createdMeeting = snapshot.meetings.find(
      (currentMeeting) => currentMeeting.id === meeting.id,
    );

    if (!createdMeeting) {
      throw new Error("Chronos criou a reuniao, mas nao conseguiu hidratar o retorno.");
    }

    return createdMeeting;
  } catch (error) {
    if (isChronosSchemaMissingError(error) && canUseChronosLocalFallback()) {
      return createLocalChronosMeeting({
        input: normalizedInput,
        user: authorization.user,
      });
    }

    throw error;
  }
}

export async function createChronosRoom({
  authorization,
  input,
}: {
  authorization: Extract<ChronosAuthorization, { ok: true }>;
  input: unknown;
}) {
  assertCanManageChronos(authorization.user);

  const normalizedInput = normalizeRoomInput(input);

  if (!authorization.client) {
    return createLocalChronosRoom({
      input: normalizedInput,
      user: authorization.user,
    });
  }

  const { data: room, error } = await authorization.client
    .from("chronos_rooms")
    .insert({
      capacity: normalizedInput.capacity,
      created_by_user_id: authorization.user.id,
      metadata: buildRoomMetadata(normalizedInput),
      minutes_required: normalizedInput.minutesRequired,
      name: normalizedInput.name,
      recording_required: normalizedInput.recordingRequired,
      room_type: normalizedInput.roomType,
      slug: normalizedInput.slug,
      status: "active",
      transcription_required: normalizedInput.transcriptionRequired,
    })
    .select("*")
    .single<ChronosRoomRow>();

  if (error) {
    throw error;
  }

  return mapRoomRow(room);
}

export async function updateChronosRoom({
  authorization,
  input,
}: {
  authorization: Extract<ChronosAuthorization, { ok: true }>;
  input: unknown;
}) {
  assertCanManageChronos(authorization.user);

  const normalizedInput = normalizeRoomUpdateInput(input);

  if (!authorization.client) {
    return updateLocalChronosRoom({ input: normalizedInput });
  }

  const { data: currentRoom, error: currentRoomError } = await authorization.client
    .from("chronos_rooms")
    .select("*")
    .eq("id", normalizedInput.roomId)
    .maybeSingle<ChronosRoomRow>();

  if (currentRoomError) {
    throw currentRoomError;
  }

  if (!currentRoom) {
    throw new Error("Sala Chronos nao encontrada.");
  }

  const nextSlug = normalizedInput.slug ?? currentRoom.slug;
  const nextMetadata = buildRoomMetadata(
    {
      backgroundDataUrl: normalizedInput.backgroundDataUrl,
      backgroundName: normalizedInput.backgroundName,
      slug: nextSlug,
    },
    currentRoom.metadata,
  );

  const { data: room, error } = await authorization.client
    .from("chronos_rooms")
    .update({
      capacity: normalizedInput.capacity ?? currentRoom.capacity,
      metadata: nextMetadata,
      minutes_required:
        normalizedInput.minutesRequired ?? currentRoom.minutes_required,
      name: normalizedInput.name ?? currentRoom.name,
      recording_required:
        normalizedInput.recordingRequired ?? currentRoom.recording_required,
      room_type: normalizedInput.roomType ?? currentRoom.room_type,
      slug: nextSlug,
      transcription_required:
        normalizedInput.transcriptionRequired ??
        currentRoom.transcription_required,
    })
    .eq("id", normalizedInput.roomId)
    .select("*")
    .single<ChronosRoomRow>();

  if (error) {
    throw error;
  }

  return mapRoomRow(room);
}

export async function deleteChronosRoom({
  authorization,
  input,
}: {
  authorization: Extract<ChronosAuthorization, { ok: true }>;
  input: unknown;
}) {
  assertCanManageChronos(authorization.user);

  const normalizedInput = normalizeRoomDeleteInput(input);

  if (!authorization.client) {
    return deleteLocalChronosRoom({ input: normalizedInput });
  }

  const { data: room, error } = await authorization.client
    .from("chronos_rooms")
    .update({ status: "archived" })
    .eq("id", normalizedInput.roomId)
    .select("*")
    .single<ChronosRoomRow>();

  if (error) {
    throw error;
  }

  return mapRoomRow(room);
}

export async function createChronosProfile({
  authorization,
  input,
}: {
  authorization: Extract<ChronosAuthorization, { ok: true }>;
  input: unknown;
}) {
  assertCanManageChronos(authorization.user);
  void input;

  throw new Error(
    "Os perfis do Chronos sao fixos: Alinhamento, Resultado e Comunicado.",
  );
}

export async function deleteChronosProfile({
  authorization,
  input,
}: {
  authorization: Extract<ChronosAuthorization, { ok: true }>;
  input: unknown;
}) {
  assertCanManageChronos(authorization.user);
  void input;

  throw new Error(
    "Os perfis oficiais do Chronos nao podem ser excluidos ou alterados.",
  );
}

export async function listChronosInternalInvitees({
  authorization,
  query,
}: {
  authorization: Extract<ChronosAuthorization, { ok: true }>;
  query?: string | null;
}): Promise<ChronosHubInvitee[]> {
  if (!authorization.client) {
    return [
      {
        displayName: authorization.user.name,
        email: authorization.user.email,
        operationalProfile: authorization.user.operationalProfile ?? null,
        role: authorization.user.role,
        userId: authorization.user.id,
      },
    ];
  }

  const normalizedQuery = normalizeSearchTerm(query);
  const { data, error } = await authorization.client
    .from("hub_users")
    .select("id,email,display_name,role,status,operational_profile")
    .eq("status", "active")
    .order("display_name", { ascending: true })
    .limit(80);

  if (error) {
    throw error;
  }

  return ((data ?? []) as ChronosUserRow[])
    .filter((user) => {
      if (!normalizedQuery) {
        return true;
      }

      return [user.display_name, user.email, user.operational_profile, user.role]
        .filter(Boolean)
        .some((value) =>
          String(value).toLowerCase().includes(normalizedQuery),
        );
    })
    .slice(0, 10)
    .map((user) => ({
      displayName: user.display_name,
      email: user.email,
      operationalProfile: user.operational_profile ?? null,
      role: user.role,
      userId: user.id,
    }));
}

export async function getChronosPublicRoomBySlug(roomSlug: string) {
  const slug = normalizeRoomSlug(roomSlug, roomSlug);
  const client = createChronosClient();

  if (!client) {
    if (!canUseChronosLocalFallback()) {
      throw new Error(
        "Chronos requer Supabase server-side configurado para sala externa.",
      );
    }

    const snapshot = await readLocalChronosSnapshot();
    const room = snapshot.rooms.find(
      (currentRoom) =>
        currentRoom.slug === slug && currentRoom.status === "active",
    );

    return room ? mapPublicRoom(room) : null;
  }

  const { data: room, error } = await client
    .from("chronos_rooms")
    .select("*")
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle<ChronosRoomRow>();

  if (error) {
    throw error;
  }

  return room ? mapPublicRoom(mapRoomRow(room)) : null;
}

export async function joinChronosPublicRoom({
  authorizationHeader,
  input,
  roomSlug,
}: {
  authorizationHeader?: string | null;
  input: unknown;
  roomSlug: string;
}): Promise<ChronosPublicJoinResult> {
  const slug = normalizeRoomSlug(roomSlug, roomSlug);
  const participantInput = normalizePublicParticipantInput(input);
  const client = createChronosClient();

  if (!client) {
    if (!canUseChronosLocalFallback()) {
      throw new Error(
        "Chronos requer Supabase server-side configurado para entrada externa.",
      );
    }

    return joinLocalChronosPublicRoom({ input: participantInput, roomSlug: slug });
  }

  const room = await getChronosRoomRowBySlug(client, slug);

  if (!room) {
    throw new Error("Sala Chronos nao encontrada.");
  }

  const loggedUser = await resolveOptionalChronosUserFromBearer(
    client,
    authorizationHeader,
  );
  const participantName =
    loggedUser?.name ?? participantInput.displayName ?? "";

  if (!participantName) {
    throw new Error("Informe seu nome para entrar na sala Chronos.");
  }

  const organization =
    loggedUser?.operationalProfile ??
    participantInput.organization ??
    undefined;
  const reservationMeeting = await resolveChronosPublicReservationMeeting(
    client,
    room,
  );
  const isHost = Boolean(
    loggedUser?.id && loggedUser.id === reservationMeeting.host_user_id,
  );

  if (reservationMeeting.status === "scheduled" && !isHost) {
    throw new Error("Aguarde o host abrir a reserva Chronos.");
  }

  const meeting =
    reservationMeeting.status === "live"
      ? reservationMeeting
      : await openChronosPublicReservation({
          client,
          isHost,
          meeting: reservationMeeting,
          participantName,
          room,
        });
  const now = new Date().toISOString();
  const existingParticipantsResult = await client
    .from("chronos_participants")
    .select("*")
    .eq("meeting_id", meeting.id)
    .returns<ChronosParticipantRow[]>();

  if (existingParticipantsResult.error) {
    throw existingParticipantsResult.error;
  }

  const existingParticipant = findMatchingChronosParticipantRow(
    existingParticipantsResult.data ?? [],
    {
      displayName: participantName,
      email: loggedUser?.email ?? null,
      organization,
      userId: loggedUser?.id ?? null,
    },
  );
  const participantResult = existingParticipant
    ? await client
        .from("chronos_participants")
        .update({
          attendance_status: "joined",
          display_name: participantName,
          email: loggedUser?.email ?? existingParticipant.email,
          joined_at: existingParticipant.joined_at ?? now,
          left_at: null,
          metadata: {
            ...readRecordMetadata(existingParticipant.metadata),
            company: organization ?? existingParticipant.organization ?? null,
            entryMode: loggedUser ? "hub_login" : "external_guest",
            source: "chronos-external-room",
          },
          organization: organization ?? existingParticipant.organization,
          role: isHost ? "host" : existingParticipant.role,
          user_id: loggedUser?.id ?? existingParticipant.user_id,
        })
        .eq("id", existingParticipant.id)
        .select("*")
        .single<ChronosParticipantRow>()
    : await client
        .from("chronos_participants")
        .insert({
          attendance_status: "joined",
          display_name: participantName,
          email: loggedUser?.email ?? null,
          joined_at: now,
          meeting_id: meeting.id,
          metadata: {
            company: organization ?? null,
            entryMode: loggedUser ? "hub_login" : "external_guest",
            source: "chronos-external-room",
          },
          organization: organization ?? null,
          role: isHost ? "host" : loggedUser ? "participant" : "external",
          user_id: loggedUser?.id ?? null,
        })
        .select("*")
        .single<ChronosParticipantRow>();
  const { data: participant, error: participantError } = participantResult;

  if (participantError) {
    throw participantError;
  }

  if (!existingParticipant?.joined_at || existingParticipant.left_at) {
    await insertTimelineEvent(client, {
      eventType: "joined",
      meetingId: meeting.id,
      title: `${participantName} entrou na sala externa`,
    });
  }

  return {
    athenaNotice:
      "Esta reuniao pode ser gravada e transcrita pela assistente Athena.",
    isHost,
    meetingId: meeting.id,
    participant: {
      displayName: participant.display_name,
      id: participant.id,
      organization: participant.organization ?? undefined,
      role: participant.role,
      userId: participant.user_id ?? undefined,
    },
    reservation: {
      endsAt: meeting.ends_at,
      protocol: meeting.protocol,
      startsAt: meeting.starts_at,
      title: meeting.title,
    },
    room: mapPublicRoom(mapRoomRow(room)),
  };
}

export async function closeChronosPublicMeeting({
  authorizationHeader,
  input,
  roomSlug,
}: {
  authorizationHeader?: string | null;
  input: unknown;
  roomSlug: string;
}) {
  const normalizedInput = normalizePublicCloseInput(input);
  const slug = normalizeRoomSlug(roomSlug, roomSlug);
  const client = createChronosClient();

  if (!client) {
    if (!canUseChronosLocalFallback()) {
      throw new Error(
        "Chronos requer Supabase server-side configurado para encerrar a chamada.",
      );
    }

    return closeLocalChronosPublicMeeting({
      input: normalizedInput,
      roomSlug: slug,
    });
  }

  const loggedUser = await resolveOptionalChronosUserFromBearer(
    client,
    authorizationHeader,
  );

  if (!loggedUser) {
    throw new Error("Somente o host autenticado pode encerrar a reserva Chronos.");
  }

  const { meeting, room } = await getChronosPublicMeetingContext({
    client,
    meetingId: normalizedInput.meetingId,
    roomSlug: slug,
  });
  const canClose =
    meeting.host_user_id === loggedUser.id ||
    getPermissionsForRole(loggedUser.role).includes("chronos:manage");

  if (!canClose) {
    throw new ChronosForbiddenError(
      "Somente o host da reserva pode encerrar a chamada Chronos.",
    );
  }

  const now = new Date().toISOString();
  const metadata = {
    ...(meeting.metadata ?? {}),
    closure: {
      closedAt: now,
      closedByUserId: loggedUser.id,
      source: "chronos-external-room",
    },
    externalRoom: {
      ...readRecordMetadata(meeting.metadata?.externalRoom),
      actualEndedAt: now,
      roomSlug: room.slug,
    },
  };
  const { error: meetingError } = await client
    .from("chronos_meetings")
    .update({
      metadata,
      minutes_status: "not_started",
      status: "closed",
      transcription_status: room.transcription_required
        ? "processing"
        : meeting.transcription_status,
    })
    .eq("id", meeting.id);

  if (meetingError) {
    throw meetingError;
  }

  const participantResult = await client
    .from("chronos_participants")
    .update({
      attendance_status: "left",
      left_at: now,
    })
    .eq("meeting_id", meeting.id)
    .is("left_at", null);

  if (participantResult.error) {
    throw participantResult.error;
  }

  await insertTimelineEvent(client, {
    actorUserId: loggedUser.id,
    eventType: "left",
    meetingId: meeting.id,
    title: "Chamada Chronos encerrada pelo host",
  });

  if (room.transcription_required) {
    await insertTimelineEvent(client, {
      actorUserId: loggedUser.id,
      eventType: "note",
      meetingId: meeting.id,
      title: "Athena preparada para processar transcricao e ata",
    });
  }

  return {
    meetingId: meeting.id,
    ok: true,
    status: "closed" as const,
  };
}

export async function markChronosPublicRecording({
  input,
  roomSlug,
}: {
  input: unknown;
  roomSlug: string;
}) {
  const normalizedInput = normalizePublicRecordingInput(input);
  const slug = normalizeRoomSlug(roomSlug, roomSlug);
  const client = createChronosClient();

  if (!client) {
    if (!canUseChronosLocalFallback()) {
      throw new Error(
        "Chronos requer Supabase server-side configurado para gravacao externa.",
      );
    }

    return markLocalChronosPublicRecording({
      input: normalizedInput,
      roomSlug: slug,
    });
  }

  const { meeting } = await getChronosPublicMeetingContext({
    client,
    meetingId: normalizedInput.meetingId,
    roomSlug: slug,
  });

  const { error: meetingError } = await client
    .from("chronos_meetings")
    .update({
      recording_status: normalizedInput.status,
    })
    .eq("id", meeting.id);

  if (meetingError) {
    throw meetingError;
  }

  await insertTimelineEvent(client, {
    eventType:
      normalizedInput.status === "recording"
        ? "recording_started"
        : "recording_stopped",
    meetingId: meeting.id,
    title:
      normalizedInput.status === "recording"
        ? "Gravacao iniciada pela sala externa"
        : normalizedInput.status === "failed"
          ? "Gravacao externa falhou antes de salvar o arquivo"
        : "Gravacao encerrada pela sala externa",
  });

  return { ok: true, status: normalizedInput.status };
}

export async function prepareChronosPublicRecordingUpload({
  input,
  roomSlug,
}: {
  input: unknown;
  roomSlug: string;
}) {
  const normalizedInput = normalizePublicRecordingUploadUrlInput(input);
  const slug = normalizeRoomSlug(roomSlug, roomSlug);
  const client = createChronosClient();

  if (!client) {
    throw new Error(
      "Chronos requer Supabase server-side configurado para preparar gravacoes.",
    );
  }

  const { meeting } = await getChronosPublicMeetingContext({
    client,
    meetingId: normalizedInput.meetingId,
    roomSlug: slug,
  });
  const storagePath = buildChronosRecordingStoragePath({
    fileName: normalizedInput.fileName,
    meetingId: meeting.id,
    participantId: normalizedInput.participantId,
    roomSlug: slug,
  });
  const { data, error } = await client.storage
    .from(chronosDriveStorageBucket)
    .createSignedUploadUrl(storagePath);

  if (error || !data?.path || !data.token) {
    throw error ?? new Error("Nao foi possivel preparar upload Chronos.");
  }

  return {
    bucket: chronosDriveStorageBucket,
    path: data.path,
    token: data.token,
  };
}

export async function completeChronosPublicRecordingUpload({
  input,
  roomSlug,
}: {
  input: unknown;
  roomSlug: string;
}) {
  const normalizedInput = normalizePublicRecordingUploadCompletionInput(input);
  const slug = normalizeRoomSlug(roomSlug, roomSlug);
  const client = createChronosClient();

  if (!client) {
    throw new Error(
      "Chronos requer Supabase server-side configurado para finalizar gravacoes.",
    );
  }

  const { meeting } = await getChronosPublicMeetingContext({
    client,
    meetingId: normalizedInput.meetingId,
    roomSlug: slug,
  });

  assertChronosRecordingStorageTarget({
    bucket: normalizedInput.storageBucket,
    meetingId: meeting.id,
    participantId: normalizedInput.participantId,
    roomSlug: slug,
    storagePath: normalizedInput.storagePath,
  });
  await assertChronosRecordingStorageObjectExists({
    bucket: normalizedInput.storageBucket,
    client,
    storagePath: normalizedInput.storagePath,
  });

  const existingRecordingResult = await client
    .from("chronos_recordings")
    .select("*")
    .eq("storage_bucket", normalizedInput.storageBucket)
    .eq("storage_path", normalizedInput.storagePath)
    .maybeSingle<ChronosRecordingRow>();

  if (existingRecordingResult.error) {
    throw existingRecordingResult.error;
  }

  const now = new Date().toISOString();
  const meetingResult = await client
    .from("chronos_meetings")
    .update({ recording_status: "available" })
    .eq("id", meeting.id);

  if (meetingResult.error) {
    throw meetingResult.error;
  }

  if (existingRecordingResult.data) {
    const [recording] = await hydrateChronosRecordingUrls(client, [
      mapRecordingRow(existingRecordingResult.data),
    ]);

    return { ok: true, recording };
  }

  const recordingResult = await client
    .from("chronos_recordings")
    .insert({
      duration_seconds: normalizedInput.durationSeconds ?? null,
      file_name: normalizedInput.fileName,
      meeting_id: meeting.id,
      metadata: {
        fileName: normalizedInput.fileName,
        mimeType: normalizedInput.mimeType,
        participantId: normalizedInput.participantId,
        sizeBytes: normalizedInput.sizeBytes,
        startedAt: normalizedInput.startedAt ?? null,
        source: "chronos-external-room-storage-direct",
      },
      mime_type: normalizedInput.mimeType,
      size_bytes: normalizedInput.sizeBytes,
      started_at: normalizedInput.startedAt ?? null,
      status: "available",
      stopped_at: now,
      storage_bucket: normalizedInput.storageBucket,
      storage_path: normalizedInput.storagePath,
      uploaded_at: now,
    })
    .select("*")
    .single<ChronosRecordingRow>();

  if (recordingResult.error) {
    throw recordingResult.error;
  }

  await insertTimelineEvent(client, {
    eventType: "recording_stopped",
    meetingId: meeting.id,
    title: "Gravacao salva no Chronos Drive",
  });

  const [recording] = await hydrateChronosRecordingUrls(client, [
    mapRecordingRow(recordingResult.data),
  ]);

  return { ok: true, recording };
}

export async function uploadChronosPublicRecording({
  input,
  roomSlug,
}: {
  input: FormData;
  roomSlug: string;
}) {
  const normalizedInput = normalizePublicRecordingUploadInput(input);
  const slug = normalizeRoomSlug(roomSlug, roomSlug);
  const client = createChronosClient();

  if (!client) {
    if (!canUseChronosLocalFallback()) {
      throw new Error(
        "Chronos requer Supabase server-side configurado para armazenar gravacoes.",
      );
    }

    return markLocalChronosPublicRecording({
      input: {
        durationSeconds: normalizedInput.durationSeconds,
        meetingId: normalizedInput.meetingId,
        participantId: normalizedInput.participantId,
        status: "available",
      },
      roomSlug: slug,
    });
  }

  const { meeting } = await getChronosPublicMeetingContext({
    client,
    meetingId: normalizedInput.meetingId,
    roomSlug: slug,
  });
  const now = new Date().toISOString();
  const storagePath = buildChronosRecordingStoragePath({
    fileName: normalizedInput.fileName,
    meetingId: meeting.id,
    participantId: normalizedInput.participantId,
    roomSlug: slug,
  });
  const uploadResult = await client.storage
    .from(chronosDriveStorageBucket)
    .upload(storagePath, normalizedInput.file, {
      contentType: normalizedInput.mimeType,
      upsert: false,
    });

  if (uploadResult.error) {
    throw uploadResult.error;
  }

  const storagePathFromUpload = uploadResult.data?.path ?? storagePath;
  const meetingResult = await client
    .from("chronos_meetings")
    .update({ recording_status: "available" })
    .eq("id", meeting.id);

  if (meetingResult.error) {
    throw meetingResult.error;
  }

  const recordingResult = await client
    .from("chronos_recordings")
    .insert({
      duration_seconds: normalizedInput.durationSeconds ?? null,
      file_name: normalizedInput.fileName,
      meeting_id: meeting.id,
      metadata: {
        fileName: normalizedInput.fileName,
        mimeType: normalizedInput.mimeType,
        participantId: normalizedInput.participantId,
        sizeBytes: normalizedInput.sizeBytes,
        source: "chronos-external-room-storage",
      },
      mime_type: normalizedInput.mimeType,
      size_bytes: normalizedInput.sizeBytes,
      status: "available",
      stopped_at: now,
      storage_bucket: chronosDriveStorageBucket,
      storage_path: storagePathFromUpload,
      uploaded_at: now,
    })
    .select("*")
    .single<ChronosRecordingRow>();

  if (recordingResult.error) {
    throw recordingResult.error;
  }

  await insertTimelineEvent(client, {
    eventType: "recording_stopped",
    meetingId: meeting.id,
    title: "Gravacao salva no Chronos Drive",
  });

  const [recording] = await hydrateChronosRecordingUrls(client, [
    mapRecordingRow(recordingResult.data),
  ]);

  return { ok: true, recording };
}

export async function addChronosPublicChatMessage({
  input,
  roomSlug,
}: {
  input: unknown;
  roomSlug: string;
}) {
  const normalizedInput = normalizePublicChatInput(input);
  const slug = normalizeRoomSlug(roomSlug, roomSlug);
  const client = createChronosClient();

  if (!client) {
    if (!canUseChronosLocalFallback()) {
      throw new Error(
        "Chronos requer Supabase server-side configurado para salvar chat.",
      );
    }

    return addLocalChronosPublicChatMessage({
      input: normalizedInput,
      roomSlug: slug,
    });
  }

  const { meeting } = await getChronosPublicMeetingContext({
    client,
    meetingId: normalizedInput.meetingId,
    roomSlug: slug,
  });
  const { data, error } = await client
    .from("chronos_chat_messages")
    .insert({
      content: normalizedInput.content,
      meeting_id: meeting.id,
      metadata: {
        clientMessageId: normalizedInput.clientMessageId ?? null,
        source: "chronos-external-room",
      },
      participant_id: normalizedInput.participantId,
      sender_name: normalizedInput.senderName,
    })
    .select("*")
    .single<ChronosChatMessageRow>();

  if (error) {
    throw error;
  }

  return { message: mapChatMessageRow(data), ok: true };
}

export async function addChronosPublicTranscript({
  input,
  roomSlug,
}: {
  input: unknown;
  roomSlug: string;
}) {
  const normalizedInput = normalizePublicTranscriptInput(input);
  const slug = normalizeRoomSlug(roomSlug, roomSlug);
  const client = createChronosClient();

  if (!client) {
    if (!canUseChronosLocalFallback()) {
      throw new Error(
        "Chronos requer Supabase server-side configurado para transcricao externa.",
      );
    }

    return addLocalChronosPublicTranscript({
      input: normalizedInput,
      roomSlug: slug,
    });
  }

  const { meeting } = await getChronosPublicMeetingContext({
    client,
    meetingId: normalizedInput.meetingId,
    roomSlug: slug,
  });

  const { error: transcriptError } = await client
    .from("chronos_transcript_segments")
    .insert({
      content: normalizedInput.content,
      ended_at: normalizedInput.endedAt ?? null,
      meeting_id: meeting.id,
      metadata: {
        participantId: normalizedInput.participantId,
        speakerSource: "declared_participant",
        source: "chronos-athena-browser",
      },
      source: "athena-browser",
      speaker_label: normalizedInput.speakerLabel,
      started_at: normalizedInput.startedAt ?? null,
    });

  if (transcriptError) {
    throw transcriptError;
  }

  const { error: meetingError } = await client
    .from("chronos_meetings")
    .update({ transcription_status: "available" })
    .eq("id", meeting.id);

  if (meetingError) {
    throw meetingError;
  }

  await insertTimelineEvent(client, {
    eventType: "transcript_added",
    meetingId: meeting.id,
    title: `Athena registrou fala de ${normalizedInput.speakerLabel}`,
  });

  return { ok: true };
}

export async function updateChronosMeeting({
  authorization,
  input,
}: {
  authorization: Extract<ChronosAuthorization, { ok: true }>;
  input: unknown;
}) {
  assertCanManageChronos(authorization.user);

  const normalizedInput = normalizeUpdateInput(input);

  if (!authorization.client) {
    return updateLocalChronosMeeting({
      input: normalizedInput,
      user: authorization.user,
    });
  }

  try {
    await applyChronosUpdate({
      client: authorization.client,
      input: normalizedInput,
      user: authorization.user,
    });
    await syncChronosMeetingToGoogleCalendar({
      meetingId: normalizedInput.meetingId,
      trigger: `chronos_update_${normalizedInput.action}`,
      userId: authorization.user.id,
    }).catch(() => null);

    const snapshot = await listChronosSnapshot(authorization);
    const meeting = snapshot.meetings.find(
      (currentMeeting) => currentMeeting.id === normalizedInput.meetingId,
    );

    if (!meeting) {
      throw new Error("Reuniao Chronos nao encontrada apos atualizacao.");
    }

    return meeting;
  } catch (error) {
    if (isChronosSchemaMissingError(error) && canUseChronosLocalFallback()) {
      return updateLocalChronosMeeting({
        input: normalizedInput,
        user: authorization.user,
      });
    }

    throw error;
  }
}

export async function deleteChronosMeeting({
  authorization,
  input,
}: {
  authorization: Extract<ChronosAuthorization, { ok: true }>;
  input: unknown;
}) {
  assertCanManageChronos(authorization.user);

  const normalizedInput = normalizeDeleteMeetingInput(input);

  if (!authorization.client) {
    return deleteLocalChronosMeeting({ input: normalizedInput });
  }

  const { data, error } = await authorization.client
    .from("chronos_meetings")
    .update({ status: "cancelled" })
    .eq("id", normalizedInput.meetingId)
    .select("id")
    .single<{ id: string }>();

  if (error) {
    throw error;
  }

  await insertTimelineEvent(authorization.client, {
    actorUserId: authorization.user.id,
    eventType: "note",
    meetingId: normalizedInput.meetingId,
    title: "Evento excluido da agenda Chronos",
  });

  return { meetingId: data.id };
}

export function isChronosSchemaMissingError(error: unknown) {
  const maybeError = error as {
    code?: unknown;
    message?: unknown;
  };
  const message =
    typeof maybeError?.message === "string" ? maybeError.message : "";

  return (
    maybeError?.code === "42703" ||
    maybeError?.code === "42P01" ||
    maybeError?.code === "PGRST205" ||
    (message.includes("chronos_") &&
      (message.includes("does not exist") ||
        message.includes("schema cache") ||
        message.includes("Could not find")))
  );
}

export function isChronosForbiddenError(error: unknown) {
  return error instanceof ChronosForbiddenError;
}

async function getChronosRoomRowBySlug(client: ChronosClient, roomSlug: string) {
  const { data: room, error } = await client
    .from("chronos_rooms")
    .select("*")
    .eq("slug", roomSlug)
    .eq("status", "active")
    .maybeSingle<ChronosRoomRow>();

  if (error) {
    throw error;
  }

  return room;
}

async function resolveOptionalChronosUserFromBearer(
  client: ChronosClient,
  authorizationHeader?: string | null,
) {
  const accessToken = getBearerTokenFromValue(authorizationHeader);

  if (!accessToken) {
    return null;
  }

  const { data: authData, error: authError } =
    await client.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return null;
  }

  const { data: user, error: userError } = await client
    .from("hub_users")
    .select("id,email,display_name,role,status,operational_profile")
    .eq("id", authData.user.id)
    .maybeSingle<ChronosUserRow>();

  if (userError || !user || user.status !== "active") {
    return null;
  }

  return {
    email: user.email,
    id: user.id,
    name: user.display_name,
    operationalProfile: user.operational_profile,
    role: user.role,
  } satisfies AuthorizedChronosUser;
}

async function readChronosProfilesFromSupabase(
  client: ChronosClient,
  options: { includeArchived?: boolean } = {},
) {
  const { data: registry, error } = await client
    .from("chronos_rooms")
    .select("*")
    .eq("slug", chronosProfileRegistrySlug)
    .maybeSingle<ChronosRoomRow>();

  if (error) {
    throw error;
  }

  const profiles = normalizeChronosProfileList(
    Array.isArray(registry?.metadata?.profiles)
      ? registry.metadata.profiles
      : [],
  );

  return options.includeArchived
    ? profiles
    : profiles.filter((profile) => profile.status === "active");
}

async function resolveChronosMeetingProfileForInput({
  client,
  input,
}: {
  client: ChronosClient;
  input: ChronosCreateMeetingInput;
}) {
  const profiles = await readChronosProfilesFromSupabase(client);
  const selectedProfile =
    profiles.find((profile) => profile.id === input.profileId) ??
    profiles.find((profile) => profile.id === input.meetingType) ??
    profiles.find((profile) => profile.meetingType === input.meetingType) ??
    defaultChronosMeetingProfiles[0];

  return selectedProfile;
}

async function resolveChronosPublicReservationMeeting(
  client: ChronosClient,
  room: ChronosRoomRow,
) {
  const referenceDate = new Date();
  const activeMeetingResult = await client
    .from("chronos_meetings")
    .select("*")
    .eq("room_id", room.id)
    .in("status", ["lobby", "live"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ChronosMeetingRow>();

  if (activeMeetingResult.error) {
    throw activeMeetingResult.error;
  }

  if (activeMeetingResult.data) {
    return activeMeetingResult.data;
  }

  const windowEnd = new Date(
    referenceDate.getTime() + 15 * 60 * 1000,
  ).toISOString();
  const scheduledMeetingResult = await client
    .from("chronos_meetings")
    .select("*")
    .eq("room_id", room.id)
    .in("status", ["scheduled", "lobby"])
    .lte("starts_at", windowEnd)
    .order("starts_at", { ascending: true })
    .limit(10);

  if (scheduledMeetingResult.error) {
    throw scheduledMeetingResult.error;
  }

  const meeting = (scheduledMeetingResult.data ?? []).find((candidate) =>
    isChronosReservationInJoinWindow(candidate, referenceDate),
  );

  if (!meeting) {
    throw new Error(
      "Sala Chronos sem reserva ativa na agenda para este horario.",
    );
  }

  return meeting;
}

async function openChronosPublicReservation({
  client,
  isHost,
  meeting,
  participantName,
  room,
}: {
  client: ChronosClient;
  isHost: boolean;
  meeting: ChronosMeetingRow;
  participantName: string;
  room: ChronosRoomRow;
}) {
  const now = new Date().toISOString();
  const metadata = {
    ...(meeting.metadata ?? {}),
    athena: {
      ...readRecordMetadata(meeting.metadata?.athena),
      assistant: "Athena",
      transcription: room.transcription_required,
    },
    externalRoom: {
      ...readRecordMetadata(meeting.metadata?.externalRoom),
      accessMode: "request_entry",
      actualStartedAt: now,
      openedBy: isHost ? "host" : "participant",
      roomSlug: room.slug,
      source: "chronos-external-room",
    },
  };
  const { data, error } = await client
    .from("chronos_meetings")
    .update({
      metadata,
      status: "live",
    })
    .eq("id", meeting.id)
    .select("*")
    .single<ChronosMeetingRow>();

  if (error) {
    throw error;
  }

  await insertTimelineEvent(client, {
    eventType: "joined",
    meetingId: meeting.id,
    title: isHost
      ? "Reserva Chronos aberta pelo host"
      : `Reserva Chronos aberta por ${participantName}`,
  });

  return data;
}

function isChronosReservationInJoinWindow(
  meeting: ChronosMeetingRow,
  referenceDate: Date,
) {
  if (!meeting.starts_at) {
    return false;
  }

  const startsAt = new Date(meeting.starts_at).getTime();
  const endsAt = meeting.ends_at
    ? new Date(meeting.ends_at).getTime()
    : startsAt + 60 * 60 * 1000;
  const windowStart = startsAt - 15 * 60 * 1000;
  const now = referenceDate.getTime();

  return now >= windowStart && now <= endsAt;
}

function readRecordMetadata(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isChronosMeetingVisibleInUserAgenda(
  meeting: ChronosMeetingRow,
  user: AuthorizedChronosUser,
) {
  const metadata = readRecordMetadata(meeting.metadata);
  const source = typeof metadata.source === "string" ? metadata.source : null;

  if (source !== "google-calendar") {
    return true;
  }

  const googleCalendar = readRecordMetadata(metadata.googleCalendar);
  const visibility =
    typeof googleCalendar.visibility === "string"
      ? googleCalendar.visibility
      : null;

  if (visibility === "out_of_scope") {
    return false;
  }

  return meeting.host_user_id === user.id;
}

async function getChronosPublicMeetingContext({
  client,
  meetingId,
  roomSlug,
}: {
  client: ChronosClient;
  meetingId: string;
  roomSlug: string;
}) {
  const room = await getChronosRoomRowBySlug(client, roomSlug);

  if (!room) {
    throw new Error("Sala Chronos nao encontrada.");
  }

  const { data: meeting, error } = await client
    .from("chronos_meetings")
    .select("*")
    .eq("id", meetingId)
    .eq("room_id", room.id)
    .maybeSingle<ChronosMeetingRow>();

  if (error) {
    throw error;
  }

  if (!meeting) {
    throw new Error("Reuniao Chronos nao encontrada para esta sala.");
  }

  return { meeting, room };
}

function createChronosClient() {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient<ChronosDatabase>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function canUseChronosLocalFallback() {
  return (
    process.env[chronosLocalFallbackFlag] === "true" &&
    process.env.NODE_ENV === "development" &&
    !isPublishedRuntime()
  );
}

function isPublishedRuntime() {
  return process.env.NODE_ENV === "production";
}

function assertCanManageChronos(user: AuthorizedChronosUser) {
  if (!getPermissionsForRole(user.role).includes("chronos:manage")) {
    throw new ChronosForbiddenError();
  }
}

function assertChronosAdmin(
  user: AuthorizedChronosUser,
  message = "Somente administradores podem executar esta acao.",
) {
  if (user.role !== "admin") {
    throw new ChronosForbiddenError(message);
  }
}

async function assertChronosMeetingHasAvailableRecording(
  client: ChronosClient,
  meetingId: string,
) {
  const recordingResult = await client
    .from("chronos_recordings")
    .select("id, storage_bucket, storage_path")
    .eq("meeting_id", meetingId)
    .eq("status", "available")
    .limit(1);

  if (recordingResult.error) {
    throw recordingResult.error;
  }

  const hasStoredRecording = Boolean(
    recordingResult.data?.some((recording) =>
      Boolean(recording.storage_path?.trim()),
    ),
  );

  if (!hasStoredRecording) {
    throw new Error(
      "Ata Chronos requer gravacao disponivel vinculada a reuniao.",
    );
  }
}

async function applyChronosUpdate({
  client,
  input,
  user,
}: {
  client: ChronosClient;
  input: ChronosUpdateInput;
  user: AuthorizedChronosUser;
}) {
  if (input.action === "set_status") {
    const { error } = await client
      .from("chronos_meetings")
      .update({ status: input.status })
      .eq("id", input.meetingId);

    if (error) {
      throw error;
    }

    await insertTimelineEvent(client, {
      actorUserId: user.id,
      eventType: input.status === "live" ? "joined" : "note",
      meetingId: input.meetingId,
      title: `Status atualizado para ${input.status}`,
    });
    return;
  }

  if (input.action === "mark_recording") {
    const now = new Date().toISOString();
    const { error } = await client
      .from("chronos_meetings")
      .update({ recording_status: input.status })
      .eq("id", input.meetingId);

    if (error) {
      throw error;
    }

    const recordingResult = await client.from("chronos_recordings").insert({
      created_by_user_id: user.id,
      duration_seconds: input.durationSeconds ?? null,
      meeting_id: input.meetingId,
      metadata: { source: "chronos-v1-browser" },
      started_at: input.status === "recording" ? now : null,
      status: input.status,
      stopped_at: input.status === "available" ? now : null,
    });

    if (recordingResult.error) {
      throw recordingResult.error;
    }

    await insertTimelineEvent(client, {
      actorUserId: user.id,
      eventType:
        input.status === "recording"
          ? "recording_started"
          : "recording_stopped",
      meetingId: input.meetingId,
      title:
        input.status === "recording"
          ? "Gravacao iniciada"
          : "Gravacao finalizada",
    });
    return;
  }

  if (input.action === "add_transcript") {
    const source = sanitizeChronosTranscriptSource(input.source);
    const insertResult = await client.from("chronos_transcript_segments").insert({
      content: sanitizeText(input.content, maxChronosTranscriptContentLength),
      created_by_user_id: user.id,
      meeting_id: input.meetingId,
      source,
      speaker_label: sanitizeOptionalText(input.speakerLabel, 80),
    });

    if (insertResult.error) {
      throw insertResult.error;
    }

    const updateResult = await client
      .from("chronos_meetings")
      .update({ transcription_status: "available" })
      .eq("id", input.meetingId);

    if (updateResult.error) {
      throw updateResult.error;
    }

    await insertTimelineEvent(client, {
      actorUserId: user.id,
      eventType: "transcript_added",
      meetingId: input.meetingId,
      title:
        source === "openai" || source === "athena"
          ? "Transcricao Athena registrada"
          : "Trecho de transcricao registrado",
    });
    return;
  }

  if (input.action === "save_summary") {
    const { error } = await client
      .from("chronos_meetings")
      .update({
        executive_summary: sanitizeText(input.summary, maxTextLength),
      })
      .eq("id", input.meetingId);

    if (error) {
      throw error;
    }

    await insertTimelineEvent(client, {
      actorUserId: user.id,
      eventType: "summary_generated",
      meetingId: input.meetingId,
      title: "Resumo executivo registrado",
    });
    return;
  }

  if (input.action === "save_minutes") {
    await assertChronosMeetingHasAvailableRecording(client, input.meetingId);
    const version = await getNextMinutesVersion(client, input.meetingId);
    const minutesResult = await client.from("chronos_minutes").insert({
      content: sanitizeText(input.content, maxChronosMinutesContentLength),
      created_by_user_id: user.id,
      meeting_id: input.meetingId,
      status: input.status,
      version,
      approved_at: input.status === "approved" ? new Date().toISOString() : null,
      approved_by_user_id: input.status === "approved" ? user.id : null,
    });

    if (minutesResult.error) {
      throw minutesResult.error;
    }

    const meetingResult = await client
      .from("chronos_meetings")
      .update({ minutes_status: input.status })
      .eq("id", input.meetingId);

    if (meetingResult.error) {
      throw meetingResult.error;
    }

    await insertTimelineEvent(client, {
      actorUserId: user.id,
      eventType:
        input.status === "approved" ? "minutes_approved" : "minutes_drafted",
      meetingId: input.meetingId,
      title:
        input.status === "approved"
          ? "Ata aprovada por revisao humana"
          : "Ata registrada para revisao",
    });
    return;
  }

  if (input.action === "delete_recording") {
    assertChronosAdmin(
      user,
      "Somente administradores podem excluir gravacoes.",
    );

    const recordingResult = await client
      .from("chronos_recordings")
      .select("*")
      .eq("meeting_id", input.meetingId)
      .eq("id", input.recordingId)
      .maybeSingle<ChronosRecordingRow>();

    if (recordingResult.error) {
      throw recordingResult.error;
    }

    if (!recordingResult.data) {
      throw new Error("Gravacao Chronos nao encontrada.");
    }

    if (
      recordingResult.data.storage_bucket &&
      recordingResult.data.storage_path
    ) {
      const removeResult = await client.storage
        .from(recordingResult.data.storage_bucket)
        .remove([recordingResult.data.storage_path]);

      if (removeResult.error) {
        throw removeResult.error;
      }
    }

    const deleteResult = await client
      .from("chronos_recordings")
      .delete()
      .eq("meeting_id", input.meetingId)
      .eq("id", input.recordingId);

    if (deleteResult.error) {
      throw deleteResult.error;
    }

    const remainingResult = await client
      .from("chronos_recordings")
      .select("status,created_at")
      .eq("meeting_id", input.meetingId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (remainingResult.error) {
      throw remainingResult.error;
    }

    const nextStatus =
      remainingResult.data?.[0]?.status &&
      isChronosCaptureStatus(remainingResult.data[0].status)
        ? remainingResult.data[0].status
        : "not_started";
    const meetingResult = await client
      .from("chronos_meetings")
      .update({ recording_status: nextStatus })
      .eq("id", input.meetingId);

    if (meetingResult.error) {
      throw meetingResult.error;
    }

    await insertTimelineEvent(client, {
      actorUserId: user.id,
      eventType: "note",
      meetingId: input.meetingId,
      title: "Gravacao excluida por administrador",
    });
    return;
  }

  if (input.action === "delete_minutes") {
    assertChronosAdmin(user, "Somente administradores podem excluir atas.");

    const deleteResult = await client
      .from("chronos_minutes")
      .delete()
      .eq("meeting_id", input.meetingId)
      .eq("id", input.minutesId);

    if (deleteResult.error) {
      throw deleteResult.error;
    }

    const remainingResult = await client
      .from("chronos_minutes")
      .select("status,created_at")
      .eq("meeting_id", input.meetingId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (remainingResult.error) {
      throw remainingResult.error;
    }

    const nextStatus =
      remainingResult.data?.[0]?.status &&
      isChronosMinutesStatus(remainingResult.data[0].status)
        ? remainingResult.data[0].status
        : "not_started";
    const meetingResult = await client
      .from("chronos_meetings")
      .update({ minutes_status: nextStatus })
      .eq("id", input.meetingId);

    if (meetingResult.error) {
      throw meetingResult.error;
    }

    await insertTimelineEvent(client, {
      actorUserId: user.id,
      eventType: "note",
      meetingId: input.meetingId,
      title: "Ata excluida por administrador",
    });
    return;
  }

  if (input.action === "create_followup") {
    const followUpResult = await client.from("chronos_followups").insert({
      created_by_user_id: user.id,
      due_at: sanitizeOptionalText(input.dueAt, 80),
      meeting_id: input.meetingId,
      owner_name: sanitizeOptionalText(input.ownerName, 120),
      status: "open",
      title: sanitizeText(input.title, 180),
    });

    if (followUpResult.error) {
      throw followUpResult.error;
    }

    await insertTimelineEvent(client, {
      actorUserId: user.id,
      eventType: "followup_created",
      meetingId: input.meetingId,
      title: "Follow-up criado",
    });
    return;
  }

  if (input.action === "complete_followup") {
    const followUpResult = await client
      .from("chronos_followups")
      .update({
        completed_at: new Date().toISOString(),
        status: "done",
      })
      .eq("id", input.followUpId)
      .eq("meeting_id", input.meetingId);

    if (followUpResult.error) {
      throw followUpResult.error;
    }

    await insertTimelineEvent(client, {
      actorUserId: user.id,
      eventType: "followup_done",
      meetingId: input.meetingId,
      title: "Follow-up concluido",
    });
    return;
  }

  const timelineResult = await client.from("chronos_timeline_events").insert({
    actor_user_id: user.id,
    description: sanitizeOptionalText(input.description, maxTextLength),
    event_type: input.eventType ?? "note",
    meeting_id: input.meetingId,
    title: sanitizeText(input.title, 180),
  });

  if (timelineResult.error) {
    throw timelineResult.error;
  }
}

async function insertTimelineEvent(
  client: ChronosClient,
  input: {
    actorUserId?: string | null;
    description?: string;
    eventType: ChronosEventType;
    meetingId: string;
    title: string;
  },
) {
  const { error } = await client.from("chronos_timeline_events").insert({
    actor_user_id: input.actorUserId ?? null,
    description: input.description ?? null,
    event_type: input.eventType,
    meeting_id: input.meetingId,
    title: input.title,
  });

  if (error) {
    throw error;
  }
}

async function getNextMinutesVersion(client: ChronosClient, meetingId: string) {
  const { data, error } = await client
    .from("chronos_minutes")
    .select("version")
    .eq("meeting_id", meetingId)
    .order("version", { ascending: false })
    .limit(1);

  if (error) {
    throw error;
  }

  return (data?.[0]?.version ?? 0) + 1;
}

async function generateChronosProtocol(client: ChronosClient | null) {
  if (!client) {
    const snapshot = await readLocalChronosSnapshot();

    return `CHR-${String(snapshot.meetings.length + 1).padStart(6, "0")}`;
  }

  const { data } = await client
    .from("chronos_meetings")
    .select("protocol")
    .order("created_at", { ascending: false })
    .limit(1);
  const lastProtocol = data?.[0]?.protocol ?? "";
  const lastNumber = Number(lastProtocol.replace(/\D/g, ""));

  return `CHR-${String(Number.isFinite(lastNumber) ? lastNumber + 1 : 1).padStart(6, "0")}`;
}

function normalizeCreateMeetingInput(input: unknown): ChronosCreateMeetingInput {
  if (!input || typeof input !== "object") {
    throw new Error("Informe os dados da reuniao.");
  }

  const maybeInput = input as Partial<ChronosCreateMeetingInput>;
  const title = sanitizeText(maybeInput.title, 160);

  if (!title) {
    throw new Error("Informe o titulo da reuniao.");
  }
  const startsAt = normalizeOptionalDate(maybeInput.startsAt);
  const endsAt = normalizeOptionalDate(maybeInput.endsAt);

  if (
    startsAt &&
    endsAt &&
    new Date(endsAt).getTime() <= new Date(startsAt).getTime()
  ) {
    throw new Error("Informe um horario final posterior ao inicio.");
  }

  const locationMode =
    maybeInput.locationMode === "offline" ? "offline" : "online";
  const locationAddress =
    locationMode === "offline"
      ? sanitizeOptionalText(maybeInput.locationAddress, 240)
      : undefined;

  if (locationMode === "offline" && !locationAddress) {
    throw new Error("Informe o endereco da reuniao presencial.");
  }

  return {
    agenda: normalizeStringList(maybeInput.agenda).slice(0, 12),
    apoloInvitees: normalizeApoloInvitees(maybeInput.apoloInvitees),
    calendarEventKind: isChronosCalendarEventKind(maybeInput.calendarEventKind)
      ? maybeInput.calendarEventKind
      : "event",
    endsAt,
    externalReference: sanitizeOptionalText(maybeInput.externalReference, 180),
    hubInvitees: normalizeHubInvitees(maybeInput.hubInvitees),
    locationAddress,
    locationMode,
    meetingType: isChronosMeetingType(maybeInput.meetingType)
      ? maybeInput.meetingType
      : "alignment",
    objective: sanitizeOptionalText(maybeInput.objective, maxTextLength),
    participants: normalizeCreateParticipants(maybeInput.participants),
    profileId: sanitizeOptionalText(maybeInput.profileId, 80),
    roomId: sanitizeOptionalText(maybeInput.roomId, 80),
    startsAt,
    title,
  };
}

function normalizeRoomInput(input: unknown): Required<ChronosRoomInput> {
  if (!input || typeof input !== "object") {
    throw new Error("Informe os dados da sala Chronos.");
  }

  const maybeInput = input as Partial<ChronosRoomInput>;
  const name = sanitizeText(maybeInput.name, 120);

  if (!name) {
    throw new Error("Informe o nome da sala Chronos.");
  }

  const slug = normalizeRoomSlug(maybeInput.slug, name);

  return {
    backgroundDataUrl: sanitizeRoomBackgroundDataUrl(
      maybeInput.backgroundDataUrl,
    ),
    backgroundName: sanitizeOptionalText(maybeInput.backgroundName, 120) ?? "",
    capacity: normalizeRoomCapacity(maybeInput.capacity),
    minutesRequired: maybeInput.minutesRequired !== false,
    name,
    recordingRequired: maybeInput.recordingRequired !== false,
    roomType: normalizeChronosOfficialProfileId(maybeInput.roomType),
    slug,
    transcriptionRequired: maybeInput.transcriptionRequired !== false,
  };
}

function normalizeRoomUpdateInput(input: unknown): ChronosRoomUpdateInput {
  if (!input || typeof input !== "object") {
    throw new Error("Informe os dados da sala Chronos.");
  }

  const maybeInput = input as Partial<ChronosRoomUpdateInput>;
  const roomId = sanitizeText(maybeInput.roomId, 80);

  if (!roomId) {
    throw new Error("Sala Chronos nao informada.");
  }

  const name = sanitizeOptionalText(maybeInput.name, 120);

  return {
    backgroundDataUrl:
      maybeInput.backgroundDataUrl === undefined
        ? undefined
        : sanitizeRoomBackgroundDataUrl(maybeInput.backgroundDataUrl),
    backgroundName:
      maybeInput.backgroundName === undefined
        ? undefined
        : sanitizeOptionalText(maybeInput.backgroundName, 120),
    capacity:
      maybeInput.capacity === undefined
        ? undefined
        : normalizeRoomCapacity(maybeInput.capacity),
    minutesRequired:
      typeof maybeInput.minutesRequired === "boolean"
        ? maybeInput.minutesRequired
        : undefined,
    name,
    recordingRequired:
      typeof maybeInput.recordingRequired === "boolean"
        ? maybeInput.recordingRequired
        : undefined,
    roomId,
    roomType:
      maybeInput.roomType === undefined
        ? undefined
        : normalizeChronosOfficialProfileId(maybeInput.roomType),
    slug:
      maybeInput.slug === undefined && !name
        ? undefined
        : normalizeRoomSlug(maybeInput.slug, name ?? "sala-chronos"),
    transcriptionRequired:
      typeof maybeInput.transcriptionRequired === "boolean"
        ? maybeInput.transcriptionRequired
        : undefined,
  };
}

function normalizeRoomDeleteInput(input: unknown): ChronosRoomDeleteInput {
  if (!input || typeof input !== "object") {
    throw new Error("Informe a sala Chronos.");
  }

  const roomId = sanitizeText(
    (input as Partial<ChronosRoomDeleteInput>).roomId,
    80,
  );

  if (!roomId) {
    throw new Error("Sala Chronos nao informada.");
  }

  return { roomId };
}

function normalizeDeleteMeetingInput(input: unknown): ChronosMeetingDeleteInput {
  if (!input || typeof input !== "object") {
    throw new Error("Informe o evento Chronos.");
  }

  const meetingId = sanitizeText(
    (input as Partial<ChronosMeetingDeleteInput>).meetingId,
    80,
  );

  if (!meetingId) {
    throw new Error("Evento Chronos nao informado.");
  }

  return { meetingId };
}

function normalizeChronosProfileList(
  value: unknown,
): ChronosMeetingProfile[] {
  void value;

  return defaultChronosMeetingProfiles.map((profile) => ({
    ...profile,
  }));
}

function normalizeChronosOfficialProfileId(value: unknown) {
  const candidate = sanitizeOptionalText(value, 80) ?? "";

  return defaultChronosMeetingProfiles.some((profile) => profile.id === candidate)
    ? candidate
    : defaultChronosMeetingProfiles[0].id;
}

function normalizeChronosRoom(room: ChronosRoom): ChronosRoom {
  return {
    ...room,
    roomType: normalizeChronosOfficialProfileId(room.roomType),
  };
}

function normalizePublicParticipantInput(
  input: unknown,
): NormalizedChronosPublicParticipantInput {
  const maybeInput =
    input && typeof input === "object"
      ? (input as Partial<ChronosPublicParticipantInput>)
      : {};

  return {
    displayName: sanitizeOptionalText(maybeInput.displayName, 100),
    organization: sanitizeOptionalText(maybeInput.organization, 120),
  };
}

function normalizePublicRecordingInput(
  input: unknown,
): NormalizedChronosPublicRecordingInput {
  if (!input || typeof input !== "object") {
    throw new Error("Informe os dados da gravacao Chronos.");
  }

  const maybeInput = input as Partial<NormalizedChronosPublicRecordingInput>;
  const meetingId = sanitizeText(maybeInput.meetingId, 80);
  const participantId = sanitizeText(maybeInput.participantId, 80);
  const status = maybeInput.status;

  if (!meetingId || !participantId) {
    throw new Error("Reuniao ou participante Chronos nao informado.");
  }

  if (status !== "available" && status !== "failed" && status !== "recording") {
    throw new Error("Status de gravacao Chronos invalido.");
  }

  return {
    durationSeconds: normalizeOptionalDurationSeconds(
      maybeInput.durationSeconds,
    ),
    meetingId,
    participantId,
    status,
  };
}

function normalizePublicRecordingUploadInput(
  input: FormData,
): NormalizedChronosPublicRecordingUploadInput {
  const meetingId = sanitizeText(input.get("meetingId"), 80);
  const participantId = sanitizeText(input.get("participantId"), 80);
  const durationSeconds = normalizeOptionalDurationSeconds(
    input.get("durationSeconds"),
  );
  const file = input.get("file");

  if (!meetingId || !participantId) {
    throw new Error("Reuniao ou participante Chronos nao informado.");
  }

  if (!isChronosUploadFile(file)) {
    throw new Error("Arquivo de gravacao Chronos nao informado.");
  }

  if (file.size <= 0 || file.size > maxChronosRecordingUploadBytes) {
    throw new Error("Arquivo de gravacao Chronos fora do limite permitido.");
  }

  return {
    durationSeconds,
    file,
    fileName: sanitizeChronosFileName(
      sanitizeOptionalText(input.get("fileName"), 180) ?? file.name,
    ),
    meetingId,
    mimeType: sanitizeOptionalText(file.type, 120) ?? "video/webm",
    participantId,
    sizeBytes: file.size,
  };
}

function normalizePublicRecordingUploadUrlInput(
  input: unknown,
): NormalizedChronosPublicRecordingUploadUrlInput {
  if (!input || typeof input !== "object") {
    throw new Error("Informe os dados da gravacao Chronos.");
  }

  const maybeInput =
    input as Partial<NormalizedChronosPublicRecordingUploadUrlInput>;
  const meetingId = sanitizeText(maybeInput.meetingId, 80);
  const participantId = sanitizeText(maybeInput.participantId, 80);
  const fileName = sanitizeChronosFileName(
    sanitizeOptionalText(maybeInput.fileName, 180) ?? "gravacao-chronos.webm",
  );
  const mimeType =
    sanitizeOptionalText(maybeInput.mimeType, 120) ?? "video/webm";
  const sizeBytes =
    typeof maybeInput.sizeBytes === "number" && Number.isFinite(maybeInput.sizeBytes)
      ? maybeInput.sizeBytes
      : 0;

  if (!meetingId || !participantId) {
    throw new Error("Reuniao ou participante Chronos nao informado.");
  }

  if (sizeBytes <= 0 || sizeBytes > maxChronosRecordingUploadBytes) {
    throw new Error("Arquivo de gravacao Chronos fora do limite permitido.");
  }

  return {
    durationSeconds: normalizeOptionalDurationSeconds(
      maybeInput.durationSeconds,
    ),
    fileName,
    meetingId,
    mimeType,
    participantId,
    sizeBytes,
    startedAt: normalizeOptionalDate(maybeInput.startedAt),
  };
}

function normalizePublicRecordingUploadCompletionInput(
  input: unknown,
): NormalizedChronosPublicRecordingUploadCompletionInput {
  const normalizedInput = normalizePublicRecordingUploadUrlInput(input);
  const maybeInput =
    input as Partial<NormalizedChronosPublicRecordingUploadCompletionInput>;
  const storageBucket = sanitizeText(maybeInput.storageBucket, 80);
  const storagePath = sanitizeText(maybeInput.storagePath, 500);

  if (!storageBucket || !storagePath) {
    throw new Error("Arquivo de gravacao Chronos nao confirmado.");
  }

  return {
    ...normalizedInput,
    storageBucket,
    storagePath,
  };
}

function normalizePublicChatInput(
  input: unknown,
): NormalizedChronosPublicChatInput {
  if (!input || typeof input !== "object") {
    throw new Error("Informe a mensagem do chat Chronos.");
  }

  const maybeInput = input as Partial<NormalizedChronosPublicChatInput>;
  const content = sanitizeText(maybeInput.content, 1800);
  const meetingId = sanitizeText(maybeInput.meetingId, 80);
  const participantId = sanitizeText(maybeInput.participantId, 80);
  const senderName = sanitizeText(maybeInput.senderName, 120);

  if (!meetingId || !participantId) {
    throw new Error("Reuniao ou participante Chronos nao informado.");
  }

  if (!senderName) {
    throw new Error("Identifique o remetente do chat Chronos.");
  }

  if (!content) {
    throw new Error("Mensagem de chat Chronos vazia.");
  }

  return {
    clientMessageId: sanitizeOptionalText(maybeInput.clientMessageId, 120),
    content,
    meetingId,
    participantId,
    senderName,
  };
}

function normalizePublicCloseInput(
  input: unknown,
): NormalizedChronosPublicCloseInput {
  if (!input || typeof input !== "object") {
    throw new Error("Informe os dados de encerramento Chronos.");
  }

  const maybeInput = input as Partial<NormalizedChronosPublicCloseInput>;
  const meetingId = sanitizeText(maybeInput.meetingId, 80);
  const participantId = sanitizeText(maybeInput.participantId, 80);

  if (!meetingId || !participantId) {
    throw new Error("Reuniao ou participante Chronos nao informado.");
  }

  return {
    meetingId,
    participantId,
  };
}

function normalizePublicTranscriptInput(
  input: unknown,
): NormalizedChronosPublicTranscriptInput {
  if (!input || typeof input !== "object") {
    throw new Error("Informe o trecho de transcricao Chronos.");
  }

  const maybeInput = input as Partial<NormalizedChronosPublicTranscriptInput>;
  const content = sanitizeText(maybeInput.content, 2200);
  const meetingId = sanitizeText(maybeInput.meetingId, 80);
  const participantId = sanitizeText(maybeInput.participantId, 80);
  const speakerLabel = sanitizeText(maybeInput.speakerLabel, 120);

  if (!meetingId || !participantId) {
    throw new Error("Reuniao ou participante Chronos nao informado.");
  }

  if (!speakerLabel) {
    throw new Error("Identifique o participante da transcricao.");
  }

  if (!content) {
    throw new Error("Conteudo de transcricao vazio.");
  }

  return {
    content,
    endedAt: normalizeOptionalDate(maybeInput.endedAt),
    meetingId,
    participantId,
    speakerLabel,
    startedAt: normalizeOptionalDate(maybeInput.startedAt),
  };
}

function normalizeUpdateInput(input: unknown): ChronosUpdateInput {
  if (!input || typeof input !== "object") {
    throw new Error("Informe a atualizacao da reuniao.");
  }

  const maybeInput = input as Partial<ChronosUpdateInput> & {
    action?: unknown;
    meetingId?: unknown;
  };
  const action = typeof maybeInput.action === "string" ? maybeInput.action : "";
  const meetingId =
    typeof maybeInput.meetingId === "string" ? maybeInput.meetingId.trim() : "";

  if (!meetingId) {
    throw new Error("Reuniao Chronos nao informada.");
  }

  if (action === "set_status") {
    const status = (maybeInput as { status?: unknown }).status;

    if (!isChronosMeetingStatus(status)) {
      throw new Error("Status Chronos invalido.");
    }

    return { action, meetingId, status };
  }

  if (action === "mark_recording") {
    const status = (maybeInput as { status?: unknown }).status;
    const durationSeconds = (maybeInput as { durationSeconds?: unknown })
      .durationSeconds;

    if (!isChronosCaptureStatus(status)) {
      throw new Error("Status de gravacao invalido.");
    }

    return {
      action,
      durationSeconds:
        typeof durationSeconds === "number" && durationSeconds >= 0
          ? Math.round(durationSeconds)
          : undefined,
      meetingId,
      status,
    };
  }

  if (action === "add_transcript") {
    const source = sanitizeChronosTranscriptSource(
      (maybeInput as { source?: unknown }).source,
    );

    return {
      action,
      content: sanitizeText(
        (maybeInput as { content?: unknown }).content,
        maxChronosTranscriptContentLength,
      ),
      meetingId,
      source,
      speakerLabel: sanitizeOptionalText(
        (maybeInput as { speakerLabel?: unknown }).speakerLabel,
        80,
      ),
    };
  }

  if (action === "save_summary") {
    return {
      action,
      meetingId,
      summary: sanitizeText((maybeInput as { summary?: unknown }).summary, maxTextLength),
    };
  }

  if (action === "save_minutes") {
    const status = (maybeInput as { status?: unknown }).status;

    if (!isChronosMinutesStatus(status)) {
      throw new Error("Status da ata invalido.");
    }

    return {
      action,
      content: sanitizeText(
        (maybeInput as { content?: unknown }).content,
        maxChronosMinutesContentLength,
      ),
      meetingId,
      status,
    };
  }

  if (action === "delete_minutes") {
    const minutesId = sanitizeOptionalText(
      (maybeInput as { minutesId?: unknown }).minutesId,
      80,
    );

    if (!minutesId) {
      throw new Error("Ata nao informada para exclusao.");
    }

    return {
      action,
      meetingId,
      minutesId,
    };
  }

  if (action === "delete_recording") {
    const recordingId = sanitizeOptionalText(
      (maybeInput as { recordingId?: unknown }).recordingId,
      80,
    );

    if (!recordingId) {
      throw new Error("Gravacao nao informada para exclusao.");
    }

    return {
      action,
      meetingId,
      recordingId,
    };
  }

  if (action === "create_followup") {
    return {
      action,
      dueAt: normalizeOptionalDate((maybeInput as { dueAt?: unknown }).dueAt),
      meetingId,
      ownerName: sanitizeOptionalText(
        (maybeInput as { ownerName?: unknown }).ownerName,
        120,
      ),
      title: sanitizeText((maybeInput as { title?: unknown }).title, 180),
    };
  }

  if (action === "complete_followup") {
    const followUpId =
      typeof (maybeInput as { followUpId?: unknown }).followUpId === "string"
        ? (maybeInput as { followUpId: string }).followUpId.trim()
        : "";

    if (!followUpId) {
      throw new Error("Follow-up nao informado.");
    }

    return { action, followUpId, meetingId };
  }

  if (action === "add_timeline_event") {
    const eventType = (maybeInput as { eventType?: unknown }).eventType;

    return {
      action,
      description: sanitizeOptionalText(
        (maybeInput as { description?: unknown }).description,
        maxTextLength,
      ),
      eventType: isChronosEventType(eventType) ? eventType : "note",
      meetingId,
      title: sanitizeText((maybeInput as { title?: unknown }).title, 180),
    };
  }

  throw new Error("Acao Chronos invalida.");
}

function sanitizeChronosTranscriptSource(
  value: unknown,
): "athena" | "browser" | "manual" | "openai" {
  return value === "athena" ||
    value === "browser" ||
    value === "openai" ||
    value === "manual"
    ? value
    : "manual";
}

function normalizeParticipantsForInsert({
  input,
  meetingId,
  user,
}: {
  input: ChronosCreateMeetingInput;
  meetingId: string;
  user: AuthorizedChronosUser;
}): ChronosDatabase["public"]["Tables"]["chronos_participants"]["Insert"][] {
  const participants = input.participants ?? [];
  const hasHost = participants.some((participant) => participant.role === "host");

  return [
    ...(hasHost
      ? []
      : [
          {
            attendance_status: "confirmed",
            display_name: user.name,
            email: user.email,
            meeting_id: meetingId,
            role: "host" as const,
            user_id: user.id,
          },
        ]),
    ...participants.map((participant) => ({
      attendance_status: "invited",
      display_name: participant.displayName,
      email: participant.email ?? null,
      meeting_id: meetingId,
      organization: participant.organization ?? null,
      role: participant.role ?? "participant",
      user_id: participant.userId ?? null,
    })),
  ];
}

function normalizeCreateParticipants(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((participant) => {
      if (!participant || typeof participant !== "object") {
        return null;
      }

      const maybeParticipant = participant as {
        displayName?: unknown;
        email?: unknown;
        organization?: unknown;
        role?: unknown;
        userId?: unknown;
      };
      const displayName = sanitizeText(maybeParticipant.displayName, 120);

      if (!displayName) {
        return null;
      }

      return {
        displayName,
        email: sanitizeOptionalText(maybeParticipant.email, 160),
        organization: sanitizeOptionalText(maybeParticipant.organization, 120),
        role: isChronosParticipantRole(maybeParticipant.role)
          ? maybeParticipant.role
          : "participant",
        userId: sanitizeOptionalText(maybeParticipant.userId, 80),
      };
    })
    .filter(Boolean)
    .slice(0, 30) as NonNullable<ChronosCreateMeetingInput["participants"]>;
}

function normalizeHubInvitees(input: unknown): ChronosHubInvitee[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((invitee) => {
      if (!invitee || typeof invitee !== "object") {
        return null;
      }

      const maybeInvitee = invitee as {
        displayName?: unknown;
        email?: unknown;
        operationalProfile?: unknown;
        role?: unknown;
        userId?: unknown;
      };
      const userId = sanitizeText(maybeInvitee.userId, 80);
      const displayName = sanitizeText(maybeInvitee.displayName, 120);
      const email = sanitizeText(maybeInvitee.email, 160);

      if (!userId || !displayName || !email) {
        return null;
      }

      return {
        displayName,
        email,
        operationalProfile:
          sanitizeOptionalText(maybeInvitee.operationalProfile, 40) ?? null,
        role: sanitizeOptionalText(maybeInvitee.role, 40) ?? null,
        userId,
      };
    })
    .filter(Boolean)
    .slice(0, 30) as ChronosHubInvitee[];
}

function normalizeApoloInvitees(input: unknown): ChronosApoloInvitee[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((invitee) => {
      if (!invitee || typeof invitee !== "object") {
        return null;
      }

      const maybeInvitee = invitee as {
        displayName?: unknown;
        email?: unknown;
        entityId?: unknown;
        organization?: unknown;
        phone?: unknown;
      };
      const displayName = sanitizeText(maybeInvitee.displayName, 120);
      const entityId = sanitizeText(maybeInvitee.entityId, 120);

      if (!displayName || !entityId) {
        return null;
      }

      return {
        displayName,
        email: sanitizeOptionalText(maybeInvitee.email, 160),
        entityId,
        organization: sanitizeOptionalText(maybeInvitee.organization, 120),
        phone: sanitizeOptionalText(maybeInvitee.phone, 40),
      };
    })
    .filter(Boolean)
    .slice(0, 30) as ChronosApoloInvitee[];
}

async function readLocalChronosSnapshot(): Promise<Omit<ChronosSnapshot, "storage">> {
  try {
    const file = await readFile(chronosLocalStorePath, "utf8");
    const payload = JSON.parse(file) as Partial<ChronosLocalStore>;

    return {
      meetings: Array.isArray(payload.meetings) ? payload.meetings : [],
      profiles: normalizeChronosProfileList(payload.profiles),
      rooms: Array.isArray(payload.rooms)
        ? payload.rooms.map(normalizeChronosRoom)
        : defaultChronosRooms.map(normalizeChronosRoom),
    };
  } catch {
    return {
      meetings: [],
      profiles: [...defaultChronosMeetingProfiles],
      rooms: defaultChronosRooms.map(normalizeChronosRoom),
    };
  }
}

async function writeLocalChronosStore(store: ChronosLocalStore) {
  await mkdir(path.dirname(chronosLocalStorePath), { recursive: true });
  await writeFile(chronosLocalStorePath, JSON.stringify(store, null, 2), "utf8");
}

async function createLocalChronosMeeting({
  input,
  user,
}: {
  input: ChronosCreateMeetingInput;
  user: AuthorizedChronosUser;
}) {
  const snapshot = await readLocalChronosSnapshot();
  const now = new Date().toISOString();
  const room =
    input.locationMode === "offline"
      ? null
      : snapshot.rooms.find((currentRoom) => currentRoom.id === input.roomId) ??
        snapshot.rooms[0] ??
        null;
  const selectedProfile =
    snapshot.profiles.find(
      (profile) =>
        profile.status === "active" &&
        profile.id === (input.profileId ?? input.meetingType),
    ) ??
    snapshot.profiles.find(
      (profile) =>
        profile.status === "active" && profile.id === input.meetingType,
    ) ??
    defaultChronosMeetingProfiles[0];
  const meeting: ChronosMeeting = {
    chatMessages: [],
    createdAt: now,
    endsAt: input.endsAt ?? null,
    executiveSummary: null,
    externalReference: input.externalReference ?? null,
    followUps: [],
    hostName: user.name,
    hostUserId: user.id,
    id: `local-chronos-${Date.now().toString(36)}`,
    meetingType: selectedProfile.meetingType,
    metadata: {
      agenda: input.agenda ?? [],
      apoloInvitees: input.apoloInvitees ?? [],
      calendarEventKind: input.calendarEventKind ?? "event",
      hubInvitees: input.hubInvitees ?? [],
      location: {
        address: input.locationAddress ?? null,
        mode: input.locationMode ?? "online",
      },
      meetingProfile: {
        id: selectedProfile.id,
        label: selectedProfile.label,
        meetingType: selectedProfile.meetingType,
      },
      source: "chronos-v1-local",
    },
    minutes: [],
    minutesStatus: "not_started",
    objective: input.objective ?? null,
    participants: [
      {
        attendanceStatus: "confirmed",
        displayName: user.name,
        email: user.email,
        id: `participant-${Date.now().toString(36)}`,
        role: "host",
        userId: user.id,
      },
      ...(input.participants ?? []).map((participant, index) => ({
        attendanceStatus: "invited",
        displayName: participant.displayName,
        email: participant.email ?? null,
        id: `participant-${Date.now().toString(36)}-${index}`,
        organization: participant.organization ?? null,
        role: participant.role ?? "participant",
        userId: participant.userId ?? null,
      })),
    ],
    protocol: await generateChronosProtocol(null),
    recordingStatus: "not_started",
    recordings: [],
    room,
    roomId: room?.id ?? null,
    startsAt: input.startsAt ?? null,
    status: "scheduled",
    timeline: [
      {
        eventAt: now,
        eventType: "created",
        id: `event-${Date.now().toString(36)}`,
        title: "Reuniao formal criada",
      },
    ],
    title: input.title,
    transcriptionStatus: "not_started",
    transcript: [],
    updatedAt: now,
  };

  await writeLocalChronosStore({
    meetings: [meeting, ...snapshot.meetings],
    profiles: snapshot.profiles,
    rooms: snapshot.rooms,
  });

  return meeting;
}

async function createLocalChronosRoom({
  input,
  user,
}: {
  input: Required<ChronosRoomInput>;
  user: AuthorizedChronosUser;
}) {
  const snapshot = await readLocalChronosSnapshot();

  if (snapshot.rooms.some((room) => room.slug === input.slug)) {
    throw new Error("Ja existe uma sala Chronos com este link.");
  }

  const room: ChronosRoom = {
    capacity: input.capacity,
    id: `local-room-${Date.now().toString(36)}`,
    metadata: {
      ...buildRoomMetadata(input),
      createdByUserId: user.id,
    },
    minutesRequired: input.minutesRequired,
    name: input.name,
    recordingRequired: input.recordingRequired,
    roomType: input.roomType,
    slug: input.slug,
    status: "active",
    transcriptionRequired: input.transcriptionRequired,
  };

  await writeLocalChronosStore({
    meetings: snapshot.meetings,
    profiles: snapshot.profiles,
    rooms: [room, ...snapshot.rooms],
  });

  return room;
}

async function updateLocalChronosRoom({
  input,
}: {
  input: ChronosRoomUpdateInput;
}) {
  const snapshot = await readLocalChronosSnapshot();
  let updatedRoom: ChronosRoom | null = null;
  const rooms = snapshot.rooms.map((room) => {
    if (room.id !== input.roomId) {
      return room;
    }

    const slug = input.slug ?? room.slug;
    updatedRoom = {
      ...room,
      capacity: input.capacity ?? room.capacity,
      metadata: buildRoomMetadata(
        {
          backgroundDataUrl: input.backgroundDataUrl,
          backgroundName: input.backgroundName,
          slug,
        },
        room.metadata,
      ),
      minutesRequired: input.minutesRequired ?? room.minutesRequired,
      name: input.name ?? room.name,
      recordingRequired: input.recordingRequired ?? room.recordingRequired,
      roomType: input.roomType ?? room.roomType,
      slug,
      transcriptionRequired:
        input.transcriptionRequired ?? room.transcriptionRequired,
    };

    return updatedRoom;
  });

  if (!updatedRoom) {
    throw new Error("Sala Chronos nao encontrada.");
  }

  await writeLocalChronosStore({
    meetings: snapshot.meetings,
    profiles: snapshot.profiles,
    rooms,
  });

  return updatedRoom;
}

async function deleteLocalChronosRoom({
  input,
}: {
  input: ChronosRoomDeleteInput;
}) {
  const snapshot = await readLocalChronosSnapshot();
  let archivedRoom: ChronosRoom | null = null;
  const rooms = snapshot.rooms.map((room) => {
    if (room.id !== input.roomId) {
      return room;
    }

    archivedRoom = {
      ...room,
      status: "archived",
    };

    return archivedRoom;
  });

  if (!archivedRoom) {
    throw new Error("Sala Chronos nao encontrada.");
  }

  await writeLocalChronosStore({
    meetings: snapshot.meetings,
    profiles: snapshot.profiles,
    rooms: rooms.filter((room) => room.status === "active"),
  });

  return archivedRoom;
}

async function deleteLocalChronosMeeting({
  input,
}: {
  input: ChronosMeetingDeleteInput;
}) {
  const snapshot = await readLocalChronosSnapshot();
  const meetingExists = snapshot.meetings.some(
    (meeting) => meeting.id === input.meetingId,
  );

  if (!meetingExists) {
    throw new Error("Evento Chronos nao encontrado.");
  }

  await writeLocalChronosStore({
    meetings: snapshot.meetings.filter(
      (meeting) => meeting.id !== input.meetingId,
    ),
    profiles: snapshot.profiles,
    rooms: snapshot.rooms,
  });

  return { meetingId: input.meetingId };
}

async function joinLocalChronosPublicRoom({
  input,
  roomSlug,
}: {
  input: NormalizedChronosPublicParticipantInput;
  roomSlug: string;
}): Promise<ChronosPublicJoinResult> {
  const snapshot = await readLocalChronosSnapshot();
  const room = snapshot.rooms.find(
    (currentRoom) =>
      currentRoom.slug === roomSlug && currentRoom.status === "active",
  );

  if (!room) {
    throw new Error("Sala Chronos nao encontrada.");
  }

  const participantName = input.displayName ?? "";

  if (!participantName) {
    throw new Error("Informe seu nome para entrar na sala Chronos.");
  }

  const now = new Date().toISOString();
  const existingMeeting = snapshot.meetings.find(
    (meeting) =>
      meeting.roomId === room.id &&
      (meeting.status === "live" || meeting.status === "lobby"),
  );
  const meeting =
    existingMeeting ??
    ({
      chatMessages: [],
      createdAt: now,
      endsAt: null,
      executiveSummary: null,
      externalReference: `/chronos/${room.slug}`,
      followUps: [],
      hostName: null,
      hostUserId: null,
      id: `local-public-meeting-${Date.now().toString(36)}`,
      meetingType: isChronosMeetingType(room.roomType)
        ? room.roomType
        : "external",
      metadata: {
        athena: {
          assistant: "Athena",
          transcription: room.transcriptionRequired,
        },
        externalRoom: {
          accessMode: "request_entry",
          roomSlug: room.slug,
          source: "chronos-external-room",
        },
      },
      minutes: [],
      minutesStatus: "not_started",
      objective: "Sala externa Chronos para reuniao formal.",
      participants: [],
      protocol: await generateChronosProtocol(null),
      recordingStatus: "not_started",
      recordings: [],
      room,
      roomId: room.id,
      startsAt: now,
      status: "live",
      timeline: [
        {
          eventAt: now,
          eventType: "created",
          id: `event-${Date.now().toString(36)}`,
          title: "Sala externa Chronos iniciada",
        },
      ],
      title: `${room.name} - Reuniao externa`,
      transcriptionStatus: "not_started",
      transcript: [],
      updatedAt: now,
    } satisfies ChronosMeeting);
  const existingParticipant = findMatchingChronosParticipant(
    meeting.participants,
    {
      displayName: participantName,
      email: null,
      organization: input.organization ?? null,
      userId: null,
    },
  );
  const participant: ChronosParticipant = existingParticipant
    ? {
        ...existingParticipant,
        attendanceStatus: "joined",
        displayName: chooseChronosParticipantDisplayName(
          existingParticipant.displayName,
          participantName,
        ),
        joinedAt: existingParticipant.joinedAt ?? now,
        leftAt: null,
        organization: input.organization ?? existingParticipant.organization,
      }
    : {
        attendanceStatus: "joined",
        displayName: participantName,
        email: null,
        id: `local-public-participant-${Date.now().toString(36)}`,
        joinedAt: now,
        organization: input.organization ?? null,
        role: "external",
        userId: null,
      };
  const shouldAppendJoinTimeline =
    !existingParticipant?.joinedAt || Boolean(existingParticipant.leftAt);
  const nextMeeting: ChronosMeeting = {
    ...meeting,
    participants: [
      participant,
      ...meeting.participants.filter(
        (currentParticipant) =>
          currentParticipant.id !== participant.id &&
          !isSameChronosParticipantIdentity(currentParticipant, participant),
      ),
    ],
    timeline: shouldAppendJoinTimeline
      ? [
          ...meeting.timeline,
          {
            eventAt: now,
            eventType: "joined",
            id: `event-${Date.now().toString(36)}-joined`,
            title: `${participantName} entrou na sala externa`,
          },
        ]
      : meeting.timeline,
    updatedAt: now,
  };

  await writeLocalChronosStore({
    meetings: [
      nextMeeting,
      ...snapshot.meetings.filter(
        (currentMeeting) => currentMeeting.id !== nextMeeting.id,
      ),
    ],
    profiles: snapshot.profiles,
    rooms: snapshot.rooms,
  });

  return {
    athenaNotice:
      "Esta reuniao pode ser gravada e transcrita pela assistente Athena.",
    isHost: false,
    meetingId: nextMeeting.id,
    participant: {
      displayName: participant.displayName,
      id: participant.id,
      organization: participant.organization ?? undefined,
      role: participant.role,
    },
    reservation: {
      endsAt: nextMeeting.endsAt,
      protocol: nextMeeting.protocol,
      startsAt: nextMeeting.startsAt,
      title: nextMeeting.title,
    },
    room: mapPublicRoom(room),
  };
}

async function closeLocalChronosPublicMeeting({
  input,
  roomSlug,
}: {
  input: NormalizedChronosPublicCloseInput;
  roomSlug: string;
}) {
  const snapshot = await readLocalChronosSnapshot();
  const room = snapshot.rooms.find((currentRoom) => currentRoom.slug === roomSlug);
  const now = new Date().toISOString();
  let foundMeeting = false;
  const meetings = snapshot.meetings.map((meeting) => {
    if (meeting.id !== input.meetingId || meeting.roomId !== room?.id) {
      return meeting;
    }

    foundMeeting = true;

    return {
      ...meeting,
      metadata: {
        ...(meeting.metadata ?? {}),
        closure: {
          closedAt: now,
          source: "chronos-external-room",
        },
      },
      participants: meeting.participants.map((participant) => ({
        ...participant,
        attendanceStatus: "left",
        leftAt: now,
      })),
      status: "closed",
      timeline: [
        ...meeting.timeline,
        {
          eventAt: now,
          eventType: "left",
          id: `event-${Date.now().toString(36)}-closed`,
          title: "Chamada Chronos encerrada pelo host",
        },
      ],
      transcriptionStatus: room?.transcriptionRequired
        ? "processing"
        : meeting.transcriptionStatus,
      updatedAt: now,
    } satisfies ChronosMeeting;
  });

  if (!foundMeeting) {
    throw new Error("Reuniao Chronos nao encontrada para esta sala.");
  }

  await writeLocalChronosStore({
    meetings,
    profiles: snapshot.profiles,
    rooms: snapshot.rooms,
  });

  return {
    meetingId: input.meetingId,
    ok: true,
    status: "closed" as const,
  };
}

async function markLocalChronosPublicRecording({
  input,
  roomSlug,
}: {
  input: NormalizedChronosPublicRecordingInput;
  roomSlug: string;
}) {
  const snapshot = await readLocalChronosSnapshot();
  const room = snapshot.rooms.find((currentRoom) => currentRoom.slug === roomSlug);
  const now = new Date().toISOString();
  let foundMeeting = false;
  const meetings = snapshot.meetings.map((meeting) => {
    if (meeting.id !== input.meetingId || meeting.roomId !== room?.id) {
      return meeting;
    }

    foundMeeting = true;

    return {
      ...meeting,
      recordingStatus: input.status,
      recordings: [
        {
          durationSeconds: input.durationSeconds ?? null,
          id: `local-recording-${Date.now().toString(36)}`,
          startedAt: input.status === "recording" ? now : null,
          status: input.status,
          stoppedAt: input.status === "available" ? now : null,
          storageBucket: null,
          storagePath: null,
        },
        ...meeting.recordings,
      ],
      timeline: [
        ...meeting.timeline,
        {
          eventAt: now,
          eventType:
            input.status === "recording"
              ? "recording_started"
              : "recording_stopped",
          id: `event-${Date.now().toString(36)}-recording`,
          title:
            input.status === "recording"
              ? "Gravacao iniciada pela sala externa"
              : "Gravacao encerrada pela sala externa",
        },
      ],
      updatedAt: now,
    } satisfies ChronosMeeting;
  });

  if (!foundMeeting) {
    throw new Error("Reuniao Chronos nao encontrada para esta sala.");
  }

  await writeLocalChronosStore({
    meetings,
    profiles: snapshot.profiles,
    rooms: snapshot.rooms,
  });

  return { ok: true, status: input.status };
}

async function addLocalChronosPublicChatMessage({
  input,
  roomSlug,
}: {
  input: NormalizedChronosPublicChatInput;
  roomSlug: string;
}) {
  const snapshot = await readLocalChronosSnapshot();
  const room = snapshot.rooms.find((currentRoom) => currentRoom.slug === roomSlug);
  const now = new Date().toISOString();
  let savedMessage: ChronosChatMessage | null = null;
  let foundMeeting = false;
  const meetings = snapshot.meetings.map((meeting) => {
    if (meeting.id !== input.meetingId || meeting.roomId !== room?.id) {
      return meeting;
    }

    foundMeeting = true;
    savedMessage = {
      content: input.content,
      createdAt: now,
      id: input.clientMessageId ?? `chat-${Date.now().toString(36)}`,
      participantId: input.participantId,
      senderName: input.senderName,
    };

    return {
      ...meeting,
      chatMessages: [...(meeting.chatMessages ?? []), savedMessage],
      updatedAt: now,
    } satisfies ChronosMeeting;
  });

  if (!foundMeeting || !savedMessage) {
    throw new Error("Reuniao Chronos nao encontrada para esta sala.");
  }

  await writeLocalChronosStore({
    meetings,
    profiles: snapshot.profiles,
    rooms: snapshot.rooms,
  });

  return { message: savedMessage, ok: true };
}

async function addLocalChronosPublicTranscript({
  input,
  roomSlug,
}: {
  input: NormalizedChronosPublicTranscriptInput;
  roomSlug: string;
}) {
  const snapshot = await readLocalChronosSnapshot();
  const room = snapshot.rooms.find((currentRoom) => currentRoom.slug === roomSlug);
  const now = new Date().toISOString();
  let foundMeeting = false;
  const meetings = snapshot.meetings.map((meeting) => {
    if (meeting.id !== input.meetingId || meeting.roomId !== room?.id) {
      return meeting;
    }

    foundMeeting = true;

    return {
      ...meeting,
      timeline: [
        ...meeting.timeline,
        {
          eventAt: now,
          eventType: "transcript_added",
          id: `event-${Date.now().toString(36)}-transcript`,
          title: `Athena registrou fala de ${input.speakerLabel}`,
        },
      ],
      transcriptionStatus: "available",
      transcript: [
        ...meeting.transcript,
        {
          content: input.content,
          createdAt: now,
          endedAt: input.endedAt ?? null,
          id: `transcript-${Date.now().toString(36)}`,
          source: "athena-browser",
          speakerLabel: input.speakerLabel,
          startedAt: input.startedAt ?? null,
        },
      ],
      updatedAt: now,
    } satisfies ChronosMeeting;
  });

  if (!foundMeeting) {
    throw new Error("Reuniao Chronos nao encontrada para esta sala.");
  }

  await writeLocalChronosStore({
    meetings,
    profiles: snapshot.profiles,
    rooms: snapshot.rooms,
  });

  return { ok: true };
}

async function updateLocalChronosMeeting({
  input,
  user,
}: {
  input: ChronosUpdateInput;
  user: AuthorizedChronosUser;
}) {
  const snapshot = await readLocalChronosSnapshot();
  const now = new Date().toISOString();
  const meetings = snapshot.meetings.map((meeting) => {
    if (meeting.id !== input.meetingId) {
      return meeting;
    }

    const nextMeeting = { ...meeting, updatedAt: now };
    const event = (title: string, eventType: ChronosEventType = "note") => ({
      eventAt: now,
      eventType,
      id: `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      title,
    });

    if (input.action === "set_status") {
      nextMeeting.status = input.status;
      nextMeeting.timeline = [
        event(`Status atualizado para ${input.status}`),
        ...meeting.timeline,
      ];
    } else if (input.action === "mark_recording") {
      nextMeeting.recordingStatus = input.status;
      nextMeeting.recordings = [
        {
          durationSeconds: input.durationSeconds ?? null,
          id: `recording-${Date.now().toString(36)}`,
          startedAt: input.status === "recording" ? now : null,
          status: input.status,
          stoppedAt: input.status === "available" ? now : null,
        },
        ...meeting.recordings,
      ];
      nextMeeting.timeline = [
        event(
          input.status === "recording"
            ? "Gravacao iniciada"
            : "Gravacao finalizada",
          input.status === "recording"
            ? "recording_started"
            : "recording_stopped",
        ),
        ...meeting.timeline,
      ];
    } else if (input.action === "add_transcript") {
      nextMeeting.transcriptionStatus = "available";
      nextMeeting.transcript = [
        ...meeting.transcript,
        {
          content: input.content,
          createdAt: now,
          id: `transcript-${Date.now().toString(36)}`,
          source: input.source ?? "manual",
          speakerLabel: input.speakerLabel ?? user.name,
        },
      ];
      nextMeeting.timeline = [
        event(
          input.source === "openai" || input.source === "athena"
            ? "Transcricao Athena registrada"
            : "Trecho de transcricao registrado",
          "transcript_added",
        ),
        ...meeting.timeline,
      ];
    } else if (input.action === "save_summary") {
      nextMeeting.executiveSummary = input.summary;
      nextMeeting.timeline = [
        event("Resumo executivo registrado", "summary_generated"),
        ...meeting.timeline,
      ];
    } else if (input.action === "save_minutes") {
      if (!hasLocalChronosAvailableRecording(meeting)) {
        throw new Error(
          "Ata Chronos requer gravacao disponivel vinculada a reuniao.",
        );
      }

      nextMeeting.minutesStatus = input.status;
      nextMeeting.minutes = [
        {
          approvedAt: input.status === "approved" ? now : null,
          approvedByUserId: input.status === "approved" ? user.id : null,
          content: input.content,
          createdAt: now,
          id: `minutes-${Date.now().toString(36)}`,
          status: input.status,
          version: meeting.minutes.length + 1,
        },
        ...meeting.minutes,
      ];
      nextMeeting.timeline = [
        event(
          input.status === "approved"
            ? "Ata aprovada por revisao humana"
            : "Ata registrada para revisao",
          input.status === "approved" ? "minutes_approved" : "minutes_drafted",
        ),
        ...meeting.timeline,
      ];
    } else if (input.action === "delete_minutes") {
      assertChronosAdmin(user, "Somente administradores podem excluir atas.");
      nextMeeting.minutes = meeting.minutes.filter(
        (minutes) => minutes.id !== input.minutesId,
      );
      nextMeeting.minutesStatus =
        nextMeeting.minutes[0]?.status ?? "not_started";
      nextMeeting.timeline = [
        event("Ata excluida por administrador", "note"),
        ...meeting.timeline,
      ];
    } else if (input.action === "delete_recording") {
      assertChronosAdmin(
        user,
        "Somente administradores podem excluir gravacoes.",
      );
      nextMeeting.recordings = meeting.recordings.filter(
        (recording) => recording.id !== input.recordingId,
      );
      nextMeeting.recordingStatus =
        nextMeeting.recordings[0]?.status ?? "not_started";
      nextMeeting.timeline = [
        event("Gravacao excluida por administrador", "note"),
        ...meeting.timeline,
      ];
    } else if (input.action === "create_followup") {
      nextMeeting.followUps = [
        {
          dueAt: input.dueAt ?? null,
          id: `followup-${Date.now().toString(36)}`,
          ownerName: input.ownerName ?? null,
          ownerUserId: null,
          status: "open",
          title: input.title,
        },
        ...meeting.followUps,
      ];
      nextMeeting.timeline = [
        event("Follow-up criado", "followup_created"),
        ...meeting.timeline,
      ];
    } else if (input.action === "complete_followup") {
      nextMeeting.followUps = meeting.followUps.map((followUp) =>
        followUp.id === input.followUpId
          ? { ...followUp, completedAt: now, status: "done" }
          : followUp,
      );
      nextMeeting.timeline = [
        event("Follow-up concluido", "followup_done"),
        ...meeting.timeline,
      ];
    } else {
      nextMeeting.timeline = [
        event(input.title, input.eventType ?? "note"),
        ...meeting.timeline,
      ];
    }

    return nextMeeting;
  });
  const updatedMeeting = meetings.find((meeting) => meeting.id === input.meetingId);

  if (!updatedMeeting) {
    throw new Error("Reuniao Chronos nao encontrada.");
  }

  await writeLocalChronosStore({
    meetings,
    profiles: snapshot.profiles,
    rooms: snapshot.rooms,
  });

  return updatedMeeting;
}

function hasLocalChronosAvailableRecording(meeting: ChronosMeeting) {
  return meeting.recordings.some(
    (recording) => recording.status === "available",
  );
}

function mapRoomRow(row: ChronosRoomRow): ChronosRoom {
  return {
    capacity: row.capacity,
    id: row.id,
    metadata: buildRoomMetadata(
      {
        slug: row.slug,
      },
      row.metadata ?? {},
    ),
    minutesRequired: row.minutes_required,
    name: row.name,
    recordingRequired: row.recording_required,
    roomType: normalizeChronosOfficialProfileId(row.room_type),
    slug: row.slug,
    status: row.status,
    transcriptionRequired: row.transcription_required,
  };
}

function mapPublicRoom(room: ChronosRoom): ChronosPublicRoom {
  const background =
    room.metadata && typeof room.metadata.background === "object"
      ? (room.metadata.background as Record<string, unknown>)
      : null;

  return {
    backgroundDataUrl:
      typeof background?.dataUrl === "string" ? background.dataUrl : undefined,
    backgroundName:
      typeof background?.name === "string" ? background.name : undefined,
    capacity: room.capacity,
    externalPath: `/chronos/${room.slug}`,
    id: room.id,
    minutesRequired: room.minutesRequired,
    name: room.name,
    recordingRequired: room.recordingRequired,
    roomType: room.roomType,
    slug: room.slug,
    transcriptionRequired: room.transcriptionRequired,
  };
}

function mapMeetingRow(input: {
  chatMessages?: ChronosChatMessage[];
  followUps: ChronosFollowUp[];
  meeting: ChronosMeetingRow;
  minutes: ChronosMinutes[];
  participants: ChronosParticipant[];
  recordings: ChronosRecording[];
  room: ChronosRoom | null;
  timeline: ChronosTimelineEvent[];
  transcript: ChronosTranscriptSegment[];
}): ChronosMeeting {
  return {
    chatMessages: input.chatMessages ?? [],
    createdAt: input.meeting.created_at,
    endsAt: input.meeting.ends_at,
    executiveSummary: readChronosNullableText(
      input.meeting.executive_summary,
      8_000,
    ),
    externalReference: readChronosNullableText(
      input.meeting.external_reference,
      500,
    ),
    followUps: input.followUps,
    hostName: readChronosNullableText(input.meeting.host_name, 160),
    hostUserId: input.meeting.host_user_id,
    id: input.meeting.id,
    meetingType: input.meeting.meeting_type,
    metadata: input.meeting.metadata ?? {},
    minutes: input.minutes,
    minutesStatus: input.meeting.minutes_status,
    objective: readChronosNullableText(input.meeting.objective, 4_000),
    participants: input.participants,
    protocol:
      readChronosNullableText(input.meeting.protocol, 80) ?? "CHR-SEM-PROTOCOLO",
    recordingStatus: input.meeting.recording_status,
    recordings: input.recordings,
    room: input.room,
    roomId: input.meeting.room_id,
    startsAt: input.meeting.starts_at,
    status: input.meeting.status,
    timeline: input.timeline,
    title: readChronosNullableText(input.meeting.title, 240) ?? "Reuniao Chronos",
    transcriptionStatus: input.meeting.transcription_status,
    transcript: input.transcript,
    updatedAt: input.meeting.updated_at,
  };
}

function mapParticipantRow(row: ChronosParticipantRow): ChronosParticipant {
  return {
    attendanceStatus: row.attendance_status,
    displayName:
      readChronosNullableText(row.display_name, 160) ?? "Participante",
    email: readChronosNullableText(row.email, 220),
    id: row.id,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
    organization: readChronosNullableText(row.organization, 160),
    role: row.role,
    userId: row.user_id,
  };
}

function readChronosNullableText(value: unknown, maxLength: number) {
  const text = sanitizeText(value, maxLength);

  return text || null;
}

function findMatchingChronosParticipantRow(
  participants: ChronosParticipantRow[],
  identity: {
    displayName: string;
    email?: string | null;
    organization?: string | null;
    userId?: string | null;
  },
) {
  return participants.find((participant) =>
    isSameChronosParticipantIdentity(
      {
        displayName: participant.display_name,
        email: participant.email,
        organization: participant.organization,
        userId: participant.user_id,
      },
      identity,
    ),
  );
}

function findMatchingChronosParticipant(
  participants: ChronosParticipant[],
  identity: {
    displayName: string;
    email?: string | null;
    organization?: string | null;
    userId?: string | null;
  },
) {
  return participants.find((participant) =>
    isSameChronosParticipantIdentity(participant, identity),
  );
}

function isSameChronosParticipantIdentity(
  current: {
    displayName?: string | null;
    email?: string | null;
    organization?: string | null;
    userId?: string | null;
  },
  incoming: {
    displayName?: string | null;
    email?: string | null;
    organization?: string | null;
    userId?: string | null;
  },
) {
  const currentEmail = normalizeChronosIdentityValue(current.email);
  const incomingEmail = normalizeChronosIdentityValue(incoming.email);

  if (currentEmail && incomingEmail && currentEmail === incomingEmail) {
    return true;
  }

  if (current.userId && incoming.userId && current.userId === incoming.userId) {
    return true;
  }

  const currentName = getChronosParticipantNameIdentity(current.displayName);
  const incomingName = getChronosParticipantNameIdentity(incoming.displayName);

  if (!currentName || !incomingName) {
    return false;
  }

  if (currentName === incomingName) {
    return true;
  }

  return (
    currentName.startsWith(`${incomingName} `) ||
    incomingName.startsWith(`${currentName} `)
  );
}

function chooseChronosParticipantDisplayName(current: string, incoming: string) {
  const currentIsAllCaps = current === current.toUpperCase();
  const incomingIsAllCaps = incoming === incoming.toUpperCase();

  if (currentIsAllCaps && !incomingIsAllCaps) {
    return incoming;
  }

  return current;
}

function getChronosParticipantNameIdentity(value?: string | null) {
  const words = normalizeChronosIdentityValue(value)
    .split(/\s+/)
    .filter(Boolean);

  return words.length >= 2 ? words.slice(0, 2).join(" ") : words.join(" ");
}

function normalizeChronosIdentityValue(value?: string | null) {
  return sanitizeText(value, 180)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function mapTimelineRow(row: ChronosTimelineEventRow): ChronosTimelineEvent {
  return {
    description: row.description,
    eventAt: row.event_at,
    eventType: row.event_type,
    id: row.id,
    title: row.title,
  };
}

function mapTranscriptRow(
  row: ChronosTranscriptSegmentRow,
): ChronosTranscriptSegment {
  return {
    content:
      readChronosNullableText(row.content, maxChronosTranscriptContentLength) ??
      "Trecho sem conteudo textual.",
    createdAt: row.created_at,
    endedAt: row.ended_at,
    id: row.id,
    source: row.source,
    speakerLabel: readChronosNullableText(row.speaker_label, 160),
    startedAt: row.started_at,
  };
}

function mapChatMessageRow(row: ChronosChatMessageRow): ChronosChatMessage {
  return {
    content: readChronosNullableText(row.content, 4_000) ?? "",
    createdAt: row.created_at,
    id: row.id,
    participantId: row.participant_id,
    senderName: readChronosNullableText(row.sender_name, 160) ?? "Participante",
  };
}

function mapMinutesRow(row: ChronosMinutesRow): ChronosMinutes {
  return {
    approvedAt: row.approved_at,
    approvedByUserId: row.approved_by_user_id,
    content: readChronosNullableText(row.content, maxChronosMinutesContentLength) ?? "",
    createdAt: row.created_at,
    id: row.id,
    status: row.status,
    version: row.version,
  };
}

function mapFollowUpRow(row: ChronosFollowUpRow): ChronosFollowUp {
  return {
    completedAt: row.completed_at,
    dueAt: row.due_at,
    id: row.id,
    ownerName: row.owner_name,
    ownerUserId: row.owner_user_id,
    status: row.status,
    title: row.title,
  };
}

function mapRecordingRow(row: ChronosRecordingRow): ChronosRecording {
  const metadata = row.metadata ?? {};
  const fileName =
    row.file_name ??
    (typeof metadata.fileName === "string" ? metadata.fileName : null);
  const mimeType =
    row.mime_type ??
    (typeof metadata.mimeType === "string" ? metadata.mimeType : null);
  const sizeBytes =
    row.size_bytes ??
    (typeof metadata.sizeBytes === "number" ? metadata.sizeBytes : null);

  return {
    downloadUrl: null,
    durationSeconds: row.duration_seconds,
    fileName,
    id: row.id,
    mimeType,
    playbackUrl: null,
    sizeBytes,
    startedAt: row.started_at,
    status: row.status,
    stoppedAt: row.stopped_at,
    storageBucket:
      row.storage_bucket ?? (row.storage_path ? chronosDriveStorageBucket : null),
    storagePath: row.storage_path,
  };
}

async function hydrateChronosRecordingUrls(
  client: ChronosClient,
  recordings: ChronosRecording[],
) {
  return Promise.all(
    recordings.map(async (recording) => {
      const storageBucket = recording.storageBucket ?? chronosDriveStorageBucket;

      if (recording.status !== "available" || !recording.storagePath) {
        return recording;
      }

      const { data, error } = await client.storage
        .from(storageBucket)
        .createSignedUrl(recording.storagePath, 60 * 60);

      if (error || !data?.signedUrl) {
        return {
          ...recording,
          storageBucket,
        } satisfies ChronosRecording;
      }

      return {
        ...recording,
        downloadUrl: data.signedUrl,
        playbackUrl: data.signedUrl,
        storageBucket,
      } satisfies ChronosRecording;
    }),
  );
}

function groupRows<Row extends { meeting_id: string }>(
  rows: Row[],
  meetingId: string,
) {
  return rows.filter((row) => row.meeting_id === meetingId);
}

function emptySupabaseList<Row>() {
  return {
    data: [] as Row[],
    error: null,
  };
}

function sanitizeText(input: unknown, maxLength: number) {
  return typeof input === "string" ? input.trim().slice(0, maxLength) : "";
}

function sanitizeOptionalText(input: unknown, maxLength: number) {
  const value = sanitizeText(input, maxLength);

  return value || undefined;
}

function normalizeSearchTerm(input: unknown) {
  return sanitizeText(input, 80).toLowerCase();
}

function normalizeStringList(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => sanitizeText(item, 240))
    .filter(Boolean);
}

function normalizeRoomSlug(input: unknown, fallbackName: string) {
  const raw = sanitizeOptionalText(input, 120) ?? fallbackName;
  const slug = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "sala-chronos";
}

function sanitizeChronosFileName(input: unknown) {
  const raw = sanitizeOptionalText(input, 180) ?? "gravacao-chronos.webm";
  const sanitized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);

  return sanitized || "gravacao-chronos.webm";
}

function buildChronosRecordingStoragePath({
  fileName,
  meetingId,
  participantId,
  roomSlug,
}: {
  fileName: string;
  meetingId: string;
  participantId: string;
  roomSlug: string;
}) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  return [
    "recordings",
    normalizeRoomSlug(roomSlug, "sala-chronos"),
    sanitizeChronosFileName(meetingId),
    `${timestamp}-${sanitizeChronosFileName(participantId)}-${fileName}`,
  ].join("/");
}

function assertChronosRecordingStorageTarget({
  bucket,
  meetingId,
  participantId,
  roomSlug,
  storagePath,
}: {
  bucket: string;
  meetingId: string;
  participantId: string;
  roomSlug: string;
  storagePath: string;
}) {
  const expectedPrefix = [
    "recordings",
    normalizeRoomSlug(roomSlug, "sala-chronos"),
    sanitizeChronosFileName(meetingId),
    "",
  ].join("/");
  const participantMarker = `-${sanitizeChronosFileName(participantId)}-`;

  if (
    bucket !== chronosDriveStorageBucket ||
    !storagePath.startsWith(expectedPrefix) ||
    !storagePath.includes(participantMarker)
  ) {
    throw new Error("Destino da gravacao Chronos invalido.");
  }
}

async function assertChronosRecordingStorageObjectExists({
  bucket,
  client,
  storagePath,
}: {
  bucket: string;
  client: ChronosClient;
  storagePath: string;
}) {
  const lastSlashIndex = storagePath.lastIndexOf("/");
  const folderPath =
    lastSlashIndex > 0 ? storagePath.slice(0, lastSlashIndex) : "";
  const fileName =
    lastSlashIndex > 0 ? storagePath.slice(lastSlashIndex + 1) : storagePath;
  const { data, error } = await client.storage
    .from(bucket)
    .list(folderPath, { limit: 100, search: fileName });

  if (error) {
    throw error;
  }

  if (!data?.some((object) => object.name === fileName)) {
    throw new Error("Arquivo de gravacao Chronos ainda nao esta no Storage.");
  }
}

function isChronosUploadFile(input: unknown): input is File {
  return (
    typeof input === "object" &&
    input !== null &&
    "arrayBuffer" in input &&
    "name" in input &&
    "size" in input &&
    "type" in input &&
    typeof (input as { arrayBuffer?: unknown }).arrayBuffer === "function" &&
    typeof (input as { name?: unknown }).name === "string" &&
    typeof (input as { size?: unknown }).size === "number" &&
    typeof (input as { type?: unknown }).type === "string"
  );
}

function normalizeRoomCapacity(input: unknown) {
  const parsed = Number(input ?? 12);

  if (!Number.isFinite(parsed)) {
    return 12;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 200);
}

function normalizeOptionalDurationSeconds(input: unknown) {
  if (input === undefined || input === null || input === "") {
    return undefined;
  }

  const parsed = Number(input);

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.min(Math.max(Math.trunc(parsed), 0), 60 * 60 * 12);
}

function sanitizeRoomBackgroundDataUrl(input: unknown) {
  if (typeof input !== "string" || !input.trim()) {
    return "";
  }

  const value = input.trim();

  if (
    !/^data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/=]+$/i.test(value) ||
    value.length > maxRoomBackgroundDataUrlLength
  ) {
    throw new Error("Fundo da sala invalido ou acima do limite permitido.");
  }

  return value;
}

function buildRoomMetadata(
  input: {
    backgroundDataUrl?: string;
    backgroundName?: string;
    slug: string;
  },
  currentMetadata: Record<string, unknown> = {},
) {
  const nextMetadata: Record<string, unknown> = {
    ...currentMetadata,
    externalAccess: {
      mode: "request_entry",
      path: `/chronos/${input.slug}`,
    },
    source: "chronos-room-config",
  };

  if (input.backgroundDataUrl) {
    nextMetadata.background = {
      dataUrl: input.backgroundDataUrl,
      name: input.backgroundName || "fundo-chronos",
    };
  }

  return nextMetadata;
}

function normalizeOptionalDate(input: unknown) {
  if (typeof input !== "string" || !input.trim()) {
    return undefined;
  }

  const normalizedDate = normalizeChronosDateTime(input);

  return normalizedDate ?? undefined;
}

function isChronosMeetingType(value: unknown): value is ChronosMeetingType {
  return chronosMeetingTypes.some((meetingType) => meetingType === value);
}

function isChronosCalendarEventKind(
  value: unknown,
): value is ChronosCalendarEventKind {
  return chronosCalendarEventKinds.some((eventKind) => eventKind === value);
}

function isChronosMeetingStatus(value: unknown): value is ChronosMeetingStatus {
  return chronosMeetingStatuses.some((status) => status === value);
}

function isChronosCaptureStatus(value: unknown): value is ChronosCaptureStatus {
  return chronosCaptureStatuses.some((status) => status === value);
}

function isChronosMinutesStatus(value: unknown): value is ChronosMinutesStatus {
  return chronosMinutesStatuses.some((status) => status === value);
}

function isChronosParticipantRole(
  value: unknown,
): value is ChronosParticipantRole {
  return chronosParticipantRoles.some((role) => role === value);
}

function isChronosEventType(value: unknown): value is ChronosEventType {
  return chronosEventTypes.some((eventType) => eventType === value);
}

function getBearerToken(request: NextRequest) {
  return getBearerTokenFromValue(request.headers.get("authorization"));
}

function getBearerTokenFromValue(authorization?: string | null) {
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}
