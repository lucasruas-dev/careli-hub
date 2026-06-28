import { NextResponse, type NextRequest } from "next/server";

import { listUserMeetings } from "@/lib/agenda/agenda";
import { authorizeAgendaRequest } from "@/lib/agenda/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Reunioes do Chronos do usuario numa janela (read-only), pra mesclar na agenda
// do "Meu dia". Default: do inicio de hoje ate +7 dias.
export async function GET(request: NextRequest) {
  const auth = await authorizeAgendaRequest(request);

  if (!auth.ok) {
    return auth.response;
  }

  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setHours(0, 0, 0, 0);
  const defaultTo = new Date(defaultFrom);
  defaultTo.setDate(defaultTo.getDate() + 7);

  const fromIso =
    parseIso(request.nextUrl.searchParams.get("from")) ??
    defaultFrom.toISOString();
  const toIso =
    parseIso(request.nextUrl.searchParams.get("to")) ?? defaultTo.toISOString();

  const meetings = await listUserMeetings(
    auth.client,
    auth.user.id,
    fromIso,
    toIso,
  );

  return NextResponse.json({ meetings });
}

function parseIso(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
