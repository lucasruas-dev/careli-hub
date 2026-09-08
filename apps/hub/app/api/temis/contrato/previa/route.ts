import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { dadosDaProposta } from "@/lib/temis/dados-do-contrato";
import { documentoParaHtml, type NoDoDocumento } from "@/lib/temis/documento-html";
import { preencherContrato } from "@/lib/temis/preencher-contrato";

// A PRÉVIA DO CONTRATO — a minuta publicada mais os dados da proposta, preenchidos.
//
// Lucas, 08/09/2026: *"eu havia falado que deveria ter um campo para visualização do contrato
// preenchido, tipo uma prévia antes de enviar"*. E, na mesma manhã: *"garante então a construção
// para a gente emitir contratos, precisamos testar isso hoje"*.
//
// ⚠️ A PRÉVIA VEM ANTES DO PDF, E ANTES DE QUALQUER ENVIO. É o passo onde alguém confere se o
// contrato saiu certo — e é barato: HTML na tela, sem Chromium, sem gravar nada, sem gastar
// documento na plataforma de assinatura. Um contrato errado descoberto aqui custa um clique; o
// mesmo contrato descoberto depois de assinado custa um aditivo.
//
// ⚠️ ELA NÃO GRAVA NADA. Nenhuma linha em `temis_*`, nenhum arquivo no storage. Gerar prévia é uma
// LEITURA — e isso é o que permite gerá-la quantas vezes for preciso enquanto se ajusta a minuta,
// sem encher a base de rascunhos que ninguém vai olhar.
//
// ⚠️ E ELA DIZ O QUE FALTOU. `semValor` são as variáveis que o texto pedia e os dados não
// responderam; `avisos` são os dados que a proposta não tinha. As duas listas voltam para a tela
// porque a alternativa é a pessoa procurar `[cpf_cliente]` no meio de 50 mil caracteres.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const autorizacao = await authorizeApoloRead(request);
  if (!autorizacao.ok) return autorizacao.response;

  const corpo = (await request.json().catch(() => ({}))) as {
    minutaId?: unknown;
    propostaId?: unknown;
  };
  const propostaId = typeof corpo.propostaId === "string" ? corpo.propostaId : "";
  if (!propostaId) {
    return NextResponse.json({ erro: "Sem proposta." }, { status: 400 });
  }

  const sb = createApoloAdminClient();
  if (!sb) return NextResponse.json({ erro: "Supabase indisponível." }, { status: 503 });

  const resolvido = await dadosDaProposta(propostaId, sb);
  if (!resolvido) {
    return NextResponse.json({ erro: "Proposta não encontrada." }, { status: 404 });
  }

  const doEmpreendimento = resolvido.dados.gerais.__empreendimento_id ?? "";
  const daUnidade = resolvido.dados.gerais.__unidade_enterprise_id ?? "";
  // ⚠️ DOIS CAMINHOS PARA O MESMO ID, e o segundo salvou o primeiro teste real. A minuta é indexada
  // por `enterprise_id` (o id do C2X), e três empreendimentos do Hércules — LOX, PDX e RDX — têm
  // esse campo NULO: para eles a busca ia com string vazia e NENHUMA minuta seria achada nunca. A
  // unidade guarda o mesmo id na sua própria coluna, e ela costuma estar preenchida quando a do
  // empreendimento não está, porque veio de outra carga.
  const minuta = await acharMinuta(sb, {
    empreendimentoId: doEmpreendimento || daUnidade,
    pedida: typeof corpo.minutaId === "string" ? corpo.minutaId : "",
  });

  if (!minuta) {
    // ⚠️ A MENSAGEM DIZ O QUE ELE PROCUROU. "Não há minuta publicada" é verdadeiro para dois
    // problemas MUITO diferentes — a minuta realmente não existe, ou a proposta não sabe a que
    // empreendimento pertence — e mandar publicar de novo uma minuta que já está publicada é o
    // caminho mais curto para alguém achar que o sistema está quebrado. Foi o que aconteceu no
    // primeiro teste, em 08/09/2026: a minuta do Veredas estava publicada e a tela mandou publicar.
    // ⚠️ TRÊS CAUSAS DIFERENTES, TRÊS FRASES. "Não há minuta publicada" era verdadeiro para as três,
    // e mandar publicar de novo uma minuta que JÁ ESTÁ publicada é o caminho mais curto para alguém
    // achar que o sistema está quebrado — foi o que aconteceu no primeiro teste, em 08/09/2026.
    const alvo = doEmpreendimento || daUnidade;
    const causa = alvo
      ? `Procurei a minuta publicada do empreendimento ${alvo} e não achei nenhuma do tipo "contrato". Publique a minuta na Têmis e tente de novo.`
      : "O empreendimento desta proposta não tem o código que liga às minutas (é o caso de LOX, PDX e RDX). Sem ele não há por onde procurar — e não adianta publicar de novo.";
    return NextResponse.json(
      { erro: `Não consegui montar o contrato. ${causa}` },
      { status: 409 },
    );
  }

  const conteudo = Array.isArray(minuta.conteudo) ? (minuta.conteudo as NoDoDocumento[]) : [];
  if (conteudo.length === 0) {
    return NextResponse.json({ erro: "A minuta publicada está vazia." }, { status: 409 });
  }

  const preenchido = preencherContrato(conteudo, resolvido.dados);

  return NextResponse.json({
    avisos: resolvido.avisos,
    // ⚠️ O MESMO SERIALIZADOR DO CONTRATO, e não um diferente para a tela. Se a prévia usasse outro
    // caminho, ela mostraria uma coisa e o PDF sairia outra — e a conferência não valeria nada.
    html: documentoParaHtml(preenchido.nos),
    minuta: { id: minuta.id, nome: minuta.nome, versao: minuta.versao },
    semValor: preenchido.semValor,
    vezesDoLaco: preenchido.vezesDoLaco,
  });
}

