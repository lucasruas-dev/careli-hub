import { NextResponse } from "next/server";

import { authorizeApoloCoordenacao } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { aprovarComRestricao, type CorpoDaAprovacao } from "@/lib/serasa/aprovar-restricao-servico";

// APROVAR COM RESTRIÇÃO (COORDENAÇÃO): PROBLEMA 3 (Lucas, 04/08).
//
// Crédito reprovado no Serasa trava a ficha em `apolo_esteira.etapa = 'revisao'`. Esta rota é o
// caminho legítimo para destravar por decisão humana: a coordenação (admin/leader) aprova "com
// restrição", ANEXA a evidência do de-acordo (PDF/PNG/JPEG, obrigatória), e a esteira segue o fluxo
// normal: prevenda se ligada, senão credenciado.
//
// O clique cru do Board ("Aprovar crédito (coordenador)"), que empurrava reprovado -> prevenda sem
// nada disso, deixou de existir.
//
// (16/09/2026) A REGRA MORA EM `lib/serasa/aprovar-restricao-servico.ts`, a mesma que o portal que
// opera sozinho chama pela própria porta. Aqui fica só o que é do hub: SÓ a coordenação passa.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Sobe a evidência + regenera a CAD; folga para não estourar o tempo da função.
export const maxDuration = 30;

export async function POST(request: Request) {
  // Só a COORDENAÇÃO (admin/leader). Analista (operator) não destrava crédito reprovado.
  const auth = await authorizeApoloCoordenacao(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });

  const corpo = (await request.json().catch(() => ({}))) as CorpoDaAprovacao;

  const resposta = await aprovarComRestricao({
    // Nome null de propósito: o serviço relê o nome em `hub_users` para o rastro, como sempre fez, e
    // `auth.nome` amarrava esta rota à mudança de `lib/apolo/auth.ts` de outra onda (revisão 16/09).
    autor: { nome: null, papel: "coordenacao", tipo: "hub", userId: auth.userId },
    client,
    corpo,
  });
  return NextResponse.json(resposta.corpo, { status: resposta.status });
}
