import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { loadApoloEnterpriseCadastro } from "@/lib/apolo/empreendimentos";

// Cadastro do empreendimento (dados gerais + players do C2X). Aceita N códigos porque a linha
// da tela pode ser um produto consolidado (cada etapa tem a sua ficha).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const codes = (new URL(request.url).searchParams.get("codes") ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

  if (!codes.length) {
    return NextResponse.json(
      { error: "Informe ao menos um codigo de empreendimento." },
      { status: 400 },
    );
  }

  try {
    const result = await loadApoloEnterpriseCadastro(codes);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }

    return NextResponse.json(
      { data: { cadastros: result.cadastros } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][empreendimentos] falha ao carregar cadastro", error);

    return NextResponse.json(
      { error: "Nao foi possivel carregar o cadastro." },
      { status: 500 },
    );
  }
}
