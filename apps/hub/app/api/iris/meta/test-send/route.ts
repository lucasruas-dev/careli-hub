import { NextResponse, type NextRequest } from "next/server";

import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";
import {
  MetaWhatsAppSendError,
  getMetaWhatsAppOutboundConfig,
  sendMetaWhatsAppTextMessage,
} from "@/lib/iris/meta-whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Rota de TESTE (admin-only): envia um texto por um phone_number_id especifico,
// sem depender do env global META_WHATSAPP_PHONE_NUMBER_ID. Usada pra validar o
// envio de numeros novos (Gurgel/4143) durante a migracao multi-WABA, sem trocar
// o env de producao. Reaproveitavel no fechamento de cada numero.
export async function POST(request: NextRequest) {
  const auth = await authorizeIrisMetaRequest(request, ["admin"]);

  if (!auth.ok) {
    return auth.response;
  }

  let phoneNumberId: string | null = null;
  let to: string | null = null;
  let body: string | null = null;

  try {
    const input = (await request.json()) as {
      body?: unknown;
      phoneNumberId?: unknown;
      to?: unknown;
    };
    phoneNumberId =
      typeof input.phoneNumberId === "string" ? input.phoneNumberId.trim() : null;
    to = typeof input.to === "string" ? input.to.trim() : null;
    body = typeof input.body === "string" ? input.body.trim() : null;
  } catch {
    phoneNumberId = null;
  }

  if (!phoneNumberId || !to || !body) {
    return NextResponse.json(
      { error: "Informe phoneNumberId, to e body." },
      { status: 400 },
    );
  }

  try {
    const result = await sendMetaWhatsAppTextMessage({
      body,
      config: { ...getMetaWhatsAppOutboundConfig(), phoneNumberId },
      to,
    });

    return NextResponse.json(
      {
        contactWaId: result.contactWaId,
        messageId: result.messageId,
        ok: true,
        phoneNumberId,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof MetaWhatsAppSendError) {
      return NextResponse.json(
        { code: error.code ?? null, error: error.message, metaStatus: error.status },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { error: "Falha no envio de teste." },
      { status: 500 },
    );
  }
}
