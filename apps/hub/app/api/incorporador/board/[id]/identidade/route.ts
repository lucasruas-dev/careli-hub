import { NextResponse } from "next/server";

import { atualizarIdentidade } from "@/lib/apolo/identidade-persist";
import {
  adminOu503,
  autorizarComercial,
  cadNoEscopo,
  recorteDoProduto,
} from "@/lib/apolo/incorporador/board-do-portal";

// Correção de IDENTIDADE da ficha pelo portal comercial — POST /api/incorporador/board/[id]/identidade?emp=
//
// Mesmas regras da rota do hub (`atualizarIdentidade`: valida CPF/CNPJ, recusa documento
// repetido, exige motivo, é auditada, recusa ficha espelho do C2X), com o escopo conferido antes:
// a pessoa tem que ter CAD (ou vínculo de imobiliária) no produto do coordenador. Fora dele: 404.
//
// Autor = a conta do portal. `atualizarIdentidade` grava o uuid em `actor_user_id` (sem FK); o
// nome não entra no evento `edit_identity` (a função é da lib do Apolo e não recebe nome), então
// no histórico esta edição aparece com traço no autor — registrado como pendência.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = autorizarComercial(request);
  if (!auth.ok) return auth.response;

  const rec = await recorteDoProduto(request, auth.sessao);
  if (!rec.ok) return rec.response;

  const admin = adminOu503();
  if (!admin.ok) return admin.response;

  const { id } = await context.params;

  const escopo = await cadNoEscopo(admin.client, id, rec.recorte);
  if (!escopo.ok) return escopo.response;

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
    autorUserId: auth.sessao.usuarioId,
    client: admin.client,
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
