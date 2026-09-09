import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { descreverRegra } from "@/lib/assinatura/ordem";
import { rotuloDoPapel } from "@/lib/assinatura/tipos";
import {
  lerOrdemDoCorpo,
  type NivelDeOrdem,
  regraDoNivel,
  resolverOrdemDeAssinatura,
  temOrdemPropria,
} from "@/lib/temis/ordem-da-categoria";

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
  codigo?: null | string,
): Promise<string> {
  try {
    // ⚠️ A FICHA CONSOLIDADA NÃO TEM ID DE EMPREENDIMENTO. Quando o produto é agrupado, o Apolo
    // monta a linha com `id: "group:Lagoa Bonita"` — um rótulo, não uma chave: não existe
    // `enterprise_id` igual a isso em tabela nenhuma. Foi assim que as duas categorias do Lagoa
    // Bonita, criadas e carimbadas em 495 lotes, apareceram como "nenhuma categoria" na tela.
    //
    // O caminho de volta é o CÓDIGO de uma das etapas (LBF, LBR, LBP), que a ficha já tem em mãos:
    // dele se acha o empreendimento, e do empreendimento se sobe ao pai.
    const porGrupo = enterpriseId.startsWith("group:");
    const chave = porGrupo ? (codigo ?? "").trim() : enterpriseId;
    if (porGrupo && !chave) return enterpriseId;

    const consulta = admin
      .from("hercules_empreendimentos")
      .select("pai_id")
      .eq("workspace_id", WORKSPACE);

    const { data } = await (porGrupo
      ? consulta.eq("codigo", chave)
      : consulta.eq("c2x_enterprise_id", chave)
    ).maybeSingle();

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

/** A ordem de assinatura que o empreendimento oferece às suas categorias. */
type HerancaDoEmpreendimento = {
  /** Quando as divisões discordam entre si, a frase de cada uma. Nulo = todas dizem o mesmo. */
  divergencia: null | string[];
  /** `false` = a leitura FALHOU. Não é "não tem regra" — ver a nota da função. */
  lido: boolean;
  nivel: NivelDeOrdem;
};

/**
 * A ordem de assinatura cadastrada no empreendimento — o degrau abaixo da categoria.
 *
 * ⚠️ LÊ O PAI E AS DIVISÕES, e não só o pai. A categoria mora no PAI (as duas que existem hoje,
 * "Condomínio" e "Loteamento", estão em `enterprise_id = 31`, o LAB), mas a aba de política grava
 * a configuração nas DIVISÕES — `enterpriseIds: politicas.map(p => p.enterpriseId)` manda LBF (33),
 * LBP (32) e LBR (27), nunca o 31. Olhar só o pai faria a tela dizer "herda o padrão da casa" com a
 * ordem cadastrada nas três divisões logo ali.
 *
 * ⚠️ E QUANDO AS DIVISÕES DISCORDAM, A TELA DIZ ISSO em vez de escolher uma. A categoria atravessa
 * as três divisões ("o Condomínio e o Loteamento não interfere nos filhos, é tudo junto"), então
 * com LBF em ordem e LBP em paralelo não existe resposta certa — e uma resposta inventada é pior do
 * que a pergunta, porque some.
 *
 * ⚠️ FALHA DE LEITURA NÃO VIRA "NÃO TEM REGRA". É a mesma armadilha da rota de política comercial:
 * um timeout do PostgREST viraria uma AFIRMAÇÃO de negócio na tela ("segue o padrão da casa") e o
 * operador estaria a um clique de cadastrar uma ordem própria "por segurança" — matando a herança
 * sem ninguém perceber. `lido: false` faz a tela dizer que não sabe.
 */
async function ordemDoEmpreendimento(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  dono: string,
  nomeVisivel: string,
): Promise<HerancaDoEmpreendimento> {
  const semRegra: NivelDeOrdem = {
    ordem: null,
    ordenada: false,
    origem: "empreendimento",
    rotulo: nomeVisivel,
  };

  const { data: pai } = await admin
    .from("hercules_empreendimentos")
    .select("id,nome")
    .eq("workspace_id", WORKSPACE)
    .eq("c2x_enterprise_id", dono)
    .maybeSingle();

  const paiRow = pai as null | { id: string; nome: null | string };
  const rotulo = new Map<string, string>([[dono, paiRow?.nome ?? nomeVisivel]]);
  const ids = [dono];

  if (paiRow) {
    const { data: filhos } = await admin
      .from("hercules_empreendimentos")
      .select("codigo,c2x_enterprise_id")
      .eq("workspace_id", WORKSPACE)
      .eq("pai_id", paiRow.id);

    for (const filho of (filhos ?? []) as Array<{
      c2x_enterprise_id: null | string;
      codigo: null | string;
    }>) {
      const id = (filho.c2x_enterprise_id ?? "").trim();
      if (!id || ids.includes(id)) continue;
      ids.push(id);
      rotulo.set(id, filho.codigo ?? id);
    }
  }

  const { data: settings, error } = await admin
    .from("apolo_enterprise_settings")
    .select("enterprise_id,assinatura_ordenada,assinatura_ordem")
    .in("enterprise_id", ids);

  if (error) return { divergencia: null, lido: false, nivel: semRegra };

  const linhas = ((settings ?? []) as Array<{
    assinatura_ordem: unknown;
    assinatura_ordenada: boolean | null;
    enterprise_id: string;
  }>).filter((linha) =>
    temOrdemPropria({ ordem: linha.assinatura_ordem, ordenada: linha.assinatura_ordenada === true }),
  );

  if (linhas.length === 0) return { divergencia: null, lido: true, nivel: semRegra };

  const niveis = linhas.map((linha) => ({
    id: String(linha.enterprise_id),
    nivel: {
      ordem: linha.assinatura_ordem,
      ordenada: linha.assinatura_ordenada === true,
      origem: "empreendimento" as const,
      rotulo: rotulo.get(String(linha.enterprise_id)) ?? nomeVisivel,
    },
  }));

  // O pai manda quando ele mesmo tem regra; senão vale a primeira divisão que tiver.
  const escolhido = niveis.find((n) => n.id === dono) ?? niveis[0];

  const distintas = new Set(
    niveis.map((n) => JSON.stringify([n.nivel.ordenada, regraDoNivel(n.nivel).papeis])),
  );

  return {
    divergencia:
      distintas.size > 1
        ? niveis.map(
            (n) => `${n.nivel.rotulo}: ${descreverRegra(regraDoNivel(n.nivel), rotuloDoPapel)}`,
          )
        : null,
    lido: true,
    nivel: { ...(escolhido?.nivel ?? semRegra), rotulo: paiRow?.nome ?? nomeVisivel },
  };
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

  const dono = await empreendimentoDasCategorias(
    admin,
    enterpriseId,
    new URL(request.url).searchParams.get("codigo"),
  );

  const { data, error } = await admin
    .from("temis_categorias")
    .select("id,nome,categoria_pai_id,ordem,assinatura_ordenada,assinatura_ordem")
    .eq("workspace_id", WORKSPACE)
    .eq("enterprise_id", dono)
    .order("ordem", { ascending: true })
    .order("nome", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Não consegui ler as categorias." }, { status: 502 });
  }

  const linhas = (data ?? []) as Array<{
    assinatura_ordem: unknown;
    assinatura_ordenada: boolean | null;
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

  const heranca = await ordemDoEmpreendimento(
    admin,
    dono,
    new URL(request.url).searchParams.get("nome")?.trim() || "o empreendimento",
  );

  // ⚠️ A SUBCATEGORIA NÃO HERDA DA MÃE, E A TELA NÃO PODE PROMETER QUE HERDA. `resolverOrdem` sabe
  // percorrer uma cadeia de vários degraus, mas quem manda o contrato é `regraDeOrdemDaVenda`
  // (`lib/assinatura/ordem-db.ts`) e ele vai da categoria DIRETO ao empreendimento — de propósito,
  // porque são duas categorias na base inteira e nenhuma subcategoria (medido em 08/09/2026). Se
  // esta tela mostrasse "Fase 1 herda de Loteamento", o envio ignoraria a mãe e o contrato sairia
  // na ordem do empreendimento: a tela dizendo uma coisa e o contrato fazendo outra, sem erro. O
  // dia em que o motor subir para a mãe, é só incluir os degraus aqui.
  const herdada = resolverOrdemDeAssinatura([heranca.nivel]);

  return NextResponse.json({
    data: {
      categorias: linhas.map((c) => {
        // O que ESTA categoria decide por si. Herda = o par intacto (booleano falso, lista nula),
        // que é o estado das duas categorias que existem hoje.
        const nivelDaCategoria: NivelDeOrdem = {
          ordem: c.assinatura_ordem,
          ordenada: c.assinatura_ordenada === true,
          origem: "categoria",
          rotulo: c.nome,
        };
        const propria = temOrdemPropria(nivelDaCategoria) ? regraDoNivel(nivelDaCategoria) : null;

        return {
          categoriaPaiId: c.categoria_pai_id,
          id: c.id,
          nome: c.nome,
          ordemHerdada:
            // ⚠️ SÓ AFIRMA "PADRÃO DA CASA" SE A LEITURA DO EMPREENDIMENTO DEU CERTO. Com a leitura
            // falha, cair no padrão é conclusão de uma consulta que não aconteceu.
            herdada.origem === "padrao" && !heranca.lido
              ? null
              : {
                  ordenada: herdada.regra.ordenada,
                  origem: herdada.origem,
                  papeis: herdada.regra.papeis,
                  rotulo: herdada.rotulo,
                },
          ordemPropria: propria
            ? { ordenada: propria.ordenada, papeis: propria.papeis }
            : null,
          unidades: porCategoria.get(c.id) ?? 0,
        };
      }),
      // A divergência é do EMPREENDIMENTO, e não de uma categoria: vale para todas de uma vez.
      divergenciaDoEmpreendimento: heranca.divergencia,
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
      enterprise_id: await empreendimentoDasCategorias(
        admin,
        enterpriseId,
        new URL(request.url).searchParams.get("codigo"),
      ),
      nome,
      // ⚠️ A CATEGORIA NASCE HERDANDO, e a ordem de assinatura não entra no formulário de criação:
      // `assinatura_ordem` fica nula (o default da 0142) e a categoria segue o empreendimento até
      // alguém decidir o contrário, olhando a ordem herdada que a tela mostra. Perguntar a ordem na
      // hora de digitar o nome faria o operador cadastrar uma cópia da herdada "por segurança" — e
      // a herança morreria no primeiro cadastro, sem ninguém perceber.
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
    // ⚠️ AUSENTE ≠ NULO, a mesma disciplina da rota de política comercial: ausente = não mexeu na
    // ordem; `assinaturaOrdem: null` = limpou, e a categoria volta a herdar do empreendimento.
    assinaturaOrdem?: null | unknown;
    assinaturaOrdenada?: unknown;
    nome?: string;
    ordem?: number;
  };
  if (!corpo) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  const mudancas: Record<string, boolean | null | number | string | string[]> = {
    atualizado_em: new Date().toISOString(),
  };
  if (corpo.nome !== undefined) {
    const nome = corpo.nome.trim();
    if (!nome) return NextResponse.json({ error: "A categoria precisa de um nome." }, { status: 400 });
    mudancas.nome = nome;
  }
  if (corpo.ordem !== undefined) mudancas.ordem = corpo.ordem;
  if (corpo.ativa !== undefined) mudancas.ativa = corpo.ativa;

  // ⚠️ A LISTA É VALIDADA AQUI, NA PORTA. Papel inexistente, papel repetido e lista vazia não
  // derrubam nada na gravação: derrubam semanas depois, no envio do contrato, longe desta tela e
  // sem ninguém para ligar uma coisa à outra.
  const daOrdem = lerOrdemDoCorpo(corpo);
  if (!daOrdem.ok) return NextResponse.json({ error: daOrdem.erro }, { status: 400 });
  if (daOrdem.mudancas) {
    mudancas.assinatura_ordem = daOrdem.mudancas.assinatura_ordem;
    mudancas.assinatura_ordenada = daOrdem.mudancas.assinatura_ordenada;
  }

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  // ⚠️ FILTRA PELO DONO, E NÃO PELO ID DA URL. A ficha consolidada manda `group:Lagoa Bonita` e a
  // ficha de uma etapa manda 33 (LBF), mas as categorias moram no PAI (31) — o `.eq` no id cru
  // casava com zero linhas e o `update` voltava SEM ERRO. A tela dizia "salvo" e nada tinha sido
  // gravado. O GET e o POST já resolviam o dono; o PATCH não.
  const dono = await empreendimentoDasCategorias(
    admin,
    enterpriseId,
    new URL(request.url).searchParams.get("codigo"),
  );

  const { data: salvas, error } = await admin
    .from("temis_categorias")
    .update(mudancas)
    .eq("workspace_id", WORKSPACE)
    .eq("enterprise_id", dono)
    .eq("id", id)
    .select("id");

  // ⚠️ ZERO LINHAS É ERRO, e não sucesso silencioso — é o mesmo sintoma de antes visto pelo outro
  // lado: a categoria não é deste empreendimento (ou não existe mais) e quem clicou precisa saber
  // disso agora, não quando o contrato sair na ordem errada.
  if (!error && (salvas ?? []).length === 0) {
    return NextResponse.json(
      { error: "Não achei esta categoria neste empreendimento. Recarregue a tela." },
      { status: 404 },
    );
  }

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

  // Mesmo motivo do PATCH: a categoria mora no PAI, e o id da URL pode ser o `group:` ou o da
  // etapa. Com o `.eq` no id cru, o `delete` casava zero linhas e voltava sem erro — a tela dizia
  // "excluída" e a categoria continuava lá.
  const dono = await empreendimentoDasCategorias(
    admin,
    enterpriseId,
    new URL(request.url).searchParams.get("codigo"),
  );

  const { data: apagadas, error } = await admin
    .from("temis_categorias")
    .delete()
    .eq("workspace_id", WORKSPACE)
    .eq("enterprise_id", dono)
    .eq("id", id)
    .select("id");

  if (error) return NextResponse.json({ error: "Não consegui apagar a categoria." }, { status: 400 });
  if ((apagadas ?? []).length === 0) {
    return NextResponse.json(
      { error: "Não achei esta categoria neste empreendimento. Recarregue a tela." },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: { id } });
}
