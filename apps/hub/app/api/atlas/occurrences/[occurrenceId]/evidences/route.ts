import {
  createAuthorizedAtlasContext,
} from "@/lib/atlas/server";
import {
  addAtlasOccurrenceEvidences,
  AtlasMutationError,
} from "@/lib/atlas/mutations";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    occurrenceId: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const atlasContext = await createAuthorizedAtlasContext(request);

  if (!atlasContext.ok) {
    return atlasContext.response;
  }

  try {
    const { occurrenceId } = await context.params;
    const payload = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    const evidences = await addAtlasOccurrenceEvidences(atlasContext.user, {
      evidences: payload?.evidences,
      occurrenceId,
    });

    return NextResponse.json({ data: evidences }, { status: 201 });
  } catch (error) {
    if (error instanceof AtlasMutationError) {
      return NextResponse.json(
        {
          code: error.code,
          error: error.message,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { error: "Nao foi possivel registrar evidencias no Atlas." },
      { status: 500 },
    );
  }
}
