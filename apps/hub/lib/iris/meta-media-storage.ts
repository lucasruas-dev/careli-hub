import { Buffer } from "node:buffer";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  downloadMetaWhatsAppMedia,
  type MetaWhatsAppOutboundConfig,
} from "@/lib/iris/meta-whatsapp";

// Mídia recebida pelo WhatsApp (áudio etc.) é baixada da Meta uma única vez e persistida num
// bucket PÚBLICO do Supabase Storage. A Meta NÃO entrega uma URL durável (a do Graph expira em
// minutos e exige o access token no header) e o carregador de mensagens da Iris roda no browser
// (`"use client"`, auth Bearer não-cookie) — então um proxy autenticado não tocaria no <audio>.
// Persistir a URL pública (path imprevisível, mesmo modelo do `hermes-attachments`) deixa o player
// tocar sem mudar nada no frontend. Best-effort: falha aqui não pode derrubar o inbound.
export const IRIS_MEDIA_BUCKET = "iris-media";
const MAX_IRIS_MEDIA_BYTES = 50 * 1024 * 1024;

let bucketEnsured = false;

async function ensureIrisMediaBucket(client: SupabaseClient) {
  if (bucketEnsured) {
    return;
  }

  const existing = await client.storage.getBucket(IRIS_MEDIA_BUCKET);

  if (existing.error) {
    await client.storage.createBucket(IRIS_MEDIA_BUCKET, {
      fileSizeLimit: MAX_IRIS_MEDIA_BYTES,
      public: true,
    });
  }

  bucketEnsured = true;
}

export type PersistedInboundMedia = {
  mimeType: string | null;
  sizeBytes: number;
  url: string;
};

// Sobe um buffer pro bucket de mídia da Iris (público). `folder`/`name` montam o path —
// `inbound/<mediaId>` (entrada) ou `outbound/<uuid>` (áudio enviado pelo operador).
export async function uploadIrisMediaBuffer({
  buffer,
  client,
  folder,
  mimeType,
  name,
}: {
  buffer: Buffer;
  client: SupabaseClient;
  folder: string;
  mimeType?: string | null;
  name: string;
}): Promise<PersistedInboundMedia | null> {
  const safeName = sanitizePathSegment(name);

  if (!safeName) {
    return null;
  }

  const resolvedMime = mimeType ?? "application/octet-stream";

  await ensureIrisMediaBucket(client);

  // Path determinístico + upsert → reprocessar o mesmo arquivo não duplica.
  const storagePath = `${folder}/${safeName}.${extensionForMime(resolvedMime)}`;
  const bytes = Uint8Array.from(Buffer.from(buffer));
  const upload = await client.storage
    .from(IRIS_MEDIA_BUCKET)
    .upload(storagePath, bytes, {
      contentType: resolvedMime,
      upsert: true,
    });

  if (upload.error) {
    throw new Error(upload.error.message);
  }

  const publicUrl = client.storage
    .from(IRIS_MEDIA_BUCKET)
    .getPublicUrl(storagePath).data.publicUrl;

  return {
    mimeType: resolvedMime,
    sizeBytes: buffer.byteLength,
    url: publicUrl,
  };
}

// Mídia recebida da Meta (download compartilhado com a CACÁ no inbound; baixado no backfill).
export async function uploadInboundMediaBuffer({
  buffer,
  client,
  mediaId,
  mimeType,
}: {
  buffer: Buffer;
  client: SupabaseClient;
  mediaId: string;
  mimeType?: string | null;
}): Promise<PersistedInboundMedia | null> {
  return uploadIrisMediaBuffer({
    buffer,
    client,
    folder: "inbound",
    mimeType,
    name: mediaId,
  });
}

// Baixa da Meta e sobe pro Storage (usado pelo backfill, que só tem o mediaId).
export async function persistInboundMediaToStorage({
  client,
  config,
  mediaId,
  mimeType,
}: {
  client: SupabaseClient;
  config?: MetaWhatsAppOutboundConfig;
  mediaId: string;
  mimeType?: string | null;
}): Promise<PersistedInboundMedia | null> {
  const normalizedId = mediaId.trim();

  if (!normalizedId) {
    return null;
  }

  const downloaded = await downloadMetaWhatsAppMedia({
    config,
    mediaId: normalizedId,
  });

  return uploadInboundMediaBuffer({
    buffer: downloaded.buffer,
    client,
    mediaId: normalizedId,
    mimeType: downloaded.mimeType ?? mimeType,
  });
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120) || "media";
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

  if (normalized.includes("wav")) {
    return "wav";
  }

  if (normalized.includes("amr")) {
    return "amr";
  }

  if (normalized.includes("mp4")) {
    return "mp4";
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

  return "bin";
}
