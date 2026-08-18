import { NextResponse } from "next/server";

import { ehTipoDeFicha } from "@/lib/apolo/incorporador/crm";
import { montarDocumentos } from "@/lib/apolo/incorporador/documentos";
import { autorizar, foraDoEscopo } from "@/lib/apolo/incorporador/escopo";

// A ABA DOCUMENTOS da ficha do CRM do portal — a rota irmã escopada de /api/apolo/documentos.
//
// ⚠️ ESTA ROTA SÓ SERVE DOCUMENTO DE PESSOA DENTRO DO ESCOPO: `montarDocumentos` roda
// `pessoaNoEscopo` (a mesma prova de `montarFicha`, contra `codigosDaSessao`/`idsDaSessao`)
// ANTES de qualquer leitura. Id de pessoa de outro loteador responde 404 via `foraDoEscopo`.
//
// A lista junta três fontes (Apolo + contrato D4Sign + anexos legados do C2X); o download de
// cada uma sai pela rota irmã ./abrir — esta aqui só lista metadados.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const tipo = url.searchParams.get("tipo") ?? "";
  const id = (url.searchParams.get("id") ?? "").trim();

  if (!ehTipoDeFicha(tipo)) {
    return NextResponse.json({ error: "Tipo desconhecido." }, { status: 400 });
  }

  if (!id) {
    return NextResponse.json({ error: "Informe o id da ficha." }, { status: 400 });
  }

  const resultado = await montarDocumentos({ id, sessao: auth.sessao, tipo });

  if (!resultado.ok) {
    if (resultado.status === 404) return foraDoEscopo();
    return NextResponse.json(
      { error: "Não foi possível carregar os documentos agora." },
      { status: resultado.status },
    );
  }

  return NextResponse.json(
    { data: { documentos: resultado.documentos } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
