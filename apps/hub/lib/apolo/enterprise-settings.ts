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
  // Toggle do Comprovante de renda (default FALSE na migration 0095). Ligado ⇒ o envio da CAD
  // exige o comprovante de renda do cliente (um entre extrato bancário dos últimos 3 meses,
  // contracheque ou declaração de imposto de renda). Desligado ⇒ a CAD segue como hoje.
  comprovanteRendaHabilitado: boolean;
  // Master "Recebendo CAD": o empreendimento está na ativa, recebendo credenciamento. Desligado,
  // os blocos de Análise de Crédito, Pré-venda e Comprovante de renda ficam inertes.
  credenciamentoAtivo: boolean;
  // Limite em R$ das restrições do Serasa acima do qual o cliente é REPROVADO. null = padrão
  // da aplicação (R$ 1.000).
  limiteCredito: number | null;
  // Toggle da Pré-venda (default true na migration). Ligado ⇒ o valor do PIX é exigido; desligado
  // ⇒ a etapa de pré-venda é ignorada na esteira.
  prevendaHabilitada: boolean;
  // Portão público de CAD (default TRUE na migration 0110). O formulário público de CAD só oferece
  // o empreendimento se `credenciamento_ativo AND recepcao_cad`. Motivo: CAD e habilitação de
  // imobiliária acontecem em momentos diferentes (caso Recanto do Vale — habilita imobiliária
  // antes da convenção de vendas, CAD só depois).
  recepcaoCad: boolean;
  // Portão público de credenciamento de imobiliária (default TRUE na migration 0110). O formulário
  // público de imobiliária só oferece o empreendimento se `credenciamento_ativo AND
  // recepcao_imobiliaria`.
  recepcaoImobiliaria: boolean;
  // Valor em R$ do PIX de credenciamento (pré-venda) DESTE empreendimento. null = padrão da ação
  // (R$ 1.000). É o que permite, com vários empreendimentos ativos, gerar o PIX no valor certo.
  valorPix: number | null;
};

type SettingRow = {
  analise_credito_habilitada: boolean | null;
  code: string | null;
  comprovante_renda_habilitado: boolean | null;
  credenciamento_ativo: boolean | null;
  enterprise_id: string;
  limite_credito: number | string | null;
  prevenda_habilitada: boolean | null;
  recepcao_cad: boolean | null;
  recepcao_imobiliaria: boolean | null;
  valor_pix: number | string | null;
};

// Flag com DEFAULT true no banco: null/undefined (linha sem o valor, ou coluna recém-criada no
// caminho de fallback) conta como LIGADO, para bater com o default da migration.
function flagPadraoLigado(v: boolean | null | undefined): boolean {
  return v == null ? true : Boolean(v);
}

// Flag com DEFAULT false no banco (comprovante de renda, migration 0095): null/undefined conta
// como DESLIGADO. ⚠️ Não dá para reaproveitar `flagPadraoLigado` aqui: no caminho de fallback
// (coluna ainda inexistente) ele devolveria "ligado" e a CAD passaria a ser recusada por falta de
// um documento que ninguém configurou.
function flagPadraoDesligado(v: boolean | null | undefined): boolean {
  return v == null ? false : Boolean(v);
}

