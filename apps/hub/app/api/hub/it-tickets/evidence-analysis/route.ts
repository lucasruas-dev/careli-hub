import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";

import { authorizeHubItTicketRequest } from "@/lib/hub-it-tickets/server";
import {
  hubItTicketCategoryLabels,
  hubItTicketPriorityLabels,
  type HubItTicketAttachmentInput,
  type HubItTicketCategory,
  type HubItTicketEvidenceAnalysis,
  type HubItTicketEvidenceAnalysisInput,
  type HubItTicketPriority,
} from "@/lib/hub-it-tickets/types";

type ParsedEvidenceAnalysisRequest =
  | {
      data: HubItTicketEvidenceAnalysisInput;
      ok: true;
    }
  | {
      error: string;
      ok: false;
    };

const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const OPENAI_TIMEOUT_MS = 45_000;
const MAX_IMAGE_EVIDENCES = 6;
const MAX_AUDIO_EVIDENCES = 2;
const PANTEON_BUSINESS_RULES = [
  "Iris e o canal oficial de comunicacao externa. Demandas que exigem retorno ao cliente devem gerar ou referenciar um protocolo AT.",
  "Zeus centraliza HelpDesk, operacao, dados, infra e suporte interno. Demandas tecnicas abertas pela Athena usam protocolo TI e precisam preservar evidencias, historico e devolutivas.",
  "Hades trata cobranca. Quando Hades gerar comunicacao externa, o fluxo operacional deve manter protocolo CB vinculado a um AT da Iris.",
  "Hermes e o chat interno. Mensagens, respostas, mencoes, reacoes, imagens e anexos devem manter contexto da conversa sem fechar paineis ou perder fluxo do usuario.",
  "Athena deve registrar prints, audio, video e leitura tecnica para apoiar a triagem, sem inventar evidencia ausente.",
  "A data de entrega solicitada pelo usuario deve ser exibida no HelpDesk; Zeus pode aprovar ou rejeitar propondo nova data, com historico visivel da decisao.",
  "A fila HelpDesk deve destacar vencimento: hoje ou atrasado em vermelho, 1-2 dias em amarelo, acima de 3 dias em verde e sem data como pendencia de classificacao.",
  "Gravacao de tela da Athena nao deve ser interrompida por troca de tela ou clique fora; quando estiver gravando, o fluxo deve minimizar ou preservar os controles ate finalizar.",
  "Todos os modulos seguem a identidade Panteon: sidebar padronizado, topbar com usuario logado e linguagem operacional objetiva.",
] as const;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authorization = await authorizeHubItTicketRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const parsed = parseEvidenceAnalysisRequest(
    await request.json().catch(() => null),
  );

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const fallback = buildFallbackEvidenceAnalysis(parsed.data);

  if (!apiKey) {
    return NextResponse.json(fallback);
  }

  try {
    const audioTranscripts = await transcribeAudioAttachments({
      apiKey,
      attachments: parsed.data.attachments,
    });
    const visualEvidenceDataUrls = collectVisualEvidenceDataUrls(
      parsed.data.attachments,
    );
    const openAiAnalysis = await analyzeEvidenceWithOpenAi({
      apiKey,
      audioTranscripts,
      fallback,
      input: parsed.data,
      visualEvidenceDataUrls,
    });

    return NextResponse.json(openAiAnalysis);
  } catch {
    return NextResponse.json(fallback);
  }
}

function parseEvidenceAnalysisRequest(
  input: unknown,
): ParsedEvidenceAnalysisRequest {
  if (!input || typeof input !== "object") {
    return {
      error: "Informe as evidencias do HelpDesk.",
      ok: false,
    };
  }

  const payload = input as Partial<HubItTicketEvidenceAnalysisInput>;
  const userDescription =
    typeof payload.userDescription === "string"
      ? payload.userDescription.trim().slice(0, 2_000)
      : "";
  const moduleName =
    typeof payload.module === "string" && payload.module.trim()
      ? payload.module.trim().slice(0, 80)
      : "Hub";
  const pathname =
    typeof payload.pathname === "string" && payload.pathname.trim()
      ? payload.pathname.trim().slice(0, 240)
      : "/";
  const category = isTicketCategory(payload.category)
    ? payload.category
    : "erro";
  const priority = isTicketPriority(payload.priority)
    ? payload.priority
    : "media";

  return {
    data: {
      attachments: normalizeEvidenceAttachments(payload.attachments),
      category,
      module: moduleName,
      pathname,
      priority,
      userDescription,
    },
    ok: true,
  };
}

