import { NextResponse, type NextRequest } from "next/server";

import { authorizeHadesRead } from "@/lib/guardian/auth";
import {
  createGuardianMotorClient,
  listGuardianCompromissoStages,
} from "@/lib/guardian/compromissos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Etapa do workflow derivada do motor por cliente (Auto - Hades), em lote. A
// fila e o detalhe consomem a MESMA fonte para a etapa ficar consistente.
// So retorna clientes que tem compromisso (conjunto pequeno).
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

  const data = await listGuardianCompromissoStages(client);

  return NextResponse.json({ data });
}
