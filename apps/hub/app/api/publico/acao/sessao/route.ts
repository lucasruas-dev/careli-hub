import { NextResponse } from "next/server";

import { emitirSessaoAcao } from "@/lib/apolo/acao-sessao";
import { verificarSenhaAcao } from "@/lib/apolo/acoes";
import { createApoloAdminClient } from "@/lib/apolo/server";

// PORTÃO da tela pública da ação: recebe { slug, senha } e devolve o token da sessão. Resposta
// uniforme (não diz se foi o slug ou a senha que errou) para não virar oráculo de enumeração.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Indisponível." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { senha?: string; slug?: string };
  const slug = body.slug?.trim();
  const senha = body.senha ?? "";
  if (!slug || !senha) {
    return NextResponse.json({ error: "Informe o acesso e a senha." }, { status: 400 });
  }

  const { data } = await client
    .from("apolo_acoes")
    .select("id, nome, publico_senha_hash, status")
    .eq("publico_slug", slug)
    .maybeSingle<{
      id: string;
      nome: string;
      publico_senha_hash: string | null;
      status: string;
    }>();

  const ok = data?.status === "ativa" && verificarSenhaAcao(senha, data.publico_senha_hash);
  if (!data || !ok) {
    return NextResponse.json({ error: "Acesso ou senha inválidos." }, { status: 401 });
  }

  return NextResponse.json({ data: { nome: data.nome, token: emitirSessaoAcao(data.id) } });
}
