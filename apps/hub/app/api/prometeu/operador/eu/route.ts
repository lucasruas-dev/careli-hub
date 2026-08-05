import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  PROMETEU_SESSION_COOKIE,
  validarTokenSessao,
} from "@/lib/prometeu/operador-auth";
import { buscarOperadorEuPorId } from "@/lib/prometeu/operadores";
import type { PrometeuOperadorEu } from "@/lib/prometeu/types";

// "Quem sou eu": le o cookie de sessao do operador, valida o token (assinatura + expiracao) e
// devolve o operador logado. ROTA PUBLICA — a validacao E' o token assinado, nao a sessao do hub.
//
// O token nao carrega o NOME (nem deve carregar dados mutaveis); por isso, com o id do token,
// relemos o operador no banco. Bonus de seguranca: se o operador foi desativado, o /eu ja devolve
// null mesmo com o token ainda dentro da validade.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const store = await cookies();
  const token = store.get(PROMETEU_SESSION_COOKIE)?.value;
  const sessao = validarTokenSessao(token, Date.now());

  if (!sessao) {
    return NextResponse.json(
      { data: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Serviço indisponível." }, { status: 503 });
  }

  const eu: PrometeuOperadorEu = await buscarOperadorEuPorId(client, sessao.operadorId);
  return NextResponse.json(
    { data: eu },
    { headers: { "Cache-Control": "no-store" } },
  );
}
