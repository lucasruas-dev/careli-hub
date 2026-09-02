import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { classificarVariaveis, conferirBlocos, extensosOrfaos } from "@/lib/temis/variaveis";

// MINUTAS DO TEMIS — subir, editar, publicar.
//
// Pedido do Lucas (01/09/2026): *"vou liberar para o time já subi a minuta e editar"*, *"isso tem
// que está pronto"*. E o fluxo que ele desenhou: *"o fluxo é subir a minuta que chega do loteador,
// vou importar, e o agente já le o documento, já identifica onde fica as variaveis, ja entrega a
// primeira versão já muito adiantada ou quase pronta"*.
//
//   GET    → lista as minutas do empreendimento (sem conteúdo), ou UMA com o conteúdo (`?id=`)
//   POST   → cria uma minuta (do zero ou a partir de um arquivo importado)
//   PATCH  → salva o rascunho; em minuta PUBLICADA, cria a próxima versão
//   PATCH ?acao=publicar → publica, conferindo antes o que quebraria o contrato
//
// ⚠️ VERSÃO PUBLICADA NÃO SE EDITA. Salvar por cima de uma publicada criaria um documento diferente
// do que as pessoas assinaram, com o mesmo id — e daqui a oito anos ninguém conseguiria reproduzir
// o contrato como foi assinado. Por isso o PATCH numa publicada não altera nada: abre a versão
// seguinte, em rascunho.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIMITE_DE_CONTEUDO = 4_000_000; // ~4 MB. A maior minuta do C2X tem 4,4 MB (com imagens).

function empreendimentoDaUrl(request: Request): null | string {
  const valor = new URL(request.url).searchParams.get("enterpriseId")?.trim();
  return valor || null;
}

/** O resumo que a tela mostra sem precisar carregar o documento inteiro. */
type LinhaDeMinuta = {
  atualizado_em: string;
  criado_em: string;
  descricao: null | string;
  id: string;
  nome: string;
  origem_arquivo_nome: null | string;
  publicada_em: null | string;
  situacao: string;
  tipo: string;
  variaveis: unknown;
  versao: number;
};

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const enterpriseId = empreendimentoDaUrl(request);
  const id = url.searchParams.get("id")?.trim();

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  // Uma minuta, com o documento. É o que o editor abre.
  if (id) {
    const { data, error } = await admin
      .from("temis_minutas")
      .select(
        "id, enterprise_id, nome, descricao, tipo, situacao, versao, versao_anterior_id, conteudo, conteudo_html, origem_arquivo_nome, variaveis, publicada_em, criado_em, atualizado_em",
      )
      .eq("workspace_id", "careli")
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: "Não consegui abrir a minuta." }, { status: 502 });
    if (!data) return NextResponse.json({ error: "Minuta não encontrada." }, { status: 404 });

    return NextResponse.json({ data: { minuta: data } });
  }

  if (!enterpriseId) {
    return NextResponse.json({ error: "Informe o empreendimento ou a minuta." }, { status: 400 });
  }

  // ⚠️ O TIPO FILTRA A LISTA, e sem ele o Setup mostraria o termo de distrato na aba da minuta —
  // e alguém publicaria como contrato o texto que encerra contrato. Sem o parâmetro devolve tudo,
  // que é o comportamento de quem já chamava esta rota antes das abas.
  const tipo = url.searchParams.get("tipo")?.trim();

  let consulta = admin
    .from("temis_minutas")
    .select(
      "id, nome, descricao, tipo, situacao, versao, origem_arquivo_nome, variaveis, publicada_em, criado_em, atualizado_em",
    )
    .eq("workspace_id", "careli")
    .eq("enterprise_id", enterpriseId);

  if (tipo) consulta = consulta.eq("tipo", tipo);

  const { data, error } = await consulta
    .order("nome", { ascending: true })
    .order("versao", { ascending: false });

  // ⚠️ FALHA FECHADA: lista vazia por erro de leitura faria a tela dizer "não há minuta aqui", e o
  // jurídico subiria de novo a que já existe.
  if (error) {
    return NextResponse.json({ error: "Não consegui listar as minutas." }, { status: 502 });
  }

  return NextResponse.json({ data: { minutas: (data ?? []) as LinhaDeMinuta[] } });
}

