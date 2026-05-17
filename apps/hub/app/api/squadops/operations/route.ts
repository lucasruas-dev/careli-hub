import { NextResponse, type NextRequest } from "next/server";

import { authorizeSquadOpsAdminRequest } from "@/lib/squadops/admin-access";
import { loadEngineeringOperationsFromFile } from "@/lib/squadops/engineering-operations-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeSquadOpsAdminRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const result = await loadEngineeringOperationsFromFile();

  if (!result.data) {
    return NextResponse.json(
      { error: result.error ?? "Não foi possível ler o Engineering Operations." },
      { status: result.error?.includes("não encontrado") ? 404 : 500 },
    );
  }

  return NextResponse.json(result.data, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
