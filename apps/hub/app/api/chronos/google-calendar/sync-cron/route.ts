import { syncChronosGoogleCalendar } from "@/lib/chronos/google-calendar";
import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

// Sync automatico Google Agenda -> Chronos via Vercel Cron. Antes o pull so
// rodava CLIENT-SIDE (abrir/focar a aba + intervalo de 20min) — com o hub
// fechado, mudancas no Google nunca chegavam ao Chronos. O watch/webhook do
// Google foi aposentado (expirava em ~7 dias sem renovacao), entao o cron e o
// caminho canonico de atualizacao; o sync manual (botao G) segue funcionando.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type ChronosGoogleConnectionRow = {
  created_by_user_id: string | null;
  id: string;
  status: string | null;
};

type ChronosSyncCronOutcome = {
  connectionId: string;
  error?: string;
  processed: number;
  status: string;
  synced: number;
};

export async function GET(request: NextRequest) {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Configure a chave server-side." },
      { status: 503 },
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (!(await isAuthorizedSyncCron(request, admin))) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const connectionsResult = await admin
    .from("chronos_google_calendar_connections")
    .select("id,created_by_user_id,status")
    .eq("status", "active")
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .returns<ChronosGoogleConnectionRow[]>();

  if (connectionsResult.error) {
    return NextResponse.json(
      { error: "Falha ao listar conexoes do Google Agenda." },
      { status: 500 },
    );
  }

  const outcomes: ChronosSyncCronOutcome[] = [];

  // Sequencial de proposito: cada pull ja e paginado/limitado internamente e o
  // paralelo dispararia varias chamadas Google + gravacoes simultaneas a toa.
  for (const connection of connectionsResult.data ?? []) {
    if (!connection.created_by_user_id) {
      continue;
    }

    try {
      const result = await syncChronosGoogleCalendar({
        direction: "pull",
        userId: connection.created_by_user_id,
      });

      outcomes.push({
        connectionId: connection.id,
        error: result.error,
        processed: result.processed,
        status: result.status,
        synced: result.synced,
      });
    } catch (error) {
      outcomes.push({
        connectionId: connection.id,
        error:
          error instanceof Error && error.message.trim()
            ? error.message
            : "Falha desconhecida no sync.",
        processed: 0,
        status: "failed",
        synced: 0,
      });
    }
  }

  const failures = outcomes.filter((outcome) => outcome.status === "failed");

  console.info("[chronos/google-sync-cron] finished", {
    connections: outcomes.length,
    failed: failures.length,
    outcomes,
  });

  return NextResponse.json(
    { failures: failures.length, outcomes },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function isAuthorizedSyncCron(
  request: NextRequest,
  admin: SupabaseClient,
): Promise<boolean> {
  // Cron interno do Vercel — este header e removido de requisicoes externas.
  if (request.headers.get("x-vercel-cron")) {
    return true;
  }

  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (!token) {
    return false;
  }

  const cronSecret = process.env.CRON_SECRET?.trim();

  if (cronSecret && token === cronSecret) {
    return true;
  }

  // Fallback: admin logado (permite disparo manual para teste).
  const { data: authData } = await admin.auth.getUser(token);

  if (!authData.user) {
    return false;
  }

  const { data: hubUser } = await admin
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<{ id: string; role: string; status: string }>();

  return hubUser?.role === "admin" && hubUser.status === "active";
}
