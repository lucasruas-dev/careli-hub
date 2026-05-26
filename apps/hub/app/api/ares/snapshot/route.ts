import {
  createAuthorizedAresContext,
  loadAresSnapshot,
} from "@/lib/ares/server";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const context = await createAuthorizedAresContext(request);

  if (!context.ok) {
    return context.response;
  }

  const snapshot = await loadAresSnapshot(
    context,
    request.nextUrl.searchParams.get("financialBaseId"),
  );

  if (!snapshot.ok) {
    return NextResponse.json(
      {
        code: snapshot.code,
        error: snapshot.error,
      },
      { status: snapshot.status },
    );
  }

  return NextResponse.json({
    data: snapshot.data,
  });
}
