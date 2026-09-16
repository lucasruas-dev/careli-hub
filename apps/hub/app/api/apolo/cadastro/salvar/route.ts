import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { salvarCadastroDoApolo, type SalvarPayload } from "@/lib/apolo/cadastro-salvar";
import { donoUploadOperador } from "@/lib/apolo/documentos";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Fecha o ciclo do cadastro: cria a ENTIDADE (papel de nascimento) e salva no drive os
// documentos anexados + o CAD em PDF. Uma chamada so, server-side (o wizard nao fala com o
// Supabase direto). Ver [[project_apolo_cadastro_prospect]].
//
// ⚠️ A REGRA NÃO MORA MAIS AQUI (16/09/2026): mora em `lib/apolo/cadastro-salvar.ts`, porque o CRM
// do portal do incorporador cadastra cliente com as MESMAS regras e as duas portas chamam a mesma
// função. Esta rota diz QUEM é o operador (Bearer do hub) e devolve a resposta de sempre, inteira:
// a mensagem que nomeia o empreendimento e o id da ficha existente são para o time da Careli.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const authorization = await authorizeApoloRead(request);
  if (!authorization.ok) {
    return authorization.response;
  }

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  let payload: SalvarPayload;
  try {
    payload = (await request.json()) as SalvarPayload;
  } catch {
    return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });
  }

  const resultado = await salvarCadastroDoApolo({
    adminClient,
    autor: {
      donoUpload: donoUploadOperador(authorization.userId),
      // Autor do cadastro (nome do operador), lido depois das validações, como sempre.
      nome: async () => {
        const { data: operator } = await adminClient
          .from("hub_users")
          .select("display_name, email")
          .eq("id", authorization.userId)
          .maybeSingle<{ display_name: string | null; email: string | null }>();
        return operator?.display_name ?? operator?.email ?? null;
      },
      ownerUserId: authorization.userId,
      registro: null,
    },
    origemDaEsteira: "cadastro-manual",
    origemPadrao: "cadastro-formulario",
    payload,
  });

  if (!resultado.ok) {
    if (resultado.tipo === "invalido") {
      return NextResponse.json({ error: resultado.error }, { status: resultado.status });
    }
    const { recusa } = resultado;
    // Documento já tem ficha: NÃO cria uma segunda (era a causa dos "dois Pedro"); devolve o id da
    // ficha existente para a tela abrir/avisar em vez de duplicar a pessoa no mesmo empreendimento.
    if (recusa.entityIdExistente) {
      return NextResponse.json(
        { entityIdExistente: recusa.entityIdExistente, error: recusa.error, jaExiste: true },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: recusa.error }, { status: 500 });
  }

  return NextResponse.json(resultado.corpo, { status: 201 });
}
