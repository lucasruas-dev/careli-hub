// Documentos do Apolo (entidade e empreendimento). Arquivos vivem no bucket PRIVADO
// `apolo-documents`; a linha guarda so o caminho + metadados (+ o que o iOCR extraiu, quando
// vem do cadastro MOST). Todo acesso passa por aqui (service role) e a leitura usa URL
// assinada. Ver [[project_apolo_cadastro_prospect]].
import type { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export const APOLO_DOCS_BUCKET = "apolo-documents";
const SIGNED_URL_TTL = 60 * 10; // 10 min

export type ApoloDocScope = "empreendimento" | "entidade";

export type ApoloDocumentItem = {
  createdAt: string;
  documentType: string;
  fileName: string | null;
  hasFile: boolean;
  id: string;
  label: string;
  sizeBytes: number | null;
  status: string;
  uploadedBy: string | null;
};

// Cada escopo tem sua tabela e sua coluna-dono.
const TABLE: Record<ApoloDocScope, { name: string; ownerColumn: string }> = {
  empreendimento: { name: "apolo_enterprise_documents", ownerColumn: "enterprise_code" },
  entidade: { name: "apolo_documents", ownerColumn: "entity_id" },
};

type DocRow = {
  created_at: string;
  document_type: string;
  id: string;
  label: string;
  metadata: { fileName?: string; sizeBytes?: number; uploadedByName?: string } | null;
  status: string;
  storage_path: string | null;
};

function mapDoc(row: DocRow): ApoloDocumentItem {
  const meta = row.metadata ?? {};
  return {
    createdAt: row.created_at,
    documentType: row.document_type,
    fileName: meta.fileName ?? null,
    hasFile: Boolean(row.storage_path),
    id: row.id,
    label: row.label,
    sizeBytes: meta.sizeBytes ?? null,
    status: row.status,
    uploadedBy: meta.uploadedByName ?? null,
  };
}

export async function listApoloDocuments(
  adminClient: AdminClient,
  scope: ApoloDocScope,
  ownerId: string,
): Promise<ApoloDocumentItem[]> {
  const { name, ownerColumn } = TABLE[scope];
  const { data } = await adminClient
    .from(name)
    .select("id, document_type, label, status, storage_path, metadata, created_at")
    .eq(ownerColumn, ownerId)
    .order("created_at", { ascending: false })
    .limit(500);

  return (data ?? []).map((row) => mapDoc(row as DocRow));
}

export async function uploadApoloDocument(input: {
  adminClient: AdminClient;
  documentType: string;
  extractedPayload?: unknown;
  fileBase64: string;
  fileName: string;
  label: string;
  mimeType?: string | null;
  ownerId: string;
  scope: ApoloDocScope;
  uploadedByName: string | null;
}): Promise<{ error?: string; id?: string; ok: boolean }> {
  const bytes = decodeBase64(input.fileBase64);
  if (!bytes) {
    return { error: "Arquivo invalido.", ok: false };
  }

  const { name, ownerColumn } = TABLE[input.scope];
  const safeName = sanitize(input.fileName);
  const storagePath = `${input.scope}/${input.ownerId}/${crypto.randomUUID()}-${safeName}`;
  const contentType = input.mimeType || guessMime(safeName);

  const upload = await input.adminClient.storage
    .from(APOLO_DOCS_BUCKET)
    .upload(storagePath, bytes, { contentType, upsert: false });

  if (upload.error) {
    return { error: `Falha ao enviar o arquivo: ${upload.error.message}`, ok: false };
  }

  const row: Record<string, unknown> = {
    [ownerColumn]: input.ownerId,
    document_type: input.documentType,
    label: input.label,
    status: "ready",
    storage_bucket: APOLO_DOCS_BUCKET,
    storage_path: storagePath,
    metadata: {
      fileName: input.fileName,
      sizeBytes: bytes.byteLength,
      source: "apolo",
      uploadedByName: input.uploadedByName,
    },
  };
  // extracted_payload só existe na tabela de entidade (o iOCR do cadastro).
  if (input.scope === "entidade" && input.extractedPayload !== undefined) {
    row.extracted_payload = input.extractedPayload;
  }

  const { data, error } = await input.adminClient
    .from(name)
    .insert(row)
    .select("id")
    .single();

  if (error) {
    // Best-effort: remove o arquivo orfao se o registro falhou.
    await input.adminClient.storage.from(APOLO_DOCS_BUCKET).remove([storagePath]);
    return { error: `Falha ao registrar o documento: ${error.message}`, ok: false };
  }

  return { id: (data as { id: string }).id, ok: true };
}

export async function getApoloDocumentSignedUrl(
  adminClient: AdminClient,
  scope: ApoloDocScope,
  documentId: string,
): Promise<{ error?: string; url?: string }> {
  const { name } = TABLE[scope];
  const { data: doc } = await adminClient
    .from(name)
    .select("storage_bucket, storage_path")
    .eq("id", documentId)
    .maybeSingle<{ storage_bucket: string | null; storage_path: string | null }>();

  if (!doc?.storage_path) {
    return { error: "Documento sem arquivo." };
  }

  const signed = await adminClient.storage
    .from(doc.storage_bucket ?? APOLO_DOCS_BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL);

  if (signed.error || !signed.data?.signedUrl) {
    return { error: "Nao foi possivel gerar o link do arquivo." };
  }

  return { url: signed.data.signedUrl };
}

export async function deleteApoloDocument(
  adminClient: AdminClient,
  scope: ApoloDocScope,
  documentId: string,
): Promise<{ error?: string; ok: boolean }> {
  const { name } = TABLE[scope];
  const { data: doc } = await adminClient
    .from(name)
    .select("storage_bucket, storage_path")
    .eq("id", documentId)
    .maybeSingle<{ storage_bucket: string | null; storage_path: string | null }>();

  if (doc?.storage_path) {
    await adminClient.storage
      .from(doc.storage_bucket ?? APOLO_DOCS_BUCKET)
      .remove([doc.storage_path]);
  }

  const { error } = await adminClient.from(name).delete().eq("id", documentId);
  if (error) {
    return { error: "Nao foi possivel remover o documento.", ok: false };
  }
  return { ok: true };
}

// ---- helpers -------------------------------------------------------------------------------

function decodeBase64(value: string): Uint8Array | null {
  try {
    const raw = value.includes(",") && value.startsWith("data:")
      ? value.slice(value.indexOf(",") + 1)
      : value;
    return Uint8Array.from(Buffer.from(raw, "base64"));
  } catch {
    return null;
  }
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "documento";
}

function guessMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    pdf: "application/pdf",
    png: "image/png",
    webp: "image/webp",
  };
  return (ext && map[ext]) || "application/octet-stream";
}
