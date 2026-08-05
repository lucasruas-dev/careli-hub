import { NextResponse, type NextRequest } from "next/server";

import { lerEstadoDaConexao, vigiarConexaoDosGrupos } from "@/lib/iris/evolution-saude";

// VIGIA DA CONEXÃO DOS GRUPOS — roda de 5 em 5 minutos (cron do vercel.json).
//
// Em 03/08 a sessão do WhatsApp caiu às 7h57 e só foi descoberta às 14h41, quando a operadora
// tentou responder um cliente e levou erro. Quase 7 horas de grupos mudos, sem ninguém saber.
// Este vigia troca esse "descobrir pelo pior caminho" por um aviso na central do hub.
//
// GET  = cron (avisa na virada: caiu / voltou).
// POST = checagem manual, mesma autorização.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function autorizado(request: NextRequest): boolean {
  if (request.headers.get("x-vercel-cron")) return true;
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && token === secret);
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) {
    // Sem credencial devolve só o estado, sem disparar aviso: serve de health check simples.
    const saude = await lerEstadoDaConexao();
    return NextResponse.json(
      { data: { estado: saude.estado, ok: saude.ok } },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const resultado = await vigiarConexaoDosGrupos();
  return NextResponse.json({ data: resultado }, { headers: { "Cache-Control": "no-store" } });
}
