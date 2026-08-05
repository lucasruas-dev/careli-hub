import type { SupabaseClient } from "@supabase/supabase-js";

// FONTE ÚNICA da imobiliária de um cliente: o vínculo por ENTIDADE em apolo_relationships. O tipo
// varia ("imobiliaria" o novo/correto, "Imobiliaria da CAD" o legado do Asana, "Imobiliária"), então
// casamos por PREFIXO case-insensitive ("imobili%") e exigimos related_entity_id. O vínculo mais
// recente e não-arquivado vence (cobre a troca de imobiliária). Ver
// [[reference_apolo_imobiliaria_duas_fontes]]. Antes cada leitor filtrava só "Imobiliaria da CAD" e
// os vínculos novos sumiam do relatório/avisos/write-back.

const PREFIXO_TIPO = "imobili%";

export async function imobiliariaEntityIdDoCliente(
  client: SupabaseClient,
  entityId: string,
): Promise<{ imobEntityId: string | null; label: string | null }> {
  const { data } = await client
    .from("apolo_relationships")
    .select("related_entity_id, label")
    .eq("entity_id", entityId)
    .ilike("relationship_type", PREFIXO_TIPO)
    .not("related_entity_id", "is", null)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ label: string | null; related_entity_id: string | null }>();
  return { imobEntityId: data?.related_entity_id ?? null, label: data?.label ?? null };
}

// Mapa cliente -> imobiliária-entidade, em lote (para o relatório). Mais recente vence.
export async function imobiliariaEntityIdEmLote(
  client: SupabaseClient,
  entityIds: string[],
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  for (let i = 0; i < entityIds.length; i += 300) {
    const { data } = await client
      .from("apolo_relationships")
      .select("entity_id, related_entity_id")
      .ilike("relationship_type", PREFIXO_TIPO)
      .not("related_entity_id", "is", null)
      .neq("status", "archived")
      .in("entity_id", entityIds.slice(i, i + 300))
      .order("created_at", { ascending: false });
    for (const r of (data ?? []) as Array<{
      entity_id: string;
      related_entity_id: string | null;
    }>) {
      // O primeiro (mais recente) de cada cliente vence.
      if (r.related_entity_id && !mapa.has(r.entity_id)) {
        mapa.set(r.entity_id, r.related_entity_id);
      }
    }
  }
  return mapa;
}
