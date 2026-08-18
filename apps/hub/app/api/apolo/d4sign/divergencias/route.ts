import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { lerDivergencias } from "@/lib/apolo/d4sign-divergencias";
import { estadoDoCacheD4Sign } from "@/lib/guardian/d4sign-consulta";

// DIVERGÊNCIAS C2X × D4SIGN — o número para cobrar o webhook.
//
// A troca da fonte (a tela passou a ler o status na D4Sign) conserta a TELA e esconde o problema
// do BANCO: o `contract_signatures` continua com 1.470 linhas "Em aberto" e `create_webhook = 0`
// em 100% delas. Esta rota é o contador que impede o problema de virar invisível — ela responde
// "hoje a tela corrigiu N assinaturas que o C2X não sabia que existiam".
//
// ⚠️ SEM DADO DE PESSOA. A resposta traz `csId`, uuid do documento, degrau, perfil e a
// `key_signer` (id opaco da D4Sign). Nome, e-mail, CPF, IP e geolocalização não passam por aqui —
// nem estão no registro, que é onde essa garantia de fato mora (`lib/apolo/d4sign-divergencias`).
//
// ⚠️ O contador é DA MEMÓRIA DO PROCESSO: zera a cada deploy e cada instância tem o seu. Serve
// para ordem de grandeza e para achar casos, não para contabilidade. Se um dia precisar ser
// contábil, o lugar é uma tabela, não esta rota.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const pedido = Number(new URL(request.url).searchParams.get("amostra"));
  const limite = Number.isFinite(pedido) && pedido > 0 ? Math.min(Math.trunc(pedido), 200) : 50;

  return NextResponse.json(
    { cache: estadoDoCacheD4Sign(), data: lerDivergencias(limite) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
