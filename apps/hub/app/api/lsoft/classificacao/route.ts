import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { type Decisao, decidirClassificacao } from "@/lib/lsoft/classificacao";

// O BOTÃO DE VALIDAR o subsídio da Caixa (Vale do Sol / MCMV).
//
// A máquina propõe quais parcelas são da Caixa; aqui uma pessoa confirma ou rejeita. Só a decisão
// confirmada tira o valor da carteira do cliente — ver `lsoft_carteira_por_cliente_empreendimento`
// (migration 0104).
//
// ⚠️ ESTA ROTA NASCE COM `authorizeApoloWrite`, e não com a porta de leitura que o resto do módulo
// LSoft usa. As rotas antigas ficam como estão (decisão do Lucas, 25/08), mas escrita nova não
// entra pela porta errada: esta decisão move dinheiro de lugar na visão do cliente.
//
// ⚠️ QUEM ASSINA É A SESSÃO, nunca o corpo do pedido. Aceitar um "autor" vindo da tela
// transformaria a trilha de validação em ficção.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const corpo = (await request.json().catch(() => null)) as
    | { decisao?: string; natureza?: null | string; parcelaId?: string }
    | null;

  const parcelaId = String(corpo?.parcelaId ?? "").trim();
  if (!parcelaId) {
    return NextResponse.json({ error: "Informe a parcela." }, { status: 400 });
  }

  const resultado = await decidirClassificacao({
    autor: "userId" in auth ? ((auth as { userId?: null | string }).userId ?? null) : null,
    autorNome: "userName" in auth ? ((auth as { userName?: null | string }).userName ?? null) : null,
    autorOrigem: "careli",
    decisao: (corpo?.decisao ?? "confirmada") as Decisao,
    natureza: corpo?.natureza,
    parcelaId,
  });

  if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 400 });

  return NextResponse.json({ data: resultado.classificacao });
}
