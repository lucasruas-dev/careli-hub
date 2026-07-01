import { Buffer } from "node:buffer";

import type Anthropic from "@anthropic-ai/sdk";

import { getAnthropicClient, resolveClaudeModel } from "@/lib/ai/claude";
import { extractDocumentText } from "./document-extract";
import {
  downloadMetaWhatsAppMedia,
  type MetaWhatsAppDownloadedMedia,
  type MetaWhatsAppOutboundConfig,
} from "@/lib/iris/meta-whatsapp";

export type CacaInboundMediaType =
  | "audio"
  | "document"
  | "image"
  | "unknown"
  | "video";

export type CacaInboundMedia = {
  caption?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  providerMediaId?: string | null;
  sha256?: string | null;
  // URL pública durável após persistir no Supabase Storage (preenchida no inbound, p/ o player tocar).
  storedUrl?: string | null;
  type: CacaInboundMediaType;
  voice?: boolean | null;
};

export type CacaInboundMediaAnalysis = {
  error?: string | null;
  fileName?: string | null;
  mediaType: CacaInboundMediaType;
  mimeType?: string | null;
  model?: string | null;
  reason?: string | null;
  sizeBytes?: number | null;
  status: "error" | "ok" | "skipped";
  summary?: string | null;
  transcript?: string | null;
};

const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const OPENAI_MEDIA_TIMEOUT_MS = 20_000;
const MEDIA_SIZE_LIMITS_BYTES: Record<CacaInboundMediaType, number> = {
  audio: 25_000_000,
  document: 20_000_000,
  image: 8_000_000,
  unknown: 8_000_000,
  video: 25_000_000,
};

export async function analyzeCacaInboundMedia({
  config,
  media,
  preloaded,
}: {
  config?: MetaWhatsAppOutboundConfig;
  media: CacaInboundMedia;
  // Download já feito no inbound (compartilhado com o upload pro Storage) — evita baixar 2x.
  preloaded?: MetaWhatsAppDownloadedMedia | null;
}): Promise<CacaInboundMediaAnalysis> {
  const mediaType = normalizeCacaMediaType(media.type, media.mimeType);
  const providerMediaId = media.providerMediaId?.trim();

  if (!providerMediaId) {
    return {
      mediaType,
      mimeType: media.mimeType ?? null,
      reason: "Mensagem de midia sem ID do provedor.",
      status: "skipped",
    };
  }

  // OpenAI agora SO transcreve audio (Whisper). Imagem e PDF leem via Claude.
  const openAiKey = process.env.OPENAI_API_KEY?.trim();

  try {
    const downloaded =
      preloaded ??
      (await downloadMetaWhatsAppMedia({
        config,
        mediaId: providerMediaId,
      }));
    const mimeType =
      downloaded.mimeType ?? media.mimeType ?? "application/octet-stream";
    const normalizedType = normalizeCacaMediaType(mediaType, mimeType);
    const sizeBytes = downloaded.buffer.byteLength;
    const fileName = normalizeFileName(media, mimeType);
    const sizeLimit = MEDIA_SIZE_LIMITS_BYTES[normalizedType];

    if (sizeBytes > sizeLimit) {
      return {
        fileName,
        mediaType: normalizedType,
        mimeType,
        reason: `Arquivo acima do limite operacional (${sizeLimit} bytes).`,
        sizeBytes,
        status: "skipped",
      };
    }

    if (normalizedType === "audio") {
      if (!openAiKey) {
        return {
          fileName,
          mediaType: normalizedType,
          mimeType,
          reason: "OPENAI_API_KEY ausente para transcricao de audio (Whisper).",
          sizeBytes,
          status: "skipped",
        };
      }

      const model =
        process.env.HUB_IT_TICKET_TRANSCRIPTION_MODEL?.trim() ||
        DEFAULT_TRANSCRIPTION_MODEL;
      const transcript = await transcribeCacaAudio({
        apiKey: openAiKey,
        buffer: downloaded.buffer,
        fileName,
        mimeType,
        model,
      });

      return {
        fileName,
        mediaType: normalizedType,
        mimeType,
        model,
        sizeBytes,
        status: "ok",
        summary: transcript
          ? `Audio transcrito para apoiar a resposta da Caca: ${truncateForPrompt(
              transcript,
              1200,
            )}`
          : "Audio recebido, mas a transcricao veio vazia.",
        transcript,
      };
    }

    // Imagem e PDF leem via Claude (visao/documento nativo). Video o Claude nao processa.
    const summary = await summarizeCacaMedia({
      buffer: downloaded.buffer,
      caption: media.caption ?? null,
      fileName,
      mediaType: normalizedType,
      mimeType,
    });

    return {
      fileName,
      mediaType: normalizedType,
      mimeType,
      model: resolveClaudeModel("default"),
      sizeBytes,
      status: summary ? "ok" : "skipped",
      summary:
        summary ||
        "Midia recebida, mas a leitura automatica (Claude) nao retornou conteudo utilizavel.",
    };
  } catch (error) {
    return {
      error: sanitizeMediaError(error),
      mediaType,
      mimeType: media.mimeType ?? null,
      status: "error",
    };
  }
}

