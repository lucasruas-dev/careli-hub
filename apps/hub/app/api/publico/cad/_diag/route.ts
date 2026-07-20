import { NextResponse } from "next/server";

// DIAGNÓSTICO TEMPORÁRIO. Remover assim que o 503 da SESSAO_CAD_SECRET for resolvido.
// Retorna SÓ o comprimento das variáveis (nunca o valor), para descobrir o que o RUNTIME de
// produção realmente enxerga — o `vercel env pull` mascara valores como "[Encrypted]" e não
// serve para diagnóstico.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const len = (name: string) => (process.env[name] ?? "").trim().length;
  return NextResponse.json({
    sessaoLen: len("SESSAO_CAD_SECRET"),
    supabaseUrlLen: len("SUPABASE_URL"),
    nextPublicSupabaseUrlLen: len("NEXT_PUBLIC_SUPABASE_URL"),
  });
}
