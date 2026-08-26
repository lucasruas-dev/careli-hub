// Suporte ao CADASTRO MANUAL de prospect (operador logado): os empreendimentos e os corretores de
// UMA imobiliária, para o operador seguir o fluxo imobiliária -> empreendimento -> corretor — o
// MESMO caminho que o portal público já faz pelo token da antessala. Reusa a regra do portal.
// Ver [[reference_apolo_empreendimento_faltante]], [[project_apolo_portal_publico_cad]].
import { empreendimentosHabilitadosInterno } from "@/lib/publico/cad/dados";
import type { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type EmpreendimentoDaImob = { enterpriseId: string; nome: string };
export type CorretorDaImob = { email: string | null; entityId: string; nome: string };

// Empreendimentos que a imobiliária TRABALHA: vínculo 'empreendimento' verified ∩ empreendimentos
// ativos. É a lista que decide "se >1 mostra pro operador escolher, se 1 vincula direto".
//
// ⚠️ Consumidor INTERNO (operador logado): usa a variante no MASTER, sem o portão público
// `recepcao_cad` da migration 0110 — Recanto do Vale com CAD fechada ao público continua
// disponível para o cadastro manual do time, como sempre foi. Decisão em aberto com o Lucas:
// se CAD fechada dever fechar também o manual, trocar para `empreendimentosHabilitados`.
export async function empreendimentosDaImobiliaria(
  client: AdminClient,
  imobiliariaEntityId: string,
): Promise<EmpreendimentoDaImob[]> {
  const habilitados = await empreendimentosHabilitadosInterno(client, imobiliariaEntityId);
  return habilitados.map((e) => ({ enterpriseId: String(e.id), nome: e.name }));
}

// Corretores da imobiliária: relationship 'corretor' com related_entity_id REAL (o corretor nasce
// entidade, ver dados.ts). Dedup por entidade — a mesma pessoa pode ter mais de um vínculo.
export async function listarCorretoresDaImobiliaria(
  client: AdminClient,
  imobiliariaEntityId: string,
): Promise<CorretorDaImob[]> {
  const { data } = await client
    .from("apolo_relationships")
    .select("related_entity_id, label, metadata")
    .eq("entity_id", imobiliariaEntityId)
    .eq("relationship_type", "corretor")
    .not("related_entity_id", "is", null)
    .limit(300);

  const porId = new Map<string, CorretorDaImob>();
  for (const r of (data ?? []) as Array<{
    label: string | null;
    metadata: { email?: string | null } | null;
    related_entity_id: string | null;
  }>) {
    const id = r.related_entity_id;
    if (!id || porId.has(id)) continue;
    porId.set(id, {
      email: (r.metadata?.email ?? "").trim() || null,
      entityId: id,
      nome: (r.label ?? "").trim() || "Corretor",
    });
  }
  return [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}
