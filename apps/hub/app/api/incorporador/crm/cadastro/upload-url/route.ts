import { NextResponse } from "next/server";

import { criarUrlDeUploadApoloDocument } from "@/lib/apolo/documentos";
import {
  conferirProdutoDaSessao,
  donoUploadDoPortal,
  recusaDaEscritaNoCadastro,
} from "@/lib/apolo/incorporador/cadastro-do-portal";
import { respostaDaEscrita } from "@/lib/apolo/incorporador/operacao-do-produto-servidor";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// Espelho de /api/apolo/cadastro/upload-url para o CRM do portal do incorporador.
//
// Esta rota NÃO recebe o arquivo: devolve uma URL assinada e o browser grava os bytes DIRETO no
// Storage. É o caminho do documento GRANDE: a Vercel corta o corpo da requisição em ~4,5MB e o
// base64 ainda infla o arquivo em ~33%, então documento acima do teto não tem como viajar dentro do
// JSON do /salvar. O caminho é amarrado ao usuário do portal (`p-<id>`), e o /salvar recusa caminho
// de outro dono.
//
// ⚠️ O PRODUTO VEM NO CORPO E É OBRIGATÓRIO (decisão do Lucas, 16/09/2026): gravar no Storage já é
// escrita, e escrita do portal só vale no produto que a Cecílio opera. Sem produto 400, produto de
// fora da sessão 404, produto só de consulta 403, cadastro sem a 0170 503.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as
    | { enterpriseId?: unknown; fileName?: unknown }
    | null;

  const produto = conferirProdutoDaSessao(auth.ator, body?.enterpriseId);
  if (!produto.ok) {
    return NextResponse.json({ error: produto.error }, { status: produto.status });
  }
  const recusa = await recusaDaEscritaNoCadastro(auth.ator, produto.enterpriseId);
  if (recusa) return respostaDaEscrita(recusa);

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });
  }

  try {
    const assinada = await criarUrlDeUploadApoloDocument({
      adminClient,
      dono: donoUploadDoPortal(auth.ator.usuarioId),
      fileName: typeof body?.fileName === "string" ? body.fileName : "",
    });

    return NextResponse.json(assinada, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível preparar o envio do documento." },
      { status: 500 },
    );
  }
}
