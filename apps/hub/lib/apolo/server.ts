import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { RowDataPacket } from "mysql2";

import { getHadesDbPool, sanitizeHadesDbError } from "@/lib/guardian/db";
import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

import {
  apoloProfileCardOrder,
  apoloProfileLabels,
} from "./catalog";
import type {
  ApoloAddress,
  ApoloAuditSignal,
  ApoloCommercialLink,
  ApoloContactPoint,
  ApoloDashboardData,
  ApoloDocumentSignal,
  ApoloEntity,
  ApoloEntityKind,
  ApoloEntityStatus,
  ApoloFinancialSnapshot,
  ApoloInstallment,
  ApoloProfile,
  ApoloProfileSummary,
  ApoloRelationship,
  ApoloServiceSignal,
  ApoloTimelineEvent,
} from "./types";

type ApoloSupabaseClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

type ApoloLoadResult =
  | { data: ApoloDashboardData; ok: true }
  | { message: string; ok: false; reason: "empty" | "missing_config" | "missing_tables" | "unavailable" };

type ApoloDashboardOptions = {
  limit?: number;
  profile?: ApoloProfile | null;
  query?: string | null;
};

type C2xUsersQueryOptions = {
  limit?: number | null;
  profile?: ApoloProfile | null;
};

type ApoloEntityRow = {
  created_at: string | null;
  document_masked: string | null;
  entity_kind: string;
  display_name: string;
  id: string;
  legal_name: string | null;
  next_action: string | null;
  primary_city: string | null;
  primary_state: string | null;
  quality_score: number | null;
  status: string | null;
  trade_name: string | null;
  updated_at: string | null;
};

type ApoloProfileRow = {
  entity_id: string;
  profile: string;
};

type ApoloContactRow = {
  contact_type: string;
  entity_id: string;
  is_primary: boolean | null;
  label: string | null;
  status: string | null;
  value: string;
};

type ApoloAddressRow = {
  city: string | null;
  complement: string | null;
  district: string | null;
  entity_id: string;
  label: string | null;
  number: string | null;
  postal_code: string | null;
  state: string | null;
  status: string | null;
  street: string | null;
};

type ApoloRelationshipRow = {
  entity_id: string;
  label: string | null;
  relationship_type: string;
  status: string | null;
};

type ApoloCommercialLinkRow = {
  entity_id: string;
  enterprise_name: string | null;
  metadata: Record<string, unknown> | null;
  reference_label: string | null;
  relationship_role: string | null;
  stage_label: string | null;
  unit_label: string | null;
};

type ApoloFinancialRow = {
  entity_id: string;
  overdue_amount: number | string | null;
  overdue_installments: number | null;
  paid_amount: number | string | null;
  payment_behavior: string | null;
  risk_level: string | null;
  total_portfolio_amount: number | string | null;
};

type ApoloServiceRow = {
  channel: string;
  entity_id: string;
  last_event: string | null;
  protocol: string | null;
  status: string | null;
};

type ApoloDocumentRow = {
  entity_id: string;
  label: string;
  status: string | null;
  updated_at: string | null;
};

type ApoloTimelineRow = {
  description: string | null;
  entity_id: string;
  occurred_at: string | null;
  status: string | null;
  title: string;
};

type ApoloAuditRow = {
  created_at: string | null;
  entity_id: string | null;
  field_name: string | null;
  status: string | null;
};

type ApoloSourceLinkRow = {
  entity_id: string;
  source_id: string | null;
  source_system: string | null;
  source_table: string | null;
};

type ApoloSearchEntryRow = {
  entity_id: string;
};

type C2xProfileAggregateRow = RowDataPacket & {
  profile_id: number | null;
  profile_name: string;
  total: number | string;
  with_vinculed_by: number | string;
};

type C2xTableCountsRow = RowDataPacket & {
  acquisition_requests_total: number | string;
  enterprise_units_total: number | string;
  enterprises_total: number | string;
  users_total: number | string;
};

type C2xCrmAggregateRow = RowDataPacket & {
  buyer_users_total: number | string | null;
  portfolio_payments_total: number | string | null;
  portfolio_units_total: number | string | null;
  usuario_total: number | string | null;
};

type C2xUserRow = RowDataPacket & {
  billed_request_count: number | string | null;
  cellphone: string | null;
  cnpj: string | null;
  cpf: string | null;
  display_name: string | null;
  email: string | null;
  fantasy_name: string | null;
  id: number;
  latest_enterprise_name: string | null;
  latest_paid_area: number | string | null;
  latest_paid_contract_document_id: string | null;
  latest_paid_contract_status: string | null;
  latest_paid_contract_url: string | null;
  latest_paid_enterprise_code: string | null;
  latest_paid_enterprise_name: string | null;
  latest_paid_request_id: number | string | null;
  latest_paid_request_code: string | null;
  latest_paid_stage_name: string | null;
  latest_paid_unit_block: string | null;
  latest_paid_unit_code: string | null;
  latest_paid_unit_id: number | string | null;
  latest_paid_unit_label: string | null;
  latest_paid_unit_lot: string | null;
  latest_paid_unit_price: number | string | null;
  latest_request_code: string | null;
  latest_stage_name: string | null;
  latest_unit_label: string | null;
  linked_party_name: string | null;
  location_label: string | null;
  overdue_amount: number | string | null;
  overdue_installments: number | string | null;
  paid_amount: number | string | null;
  person_type_id: number | null;
  person_type_name: string | null;
  phone: string | null;
  payment_count: number | string | null;
  profile_id: number | null;
  profile_name: string | null;
  request_count: number | string | null;
  social_name: string | null;
  user_name: string | null;
  total_portfolio_amount: number | string | null;
  unit_count: number | string | null;
  updated_at: Date | string | null;
  vinculed_by_id: number | null;
};

type C2xDocumentLookupRow = RowDataPacket & {
  cnpj: string | null;
  cpf: string | null;
  id: number;
};

type C2xPortfolioRow = RowDataPacket & {
  acquisition_request_code: string | null;
  acquisition_request_id: number | string;
  area: number | string | null;
  block: string | null;
  broker_agency: string | null;
  enterprise_code: string | null;
  enterprise_name: string | null;
  lot: string | null;
  max_overdue_days: number | string | null;
  overdue_amount: number | string | null;
  overdue_payments: number | string;
  paid_amount: number | string | null;
  pending_payments: number | string;
  signed_contract_document_id: string | null;
  signed_contract_status: string | null;
  signed_contract_url: string | null;
  stage_name: string | null;
  total_payments: number | string;
  total_portfolio_amount: number | string | null;
  unit_price: number | string | null;
  unity_id: number | string | null;
  unity_name: string | null;
  user_id: number | string;
};

type C2xPortfolioInstallmentRow = RowDataPacket & {
  acquisition_request_id: number | string;
  asaas_payment_id: string | null;
  current_signal_parcel: number | string | null;
  current_total_parcel: number | string | null;
  due_date: Date | string | null;
  due_date_value: string | null;
  id: number | string;
  initial_value: number | string | null;
  interest_value: number | string | null;
  invoice_url: string | null;
  mulct_value: number | string | null;
  paid_value: number | string | null;
  parcel_type_id: number | string | null;
  parcel_type_name: string | null;
  payment_date_value: string | null;
  payment_status_id: number | string | null;
  payment_url: string | null;
  total_parcels: number | string | null;
  total_signal_parcels: number | string | null;
};

type C2xPortfolioHydration = {
  commercialLinks: ApoloCommercialLink[];
  financial: ApoloFinancialSnapshot;
};

type SyncResult =
  | {
      ok: true;
      rowsWritten: number;
      syncRunId: string;
    }
  | {
      error: string;
      ok: false;
    };

const SYNC_BATCH_SIZE = 500;
const DEFAULT_CRM_LIMIT = 20;
const LIVE_C2X_DEFAULT_ENTITY_LIMIT = 150;
const LIVE_C2X_MAX_ENTITY_LIMIT = 500;
const C2X_ACTIVE_PAYMENT_WHERE =
  "(p.payment_to_delete is null or p.payment_to_delete = 0)";
const C2X_PORTFOLIO_STAGE_WHERE =
  "ar.acquisition_request_stage_id in (1, 2, 3, 4, 5, 6, 9)";
const C2X_OUTSTANDING_PAYMENT_EXPRESSION = `
  coalesce(
    nullif(p.paid_value, 0),
    coalesce(p.initial_value, 0)
      + coalesce(p.interest_value, 0)
      + coalesce(p.mulct_value, 0),
    0
  )
`;
const C2X_ENTERPRISE_DISPLAY_EXPRESSION = `
  case
    when upper(trim(e.code)) = 'REP' then 'Recanto do Para'
    when upper(trim(e.code)) = 'EDL' then 'Estancia do Lago'
    when upper(trim(e.code)) in ('LOU', 'LOS') then 'Lavra do Ouro'
    when upper(trim(e.code)) in ('PDV', 'PVS') then 'Portal dos Vales'
    when upper(trim(e.code)) in ('RDP', 'RPS', 'RPC') then 'Rio de Pedras'
    when upper(trim(e.code)) in ('LBR', 'LBP', 'LBF') then concat('Lagoa Bonita - ', upper(trim(e.code)))
    when upper(trim(e.code)) = 'MDS' then 'Morada da Serra'
    when upper(trim(e.code)) = 'MLN' then 'Milenium'
    when upper(trim(e.code)) = 'VDO' then 'Veredas do Ouro'
    when upper(trim(e.code)) = 'VAL' then 'Vista Alegre'
    when upper(trim(e.code)) = 'VDP' then 'Vistas da Praia'
    else trim(coalesce(nullif(e.divulgation_name, ''), nullif(e.name, ''), concat('Empreendimento ', e.id)))
  end
`;
const C2X_VALID_ENTERPRISE_WHERE = `
  e.id is not null
  and upper(trim(coalesce(e.code, ''))) in (
    'REP', 'EDL', 'LOU', 'LOS', 'PDV', 'PVS', 'RDP', 'RPS', 'RPC',
    'LBR', 'LBP', 'LBF', 'MDS', 'MLN', 'VDO', 'VAL', 'VDP'
  )
`;

export async function loadApoloDashboard(
  options: ApoloDashboardOptions = {},
  client?: ApoloSupabaseClient,
): Promise<ApoloDashboardData> {
  const apoloResult = await loadApoloTablesDashboard(options, client);

  if (apoloResult.ok) {
    return apoloResult.data;
  }

  if (shouldAllowLiveC2xFallback()) {
    const liveResult = await loadLiveC2xDashboard(apoloResult, options);

    if (liveResult.ok) {
      return liveResult.data;
    }

    return emptyApoloDashboard(
      liveResult.message,
      "unavailable",
      "configuration_pending",
    );
  }

  return emptyApoloDashboard(
    apoloResult.message,
    "unavailable",
    apoloResult.reason === "empty" ? "sync_pending" : "configuration_pending",
  );
}

function shouldAllowLiveC2xFallback() {
  return process.env.NODE_ENV === "development";
}

