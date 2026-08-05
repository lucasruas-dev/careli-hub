import { NextResponse } from "next/server";

import { createPrometeuClient } from "@/lib/prometeu/data";

// IDENTIDADE do lançamento para a TELA DE LOGIN do operador — a única coisa que a tela precisa
// saber antes de alguém entrar: de que evento é este acesso ("Vale do Ouro"), pra o freela ter
// certeza de que abriu o link certo.
//
// PÚBLICA de propósito, e por isso RESPONDE SÓ O NOME. Nada de fila, credenciados, contagens ou
// qualquer dado de pessoa. O nome do lançamento já é público (está no telão, na etiqueta e no
// WhatsApp que o cliente recebe), então não há o que proteger aqui.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ data: { nome: null } }, { headers: { "Cache-Control": "no-store" } });
  }

  // ⚠️ MESMO BUG DO TELÃO (01/08): filtrar só por `status = "ativo"` faz a tela perder o nome do
  // lançamento assim que o evento COMEÇA, porque "Iniciar evento" muda o status para
  // `em_andamento`. Aqui a consequência é menos visível (o login dos externos fica sem o nome do
  // empreendimento), mas é a mesma causa. Os dois status entram, com o em andamento na frente.
  const { data } = await client
    .from("prometeu_eventos")
    .select("nome, config, status")
    .in("status", ["em_andamento", "ativo"])
    .order("created_at", { ascending: false })
    .limit(5);

  const linhas = (data ?? []) as {
    config: { enterpriseNome?: string } | null;
    nome: string | null;
    status: string;
  }[];
  const evento = linhas.find((l) => l.status === "em_andamento") ?? linhas[0] ?? null;

  // O nome por extenso do empreendimento quando existe ("Vale do Ouro"); senão o nome do evento.
  const nome = evento?.config?.enterpriseNome?.trim() || evento?.nome?.trim() || null;

  return NextResponse.json(
    { data: { nome } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
