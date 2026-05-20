import {
  createAuthorizedAtlasContext,
  loadAtlasSnapshot,
} from "@/lib/atlas/server";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const context = await createAuthorizedAtlasContext(request);

  if (!context.ok) {
    return context.response;
  }

  const snapshot = await loadAtlasSnapshot();

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
