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

export type EnterpriseSetting = {
  // Toggle da Análise de Crédito (default true na migration). Ligado ⇒ o limite de crédito é
  // exigido; desligado ⇒ a etapa de crédito é ignorada na esteira.
  analiseCreditoHabilitada: boolean;
  // Master "Recebendo CAD": o empreendimento está na ativa, recebendo credenciamento. Desligado,
  // os blocos de Análise de Crédito e Pré-venda ficam inertes.
  credenciamentoAtivo: boolean;
  // Limite em R$ das restrições do Serasa acima do qual o cliente é REPROVADO. null = padrão
  // da aplicação (R$ 1.000).
  limiteCredito: number | null;
  // Toggle da Pré-venda (default true na migration). Ligado ⇒ o valor do PIX é exigido; desligado
  // ⇒ a etapa de pré-venda é ignorada na esteira.
  prevendaHabilitada: boolean;
  // Valor em R$ do PIX de credenciamento (pré-venda) DESTE empreendimento. null = padrão da ação
  // (R$ 1.000). É o que permite, com vários empreendimentos ativos, gerar o PIX no valor certo.
  valorPix: number | null;
};

type SettingRow = {
  analise_credito_habilitada: boolean | null;
  code: string | null;
  credenciamento_ativo: boolean | null;
  enterprise_id: string;
  limite_credito: number | string | null;
  prevenda_habilitada: boolean | null;
  valor_pix: number | string | null;
};

// Flag com DEFAULT true no banco: null/undefined (linha sem o valor, ou coluna recém-criada no
// caminho de fallback) conta como LIGADO, para bater com o default da migration.
function flagPadraoLigado(v: boolean | null | undefined): boolean {
  return v == null ? true : Boolean(v);
}

// numeric do Postgres pode voltar como número ou string; normaliza para número >= 0 ou null.
function normalizarLimite(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

// A tabela pode não existir ainda (migration pendente): trata como "sem settings".
function tabelaAusente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || /does not exist/i.test(error.message ?? "");
}

// { enterpriseId -> { credenciamentoAtivo } } de todos os empreendimentos já marcados.
export async function listEnterpriseSettings(
  adminClient: AdminClient,
): Promise<Record<string, EnterpriseSetting>> {
  // Seleciona valor_pix junto; se a coluna ainda não existe (migration 0067 pendente), refaz a
  // leitura sem ela em vez de devolver settings vazias — a tela não pode perder o resto por causa
  // de uma coluna nova.
  let data: SettingRow[] | null = null;
  const completa = await adminClient
    .from(TABLE)
    .select(
      "enterprise_id, code, credenciamento_ativo, limite_credito, valor_pix, analise_credito_habilitada, prevenda_habilitada",
    )
    .limit(2000);

  if (completa.error) {
    // Colunas novas (valor_pix, análise de crédito, pré-venda) podem não existir em ambiente com
    // migration pendente: refaz a leitura com o núcleo estável e assume os defaults (flags = true,
    // valor_pix = null) em vez de perder o resto das settings.
    const semColuna = await adminClient
      .from(TABLE)
      .select("enterprise_id, code, credenciamento_ativo, limite_credito")
      .limit(2000);
    if (semColuna.error || !semColuna.data) return {};
    data = semColuna.data.map((r) => ({
      ...(r as Omit<
        SettingRow,
        "analise_credito_habilitada" | "prevenda_habilitada" | "valor_pix"
      >),
      analise_credito_habilitada: null,
      prevenda_habilitada: null,
      valor_pix: null,
    }));
  } else {
    data = (completa.data ?? []) as SettingRow[];
  }

  const out: Record<string, EnterpriseSetting> = {};
  for (const row of data) {
    out[row.enterprise_id] = {
      analiseCreditoHabilitada: flagPadraoLigado(row.analise_credito_habilitada),
      credenciamentoAtivo: Boolean(row.credenciamento_ativo),
      limiteCredito: normalizarLimite(row.limite_credito),
      prevendaHabilitada: flagPadraoLigado(row.prevenda_habilitada),
      valorPix: normalizarLimite(row.valor_pix),
    };
  }
  return out;
}

// Valor do PIX de credenciamento do empreendimento (id do C2X). null = sem valor próprio (usar o
// padrão da aplicação). Nunca lança nem depende da migration: coluna ausente vira null (fallback).
export async function getValorPix(
  adminClient: AdminClient,
  enterpriseId: string | null | undefined,
): Promise<number | null> {
  const id = (enterpriseId ?? "").trim();
  if (!id) return null;

  const { data, error } = await adminClient
    .from(TABLE)
    .select("valor_pix")
    .eq("enterprise_id", id)
    .maybeSingle<{ valor_pix: number | string | null }>();

  if (error || !data) return null;
  return normalizarLimite(data.valor_pix);
}

