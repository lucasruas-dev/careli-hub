import { NextResponse } from "next/server";

import { ehTipoDeFicha, montarFicha } from "@/lib/apolo/incorporador/crm";
import { autorizar, foraDoEscopo } from "@/lib/apolo/incorporador/escopo";

// A FICHA do CRM do portal do incorporador — o que o clique no card da lista abre.
//
// ⚠️ O ID DA URL NÃO É CONFIÁVEL, mesmo sendo "o mesmo que a lista devolveu". Id devolvido ontem
// pode ser trocado hoje por outro id válido, de outro loteador. Por isso `montarFicha` REFAZ a
// consulta no servidor, estreitada por `codigosDaSessao`/`idsDaSessao`, e só devolve a ficha de
// quem aparece DENTRO dela. Quem não aparece recebe `foraDoEscopo()`: 404, como se não existisse.
//
// PAYLOAD POR ALLOWLIST (ver o cabeçalho da seção FICHA em `lib/apolo/incorporador/crm.ts`).
// Desde 18/08/2026, por ordem do Lucas ("tem que ser igual, cadastro, tudo"), a ficha carrega o
// cadastro COMPLETO da pessoa (documento sem máscara, cônjuge, endereço) e os relacionamentos.
// Continuam NÃO saindo: link Asaas, rótulo interno, contato de terceiros, id interno novo.
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

  const resultado = await montarFicha({ id, sessao: auth.sessao, tipo });

  if (!resultado.ok) {
    // 404 padronizado: a mensagem interna não sai, e "não é seu" vira "não existe".
    if (resultado.status === 404) return foraDoEscopo();
    return NextResponse.json({ error: resultado.erro }, { status: resultado.status });
  }

  return NextResponse.json(
    { data: { ficha: resultado.ficha } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
