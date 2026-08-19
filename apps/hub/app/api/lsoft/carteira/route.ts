import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { lerCarteiraDoLsoft } from "@/lib/lsoft/carteira";

// A CARTEIRA DO LSOFT (Garden e Vale do Sol) — lista de clientes com o resumo de cada um.
//
// ⚠️ MESMA PORTA DO APOLO (`authorizeApoloRead`): aqui trafega CPF, RG, filiação e endereço de 237
// pessoas, então quem entra é o mesmo time que já vê o CRM. As tabelas `lsoft_*` são deny-all no
// RLS: quem lê é o servidor com a service role, nunca o navegador direto.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const resultado = await lerCarteiraDoLsoft({
    busca: url.searchParams.get("q"),
    empreendimento: url.searchParams.get("emp"),
  });

  if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 503 });

  return NextResponse.json(
    { data: { clientes: resultado.clientes, resumo: resultado.resumo } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
