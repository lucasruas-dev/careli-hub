import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const maxTranscriptTextLength = 80_000;
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);

loadEnvFile(readTextArg("--env-file"));

const wherebyBaseUrl = (
  process.env.WHEREBY_API_BASE_URL ||
  process.env.CHRONOS_WHEREBY_API_BASE_URL ||
  "https://api.whereby.dev/v1"
).replace(/\/+$/, "");
const wherebyApiKey =
  process.env.WHEREBY_API_KEY || process.env.CHRONOS_WHEREBY_API_KEY || "";
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
const execute = args.has("--execute");
const publicSync = args.has("--public-sync");
const publicBaseUrl = (
  readTextArg("--public-base-url") ||
  process.env.CHRONOS_PUBLIC_BASE_URL ||
  "https://c2x.app.br"
).replace(/\/+$/, "");
const limit = readNumericArg("--limit", 8);
const days = readNumericArg("--days", 14);
const now = new Date();
const sinceDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

if (args.has("--env-check")) {
  console.log(
    JSON.stringify(
      {
        hasNextPublicSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
        hasSupabaseSecretKey: Boolean(process.env.SUPABASE_SECRET_KEY),
        hasSupabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
        hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
        hasWherebyApiKey: Boolean(
          process.env.WHEREBY_API_KEY || process.env.CHRONOS_WHEREBY_API_KEY,
        ),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Supabase de producao nao esta disponivel no ambiente.");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

if (publicSync) {
  console.log(JSON.stringify(await syncRecentWherebyMeetingsThroughPublicEndpoint(), null, 2));
  process.exit(0);
}

if (args.has("--diagnose-meetings")) {
  console.log(JSON.stringify(await diagnoseRecentChronosMeetings(), null, 2));
  process.exit(0);
}

if (!wherebyApiKey) {
  throw new Error("Whereby nao esta disponivel no ambiente.");
}

const summary = {
  days,
  dryRun: !execute,
  linkedCandidates: 0,
  limit,
  meetingsByRoomName: 0,
  recordingsInserted: 0,
  recordingsSeen: 0,
  transcriptSegmentsInserted: 0,
  transcriptionJobsRequested: 0,
  transcriptionsReadySeen: 0,
  unlinkedRecordings: [],
  updatedMeetings: 0,
};

const rooms = await fetchChronosRooms();
const meetings = await fetchChronosWherebyMeetings();
const meetingsByRoomName = new Map();

for (const meeting of meetings) {
  const roomName = readWherebyRoomName(meeting);
  const room = rooms.get(meeting.room_id);

  if (!roomName || !room) {
    continue;
  }

  if (!meetingsByRoomName.has(roomName)) {
    meetingsByRoomName.set(roomName, []);
  }

  meetingsByRoomName.get(roomName).push({ meeting, room, roomName });
}

summary.meetingsByRoomName = meetingsByRoomName.size;

const recordings = (await listWherebyRecordings()).filter((recording) => {
  const start = parseDate(recording.startDate);
  return !start || start.getTime() >= sinceDate.getTime();
});
const transcriptions = await listWherebyTranscriptions();
const transcriptionsByRoomSessionId = new Map();
const transcriptionsByRoomName = new Map();

for (const transcription of transcriptions) {
  if (transcription.state?.toLowerCase() === "ready") {
    summary.transcriptionsReadySeen += 1;
  }

  if (transcription.roomSessionId) {
    if (!transcriptionsByRoomSessionId.has(transcription.roomSessionId)) {
      transcriptionsByRoomSessionId.set(transcription.roomSessionId, []);
    }
    transcriptionsByRoomSessionId
      .get(transcription.roomSessionId)
      .push(transcription);
  }

  if (transcription.roomName) {
    if (!transcriptionsByRoomName.has(transcription.roomName)) {
      transcriptionsByRoomName.set(transcription.roomName, []);
    }
    transcriptionsByRoomName.get(transcription.roomName).push(transcription);
  }
}

const candidates = [];

for (const recording of recordings) {
  summary.recordingsSeen += 1;
  const matches = meetingsByRoomName.get(recording.roomName) ?? [];

  if (matches.length === 0) {
    summary.unlinkedRecordings.push({
      recordingId: recording.recordingId,
      roomName: recording.roomName,
      startDate: recording.startDate,
    });
    continue;
  }

  const match =
    matches.find(({ meeting }) =>
      isRecordingInsideMeetingWindow(recording, meeting),
    ) ?? matches[0];

  candidates.push({ ...match, recording });
}

summary.linkedCandidates = candidates.length;

for (const candidate of candidates.slice(0, limit)) {
  const meetingSummary = await backfillRecording(candidate);

  summary.recordingsInserted += meetingSummary.recordingsInserted;
  summary.transcriptSegmentsInserted +=
    meetingSummary.transcriptSegmentsInserted;
  summary.transcriptionJobsRequested +=
    meetingSummary.transcriptionJobsRequested;
  summary.updatedMeetings += meetingSummary.updatedMeeting ? 1 : 0;
}

console.log(JSON.stringify(summary, null, 2));

async function syncRecentWherebyMeetingsThroughPublicEndpoint() {
  const rooms = await fetchChronosRooms();
  const meetings = await fetchChronosWherebyMeetings();
  const candidates = meetings
    .map((meeting) => ({
      meeting,
      room: meeting.room_id ? rooms.get(meeting.room_id) : null,
      roomName: readWherebyRoomName(meeting),
    }))
    .filter(
      (candidate) =>
        candidate.room?.slug &&
        candidate.roomName &&
        isRecentWherebyMeetingForPublicSync(candidate.meeting),
    )
    .slice(0, limit);
  const result = {
    days,
    endpoint: publicBaseUrl,
    errors: 0,
    limit,
    skipped: 0,
    synced: 0,
    totalCandidates: candidates.length,
    results: [],
  };

  for (const candidate of candidates) {
    const roomSlug = candidate.room.slug;
    const url = `${publicBaseUrl}/api/chronos/public/rooms/${encodeURIComponent(
      roomSlug,
    )}/whereby-sync`;
    const response = await fetch(url, {
      body: JSON.stringify({
        meetingId: candidate.meeting.id,
        participantId: "chronos-public-backfill",
      }),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const payload = await response.json().catch(() => null);
    const row = {
      meetingId: candidate.meeting.id,
      ok: Boolean(response.ok && payload?.ok),
      recordingCount:
        typeof payload?.recordingCount === "number" ? payload.recordingCount : null,
      roomName: payload?.roomName ?? candidate.roomName,
      roomSlug,
      status: response.status,
      syncSkipped: payload?.syncSkipped ?? null,
      transcriptSegmentCount:
        typeof payload?.transcriptSegmentCount === "number"
          ? payload.transcriptSegmentCount
          : null,
      transcriptionCount:
        typeof payload?.transcriptionCount === "number"
          ? payload.transcriptionCount
          : null,
      error: payload?.error ?? null,
    };

    result.results.push(row);

    if (!row.ok) {
      result.errors += 1;
    } else if (row.syncSkipped) {
      result.skipped += 1;
    } else {
      result.synced += 1;
    }

    await sleep(8_000);
  }

  return result;
}

async function diagnoseRecentChronosMeetings() {
  const rooms = await fetchChronosRooms();
  const { data, error } = await supabase
    .from("chronos_meetings")
    .select("id,room_id,status,starts_at,ends_at,updated_at,recording_status,transcription_status,metadata")
    .gte("updated_at", sinceDate.toISOString())
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    throw error;
  }

  const meetings = data ?? [];
  const providerCounts = {};
  const sample = meetings.slice(0, 20).map((meeting) => {
    const metadata = readRecord(meeting.metadata);
    const externalRoom = readRecord(metadata.externalRoom);
    const whereby = readRecord(externalRoom.whereby);
    const provider = readText(whereby, "provider") || readText(externalRoom, "provider") || "none";

    providerCounts[provider] = (providerCounts[provider] ?? 0) + 1;

    return {
      externalProvider: provider,
      hasWherebyRoomName: Boolean(readText(whereby, "roomName")),
      id: meeting.id,
      recordingStatus: meeting.recording_status,
      roomSlug: meeting.room_id ? rooms.get(meeting.room_id)?.slug ?? null : null,
      status: meeting.status,
      transcriptionStatus: meeting.transcription_status,
      updatedAt: meeting.updated_at,
    };
  });

  return {
    days,
    providerCounts,
    recentMeetings: meetings.length,
    rooms: rooms.size,
    sample,
    supabaseUrlHost: safeUrlHost(supabaseUrl),
  };
}

async function backfillRecording({ meeting, recording, roomName }) {
  const result = {
    recordingsInserted: 0,
    transcriptSegmentsInserted: 0,
    transcriptionJobsRequested: 0,
    updatedMeeting: false,
  };
  const existingRecordings = await fetchExistingRecordingIds(meeting.id);
  const existingSegments = await fetchExistingTranscriptionIds(meeting.id);
  const metadata = readRecord(meeting.metadata);
  const externalRoom = readRecord(metadata.externalRoom);
  const whereby = readRecord(externalRoom.whereby);

  if (!existingRecordings.has(recording.recordingId)) {
    if (execute) {
      await insertChronosRecording({ meeting, recording, roomName });
    }
    result.recordingsInserted += 1;
  }

  const matchingTranscriptions = findMatchingTranscriptions(recording, roomName);
  let insertedSegments = 0;

  for (const transcription of matchingTranscriptions.filter(
    (item) => item.state?.toLowerCase() === "ready",
  )) {
    if (existingSegments.has(transcription.transcriptionId)) {
      continue;
    }

    const rows = await buildTranscriptRows({
      meeting,
      roomName,
      transcription,
    });

    if (rows.length === 0) {
      continue;
    }

    if (execute) {
      const { error } = await supabase
        .from("chronos_transcript_segments")
        .insert(rows);

      if (error) {
        throw error;
      }
    }

    insertedSegments += rows.length;
  }

  result.transcriptSegmentsInserted += insertedSegments;

  const hasTranscriptionJob = matchingTranscriptions.length > 0;
  const requestedIds = new Set(
    Array.isArray(whereby.transcriptionJobRecordingIds)
      ? whereby.transcriptionJobRecordingIds.filter(
          (value) => typeof value === "string" && value.trim(),
        )
      : [],
  );

  if (!hasTranscriptionJob && !requestedIds.has(recording.recordingId)) {
    if (execute) {
      await requestWherebyTranscription(recording.recordingId);
    }
    requestedIds.add(recording.recordingId);
    result.transcriptionJobsRequested += 1;
  }

  const nextMetadata = {
    ...metadata,
    externalRoom: {
      ...externalRoom,
      provider: "whereby",
      whereby: {
        ...whereby,
        lastBackfillAt: now.toISOString(),
        lastSyncAttemptAt: now.toISOString(),
        lastSyncedAt: now.toISOString(),
        provider: "whereby",
        recordingCount: existingRecordings.has(recording.recordingId)
          ? existingRecordings.size
          : existingRecordings.size + 1,
        roomName,
        source: "chronos-whereby-backfill",
        transcriptSegmentCount:
          existingSegments.size + result.transcriptSegmentsInserted,
        transcriptionJobRecordingIds: [...requestedIds],
        transcriptionCount: matchingTranscriptions.length,
      },
    },
  };
  const nextRecordingStatus = "available";
  const nextTranscriptionStatus =
    result.transcriptSegmentsInserted > 0 || existingSegments.size > 0
      ? "available"
      : meeting.transcription_status === "available"
        ? "available"
        : "processing";

  if (execute) {
    const { error } = await supabase
      .from("chronos_meetings")
      .update({
        metadata: nextMetadata,
        recording_status: nextRecordingStatus,
        transcription_status: nextTranscriptionStatus,
        updated_at: now.toISOString(),
      })
      .eq("id", meeting.id);

    if (error) {
      throw error;
    }
  }

  result.updatedMeeting = true;

  return result;
}

async function fetchChronosRooms() {
  const { data, error } = await supabase
    .from("chronos_rooms")
    .select("id,slug,name,status,recording_required,transcription_required");

  if (error) {
    throw error;
  }

  return new Map((data ?? []).map((room) => [room.id, room]));
}

async function fetchChronosWherebyMeetings() {
  const { data, error } = await supabase
    .from("chronos_meetings")
    .select(
      "id,room_id,title,starts_at,ends_at,updated_at,recording_status,transcription_status,metadata",
    )
    .gte("updated_at", new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error) {
    throw error;
  }

  return (data ?? []).filter((meeting) => {
    const metadata = readRecord(meeting.metadata);
    const externalRoom = readRecord(metadata.externalRoom);
    const whereby = readRecord(externalRoom.whereby);
    const provider = whereby.provider ?? externalRoom.provider;

    return provider === "whereby" && typeof whereby.roomName === "string";
  });
}

async function fetchExistingRecordingIds(meetingId) {
  const { data, error } = await supabase
    .from("chronos_recordings")
    .select("metadata")
    .eq("meeting_id", meetingId);

  if (error) {
    throw error;
  }

  return new Set(
    (data ?? [])
      .map((recording) =>
        readText(readRecord(readRecord(recording.metadata).whereby), "recordingId"),
      )
      .filter(Boolean),
  );
}

async function fetchExistingTranscriptionIds(meetingId) {
  const { data, error } = await supabase
    .from("chronos_transcript_segments")
    .select("metadata")
    .eq("meeting_id", meetingId)
    .eq("source", "whereby");

  if (error) {
    throw error;
  }

  return new Set(
    (data ?? [])
      .map((segment) =>
        readText(readRecord(readRecord(segment.metadata).whereby), "transcriptionId"),
      )
      .filter(Boolean),
  );
}

async function insertChronosRecording({ meeting, recording, roomName }) {
  const { error } = await supabase.from("chronos_recordings").insert({
    duration_seconds: estimateDurationSeconds(recording),
    file_name: recording.filename || `whereby-${recording.recordingId}.mp4`,
    meeting_id: meeting.id,
    metadata: {
      provider: "whereby",
      roomName,
      roomSessionId: recording.roomSessionId ?? null,
      source: "chronos-whereby-backfill",
      whereby: {
        recordingId: recording.recordingId,
        roomName,
        roomSessionId: recording.roomSessionId ?? null,
      },
    },
    mime_type: inferMimeType(recording.filename ?? "mp4"),
    size_bytes:
      typeof recording.sizeInMegaBytes === "number"
        ? Math.round(recording.sizeInMegaBytes * 1024 * 1024)
        : null,
    started_at: recording.startDate ?? meeting.starts_at,
    status: "available",
    stopped_at: recording.endDate ?? meeting.ends_at,
    storage_bucket: "whereby",
    storage_path: `whereby://recordings/${recording.recordingId}`,
    uploaded_at: now.toISOString(),
  });

  if (error) {
    throw error;
  }
}

function findMatchingTranscriptions(recording, roomName) {
  const bySession = recording.roomSessionId
    ? (transcriptionsByRoomSessionId.get(recording.roomSessionId) ?? [])
    : [];

  if (bySession.length > 0) {
    return bySession;
  }

  return transcriptionsByRoomName.get(roomName) ?? [];
}

async function buildTranscriptRows({ meeting, roomName, transcription }) {
  const accessLink = await getWherebyTranscriptionAccessLink(
    transcription.transcriptionId,
  );
  const response = await fetch(accessLink, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(
      `Whereby transcript download falhou com status ${response.status}.`,
    );
  }

  const content = await response.text();
  const parsedSegments = parseTranscriptContent(content);
  const fallbackStartedAt = transcription.startDate ?? meeting.starts_at ?? null;
  const fallbackEndedAt = transcription.endDate ?? meeting.ends_at ?? null;

  return parsedSegments
    .map((segment, index) => ({
      content: sanitizeText(segment.content, maxTranscriptTextLength),
      ended_at: segment.endedAt ?? fallbackEndedAt,
      meeting_id: meeting.id,
      metadata: {
        provider: "whereby",
        roomName,
        source: "chronos-whereby-backfill",
        whereby: {
          filename: transcription.filename ?? null,
          index,
          roomName,
          roomSessionId: transcription.roomSessionId ?? null,
          transcriptionId: transcription.transcriptionId,
          type: transcription.type ?? null,
        },
      },
      source: "whereby",
      speaker_label:
        sanitizeOptionalText(segment.speakerLabel, 80) ?? "Speaker 00",
      started_at: segment.startedAt ?? fallbackStartedAt,
    }))
    .filter((row) => Boolean(row.content));
}

async function listWherebyRecordings() {
  const payload = await callWherebyApi("/recordings?sortBy=startDate:desc&limit=100");

  return readList(payload)
    .map(normalizeRecording)
    .filter((recording) => recording && recording.recordingId);
}

async function listWherebyTranscriptions() {
  const payload = await callWherebyApi(
    "/transcriptions?sortBy=startDate:desc&limit=100",
  );

  return readList(payload)
    .map(normalizeTranscription)
    .filter((transcription) => transcription && transcription.transcriptionId);
}

async function getWherebyTranscriptionAccessLink(transcriptionId) {
  const payload = await callWherebyApi(
    `/transcriptions/${encodeURIComponent(transcriptionId)}/access-link`,
  );
  const accessLink = readText(readRecord(payload), "accessLink");

  if (!accessLink) {
    throw new Error("Whereby nao retornou accessLink de transcricao.");
  }

  return accessLink;
}

async function requestWherebyTranscription(recordingId) {
  await callWherebyApi("/transcriptions", {
    body: { recordingId },
    method: "POST",
  });
}

async function callWherebyApi(path, options = {}) {
  const headers = {
    Authorization: `Bearer ${wherebyApiKey}`,
  };
  const requestInit = {
    cache: "no-store",
    headers,
    method: options.method ?? "GET",
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestInit.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${wherebyBaseUrl}${path}`, requestInit);
  const text = await response.text();
  const payload = text ? parseJson(text) : null;

  if (!response.ok) {
    const message =
      readText(readRecord(payload), "message") ||
      readText(readRecord(payload), "error") ||
      `Whereby falhou com status ${response.status}.`;

    throw new Error(message);
  }

  return payload;
}

function normalizeRecording(value) {
  const payload = readRecord(value);
  const recordingId = readText(payload, "recordingId") || readText(payload, "id");

  if (!recordingId) {
    return null;
  }

  return {
    endDate: readText(payload, "endDate"),
    filename: readText(payload, "filename"),
    recordingId,
    roomName: readText(payload, "roomName"),
    roomSessionId: readText(payload, "roomSessionId"),
    sizeInMegaBytes: readNumber(payload, "sizeInMegaBytes"),
    startDate: readText(payload, "startDate"),
  };
}

function normalizeTranscription(value) {
  const payload = readRecord(value);
  const transcriptionId =
    readText(payload, "transcriptionId") || readText(payload, "id");

  if (!transcriptionId) {
    return null;
  }

  return {
    createdAt: readText(payload, "createdAt"),
    durationInSeconds: readNumber(payload, "durationInSeconds"),
    endDate: readText(payload, "endDate"),
    filename: readText(payload, "filename"),
    roomName: readText(payload, "roomName"),
    roomSessionId: readText(payload, "roomSessionId"),
    startDate: readText(payload, "startDate"),
    state: readText(payload, "state"),
    storageType: readText(payload, "storageType"),
    transcriptionId,
    type: readText(payload, "type"),
  };
}

function readWherebyRoomName(meeting) {
  const metadata = readRecord(meeting.metadata);
  const externalRoom = readRecord(metadata.externalRoom);
  const whereby = readRecord(externalRoom.whereby);

  return readText(whereby, "roomName");
}

function isRecordingInsideMeetingWindow(recording, meeting) {
  const recordingStart = parseDate(recording.startDate);
  const startsAt = parseDate(meeting.starts_at);
  const endsAt = parseDate(meeting.ends_at);

  if (!recordingStart || !startsAt || !endsAt) {
    return false;
  }

  const marginMs = 2 * 60 * 60 * 1000;

  return (
    recordingStart.getTime() >= startsAt.getTime() - marginMs &&
    recordingStart.getTime() <= endsAt.getTime() + marginMs
  );
}

function isRecentWherebyMeetingForPublicSync(meeting) {
  const metadata = readRecord(meeting.metadata);
  const externalRoom = readRecord(metadata.externalRoom);
  const whereby = readRecord(externalRoom.whereby);
  const reference =
    parseDate(readText(whereby, "endDate")) ||
    parseDate(meeting.ends_at) ||
    parseDate(meeting.updated_at);

  if (!reference) {
    return true;
  }

  return now.getTime() - reference.getTime() <= 72 * 60 * 60 * 1000;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function safeUrlHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function estimateDurationSeconds(recording) {
  const startedAt = parseDate(recording.startDate);
  const endedAt = parseDate(recording.endDate);

  if (!startedAt || !endedAt) {
    return null;
  }

  return Math.max(
    0,
    Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
  );
}

function inferMimeType(fileName) {
  const normalized = fileName.toLowerCase();

  if (normalized.endsWith(".webm")) {
    return "video/webm";
  }

  if (normalized.endsWith(".ogg")) {
    return "audio/ogg";
  }

  return "video/mp4";
}

function parseTranscriptContent(content) {
  const text = content.trim();

  if (!text) {
    return [];
  }

  const jsonSegments = parseJsonTranscript(text);

  if (jsonSegments.length > 0) {
    return jsonSegments;
  }

  return parseTextTranscript(text);
}

function parseJsonTranscript(content) {
  try {
    const payload = JSON.parse(content);
    const payloadRecord = readRecord(payload);
    const sourceSegments = Array.isArray(payload)
      ? payload
      : Array.isArray(payloadRecord.segments)
        ? payloadRecord.segments
        : Array.isArray(payloadRecord.transcript)
          ? payloadRecord.transcript
          : [];

    return sourceSegments
      .map((segment, index) => {
        const payloadSegment = readRecord(segment);
        const contentText =
          readText(payloadSegment, "text") ||
          readText(payloadSegment, "content") ||
          readText(payloadSegment, "transcript") ||
          "";

        if (!contentText) {
          return null;
        }

        return {
          content: contentText,
          endedAt: readText(payloadSegment, "end") || readText(payloadSegment, "endedAt"),
          speakerLabel:
            readText(payloadSegment, "speaker") ||
            readText(payloadSegment, "speakerLabel") ||
            `Speaker ${index.toString().padStart(2, "0")}`,
          startedAt:
            readText(payloadSegment, "start") ||
            readText(payloadSegment, "startedAt"),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseTextTranscript(content) {
  const lines = content
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== "WEBVTT")
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => !line.includes("-->"));
  const segments = [];
  let currentSpeaker = "Speaker 00";
  let currentContent = [];
  const flush = () => {
    const joined = currentContent.join(" ").trim();

    if (!joined) {
      currentContent = [];
      return;
    }

    splitTranscriptContent(joined).forEach((chunk) => {
      segments.push({
        content: chunk,
        endedAt: null,
        speakerLabel: currentSpeaker,
        startedAt: null,
      });
    });
    currentContent = [];
  };

  for (const line of lines) {
    const speakerMatch = /^([^:]{1,80}):\s*(.+)$/.exec(line);

    if (speakerMatch) {
      flush();
      currentSpeaker = speakerMatch[1]?.trim() || currentSpeaker;
      currentContent.push(speakerMatch[2] ?? "");
      continue;
    }

    currentContent.push(line);
  }

  flush();

  if (segments.length > 0) {
    return segments;
  }

  return splitTranscriptContent(content).map((chunk, index) => ({
    content: chunk,
    endedAt: null,
    speakerLabel: `Speaker ${index.toString().padStart(2, "0")}`,
    startedAt: null,
  }));
}

function splitTranscriptContent(content) {
  const normalized = content.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return [];
  }

  const chunks = [];
  let remaining = normalized;

  while (remaining.length > maxTranscriptTextLength) {
    const splitIndex = Math.max(
      remaining.lastIndexOf(". ", maxTranscriptTextLength),
      remaining.lastIndexOf(" ", maxTranscriptTextLength),
    );
    const nextIndex =
      splitIndex > 200
        ? splitIndex + (remaining[splitIndex] === "." ? 1 : 0)
        : maxTranscriptTextLength;

    chunks.push(remaining.slice(0, nextIndex).trim());
    remaining = remaining.slice(nextIndex).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function sanitizeText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function sanitizeOptionalText(value, maxLength) {
  const normalized = sanitizeText(value, maxLength);

  return normalized || null;
}

function readRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function readList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = readRecord(payload);
  const results =
    record.results ??
    record.data ??
    record.items ??
    record.recordings ??
    record.transcriptions;

  return Array.isArray(results) ? results : [];
}

function readText(record, key) {
  const value = record[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(record, key) {
  const value = record[key];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();

  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readNumericArg(name, fallback) {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return fallback;
  }

  const value = Number(process.argv[index + 1]);

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readTextArg(name) {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return null;
  }

  const value = process.argv[index + 1];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function loadEnvFile(filePath) {
  if (!filePath) {
    return;
  }

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}
