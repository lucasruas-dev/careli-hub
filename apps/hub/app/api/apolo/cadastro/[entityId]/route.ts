import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  lerCadastroParaEdicao,
  salvarEdicaoCadastro,
  type CadastroEditavel,
} from "@/lib/apolo/cadastro-editar";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Ler / editar o cadastro de uma entidade do Apolo direto no CRM. O GET traz os campos com os ids
// do C2X (que os selects usam); o PATCH salva. Escrever exige papel de escrita (viewer só lê).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Atalho SÓ EM DESENVOLVIMENTO: o CRON_SECRET via Bearer libera o teste local via curl (sem
// sessão do hub). Em produção nunca vale — a rota de edição é sempre autenticada por sessão.
function bypassDeDev(request: NextRequest): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && token === secret);
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ entityId: string }> },
) {
  if (!bypassDeDev(request)) {
    const auth = await authorizeApoloRead(request);
    if (!auth.ok) return auth.response;
  }

  const { entityId } = await ctx.params;
  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });
  }

  const resultado = await lerCadastroParaEdicao(client, entityId);
  if (!resultado) {
    return NextResponse.json({ error: "Entidade não encontrada." }, { status: 404 });
  }

  return NextResponse.json({ data: resultado });
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ entityId: string }> },
) {
  if (!bypassDeDev(request)) {
    const auth = await authorizeApoloWrite(request);
    if (!auth.ok) return auth.response;
  }

  const { entityId } = await ctx.params;
  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => null)) as CadastroEditavel | null;
  if (!corpo) {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const resultado = await salvarEdicaoCadastro(client, entityId, corpo);
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 500 });
  }

  return NextResponse.json({ data: { ok: true } });
}
