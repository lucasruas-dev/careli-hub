// Credenciamento de imobiliárias: a triagem que roda ANTES do cadastro completo.
//
// Regra de negócio (Lucas 18/jul): a imobiliária quer trabalhar um empreendimento da nossa
// gestão. O portal oferece SOMENTE os empreendimentos "na ativa" (apolo_enterprise_settings).
// Se ela já é cadastrada, mostramos os que ela AINDA NÃO trabalha, pra pedir habilitação;
// se não achamos o CNPJ, abre o cadastro de imobiliária completo.
//
// ⚠️ O C2X NÃO tem vínculo imobiliária↔empreendimento (Lucas): a única ligação real são as
// VENDAS (users.vinculed_by_id -> acquisition_requests -> enterprises), o mesmo caminho da
// carteira por papel. O credenciamento é justamente o que passa a registrar esse vínculo
// EXPLICITAMENTE no Apolo (apolo_relationships tipo 'empreendimento').
// Ver [[project_apolo_cadastro_imobiliaria]].
import type { RowDataPacket } from "mysql2";

import { loadApoloEnterprises } from "@/lib/apolo/empreendimentos";
import { listEnterpriseLogos } from "@/lib/apolo/enterprise-logos";
import { listEnterprisesAtivos } from "@/lib/apolo/enterprise-settings";
import { hashIdentifier } from "@/lib/apolo/server";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import { EXCLUDED_ENTERPRISE_CODES } from "@/lib/guardian/c2x-analytics";
import { getHadesDbPool } from "@/lib/guardian/db";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type CredenciamentoEmpreendimento = {
  code: string;
  id: string;
  logoUrl: string | null;
  name: string;
};

export type ConsultaImobiliaria = {
  encontrada: boolean;
  entityId: string | null;
  // Ids de empreendimento que ela JÁ trabalha (vendas no C2X ∪ credenciamentos no Apolo).
  jaTrabalha: string[];
  nome: string | null;
};

function onlyDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

