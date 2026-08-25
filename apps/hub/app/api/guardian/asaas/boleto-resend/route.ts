import { NextResponse, type NextRequest } from "next/server";

import {
  prepareBoletoResendAction,
  type BoletoResendMode,
} from "@/lib/guardian/asaas";
import { authorizeHadesWrite } from "@/lib/guardian/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // ⚠️ ESTA ERA A UNICA ROTA DO HADES QUE NAO CONSULTAVA `hub_users` (1 de 14): a guarda local so
  // perguntava "existe um JWT valido do projeto?", entao conta DESATIVADA continuava puxando o link
  // publico de fatura do Asaas de qualquer parcela. Agora entra pela mesma porta das outras, que
  // confere status e papel do usuario.
  const auth = await authorizeHadesWrite(request);

  if (!auth.ok) {
    return auth.response;
  }

  const body = (await request.json().catch(() => null)) as
    | {
        deliveryMode?: unknown;
        paymentId?: unknown;
      }
    | null;
  const paymentId =
    typeof body?.paymentId === "string" ? body.paymentId.trim() : "";
  const deliveryMode = parseDeliveryMode(body?.deliveryMode);

  if (!paymentId) {
    return NextResponse.json(
      { error: "Parcela nao informada para reenvio." },
      { status: 400 },
    );
  }

  try {
    const action = await prepareBoletoResendAction(paymentId, deliveryMode);

    return NextResponse.json({
      action,
      source: "c2x",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel preparar o reenvio do boleto.",
      },
      { status: 422 },
    );
  }
}

function parseDeliveryMode(_value: unknown): BoletoResendMode {
  // Disparo nativo do Asaas (pago) desativado por decisao de custo: sempre "link".
  return "link";
}

