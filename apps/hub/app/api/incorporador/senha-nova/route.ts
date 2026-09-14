import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { hashSenhaIncorporador } from "@/lib/apolo/incorporador/senha";
import { sessaoDoRequest } from "@/lib/apolo/incorporador/sessao";
import { conferirSenhaNova } from "@/lib/auth/senha-nova";

// A TROCA DE SENHA OBRIGATÓRIA — lado do portal (comercial e incorporador).
//
// ⚠️ O OUTRO LADO É `app/api/auth/senha-nova`, e são rotas diferentes porque são LOGINS diferentes:
// o hub autentica no Supabase Auth e o portal tem senha própria, scrypt em
// `apolo_incorborador_usuarios.senha_hash`. O que as duas compartilham é a RÉGUA
// (`lib/auth/senha-nova.ts`) — a mesma pessoa pode ter conta nos dois lados, e duas exigências
// diferentes para a mesma senha seria confusão pura.
//
// ⚠️ QUEM TROCA É QUEM ESTÁ LOGADO, e a conta sai do COOKIE ASSINADO — nunca do corpo do pedido.
// Aceitar um `usuarioId` do cliente aqui seria dar a qualquer pessoa logada a senha de qualquer
// outra: é o defeito clássico desta classe de rota, e ele não aparece em teste nenhum que não o
// procure de propósito.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Esta conta do portal precisa cadastrar senha nova?
 *
 * ⚠️ LÊ DO BANCO, E NÃO DO COOKIE. O cookie foi assinado no login e congela o que era verdade
 * naquele instante; a marca pode ser ligada com a pessoa já logada, que foi exatamente o caso do
 * mutirão de 14/09/2026. É a mesma disciplina que a rota de sessão já segue ao revalidar o escopo
 * no banco a cada carga.
 */
export async function GET(request: Request) {
  const sessao = sessaoDoRequest(request);
  if (!sessao?.usuarioId) return NextResponse.json({ precisa: false });

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ precisa: false });

  try {
    const { data } = await admin
      .from("apolo_incorporador_usuarios")
      .select("trocar_senha")
      .eq("id", sessao.usuarioId)
      .maybeSingle<{ trocar_senha: boolean }>();

    return NextResponse.json({ precisa: data?.trocar_senha === true });
  } catch {
    // ⚠️ FALHA AQUI NÃO TRANCA NINGUÉM — mesma regra do portão do hub.
    return NextResponse.json({ precisa: false });
  }
}

export async function POST(request: Request) {
  const sessao = sessaoDoRequest(request);
  if (!sessao?.usuarioId) {
    return NextResponse.json({ error: "Sessao invalida." }, { status: 401 });
  }

  const corpo = (await request.json().catch(() => null)) as null | { senha?: unknown };
  const veredito = conferirSenhaNova(corpo?.senha);
  if (!veredito.ok) {
    return NextResponse.json({ error: veredito.erro }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  try {
    const hash = await hashSenhaIncorporador(veredito.senha);

    const agora = new Date().toISOString();
    const { error } = await admin
      .from("apolo_incorporador_usuarios")
      .update({
        senha_hash: hash,
        senha_trocada_em: agora,
        trocar_senha: false,
        updated_at: agora,
      })
      .eq("id", sessao.usuarioId)
      .eq("ativo", true);

    if (error) {
      console.warn("[incorporador/senha-nova] gravacao falhou:", error.message);
      return NextResponse.json({ error: "Nao foi possivel trocar a senha." }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.warn("[incorporador/senha-nova] falhou:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Nao foi possivel trocar a senha." }, { status: 500 });
  }
}
