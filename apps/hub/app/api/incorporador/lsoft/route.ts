import { NextResponse } from "next/server";

import { autorizar } from "@/lib/apolo/incorporador/escopo";
import {
  CAMPOS_DA_PARCELA,
  CAMPOS_EDITAVEIS,
  type CampoDaParcela,
  type CampoEditavel,
  lerCarteiraDoLsoft,
  lerFichaDoLsoft,
  salvarParcelaDoLsoft,
  salvarValidacaoDoLsoft,
  type StatusDaValidacao,
} from "@/lib/lsoft/carteira";
import { lerParcelasDeSubsidio } from "@/lib/lsoft/classificacao";
import {
  abrirDocumentoDoLsoft,
  listarDocumentosDoLsoft,
  prepararUploadDoLsoft,
  registrarDocumentoDoLsoft,
  removerDocumentoDoLsoft,
} from "@/lib/lsoft/documentos";
import { portalVeBaseLsoft } from "@/lib/lsoft/portais";

// A BASE DO LSOFT DENTRO DO PORTAL DO INCORPORADOR.
//
// Decisão do Lucas (19/08/2026): *"no portal personalizado da Cecílio, no CER é para ter, pois são
// eles que vão atualizar essa base para depois a gente subir"*.
//
// ⚠️ ESTA É A PRIMEIRA ESCRITA EXTERNA DO PANTEON. Até aqui o portal do incorporador era leitura
// pura em tudo. Por isso, três travas explícitas:
//   1. só os portais de `portalVeBaseLsoft` entram (hoje `cer` e `cecilio-rocha`);
//   2. o autor gravado é o USUÁRIO DA SESSÃO, com `autor_origem: 'incorporador'` — a trilha
//      distingue quem é da Careli de quem é do cliente;
//   3. os campos aceitos são os mesmos da tela interna, e nada além.
//
// ⚠️ ROTA ÚNICA COM `acao` no corpo, e não quatro caminhos: o portal já tem muita rota, e o que
// separa uma operação da outra aqui é o verbo de negócio, não o recurso.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fora(): NextResponse {
  // 404, não 403: para quem não tem a aba, esta rota simplesmente não existe.
  return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
}

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;
  if (!portalVeBaseLsoft(auth.sessao.slug)) return fora();

  const url = new URL(request.url);
  const codigo = url.searchParams.get("cliente");

  // A VISÃO DO SUBSÍDIO DA CAIXA, parcela a parcela. É informação que o incorporador precisa: o
  // dinheiro que a Caixa libera por medição é dele. Leitura pura — quem CLASSIFICA continua sendo
  // só a Careli, por /api/lsoft/classificacao.
  if (url.searchParams.get("subsidio")) {
    const subsidio = await lerParcelasDeSubsidio({
      busca: url.searchParams.get("busca"),
      empreendimento: url.searchParams.get("empreendimento") ?? "Vale do Sol",
      situacao: url.searchParams.get("situacao"),
    });
    if (!subsidio.ok) return NextResponse.json({ error: subsidio.erro }, { status: 400 });
    return NextResponse.json(
      { data: { linhas: subsidio.linhas, resumo: subsidio.resumo } },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (codigo) {
    // A ABA DE DOCUMENTOS. Mesmo caminho da ficha, porque a permissão é a mesma: quem pode ver o
    // cadastro deste cliente pode ver (e juntar) os documentos dele.
    const abrir = (url.searchParams.get("abrir") ?? "").trim();
    if (abrir) {
      const aberto = await abrirDocumentoDoLsoft({ codigo, id: abrir });
      if (!aberto.ok) return NextResponse.json({ error: aberto.erro }, { status: 404 });
      return NextResponse.json(
        { data: { nome: aberto.nome, url: aberto.url } },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (url.searchParams.get("documentos")) {
      const lista = await listarDocumentosDoLsoft(codigo);
      if (!lista.ok) return NextResponse.json({ error: lista.erro }, { status: 503 });
      return NextResponse.json(
        { data: { documentos: lista.documentos } },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const ficha = await lerFichaDoLsoft(codigo);
    if (!ficha.ok) return NextResponse.json({ error: ficha.erro }, { status: 404 });
    return NextResponse.json(
      { data: { cadastro: ficha.cadastro, parcelas: ficha.parcelas } },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const carteira = await lerCarteiraDoLsoft({
    busca: url.searchParams.get("q"),
    empreendimento: url.searchParams.get("emp"),
  });
  if (!carteira.ok) return NextResponse.json({ error: carteira.erro }, { status: 503 });

  return NextResponse.json(
    { data: { clientes: carteira.clientes, resumo: carteira.resumo } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;
  if (!portalVeBaseLsoft(auth.sessao.slug)) return fora();

  const corpo = (await request.json().catch(() => null)) as
    | {
        acao?: string;
        campos?: Record<string, unknown>;
        cliente?: string;
        parcela?: string;
        status?: string;
      }
    | null;

  if (!corpo) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  // Quem assina: o usuário da sessão do portal, nunca o que a tela mandar.
  const autor = `${auth.sessao.usuarioNome} (${auth.sessao.slug})`;

  if (corpo.acao === "parcela" && corpo.parcela) {
    const campos: Partial<Record<CampoDaParcela, null | string>> = {};
    for (const campo of CAMPOS_DA_PARCELA) {
      if (corpo.campos && campo in corpo.campos) {
        const valor = corpo.campos[campo];
        campos[campo] = valor === null || valor === undefined ? null : String(valor);
      }
    }

    const resultado = await salvarParcelaDoLsoft({
      autor,
      autorOrigem: "incorporador",
      campos,
      parcelaId: corpo.parcela,
    });

    if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 400 });
    return NextResponse.json({ data: { alterados: resultado.alterados } });
  }

  if (!corpo.cliente) return NextResponse.json({ error: "Cliente ausente." }, { status: 400 });

  const campos: Partial<Record<CampoEditavel, null | string>> = {};
  for (const campo of CAMPOS_EDITAVEIS) {
    if (corpo.campos && campo in corpo.campos) {
      const valor = corpo.campos[campo];
      campos[campo] = valor === null || valor === undefined ? null : String(valor);
    }
  }

  const STATUS = ["dispensado", "em_analise", "pendente", "validado"] as const;
  const status = corpo.status && STATUS.includes(corpo.status as never)
    ? (corpo.status as StatusDaValidacao)
    : undefined;

  const resultado = await salvarValidacaoDoLsoft({
    autor,
    autorOrigem: "incorporador",
    campos,
    codigo: corpo.cliente,
    status,
  });

  if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 400 });
  return NextResponse.json({ data: { alterados: resultado.alterados } });
}

// ── DOCUMENTOS ──────────────────────────────────────────────────────────────
//
// O envio em duas etapas, igual à rota interna: `preparar` assina a permissão de gravar um
// caminho, o navegador manda o arquivo direto ao Supabase, e `registrar` grava a linha. O binário
// não passa por aqui — em base64 dentro do JSON ele estouraria o limite de corpo da Vercel.
//
// ⚠️ MESMAS TRÊS TRAVAS DO RESTO DESTA ROTA: só portal de `portalVeBaseLsoft`, autor é o usuário da
// sessão com origem `incorporador`, e nada além dos campos previstos.

export async function POST(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;
  if (!portalVeBaseLsoft(auth.sessao.slug)) return fora();

  const corpo = (await request.json().catch(() => null)) as null | {
    acao?: string;
    caminho?: string;
    categoria?: string;
    cliente?: string;
    mimeType?: string;
    nomeArquivo?: string;
    observacao?: string;
    tamanhoBytes?: number;
  };

  if (!corpo?.cliente) return NextResponse.json({ error: "Cliente ausente." }, { status: 400 });
  if (!corpo.nomeArquivo?.trim()) {
    return NextResponse.json({ error: "Nome do arquivo ausente." }, { status: 400 });
  }

  if (corpo.acao === "preparar") {
    const preparo = await prepararUploadDoLsoft({
      codigo: corpo.cliente,
      nomeArquivo: corpo.nomeArquivo,
      tamanhoBytes: corpo.tamanhoBytes ?? null,
    });
    if (!preparo.ok) return NextResponse.json({ error: preparo.erro }, { status: 400 });
    return NextResponse.json({
      data: { bucket: preparo.bucket, caminho: preparo.caminho, token: preparo.token },
    });
  }

  if (!corpo.caminho) return NextResponse.json({ error: "Caminho ausente." }, { status: 400 });

  const registro = await registrarDocumentoDoLsoft({
    autor: `${auth.sessao.usuarioNome} (${auth.sessao.slug})`,
    autorOrigem: "incorporador",
    caminho: corpo.caminho,
    categoria: corpo.categoria ?? null,
    codigo: corpo.cliente,
    mimeType: corpo.mimeType ?? null,
    nomeArquivo: corpo.nomeArquivo,
    observacao: corpo.observacao ?? null,
    tamanhoBytes: corpo.tamanhoBytes ?? null,
  });

  if (!registro.ok) return NextResponse.json({ error: registro.erro }, { status: 400 });

  return NextResponse.json({ data: { documento: registro.documento } });
}

export async function DELETE(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;
  if (!portalVeBaseLsoft(auth.sessao.slug)) return fora();

  const url = new URL(request.url);
  const codigo = (url.searchParams.get("cliente") ?? "").trim();
  const id = (url.searchParams.get("id") ?? "").trim();

  if (!codigo || !id) {
    return NextResponse.json({ error: "Cliente ou documento ausente." }, { status: 400 });
  }

  const resultado = await removerDocumentoDoLsoft({
    autor: `${auth.sessao.usuarioNome} (${auth.sessao.slug})`,
    codigo,
    id,
  });

  if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 404 });

  return NextResponse.json({ data: { removido: true } });
}
