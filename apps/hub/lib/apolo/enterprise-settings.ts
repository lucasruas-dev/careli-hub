// Settings do empreendimento no Apolo. Hoje guarda um flag só: `credenciamento_ativo` — se o
// empreendimento ainda está "na ativa", recebendo CAD e credenciamento de imobiliária. O portal
// de credenciamento oferece SOMENTE os ativos (decisão do Lucas 18/jul).
//
// O empreendimento é do C2X (enterprises), não é uma apolo_entity: a chave é o id do C2X.
// Requer a migration 0052_apolo_enterprise_settings.sql. Enquanto ela não for aplicada, as
// leituras devolvem vazio (sem quebrar a tela) e a escrita devolve erro explicativo.
import type { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

const TABLE = "apolo_enterprise_settings";

export type EnterpriseSetting = { credenciamentoAtivo: boolean };

type SettingRow = {
  code: string | null;
  credenciamento_ativo: boolean | null;
  enterprise_id: string;
};

// A tabela pode não existir ainda (migration pendente): trata como "sem settings".
function tabelaAusente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || /does not exist/i.test(error.message ?? "");
}

// { enterpriseId -> { credenciamentoAtivo } } de todos os empreendimentos já marcados.
export async function listEnterpriseSettings(
  adminClient: AdminClient,
): Promise<Record<string, EnterpriseSetting>> {
  const { data, error } = await adminClient
    .from(TABLE)
    .select("enterprise_id, code, credenciamento_ativo")
    .limit(2000);

  if (error || !data) return {};

  const out: Record<string, EnterpriseSetting> = {};
  for (const row of data as SettingRow[]) {
    out[row.enterprise_id] = { credenciamentoAtivo: Boolean(row.credenciamento_ativo) };
  }
  return out;
}

// Ids dos empreendimentos ativos pro credenciamento (o portal usa este recorte).
export async function listEnterprisesAtivos(adminClient: AdminClient): Promise<string[]> {
  const { data, error } = await adminClient
    .from(TABLE)
    .select("enterprise_id")
    .eq("credenciamento_ativo", true)
    .limit(2000);

  if (error || !data) return [];
  return (data as { enterprise_id: string }[]).map((row) => row.enterprise_id);
}

export async function setEnterpriseCredenciamento(input: {
  adminClient: AdminClient;
  ativo: boolean;
  code?: string | null;
  enterpriseId: string;
  updatedBy?: string | null;
}): Promise<{ error?: string; ok: boolean }> {
  const enterpriseId = (input.enterpriseId ?? "").trim();
  if (!enterpriseId) return { error: "Empreendimento invalido.", ok: false };

  const { error } = await input.adminClient.from(TABLE).upsert(
    {
      code: input.code ?? null,
      credenciamento_ativo: input.ativo,
      enterprise_id: enterpriseId,
      updated_at: new Date().toISOString(),
      updated_by: input.updatedBy ?? null,
    },
    { onConflict: "enterprise_id" },
  );

  if (error) {
    if (tabelaAusente(error)) {
      return {
        error:
          "Tabela de settings do empreendimento ainda nao existe (migration 0052 pendente).",
        ok: false,
      };
    }
    return { error: `Nao foi possivel salvar: ${error.message}`, ok: false };
  }

  return { ok: true };
}