async function transcribeCacaAudio({
  apiKey,
  buffer,
  fileName,
  mimeType,
  model,
}: {
  apiKey: string;
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  model: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_MEDIA_TIMEOUT_MS);
  const formData = new FormData();
  const bytes = Uint8Array.from(buffer);

  formData.append("model", model);
  formData.append("file", new Blob([bytes], { type: mimeType }), fileName);

  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      body: formData,
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
      throw new Error(
        readString(payload?.error?.message) ??
          "OpenAI nao conseguiu transcrever o audio.",
      );
    }

    return readString(payload?.text) ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

async function summarizeCacaMedia({
  buffer,
  caption,
  fileName,
  mediaType,
  mimeType,
}: {
  buffer: Buffer;
  caption: string | null;
  fileName: string;
  mediaType: CacaInboundMediaType;
  mimeType: string;
}): Promise<string | null> {
  // Claude le IMAGEM e PDF nativo. Video o Claude nao processa. Documento que nao e
  // PDF (planilha/docx/csv/txt) e binario -> extraimos o texto no servidor e mandamos
  // o texto pro modelo. So sobra null pra tipos sem leitura (ai a Caca cai no fallback).
  if (mediaType === "video") {
    return null;
  }

  const client = getAnthropicClient();

  if (!client) {
    return null;
  }

  const isImage = mediaType === "image";
  const isPdf = mimeType.toLowerCase().includes("pdf");

  const instruction = [
    "Analise este anexo recebido no atendimento WhatsApp da Iris.",
    "Extraia somente informacoes uteis para a Caca responder o cliente com seguranca.",
    "Nao invente dados. Se algo estiver ilegivel, informe a limitacao.",
    "Responda em ate 8 linhas, em portugues do Brasil.",
    `Tipo de midia: ${mediaType}`,
    `Nome do arquivo: ${fileName}`,
    `Legenda/caption enviada pelo cliente: ${caption ?? "nao informada"}`,
  ].join("\n");

  let content: Anthropic.ContentBlockParam[];

  if (isImage) {
    content = [
      { text: instruction, type: "text" },
      {
        source: {
          data: buffer.toString("base64"),
          media_type: normalizeClaudeImageMediaType(mimeType),
          type: "base64",
        },
        type: "image",
      },
    ];
  } else if (isPdf) {
    content = [
      { text: instruction, type: "text" },
      {
        source: {
          data: buffer.toString("base64"),
          media_type: "application/pdf",
          type: "base64",
        },
        type: "document",
      },
    ];
  } else {
    const extracted = await extractDocumentText({ buffer, fileName, mimeType });
    if (!extracted) {
      return null;
    }
    content = [
      {
        text: `${instruction}\n\nConteudo extraido do anexo (${extracted.format}):\n"""\n${extracted.text}\n"""`,
        type: "text",
      },
    ];
  }

  const response = await client.messages.create(
    {
      max_tokens: 500,
      messages: [{ content, role: "user" }],
      model: resolveClaudeModel("default"),
    },
    { timeout: OPENAI_MEDIA_TIMEOUT_MS },
  );

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text ? truncateForPrompt(text, 1800) : null;
}

function normalizeClaudeImageMediaType(
  mimeType: string,
): "image/gif" | "image/jpeg" | "image/png" | "image/webp" {
  const normalized = mimeType.toLowerCase();

  if (normalized.includes("png")) {
    return "image/png";
  }

  if (normalized.includes("gif")) {
    return "image/gif";
  }

  if (normalized.includes("webp")) {
    return "image/webp";
  }

  return "image/jpeg";
}

function normalizeCacaMediaType(
  value: CacaInboundMediaType,
  mimeType?: string | null,
): CacaInboundMediaType {
  const normalizedMime = mimeType?.toLowerCase() ?? "";

  if (value !== "unknown") {
    return value;
  }

  if (normalizedMime.startsWith("audio/")) {
    return "audio";
  }

  if (normalizedMime.startsWith("image/")) {
    return "image";
  }

  if (normalizedMime.startsWith("video/")) {
    return "video";
  }

  if (normalizedMime.includes("pdf") || normalizedMime.startsWith("text/")) {
    return "document";
  }

  return "unknown";
}

function normalizeFileName(media: CacaInboundMedia, mimeType: string) {
  const provided = media.fileName?.trim();

  if (provided) {
    return provided.slice(0, 120);
  }

  return `iris-${media.type}-${Date.now()}.${extensionForMime(mimeType)}`;
}

function extensionForMime(mimeType: string) {
  const normalized = mimeType.toLowerCase();

  if (normalized.includes("ogg")) {
    return "ogg";
  }

  if (normalized.includes("mpeg") || normalized.includes("mp3")) {
    return "mp3";
  }

  if (normalized.includes("webm")) {
    return "webm";
  }

  if (normalized.includes("png")) {
    return "png";
  }

  if (normalized.includes("jpeg") || normalized.includes("jpg")) {
    return "jpg";
  }

  if (normalized.includes("pdf")) {
    return "pdf";
  }

  if (normalized.includes("mp4")) {
    return "mp4";
  }

  return "bin";
}

function truncateForPrompt(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function sanitizeMediaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return truncateForPrompt(message.replace(/https?:\/\/\S+/gi, "[url]"), 300);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
