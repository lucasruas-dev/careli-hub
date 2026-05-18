import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getPermissionsForRole } from "@repo/shared";

import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import {
  chronosCaptureStatuses,
  chronosEventTypes,
  chronosMeetingStatuses,
  chronosMeetingTypes,
  chronosMinutesStatuses,
  chronosParticipantRoles,
  type ChronosCaptureStatus,
  type ChronosCreateMeetingInput,
  type ChronosEventType,
  type ChronosFollowUp,
  type ChronosFollowUpStatus,
  type ChronosMeeting,
  type ChronosMeetingStatus,
  type ChronosMeetingType,
  type ChronosMinutes,
  type ChronosMinutesStatus,
  type ChronosParticipant,
  type ChronosParticipantRole,
  type ChronosRecording,
  type ChronosRoom,
  type ChronosSnapshot,
  type ChronosTimelineEvent,
  type ChronosTranscriptSegment,
  type ChronosUpdateInput,
} from "./types";

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
  id: string;
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
  display_name: string;
  email: string | null;
  id: string;
  meeting_id: string;
  organization: string | null;
  role: ChronosParticipantRole;
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
  id: string;
  meeting_id: string;
  metadata: Record<string, unknown>;
  started_at: string | null;
  status: ChronosCaptureStatus;
  stopped_at: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
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
        Insert: never;
        Relationships: [];
        Row: ChronosRoomRow;
        Update: never;
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

type ChronosLocalStore = {
  meetings: ChronosMeeting[];
  rooms: ChronosRoom[];
};

const chronosLocalStorePath = path.join(
  process.cwd(),
  ".next",
  "cache",
  "chronos-meetings.json",
);
const chronosLocalFallbackFlag = "CHRONOS_ENABLE_LOCAL_FALLBACK";
const maxTextLength = 8_000;