// Salva SÓ o valor do PIX do empreendimento, SEM tocar os outros flags — mesmo cuidado do limite
// de crédito: linha existente vira UPDATE, inexistente vira INSERT com credenciamento_ativo=false
// explícito, e cada escrita CHECA o error.
export async function setEnterpriseValorPix(input: {
  adminClient: AdminClient;
  code?: string | null;
  enterpriseId: string;
  updatedBy?: string | null;
  valor: number | null;
}): Promise<{ error?: string; ok: boolean }> {
  const enterpriseId = (input.enterpriseId ?? "").trim();
  if (!enterpriseId) return { error: "Empreendimento invalido.", ok: false };

  const valor = normalizarLimite(input.valor);

  const { data: existente, error: erroLeitura } = await input.adminClient
    .from(TABLE)
    .select("enterprise_id")
    .eq("enterprise_id", enterpriseId)
    .maybeSingle<{ enterprise_id: string }>();

  if (erroLeitura) {
    if (tabelaAusente(erroLeitura)) {
      return { error: "Tabela de settings do empreendimento ainda nao existe.", ok: false };
    }
    return { error: `Nao foi possivel salvar: ${erroLeitura.message}`, ok: false };
  }

  const colunaAusente = (error: { message?: string } | null) =>
    /valor_pix/i.test(error?.message ?? "") && /column|does not exist/i.test(error?.message ?? "");

  if (existente) {
    const { error } = await input.adminClient
      .from(TABLE)
      .update({
        updated_at: new Date().toISOString(),
        updated_by: input.updatedBy ?? null,
        valor_pix: valor,
      })
      .eq("enterprise_id", enterpriseId);

    if (error) {
      if (colunaAusente(error)) {
        return { error: "Coluna do valor do PIX ainda nao existe (migration 0067 pendente).", ok: false };
      }
      return { error: `Nao foi possivel salvar: ${error.message}`, ok: false };
    }
    return { ok: true };
  }

  const { error } = await input.adminClient.from(TABLE).insert({
    code: input.code ?? null,
    credenciamento_ativo: false,
    enterprise_id: enterpriseId,
    updated_at: new Date().toISOString(),
    updated_by: input.updatedBy ?? null,
    valor_pix: valor,
  });

  if (error) {
    if (colunaAusente(error)) {
      return { error: "Coluna do valor do PIX ainda nao existe (migration 0067 pendente).", ok: false };
    }
    if (tabelaAusente(error)) {
      return { error: "Tabela de settings do empreendimento ainda nao existe.", ok: false };
    }
    return { error: `Nao foi possivel salvar: ${error.message}`, ok: false };
  }

  return { ok: true };
}

// Salva UM flag booleano de habilitação (Análise de Crédito ou Pré-venda) SEM tocar os demais
// campos — mesmo cuidado do limite/valor do PIX: linha existente vira UPDATE, inexistente vira
// INSERT com credenciamento_ativo=false explícito, e cada escrita CHECA o error. Não usa upsert
// (que dependeria do default do banco no INSERT e sobrescreveria flags no UPDATE).
async function setEnterpriseFlag(input: {
  adminClient: AdminClient;
  code?: string | null;
  coluna: "analise_credito_habilitada" | "prevenda_habilitada";
  enterpriseId: string;
  habilitada: boolean;
  updatedBy?: string | null;
}): Promise<{ error?: string; ok: boolean }> {
  const enterpriseId = (input.enterpriseId ?? "").trim();
  if (!enterpriseId) return { error: "Empreendimento invalido.", ok: false };

  const { data: existente, error: erroLeitura } = await input.adminClient
    .from(TABLE)
    .select("enterprise_id")
    .eq("enterprise_id", enterpriseId)
    .maybeSingle<{ enterprise_id: string }>();

  if (erroLeitura) {
    if (tabelaAusente(erroLeitura)) {
      return { error: "Tabela de settings do empreendimento ainda nao existe.", ok: false };
    }
    return { error: `Nao foi possivel salvar: ${erroLeitura.message}`, ok: false };
  }

  if (existente) {
    const { error } = await input.adminClient
      .from(TABLE)
      .update({
        [input.coluna]: input.habilitada,
        updated_at: new Date().toISOString(),
        updated_by: input.updatedBy ?? null,
      })
      .eq("enterprise_id", enterpriseId);

    if (error) return { error: `Nao foi possivel salvar: ${error.message}`, ok: false };
    return { ok: true };
  }

  const { error } = await input.adminClient.from(TABLE).insert({
    [input.coluna]: input.habilitada,
    code: input.code ?? null,
    // Default explícito: mexer numa habilitação de um empreendimento ainda sem settings não pode
    // ligar o credenciamento por acidente.
    credenciamento_ativo: false,
    enterprise_id: enterpriseId,
    updated_at: new Date().toISOString(),
    updated_by: input.updatedBy ?? null,
  });

  if (error) {
    if (tabelaAusente(error)) {
      return { error: "Tabela de settings do empreendimento ainda nao existe.", ok: false };
    }
    return { error: `Nao foi possivel salvar: ${error.message}`, ok: false };
  }

  return { ok: true };
}

