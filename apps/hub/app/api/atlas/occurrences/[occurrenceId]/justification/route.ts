import {
  reviewAtlasOccurrenceJustification,
  submitAtlasOccurrenceJustification,
  AtlasMutationError,
} from "@/lib/atlas/mutations";
import { createAuthorizedAtlasContext } from "@/lib/atlas/server";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ occurrenceId: string }> },
) {
  const atlasContext = await createAuthorizedAtlasContext(request);

  if (!atlasContext.ok) {
    return atlasContext.response;
  }

  const { occurrenceId } = await context.params;

  try {
    const payload = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    const action = payload?.action;

    if (action === "submit") {
      const occurrence = await submitAtlasOccurrenceJustification(
        atlasContext.user,
        {
          justification: payload?.justification,
          occurrenceId,
        },
      );

      return NextResponse.json({ data: occurrence });
    }

    if (action === "accept" || action === "reject") {
      const occurrence = await reviewAtlasOccurrenceJustification(
        atlasContext.user,
        {
          action,
          occurrenceId,
          reviewNote: payload?.reviewNote,
        },
      );

      return NextResponse.json({ data: occurrence });
    }

    return NextResponse.json(
      { error: "Acao de justificativa invalida." },
      { status: 400 },
    );
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
      { error: "Nao foi possivel atualizar a justificativa Atlas." },
      { status: 500 },
    );
  }
}
