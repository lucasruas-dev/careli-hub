import { NextResponse } from "next/server";

import { createPrometeuClient, jornadaDoCredenciado } from "@/lib/prometeu/data";
import { autorizarOperacao } from "@/lib/prometeu/operador-server";

// A JORNADA de UM cliente (modal da Central). Buscada só ao abrir o modal — não entra no polling da
// fila, que carrega todo mundo. Aceita a sessão do hub OU o cookie do operador.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarOperacao(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const credenciadoId = new URL(request.url).searchParams.get("credenciadoId")?.trim() ?? "";
  if (!credenciadoId) {
    return NextResponse.json({ error: "Informe o credenciadoId." }, { status: 400 });
  }

  const passos = await jornadaDoCredenciado(client, credenciadoId);
  return NextResponse.json(
    { data: { passos } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