function normalizeEvidenceAttachments(
  attachments: unknown,
): HubItTicketAttachmentInput[] {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments.slice(0, 3).flatMap((attachment) => {
    if (!attachment || typeof attachment !== "object") {
      return [];
    }

    const maybeAttachment = attachment as Partial<HubItTicketAttachmentInput>;
    const fileName = sanitizeText(maybeAttachment.fileName, 120);
    const mimeType = sanitizeText(maybeAttachment.mimeType, 120);
    const dataUrl = sanitizeDataUrl(maybeAttachment.dataUrl, 8_500_000);
    const capturedAt = sanitizeText(maybeAttachment.capturedAt, 60);
    const type = maybeAttachment.type;
    const sizeBytes = Number.isFinite(maybeAttachment.sizeBytes)
      ? Math.max(0, Math.trunc(Number(maybeAttachment.sizeBytes)))
      : 0;

    if (
      !fileName ||
      !mimeType ||
      !dataUrl ||
      !capturedAt ||
      !isAttachmentType(type)
    ) {
      return [];
    }

    const analysisDataUrls = normalizeAnalysisDataUrls(
      maybeAttachment.analysisDataUrls,
    );

    return [
      {
        ...(analysisDataUrls.length > 0 ? { analysisDataUrls } : {}),
        capturedAt,
        dataUrl,
        fileName,
        mimeType,
        sizeBytes,
        type,
      } satisfies HubItTicketAttachmentInput,
    ];
  });
}

function buildFallbackEvidenceAnalysis(
  input: HubItTicketEvidenceAnalysisInput,
): HubItTicketEvidenceAnalysis {
  const description =
    input.userDescription.trim() || "Evidencia anexada pelo usuario.";
  const evidenceInsights = buildEvidenceInsights(input.attachments);

  return {
    actualResult: inferActualResult(description, input),
    evidenceInsights,
    expectedResult: inferExpectedResult(description, input),
    source: "fallback",
    technicalSummary: [
      `Modulo afetado: ${input.module}`,
      `Rota/tela: ${input.pathname}`,
      `Tipo classificado: ${hubItTicketCategoryLabels[input.category]}`,
      `Impacto estimado: ${hubItTicketPriorityLabels[input.priority]}`,
      `Relato original: ${description}`,
      "Regras de negocio consideradas:",
      getBusinessRulesForInput(input).map((rule) => `- ${rule}`).join("\n"),
      "Evidencias consideradas:",
      evidenceInsights.map((item) => `- ${item}`).join("\n"),
      "Triagem Athena: comparar o comportamento observado com as regras do Panteon, preencher como deveria funcionar, o que ocorreu, validar evidencias e devolver status ao usuario pelo Zeus.",
    ].join("\n"),
  };
}

