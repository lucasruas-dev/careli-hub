import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { lerContasDaEntidade } from "@/lib/apolo/conta-do-fornecedor";
import { createApoloAdminClient } from "@/lib/apolo/server";

// A conta e o PIX do FORNECEDOR, para a seção "Dados bancários" da ficha (02/10/2026).
//
// ⚠️ QUEM VÊ É QUEM PODE GRAVAR NO APOLO (admin, liderança e operação), e não todo leitor: conta e chave
// PIX são o caminho do dinheiro, e o `viewer` não paga ninguém. É também por isso que elas não vivem
// em `metadata.cadastro`, que a lista e a busca do CRM entregam a todo leitor.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ entityId: string }> },
) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const { entityId } = await ctx.params;
  if (!UUID_RE.test(entityId)) {
    return NextResponse.json({ error: "Ficha inválida." }, { status: 400 });
  }

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });
  }

  const leitura = await lerContasDaEntidade(client, entityId);
  if (!leitura.ok) {
    return NextResponse.json(
      {
        error:
          leitura.motivo === "sem-tabela"
            ? "Os dados bancários ainda não estão liberados neste ambiente."
            : "Não consegui ler os dados bancários agora.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ data: leitura.contas });
}
