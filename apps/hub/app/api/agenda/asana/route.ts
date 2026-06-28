import { NextResponse, type NextRequest } from "next/server";

import { listUserAsanaTasks } from "@/lib/agenda/asana-bridge";
import { authorizeAgendaRequest } from "@/lib/agenda/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Ponte read-only: tarefas abertas do Asana do usuario logado, pra mesclar na
// tela "Meu dia" enquanto o modulo nativo de tarefas nao esta completo.
export async function GET(request: NextRequest) {
  const auth = await authorizeAgendaRequest(request);

  if (!auth.ok) {
    return auth.response;
  }

  const tasks = await listUserAsanaTasks(auth.user.email);

  return NextResponse.json({ tasks });
}
