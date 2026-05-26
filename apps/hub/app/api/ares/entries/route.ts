import {
  createAresFinancialEntry,
  createAuthorizedAresContext,
} from "@/lib/ares/server";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const context = await createAuthorizedAresContext(request);

  if (!context.ok) {
    return context.response;
  }

  const payload = await request.json().catch(() => null);
  const result = await createAresFinancialEntry(context, payload);

  if (!result.ok) {
    return NextResponse.json(
      {
        code: result.code,
        error: result.error,
      },
      { status: result.status },
    );
  }

  return NextResponse.json(
    {
      data: result.data,
    },
    { status: 201 },
  );
}
