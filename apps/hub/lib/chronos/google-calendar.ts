import { createHash, randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import type {
  ChronosGoogleCalendarConnectionStatus,
  ChronosGoogleCalendarEnvRequirement,
  ChronosGoogleCalendarStatus,
  ChronosGoogleCalendarSyncDirection,
  ChronosGoogleCalendarSyncResult,
  ChronosMeetingType,
  ChronosParticipantRole,
} from "./types";

export const chronosGoogleCalendarEnvRequirements = [
  {
    classification: "identifier",
    name: "GOOGLE_CALENDAR_CLIENT_ID",
    required: true,
  },
  {
    classification: "server_secret",
    name: "GOOGLE_CALENDAR_CLIENT_SECRET",
    required: true,
  },
  {
    classification: "operational",
    name: "GOOGLE_CALENDAR_REDIRECT_URI",
    required: true,
  },
  {
    classification: "operational",
    name: "GOOGLE_CALENDAR_SCOPES",
    required: false,
  },
  {
    classification: "operational",
    name: "GOOGLE_CALENDAR_PRIMARY_CALENDAR_ID",
    required: false,
  },
] as const satisfies ChronosGoogleCalendarEnvRequirement[];

const defaultChronosGoogleCalendarScopes = [
  "https://www.googleapis.com/auth/calendar.events",
];
const googleOAuthAuthorizeUrl = "https://accounts.google.com/o/oauth2/v2/auth";
const googleOAuthTokenUrl = "https://oauth2.googleapis.com/token";
const googleCalendarApiBaseUrl = "https://www.googleapis.com/calendar/v3";
const googleCalendarProvider = "google-calendar";
const googleCalendarDefaultTimezone = "America/Sao_Paulo";
const googleCalendarStateTtlMinutes = 15;
const googleCalendarSyncWindowPastDays = 30;
const googleCalendarSyncWindowFutureDays = 365;
const maxGoogleCalendarDescriptionLength = 7_500;

type ChronosGoogleCalendarConnectionRow = {
  calendar_id: string;
  connected_at: string;
  created_by_user_id: string | null;
  id: string;
  is_default: boolean;
  last_error: string | null;
  last_synced_at: string | null;
  metadata: Record<string, unknown>;
  refresh_token: string;
  scope: string[];
  status: "active" | "error" | "revoked";
  sync_token: string | null;
  sync_token_status: "active" | "expired" | "missing";
  token_type: string | null;
  updated_at: string;
};

type ChronosGoogleCalendarConnectionInsert =
  Partial<ChronosGoogleCalendarConnectionRow> & {
    calendar_id: string;
    refresh_token: string;
  };

type ChronosGoogleCalendarEventLinkRow = {
  calendar_id: string;
  connection_id: string | null;
  google_etag: string | null;
  google_event_id: string;
  google_html_link: string | null;
  google_ical_uid: string | null;
  id: string;
  last_error: string | null;
  last_google_updated_at: string | null;
  last_synced_at: string | null;
  meeting_id: string;
  metadata: Record<string, unknown>;
  origin: "chronos" | "google";
  sync_status: "conflict" | "deleted" | "error" | "pending" | "synced";
  updated_at: string;
};

type ChronosGoogleCalendarEventLinkInsert =
  Partial<ChronosGoogleCalendarEventLinkRow> & {
    calendar_id: string;
    google_event_id: string;
    meeting_id: string;
    origin: "chronos" | "google";
  };

type ChronosGoogleCalendarOAuthStateRow = {
  code_verifier: string;
  consumed_at: string | null;
  created_at: string;
  expires_at: string;
  id: string;
  metadata: Record<string, unknown>;
  redirect_after: string | null;
  requested_by_user_id: string | null;
  state_hash: string;
};

type ChronosMeetingRow = {
  created_at: string;
  ends_at: string | null;
  external_reference: string | null;
  host_name: string | null;
  host_user_id: string | null;
  id: string;
  meeting_type: ChronosMeetingType;
  metadata: Record<string, unknown>;
  objective: string | null;
  protocol: string;
  room_id: string | null;
  starts_at: string | null;
  status: "cancelled" | "closed" | "live" | "lobby" | "review" | "scheduled";
  title: string;
  updated_at: string;
};

type ChronosParticipantRow = {
  attendance_status?: string | null;
  display_name: string;
  email: string | null;
  meeting_id: string;
  metadata: Record<string, unknown>;
  organization: string | null;
  role: ChronosParticipantRole;
  user_id: string | null;
};

type ChronosRoomRow = {
  id: string;
  metadata: Record<string, unknown>;
  name: string;
  slug: string;
};

type ChronosTimelineEventInsert = {
  actor_user_id?: string | null;
  description?: string | null;
  event_type?: string;
  meeting_id: string;
  metadata?: Record<string, unknown>;
  title: string;
};

type ChronosGoogleCalendarDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      chronos_google_calendar_connections: {
        Insert: ChronosGoogleCalendarConnectionInsert;
        Relationships: [];
        Row: ChronosGoogleCalendarConnectionRow;
        Update: Partial<ChronosGoogleCalendarConnectionRow>;
      };
      chronos_google_calendar_event_links: {
        Insert: ChronosGoogleCalendarEventLinkInsert;
        Relationships: [];
        Row: ChronosGoogleCalendarEventLinkRow;
        Update: Partial<ChronosGoogleCalendarEventLinkRow>;
      };
      chronos_google_calendar_oauth_states: {
        Insert: Partial<ChronosGoogleCalendarOAuthStateRow> & {
          code_verifier: string;
          expires_at: string;
          state_hash: string;
        };
        Relationships: [];
        Row: ChronosGoogleCalendarOAuthStateRow;
        Update: Partial<ChronosGoogleCalendarOAuthStateRow>;
      };
      chronos_google_calendar_sync_runs: {
        Insert: {
          completed_at?: string | null;
          direction: ChronosGoogleCalendarSyncDirection;
          error_message?: string | null;
          metadata?: Record<string, unknown>;
          processed_events?: number;
          skipped_events?: number;
          started_by_user_id?: string | null;
          status: "failed" | "running" | "success";
          synced_events?: number;
        };
        Relationships: [];
        Row: {
          id: string;
        };
        Update: {
          completed_at?: string | null;
          error_message?: string | null;
          metadata?: Record<string, unknown>;
          processed_events?: number;
          skipped_events?: number;
          status?: "failed" | "running" | "success";
          synced_events?: number;
        };
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
      chronos_participants: {
        Insert: Partial<ChronosParticipantRow> & {
          display_name: string;
          meeting_id: string;
        };
        Relationships: [];
        Row: ChronosParticipantRow;
        Update: Partial<ChronosParticipantRow>;
      };
      chronos_rooms: {
        Insert: never;
        Relationships: [];
        Row: ChronosRoomRow;
        Update: never;
      };
      chronos_timeline_events: {
        Insert: ChronosTimelineEventInsert;
        Relationships: [];
        Row: never;
        Update: never;
      };
    };
    Views: Record<string, never>;
  };
};

type ChronosGoogleCalendarClient = ReturnType<
  typeof createClient<ChronosGoogleCalendarDatabase>
>;

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type GoogleCalendarEvent = {
  attendees?: Array<{
    displayName?: string;
    email?: string;
    responseStatus?: string;
  }>;
  description?: string;
  end?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  etag?: string;
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
  guestsCanInviteOthers?: boolean;
  guestsCanModify?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  htmlLink?: string;
  iCalUID?: string;
  id?: string;
  location?: string;
  recurrence?: string[];
  reminders?: {
    overrides?: Array<{
      method: "email" | "popup";
      minutes: number;
    }>;
    useDefault?: boolean;
  };
  start?: {
    date?: string;
    dateTime?: string;
    timeZone?: string;
  };
  status?: "cancelled" | "confirmed" | "tentative";
  summary?: string;
  transparency?: "opaque" | "transparent";
  updated?: string;
  visibility?: "confidential" | "default" | "private" | "public";
};

