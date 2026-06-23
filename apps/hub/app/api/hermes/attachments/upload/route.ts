import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

// Anexos do Hermes: esta rota NAO recebe o arquivo. Ela gera uma SIGNED UPLOAD URL e o
// cliente envia o arquivo DIRETO pro Supabase Storage (bypass da function da Vercel) —
// assim nao batemos no limite de ~4.5MB de body das serverless. O bucket e publico
// (leitura), entao a URL publica do anexo funciona pra todos. O signed URL autoriza o
// upload sem precisar de RLS na storage.objects.
const HERMES_ATTACHMENT_BUCKET = "hermes-attachments";
const MAX_HERMES_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const context = await createAuthorizedContext(request);

  if (!context.ok) {
    return context.response;
  }

  const body = (await request.json().catch(() => null)) as {
    fileName?: unknown;
  } | null;
  const fileName = typeof body?.fileName === "string" ? body.fileName : "";

  const existingBucket = await context.adminClient.storage.getBucket(
    HERMES_ATTACHMENT_BUCKET,
  );

  if (existingBucket.error) {
    await context.adminClient.storage.createBucket(HERMES_ATTACHMENT_BUCKET, {
      fileSizeLimit: MAX_HERMES_ATTACHMENT_BYTES,
      public: true,
    });
  } else {
    // Garante que um bucket pre-existente (criado antes com limite menor) aceite 50MB.
    await context.adminClient.storage.updateBucket(HERMES_ATTACHMENT_BUCKET, {
      fileSizeLimit: MAX_HERMES_ATTACHMENT_BYTES,
      public: true,
    });
  }

  const storagePath = `${context.userId}/${crypto.randomUUID()}${getExtensionFromName(fileName)}`;
  const signed = await context.adminClient.storage
    .from(HERMES_ATTACHMENT_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (signed.error || !signed.data) {
    return NextResponse.json(
      { error: "Nao foi possivel preparar o envio do anexo." },
      { status: 500 },
    );
  }

  const publicUrl = context.adminClient.storage
    .from(HERMES_ATTACHMENT_BUCKET)
    .getPublicUrl(storagePath).data.publicUrl;

  return NextResponse.json({
    bucket: HERMES_ATTACHMENT_BUCKET,
    path: signed.data.path,
    publicUrl,
    token: signed.data.token,
  });
}

async function createAuthorizedContext(request: NextRequest) {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Configure a chave server-side para enviar anexos." },
        { status: 503 },
      ),
    };
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Sessao ausente." }, { status: 401 }),
    };
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data: authData, error: authError } =
    await adminClient.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Sessao invalida." }, { status: 401 }),
    };
  }

  const { data: currentUser, error: currentUserError } = await adminClient
    .from("hub_users")
    .select("id,status")
    .eq("id", authData.user.id)
    .maybeSingle<{ id: string; status: string }>();

  if (currentUserError || !currentUser || currentUser.status !== "active") {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Usuario sem permissao para enviar anexos." },
        { status: 403 },
      ),
    };
  }

  return {
    adminClient,
    ok: true as const,
    userId: currentUser.id,
  };
}

function getExtensionFromName(fileName: string) {
  const extension = /\.([a-z0-9]{1,8})$/i.exec(fileName)?.[1];

  return extension ? `.${extension.toLowerCase()}` : "";
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}
