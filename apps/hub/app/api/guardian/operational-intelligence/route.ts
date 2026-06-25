import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { loadHadesOperationalIntelligenceReadModel } from "@/lib/guardian/read-model";
import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Inteligencia operacional do dashboard do Hades (aging por cliente + top 15
// inadimplentes). Serve da tabela read-model (Supabase, barata); o cron de sync
// mantem fresca em prod. Fetch unico no mount do dashboard (nao e polled).
export async function GET(request: NextRequest) {
  const auth = await authorizeHadesUser(request);

  if (!auth.ok) {
    return auth.response;
  }

  const data = await loadHadesOperationalIntelligenceReadModel();

  if (!data) {
    return NextResponse.json(
      {
        error:
          "Inteligencia operacional indisponivel. Rode uma sincronizacao do C2X.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { data },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function authorizeHadesUser(request: NextRequest) {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Configure a chave server-side para carregar o Hades." },
        { status: 503 },
      ),
    };
  }

  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (!accessToken) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Sessao administrativa ausente." },
        { status: 401 },
      ),
    };
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } =
    await adminClient.auth.getUser(accessToken);

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
    .maybeSingle<{ id: string; role: string; status: string }>();

  if (userError || !user || user.status !== "active") {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Usuario sem acesso ao Hades." },
        { status: 403 },
      ),
    };
  }

  return { ok: true as const };
}
