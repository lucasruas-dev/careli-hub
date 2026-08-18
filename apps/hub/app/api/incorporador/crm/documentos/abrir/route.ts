import { NextResponse } from "next/server";

import { ehTipoDeFicha } from "@/lib/apolo/incorporador/crm";
import { abrirDocumento } from "@/lib/apolo/incorporador/documentos";
import { autorizar, foraDoEscopo } from "@/lib/apolo/incorporador/escopo";
import { d4signPdfHeaders } from "@/lib/guardian/d4sign";

// ABRE UM documento da ficha do portal. A tela chama por navegação (window.open), então a
// resposta é o próprio arquivo:
//
//   • fonte=apolo    → redirect para a URL ASSINADA do bucket privado (10 min);
//   • fonte=contrato → o PDF do D4Sign PROXIADO por aqui — o token D4Sign fica no servidor,
//     NUNCA no navegador (mesmo desenho de /api/hades/d4sign/contracts);
//   • fonte=c2x      → 404 sempre: o anexo legado vive num S3 sem credencial nossa, e URL
//     inventada é pior que botão desabilitado.
//
// ⚠️ A POSSE É RECONFERIDA POR CHAMADA, ANTES de gerar URL ou baixar PDF: `abrirDocumento` prova
// a pessoa no escopo E que o documento pedido pertence a ela. Doc de outra pessoa = 404.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const tipo = url.searchParams.get("tipo") ?? "";
  const id = (url.searchParams.get("id") ?? "").trim();
  const fonte = url.searchParams.get("fonte") ?? "";
  const doc = (url.searchParams.get("doc") ?? "").trim();

  if (!ehTipoDeFicha(tipo) || !id || !doc) return foraDoEscopo();

  const resultado = await abrirDocumento({ doc, fonte, id, sessao: auth.sessao, tipo });

  if (!resultado.ok) {
    if (resultado.status === 404) return foraDoEscopo();
    return NextResponse.json(
      { error: "Não foi possível abrir o documento agora." },
      { status: resultado.status },
    );
  }

  if (resultado.tipo === "url") {
    // URL assinada e efêmera do Storage: o redirect não carrega credencial nenhuma.
    return NextResponse.redirect(resultado.url, 302);
  }

  return new NextResponse(resultado.body, {
    headers: d4signPdfHeaders(doc, resultado.contentType, resultado.contentLength),
  });
}
