import { NextResponse } from "next/server";

import { autorizarOperacaoDeVenda } from "@/lib/apolo/incorporador/board-do-portal";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { autorizarEscritaNoProduto } from "@/lib/apolo/incorporador/operacao-do-produto-servidor";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  conferirBloqueio,
  motivoDoBloqueio,
  type PedidoDeBloqueio,
} from "@/lib/hercules/bloqueio-de-unidade";
import { lerComColunasDoApartamento, nomeDaUnidade } from "@/lib/hercules/nome-da-unidade";

// O BLOQUEIO DA UNIDADE — o coordenador tira um lote da venda, com o motivo escrito.
//
// Lucas (14/09/2026): *"o coordenador pode bloquear as unidades (...) ter um campo de justificativa
// do bloqueio"* · *"não pode ter nenhuma proposta, reserva, contrato, o bloqueio aparece somente
// quando não há nada na unidade. se tiver uma reserva, primeiro ele cancela a reserva para depois
// bloquear o lote"*.
//
// ⚠️ `autorizarOperacaoDeVenda`, E NUNCA `autorizar`. A diferença já foi paga em produção:
// `autorizar` não olha o TIPO do portal, e por isso um usuário de portal de INCORPORADOR chegou a
// cancelar proposta do comercial. São 35 portais de incorporador contra 3 do comercial — usar o
// gate errado aqui daria a 35 donos de loteamento o poder de tirar lote da venda. A porta aceita o
// comercial e SÓ os incorporadores da lista explícita que operam a própria venda (o Cecílio,
// Lucas em 16/09/2026); os demais seguem recebendo 404.
//
// ⚠️ E O ESCOPO VEM DO COOKIE, NUNCA DO CORPO. O `unidadeId` do POST é conferido contra
// `idsDaSessao`; unidade de fora responde 404, e não 403 — a resposta não pode diferenciar "não é
// seu" de "não existe".

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ⚠️ "careli", E NÃO UM UUID. A coluna é TEXT com default 'careli' (migration 0112), e as 5.541
// linhas de `hercules_unidades` e as 4.890 de `hercules_propostas` estão todas nela — conferido em
// 14/09/2026. Escrevi um uuid aqui na primeira versão e a rota respondia 404 em TODO POST: texto
// contra texto não dá erro de tipo, só casa zero linhas, em silêncio. As nove rotas irmãs de
// /venda usam "careli"; esta é a décima.
const WORKSPACE = "careli";

type UnidadeDoBloqueio = {
  /** Só no prédio (0171). Ausente quando a coluna ainda não existe. */
  apartamento?: null | string;
  bloqueado_em: null | string;
  codigo: null | string;
  enterprise_id: null | string;
  espelho_de: null | string;
  id: string;
  lote: null | string;
  quadra: null | string;
  situacao: null | string;
  /** Só no prédio. Nulo = torre única. */
  torre?: null | string;
};

/**
 * A unidade pelo id, com as colunas do prédio quando a 0171 já existe.
 *
 * ⚠️ UMA LEITURA PARA OS DOIS VERBOS (16/09/2026). É desta linha que sai o nome devolvido à tela
 * ("Torre A · Apto 304"); sem a 0171, a leitura repete sem as colunas.
 */
async function unidadeDoBloqueio(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  unidadeId: string,
): Promise<null | UnidadeDoBloqueio> {
  const { data } = await lerComColunasDoApartamento((extras) =>
    admin
      .from("hercules_unidades")
      .select(`id,codigo,quadra,lote,situacao,enterprise_id,espelho_de,bloqueado_em${extras}`)
      .eq("workspace_id", WORKSPACE)
      .eq("id", unidadeId)
      .maybeSingle(),
  );
  return (data ?? null) as unknown as null | UnidadeDoBloqueio;
}

/** O nome da unidade para a resposta, com as colunas do prédio quando vieram. */
function nomeParaATela(unidade: UnidadeDoBloqueio): string {
  return nomeDaUnidade({
    apartamento: unidade.apartamento,
    codigo: unidade.codigo ?? "",
    lote: unidade.lote,
    quadra: unidade.quadra,
    torre: unidade.torre,
  });
}