export async function syncApoloFromC2x(): Promise<SyncResult> {
  const adminClient = createApoloAdminClient();

  if (!adminClient) {
    return {
      error: "Configuracao server-side do Supabase ausente.",
      ok: false,
    };
  }

  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return {
      error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`,
      ok: false,
    };
  }

  const syncRun = await startApoloSyncRun(adminClient);

  if (!syncRun.ok) {
    return syncRun;
  }

  try {
    const [users] = await poolResult.pool.query<C2xUserRow[]>(c2xUsersQuery());
    const now = new Date().toISOString();
    let rowsWritten = 0;

    for (let index = 0; index < users.length; index += SYNC_BATCH_SIZE) {
      const batch = users.slice(index, index + SYNC_BATCH_SIZE);
      rowsWritten += await persistApoloEntityBatch(adminClient, batch, syncRun.syncRunId, now);
    }

    const { error: finishError } = await adminClient
      .from("apolo_sync_runs")
      .update({
        finished_at: now,
        scanned_count: users.length,
        status: "completed",
        upserted_count: rowsWritten,
        updated_at: now,
      })
      .eq("id", syncRun.syncRunId);

    if (finishError) {
      throw finishError;
    }

    return {
      ok: true,
      rowsWritten,
      syncRunId: syncRun.syncRunId,
    };
  } catch (error) {
    const message = apoloSafeErrorMessage(error);

    await adminClient
      .from("apolo_sync_runs")
      .update({
        error_message: message,
        finished_at: new Date().toISOString(),
        status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", syncRun.syncRunId);

    return {
      error: message,
      ok: false,
    };
  }
}

export function createApoloAdminClient() {
  const { serviceRoleKey, url } = getServerSupabaseConfig();

  if (!url || !serviceRoleKey || isSupabaseSecretKey(serviceRoleKey)) {
    return null;
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function createApoloUserClient(accessToken: string) {
  const { anonKey, url } = getServerSupabaseConfig();

  if (!url || !anonKey || !accessToken) {
    return null;
  }

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

async function loadApoloTablesDashboard(
  options: ApoloDashboardOptions,
  client?: ApoloSupabaseClient,
): Promise<ApoloLoadResult> {
  const adminClient = client ?? createApoloAdminClient();

  if (!adminClient) {
    return {
      message: "Configuracao server-side do Supabase ausente.",
      ok: false,
      reason: "missing_config",
    };
  }

  const entityResult = await fetchApoloEntityRows(adminClient, options);

  if (!entityResult.ok) {
    return {
      message:
        entityResult.code === "PGRST205"
          ? "Tabelas Apolo ainda nao aplicadas."
          : entityResult.message,
      ok: false,
      reason: entityResult.code === "PGRST205" ? "missing_tables" : "unavailable",
    };
  }

  const entityRows = entityResult.rows;

  if (!entityRows?.length) {
    return {
      message: "Tabelas Apolo ainda sem registros sincronizados.",
      ok: false,
      reason: "empty",
    };
  }

  const entityIds = entityRows.map((entity) => entity.id);
  const [
    profiles,
    contacts,
    addresses,
    relationships,
    commercialLinks,
    financialSnapshots,
    serviceSignals,
    documents,
    timelineEvents,
    auditEvents,
    sourceLinks,
    profileSummaries,
    pendingReviewCount,
    linkedUsersCount,
    buyerUsersCount,
    portfolioUnitsCount,
  ] = await Promise.all([
    fetchRows<ApoloProfileRow>(adminClient, "apolo_entity_profiles", "entity_id,profile", entityIds),
    fetchRows<ApoloContactRow>(
      adminClient,
      "apolo_contacts",
      "entity_id,contact_type,label,value,status,is_primary",
      entityIds,
    ),
    fetchRows<ApoloAddressRow>(
      adminClient,
      "apolo_addresses",
      "entity_id,label,postal_code,street,number,complement,district,city,state,status",
      entityIds,
    ),
    fetchRows<ApoloRelationshipRow>(
      adminClient,
      "apolo_relationships",
      "entity_id,relationship_type,label,status",
      entityIds,
    ),
    fetchRows<ApoloCommercialLinkRow>(
      adminClient,
      "apolo_commercial_links",
      "entity_id,enterprise_name,unit_label,relationship_role,stage_label,reference_label,metadata",
      entityIds,
    ),
    fetchRows<ApoloFinancialRow>(
      adminClient,
      "apolo_financial_snapshots",
      "entity_id,total_portfolio_amount,paid_amount,overdue_amount,overdue_installments,risk_level,payment_behavior",
      entityIds,
    ),
    fetchRows<ApoloServiceRow>(
      adminClient,
      "apolo_service_signals",
      "entity_id,channel,protocol,status,last_event",
      entityIds,
    ),
    fetchRows<ApoloDocumentRow>(
      adminClient,
      "apolo_documents",
      "entity_id,label,status,updated_at",
      entityIds,
    ),
    fetchRows<ApoloTimelineRow>(
      adminClient,
      "apolo_timeline_events",
      "entity_id,title,description,status,occurred_at",
      entityIds,
    ),
    fetchRows<ApoloAuditRow>(
      adminClient,
      "apolo_audit_events",
      "entity_id,field_name,status,created_at",
      entityIds,
    ),
    fetchRows<ApoloSourceLinkRow>(
      adminClient,
      "apolo_source_links",
      "entity_id,source_system,source_table,source_id",
      entityIds,
    ),
    fetchProfileSummaryCounts(adminClient),
    countPendingApoloEntities(adminClient),
    countVerifiedApoloRelationships(adminClient),
    countApoloBuyerEntities(adminClient),
    countApoloBuyerCommercialLinks(adminClient),
  ]);

  const hasStalePortfolio = hasStaleCommercialPortfolio(commercialLinks);
  const documentLabelsByEntity =
    await fetchC2xDocumentLabelsByEntity(sourceLinks);
  const c2xPortfolioByEntity =
    await fetchC2xPortfolioByEntity(sourceLinks);

  const profilesByEntity = groupRowsBy(profiles, "entity_id");
  const entities = entityRows.map((row) =>
    mapApoloEntityRow(row, {
      addresses: groupRowsBy(addresses, "entity_id").get(row.id) ?? [],
      audit: groupRowsBy(auditEvents.filter((item) => item.entity_id), "entity_id").get(row.id) ?? [],
      commercialLinks: groupRowsBy(commercialLinks, "entity_id").get(row.id) ?? [],
      contacts: groupRowsBy(contacts, "entity_id").get(row.id) ?? [],
      documents: groupRowsBy(documents, "entity_id").get(row.id) ?? [],
      financialSnapshots: groupRowsBy(financialSnapshots, "entity_id").get(row.id) ?? [],
      profiles: profilesByEntity.get(row.id) ?? [],
      relationships: groupRowsBy(relationships, "entity_id").get(row.id) ?? [],
      serviceSignals: groupRowsBy(serviceSignals, "entity_id").get(row.id) ?? [],
      sourceLinks: groupRowsBy(sourceLinks, "entity_id").get(row.id) ?? [],
      timelineEvents: groupRowsBy(timelineEvents, "entity_id").get(row.id) ?? [],
    }, documentLabelsByEntity.get(row.id), c2xPortfolioByEntity.get(row.id)),
  );

  const prospectCount = profileSummaries.find((summary) => summary.profile === "prospect")?.count ?? 0;

  return {
    data: {
      buyerUsersCount,
      entities,
      linkedUsersCount,
      meta: {
        generatedAt: new Date().toISOString(),
        message: hasStalePortfolio
          ? "Carteira Apolo carregada do read model; sincronizacao C2X recomendada para renovar metadata de unidade."
          : undefined,
        source: "apolo",
        status: "ready",
      },
      nonBuyerUsersCount: prospectCount,
      pendingReviewCount,
      portfolioPaymentsCount: 0,
      portfolioUnitsCount,
      profileSummaries,
      totalCount: entityResult.totalCount,
    },
    ok: true,
  };
}

function isSupabaseSecretKey(value: string) {
  return value.startsWith("sb_secret_");
}

function hasStaleCommercialPortfolio(rows: ApoloCommercialLinkRow[]) {
  return rows.some((row) => {
    if (!isBuyerCommercialRole(row.relationship_role)) {
      return false;
    }

    const metadata = metadataRecord(row.metadata);
    const hasRealUnitMetadata =
      Boolean(metadataString(metadata, "unitCode")) ||
      Boolean(metadataString(metadata, "block")) ||
      Boolean(metadataString(metadata, "lot"));

    if (hasRealUnitMetadata) {
      return false;
    }

    const legacyText = normalizeSearchText(
      `${row.enterprise_name ?? ""} ${row.reference_label ?? ""} ${row.unit_label ?? ""}`,
    );

    return (
      legacyText.includes("carteira comercial") ||
      legacyText.includes("vinculo identificado") ||
      legacyText.includes("sem carteira por pagamento")
    );
  });
}

function hasCommercialPortfolioEvidence(link: ApoloCommercialLink) {
  return Boolean(link.installments?.length);
}

function hasCommercialRowPortfolioEvidence(row: ApoloCommercialLinkRow) {
  if (!isBuyerCommercialRole(row.relationship_role)) {
    return false;
  }

  const metadata = metadataRecord(row.metadata);

  return Boolean(mapMetadataInstallments(metadata.installments)?.length);
}

function isBuyerCommercialRole(role: string | null | undefined) {
  const normalized = normalizeSearchText(role ?? "");

  return normalized === "usuario" || normalized === "usuario comprador";
}

async function fetchC2xDocumentLabelsByEntity(
  sourceLinks: ApoloSourceLinkRow[],
) {
  if (process.env.NODE_ENV !== "development") {
    return new Map<string, string>();
  }

  const c2xUserLinks = sourceLinks.filter(
    (link) =>
      link.source_system === "c2x" &&
      link.source_table === "users" &&
      Boolean(link.source_id),
  );
  const userIds = uniqueStrings(
    c2xUserLinks
      .map((link) => link.source_id ?? "")
      .filter((sourceId) => /^\d+$/.test(sourceId)),
  );

  if (!userIds.length) {
    return new Map<string, string>();
  }

  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return new Map<string, string>();
  }

  try {
    const placeholders = userIds.map(() => "?").join(",");
    const [rows] = await poolResult.pool.query<C2xDocumentLookupRow[]>(
      `select id, cpf, cnpj from users where id in (${placeholders})`,
      userIds,
    );
    const documentsByUserId = new Map(
      rows
        .map((row) => [
          String(row.id),
          formatDocumentForDisplay(row.cpf ?? row.cnpj),
        ] as const)
        .filter(([, document]) => document !== "Documento em revisao"),
    );
    const documentsByEntity = new Map<string, string>();

    for (const link of c2xUserLinks) {
      const document = documentsByUserId.get(link.source_id ?? "");

      if (document) {
        documentsByEntity.set(link.entity_id, document);
      }
    }

    return documentsByEntity;
  } catch {
    return new Map<string, string>();
  }
}

async function fetchC2xPortfolioByEntity(
  sourceLinks: ApoloSourceLinkRow[],
) {
  const c2xUserLinks = sourceLinks.filter(
    (link) =>
      link.source_system === "c2x" &&
      link.source_table === "users" &&
      Boolean(link.source_id) &&
      /^\d+$/.test(String(link.source_id)),
  );
  const entityIdByUserId = new Map(
    c2xUserLinks.map((link) => [String(link.source_id), link.entity_id] as const),
  );
  const userIds = uniqueStrings(Array.from(entityIdByUserId.keys()));

  if (!userIds.length) {
    return new Map<string, C2xPortfolioHydration>();
  }

  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return new Map<string, C2xPortfolioHydration>();
  }

  try {
    const [portfolioRows] = await poolResult.pool.query<C2xPortfolioRow[]>(
      `
        select
          participants.user_id,
          ar.id as acquisition_request_id,
          coalesce(nullif(trim(ar.code), ''), cast(ar.id as char)) as acquisition_request_code,
          ars.name as stage_name,
          eu.id as unity_id,
          eu.name as unity_name,
          eu.block,
          eu.lot,
          eu.area,
          eu.price as unit_price,
          e.code as enterprise_code,
          ${C2X_ENTERPRISE_DISPLAY_EXPRESSION} as enterprise_name,
          coalesce(
            nullif(trim(linked.fantasy_name), ''),
            nullif(trim(linked.social_name), ''),
            nullif(trim(linked.name), '')
          ) as broker_agency,
          (
            select nullif(trim(cs.uuidDoc), '')
            from contract_signatures cs
            left join acquisition_request_contracts arc_sig on arc_sig.id = cs.acquisition_request_contract_id
            where arc_sig.acquisition_request_id = ar.id
              and trim(coalesce(cs.uuidDoc, '')) <> ''
            order by cs.updated_at desc, cs.id desc
            limit 1
          ) as signed_contract_document_id,
          (
            select nullif(trim(cs.link_pdf_signed_file), '')
            from contract_signatures cs
            left join acquisition_request_contracts arc_sig on arc_sig.id = cs.acquisition_request_contract_id
            where arc_sig.acquisition_request_id = ar.id
              and trim(coalesce(cs.link_pdf_signed_file, '')) <> ''
            order by cs.updated_at desc, cs.id desc
            limit 1
          ) as signed_contract_url,
          (
            select coalesce(css_sig.name, 'Assinado')
            from contract_signatures cs
            left join contract_signature_statuses css_sig on css_sig.id = cs.contract_signature_status_id
            left join acquisition_request_contracts arc_sig on arc_sig.id = cs.acquisition_request_contract_id
            where arc_sig.acquisition_request_id = ar.id
              and trim(coalesce(cs.uuidDoc, '')) <> ''
            order by cs.updated_at desc, cs.id desc
            limit 1
          ) as signed_contract_status,
          count(case when p.payment_status_id in (5, 6, 7) then p.id end) as total_payments,
          count(case when p.payment_status_id = 5 then p.id end) as paid_payments,
          count(case when p.payment_status_id = 6 then p.id end) as pending_payments,
          count(case when p.payment_status_id = 7 then p.id end) as overdue_payments,
          coalesce(sum(case when p.payment_status_id in (5, 6, 7) then coalesce(p.initial_value, 0) else 0 end), 0) as total_portfolio_amount,
          coalesce(sum(case when p.payment_status_id = 5 then coalesce(p.paid_value, p.initial_value, 0) else 0 end), 0) as paid_amount,
          coalesce(sum(case when p.payment_status_id = 7 then ${C2X_OUTSTANDING_PAYMENT_EXPRESSION} else 0 end), 0) as overdue_amount,
          max(case when p.payment_status_id = 7 and p.due_date is not null then datediff(curdate(), p.due_date) else 0 end) as max_overdue_days
        from (
          select id as request_id, client_id as user_id from acquisition_requests where client_id is not null
          union all select id, client_2_id from acquisition_requests where client_2_id is not null
          union all select id, client_3_id from acquisition_requests where client_3_id is not null
          union all select id, client_4_id from acquisition_requests where client_4_id is not null
          union all select id, client_5_id from acquisition_requests where client_5_id is not null
        ) participants
        inner join acquisition_requests ar on ar.id = participants.request_id
        left join payments p on p.acquisition_request_id = ar.id
          and p.payment_status_id in (5, 6, 7)
          and ${C2X_ACTIVE_PAYMENT_WHERE}
        left join users client on client.id = participants.user_id
        left join users linked on linked.id = client.vinculed_by_id
        left join acquisition_request_stages ars on ars.id = ar.acquisition_request_stage_id
        left join enterprise_unities eu on eu.id = ar.enterprise_unity_id
        left join enterprises e on e.id = eu.enterprise_id
        where participants.user_id in (?)
          and ${C2X_VALID_ENTERPRISE_WHERE}
          and ar.id is not null
          and (p.id is not null or ${C2X_PORTFOLIO_STAGE_WHERE})
        group by
          participants.user_id,
          ar.id,
          ar.code,
          ars.name,
          eu.id,
          eu.name,
          eu.block,
          eu.lot,
          eu.area,
          eu.price,
          e.id,
          e.code,
          e.divulgation_name,
          e.name,
          linked.fantasy_name,
          linked.social_name,
          linked.name
        order by ar.updated_at desc, ar.id desc
      `,
      [userIds],
    );

    const requestIds = uniqueStrings(
      portfolioRows.map((row) => String(row.acquisition_request_id)),
    );
    const installmentsByRequestId = new Map<string, ApoloInstallment[]>();

    if (requestIds.length) {
      const [installmentRows] = await poolResult.pool.query<C2xPortfolioInstallmentRow[]>(
        `
          select
            p.id,
            p.acquisition_request_id,
            p.parcel_type_id,
            pt.name as parcel_type_name,
            p.payment_status_id,
            p.due_date,
            date_format(p.due_date, '%Y-%m-%d') as due_date_value,
            date_format(p.payment_date, '%Y-%m-%d') as payment_date_value,
            p.paid_value,
            p.initial_value,
            p.interest_value,
            p.mulct_value,
            p.current_total_parcel,
            p.total_parcels,
            p.current_signal_parcel,
            p.total_signal_parcels,
            p.payment_asaas_id as asaas_payment_id,
            p.payment_asaas_url as payment_url,
            p.payment_asaas_invoice_url as invoice_url
          from payments p
          left join parcel_types pt on pt.id = p.parcel_type_id
          where p.acquisition_request_id in (?)
            and p.payment_status_id in (5, 6, 7)
            and ${C2X_ACTIVE_PAYMENT_WHERE}
          order by p.acquisition_request_id asc, p.due_date asc, p.id asc
        `,
        [requestIds],
      );

      for (const row of installmentRows) {
        const requestId = String(row.acquisition_request_id);
        const current = installmentsByRequestId.get(requestId) ?? [];

        current.push(mapC2xPortfolioInstallment(row));
        installmentsByRequestId.set(requestId, current);
      }
    }

    const rowsByEntity = new Map<string, C2xPortfolioRow[]>();

    for (const row of portfolioRows) {
      const entityId = entityIdByUserId.get(String(row.user_id));

      if (!entityId) {
        continue;
      }

      rowsByEntity.set(entityId, [...(rowsByEntity.get(entityId) ?? []), row]);
    }

    const portfolioByEntity = new Map<string, C2xPortfolioHydration>();

    for (const [entityId, rows] of rowsByEntity) {
      portfolioByEntity.set(entityId, {
        commercialLinks: rows.map((row) =>
          mapC2xPortfolioRowToCommercialLink(
            row,
            installmentsByRequestId.get(String(row.acquisition_request_id)) ?? [],
          ),
        ),
        financial: mapC2xPortfolioFinancialSnapshot(rows),
      });
    }

    return portfolioByEntity;
  } catch (error) {
    console.error("[apolo] C2X portfolio hydration failed", sanitizeHadesDbError(error));
    return new Map<string, C2xPortfolioHydration>();
  }
}

function mapC2xPortfolioRowToCommercialLink(
  row: C2xPortfolioRow,
  installments: ApoloInstallment[],
): ApoloCommercialLink {
  const block = normalizeC2xBlock(row.block);
  const lot = normalizeC2xLot(row.lot);
  const unitCode = firstFilled(row.unity_name) ?? undefined;
  const enterprise = firstFilled(row.enterprise_name) ?? "Carteira comercial";
  const brokerAgency = firstFilled(row.broker_agency) ?? undefined;

  return {
    acquisitionRequestId: optionalString(row.acquisition_request_id),
    area: formatC2xArea(row.area),
    block,
    brokerAgency,
    contractDocumentId: firstFilled(row.signed_contract_document_id) ?? undefined,
    contractStatus: firstFilled(row.signed_contract_status) ?? undefined,
    contractUrl: firstFilled(row.signed_contract_url) ?? undefined,
    enterprise,
    enterpriseCode: firstFilled(row.enterprise_code) ?? undefined,
    installments,
    lot,
    referenceLabel:
      brokerAgency ??
      firstFilled(row.acquisition_request_code) ??
      "Vinculo comercial",
    role: installments.length ? "Usuario" : "Prospect",
    stage: firstFilled(row.stage_name) ?? "Relacionamento ativo",
    tableValue: positiveCurrencyOrEmpty(row.unit_price),
    unit: c2xUnitLabel(block, lot, unitCode),
    unitCode,
    unitId: optionalString(row.unity_id),
  };
}

function mapC2xPortfolioInstallment(
  row: C2xPortfolioInstallmentRow,
): ApoloInstallment {
  const dueDateInput = normalizeDateOnly(row.due_date_value) || dateOnlyFromValue(row.due_date);
  const paidDateInput = normalizeDateOnly(row.payment_date_value);
  const status = portfolioInstallmentStatus(row.payment_status_id);

  return {
    acquisitionRequestId: String(row.acquisition_request_id),
    asaasPaymentId: firstFilled(row.asaas_payment_id) ?? undefined,
    dueDate: formatDateOnlyLabel(dueDateInput),
    id: String(row.id),
    invoiceUrl: firstFilled(row.invoice_url) ?? undefined,
    number: portfolioInstallmentNumber(row),
    overdueDays:
      status === "Vencida" && dueDateInput
        ? Math.max(daysBetweenDateOnly(dueDateInput, new Date()), 1)
        : 0,
    paidAt: paidDateInput ? formatDateOnlyLabel(paidDateInput) : undefined,
    paymentUrl: firstFilled(row.payment_url) ?? undefined,
    reference: formatReferenceFromDateOnly(dueDateInput),
    status,
    value: formatCurrency(portfolioInstallmentAmount(row)),
    valueNumber: portfolioInstallmentAmount(row),
  };
}

function mapC2xPortfolioFinancialSnapshot(
  rows: C2xPortfolioRow[],
): ApoloFinancialSnapshot {
  const paymentCount = rows.reduce((total, row) => total + toNumber(row.total_payments), 0);
  const unitsCount = uniqueStrings(
    rows
      .map((row) => optionalString(row.unity_id))
      .filter((value): value is string => Boolean(value)),
  ).length;
  const overdueInstallments = rows.reduce((total, row) => total + toNumber(row.overdue_payments), 0);
  const totalPortfolio = rows.reduce((total, row) => total + toNumber(row.total_portfolio_amount), 0);
  const paidAmount = rows.reduce((total, row) => total + toNumber(row.paid_amount), 0);
  const overdueAmount = rows.reduce((total, row) => total + toNumber(row.overdue_amount), 0);
  const maxOverdueDays = Math.max(...rows.map((row) => toNumber(row.max_overdue_days)), 0);

  return {
    overdueAmount: formatCurrency(overdueAmount),
    overdueInstallments,
    paidAmount: formatCurrency(paidAmount),
    paymentBehavior: `${paymentCount} pagamento(s), ${unitsCount} unidade(s) e ${overdueInstallments} parcela(s) em atraso.`,
    risk:
      overdueInstallments >= 7 || maxOverdueDays >= 180
        ? "critico"
        : overdueInstallments >= 3 || maxOverdueDays >= 90
          ? "alto"
          : overdueInstallments > 0
            ? "medio"
            : "baixo",
    totalPortfolio: formatCurrency(totalPortfolio),
  };
}

function portfolioInstallmentNumber(row: C2xPortfolioInstallmentRow) {
  const parcelTypeId = toNumber(row.parcel_type_id);
  const current =
    parcelTypeId === 2
      ? toNumber(row.current_signal_parcel)
      : toNumber(row.current_total_parcel);
  const total =
    parcelTypeId === 2
      ? toNumber(row.total_signal_parcels)
      : toNumber(row.total_parcels);
  const label = firstFilled(row.parcel_type_name) ?? "Parcela";

  if (current > 0 && total > 0) {
    return `${String(current).padStart(2, "0")}/${String(total).padStart(2, "0")}`;
  }

  return label;
}

function portfolioInstallmentStatus(
  value: number | string | null | undefined,
): ApoloInstallment["status"] {
  const status = toNumber(value);

  if (status === 5) return "Liquidada";
  if (status === 6) return "A vencer";

  return "Vencida";
}

function portfolioInstallmentAmount(row: C2xPortfolioInstallmentRow) {
  const paidValue = toNumber(row.paid_value);
  const baseValue =
    toNumber(row.initial_value) +
    toNumber(row.interest_value) +
    toNumber(row.mulct_value);

  return Math.max(paidValue || baseValue, 0);
}

function normalizeDateOnly(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();

  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function dateOnlyFromValue(value: Date | string | null | undefined) {
  if (!value) {
    return "";
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  return normalizeDateOnly(String(value).slice(0, 10));
}

function formatDateOnlyLabel(value: string) {
  const normalized = normalizeDateOnly(value);

  if (!normalized) {
    return "Sem data";
  }

  const [year, month, day] = normalized.split("-");

  return `${day}/${month}/${year}`;
}

function formatReferenceFromDateOnly(value: string) {
  const normalized = normalizeDateOnly(value);

  if (!normalized) {
    return "-";
  }

  const [year, month] = normalized.split("-");

  return `${month}/${year}`;
}

function daysBetweenDateOnly(start: string, end: Date) {
  const normalized = normalizeDateOnly(start);

  if (!normalized) {
    return 0;
  }

  const startDate = new Date(`${normalized}T00:00:00.000Z`);
  const endDate = new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()));

  if (Number.isNaN(startDate.getTime())) {
    return 0;
  }

  return Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000);
}

async function fetchApoloEntityRows(
  adminClient: ApoloSupabaseClient,
  options: ApoloDashboardOptions,
) {
  const normalizedQuery = normalizeSearchText(options.query ?? "");
  const profile = options.profile ?? null;
  const limit = normalizedQuery
    ? broadApoloQueryLimit(normalizedQuery)
    : options.limit ?? DEFAULT_CRM_LIMIT;
  const countResult = await adminClient
    .from("apolo_entities")
    .select("id", { count: "exact", head: true })
    .neq("status", "archived");

  if (countResult.error) {
    return {
      code: countResult.error.code,
      message: countResult.error.message,
      ok: false as const,
    };
  }

  const totalCount = countResult.count ?? 0;

  if (normalizedQuery || profile) {
    const searchedIds = normalizedQuery
      ? await fetchSearchEntityIds(adminClient, normalizedQuery)
      : null;
    const profileIds = profile
      ? await fetchDerivedProfileEntityIds(adminClient, profile)
      : null;

    if (searchedIds?.error || profileIds?.error) {
      const error = searchedIds?.error ?? profileIds?.error;

      return {
        code: error?.code,
        message: error?.message ?? "Nao foi possivel consultar o indice do Apolo.",
        ok: false as const,
      };
    }

    const selectedIds = intersectEntityIds(searchedIds?.ids, profileIds?.ids);

    if (!selectedIds.length) {
      return {
        ok: true as const,
        rows: [],
        totalCount,
      };
    }

    const rows = await fetchEntityRowsByIds(
      adminClient,
      limit ? selectedIds.slice(0, limit) : selectedIds,
    );

    if (!rows.ok) {
      return rows;
    }

    return {
      ok: true as const,
      rows: sortEntityRows(rows.rows).slice(0, limit),
      totalCount,
    };
  }

  const { data, error } = await adminClient
    .from("apolo_entities")
    .select(
      "id,entity_kind,display_name,legal_name,trade_name,document_masked,status,quality_score,primary_city,primary_state,next_action,created_at,updated_at",
    )
    .neq("status", "archived")
    .order("display_name", { ascending: true })
    .limit(limit ?? DEFAULT_CRM_LIMIT)
    .returns<ApoloEntityRow[]>();

  if (error) {
    return {
      code: error.code,
      message: error.message,
      ok: false as const,
    };
  }

  return {
    ok: true as const,
    rows: data ?? [],
    totalCount,
  };
}

async function fetchSearchEntityIds(
  adminClient: ApoloSupabaseClient,
  normalizedQuery: string,
) {
  const ids: string[] = [];
  const pageSize = 1000;

  if (shouldSearchBuyerUsers(normalizedQuery)) {
    return fetchBuyerEntityIds(adminClient, broadApoloQueryLimit(normalizedQuery));
  }

  if (shouldSearchProspects(normalizedQuery)) {
    return fetchProspectEntityIds(adminClient, broadApoloQueryLimit(normalizedQuery));
  }

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await adminClient
      .from("apolo_search_entries")
      .select("entity_id")
      .ilike("normalized_text", `%${normalizedQuery}%`)
      .range(from, from + pageSize - 1)
      .returns<ApoloSearchEntryRow[]>();

    if (error) {
      return {
        error,
        ids: [],
      };
    }

    ids.push(...(data ?? []).map((row) => row.entity_id));

    if (!data || data.length < pageSize) {
      return {
        ids: uniqueStrings(ids),
      };
    }
  }
}

async function fetchBuyerEntityIds(
  adminClient: ApoloSupabaseClient,
  maxIds?: number,
) {
  const ids: string[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await adminClient
      .from("apolo_commercial_links")
      .select("entity_id,enterprise_name,unit_label,relationship_role,stage_label,reference_label,metadata")
      .in("relationship_role", ["Usuario", "Usuario comprador"])
      .range(from, from + pageSize - 1)
      .returns<ApoloCommercialLinkRow[]>();

    if (error) {
      return {
        error,
        ids: [],
      };
    }

    ids.push(
      ...(data ?? [])
        .filter(hasCommercialRowPortfolioEvidence)
        .map((row) => row.entity_id),
    );

    if (maxIds && ids.length >= maxIds) {
      break;
    }

    if (!data || data.length < pageSize) {
      break;
    }
  }

  return {
    ids: uniqueStrings(maxIds ? ids.slice(0, maxIds) : ids),
  };
}

async function fetchProspectEntityIds(
  adminClient: ApoloSupabaseClient,
  maxIds?: number,
) {
  const [usuarioLikeResult, buyerResult] = await Promise.all([
    fetchUsuarioLikeEntityIds(adminClient),
    fetchBuyerEntityIds(adminClient),
  ]);

  if (usuarioLikeResult.error || buyerResult.error) {
    return {
      error: usuarioLikeResult.error ?? buyerResult.error,
      ids: [],
    };
  }

  const buyerIds = new Set(buyerResult.ids);
  const ids = usuarioLikeResult.ids.filter((id) => !buyerIds.has(id));

  return {
    ids: maxIds ? ids.slice(0, maxIds) : ids,
  };
}

async function fetchUsuarioLikeEntityIds(adminClient: ApoloSupabaseClient) {
  const [usuarioResult, prospectResult] = await Promise.all([
    fetchProfileEntityIds(adminClient, "usuario"),
    fetchProfileEntityIds(adminClient, "prospect"),
  ]);

  if (usuarioResult.error || prospectResult.error) {
    return {
      error: usuarioResult.error ?? prospectResult.error,
      ids: [],
    };
  }

  return {
    ids: uniqueStrings([...usuarioResult.ids, ...prospectResult.ids]),
  };
}

function shouldSearchBuyerUsers(normalizedQuery: string) {
  return [
    "comprador",
    "compradores",
    "usuario",
    "usuario comprador",
    "usuarios",
    "usuarios compradores",
  ].includes(normalizedQuery);
}

function shouldSearchProspects(normalizedQuery: string) {
  return [
    "nao comprador",
    "nao compradores",
    "prospect",
    "prospects",
    "prospecto",
    "prospectos",
    "sem compra",
  ].includes(normalizedQuery);
}

function broadApoloQueryLimit(normalizedQuery: string) {
  if (shouldSearchBuyerUsers(normalizedQuery) || shouldSearchProspects(normalizedQuery)) {
    return 120;
  }

  return undefined;
}

async function fetchProfileEntityIds(
  adminClient: ApoloSupabaseClient,
  profile: ApoloProfile,
) {
  const ids: string[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await adminClient
      .from("apolo_entity_profiles")
      .select("entity_id")
      .eq("profile", profile)
      .range(from, from + pageSize - 1)
      .returns<Array<{ entity_id: string }>>();

    if (error) {
      return {
        error,
        ids: [],
      };
    }

    ids.push(...(data ?? []).map((row) => row.entity_id));

    if (!data || data.length < pageSize) {
      return {
        ids: uniqueStrings(ids),
      };
    }
  }
}

async function fetchDerivedProfileEntityIds(
  adminClient: ApoloSupabaseClient,
  profile: ApoloProfile,
) {
  if (profile === "usuario") {
    return fetchBuyerEntityIds(adminClient);
  }

  if (profile === "prospect") {
    return fetchProspectEntityIds(adminClient);
  }

  return fetchProfileEntityIds(adminClient, profile);
}

async function fetchEntityRowsByIds(
  adminClient: ApoloSupabaseClient,
  entityIds: string[],
) {
  const rows: ApoloEntityRow[] = [];
  const chunkSize = 350;

  for (let index = 0; index < entityIds.length; index += chunkSize) {
    const chunk = entityIds.slice(index, index + chunkSize);
    const { data, error } = await adminClient
      .from("apolo_entities")
      .select(
        "id,entity_kind,display_name,legal_name,trade_name,document_masked,status,quality_score,primary_city,primary_state,next_action,created_at,updated_at",
      )
      .in("id", chunk)
      .neq("status", "archived")
      .returns<ApoloEntityRow[]>();

    if (error) {
      return {
        code: error.code,
        message: error.message,
        ok: false as const,
      };
    }

    rows.push(...(data ?? []));
  }

  return {
    ok: true as const,
    rows,
  };
}

function intersectEntityIds(
  searchedIds: string[] | undefined,
  profileIds: string[] | undefined,
) {
  if (searchedIds && profileIds) {
    const profileSet = new Set(profileIds);

    return searchedIds.filter((id) => profileSet.has(id));
  }

  return searchedIds ?? profileIds ?? [];
}

function sortEntityRows(rows: ApoloEntityRow[]) {
  return [...rows].sort((a, b) =>
    a.display_name.localeCompare(b.display_name, "pt-BR", { sensitivity: "base" }),
  );
}

async function fetchRows<T>(
  adminClient: ApoloSupabaseClient,
  table: string,
  columns: string,
  entityIds: string[],
) {
  const rows: T[] = [];
  const chunkSize = 350;
  const pageSize = 1000;

  for (let index = 0; index < entityIds.length; index += chunkSize) {
    const chunk = entityIds.slice(index, index + chunkSize);

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await adminClient
        .from(table)
        .select(columns)
        .in("entity_id", chunk)
        .range(from, from + pageSize - 1)
        .returns<T[]>();

      if (error) {
        return [];
      }

      rows.push(...(data ?? []));

      if (!data || data.length < pageSize) {
        break;
      }
    }
  }

  return rows;
}

async function fetchProfileSummaryCounts(
  adminClient: ApoloSupabaseClient,
): Promise<ApoloProfileSummary[]> {
  const [buyerResult, usuarioLikeResult] = await Promise.all([
    fetchBuyerEntityIds(adminClient),
    fetchUsuarioLikeEntityIds(adminClient),
  ]);
  const buyerCount = buyerResult.error ? 0 : buyerResult.ids.length;
  const usuarioLikeCount = usuarioLikeResult.error ? 0 : usuarioLikeResult.ids.length;
  const prospectCount = Math.max(usuarioLikeCount - buyerCount, 0);

  return Promise.all(
    apoloProfileCardOrder.map(async (profile) => {
      if (profile === "usuario") {
        return {
          count: buyerCount,
          label: apoloProfileLabels[profile],
          profile,
        };
      }

      if (profile === "prospect") {
        return {
          count: prospectCount,
          label: apoloProfileLabels[profile],
          profile,
        };
      }

      return {
        count: await countApoloProfileRows(adminClient, profile),
        label: apoloProfileLabels[profile],
        profile,
      };
    }),
  );
}

async function countApoloProfileRows(
  adminClient: ApoloSupabaseClient,
  profile: ApoloProfile,
) {
  const { count, error } = await adminClient
    .from("apolo_entity_profiles")
    .select("entity_id", { count: "exact", head: true })
    .eq("profile", profile);

  if (error) {
    return 0;
  }

  return count ?? 0;
}

async function countPendingApoloEntities(adminClient: ApoloSupabaseClient) {
  const { count, error } = await adminClient
    .from("apolo_entities")
    .select("id", { count: "exact", head: true })
    .neq("status", "archived")
    .neq("status", "active");

  if (error) {
    return 0;
  }

  return count ?? 0;
}

async function countVerifiedApoloRelationships(adminClient: ApoloSupabaseClient) {
  const { count, error } = await adminClient
    .from("apolo_relationships")
    .select("entity_id", { count: "exact", head: true })
    .eq("status", "verified");

  if (error) {
    return 0;
  }

  return count ?? 0;
}

async function countApoloBuyerEntities(adminClient: ApoloSupabaseClient) {
  const result = await fetchBuyerEntityIds(adminClient);

  if (result.error) {
    return 0;
  }

  return result.ids.length;
}

async function countApoloBuyerCommercialLinks(adminClient: ApoloSupabaseClient) {
  const result = await fetchBuyerEntityIds(adminClient);

  if (result.error) {
    return 0;
  }

  return result.ids.length;
}

async function loadLiveC2xDashboard(
  previousResult: ApoloLoadResult,
  options: ApoloDashboardOptions,
): Promise<ApoloLoadResult> {
  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return {
      message: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`,
      ok: false,
      reason: "missing_config",
    };
  }

  try {
    const normalizedQuery = normalizeSearchText(options.query ?? "");
    const liveUsersLimit = liveC2xUsersQueryLimit(options, normalizedQuery);
    const [profileRows, tableRows, crmRows, userRows] = await Promise.all([
      poolResult.pool.query<C2xProfileAggregateRow[]>(c2xProfileAggregateQuery()),
      poolResult.pool.query<C2xTableCountsRow[]>(c2xTableCountsQuery()),
      poolResult.pool.query<C2xCrmAggregateRow[]>(c2xCrmAggregateQuery()),
      poolResult.pool.query<C2xUserRow[]>(
        c2xUsersQuery({
          limit: liveUsersLimit,
          profile: options.profile,
        }),
      ),
    ]);
    const profiles = profileRows[0];
    const tableCounts = tableRows[0][0];
    const crmCounts = crmRows[0][0];
    const users = userRows[0];
    const limit = normalizedQuery ? undefined : options.limit ?? DEFAULT_CRM_LIMIT;
    const candidateLimit = limit
      ? Math.min(
          Math.max(limit * 25, LIVE_C2X_DEFAULT_ENTITY_LIMIT),
          LIVE_C2X_MAX_ENTITY_LIMIT,
        )
      : undefined;
    const candidateRows = users
      .filter((row) => matchesLiveC2xCandidateOptions(row, options))
      .slice(0, candidateLimit);
    const c2xPortfolioByEntity =
      await fetchC2xPortfolioByEntity(buildLiveC2xSourceLinks(candidateRows));
    const entities = candidateRows
      .map((row) =>
        mapC2xUserToApoloEntity(
          row,
          c2xPortfolioByEntity.get(liveC2xEntityId(row.id)),
        ),
      )
      .filter((entity) => matchesDashboardOptions(entity, options))
      .slice(0, limit);
    const linkedUsersCount = sumProfileMetric(profiles, 2, "with_vinculed_by");
    const buyerUsersCount = toNumber(crmCounts?.buyer_users_total);
    const usuarioTotal = toNumber(crmCounts?.usuario_total) || sumProfileMetric(profiles, 2, "total");

    return {
      data: {
        buyerUsersCount,
        entities,
        linkedUsersCount,
        meta: {
          generatedAt: new Date().toISOString(),
          message: previousResult.ok ? undefined : previousResult.message,
          source: "live-c2x",
          status: "sync_pending",
        },
        nonBuyerUsersCount: Math.max(usuarioTotal - buyerUsersCount, 0),
        pendingReviewCount: Math.max(
          sumProfileMetric(profiles, 2, "total") - linkedUsersCount,
          entities.filter((entity) => entity.status !== "active").length,
        ),
        portfolioPaymentsCount: toNumber(crmCounts?.portfolio_payments_total),
        portfolioUnitsCount: toNumber(crmCounts?.portfolio_units_total),
        profileSummaries: buildC2xProfileSummaries(profiles, {
          buyerUsersCount,
          prospectUsersCount: Math.max(usuarioTotal - buyerUsersCount, 0),
        }),
        totalCount: toNumber(tableCounts?.users_total),
      },
      ok: true,
    };
  } catch (error) {
    return {
      message: apoloSafeErrorMessage(error),
      ok: false,
      reason: "unavailable",
    };
  }
}

