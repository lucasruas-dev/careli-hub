import { NextResponse, type NextRequest } from "next/server";

import { fetchEvolutionGroupInfo } from "@/lib/iris/evolution-api";
import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Semeia os participantes dos grupos JÁ monitorados, pra o seletor de menção (@)
// funcionar sem esperar todo mundo falar. Busca a lista na Evolution
// (findGroupInfos) e grava os NÚMEROS (o nome vem depois, de quem falar).
//
// Roda em lote e é reentrante: só processa grupos que ainda não têm participante.
//
// ⚠️ FORA de /api/iris/evolution de propósito (aquele prefixo é público pelo gate).

export async function POST(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const { client } = authorization;

  let limit = 5;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.limit === "number" && Number.isFinite(body.limit)) {
      limit = Math.min(Math.max(Math.trunc(body.limit), 1), 20);
    }
  } catch {
    // corpo opcional
  }

  // Grupos monitorados que ainda não têm participante semeado.
  const { data: groups } = await client
    .from("caredesk_whatsapp_groups")
    .select("id,group_jid")
    .eq("monitored", true);

  const result = { pendentes: 0, processados: 0, semeados: 0, falharam: 0 };

  const pending: { id: string; group_jid: string }[] = [];
  for (const group of (groups ?? []) as { id: string; group_jid: string }[]) {
    const { count } = await client
      .from("caredesk_whatsapp_group_participants")
      .select("id", { count: "exact", head: true })
      .eq("group_id", group.id);
    if (!count) {
      pending.push(group);
    }
  }
  result.pendentes = pending.length;

  for (const group of pending.slice(0, limit)) {
    result.processados += 1;

    try {
      const info = await fetchEvolutionGroupInfo(group.group_jid);
      const rows = (info?.participants ?? [])
        .map((participant) => ({
          group_id: group.id,
          is_admin: Boolean(participant.admin),
          phone: jidToPhone(participant.phoneNumber),
        }))
        .filter(
          (row): row is { group_id: string; is_admin: boolean; phone: string } =>
            Boolean(row.phone),
        );

      if (!rows.length) {
        result.falharam += 1;
        continue;
      }

      const { error } = await client
        .from("caredesk_whatsapp_group_participants")
        .upsert(rows, { onConflict: "group_id,phone" });

      if (error) {
        result.falharam += 1;
        continue;
      }

      result.semeados += 1;
    } catch {
      result.falharam += 1;
    }
  }

  return NextResponse.json(
    { ok: true, ...result, restantes: result.pendentes - result.semeados },
    { headers: { "Cache-Control": "no-store" }, status: 200 },
  );
}

function jidToPhone(jid: string | null): string | null {
  if (!jid || !jid.includes("@s.whatsapp.net")) {
    return null;
  }
  const phone = jid.split("@")[0]?.replace(/\D/g, "") ?? "";
  return phone || null;
}
