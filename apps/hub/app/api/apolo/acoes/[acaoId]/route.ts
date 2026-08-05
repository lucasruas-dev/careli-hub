import { NextResponse } from "next/server";

import {
  lerAcaoPorId,
  listarAlvos,
  resumoDaAcao,
  salvarContato,
  type ContatoCanal,
  type Perfil,
  type UnidadesInteresse,
} from "@/lib/apolo/acoes";
import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Detalhe de UMA ação (a campanha + os alvos + os KPIs) e a marcação do contato de um alvo.
// Usado pela aba Ações da Iris (login do hub). A tela pública tem rotas próprias sob /api/publico.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ acaoId: string }> },
) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base." }, { status: 503 });

  const { acaoId } = await params;
  const acao = await lerAcaoPorId(client, acaoId);
  if (!acao) return NextResponse.json({ error: "Ação não encontrada." }, { status: 404 });

  const [alvos, resumo] = await Promise.all([
    listarAlvos(client, acaoId),
    resumoDaAcao(client, acaoId),
  ]);

  return NextResponse.json(
    { data: { acao, alvos, resumo } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ acaoId: string }> },
) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base." }, { status: 503 });

  await params; // acaoId não é necessário no update (o alvoId é único), mas mantém a rota coesa.

  const body = (await request.json().catch(() => ({}))) as {
    alvoId?: string;
    canal?: ContatoCanal;
    perfil?: Perfil | null;
    unidades?: UnidadesInteresse | null;
  };

  if (!body.alvoId || !body.canal) {
    return NextResponse.json({ error: "Informe alvoId e canal." }, { status: 400 });
  }

  const resultado = await salvarContato(client, {
    alvoId: body.alvoId,
    canal: body.canal,
    perfil: body.perfil ?? null,
    por: auth.userId,
    unidades: body.unidades ?? null,
  });

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 400 });
  }

  return NextResponse.json({ data: { ok: true } });
}