type CorpoDeMinuta = {
  conteudo?: unknown;
  conteudoHtml?: null | string;
  descricao?: null | string;
  nome?: string;
  origemArquivoNome?: null | string;
  tipo?: string;
};

/**
 * O que a tela precisa saber sobre o texto ANTES de publicar.
 *
 * Roda no servidor e não só no navegador porque é a conferência que impede um contrato quebrado de
 * ir para assinatura — e conferência que só existe na tela é conferência que uma requisição direta
 * pula.
 */
function auditar(html: string) {
  const { conhecidas, desconhecidas } = classificarVariaveis(html);
  return {
    blocos: conferirBlocos(html),
    conhecidas: conhecidas.map((c) => ({ nome: c.nome, ocorrencias: c.ocorrencias })),
    desconhecidas,
    extensosOrfaos: extensosOrfaos(html),
  };
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const enterpriseId = empreendimentoDaUrl(request);
  if (!enterpriseId) return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });

  const corpo = (await request.json().catch(() => null)) as CorpoDeMinuta | null;
  const nome = corpo?.nome?.trim();
  if (!nome) return NextResponse.json({ error: "A minuta precisa de um nome." }, { status: 400 });

  const html = corpo?.conteudoHtml ?? null;
  if (html && html.length > LIMITE_DE_CONTEUDO) {
    return NextResponse.json(
      { error: "A minuta passou de 4 MB. Provavelmente traz imagens muito grandes." },
      { status: 413 },
    );
  }

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  // ⚠️ SÓ A MINUTA DE CONTRATO PODE TER VÁRIAS POR EMPREENDIMENTO. Regra do Lucas (02/09/2026):
  // *"será único por empreendimento, o varia por plano é somente a minuta"*. A minuta de contrato
  // se multiplica porque o PLANO decide qual usar (a Lagoa Bonita tem dez); cessão, distrato e
  // cancelamento são um só.
  //
  // ⚠️ E É AQUI QUE ISSO PRECISA SER BARRADO, e não na tela. Com dois termos de distrato publicados
  // no mesmo empreendimento, o motor não tem critério para escolher — e a escolha cairia na ordem
  // do banco, que é a mais silenciosa das escolhas erradas. A versão anterior continua existindo
  // como versão, que é como o texto evolui; o que não pode é haver DOIS termos vivos.
  const tipoNovo = corpo?.tipo ?? "contrato";
  if (tipoNovo !== "contrato") {
    const { data: jaExiste } = await admin
      .from("temis_minutas")
      .select("id, nome")
      .eq("workspace_id", "careli")
      .eq("enterprise_id", enterpriseId)
      .eq("tipo", tipoNovo)
      .neq("situacao", "arquivada")
      .limit(1);

    if (jaExiste && jaExiste.length > 0) {
      return NextResponse.json(
        {
          error: `este empreendimento já tem um documento deste tipo ("${jaExiste[0]?.nome}"). Edite o que existe — ele guarda as versões — ou arquive antes de criar outro.`,
        },
        { status: 409 },
      );
    }
  }

  const auditoria = html ? auditar(html) : null;

  const { data, error } = await admin
    .from("temis_minutas")
    .insert({
      conteudo: corpo?.conteudo ?? null,
      conteudo_html: html,
      descricao: corpo?.descricao ?? null,
      enterprise_id: enterpriseId,
      nome,
      origem_arquivo_nome: corpo?.origemArquivoNome ?? null,
      situacao: "rascunho",
      tipo: tipoNovo,
      variaveis: auditoria?.conhecidas ?? [],
      versao: 1,
      workspace_id: "careli",
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: "Não consegui criar a minuta." }, { status: 400 });
  }
  return NextResponse.json({ data: { auditoria, id: data.id } });
}

