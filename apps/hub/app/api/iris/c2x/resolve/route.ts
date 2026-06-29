import { NextResponse, type NextRequest } from "next/server";

import { resolveC2xEntitiesByContact } from "@/lib/apolo/server";
import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ResolveRequest = {
  documents?: unknown;
  limit?: unknown;
  phones?: unknown;
  query?: unknown;
};

export async function POST(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request, [
    "admin",
    "leader",
    "operator",
    "viewer",
  ]);

  if (!authorization.ok) {
    return authorization.response;
  }

  const input = (await request.json().catch(() => null)) as ResolveRequest | null;
  const phones = normalizeStringList(input?.phones);
  const documents = normalizeStringList(input?.documents);
  const query = typeof input?.query === "string" ? input.query : undefined;
  const limit =
    typeof input?.limit === "number" && Number.isFinite(input.limit)
      ? input.limit
      : undefined;

  const result = await resolveC2xEntitiesByContact({
    documents,
    limit,
    phones,
    query,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  return NextResponse.json(
    { data: { entities: result.entities } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 50);
}