async function analyzeEvidenceWithOpenAi({
  apiKey,
  audioTranscripts,
  fallback,
  input,
  visualEvidenceDataUrls,
}: {
  apiKey: string;
  audioTranscripts: string[];
  fallback: HubItTicketEvidenceAnalysis;
  input: HubItTicketEvidenceAnalysisInput;
  visualEvidenceDataUrls: string[];
}) {
  const model = process.env.HUB_AI_MODEL?.trim() || DEFAULT_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      body: JSON.stringify({
        input: [
          {
            content: [
              {
                text: buildEvidenceAnalysisPrompt({
                  audioTranscripts,
                  fallback,
                  input,
                }),
                type: "input_text",
              },
              ...visualEvidenceDataUrls.map((imageUrl) => ({
                image_url: imageUrl,
                type: "input_image",
              })),
            ],
            role: "user",
          },
        ],
        instructions: [
          "Voce e a Athena, analista operacional do Panteon.",
          "Leia prints/imagens e quadros extraidos de video quando estiverem presentes.",
          "Use transcricoes de audio quando estiverem presentes.",
          "Compare o relato e as evidencias com as regras de negocio do Panteon enviadas no prompt.",
          "Preencha expectedResult com o comportamento correto segundo a regra de negocio.",
          "Preencha actualResult com a divergencia observada ou relatada pelo usuario.",
          "Nao invente evidencia. Se a imagem, audio ou video nao for conclusivo, registre isso de forma objetiva.",
          "Responda somente JSON valido, sem markdown.",
        ].join("\n"),
        max_output_tokens: 1_200,
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
    const result = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;

    if (!response.ok) {
      return fallback;
    }

    const parsed = parseEvidenceAnalysisJson(extractOutputText(result));

    if (!parsed?.technicalSummary) {
      return fallback;
    }

    const actualResult = sanitizeText(parsed.actualResult, 1_000);
    const expectedResult = sanitizeText(parsed.expectedResult, 1_000);
    const evidenceInsights: string[] =
      parsed.evidenceInsights.length > 0
        ? parsed.evidenceInsights.filter(
            (item): item is string => typeof item === "string" && item.length > 0,
          )
        : fallback.evidenceInsights;

    return {
      ...(actualResult ? { actualResult } : {}),
      evidenceInsights,
      ...(expectedResult ? { expectedResult } : {}),
      source: "openai",
      technicalSummary: parsed.technicalSummary,
    } satisfies HubItTicketEvidenceAnalysis;
  } finally {
    clearTimeout(timeout);
  }
}

function buildEvidenceAnalysisPrompt({
  audioTranscripts,
  fallback,
  input,
}: {
  audioTranscripts: string[];
  fallback: HubItTicketEvidenceAnalysis;
  input: HubItTicketEvidenceAnalysisInput;
}) {
  return [
    "Monte a leitura tecnica de um HelpDesk para o Zeus.",
    "Campos esperados no JSON:",
    '{"technicalSummary":"...","expectedResult":"...","actualResult":"...","evidenceInsights":["..."]}',
    "",
    `Modulo: ${input.module}`,
    `Rota/tela: ${input.pathname}`,
    `Tipo: ${hubItTicketCategoryLabels[input.category]}`,
    `Impacto: ${hubItTicketPriorityLabels[input.priority]}`,
    `Relato do usuario: ${input.userDescription || "Nao informado."}`,
    "",
    "Regras de negocio do Panteon para comparar comportamento observado:",
    getBusinessRulesForInput(input).map((rule) => `- ${rule}`).join("\n"),
    "",
    "Transcricoes de audio:",
    audioTranscripts.length
      ? audioTranscripts.map((item) => `- ${item}`).join("\n")
      : "- Nenhuma transcricao de audio.",
    "",
    "Base tecnica atual:",
    fallback.technicalSummary,
  ].join("\n");
}

async function transcribeAudioAttachments({
  apiKey,
  attachments,
}: {
  apiKey: string;
  attachments: HubItTicketAttachmentInput[];
}) {
  const audioAttachments = attachments
    .filter((attachment) => attachment.type === "audio" && attachment.dataUrl)
    .slice(0, MAX_AUDIO_EVIDENCES);
  const transcripts: string[] = [];

  for (const attachment of audioAttachments) {
    const transcript = await transcribeAudioAttachment({ apiKey, attachment });

    if (transcript) {
      transcripts.push(`${attachment.fileName}: ${transcript}`);
    }
  }

  return transcripts;
}

async function transcribeAudioAttachment({
  apiKey,
  attachment,
}: {
  apiKey: string;
  attachment: HubItTicketAttachmentInput;
}) {
  const blob = dataUrlToBlob(attachment.dataUrl, attachment.mimeType);

  if (!blob) {
    return "";
  }

  const formData = new FormData();
  formData.append(
    "model",
    process.env.HUB_IT_TICKET_TRANSCRIPTION_MODEL?.trim() ||
      DEFAULT_TRANSCRIPTION_MODEL,
  );
  formData.append("file", blob, attachment.fileName);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    body: formData,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | { text?: unknown }
    | null;

  return response.ok && typeof payload?.text === "string"
    ? payload.text.trim()
    : "";
}

function collectVisualEvidenceDataUrls(attachments: HubItTicketAttachmentInput[]) {
  const imageUrls: string[] = [];

  attachments.forEach((attachment) => {
    const attachmentDataUrl = attachment.dataUrl;

    if (
      attachment.type === "image" &&
      isSupportedImageDataUrl(attachmentDataUrl)
    ) {
      imageUrls.push(attachmentDataUrl);
    }

    attachment.analysisDataUrls?.forEach((dataUrl) => {
      if (isSupportedImageDataUrl(dataUrl)) {
        imageUrls.push(dataUrl);
      }
    });
  });

  return imageUrls.slice(0, MAX_IMAGE_EVIDENCES);
}

function buildEvidenceInsights(attachments: HubItTicketAttachmentInput[]) {
  if (attachments.length === 0) {
    return ["Sem print, video ou audio anexado."];
  }

  return attachments.map((attachment, index) => {
    const extra =
      attachment.type === "video" && attachment.analysisDataUrls?.length
        ? `, ${attachment.analysisDataUrls.length} quadro(s) extraido(s) para leitura visual`
        : "";

    return `${index + 1}. ${getAttachmentLabel(attachment.type)} ${attachment.fileName} (${formatBytes(attachment.sizeBytes)}${extra})`;
  });
}

function parseEvidenceAnalysisJson(value: string): {
  actualResult?: string;
  evidenceInsights: string[];
  expectedResult?: string;
  technicalSummary: string;
} | null {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");

  if (start < 0 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(value.slice(start, end + 1)) as {
      actualResult?: unknown;
      evidenceInsights?: unknown;
      expectedResult?: unknown;
      technicalSummary?: unknown;
    };
    const technicalSummary = sanitizeText(parsed.technicalSummary, 5_000);

    if (!technicalSummary) {
      return null;
    }

    return {
      actualResult: sanitizeText(parsed.actualResult, 1_000),
      evidenceInsights: Array.isArray(parsed.evidenceInsights)
        ? parsed.evidenceInsights
            .map((item) => sanitizeText(item, 500))
            .filter((item): item is string => Boolean(item))
            .slice(0, 8)
        : [],
      expectedResult: sanitizeText(parsed.expectedResult, 1_000),
      technicalSummary,
    };
  } catch {
    return null;
  }
}

function extractOutputText(payload: Record<string, unknown> | null) {
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

function normalizeAnalysisDataUrls(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => sanitizeDataUrl(item, 2_500_000))
    .filter((item): item is string => Boolean(item))
    .slice(0, 3);
}

function dataUrlToBlob(dataUrl?: string | null, fallbackMimeType?: string) {
  const match = dataUrl?.match(/^data:([^;]+);base64,(.+)$/);
  const base64Payload = match?.[2];

  if (!base64Payload) {
    return null;
  }

  const mimeType = match[1] || fallbackMimeType || "application/octet-stream";
  const buffer = Buffer.from(base64Payload, "base64");

  return new Blob([buffer], { type: mimeType });
}

function isSupportedImageDataUrl(value?: string | null): value is string {
  return Boolean(value?.match(/^data:image\/(?:png|jpe?g|webp|gif);base64,/i));
}

function sanitizeDataUrl(value: unknown, maxLength: number) {
  const text = sanitizeText(value, maxLength);

  return text?.startsWith("data:") ? text : undefined;
}

function sanitizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return undefined;
  }

  const text = value.trim().slice(0, maxLength);

  return text || undefined;
}

