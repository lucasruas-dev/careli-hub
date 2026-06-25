import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import {
  loadHadesKpiDrilldown,
  type HadesKpiDrilldownKey,
} from "@/lib/guardian/overview";
import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_KPIS: HadesKpiDrilldownKey[] = [
  "totalPortfolio",
  "delinquency",
  "overdueAmount",
  "monthlyRecovery",
  "overdueClients",
  "criticalContracts",
];

// Detalhamento (drill-down) por indicador do dashboard do Hades. Serve a lista
// real do C2X ao vivo correspondente ao card clicado. Fetch sob demanda.
export async function GET(request: NextRequest) {
  const auth = await authorizeHadesUser(request);

  if (!auth.ok) {
    return auth.response;
  }

  const kpiParam = request.nextUrl.searchParams.get("kpi");

  if (!kpiParam || !VALID_KPIS.includes(kpiParam as HadesKpiDrilldownKey)) {
    return NextResponse.json(
      { error: "Indicador invalido." },
      { status: 400 },
    );
  }

  const data = await loadHadesKpiDrilldown(kpiParam as HadesKpiDrilldownKey);

  if (!data) {
    return NextResponse.json(
      { error: "Detalhamento indisponivel. O C2X nao respondeu." },
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