// Empreendimentos "na ativa", com a logo que o operador subiu. O nome/sigla vem do C2X; se o
// legado estiver fora do ar, o empreendimento ainda aparece (com a sigla salva no settings).
export async function listEmpreendimentosAtivos(
  adminClient: AdminClient,
): Promise<CredenciamentoEmpreendimento[]> {
  const [ativos, logos] = await Promise.all([
    listEnterprisesAtivos(adminClient),
    listEnterpriseLogos(adminClient),
  ]);
  if (!ativos.length) return [];

  const { data: settingsRows } = await adminClient
    .from("apolo_enterprise_settings")
    .select("enterprise_id, code")
    .in("enterprise_id", ativos);
  const codeById = new Map(
    ((settingsRows ?? []) as { code: string | null; enterprise_id: string }[]).map((row) => [
      row.enterprise_id,
      row.code ?? "",
    ]),
  );

  const c2x = await loadApoloEnterprises();
  const rowById = new Map(
    (c2x.ok ? c2x.data.rows : []).map((row) => [row.id, row]),
  );

  return ativos
    .map((id) => {
      const row = rowById.get(id);
      const code = row?.code ?? codeById.get(id) ?? "";
      return {
        code,
        id,
        logoUrl: logos[id] ?? null,
        name: row?.name ?? code ?? "Empreendimento",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// Procura a imobiliária pelo CNPJ no read-model do Apolo e descobre onde ela já atua.
export async function consultarImobiliariaPorCnpj(
  adminClient: AdminClient,
  cnpj: string,
): Promise<ConsultaImobiliaria> {
  const vazio: ConsultaImobiliaria = {
    encontrada: false,
    entityId: null,
    jaTrabalha: [],
    nome: null,
  };

  const digits = onlyDigits(cnpj);
  if (digits.length !== 14) return vazio;

  const hash = hashIdentifier("cnpj", digits);

  // ⚠️ PROCURA EM DOIS LUGARES, e a ordem importa.
  //
  // `apolo_entities.document_hash` só é preenchido por quem NASCE no Apolo (o wizard). As 412
  // imobiliárias que vieram do sync do C2X têm esse campo NULO: o CNPJ delas mora em
  // `apolo_entity_identifiers.value_hash`. Medido em 20/jul: 0 de 412 com document_hash, 395 com
  // identificador de CNPJ.
  //
  // Buscar só por document_hash reprovava TODA imobiliária real. Foi o que aconteceu no primeiro
  // teste do Lucas: ele digitou o CNPJ da RAIANE IMOBILIARIA, que está cadastrada e tem CAD
  // nossa, e o portal respondeu "não credenciada".
  const { data: porIdentificador, error: erroIdent } = await adminClient
    .from("apolo_entity_identifiers")
    .select("entity_id")
    .eq("identifier_type", "cnpj")
    .eq("value_hash", hash)
    .limit(1)
    .maybeSingle<{ entity_id: string }>();

  // Erro de leitura não pode virar "não credenciada": isso barraria um parceiro legítimo por
  // falha nossa. Melhor devolver vazio e deixar o chamador tratar como indisponibilidade.
  if (erroIdent && erroIdent.code !== "PGRST116") return vazio;

  let entityId = porIdentificador?.entity_id ?? null;

  if (!entityId) {
    const { data: porDocumento } = await adminClient
      .from("apolo_entities")
      .select("id")
      .eq("document_hash", hash)
      .maybeSingle<{ id: string }>();
    entityId = porDocumento?.id ?? null;
  }

  if (!entityId) return vazio;

  const { data: entity } = await adminClient
    .from("apolo_entities")
    .select("id, display_name, legal_name")
    .eq("id", entityId)
    .maybeSingle<{ display_name: string | null; id: string; legal_name: string | null }>();

  if (!entity?.id) return vazio;

  const [porVendas, porCredenciamento] = await Promise.all([
    empreendimentosPorVendas(adminClient, entity.id),
    empreendimentosPorCredenciamento(adminClient, entity.id),
  ]);

  return {
    encontrada: true,
    entityId: entity.id,
    jaTrabalha: Array.from(new Set([...porVendas, ...porCredenciamento])),
    nome: entity.legal_name || entity.display_name,
  };
}

// Vínculos JÁ registrados no Apolo (o que o próprio credenciamento grava).
async function empreendimentosPorCredenciamento(
  adminClient: AdminClient,
  entityId: string,
): Promise<string[]> {
  const { data } = await adminClient
    .from("apolo_relationships")
    .select("metadata")
    .eq("entity_id", entityId)
    .eq("relationship_type", "empreendimento")
    .limit(500);

  return ((data ?? []) as { metadata: { enterpriseId?: string } | null }[])
    .map((row) => row.metadata?.enterpriseId)
    .filter((id): id is string => Boolean(id));
}

// Onde ela JÁ VENDEU (única ligação real no C2X). Mesmo caminho da carteira por papel.
async function empreendimentosPorVendas(
  adminClient: AdminClient,
  entityId: string,
): Promise<string[]> {
  const c2xId = await c2xIdDaEntidade(adminClient, entityId);
  if (!c2xId) return [];

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) return [];

  const placeholders = EXCLUDED_ENTERPRISE_CODES.map(() => "?").join(", ");
  try {
    const [rows] = await poolResult.pool.query<(RowDataPacket & { id: number })[]>(
      `select distinct e.id
         from acquisition_requests ar
         join enterprise_unities eu on eu.id = ar.enterprise_unity_id
         join enterprises e on e.id = eu.enterprise_id
        where ar.client_id in (select id from users where vinculed_by_id = ?)
          and e.code not in (${placeholders})`,
      [c2xId, ...EXCLUDED_ENTERPRISE_CODES],
    );
    return rows.map((row) => String(row.id));
  } catch {
    // C2X fora do ar: devolve só o que o Apolo sabe (não trava a triagem).
    return [];
  }
}

// O id do usuário no C2X, guardado no source_link da entidade.
async function c2xIdDaEntidade(
  adminClient: AdminClient,
  entityId: string,
): Promise<number | null> {
  const { data } = await adminClient
    .from("apolo_source_links")
    .select("source_id, source_table")
    .eq("entity_id", entityId)
    .eq("source_system", "c2x")
    .limit(20);

  for (const row of (data ?? []) as { source_id: string; source_table: string }[]) {
    if (row.source_table === "users") {
      const id = Number(onlyDigits(row.source_id));
      if (Number.isInteger(id) && id > 0) return id;
    }
  }
  return null;
}