function buildLiveC2xSourceLinks(rows: C2xUserRow[]): ApoloSourceLinkRow[] {
  return rows.map((row) => ({
    entity_id: liveC2xEntityId(row.id),
    source_id: String(row.id),
    source_system: "c2x",
    source_table: "users",
  }));
}

function liveC2xEntityId(id: number | string) {
  return `rel-${id}`;
}

function liveC2xUsersQueryLimit(
  options: ApoloDashboardOptions,
  normalizedQuery: string,
) {
  if (normalizedQuery || options.profile) {
    return null;
  }

  const requestedLimit = Math.max(options.limit ?? DEFAULT_CRM_LIMIT, 1);

  return Math.min(
    Math.max(requestedLimit * 5, LIVE_C2X_DEFAULT_ENTITY_LIMIT),
    LIVE_C2X_MAX_ENTITY_LIMIT,
  );
}

function c2xProfileAggregateQuery() {
  return `
    select
      coalesce(p.id, u.profile_id) as profile_id,
      coalesce(p.name, 'Sem perfil') as profile_name,
      count(*) as total,
      sum(case when u.vinculed_by_id is not null then 1 else 0 end) as with_vinculed_by
    from users u
    left join profiles p on p.id = u.profile_id
    group by coalesce(p.id, u.profile_id), coalesce(p.name, 'Sem perfil')
    order by profile_id
  `;
}