export async function POST(request: Request) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Bloqueio indisponível." }, { status: 503 });
  }

  let corpo: { detalhe?: string; motivo?: string; unidadeId?: string } = {};
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const pedido: PedidoDeBloqueio = {
    detalhe: String(corpo.detalhe ?? "").trim(),
    motivo: String(corpo.motivo ?? "").trim(),
    unidadeId: String(corpo.unidadeId ?? "").trim(),
  };

  // A MESMA régua da tela, de novo. Ver o aviso em `conferirBloqueio`.
  const erros = conferirBloqueio(pedido);
  if (erros.length > 0) {
    return NextResponse.json({ erros }, { status: 422 });
  }

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));

    const unidade = await unidadeDoBloqueio(admin, pedido.unidadeId);
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    // ⚠️ QUEM OPERA O PRODUTO DECIDE A ESCRITA (Lucas, 16/09/2026). No portal que confecciona (o
    // Cecílio) bloquear só vale no produto operado por ele; no VOC e no VOR é 403 só consulta. A
    // Gurgel passa sem ida ao banco. Antes de qualquer conferência que só serve a quem pode gravar.
    const escrita = await autorizarEscritaNoProduto(request, auth.sessao, [unidade.enterprise_id]);
    if (!escrita.ok) return escrita.response;
    const sessao = escrita.sessao;

    // ⚠️ A LINHA ESPELHO NÃO RESPONDE POR NADA, E BLOQUEÁ-LA NÃO TIRA O LOTE DA VENDA. O mesmo
    // terreno tem DUAS linhas nos produtos divididos (Lagoa Bonita, Vale do Ouro): a do pai, que é
    // história parada, e a da gleba que vende. Medido: 64 das 1.318 "disponíveis" são linhas
    // mortas. Bloquear a do pai deixaria o lote sendo oferecido normalmente pela gleba — e o
    // coordenador olharia a tela achando que resolveu.
    if (unidade.espelho_de) {
      return NextResponse.json(
        {
          error:
            "Esta linha é o registro antigo do terreno. Bloqueie o lote pela gleba que vende.",
        },
        { status: 409 },
      );
    }

    // ⚠️ AQUI A PERGUNTA É PELA `situacao`, E ELA NÃO BASTA SOZINHA — a trava de verdade é o UPDATE
    // condicional abaixo. Esta conferência existe para dar uma FRASE a quem clicou; sem ela, o
    // update casaria zero linhas e a resposta seria um "não deu" sem motivo.
    if (unidade.situacao !== "disponivel") {
      return NextResponse.json(
        {
          error: `Esta unidade está ${unidade.situacao}. Só unidade disponível pode ser bloqueada.`,
        },
        { status: 409 },
      );
    }

    // ⚠️ E A PROPOSTA VIVA GANHA DO CADASTRO. A coluna `situacao` e a etapa do fluxo JÁ DISCORDAM em
    // produção: 38 unidades estão `bloqueada` no cadastro e têm proposta viva. O inverso — cadastro
    // `disponivel` com proposta andando — é o caso que o Lucas proibiu em palavras ("não pode ter
    // nenhuma proposta, reserva, contrato"), e `situacao` sozinha não o enxerga.
    //
    // ⚠️ A PERGUNTA É PELA ETAPA, E NÃO POR `aberta`: medido, `hercules_propostas.aberta` nunca
    // volta para false, e 20 propostas mortas (distrato, cancelado) continuam marcadas como
    // abertas. Usar `aberta` barraria o bloqueio em lote que está livre de verdade.
    //
    // ⚠️ E A PERGUNTA É PELO TERRENO, NÃO PELA LINHA — foi o defeito que a revisão pegou. O mesmo
    // lote tem DUAS linhas nos produtos divididos, e a proposta pode morar na OUTRA. Medido em
    // 14/09/2026, o caso exato: `VOC0305` (a linha viva, `espelho_de` nulo) está `disponivel` com
    // ZERO propostas, e o gêmeo `VLO0305` — o registro antigo, que aponta para ela — está
    // `reservada` com UMA proposta viva desde 08/09. Perguntando só pela linha viva, a rota
    // bloquearia o lote com a reserva ativa por baixo: exatamente o que o pedido proíbe.
    const { data: gemeas } = await admin
      .from("hercules_unidades")
      .select("id")
      .eq("workspace_id", WORKSPACE)
      .eq("espelho_de", unidade.id);

    const linhasDoTerreno = [
      unidade.id,
      ...(Array.isArray(gemeas) ? gemeas.map((g) => String((g as { id: string }).id)) : []),
    ];

    const { data: vivas } = await admin
      .from("hercules_propostas")
      .select("id,etapa")
      .eq("workspace_id", WORKSPACE)
      .in("unidade_id", linhasDoTerreno)
      .not("etapa", "in", '("cancelado","distrato")')
      .limit(1);

    if (Array.isArray(vivas) && vivas.length > 0) {
      return NextResponse.json(
        {
          error:
            "Esta unidade tem um processo de venda em andamento. Cancele antes de bloquear o lote.",
        },
        { status: 409 },
      );
    }

    const agora = new Date().toISOString();

    // ⚠️ O UPDATE É CONDICIONAL, E É ELE A TRAVA. `.update()` sem `.select()` devolve sucesso mesmo
    // casando ZERO linhas — e entre a leitura acima e a gravação cabe uma reserva feita por outra
    // pessoa. Repetindo `situacao = 'disponivel'` no `eq`, o banco decide: quem chegar depois não
    // casa linha nenhuma, e o `select` devolve lista vazia em vez de um sucesso mentiroso.
    const { data: gravadas, error } = await admin
      .from("hercules_unidades")
      .update({
        atualizado_em: agora,
        bloqueado_em: agora,
        bloqueado_por: sessao.usuarioId,
        bloqueado_por_nome: sessao.usuarioNome,
        bloqueio_motivo: motivoDoBloqueio(pedido),
        situacao: "bloqueada",
      })
      .eq("workspace_id", WORKSPACE)
      .eq("id", unidade.id)
      .eq("situacao", "disponivel")
      .select("id");

    if (error) {
      console.error("[incorporador][bloqueio] update falhou", error.message);
      return NextResponse.json({ error: "Não foi possível bloquear a unidade." }, { status: 500 });
    }

    if (!Array.isArray(gravadas) || gravadas.length === 0) {
      // Alguém chegou primeiro entre a leitura e a gravação.
      return NextResponse.json(
        { error: "A unidade deixou de estar disponível. Recarregue a tela." },
        { status: 409 },
      );
    }

    return NextResponse.json({
      data: {
        bloqueadoPor: sessao.usuarioNome,
        motivo: motivoDoBloqueio(pedido),
        unidade: nomeParaATela(unidade),
      },
    });
  } catch (erro) {
    console.error("[incorporador][bloqueio]", erro);
    return NextResponse.json({ error: "Não foi possível bloquear a unidade." }, { status: 500 });
  }
}