// numeric do Postgres pode voltar como número ou string; normaliza para número >= 0 ou null.
function normalizarLimite(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

// Percentual aceita vírgula (o operador digita 97,5) e preserva 3 casas, como a coluna.
function normalizarPercentual(v: null | number | string | undefined): null | number {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1000) / 1000;
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
      "enterprise_id, code, credenciamento_ativo, limite_credito, valor_pix, analise_credito_habilitada, prevenda_habilitada, comprovante_renda_habilitado, recepcao_cad, recepcao_imobiliaria",
    )
    .limit(2000);

  if (completa.error) {
    // Colunas novas (valor_pix, análise de crédito, pré-venda, comprovante de renda) podem não
    // existir em ambiente com migration pendente: refaz a leitura com o núcleo estável e assume os
    // defaults de cada coluna em vez de perder o resto das settings.
    const semColuna = await adminClient
      .from(TABLE)
      .select("enterprise_id, code, credenciamento_ativo, limite_credito")
      .limit(2000);
    if (semColuna.error || !semColuna.data) return {};
    data = semColuna.data.map((r) => ({
      ...(r as Omit<
        SettingRow,
        | "analise_credito_habilitada"
        | "comprovante_renda_habilitado"
        | "prevenda_habilitada"
        | "recepcao_cad"
        | "recepcao_imobiliaria"
        | "valor_pix"
      >),
      analise_credito_habilitada: null,
      comprovante_renda_habilitado: null,
      prevenda_habilitada: null,
      // Colunas da migration 0110 ausentes: null vira "ligado" (flagPadraoLigado), o mesmo
      // comportamento de hoje — o master sozinho decide.
      recepcao_cad: null,
      recepcao_imobiliaria: null,
      valor_pix: null,
    }));
  } else {
    data = (completa.data ?? []) as SettingRow[];
  }

  const out: Record<string, EnterpriseSetting> = {};
  for (const row of data) {
    out[row.enterprise_id] = {
      analiseCreditoHabilitada: flagPadraoLigado(row.analise_credito_habilitada),
      comprovanteRendaHabilitado: flagPadraoDesligado(row.comprovante_renda_habilitado),
      credenciamentoAtivo: Boolean(row.credenciamento_ativo),
      limiteCredito: normalizarLimite(row.limite_credito),
      prevendaHabilitada: flagPadraoLigado(row.prevenda_habilitada),
      recepcaoCad: flagPadraoLigado(row.recepcao_cad),
      recepcaoImobiliaria: flagPadraoLigado(row.recepcao_imobiliaria),
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
  coluna:
    | "analise_credito_habilitada"
    | "comprovante_renda_habilitado"
    | "prevenda_habilitada"
    | "recepcao_cad"
    | "recepcao_imobiliaria";
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

  // Coluna do flag ainda inexistente (migration da etapa pendente). Sem isto o operador leva um
  // erro cru do Postgres num toggle da tela e não tem como saber que falta aplicar a migration —
  // mesmo cuidado que `setEnterpriseValorPix` já tinha para o valor do PIX.
  const colunaAusente = (error: { message?: string } | null) =>
    new RegExp(input.coluna, "i").test(error?.message ?? "") &&
    /column|does not exist/i.test(error?.message ?? "");
  const MIGRATION_DA_COLUNA: Record<typeof input.coluna, string> = {
    analise_credito_habilitada: "0071",
    comprovante_renda_habilitado: "0095",
    prevenda_habilitada: "0071",
    recepcao_cad: "0110",
    recepcao_imobiliaria: "0110",
  };
  const erroColunaAusente = () => ({
    error: `Coluna desta etapa ainda nao existe (migration ${MIGRATION_DA_COLUNA[input.coluna]} pendente).`,
    ok: false as const,
  });

  if (existente) {
    const { error } = await input.adminClient
      .from(TABLE)
      .update({
        [input.coluna]: input.habilitada,
        updated_at: new Date().toISOString(),
        updated_by: input.updatedBy ?? null,
      })
      .eq("enterprise_id", enterpriseId);

    if (error) {
      if (colunaAusente(error)) return erroColunaAusente();
      return { error: `Nao foi possivel salvar: ${error.message}`, ok: false };
    }
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
    if (colunaAusente(error)) return erroColunaAusente();
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

// Liga/desliga a exigência do Comprovante de renda no envio da CAD (não toca
// `credenciamento_ativo`).
export function setEnterpriseComprovanteRenda(input: {
  adminClient: AdminClient;
  code?: string | null;
  enterpriseId: string;
  habilitada: boolean;
  updatedBy?: string | null;
}): Promise<{ error?: string; ok: boolean }> {
  return setEnterpriseFlag({ ...input, coluna: "comprovante_renda_habilitado" });
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

// Liga/desliga a Recepção de CAD do empreendimento (não toca `credenciamento_ativo`). Desligada,
// o formulário PÚBLICO de CAD deixa de oferecer o empreendimento — o interno segue normal.
export function setEnterpriseRecepcaoCad(input: {
  adminClient: AdminClient;
  code?: string | null;
  enterpriseId: string;
  habilitada: boolean;
  updatedBy?: string | null;
}): Promise<{ error?: string; ok: boolean }> {
  return setEnterpriseFlag({ ...input, coluna: "recepcao_cad" });
}

// Liga/desliga a Recepção de imobiliária do empreendimento (não toca `credenciamento_ativo`).
// Desligada, o formulário PÚBLICO de credenciamento de imobiliária deixa de oferecer (e de
// aceitar) o empreendimento — o interno segue normal.
export function setEnterpriseRecepcaoImobiliaria(input: {
  adminClient: AdminClient;
  code?: string | null;
  enterpriseId: string;
  habilitada: boolean;
  updatedBy?: string | null;
}): Promise<{ error?: string; ok: boolean }> {
  return setEnterpriseFlag({ ...input, coluna: "recepcao_imobiliaria" });
}

/**
 * O empreendimento (id do C2X) exige COMPROVANTE DE RENDA no envio da CAD?
 *
 * É a leitura que as DUAS rotas de salvar consultam antes de validar os documentos obrigatórios —
 * a trava de servidor da etapa. Uma linha, uma coluna, sem depender de `listEnterpriseSettings`
 * (que carrega 2000 linhas e não faz sentido no caminho de envio da CAD).
 *
 * ⚠️ FALHA DE LEITURA = NÃO EXIGE, de propósito. Os três motivos de a leitura não responder são
 * "empreendimento nunca configurado", "migration 0095 ainda não aplicada" e "Supabase oscilando";
 * nos três a resposta honesta é "não sei", e transformar "não sei" em "exijo" derrubaria TODA CAD
 * de TODO empreendimento por causa de uma coluna ou de um soluço de rede. O default da coluna é
 * false justamente para que ausência e desligado signifiquem a mesma coisa.
 */
export async function exigeComprovanteRenda(
  adminClient: AdminClient,
  enterpriseId: null | string | undefined,
): Promise<boolean> {
  const id = (enterpriseId ?? "").trim();
  if (!id) return false;

  const { data, error } = await adminClient
    .from(TABLE)
    .select("comprovante_renda_habilitado")
    .eq("enterprise_id", id)
    .maybeSingle<{ comprovante_renda_habilitado: boolean | null }>();

  if (error || !data) return false;
  return flagPadraoDesligado(data.comprovante_renda_habilitado);
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

export type PortaoRecepcao = "cad" | "imobiliaria";

const COLUNA_DO_PORTAO: Record<PortaoRecepcao, "recepcao_cad" | "recepcao_imobiliaria"> = {
  cad: "recepcao_cad",
  imobiliaria: "recepcao_imobiliaria",
};

/**
 * Ids dos empreendimentos com o PORTÃO PÚBLICO aberto: master `credenciamento_ativo` ligado E o
 * flag de recepção do canal (CAD ou imobiliária) ligado.
 *
 * Motivo (Lucas, 26/08): CAD e habilitação de imobiliária acontecem em momentos diferentes —
 * o Recanto do Vale habilita imobiliárias antes da convenção de vendas, mas só recebe CAD depois.
 *
 * ⚠️ FALLBACK DE COLUNA AUSENTE: se as colunas da migration 0110 ainda não existem no banco, a
 * leitura refaz SÓ com o master (`listEnterprisesAtivos`) — comporta-se exatamente como hoje.
 * Migration pendente NUNCA pode quebrar o formulário público (mesmo padrão do arquivo inteiro).
 * E linha antiga com o valor null conta como LIGADO (`flagPadraoLigado`), batendo com o
 * DEFAULT true da migration.
 *
 * ⚠️ Mas o fallback é SÓ para coluna/tabela ausente (migration pendente), NUNCA para erro
 * genérico: com a 0110 já aplicada, um erro qualquer que atingisse só esta leitura (policy
 * negando a coluna, regressão futura no select) não pode REABRIR o portão por baixo dos panos —
 * portão de negócio falha FECHADO ([] — o mesmo que `listEnterprisesAtivos` devolve em erro).
 */
// Coluna da 0110 ausente: 42703 do Postgres ou PGRST204 do schema cache do PostgREST — e, por
// garantia, mensagem citando a coluna nova (mesmo padrão do `colunaAusente` dos setters).
function colunaRecepcaoAusente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  const msg = error.message ?? "";
  return /recepcao_(cad|imobiliaria)/i.test(msg) && /column|does not exist|schema cache/i.test(msg);
}

export async function listEnterprisesRecebendo(
  adminClient: AdminClient,
  portao: PortaoRecepcao,
): Promise<string[]> {
  const coluna = COLUNA_DO_PORTAO[portao];

  const { data, error } = await adminClient
    .from(TABLE)
    .select(`enterprise_id, ${coluna}`)
    .eq("credenciamento_ativo", true)
    .limit(2000);

  if (error) {
    // Migration pendente (coluna 0110 ou a própria tabela 0052 ausente): refaz com o núcleo
    // estável, que é o comportamento de antes desta feature.
    if (colunaRecepcaoAusente(error) || tabelaAusente(error)) {
      return listEnterprisesAtivos(adminClient);
    }
    // Qualquer outro erro: falha FECHADO, sem reabrir o portão.
    return [];
  }
  if (!data) return [];

  return (data as unknown as ({ enterprise_id: string } & Record<string, boolean | null>)[])
    .filter((row) => flagPadraoLigado(row[coluna]))
    .map((row) => row.enterprise_id);
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
/**
 * A % de gestão de carteira do empreendimento: quanto das parcelas do financiamento fica com o
 * INCORPORADOR.
 *
 * ⚠️ NULO NÃO É "FALTA CADASTRAR", É "NÃO FAZEMOS A GESTÃO". Decisão do Lucas (17/08/2026): "irei
 * atualizar todas no Apolo; o que não tiver cadastrado é porque não fazemos a gestão de carteira
 * desse empreendimento". Por isso o zero e o nulo são coisas diferentes aqui, e apagar o campo é
 * uma ação com significado: some a carteira daquele empreendimento no portal do incorporador.
 *
 * É o único campo da política comercial que nasce no Apolo — o resto (comissão, entrada, parcelas
 * do sinal) continua vindo do C2X, que tem prioridade no financeiro.
 *
 * Percentual de 0 a 100, do jeito que o Lucas fala e que a tela do C2X mostra: 97 no Recanto,
 * 97,5 no Vista Alegre, 96 na Lavra do Ouro.
 */
export async function setEnterpriseGestaoCarteira(input: {
  adminClient: AdminClient;
  code?: null | string;
  enterpriseId: string;
  percentual: null | number;
  updatedBy?: null | string;
}): Promise<{ error?: string; ok: boolean }> {
  const enterpriseId = (input.enterpriseId ?? "").trim();
  if (!enterpriseId) return { error: "Empreendimento invalido.", ok: false };

  const percentual = normalizarPercentual(input.percentual);

  // Fora de 0..100 é digitação errada (98,5 e 985 são fáceis de confundir num campo). Barra aqui
  // com mensagem em vez de deixar o CHECK do banco devolver erro cru.
  if (percentual !== null && (percentual < 0 || percentual > 100)) {
    return { error: "A gestao de carteira precisa estar entre 0 e 100%.", ok: false };
  }

  const { data: existente, error: erroLeitura } = await input.adminClient
    .from(TABLE)
    .select("enterprise_id")
    .eq("enterprise_id", enterpriseId)
    .maybeSingle<{ enterprise_id: string }>();

  if (erroLeitura && !tabelaAusente(erroLeitura)) {
    return { error: `Nao foi possivel salvar: ${erroLeitura.message}`, ok: false };
  }

  if (existente) {
    const { error } = await input.adminClient
      .from(TABLE)
      .update({
        gestao_carteira_percentual: percentual,
        updated_at: new Date().toISOString(),
        updated_by: input.updatedBy ?? null,
      })
      .eq("enterprise_id", enterpriseId);

    if (error) return { error: `Nao foi possivel salvar: ${error.message}`, ok: false };
    return { ok: true };
  }

  const { error } = await input.adminClient.from(TABLE).insert({
    code: input.code ?? null,
    // Mesmo cuidado do limite de crédito: cadastrar a gestão de carteira de um empreendimento sem
    // settings NÃO pode ligar o credenciamento por acidente.
    credenciamento_ativo: false,
    enterprise_id: enterpriseId,
    gestao_carteira_percentual: percentual,
    updated_at: new Date().toISOString(),
    updated_by: input.updatedBy ?? null,
  });

  if (error) return { error: `Nao foi possivel salvar: ${error.message}`, ok: false };
  return { ok: true };
}

/**
 * A % MÍNIMA DE ENTRADA do empreendimento.
 *
 * Lucas (03/09/2026): *"vamos ter um campo dentro da parte que vamos cadastrar a política comercial
 * e lá vamos apontar a % mínima"*.
 *
 * ⚠️ É O GÊMEO DE `setEnterpriseGestaoCarteira`, de propósito: mesma tabela, mesma chave, mesma
 * tela e o mesmo significado para `null` — "não cadastrado", e não zero. Quem lê aplica o padrão da
 * casa (10%) quando vem nulo; gravar 0 é uma decisão diferente e legítima (empreendimento que
 * aceita venda sem entrada), e as duas precisam continuar distinguíveis.
 */
export async function setEnterpriseEntradaMinima(input: {
  adminClient: AdminClient;
  code?: null | string;
  enterpriseId: string;
  percentual: null | number;
  updatedBy?: null | string;
}): Promise<{ error?: string; ok: boolean }> {
  const enterpriseId = (input.enterpriseId ?? "").trim();
  if (!enterpriseId) return { error: "Empreendimento invalido.", ok: false };

  const percentual = normalizarPercentual(input.percentual);

  if (percentual !== null && (percentual < 0 || percentual > 100)) {
    return { error: "A entrada minima precisa estar entre 0 e 100%.", ok: false };
  }

  const { data: existente, error: erroLeitura } = await input.adminClient
    .from(TABLE)
    .select("enterprise_id")
    .eq("enterprise_id", enterpriseId)
    .maybeSingle<{ enterprise_id: string }>();

  if (erroLeitura && !tabelaAusente(erroLeitura)) {
    return { error: `Nao foi possivel salvar: ${erroLeitura.message}`, ok: false };
  }

  if (existente) {
    const { error } = await input.adminClient
      .from(TABLE)
      .update({
        entrada_minima_percentual: percentual,
        updated_at: new Date().toISOString(),
        updated_by: input.updatedBy ?? null,
      })
      .eq("enterprise_id", enterpriseId);

    if (error) return { error: `Nao foi possivel salvar: ${error.message}`, ok: false };
    return { ok: true };
  }

  const { error } = await input.adminClient.from(TABLE).insert({
    code: input.code ?? null,
    // Mesmo cuidado das irmãs: cadastrar a entrada mínima de um empreendimento sem settings NÃO
    // pode ligar o credenciamento por acidente.
    credenciamento_ativo: false,
    enterprise_id: enterpriseId,
    entrada_minima_percentual: percentual,
    updated_at: new Date().toISOString(),
    updated_by: input.updatedBy ?? null,
  });

  if (error) return { error: `Nao foi possivel salvar: ${error.message}`, ok: false };
  return { ok: true };
}

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
