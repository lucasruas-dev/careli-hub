import { NextResponse } from "next/server";

import { CLAUDE_MODEL, getAnthropicClient } from "@/lib/ai/claude";
import {
  cabeNoTetoDoPortal,
  MENSAGEM_DO_TETO_DO_PORTAL,
} from "@/lib/apolo/incorporador/teto-do-portal";
import { APOLO_DOCS_BUCKET, MENSAGEM_DOCUMENTO_GRANDE } from "@/lib/apolo/documentos";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { catalogoParaOModelo, CONHECIMENTO_DA_TEMIS } from "@/lib/temis/agente-conhecimento";
import {
  descreverProposta,
  motivoDaRecusa,
  type Proposta,
  type TipoDeProposta,
  triarPropostas,
} from "@/lib/temis/marcar-variaveis";
import {
  caminhoDeMidiaValido,
  ehTipoAceitoMidia,
  LIMITE_MIDIA_BYTES,
  type MidiaConfirmada,
  PREFIXO_MIDIA,
  sanitizarNomeDeMidia,
  type UrlAssinadaDeUpload,
} from "@/lib/temis/upload-midia";
import { classificarVariaveis, conferirBlocos, extensosOrfaos } from "@/lib/temis/variaveis";

import {
  alcanceDaMinuta,
  alcanceDoEmpreendimento,
  alcanceParaEscrever,
  respostaDoAlcance,
} from "./alcance-da-estrutura";
import { type AtorDaTemis, idDoAutor, origemDoAtor } from "./ator";
import {
  COLUNAS_DA_0173,
  ehColunaDeAutoriaAusente,
  gravarComAutoria,
  nomeComOrigem,
  registrarAtoDoPortal,
} from "./autoria-dos-modelos";

// OS MODELOS DA TÊMIS (MINUTAS) — a lógica das rotas, num lugar só para as DUAS portas.
//
// Decisões do Lucas (16/09/2026): a equipe da Cecílio gera o contrato, manda assinar e *"também
// cria e edita os modelos"* dos produtos dela. A rota do hub (`/api/temis/minutas/**`, Bearer) e a
// do portal (`/api/incorporador/temis/minutas/**`, cookie `apolo_inc`) chamam AS MESMAS funções
// daqui, passando o ATOR (`ator.ts`). O que muda entre as duas é o recorte, e ele é aplicado aqui,
// ANTES de ler ou gravar qualquer coisa, inclusive os ids que vêm da URL ou do corpo.
//
// ⚠️ A MINUTA É DO PRODUTO, E NÃO DA VENDA. Quem confecciona depende da origem da venda (a Gurgel
// entrega à Careli, o time da Cecílio confecciona no portal), mas o MODELO é um só por produto:
// a edição que o time da Cecílio publica vale também para os contratos das vendas da Gurgel naquele
// produto, que a Careli gera. É por isso que o nome de quem mexe pelo portal é gravado com a porta
// junto, "Maria Souza (portal do incorporador)" (`autoria-dos-modelos.ts`): o jurídico da Careli
// abre a minuta e sabe que a versão veio de fora.
//
// ⚠️ O HUB CONTINUA IGUAL. Para o ator do hub, toda conferência de alcance responde "dentro" sem
// consulta (`alcance-da-estrutura.ts`), e o autor continua saindo de `hub_users` (nome ou e-mail).
// As funções devolvem a mesma resposta, com o mesmo status e a mesma frase, que as rotas davam. O
// que o hub ganha é o nome de quem PUBLICA e ARQUIVA, nas colunas da 0173 (a lista de minutas os
// devolve e a tela os mostra; sem a migration simplesmente não são gravados nem lidos).
//
// ⚠️ ESCREVER NO PORTAL É SÓ NO PRODUTO QUE ELE OPERA (decisão do Lucas, 16/09/2026). Criar, salvar,
// publicar, arquivar, subir mídia e chamar o agente perguntam `alcanceParaEscrever` (ou
// `alcanceDaMinuta(..., "escrever")`): a minuta do VOC, que a Cecílio enxerga, responde 403 só
// consulta. Ler, listar e re-assinar a mídia para abrir continuam pelo escopo de sempre.

type Admin = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// ════════════════════════════════════════════════════════════════════════════
// MINUTAS — subir, editar, publicar
// ════════════════════════════════════════════════════════════════════════════
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
//   DELETE → arquiva
//
// ⚠️ VERSÃO PUBLICADA NÃO SE EDITA. Salvar por cima de uma publicada criaria um documento diferente
// do que as pessoas assinaram, com o mesmo id — e daqui a oito anos ninguém conseguiria reproduzir
// o contrato como foi assinado. Por isso o PATCH numa publicada não altera nada: abre a versão
// seguinte, em rascunho.

const LIMITE_DE_CONTEUDO = 4_000_000; // ~4 MB. A maior minuta do C2X tem 4,4 MB (com imagens).

function empreendimentoDaUrl(request: Request): null | string {
  const valor = new URL(request.url).searchParams.get("enterpriseId")?.trim();
  return valor || null;
}

/** O resumo que a tela mostra sem precisar carregar o documento inteiro. */
type LinhaDeMinuta = {
  /** 0173. Ausente sem a migration; nulo no ato anterior a ela. */
  arquivada_por_nome?: null | string;
  atualizado_em: string;
  criado_em: string;
  descricao: null | string;
  id: string;
  nome: string;
  origem_arquivo_nome: null | string;
  publicada_em: null | string;
  /** 0173. Ausente sem a migration; nulo no ato anterior a ela. */
  publicada_por_nome?: null | string;
  situacao: string;
  tipo: string;
  variaveis: unknown;
  versao: number;
};

/**
 * O NOME de quem está mexendo, a partir do id da sessão do hub.
 *
 * ⚠️ A LINHA GUARDA O NOME, E NÃO A CHAVE. `temis_minutas` tem `criado_por` (uuid) desde a 0113 e
 * ninguém nunca o preencheu — e, mesmo preenchido, uuid não responde "quem alterou esta minuta".
 * Guardar o nome é o padrão que o Hércules já usa (`criado_por_nome`, `cancelada_por_nome`): a
 * linha se explica sozinha anos depois, mesmo que a pessoa saia da empresa e o cadastro dela mude.
 *
 * ⚠️ FALHA AQUI NÃO DERRUBA O SALVAMENTO. Ficar sem o nome do autor é ruim; perder a minuta que a
 * pessoa acabou de escrever, por causa de uma consulta de conveniência, é pior.
 */
