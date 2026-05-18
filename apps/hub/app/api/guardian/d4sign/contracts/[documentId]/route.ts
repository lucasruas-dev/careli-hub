import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const D4SIGN_API_BASE_URL = "https://secure.d4sign.com.br/api/v1";

type HubUserRole = "admin" | "leader" | "operator" | "viewer";

type D4SignDownloadResponse = {
  message?: string;
  url?: string;
};

type GuardianD4SignApiDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      hub_users: {
        Insert: never;
        Relationships: [];
        Row: {
          id: string;
          role: HubUserRole;
          status: string;
        };
        Update: never;
      };
    };
    Views: Record<string, never>;
  };
};

function inlinePdfHeaders(documentId: string, contentLength?: string | null) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Disposition": `inline; filename="contrato-${documentId}.pdf"`,
    "Content-Type": "application/pdf",
    "X-Content-Type-Options": "nosniff",
  });

  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  return headers;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> },
) {
  const authorization = await createAuthorizedContext(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const { documentId } = await context.params;
  const decodedDocumentId = decodeURIComponent(documentId ?? "").trim();

  if (!decodedDocumentId) {
    return NextResponse.json(
      { error: "Documento D4Sign nao informado." },
      { status: 400 },
    );
  }

  const tokenAPI = process.env.D4SIGN_TOKEN_API;
  const cryptKey = process.env.D4SIGN_CRYPT_KEY;

  if (!tokenAPI || !cryptKey) {
    return NextResponse.json(
      { error: "Credenciais D4Sign nao configuradas no Hub." },
      { status: 503 },
    );
  }

  const searchParams = new URLSearchParams({
    cryptKey,
    tokenAPI,
  });
  const url = `${D4SIGN_API_BASE_URL}/documents/${encodeURIComponent(
    decodedDocumentId,
  )}/download?${searchParams.toString()}`;

  try {
    const response = await fetch(url, {
      body: JSON.stringify({ language: "pt", type: "PDF" }),
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const payload = (await response
      .json()
      .catch(() => null)) as D4SignDownloadResponse | null;

    if (!response.ok || !payload?.url) {
      return NextResponse.json(
        {
          detail: payload?.message,
          error: "Nao foi possivel gerar um novo link do contrato D4Sign.",
        },
        { status: 502 },
      );
    }

    const documentResponse = await fetch(payload.url, {
      cache: "no-store",
      redirect: "follow",
    });

    if (!documentResponse.ok) {
      return NextResponse.json(
        { error: "Nao foi possivel abrir o contrato D4Sign." },
        { status: 502 },
      );
    }

    const contentType = documentResponse.headers.get("content-type") ?? "";
    const documentBody = await documentResponse.arrayBuffer();

    if (
      contentType.includes("application/pdf") ||
      contentType.includes("application/octet-stream")
    ) {
      return new Response(documentBody, {
        headers: inlinePdfHeaders(
          decodedDocumentId,
          documentResponse.headers.get("content-length"),
        ),
      });
    }

    return new Response(documentBody, {
      headers: new Headers({
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="contrato-${decodedDocumentId}.html"`,
        "Content-Type": contentType || "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      }),
      status: documentResponse.status,
    });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel conectar ao D4Sign agora." },
      { status: 502 },
    );
  }
}

async function createAuthorizedContext(request: NextRequest) {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Configure a chave server-side para abrir contratos do Guardian." },
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

  const adminClient = createClient<GuardianD4SignApiDatabase>(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
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

  const { data: user, error: userError } = await adminClient
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<{ id: string; role: HubUserRole; status: string }>();

  if (userError || !user || user.status !== "active") {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Usuario sem acesso ao Guardian." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    user,
  };
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}
