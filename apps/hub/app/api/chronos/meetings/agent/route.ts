import { type NextRequest } from "next/server";

import {
  completeWithClaudeStructured,
  resolveClaudeModel,
} from "@/lib/ai/claude";
import {
  authorizeChronosRequest,
  isChronosForbiddenError,
  isChronosSchemaMissingError,
  listChronosSnapshot,
  syncChronosWherebyArtifactsForMeeting,
  updateChronosMeeting,
} from "@/lib/chronos/server";
import {
  chronosMeetingTypeLabels,
  chronosMinutesProfileLabels,
  chronosMinutesProfiles,
  type ChronosMeeting,
  type ChronosMinutesProfile,
  type ChronosTranscriptSegment,
} from "@/lib/chronos/types";
import {
  buildChronosMinutesContext,
  formatChronosDate,
  formatChronosDateTime,
  formatChronosDuration,
} from "@/lib/chronos/minutes";
import { normalizeChronosMeetingRuntime } from "@/lib/chronos/runtime-meeting";

const DEFAULT_MINUTES_MODEL = "gpt-5.5";
const DEFAULT_MINUTES_REASONING_EFFORT = "medium";
const DEFAULT_AGENDA_MODEL = "gpt-5.5";
const DEFAULT_AGENDA_REASONING_EFFORT = "medium";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-transcribe-diarize";
const CHRONOS_TRANSCRIPTION_MODELS = [
  "gpt-4o-transcribe-diarize",
  "gpt-4o-mini-transcribe",
  "gpt-4o-transcribe",
  "whisper-1",
] as const;
const OPENAI_TIMEOUT_MS = 240_000;
const MAX_RECORDING_BYTES = 25_000_000;
const CHRONOS_FULL_RECORDING_SPEAKER_LABEL = "Audio completo da reuniao";
const CHRONOS_PARTICIPANT_AUDIO_SOURCE =
  "chronos-livekit-egress-participant-audio";
const CHRONOS_MINUTES_RESPONSE_FORMAT = {
  name: "chronos_minutes_draft",
  schema: {
    additionalProperties: false,
    properties: {
      minutes: {
        description:
          "Ata executiva em Markdown simples, pronta para revisao humana.",
        type: "string",
      },
      summary: {
        description:
          "Resumo executivo curto da ata gerada, sem citar fallback local.",
        type: "string",
      },
    },
    required: ["summary", "minutes"],
    type: "object",
  },
  strict: true,
  type: "json_schema",
} as const;
const CHRONOS_AGENDA_RESPONSE_FORMAT = {
  name: "chronos_agenda_draft",
  schema: {
    additionalProperties: false,
    properties: {
      agendaMarkdown: {
        description:
          "Pauta executiva completa em Markdown simples, pronta para preencher o campo de pauta.",
        type: "string",
      },
      bulletPoints: {
        description:
          "Principais topicos executivos para revisao humana antes de salvar.",
        items: {
          type: "string",
        },
        type: "array",
      },
      title: {
        description: "Titulo executivo curto da pauta.",
        type: "string",
      },
    },
    required: ["title", "bulletPoints", "agendaMarkdown"],
    type: "object",
  },
  strict: true,
  type: "json_schema",
} as const;
const CHRONOS_JSON_OBJECT_RESPONSE_FORMAT = {
  type: "json_object",
} as const;

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

type ChronosAgentAction =
  | "draft_minutes"
  | "generate_agenda"
  | "transcribe_existing_recording"
  | "transcribe_recording";

type ChronosAgendaGenerationContext = {
  agendaBrief?: string;
  currentAgenda: string[];
  endsAt?: string;
  objective?: string;
  participants: Array<{
    displayName: string;
    email?: string;
    organization?: string;
  }>;
  startsAt?: string;
  title?: string;
};

type ChronosAgendaDraft = {
  agendaMarkdown: string;
  bulletPoints: string[];
  title: string;
};

type ParsedChronosAgentRequest =
  | {
      action: "draft_minutes";
      meetingId: string;
      minutesProfile: ChronosMinutesProfile;
      ok: true;
    }
  | {
      action: "generate_agenda";
      context: ChronosAgendaGenerationContext;
      meetingId?: string;
      ok: true;
    }
  | {
      action: "transcribe_existing_recording";
      meetingId: string;
      minutesProfile: ChronosMinutesProfile;
      ok: true;
      recordingId: string;
      speakerLabel?: string;
    }
  | {
      action: "transcribe_recording";
      file: File;
      meetingId: string;
      minutesProfile: ChronosMinutesProfile;
      ok: true;
      speakerLabel?: string;
    }
  | {
      error: string;
      ok: false;
    };

type OpenAiResponsePayload = Record<string, unknown> | null;
type OpenAiTranscriptionPayload = {
  error?: { message?: unknown };
  segments?: unknown;
  text?: unknown;
};

type ChronosTranscribedSegment = {
  content: string;
  speakerLabel?: string;
};

type ChronosTranscriptionResult = {
  segments: ChronosTranscribedSegment[];
  text: string;
};

class ChronosOpenAiGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChronosOpenAiGenerationError";
  }
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeChronosRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const parsed = await parseChronosAgentRequest(request);

    if (!parsed.ok) {
      return Response.json({ error: parsed.error }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      return Response.json(
        {
          error:
            "OpenAI nao configurada para o agente Chronos. Configure OPENAI_API_KEY no ambiente server-side.",
        },
        { status: 503 },
      );
    }

    if (parsed.action === "transcribe_existing_recording") {
      const snapshot = await listChronosSnapshot(authorization);
      const rawMeeting = snapshot.meetings.find(
        (currentMeeting) => currentMeeting.id === parsed.meetingId,
      );

      if (!rawMeeting) {
        return Response.json(
          { error: "Reuniao Chronos nao encontrada." },
          { status: 404 },
        );
      }

      const meeting = normalizeChronosMeetingRuntime(rawMeeting);
      const recording = meeting.recordings.find(
        (currentRecording) => currentRecording.id === parsed.recordingId,
      );

      if (!recording || recording.status !== "available") {
        return Response.json(
          {
            error:
              "Gravacao Chronos ainda nao esta disponivel para transcricao.",
          },
          { status: 409 },
        );
      }

      const meetingWithSyncedTranscript =
        await syncChronosWherebyTranscriptForMinutes({
          authorization,
          meeting,
          meetingId: parsed.meetingId,
        });

      if (hasChronosTranscriptForMinutes(meetingWithSyncedTranscript)) {
        const { draft, meeting: updatedMeeting } =
          await saveChronosMinutesDraft({
            apiKey,
            authorization,
            meeting: meetingWithSyncedTranscript,
            meetingId: parsed.meetingId,
            minutesProfile: parsed.minutesProfile,
          });

        return Response.json(
          {
            meeting: updatedMeeting,
            minutes: draft.minutes,
            minutesProfile: parsed.minutesProfile,
            source: hasChronosWherebyTranscript(meetingWithSyncedTranscript)
              ? "whereby"
              : "openai",
            summary: draft.summary,
            transcript: buildChronosTranscriptTextForResponse(
              meetingWithSyncedTranscript,
            ),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      if (isChronosWherebyRecording(recording)) {
        return Response.json(
          {
            error:
              "A transcricao Whereby desta gravacao ainda esta em processamento. Atualize o Drive em alguns minutos e tente gerar a ata novamente.",
          },
          { status: 409 },
        );
      }

      const recordingUrl = recording.downloadUrl ?? recording.playbackUrl;

      if (!recordingUrl || recordingUrl === "#") {
        return Response.json(
          {
            error:
              "Gravacao Chronos nao possui arquivo assinado para transcricao.",
          },
          { status: 409 },
        );
      }

      void recordingUrl;
      const transcription = await transcribeChronosRecordingCollection({
        apiKey,
        authorization,
        meetingId: parsed.meetingId,
        preferredRecording: recording,
        preferredSpeakerLabel: parsed.speakerLabel,
        sourceMeeting: meeting,
      });
      const { draft, meeting: updatedMeeting } = await saveChronosMinutesDraft({
        apiKey,
        authorization,
        meeting: transcription.meeting,
        meetingId: parsed.meetingId,
        minutesProfile: parsed.minutesProfile,
      });

      return Response.json(
        {
          meeting: updatedMeeting,
          minutes: draft.minutes,
          minutesProfile: parsed.minutesProfile,
          source: "openai",
          summary: draft.summary,
          transcript: transcription.text,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (parsed.action === "generate_agenda") {
      const snapshot = parsed.meetingId
        ? await listChronosSnapshot(authorization)
        : null;
      const rawMeeting = parsed.meetingId
        ? snapshot?.meetings.find(
            (currentMeeting) => currentMeeting.id === parsed.meetingId,
          )
        : null;
      const meeting = rawMeeting
        ? normalizeChronosMeetingRuntime(rawMeeting)
        : null;

      if (parsed.meetingId && !meeting) {
        return Response.json(
          { error: "Reuniao Chronos nao encontrada." },
          { status: 404 },
        );
      }

      const agenda = await draftChronosAgenda({
        apiKey,
        context: parsed.context,
        meeting: meeting ?? undefined,
      });

      return Response.json(
        {
          agenda: agenda.bulletPoints,
          agendaMarkdown: agenda.agendaMarkdown,
          bulletPoints: agenda.bulletPoints,
          source: "openai",
          title: agenda.title,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (parsed.action === "transcribe_recording") {
      const transcription = await transcribeChronosRecording({
        apiKey,
        file: parsed.file,
      });
      const transcribedMeeting = await saveChronosTranscriptionResult({
        authorization,
        meetingId: parsed.meetingId,
        speakerLabel:
          parsed.speakerLabel ?? CHRONOS_FULL_RECORDING_SPEAKER_LABEL,
        transcription,
      });
      const { draft, meeting } = await saveChronosMinutesDraft({
        apiKey,
        authorization,
        meeting: transcribedMeeting,
        meetingId: parsed.meetingId,
        minutesProfile: parsed.minutesProfile,
      });

      return Response.json(
        {
          meeting,
          minutes: draft.minutes,
          minutesProfile: parsed.minutesProfile,
          source: "openai",
          summary: draft.summary,
          transcript: transcription.text,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const snapshot = await listChronosSnapshot(authorization);
    const rawMeeting = snapshot.meetings.find(
      (currentMeeting) => currentMeeting.id === parsed.meetingId,
    );

    if (!rawMeeting) {
      return Response.json(
        { error: "Reuniao Chronos nao encontrada." },
        { status: 404 },
      );
    }

    const meeting = await ensureChronosOfficialTranscriptForMinutes({
      apiKey,
      authorization,
      meeting: normalizeChronosMeetingRuntime(rawMeeting),
      meetingId: parsed.meetingId,
    });

    if (!hasChronosTranscriptForMinutes(meeting)) {
      return Response.json(
        {
          error:
            "Ata Chronos requer transcricao salva com conteudo. Transcreva a gravacao antes de gerar a ata.",
        },
        { status: 409 },
      );
    }

    const { draft, meeting: updatedMeeting } = await saveChronosMinutesDraft({
      apiKey,
      authorization,
      meeting,
      meetingId: parsed.meetingId,
      minutesProfile: parsed.minutesProfile,
    });

    return Response.json(
      {
        meeting: updatedMeeting,
        minutes: draft.minutes,
        minutesProfile: parsed.minutesProfile,
        source: "openai",
        summary: draft.summary,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error: getChronosAgentErrorMessage(
          error,
          "Nao foi possivel executar o agente Chronos.",
        ),
      },
      { status: getChronosAgentErrorStatus(error) },
    );
  }
}

async function saveChronosMinutesDraft({
  apiKey,
  authorization,
  meeting,
  meetingId,
  minutesProfile,
}: {
  apiKey: string;
  authorization: Parameters<typeof updateChronosMeeting>[0]["authorization"];
  meeting: ChronosMeeting;
  meetingId: string;
  minutesProfile: ChronosMinutesProfile;
}) {
  const normalizedMeeting = normalizeChronosMeetingRuntime(meeting);

  assertChronosTranscriptForMinutes(normalizedMeeting);

  const draft = await draftChronosMinutes({
    apiKey,
    meeting: normalizedMeeting,
    minutesProfile,
  });

  await updateChronosMeeting({
    authorization,
    input: {
      action: "save_summary",
      meetingId,
      summary: draft.summary,
    },
  });
  const updatedMeeting = await updateChronosMeeting({
    authorization,
    input: {
      action: "save_minutes",
      content: draft.minutes,
      meetingId,
      status: "draft",
    },
  });

  return { draft, meeting: updatedMeeting };
}

async function ensureChronosOfficialTranscriptForMinutes({
  apiKey,
  authorization,
  meeting,
  meetingId,
}: {
  apiKey: string;
  authorization: Parameters<typeof updateChronosMeeting>[0]["authorization"];
  meeting: ChronosMeeting;
  meetingId: string;
}) {
  const normalizedMeeting = normalizeChronosMeetingRuntime(meeting);

  if (hasChronosOfficialTranscript(normalizedMeeting)) {
    return normalizedMeeting;
  }

  const meetingWithSyncedTranscript =
    await syncChronosWherebyTranscriptForMinutes({
      authorization,
      meeting: normalizedMeeting,
      meetingId,
    });

  if (hasChronosOfficialTranscript(meetingWithSyncedTranscript)) {
    return meetingWithSyncedTranscript;
  }

  const recording = selectChronosTranscribableRecording(normalizedMeeting);

  if (!recording) {
    return meetingWithSyncedTranscript;
  }

  if (isChronosWherebyRecording(recording) && !isChronosAudioRecording(recording)) {
    return meetingWithSyncedTranscript;
  }

  const transcription = await transcribeChronosRecordingCollection({
    apiKey,
    authorization,
    meetingId,
    preferredRecording: recording,
    sourceMeeting: meetingWithSyncedTranscript,
  });

  return transcription.meeting;
}

async function syncChronosWherebyTranscriptForMinutes({
  authorization,
  meeting,
  meetingId,
}: {
  authorization: Parameters<typeof updateChronosMeeting>[0]["authorization"];
  meeting: ChronosMeeting;
  meetingId: string;
}) {
  const normalizedMeeting = normalizeChronosMeetingRuntime(meeting);

  if (
    hasChronosOfficialTranscript(normalizedMeeting) ||
    !normalizedMeeting.recordings.some(isChronosWherebyRecording)
  ) {
    return normalizedMeeting;
  }

  try {
    await syncChronosWherebyArtifactsForMeeting({
      authorization,
      force: true,
      meetingId,
    });
  } catch (error) {
    console.warn(
      "[chronos/agent] Whereby transcript sync before minutes failed",
      error instanceof Error ? error.message : "unknown error",
    );

    return normalizedMeeting;
  }

  // Antes carregava o snapshot INTEIRO (todas as reunioes + dados + URLs assinadas)
  // so para reler esta reuniao -> consumia tempo precioso antes da IA (causa do 502).
  // A transcricao recem-sincronizada e lida direto por reuniao logo abaixo.
  const syncedMeeting = normalizedMeeting;

  const directTranscript = await loadChronosTranscriptSegmentsForMeeting({
    authorization,
    meetingId,
  });

  if (directTranscript.length === 0) {
    return syncedMeeting;
  }

  return normalizeChronosMeetingRuntime({
    ...syncedMeeting,
    transcript: mergeChronosTranscriptSegments([
      ...syncedMeeting.transcript,
      ...directTranscript,
    ]),
  });
}

async function loadChronosTranscriptSegmentsForMeeting({
  authorization,
  meetingId,
}: {
  authorization: Parameters<typeof updateChronosMeeting>[0]["authorization"];
  meetingId: string;
}) {
  if (!authorization.client) {
    return [];
  }

  const result = await authorization.client
    .from("chronos_transcript_segments")
    .select("content,created_at,ended_at,id,source,speaker_label,started_at")
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: true });

  if (result.error) {
    console.warn(
      "[chronos/agent] Direct transcript reload failed",
      result.error.message,
    );

    return [];
  }

  return (result.data ?? []).map((segment) => ({
    content: segment.content,
    createdAt: segment.created_at,
    endedAt: segment.ended_at,
    id: segment.id,
    source: segment.source,
    speakerLabel: segment.speaker_label,
    startedAt: segment.started_at,
  })) satisfies ChronosTranscriptSegment[];
}

function mergeChronosTranscriptSegments(
  segments: ChronosTranscriptSegment[],
) {
  return Array.from(
    segments
      .reduce((segmentById, segment) => {
        segmentById.set(segment.id, segment);

        return segmentById;
      }, new Map<string, ChronosTranscriptSegment>())
      .values(),
  ).sort((firstSegment, secondSegment) =>
    firstSegment.createdAt.localeCompare(secondSegment.createdAt),
  );
}

async function saveChronosTranscriptionResult({
  authorization,
  forceSpeakerLabel = false,
  meetingId,
  speakerLabel,
  transcription,
}: {
  authorization: Parameters<typeof updateChronosMeeting>[0]["authorization"];
  forceSpeakerLabel?: boolean;
  meetingId: string;
  speakerLabel: string;
  transcription: ChronosTranscriptionResult;
}) {
  const segments =
    transcription.segments.length > 0
      ? transcription.segments
      : [
          {
            content: transcription.text,
            speakerLabel,
          },
        ];

  return updateChronosMeeting({
    authorization,
    input: {
      action: "add_transcript_segments",
      meetingId,
      segments: segments.map((segment) => ({
        content: segment.content,
        source: "openai",
        speakerLabel: forceSpeakerLabel
          ? speakerLabel
          : segment.speakerLabel || speakerLabel,
      })),
    },
  });
}

async function transcribeChronosRecordingCollection({
  apiKey,
  authorization,
  meetingId,
  preferredRecording,
  preferredSpeakerLabel,
  sourceMeeting,
}: {
  apiKey: string;
  authorization: Parameters<typeof updateChronosMeeting>[0]["authorization"];
  meetingId: string;
  preferredRecording: ChronosMeeting["recordings"][number];
  preferredSpeakerLabel?: string;
  sourceMeeting: ChronosMeeting;
}) {
  const participantAudioRecordings =
    selectChronosParticipantAudioRecordings(sourceMeeting);
  const shouldUseParticipantAudio = participantAudioRecordings.length > 0;
  const preferredTranscriptionRecording = isChronosAudioRecording(
    preferredRecording,
  )
    ? preferredRecording
    : (selectChronosTranscribableRecording(sourceMeeting) ?? preferredRecording);
  const recordingCollection = shouldUseParticipantAudio
    ? participantAudioRecordings
    : [preferredTranscriptionRecording];

  try {
    return await transcribeChronosRecordingList({
      apiKey,
      authorization,
      meetingId,
      recordings: recordingCollection,
      speakerLabel: preferredSpeakerLabel,
    });
  } catch (error) {
    if (!shouldUseParticipantAudio) {
      throw error;
    }

    console.warn(
      "[chronos/agent] Participant audio transcription failed, falling back to mixed recording",
      error instanceof Error ? error.message : "unknown error",
    );

    const fallbackRecording = selectChronosTranscribableRecording(
      sourceMeeting,
      {
        excludeParticipantAudio: true,
      },
    );

    if (!fallbackRecording) {
      throw error;
    }

    return transcribeChronosRecordingList({
      apiKey,
      authorization,
      meetingId,
      recordings: [fallbackRecording],
      speakerLabel: preferredSpeakerLabel,
    });
  }
}

async function transcribeChronosRecordingList({
  apiKey,
  authorization,
  meetingId,
  recordings,
  speakerLabel,
}: {
  apiKey: string;
  authorization: Parameters<typeof updateChronosMeeting>[0]["authorization"];
  meetingId: string;
  recordings: Array<ChronosMeeting["recordings"][number]>;
  speakerLabel?: string;
}) {
  let currentMeeting: ChronosMeeting | null = null;
  const failedRecordings: string[] = [];
  const transcriptTexts: string[] = [];

  for (const recording of recordings) {
    const recordingUrl = recording.downloadUrl ?? recording.playbackUrl;

    if (!recordingUrl || recordingUrl === "#") {
      continue;
    }

    const label =
      speakerLabel ??
      getChronosRecordingSpeakerLabel(recording) ??
      CHRONOS_FULL_RECORDING_SPEAKER_LABEL;
    try {
      const file = await fetchChronosRecordingFile({
        fileName:
          recording.fileName ??
          recording.storagePath?.split("/").filter(Boolean).at(-1) ??
          "chronos-recording.webm",
        mimeType: recording.mimeType,
        url: recordingUrl,
      });
      const transcription = await transcribeChronosRecording({
        apiKey,
        file,
      });

      currentMeeting = await saveChronosTranscriptionResult({
        authorization,
        forceSpeakerLabel: isChronosParticipantAudioRecording(recording),
        meetingId,
        speakerLabel: label,
        transcription,
      });
      transcriptTexts.push(`${label}: ${transcription.text}`);
    } catch (error) {
      const message = getChronosAgentErrorMessage(
        error,
        "Falha ao transcrever audio Chronos.",
      );
      failedRecordings.push(`${label}: ${message}`);
      console.warn("[chronos/agent] Recording transcription skipped", {
        meetingId,
        reason: message,
        recordingId: recording.id,
      });

      if (recordings.length === 1) {
        throw error;
      }
    }
  }

  if (!currentMeeting) {
    throw new Error(
      failedRecordings.length
        ? `Nenhuma gravacao Chronos do lote foi transcrita: ${failedRecordings.join("; ")}`
        : "Gravacao Chronos nao possui arquivo assinado para transcricao.",
    );
  }

  return {
    meeting: currentMeeting,
    text: normalizeText(transcriptTexts.join("\n\n"), 80_000),
  };
}

function selectChronosTranscribableRecording(
  meeting: ChronosMeeting,
  options: { excludeParticipantAudio?: boolean } = {},
) {
  return (
    meeting.recordings
      .filter((recording) => {
        if (recording.status !== "available") {
          return false;
        }

        if (
          options.excludeParticipantAudio &&
          isChronosParticipantAudioRecording(recording)
        ) {
          return false;
        }

        const recordingUrl = recording.downloadUrl ?? recording.playbackUrl;

        return Boolean(recordingUrl && recordingUrl !== "#");
      })
      .sort((firstRecording, secondRecording) => {
        const firstAudioPriority = getChronosRecordingTranscriptionPriority(
          firstRecording,
        );
        const secondAudioPriority = getChronosRecordingTranscriptionPriority(
          secondRecording,
        );

        if (firstAudioPriority !== secondAudioPriority) {
          return secondAudioPriority - firstAudioPriority;
        }

        return (
          getChronosRecordingSortDate(secondRecording) -
          getChronosRecordingSortDate(firstRecording)
        );
      })[0] ?? null
  );
}

function selectChronosParticipantAudioRecordings(meeting: ChronosMeeting) {
  return meeting.recordings
    .filter((recording) => {
      const recordingUrl = recording.downloadUrl ?? recording.playbackUrl;

      return (
        recording.status === "available" &&
        Boolean(recordingUrl && recordingUrl !== "#") &&
        isChronosParticipantAudioRecording(recording)
      );
    })
    .sort(
      (firstRecording, secondRecording) =>
        getChronosRecordingSortDate(firstRecording) -
        getChronosRecordingSortDate(secondRecording),
    );
}

function getChronosRecordingTranscriptionPriority(
  recording: ChronosMeeting["recordings"][number],
) {
  if (isChronosParticipantAudioRecording(recording)) {
    return 2;
  }

  return isChronosAudioRecording(recording) ? 1 : 0;
}

function isChronosParticipantAudioRecording(
  recording: ChronosMeeting["recordings"][number],
) {
  const metadata = recording.metadata ?? {};
  const source = typeof metadata.source === "string" ? metadata.source : "";
  const kind = typeof metadata.kind === "string" ? metadata.kind : "";
  const storagePath = recording.storagePath?.toLowerCase() ?? "";

  return (
    source === CHRONOS_PARTICIPANT_AUDIO_SOURCE ||
    kind === "participant-audio" ||
    (isChronosAudioRecording(recording) &&
      storagePath.includes("/participants/"))
  );
}

function getChronosRecordingSpeakerLabel(
  recording: ChronosMeeting["recordings"][number],
) {
  const metadata = recording.metadata ?? {};
  const participantName =
    typeof metadata.participantName === "string"
      ? metadata.participantName.trim()
      : "";
  const participantIdentity =
    typeof metadata.participantIdentity === "string"
      ? metadata.participantIdentity.trim()
      : "";

  return participantName || participantIdentity || null;
}

function isChronosWherebyRecording(
  recording: ChronosMeeting["recordings"][number],
) {
  const metadata = recording.metadata ?? {};
  const wherebyMetadata =
    metadata.whereby && typeof metadata.whereby === "object"
      ? (metadata.whereby as Record<string, unknown>)
      : {};
  const source = typeof metadata.source === "string" ? metadata.source : "";
  const provider =
    typeof metadata.provider === "string" ? metadata.provider : "";
  const storageBucket = recording.storageBucket?.toLowerCase() ?? "";
  const storagePath = recording.storagePath?.toLowerCase() ?? "";

  return (
    provider === "whereby" ||
    source.includes("whereby") ||
    storageBucket === "whereby" ||
    storagePath.startsWith("whereby://recordings/") ||
    typeof wherebyMetadata.recordingId === "string"
  );
}

function isChronosAudioRecording(recording: ChronosMeeting["recordings"][number]) {
  const mimeType = recording.mimeType?.toLowerCase() ?? "";
  const fileName = recording.fileName?.toLowerCase() ?? "";
  const storagePath = recording.storagePath?.toLowerCase() ?? "";

  return (
    mimeType.startsWith("audio/") ||
    fileName.endsWith("-audio.mp4") ||
    fileName.endsWith(".ogg") ||
    fileName.endsWith(".mp3") ||
    fileName.endsWith(".m4a") ||
    (storagePath.includes("-audio-") && storagePath.endsWith(".mp4")) ||
    storagePath.endsWith(".ogg") ||
    storagePath.endsWith(".mp3") ||
    storagePath.endsWith(".m4a")
  );
}

function getChronosRecordingSortDate(
  recording: ChronosMeeting["recordings"][number],
) {
  return (
    parseChronosRecordingDate(recording.stoppedAt) ||
    parseChronosRecordingDate(recording.startedAt) ||
    parseChronosRecordingDate(recording.storagePath)
  );
}

function parseChronosRecordingDate(value?: string | null) {
  const timestamp = value ? Date.parse(value) : NaN;

  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function parseChronosAgentRequest(
  request: NextRequest,
): Promise<ParsedChronosAgentRequest> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const action = normalizeChronosAgentAction(formData.get("action"));
    const meetingId = normalizeText(formData.get("meetingId"), 120);
    const file = formData.get("file");

    if (action !== "transcribe_recording") {
      return {
        error: "Acao de upload Chronos invalida.",
        ok: false,
      };
    }

    if (!meetingId) {
      return { error: "Reuniao Chronos nao informada.", ok: false };
    }

    if (!(file instanceof File) || file.size <= 0) {
      return { error: "Envie um arquivo de audio ou video.", ok: false };
    }

    if (file.size > MAX_RECORDING_BYTES) {
      return {
        error:
          "Arquivo maior que 25 MB. A transcricao oficial exige audio compactado ou divisao em partes antes de enviar para a OpenAI.",
        ok: false,
      };
    }

    return {
      action,
      file,
      meetingId,
      minutesProfile: normalizeMinutesProfile(formData.get("minutesProfile")),
      ok: true,
      speakerLabel: normalizeOptionalText(formData.get("speakerLabel"), 80),
    };
  }

  const input = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!input) {
    return { error: "Informe a acao do agente Chronos.", ok: false };
  }

  const action = normalizeChronosAgentAction(input.action);
  const meetingId = normalizeText(input.meetingId, 120);

  if (action !== "draft_minutes") {
    if (action === "generate_agenda") {
      return {
        action,
        context: parseChronosAgendaGenerationContext(input.context),
        ...(meetingId ? { meetingId } : {}),
        ok: true,
      };
    }

    if (!meetingId) {
      return { error: "Reuniao Chronos nao informada.", ok: false };
    }

    if (action === "transcribe_existing_recording") {
      const recordingId = normalizeText(input.recordingId, 120);

      if (!recordingId) {
        return { error: "Gravacao Chronos nao informada.", ok: false };
      }

      return {
        action,
        meetingId,
        minutesProfile: normalizeMinutesProfile(input.minutesProfile),
        ok: true,
        recordingId,
        speakerLabel: normalizeOptionalText(input.speakerLabel, 80),
      };
    }

    return { error: "Acao Chronos invalida para JSON.", ok: false };
  }

  if (!meetingId) {
    return { error: "Reuniao Chronos nao informada.", ok: false };
  }

  return {
    action,
    meetingId,
    minutesProfile: normalizeMinutesProfile(input.minutesProfile),
    ok: true,
  };
}

function normalizeChronosAgentAction(value: unknown): ChronosAgentAction {
  return value === "transcribe_recording" ||
    value === "transcribe_existing_recording" ||
    value === "generate_agenda" ||
    value === "draft_minutes"
    ? value
    : "draft_minutes";
}

function parseChronosAgendaGenerationContext(
  value: unknown,
): ChronosAgendaGenerationContext {
  const context =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    currentAgenda: parseChronosAgendaLines(context.currentAgenda),
    agendaBrief: normalizeOptionalText(context.agendaBrief, 2_000),
    endsAt: normalizeOptionalText(context.endsAt, 80),
    objective: normalizeOptionalText(context.objective, 2_000),
    participants: parseChronosAgendaParticipants(context.participants),
    startsAt: normalizeOptionalText(context.startsAt, 80),
    title: normalizeOptionalText(context.title, 240),
  };
}

function parseChronosAgendaLines(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => normalizeText(item, 240)).filter(Boolean).slice(0, 12)
    : [];
}

function parseChronosAgendaParticipants(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const participant = item as Record<string, unknown>;
      const displayName = normalizeText(participant.displayName, 120);

      if (!displayName) {
        return null;
      }

      return {
        displayName,
        email: normalizeOptionalText(participant.email, 160),
        organization: normalizeOptionalText(participant.organization, 120),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 30);
}

function normalizeMinutesProfile(value: unknown): ChronosMinutesProfile {
  return chronosMinutesProfiles.includes(value as ChronosMinutesProfile)
    ? (value as ChronosMinutesProfile)
    : "alinhamento";
}

async function transcribeChronosRecording({
  apiKey,
  file,
}: {
  apiKey: string;
  file: File;
}) {
  const model = resolveChronosTranscriptionModel(
    process.env.HUB_CHRONOS_TRANSCRIPTION_MODEL,
    process.env.HUB_IT_TICKET_TRANSCRIPTION_MODEL,
  );
  const isDiarizedTranscriptionModel = model === "gpt-4o-transcribe-diarize";
  const formData = new FormData();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  formData.append("model", model);
  formData.append("file", file, file.name || "chronos-recording.webm");
  formData.append("language", "pt");
  formData.append(
    "response_format",
    isDiarizedTranscriptionModel ? "diarized_json" : "json",
  );

  if (isDiarizedTranscriptionModel) {
    formData.append("chunking_strategy", "auto");
  } else {
    formData.append(
      "prompt",
      [
        "Transcreva literalmente uma reuniao corporativa em portugues do Brasil.",
        "Use somente falas audiveis. Nao complete frases, nao resuma e nao invente conteudo.",
        "Quando um trecho estiver incerto, use [inaudivel] ou [trecho incerto].",
        "Preserve nomes, siglas, protocolos, datas e tarefas quando forem claramente ditos.",
        "Ignore ruido de fundo, silencio, eco, notificacoes e falas sobrepostas que nao fiquem inteligiveis.",
      ].join(" "),
    );
  }

  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      body: formData,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      method: "POST",
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as
      | OpenAiTranscriptionPayload
      | null;

    if (!response.ok) {
      const errorMessage = getOpenAiErrorMessage(
        payload,
        "Falha na transcricao.",
      );

      console.error("[chronos/agent] OpenAI transcription failed", {
        model,
        status: response.status,
        error: errorMessage,
      });
      throw new Error(errorMessage);
    }

    const transcript = normalizeChronosTranscriptionPayload(payload);

    if (!transcript.text) {
      throw new Error("OpenAI nao retornou transcricao para este arquivo.");
    }

    return transcript;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeChronosTranscriptionPayload(
  payload: OpenAiTranscriptionPayload | null,
): ChronosTranscriptionResult {
  const diarizedTranscript = normalizeChronosDiarizedTranscriptSegments(
    payload?.segments,
  );

  if (diarizedTranscript) {
    return diarizedTranscript;
  }

  const text = normalizeText(payload?.text, 80_000);

  return {
    segments: text
      ? [
          {
            content: text,
            speakerLabel: CHRONOS_FULL_RECORDING_SPEAKER_LABEL,
          },
        ]
      : [],
    text,
  };
}

function normalizeChronosDiarizedTranscriptSegments(
  segments: unknown,
): ChronosTranscriptionResult | null {
  if (!Array.isArray(segments)) {
    return null;
  }

  const parsedSegments: ChronosTranscribedSegment[] = [];

  segments.forEach((segment, index) => {
    if (!segment || typeof segment !== "object") {
      return;
    }

    const record = segment as Record<string, unknown>;
    const text = normalizeText(record.text, 2_200);

    if (!text) {
      return;
    }

    const speaker =
      normalizeText(record.speaker, 80) || `speaker_${index + 1}`;
    const startLabel = formatChronosTranscriptOffset(record.start);
    const endLabel = formatChronosTranscriptOffset(record.end);
    const timeLabel =
      startLabel || endLabel ? `[${startLabel || "?"}-${endLabel || "?"}]` : "";

    parsedSegments.push({
      content: timeLabel ? `${timeLabel} ${text}` : text,
      speakerLabel: speaker,
    });
  });

  if (parsedSegments.length === 0) {
    return null;
  }

  return {
    segments: parsedSegments,
    text: normalizeText(
      parsedSegments
        .map((segment) => `${segment.speakerLabel}: ${segment.content}`)
        .join("\n"),
      80_000,
    ),
  };
}

function formatChronosTranscriptOffset(value: unknown) {
  const seconds =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  if (!Number.isFinite(seconds) || seconds < 0) {
    return "";
  }

  const roundedSeconds = Math.floor(seconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = roundedSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(
    remainingSeconds,
  ).padStart(2, "0")}`;
}

function resolveChronosTranscriptionModel(
  ...candidates: Array<string | undefined>
) {
  return (
    candidates
      .map(normalizeChronosOpenAiModelCandidate)
      .map((candidate) => candidate?.toLowerCase())
      .find((candidate): candidate is (typeof CHRONOS_TRANSCRIPTION_MODELS)[number] =>
        isChronosTranscriptionModel(candidate),
      ) ?? DEFAULT_TRANSCRIPTION_MODEL
  );
}

async function fetchChronosRecordingFile({
  fileName,
  mimeType,
  url,
}: {
  fileName: string;
  mimeType?: string | null;
  url: string;
}) {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Nao foi possivel abrir o arquivo da gravacao Chronos.");
  }

  const blob = await response.blob();

  if (blob.size > MAX_RECORDING_BYTES) {
    throw new Error(
      "Arquivo maior que 25 MB. Gere audio compactado ou divida a gravacao em partes para transcrever pela OpenAI.",
    );
  }

  return new File([blob], fileName || "chronos-recording.webm", {
    type: mimeType || blob.type || "video/webm",
  });
}

async function draftChronosMinutes({
  apiKey,
  meeting,
  minutesProfile,
}: {
  apiKey: string;
  meeting: ChronosMeeting;
  minutesProfile: ChronosMinutesProfile;
}) {
  const model = resolveClaudeModel("heavy");

  try {
    const completion = await completeWithClaudeStructured<{
      minutes?: unknown;
      summary?: unknown;
    }>({
      inputSchema: {
        properties: {
          minutes: {
            description:
              "Ata executiva completa em Markdown (secoes '## ', subtitulos '### ', tabela do plano de acao). Rascunho para revisao humana.",
            type: "string",
          },
          summary: {
            description:
              "Resumo executivo curto da ata (3 a 6 frases), sem citar fallback nem transcricao literal.",
            type: "string",
          },
        },
        required: ["summary", "minutes"],
        type: "object",
      },
      maxTokens: 8_000,
      messages: [
        {
          content: buildChronosMinutesPrompt({ meeting, minutesProfile }),
          role: "user",
        },
      ],
      model,
      system: [
        "Voce e a Athena, agente executivo do Chronos no Panteon.",
        "Gere rascunho de ata em portugues do Brasil, executivo e profissional.",
        "Use apenas fatos recebidos no contexto. Nao invente decisao, participante, prazo ou responsavel.",
        "Quando faltar informacao, escreva 'Nao informado'.",
        "A ata nunca deve sair aprovada; ela e rascunho para revisao humana.",
        "Escreva a ata em Markdown com secoes (##), subtitulos (###), bullets, negrito com **texto** e uma tabela markdown para o plano de acao.",
        "Nao despeje a transcricao crua; transforme falas em resumo executivo, decisoes, riscos, pendencias e proximos passos.",
        "Entregue o resultado chamando a ferramenta entregar_ata com os campos summary e minutes.",
      ].join("\n"),
      toolDescription:
        "Entrega a ata executiva do Chronos (summary + minutes em Markdown).",
      toolName: "entregar_ata",
    });

    if (!completion) {
      throw new Error(
        "A Athena nao retornou a ata estruturada (summary + minutes).",
      );
    }

    const summary = normalizeText(completion.data.summary, 2_000);
    const minutes = normalizeText(completion.data.minutes, 16_000);

    if (!summary || !minutes) {
      throw new Error("A Athena retornou a ata sem summary ou minutes validos.");
    }

    return { minutes, summary };
  } catch (error) {
    const message = getChronosAgentErrorMessage(
      error,
      "A Athena nao concluiu a geracao estruturada da ata.",
    );

    console.error("[chronos/agent] Claude minutes generation failed", {
      meetingId: meeting.id,
      model,
      protocol: meeting.protocol,
      reason: message,
    });

    throw new ChronosOpenAiGenerationError(
      `Athena nao concluiu a ata executiva: ${message}`,
    );
  }
}

async function draftChronosAgenda({
  apiKey,
  context,
  meeting,
}: {
  apiKey: string;
  context: ChronosAgendaGenerationContext;
  meeting?: ChronosMeeting;
}): Promise<ChronosAgendaDraft> {
  const model = resolveClaudeModel("heavy");

  try {
    const completion = await completeWithClaudeStructured<{
      agendaMarkdown?: unknown;
      bulletPoints?: unknown;
      title?: unknown;
    }>({
      inputSchema: {
        properties: {
          agendaMarkdown: {
            description:
              "Pauta executiva completa em Markdown simples, pronta para preencher o campo de pauta.",
            type: "string",
          },
          bulletPoints: {
            description:
              "5 a 8 topicos-resumo executivos da pauta, acionaveis, sem participantes.",
            items: { type: "string" },
            type: "array",
          },
          title: {
            description: "Titulo executivo curto da pauta.",
            type: "string",
          },
        },
        required: ["title", "bulletPoints", "agendaMarkdown"],
        type: "object",
      },
      maxTokens: 1_500,
      messages: [
        {
          content: buildChronosAgendaPrompt({ context, meeting }),
          role: "user",
        },
      ],
      model,
      system: [
        "Voce e a Athena, agente executivo do Chronos no Panteon.",
        "Monte uma pauta executiva padronizada em portugues do Brasil para revisao humana.",
        "Escreva como assessoria executiva: profissional, objetiva, com criterio de prioridade e sem tom generico.",
        "Use apenas o contexto recebido. Nao invente cliente, decisao, prazo, responsavel ou participantes.",
        "A pauta deve ter objetivo obrigatorio, temas conforme o contexto e estrutura com expectativa de tempo.",
        "Use negrito em objetivo, decisoes, riscos, tempos, entregas, pontos criticos e termos importantes usando Markdown (**texto**).",
        "Nao inclua secao de participantes; participantes aparecem no card do evento.",
        "Entregue o resultado chamando a ferramenta entregar_pauta com title, bulletPoints e agendaMarkdown.",
      ].join("\n"),
      toolDescription: "Entrega a pauta executiva do Chronos.",
      toolName: "entregar_pauta",
    });

    const agenda: ChronosAgendaDraft = completion
      ? {
          agendaMarkdown: normalizeText(completion.data.agendaMarkdown, 8_000),
          bulletPoints: parseChronosAgendaLines(
            completion.data.bulletPoints,
          ).slice(0, 8),
          title:
            normalizeText(completion.data.title, 180) || "Pauta executiva",
        }
      : { agendaMarkdown: "", bulletPoints: [], title: "Pauta executiva" };

    if (agenda.bulletPoints.length === 0) {
      throw new Error("A Athena nao retornou itens de pauta validos.");
    }

    return agenda;
  } catch (error) {
    const message = getChronosAgentErrorMessage(
      error,
      "A Athena nao concluiu a geracao da pauta.",
    );

    console.error("[chronos/agent] Claude agenda generation failed", {
      meetingId: meeting?.id ?? "draft",
      model,
      protocol: meeting?.protocol ?? "draft",
      reason: message,
    });

    throw new ChronosOpenAiGenerationError(
      `Athena nao concluiu a pauta: ${message}`,
    );
  }
}

function resolveChronosOpenAiModel(
  fallback: string,
  ...candidates: Array<string | undefined>
) {
  return (
    candidates
      .map((candidate) => candidate?.trim())
      .find((candidate): candidate is string =>
        isUsableChronosOpenAiModel(candidate),
      ) ?? fallback
  );
}

function normalizeChronosOpenAiModelCandidate(value?: string) {
  const candidate = value?.trim();

  if (!isUsableChronosOpenAiModel(candidate)) {
    return undefined;
  }

  return candidate;
}

function isUsableChronosOpenAiModel(value?: string) {
  if (!value) {
    return false;
  }

  const normalized = value.toLowerCase();

  if (
    ["default", "none", "null", "option", "select", "undefined"].includes(
      normalized,
    )
  ) {
    return false;
  }

  return true;
}

function isChronosTranscriptionModel(
  value?: string,
): value is (typeof CHRONOS_TRANSCRIPTION_MODELS)[number] {
  return CHRONOS_TRANSCRIPTION_MODELS.some((model) => model === value);
}

function assertChronosTranscriptForMinutes(meeting: ChronosMeeting) {
  if (!hasChronosTranscriptForMinutes(meeting)) {
    throw new Error(
      "Ata Chronos requer transcricao salva com conteudo. Transcreva a gravacao antes de gerar a ata.",
    );
  }
}

function hasChronosTranscriptForMinutes(meeting: ChronosMeeting) {
  return getChronosMinutesTranscriptSegments(
    normalizeChronosMeetingRuntime(meeting),
  ).some((segment) => normalizeText(segment.content, 10_000).length > 0);
}

function hasChronosOfficialTranscript(meeting: ChronosMeeting) {
  return normalizeChronosMeetingRuntime(meeting).transcript.some((segment) =>
    isChronosOfficialTranscriptSource(segment.source),
  );
}

function hasChronosWherebyTranscript(meeting: ChronosMeeting) {
  return normalizeChronosMeetingRuntime(meeting).transcript.some(
    (segment) => segment.source === "whereby",
  );
}

function buildChronosTranscriptTextForResponse(meeting: ChronosMeeting) {
  return normalizeText(
    getChronosMinutesTranscriptSegments(normalizeChronosMeetingRuntime(meeting))
      .map((segment) => segment.content)
      .join("\n\n"),
    80_000,
  );
}

function buildChronosMinutesPrompt({
  meeting,
  minutesProfile,
}: {
  meeting: ChronosMeeting;
  minutesProfile: ChronosMinutesProfile;
}) {
  const agenda = Array.isArray(meeting.metadata?.agenda)
    ? meeting.metadata.agenda
    : [];
  const minutesContext = buildChronosMinutesContext(meeting);
  const recordingEvidence = buildChronosRecordingEvidence(meeting);
  const chatContext = buildChronosChatContext(meeting);
  const transcriptSegments = getChronosMinutesTranscriptSegments(meeting);
  const profileInstruction = {
    alinhamento:
      "Ata de alinhamento: destaque contexto, pontos alinhados, decisoes, responsaveis, pendencias e proximos passos. Sempre inclua uma secao 'Plano de acao' em tabela.",
    comunicado:
      "Ata comunicado: destaque mensagem executiva, publico afetado, decisao comunicada, impacto e proximos passos.",
    resultado:
      "Ata de resultado: destaque indicadores, leitura executiva, riscos, decisoes, responsaveis e compromissos.",
  } satisfies Record<ChronosMinutesProfile, string>;

  return [
    "Monte um rascunho de ata Chronos para revisao humana.",
    `Perfil da ata: ${chronosMinutesProfileLabels[minutesProfile]}.`,
    profileInstruction[minutesProfile],
    "FORMATACAO (siga a risca para a ata sair bem diagramada):",
    "ACENTUACAO OBRIGATORIA: embora estas instrucoes estejam escritas sem acento, a ATA GERADA deve usar acentuacao e ortografia perfeitas do portugues do Brasil. Exemplos do que NAO pode sair sem acento na ata final: 'reuniao'->'reunião', 'identificacao'->'identificação', 'decisoes'->'decisões', 'acao'->'ação', 'proximos'->'próximos', 'video'->'vídeo', 'gravacao'->'gravação', 'responsaveis'->'responsáveis'. NUNCA omita acentos no texto final.",
    "Cada secao principal e um titulo markdown nivel 2, no formato '## Nome da secao'. NUNCA use negrito (**texto**) como titulo de secao.",
    "Subtopicos dentro de uma secao sao titulos nivel 3, no formato '### Subtopico'. NUNCA use bullets como subtitulo.",
    "Escreva o corpo em PARAGRAFOS curtos e objetivos. Use bullets ('- ') apenas para listas reais de 3 ou mais itens, e cada bullet precisa ser uma FRASE COMPLETA.",
    "E PROIBIDO criar bullets de uma ou duas palavras (ex: '- Feedback.', '- Comunicacao clara.', '- Clima do departamento.'). Quando os itens forem curtos, consolide-os em UMA frase corrida separada por virgulas, dentro de um paragrafo.",
    "Nas secoes de dados (Identificacao da reuniao, Participantes com check-in), use bullets no formato '- **Rotulo:** valor'.",
    "Use negrito (**texto**) com moderacao: apenas em rotulos de dados, decisoes, responsaveis e prazos. Nao encha a ata de negrito.",
    "Estruture a ata com estas secoes (titulo nivel 2 '## '), nesta ordem: Identificação da reunião, Participantes com check-in, Resumo executivo, Pontos relevantes, Decisões e alinhamentos, Plano de ação, Próximos passos, Evidências de gravação/vídeo, Chat da reunião, Linha do tempo.",
    "Omita por completo as secoes que nao tiverem conteudo real (ex: Chat da reuniao ou Linha do tempo vazios), para nao gerar paginas em branco.",
    "O resumo executivo deve ter de 3 a 6 bullets claros (frases completas), sem repetir transcricao literal.",
    "Pontos relevantes devem ser paragrafos consolidados por assunto, com subtopicos '### ' quando necessario, em linguagem profissional, sem piadas internas, ruidos ou trechos irrelevantes. NAO fragmente em bullets curtos.",
    "Decisoes e alinhamentos devem separar o que foi decidido do que ficou apenas em discussao.",
    "Na identificacao da reuniao, use sempre o inicio programado e o fim real de encerramento. Nao use o fim agendado como fim da ata.",
    "Nos participantes, liste somente quem fez check-in/entrou na reuniao. Nao use convidados sem check-in.",
    "Para transcricao, use somente o que esta nos trechos recebidos. Se houver ruido ou baixa confianca, registre como 'Nao identificado' e nao invente fala.",
    "Trate gravacoes de video como evidencias vinculadas da reuniao. Use o video como lastro operacional, mas nao descreva tela, gesto, planilha ou conteudo visual que nao esteja na transcricao, chat, timeline ou metadados.",
    "Quando existir transcricao salva, ela e o gatilho principal para gerar a ata formatada, mesmo que a gravacao ainda esteja apenas como evidencia.",
    "Para reuniao de alinhamento, o Plano de acao deve ser uma tabela markdown com colunas: Atividade | Responsavel | Prazo | Status.",
    `Se uma atividade ficar sem prazo mencionado, use ${minutesContext.defaultActionDueLabel} como prazo padrao de 5 dias uteis a partir da reuniao.`,
    `Se nenhuma atividade for mencionada, registre uma linha com 'Sem atividade formal registrada' e prazo '${minutesContext.defaultActionDueLabel}'.`,
    "",
    "Retorne JSON neste formato:",
    '{"summary":"Resumo executivo curto.","minutes":"Conteudo completo da ata."}',
    "",
    "Contexto da reuniao:",
    `Protocolo: ${meeting.protocol}`,
    `Titulo: ${meeting.title}`,
    `Tipo: ${chronosMeetingTypeLabels[meeting.meetingType]}`,
    `Inicio programado: ${minutesContext.scheduledStartLabel}`,
    `Fim real de encerramento: ${minutesContext.actualEndLabel}`,
    `Duracao real: ${minutesContext.durationLabel}`,
    `Data base do prazo padrao: ${formatChronosDate(
      minutesContext.actualEndAt ?? minutesContext.scheduledStartAt,
    )}`,
    `Objetivo: ${meeting.objective ?? "Nao informado"}`,
    `Sala: ${meeting.room?.name ?? "Nao informado"}`,
    `Host: ${meeting.hostName ?? "Nao informado"}`,
    "",
    "Agenda:",
    agenda.length
      ? agenda.map((item, index) => `${index + 1}. ${String(item)}`).join("\n")
      : "Nao informada.",
    "",
    "Participantes:",
    minutesContext.participants.length
      ? minutesContext.participants
          .map(
            (participant) =>
              `- ${participant.displayName} (${participant.role}; check-in: ${formatChronosDateTime(
                participant.joinedAt,
              )})${
                participant.email ? ` - ${participant.email}` : ""
              }`,
          )
          .join("\n")
      : "Nao informado.",
    "",
    "Evidencias de gravacao/video:",
    recordingEvidence,
    "",
    "Chat da reuniao:",
    chatContext,
    "",
    "Transcricao:",
    transcriptSegments.length
      ? transcriptSegments
          .map(
            (segment) =>
              `[${segment.speakerLabel ?? "Participante"}] ${segment.content}`,
          )
          .join("\n")
      : "Nao ha transcricao salva.",
    "",
    "Timeline:",
    meeting.timeline.length
      ? meeting.timeline
          .slice(0, 20)
          .map((event) => `- ${event.eventAt}: ${event.title}`)
          .join("\n")
      : "Nao informada.",
    "",
    "Follow-ups:",
    meeting.followUps.length
      ? meeting.followUps
          .map(
            (followUp) =>
              `- ${followUp.title}; responsavel: ${
                followUp.ownerName ?? "Nao informado"
              }; prazo: ${followUp.dueAt ?? "Nao informado"}; status: ${
                followUp.status
              }`,
          )
          .join("\n")
      : "Nao informado.",
    "",
    "Resumo executivo atual:",
    meeting.executiveSummary ?? "Nao informado.",
  ].join("\n");
}

function getChronosMinutesTranscriptSegments(meeting: ChronosMeeting) {
  const openAiTranscript = meeting.transcript.filter(
    (segment) => segment.source === "openai",
  );

  if (openAiTranscript.length > 0) {
    return openAiTranscript;
  }

  const officialTranscript = meeting.transcript.filter((segment) =>
    isChronosOfficialTranscriptSource(segment.source),
  );

  return officialTranscript.length > 0 ? officialTranscript : meeting.transcript;
}

function isChronosOfficialTranscriptSource(source?: string | null) {
  return source === "openai" || source === "whereby";
}

function buildChronosAgendaPrompt({
  context,
  meeting,
}: {
  context: ChronosAgendaGenerationContext;
  meeting?: ChronosMeeting;
}) {
  const metadataAgenda = Array.isArray(meeting?.metadata?.agenda)
    ? meeting.metadata.agenda
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : [];
  const currentAgenda = context.currentAgenda.length
    ? context.currentAgenda
    : metadataAgenda;
  const participants = context.participants.length
    ? context.participants
    : (meeting?.participants ?? []).map((participant) => ({
        displayName: participant.displayName,
        email: participant.email ?? undefined,
        organization: participant.organization ?? undefined,
      }));

  return [
    "Crie uma pauta executiva Chronos para antes da reuniao.",
    "Objetivo: ajudar o operador a salvar uma pauta profissional, objetiva e rica em contexto no evento.",
    "Padrao obrigatorio do campo agendaMarkdown:",
    "- Comece com `## {titulo executivo}`.",
    "- Inclua obrigatoriamente a secao `### Objetivo da reuniao` com 1 paragrafo claro.",
    "- Inclua `### Estrutura da reuniao ({tempo estimado})` quando houver inicio/fim ou duracao inferivel.",
    "- Dentro da estrutura, use blocos numerados com expectativa de tempo, por exemplo `1. Abertura e direcionamento (5 min)`.",
    "- Em cada bloco, use bullets curtos e executivos iniciando com `•`, nunca com hifen ou traco.",
    "- Inclua secoes adicionais apenas quando o contexto justificar, como `Temas prioritarios`, `Decisoes esperadas`, `Riscos e atencoes`, `Encaminhamentos`.",
    "- Nao use separadores `---`, `***`, linhas horizontais ou emojis.",
    "- Use negrito em objetivo, decisoes, riscos, tempos, entregas, pontos criticos e termos importantes usando Markdown (**texto**).",
    "- Nao inclua secao de participantes, lista de convidados ou ordem alfabetica.",
    "O campo bulletPoints deve conter apenas 5 a 8 topicos-resumo da pauta, sem participantes.",
    "Cada topico deve ser acionavel, com verbo no infinitivo ou foco claro de decisao/alinhamento.",
    "Priorize: objetivo da reuniao, contexto executivo, decisoes esperadas, riscos/pendencias, perguntas criticas, estrutura e proximos encaminhamentos.",
    "Se houver contexto adicional do operador, use esse contexto como principal direcionador da pauta.",
    "Se ja houver pauta, refine e complete sem repetir itens iguais.",
    "Se o contexto estiver curto, gere uma pauta generica e segura para alinhamento, sem inventar fatos especificos.",
    "",
    "Retorne JSON neste formato:",
    '{"title":"Pauta executiva - tema da reuniao","bulletPoints":["Alinhar objetivo executivo da reuniao","Validar decisoes esperadas"],"agendaMarkdown":"## Pauta executiva - tema da reuniao\\n\\n### Objetivo da reuniao\\nDefinir **objetivo claro** da reuniao.\\n\\n### Estrutura da reuniao (1h)\\n\\n1. Abertura e direcionamento (5 min)\\n• Contextualizar o tema\\n• Alinhar expectativas"}',
    "",
    "Contexto da reuniao:",
    `Protocolo: ${meeting?.protocol ?? "Evento ainda nao salvo"}`,
    `Titulo: ${context.title ?? meeting?.title ?? "Nao informado"}`,
    `Tipo: ${meeting ? chronosMeetingTypeLabels[meeting.meetingType] : "Nao informado"}`,
    `Inicio: ${context.startsAt ?? meeting?.startsAt ?? "Nao informado"}`,
    `Fim: ${context.endsAt ?? meeting?.endsAt ?? "Nao informado"}`,
    `Sala: ${meeting?.room?.name ?? "Nao informado"}`,
    `Host: ${meeting?.hostName ?? "Nao informado"}`,
    `Objetivo/descricao: ${context.objective ?? meeting?.objective ?? "Nao informado"}`,
    `Contexto adicional do operador: ${context.agendaBrief ?? "Nao informado"}`,
    "",
    "Pauta atual:",
    currentAgenda.length
      ? currentAgenda.map((item, index) => `${index + 1}. ${item}`).join("\n")
      : "Nao informada.",
    "",
    "Convidados (somente contexto interno; nao listar na pauta gerada):",
    participants.length
      ? participants
          .map((participant) =>
            [
              `- ${participant.displayName}`,
              participant.email ? `email: ${participant.email}` : null,
              participant.organization ? `org: ${participant.organization}` : null,
            ]
              .filter(Boolean)
              .join(" | "),
          )
          .join("\n")
      : "Nao informado.",
  ].join("\n");
}

function buildChronosRecordingEvidence(meeting: ChronosMeeting) {
  if (meeting.recordings.length === 0) {
    return "Nao ha gravacao vinculada.";
  }

  return meeting.recordings
    .map((recording, index) => {
      const isVideo = recording.mimeType?.toLowerCase().includes("video");
      const source =
        recording.storagePath || recording.fileName || recording.id || "arquivo";

      return [
        `${index + 1}. ${source}`,
        `status: ${recording.status}`,
        `tipo: ${recording.mimeType ?? "Nao informado"}`,
        `inicio: ${formatChronosDateTime(recording.startedAt)}`,
        `fim: ${formatChronosDateTime(recording.stoppedAt)}`,
        `duracao: ${formatChronosDuration(recording.durationSeconds)}`,
        `uso operacional: ${
          isVideo
            ? "video anexado como evidencia; conteudo visual nao analisado automaticamente"
            : "audio/anexo usado para transcricao"
        }`,
      ].join(" | ");
    })
    .join("\n");
}

function buildChronosChatContext(meeting: ChronosMeeting) {
  const messages = meeting.chatMessages ?? [];

  if (messages.length === 0) {
    return "Nao ha chat salvo.";
  }

  return messages
    .slice(-25)
    .map(
      (message) =>
        `- ${formatChronosDateTime(message.createdAt)} | ${message.senderName}: ${message.content}`,
    )
    .join("\n");
}

function parseChronosMinutesJson(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");

  if (start < 0 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(value.slice(start, end + 1)) as {
      minutes?: unknown;
      summary?: unknown;
    };
    const summary = normalizeText(parsed.summary, 2_000);
    const minutes = normalizeText(parsed.minutes, 16_000);

    if (!summary || !minutes) {
      return null;
    }

    return { minutes, summary };
  } catch {
    return null;
  }
}

function parseChronosAgendaJson(value: string): ChronosAgendaDraft {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");

  if (start < 0 || end <= start) {
    return { agendaMarkdown: "", bulletPoints: [], title: "Pauta executiva" };
  }

  try {
    const parsed = JSON.parse(value.slice(start, end + 1)) as {
      agenda?: unknown;
      agendaMarkdown?: unknown;
      bulletPoints?: unknown;
      title?: unknown;
    };
    const title = normalizeText(parsed.title, 180) || "Pauta executiva";
    const bulletPoints = parseChronosAgendaLines(
      parsed.bulletPoints ?? parsed.agenda,
    ).slice(0, 8);
    const agendaMarkdown = normalizeText(parsed.agendaMarkdown, 8_000);

    return { agendaMarkdown, bulletPoints, title };
  } catch {
    return { agendaMarkdown: "", bulletPoints: [], title: "Pauta executiva" };
  }
}

function extractOutputText(payload: OpenAiResponsePayload) {
  if (!payload) {
    return "";
  }

  if (typeof payload.output_text === "string") {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  const chunks: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const content = (item as { content?: unknown }).content;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        chunks.push((part as { text: string }).text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function getOpenAiErrorMessage(
  payload: OpenAiResponsePayload | { error?: { message?: unknown } },
  fallback: string,
) {
  const message =
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error &&
    typeof (payload.error as { message?: unknown }).message === "string"
      ? (payload.error as { message: string }).message
      : "";

  return normalizeChronosOpenAiErrorMessage(message || fallback);
}

function normalizeChronosOpenAiErrorMessage(message: string) {
  if (/invalid option\s*:?\s*option/i.test(message)) {
    return "OpenAI recusou um placeholder de modelo chamado option. Chronos deve ignorar esse placeholder e usar o modelo padrao.";
  }

  return message;
}

function shouldRetryChronosJsonObjectFormat(message: string) {
  return /option|json_schema|text\.format|response_format|format/i.test(message);
}

function normalizeOptionalText(value: unknown, maxLength: number) {
  const text = normalizeText(value, maxLength);

  return text || undefined;
}

function normalizeText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function getChronosAgentErrorMessage(error: unknown, fallback: string) {
  if (isChronosSchemaMissingError(error)) {
    return "Chronos aguarda aplicacao da migration Supabase 0019_chronos_core.sql.";
  }

  if (
    error instanceof TypeError &&
    /invalid option\s*:?\s*option/i.test(error.message)
  ) {
    return "Chronos encontrou uma opcao invalida de runtime ao preparar a ata.";
  }

  return normalizeChronosOpenAiErrorMessage(
    error instanceof Error && error.message.trim() ? error.message : fallback,
  );
}

function getChronosAgentErrorStatus(error: unknown) {
  if (isChronosSchemaMissingError(error)) {
    return 503;
  }

  if (isChronosForbiddenError(error)) {
    return 403;
  }

  if (error instanceof ChronosOpenAiGenerationError) {
    return 502;
  }

  return 400;
}
