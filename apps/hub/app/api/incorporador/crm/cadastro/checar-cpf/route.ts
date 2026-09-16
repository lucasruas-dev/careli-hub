import { NextResponse } from "next/server";

import {
  checarCpfNoPortal,
  recusaDaEscritaNoCadastro,
} from "@/lib/apolo/incorporador/cadastro-do-portal";
import { respostaDaEscrita } from "@/lib/apolo/incorporador/operacao-do-produto-servidor";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// CHECAGEM DO CPF NA IDENTIFICAÇÃO — versão do CRM do portal do incorporador.
//
// Gêmea de /api/apolo/cadastro/checar-cpf: a conferência é a MESMA função
// (`conferirCpfNoEmpreendimento`). Muda a porta (cookie do portal que opera sozinho), o produto
// (vem do corpo e tem de ser da sessão, senão 404) e a frase: aqui ela não nomeia o titular do
// núcleo nem o empreendimento onde a CAD já está.
//
// ⚠️ É O PRIMEIRO PASSO DE UM CADASTRO, e cadastro só vale no produto que a Cecílio opera (decisão do
// Lucas, 16/09/2026): produto só de consulta responde 403 já aqui, antes de o time preencher a ficha.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  const corpo = (await request.json().catch(() => null)) as { enterpriseId?: unknown } | null;

  const recusa = await recusaDaEscritaNoCadastro(auth.ator, corpo?.enterpriseId);
  if (recusa) {
    const resposta = respostaDaEscrita(recusa);
    resposta.headers.set("Cache-Control", "no-store");
    return resposta;
  }

  const resposta = await checarCpfNoPortal({
    adminClient: createApoloAdminClient(),
    ator: auth.ator,
    corpo,
  });

  return NextResponse.json(resposta.corpo, { headers: noStore, status: resposta.status });
}
