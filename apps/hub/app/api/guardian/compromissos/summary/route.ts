import { NextResponse, type NextRequest } from "next/server";

import { authorizeHadesRead } from "@/lib/guardian/auth";
import {
  createGuardianMotorClient,
  getGuardianCompromissosFinancialSummary,
} from "@/lib/guardian/compromissos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Saude financeira da recuperacao (Visao geral do cockpit do gestor): em
// negociacao, a receber, recuperado, quebrado, previsibilidade e por
// empreendimento. Leitura para qualquer papel operacional.
export async function GET(request: NextRequest) {
  const auth = await authorizeHadesRead(request);

  if (!auth.ok) {
    return auth.response;
  }

  const client = createGuardianMotorClient();

  if (!client) {
    return NextResponse.json(
      { error: "Configure a chave server-side para acessar a cobranca." },
      { status: 503 },
    );
  }

  const data = await getGuardianCompromissosFinancialSummary(client);

  return NextResponse.json({ data });
}
