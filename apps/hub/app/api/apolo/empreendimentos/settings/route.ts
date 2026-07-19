import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import {
  listEnterpriseSettings,
  setEnterpriseCredenciamento,
} from "@/lib/apolo/enterprise-settings";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Settings do empreendimento. Hoje só o flag `credenciamentoAtivo` (empreendimento na ativa,
// recebendo CAD/credenciamento) — o portal de credenciamento oferece somente os ativos.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const settings = await listEnterpriseSettings(adminClient);
  return NextResponse.json(
    { data: { settings } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  let body: { ativo?: boolean; code?: string; enterpriseId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });
  }

  if (!body.enterpriseId || typeof body.ativo !== "boolean") {
    return NextResponse.json(
      { error: "Informe o empreendimento e o estado (ativo)." },
      { status: 400 },
    );
  }

  const result = await setEnterpriseCredenciamento({
    adminClient,
    ativo: body.ativo,
    code: body.code,
    enterpriseId: body.enterpriseId,
    updatedBy: auth.userId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ data: { ativo: body.ativo } });
}