function c2xTableCountsQuery() {
  return `
    select
      (select count(*) from users) as users_total,
      (select count(*) from acquisition_requests) as acquisition_requests_total,
      (select count(*) from enterprises) as enterprises_total,
      (select count(*) from enterprise_unities) as enterprise_units_total
  `;
}

function c2xCrmAggregateQuery() {
  return `
    select
      (select count(*) from users where profile_id = 2) as usuario_total,
      count(distinct case
        when (
          pmt.id is not null
          and pmt.payment_status_id in (5, 6, 7)
          and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0)
        )
          and ${C2X_VALID_ENTERPRISE_WHERE}
        then participants.user_id
        else null
      end) as buyer_users_total,
      count(distinct case
        when (
          pmt.id is not null
          and pmt.payment_status_id in (5, 6, 7)
          and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0)
        )
          and ${C2X_VALID_ENTERPRISE_WHERE}
        then ar.enterprise_unity_id
        else null
      end) as portfolio_units_total,
      count(distinct case
        when pmt.id is not null
          and pmt.payment_status_id in (5, 6, 7)
          and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0)
        then pmt.id
        else null
      end) as portfolio_payments_total
    from (
      select id as request_id, client_id as user_id from acquisition_requests where client_id is not null
      union all select id, client_2_id from acquisition_requests where client_2_id is not null
      union all select id, client_3_id from acquisition_requests where client_3_id is not null
      union all select id, client_4_id from acquisition_requests where client_4_id is not null
      union all select id, client_5_id from acquisition_requests where client_5_id is not null
    ) participants
    inner join users u on u.id = participants.user_id and u.profile_id = 2
    left join acquisition_requests ar on ar.id = participants.request_id
    left join payments pmt on pmt.acquisition_request_id = ar.id
    left join enterprise_unities eu on eu.id = ar.enterprise_unity_id
    left join enterprises e on e.id = eu.enterprise_id
  `;
}

