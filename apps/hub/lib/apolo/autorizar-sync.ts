import { timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

// QUEM PODE DISPARAR UMA ROTINA DE SINCRONIZAÇÃO: o admin do Hub (POST manual) e o cron (GET).
//
// ⚠️ `authorizeApoloSyncRequest` SAIU DE `app/api/apolo/sync/c2x/route.ts` (F3 do plano da fonte única)
// SEM MUDAR O COMPORTAMENTO: o espelho da D4Sign (`/api/assinatura/d4sign/espelho`) usa a mesma porta
// de admin, e uma segunda cópia divergiria no primeiro conserto. A diferença é que agora ela devolve o
// id de quem disparou (o espelho registra quem rodou o POST).
//
// ⚠️ `cronPeloSegredo` NÃO ACEITA `x-vercel-cron`. Esse cabeçalho não autentica ninguém: qualquer um de
// fora manda (memória `reference_cron_x_vercel_cron_spoofavel`). O cron da Vercel manda
// `Authorization: Bearer <CRON_SECRET>` quando o segredo existe no projeto, e é SÓ isso que vale aqui.
// A comparação é por `timingSafeEqual` (o `===` vaza pelo tempo quantos caracteres bateram), e
// segredo vazio RECUSA tudo (503): um `CRON_SECRET` ausente não pode virar "qualquer Bearer vazio passa".

type HubUserRole = "admin" | "leader" | "operator" | "viewer";

export type AutorizacaoDoSync = { ok: true; usuarioId: string } | { ok: false; response: NextResponse };

export type ResultadoDoCron = { ok: true } | { motivo: "nao_autorizado" | "segredo_ausente"; ok: false };

/** O token do `Authorization: Bearer`, ou `null`. */
export function tokenDoBearer(request: Pick<NextRequest, "headers">): null | string {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

/**
 * O GET do cron: SÓ `Authorization: Bearer <CRON_SECRET>`.
 *
 * ⚠️ `segredo_ausente` É 503, NÃO 401: é configuração faltando no ambiente, e quem lê o log precisa
 * saber que a rotina não roda por isso (e não porque alguém bateu na porta errada).
 */
export function cronPeloSegredo(
  request: Pick<NextRequest, "headers">,
  segredo: null | string | undefined = process.env.CRON_SECRET,
): ResultadoDoCron {
  const esperado = String(segredo ?? "").trim();
  if (!esperado) return { motivo: "segredo_ausente", ok: false };
  const recebido = tokenDoBearer(request);
  if (!recebido) return { motivo: "nao_autorizado", ok: false };
  const a = Buffer.from(recebido, "utf8");
  const b = Buffer.from(esperado, "utf8");
  // `timingSafeEqual` exige o mesmo tamanho; tamanho diferente já é "não", sem comparar.
  if (a.length !== b.length) return { motivo: "nao_autorizado", ok: false };
  return timingSafeEqual(a, b) ? { ok: true } : { motivo: "nao_autorizado", ok: false };
}

/**
 * O POST manual: sessão do Hub, usuário ativo e admin. Devolve o id de quem disparou.
 *
 * ⚠️ IGUAL AO QUE MORAVA NA ROTA DO APOLO (mesmas mensagens e códigos), para a rota de lá não mudar.
 */
export async function authorizeApoloSyncRequest(
  request: Pick<NextRequest, "headers">,
  adminClient: SupabaseClient,
): Promise<AutorizacaoDoSync> {
  const accessToken = tokenDoBearer(request);

  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Sessao administrativa ausente." }, { status: 401 }),
    };
  }

  const { data: authData, error: authError } = await adminClient.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Sessao administrativa invalida." }, { status: 401 }),
    };
  }

  const { data: user, error: userError } = await adminClient
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<{ id: string; role: HubUserRole; status: string }>();

  if (userError || !user || user.status !== "active" || user.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Usuario sem acesso a sincronizacao do Apolo." }, { status: 403 }),
    };
  }

  return { ok: true, usuarioId: user.id };
}
