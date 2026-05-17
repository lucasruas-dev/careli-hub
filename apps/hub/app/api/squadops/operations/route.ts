import { NextResponse } from "next/server";

import { loadEngineeringOperationsFromFile } from "@/lib/squadops/engineering-operations-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const result = await loadEngineeringOperationsFromFile();

  if (!result.data) {
    return NextResponse.json(
      { error: result.error ?? "Não foi possível ler o Engineering Operations." },
      { status: result.error?.includes("não encontrado") ? 404 : 500 },
    );
  }

  return NextResponse.json(result.data, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
