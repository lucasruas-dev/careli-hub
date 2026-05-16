import { NextResponse, type NextRequest } from "next/server";

import { loadPaymentViewingInfo } from "@/lib/guardian/asaas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const paymentId = request.nextUrl.searchParams.get("paymentId")?.trim();

  if (!paymentId) {
    return NextResponse.json(
      { error: "Parcela nao informada." },
      { status: 400 },
    );
  }

  try {
    const viewing = await loadPaymentViewingInfo(paymentId);

    return NextResponse.json({ viewing });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel consultar a visualizacao no Asaas." },
      { status: 500 },
    );
  }
}
