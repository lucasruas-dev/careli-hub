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

const DEFAULT_MINUTES_MODEL = "gpt-4o-mini";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const CHRONOS_TRANSCRIPTION_MODELS = [
  "gpt-4o-mini-transcribe",
  "gpt-4o-transcribe",
  "whisper-1",
] as const;
const CHRONOS_MINUTES_FALLBACK_MODELS = [
  DEFAULT_MINUTES_MODEL,
  "gpt-4.1-mini",
] as const;
const CHRONOS_MINUTES_MAX_OUTPUT_TOKENS = 8_000;
const CHRONOS_MINUTES_MAX_CHARS = 24_000;
const CHRONOS_TRANSCRIPT_MAX_CHARS = 40_000;
const CHRONOS_MINUTES_RESPONSE_FORMAT = {
  name: "chronos_minutes_draft",
  schema: {
    additionalProperties: false,
    properties: {
      minutes: {
        description: "Conteudo completo da ata em markdown executivo.",
        type: "string",
      },
      summary: {
        description: "Resumo executivo curto da ata.",
        type: "string",
      },
    },
    required: ["summary", "minutes"],
    type: "object",
  },
  strict: true,
  type: "json_schema",
} as const;
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
          speakerLabel: parsed.speakerLabel ?? "Transcricao OpenAI",
        },
      });
      const minutesResult = await trySaveChronosMinutesDraft({
        apiKey,
        authorization,
        meeting: transcribedMeeting,
        meetingId: parsed.meetingId,
        minutesProfile: parsed.minutesProfile,
      });

      return Response.json(
        {
          meeting: minutesResult.meeting,
          minutes: minutesResult.draft?.minutes,
          minutesError: minutesResult.error,
          minutesProfile: parsed.minutesProfile,
          source: "openai",
          summary: minutesResult.draft?.summary,
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
          speakerLabel: parsed.speakerLabel ?? "Transcricao OpenAI",
        },
      });
      const minutesResult = await trySaveChronosMinutesDraft({
        apiKey,
        authorization,
        meeting: transcribedMeeting,
        meetingId: parsed.meetingId,
        minutesProfile: parsed.minutesProfile,
      });

      return Response.json(
        {
          meeting: minutesResult.meeting,
          minutes: minutesResult.draft?.minutes,
          minutesError: minutesResult.error,
          minutesProfile: parsed.minutesProfile,
          source: "openai",
          summary: minutesResult.draft?.summary,
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

async function trySaveChronosMinutesDraft(
  input: Parameters<typeof saveChronosMinutesDraft>[0],
) {
  try {
    const result = await saveChronosMinutesDraft(input);

    return {
      draft: result.draft,
      error: undefined,
      meeting: result.meeting,
      ok: true,
    };
  } catch (error) {
    const errorMessage = getChronosAgentErrorMessage(
      error,
      "Transcricao salva, mas a ata ainda nao foi gerada.",
    );

    console.error("[chronos/agent] minutes draft failed after transcription", {
      meetingId: input.meetingId,
      message: errorMessage,
    });

    return {
      draft: undefined,
      error: errorMessage,
      meeting: input.meeting,
      ok: false,
    };
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

  const models = getChronosTranscriptionModelCandidates(
    process.env.HUB_CHRONOS_TRANSCRIPTION_MODEL,
    process.env.HUB_IT_TICKET_TRANSCRIPTION_MODEL,
  );

  let lastError: unknown;

  for (const model of models) {
    try {
      return await requestChronosTranscription({
        apiKey,
        file,
        model,
      });
    } catch (error) {
      lastError = error;

      if (!isRetriableChronosOpenAiOptionError(error)) {
        break;
      }

      console.error("[chronos/agent] retrying transcription with fallback model", {
        error: getChronosAgentErrorMessage(error, "Falha na transcricao."),
        model,
      });
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Falha na transcricao.");
}

async function requestChronosTranscription({
  apiKey,
  file,
  model,
}: {
  apiKey: string;
  file: File;
  model: (typeof CHRONOS_TRANSCRIPTION_MODELS)[number];
}) {
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
    const payload = (await readChronosOpenAiPayload(response)) as
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

    const transcript = normalizeText(payload?.text, CHRONOS_TRANSCRIPT_MAX_CHARS);

    if (!transcript) {
      throw new Error("OpenAI nao retornou transcricao para este arquivo.");
    }

    return transcript;
  } finally {
    clearTimeout(timeout);
  }
}

function getChronosTranscriptionModelCandidates(
  ...candidates: Array<string | undefined>
) {
  const uniqueModels = new Set<(typeof CHRONOS_TRANSCRIPTION_MODELS)[number]>();

  for (const candidate of [
    ...candidates,
    DEFAULT_TRANSCRIPTION_MODEL,
    "gpt-4o-transcribe",
    "whisper-1",
  ]) {
    const normalized = normalizeChronosOpenAiModelCandidate(candidate)?.toLowerCase();

    if (isChronosTranscriptionModel(normalized)) {
      uniqueModels.add(normalized);
    }
  }

  return Array.from(uniqueModels);
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
  const models = getChronosOpenAiModelCandidates(
    process.env.HUB_CHRONOS_MINUTES_MODEL,
    process.env.HUB_AI_MODEL,
    ...CHRONOS_MINUTES_FALLBACK_MODELS,
  );
  let lastError: unknown;

  for (const model of models) {
    try {
      return await requestChronosMinutesDraft({
        apiKey,
        meeting,
        minutesProfile,
        model,
      });
    } catch (error) {
      lastError = error;

      if (!isRetriableChronosOpenAiOptionError(error)) {
        break;
      }

      console.error("[chronos/agent] retrying minutes with fallback model", {
        error: getChronosAgentErrorMessage(error, "Falha ao gerar ata."),
        model,
      });
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("OpenAI nao retornou uma ata valida para revisao.");
}

async function requestChronosMinutesDraft({
  apiKey,
  meeting,
  minutesProfile,
  model,
}: {
  apiKey: string;
  meeting: ChronosMeeting;
  minutesProfile: ChronosMinutesProfile;
  model: string;
}) {
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
        max_output_tokens: CHRONOS_MINUTES_MAX_OUTPUT_TOKENS,
        model,
        text: {
          format: CHRONOS_MINUTES_RESPONSE_FORMAT,
        },
      }),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });
    const payload = (await readChronosOpenAiPayload(
      response,
    )) as OpenAiResponsePayload;

    if (!response.ok) {
      throw new Error(getOpenAiErrorMessage(payload, "Falha ao gerar ata."));
    }

    const parsed = parseChronosMinutesPayload(payload);

    if (!parsed) {
      throw new Error("OpenAI nao retornou uma ata valida para revisao.");
    }

    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

function getChronosOpenAiModelCandidates(
  ...candidates: Array<string | undefined>
) {
  const uniqueModels = new Set<string>();

  for (const candidate of candidates) {
    const normalized = normalizeChronosOpenAiModelCandidate(candidate);

    if (isUsableChronosOpenAiModel(normalized)) {
      uniqueModels.add(normalized);
    }
  }

  return Array.from(uniqueModels);
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

function isUsableChronosOpenAiModel(value?: string): value is string {
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
    "Use o padrao executivo do modelo Careli: titulo objetivo, secoes numeradas, texto curto, bullets profissionais e plano de acao em tabela.",
    "Use markdown simples. Titulos das secoes devem vir como linhas numeradas: 1. Participantes, 2. Objetivo da Reuniao, 3. Resumo Executivo etc.",
    "Nao despeje a transcricao literal na ata principal. Nao crie uma secao 'Falas registradas'. Transforme falas em sintese executiva, decisoes, direcionamentos, pendencias e plano de acao.",
    "Organize a ata com esta base minima: Participantes, Objetivo da Reuniao, Resumo Executivo, Pontos Alinhados, Decisoes e Direcionamentos, Pendencias e Riscos, Plano de Acao, Proxima Reuniao, Formalizacao e Assinaturas.",
    "Evite blocos longos. Prefira bullets curtos, objetivos e acionaveis, com linguagem executiva e formal.",
    "Quando o perfil for Resultado, aproxime a estrutura do modelo de apresentacao de resultados: Performance/Indicadores, Gestao de Carteira ou Operacao, Comunicacao, Direcionamentos, Plano de Acao e Proxima Reuniao.",
    "Na identificacao da reuniao, use sempre o inicio programado e o fim real de encerramento. Nao use o fim agendado como fim da ata.",
    "Nos participantes, liste somente quem fez check-in/entrou na reuniao. Nao use convidados sem check-in.",
    "Para transcricao, use somente o que esta nos trechos recebidos. Se houver ruido ou baixa confianca, registre como 'Nao identificado' e nao invente fala.",
    "Rotulos de falante vindos de captura browser/Athena sao origem de captura, nao identidade confirmada. Nao atribua uma fala a Lucas, Nivea, Cinthia, Northon ou outro participante se o contexto nao confirmar claramente.",
    "Trate gravacoes de video como evidencias vinculadas da reuniao. Use o video como lastro operacional, mas nao descreva tela, gesto, planilha ou conteudo visual que nao esteja na transcricao, chat, timeline ou metadados.",
    "Quando existir transcricao salva, ela e o gatilho principal para gerar a ata formatada, mesmo que a gravacao ainda esteja apenas como evidencia.",
    "Para reuniao de alinhamento, o Plano de acao deve ser uma tabela markdown com colunas: Atividade | Responsavel | Prazo | Status.",
    `Se uma atividade ficar sem prazo mencionado, use ${minutesContext.defaultActionDueLabel} como prazo padrao de 5 dias corridos a partir da data da reuniao.`,
    `Se nenhuma atividade for mencionada, registre uma linha com 'Sem atividade formal registrada' e prazo '${minutesContext.defaultActionDueLabel}'.`,
    "A secao Formalizacao deve informar que a ata segue para revisao humana e formalizacao/assinatura digital quando aplicavel.",
    "A secao Assinaturas deve conter texto declaratorio curto, sem inventar assinatura efetiva.",
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
          .map(formatChronosTranscriptSegmentForPrompt)
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

function formatChronosTranscriptSegmentForPrompt(
  segment: ChronosMeeting["transcript"][number],
) {
  const source = segment.source?.toLowerCase() ?? "";
  const rawLabel = segment.speakerLabel?.trim() ?? "";
  const label = isReliableChronosSpeakerLabel(rawLabel, source)
    ? rawLabel
    : "Falante nao confirmado";
  const captureNote =
    rawLabel && rawLabel !== label ? ` (captado por ${rawLabel})` : "";

  return `[${label}]${captureNote} ${segment.content}`;
}

function isReliableChronosSpeakerLabel(label: string, source: string) {
  if (!label) {
    return false;
  }

  const normalized = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (
    [
      "athena",
      "browser",
      "captura",
      "falante nao confirmado",
      "openai",
      "participante",
      "transcricao openai",
    ].some((fragment) => normalized.includes(fragment))
  ) {
    return false;
  }

  if (source === "browser" || source === "athena") {
    return false;
  }

  return true;
}

function parseChronosMinutesPayload(payload: OpenAiResponsePayload) {
  const parsedFromText = parseChronosMinutesJson(extractOutputText(payload));

  if (parsedFromText) {
    return parsedFromText;
  }

  return findChronosMinutesObject(payload);
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
    const minutes = normalizeText(parsed.minutes, CHRONOS_MINUTES_MAX_CHARS);

    if (!summary || !minutes) {
      return null;
    }

    return { minutes, summary };
  } catch {
    return null;
  }
}

function findChronosMinutesObject(value: unknown): {
  minutes: string;
  summary: string;
} | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as { minutes?: unknown; summary?: unknown };
  const summary = normalizeText(candidate.summary, 2_000);
  const minutes = normalizeText(candidate.minutes, CHRONOS_MINUTES_MAX_CHARS);

  if (summary && minutes) {
    return { minutes, summary };
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const nested = findChronosMinutesObject(item);

        if (nested) {
          return nested;
        }
      }

      continue;
    }

    const nested = findChronosMinutesObject(child);

    if (nested) {
      return nested;
    }
  }

  return null;
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

async function readChronosOpenAiPayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.toLowerCase().includes("application/json")) {
    return response.json().catch(() => null);
  }

  const text = await response.text().catch(() => "");

  if (response.ok) {
    return { text };
  }

  return {
    error: {
      message: text || response.statusText || "Falha OpenAI sem corpo textual.",
    },
  };
}

function isRetriableChronosOpenAiOptionError(error: unknown) {
  const message = getChronosAgentErrorMessage(error, "")
    .toLowerCase()
    .trim();

  return [
    "does not exist",
    "invalid model",
    "invalid option",
    "invalid value",
    "model_not_found",
    "not found",
    "unsupported",
  ].some((fragment) => message.includes(fragment));
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