export async function PATCH(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim();
  const acao = url.searchParams.get("acao")?.trim();
  if (!id) return NextResponse.json({ error: "Informe a minuta." }, { status: 400 });

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const { data: atual, error: erroLeitura } = await admin
    .from("temis_minutas")
    .select("id, enterprise_id, nome, descricao, tipo, situacao, versao, conteudo, conteudo_html, origem_arquivo_nome")
    .eq("workspace_id", "careli")
    .eq("id", id)
    .maybeSingle();

  if (erroLeitura) return NextResponse.json({ error: "Não consegui ler a minuta." }, { status: 502 });
  if (!atual) return NextResponse.json({ error: "Minuta não encontrada." }, { status: 404 });

  // ── PUBLICAR ───────────────────────────────────────────────────────────────
  if (acao === "publicar") {
    const html = atual.conteudo_html;
    if (!html?.trim()) {
      return NextResponse.json(
        { error: "Minuta vazia: publicar geraria contrato em branco." },
        { status: 400 },
      );
    }

    // ⚠️ A CONFERÊNCIA DE BLOCOS TRAVA A PUBLICAÇÃO, e não é excesso de zelo: um `[inicio_dados_
    // cliente_pj]` sem o `[fim_...]` faz o motor imprimir o parágrafo de pessoa jurídica no contrato
    // de uma pessoa física. Já aconteceu, no Villa Paris, e ninguém percebeu até o cliente ler.
    const problemas = conferirBlocos(html);
    if (problemas.length > 0) {
      return NextResponse.json(
        {
          data: { problemas },
          error: `A minuta tem ${problemas.length} bloco(s) condicional(is) mal fechado(s). Corrija antes de publicar: é o que faz o contrato imprimir o trecho errado.`,
        },
        { status: 409 },
      );
    }

    const agora = new Date().toISOString();

    // ⚠️ ARQUIVA A PUBLICADA ANTERIOR DE MESMO NOME, e o índice único do banco exige isso: duas
    // publicadas com o mesmo nome fariam a geração escolher por sorteio. A antiga continua
    // existindo — os contratos já assinados apontam para ela.
    const { data: anteriores, error: erroAnteriores } = await admin
      .from("temis_minutas")
      .select("id")
      .eq("workspace_id", "careli")
      .eq("enterprise_id", atual.enterprise_id)
      .eq("nome", atual.nome)
      .eq("situacao", "publicada")
      .neq("id", id);

    if (erroAnteriores) {
      return NextResponse.json({ error: "Não consegui conferir a versão vigente." }, { status: 502 });
    }

    const idsAnteriores = (anteriores ?? []).map((a) => a.id as string);
    if (idsAnteriores.length > 0) {
      const { error: erroArquivar } = await admin
        .from("temis_minutas")
        .update({ atualizado_em: agora, situacao: "arquivada" })
        .in("id", idsAnteriores);
      if (erroArquivar) {
        return NextResponse.json({ error: "Não consegui arquivar a versão anterior." }, { status: 502 });
      }
    }

    const { error: erroPublicar } = await admin
      .from("temis_minutas")
      .update({
        atualizado_em: agora,
        publicada_em: agora,
        situacao: "publicada",
        variaveis: auditar(html).conhecidas,
      })
      .eq("id", id);

    if (erroPublicar) {
      return NextResponse.json({ error: "Não consegui publicar a minuta." }, { status: 502 });
    }

    // ⚠️ OS PLANOS SEGUEM PARA A VERSÃO NOVA. Sem este repasse, publicar a v2 deixaria os planos
    // apontando para a v1 recém-arquivada: o cadastro mostraria "minuta vinculada", e a geração
    // usaria o texto ANTIGO — a pior combinação, porque nada na tela denunciaria o problema.
    let planosMigrados = 0;
    if (idsAnteriores.length > 0) {
      const { data: planos, error: erroPlanos } = await admin
        .from("temis_planos")
        .update({ atualizado_em: agora, minuta_id: id })
        .in("minuta_id", idsAnteriores)
        .select("id");
      if (erroPlanos) {
        return NextResponse.json(
          {
            error:
              "A minuta foi publicada, mas não consegui repassar os planos que usavam a versão anterior. Confira o vínculo na aba Planos.",
          },
          { status: 502 },
        );
      }
      planosMigrados = (planos ?? []).length;
    }

    return NextResponse.json({
      data: { arquivadas: idsAnteriores.length, id, planosMigrados },
    });
  }

  // ── SALVAR ─────────────────────────────────────────────────────────────────
  const corpo = (await request.json().catch(() => null)) as CorpoDeMinuta | null;
  if (!corpo) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  const html = corpo.conteudoHtml ?? atual.conteudo_html;
  if (html && html.length > LIMITE_DE_CONTEUDO) {
    return NextResponse.json(
      { error: "A minuta passou de 4 MB. Provavelmente traz imagens muito grandes." },
      { status: 413 },
    );
  }

  const auditoria = html ? auditar(html) : null;
  const agora = new Date().toISOString();

  // Minuta publicada: NÃO se altera. Abre a próxima versão, em rascunho. Ver a nota do topo.
  if (atual.situacao === "publicada") {
    const { data: nova, error } = await admin
      .from("temis_minutas")
      .insert({
        conteudo: corpo.conteudo ?? atual.conteudo,
        conteudo_html: html,
        descricao: corpo.descricao ?? atual.descricao,
        enterprise_id: atual.enterprise_id,
        nome: corpo.nome?.trim() || atual.nome,
        origem_arquivo_nome: atual.origem_arquivo_nome,
        situacao: "rascunho",
        tipo: corpo.tipo ?? atual.tipo,
        variaveis: auditoria?.conhecidas ?? [],
        versao: (atual.versao as number) + 1,
        versao_anterior_id: id,
        workspace_id: "careli",
      })
      .select("id, versao")
      .single();

    if (error) {
      return NextResponse.json({ error: "Não consegui abrir a nova versão." }, { status: 400 });
    }
    return NextResponse.json({
      data: { auditoria, id: nova.id, novaVersao: nova.versao, versaoNova: true },
    });
  }

  const { error } = await admin
    .from("temis_minutas")
    .update({
      atualizado_em: agora,
      conteudo: corpo.conteudo ?? atual.conteudo,
      conteudo_html: html,
      descricao: corpo.descricao ?? atual.descricao,
      nome: corpo.nome?.trim() || atual.nome,
      tipo: corpo.tipo ?? atual.tipo,
      variaveis: auditoria?.conhecidas ?? [],
    })
    .eq("workspace_id", "careli")
    .eq("id", id);

  if (error) return NextResponse.json({ error: "Não consegui salvar a minuta." }, { status: 400 });
  return NextResponse.json({ data: { auditoria, id } });
}

