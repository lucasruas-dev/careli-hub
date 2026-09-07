import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
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

const WORKSPACE = "careli";

function empreendimentoDaUrl(request: Request): null | string {
  const valor = new URL(request.url).searchParams.get("enterpriseId")?.trim();
  return valor || null;
}

/**
 * O empreendimento onde as categorias moram.
 *
 * ⚠️ A CATEGORIA VIVE NO PAI, e o filho lê de lá. O Lagoa Bonita é o caso vivo: LBF, LBP e LBR são
 * o jeito que o LEGADO tinha de dividir um empreendimento — criar três produtos para separar o que
 * é um só. A categoria é justamente o que substitui isso (Lucas, 07/09/2026: *"o Condomínio e o
 * Loteamento não interfere nos filhos, é tudo junto"*, e *"isso é porque o legado não tem essa
 * arquitetura que estamos fazendo no Panteon, estamos exatamente resolvendo isso"*).
 *
 * ⚠️ DUPLICAR O CADASTRO NOS TRÊS SERIA CARREGAR A LIMITAÇÃO DO C2X PARA DENTRO DO PANTEON: três
 * "Condomínio" para manter em dia, e o dia em que um deles ficar para trás ninguém percebe.
 *
 * Falha aqui devolve o próprio id: sem cadastro, o empreendimento responde por si — que é o que
 * acontece com os 35 produtos que não têm pai.
 */
async function empreendimentoDasCategorias(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  enterpriseId: string,
): Promise<string> {
  try {
    const { data } = await admin
      .from("hercules_empreendimentos")
      .select("pai_id")
      .eq("workspace_id", WORKSPACE)
      .eq("c2x_enterprise_id", enterpriseId)
      .maybeSingle();

    const paiId = (data as null | { pai_id: null | string })?.pai_id;
    if (!paiId) return enterpriseId;

    const { data: pai } = await admin
      .from("hercules_empreendimentos")
      .select("c2x_enterprise_id")
      .eq("id", paiId)
      .maybeSingle();

    return (pai as null | { c2x_enterprise_id: null | string })?.c2x_enterprise_id ?? enterpriseId;
  } catch {
    return enterpriseId;
  }
}

/**
 * As categorias do empreendimento, com quantos lotes cada uma tem.
 *
 * ⚠️ A CONTAGEM DE LOTES É O QUE TORNA A EXCLUSÃO HONESTA. Apagar uma categoria devolve os lotes
 * dela à regra geral do produto — e quem clica precisa saber que são doze, e não zero, ANTES de
 * confirmar.
 */
export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const enterpriseId = empreendimentoDaUrl(request);
  if (!enterpriseId) return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const dono = await empreendimentoDasCategorias(admin, enterpriseId);

  const { data, error } = await admin
    .from("temis_categorias")
    .select("id,nome,categoria_pai_id,ordem")
    .eq("workspace_id", WORKSPACE)
    .eq("enterprise_id", dono)
    .order("ordem", { ascending: true })
    .order("nome", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Não consegui ler as categorias." }, { status: 502 });
  }

  const linhas = (data ?? []) as Array<{
    categoria_pai_id: null | string;
    id: string;
    nome: string;
  }>;

  const porCategoria = new Map<string, number>();
  if (linhas.length > 0) {
    const { data: unidades } = await admin
      .from("hercules_unidades")
      .select("categoria_id,quadra,lote")
      .eq("workspace_id", WORKSPACE)
      .in(
        "categoria_id",
        linhas.map((c) => c.id),
      );

    // ⚠️ CONTA LOTE, E NÃO REGISTRO. No Lagoa Bonita o mesmo lote existe duas vezes — uma no pai e
    // outra na etapa —, e somar as linhas diria "750 lotes de condomínio" onde há 400. A chave é
    // quadra + lote, que é o que identifica o terreno independentemente de por qual nível se olha.
    const vistos = new Set<string>();
    for (const linha of (unidades ?? []) as Array<{
      categoria_id: null | string;
      lote: null | string;
      quadra: null | string;
    }>) {
      if (!linha.categoria_id) continue;
      const chave = `${linha.categoria_id}:${linha.quadra ?? ""}:${linha.lote ?? ""}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      porCategoria.set(linha.categoria_id, (porCategoria.get(linha.categoria_id) ?? 0) + 1);
    }
  }

  return NextResponse.json({
    data: {
      categorias: linhas.map((c) => ({
        categoriaPaiId: c.categoria_pai_id,
        id: c.id,
        nome: c.nome,
        unidades: porCategoria.get(c.id) ?? 0,
      })),
    },
  });
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const enterpriseId = empreendimentoDaUrl(request);
  if (!enterpriseId) return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });

  const corpo = (await request.json().catch(() => null)) as null | {
    categoriaPaiId?: null | string;
    nome?: string;
    ordem?: number;
  };
  const nome = corpo?.nome?.trim();
  if (!nome) return NextResponse.json({ error: "A categoria precisa de um nome." }, { status: 400 });

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const { data, error } = await admin
    .from("temis_categorias")
    .insert({
      // ⚠️ A SUBCATEGORIA É A MESMA TABELA, apontando para a mãe. *"eu posso criar uma subcategoria
      // da categoria"* — e a profundidade é do negócio: condomínio dentro de loteamento, fase
      // dentro de condomínio. Uma tabela separada para o segundo nível impediria o terceiro.
      categoria_pai_id: corpo?.categoriaPaiId ?? null,
      // A categoria nasce no PAI, para o filho não ter cadastro próprio do mesmo recorte.
      enterprise_id: await empreendimentoDasCategorias(admin, enterpriseId),
      nome,
      ordem: corpo?.ordem ?? 0,
      workspace_id: WORKSPACE,
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

  // ⚠️ SUBCATEGORIA PRIMEIRO. A 0139 poe `on delete restrict` na autorreferencia, entao o banco
  // recusaria — mas com o erro cru do Postgres, que nao diz a ninguem o que fazer. Conferir aqui
  // devolve a frase com o NOME das filhas, que e o que a pessoa precisa para desmontar de baixo
  // para cima.
  const { data: filhas, error: erroFilhas } = await admin
    .from("temis_categorias")
    .select("nome")
    .eq("workspace_id", "careli")
    .eq("categoria_pai_id", id);

  if (erroFilhas) {
    return NextResponse.json(
      { error: "Não consegui conferir as subcategorias." },
      { status: 503 },
    );
  }

  const dentro = (filhas ?? []) as Array<{ nome: string }>;
  if (dentro.length > 0) {
    return NextResponse.json(
      {
        error: `Esta categoria tem ${dentro.length === 1 ? "a subcategoria" : "as subcategorias"} ${dentro
          .map((c) => `"${c.nome}"`)
          .join(", ")}. Exclua ${dentro.length === 1 ? "ela" : "elas"} antes.`,
      },
      { status: 409 },
    );
  }

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
