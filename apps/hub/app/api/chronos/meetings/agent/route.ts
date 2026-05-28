import { type NextRequest } from "next/server";

import {
  authorizeChronosRequest,
  isChronosForbiddenError,
  isChronosSchemaMissingError,
  listChronosSnapshot,
  updateChronosMeeting,
} from "@/lib/chronos/server";
import {
  chronosMeetingTypeLabels,
  chronosMinutesProfileLabels,
  chronosMinutesProfiles,
  type ChronosMeeting,
  type ChronosMinutesProfile,
} from "@/lib/chronos/types";

const DEFAULT_MINUTES_MODEL = "gpt-5.5";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const OPENAI_TIMEOUT_MS = 60_000;
const MAX_RECORDING_BYTES = 150_000_000;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ChronosAgentAction = "draft_minutes" | "transcribe_recording";

type ParsedChronosAgentRequest =
  | {
      action: "draft_minutes";
      meetingId: string;
      minutesProfile: ChronosMinutesProfile;
      ok: true;
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

    if (parsed.action === "transcribe_recording") {
      const transcript = await transcribeChronosRecording({
        apiKey,
        file: parsed.file,
      });
      const meeting = await updateChronosMeeting({
        authorization,
        input: {
          action: "add_transcript",
          content: transcript,
          meetingId: parsed.meetingId,
          source: "openai",
          speakerLabel: parsed.speakerLabel ?? "Athena",
        },
      });

      return Response.json(
        {
          meeting,
          minutesProfile: parsed.minutesProfile,
          source: "openai",
          transcript,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const snapshot = await listChronosSnapshot(authorization);
    const meeting = snapshot.meetings.find(
      (currentMeeting) => currentMeeting.id === parsed.meetingId,
    );

    if (!meeting) {
      return Response.json(
        { error: "Reuniao Chronos nao encontrada." },
        { status: 404 },
      );
    }

    const draft = await draftChronosMinutes({
      apiKey,
      meeting,
      minutesProfile: parsed.minutesProfile,
    });

    await updateChronosMeeting({
      authorization,
      input: {
        action: "save_summary",
        meetingId: parsed.meetingId,
        summary: draft.summary,
      },
    });
    const updatedMeeting = await updateChronosMeeting({
      authorization,
      input: {
        action: "save_minutes",
        content: draft.minutes,
        meetingId: parsed.meetingId,
        status: "draft",
      },
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
        error: "Arquivo muito grande para transcricao operacional.",
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

  if (!meetingId) {
    return { error: "Reuniao Chronos nao informada.", ok: false };
  }

  if (action !== "draft_minutes") {
    return { error: "Acao Chronos invalida para JSON.", ok: false };
  }

  return {
    action,
    meetingId,
    minutesProfile: normalizeMinutesProfile(input.minutesProfile),
    ok: true,
  };
}

function normalizeChronosAgentAction(value: unknown): ChronosAgentAction {
  return value === "transcribe_recording" || value === "draft_minutes"
    ? value
    : "draft_minutes";
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
  const model =
    process.env.HUB_CHRONOS_TRANSCRIPTION_MODEL?.trim() ||
    process.env.HUB_IT_TICKET_TRANSCRIPTION_MODEL?.trim() ||
    DEFAULT_TRANSCRIPTION_MODEL;
  const formData = new FormData();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  formData.append("model", model);
  formData.append("file", file, file.name || "chronos-recording.webm");
  formData.append("language", "pt");
  formData.append("response_format", "json");

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
      | { error?: { message?: unknown }; text?: unknown }
      | null;

    if (!response.ok) {
      throw new Error(getOpenAiErrorMessage(payload, "Falha na transcricao."));
    }

    const transcript = normalizeText(payload?.text, 8_000);

    if (!transcript) {
      throw new Error("OpenAI nao retornou transcricao para este arquivo.");
    }

    return transcript;
  } finally {
    clearTimeout(timeout);
  }
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
  const model =
    process.env.HUB_CHRONOS_MINUTES_MODEL?.trim() ||
    process.env.HUB_AI_MODEL?.trim() ||
    DEFAULT_MINUTES_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      body: JSON.stringify({
        input: [
          {
            content: [
              {
                text: buildChronosMinutesPrompt({ meeting, minutesProfile }),
                type: "input_text",
              },
            ],
            role: "user",
          },
        ],
        instructions: [
          "Voce e a Athena, agente executivo do Chronos no Panteon.",
          "Gere rascunho de ata em portugues do Brasil, objetivo e profissional.",
          "Use apenas fatos recebidos no contexto. Nao invente decisao, participante, prazo ou responsavel.",
          "Quando faltar informacao, escreva 'Nao informado'.",
          "A ata nunca deve sair aprovada; ela e rascunho para revisao humana.",
          "Retorne somente JSON valido com summary e minutes.",
        ].join("\n"),
        max_output_tokens: 2_400,
        model,
      }),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as OpenAiResponsePayload;

    if (!response.ok) {
      throw new Error(getOpenAiErrorMessage(payload, "Falha ao gerar ata."));
    }

    const parsed = parseChronosMinutesJson(extractOutputText(payload));

    if (!parsed) {
      throw new Error("OpenAI nao retornou uma ata valida para revisao.");
    }

    return parsed;
  } finally {
    clearTimeout(timeout);
  }
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
  const profileInstruction = {
    alinhamento:
      "Ata de alinhamento: destaque contexto, pontos alinhados, decisoes, responsaveis, pendencias e proximos passos.",
    comunicado:
      "Ata comunicado: destaque mensagem executiva, publico afetado, decisao comunicada, impacto e proximos passos.",
    resultado:
      "Ata de resultado: destaque indicadores, leitura executiva, riscos, decisoes, responsaveis e compromissos.",
  } satisfies Record<ChronosMinutesProfile, string>;

  return [
    "Monte um rascunho de ata Chronos para revisao humana.",
    `Perfil da ata: ${chronosMinutesProfileLabels[minutesProfile]}.`,
    profileInstruction[minutesProfile],
    "",
    "Retorne JSON neste formato:",
    '{"summary":"Resumo executivo curto.","minutes":"Conteudo completo da ata."}',
    "",
    "Contexto da reuniao:",
    `Protocolo: ${meeting.protocol}`,
    `Titulo: ${meeting.title}`,
    `Tipo: ${chronosMeetingTypeLabels[meeting.meetingType]}`,
    `Inicio: ${meeting.startsAt ?? "Nao informado"}`,
    `Fim: ${meeting.endsAt ?? "Nao informado"}`,
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
    meeting.participants.length
      ? meeting.participants
          .map(
            (participant) =>
              `- ${participant.displayName} (${participant.role})${
                participant.email ? ` - ${participant.email}` : ""
              }`,
          )
          .join("\n")
      : "Nao informado.",
    "",
    "Transcricao:",
    meeting.transcript.length
      ? meeting.transcript
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
    const minutes = normalizeText(parsed.minutes, 8_000);

    if (!summary || !minutes) {
      return null;
    }

    return { minutes, summary };
  } catch {
    return null;
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

  return message || fallback;
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

  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function getChronosAgentErrorStatus(error: unknown) {
  if (isChronosSchemaMissingError(error)) {
    return 503;
  }

  if (isChronosForbiddenError(error)) {
    return 403;
  }

  return 400;
}
