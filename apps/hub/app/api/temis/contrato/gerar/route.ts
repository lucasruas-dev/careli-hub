import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  autorizarEmissaoDeContrato,
  autorizarLeituraDeContrato,
} from "@/lib/temis/autorizacao";
import { montarContratoDaProposta } from "@/lib/temis/contrato-da-proposta";
import { variaveisAindaEmBranco } from "@/lib/temis/contrato-editado";
import { lerEdicao } from "@/lib/temis/contrato-editado-db";
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
 * ⚠️ EMITIR CONTRATO NÃO É A MESMA PORTA DE CONFERIR CONTRATO — e até 08/09/2026 era. Esta rota
 * autorizava com `authorizeApoloRead`, o papel mais baixo que existe, justificada assim: "o botão
 * mora na tela onde a prévia já abriu; se a geração exigisse um papel maior, quem consegue conferir
 * não conseguiria gerar". O raciocínio está errado para este caso, e o Lucas apontou por que ao ver
 * o botão no portal comercial da Gurgel: *"estou como coordenador, não pode ter esse botão de gerar
 * contrato, isso é somente o time administrativo interno"*. Conferir e emitir são de gente
 * diferente; que as duas coisas caibam na mesma tela não faz delas o mesmo direito.
 *
 * ⚠️ QUEM DECIDE É `autorizarEmissaoDeContrato`, E É O ÚNICO LUGAR (`lib/temis/autorizacao.ts`) —
 * a etapa 2 troca o recorte por permissão (`temis:manage`) lá dentro, sem voltar aqui.
 */
export async function POST(request: Request) {
  const autorizacao = await autorizarEmissaoDeContrato(request);
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

  // ⚠️ O QUE VIRA PAPEL É O TEXTO ALTERADO À MÃO, QUANDO ELE EXISTE (migration 0152). A regra
  // escrita acima — "o HTML nasce no servidor, da minuta publicada" — continua valendo: o texto
  // editado NÃO viaja neste pedido. Ele foi gravado antes, por `/api/temis/contrato/edicao`, numa
  // linha com dono, hora e a impressão da base, e já passou pela faxina do servidor. O que esta
  // rota aceita continua sendo só um id de proposta.
  //
  // ⚠️ E A EDIÇÃO SOBREVIVE À GERAÇÃO. A v2 deste contrato parte do mesmo texto ajustado: apagar
  // a edição ao emitir faria a cláusula negociada desaparecer na primeira vez que alguém
  // corrigisse uma vírgula no cadastro e gerasse de novo.
  const edicao = await lerEdicao(sb, propostaId);
  const html = edicao?.html ?? montado.html;

  // ⚠️ A TRAVA MEDE O PAPEL, NÃO A MONTAGEM. Ver a decisão 1 em `contrato-guardado.ts`: um
  // contrato com `[cpf_cliente]` impresso não vira arquivo — mas quem digitou o CPF por cima do
  // colchete preencheu o contrato, e recusar mesmo assim mandaria a pessoa consertar o cadastro
  // para poder imprimir um papel que já está certo.
  const semValor = edicao
    ? variaveisAindaEmBranco(html, montado.semValor)
    : montado.semValor;
  const veredito = podeGerarContrato(semValor);
  if (!veredito.ok) {
    return NextResponse.json(
      { avisos: montado.avisos, erro: veredito.erro, semValor },
      { status: 409 },
    );
  }

  let pdf: Uint8Array;
  try {
    pdf = await gerarPdfDoHtml(html);
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
    // Quem lê a gaveta precisa saber que este PDF não é o texto puro da minuta.
    alteradoAMaoPor: edicao ? (edicao.editadoPorNome ?? "alguém da equipe") : null,
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
 *
 * ⚠️ O GET NÃO SOBE PARA O RECORTE DO POST, E A ASSIMETRIA É A DECISÃO. Abrir o contrato que já
 * existe é conferência — é o que o comercial faz na prévia, e é o botão "Abrir o contrato guardado"
 * que continua no rodapé do portal. Fechar esta leitura junto com a emissão apagaria esse botão e
 * faria o botão da Têmis mentir sobre a versão, sem esconder nada: as mesmas linhas de
 * `hercules_documentos` já abrem com esta régua na aba Documentos da venda e na ficha do cliente no
 * Apolo. O que impede um id qualquer de virar link assinado é o `tipo = contrato`, em
 * `abrirContratoGuardado` — e não o papel de quem pede.
 */
export async function GET(request: Request) {
  const autorizacao = await autorizarLeituraDeContrato(request);
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
