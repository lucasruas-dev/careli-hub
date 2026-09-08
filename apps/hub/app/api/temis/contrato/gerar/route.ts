import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { montarContratoDaProposta } from "@/lib/temis/contrato-da-proposta";
import { podeGerarContrato } from "@/lib/temis/contrato-guardado";
import {
  abrirContratoGuardado,
  contratosDaProposta,
  guardarContrato,
} from "@/lib/temis/contrato-guardado-db";
import { gerarPdfDoHtml } from "@/lib/temis/html-para-pdf";

// O CONTRATO VIRA ARQUIVO — o passo que faltava depois da prévia.
//
// Até 08/09/2026 a cadeia parava aqui: `/api/temis/contrato/previa` montava o contrato preenchido,
// a tela mostrava, e nada ficava. Esta rota fecha o elo: mesmo HTML, PDF, bucket, linha em
// `hercules_documentos` — e o card da Têmis passa a apontar para o papel.
//
// ⚠️ O HTML É O MESMO DA PRÉVIA, E ISSO É O PONTO INTEIRO. As duas rotas chamam
// `montarContratoDaProposta`; nenhuma delas sabe montar contrato sozinha. Se esta rota tivesse a
// própria montagem, aprovar na tela deixaria de dizer alguma coisa sobre o que foi impresso — e a
// divergência apareceria meses depois, num contrato assinado.
//
// ⚠️ E O CONVERSOR TAMBÉM É UM SÓ (`gerarPdfDoHtml`). `/api/temis/pdf` é a porta do NAVEGADOR para
// o mesmo conversor: ela recebe HTML e devolve bytes, sem guardar nada. Guardar por lá exigiria
// aceitar o HTML de quem chama como sendo "o contrato" — quer dizer, deixar o navegador ditar o
// conteúdo do papel que vai a cartório. Aqui o HTML nasce no servidor, da minuta publicada.
//
// ⚠️ `runtime = "nodejs"` E O TETO DE 300s pelo mesmo motivo de `/api/temis/pdf`: o Chromium é um
// processo do sistema operacional, e descompactar o binário na primeira invocação da instância
// custa segundos.
//
// ⚠️ ESTA ROTA PRECISA DAS QUATRO LINHAS DO `next.config.ts` (`outputFileTracingIncludes`), como a
// irmã. Sem elas a função sobe com o código do `@sparticuz/chromium` e SEM o binário, e a única
// evidência é um erro em produção numa rota que funciona perfeitamente na máquina de quem
// desenvolveu — onde o Chrome é o do sistema.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * ⚠️ `authorizeApoloRead`, A MESMA DA PRÉVIA E DO BOARD DA TÊMIS — e não a de escrita. O botão
 * mora na tela onde a prévia já abriu: se a geração exigisse um papel maior, quem consegue conferir
 * o contrato leria "Usuario sem acesso" ao clicar no botão do lado, sem entender por quê. É a régua
 * que `/api/temis/trabalhos` já usa para POST (marcar atividade, abrir solicitação), que também
 * gravam.
 */
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

  const montado = await montarContratoDaProposta(sb, {
    minutaId: typeof corpo.minutaId === "string" ? corpo.minutaId : "",
    propostaId,
  });
  if (!montado.ok) {
    return NextResponse.json({ erro: montado.erro }, { status: montado.status });
  }

  // ⚠️ A CONFERÊNCIA NÃO PODE SUMIR NA HORA DE IMPRIMIR. Ver a decisão 1 em `contrato-guardado.ts`:
  // um contrato com `[cpf_cliente]` impresso não vira arquivo. A lista volta para a tela.
  const veredito = podeGerarContrato(montado.semValor);
  if (!veredito.ok) {
    return NextResponse.json(
      { avisos: montado.avisos, erro: veredito.erro, semValor: montado.semValor },
      { status: 409 },
    );
  }

  let pdf: Uint8Array;
  try {
    pdf = await gerarPdfDoHtml(montado.html);
  } catch (e) {
    // A mensagem real vai para o log: o erro do Chromium cita caminho de binário e flag de linha de
    // comando — infraestrutura, que não ajuda quem está emitindo um contrato e não deve vazar.
    console.error("[temis][contrato] falha ao gerar o PDF", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { erro: "Não foi possível gerar o PDF do contrato. Tente de novo." },
      { status: 502 },
    );
  }

  const guardado = await guardarContrato(sb, {
    geradoPor: autorizacao.userId,
    geradoPorNome: await nomeDoUsuario(sb, autorizacao.userId),
    identidade: montado.identidade,
    pdf,
    propostaId,
  });

  if (!guardado.ok) {
    return NextResponse.json({ erro: guardado.erro }, { status: guardado.status });
  }

  return NextResponse.json({
    data: {
      avisos: montado.avisos,
      documentoId: guardado.documentoId,
      minuta: montado.minuta,
      nome: guardado.nome,
      protocolo: guardado.protocolo,
      tamanhoBytes: guardado.tamanhoBytes,
      versao: guardado.versao,
    },
  });
}

/**
 * O que já foi gerado desta proposta (`?proposta=`), ou o link para abrir um deles (`?documento=`).
 *
 * ⚠️ A LISTA EXISTE PARA A TELA SABER O QUE ELA VAI FAZER ANTES DE FAZER. Sem ela, o botão diz
 * "Gerar contrato" mesmo quando já existe uma versão guardada, e quem clica descobre que criou a v2
 * depois de criada — num documento jurídico, essa é a ordem errada de descobrir.
 */
export async function GET(request: Request) {
  const autorizacao = await authorizeApoloRead(request);
  if (!autorizacao.ok) return autorizacao.response;

  const sb = createApoloAdminClient();
  if (!sb) return NextResponse.json({ erro: "Supabase indisponível." }, { status: 503 });

  const url = new URL(request.url);
  const documentoId = (url.searchParams.get("documento") ?? "").trim();
  if (documentoId) {
    const aberto = await abrirContratoGuardado(sb, documentoId);
    if (!aberto.ok) return NextResponse.json({ erro: aberto.erro }, { status: aberto.status });
    return NextResponse.json(
      { data: { nome: aberto.nome, url: aberto.url } },
      // ⚠️ `no-store`: a URL assinada abre o contrato de um comprador sem pedir nada. Guardá-la em
      // proxy ou CDN a poria no caminho de outro.
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const propostaId = (url.searchParams.get("proposta") ?? "").trim();
  if (!propostaId) {
    return NextResponse.json({ erro: "Informe a proposta ou o documento." }, { status: 400 });
  }

  return NextResponse.json(
    { data: { contratos: await contratosDaProposta(sb, propostaId) } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * O nome de quem gerou, para a linha `enviado_por_nome`.
 *
 * ⚠️ VALE A PENA A CONSULTA A MAIS. As três telas que listam documento mostram esse nome, e um
 * contrato sem autor na gaveta é um documento que ninguém pediu — a mesma falta que a auditoria da
 * casa já registrou em `temis_trabalhos.aberto_por`. Falha vira `null`, nunca derruba a geração: o
 * papel já existe a esta altura.
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