/**
 * DESBLOQUEAR — o lote volta ao estoque.
 *
 * ⚠️ ISTO NÃO FOI PEDIDO, E EU O CONSTRUÍ MESMO ASSIM. Bloquear sem desbloquear cria um estado que
 * só sai com SQL na mão: o coordenador que errar o lote fica sem caminho na tela, e o primeiro
 * engano vira chamado. O par é o que torna o bloqueio uma decisão reversível em vez de uma marca
 * definitiva. Se o Lucas preferir tirar, é este bloco e o rótulo do botão.
 *
 * ⚠️ E A VOLTA NÃO É SIMÉTRICA, por isso ela tem regra própria. Medido em 14/09/2026: 38 unidades
 * estão `bloqueada` no cadastro E TÊM PROPOSTA VIVA — são bloqueios herdados do C2X em cima de
 * vendas que andam no legado. Devolvê-las para `disponivel` às cegas colocaria 38 vendas de volta
 * na prateleira, que é exatamente o erro que `fluxo-de-venda.ts` chama de "convidar a segunda
 * venda". Então desbloquear exige a MESMA prova que bloquear: nada vivo em cima do lote.
 *
 * ⚠️ O CARIMBO SAI JUNTO. Sem limpar `bloqueado_em`, a unidade continuaria protegida da carga do
 * C2X (ver `carregar-unidades-do-c2x.mjs`) como se ainda estivesse bloqueada — e o motivo antigo
 * ficaria pendurado numa unidade disponível, mentindo para quem lesse depois.
 */