// Liga/desliga a Análise de Crédito do empreendimento (não toca `credenciamento_ativo`).
export function setEnterpriseAnaliseCredito(input: {
  adminClient: AdminClient;
  code?: string | null;
  enterpriseId: string;
  habilitada: boolean;
  updatedBy?: string | null;
}): Promise<{ error?: string; ok: boolean }> {
  return setEnterpriseFlag({ ...input, coluna: "analise_credito_habilitada" });
}

// Liga/desliga a Pré-venda do empreendimento (não toca `credenciamento_ativo`).
export function setEnterprisePrevenda(input: {
  adminClient: AdminClient;
  code?: string | null;
  enterpriseId: string;
  habilitada: boolean;
  updatedBy?: string | null;
}): Promise<{ error?: string; ok: boolean }> {
  return setEnterpriseFlag({ ...input, coluna: "prevenda_habilitada" });
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

// Salva SÓ o limite de crédito do empreendimento, SEM tocar `credenciamento_ativo`.
//
// Não usa upsert: um upsert com onConflict que omitisse `credenciamento_ativo` dependeria do
// default do banco no caminho de INSERT, e sobrescreveria o flag no caminho de UPDATE. Aqui a
// linha existente vira UPDATE (só o limite muda) e a inexistente vira INSERT com o flag no
// default explícito (false) — empreendimento novo não nasce "na ativa". Cada escrita CHECA o
// `error` (lição de 21/jul: upsert em NOT NULL sem default falhava em silêncio).
export async function setEnterpriseLimiteCredito(input: {
  adminClient: AdminClient;
  code?: string | null;
  enterpriseId: string;
  limite: number | null;
  updatedBy?: string | null;
}): Promise<{ error?: string; ok: boolean }> {
  const enterpriseId = (input.enterpriseId ?? "").trim();
  if (!enterpriseId) return { error: "Empreendimento invalido.", ok: false };

  const limite = normalizarLimite(input.limite);

  const { data: existente, error: erroLeitura } = await input.adminClient
    .from(TABLE)
    .select("enterprise_id")
    .eq("enterprise_id", enterpriseId)
    .maybeSingle<{ enterprise_id: string }>();

  if (erroLeitura) {
    if (tabelaAusente(erroLeitura)) {
      return {
        error:
          "Tabela de settings do empreendimento ainda nao existe (migration 0052 pendente).",
        ok: false,
      };
    }
    return { error: `Nao foi possivel salvar: ${erroLeitura.message}`, ok: false };
  }

  if (existente) {
    const { error } = await input.adminClient
      .from(TABLE)
      .update({
        limite_credito: limite,
        updated_at: new Date().toISOString(),
        updated_by: input.updatedBy ?? null,
      })
      .eq("enterprise_id", enterpriseId);

    if (error) return { error: `Nao foi possivel salvar: ${error.message}`, ok: false };
    return { ok: true };
  }

  const { error } = await input.adminClient.from(TABLE).insert({
    code: input.code ?? null,
    // Default explícito: salvar o limite de um empreendimento ainda sem settings não pode
    // ligar o credenciamento por acidente.
    credenciamento_ativo: false,
    enterprise_id: enterpriseId,
    limite_credito: limite,
    updated_at: new Date().toISOString(),
    updated_by: input.updatedBy ?? null,
  });

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

// Limite de crédito do empreendimento (id do C2X). null = sem limite próprio (usar o padrão da
// aplicação). Nunca lança: qualquer falha vira null.
export async function getLimiteCredito(
  adminClient: AdminClient,
  enterpriseId: string,
): Promise<number | null> {
  const id = (enterpriseId ?? "").trim();
  if (!id) return null;

  const { data, error } = await adminClient
    .from(TABLE)
    .select("limite_credito")
    .eq("enterprise_id", id)
    .maybeSingle<{ limite_credito: number | string | null }>();

  if (error || !data) return null;
  return normalizarLimite(data.limite_credito);
}
