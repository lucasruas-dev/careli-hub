import { NextResponse, type NextRequest } from "next/server";

import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";
import {
  MetaWhatsAppSendError,
  registerMetaWhatsAppPhoneNumber,
} from "@/lib/iris/meta-whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Rota admin-only: ATIVA um numero na Cloud API (POST /{phone_number_id}/register),
// tirando-o de "Pendente" apos ser adicionado/migrado para a WABA Careli-Panteon.
// Usa o token do System User (server-side) — o mesmo que ja opera os outros numeros.
// O `pin` de 6 digitos vira a verificacao em duas etapas do numero (guardar).
export async function POST(request: NextRequest) {
  const auth = await authorizeIrisMetaRequest(request, ["admin"]);

  if (!auth.ok) {
    return auth.response;
  }

  let phoneNumberId: string | null = null;
  let pin: string | null = null;

  try {
    const input = (await request.json()) as {
      phoneNumberId?: unknown;
      pin?: unknown;
    };
    phoneNumberId =
      typeof input.phoneNumberId === "string" ? input.phoneNumberId.trim() : null;
    pin = typeof input.pin === "string" ? input.pin.trim() : null;
  } catch {
    phoneNumberId = null;
  }

  if (!phoneNumberId || !pin) {
    return NextResponse.json(
      { error: "Informe phoneNumberId e pin (6 digitos)." },
      { status: 400 },
    );
  }

  try {
    const result = await registerMetaWhatsAppPhoneNumber({ phoneNumberId, pin });

    return NextResponse.json(
      { ok: true, phoneNumberId, raw: result.raw, success: result.success },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof MetaWhatsAppSendError) {
      return NextResponse.json(
        {
          code: error.code ?? null,
          error: error.message,
          metaStatus: error.status,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { error: "Falha ao registrar o numero." },
      { status: 500 },
    );
  }
}
