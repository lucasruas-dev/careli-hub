import { NextResponse } from "next/server";

import { trazerDocumentosDoLote } from "@/lib/apolo/asana-documentos";
import {
  aplicarVinculos,
  asanaConfigurado,
  criarEntidadesDoLote,
  escanearCads,
} from "@/lib/apolo/asana-import";
import { lerDocumentosDoLote, orcarLeitura } from "@/lib/apolo/asana-ocr";
import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Leitura dos documentos das CADs (iOCR da MOST) — O CAMINHO QUE CUSTA DINHEIRO.
//
// GET  = ORÇAMENTO. Read-only, custo ZERO. Diz quantas CADs, quantas imagens seriam lidas e
//        QUANTOS REAIS isso custa, já descontando as economias (CPF no texto, arquivo não
//        legível, documento já lido antes).
// POST = LEITURA PAGA. Exige `confirmado` e a lista explícita de CADs. Sem isso, 428.
//
// O POST processa um LOTE pequeno de propósito: a tela chama repetidamente e o gasto vai
// aparecendo aos poucos, em vez de uma chamada longa que pode estourar no meio já tendo pago.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAXIMO_POR_LOTE = 5;

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  if (!asanaConfigurado()) {
    return NextResponse.json(
      { error: "ASANA_ACCESS_TOKEN nao configurado neste ambiente." },
      { status: 503 },
    );
  }

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const url = new URL(request.url);
  const empreendimento = url.searchParams.get("empreendimento")?.trim() || "Vale do Ouro";
  const secoes = (url.searchParams.get("secoes") ?? "Em Cadastro")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const { cads } = await escanearCads({ empreendimento, secoes });
    const { itens, orcamento } = await orcarLeitura({
      cads: cads.map((cad) => ({
        conjuge: cad.conjuge,
        email: cad.email,
        escolaridade: cad.escolaridade,
        estadoCivil: cad.estadoCivil,
        gid: cad.gid,
        imobiliaria: cad.imobiliaria,
        // O nome do PROPONENTE é o do cliente; o título da task é digitado à mão.
        nome: cad.nomeProponente || cad.nome,
        notas: cad.notas,
        profissao: cad.profissao,
        renda: cad.renda,
        telefone: cad.telefone,
      })),
      client,
    });

    return NextResponse.json(
      { data: { empreendimento, itens, orcamento, secoes } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    analistaId?: string | null;
    confirmado?: boolean;
    empreendimento?: string | null;
    itens?: Parameters<typeof lerDocumentosDoLote>[0]["itens"];
    secao?: string | null;
  };

  if (!body.confirmado) {
    return NextResponse.json(
      {
        error:
          "Esta acao CONSULTA A MOST e e cobrada por imagem. Confirme o orcamento na tela antes.",
      },
      { status: 428 },
    );
  }

  const itens = body.itens ?? [];
  if (itens.length === 0) {
    return NextResponse.json({ error: "Nenhuma CAD no lote." }, { status: 400 });
  }
  if (itens.length > MAXIMO_POR_LOTE) {
    return NextResponse.json(
      { error: `Envie no maximo ${MAXIMO_POR_LOTE} CADs por lote.` },
      { status: 400 },
    );
  }

  // 1) LEITURA (paga) — obtém o CPF de cada CAD.
  const { porCad, resultado } = await lerDocumentosDoLote({
    client,
    itens,
    lidoPor: auth.userId,
  });

  // 2) CRIA a entidade de quem teve CPF lido. Quem não teve fica de fora: sem documento
  //    válido o Apolo recusa a criação, e sem entidade não há onde anexar o documento.
  //    Essas voltam na lista de pendências para o operador cadastrar à mão.
  const comCpf = itens
    .filter((item) => porCad[item.gid])
    .map((item) => {
      const lido = porCad[item.gid]!;
      return {
        // Tudo que o OCR entregou vai para a ficha: foi pago, tem que ser aproveitado.
        cidade: lido.cidade,
        // Da DESCRIÇÃO da CAD (grátis): cônjuge, escolaridade, estado civil, profissão e
        // renda. É o que evita pagar enriquecimento para descobrir o mesmo.
        conjuge: item.conjuge,
        cpf: lido.cpf,
        dataNascimento: lido.dataNascimento,
        email: item.email,
        empreendimento: body.empreendimento ?? null,
        escolaridade: item.escolaridade,
        estadoCivil: item.estadoCivil,
        gid: item.gid,
        imobiliaria: item.imobiliaria,
        profissao: item.profissao,
        renda: item.renda,
        nacionalidade: lido.nacionalidade,
        naturalidade: lido.naturalidade,
        nome: item.nome,
        nomeDoDocumento: lido.nome,
        nomeMae: lido.nomeMae,
        nomePai: lido.nomePai,
        orgaoEmissor: lido.orgaoEmissor,
        rg: lido.rg,
        telefone: item.telefone,
        uf: lido.uf,
      };
    });

  const { entidadePorCad, resultado: criacao } = await criarEntidadesDoLote({
    client,
    itens: comCpf,
    ownerUserId: auth.userId,
  });

  // 3) VINCULA à task e coloca na esteira em VALIDAÇÃO: o operador confere o que o OCR leu e
  //    completa o que faltou, que é o processo que o Lucas descreveu.
  const paraVincular = comCpf
    .filter((item) => entidadePorCad[item.gid])
    .map((item) => ({
      corretor: null,
      criadoEm: null,
      empreendimento: body.empreendimento ?? null,
      entityId: entidadePorCad[item.gid]!,
      gid: item.gid,
      imobiliaria: item.imobiliaria,
      secao: body.secao ?? "Em Cadastro",
    }));

  const vinculo = paraVincular.length
    ? await aplicarVinculos({
        analistaId: body.analistaId ?? null,
        client,
        etapa: "validacao",
        itens: paraVincular,
        porUsuario: auth.userId,
      })
    : { erros: [], ignorados: 0, vinculados: 0 };

  // 4) ANEXOS para o Apolo (grátis) — é o que a validação mostra ao lado dos dados.
  const documentos = paraVincular.length
    ? await trazerDocumentosDoLote({
        client,
        itens: paraVincular.map((item) => ({
          entityId: item.entityId,
          nome: item.gid,
          taskGid: item.gid,
        })),
      })
    : { baixados: 0, erros: [], ignorados: 0, semAnexo: 0 };

  // Quem não teve CPF: vira pendência para cadastro manual.
  const pendentes = itens
    .filter((item) => !porCad[item.gid])
    .map((item) => ({ gid: item.gid, nome: item.nome }));

  return NextResponse.json({
    data: {
      criacao,
      documentos,
      leitura: resultado,
      pendentes,
      vinculo,
    },
  });
}