type MinutaEncontrada = {
  conteudo: unknown;
  id: string;
  nome: string;
  versao: null | number;
};

/**
 * A minuta que vale para esta proposta.
 *
 * ⚠️ SÓ PUBLICADA. Rascunho é trabalho em andamento: gerar contrato de rascunho é como imprimir um
 * documento que alguém ainda está escrevendo — e a `temis_minutas` tem a checagem que só exige
 * `conteudo_html` quando a situação é `publicada`, justamente porque publicar é o ato de dizer "esta
 * pode ser usada".
 *
 * ⚠️ A CATEGORIA DEVERIA MANDAR, e ainda não manda. O desenho é `unidade → categoria →
 * temis_categorias.minuta_id`, e é o que permite dois contratos diferentes no mesmo empreendimento.
 * Enquanto não houver categoria cadastrada na unidade, cai-se na minuta publicada mais recente do
 * empreendimento — que é o comportamento certo para quem tem uma minuta só, e é o caso de todos
 * hoje. Quando a categoria entrar, este é o único lugar a mudar.
 */
async function acharMinuta(
  sb: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  { empreendimentoId, pedida }: { empreendimentoId: string; pedida: string },
): Promise<MinutaEncontrada | null> {
  if (pedida) {
    const { data } = await sb
      .from("temis_minutas")
      .select("id, nome, versao, conteudo, situacao")
      .eq("id", pedida)
      .maybeSingle();
    // ⚠️ A MINUTA PEDIDA TAMBÉM PRECISA ESTAR PUBLICADA. Aceitar um id de rascunho pela porta dos
    // fundos derrubaria a regra inteira.
    if (data && data.situacao === "publicada") return data as MinutaEncontrada;
    return null;
  }

  if (!empreendimentoId) return null;

  const { data } = await sb
    .from("temis_minutas")
    .select("id, nome, versao, conteudo")
    .eq("enterprise_id", empreendimentoId)
    .eq("situacao", "publicada")
    .eq("tipo", "contrato")
    .order("atualizado_em", { ascending: false })
    .limit(1);

  return (data?.[0] as MinutaEncontrada | undefined) ?? null;
}
