import { NextResponse } from "next/server";

import { ehTipoDeFicha } from "@/lib/apolo/incorporador/crm";
import { autorizar, foraDoEscopo } from "@/lib/apolo/incorporador/escopo";
import { montarHistorico } from "@/lib/apolo/incorporador/historico";

// A ABA HISTÓRICO da ficha do CRM do portal — a ficha corrida FILTRADA para o cliente externo:
// vendas, pagamentos e reuniões, sempre estreitadas pelo escopo da sessão. Atendimentos da Iris,
// negociações do Hades e notas manuais NÃO saem por aqui (operação interna da Careli — ver o
// cabeçalho de lib/apolo/incorporador/historico.ts).
//
// ⚠️ `montarHistorico` prova a pessoa no escopo (`pessoaNoEscopo`) ANTES de ler qualquer evento,
// e as consultas de venda/pagamento levam `e.code in (codes da sessão)` — a mesma pessoa pode
// ter lote de OUTRO loteador, e esse lote não existe para esta sessão.
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

  const resultado = await montarHistorico({ id, sessao: auth.sessao, tipo });

  if (!resultado.ok) {
    if (resultado.status === 404) return foraDoEscopo();
    return NextResponse.json(
      { error: "Não foi possível carregar o histórico agora." },
      { status: resultado.status },
    );
  }

  return NextResponse.json(
    { data: { eventos: resultado.eventos } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