function c2xUsersQuery(options: C2xUsersQueryOptions = {}) {
  const limitClause = c2xUsersLimitClause(options.limit);
  const profileWhereClause = c2xUsersProfileWhereClause(options.profile);
  const profileOrderClause = c2xUsersProfileOrderClause(options.profile);

  return `
    select
      u.id,
      u.profile_id,
      coalesce(p.name, 'Sem perfil') as profile_name,
      u.person_type_id,
      pt.name as person_type_name,
      u.name as user_name,
      u.social_name,
      u.fantasy_name,
      coalesce(
        nullif(trim(u.fantasy_name), ''),
        nullif(trim(u.social_name), ''),
        nullif(trim(u.name), ''),
        concat('Cadastro ', u.id)
      ) as display_name,
      u.cpf,
      u.cnpj,
      u.email,
      u.phone,
      u.cellphone,
      u.vinculed_by_id,
      coalesce(
        nullif(trim(linked.fantasy_name), ''),
        nullif(trim(linked.social_name), ''),
        nullif(trim(linked.name), '')
      ) as linked_party_name,
      coalesce(portfolio.request_count, 0) as request_count,
      coalesce(portfolio.billed_request_count, 0) as billed_request_count,
      coalesce(portfolio.payment_count, 0) as payment_count,
      coalesce(portfolio.unit_count, 0) as unit_count,
      portfolio.latest_stage_name,
      portfolio.latest_enterprise_name,
      portfolio.latest_unit_label,
      portfolio.latest_request_code,
      portfolio.latest_paid_area,
      portfolio.latest_paid_contract_document_id,
      portfolio.latest_paid_contract_status,
      portfolio.latest_paid_contract_url,
      portfolio.latest_paid_enterprise_code,
      portfolio.latest_paid_stage_name,
      portfolio.latest_paid_enterprise_name,
      portfolio.latest_paid_request_id,
      portfolio.latest_paid_unit_label,
      portfolio.latest_paid_request_code,
      portfolio.latest_paid_unit_block,
      portfolio.latest_paid_unit_code,
      portfolio.latest_paid_unit_id,
      portfolio.latest_paid_unit_lot,
      portfolio.latest_paid_unit_price,
      coalesce(portfolio.total_portfolio_amount, 0) as total_portfolio_amount,
      coalesce(portfolio.paid_amount, 0) as paid_amount,
      coalesce(portfolio.overdue_amount, 0) as overdue_amount,
      coalesce(portfolio.overdue_installments, 0) as overdue_installments,
      (
        select concat_ws(' / ', nullif(trim(city.name), ''), nullif(trim(state.acronym), ''))
        from addresses addr
        left join cities city on city.id = addr.city_id
        left join states state on state.id = coalesce(addr.state_id, city.state_id)
        where addr.ownertable_type = 'User'
          and addr.ownertable_id = u.id
        order by addr.updated_at desc, addr.id desc
        limit 1
      ) as location_label,
      u.updated_at
    from users u
    left join profiles p on p.id = u.profile_id
    left join person_types pt on pt.id = u.person_type_id
    left join users linked on linked.id = u.vinculed_by_id
    left join (
      select
        participants.user_id,
        count(distinct ar.id) as request_count,
        count(distinct case when ar.acquisition_request_stage_id = 4 then ar.id else null end) as billed_request_count,
        count(distinct case when pmt.payment_status_id in (5, 6, 7) and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then pmt.id else null end) as payment_count,
        count(distinct case
          when (
            pmt.id is not null
            and pmt.payment_status_id in (5, 6, 7)
            and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0)
          )
            and ${C2X_VALID_ENTERPRISE_WHERE}
          then eu.id
          else null
        end) as unit_count,
        substring_index(group_concat(coalesce(ars.name, '') order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_stage_name,
        substring_index(group_concat(coalesce(nullif(trim(e.divulgation_name), ''), nullif(trim(e.name), ''), '') order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_enterprise_name,
        substring_index(group_concat(coalesce(nullif(trim(eu.name), ''), concat_ws(' ', nullif(trim(eu.block), ''), nullif(trim(eu.lot), '')), '') order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_unit_label,
        substring_index(group_concat(coalesce(nullif(trim(ar.code), ''), cast(ar.id as char)) order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_request_code,
        substring_index(group_concat(case when pmt.payment_status_id in (5, 6, 7) and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then coalesce(ars.name, '') else null end order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_paid_stage_name,
        substring_index(group_concat(case when pmt.payment_status_id in (5, 6, 7) and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then coalesce(nullif(trim(e.divulgation_name), ''), nullif(trim(e.name), ''), '') else null end order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_paid_enterprise_name,
        substring_index(group_concat(case when pmt.payment_status_id in (5, 6, 7) and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then nullif(trim(e.code), '') else null end order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_paid_enterprise_code,
        substring_index(group_concat(case when pmt.payment_status_id in (5, 6, 7) and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then cast(ar.id as char) else null end order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_paid_request_id,
        substring_index(group_concat(case when pmt.payment_status_id in (5, 6, 7) and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then coalesce(nullif(trim(eu.name), ''), concat_ws(' ', nullif(trim(eu.block), ''), nullif(trim(eu.lot), '')), '') else null end order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_paid_unit_label,
        substring_index(group_concat(case when pmt.payment_status_id in (5, 6, 7) and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then coalesce(nullif(trim(ar.code), ''), cast(ar.id as char)) else null end order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_paid_request_code,
        substring_index(group_concat(case when pmt.payment_status_id in (5, 6, 7) and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then cast(eu.id as char) else null end order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_paid_unit_id,
        substring_index(group_concat(case when pmt.payment_status_id in (5, 6, 7) and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then nullif(trim(eu.name), '') else null end order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_paid_unit_code,
        substring_index(group_concat(case when pmt.payment_status_id in (5, 6, 7) and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then nullif(trim(eu.block), '') else null end order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_paid_unit_block,
        substring_index(group_concat(case when pmt.payment_status_id in (5, 6, 7) and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then nullif(trim(eu.lot), '') else null end order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_paid_unit_lot,
        substring_index(group_concat(case when pmt.payment_status_id in (5, 6, 7) and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then eu.area else null end order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_paid_area,
        substring_index(group_concat(case when pmt.payment_status_id in (5, 6, 7) and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then eu.price else null end order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_paid_unit_price,
        substring_index(group_concat(case when pmt.payment_status_id in (5, 6, 7) and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then (
          select nullif(trim(cs.uuidDoc), '')
          from contract_signatures cs
          left join acquisition_request_contracts arc_sig on arc_sig.id = cs.acquisition_request_contract_id
          where arc_sig.acquisition_request_id = ar.id
            and trim(coalesce(cs.uuidDoc, '')) <> ''
          order by cs.updated_at desc, cs.id desc
          limit 1
        ) else null end order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_paid_contract_document_id,
        substring_index(group_concat(case when pmt.payment_status_id in (5, 6, 7) and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then (
          select nullif(trim(cs.link_pdf_signed_file), '')
          from contract_signatures cs
          left join acquisition_request_contracts arc_sig on arc_sig.id = cs.acquisition_request_contract_id
          where arc_sig.acquisition_request_id = ar.id
            and trim(coalesce(cs.link_pdf_signed_file, '')) <> ''
          order by cs.updated_at desc, cs.id desc
          limit 1
        ) else null end order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_paid_contract_url,
        substring_index(group_concat(case when pmt.payment_status_id in (5, 6, 7) and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then (
          select coalesce(css_sig.name, 'Assinado')
          from contract_signatures cs
          left join contract_signature_statuses css_sig on css_sig.id = cs.contract_signature_status_id
          left join acquisition_request_contracts arc_sig on arc_sig.id = cs.acquisition_request_contract_id
          where arc_sig.acquisition_request_id = ar.id
            and trim(coalesce(cs.uuidDoc, '')) <> ''
          order by cs.updated_at desc, cs.id desc
          limit 1
        ) else null end order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_paid_contract_status,
        coalesce(sum(case when pmt.payment_status_id in (5, 6, 7) and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then coalesce(pmt.initial_value, 0) else 0 end), 0) as total_portfolio_amount,
        coalesce(sum(case when pmt.payment_status_id = 5 and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then coalesce(pmt.paid_value, pmt.initial_value, 0) else 0 end), 0) as paid_amount,
        coalesce(sum(case when pmt.payment_status_id = 7 and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then greatest(coalesce(pmt.initial_value, 0) + coalesce(pmt.interest_value, 0) + coalesce(pmt.mulct_value, 0) - coalesce(pmt.paid_value, 0), 0) else 0 end), 0) as overdue_amount,
        count(case when pmt.payment_status_id = 7 and (pmt.payment_to_delete is null or pmt.payment_to_delete = 0) then pmt.id else null end) as overdue_installments
      from (
        select id as request_id, client_id as user_id from acquisition_requests where client_id is not null
        union all select id, client_2_id from acquisition_requests where client_2_id is not null
        union all select id, client_3_id from acquisition_requests where client_3_id is not null
        union all select id, client_4_id from acquisition_requests where client_4_id is not null
        union all select id, client_5_id from acquisition_requests where client_5_id is not null
      ) participants
      left join acquisition_requests ar on ar.id = participants.request_id
      left join acquisition_request_stages ars on ars.id = ar.acquisition_request_stage_id
      left join enterprise_unities eu on eu.id = ar.enterprise_unity_id
      left join enterprises e on e.id = eu.enterprise_id
      left join payments pmt on pmt.acquisition_request_id = ar.id
      group by participants.user_id
    ) portfolio on portfolio.user_id = u.id
    ${profileWhereClause}
    order by
      ${profileOrderClause}
      case u.profile_id
        when 2 then 1
        when 3 then 2
        when 6 then 3
        when 7 then 4
        when 1 then 5
        when 5 then 6
        when 4 then 7
        else 8
      end,
      u.updated_at desc,
      u.id desc
    ${limitClause}
  `;
}

function c2xUsersProfileWhereClause(profile: ApoloProfile | null | undefined) {
  if (!profile) {
    return "";
  }

  if (profile === "usuario" || profile === "prospect") {
    return "where u.profile_id = 2";
  }

  if (profile === "colaborador") {
    return "where u.profile_id in (1, 5)";
  }

  const profileIdByApoloProfile: Partial<Record<ApoloProfile, number>> = {
    acesso_incorporador: 4,
    corretor: 7,
    imobiliaria: 6,
    incorporador: 3,
  };
  const personTypeByApoloProfile: Partial<Record<ApoloProfile, number>> = {
    pessoa_fisica: 1,
    pessoa_juridica: 2,
  };
  const profileId = profileIdByApoloProfile[profile];
  const personTypeId = personTypeByApoloProfile[profile];

  if (profileId) {
    return `where u.profile_id = ${profileId}`;
  }

  if (personTypeId) {
    return `where u.person_type_id = ${personTypeId}`;
  }

  return "";
}

function c2xUsersProfileOrderClause(profile: ApoloProfile | null | undefined) {
  if (profile === "usuario") {
    return "case when coalesce(portfolio.payment_count, 0) > 0 then 0 else 1 end,";
  }

  if (profile === "prospect") {
    return "case when coalesce(portfolio.payment_count, 0) = 0 then 0 else 1 end,";
  }

  return "";
}

function c2xUsersLimitClause(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }

  const normalizedLimit = Math.trunc(value);

  if (normalizedLimit < 1) {
    return "";
  }

  return `limit ${Math.min(normalizedLimit, LIVE_C2X_MAX_ENTITY_LIMIT)}`;
}

function mapApoloEntityRow(
  row: ApoloEntityRow,
  related: {
    addresses: ApoloAddressRow[];
    audit: ApoloAuditRow[];
    commercialLinks: ApoloCommercialLinkRow[];
    contacts: ApoloContactRow[];
    documents: ApoloDocumentRow[];
    financialSnapshots: ApoloFinancialRow[];
    profiles: ApoloProfileRow[];
    relationships: ApoloRelationshipRow[];
    serviceSignals: ApoloServiceRow[];
    sourceLinks: ApoloSourceLinkRow[];
    timelineEvents: ApoloTimelineRow[];
  },
  documentDisplayValue?: string,
  c2xPortfolio?: C2xPortfolioHydration,
): ApoloEntity {
  const rawProfiles = related.profiles
    .map((profile) => normalizeApoloProfile(profile.profile))
    .filter((profile): profile is ApoloProfile => Boolean(profile));
  const commercialLinks =
    c2xPortfolio?.commercialLinks.length
      ? c2xPortfolio.commercialLinks
      : related.commercialLinks.map(mapApoloCommercialRow);
  const profiles = normalizeCommerceProfiles(
    rawProfiles.length ? rawProfiles : profilesFromEntityKind(row.entity_kind),
    commercialLinks,
  );

  return {
    addresses: related.addresses.map(mapApoloAddressRow),
    audit: related.audit.map(mapApoloAuditRow),
    commercialLinks,
    confidenceScore: clampScore(row.quality_score ?? 0),
    contacts: related.contacts.map(mapApoloContactRow),
    createdAt: formatDateLabel(row.created_at),
    displayName: row.display_name,
    documentMasked: visibleDocumentValue(
      documentDisplayValue ?? row.document_masked,
    ),
    documents: related.documents.map(mapApoloDocumentRow),
    financial: c2xPortfolio?.financial ?? mapApoloFinancialRow(related.financialSnapshots[0]),
    hadesClientId: hadesClientIdFromSourceLinks(related.sourceLinks),
    id: row.id,
    kind: normalizeEntityKind(row.entity_kind),
    legalName: firstFilled(row.legal_name) ?? undefined,
    locationLabel: locationLabel(row.primary_city, row.primary_state),
    nextAction: row.next_action ?? "Revisar dados cadastrais",
    profiles,
    relationships: related.relationships.map(mapApoloRelationshipRow),
    serviceSignals: related.serviceSignals.map(mapApoloServiceRow),
    status: normalizeEntityStatus(row.status),
    timeline: related.timelineEvents.map(mapApoloTimelineRow),
    tradeName: firstFilled(row.trade_name) ?? undefined,
    updatedAt: formatDateLabel(row.updated_at),
  };
}

function mapC2xUserToApoloEntity(
  row: C2xUserRow,
  c2xPortfolio?: C2xPortfolioHydration,
): ApoloEntity {
  const hydratedCommercialLinks = c2xPortfolio?.commercialLinks ?? [];
  const hasHydratedPortfolio = hydratedCommercialLinks.length > 0;
  const commercialLinks = hasHydratedPortfolio
    ? hydratedCommercialLinks
    : buildC2xCommercialLinks(row);
  const profiles = normalizeCommerceProfiles(
    mapC2xProfiles(
      row.profile_id,
      row.person_type_id,
      hasCommercialLinksWithIssuedInstallments(commercialLinks) || hasC2xPortfolioPurchase(row),
    ),
    commercialLinks,
  );
  const document = row.cpf ?? row.cnpj ?? null;
  const documentDisplay = formatDocumentForDisplay(document);
  const contacts = buildMaskedContacts(row);
  const relationships = buildC2xRelationships(row);
  const status = deriveC2xEntityStatus(row, documentDisplay, relationships);
  const kind = deriveC2xEntityKind(row);

  return {
    addresses: buildC2xAddresses(row),
    audit: buildC2xAudit(row),
    commercialLinks,
    confidenceScore: deriveC2xConfidenceScore(row, contacts, relationships, documentDisplay),
    contacts,
    createdAt: formatDateLabel(row.updated_at),
    displayName: row.display_name?.trim() || `Cadastro ${row.id}`,
    documentMasked: documentDisplay,
    documents: buildC2xDocuments(documentDisplay),
    financial: c2xPortfolio?.financial ?? buildC2xFinancialSnapshot(row),
    hadesClientId: `c2x-client-${row.id}`,
    id: `rel-${row.id}`,
    kind,
    legalName: legalNameFromC2x(row) ?? undefined,
    locationLabel: normalizeLocationLabel(row.location_label),
    nextAction: deriveC2xNextAction(row, status),
    profiles,
    relationships,
    serviceSignals: [],
    status,
    timeline: buildC2xTimeline(row, status),
    tradeName: tradeNameFromC2x(row) ?? undefined,
    updatedAt: formatDateLabel(row.updated_at),
  };
}

function hasC2xPortfolioPurchase(row: C2xUserRow) {
  return row.profile_id === 2 && toNumber(row.payment_count) > 0;
}

function hasCommercialLinksWithIssuedInstallments(
  commercialLinks: ApoloCommercialLink[],
) {
  return commercialLinks.some((link) => Boolean(link.installments?.length));
}

