import { NextResponse, type NextRequest } from "next/server";

import {
  createSupabaseAdminClient,
  syncGuardianC2xReadModel,
} from "@/lib/guardian/read-model-sync";

type HubUserRole = "admin" | "leader" | "operator" | "viewer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const adminClient = createSupabaseAdminClient();

  if (!adminClient) {
    return NextResponse.json(
      { error: "Configure a chave server-side para sincronizar o Guardian." },
      { status: 503 },
    );
  }

  const authorization = await authorizeSyncRequest(request, adminClient);

  if (!authorization.ok) {
    return authorization.response;
  }

  const result = await syncGuardianC2xReadModel();

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      rowsWritten: result.rowsWritten,
      syncRunId: result.syncRunId,
    },
  });
}

async function authorizeSyncRequest(
  request: NextRequest,
  adminClient: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
) {
  const syncSecret = process.env.GUARDIAN_SYNC_SECRET;
  const providedSecret = request.headers.get("x-guardian-sync-secret");

  if (syncSecret && providedSecret && providedSecret === syncSecret) {
    return { ok: true as const };
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

  if (userError || !user || user.status !== "active" || user.role !== "admin") {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Usuario sem acesso a sincronizacao do Guardian." },
        { status: 403 },
      ),
    };
  }

  return { ok: true as const };
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}
