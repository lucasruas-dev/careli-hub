import { NextResponse } from "next/server";

import { PROMETEU_SESSION_COOKIE } from "@/lib/prometeu/operador-auth";

// Logout do operador do evento: apaga o cookie de sessao (maxAge 0). ROTA PUBLICA — nao ha o que
// autorizar; quem nao tem cookie sai igual.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const resposta = NextResponse.json({ data: { ok: true } });
  resposta.cookies.set(PROMETEU_SESSION_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: true,
  });
  return resposta;
}
