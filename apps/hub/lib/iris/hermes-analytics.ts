import type { SupabaseClient } from "@supabase/supabase-js";

// Analytics do HERMES (pulsex) para o modo ASSISTENTE da CACÁ: "tem mensagem pra mim?" =
// mensagens NÃO LIDAS por canal (criadas depois do last_read_at do usuário, que não são dele
// e não estão apagadas). Precisa do hub_user_id do admin (mapa número→usuário no env).
// Ver [[project-caca-admin-assistant-mode]].

export type HermesResumo = {
  totalNaoLidas: number;
  canais: { canal: string; naoLidas: number }[];
};

export async function loadHermesResumo(
  client: SupabaseClient,
  hubUserId: string,
): Promise<HermesResumo | null> {
  const { data: members, error } = await client
    .from("pulsex_channel_members")
    .select("channel_id, last_read_at")
    .eq("user_id", hubUserId)
    .limit(200);

  if (error) {
    console.error("[hermes] loadHermesResumo failed", error.message);

    return null;
  }

  const memberships = (members ?? []) as {
    channel_id: string;
    last_read_at: string | null;
  }[];

  if (memberships.length === 0) {
    return { canais: [], totalNaoLidas: 0 };
  }

  const { data: channels } = await client
    .from("pulsex_channels")
    .select("id, name");
  const channelName = new Map(
    (channels ?? []).map((c: { id: string; name: string | null }) => [
      c.id,
      c.name ?? "Canal",
    ]),
  );

  const perChannel = await Promise.all(
    memberships.map(async (membership) => {
      let query = client
        .from("pulsex_messages")
        .select("id", { count: "exact", head: true })
        .eq("channel_id", membership.channel_id)
        .is("deleted_at", null)
        .neq("author_user_id", hubUserId);

      if (membership.last_read_at) {
        query = query.gt("created_at", membership.last_read_at);
      }

      const { count } = await query;

      return {
        canal: channelName.get(membership.channel_id) ?? "Canal",
        naoLidas: count ?? 0,
      };
    }),
  );

  const canais = perChannel
    .filter((entry) => entry.naoLidas > 0)
    .sort((first, second) => second.naoLidas - first.naoLidas);

  return {
    canais,
    totalNaoLidas: canais.reduce((sum, entry) => sum + entry.naoLidas, 0),
  };
}
