import {
  AtlasMutationError,
  createAtlasFpeEntry,
} from "@/lib/atlas/mutations";
import { createAuthorizedAtlasContext } from "@/lib/atlas/server";
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

    const entry = await createAtlasFpeEntry(context.user, {
      amount: payload?.amount,
      collaboratorId: payload?.collaboratorId,
      description: payload?.description,
      entryDate: payload?.entryDate,
      evidences: payload?.evidences,
      kind: payload?.kind,
      typeId: payload?.typeId,
    });

    return NextResponse.json({ data: entry }, { status: 201 });
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
      { error: "Nao foi possivel registrar o lancamento FPE." },
      { status: 500 },
    );
  }
}
