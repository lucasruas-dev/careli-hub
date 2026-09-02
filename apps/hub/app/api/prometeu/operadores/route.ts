import { NextResponse } from "next/server";

import { authorizePrometeuWrite } from "@/lib/prometeu/auth";
import { createPrometeuClient, getEvento } from "@/lib/prometeu/data";
import {
  autorizarLeituraDoHubOuDoCoordenador,
  eventoNoEscopo,
  respostaForaDoEscopo,
} from "@/lib/prometeu/operador-server";
import {
  criarOperador,
  listarOperadores,
  removerOperador,
} from "@/lib/prometeu/operadores";

// Rotas de ADMIN dos operadores do evento (o Lucas gerencia no Setup, com sessao do hub).
//   GET    ?eventoId=  -> lista os operadores (sem senha)
//   POST   { eventoId, username, nome, senha, perfil, zona, mesaId }  -> cria
//   DELETE ?id=        -> remove
// O login/logout/eu do PROPRIO operador vive em /api/prometeu/operador/* (rotas publicas).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  // A LISTA também é do coordenador do portal comercial: a Central mostra os postos de
  // credenciamento (operadoresRecepcao) e engole o erro (`data ?? []`) — só com o hub, o mapa do
  // salão dele apareceria sem posto nenhum, como se ninguém estivesse credenciando. O recorte é
  // conferido no evento pedido; o operador de posto continua de fora (não é dele).
  const auth = await autorizarLeituraDoHubOuDoCoordenador(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const eventoId = new URL(request.url).searchParams.get("eventoId")?.trim();
  if (!eventoId) {
    return NextResponse.json({ error: "Informe o eventoId." }, { status: 400 });
  }

  const evento = await getEvento(client, eventoId);
  if (!evento || !eventoNoEscopo(auth, evento)) return respostaForaDoEscopo();

  const operadores = await listarOperadores(client, eventoId);
  return NextResponse.json(
    { data: operadores },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authorizePrometeuWrite(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    eventoId?: string;
    mesaId?: string | null;
    nome?: string;
    perfil?: string;
    senha?: string;
    username?: string;
    zona?: string;
  };

  if (!body.eventoId) {
    return NextResponse.json({ error: "Informe o eventoId." }, { status: 400 });
  }

  const resultado = await criarOperador(client, {
    eventoId: body.eventoId,
    mesaId: body.mesaId ?? null,
    nome: body.nome ?? "",
    perfil: body.perfil ?? "",
    senha: body.senha ?? "",
    username: body.username ?? "",
    zona: body.zona ?? "",
  });

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 400 });
  }
  return NextResponse.json({ data: { id: resultado.id, ok: true } });
}

export async function DELETE(request: Request) {
  const auth = await authorizePrometeuWrite(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "Informe o id." }, { status: 400 });
  }

  const resultado = await removerOperador(client, id);
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 400 });
  }
  return NextResponse.json({ data: { ok: true } });
}
