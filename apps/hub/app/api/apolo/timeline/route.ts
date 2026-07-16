import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { loadApoloEntityTimeline } from "@/lib/apolo/timeline";

// Timeline (ficha corrida) da entidade: agrega Iris/Hades/Chronos + pagamentos do C2X,
// resolvendo a identidade por c2xId ∪ e-mails ∪ telefones. Ver [[project_apolo_timeline]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function csv(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
  const c2xIdRaw = Number(params.get("c2xId"));
  const c2xId = Number.isInteger(c2xIdRaw) && c2xIdRaw > 0 ? c2xIdRaw : null;
  const emails = csv(params.get("emails")).map((email) => email.toLowerCase());
  const phones = csv(params.get("phones"));

  if (!c2xId && !emails.length && !phones.length) {
    return NextResponse.json(
      { error: "Sem identidade (c2xId/emails/phones) para montar a timeline." },
      { status: 400 },
    );
  }

  try {
    const result = await loadApoloEntityTimeline({ adminClient, c2xId, emails, phones });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }

    return NextResponse.json(
      { data: result.data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][timeline] falha ao carregar timeline", error);

    return NextResponse.json(
      { error: "Nao foi possivel carregar a timeline." },
      { status: 500 },
    );
  }
}
