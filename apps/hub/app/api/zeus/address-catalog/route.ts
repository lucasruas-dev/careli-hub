import { type NextRequest } from "next/server";

import { authorizeZeusAdminRequest } from "@/lib/squadops/admin-access";
import { loadPanteonAddressRegistry } from "@/lib/squadops/address-registry-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeZeusAdminRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const registry = await loadPanteonAddressRegistry();

    return Response.json(registry, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel carregar o catalogo Address.",
      },
      { status: 500 },
    );
  }
}
