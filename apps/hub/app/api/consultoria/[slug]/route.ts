import { NextResponse } from "next/server";

import {
  abrirProjetoDoDono,
  autorizarDono,
  ehProjetoConhecido,
  salvarProjeto,
} from "@/lib/consultoria/projeto";

// A PORTA DO CONSULTOR: lê e salva o documento da consultoria. Exige a sessão do hub (Bearer) E
// ser o dono por e-mail. O cliente nunca passa por aqui: ele lê por /api/publico/consultoria.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEM_CACHE = { "cache-control": "no-store" };

type Contexto = { params: Promise<{ slug: string }> };

export async function GET(request: Request, { params }: Contexto) {
  const { slug } = await params;
  if (!ehProjetoConhecido(slug)) return NextResponse.json({ error: "Não encontrado." }, { status: 404 });

  const acesso = await autorizarDono(request);
  if (!acesso.ok) return acesso.response;

  try {
    const linha = await abrirProjetoDoDono(slug, acesso.email);
    return NextResponse.json(
      {
        atualizadoEm: linha.atualizado_em,
        dados: linha.dados,
        linkDeLeitura: `/consultoria/${slug}?t=${linha.token_leitura}`,
        podeEditar: true,
      },
      { headers: SEM_CACHE },
    );
  } catch (erro) {
    console.error("[consultoria] leitura do dono falhou", slug, erro);
    return NextResponse.json({ error: "Não foi possível abrir o projeto." }, { headers: SEM_CACHE, status: 500 });
  }
}

export async function PUT(request: Request, { params }: Contexto) {
  const { slug } = await params;
  if (!ehProjetoConhecido(slug)) return NextResponse.json({ error: "Não encontrado." }, { status: 404 });

  const acesso = await autorizarDono(request);
  if (!acesso.ok) return acesso.response;

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
    const resultado = await salvarProjeto(slug, acesso.email, corpo.dados, corpo.base);
    if (!resultado.ok) {
      return resultado.motivo === "conflito"
        ? NextResponse.json(
            { error: "O projeto foi alterado em outra janela. Recarregue a página antes de continuar." },
            { headers: SEM_CACHE, status: 409 },
          )
        : NextResponse.json({ error: "Documento inválido." }, { headers: SEM_CACHE, status: 400 });
    }
    return NextResponse.json({ atualizadoEm: resultado.atualizadoEm }, { headers: SEM_CACHE });
  } catch (erro) {
    console.error("[consultoria] salvamento falhou", slug, erro);
    return NextResponse.json({ error: "Não foi possível salvar." }, { headers: SEM_CACHE, status: 500 });
  }
}
