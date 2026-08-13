import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { salvarUsuarioIncorporador } from "@/lib/apolo/incorporador/gestao";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Cria a conta de login de um incorporador, ou atualiza a que existe (nome, e-mail, senha,
// ativo/inativo). Sem GET: a lista de usuários já vem em /api/apolo/incorporadores, e uma rota
// de leitura a mais seria uma superfície a mais expondo quem entra no portal.
//
// A senha entra por aqui e vira scrypt na hora. NUNCA é gravada crua, nunca volta na resposta e
// nunca vai para log.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base do Apolo." }, { status: 503 });

  const corpo = (await request.json().catch(() => null)) as null | {
    ativo?: boolean;
    email?: string;
    id?: null | string;
    incorporadorId?: string;
    nome?: string;
    senha?: null | string;
  };

  if (!corpo?.incorporadorId?.trim() && !corpo?.id?.trim()) {
    return NextResponse.json({ error: "Escolha o incorporador." }, { status: 400 });
  }

  const resultado = await salvarUsuarioIncorporador(client, {
    ativo: corpo.ativo,
    email: corpo.email ?? "",
    id: corpo.id ?? null,
    incorporadorId: String(corpo.incorporadorId ?? ""),
    nome: corpo.nome ?? "",
    senha: corpo.senha ?? null,
  });

  if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 400 });

  return NextResponse.json({ data: { id: resultado.id } });
}
