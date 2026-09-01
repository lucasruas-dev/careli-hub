import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";

// CATEGORIAS DO TEMIS — o agrupamento livre de planos dentro do empreendimento.
//
// Pedido do Lucas (01/09/2026): *"empreendimento já vai vir do apolo, ae eu posso criar as
// subcategorias"*. Ela existe para dar nome ao que no legado ficava escondido no arquivo: o JDG tem
// seis planos, três internos e três externos, e a diferença só aparecia em "JDG-EXTERNA-...".
//
// A LEITURA VIVE NA ROTA DOS PLANOS (`/api/temis/planos` devolve categorias, planos e minutas numa
// chamada só). Aqui só há escrita — não faz sentido a tela buscar categoria separado e correr o
// risco de mostrar plano apontando para categoria que ela ainda não carregou.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function empreendimentoDaUrl(request: Request): null | string {
  const valor = new URL(request.url).searchParams.get("enterpriseId")?.trim();
  return valor || null;
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const enterpriseId = empreendimentoDaUrl(request);
  if (!enterpriseId) return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });

  const corpo = (await request.json().catch(() => null)) as null | { nome?: string; ordem?: number };
  const nome = corpo?.nome?.trim();
  if (!nome) return NextResponse.json({ error: "A categoria precisa de um nome." }, { status: 400 });

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const { data, error } = await admin
    .from("temis_categorias")
    .insert({
      enterprise_id: enterpriseId,
      nome,
      ordem: corpo?.ordem ?? 0,
      workspace_id: "careli",
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json(
      {
        error:
          error.code === "23505"
            ? "Já existe uma categoria com esse nome neste empreendimento."
            : "Não consegui criar a categoria.",
      },
      { status: 400 },
    );
  }
  return NextResponse.json({ data: { id: data.id } });
}

export async function PATCH(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const enterpriseId = empreendimentoDaUrl(request);
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!enterpriseId || !id) {
    return NextResponse.json({ error: "Informe o empreendimento e a categoria." }, { status: 400 });
  }

  const corpo = (await request.json().catch(() => null)) as null | {
    ativa?: boolean;
    nome?: string;
    ordem?: number;
  };
  if (!corpo) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  const mudancas: Record<string, boolean | number | string> = {
    atualizado_em: new Date().toISOString(),
  };
  if (corpo.nome !== undefined) {
    const nome = corpo.nome.trim();
    if (!nome) return NextResponse.json({ error: "A categoria precisa de um nome." }, { status: 400 });
    mudancas.nome = nome;
  }
  if (corpo.ordem !== undefined) mudancas.ordem = corpo.ordem;
  if (corpo.ativa !== undefined) mudancas.ativa = corpo.ativa;

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const { error } = await admin
    .from("temis_categorias")
    .update(mudancas)
    .eq("workspace_id", "careli")
    .eq("enterprise_id", enterpriseId)
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      {
        error:
          error.code === "23505"
            ? "Já existe uma categoria com esse nome neste empreendimento."
            : "Não consegui salvar a categoria.",
      },
      { status: 400 },
    );
  }
  return NextResponse.json({ data: { id } });
}

export async function DELETE(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const enterpriseId = empreendimentoDaUrl(request);
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!enterpriseId || !id) {
    return NextResponse.json({ error: "Informe o empreendimento e a categoria." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  // ⚠️ CONTA OS PLANOS ANTES. O banco tem `on delete set null`, então apagar a categoria NÃO daria
  // erro: os planos apenas perderiam a organização em silêncio, e no JDG isso significa seis planos
  // virando uma lista plana onde ninguém mais distingue interno de externo. Melhor recusar e mandar
  // o operador mover ou desativar.
  const { count, error: erroConta } = await admin
    .from("temis_planos")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", "careli")
    .eq("categoria_id", id);

  if (erroConta) {
    return NextResponse.json({ error: "Não consegui conferir os planos da categoria." }, { status: 503 });
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `Esta categoria tem ${count} plano(s). Mova-os para outra categoria antes de apagar.`,
      },
      { status: 409 },
    );
  }

  const { error } = await admin
    .from("temis_categorias")
    .delete()
    .eq("workspace_id", "careli")
    .eq("enterprise_id", enterpriseId)
    .eq("id", id);

  if (error) return NextResponse.json({ error: "Não consegui apagar a categoria." }, { status: 400 });
  return NextResponse.json({ data: { id } });
}
