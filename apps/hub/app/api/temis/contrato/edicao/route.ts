import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { autorizarEmissaoDeContrato } from "@/lib/temis/autorizacao";
import { sanitizarHtmlDoContrato } from "@/lib/temis/contrato-editado";
import { descartarEdicao, salvarEdicao } from "@/lib/temis/contrato-editado-db";

// A ALTERAÇÃO MANUAL DO CONTRATO — salvar e descartar.
//
// Lucas (10/09/2026): *"quando eu clicar no abrir contrato, esse contrato tem que me permitir fazer
// alteração manual, salvar, fechar contrato"*.
//
// ⚠️ QUEM EDITA É QUEM EMITE — `autorizarEmissaoDeContrato`, a mesma régua de
// `/api/temis/contrato/gerar`, e não a de leitura. Reescrever uma cláusula é um ato maior do que
// imprimir o texto que a minuta já aprovou; deixar isso na régua de conferência daria ao comercial
// do portal o poder de mudar o contrato que o jurídico vai assinar.
//
// ⚠️ NÃO EXISTE `GET` AQUI, DE PROPÓSITO. A edição vigente volta junto com a prévia
// (`/api/temis/contrato/previa`), porque a tela precisa das duas coisas ao mesmo tempo: o texto que
// vale e a base de hoje para comparar. Uma segunda porta produziria a janela em que a tela mostra o
// texto editado e ainda não sabe que o cadastro mudou — e é justamente nessa janela que alguém
// clica em gerar.
//
// ⚠️ O TEXTO É FAXINADO AQUI, NO SERVIDOR, ANTES DE ENCOSTAR NO BANCO. O gesto comum não é o
// ataque: é colar um parágrafo de outro contrato, de um e-mail ou de uma página — e junto vêm
// script, rastreador e `onerror=`, que iriam direto para o Chromium que gera o PDF.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * O teto do que se aceita gravar.
 *
 * ⚠️ O CONTRATO É GRANDE, MAS NÃO INFINITO: 27 páginas de texto dão ~100 KB, e a folga aqui é para
 * as figuras que a minuta traz embutidas como `data:image`. Um corpo maior do que isto é quase
 * sempre uma colagem que trouxe uma página inteira junto — e o custo dela é uma linha de vários
 * megabytes lida em toda abertura do contrato.
 */
const TETO_BYTES = 8 * 1024 * 1024;

/** sha-256 em hexadecimal — o formato que `impressaoDaBase` produz. */
const IMPRESSAO = /^[a-f0-9]{64}$/;

export async function PUT(request: Request) {
  const autorizacao = await autorizarEmissaoDeContrato(request);
  if (!autorizacao.ok) return autorizacao.response;

  const corpo = (await request.json().catch(() => ({}))) as {
    baseImpressao?: unknown;
    html?: unknown;
    minutaId?: unknown;
    propostaId?: unknown;
  };

  const propostaId = typeof corpo.propostaId === "string" ? corpo.propostaId : "";
  const html = typeof corpo.html === "string" ? corpo.html : "";
  if (!propostaId) return NextResponse.json({ erro: "Sem proposta." }, { status: 400 });
  if (!html.trim()) {
    // ⚠️ CONTRATO VAZIO NÃO É EDIÇÃO, É ACIDENTE — um "selecionar tudo + apagar" seguido de salvar.
    // Quem quer voltar ao texto da minuta usa o DELETE, que diz o que faz.
    return NextResponse.json(
      { erro: "O contrato ficou vazio. Para voltar ao texto da minuta, use “Descartar alterações”." },
      { status: 400 },
    );
  }
  if (Buffer.byteLength(html, "utf8") > TETO_BYTES) {
    return NextResponse.json(
      { erro: "O texto ficou grande demais para ser salvo. Verifique se algo foi colado por engano." },
      { status: 413 },
    );
  }

  const sb = createApoloAdminClient();
  if (!sb) return NextResponse.json({ erro: "Supabase indisponível." }, { status: 503 });

  const limpo = sanitizarHtmlDoContrato(html);

  const baseImpressao =
    typeof corpo.baseImpressao === "string" && IMPRESSAO.test(corpo.baseImpressao)
      ? corpo.baseImpressao
      : "";

  const gravado = await salvarEdicao(sb, {
    baseImpressao,
    editadoPor: autorizacao.userId,
    editadoPorNome: await nomeDoUsuario(sb, autorizacao.userId),
    html: limpo.html,
    minutaId: typeof corpo.minutaId === "string" ? corpo.minutaId : null,
    propostaId,
  });

  if (!gravado.ok) {
    return NextResponse.json({ erro: gravado.erro }, { status: gravado.status });
  }

  // ⚠️ A TELA PRECISA SABER O QUE A FAXINA TIROU. Uma colagem que perdeu o rastreador não muda nada
  // para quem escreveu; uma que perdeu uma tabela inteira, muda — e o silêncio faria a pessoa
  // descobrir isso no PDF assinado.
  return NextResponse.json({ data: { removeu: limpo.removeu } });
}

/** Joga fora a alteração manual: o contrato volta a ser o texto da minuta. */
export async function DELETE(request: Request) {
  const autorizacao = await autorizarEmissaoDeContrato(request);
  if (!autorizacao.ok) return autorizacao.response;

  const propostaId = (new URL(request.url).searchParams.get("proposta") ?? "").trim();
  if (!propostaId) return NextResponse.json({ erro: "Sem proposta." }, { status: 400 });

  const sb = createApoloAdminClient();
  if (!sb) return NextResponse.json({ erro: "Supabase indisponível." }, { status: 503 });

  const feito = await descartarEdicao(sb, propostaId);
  if (!feito.ok) return NextResponse.json({ erro: feito.erro }, { status: feito.status });

  return NextResponse.json({ data: { descartado: true } });
}

/**
 * O nome de quem alterou, para a linha ficar com autor legível.
 *
 * ⚠️ MESMO MOTIVO DA GERAÇÃO (ver `gerar/route.ts`): "quem escreveu esta cláusula?" é uma pergunta
 * que só aparece depois, e um id de usuário não a responde para quem lê a tela. Falha vira `null` e
 * nunca derruba a gravação — o texto é o que importa salvar.
 */
async function nomeDoUsuario(
  sb: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  userId: string,
): Promise<null | string> {
  try {
    const { data } = await sb
      .from("hub_users")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    return (data as null | { display_name: null | string })?.display_name ?? null;
  } catch {
    return null;
  }
}
