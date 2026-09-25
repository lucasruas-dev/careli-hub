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
    // ⚠️ `conferirNoC2x` (PAN-124): a sigla desta tela foi lida AO VIVO do C2X (`loadApoloEnterprises`),
    // então é conferida no C2X no mesmo instante, e não só no catálogo em cache (até 10 minutos), que
    // ainda pode não conhecer uma sigla nova ou dar uma sigla trocada ao outro empreendimento.
    const result = await loadApoloEnterpriseCadastro(codes, { conferirNoC2x: true });

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
