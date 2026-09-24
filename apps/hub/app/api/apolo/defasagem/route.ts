import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { carregarDefasagem } from "@/lib/apolo/reajuste/defasagem-c2x";

// A DEFASAGEM DA CARTEIRA — quanto a parcela FUTURA está atrás do que a cobrança já pratica.
//
// Nasceu do pedido do Lucas (23/09/2026) de um relatório de projeção de reajuste. Ao medir o
// terreno apareceu isto, que vale mais e vem antes: **o valor contratual da parcela nunca é
// atualizado no C2X**, só a que recebe boleto é corrigida. Medido em 23/09/2026, 527 de 874
// contratos (60%) têm parcela futura defasada, mediana de 22,63%, somando R$ 50.762,05 por mês de
// mensalidade que a carteira deixa de cobrar.
//
// ⚠️ ISTO NÃO É PROJEÇÃO, É MEDIÇÃO. Não há índice nenhum nesta conta: compara-se o que a cobrança
// já usa com o que as futuras ainda carregam. Ver `lib/apolo/reajuste/defasagem.ts` e o documento
// `docs/operations/2026-09-23-como-o-reajuste-realmente-anda.md`.
//
// ⚠️ LEITURA PESADA, E DE PROPÓSITO SEM CACHE. São 118.033 mensais em uma consulta (1,6 s medido).
// É uma tela que se abre para trabalhar, não um painel que fica aberto atualizando: não coloque
// polling nisto. O custo de polling em leitura do legado já derrubou fatura nesta casa.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);
  if (!authorization.ok) return authorization.response;

  const params = new URL(request.url).searchParams;
  const codes = (params.get("codes") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  const resultado = await carregarDefasagem(codes);
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 503 });
  }

  return NextResponse.json(
    { data: resultado.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
