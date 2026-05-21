import {
  createAuthorizedAtlasContext,
} from "@/lib/atlas/server";
import {
  AtlasMutationError,
  createAtlasOccurrence,
} from "@/lib/atlas/mutations";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const context = await createAuthorizedAtlasContext(request);

  if (!context.ok) {
    return context.response;
  }

  try {
    const payload = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;

    const occurrence = await createAtlasOccurrence(context.user, {
      collaboratorId: payload?.collaboratorId,
      evidences: payload?.evidences,
      occurrenceDate: payload?.occurrenceDate,
      observation: payload?.observation,
      typeId: payload?.typeId,
    });

    return NextResponse.json({ data: occurrence }, { status: 201 });
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
      { error: "Nao foi possivel abrir a ocorrencia Atlas." },
      { status: 500 },
    );
  }
}
