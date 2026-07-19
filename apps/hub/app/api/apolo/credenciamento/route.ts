import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import {
  consultarImobiliariaPorCnpj,
  listEmpreendimentosAtivos,
} from "@/lib/apolo/credenciamento";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Portal de credenciamento de imobiliárias.
//  GET  -> empreendimentos "na ativa" (com logo) que podem ser habilitados.
//  POST -> consulta por CNPJ: acha a imobiliária e onde ela já atua.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const empreendimentos = await listEmpreendimentosAtivos(adminClient);
  return NextResponse.json(
    { data: { empreendimentos } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  let body: { cnpj?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });
  }

  const digits = (body.cnpj ?? "").replace(/\D/g, "");
  if (digits.length !== 14) {
    return NextResponse.json({ error: "Informe um CNPJ valido." }, { status: 400 });
  }

  const consulta = await consultarImobiliariaPorCnpj(adminClient, digits);
  return NextResponse.json(
    { data: { consulta } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