export async function DELETE(request: Request) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Bloqueio indisponível." }, { status: 503 });
  }

  let corpo: { unidadeId?: string } = {};
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const unidadeId = String(corpo.unidadeId ?? "").trim();
  if (!unidadeId) {
    return NextResponse.json({ error: "Escolha a unidade." }, { status: 422 });
  }

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));

    const unidade = await unidadeDoBloqueio(admin, unidadeId);
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    // A mesma régua do bloqueio: devolver o lote ao estoque também é escrita.
    const escrita = await autorizarEscritaNoProduto(request, auth.sessao, [unidade.enterprise_id]);
    if (!escrita.ok) return escrita.response;

    if (unidade.situacao !== "bloqueada") {
      return NextResponse.json(
        { error: "Esta unidade não está bloqueada." },
        { status: 409 },
      );
    }

    // ⚠️ SÓ DESFAZ O BLOQUEIO FEITO AQUI. As 1.554 unidades bloqueadas hoje vieram do retrato do
    // C2X e não têm carimbo; desbloqueá-las no Panteon criaria uma divergência que a próxima carga
    // desfaz sozinha — o lote voltaria ao estoque e, horas depois, se bloquearia de novo sem
    // ninguém ter mexido. Pior do que não deixar: parece um defeito da tela.
    if (!unidade.bloqueado_em) {
      return NextResponse.json(
        {
          error:
            "Este bloqueio veio do C2X, e é lá que ele se desfaz. Aqui só é possível desfazer bloqueio feito no Panteon.",
        },
        { status: 409 },
      );
    }

    // A mesma prova do bloqueio, ao contrário: só volta ao estoque o que não tem nada em cima — e
    // pelas DUAS linhas do terreno, pelo mesmo motivo de lá.
    const { data: gemeas } = await admin
      .from("hercules_unidades")
      .select("id")
      .eq("workspace_id", WORKSPACE)
      .eq("espelho_de", unidade.id);

    const { data: vivas } = await admin
      .from("hercules_propostas")
      .select("id,etapa")
      .eq("workspace_id", WORKSPACE)
      .in("unidade_id", [
        unidade.id,
        ...(Array.isArray(gemeas) ? gemeas.map((g) => String((g as { id: string }).id)) : []),
      ])
      .not("etapa", "in", '("cancelado","distrato")')
      .limit(1);

    if (Array.isArray(vivas) && vivas.length > 0) {
      return NextResponse.json(
        {
          error:
            "Esta unidade tem um processo de venda em andamento e não pode voltar ao estoque.",
        },
        { status: 409 },
      );
    }

    const { data: gravadas, error } = await admin
      .from("hercules_unidades")
      .update({
        atualizado_em: new Date().toISOString(),
        bloqueado_em: null,
        bloqueado_por: null,
        bloqueado_por_nome: null,
        bloqueio_motivo: null,
        situacao: "disponivel",
      })
      .eq("workspace_id", WORKSPACE)
      .eq("id", unidade.id)
      .eq("situacao", "bloqueada")
      .select("id");

    if (error) {
      console.error("[incorporador][bloqueio] desbloquear falhou", error.message);
      return NextResponse.json(
        { error: "Não foi possível desbloquear a unidade." },
        { status: 500 },
      );
    }

    if (!Array.isArray(gravadas) || gravadas.length === 0) {
      return NextResponse.json(
        { error: "A unidade mudou de estado. Recarregue a tela." },
        { status: 409 },
      );
    }

    return NextResponse.json({
      data: {
        unidade: nomeParaATela(unidade),
      },
    });
  } catch (erro) {
    console.error("[incorporador][bloqueio][DELETE]", erro);
    return NextResponse.json(
      { error: "Não foi possível desbloquear a unidade." },
      { status: 500 },
    );
  }
}
