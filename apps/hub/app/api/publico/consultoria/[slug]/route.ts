import { NextResponse } from "next/server";

import { abrirProjeto, type Credenciais, salvarProjeto } from "@/lib/consultoria/projeto";

// A PORTA DA CONSULTORIA (c2x.app.br/consultoria/<slug>): sem login, por link secreto.
//   • x-consultoria-edicao → o consultor: lê e salva.
//   • x-consultoria-token  → o cliente: só lê.
// Os códigos vêm no CABEÇALHO, não na URL da API: a tela os tira do link e repassa aqui, para não
// ficarem gravados no log de cada requisição. Código errado e projeto inexistente respondem o
// mesmo 404, para o link não virar oráculo.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEM_CACHE = { "cache-control": "no-store", "x-robots-tag": "noindex" };

type Contexto = { params: Promise<{ slug: string }> };

function credenciais(request: Request): Credenciais {
  return {
    edicao: request.headers.get("x-consultoria-edicao")?.trim() ?? "",
    leitura: request.headers.get("x-consultoria-token")?.trim() ?? "",
  };
}

export async function GET(request: Request, { params }: Contexto) {
  const { slug } = await params;

  try {
    const projeto = await abrirProjeto(slug, credenciais(request));
    if (!projeto) return NextResponse.json({ error: "Link inválido." }, { headers: SEM_CACHE, status: 404 });
    return NextResponse.json(projeto, { headers: SEM_CACHE });
  } catch (erro) {
    console.error("[consultoria] leitura falhou", slug, erro);
    return NextResponse.json({ error: "Não foi possível abrir o projeto." }, { headers: SEM_CACHE, status: 500 });
  }
}

export async function PUT(request: Request, { params }: Contexto) {
  const { slug } = await params;
  const { edicao } = credenciais(request);
  if (!edicao) return NextResponse.json({ error: "Link inválido." }, { headers: SEM_CACHE, status: 404 });

  let corpo: { base?: unknown; dados?: unknown };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { headers: SEM_CACHE, status: 400 });
  }
  if (typeof corpo.base !== "string") {
    return NextResponse.json({ error: "Versão de partida ausente." }, { headers: SEM_CACHE, status: 400 });
  }

  try {
    const resultado = await salvarProjeto(slug, edicao, corpo.dados, corpo.base);
    if (resultado.ok) return NextResponse.json({ atualizadoEm: resultado.atualizadoEm }, { headers: SEM_CACHE });
    if (resultado.motivo === "negado") {
      return NextResponse.json({ error: "Link inválido." }, { headers: SEM_CACHE, status: 404 });
    }
    if (resultado.motivo === "conflito") {
      return NextResponse.json(
        { error: "O projeto foi alterado em outra janela. Recarregue a página antes de continuar." },
        { headers: SEM_CACHE, status: 409 },
      );
    }
    return NextResponse.json({ error: "Documento inválido." }, { headers: SEM_CACHE, status: 400 });
  } catch (erro) {
    console.error("[consultoria] salvamento falhou", slug, erro);
    return NextResponse.json({ error: "Não foi possível salvar." }, { headers: SEM_CACHE, status: 500 });
  }
}