async function startApoloSyncRun(adminClient: ApoloSupabaseClient): Promise<SyncResult> {
  const { data, error } = await adminClient
    .from("apolo_sync_runs")
    .insert({
      metadata: {
        strategy: "apolo-c2x-users-v1",
      },
      source_system: "c2x",
      status: "running",
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data?.id) {
    return {
      error: error?.message ?? "Nao foi possivel registrar a sincronizacao do Apolo.",
      ok: false,
    };
  }

  return {
    ok: true,
    rowsWritten: 1,
    syncRunId: data.id,
  };
}

async function persistApoloEntityBatch(
  adminClient: ApoloSupabaseClient,
  users: C2xUserRow[],
  syncRunId: string,
  syncedAt: string,
) {
  const entityRows = users.map((user) => {
    const document = user.cpf ?? user.cnpj ?? null;
    const documentDisplay = formatDocumentForDisplay(document);
    const kind = deriveC2xEntityKind(user);
    const status = deriveC2xEntityStatus(user, documentDisplay, buildC2xRelationships(user));

    return {
      display_name: user.display_name?.trim() || `Cadastro ${user.id}`,
      document_hash: null,
      document_kind: documentKind(document),
      document_masked: documentDisplay,
      entity_kind: kind,
      id: deterministicUuid(`apolo:c2x:users:${user.id}`),
      legal_name: legalNameFromC2x(user),
      metadata: {
        profileNames: [user.profile_name].filter(Boolean),
        responsibleName: user.linked_party_name,
      },
      next_action: deriveC2xNextAction(user, status),
      primary_city: splitLocation(user.location_label).city,
      primary_state: splitLocation(user.location_label).state,
      quality_score: deriveC2xConfidenceScore(user, buildMaskedContacts(user), buildC2xRelationships(user), documentDisplay),
      status,
      trade_name: tradeNameFromC2x(user),
      updated_at: syncedAt,
      workspace_id: "careli",
    };
  });
  const profileRows = users.flatMap((user) =>
    mapC2xProfiles(user.profile_id, user.person_type_id).map((profile) => ({
      entity_id: deterministicUuid(`apolo:c2x:users:${user.id}`),
      profile,
      status: "active",
      updated_at: syncedAt,
    })),
  );
  const sourceRows = users.map((user) => ({
    entity_id: deterministicUuid(`apolo:c2x:users:${user.id}`),
    last_seen_at: syncedAt,
    metadata: {
      syncRunId,
    },
    source_id: String(user.id),
    source_system: "c2x",
    source_table: "users",
    sync_run_id: syncRunId,
    updated_at: syncedAt,
  }));
  const identifierRows = users.flatMap((user) =>
    buildIdentifierRows(user, syncRunId, syncedAt),
  );
  const contactRows = users.flatMap((user) => buildContactRows(user, syncedAt));
  const addressRows = users.flatMap((user) => buildAddressRows(user, syncedAt));
  const relationshipRows = users.flatMap((user) =>
    buildRelationshipRows(user, syncedAt),
  );
  const commercialRows = users.flatMap((user) =>
    buildCommercialRows(user, syncedAt),
  );
  const financialRows = users.map((user) => buildFinancialRow(user, syncedAt));
  const documentRows = users.flatMap((user) => buildDocumentRows(user, syncedAt));
  const timelineRows = users.flatMap((user) => buildTimelineRows(user, syncedAt));
  const auditRows = users.flatMap((user) => buildAuditRows(user, syncedAt));
  const moduleRows = users.map((user) => ({
    entity_id: deterministicUuid(`apolo:c2x:users:${user.id}`),
    id: deterministicUuid(`apolo:c2x:users:${user.id}:module-record`),
    metadata: {
      syncRunId,
    },
    module_key: "c2x",
    record_id: String(user.id),
    record_type: "users",
    relationship_label: user.profile_name ?? "Cadastro",
    status: "active",
    updated_at: syncedAt,
  }));
  const searchRows = users.map((user) => buildSearchRow(user, syncedAt));

  const { error: entityError } = await adminClient
    .from("apolo_entities")
    .upsert(entityRows, { onConflict: "id" });

  if (entityError) {
    throw entityError;
  }

  const { error: profileError } = await adminClient
    .from("apolo_entity_profiles")
    .upsert(profileRows, { onConflict: "entity_id,profile" });

  if (profileError) {
    throw profileError;
  }

  const { error: sourceError } = await adminClient
    .from("apolo_source_links")
    .upsert(sourceRows, { onConflict: "source_system,source_table,source_id" });

  if (sourceError) {
    throw sourceError;
  }

  await upsertApoloRows(adminClient, "apolo_entity_identifiers", identifierRows, {
    onConflict: "entity_id,identifier_type,value_hash",
  });
  await upsertApoloRows(adminClient, "apolo_contacts", contactRows);
  await upsertApoloRows(adminClient, "apolo_addresses", addressRows);
  await upsertApoloRows(adminClient, "apolo_relationships", relationshipRows);
  await upsertApoloRows(adminClient, "apolo_commercial_links", commercialRows);
  await upsertApoloRows(adminClient, "apolo_financial_snapshots", financialRows);
  await upsertApoloRows(adminClient, "apolo_documents", documentRows);
  await upsertApoloRows(adminClient, "apolo_timeline_events", timelineRows);
  await upsertApoloRows(adminClient, "apolo_audit_events", auditRows);
  await upsertApoloRows(adminClient, "apolo_module_records", moduleRows, {
    onConflict: "module_key,record_type,record_id",
  });
  await upsertApoloRows(adminClient, "apolo_search_entries", searchRows, {
    onConflict: "entity_id",
  });

  return (
    entityRows.length +
    profileRows.length +
    sourceRows.length +
    identifierRows.length +
    contactRows.length +
    addressRows.length +
    relationshipRows.length +
    commercialRows.length +
    financialRows.length +
    documentRows.length +
    timelineRows.length +
    auditRows.length +
    moduleRows.length +
    searchRows.length
  );
}

async function upsertApoloRows(
  adminClient: ApoloSupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  options: { onConflict?: string } = { onConflict: "id" },
) {
  if (rows.length === 0) {
    return;
  }

  const { error } = await adminClient.from(table).upsert(rows, options);

  if (error) {
    throw error;
  }
}

function buildIdentifierRows(
  user: C2xUserRow,
  syncRunId: string,
  syncedAt: string,
) {
  const entityId = deterministicUuid(`apolo:c2x:users:${user.id}`);
  const identifiers: Array<{
    identifier_type:
      | "cnpj"
      | "cpf"
      | "email"
      | "legacy_id"
      | "phone";
    rawValue: string;
    maskedValue: string;
  }> = [
    {
      identifier_type: "legacy_id",
      maskedValue: String(user.id),
      rawValue: String(user.id),
    },
  ];
  const document = user.cpf ?? user.cnpj;

  if (document && documentKind(document)) {
    identifiers.push({
      identifier_type: documentKind(document) as "cnpj" | "cpf",
      maskedValue: maskDocument(document),
      rawValue: onlyDigits(document),
    });
  }

  if (user.email) {
    identifiers.push({
      identifier_type: "email",
      maskedValue: maskEmail(user.email),
      rawValue: user.email.trim().toLowerCase(),
    });
  }

  for (const phone of [user.cellphone, user.phone]) {
    if (phone) {
      identifiers.push({
        identifier_type: "phone",
        maskedValue: maskPhone(phone),
        rawValue: onlyDigits(phone),
      });
    }
  }

  return identifiers
    .filter((identifier) => identifier.rawValue)
    .map((identifier) => {
      const valueHash = hashIdentifier(
        identifier.identifier_type,
        identifier.rawValue,
      );

      return {
        confidence_score: identifier.identifier_type === "legacy_id" ? 100 : 80,
        entity_id: entityId,
        identifier_type: identifier.identifier_type,
        is_primary:
          identifier.identifier_type === "cpf" ||
          identifier.identifier_type === "cnpj" ||
          identifier.identifier_type === "legacy_id",
        metadata: {
          syncRunId,
        },
        source_system: "c2x",
        updated_at: syncedAt,
        value_hash: valueHash,
        value_masked: identifier.maskedValue,
      };
    });
}

function buildContactRows(user: C2xUserRow, syncedAt: string) {
  const entityId = deterministicUuid(`apolo:c2x:users:${user.id}`);
  const contacts: Array<{
    contact_type: "email" | "phone" | "whatsapp";
    label: string;
    rawValue: string | null;
  }> = [
    {
      contact_type: "whatsapp",
      label: "Celular",
      rawValue: user.cellphone,
    },
    {
      contact_type: "phone",
      label: "Telefone",
      rawValue: user.phone && user.phone !== user.cellphone ? user.phone : null,
    },
    {
      contact_type: "email",
      label: "E-mail",
      rawValue: user.email,
    },
  ];

  return contacts
    .filter((contact) => contact.rawValue)
    .map((contact) => ({
      contact_type: contact.contact_type,
      entity_id: entityId,
      id: deterministicUuid(
        `apolo:c2x:users:${user.id}:contact:${contact.contact_type}:${contact.rawValue}`,
      ),
      is_primary: contact.contact_type === "whatsapp" || contact.contact_type === "email",
      label: contact.label,
      normalized_value: hashIdentifier(contact.contact_type, contact.rawValue ?? ""),
      status: "pending",
      updated_at: syncedAt,
      value: contact.rawValue ?? "",
    }));
}

function buildAddressRows(user: C2xUserRow, syncedAt: string) {
  const location = splitLocation(user.location_label);

  if (!location.city && !location.state) {
    return [];
  }

  return [
    {
      city: location.city,
      entity_id: deterministicUuid(`apolo:c2x:users:${user.id}`),
      id: deterministicUuid(`apolo:c2x:users:${user.id}:address:primary`),
      is_primary: true,
      label: "Principal",
      state: location.state,
      status: "pending",
      street: "Endereco cadastral",
      updated_at: syncedAt,
    },
  ];
}

function buildRelationshipRows(user: C2xUserRow, syncedAt: string) {
  return buildC2xRelationships(user).map((relationship) => ({
    entity_id: deterministicUuid(`apolo:c2x:users:${user.id}`),
    id: deterministicUuid(
      `apolo:c2x:users:${user.id}:relationship:${relationship.relation}:${relationship.label}`,
    ),
    label: relationship.label,
    relationship_type: relationship.relation,
    status: relationship.status,
    updated_at: syncedAt,
  }));
}

function buildCommercialRows(user: C2xUserRow, syncedAt: string) {
  return buildC2xCommercialLinks(user).map((link) => ({
    entity_id: deterministicUuid(`apolo:c2x:users:${user.id}`),
    enterprise_name: link.enterprise,
    id: deterministicUuid(
      `apolo:c2x:users:${user.id}:commercial:${link.role}:${link.unit}`,
    ),
    metadata: {
      acquisitionRequestId: link.acquisitionRequestId ?? null,
      area: link.area ?? null,
      block: link.block ?? null,
      brokerAgency: link.brokerAgency ?? null,
      contractDocumentId: link.contractDocumentId ?? null,
      contractStatus: link.contractStatus ?? null,
      contractUrl: link.contractUrl ?? null,
      enterpriseCode: link.enterpriseCode ?? null,
      lot: link.lot ?? null,
      sourceSystem: "c2x",
      tableValue: link.tableValue ?? null,
      unitCode: link.unitCode ?? null,
      unitId: link.unitId ?? null,
    },
    reference_label: link.referenceLabel,
    relationship_role: link.role,
    stage_label: link.stage,
    status: "active",
    unit_label: link.unit,
    updated_at: syncedAt,
  }));
}

function buildFinancialRow(user: C2xUserRow, syncedAt: string) {
  const financial = buildC2xFinancialSnapshot(user);

  return {
    entity_id: deterministicUuid(`apolo:c2x:users:${user.id}`),
    id: deterministicUuid(`apolo:c2x:users:${user.id}:financial:${syncedAt.slice(0, 10)}`),
    metadata: {
      billedRequestCount: toNumber(user.billed_request_count),
      paymentCount: toNumber(user.payment_count),
      requestCount: toNumber(user.request_count),
      unitCount: toNumber(user.unit_count),
    },
    overdue_amount: toNumber(user.overdue_amount),
    overdue_installments: financial.overdueInstallments,
    paid_amount: toNumber(user.paid_amount),
    payment_behavior: financial.paymentBehavior,
    risk_level: financial.risk,
    snapshot_date: syncedAt.slice(0, 10),
    total_portfolio_amount: toNumber(user.total_portfolio_amount),
    updated_at: syncedAt,
  };
}

function buildDocumentRows(user: C2xUserRow, syncedAt: string) {
  const document = user.cpf ?? user.cnpj ?? null;
  const documentDisplay = formatDocumentForDisplay(document);

  return buildC2xDocuments(documentDisplay).map((documentSignal) => ({
    document_type: "identity",
    entity_id: deterministicUuid(`apolo:c2x:users:${user.id}`),
    id: deterministicUuid(`apolo:c2x:users:${user.id}:document:${documentSignal.label}`),
    label: documentSignal.label,
    metadata: {
      requestCount: toNumber(user.request_count),
    },
    status: documentSignal.status,
    updated_at: syncedAt,
  }));
}

function buildTimelineRows(user: C2xUserRow, syncedAt: string) {
  const document = user.cpf ?? user.cnpj ?? null;
  const documentDisplay = formatDocumentForDisplay(document);
  const relationships = buildC2xRelationships(user);
  const status = deriveC2xEntityStatus(user, documentDisplay, relationships);

  return buildC2xTimeline(user, status).map((event) => ({
    description: event.description,
    entity_id: deterministicUuid(`apolo:c2x:users:${user.id}`),
    event_type: "cadastro",
    id: deterministicUuid(`apolo:c2x:users:${user.id}:timeline:${event.title}`),
    metadata: {
      billedRequestCount: toNumber(user.billed_request_count),
      paymentCount: toNumber(user.payment_count),
      requestCount: toNumber(user.request_count),
      unitCount: toNumber(user.unit_count),
    },
    occurred_at: user.updated_at ?? syncedAt,
    status: event.status,
    title: event.title,
    updated_at: syncedAt,
  }));
}

function buildAuditRows(user: C2xUserRow, syncedAt: string) {
  return buildC2xAudit(user).map((audit) => ({
    action: "mapped",
    created_at: syncedAt,
    entity_id: deterministicUuid(`apolo:c2x:users:${user.id}`),
    field_name: audit.field,
    id: deterministicUuid(`apolo:c2x:users:${user.id}:audit:${audit.field}`),
    metadata: {
      paymentCount: toNumber(user.payment_count),
      requestCount: toNumber(user.request_count),
      unitCount: toNumber(user.unit_count),
    },
    status: audit.status,
  }));
}

function buildSearchRow(user: C2xUserRow, syncedAt: string) {
  const profiles = mapC2xProfiles(user.profile_id, user.person_type_id, hasC2xPortfolioPurchase(user));
  const profileLabels = profiles.map((profile) => apoloProfileLabels[profile]);
  const document = user.cpf ?? user.cnpj ?? null;
  const documentDisplay = formatDocumentForDisplay(document);
  const entityKind = deriveC2xEntityKind(user);
  const relationships = buildC2xRelationships(user);
  const status = deriveC2xEntityStatus(user, documentDisplay, relationships);
  const displayName = user.display_name?.trim() || `Cadastro ${user.id}`;
  const location = normalizeLocationLabel(user.location_label);
  const buyerSearchLabel = hasC2xPortfolioPurchase(user)
    ? toNumber(user.overdue_installments) > 0
      ? "usuario inadimplente"
      : "usuario adimplente"
    : "prospect sem compra";

  return {
    display_name: displayName,
    document_masked: documentDisplay,
    entity_id: deterministicUuid(`apolo:c2x:users:${user.id}`),
    entity_kind: entityKind,
    last_synced_at: syncedAt,
    location_label: location,
    metadata: {
      sourceSystem: "c2x",
    },
    normalized_text: normalizeSearchText(
      [
        displayName,
        legalNameFromC2x(user),
        tradeNameFromC2x(user),
        documentDisplay,
        location,
        buyerSearchLabel,
        user.linked_party_name,
        user.profile_name,
        user.latest_enterprise_name,
        user.latest_paid_enterprise_name,
        user.latest_paid_request_code,
        user.latest_paid_stage_name,
        user.latest_paid_unit_block,
        user.latest_paid_unit_code,
        user.latest_paid_unit_label,
        user.latest_paid_unit_lot,
        user.latest_request_code,
        user.latest_stage_name,
        user.latest_unit_label,
        ...profileLabels,
      ].join(" "),
    ),
    profile_labels: profileLabels,
    quality_score: deriveC2xConfidenceScore(
      user,
      buildMaskedContacts(user),
      relationships,
      documentDisplay,
    ),
    status,
    updated_at: syncedAt,
  };
}

function buildC2xProfileSummaries(
  rows: C2xProfileAggregateRow[],
  commerceCounts?: {
    buyerUsersCount: number;
    prospectUsersCount: number;
  },
): ApoloProfileSummary[] {
  const counts = new Map<ApoloProfile, number>();

  for (const row of rows) {
    if (commerceCounts && row.profile_id === 2) {
      continue;
    }

    for (const profile of mapC2xProfiles(row.profile_id, null).filter(
      (profile) => !profile.startsWith("pessoa_"),
    )) {
      counts.set(profile, (counts.get(profile) ?? 0) + toNumber(row.total));
    }
  }

  if (commerceCounts) {
    counts.set("usuario", commerceCounts.buyerUsersCount);
    counts.set("prospect", commerceCounts.prospectUsersCount);
  }

  return apoloProfileCardOrder.map((profile) => ({
    count: counts.get(profile) ?? 0,
    label: apoloProfileLabels[profile],
    profile,
  }));
}

function mapC2xProfiles(
  profileId: number | null,
  personTypeId: number | null,
  hasPaymentPortfolio?: boolean,
): ApoloProfile[] {
  const profiles: ApoloProfile[] = [];

  if (profileId === 1 || profileId === 5) {
    profiles.push("colaborador");
  } else if (profileId === 2) {
    profiles.push(hasPaymentPortfolio === false ? "prospect" : "usuario");
  } else if (profileId === 3) {
    profiles.push("incorporador");
  } else if (profileId === 4) {
    profiles.push("acesso_incorporador");
  } else if (profileId === 6) {
    profiles.push("imobiliaria");
  } else if (profileId === 7) {
    profiles.push("corretor");
  }

  if (personTypeId === 1) {
    profiles.push("pessoa_fisica");
  } else if (personTypeId === 2) {
    profiles.push("pessoa_juridica");
  }

  return uniqueProfiles(profiles);
}

function profilesFromEntityKind(entityKind: string): ApoloProfile[] {
  if (entityKind === "pf") {
    return ["pessoa_fisica"];
  }

  if (entityKind === "pj" || entityKind === "organization") {
    return ["pessoa_juridica"];
  }

  return ["colaborador"];
}

function normalizeCommerceProfiles(
  profiles: ApoloProfile[],
  commercialLinks: ApoloCommercialLink[],
) {
  const unique = uniqueProfiles(profiles);
  const hasC2xUserProfile = unique.includes("usuario") || unique.includes("prospect");

  if (!hasC2xUserProfile) {
    return unique;
  }

  const hasPaymentPortfolio = commercialLinks.some((link) =>
    isBuyerCommercialRole(link.role) && hasCommercialPortfolioEvidence(link),
  );
  const normalizedUserProfile: ApoloProfile = hasPaymentPortfolio ? "usuario" : "prospect";

  return uniqueProfiles([
    normalizedUserProfile,
    ...unique.filter((profile) => profile !== "usuario" && profile !== "prospect"),
  ]);
}

function normalizeApoloProfile(profile: string): ApoloProfile | null {
  return apoloProfileOptionsSet.has(profile) ? (profile as ApoloProfile) : null;
}

const apoloProfileOptionsSet = new Set<string>([
  "usuario",
  "prospect",
  "incorporador",
  "imobiliaria",
  "corretor",
  "fornecedor",
  "parceiro",
  "colaborador",
  "acesso_incorporador",
  "pessoa_fisica",
  "pessoa_juridica",
]);

function deriveC2xEntityKind(row: C2xUserRow): ApoloEntityKind {
  if (row.profile_id === 1 || row.profile_id === 5) {
    return "internal";
  }

  if (row.person_type_id === 2) {
    return "pj";
  }

  if (row.person_type_id === 1) {
    return "pf";
  }

  return row.profile_id === 3 || row.profile_id === 6 ? "organization" : "pf";
}

function normalizeEntityKind(value: string): ApoloEntityKind {
  if (value === "pf" || value === "pj" || value === "internal" || value === "organization") {
    return value;
  }

  return "pf";
}

function deriveC2xEntityStatus(
  row: C2xUserRow,
  documentMasked: string,
  relationships: ApoloRelationship[],
): ApoloEntityStatus {
  if (row.profile_id === 2 && !row.vinculed_by_id) {
    return "attention";
  }

  if (documentMasked === "Documento em revisao") {
    return "review";
  }

  if (relationships.some((relationship) => relationship.status !== "verified")) {
    return "review";
  }

  return "active";
}

function normalizeEntityStatus(status: string | null): ApoloEntityStatus {
  if (status === "active" || status === "attention" || status === "blocked" || status === "review") {
    return status;
  }

  return "review";
}

function deriveC2xNextAction(row: C2xUserRow, status: ApoloEntityStatus) {
  if (row.profile_id === 2 && !row.vinculed_by_id) {
    return "Confirmar vinculo comercial";
  }

  if (status === "review") {
    return "Revisar completude cadastral";
  }

  return "Cadastro operacional ativo";
}

function deriveC2xConfidenceScore(
  row: C2xUserRow,
  contacts: ApoloContactPoint[],
  relationships: ApoloRelationship[],
  documentMasked: string,
) {
  let score = 45;

  if (row.display_name) score += 15;
  if (documentMasked !== "Documento em revisao") score += 15;
  if (contacts.length > 0) score += 10;
  if (row.location_label) score += 5;
  if (!row.profile_id || row.profile_id === 2) {
    score += relationships.some((relationship) => relationship.status === "verified") ? 10 : 0;
  } else {
    score += 10;
  }

  return clampScore(score);
}

function buildMaskedContacts(row: C2xUserRow): ApoloContactPoint[] {
  const contacts: ApoloContactPoint[] = [];

  if (row.cellphone) {
    contacts.push({
      label: "Celular",
      status: "pending",
      type: "whatsapp",
      value: row.cellphone,
    });
  }

  if (row.phone && row.phone !== row.cellphone) {
    contacts.push({
      label: "Telefone",
      status: "pending",
      type: "phone",
      value: row.phone,
    });
  }

  if (row.email) {
    contacts.push({
      label: "E-mail",
      status: "pending",
      type: "email",
      value: row.email,
    });
  }

  return contacts.slice(0, 3);
}

function buildC2xAddresses(row: C2xUserRow): ApoloAddress[] {
  const location = splitLocation(row.location_label);

  if (!location.city && !location.state) {
    return [];
  }

  return [
    {
      city: location.city || "Cidade em revisao",
      label: "Principal",
      state: location.state || "UF",
      status: "pending",
      value: "Endereco cadastral",
    },
  ];
}

function buildC2xRelationships(row: C2xUserRow): ApoloRelationship[] {
  if (row.profile_id === 2) {
    return [
      {
        label: row.linked_party_name || "Vinculo comercial pendente",
        relation: "Imobiliaria ou responsavel comercial",
        status: row.vinculed_by_id ? "verified" : "attention",
      },
    ];
  }

  if (row.profile_id === 6) {
    return [
      {
        label: "Usuarios vinculados",
        relation: "Vinculo comercial",
        status: "pending",
      },
    ];
  }

  if (row.profile_id === 7) {
    return [
      {
        label: "Carteira comercial",
        relation: "Corretagem",
        status: "pending",
      },
    ];
  }

  return [];
}

function buildC2xCommercialLinks(row: C2xUserRow): ApoloCommercialLink[] {
  if (row.profile_id === 2) {
    const requestCount = toNumber(row.request_count);
    const billedRequestCount = toNumber(row.billed_request_count);

    if (hasC2xPortfolioPurchase(row)) {
      const paidBlock = normalizeC2xBlock(row.latest_paid_unit_block);
      const paidLot = normalizeC2xLot(row.latest_paid_unit_lot);
      const paidUnitCode = firstFilled(row.latest_paid_unit_code) ?? undefined;
      const paidUnitLabel = c2xUnitLabel(
        paidBlock,
        paidLot,
        firstFilled(row.latest_paid_unit_label) ?? paidUnitCode,
      );
      const enterprise =
        firstFilled(row.latest_paid_enterprise_name) ??
        firstFilled(row.latest_enterprise_name) ??
        "-";
      const brokerAgency = firstFilled(row.linked_party_name);
      const stage =
        firstFilled(row.latest_paid_stage_name) ??
        firstFilled(row.latest_stage_name) ??
        (billedRequestCount > 0 ? "Faturado" : "Carteira financeira");

      return [
        {
          acquisitionRequestId: optionalString(row.latest_paid_request_id),
          area: formatC2xArea(row.latest_paid_area),
          block: paidBlock,
          brokerAgency: brokerAgency ?? undefined,
          contractDocumentId: firstFilled(row.latest_paid_contract_document_id) ?? undefined,
          contractStatus: firstFilled(row.latest_paid_contract_status) ?? undefined,
          contractUrl: firstFilled(row.latest_paid_contract_url) ?? undefined,
          enterprise,
          enterpriseCode: firstFilled(row.latest_paid_enterprise_code) ?? undefined,
          lot: paidLot,
          referenceLabel:
            brokerAgency ??
            firstFilled(row.latest_paid_request_code) ??
            firstFilled(row.latest_request_code) ??
            "Pagamento vinculado",
          role: "Usuario",
          stage,
          tableValue: positiveCurrencyOrEmpty(row.latest_paid_unit_price),
          unit: paidUnitLabel,
          unitCode: paidUnitCode,
          unitId: optionalString(row.latest_paid_unit_id),
        },
      ];
    }

    if (requestCount > 0) {
      return [
        {
          enterprise: firstFilled(row.latest_enterprise_name) ?? "Jornada comercial",
          referenceLabel:
            firstFilled(row.linked_party_name) ??
            firstFilled(row.latest_request_code) ??
            "Vinculo comercial sem pagamento",
          role: "Prospect",
          stage: firstFilled(row.latest_stage_name) ?? "Sem pagamento vinculado",
          unit: firstFilled(row.latest_unit_label) ?? "Unidade em qualificacao",
        },
      ];
    }

    return [
      {
        enterprise: "Relacionamento cadastral",
        referenceLabel: row.linked_party_name ? "Vinculo comercial identificado" : "Vinculo pendente",
        role: "Prospect",
        stage: "Sem compra vinculada",
        unit: row.linked_party_name || "Sem carteira operacional",
      },
    ];
  }

  return [
    {
      enterprise: "Relacionamento Careli",
      referenceLabel: row.profile_name || "Perfil cadastral",
      role: apoloProfileLabels[mapC2xProfiles(row.profile_id, null)[0] ?? "usuario"],
      stage: "Cadastro ativo",
      unit: normalizeLocationLabel(row.location_label),
    },
  ];
}

function buildC2xFinancialSnapshot(row: C2xUserRow): ApoloFinancialSnapshot {
  const overdueInstallments = toNumber(row.overdue_installments);
  const paymentCount = toNumber(row.payment_count);
  const requestCount = toNumber(row.request_count);
  const billedRequestCount = toNumber(row.billed_request_count);
  const unitCount = toNumber(row.unit_count);

  if (paymentCount === 0) {
    return {
      overdueAmount: "A consultar",
      overdueInstallments: 0,
      paidAmount: "A consultar",
      paymentBehavior:
        requestCount > 0
          ? `${requestCount} vinculo(s) comercial(is) identificado(s), mas sem pagamento vinculado para abrir carteira.`
          : "Sem pagamento vinculado ao cadastro.",
      risk: "baixo",
      totalPortfolio: "A consultar",
    };
  }

  return {
    overdueAmount: formatCurrency(row.overdue_amount),
    overdueInstallments,
    paidAmount: formatCurrency(row.paid_amount),
    paymentBehavior:
      `${paymentCount} pagamento(s), ${unitCount} unidade(s), ${billedRequestCount} faturado(s) e ${overdueInstallments} parcela(s) em atraso.`,
    risk: overdueInstallments >= 7 ? "critico" : overdueInstallments >= 3 ? "alto" : overdueInstallments > 0 ? "medio" : "baixo",
    totalPortfolio: formatCurrency(row.total_portfolio_amount),
  };
}

function buildC2xDocuments(documentMasked: string): ApoloDocumentSignal[] {
  return [
    {
      label: "Documento principal",
      status: documentMasked === "Documento em revisao" ? "pending_review" : "ready",
      updatedAt: documentMasked === "Documento em revisao" ? "Revisao pendente" : "Disponivel",
    },
  ];
}

function buildC2xTimeline(row: C2xUserRow, status: ApoloEntityStatus): ApoloTimelineEvent[] {
  const events: ApoloTimelineEvent[] = [
    {
      date: formatDateLabel(row.updated_at),
      description: "Cadastro carregado para composicao do relacionamento 360.",
      status: status === "active" ? "ok" : "attention",
      title: status === "active" ? "Cadastro ativo" : "Cadastro em revisao",
    },
  ];

  if (toNumber(row.request_count) > 0) {
    events.unshift({
      date: formatDateLabel(row.updated_at),
      description: `${firstFilled(row.latest_enterprise_name) ?? "Carteira"} / ${firstFilled(row.latest_unit_label) ?? "unidade vinculada"} - ${firstFilled(row.latest_stage_name) ?? "venda vinculada"}.`,
      status: "ok",
      title: "Vinculo comercial identificado",
    });
  }

  if (toNumber(row.payment_count) > 0) {
    events.unshift({
      date: formatDateLabel(row.updated_at),
      description: `${firstFilled(row.latest_paid_enterprise_name) ?? "Carteira"} / ${firstFilled(row.latest_paid_unit_label) ?? "unidade vinculada"} - ${toNumber(row.payment_count)} pagamento(s) encontrado(s).`,
      status: "ok",
      title: "Carteira financeira identificada",
    });
  }

  return events;
}

function buildC2xAudit(row: C2xUserRow): ApoloAuditSignal[] {
  return [
    {
      field: "Perfil",
      status: row.profile_id ? "mapped" : "pending",
      updatedAt: formatDateLabel(row.updated_at),
    },
    {
      field: "Documento",
      status: row.cpf || row.cnpj ? "mapped" : "pending",
      updatedAt: formatDateLabel(row.updated_at),
    },
    {
      field: "Vinculo comercial",
      status: toNumber(row.request_count) > 0 || row.vinculed_by_id ? "mapped" : "pending",
      updatedAt: formatDateLabel(row.updated_at),
    },
    {
      field: "Carteira",
      status: toNumber(row.payment_count) > 0 ? "mapped" : "pending",
      updatedAt: formatDateLabel(row.updated_at),
    },
  ];
}

function mapApoloContactRow(row: ApoloContactRow): ApoloContactPoint {
  const type = normalizeContactType(row.contact_type);

  return {
    label: row.label ?? contactTypeLabel(row.contact_type),
    status: normalizeSmallStatus(row.status),
    type,
    value: row.value,
  };
}

function mapApoloAddressRow(row: ApoloAddressRow): ApoloAddress {
  return {
    city: row.city ?? "Cidade em revisao",
    complement: row.complement ?? undefined,
    district: row.district ?? undefined,
    label: row.label ?? "Endereco",
    number: row.number ?? undefined,
    postalCode: row.postal_code ?? undefined,
    state: row.state ?? "UF",
    status: normalizeSmallStatus(row.status),
    value: row.street ?? "Endereco cadastral",
  };
}

function mapApoloRelationshipRow(row: ApoloRelationshipRow): ApoloRelationship {
  return {
    label: row.label ?? row.relationship_type,
    relation: row.relationship_type,
    status: normalizeSmallStatus(row.status),
  };
}

function metadataRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = metadata[key];

  if (typeof value === "string") {
    return firstFilled(value) ?? undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function mapApoloCommercialRow(row: ApoloCommercialLinkRow): ApoloCommercialLink {
  const metadata = metadataRecord(row.metadata);

  return {
    acquisitionRequestId: metadataString(metadata, "acquisitionRequestId"),
    area: metadataString(metadata, "area"),
    block: metadataString(metadata, "block"),
    brokerAgency: metadataString(metadata, "brokerAgency"),
    contractDocumentId: metadataString(metadata, "contractDocumentId"),
    contractStatus: metadataString(metadata, "contractStatus"),
    contractUrl: metadataString(metadata, "contractUrl"),
    enterprise: row.enterprise_name ?? "Relacionamento Careli",
    enterpriseCode: metadataString(metadata, "enterpriseCode"),
    installments: mapMetadataInstallments(metadata.installments),
    lot: metadataString(metadata, "lot"),
    referenceLabel: row.reference_label ?? "Cadastro",
    role: row.relationship_role ?? "Relacionamento",
    stage: row.stage_label ?? "Ativo",
    tableValue: metadataString(metadata, "tableValue"),
    unit: row.unit_label ?? "Sem unidade",
    unitCode: metadataString(metadata, "unitCode"),
    unitId: metadataString(metadata, "unitId"),
  };
}

function mapMetadataInstallments(value: unknown): ApoloInstallment[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const installments: ApoloInstallment[] = [];

  for (const rawItem of value) {
    const item = metadataRecord(rawItem);
    const id = metadataString(item, "id");
    const acquisitionRequestId = metadataString(item, "acquisitionRequestId");
    const number = metadataString(item, "number");
    const status = metadataString(item, "status");

    if (!id || !acquisitionRequestId || !number) {
      continue;
    }

    installments.push({
      acquisitionRequestId,
      asaasPaymentId: metadataString(item, "asaasPaymentId"),
      dueDate: metadataString(item, "dueDate") ?? "Sem data",
      id,
      invoiceUrl: metadataString(item, "invoiceUrl"),
      number,
      overdueDays: toNumber(item.overdueDays),
      paidAt: metadataString(item, "paidAt"),
      paymentUrl: metadataString(item, "paymentUrl"),
      reference: metadataString(item, "reference") ?? "-",
      status:
        status === "Liquidada" || status === "A vencer" || status === "Vencida"
          ? status
          : "Vencida",
      value: metadataString(item, "value") ?? "A consultar",
      valueNumber: toNumber(item.valueNumber),
    });
  }

  return installments;
}

function mapApoloFinancialRow(row: ApoloFinancialRow | undefined): ApoloFinancialSnapshot {
  if (!row) {
    return emptyFinancialSnapshot();
  }

  return {
    overdueAmount: formatCurrency(row.overdue_amount),
    overdueInstallments: row.overdue_installments ?? 0,
    paidAmount: formatCurrency(row.paid_amount),
    paymentBehavior: row.payment_behavior ?? "Financeiro em sincronizacao.",
    risk: normalizeRisk(row.risk_level),
    totalPortfolio: formatCurrency(row.total_portfolio_amount),
  };
}

function mapApoloServiceRow(row: ApoloServiceRow): ApoloServiceSignal {
  return {
    channel: row.channel,
    lastEvent: row.last_event ?? "Sem evento recente",
    protocol: row.protocol ?? "Sem protocolo",
    status: row.status ?? "Aberto",
  };
}

function mapApoloDocumentRow(row: ApoloDocumentRow): ApoloDocumentSignal {
  return {
    label: row.label,
    status: normalizeDocumentStatus(row.status),
    updatedAt: formatDateLabel(row.updated_at),
  };
}

function mapApoloTimelineRow(row: ApoloTimelineRow): ApoloTimelineEvent {
  return {
    date: formatDateLabel(row.occurred_at),
    description: row.description ?? "Evento cadastral.",
    status: normalizeTimelineStatus(row.status),
    title: row.title,
  };
}

function mapApoloAuditRow(row: ApoloAuditRow): ApoloAuditSignal {
  return {
    field: row.field_name ?? "Campo cadastral",
    status: normalizeAuditStatus(row.status),
    updatedAt: formatDateLabel(row.created_at),
  };
}

function hadesClientIdFromSourceLinks(sourceLinks: ApoloSourceLinkRow[]) {
  const c2xUserLink = sourceLinks.find(
    (link) =>
      link.source_system === "c2x" &&
      link.source_table === "users" &&
      /^\d+$/.test(String(link.source_id ?? "")),
  );

  return c2xUserLink ? `c2x-client-${c2xUserLink.source_id}` : undefined;
}

function emptyFinancialSnapshot(): ApoloFinancialSnapshot {
  return {
    overdueAmount: "A consultar",
    overdueInstallments: 0,
    paidAmount: "A consultar",
    paymentBehavior: "Financeiro aguardando leitura consolidada.",
    risk: "baixo",
    totalPortfolio: "A consultar",
  };
}

function emptyApoloDashboard(
  message: string,
  source: ApoloDashboardData["meta"]["source"],
  status: ApoloDashboardData["meta"]["status"],
): ApoloDashboardData {
  return {
    buyerUsersCount: 0,
    entities: [],
    linkedUsersCount: 0,
    meta: {
      generatedAt: new Date().toISOString(),
      message,
      source,
      status,
    },
    nonBuyerUsersCount: 0,
    pendingReviewCount: 0,
    portfolioPaymentsCount: 0,
    portfolioUnitsCount: 0,
    profileSummaries: apoloProfileCardOrder.map((profile) => ({
      count: 0,
      label: apoloProfileLabels[profile],
      profile,
    })),
    totalCount: 0,
  };
}

function sumProfileMetric(
  rows: C2xProfileAggregateRow[],
  profileId: number,
  metric: "total" | "with_vinculed_by",
) {
  return toNumber(rows.find((row) => row.profile_id === profileId)?.[metric]);
}

function matchesLiveC2xCandidateOptions(
  row: C2xUserRow,
  options: ApoloDashboardOptions,
) {
  if (
    options.profile &&
    !matchesLiveC2xCandidateProfile(row, options.profile)
  ) {
    return false;
  }

  return matchesDashboardOptions(
    mapC2xUserToApoloEntity(row),
    {
      ...options,
      profile: null,
    },
  );
}

function matchesLiveC2xCandidateProfile(
  row: C2xUserRow,
  profile: ApoloProfile,
) {
  if (profile === "usuario") {
    return hasC2xPortfolioPurchase(row);
  }

  if (profile === "prospect") {
    return row.profile_id === 2 && !hasC2xPortfolioPurchase(row);
  }

  return mapC2xProfiles(
    row.profile_id,
    row.person_type_id,
    hasC2xPortfolioPurchase(row),
  ).includes(profile);
}

function matchesDashboardOptions(
  entity: ApoloEntity,
  options: ApoloDashboardOptions,
) {
  if (options.profile && !entity.profiles.includes(options.profile)) {
    return false;
  }

  const query = normalizeSearchText(options.query ?? "");

  if (!query) {
    return true;
  }

  return normalizeSearchText(
    [
      entity.displayName,
      entity.documentMasked,
      entity.locationLabel,
      entity.profiles.join(" "),
      entity.commercialLinks
        .map((link) => `${link.enterprise} ${link.unit} ${link.role} ${link.referenceLabel}`)
        .join(" "),
      entity.contacts.map((contact) => contact.value).join(" "),
      entity.relationships.map((relationship) => relationship.label).join(" "),
    ].join(" "),
  ).includes(query);
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}

function clampScore(value: number) {
  return Math.min(100, Math.max(0, Math.trunc(value)));
}

function uniqueProfiles(profiles: ApoloProfile[]) {
  return Array.from(new Set(profiles));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function groupRowsBy<T extends Record<string, unknown>>(rows: T[], key: keyof T) {
  const map = new Map<string, T[]>();

  for (const row of rows) {
    const value = row[key];

    if (!value) {
      continue;
    }

    const normalizedValue = String(value);
    map.set(normalizedValue, [...(map.get(normalizedValue) ?? []), row]);
  }

  return map;
}

function normalizeContactType(value: string): ApoloContactPoint["type"] {
  if (value === "email" || value === "phone" || value === "whatsapp") {
    return value;
  }

  return "phone";
}

function contactTypeLabel(value: string) {
  if (value === "email") return "E-mail";
  if (value === "whatsapp") return "WhatsApp";
  return "Telefone";
}

function normalizeSmallStatus(value: string | null): "attention" | "pending" | "verified" {
  if (value === "verified") {
    return "verified";
  }

  if (value === "attention" || value === "blocked") {
    return "attention";
  }

  return "pending";
}

function normalizeRisk(value: string | null): ApoloFinancialSnapshot["risk"] {
  if (value === "baixo" || value === "medio" || value === "alto" || value === "critico") {
    return value;
  }

  return "baixo";
}

function normalizeDocumentStatus(value: string | null): ApoloDocumentSignal["status"] {
  if (value === "ready" || value === "blocked" || value === "pending_review") {
    return value;
  }

  return "pending_review";
}

function normalizeTimelineStatus(value: string | null): ApoloTimelineEvent["status"] {
  if (value === "ok" || value === "attention" || value === "blocked") {
    return value;
  }

  return "ok";
}

function normalizeAuditStatus(value: string | null): ApoloAuditSignal["status"] {
  if (value === "mapped" || value === "pending" || value === "blocked") {
    return value;
  }

  return "pending";
}

function visibleDocumentValue(value: string | null | undefined) {
  const normalized = firstFilled(value);

  if (!normalized || normalized.includes("*")) {
    return "Documento em revisao";
  }

  return normalized;
}

function formatDocumentForDisplay(value: string | null | undefined) {
  const digits = onlyDigits(value);

  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }

  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }

  return "Documento em revisao";
}

function maskDocument(value: string | null | undefined) {
  const digits = onlyDigits(value);

  if (digits.length === 11) {
    return `***.***.***-${digits.slice(-2)}`;
  }

  if (digits.length === 14) {
    return `**.***.***/****-${digits.slice(-2)}`;
  }

  return "Documento em revisao";
}

function maskPhone(value: string) {
  const digits = onlyDigits(value);

  if (!digits) {
    return "Telefone em revisao";
  }

  return `(**) *****-**${digits.slice(-2)}`;
}

function maskEmail(value: string) {
  const [local, domain] = value.split("@");

  if (!local || !domain) {
    return "E-mail em revisao";
  }

  return `${local.slice(0, 1)}***@${domain}`;
}

function onlyDigits(value: string | null | undefined) {
  return value?.replace(/\D/g, "") ?? "";
}

function firstFilled(value: string | null | undefined) {
  const normalized = value?.trim();

  return normalized || null;
}

function optionalString(value: number | string | null | undefined) {
  const normalized = String(value ?? "").trim();

  return normalized || undefined;
}

function legalNameFromC2x(row: C2xUserRow) {
  return (
    firstFilled(row.social_name) ??
    firstFilled(row.user_name) ??
    firstFilled(row.display_name) ??
    null
  );
}

function tradeNameFromC2x(row: C2xUserRow) {
  return (
    firstFilled(row.fantasy_name) ??
    firstFilled(row.display_name) ??
    firstFilled(row.social_name) ??
    firstFilled(row.user_name) ??
    null
  );
}

function hashIdentifier(type: string, value: string) {
  return createHash("sha256")
    .update(`apolo-identifier:${type}:${value.trim().toLowerCase()}`)
    .digest("hex");
}

function documentKind(value: string | null | undefined) {
  const digits = onlyDigits(value);

  if (digits.length === 11) {
    return "cpf";
  }

  if (digits.length === 14) {
    return "cnpj";
  }

  return null;
}

function deterministicUuid(seed: string) {
  const chars = createHash("sha1").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = (8 + (Number.parseInt(chars[16] ?? "0", 16) % 4)).toString(16);
  const hex = chars.join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function splitLocation(value: string | null | undefined) {
  const [city, state] = (value ?? "")
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    city: city ?? null,
    state: state ?? null,
  };
}

function normalizeLocationLabel(value: string | null | undefined) {
  const location = splitLocation(value);

  if (!location.city && !location.state) {
    return "Localizacao em revisao";
  }

  return [location.city, location.state].filter(Boolean).join(" / ");
}

function locationLabel(city: string | null, state: string | null) {
  const normalized = [city, state].filter(Boolean).join(" / ");

  return normalized || "Localizacao em revisao";
}

function formatDateLabel(value: Date | string | null | undefined) {
  if (!value) {
    return "Sem data";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Sem data";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatCurrency(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "A consultar";
  }

  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(parsed);
}

function positiveCurrencyOrEmpty(value: number | string | null | undefined) {
  const formatted = formatCurrency(value);

  return formatted === "A consultar" ? undefined : formatted;
}

function formatC2xArea(value: number | string | null | undefined) {
  const area = toNumber(value);

  return area > 0 ? `${area.toLocaleString("pt-BR")} m2` : undefined;
}

function normalizeC2xBlock(value: string | null | undefined) {
  const clean = String(value ?? "").trim();

  if (!clean) {
    return "Sem quadra";
  }

  return /^q/i.test(clean) ? clean.toUpperCase() : `Q${clean}`;
}

function normalizeC2xLot(value: string | null | undefined) {
  const clean = String(value ?? "").trim();

  if (!clean) {
    return "Sem lote";
  }

  return /^l/i.test(clean) ? clean.toUpperCase() : `L${clean}`;
}

function c2xUnitLabel(block: string, lot: string, unityName?: string | null) {
  if (block !== "Sem quadra" || lot !== "Sem lote") {
    return `${block} · Lote ${lot.replace(/^L/i, "")}`;
  }

  return firstFilled(unityName) ?? "-";
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function apoloSafeErrorMessage(error: unknown) {
  const sanitized = sanitizeHadesDbError(error);

  return sanitized.message || "Nao foi possivel carregar os dados do Apolo.";
}
