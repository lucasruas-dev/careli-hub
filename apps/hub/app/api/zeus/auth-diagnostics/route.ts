import { type NextRequest } from "next/server";

import { collectAuthDiagnostics } from "@/lib/operations/auth-diagnostics";
import { authorizeZeusAdminRequest } from "@/lib/squadops/admin-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeZeusAdminRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const diagnostics = await collectAuthDiagnostics();

  return Response.json(diagnostics, {
    headers: {
      "Cache-Control": "no-store",
    },
    status: diagnostics.status === "indisponivel" ? 503 : 200,
  });
}
