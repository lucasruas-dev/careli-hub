import { type NextRequest } from "next/server";

import { authorizeZeusAdminRequest } from "@/lib/squadops/admin-access";
import { loadReleaseRegistersFromFiles } from "@/lib/squadops/release-registers-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeZeusAdminRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const result = await loadReleaseRegistersFromFiles();
  const hasReadError = result.sources.some(
    (source) => source.exists && source.error,
  );
  const hasMissingSource = result.sources.some((source) => !source.exists);

  return Response.json(
    {
      ...result,
      status:
        hasReadError || hasMissingSource
          ? "fonte parcial"
          : "indices sincronizados",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
      status: hasReadError ? 500 : 200,
    },
  );
}
