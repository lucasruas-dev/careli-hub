import { type NextRequest } from "next/server";

import { getVercelCostHistory } from "@/lib/operations/cost";
import { authorizeZeusAdminRequest } from "@/lib/squadops/admin-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Historico de custo por periodo (popup com filtro de datas na Saude do HUB).
export async function GET(request: NextRequest) {
  const authorization = await authorizeZeusAdminRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const params = request.nextUrl.searchParams;
  const history = await getVercelCostHistory(
    params.get("from") ?? "",
    params.get("to") ?? "",
  );

  return Response.json(history, {
    headers: { "Cache-Control": "no-store" },
  });
}
