import { NextResponse, type NextRequest } from "next/server";

import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";
import {
  MetaWhatsAppSendError,
  listMetaWhatsAppWabaSubscribedApps,
  subscribeMetaWhatsAppAppToWaba,
} from "@/lib/iris/meta-whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Subscreve o app da Iris ao webhook de uma WABA (subscribed_apps) usando o
// token server-side — sem expor token. Admin-only. Primeiro tijolo do multi-WABA
// (conectar principal/Gurgel/juridico ao app sem mover numero entre WABAs).
export async function POST(request: NextRequest) {
  const auth = await authorizeIrisMetaRequest(request, ["admin"]);

  if (!auth.ok) {
    return auth.response;
  }

  let wabaId: string | null = null;

  try {
    const body = (await request.json()) as { wabaId?: unknown };
    wabaId = typeof body.wabaId === "string" ? body.wabaId.trim() : null;
  } catch {
    wabaId = null;
  }

  if (!wabaId) {
    return NextResponse.json(
      { error: "Informe o wabaId (id da conta do WhatsApp Business)." },
      { status: 400 },
    );
  }

  try {
    const subscription = await subscribeMetaWhatsAppAppToWaba({ wabaId });
    const subscribedApps = await listMetaWhatsAppWabaSubscribedApps({
      wabaId,
    }).catch(() => null);

    return NextResponse.json(
      {
        ok: true,
        subscribedApps,
        subscription,
        wabaId,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof MetaWhatsAppSendError) {
      return NextResponse.json(
        { code: error.code ?? null, error: error.message },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { error: "Falha ao subscrever a WABA no app." },
      { status: 500 },
    );
  }
}