async function nomeDeQuem(admin: Admin, userId: string): Promise<null | string> {
  try {
    const { data } = await admin
      .from("hub_users")
      .select("display_name,email")
      .eq("id", userId)
      .maybeSingle();

    const pessoa = data as null | { display_name: null | string; email: null | string };
    return pessoa?.display_name?.trim() || pessoa?.email?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * O nome que vai para as colunas de autor.
 *
 * Hub: `hub_users` (nome ou, sem nome, o e-mail), como sempre foi. Portal: o nome do usuário que a
 * sessão assinada carrega, com "(portal do incorporador)" junto (`nomeComOrigem`), sem ida ao banco
 * — o portal não tem linha em `hub_users`.
 */
async function autorDaGravacao(admin: Admin, ator: AtorDaTemis): Promise<null | string> {
  return ator.tipo === "hub" ? nomeDeQuem(admin, ator.userId) : nomeComOrigem(ator);
}

export async function lerMinutas(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const enterpriseId = empreendimentoDaUrl(request);
  const id = url.searchParams.get("id")?.trim();

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  // Uma minuta, com o documento. É o que o editor abre.
  if (id) {
    // ⚠️ O RECORTE VEM ANTES DA LEITURA DO DOCUMENTO: conferir com o conteúdo já em mãos é o mesmo
    // que não conferir, porque ele já saiu do banco.
    const barrado = respostaDoAlcance(await alcanceDaMinuta(admin, ator, id));
    if (barrado) return barrado;

    const { data, error } = await admin
      .from("temis_minutas")
      .select(
        "id, enterprise_id, nome, descricao, tipo, situacao, versao, versao_anterior_id, conteudo, conteudo_html, origem_arquivo_nome, variaveis, publicada_em, criado_em, atualizado_em, criado_por_nome, atualizado_por_nome",
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

  const barrado = respostaDoAlcance(await alcanceDoEmpreendimento(admin, ator, enterpriseId));
  if (barrado) return barrado;

  // ⚠️ O TIPO FILTRA A LISTA, e sem ele o Setup mostraria o termo de distrato na aba da minuta —
  // e alguém publicaria como contrato o texto que encerra contrato. Sem o parâmetro devolve tudo,
  // que é o comportamento de quem já chamava esta rota antes das abas.
  const tipo = url.searchParams.get("tipo")?.trim();

  // ⚠️ QUEM PUBLICOU E QUEM ARQUIVOU VÊM JUNTO, TOLERANTES À 0173. A tela da Careli mostra esses nomes
  // porque a minuta agora também é editada pelo portal ("Maria (portal do incorporador)"). Sem a
  // migration as colunas não existem: a lista é lida de novo sem elas, e a tela só não mostra o nome.
  const listar = (comAutoria: boolean) => {
    let consulta = admin
      .from("temis_minutas")
      .select(
        `id, nome, descricao, tipo, situacao, versao, origem_arquivo_nome, variaveis, publicada_em, criado_em, atualizado_em, criado_por_nome, atualizado_por_nome, capa_path, capa_nome${comAutoria ? `, ${COLUNAS_DA_0173.temis_minutas.join(", ")}` : ""}`,
      )
      .eq("workspace_id", "careli")
      .eq("enterprise_id", enterpriseId);

    if (tipo) consulta = consulta.eq("tipo", tipo);

    return consulta.order("nome", { ascending: true }).order("versao", { ascending: false });
  };

  let { data, error } = await listar(true);
  if (error && ehColunaDeAutoriaAusente(error, COLUNAS_DA_0173.temis_minutas)) {
    ({ data, error } = await listar(false));
  }

  // ⚠️ FALHA FECHADA: lista vazia por erro de leitura faria a tela dizer "não há minuta aqui", e o
  // jurídico subiria de novo a que já existe.
  if (error) {
    return NextResponse.json({ error: "Não consegui listar as minutas." }, { status: 502 });
  }

  // ── QUANTOS PLANOS ASSINAM POR CADA MINUTA ────────────────────────────────
  //
  // Lucas (07/09/2026): *"aqui seria uma tela de informação, além de trazer quem criou, última
  // atualização, queria a informação de quantos contratos foram emitidos nessa minuta/versão"*.
  //
  // ⚠️ CONTRATO EMITIDO AINDA NÃO TEM DE ONDE SAIR — e dizer isso é mais útil do que mostrar um zero
  // que parece medida. O número nasce no dia em que a peça que gera contrato a partir da minuta
  // nascer, e ele vem daqui.
  //
  // O que EXISTE hoje e responde metade da pergunta: quantos PLANOS apontam para cada minuta. É o
  // que diz se mexer nela é seguro — uma minuta usada por três planos é o contrato de três formas
  // de pagamento diferentes.
  const minutas = (data ?? []) as unknown as LinhaDeMinuta[];
  const usos = new Map<string, number>();

  if (minutas.length > 0) {
    const { data: planos } = await admin
      .from("temis_planos")
      .select("minuta_id")
      .eq("workspace_id", "careli")
      .eq("enterprise_id", enterpriseId)
      .not("minuta_id", "is", null);

    for (const linha of (planos ?? []) as Array<{ minuta_id: null | string }>) {
      if (!linha.minuta_id) continue;
      usos.set(linha.minuta_id, (usos.get(linha.minuta_id) ?? 0) + 1);
    }
  }

  return NextResponse.json({
    data: {
      minutas: minutas.map((m) => ({ ...m, planosQueUsam: usos.get(m.id) ?? 0 })),
    },
  });
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

export async function criarMinuta(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
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

  // ⚠️ O EMPREENDIMENTO DA URL É CONFERIDO ANTES DA PRIMEIRA CONSULTA (a do tipo repetido), e não
  // só antes do insert: o 409 diria ao portal o nome da minuta de outro dono. Criar é escrita: no
  // portal, só em produto que ele opera (VOC e VOR ficam só consulta para a Cecílio).
  const barrado = respostaDoAlcance(await alcanceParaEscrever(admin, ator, enterpriseId));
  if (barrado) return barrado;

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
  const autor = await autorDaGravacao(admin, ator);

  const { data, error } = await admin
    .from("temis_minutas")
    .insert({
      atualizado_por_nome: autor,
      conteudo: corpo?.conteudo ?? null,
      conteudo_html: html,
      // Hub: `hub_users.id`. Portal: `apolo_incorporador_usuarios.id` — o nome com a origem diz
      // de qual das duas tabelas o uuid é.
      criado_por: idDoAutor(ator),
      // Quem cria também é quem alterou por último, até alguém mais salvar por cima.
      criado_por_nome: autor,
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
  registrarAtoDoPortal(ator, "minuta criada", { enterpriseId, minutaId: data.id, tipo: tipoNovo });
  return NextResponse.json({ data: { auditoria, id: data.id } });
}

export async function salvarMinuta(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim();
  const acao = url.searchParams.get("acao")?.trim();
  if (!id) return NextResponse.json({ error: "Informe a minuta." }, { status: 400 });

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  // Salvar e publicar são escrita: no portal, só na minuta de produto que ele opera.
  const barrado = respostaDoAlcance(await alcanceDaMinuta(admin, ator, id, "escrever"));
  if (barrado) return barrado;

  const { data: atual, error: erroLeitura } = await admin
    .from("temis_minutas")
    .select(
      "id, enterprise_id, nome, descricao, tipo, situacao, versao, conteudo, conteudo_html, origem_arquivo_nome, criado_por_nome, capa_path, capa_nome",
    )
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

    // ⚠️ PUBLICAR É O ATO QUE MAIS PRECISA DE AUTOR: muda o texto de todo contrato NOVO do produto,
    // inclusive os das vendas da Gurgel que a Careli confecciona. Até a 0173 ninguém o registrava.
    const autor = await autorDaGravacao(admin, ator);

    const idsAnteriores = (anteriores ?? []).map((a) => a.id as string);
    if (idsAnteriores.length > 0) {
      const { error: erroArquivar } = await gravarComAutoria(
        COLUNAS_DA_0173.temis_minutas,
        (comAutoria) =>
          admin
            .from("temis_minutas")
            .update({
              atualizado_em: agora,
              situacao: "arquivada",
              ...(comAutoria ? { arquivada_por_nome: autor } : {}),
            })
            .in("id", idsAnteriores),
      );
      if (erroArquivar) {
        return NextResponse.json({ error: "Não consegui arquivar a versão anterior." }, { status: 502 });
      }
    }

    const { error: erroPublicar } = await gravarComAutoria(
      COLUNAS_DA_0173.temis_minutas,
      (comAutoria) =>
        admin
          .from("temis_minutas")
          .update({
            atualizado_em: agora,
            publicada_em: agora,
            situacao: "publicada",
            variaveis: auditar(html).conhecidas,
            ...(comAutoria ? { publicada_por_nome: autor } : {}),
          })
          .eq("id", id),
    );

    if (erroPublicar) {
      return NextResponse.json({ error: "Não consegui publicar a minuta." }, { status: 502 });
    }
    registrarAtoDoPortal(ator, "minuta publicada", {
      arquivadas: idsAnteriores,
      enterpriseId: atual.enterprise_id,
      minutaId: id,
    });

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

    // ⚠️ AS CATEGORIAS TAMBÉM SEGUEM, PELA MESMA RAZÃO DOS PLANOS. Desde 21/09/2026 a categoria
    // aponta a minuta dela (`temis_categorias.minuta_id`) e esse é o PRIMEIRO degrau da cadeia
    // (`cadeia-do-contrato.ts`): sem o repasse, publicar a v2 deixaria a categoria apontando para a
    // v1 recém-arquivada — e aí não é "texto antigo", é recusa, porque `escolherMinutaDaCadeia` se
    // nega a usar minuta arquivada e NÃO herda por cima dela (quem decidiu, decidiu).
    let categoriasMigradas = 0;
    if (idsAnteriores.length > 0) {
      const { data: categorias, error: erroCategorias } = await admin
        .from("temis_categorias")
        .update({ atualizado_em: agora, minuta_id: id })
        .in("minuta_id", idsAnteriores)
        .select("id");
      if (erroCategorias) {
        return NextResponse.json(
          {
            error:
              "A minuta foi publicada, mas não consegui repassar as categorias que usavam a versão anterior. Confira o vínculo na aba Categorias.",
          },
          { status: 502 },
        );
      }
      categoriasMigradas = (categorias ?? []).length;
    }

    return NextResponse.json({
      data: { arquivadas: idsAnteriores.length, categoriasMigradas, id, planosMigrados },
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
        // ⚠️ A VERSÃO NOVA HERDA O CRIADOR DA ANTERIOR. Ela é a mesma minuta um passo adiante, e não
        // um documento novo: quem escreveu a v1 continua sendo o autor da v2, e quem abriu a v2
        // aparece como quem alterou por último.
        atualizado_por_nome: await autorDaGravacao(admin, ator),
        // ⚠️ A CAPA É DA MINUTA, E ACOMPANHA A VERSÃO NOVA. Sem estas duas linhas a capa morria a
        // cada publicação, e o rastro do dado mostra que morreu mesmo: das 11 minutas de produção,
        // 3 têm `capa_path` e as 3 estão ARQUIVADAS (VOL v1, VOL v4, RVP v1); as 3 publicadas não
        // têm nenhuma (medido em 21/09/2026). No VOL a capa foi enviada, perdida na v2, enviada de
        // novo na v4 e perdida de novo na v5 — e o ramo da capa do montador nunca rodou em
        // produção, enquanto quem subiu achava que ela estava lá. É a mesma razão do repasse dos
        // planos, logo acima: a v2 é a MESMA minuta um passo adiante.
        capa_nome: (atual as { capa_nome?: null | string }).capa_nome ?? null,
        capa_path: (atual as { capa_path?: null | string }).capa_path ?? null,
        conteudo: corpo.conteudo ?? atual.conteudo,
        conteudo_html: html,
        criado_por_nome: (atual as { criado_por_nome?: null | string }).criado_por_nome ?? null,
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
    registrarAtoDoPortal(ator, "nova versão de minuta aberta", {
      enterpriseId: atual.enterprise_id,
      minutaAnteriorId: id,
      minutaId: nova.id,
    });
    return NextResponse.json({
      data: { auditoria, id: nova.id, novaVersao: nova.versao, versaoNova: true },
    });
  }

  const { error } = await admin
    .from("temis_minutas")
    .update({
      atualizado_em: agora,
      // ⚠️ SÓ O "ALTERADO POR" MUDA AQUI. Quem CRIOU a minuta continua sendo quem criou: sobrescrever
      // os dois a cada salvamento apagaria a origem do documento no primeiro ajuste de vírgula.
      atualizado_por_nome: await autorDaGravacao(admin, ator),
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
  registrarAtoDoPortal(ator, "minuta salva", { enterpriseId: atual.enterprise_id, minutaId: id });
  return NextResponse.json({ data: { auditoria, id } });
}

export async function arquivarMinuta(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "Informe a minuta." }, { status: 400 });

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const barrado = respostaDoAlcance(await alcanceDaMinuta(admin, ator, id, "escrever"));
  if (barrado) return barrado;

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

  const autor = await autorDaGravacao(admin, ator);
  const { error } = await gravarComAutoria(COLUNAS_DA_0173.temis_minutas, (comAutoria) =>
    admin
      .from("temis_minutas")
      .update({
        atualizado_em: new Date().toISOString(),
        situacao: "arquivada",
        ...(comAutoria ? { arquivada_por_nome: autor } : {}),
      })
      .eq("workspace_id", "careli")
      .eq("id", id),
  );

  if (error) return NextResponse.json({ error: "Não consegui arquivar a minuta." }, { status: 400 });
  registrarAtoDoPortal(ator, "minuta arquivada", { minutaId: id });
  return NextResponse.json({ data: { id } });
}

// ════════════════════════════════════════════════════════════════════════════
// MÍDIA DO EDITOR — upload por URL assinada
// ════════════════════════════════════════════════════════════════════════════
//
// Pedido do Lucas (02/09/2026): o editor com o Plate UI completo, "mídia com upload". Bucket PRIVADO
// `apolo-documents`, prefixo `temis-minutas/<minutaId>/`.
//
// NÃO RECEBE BYTES. Três verbos, o mesmo padrão do documento grande do CAD e do anexo do Hub IT:
//   POST  { minutaId, fileName, contentType, size } → { bucket, path, token }  URL assinada de UPLOAD
//   PATCH { path }                                  → { url, path, size, type, name }  confirmação
//   GET   ?path=                                    → 302 para uma signed URL de leitura curta
//   GET   ?path=&json=1                             → { url, path } re-assinatura (a tela, ao abrir)
//
// ⚠️ SEM BEARER NO PORTAL, E SEM ARQUIVO NO CORPO. O arquivo sobe do navegador direto para o
// Storage com o `token` da URL assinada (o `uploadToSignedUrl` do Supabase só precisa da chave
// pública e do token, e nenhuma sessão do hub). A função da Vercel nunca vê os bytes, e o teto de
// ~4,5 MB do corpo não se aplica. É o mesmo desenho nas duas portas; muda só quem assina.
//
// ⚠️ A URL GRAVADA NO NÓ do documento é uma signed URL de leitura, e ELA EXPIRA (7 dias). Motivo de
// ser signed URL: `<img src>` não manda Bearer nem é garantido que mande o cookie, então a URL
// precisa abrir sozinha. Motivo de expirar: a primeira versão assinava por 10 ANOS, e isso tornava
// o objeto público para quem tivesse o link — sem sessão, por uma década, em toda cópia do HTML/PDF
// do contrato. Agora a URL viva só existe enquanto alguém autenticado a pediu: a tela re-assina
// cada mídia ao abrir a minuta (`lib/temis/reassinar-midias.ts` → GET ?json=1). O `path` (a chave
// duradoura) é recuperável da própria URL. Alternativa rejeitada: bucket público (o bucket tem CAD
// de cliente).
//
// ⚠️ O caminho é escolhido AQUI, pelo servidor, e amarrado à minuta que existe no banco: um corpo
// forjado não grava em cima de outra pasta. O PATCH/GET só aceitam caminho dentro do prefixo, e no
// portal só de uma minuta no alcance.

// 7 dias: cobre a sessão de edição mais longa e o `conteudo_html` de rascunho entre um salvar e o
// próximo abrir (que re-assina). Curto o bastante para um link vazado morrer sozinho.
export const TTL_LEITURA_MIDIA = 7 * 24 * 60 * 60;
// TTL do GET com redirect (abrir um anexo agora): o mesmo dos documentos do CAD.
const TTL_LEITURA_CURTA = 60 * 10;

const SEM_CACHE = { "Cache-Control": "no-store" } as const;

type CorpoDoPedidoDeMidia = {
  contentType?: unknown;
  fileName?: unknown;
  minutaId?: unknown;
  size?: unknown;
};

/** A minuta dona de um caminho `temis-minutas/<minutaId>/<arquivo>` já validado. */
function minutaDoCaminho(path: string): string {
  return path.slice(PREFIXO_MIDIA.length).split("/")[0] ?? "";
}

export async function pedirUploadDeMidia(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => null)) as CorpoDoPedidoDeMidia | null;
  const minutaId = typeof corpo?.minutaId === "string" ? corpo.minutaId.trim() : "";
  const fileName = typeof corpo?.fileName === "string" ? corpo.fileName : "";
  const contentType =
    typeof corpo?.contentType === "string" ? corpo.contentType.trim().toLowerCase() : "";
  const size = typeof corpo?.size === "number" && Number.isFinite(corpo.size) ? corpo.size : -1;

  if (!minutaId || !/^[A-Za-z0-9-]{8,64}$/.test(minutaId)) {
    return NextResponse.json({ error: "Minuta invalida." }, { status: 400 });
  }
  if (!ehTipoAceitoMidia(contentType)) {
    return NextResponse.json(
      { error: "Tipo de arquivo nao aceito na minuta (imagem, video, audio, PDF ou .docx)." },
      { status: 415 },
    );
  }
  // O teto é cobrado de novo no PATCH com o tamanho REAL; aqui é só para não assinar à toa.
  if (size < 0 || size > LIMITE_MIDIA_BYTES) {
    return NextResponse.json({ error: MENSAGEM_DOCUMENTO_GRANDE }, { status: 413 });
  }

  // ⚠️ NO PORTAL, A MINUTA PRECISA SER DO ATOR ANTES DE QUALQUER OUTRA PERGUNTA. Inexistente e de
  // outro dono respondem igual (404 "Nao encontrado."): a frase "Minuta nao encontrada." só chega
  // ao hub, senão diria ao portal quais ids existem na casa. Subir mídia é escrita na minuta.
  const barrado = respostaDoAlcance(await alcanceDaMinuta(admin, ator, minutaId, "escrever"));
  if (barrado) return barrado;

  // A minuta precisa existir: o prefixo do objeto é o id dela.
  const { data: minuta, error: erroMinuta } = await admin
    .from("temis_minutas")
    .select("id")
    .eq("id", minutaId)
    .maybeSingle<{ id: string }>();
  if (erroMinuta) {
    return NextResponse.json({ error: "Nao foi possivel conferir a minuta." }, { status: 500 });
  }
  if (!minuta) {
    return NextResponse.json({ error: "Minuta nao encontrada." }, { status: 404 });
  }

  const caminho = `${PREFIXO_MIDIA}${minuta.id}/${crypto.randomUUID()}-${sanitizarNomeDeMidia(fileName)}`;
  const assinada = await admin.storage.from(APOLO_DOCS_BUCKET).createSignedUploadUrl(caminho);
  if (assinada.error || !assinada.data) {
    console.warn("[temis/upload] createSignedUploadUrl falhou:", assinada.error?.message);
    return NextResponse.json(
      { error: "Nao foi possivel preparar o envio da midia." },
      { status: 500 },
    );
  }

  const resposta: UrlAssinadaDeUpload = {
    bucket: APOLO_DOCS_BUCKET,
    path: assinada.data.path,
    token: assinada.data.token,
  };
  return NextResponse.json(resposta, { headers: SEM_CACHE });
}

export async function confirmarUploadDeMidia(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => null)) as { path?: unknown } | null;
  const path = typeof corpo?.path === "string" ? corpo.path.trim() : "";
  if (!caminhoDeMidiaValido(path)) {
    return NextResponse.json({ error: "Caminho de midia invalido." }, { status: 400 });
  }

  // ⚠️ ANTES DE TOCAR NO STORAGE: sem isto, o portal confirmaria (e re-assinaria por 7 dias) a
  // mídia de qualquer minuta da casa, bastando conhecer o caminho. Confirmar é escrita.
  const barrado = respostaDoAlcance(
    await alcanceDaMinuta(admin, ator, minutaDoCaminho(path), "escrever"),
  );
  if (barrado) return barrado;

  const bucket = admin.storage.from(APOLO_DOCS_BUCKET);

  // Tamanho REAL do objeto. A trava do cliente pode ser burlada; esta não.
  const info = await bucket.info(path);
  if (info.error || !info.data) {
    return NextResponse.json(
      { error: "Arquivo enviado nao foi encontrado no armazenamento." },
      { status: 404 },
    );
  }
  const tamanho = typeof info.data.size === "number" ? info.data.size : -1;
  if (tamanho < 0) {
    return NextResponse.json(
      { error: "Arquivo enviado nao foi encontrado no armazenamento." },
      { status: 404 },
    );
  }
  if (tamanho > LIMITE_MIDIA_BYTES) {
    await bucket.remove([path]);
    return NextResponse.json({ error: MENSAGEM_DOCUMENTO_GRANDE }, { status: 413 });
  }

  const assinada = await bucket.createSignedUrl(path, TTL_LEITURA_MIDIA);
  if (assinada.error || !assinada.data?.signedUrl) {
    console.warn("[temis/upload] createSignedUrl falhou:", assinada.error?.message);
    return NextResponse.json({ error: "Nao foi possivel gerar o link da midia." }, { status: 500 });
  }

  const nome = path.slice(path.lastIndexOf("/") + 1).replace(/^[0-9a-f-]{36}-/i, "");
  const resposta: MidiaConfirmada = {
    name: nome,
    path,
    size: tamanho,
    type: typeof info.data.contentType === "string" ? info.data.contentType : "",
    url: assinada.data.signedUrl,
  };
  return NextResponse.json(resposta, { headers: SEM_CACHE });
}

/**
 * Re-assinatura sob demanda (leitura). É a "rota autenticada" para quem tem o `path` e precisa de
 * um link novo: a tela ao abrir a minuta (`?json=1`, porque `<img>` não segue um 302 com Bearer —
 * quem pede é o `fetch` da tela, que troca a URL no nó) e o futuro gerador de contrato. Sem `json`,
 * é o 302 curto para abrir um anexo no navegador.
 */
export async function reassinarMidia(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
  const parametros = new URL(request.url).searchParams;
  const path = (parametros.get("path") ?? "").trim();
  const emJson = parametros.get("json") === "1";
  if (!caminhoDeMidiaValido(path)) {
    return NextResponse.json({ error: "Caminho de midia invalido." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const barrado = respostaDoAlcance(await alcanceDaMinuta(admin, ator, minutaDoCaminho(path)));
  if (barrado) return barrado;

  // A URL que vai para o nó do documento tem o prazo da mídia; a do redirect é só para abrir agora.
  const assinada = await admin.storage
    .from(APOLO_DOCS_BUCKET)
    .createSignedUrl(path, emJson ? TTL_LEITURA_MIDIA : TTL_LEITURA_CURTA);
  if (assinada.error || !assinada.data?.signedUrl) {
    return NextResponse.json({ error: "Midia nao encontrada." }, { status: 404 });
  }

  if (emJson) {
    return NextResponse.json({ path, url: assinada.data.signedUrl }, { headers: SEM_CACHE });
  }
  return NextResponse.redirect(assinada.data.signedUrl, { headers: SEM_CACHE, status: 302 });
}

// ════════════════════════════════════════════════════════════════════════════
// O SUPER AGENTE DA MINUTA — marcar variáveis e conversar
// ════════════════════════════════════════════════════════════════════════════
//
// Lucas (07/09/2026): *"isso é o que eu quero, um super agente que consiga inserir as variáveis,
// olhar o texto e identificar onde as variáveis vão, e conhece todas as variáveis, pode subir para
// opus 5"*.
//
// ⚠️ ELE PROPÕE, NÃO REESCREVE — a decisão está explicada em `lib/temis/marcar-variaveis.ts`. O
// modelo devolve pares {trecho, variável}; o texto do contrato nunca passa por ele de volta. Assim
// nenhuma palavra do instrumento muda por conta de uma geração, e `[nome do cliente]` não tem como
// nascer.
//
// ⚠️ TODA PROPOSTA É CONFERIDA AQUI, no servidor, antes de chegar à tela: variável fora do catálogo,
// trecho que não existe no texto, trecho repetido e trecho já marcado são descartados. A tela mostra
// o que foi recusado e por quê — isso é informação útil, não erro escondido.
//
// ⚠️ SEM LEITURA DE BANCO, E POR ISSO SEM ID PARA RECORTAR. O agente recebe o TEXTO que está na tela
// e o catálogo de variáveis (que é da casa inteira, igual para todo produto). O que o portal pode
// mandar aqui é o que ele já tem aberto; a porta (`autorizarTemisDoPortal`) é o recorte.
//
// ⚠️ OPUS 5 (`CLAUDE_MODEL.frontier`), e não o modelo padrão: a tarefa é ler um contrato de 60 mil
// caracteres e casar trechos com um catálogo de ~280 nomes parecidos entre si (`nome_cliente` x
// `nome_conjuge` x `nome_cliente_2`). Errar aqui é marcar o cônjuge como comprador.
//
// ⚠️ SÃO DUAS PASSADAS, E É AQUI QUE MORA A DIFERENÇA. Lucas, 08/09/2026, depois do primeiro teste
// com a minuta do Aldeia da Cachoeira: *"achei pouco as variáveis a serem inseridas, ainda não está
// legal, o que podemos fazer? Pois se te pedir para montar essa minuta você vai conseguir — queria
// era esse tipo de inteligência"*.
//
// Ele está certo, e a diferença não era de modelo: era de MÉTODO. Uma pessoa preparando essa minuta
// não entrega a primeira lista que escreve — ela relê o documento com a lista na mão e pergunta "o
// que passou?". Uma passada só é ótima nas primeiras seções (partes, imóvel) e vai rareando.
//
//   PASSADA 1   lê o texto e propõe.
//   PASSADA 2   recebe o TEXTO e a LISTA da primeira, e procura só o que ficou de fora.
//
// ⚠️ E SÃO DUAS REQUISIÇÕES, NÃO DUAS CHAMADAS NUMA SÓ. O teto da função na Vercel é 300 segundos, e
// uma leitura de 45 mil caracteres por um modelo de fronteira, com resposta longa, come uma boa
// parte disso. Somar as duas na mesma requisição colocaria as DUAS passadas em risco de estourar
// junto — e um timeout aqui volta como TEXTO, não como JSON, então nem a mensagem de erro chega
// ([[reference_vercel_timeout_vira_erro_de_json]]). Quem orquestra é a TELA: manda a primeira
// rodada, recebe as propostas, e manda a segunda passando o que já veio (`jaPropostas` no corpo).

/** Quanto texto aceitamos de uma vez. Acima disso, a tela manda por partes. */
const TETO_DE_TEXTO_PARA_MARCAR = 120_000;

/**
 * ⚠️ O CLIENTE COMPARTILHADO ABORTA EM 90 SEGUNDOS, E FOI ISSO QUE DERRUBOU O AGENTE.
 *
 * `getAnthropicClient()` é o mesmo de toda a casa e nasce com `timeout: 90_000` — uma decisão certa
 * para o webhook do WhatsApp, onde a mediana da CACÁ é 8,7 segundos e um timeout longo segura a
 * função serverless com o cliente pendurado (ver a nota em `lib/ai/claude.ts`).
 *
 * Ler 45 mil caracteres de contrato e devolver 80 propostas NÃO cabe em 90 segundos. O SDK abortava
 * a chamada, a rota devolvia "a IA não respondeu" e a tela mostrava zero variáveis. Era isso — e não
 * o tamanho da resposta — o "1 de 2 partes falharam" que o Lucas viu nos dois testes.
 *
 * 280 segundos deixa margem para os 300 de `maxDuration`: o que estourar aqui estoura como erro
 * nosso, com mensagem, em vez de virar o timeout mudo da Vercel (que volta como HTML, não JSON).
 */
const TEMPO_DE_LEITURA = 280_000;

/**
 * O teto do agente da minuta para quem vem do PORTAL. `null` = pode chamar o modelo.
 *
 * ⚠️ POR QUE (revisão da onda 3, 16/09/2026): marcar e conversar chamam o modelo de fronteira com até
 * 120 mil caracteres por pedido, pago pela Careli. No hub isso é ferramenta do jurídico da casa; no
 * portal é uma torneira aberta para gente de fora, e um laço virava fatura. O teto é por usuário do
 * portal (`teto-do-portal.ts`) e só é contado depois das recusas baratas (texto vazio, texto grande
 * demais), para erro de uso não gastar a cota. O hub não passa por aqui.
 */
async function tetoDoAgenteNoPortal(ator: AtorDaTemis): Promise<NextResponse | null> {
  if (ator.tipo !== "portal") return null;
  if (await cabeNoTetoDoPortal(createApoloAdminClient(), ator, "agente-da-minuta")) return null;
  console.warn("[temis][portal] teto do agente da minuta atingido", {
    incorporadorId: ator.incorporadorId,
    slug: ator.slug,
    usuarioId: ator.usuarioId,
  });
  return NextResponse.json({ erro: MENSAGEM_DO_TETO_DO_PORTAL }, { status: 429 });
}

/**
 * A minuta sobre a qual o agente trabalha, no PORTAL: precisa ser de produto que ele opera. `null` =
 * pode seguir.
 *
 * ⚠️ POR QUE O AGENTE PERGUNTA, SE ELE NÃO GRAVA NADA (decisão do Lucas, 16/09/2026: escrita só no
 * que a Cecílio opera). Marcar e conversar são o primeiro passo de EDITAR a minuta, e cada chamada é
 * um modelo de fronteira pago pela Careli. Na minuta do VOC, que para a Cecílio é só consulta, o
 * salvar já seria recusado; deixar o agente trabalhar antes seria só custo.
 *
 * ⚠️ O ID VEM DO CORPO (`minutaId`) OU DA URL (`?minutaId=`), nessa ordem. Sem id nenhum é 404 (o
 * parâmetro esquecido não vira permissão). O hub não passa por aqui: a Careli edita todo modelo.
 */
async function minutaDoAgenteNoPortal(
  ator: AtorDaTemis,
  request: Request,
  doCorpo: unknown,
): Promise<NextResponse | null> {
  if (ator.tipo !== "portal") return null;

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ erro: "Supabase indisponível." }, { status: 503 });

  const minutaId =
    (typeof doCorpo === "string" ? doCorpo.trim() : "") ||
    (new URL(request.url).searchParams.get("minutaId") ?? "").trim();
  return respostaDoAlcance(await alcanceDaMinuta(admin, ator, minutaId, "escrever"));
}

export async function marcarVariaveisDaMinuta(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
  const cliente = getAnthropicClient();
  if (!cliente) {
    return NextResponse.json(
      { erro: "A IA não está configurada (falta ANTHROPIC_API_KEY)." },
      { status: 503 },
    );
  }

  const corpo = (await request.json().catch(() => ({}))) as {
    jaPropostas?: unknown;
    minutaId?: unknown;
    texto?: unknown;
  };
  const texto = typeof corpo.texto === "string" ? corpo.texto : "";
  // Quando vem lista, esta requisição é a RELEITURA: procura o que a primeira deixou passar.
  const jaPropostas = lerPropostasDaVarredura(
    typeof corpo.jaPropostas === "string"
      ? corpo.jaPropostas
      : JSON.stringify({ propostas: corpo.jaPropostas ?? [] }),
  );
  const ehReleitura = (jaPropostas?.length ?? 0) > 0;

  if (!texto.trim()) {
    return NextResponse.json({ erro: "Sem texto para marcar." }, { status: 400 });
  }

  if (texto.length > TETO_DE_TEXTO_PARA_MARCAR) {
    return NextResponse.json(
      {
        erro: `O texto tem ${texto.length.toLocaleString("pt-BR")} caracteres e o teto é ${TETO_DE_TEXTO_PARA_MARCAR.toLocaleString("pt-BR")}. Selecione um trecho e marque por partes.`,
      },
      { status: 413 },
    );
  }

  const barradoPelaMinuta = await minutaDoAgenteNoPortal(ator, request, corpo.minutaId);
  if (barradoPelaMinuta) return barradoPelaMinuta;

  const barradoPeloTeto = await tetoDoAgenteNoPortal(ator);
  if (barradoPeloTeto) return barradoPeloTeto;

  let bruto = "";
  try {
    // ⚠️ STREAM, E NÃO `create`. Duas razões, e as duas doem em produção:
    //
    // 1. A CONEXÃO FICA VIVA. Numa chamada comum o servidor da Anthropic só responde quando termina
    //    de escrever, e no meio disso não há tráfego nenhum — qualquer proxy no caminho (o da
    //    Vercel inclusive) pode considerar a conexão ociosa e derrubá-la. Com stream, cada pedaço
    //    que chega é atividade.
    // 2. A PRÓPRIA ANTHROPIC RECUSA requisição não-streaming quando o `max_tokens` pedido é grande
    //    o bastante para a resposta demorar demais. Pedimos 32 mil.
    //
    // O `finalMessage()` espera o fim e devolve a mensagem inteira, então nada muda daqui para
    // baixo: quem lê o JSON continua lendo de uma vez só.
    const resposta = await cliente.messages
      .stream(
        {
          // ⚠️ 16 MIL TRUNCAVA A RESPOSTA. Uma minuta de 50 mil caracteres rende 60 a 100
          // propostas, cada uma com trecho e contexto — passa fácil de 16 mil tokens de saída, e o
          // JSON vinha cortado no meio.
          //
          // ⚠️ MAS NÃO SUBA ISTO SEM LIMITE. No Opus 5 o `max_tokens` é teto de RACIOCÍNIO MAIS
          // RESPOSTA (ver a nota em `lib/ai/claude.ts`), e um valor acima do teto do modelo é
          // recusado na hora, com 400 — que chega à tela como "a IA não respondeu", sem dizer o
          // motivo.
          max_tokens: 32_000,
          messages: [
            {
              content: ehReleitura
                ? `CATÁLOGO DE VARIÁVEIS:\n${catalogoParaOModelo()}\n\n---\n\nTEXTO DA MINUTA:\n\n${texto}\n\n---\n\nO QUE JÁ FOI PROPOSTO NA PRIMEIRA LEITURA (${jaPropostas?.length ?? 0}):\n${listaDoQueJaVeio(jaPropostas ?? [])}`
                : `CATÁLOGO DE VARIÁVEIS:\n${catalogoParaOModelo()}\n\n---\n\nTEXTO DA MINUTA:\n\n${texto}`,
              role: "user",
            },
          ],
          model: CLAUDE_MODEL.frontier,
          system: ehReleitura ? `${CONHECIMENTO_DA_TEMIS}\n\n${RELEITURA}` : CONHECIMENTO_DA_TEMIS,
        },
        { timeout: TEMPO_DE_LEITURA },
      )
      .finalMessage();
    // Só os blocos de texto: a resposta pode trazer outros tipos (raciocínio, uso de ferramenta),
    // e concatenar tudo cegamente colocaria lixo dentro do JSON que vamos ler.
    bruto = resposta.content.map((bloco) => (bloco.type === "text" ? bloco.text : "")).join("");
  } catch (e) {
    // ⚠️ O MOTIVO PRECISA CHEGAR À TELA. "A IA não respondeu" sozinho custou duas rodadas de teste
    // do Lucas: o erro real era o timeout de 90s do cliente compartilhado, e a mensagem genérica
    // não deixava ninguém suspeitar disso. Aqui vai a mensagem do SDK — que diz "timeout",
    // "max_tokens" ou o código do erro —, e nada do conteúdo do contrato.
    const motivo = e instanceof Error ? e.message : String(e);
    console.error("[temis][marcar] falha ao chamar o modelo", origemDoAtor(ator), motivo);
    return NextResponse.json({ erro: `A IA não respondeu: ${motivo.slice(0, 200)}` }, { status: 502 });
  }

  const propostas = lerPropostasDaVarredura(bruto);
  if (!propostas) {
    return NextResponse.json(
      { erro: "A IA respondeu num formato que não deu para ler." },
      { status: 502 },
    );
  }

  const { aceitas, recusadas } = triarPropostas(texto, propostas);

  return NextResponse.json({
    // A ordem de aplicação é de trás para a frente; a tela mostra na ordem do texto, que é como
    // quem revisa lê.
    propostas: [...aceitas]
      .sort((a, b) => a.posicao - b.posicao)
      .map((a) => ({
        // O que a proposta VAI FAZER, escrito em português: a tela mostra isso, e não o nome cru.
        acao: descreverProposta(a),
        // ⚠️ O CONTEXTO VIAJA ATÉ A TELA. Ela reacha o trecho no clique (o documento pode ter
        // mudado), e sem a mesma âncora a lacuna voltaria a ser ambígua exatamente onde a triagem a
        // resolveu.
        contexto: a.contexto ?? "",
        motivo: a.motivo,
        nome: a.nome,
        // Só o tipo `variavel` tem origem e rótulo de catálogo; os outros descrevem a si mesmos.
        origem: a.variavel?.origem ?? "",
        posicao: a.posicao,
        rotulo: a.variavel?.rotulo ?? descreverProposta(a),
        tipo: a.tipo,
        trecho: a.trecho,
      })),
    // O que foi recusado é informação, não erro escondido: mostra que a rede de segurança agiu.
    recusadas: recusadas.map((r) => ({
      motivo: motivoDaRecusa(r),
      nome: r.proposta.nome,
      trecho: r.proposta.trecho,
    })),
  });
}

/**
 * Lê o JSON da resposta da varredura.
 *
 * ⚠️ TOLERA CERCA DE CÓDIGO E TEXTO EM VOLTA. O modelo às vezes embrulha o JSON em ```json apesar da
 * instrução; recusar por isso desperdiçaria uma resposta boa. O que NÃO se tolera é conteúdo
 * inválido — aí a triagem recusa proposta por proposta, que é onde a segurança mora.
 */
function lerPropostasDaVarredura(bruto: string): null | Proposta[] {
  const semCerca = bruto.replace(/^```(?:json)?/gm, "").replace(/```$/gm, "").trim();
  const inicio = semCerca.indexOf("{");
  const fim = semCerca.lastIndexOf("}");
  if (inicio < 0 || fim <= inicio) return null;

  try {
    const corpo = JSON.parse(semCerca.slice(inicio, fim + 1)) as { propostas?: unknown };
    if (!Array.isArray(corpo.propostas)) return null;
    return corpo.propostas
      .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object")
      .map((p) => ({
        contexto: typeof p.contexto === "string" ? p.contexto : undefined,
        motivo: typeof p.motivo === "string" ? p.motivo : "",
        nome: typeof p.nome === "string" ? p.nome : "",
        // Tipo desconhecido não é recusado aqui: a triagem trata como `variavel`, que é o que a
        // primeira versão do agente devolvia e o que ele faz na esmagadora maioria das vezes.
        tipo: typeof p.tipo === "string" ? (p.tipo as TipoDeProposta) : undefined,
        trecho: typeof p.trecho === "string" ? p.trecho : "",
      }));
  } catch {
    return null;
  }
}

/**
 * A lista do que a primeira leitura já propôs, como o modelo precisa ver.
 *
 * ⚠️ É ELA QUE TORNA A RELEITURA DIFERENTE DE RODAR DUAS VEZES. Sem a lista, a segunda chamada
 * devolveria mais ou menos as mesmas propostas — as fáceis, do começo do documento. Com a lista, a
 * pergunta muda de "o que tem aqui?" para "o que ficou de fora?", que é a pergunta que uma pessoa
 * faz na segunda leitura.
 */
function listaDoQueJaVeio(propostas: Proposta[]): string {
  if (propostas.length === 0) return "(nada)";
  return propostas
    .map((p) => `- [${p.nome || p.tipo || "?"}] sobre "${cortarParaLista(p.trecho)}"`)
    .join("\n");
}

function cortarParaLista(t: string): string {
  const limpo = (t ?? "").replace(/\s+/g, " ").trim();
  return limpo.length > 60 ? `${limpo.slice(0, 60)}…` : limpo;
}

const RELEITURA = `# ESTA É A SEGUNDA LEITURA

Você já leu esta minuta uma vez e produziu a lista que está no fim da mensagem. Agora releia o
documento com essa lista na mão e ache O QUE FICOU DE FORA.

Não repita nada da lista. Não comente o que já foi proposto. Devolva SÓ o que falta.

⚠️ ONDE A PRIMEIRA LEITURA COSTUMA FALHAR — procure nestes lugares primeiro:

1. NO FIM DO DOCUMENTO. A primeira leitura é minuciosa nas partes e no imóvel, e vai rareando: foro,
   assinaturas, quadro-resumo, cláusulas de tributos e de rescisão quase sempre ficam sem marcação.
2. NOS VALORES. Preço, sinal, entrada, saldo, prazo, dia de vencimento, comissão — e o POR EXTENSO
   de cada um deles, que é uma variável separada e é esquecida com frequência.
3. NAS REPETIÇÕES. O nome do comprador e a identificação do lote costumam aparecer três ou quatro
   vezes no contrato (qualificação, objeto, quadro-resumo, assinatura). A primeira leitura marca a
   primeira ocorrência e esquece as outras — use "contexto" para desambiguar cada uma.
4. NO CABEÇALHO E NO RODAPÉ DAS SEÇÕES. Títulos com o nome do empreendimento, "QUADRA X - LOTE Y",
   a cidade e a data.
5. NAS LACUNAS DISCRETAS: um "____" curto no meio de uma frase, um "(extenso)" vazio, um "[●]".
6. NOS BLOCOS CONDICIONAIS que ninguém propôs: o trecho do cônjuge, o do segundo comprador, o que só
   vale para pessoa jurídica. Se o documento tem uma qualificação de cônjuge solta, ela precisa de
   "envolver".

Percorra o documento inteiro, do título à última assinatura. Se você não achar nada, devolva
{"propostas":[]} — mas antes confira o fim do contrato, que é onde quase sempre há coisa.

Mesmo formato de saída de sempre, e as mesmas regras (trecho copiado, único ou com contexto, nome do
catálogo). Sem cerca de código.`;

// ── A CONVERSA COM O AGENTE ─────────────────────────────────────────────────
//
// Lucas, 08/09/2026: *"acho que pode ter um chat entre o usuário e o agente"* e *"ele precisa
// entender muito sobre contratos, as nossas variáveis, queria esse tipo de interação"*.
//
// ⚠️ POR QUE ISTO EXISTE SEPARADO DO BOTÃO. O botão "Marcar variáveis" é uma varredura: lê a minuta
// inteira e devolve tudo que enxergou. Mas uma minuta de verdade tem casos que só uma pessoa
// resolve, e que a varredura sozinha erra ou pula:
//
//   "esse aí é o cônjuge, não o comprador"        — a correção que ensina no meio do trabalho
//   "por que você não marcou a cláusula VII?"     — a pergunta que descobre uma variável faltando
//   "marca só a parte das partes por enquanto"    — o recorte que a varredura não sabe fazer
//   "o que é [valor_garantia_fiduciaria]?"        — a dúvida sobre o próprio catálogo
//
// ⚠️ ELE RESPONDE E PROPÕE NA MESMA VOLTA. A resposta em texto explica; as propostas, quando vêm,
// passam pela MESMA triagem do botão e caem na mesma lista de aplicar.
//
// ⚠️ E ELE CONTINUA SEM REESCREVER O TEXTO. A única coisa que muda o documento é uma proposta
// aplicada. Ver `lib/temis/marcar-variaveis.ts`.

/** O texto da minuta que acompanha cada volta da conversa. */
const TETO_DE_TEXTO_DA_CONVERSA = 120_000;

/** Quantas voltas da conversa viajam. Além disso, o começo cai — o contexto é a minuta, não o papo. */
const TETO_DE_MENSAGENS = 24;

/**
 * ⚠️ A MARCA QUE SEPARA CONVERSA DE PROPOSTA. Sem ela o modelo teria de escolher entre falar e
 * propor: JSON puro impede a explicação, e texto puro impede a aplicação. Com a marca, ele faz as
 * duas coisas na mesma resposta — e o que estiver fora dela é lido como conversa, nunca como
 * comando.
 */
const ABRE = "<PROPOSTAS>";
const FECHA = "</PROPOSTAS>";

const COMO_CONVERSAR = `
# COMO VOCÊ CONVERSA AQUI

Você está falando com quem prepara a minuta — normalmente o jurídico ou o Lucas. Ele está com o
documento aberto na tela, ao lado desta conversa.

Responda em português do Brasil, direto, sem preâmbulo e sem repetir a pergunta. Frases curtas.
Quando ele apontar um erro seu, corrija sem se desculpar e siga.

Você conhece o catálogo inteiro e a arquitetura acima: use isso para RESPONDER, não só para propor.
Se ele perguntar o que é uma variável, de onde vem o valor, por que você não marcou um trecho, ou
qual das duas parecidas é a certa — responda com o que você sabe.

⚠️ QUANDO ELE PEDIR PARA VOCÊ FAZER ALGUMA COISA NO DOCUMENTO, responda em texto E acrescente as
propostas, entre as marcas, no FIM da mensagem:

${ABRE}{"propostas":[{"tipo":"variavel","trecho":"...","contexto":"...","nome":"cpf_cliente","motivo":"..."}]}${FECHA}

As regras das propostas são as mesmas de sempre (trecho copiado do texto, único ou com contexto,
nome do catálogo). Elas passam pela mesma conferência, e ele aplica clicando.

Se a mensagem dele for uma pergunta, responda só em texto — não force proposta nenhuma.
Se você não tem certeza de um trecho, diga isso em vez de propor: proposta errada num contrato
assinado é cara, e ele está do seu lado para tirar a dúvida.`;

type MensagemDaConversa = { conteudo: string; papel: "agente" | "usuario" };

export async function conversarSobreAMinuta(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
  const cliente = getAnthropicClient();
  if (!cliente) {
    return NextResponse.json(
      { erro: "A IA não está configurada (falta ANTHROPIC_API_KEY)." },
      { status: 503 },
    );
  }

  const corpo = (await request.json().catch(() => ({}))) as {
    mensagens?: unknown;
    minutaId?: unknown;
    texto?: unknown;
  };
  const texto = typeof corpo.texto === "string" ? corpo.texto : "";
  const mensagens = lerMensagens(corpo.mensagens);

  if (mensagens.length === 0) {
    return NextResponse.json({ erro: "Sem pergunta." }, { status: 400 });
  }

  const barradoPelaMinuta = await minutaDoAgenteNoPortal(ator, request, corpo.minutaId);
  if (barradoPelaMinuta) return barradoPelaMinuta;

  const barradoPeloTeto = await tetoDoAgenteNoPortal(ator);
  if (barradoPeloTeto) return barradoPeloTeto;

  // ⚠️ A MINUTA VIAJA CORTADA, e a conversa continua. Um contrato de 140 mil caracteres não cabe
  // numa volta com histórico; cortar o TEXTO (e dizer que cortou) é melhor do que recusar a
  // conversa — as perguntas costumam ser sobre o começo do documento, onde ficam as partes.
  const cortado = texto.length > TETO_DE_TEXTO_DA_CONVERSA;
  const minuta = cortado ? texto.slice(0, TETO_DE_TEXTO_DA_CONVERSA) : texto;

  let bruto = "";
  try {
    // Stream pelo mesmo motivo da varredura: mantém a conexão viva na leitura de um contrato.
    const resposta = await cliente.messages
      .stream(
        {
          max_tokens: 8_000,
          messages: [
            {
              content: [
                `CATÁLOGO DE VARIÁVEIS:\n${catalogoParaOModelo()}`,
                "---",
                minuta.trim()
                  ? `TEXTO DA MINUTA ABERTA NA TELA${cortado ? " (cortado no começo do documento — diga isso se a pergunta for sobre o fim)" : ""}:\n\n${minuta}`
                  : "A minuta na tela está vazia.",
              ].join("\n\n"),
              role: "user",
            },
            {
              content: "Certo. Li a minuta e conheço o catálogo. O que você precisa?",
              role: "assistant",
            },
            ...mensagens.map((m) => ({
              content: m.conteudo,
              role: m.papel === "usuario" ? ("user" as const) : ("assistant" as const),
            })),
          ],
          model: CLAUDE_MODEL.frontier,
          system: `${CONHECIMENTO_DA_TEMIS}\n\n${COMO_CONVERSAR}`,
          // ⚠️ O CLIENTE COMPARTILHADO ABORTA EM 90 SEGUNDOS — certo para o webhook do WhatsApp,
          // curto demais para uma pergunta sobre um contrato de 50 mil caracteres. Ver a nota de
          // `TEMPO_DE_LEITURA`.
        },
        { timeout: TEMPO_DE_LEITURA },
      )
      .finalMessage();
    bruto = resposta.content.map((bloco) => (bloco.type === "text" ? bloco.text : "")).join("");
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.error("[temis][conversar] falha ao chamar o modelo", origemDoAtor(ator), motivo);
    return NextResponse.json({ erro: `A IA não respondeu: ${motivo.slice(0, 200)}` }, { status: 502 });
  }

  const { fala, propostas } = separar(bruto);
  const { aceitas, recusadas } = triarPropostas(texto, propostas);

  return NextResponse.json({
    propostas: [...aceitas]
      .sort((a, b) => a.posicao - b.posicao)
      .map((a) => ({
        acao: descreverProposta(a),
        contexto: a.contexto ?? "",
        motivo: a.motivo,
        nome: a.nome,
        origem: a.variavel?.origem ?? "",
        posicao: a.posicao,
        rotulo: a.variavel?.rotulo ?? descreverProposta(a),
        tipo: a.tipo,
        trecho: a.trecho,
      })),
    recusadas: recusadas.map((r) => ({
      motivo: motivoDaRecusa(r),
      nome: r.proposta.nome ?? "",
      trecho: r.proposta.trecho,
    })),
    resposta: fala,
  });
}

/**
 * Separa o que é conversa do que é proposta.
 *
 * ⚠️ SEM AS MARCAS, TUDO É CONVERSA. Um modelo que esqueceu de fechar o bloco produz uma mensagem
 * estranha, não uma proposta inventada — e o operador vê o texto e pede de novo. O contrário
 * (adivinhar propostas dentro da fala) abriria a porta para aplicar o que ele só estava explicando.
 */
function separar(bruto: string): { fala: string; propostas: Proposta[] } {
  const inicio = bruto.indexOf(ABRE);
  const fim = bruto.indexOf(FECHA, inicio + 1);
  if (inicio < 0 || fim < 0) return { fala: bruto.trim(), propostas: [] };

  const fala = (bruto.slice(0, inicio) + bruto.slice(fim + FECHA.length)).trim();
  const dentro = bruto.slice(inicio + ABRE.length, fim);
  return { fala, propostas: lerPropostasDaVarredura(dentro) ?? [] };
}

/** As mensagens da conversa, saneadas. Só as últimas — o contexto que importa é a minuta. */
function lerMensagens(cru: unknown): MensagemDaConversa[] {
  if (!Array.isArray(cru)) return [];
  return cru
    .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object")
    .map((m) => ({
      conteudo: typeof m.conteudo === "string" ? m.conteudo.slice(0, 8_000) : "",
      papel: m.papel === "agente" ? ("agente" as const) : ("usuario" as const),
    }))
    .filter((m) => m.conteudo.trim() !== "")
    .slice(-TETO_DE_MENSAGENS);
}
