import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import {
  listApoloDocuments,
  uploadApoloDocument,
  type ApoloDocScope,
} from "@/lib/apolo/documentos";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Documentos do Apolo por escopo: entidade (apolo_documents) ou empreendimento
// (apolo_enterprise_documents). GET lista; POST recebe o arquivo (base64) e grava no
// bucket privado. Escrita via service role (RLS só libera SELECT). Autor = display_name
// do hub_users. Ver [[project_apolo_cadastro_prospect]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Teto de segurança pro upload base64 (o arquivo cru infla ~33% em base64; docs de cadastro
// -- RG/CPF/comprovante/contrato -- cabem folgado). Evita estourar o body do route handler.
const MAX_FILE_BYTES = 15 * 1024 * 1024;

// Deriva o escopo a partir de qual dono veio na requisição.
function resolveScope(
  entityId: string | null,
  enterprise: string | null,
): { ownerId: string; scope: ApoloDocScope } | null {
  if (entityId) {
    return { ownerId: entityId, scope: "entidade" };
  }
  if (enterprise) {
    return { ownerId: enterprise, scope: "empreendimento" };
  }
  return null;
}

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const params = new URL(request.url).searchParams;
  const target = resolveScope(
    params.get("entityId")?.trim() || null,
    params.get("enterprise")?.trim() || null,
  );

  if (!target) {
    return NextResponse.json(
      { error: "Informe a entidade (entityId) ou o empreendimento (enterprise)." },
      { status: 400 },
    );
  }

  try {
    const documents = await listApoloDocuments(adminClient, target.scope, target.ownerId);
    return NextResponse.json(
      { documents },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][documentos] falha ao listar", error);
    return NextResponse.json(
      { error: "Nao foi possivel carregar os documentos." },
      { status: 500 },
    );
  }
}

type UploadPayload = {
  documentType?: unknown;
  enterprise?: unknown;
  entityId?: unknown;
  extractedPayload?: unknown;
  fileBase64?: unknown;
  fileName?: unknown;
  label?: unknown;
  mimeType?: unknown;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  let payload: UploadPayload;
  try {
    payload = (await request.json()) as UploadPayload;
  } catch {
    return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });
  }

  const target = resolveScope(
    asText(payload.entityId) || null,
    asText(payload.enterprise) || null,
  );

  if (!target) {
    return NextResponse.json(
      { error: "Informe a entidade (entityId) ou o empreendimento (enterprise)." },
      { status: 400 },
    );
  }

  const fileBase64 = asText(payload.fileBase64);
  const fileName = asText(payload.fileName);

  if (!fileBase64 || !fileName) {
    return NextResponse.json(
      { error: "Envie o arquivo e o nome do arquivo." },
      { status: 400 },
    );
  }

  // Estimativa do tamanho cru a partir do comprimento do base64 (sem decodificar duas vezes).
  const base64Body = fileBase64.includes(",") && fileBase64.startsWith("data:")
    ? fileBase64.slice(fileBase64.indexOf(",") + 1)
    : fileBase64;
  const approxBytes = Math.floor((base64Body.length * 3) / 4);
  if (approxBytes > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "Arquivo acima do limite de 15 MB." },
      { status: 413 },
    );
  }

  // Autor do upload (nome do operador que está anexando).
  const { data: operator } = await adminClient
    .from("hub_users")
    .select("display_name, email")
    .eq("id", authorization.userId)
    .maybeSingle<{ display_name: string | null; email: string | null }>();
  const uploadedByName = operator?.display_name ?? operator?.email ?? null;

  const result = await uploadApoloDocument({
    adminClient,
    documentType: asText(payload.documentType) || "anexo",
    extractedPayload: payload.extractedPayload,
    fileBase64,
    fileName,
    label: asText(payload.label) || fileName,
    mimeType: asText(payload.mimeType) || null,
    ownerId: target.ownerId,
    scope: target.scope,
    uploadedByName,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ id: result.id, ok: true }, { status: 201 });
}