type GoogleCalendarEventsListResponse = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

class GoogleCalendarApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GoogleCalendarApiError";
    this.status = status;
  }
}

type MeetingContext = {
  meeting: ChronosMeetingRow;
  participants: ChronosParticipantRow[];
  room: ChronosRoomRow | null;
};

type GoogleConnectionLookup = {
  connection: ChronosGoogleCalendarConnectionRow | null;
  storageReady: boolean;
};

export async function getChronosGoogleCalendarStatus({
  userId,
}: {
  userId: string;
}): Promise<ChronosGoogleCalendarStatus> {
  const configStatus = getChronosGoogleCalendarConfigStatus();
  const baseStatus: ChronosGoogleCalendarStatus = {
    ...configStatus,
    callbackPath: "/api/chronos/google-calendar/callback",
    connection: {
      connected: false,
      storageReady: false,
    },
    syncPath: "/api/chronos/google-calendar/sync",
  };

  if (!configStatus.configured) {
    return baseStatus;
  }

  const client = createChronosGoogleCalendarClient();

  if (!client) {
    return {
      ...baseStatus,
      connection: {
        connected: false,
        lastError:
          "Supabase server-side indisponivel para armazenar OAuth do Google Agenda.",
        storageReady: false,
      },
      status: "storage_pending",
    };
  }

  const lookup = await getUserGoogleCalendarConnection(client, userId);

  if (!lookup.storageReady) {
    return {
      ...baseStatus,
      connection: {
        connected: false,
        lastError:
          "Migration Chronos Google Agenda ainda nao aplicada no Supabase.",
        storageReady: false,
      },
      status: "storage_pending",
    };
  }

  if (!lookup.connection) {
    return {
      ...baseStatus,
      connection: {
        connected: false,
        storageReady: true,
      },
      status: "ready_to_authorize",
    };
  }

  return {
    ...baseStatus,
    connection: mapConnectionStatus(lookup.connection, true),
    status: "connected",
  };
}

export async function startChronosGoogleCalendarAuthorization({
  redirectAfter,
  userId,
}: {
  redirectAfter?: string | null;
  userId: string;
}) {
  const configStatus = getChronosGoogleCalendarConfigStatus();

  if (!configStatus.configured) {
    throw new Error("Google Agenda aguarda configuracao server-side segura.");
  }

  const client = createChronosGoogleCalendarClient();

  if (!client) {
    throw new Error("Chronos requer Supabase server-side para OAuth Google.");
  }

  const state = toBase64Url(randomBytes(32));
  const codeVerifier = toBase64Url(randomBytes(64));
  const codeChallenge = toBase64Url(
    createHash("sha256").update(codeVerifier).digest(),
  );
  const expiresAt = new Date(
    Date.now() + googleCalendarStateTtlMinutes * 60_000,
  ).toISOString();
  const insertResult = await client
    .from("chronos_google_calendar_oauth_states")
    .insert({
      code_verifier: codeVerifier,
      expires_at: expiresAt,
      metadata: {
        provider: googleCalendarProvider,
        source: "chronos-oauth-start",
      },
      redirect_after: sanitizeReturnPath(redirectAfter),
      requested_by_user_id: userId,
      state_hash: hashSecret(state),
    });

  if (insertResult.error) {
    if (isGoogleCalendarStorageMissingError(insertResult.error)) {
      throw new Error(
        "Migration Chronos Google Agenda ainda nao aplicada no Supabase.",
      );
    }

    throw new Error("Nao foi possivel preparar OAuth Google Agenda.");
  }

  const url = new URL(googleOAuthAuthorizeUrl);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("client_id", readRequiredEnv("GOOGLE_CALENDAR_CLIENT_ID"));
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set(
    "redirect_uri",
    readRequiredEnv("GOOGLE_CALENDAR_REDIRECT_URI"),
  );
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", getChronosGoogleCalendarScopes().join(" "));
  url.searchParams.set("state", state);

  return url.toString();
}

export async function completeChronosGoogleCalendarAuthorization(
  requestUrl: string,
) {
  const url = new URL(requestUrl);
  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const deniedError = url.searchParams.get("error")?.trim();

  if (deniedError) {
    return buildChronosGoogleCalendarRedirect("/chronos", "denied");
  }

  if (!code || !state) {
    return buildChronosGoogleCalendarRedirect("/chronos", "invalid_callback");
  }

  const client = createChronosGoogleCalendarClient();

  if (!client) {
    return buildChronosGoogleCalendarRedirect("/chronos", "storage_missing");
  }

  const stateResult = await client
    .from("chronos_google_calendar_oauth_states")
    .select("*")
    .eq("state_hash", hashSecret(state))
    .is("consumed_at", null)
    .maybeSingle<ChronosGoogleCalendarOAuthStateRow>();

  if (stateResult.error || !stateResult.data) {
    return buildChronosGoogleCalendarRedirect("/chronos", "invalid_state");
  }

  const oauthState = stateResult.data;
  const redirectAfter = sanitizeReturnPath(oauthState.redirect_after) ?? "/chronos";

  if (!oauthState.requested_by_user_id) {
    return buildChronosGoogleCalendarRedirect(redirectAfter, "missing_user");
  }

  if (new Date(oauthState.expires_at).getTime() < Date.now()) {
    return buildChronosGoogleCalendarRedirect(redirectAfter, "expired_state");
  }

  const tokenResponse = await exchangeGoogleAuthorizationCode({
    code,
    codeVerifier: oauthState.code_verifier,
  });

  if (!tokenResponse.refresh_token) {
    return buildChronosGoogleCalendarRedirect(
      redirectAfter,
      "missing_refresh_token",
    );
  }

  const calendarId = getDefaultGoogleCalendarId();
  const now = new Date().toISOString();
  await client
    .from("chronos_google_calendar_connections")
    .update({
      is_default: false,
      metadata: {
        replacedAt: now,
        source: "chronos-oauth-rotation",
      },
      status: "revoked",
    })
    .eq("calendar_id", calendarId)
    .eq("created_by_user_id", oauthState.requested_by_user_id)
    .eq("is_default", true)
    .eq("status", "active");

  const connectionResult = await client
    .from("chronos_google_calendar_connections")
    .insert({
      calendar_id: calendarId,
      connected_at: now,
      created_by_user_id: oauthState.requested_by_user_id,
      is_default: true,
      metadata: {
        provider: googleCalendarProvider,
        source: "chronos-oauth-callback",
      },
      refresh_token: tokenResponse.refresh_token,
      scope: splitScopes(tokenResponse.scope) ?? getChronosGoogleCalendarScopes(),
      status: "active",
      sync_token_status: "missing",
      token_type: tokenResponse.token_type ?? "Bearer",
    });

  if (connectionResult.error) {
    return buildChronosGoogleCalendarRedirect(redirectAfter, "connection_failed");
  }

  await client
    .from("chronos_google_calendar_oauth_states")
    .update({ consumed_at: now })
    .eq("id", oauthState.id);

  return buildChronosGoogleCalendarRedirect(redirectAfter, "connected");
}

