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
import {
  buildChronosMinutesContext,
  formatChronosDate,
  formatChronosDateTime,
  formatChronosDuration,
} from "@/lib/chronos/minutes";

const DEFAULT_MINUTES_MODEL = "gpt-5.5";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const CHRONOS_TRANSCRIPTION_MODELS = [
  "gpt-4o-mini-transcribe",
  "gpt-4o-transcribe",
  "whisper-1",
] as const;
const OPENAI_TIMEOUT_MS = 60_000;
const OPENAI_TRANSCRIPTION_MAX_BYTES = 25_000_000;
const MAX_RECORDING_BYTES = 150_000_000;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ChronosAgentAction =
  | "draft_minutes"
  | "transcribe_existing_recording"
  | "transcribe_recording";

type ParsedChronosAgentRequest =
  | {
      action: "draft_minutes";
      meetingId: string;
      minutesProfile: ChronosMinutesProfile;
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
      const meeting = snapshot.meetings.find(
        (currentMeeting) => currentMeeting.id === parsed.meetingId,
      );

      if (!meeting) {
        return Response.json(
          { error: "Reuniao Chronos nao encontrada." },
          { status: 404 },
        );
      }

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

      const file = await fetchChronosRecordingFile({
        fileName: recording.fileName ?? "chronos-recording.webm",
        mimeType: recording.mimeType,
        url: recordingUrl,
      });
      const transcript = await transcribeChronosRecording({
        apiKey,
        file,
      });
      const transcribedMeeting = await updateChronosMeeting({
        authorization,
        input: {
          action: "add_transcript",
          content: transcript,
          meetingId: parsed.meetingId,
          source: "openai",
          speakerLabel: parsed.speakerLabel ?? "Athena",
        },
      });
      const { draft, meeting: updatedMeeting } = await saveChronosMinutesDraft({
        apiKey,
        authorization,
        meeting: transcribedMeeting,
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
          transcript,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (parsed.action === "transcribe_recording") {
      const transcript = await transcribeChronosRecording({
        apiKey,
        file: parsed.file,
      });
      const transcribedMeeting = await updateChronosMeeting({
        authorization,
        input: {
          action: "add_transcript",
          content: transcript,
          meetingId: parsed.meetingId,
          source: "openai",
          speakerLabel: parsed.speakerLabel ?? "Athena",
        },
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

    if (!hasChronosAvailableRecording(meeting) && meeting.transcript.length === 0) {
      return Response.json(
        {
          error:
            "Ata Chronos requer gravacao disponivel ou transcricao vinculada a reuniao.",
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
    const errorMessage = getChronosAgentErrorMessage(
      error,
      "Nao foi possivel executar o agente Chronos.",
    );

    console.error("[chronos/agent] request failed", {
      message: errorMessage,
      status: getChronosAgentErrorStatus(error),
    });

    return Response.json(
      {
        error: errorMessage,
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
  const draft = await draftChronosMinutes({
    apiKey,
    meeting,
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
    value === "draft_minutes"
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
  if (file.size > OPENAI_TRANSCRIPTION_MAX_BYTES) {
    throw new Error(
      "OpenAI aceita transcricao de audio/video ate 25 MB. Baixe a gravacao e compacte/recorte o arquivo antes de transcrever.",
    );
  }

  const model = resolveChronosTranscriptionModel(
    process.env.HUB_CHRONOS_TRANSCRIPTION_MODEL,
    process.env.HUB_IT_TICKET_TRANSCRIPTION_MODEL,
  );
  const formData = new FormData();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  formData.append("model", model);
  formData.append("file", file, file.name || "chronos-recording.webm");
  formData.append("language", "pt");
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

    const transcript = normalizeText(payload?.text, 12_000);

    if (!transcript) {
      throw new Error("OpenAI nao retornou transcricao para este arquivo.");
    }

    return transcript;
  } finally {
    clearTimeout(timeout);
  }
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
  const model = resolveChronosOpenAiModel(
    DEFAULT_MINUTES_MODEL,
    process.env.HUB_CHRONOS_MINUTES_MODEL,
    process.env.HUB_AI_MODEL,
  );
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
  } catch (error) {
    return buildChronosFallbackMinutes({
      error,
      meeting,
      minutesProfile,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function resolveChronosOpenAiModel(
  fallback: string,
  ...candidates: Array<string | undefined>
) {
  return (
    candidates
      .map(normalizeChronosOpenAiModelCandidate)
      .find((candidate): candidate is string =>
        isUsableChronosOpenAiModel(candidate),
      ) ?? fallback
  );
}

function normalizeChronosOpenAiModelCandidate(value?: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed
    .replace(/^["']+|["']+$/g, "")
    .trim();
}

function isUsableChronosOpenAiModel(value?: string) {
  if (!value) {
    return false;
  }

  return ![
    "choose",
    "default",
    "model",
    "none",
    "null",
    "option",
    "placeholder",
    "select",
    "selecione",
    "undefined",
  ].includes(
    value.toLowerCase(),
  );
}

function isChronosTranscriptionModel(
  value?: string,
): value is (typeof CHRONOS_TRANSCRIPTION_MODELS)[number] {
  return CHRONOS_TRANSCRIPTION_MODELS.some((model) => model === value);
}

function hasChronosAvailableRecording(meeting: ChronosMeeting) {
  return meeting.recordings.some(
    (recording) => recording.status === "available",
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
    "Use topicos com bullets para deixar a leitura organizada.",
    "Use negrito em titulos e dados importantes usando markdown (**texto**).",
    "Na identificacao da reuniao, use sempre o inicio programado e o fim real de encerramento. Nao use o fim agendado como fim da ata.",
    "Nos participantes, liste somente quem fez check-in/entrou na reuniao. Nao use convidados sem check-in.",
    "Para transcricao, use somente o que esta nos trechos recebidos. Se houver ruido ou baixa confianca, registre como 'Nao identificado' e nao invente fala.",
    "Trate gravacoes de video como evidencias vinculadas da reuniao. Use o video como lastro operacional, mas nao descreva tela, gesto, planilha ou conteudo visual que nao esteja na transcricao, chat, timeline ou metadados.",
    "Quando existir transcricao salva, ela e o gatilho principal para gerar a ata formatada, mesmo que a gravacao ainda esteja apenas como evidencia.",
    "Para reuniao de alinhamento, o Plano de acao deve ser uma tabela markdown com colunas: Atividade | Responsavel | Prazo | Status.",
    `Se uma atividade ficar sem prazo mencionado, use ${minutesContext.defaultActionDueLabel} como prazo padrao de 5 dias uteis a partir da reuniao.`,
    "Se nenhuma atividade for mencionada, registre uma linha com 'Sem atividade formal registrada' e prazo 'Nao informado'.",
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

function buildChronosFallbackMinutes({
  error,
  meeting,
  minutesProfile,
}: {
  error: unknown;
  meeting: ChronosMeeting;
  minutesProfile: ChronosMinutesProfile;
}) {
  const context = buildChronosMinutesContext(meeting);
  const participants = context.participants
    .map((participant) => {
      const details = [
        participant.role,
        participant.email,
        participant.organization,
      ].filter(Boolean);

      return `- ${participant.displayName}${
        details.length ? ` (${details.join(" / ")})` : ""
      }`;
    })
    .join("\n");
  const transcript = meeting.transcript
    .slice(0, 18)
    .map(
      (segment) =>
        `- **${segment.speakerLabel ?? "Participante"}:** ${segment.content}`,
    )
    .join("\n");
  const timeline = meeting.timeline
    .slice(0, 14)
    .map((event) => `- ${formatChronosDateTime(event.eventAt)}: ${event.title}`)
    .join("\n");
  const recordingEvidence = buildChronosRecordingEvidence(meeting);
  const chatContext = buildChronosChatContext(meeting);
  const followUps = meeting.followUps
    .map(
      (followUp) =>
        `| ${followUp.title} | ${followUp.ownerName ?? "Nao informado"} | ${
          followUp.dueAt ? formatChronosDate(followUp.dueAt) : "Nao informado"
        } | ${followUp.status} |`,
    )
    .join("\n");
  const fallbackReason =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Falha operacional da OpenAI";
  const summary = `Rascunho de ata ${chronosMinutesProfileLabels[
    minutesProfile
  ].toLowerCase()} gerado localmente para revisao humana.`;
  const minutes = [
    `**Ata ${meeting.protocol}**`,
    "",
    "**Identificacao da reuniao**",
    `- **Reuniao:** ${meeting.title}`,
    `- **Perfil:** ${chronosMinutesProfileLabels[minutesProfile]}`,
    `- **Inicio programado:** ${context.scheduledStartLabel}`,
    `- **Fim real:** ${context.actualEndLabel}`,
    `- **Duracao:** ${context.durationLabel}`,
    `- **Sala:** ${meeting.room?.name ?? "Nao informado"}`,
    `- **Host:** ${meeting.hostName ?? "Nao informado"}`,
    "",
    "**Participantes com check-in**",
    participants || "- Nao informado",
    "",
    "**Resumo executivo**",
    meeting.executiveSummary ||
      "Rascunho gerado com base nos registros disponiveis do Chronos.",
    "",
    "**Falas registradas**",
    transcript || "- Nao ha transcricao salva.",
    "",
    "**Evidencias de gravacao/video**",
    recordingEvidence,
    "",
    "**Chat da reuniao**",
    chatContext,
    "",
    "**Linha do tempo**",
    timeline || "- Nao informada.",
    "",
    "**Plano de acao**",
    "| Atividade | Responsavel | Prazo | Status |",
    "| --- | --- | --- | --- |",
    followUps ||
      `| Sem atividade formal registrada | Nao informado | ${context.defaultActionDueLabel} | Aberto |`,
    "",
    "**Observacao operacional**",
    `- Athena gerou este rascunho localmente porque a chamada OpenAI retornou: ${fallbackReason}.`,
    "- Ata sujeita a revisao humana antes de aprovacao.",
  ].join("\n");

  return { minutes, summary };
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

  return normalizeChronosOpenAiErrorMessage(message || fallback);
}

function normalizeChronosOpenAiErrorMessage(message: string) {
  const normalized = message.trim();

  return normalized && normalized !== "[object Object]"
    ? normalized
    : "OpenAI retornou uma falha sem mensagem textual.";
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

  return 400;
}
