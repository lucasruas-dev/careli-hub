import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { atualizarIdentidade } from "@/lib/apolo/identidade-persist";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Correção de IDENTIDADE da ficha: nome, documento e tipo PF/PJ.
//
// Rota separada do PATCH da ficha de propósito. O PATCH grava campo a campo num jsonb e é
// reversível; isto troca quem a pessoa É — mexe em apolo_entities, nos identificadores e no
// índice de busca. Exige motivo, é auditado, e recusa ficha espelho do C2X (o resync
// desfaria em até 6 horas).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    documento?: string;
    motivo?: string;
    nome?: string;
    nomeFantasia?: string | null;
    tipo?: "pf" | "pj";
  };

  if (!body.nome || !body.documento || !body.tipo) {
    return NextResponse.json(
      { error: "Nome, documento e tipo sao obrigatorios." },
      { status: 400 },
    );
  }
  if (body.tipo !== "pf" && body.tipo !== "pj") {
    return NextResponse.json({ error: "Tipo invalido." }, { status: 400 });
  }

  const resultado = await atualizarIdentidade({
    autorUserId: auth.userId,
    client,
    documento: body.documento,
    entityId: id,
    motivo: body.motivo ?? "",
    nome: body.nome,
    nomeFantasia: body.nomeFantasia ?? null,
    tipo: body.tipo,
  });

  if (!resultado.ok) {
    // 409 para colisão e para ficha bloqueada: são conflitos de estado, não erro de entrada.
    const status =
      resultado.motivo === "colisao" || resultado.motivo === "bloqueado"
        ? 409
        : resultado.motivo === "nao_encontrada"
          ? 404
          : 400;
    return NextResponse.json({ error: resultado.erro, motivo: resultado.motivo }, { status });
  }

  return NextResponse.json({ data: { ok: true } });
}
