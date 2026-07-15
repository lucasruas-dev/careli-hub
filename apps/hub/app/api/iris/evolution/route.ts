import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { processEvolutionWebhook } from "@/lib/iris/evolution-inbound-processor";
import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Webhook da Evolution API (instância caca-observadora) para monitoramento
// passivo de grupos de WhatsApp. Autenticado por segredo compartilhado no header.
// A Evolution é configurada para enviar apenas o evento messages.upsert aqui.

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.IRIS_EVOLUTION_WEBHOOK_SECRET;

  if (!expectedSecret) {
    return NextResponse.json(
      { error: "Webhook Evolution nao configurado no Iris." },
      { status: 503 },
    );
  }

  const providedSecret =
    request.headers.get("x-evolution-secret") ??
    request.headers.get("apikey") ??
    "";

  if (providedSecret !== expectedSecret) {
    return NextResponse.json(
      { error: "Segredo do webhook Evolution invalido." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Payload Evolution invalido." },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { error: "Payload Evolution invalido." },
      { status: 400 },
    );
  }

  const adminClient = createIrisEvolutionClient();

  if (!adminClient) {
    return NextResponse.json(
      { error: "Persistencia server-side do Iris nao configurada." },
      { status: 503 },
    );
  }

  const processing = await processEvolutionWebhook({
    client: adminClient,
    body: body as Parameters<typeof processEvolutionWebhook>[0]["body"],
  });

  return NextResponse.json(
    { ok: true, processing },
    { headers: { "Cache-Control": "no-store" }, status: 200 },
  );
}

function createIrisEvolutionClient() {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
