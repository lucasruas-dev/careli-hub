import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import { createAuthorizedAtlasContext } from "@/lib/atlas/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ATLAS_EVIDENCE_BUCKET = "atlas-evidences";
const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;
const ALLOWED_EVIDENCE_MIME_TYPES = new Set([
  "application/msword",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
]);

export async function POST(request: NextRequest) {
  const context = await createAuthorizedAtlasContext(request);

  if (!context.ok) {
    return context.response;
  }

  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Configure a chave server-side do Hub para anexar arquivos." },
      { status: 503 },
    );
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const occurrenceId = getFormString(formData?.get("occurrenceId"));

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Selecione um arquivo para anexar." },
      { status: 400 },
    );
  }

  if (file.size <= 0) {
    return NextResponse.json(
      { error: "O arquivo selecionado esta vazio." },
      { status: 400 },
    );
  }

  if (file.size > MAX_EVIDENCE_BYTES) {
    return NextResponse.json(
      { error: "O arquivo deve ter no maximo 15 MB." },
      { status: 400 },
    );
  }

  if (file.type && !ALLOWED_EVIDENCE_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Tipo de arquivo nao permitido para evidencia Atlas." },
      { status: 400 },
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const bucketReady = await ensureAtlasEvidenceBucket(adminClient);

  if (!bucketReady) {
    return NextResponse.json(
      { error: "Nao foi possivel preparar o armazenamento de evidencias." },
      { status: 500 },
    );
  }

  const extension = getFileExtension(file.name);
  const storagePath = [
    new Date().getFullYear(),
    context.user.id,
    occurrenceId || "drafts",
    `${crypto.randomUUID()}${extension}`,
  ].join("/");
  const uploadResult = await adminClient.storage
    .from(ATLAS_EVIDENCE_BUCKET)
    .upload(storagePath, await file.arrayBuffer(), {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadResult.error) {
    return NextResponse.json(
      { error: "Nao foi possivel anexar o arquivo." },
      { status: 500 },
    );
  }

  const publicUrl = adminClient.storage
    .from(ATLAS_EVIDENCE_BUCKET)
    .getPublicUrl(storagePath).data.publicUrl;

  return NextResponse.json({
    data: {
      bucket: ATLAS_EVIDENCE_BUCKET,
      name: sanitizeEvidenceName(file.name),
      path: storagePath,
      size: file.size,
      type: file.type || "arquivo",
      url: publicUrl,
    },
  });
}

async function ensureAtlasEvidenceBucket(adminClient: SupabaseClient) {
  const bucket = await adminClient.storage.getBucket(ATLAS_EVIDENCE_BUCKET);

  if (!bucket.error) {
    return true;
  }

  const result = await adminClient.storage.createBucket(ATLAS_EVIDENCE_BUCKET, {
    allowedMimeTypes: [...ALLOWED_EVIDENCE_MIME_TYPES],
    fileSizeLimit: MAX_EVIDENCE_BYTES,
    public: true,
  });

  return !result.error;
}

function getFileExtension(fileName: string) {
  const safeName = sanitizeEvidenceName(fileName);
  const extension = safeName.match(/\.[a-z0-9]{1,12}$/i)?.[0]?.toLowerCase();

  return extension ?? "";
}

function sanitizeEvidenceName(fileName: string) {
  const normalizedName = fileName
    .trim()
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 160);

  return normalizedName || "evidencia";
}

function getFormString(value: FormDataEntryValue | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}