export async function syncChronosMeetingToGoogleCalendar({
  meetingId,
  trigger,
  userId,
}: {
  meetingId: string;
  trigger: string;
  userId?: string | null;
}): Promise<ChronosGoogleCalendarSyncResult> {
  const client = createChronosGoogleCalendarClient();

  if (!client) {
    return createSkippedSyncResult("push", "supabase_unconfigured");
  }

  if (!userId) {
    return createSkippedSyncResult("push", "user_missing");
  }

  const connectionLookup = await getUserGoogleCalendarConnection(client, userId);

  if (!connectionLookup.storageReady) {
    return createSkippedSyncResult("push", "storage_pending");
  }

  if (!connectionLookup.connection) {
    await updateMeetingGoogleCalendarMetadata(client, meetingId, {
      lastError: "Google Agenda ainda nao conectado.",
      status: "pending_connection",
      syncedAt: new Date().toISOString(),
      trigger,
    });

    return createSkippedSyncResult("push", "connection_missing");
  }

  const context = await loadMeetingContext(client, meetingId);

  if (!context) {
    return createSkippedSyncResult("push", "meeting_missing");
  }

  if (!context.meeting.starts_at) {
    await updateMeetingGoogleCalendarMetadata(client, meetingId, {
      calendarId: connectionLookup.connection.calendar_id,
      lastError: "Reuniao Chronos sem inicio definido.",
      status: "blocked_missing_start",
      syncedAt: new Date().toISOString(),
      trigger,
    });

    return createSkippedSyncResult("push", "missing_start");
  }

  try {
    const accessToken = await refreshGoogleAccessToken(connectionLookup.connection);
    const existingLink = await findGoogleCalendarEventLink(client, {
      calendarId: connectionLookup.connection.calendar_id,
      meetingId,
    });

    if (context.meeting.status === "cancelled") {
      if (existingLink) {
        await deleteGoogleCalendarEvent({
          accessToken,
          calendarId: connectionLookup.connection.calendar_id,
          eventId: existingLink.google_event_id,
        });
        await upsertGoogleCalendarEventLink(client, {
          calendarId: connectionLookup.connection.calendar_id,
          connectionId: connectionLookup.connection.id,
          event: {
            id: existingLink.google_event_id,
          },
          meetingId,
          origin: existingLink.origin,
          status: "deleted",
        });
      }

      await updateMeetingGoogleCalendarMetadata(client, meetingId, {
        calendarId: connectionLookup.connection.calendar_id,
        eventId: existingLink?.google_event_id,
        status: "deleted",
        syncedAt: new Date().toISOString(),
        trigger,
      });

      return {
        direction: "push",
        processed: 1,
        skipped: 0,
        status: "success",
        synced: existingLink ? 1 : 0,
      };
    }

    const eventBody = buildGoogleCalendarEventBody(context);
    const event = existingLink
      ? await patchGoogleCalendarEvent({
          accessToken,
          calendarId: connectionLookup.connection.calendar_id,
          eventBody,
          eventId: existingLink.google_event_id,
        })
      : await insertGoogleCalendarEvent({
          accessToken,
          calendarId: connectionLookup.connection.calendar_id,
          eventBody,
        });

    if (!event.id) {
      throw new Error("Google Agenda nao retornou identificador do evento.");
    }

    await upsertGoogleCalendarEventLink(client, {
      calendarId: connectionLookup.connection.calendar_id,
      connectionId: connectionLookup.connection.id,
      event,
      meetingId,
      origin: existingLink?.origin ?? "chronos",
      status: "synced",
    });
    await updateMeetingGoogleCalendarMetadata(client, meetingId, {
      calendarId: connectionLookup.connection.calendar_id,
      eventId: event.id,
      htmlLink: event.htmlLink,
      status: "synced",
      syncedAt: new Date().toISOString(),
      trigger,
    });
    await insertGoogleCalendarTimelineEvent(client, {
      eventId: event.id,
      meetingId,
      title: existingLink
        ? "Google Agenda atualizado pelo Chronos"
        : "Google Agenda criado pelo Chronos",
      userId,
    });

    return {
      direction: "push",
      processed: 1,
      skipped: 0,
      status: "success",
      synced: 1,
    };
  } catch (error) {
    const sanitizedError = sanitizeGoogleCalendarError(error);
    await updateGoogleCalendarConnectionError(
      client,
      connectionLookup.connection.id,
      sanitizedError,
    );
    await updateMeetingGoogleCalendarMetadata(client, meetingId, {
      calendarId: connectionLookup.connection.calendar_id,
      lastError: sanitizedError,
      status: "error",
      syncedAt: new Date().toISOString(),
      trigger,
    });

    return {
      direction: "push",
      error: sanitizedError,
      processed: 1,
      skipped: 0,
      status: "failed",
      synced: 0,
    };
  }
}

export async function syncChronosGoogleCalendar({
  direction,
  forceFullSync = false,
  userId,
}: {
  direction: ChronosGoogleCalendarSyncDirection;
  forceFullSync?: boolean;
  userId?: string | null;
}): Promise<ChronosGoogleCalendarSyncResult> {
  const client = createChronosGoogleCalendarClient();

  if (!client) {
    return createSkippedSyncResult(direction, "supabase_unconfigured");
  }

  const runId = await createSyncRun(client, direction, userId ?? null);

  try {
    const result =
      direction === "pull"
        ? await pullChronosEventsFromGoogleCalendar(client, userId ?? null, {
            forceFullSync,
          })
        : direction === "push"
          ? await pushChronosMeetingsToGoogleCalendar(client, userId ?? null)
          : await syncBothDirections(client, userId ?? null, { forceFullSync });

    await finishSyncRun(client, runId, result);

    return result;
  } catch (error) {
    const failedResult: ChronosGoogleCalendarSyncResult = {
      direction,
      error: sanitizeGoogleCalendarError(error),
      processed: 0,
      skipped: 0,
      status: "failed",
      synced: 0,
    };

    await finishSyncRun(client, runId, failedResult);

    return failedResult;
  }
}

function getChronosGoogleCalendarConfigStatus(): Omit<
  ChronosGoogleCalendarStatus,
  "callbackPath" | "connection" | "syncPath"
> {
  const missingEnvNames = chronosGoogleCalendarEnvRequirements
    .filter((requirement) => requirement.required)
    .filter((requirement) => !readEnvPresence(requirement.name))
    .map((requirement) => requirement.name);
  const configured = missingEnvNames.length === 0;

  return {
    authorizationPath: "/api/chronos/google-calendar/authorize",
    configured,
    missingEnvNames,
    provider: googleCalendarProvider,
    redirectUriEnvName: "GOOGLE_CALENDAR_REDIRECT_URI",
    requiredEnvNames: chronosGoogleCalendarEnvRequirements
      .filter((requirement) => requirement.required)
      .map((requirement) => requirement.name),
    scopes: getChronosGoogleCalendarScopes(),
    status: configured ? "ready_to_authorize" : "blocked",
  };
}

function getChronosGoogleCalendarScopes() {
  const configuredScopes = process.env.GOOGLE_CALENDAR_SCOPES?.split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  return configuredScopes?.length
    ? configuredScopes
    : defaultChronosGoogleCalendarScopes;
}

function getDefaultGoogleCalendarId() {
  return process.env.GOOGLE_CALENDAR_PRIMARY_CALENDAR_ID?.trim() || "primary";
}

