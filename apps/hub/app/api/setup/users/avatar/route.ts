import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

type HubUserRole = "admin" | "leader" | "operator" | "viewer";

type AvatarDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      hub_users: {
        Insert: never;
        Relationships: [];
        Row: {
          avatar_url?: string | null;
          id: string;
          role: HubUserRole;
          status: string;
        };
        Update: {
          avatar_url?: string | null;
        };
      };
    };
    Views: Record<string, never>;
  };
};

const AVATAR_BUCKET = "hub-avatars";
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const context = await createAuthorizedContext(request);

  if (!context.ok) {
    return context.response;
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const userId = getFormString(formData?.get("userId"));

  if (!userId) {
    return NextResponse.json(
      { error: "Informe o usuario da foto." },
      { status: 400 },
    );
  }

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Importe um arquivo PNG." },
      { status: 400 },
    );
  }

  if (file.type !== "image/png") {
    return NextResponse.json(
      { error: "A foto precisa ser um PNG." },
      { status: 400 },
    );
  }

  if (file.size > MAX_AVATAR_BYTES) {
    return NextResponse.json(
      { error: "A foto deve ter no maximo 2 MB." },
      { status: 400 },
    );
  }

  await ensureAvatarBucket(context.adminClient);

  const storagePath = `${userId}/${crypto.randomUUID()}.png`;
  const uploadResult = await context.adminClient.storage
    .from(AVATAR_BUCKET)
    .upload(storagePath, await file.arrayBuffer(), {
      contentType: "image/png",
      upsert: false,
    });

  if (uploadResult.error) {
    return NextResponse.json(
      { error: "Nao foi possivel importar a foto." },
      { status: 500 },
    );
  }

  const publicUrl = context.adminClient.storage
    .from(AVATAR_BUCKET)
    .getPublicUrl(storagePath).data.publicUrl;

  const { data: targetAuthUser } = await context.adminClient.auth.admin.getUserById(
    userId,
  );

  await context.adminClient.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...(targetAuthUser.user?.user_metadata ?? {}),
      avatar_url: publicUrl,
    },
  });

  const { error: profileError } = await context.adminClient
    .from("hub_users")
    .update({ avatar_url: publicUrl })
    .eq("id", userId);

  if (profileError) {
    return NextResponse.json(
      { error: "Foto importada, mas nao foi possivel atualizar o perfil." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    avatarUrl: publicUrl,
  });
}

async function createAuthorizedContext(request: NextRequest) {
  const serverEnv = process.env as Record<string, string | undefined>;
  const supabaseUrl = serverEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Configure a chave server-side para importar fotos." },
        { status: 503 },
      ),
    };
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Sessao administrativa ausente." },
        { status: 401 },
      ),
    };
  }

  const adminClient = createClient<AvatarDatabase>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data: authData, error: authError } = await adminClient.auth.getUser(
    accessToken,
  );

  if (authError || !authData.user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Sessao administrativa invalida." },
        { status: 401 },
      ),
    };
  }

  const { data: currentUser, error: currentUserError } = await adminClient
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<{ id: string; role: HubUserRole; status: string }>();

  if (
    currentUserError ||
    currentUser?.role !== "admin" ||
    currentUser.status !== "active"
  ) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Apenas administradores podem importar fotos." },
        { status: 403 },
      ),
    };
  }

  return {
    adminClient,
    ok: true as const,
  };
}

async function ensureAvatarBucket(
  adminClient: ReturnType<typeof createClient<AvatarDatabase>>,
) {
  const bucket = await adminClient.storage.getBucket(AVATAR_BUCKET);

  if (!bucket.error) {
    return;
  }

  await adminClient.storage.createBucket(AVATAR_BUCKET, {
    allowedMimeTypes: ["image/png"],
    fileSizeLimit: MAX_AVATAR_BYTES,
    public: true,
  });
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}

function getFormString(value: FormDataEntryValue | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}
