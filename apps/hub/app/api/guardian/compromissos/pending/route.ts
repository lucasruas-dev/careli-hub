import { NextResponse, type NextRequest } from "next/server";

import { authorizeHadesRead } from "@/lib/guardian/auth";
import {
  createGuardianMotorClient,
  listAllGuardianCompromissos,
  listGuardianCompromissosByApproval,
  type GuardianApprovalStatus,
} from "@/lib/guardian/compromissos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APPROVAL_STATUSES: GuardianApprovalStatus[] = [
  "em_elaboracao",
  "pendente",
  "aprovado",
  "reprovado",
];

// Propostas (todos os clientes) por estado de aprovacao (?status=, default
// pendente). ?status=all traz todas (tabela/overview da Central de Propostas).
// Leitura para qualquer papel operacional; a DECISAO (aprovar/reprovar) e
// admin-only e vive em /[id]/approval.
export async function GET(request: NextRequest) {
  const auth = await authorizeHadesRead(request);

  if (!auth.ok) {
    return auth.response;
  }

  const requested = request.nextUrl.searchParams.get("status");

  const client = createGuardianMotorClient();

  if (!client) {
    return NextResponse.json(
      { error: "Configure a chave server-side para acessar a cobranca." },
      { status: 503 },
    );
  }

  if (requested === "all") {
    const data = await listAllGuardianCompromissos(client);
    return NextResponse.json({ data });
  }

  const status: GuardianApprovalStatus = APPROVAL_STATUSES.includes(
    requested as GuardianApprovalStatus,
  )
    ? (requested as GuardianApprovalStatus)
    : "pendente";

  const data = await listGuardianCompromissosByApproval(client, status);

  return NextResponse.json({ data });
}
