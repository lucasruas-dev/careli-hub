import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import {
  CAMPOS_DA_PARCELA,
  type CampoDaParcela,
  salvarParcelaDoLsoft,
} from "@/lib/lsoft/carteira";

// EDIÇÃO DE UMA PARCELA do LSoft: vencimento, valor e se foi paga.
//
// ⚠️ QUEM ASSINA É A SESSÃO, não o corpo do pedido — mesma regra da edição de cadastro. Aceitar um
// "autor" enviado pela tela transformaria a trilha em ficção.
//
// ⚠️ ISTO MEXE EM DINHEIRO. Só é aceitável porque a carga do LSoft foi única e este banco virou a
// fonte; toda alteração fica registrada com valor anterior, valor novo, autor e data.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const corpo = (await request.json().catch(() => null)) as
    | { campos?: Record<string, unknown> }
    | null;

  if (!corpo?.campos) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  const campos: Partial<Record<CampoDaParcela, null | string>> = {};
  for (const campo of CAMPOS_DA_PARCELA) {
    if (campo in corpo.campos) {
      const valor = corpo.campos[campo];
      campos[campo] =
        valor === null || valor === undefined
          ? null
          : typeof valor === "boolean"
            ? String(valor)
            : String(valor);
    }
  }

  const resultado = await salvarParcelaDoLsoft({
    autor: auth.userId,
    campos,
    parcelaId: id,
  });

  if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 400 });

  return NextResponse.json({ data: { alterados: resultado.alterados } });
}
