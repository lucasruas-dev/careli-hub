import { NextResponse } from "next/server";

import { abrirProjetoPeloLink } from "@/lib/consultoria/projeto";

// A PORTA DO CLIENTE: o documento da consultoria em SÓ LEITURA, pelo token do link
// (/consultoria/<slug>?t=...). Sem sessão do hub por desenho: quem abre é a diretoria do cliente.
// Token errado e projeto inexistente respondem o mesmo 404, para o link não virar oráculo.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEM_CACHE = { "cache-control": "no-store", "x-robots-tag": "noindex" };

type Contexto = { params: Promise<{ slug: string }> };

export async function GET(request: Request, { params }: Contexto) {
  const { slug } = await params;
  // No cabeçalho, não na URL da API: a tela tira o token do link e o repassa aqui, para ele não
  // ficar gravado no log de cada requisição.
  const token = request.headers.get("x-consultoria-token")?.trim() ?? "";

  try {
    const projeto = await abrirProjetoPeloLink(slug, token);
    if (!projeto) return NextResponse.json({ error: "Link inválido." }, { headers: SEM_CACHE, status: 404 });
    return NextResponse.json({ ...projeto, podeEditar: false }, { headers: SEM_CACHE });
  } catch (erro) {
    console.error("[consultoria] leitura pelo link falhou", slug, erro);
    return NextResponse.json({ error: "Não foi possível abrir o projeto." }, { headers: SEM_CACHE, status: 500 });
  }
}