function createChronosGoogleCalendarClient() {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient<ChronosGoogleCalendarDatabase>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function getUserGoogleCalendarConnection(
  client: ChronosGoogleCalendarClient,
  userId: string,
): Promise<GoogleConnectionLookup> {
  const result = await client
    .from("chronos_google_calendar_connections")
    .select("*")
    .eq("created_by_user_id", userId)
    .eq("status", "active")
    .eq("is_default", true)
    .order("connected_at", { ascending: false })
    .limit(1);

  if (result.error) {
    if (isGoogleCalendarStorageMissingError(result.error)) {
      return { connection: null, storageReady: false };
    }

    throw result.error;
  }

  return {
    connection: result.data?.[0] ?? null,
    storageReady: true,
  };
}

function mapConnectionStatus(
  connection: ChronosGoogleCalendarConnectionRow,
  storageReady: boolean,
): ChronosGoogleCalendarConnectionStatus {
  return {
    calendarId: connection.calendar_id,
    connected: true,
    connectedAt: connection.connected_at,
    lastError: connection.last_error,
    lastSyncedAt: connection.last_synced_at,
    storageReady,
    syncTokenPresent: Boolean(connection.sync_token),
  };
}

async function exchangeGoogleAuthorizationCode({
  code,
  codeVerifier,
}: {
  code: string;
  codeVerifier: string;
}) {
  const body = new URLSearchParams({
    client_id: readRequiredEnv("GOOGLE_CALENDAR_CLIENT_ID"),
    client_secret: readRequiredEnv("GOOGLE_CALENDAR_CLIENT_SECRET"),
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: readRequiredEnv("GOOGLE_CALENDAR_REDIRECT_URI"),
  });

  const response = await fetch(googleOAuthTokenUrl, {
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | GoogleTokenResponse
    | null;

  if (!response.ok || payload?.error) {
    throw new GoogleCalendarApiError(
      normalizeGoogleOAuthErrorMessage(payload) || "Falha OAuth Google.",
      response.status,
    );
  }

  return payload ?? {};
}

async function refreshGoogleAccessToken(
  connection: ChronosGoogleCalendarConnectionRow,
) {
  const body = new URLSearchParams({
    client_id: readRequiredEnv("GOOGLE_CALENDAR_CLIENT_ID"),
    client_secret: readRequiredEnv("GOOGLE_CALENDAR_CLIENT_SECRET"),
    grant_type: "refresh_token",
    refresh_token: connection.refresh_token,
  });
  const response = await fetch(googleOAuthTokenUrl, {
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | GoogleTokenResponse
    | null;

  if (!response.ok || !payload?.access_token || payload.error) {
    throw new GoogleCalendarApiError(
      normalizeGoogleOAuthErrorMessage(payload) ||
        "Falha ao renovar Google Agenda.",
      response.status,
    );
  }

  return payload.access_token;
}

async function loadMeetingContext(
  client: ChronosGoogleCalendarClient,
  meetingId: string,
): Promise<MeetingContext | null> {
  const meetingResult = await client
    .from("chronos_meetings")
    .select("*")
    .eq("id", meetingId)
    .maybeSingle<ChronosMeetingRow>();

  if (meetingResult.error || !meetingResult.data) {
    return null;
  }

  const participantsResult = await client
    .from("chronos_participants")
    .select("*")
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: true });
  const roomResult = meetingResult.data.room_id
    ? await client
        .from("chronos_rooms")
        .select("*")
        .eq("id", meetingResult.data.room_id)
        .maybeSingle<ChronosRoomRow>()
    : null;

  return {
    meeting: meetingResult.data,
    participants: participantsResult.data ?? [],
    room: roomResult?.data ?? null,
  };
}

function buildGoogleCalendarEventBody(context: MeetingContext): GoogleCalendarEvent {
  const startsAt = context.meeting.starts_at;

  if (!startsAt) {
    throw new Error("Reuniao Chronos sem inicio definido.");
  }

  const endsAt =
    context.meeting.ends_at ??
    new Date(new Date(startsAt).getTime() + 60 * 60_000).toISOString();
  const privateProperties: Record<string, string> = {
    chronosMeetingId: context.meeting.id,
    chronosProtocol: context.meeting.protocol,
    source: "chronos",
  };
  const attendees = context.participants
    .filter((participant) => Boolean(participant.email?.trim()))
    .map((participant) => ({
      displayName: participant.display_name,
      email: participant.email?.trim(),
    }));
  const recurrence = getGoogleCalendarRecurrence(context);
  const calendarOptions = getGoogleCalendarOptions(context);

  return {
    attendees,
    description: buildGoogleCalendarEventDescription(context),
    end: {
      dateTime: endsAt,
      timeZone: googleCalendarDefaultTimezone,
    },
    ...calendarOptions,
    extendedProperties: {
      private: privateProperties,
      shared: {
        chronosProtocol: context.meeting.protocol,
      },
    },
    location: buildGoogleCalendarLocation(context),
    recurrence: recurrence.length > 0 ? recurrence : undefined,
    start: {
      dateTime: startsAt,
      timeZone: googleCalendarDefaultTimezone,
    },
    status: context.meeting.status === "cancelled" ? "cancelled" : "confirmed",
    summary: context.meeting.title,
  };
}

function buildGoogleCalendarEventDescription(context: MeetingContext) {
  const agendaHtml = Array.isArray(context.meeting.metadata?.agenda)
    ? formatGoogleCalendarAgendaHtml(
        context.meeting.metadata.agenda.filter(
          (item): item is string => typeof item === "string",
        ),
      )
    : [];
  const roomUrl = getChronosGoogleCalendarRoomUrl(context);
  const recurrence = readRecord(context.meeting.metadata?.recurrence);
  const recurrenceLabel =
    typeof recurrence.label === "string" ? recurrence.label.trim() : "";
  const metadataItems = [
    ["Protocolo Chronos", context.meeting.protocol],
    ["Objetivo", context.meeting.objective],
    ["Sala Chronos", context.room?.name],
    ["URL da sala", roomUrl],
    ["Recorrencia", recurrenceLabel],
  ]
    .filter((item): item is [string, string] => Boolean(item[1]?.trim()))
    .map(([label, value]) => {
      const escapedValue = escapeGoogleCalendarHtml(value);

      if (label === "URL da sala" && roomUrl) {
        return `<p><strong>${label}:</strong> <a href="${escapeGoogleCalendarHtml(roomUrl)}">${escapedValue}</a></p>`;
      }

      return `<p><strong>${label}:</strong> ${escapedValue}</p>`;
    });

  const html = [
    ...metadataItems,
    agendaHtml.length ? "<hr>" : null,
    ...agendaHtml,
    "<p><em>Evento espelhado pelo Panteon Chronos.</em></p>",
  ].filter((item): item is string => typeof item === "string");

  return html.join("").slice(0, maxGoogleCalendarDescriptionLength);
}

function buildGoogleCalendarLocation(context: MeetingContext) {
  const location = readRecord(context.meeting.metadata?.location);
  const mode = typeof location.mode === "string" ? location.mode : "online";
  const roomUrl = getChronosGoogleCalendarRoomUrl(context);

  if (mode === "offline" && typeof location.address === "string") {
    return location.address;
  }

  if (context.room?.name && roomUrl) {
    return `${context.room.name} - ${roomUrl}`;
  }

  return roomUrl ?? context.room?.name ?? "Chronos";
}

function getChronosGoogleCalendarRoomUrl(context: MeetingContext) {
  const appUrl = getChronosGoogleCalendarAppUrl();
  const roomPath = context.room?.slug ? `/chronos/${context.room.slug}` : null;

  return appUrl && roomPath ? new URL(roomPath, appUrl).toString() : null;
}

function getChronosGoogleCalendarAppUrl() {
  const configuredUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_CARELI_APP_URL?.trim();

  if (configuredUrl) {
    return ensureUrl(configuredUrl);
  }

  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
    return "https://c2x.app.br";
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();

  return vercelUrl ? ensureUrl(vercelUrl) : null;
}

function formatGoogleCalendarAgendaHtml(agenda: string[]) {
  const blocks: string[] = [];
  let bulletItems: string[] = [];

  const flushBulletItems = () => {
    if (!bulletItems.length) {
      return;
    }

    blocks.push(`<ul>${bulletItems.join("")}</ul>`);
    bulletItems = [];
  };

  for (const rawLine of agenda.flatMap((item) => item.split(/\r?\n/)).slice(0, 120)) {
    const line = rawLine.replace(/\s+/g, " ").trim();

    if (!line || line === "---") {
      flushBulletItems();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch?.[1] && headingMatch[2]) {
      flushBulletItems();
      const headingLevel = headingMatch[1];
      const headingText = headingMatch[2];
      const level = headingLevel.length <= 2 ? "h2" : "h3";
      blocks.push(
        `<${level}>${formatGoogleCalendarInlineMarkdown(headingText)}</${level}>`,
      );
      continue;
    }

    const bulletMatch = line.match(/^(?:[-*]|\u2022)\s+(.+)$/);

    if (bulletMatch?.[1]) {
      const bulletText = bulletMatch[1];

      bulletItems.push(
        `<li>${formatGoogleCalendarInlineMarkdown(bulletText)}</li>`,
      );
      continue;
    }

    const numberedSectionMatch = line.match(/^(\d+[.)]\s+.+)$/);

    flushBulletItems();
    blocks.push(
      numberedSectionMatch?.[1]
        ? `<p><strong>${formatGoogleCalendarInlineMarkdown(numberedSectionMatch[1])}</strong></p>`
        : `<p>${formatGoogleCalendarInlineMarkdown(line)}</p>`,
    );
  }

  flushBulletItems();

  return blocks;
}

function formatGoogleCalendarInlineMarkdown(value: string) {
  return escapeGoogleCalendarHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function escapeGoogleCalendarHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getGoogleCalendarRecurrence(context: MeetingContext) {
  const recurrence = readRecord(context.meeting.metadata?.recurrence);
  const rrule = typeof recurrence.rrule === "string" ? recurrence.rrule : "";

  return rrule.startsWith("RRULE:") ? [rrule] : [];
}

function getGoogleCalendarOptions(context: MeetingContext): Partial<GoogleCalendarEvent> {
  const options = readRecord(context.meeting.metadata?.calendarOptions);
  const guestPermissions = readRecord(options.guestPermissions);
  const notificationMinutes =
    typeof options.notificationMinutes === "number"
      ? Math.max(0, Math.min(10_080, Math.round(options.notificationMinutes)))
      : null;
  const visibility =
    options.visibility === "private" || options.visibility === "public"
      ? options.visibility
      : "default";

  return {
    guestsCanInviteOthers: guestPermissions.canInviteOthers !== false,
    guestsCanModify: guestPermissions.canModify === true,
    guestsCanSeeOtherGuests: guestPermissions.canSeeGuestList !== false,
    reminders:
      notificationMinutes !== null
        ? {
            overrides: [
              {
                method: "popup",
                minutes: notificationMinutes,
              },
            ],
            useDefault: false,
          }
        : undefined,
    transparency: options.availability === "free" ? "transparent" : "opaque",
    visibility,
  };
}

async function insertGoogleCalendarEvent({
  accessToken,
  calendarId,
  eventBody,
}: {
  accessToken: string;
  calendarId: string;
  eventBody: GoogleCalendarEvent;
}) {
  return googleCalendarFetch<GoogleCalendarEvent>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
    {
      body: JSON.stringify(eventBody),
      method: "POST",
    },
  );
}

async function patchGoogleCalendarEvent({
  accessToken,
  calendarId,
  eventBody,
  eventId,
}: {
  accessToken: string;
  calendarId: string;
  eventBody: GoogleCalendarEvent;
  eventId: string;
}) {
  return googleCalendarFetch<GoogleCalendarEvent>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    {
      body: JSON.stringify(eventBody),
      method: "PATCH",
    },
  );
}

async function deleteGoogleCalendarEvent({
  accessToken,
  calendarId,
  eventId,
}: {
  accessToken: string;
  calendarId: string;
  eventId: string;
}) {
  await googleCalendarFetch<unknown>(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    {
      method: "DELETE",
    },
    { allowEmpty: true },
  );
}

async function googleCalendarFetch<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
  options: { allowEmpty?: boolean } = {},
): Promise<T> {
  const response = await fetch(`${googleCalendarApiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const payload = text ? parseGoogleCalendarResponse(text) : null;

  if (!response.ok) {
    throw new GoogleCalendarApiError(
      extractGoogleCalendarError(payload) ??
        (text.trim() ? text.trim().slice(0, 180) : "Falha Google Agenda."),
      response.status,
    );
  }

  if (!payload && !options.allowEmpty) {
    throw new Error("Google Agenda retornou resposta vazia.");
  }

  return payload as T;
}

async function findGoogleCalendarEventLink(
  client: ChronosGoogleCalendarClient,
  input: { calendarId: string; meetingId: string },
) {
  const result = await client
    .from("chronos_google_calendar_event_links")
    .select("*")
    .eq("calendar_id", input.calendarId)
    .eq("meeting_id", input.meetingId)
    .maybeSingle<ChronosGoogleCalendarEventLinkRow>();

  if (result.error) {
    throw result.error;
  }

  return result.data;
}

async function findGoogleCalendarEventLinkByEventId(
  client: ChronosGoogleCalendarClient,
  input: { calendarId: string; eventId: string },
) {
  const result = await client
    .from("chronos_google_calendar_event_links")
    .select("*")
    .eq("calendar_id", input.calendarId)
    .eq("google_event_id", input.eventId)
    .limit(1)
    .returns<ChronosGoogleCalendarEventLinkRow[]>();

  if (result.error) {
    throw result.error;
  }

  return result.data?.[0] ?? null;
}

async function findGoogleCalendarEventLinkByConnectionEventId(
  client: ChronosGoogleCalendarClient,
  input: { connectionId: string; eventId: string },
) {
  const result = await client
    .from("chronos_google_calendar_event_links")
    .select("*")
    .eq("connection_id", input.connectionId)
    .eq("google_event_id", input.eventId)
    .limit(1)
    .returns<ChronosGoogleCalendarEventLinkRow[]>();

  if (result.error) {
    throw result.error;
  }

  return result.data?.[0] ?? null;
}

async function upsertGoogleCalendarEventLink(
  client: ChronosGoogleCalendarClient,
  input: {
    calendarId: string;
    connectionId: string;
    event: GoogleCalendarEvent;
    meetingId: string;
    origin: "chronos" | "google";
    status: "deleted" | "error" | "synced";
  },
) {
  if (!input.event.id) {
    throw new Error("Evento Google sem identificador.");
  }

  const now = new Date().toISOString();
  const payload: ChronosGoogleCalendarEventLinkInsert = {
    calendar_id: input.calendarId,
    connection_id: input.connectionId || null,
    google_etag: input.event.etag ?? null,
    google_event_id: input.event.id,
    google_html_link: input.event.htmlLink ?? null,
    google_ical_uid: input.event.iCalUID ?? null,
    last_error: null,
    last_google_updated_at: input.event.updated ?? null,
    last_synced_at: now,
    meeting_id: input.meetingId,
    metadata: {
      provider: googleCalendarProvider,
      source: "chronos-google-calendar-sync",
    },
    origin: input.origin,
    sync_status: input.status,
  };
  const existingLink =
    input.connectionId
      ? await findGoogleCalendarEventLinkByConnectionEventId(client, {
          connectionId: input.connectionId,
          eventId: input.event.id,
        })
      : await findGoogleCalendarEventLinkByEventId(client, {
          calendarId: input.calendarId,
          eventId: input.event.id,
        });
  const result = existingLink
    ? await client
        .from("chronos_google_calendar_event_links")
        .update(payload)
        .eq("id", existingLink.id)
    : await client.from("chronos_google_calendar_event_links").insert(payload);

  if (result.error) {
    throw result.error;
  }
}

async function updateMeetingGoogleCalendarMetadata(
  client: ChronosGoogleCalendarClient,
  meetingId: string,
  googleCalendar: Record<string, unknown>,
) {
  const meeting = await client
    .from("chronos_meetings")
    .select("metadata")
    .eq("id", meetingId)
    .maybeSingle<{ metadata: Record<string, unknown> }>();

  if (meeting.error || !meeting.data) {
    return;
  }

  const metadata = {
    ...(meeting.data.metadata ?? {}),
    googleCalendar: {
      ...readRecord(meeting.data.metadata?.googleCalendar),
      provider: googleCalendarProvider,
      ...googleCalendar,
    },
  };
  await client.from("chronos_meetings").update({ metadata }).eq("id", meetingId);
}

async function updateGoogleCalendarConnectionError(
  client: ChronosGoogleCalendarClient,
  connectionId: string,
  lastError: string,
) {
  await client
    .from("chronos_google_calendar_connections")
    .update({
      last_error: lastError,
    })
    .eq("id", connectionId);
}

async function insertGoogleCalendarTimelineEvent(
  client: ChronosGoogleCalendarClient,
  input: {
    eventId?: string;
    meetingId: string;
    title: string;
    userId?: string | null;
  },
) {
  await client.from("chronos_timeline_events").insert({
    actor_user_id: input.userId ?? null,
    event_type: "note",
    meeting_id: input.meetingId,
    metadata: {
      googleEventId: input.eventId ?? null,
      provider: googleCalendarProvider,
      source: "chronos-google-calendar-sync",
    },
    title: input.title,
  });
}

async function pushChronosMeetingsToGoogleCalendar(
  client: ChronosGoogleCalendarClient,
  userId: string | null,
): Promise<ChronosGoogleCalendarSyncResult> {
  const since = new Date(
    Date.now() - googleCalendarSyncWindowPastDays * 24 * 60 * 60_000,
  ).toISOString();
  const meetingsResult = await client
    .from("chronos_meetings")
    .select("id")
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (meetingsResult.error) {
    throw meetingsResult.error;
  }

  let processed = 0;
  let skipped = 0;
  let synced = 0;

  for (const meeting of meetingsResult.data ?? []) {
    processed += 1;
    const result = await syncChronosMeetingToGoogleCalendar({
      meetingId: meeting.id,
      trigger: "manual_push",
      userId,
    });

    skipped += result.skipped;
    synced += result.synced;
  }

  return {
    direction: "push",
    processed,
    skipped,
    status: "success",
    synced,
  };
}

async function pullChronosEventsFromGoogleCalendar(
  client: ChronosGoogleCalendarClient,
  userId: string | null,
  options: { forceFullSync?: boolean } = {},
): Promise<ChronosGoogleCalendarSyncResult> {
  if (!userId) {
    return createSkippedSyncResult("pull", "user_missing");
  }

  const connectionLookup = await getUserGoogleCalendarConnection(client, userId);

  if (!connectionLookup.storageReady) {
    return createSkippedSyncResult("pull", "storage_pending");
  }

  if (!connectionLookup.connection) {
    return createSkippedSyncResult("pull", "connection_missing");
  }

  let accessToken: string;

  try {
    accessToken = await refreshGoogleAccessToken(connectionLookup.connection);
  } catch (error) {
    await updateGoogleCalendarConnectionError(
      client,
      connectionLookup.connection.id,
      sanitizeGoogleCalendarError(error),
    );
    throw error;
  }

  let activeConnection = connectionLookup.connection;
  let listResult: Awaited<ReturnType<typeof listGoogleCalendarEvents>>;

  try {
    listResult = await listGoogleCalendarEvents({
      accessToken,
      connection: activeConnection,
      forceFullSync: options.forceFullSync === true,
    });
  } catch (error) {
    if (
      options.forceFullSync === true ||
      !isExpiredGoogleCalendarSyncTokenError(error) ||
      !activeConnection.sync_token
    ) {
      await updateGoogleCalendarConnectionError(
        client,
        activeConnection.id,
        sanitizeGoogleCalendarError(error),
      );
      throw error;
    }

    await client
      .from("chronos_google_calendar_connections")
      .update({
        last_error: null,
        sync_token: null,
        sync_token_status: "expired",
      })
      .eq("id", activeConnection.id);

    activeConnection = {
      ...activeConnection,
      sync_token: null,
      sync_token_status: "expired",
    };
    listResult = await listGoogleCalendarEvents({
      accessToken,
      connection: activeConnection,
      forceFullSync: true,
    });
  }
  let processed = 0;
  let skipped = 0;
  let synced = 0;
  let lastEventError: string | null = null;
  const diagnostics: Record<string, number> = {};
  const countDiagnostic = (reason: string) => {
    diagnostics[reason] = (diagnostics[reason] ?? 0) + 1;
  };

  for (const event of listResult.events) {
    processed += 1;
    try {
      const eventId = event.id;

      if (!eventId) {
        skipped += 1;
        countDiagnostic("missing_event_id");
        continue;
      }

      const link = await findGoogleCalendarEventLinkByEventId(client, {
        calendarId: connectionLookup.connection.calendar_id,
        eventId,
      });

      if (event.status === "cancelled") {
        if (link) {
          await client
            .from("chronos_meetings")
            .update({ status: "cancelled" })
            .eq("id", link.meeting_id);
          await upsertGoogleCalendarEventLink(client, {
            calendarId: connectionLookup.connection.calendar_id,
            connectionId: connectionLookup.connection.id,
            event,
            meetingId: link.meeting_id,
            origin: link.origin,
            status: "deleted",
          });
          synced += 1;
        } else {
          skipped += 1;
          countDiagnostic("cancelled_without_link");
        }

        continue;
      }

      if (link) {
        await applyGoogleEventToChronosMeeting(client, {
          calendarId: connectionLookup.connection.calendar_id,
          event,
          link,
          userId,
        });
        synced += 1;
        continue;
      }

      const importedMeetingId = await importGoogleEventAsChronosMeeting(client, {
        calendarId: connectionLookup.connection.calendar_id,
        connectionId: connectionLookup.connection.id,
        event,
        userId,
      });

      if (importedMeetingId) {
        synced += 1;
      } else {
        skipped += 1;
        countDiagnostic("missing_start_or_unimportable");
      }
    } catch (error) {
      lastEventError = sanitizeGoogleCalendarError(error);
      skipped += 1;
      countDiagnostic("event_error");
    }
  }

  await client
    .from("chronos_google_calendar_connections")
    .update({
      last_error: lastEventError,
      last_synced_at: new Date().toISOString(),
      sync_token: listResult.nextSyncToken ?? activeConnection.sync_token,
      sync_token_status: listResult.nextSyncToken ? "active" : "missing",
    })
    .eq("id", activeConnection.id);

  return {
    diagnostics,
    direction: "pull",
    error: lastEventError ?? undefined,
    processed,
    skipped,
    status: "success",
    synced,
  };
}

async function syncBothDirections(
  client: ChronosGoogleCalendarClient,
  userId: string | null,
  options: { forceFullSync?: boolean } = {},
): Promise<ChronosGoogleCalendarSyncResult> {
  const push = await runGoogleCalendarSyncStep("push", () =>
    pushChronosMeetingsToGoogleCalendar(client, userId),
  );
  const pull = await runGoogleCalendarSyncStep("pull", () =>
    pullChronosEventsFromGoogleCalendar(client, userId, options),
  );
  const importFailed = pull.status === "failed";

  return {
    direction: "both",
    error: importFailed ? pull.error : undefined,
    processed: push.processed + pull.processed,
    skipped: push.skipped + pull.skipped,
    status: importFailed ? "failed" : "success",
    synced: push.synced + pull.synced,
  };
}

async function runGoogleCalendarSyncStep(
  direction: "pull" | "push",
  operation: () => Promise<ChronosGoogleCalendarSyncResult>,
): Promise<ChronosGoogleCalendarSyncResult> {
  try {
    return await operation();
  } catch (error) {
    return {
      direction,
      error: sanitizeGoogleCalendarError(error),
      processed: 0,
      skipped: 0,
      status: "failed",
      synced: 0,
    };
  }
}

async function listGoogleCalendarEvents({
  accessToken,
  connection,
  forceFullSync = false,
}: {
  accessToken: string;
  connection: ChronosGoogleCalendarConnectionRow;
  forceFullSync?: boolean;
}) {
  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  const baseParams = new URLSearchParams({
    maxResults: "250",
    showDeleted: "true",
    singleEvents: "true",
  });

  if (connection.sync_token && !forceFullSync) {
    baseParams.set("syncToken", connection.sync_token);
  } else {
    baseParams.set(
      "timeMin",
      new Date(
        Date.now() - googleCalendarSyncWindowPastDays * 24 * 60 * 60_000,
      ).toISOString(),
    );
    baseParams.set(
      "timeMax",
      new Date(
        Date.now() + googleCalendarSyncWindowFutureDays * 24 * 60 * 60_000,
      ).toISOString(),
    );
  }

  do {
    const params = new URLSearchParams(baseParams);

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const payload = await googleCalendarFetch<GoogleCalendarEventsListResponse>(
      accessToken,
      `/calendars/${encodeURIComponent(connection.calendar_id)}/events?${params.toString()}`,
      { method: "GET" },
    );

    events.push(...(payload.items ?? []));
    pageToken = payload.nextPageToken;
    nextSyncToken = payload.nextSyncToken ?? nextSyncToken;
  } while (pageToken);

  return { events, nextSyncToken };
}

async function applyGoogleEventToChronosMeeting(
  client: ChronosGoogleCalendarClient,
  input: {
    calendarId: string;
    event: GoogleCalendarEvent;
    link: ChronosGoogleCalendarEventLinkRow;
    userId: string | null;
  },
) {
  const startsAt = normalizeGoogleEventDate(input.event.start);
  const endsAt = normalizeGoogleEventDate(input.event.end);
  const existingMeeting = await client
    .from("chronos_meetings")
    .select("metadata")
    .eq("id", input.link.meeting_id)
    .maybeSingle<{ metadata: Record<string, unknown> }>();
  const updatePayload: Partial<ChronosMeetingRow> = {
    metadata: {
      ...(existingMeeting.data?.metadata ?? {}),
      googleCalendar: {
        ...readRecord(existingMeeting.data?.metadata?.googleCalendar),
        calendarId: input.calendarId,
        eventId: input.event.id,
        htmlLink: input.event.htmlLink,
        inboundSyncedAt: new Date().toISOString(),
        provider: googleCalendarProvider,
        source: "google",
        status: "synced",
      },
    },
  };

  if (input.event.summary?.trim()) {
    updatePayload.title = input.event.summary.trim().slice(0, 160);
  }

  if (startsAt) {
    updatePayload.starts_at = startsAt;
  }

  if (endsAt) {
    updatePayload.ends_at = endsAt;
  }

  await client
    .from("chronos_meetings")
    .update(updatePayload)
    .eq("id", input.link.meeting_id);
  await upsertGoogleCalendarEventLink(client, {
    calendarId: input.calendarId,
    connectionId: input.link.connection_id ?? "",
    event: input.event,
    meetingId: input.link.meeting_id,
    origin: input.link.origin,
    status: "synced",
  });
  await insertGoogleCalendarTimelineEvent(client, {
    eventId: input.event.id,
    meetingId: input.link.meeting_id,
    title: "Chronos atualizado pelo Google Agenda",
    userId: input.userId,
  });
}

async function importGoogleEventAsChronosMeeting(
  client: ChronosGoogleCalendarClient,
  input: {
    calendarId: string;
    connectionId: string;
    event: GoogleCalendarEvent;
    userId: string | null;
  },
) {
  const eventId = input.event.id;
  const startsAt = normalizeGoogleEventDate(input.event.start);

  if (!eventId || !startsAt) {
    return null;
  }

  const endsAt = normalizeGoogleEventDate(input.event.end);
  const existingMeeting = await findChronosMeetingByGoogleExternalReference(client, eventId);

  if (existingMeeting) {
    await applyGoogleEventToExistingChronosMeeting(client, {
      calendarId: input.calendarId,
      connectionId: input.connectionId,
      event: input.event,
      meeting: existingMeeting,
      userId: input.userId,
    });

    return existingMeeting.id;
  }

  const protocol = await generateChronosProtocol(client);
  const meetingResult = await client
    .from("chronos_meetings")
    .insert({
      ends_at: endsAt,
      external_reference: `google:${eventId}`,
      host_user_id: input.userId,
      meeting_type: "alignment",
      metadata: {
        googleCalendar: {
          calendarId: input.calendarId,
          eventId,
          htmlLink: input.event.htmlLink,
          inboundSyncedAt: new Date().toISOString(),
          provider: googleCalendarProvider,
          source: "google",
          status: "synced",
        },
        source: "google-calendar",
      },
      protocol,
      starts_at: startsAt,
      status: "scheduled",
      title: input.event.summary?.trim().slice(0, 160) || "Evento Google Agenda",
    })
    .select("*")
    .single<ChronosMeetingRow>();

  if (meetingResult.error || !meetingResult.data) {
    throw meetingResult.error ?? new Error("Falha ao importar evento Google.");
  }

  const attendees = input.event.attendees ?? [];
  const participants = attendees
    .filter((attendee) => attendee.email?.trim())
    .map((attendee) => ({
      display_name: attendee.displayName?.trim() || attendee.email?.trim() || "Convidado",
      email: attendee.email?.trim() ?? null,
      meeting_id: meetingResult.data.id,
      metadata: {
        googleResponseStatus: attendee.responseStatus ?? null,
        source: "google-calendar",
      },
      role: "participant" as const,
    }));

  if (participants.length > 0) {
    await client.from("chronos_participants").insert(participants);
  }

  await upsertGoogleCalendarEventLink(client, {
    calendarId: input.calendarId,
    connectionId: input.connectionId,
    event: input.event,
    meetingId: meetingResult.data.id,
    origin: "google",
    status: "synced",
  });
  await insertGoogleCalendarTimelineEvent(client, {
    eventId,
    meetingId: meetingResult.data.id,
    title: "Evento importado do Google Agenda",
    userId: input.userId,
  });

  return meetingResult.data.id;
}

async function findChronosMeetingByGoogleExternalReference(
  client: ChronosGoogleCalendarClient,
  eventId: string,
) {
  const result = await client
    .from("chronos_meetings")
    .select("*")
    .eq("external_reference", `google:${eventId}`)
    .limit(1)
    .returns<ChronosMeetingRow[]>();

  if (result.error) {
    throw result.error;
  }

  return result.data?.[0] ?? null;
}

async function applyGoogleEventToExistingChronosMeeting(
  client: ChronosGoogleCalendarClient,
  input: {
    calendarId: string;
    connectionId: string;
    event: GoogleCalendarEvent;
    meeting: ChronosMeetingRow;
    userId: string | null;
  },
) {
  const startsAt = normalizeGoogleEventDate(input.event.start);
  const endsAt = normalizeGoogleEventDate(input.event.end);
  const metadata = {
    ...(input.meeting.metadata ?? {}),
    googleCalendar: {
      ...readRecord(input.meeting.metadata?.googleCalendar),
      calendarId: input.calendarId,
      eventId: input.event.id,
      htmlLink: input.event.htmlLink,
      inboundSyncedAt: new Date().toISOString(),
      provider: googleCalendarProvider,
      source: "google",
      status: "synced",
    },
  };
  const updatePayload: Partial<ChronosMeetingRow> = {
    metadata,
    status: input.meeting.status === "cancelled" ? "scheduled" : input.meeting.status,
  };

  if (input.userId) {
    updatePayload.host_user_id = input.userId;
  }

  if (input.event.summary?.trim()) {
    updatePayload.title = input.event.summary.trim().slice(0, 160);
  }

  if (startsAt) {
    updatePayload.starts_at = startsAt;
  }

  if (endsAt) {
    updatePayload.ends_at = endsAt;
  }

  const updateResult = await client
    .from("chronos_meetings")
    .update(updatePayload)
    .eq("id", input.meeting.id);

  if (updateResult.error) {
    throw updateResult.error;
  }

  await syncGoogleEventAttendeesToChronosParticipants(client, {
    event: input.event,
    meetingId: input.meeting.id,
  });

  await upsertGoogleCalendarEventLink(client, {
    calendarId: input.calendarId,
    connectionId: input.connectionId,
    event: input.event,
    meetingId: input.meeting.id,
    origin: "google",
    status: "synced",
  });
  await insertGoogleCalendarTimelineEvent(client, {
    eventId: input.event.id,
    meetingId: input.meeting.id,
    title: "Evento Google Agenda revinculado ao Chronos",
    userId: input.userId,
  });
}

async function syncGoogleEventAttendeesToChronosParticipants(
  client: ChronosGoogleCalendarClient,
  input: {
    event: GoogleCalendarEvent;
    meetingId: string;
  },
) {
  const attendees = (input.event.attendees ?? [])
    .map((attendee) => ({
      displayName:
        attendee.displayName?.trim() ||
        attendee.email?.trim() ||
        "Convidado",
      email: attendee.email?.trim() ?? null,
      googleResponseStatus: attendee.responseStatus ?? null,
    }))
    .filter((attendee) => Boolean(attendee.email));

  if (attendees.length === 0) {
    return;
  }

  const existingParticipantsResult = await client
    .from("chronos_participants")
    .select("*")
    .eq("meeting_id", input.meetingId);

  if (existingParticipantsResult.error) {
    throw existingParticipantsResult.error;
  }

  const hostEmails = new Set(
    (existingParticipantsResult.data ?? [])
      .filter((participant) => participant.role === "host")
      .map((participant) => participant.email?.trim().toLowerCase())
      .filter((email): email is string => Boolean(email)),
  );
  const participantRows = attendees
    .filter(
      (attendee) =>
        attendee.email &&
        !hostEmails.has(attendee.email.trim().toLowerCase()),
    )
    .map((attendee) => ({
      attendance_status:
        attendee.googleResponseStatus === "accepted" ? "confirmed" : "invited",
      display_name: attendee.displayName,
      email: attendee.email,
      meeting_id: input.meetingId,
      metadata: {
        chronosResponseStatus:
          attendee.googleResponseStatus === "accepted"
            ? "accepted"
            : attendee.googleResponseStatus === "declined"
              ? "declined"
              : attendee.googleResponseStatus === "tentative"
                ? "tentative"
                : "pending",
        googleResponseStatus: attendee.googleResponseStatus,
        source: "google-calendar",
      },
      organization: null,
      role: "participant" as const,
      user_id: null,
    }));

  const deleteResult = await client
    .from("chronos_participants")
    .delete()
    .eq("meeting_id", input.meetingId)
    .neq("role", "host");

  if (deleteResult.error) {
    throw deleteResult.error;
  }

  if (participantRows.length === 0) {
    return;
  }

  const insertResult = await client
    .from("chronos_participants")
    .insert(participantRows);

  if (insertResult.error) {
    throw insertResult.error;
  }
}

async function generateChronosProtocol(client: ChronosGoogleCalendarClient) {
  const { data } = await client
    .from("chronos_meetings")
    .select("protocol")
    .order("created_at", { ascending: false })
    .limit(1);
  const lastProtocol = data?.[0]?.protocol ?? "";
  const lastNumber = Number(lastProtocol.replace(/\D/g, ""));

  return `CHR-${String(Number.isFinite(lastNumber) ? lastNumber + 1 : 1).padStart(6, "0")}`;
}

async function createSyncRun(
  client: ChronosGoogleCalendarClient,
  direction: ChronosGoogleCalendarSyncDirection,
  userId: string | null,
) {
  const result = await client
    .from("chronos_google_calendar_sync_runs")
    .insert({
      direction,
      metadata: {
        provider: googleCalendarProvider,
        source: "chronos-sync-route",
      },
      started_by_user_id: userId,
      status: "running",
    })
    .select("id")
    .single<{ id: string }>();

  return result.data?.id ?? null;
}

async function finishSyncRun(
  client: ChronosGoogleCalendarClient,
  runId: string | null,
  result: ChronosGoogleCalendarSyncResult,
) {
  if (!runId) {
    return;
  }

  await client
    .from("chronos_google_calendar_sync_runs")
    .update({
      completed_at: new Date().toISOString(),
      error_message: result.error ?? null,
      metadata: {
        diagnostics: result.diagnostics ?? null,
        provider: googleCalendarProvider,
        source: "chronos-sync-route",
      },
      processed_events: result.processed,
      skipped_events: result.skipped,
      status: result.status === "failed" ? "failed" : "success",
      synced_events: result.synced,
    })
    .eq("id", runId);
}

function normalizeGoogleEventDate(
  value: GoogleCalendarEvent["start"] | GoogleCalendarEvent["end"],
) {
  const raw = value?.dateTime ?? value?.date;

  if (!raw) {
    return null;
  }

  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function createSkippedSyncResult(
  direction: ChronosGoogleCalendarSyncDirection,
  reason: string,
): ChronosGoogleCalendarSyncResult {
  return {
    direction,
    error: reason,
    processed: 0,
    skipped: 1,
    status: "skipped",
    synced: 0,
  };
}

function buildChronosGoogleCalendarRedirect(path: string, status: string) {
  const redirect = new URL(sanitizeReturnPath(path) ?? "/chronos", getAppBaseUrl());
  redirect.searchParams.set("chronosGoogle", status);

  return redirect.toString();
}

function getAppBaseUrl() {
  return ensureUrl(
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      process.env.NEXT_PUBLIC_CARELI_APP_URL?.trim() ||
      process.env.VERCEL_URL?.trim() ||
      "http://localhost:3001",
  );
}

function ensureUrl(value: string) {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  return `https://${value}`;
}

function sanitizeReturnPath(value?: string | null) {
  if (!value) {
    return null;
  }

  if (!value.startsWith("/") || value.startsWith("//")) {
    return null;
  }

  return value.slice(0, 240);
}

function splitScopes(scope?: string) {
  const scopes = scope
    ?.split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return scopes?.length ? scopes : null;
}

function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} ausente.`);
  }

  return value;
}

function readEnvPresence(name: string) {
  return Boolean(process.env[name]?.trim());
}

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function toBase64Url(value: Buffer) {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isGoogleCalendarStorageMissingError(error: unknown) {
  const maybeError = error as { code?: unknown; message?: unknown };
  const message = typeof maybeError.message === "string" ? maybeError.message : "";

  return (
    maybeError.code === "42P01" ||
    maybeError.code === "PGRST205" ||
    (message.includes("chronos_google_calendar") &&
      (message.includes("does not exist") || message.includes("schema cache")))
  );
}

function extractGoogleCalendarError(payload: unknown) {
  const record = readRecord(payload);
  const directError = record.error;
  const directMessage = record.message;

  if (typeof directError === "string" && directError.trim()) {
    return directError.trim();
  }

  if (typeof directMessage === "string" && directMessage.trim()) {
    return directMessage.trim();
  }

  const error = readRecord(record.error);
  const message = error.message;

  return typeof message === "string" && message.trim() ? message : null;
}

function parseGoogleCalendarResponse(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function normalizeGoogleOAuthErrorMessage(payload: GoogleTokenResponse | null) {
  const rawMessage = payload?.error_description || payload?.error;
  const message = rawMessage?.trim();

  if (!message) {
    return null;
  }

  if (
    payload?.error === "invalid_client" ||
    message.toLowerCase().includes("oauth client was not found")
  ) {
    return "Google Agenda: OAuth Client invalido. Revise GOOGLE_CALENDAR_CLIENT_ID/GOOGLE_CALENDAR_CLIENT_SECRET e reconecte a agenda do colaborador.";
  }

  return message;
}

function sanitizeGoogleCalendarError(error: unknown) {
  const record = readRecord(error);
  const message =
    error instanceof Error
      ? error.message
      : typeof record.message === "string" && record.message.trim()
        ? record.message
        : typeof record.details === "string" && record.details.trim()
          ? record.details
          : "Falha Google Agenda.";
  const code = typeof record.code === "string" ? record.code : null;
  const safeMessage = code ? `${code}: ${message}` : message;

  return safeMessage
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[google-token]")
    .slice(0, 280);
}

function isExpiredGoogleCalendarSyncTokenError(error: unknown) {
  if (!(error instanceof GoogleCalendarApiError)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    error.status === 410 ||
    message.includes("sync token") ||
    message.includes("synctoken") ||
    message.includes("full sync")
  );
}