function isTicketCategory(value: unknown): value is HubItTicketCategory {
  return (
    value === "erro" ||
    value === "bug" ||
    value === "melhoria" ||
    value === "sugestao" ||
    value === "acesso" ||
    value === "performance" ||
    value === "outro"
  );
}

function isTicketPriority(value: unknown): value is HubItTicketPriority {
  return (
    value === "baixa" ||
    value === "media" ||
    value === "alta" ||
    value === "critica"
  );
}

function isAttachmentType(
  value: unknown,
): value is HubItTicketAttachmentInput["type"] {
  return (
    value === "audio" ||
    value === "image" ||
    value === "video" ||
    value === "file"
  );
}

function getBusinessRulesForInput(input: HubItTicketEvidenceAnalysisInput) {
  const normalizedModule = normalizeRuleText(input.module);
  const normalizedPath = normalizeRuleText(input.pathname);
  const scopedRules = PANTEON_BUSINESS_RULES.filter((rule) => {
    const normalizedRule = normalizeRuleText(rule);
    const matchesModule =
      normalizedModule.length > 0 && normalizedRule.includes(normalizedModule);
    const matchesPath =
      (normalizedPath.includes("hermes") &&
        normalizedRule.includes("hermes")) ||
      (normalizedPath.includes("hades") && normalizedRule.includes("hades")) ||
      (normalizedPath.includes("iris") && normalizedRule.includes("iris")) ||
      (normalizedPath.includes("zeus") && normalizedRule.includes("zeus"));

    return (
      normalizedRule.includes("panteon") ||
      normalizedRule.includes("athena") ||
      matchesModule ||
      matchesPath
    );
  });

  return scopedRules.length > 0
    ? scopedRules
    : Array.from(PANTEON_BUSINESS_RULES);
}

function normalizeRuleText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function inferExpectedResult(
  description: string,
  input: HubItTicketEvidenceAnalysisInput,
) {
  const match = description.match(/esperava(?: que)?(.+?)(?:\.|\n|$)/i);

  if (match?.[1]?.trim()) {
    return match[1].trim();
  }

  return [
    "O comportamento esperado deve seguir as regras de negocio do Panteon para o modulo informado.",
    getBusinessRulesForInput(input)[0],
  ]
    .filter(Boolean)
    .join(" ");
}

function inferActualResult(
  description: string,
  input: HubItTicketEvidenceAnalysisInput,
) {
  const match = description.match(/(?:aconteceu|ocorreu|erro)(.+?)(?:\.|\n|$)/i);

  if (match?.[1]?.trim()) {
    return match[1].trim();
  }

  return description || `Usuario relatou divergencia no modulo ${input.module}.`;
}

function getAttachmentLabel(type: HubItTicketAttachmentInput["type"]) {
  const labels = {
    audio: "Audio",
    file: "Arquivo",
    image: "Print",
    video: "Video",
  } as const satisfies Record<HubItTicketAttachmentInput["type"], string>;

  return labels[type];
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes = bytes / 1024;

  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(kilobytes >= 100 ? 0 : 1)} KB`;
  }

  const megabytes = kilobytes / 1024;

  return `${megabytes.toFixed(megabytes >= 10 ? 1 : 2)} MB`;
}
