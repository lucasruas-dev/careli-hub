"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";

import { getHubItTicketAccessToken } from "./client";

// Sobe o arquivo DIRETO pro Supabase Storage: pedimos uma signed upload URL
// (request pequeno, sem o arquivo) e mandamos os bytes pro Storage. A function
// da Vercel nunca ve o arquivo, entao o limite de ~4.5MB de body deixa de valer.
// E por causa dele que a gravacao era 450 kbps e o print JPEG 82%.
export async function uploadHubItTicketAttachment({
  accessToken,
  blob,
  fileName,
}: {
  accessToken?: string | null;
  blob: Blob;
  fileName: string;
}): Promise<string | null> {
  const token = await getHubItTicketAccessToken(accessToken);
  const client = getHubSupabaseClient();

  if (!token || !client) {
    return null;
  }

  const contentType = blob.type || "application/octet-stream";

  try {
    const signResponse = await fetch("/api/hub/it-tickets/attachment-upload", {
      body: JSON.stringify({ fileName }),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!signResponse.ok) {
      return null;
    }

    const signed = (await signResponse.json()) as {
      bucket?: string;
      path?: string;
      token?: string;
    };

    if (!signed.bucket || !signed.path || !signed.token) {
      return null;
    }

    const upload = await client.storage
      .from(signed.bucket)
      .uploadToSignedUrl(signed.path, signed.token, blob, { contentType });

    if (upload.error) {
      return null;
    }

    return signed.path;
  } catch {
    return null;
  }
}