const defaultChronosRooms: ChronosRoom[] = [
  {
    capacity: 12,
    id: "local-room-executiva",
    minutesRequired: true,
    name: "Sala Executiva",
    recordingRequired: true,
    roomType: "executive",
    slug: "sala-executiva",
    status: "active",
    transcriptionRequired: true,
  },
  {
    capacity: 16,
    id: "local-room-cliente",
    minutesRequired: true,
    name: "Sala Cliente",
    recordingRequired: true,
    roomType: "external",
    slug: "sala-cliente",
    status: "active",
    transcriptionRequired: true,
  },
  {
    capacity: 20,
    id: "local-room-resultado",
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

  try {
    const roomsResult = await authorization.client
      .from("chronos_rooms")
      .select("*")
      .eq("status", "active")
      .order("name", { ascending: true });

    if (roomsResult.error) {
      throw roomsResult.error;
    }

    const meetingsResult = await authorization.client
      .from("chronos_meetings")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(80);

    if (meetingsResult.error) {
      throw meetingsResult.error;
    }

    const meetings = meetingsResult.data ?? [];
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
            authorization.client
              .from("chronos_participants")
              .select("*")
              .in("meeting_id", meetingIds),
            authorization.client
              .from("chronos_timeline_events")
              .select("*")
              .in("meeting_id", meetingIds)
              .order("event_at", { ascending: false }),
            authorization.client
              .from("chronos_transcript_segments")
              .select("*")
              .in("meeting_id", meetingIds)
              .order("created_at", { ascending: true }),
            authorization.client
              .from("chronos_minutes")
              .select("*")
              .in("meeting_id", meetingIds)
              .order("created_at", { ascending: false }),
            authorization.client
              .from("chronos_followups")
              .select("*")
              .in("meeting_id", meetingIds)
              .order("created_at", { ascending: false }),
            authorization.client
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
    const roomsById = new Map(rooms.map((room) => [room.id, room]));

    return {
      meetings: meetings.map((meeting) =>
        mapMeetingRow({
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
          recordings: groupRows(recordingsResult.data ?? [], meeting.id).map(
            mapRecordingRow,
          ),
          room: meeting.room_id ? roomsById.get(meeting.room_id) ?? null : null,
          timeline: groupRows(timelineResult.data ?? [], meeting.id).map(
            mapTimelineRow,
          ),
          transcript: groupRows(transcriptResult.data ?? [], meeting.id).map(
            mapTranscriptRow,
          ),
        }),
      ),
      rooms,
      storage: {
        status: "supabase",
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
      (roomsResult.data ?? []).find((room) => room.id === normalizedInput.roomId) ??
      roomsResult.data?.[0] ??
      null;
    const protocol = await generateChronosProtocol(authorization.client);
    const { data: meeting, error } = await authorization.client
      .from("chronos_meetings")
      .insert({
        external_reference: normalizedInput.externalReference ?? null,
        host_name: authorization.user.name,
        host_user_id: authorization.user.id,
        meeting_type: normalizedInput.meetingType,
        metadata: {
          agenda: normalizedInput.agenda ?? [],
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

export function isChronosSchemaMissingError(error: unknown) {
  const maybeError = error as {
    code?: unknown;
    message?: unknown;
  };
  const message =
    typeof maybeError?.message === "string" ? maybeError.message : "";

  return (
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
    const insertResult = await client.from("chronos_transcript_segments").insert({
      content: sanitizeText(input.content, maxTextLength),
      created_by_user_id: user.id,
      meeting_id: input.meetingId,
      source: "manual",
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
      title: "Trecho de transcricao registrado",
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
    const version = await getNextMinutesVersion(client, input.meetingId);
    const minutesResult = await client.from("chronos_minutes").insert({
      content: sanitizeText(input.content, maxTextLength),
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
    actorUserId: string;
    description?: string;
    eventType: ChronosEventType;
    meetingId: string;
    title: string;
  },
) {
  const { error } = await client.from("chronos_timeline_events").insert({
    actor_user_id: input.actorUserId,
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

  return {
    agenda: normalizeStringList(maybeInput.agenda).slice(0, 12),
    externalReference: sanitizeOptionalText(maybeInput.externalReference, 180),
    meetingType: isChronosMeetingType(maybeInput.meetingType)
      ? maybeInput.meetingType
      : "executive",
    objective: sanitizeOptionalText(maybeInput.objective, maxTextLength),
    participants: normalizeCreateParticipants(maybeInput.participants),
    roomId: sanitizeOptionalText(maybeInput.roomId, 80),
    startsAt: normalizeOptionalDate(maybeInput.startsAt),
    title,
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
    return {
      action,
      content: sanitizeText((maybeInput as { content?: unknown }).content, maxTextLength),
      meetingId,
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
      content: sanitizeText((maybeInput as { content?: unknown }).content, maxTextLength),
      meetingId,
      status,
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
      };
    })
    .filter(Boolean)
    .slice(0, 30) as NonNullable<ChronosCreateMeetingInput["participants"]>;
}

async function readLocalChronosSnapshot(): Promise<Omit<ChronosSnapshot, "storage">> {
  try {
    const file = await readFile(chronosLocalStorePath, "utf8");
    const payload = JSON.parse(file) as Partial<ChronosLocalStore>;

    return {
      meetings: Array.isArray(payload.meetings) ? payload.meetings : [],
      rooms: Array.isArray(payload.rooms) ? payload.rooms : defaultChronosRooms,
    };
  } catch {
    return {
      meetings: [],
      rooms: defaultChronosRooms,
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
    snapshot.rooms.find((currentRoom) => currentRoom.id === input.roomId) ??
    snapshot.rooms[0] ??
    null;
  const meeting: ChronosMeeting = {
    createdAt: now,
    endsAt: null,
    executiveSummary: null,
    externalReference: input.externalReference ?? null,
    followUps: [],
    hostName: user.name,
    hostUserId: user.id,
    id: `local-chronos-${Date.now().toString(36)}`,
    meetingType: input.meetingType,
    metadata: { agenda: input.agenda ?? [], source: "chronos-v1-local" },
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
        userId: null,
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
    rooms: snapshot.rooms,
  });

  return meeting;
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
          source: "manual",
          speakerLabel: input.speakerLabel ?? user.name,
        },
      ];
      nextMeeting.timeline = [
        event("Trecho de transcricao registrado", "transcript_added"),
        ...meeting.timeline,
      ];
    } else if (input.action === "save_summary") {
      nextMeeting.executiveSummary = input.summary;
      nextMeeting.timeline = [
        event("Resumo executivo registrado", "summary_generated"),
        ...meeting.timeline,
      ];
    } else if (input.action === "save_minutes") {
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
    rooms: snapshot.rooms,
  });

  return updatedMeeting;
}

function mapRoomRow(row: ChronosRoomRow): ChronosRoom {
  return {
    capacity: row.capacity,
    id: row.id,
    minutesRequired: row.minutes_required,
    name: row.name,
    recordingRequired: row.recording_required,
    roomType: row.room_type,
    slug: row.slug,
    status: row.status,
    transcriptionRequired: row.transcription_required,
  };
}

function mapMeetingRow(input: {
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
    createdAt: input.meeting.created_at,
    endsAt: input.meeting.ends_at,
    executiveSummary: input.meeting.executive_summary,
    externalReference: input.meeting.external_reference,
    followUps: input.followUps,
    hostName: input.meeting.host_name,
    hostUserId: input.meeting.host_user_id,
    id: input.meeting.id,
    meetingType: input.meeting.meeting_type,
    metadata: input.meeting.metadata ?? {},
    minutes: input.minutes,
    minutesStatus: input.meeting.minutes_status,
    objective: input.meeting.objective,
    participants: input.participants,
    protocol: input.meeting.protocol,
    recordingStatus: input.meeting.recording_status,
    recordings: input.recordings,
    room: input.room,
    roomId: input.meeting.room_id,
    startsAt: input.meeting.starts_at,
    status: input.meeting.status,
    timeline: input.timeline,
    title: input.meeting.title,
    transcriptionStatus: input.meeting.transcription_status,
    transcript: input.transcript,
    updatedAt: input.meeting.updated_at,
  };
}

function mapParticipantRow(row: ChronosParticipantRow): ChronosParticipant {
  return {
    attendanceStatus: row.attendance_status,
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    organization: row.organization,
    role: row.role,
    userId: row.user_id,
  };
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
    content: row.content,
    createdAt: row.created_at,
    id: row.id,
    source: row.source,
    speakerLabel: row.speaker_label,
  };
}

function mapMinutesRow(row: ChronosMinutesRow): ChronosMinutes {
  return {
    approvedAt: row.approved_at,
    approvedByUserId: row.approved_by_user_id,
    content: row.content,
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
  return {
    durationSeconds: row.duration_seconds,
    id: row.id,
    startedAt: row.started_at,
    status: row.status,
    stoppedAt: row.stopped_at,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
  };
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

function normalizeStringList(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => sanitizeText(item, 240))
    .filter(Boolean);
}

function normalizeOptionalDate(input: unknown) {
  if (typeof input !== "string" || !input.trim()) {
    return undefined;
  }

  const timestamp = Date.parse(input);

  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function isChronosMeetingType(value: unknown): value is ChronosMeetingType {
  return chronosMeetingTypes.some((meetingType) => meetingType === value);
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
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}