export async function DELETE(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "Informe a minuta." }, { status: 400 });

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  // ⚠️ ARQUIVA, NÃO APAGA — nem quando é rascunho. Uma minuta pode estar vinculada a um plano, e o
  // `on delete set null` do banco desfaria o vínculo em silêncio: o plano continuaria ativo, sem
  // minuta, e a venda travaria só na hora de gerar o contrato. Arquivar mantém o rastro.
  const { data: planos, error: erroPlanos } = await admin
    .from("temis_planos")
    .select("nome")
    .eq("workspace_id", "careli")
    .eq("minuta_id", id);

  if (erroPlanos) {
    return NextResponse.json({ error: "Não consegui conferir os planos que usam a minuta." }, { status: 502 });
  }
  if ((planos ?? []).length > 0) {
    const nomes = (planos ?? []).map((p) => p.nome as string).join(", ");
    return NextResponse.json(
      {
        error: `Esta minuta está vinculada a: ${nomes}. Aponte esses planos para outra minuta antes de arquivar.`,
      },
      { status: 409 },
    );
  }

  const { error } = await admin
    .from("temis_minutas")
    .update({ atualizado_em: new Date().toISOString(), situacao: "arquivada" })
    .eq("workspace_id", "careli")
    .eq("id", id);

  if (error) return NextResponse.json({ error: "Não consegui arquivar a minuta." }, { status: 400 });
  return NextResponse.json({ data: { id } });
}
