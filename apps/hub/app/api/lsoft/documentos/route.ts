import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import {
  abrirDocumentoDoLsoft,
  listarDocumentosDoLsoft,
  prepararUploadDoLsoft,
  registrarDocumentoDoLsoft,
  removerDocumentoDoLsoft,
} from "@/lib/lsoft/documentos";

// DOCUMENTOS DO CLIENTE DO LSOFT — a rota interna (tela /lsoft, gente da Careli).
//
// Pedido do Lucas (19/08/2026): "deixar aba para subir documentação".
//
// ⚠️ O ENVIO TEM DUAS ETAPAS, e é de propósito:
//   1. POST { acao: "preparar" } devolve uma URL assinada para gravar UM caminho;
//   2. o navegador manda o arquivo direto ao Supabase;
//   3. POST { acao: "registrar" } grava a linha com o caminho que voltou.
// O binário NUNCA passa por esta rota. Em base64 dentro do JSON ele estouraria o limite de 4,5MB
// da Vercel e devolveria 413 sem explicação — o que já aconteceu no CAD.
//
// ⚠️ QUEM ASSINA É A SESSÃO, nunca o corpo do pedido: mesma regra da edição de cadastro e de
// parcela. Aceitar um "autor" enviado pela tela transformaria a trilha em ficção.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const codigo = (url.searchParams.get("cliente") ?? "").trim();
  if (!codigo) return NextResponse.json({ error: "Cliente ausente." }, { status: 400 });

  // `abrir=<id>` devolve a URL assinada de UM documento, em vez da lista.
  const abrir = (url.searchParams.get("abrir") ?? "").trim();
  if (abrir) {
    const aberto = await abrirDocumentoDoLsoft({ codigo, id: abrir });
    if (!aberto.ok) {
      const naoAchou = aberto.erro === "Documento não encontrado.";
      return NextResponse.json({ error: aberto.erro }, { status: naoAchou ? 404 : 503 });
    }
    return NextResponse.json(
      { data: { nome: aberto.nome, url: aberto.url } },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const lista = await listarDocumentosDoLsoft(codigo);
  if (!lista.ok) return NextResponse.json({ error: lista.erro }, { status: 503 });

  return NextResponse.json(
    { data: { documentos: lista.documentos } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

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
    if (!preparo.ok) {
      const naoAchou = preparo.erro === "Cliente não encontrado.";
      return NextResponse.json({ error: preparo.erro }, { status: naoAchou ? 404 : 503 });
    }
    return NextResponse.json({
      data: { bucket: preparo.bucket, caminho: preparo.caminho, token: preparo.token },
    });
  }

  if (!corpo.caminho) return NextResponse.json({ error: "Caminho ausente." }, { status: 400 });

  const registro = await registrarDocumentoDoLsoft({
    autor: auth.userId,
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
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const codigo = (url.searchParams.get("cliente") ?? "").trim();
  const id = (url.searchParams.get("id") ?? "").trim();

  if (!codigo || !id) {
    return NextResponse.json({ error: "Cliente ou documento ausente." }, { status: 400 });
  }

  const resultado = await removerDocumentoDoLsoft({ autor: auth.userId, codigo, id });
  if (!resultado.ok) {
    const naoAchou = resultado.erro === "Documento não encontrado.";
    return NextResponse.json({ error: resultado.erro }, { status: naoAchou ? 404 : 503 });
  }

  return NextResponse.json({ data: { removido: true } });
}
