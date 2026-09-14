import { NextResponse, type NextRequest } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { conferirSenhaNova } from "@/lib/auth/senha-nova";
import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

// A TROCA DE SENHA OBRIGATÓRIA — lado do hub interno.
//
// Lucas (13/09/2026): *"quero que todos amanhã ao logar no panteon possa configurar uma senha nova.
// isso vai virar padrão, primeiro acesso eu coloco a senha como é hoje, no acesso, o sistema pede
// para ele cadastrar uma nova senha"*.
//
// ⚠️ QUEM TROCA A SENHA É O DONO DELA, com o token DELE. O Panteon não escreve senha de ninguém: a
// chamada vai para o `PUT /auth/v1/user` do Supabase Auth com o access token de quem está logado.
// Usar a chave de serviço para trocar a senha por cima daria ao Panteon um poder que ele não
// precisa ter — e bastaria um defeito nesta rota para virar troca de senha alheia.
//
// ⚠️ E POR ISSO A ORDEM É: TROCA PRIMEIRO, DESMARCA DEPOIS. Se a troca falhar, a marca continua de
// pé e a pessoa volta a cair na tela — que é o certo. O contrário (desmarcar antes) soltaria alguém
// para dentro do sistema com a senha antiga, calado.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIMEOUT_MS = 15_000;

/**
 * Esta conta precisa cadastrar senha nova?
 *
 * ⚠️ O PORTÃO PERGUNTA AO SERVIDOR, e não ao que veio no login. A marca pode ser ligada com a
 * pessoa já logada (foi assim no mutirão de 14/09/2026), e um valor guardado na sessão só valeria
 * a partir do próximo login — que é justamente o que se quer evitar.
 */
export async function GET(request: NextRequest) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ precisa: false });

  const { anonKey, url: supabaseUrl } = getServerSupabaseConfig();
  const admin = createApoloAdminClient();
  if (!supabaseUrl || !anonKey || !admin) return NextResponse.json({ precisa: false });

  try {
    const quem = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
      cache: "no-store",
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    });
    const dono = (await quem.json().catch(() => null)) as null | { id?: unknown };
    const id = typeof dono?.id === "string" ? dono.id : null;
    if (!quem.ok || !id) return NextResponse.json({ precisa: false });

    const { data } = await admin
      .from("hub_users")
      .select("trocar_senha")
      .eq("id", id)
      .maybeSingle<{ trocar_senha: boolean }>();

    return NextResponse.json({ precisa: data?.trocar_senha === true });
  } catch {
    // ⚠️ FALHA AQUI NÃO TRANCA NINGUÉM. Um soluço de rede no portão barraria o hub inteiro para
    // quem já trocou a senha. O custo do erro para o outro lado é um dia a mais com a senha antiga.
    return NextResponse.json({ precisa: false });
  }
}

export async function POST(request: NextRequest) {
  const { anonKey, url: supabaseUrl } = getServerSupabaseConfig();
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ error: "Supabase nao configurado." }, { status: 503 });
  }

  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ error: "Sessao invalida." }, { status: 401 });
  }

  const corpo = (await request.json().catch(() => null)) as null | { senha?: unknown };
  const veredito = conferirSenhaNova(typeof corpo?.senha === "string" ? corpo.senha : "");
  if (!veredito.ok) {
    return NextResponse.json({ error: veredito.erro }, { status: 400 });
  }

  const controller = new AbortController();
  const relogio = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resposta = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
      body: JSON.stringify({ password: veredito.senha }),
      cache: "no-store",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      method: "PUT",
      signal: controller.signal,
    });

    const payload = (await resposta.json().catch(() => null)) as null | {
      id?: unknown;
      msg?: unknown;
      error_description?: unknown;
      message?: unknown;
    };

    if (!resposta.ok) {
      // ⚠️ A MENSAGEM DELES VEM EM INGLÊS E ÀS VEZES CRUA. A mais comum é a senha repetida — o
      // Supabase recusa trocar para a MESMA senha, e é exatamente o que alguém tenta primeiro.
      const cru = String(
        payload?.error_description ?? payload?.msg ?? payload?.message ?? "",
      ).toLowerCase();
      const repetida = cru.includes("should be different") || cru.includes("same password");
      return NextResponse.json(
        {
          error: repetida
            ? "A senha nova precisa ser diferente da atual."
            : "Nao foi possivel trocar a senha. Tente de novo.",
        },
        { status: 400 },
      );
    }

    const userId = typeof payload?.id === "string" ? payload.id : null;
    if (!userId) {
      return NextResponse.json({ error: "Resposta inesperada do login." }, { status: 502 });
    }

    // ⚠️ A MARCA SÓ CAI DEPOIS QUE A SENHA MUDOU DE VERDADE. Ver a nota do topo.
    const admin = createApoloAdminClient();
    if (admin) {
      const { error } = await admin
        .from("hub_users")
        .update({
          senha_trocada_em: new Date().toISOString(),
          trocar_senha: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (error) {
        // A senha JÁ mudou. Falhar aqui faria a pessoa achar que nada aconteceu e tentar de novo
        // com a senha antiga, que não vale mais. Ela entra; a marca cai no próximo acesso.
        console.warn("[auth/senha-nova] senha trocada mas a marca ficou:", error.message);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.warn("[auth/senha-nova] falhou:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Nao foi possivel trocar a senha." }, { status: 500 });
  } finally {
    clearTimeout(relogio);
  }
}
