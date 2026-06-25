import { createSupabaseAdminClient } from "@/lib/guardian/read-model-sync";
import type {
  HadesAgingByClientBucket,
  HadesDistributionBucket,
  HadesEnterprisePerformance,
  HadesOperationalIntelligence,
  HadesOverviewSnapshot,
  HadesTopDelinquentClient,
} from "@/lib/guardian/overview";
import type {
  AgreementRisk,
  AttendancePriority,
  QueueClient,
  WorkflowStage,
} from "@/modules/guardian/attendance/types";

type FinancialSnapshotRow = {
  created_at: string | null;
  critical_contracts: number | string | null;
  delinquency_base_amount: number | string | null;
  delinquency_rate: number | string | null;
  liquidated_amount: number | string | null;
  liquidated_payments: number | string | null;
  monthly_recovery_amount: number | string | null;
  monthly_recovery_payments: number | string | null;
  overdue_amount: number | string | null;
  overdue_clients: number | string | null;
  overdue_payments: number | string | null;
  pending_amount: number | string | null;
  pending_payments: number | string | null;
  snapshot_at: string;
  total_portfolio_amount: number | string | null;
  total_portfolio_payments: number | string | null;
  id: string;
};

type EnterprisePerformanceRow = {
  delinquency_base_amount: number | string | null;
  enterprise_name: string;
  monthly_recovery_amount: number | string | null;
  monthly_recovery_payments: number | string | null;
  overdue_amount: number | string | null;
  overdue_clients: number | string | null;
  overdue_payments: number | string | null;
  total_portfolio_amount: number | string | null;
  total_portfolio_payments: number | string | null;
};

type DistributionRow = {
  label: string;
  payments: number | string | null;
  sort_order: number | string | null;
};

type AttendanceQueueRow = {
  client_c2x_id: number | string | null;
  client_name: string | null;
  document: string | null;
  enterprise_name: string | null;
  id: string;
  linked_party_name: string | null;
  metadata?: Record<string, unknown> | null;
  overdue_amount: number | string | null;
  overdue_days: number | string | null;
  overdue_payments: number | string | null;
  phone: string | null;
  priority: string | null;
  risk_score: number | string | null;
  synced_at: string | null;
  unit_label: string | null;
  workflow_status: string | null;
};

type AttendanceQueueReadModelOptions = {
  includeMetadata?: boolean;
  limit?: number;
};

type AttendanceQueueReadModelResult = {
  clients: QueueClient[];
  count: number | null;
  syncedAt: string | null;
};

const ATTENDANCE_QUEUE_BASE_SELECT = `
  id,
  client_c2x_id,
  client_name,
  document,
  enterprise_name,
  linked_party_name,
  overdue_amount,
  overdue_days,
  overdue_payments,
  phone,
  priority,
  risk_score,
  synced_at,
  unit_label,
  workflow_status
`;

const ATTENDANCE_QUEUE_DETAIL_SELECT = `
  ${ATTENDANCE_QUEUE_BASE_SELECT},
  metadata
`;
const EMPTY_FIELD = "-";

export async function loadHadesOverviewReadModel(): Promise<HadesOverviewSnapshot | null> {
  const adminClient = createSupabaseAdminClient();

  if (!adminClient) {
    return null;
  }

  const { data: snapshot, error } = await adminClient
    .from("c2x_guardian_financial_snapshots")
    .select("*")
    .eq("is_current", true)
    .maybeSingle<FinancialSnapshotRow>();

  if (error || !snapshot) {
    return null;
  }

  const [enterpriseResult, agingResult, compositionResult, queueCountResult] = await Promise.all([
    adminClient
      .from("c2x_guardian_enterprise_performance")
      .select("*")
      .eq("snapshot_id", snapshot.id),
    adminClient
      .from("c2x_guardian_overdue_aging")
      .select("*")
      .eq("snapshot_id", snapshot.id)
      .order("sort_order", { ascending: true }),
    adminClient
      .from("c2x_guardian_billing_composition")
      .select("*")
      .eq("snapshot_id", snapshot.id)
      .order("sort_order", { ascending: true }),
    adminClient
      .from("c2x_guardian_attendance_queue")
      .select("id", { count: "exact", head: true })
      .eq("is_current", true)
      .gt("overdue_payments", 0),
  ]);

  if (enterpriseResult.error || agingResult.error || compositionResult.error) {
    return null;
  }

  const attendanceQueueOverdueClients = queueCountResult.error
    ? null
    : queueCountResult.count;

  return {
    billingComposition: mapDistributionRows(compositionResult.data ?? []),
    enterprisePerformance: mapEnterpriseRows(enterpriseResult.data ?? []),
    generatedAt:
      snapshot.snapshot_at ?? snapshot.created_at ?? new Date().toISOString(),
    overdueAging: mapDistributionRows(agingResult.data ?? []),
    overduePayments: [],
    paymentStatuses: [],
    recentProposals: [],
    signatureQueue: [],
    stages: [],
    summary: {
      availableUnits: 0,
      criticalContracts: toNumber(snapshot.critical_contracts),
      finalizedProposals: 0,
      inSignatureProposals: 0,
      liquidatedAmount: toNumber(snapshot.liquidated_amount),
      liquidatedPayments: toNumber(snapshot.liquidated_payments),
      monthlyRecoveryAmount: toNumber(snapshot.monthly_recovery_amount),
      monthlyRecoveryPayments: toNumber(snapshot.monthly_recovery_payments),
      openProposals: 0,
      overdueAmount: toNumber(snapshot.overdue_amount),
      overdueClients:
        attendanceQueueOverdueClients ?? toNumber(snapshot.overdue_clients),
      overduePayments: toNumber(snapshot.overdue_payments),
      overduePrincipalAmount: toNumber(snapshot.overdue_amount),
      overduePrincipalPayments: toNumber(snapshot.overdue_payments),
      pendingAmount: toNumber(snapshot.pending_amount),
      pendingPayments: toNumber(snapshot.pending_payments),
      pendingSignatures: 0,
      totalPortfolioAmount: toNumber(snapshot.total_portfolio_amount),
      totalPortfolioPayments: toNumber(snapshot.total_portfolio_payments),
      totalProposals: 0,
    },
  };
}

export async function loadHadesAttendanceQueueReadModel(
  options: AttendanceQueueReadModelOptions = {},
): Promise<AttendanceQueueReadModelResult | null> {
  const adminClient = createSupabaseAdminClient();

  if (!adminClient) {
    return null;
  }

  const limit = normalizeQueueLimit(options.limit);
  const includeMetadata = options.includeMetadata === true;
  let query = adminClient
    .from("c2x_guardian_attendance_queue")
    .select(
      includeMetadata
        ? ATTENDANCE_QUEUE_DETAIL_SELECT
        : ATTENDANCE_QUEUE_BASE_SELECT,
      { count: "exact" },
    )
    .eq("is_current", true)
    .order("overdue_payments", { ascending: false })
    .order("overdue_days", { ascending: false })
    .order("overdue_amount", { ascending: false });

  if (limit) {
    query = query.limit(limit);
  }

  const { count, data, error } = await query.returns<AttendanceQueueRow[]>();

  if (error || !data?.length) {
    return null;
  }

  return {
    clients: data.map((row) =>
      mapAttendanceQueueRow(row, { compact: !includeMetadata }),
    ),
    count: count ?? null,
    syncedAt: latestSyncedAt(data),
  };
}

export type {
  HadesAgingByClientBucket,
  HadesOperationalIntelligence,
  HadesTopDelinquentClient,
};

const AGING_CLIENT_BUCKETS = [
  { label: "1 a 15 dias", max: 15, min: 1, sortOrder: 1 },
  { label: "16 a 30 dias", max: 30, min: 16, sortOrder: 2 },
  { label: "31 a 60 dias", max: 60, min: 31, sortOrder: 3 },
  { label: "61 a 90 dias", max: 90, min: 61, sortOrder: 4 },
  { label: "90+ dias", max: Number.POSITIVE_INFINITY, min: 91, sortOrder: 5 },
];

type OperationalIntelligenceRow = {
  client_name: string | null;
  enterprise_name: string | null;
  overdue_amount: number | string | null;
  overdue_days: number | null;
  overdue_payments: number | null;
  synced_at: string | null;
};

// Inteligência operacional do dashboard (overview): aging por cliente + top 15
// inadimplentes, a partir da tabela read-model (Supabase, barata). O cron mantem
// fresca em prod; em preview reflete a ultima sync (carimbo syncedAt na UI).
export async function loadHadesOperationalIntelligenceReadModel(): Promise<HadesOperationalIntelligence | null> {
  const adminClient = createSupabaseAdminClient();

  if (!adminClient) {
    return null;
  }

  const { data, error } = await adminClient
    .from("c2x_guardian_attendance_queue")
    .select(
      "client_name, enterprise_name, overdue_payments, overdue_amount, overdue_days, synced_at",
    )
    .eq("is_current", true)
    .returns<OperationalIntelligenceRow[]>();

  if (error || !data?.length) {
    return null;
  }

  const agingByClient = AGING_CLIENT_BUCKETS.map((bucket) => ({
    clients: data.filter((row) => {
      const days = Number(row.overdue_days ?? 0);

      return days >= bucket.min && days <= bucket.max;
    }).length,
    label: bucket.label,
    sortOrder: bucket.sortOrder,
  }));

  const topClients = data
    .map((row) => ({
      enterprise: row.enterprise_name ?? null,
      name: row.client_name ?? "Sem nome",
      overdueAmount: Number(row.overdue_amount ?? 0),
      overdueDays: Number(row.overdue_days ?? 0),
      overduePayments: Number(row.overdue_payments ?? 0),
    }))
    .sort((first, second) => second.overdueAmount - first.overdueAmount)
    .slice(0, 15);

  const syncedAt =
    data
      .map((row) => row.synced_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;

  return {
    agingByClient,
    syncedAt,
    topClients,
    totalOverdueClients: data.filter(
      (row) => Number(row.overdue_days ?? 0) > 0,
    ).length,
  };
}

function latestSyncedAt(rows: AttendanceQueueRow[]) {
  let latestTimestamp = 0;
  let latestValue: string | null = null;

  for (const row of rows) {
    const timestamp = row.synced_at ? new Date(row.synced_at).getTime() : 0;

    if (Number.isFinite(timestamp) && timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
      latestValue = row.synced_at;
    }
  }

  return latestValue;
}

function mapEnterpriseRows(
  rows: EnterprisePerformanceRow[],
): HadesEnterprisePerformance[] {
  return rows.map((row) => ({
    criticalContracts: 0,
    delinquencyBaseAmount: toNumber(row.delinquency_base_amount),
    enterpriseName: row.enterprise_name,
    monthlyRecoveryAmount: toNumber(row.monthly_recovery_amount),
    monthlyRecoveryPayments: toNumber(row.monthly_recovery_payments),
    overdueClients: toNumber(row.overdue_clients),
    overduePrincipalAmount: toNumber(row.overdue_amount),
    overduePrincipalPayments: toNumber(row.overdue_payments),
    totalPortfolioAmount: toNumber(row.total_portfolio_amount),
    totalPortfolioPayments: toNumber(row.total_portfolio_payments),
  }));
}

function mapDistributionRows(
  rows: DistributionRow[],
): HadesDistributionBucket[] {
  return [...rows]
    .sort(
      (first, second) =>
        toNumber(first.sort_order) - toNumber(second.sort_order),
    )
    .map((row) => ({
      label: row.label,
      total: toNumber(row.payments),
    }));
}

function mapAttendanceQueueRow(
  row: AttendanceQueueRow,
  options: { compact: boolean },
): QueueClient {
  const clientName = row.client_name?.trim() || EMPTY_FIELD;
  const enterpriseName = row.enterprise_name?.trim() || EMPTY_FIELD;
  const unitLabel = row.unit_label?.trim() || EMPTY_FIELD;
  const linkedPartyName = row.linked_party_name?.trim() || EMPTY_FIELD;
  const overdueAmount = toNumber(row.overdue_amount);
  const overduePayments = toNumber(row.overdue_payments);
  const overdueDays = toNumber(row.overdue_days);
  const riskScore = Math.min(
    Math.max(Math.round(toNumber(row.risk_score)), 0),
    100,
  );
  const priority = mapHadesPriority(row.priority);
  const workflowStage = mapWorkflowStage(row.workflow_status, overdueDays);
  const nextAction = nextActionForStage(workflowStage, priority);
  const rowId = String(row.client_c2x_id ?? row.id);
  const metadata = options.compact ? null : (row.metadata ?? null);
  const unitIds = metadataStringArray(metadata, "unitIds");
  const unitId = unitIds[0] ?? `c2x-unit-${rowId}`;
  const metadataUnits = metadataRecordArray(metadata, "units");
  const phone = row.phone?.trim() || EMPTY_FIELD;
  const dados360Metadata = metadataRecord(metadata, "dados360");
  const conjugeMetadata = metadataRecord(dados360Metadata, "conjugeDados");
  const fallbackUnit = {
    area: EMPTY_FIELD,
    empreendimento: enterpriseName,
    id: unitId,
    imobiliariaCorretor: linkedPartyName,
    lote: parseLotFromUnitLabel(unitLabel),
    matricula: unitLabel,
    quadra: parseBlockFromUnitLabel(unitLabel),
    statusVenda: EMPTY_FIELD,
    unidadeLote: unitLabel,
    valorTabela: EMPTY_FIELD,
  };
  const units =
    metadataUnits.length > 0
      ? metadataUnits.map((unit, index) => ({
          area: metadataString(unit, "area", fallbackUnit.area),
          empreendimento: metadataString(
            unit,
            "empreendimento",
            enterpriseName,
          ),
          id: metadataString(
            unit,
            "id",
            unitIds[index] ?? `c2x-unit-${rowId}-${index + 1}`,
          ),
          imobiliariaCorretor: metadataString(
            unit,
            "imobiliariaCorretor",
            linkedPartyName,
          ),
          lote: metadataString(unit, "lote", fallbackUnit.lote),
          matricula: metadataString(
            unit,
            "matricula",
            metadataString(unit, "unidadeLote", unitLabel),
          ),
          quadra: metadataString(unit, "quadra", fallbackUnit.quadra),
          signedContractDocumentId:
            metadataString(unit, "signedContractDocumentId", "") || undefined,
          signedContractStatus:
            metadataString(unit, "signedContractStatus", "") || undefined,
          signedContractUrl:
            metadataString(unit, "signedContractUrl", "") || undefined,
          statusVenda: metadataString(unit, "statusVenda", EMPTY_FIELD),
          unidadeLote: metadataString(unit, "unidadeLote", unitLabel),
          valorTabela: metadataString(unit, "valorTabela", EMPTY_FIELD),
        }))
      : [fallbackUnit];

  return {
    agreement: buildEmptyAgreement({
      clientName,
      enterpriseName,
      operator: EMPTY_FIELD,
      priority,
      riskScore,
      unitLabel,
      value: overdueAmount,
    }),
    aiSuggestion: buildQueueSuggestion(),
    atrasoDias: overdueDays,
    carteira: {
      empreendimento: enterpriseName,
      imobiliariaCorretor: linkedPartyName,
      unidades: units,
    },
    c2xInstallments: [],
    c2xInstallmentsLoaded: false,
    commitments: [],
    cpf: row.document?.trim() || EMPTY_FIELD,
    dados360: options.compact
      ? buildCompactDados360(phone)
      : buildQueueDados360(metadata, dados360Metadata, conjugeMetadata, phone),
    id: `c2x-client-${rowId}`,
    nome: clientName,
    parcelas: {
      abertas: overduePayments,
      proximaAcao: nextAction,
      ultimaParcela:
        overduePayments > 0
          ? toMoney(overdueAmount / overduePayments)
          : toMoney(0),
      vencidas: overduePayments,
    },
    prioridade: priority,
    responsavel: EMPTY_FIELD,
    saldoDevedor: toMoney(overdueAmount),
    scoreRisco: riskScore,
    segmento: metadataString(metadata, "segment", EMPTY_FIELD),
    timeline: [],
    workflow: {
      history: options.compact
        ? []
        : [
            {
              changedAt: formatSyncedAt(row.synced_at),
              from: "Entrada",
              id: `c2x-workflow-${row.id}`,
              operator: EMPTY_FIELD,
              reason: `${overduePayments} parcela(s) vencida(s) importada(s) do C2X para a fila operacional.`,
              to: workflowStage,
            },
          ],
      nextAction,
      owner: EMPTY_FIELD,
      stage: workflowStage,
      updatedAt: formatSyncedAt(row.synced_at),
    },
  };
}

function buildCompactDados360(phone: string): QueueClient["dados360"] {
  return {
    conjugeDados: {},
    relacionamento: EMPTY_FIELD,
    telefone: phone,
    tipoPessoa: EMPTY_FIELD,
  } as QueueClient["dados360"];
}

function buildQueueDados360(
  metadata: Record<string, unknown> | null,
  dados360Metadata: Record<string, unknown> | null,
  conjugeMetadata: Record<string, unknown> | null,
  phone: string,
): QueueClient["dados360"] {
  return {
    bairro: metadataString(dados360Metadata, "bairro", EMPTY_FIELD),
    cep: metadataString(dados360Metadata, "cep", EMPTY_FIELD),
    cidade: metadataString(dados360Metadata, "cidade", EMPTY_FIELD),
    complementoEndereco: metadataString(
      dados360Metadata,
      "complementoEndereco",
      EMPTY_FIELD,
    ),
    conjuge: metadataString(dados360Metadata, "conjuge", EMPTY_FIELD),
    conjugeDados: {
      cpf: metadataString(
        conjugeMetadata,
        "cpf",
        metadataString(dados360Metadata, "cpfConjuge", EMPTY_FIELD),
      ),
      documentoIdentidade: metadataString(
        conjugeMetadata,
        "documentoIdentidade",
        EMPTY_FIELD,
      ),
      email: metadataString(conjugeMetadata, "email", EMPTY_FIELD),
      endereco: metadataString(conjugeMetadata, "endereco", EMPTY_FIELD),
      idade: metadataString(conjugeMetadata, "idade", EMPTY_FIELD),
      nacionalidade: metadataString(
        conjugeMetadata,
        "nacionalidade",
        EMPTY_FIELD,
      ),
      nascimento: metadataString(
        conjugeMetadata,
        "nascimento",
        EMPTY_FIELD,
      ),
      naturalidade: metadataString(
        conjugeMetadata,
        "naturalidade",
        EMPTY_FIELD,
      ),
      nome: metadataString(
        conjugeMetadata,
        "nome",
        metadataString(dados360Metadata, "conjuge", EMPTY_FIELD),
      ),
      profissao: metadataString(conjugeMetadata, "profissao", EMPTY_FIELD),
      sexo: metadataString(conjugeMetadata, "sexo", EMPTY_FIELD),
      telefone: metadataString(conjugeMetadata, "telefone", EMPTY_FIELD),
    },
    cpfConjuge: metadataString(dados360Metadata, "cpfConjuge", EMPTY_FIELD),
    documentoIdentidade: metadataString(
      dados360Metadata,
      "documentoIdentidade",
      EMPTY_FIELD,
    ),
    email: metadataString(dados360Metadata, "email", EMPTY_FIELD),
    endereco: metadataString(dados360Metadata, "endereco", EMPTY_FIELD),
    escolaridade: metadataString(
      dados360Metadata,
      "escolaridade",
      EMPTY_FIELD,
    ),
    estadoCivil: metadataString(
      dados360Metadata,
      "estadoCivil",
      EMPTY_FIELD,
    ),
    faixaSalarial: metadataString(
      dados360Metadata,
      "faixaSalarial",
      EMPTY_FIELD,
    ),
    idade: metadataString(dados360Metadata, "idade", EMPTY_FIELD),
    nacionalidade: metadataString(
      dados360Metadata,
      "nacionalidade",
      EMPTY_FIELD,
    ),
    nascimento: metadataString(dados360Metadata, "nascimento", EMPTY_FIELD),
    naturalidade: metadataString(
      dados360Metadata,
      "naturalidade",
      EMPTY_FIELD,
    ),
    nomeFantasia: metadataString(
      dados360Metadata,
      "nomeFantasia",
      EMPTY_FIELD,
    ),
    nomeMae: metadataString(dados360Metadata, "nomeMae", EMPTY_FIELD),
    numeroEndereco: metadataString(
      dados360Metadata,
      "numeroEndereco",
      EMPTY_FIELD,
    ),
    profissao: metadataString(dados360Metadata, "profissao", EMPTY_FIELD),
    razaoSocial: metadataString(
      dados360Metadata,
      "razaoSocial",
      EMPTY_FIELD,
    ),
    regimeBens: metadataString(dados360Metadata, "regimeBens", EMPTY_FIELD),
    relacionamento: metadataString(metadata, "relationship", EMPTY_FIELD),
    rg: metadataString(dados360Metadata, "rg", EMPTY_FIELD),
    sexo: metadataString(dados360Metadata, "sexo", EMPTY_FIELD),
    telefone: metadataString(dados360Metadata, "telefone", phone),
    tipoPessoa: metadataString(dados360Metadata, "tipoPessoa", EMPTY_FIELD),
  };
}

function toNumber(value: number | string | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeQueueLimit(value: number | null | undefined) {
  const parsed = Number(value ?? 50);

  if (!Number.isFinite(parsed)) {
    return 50;
  }

  return Math.min(Math.max(Math.trunc(parsed), 20), 2_000);
}

function mapHadesPriority(value: string | null): AttendancePriority {
  if (value === "critical") {
    return "Crítica";
  }

  if (value === "high") {
    return "Alta";
  }

  if (value === "medium") {
    return "Média";
  }

  return "Baixa";
}

function mapWorkflowStage(value: string | null, overdueDays = 0): WorkflowStage {
  if (overdueDays >= 91) {
    return "Jurídico";
  }

  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  const initialStage = overdueDays >= 3 ? "Contato" : "A acionar";
  const map: Record<string, WorkflowStage> = {
    "": initialStage,
    "a acionar": "A acionar",
    acordo: "Acordo",
    "aguardando pagamento": "Promessa de pagamento",
    contato: "Contato",
    critico: "Quebra",
    "distrato/evasao": "Jurídico",
    "em negociacao": "Negociação",
    juridico: "Jurídico",
    negociacao: "Negociação",
    "novo atraso": initialStage,
    pago: "Acordo",
    "primeiro contato": "Contato",
    "promessa de pagamento": "Promessa de pagamento",
    "promessa realizada": "Promessa de pagamento",
    quebra: "Quebra",
    "quebra de promessa": "Quebra",
    "sem retorno": "Contato",
  };

  return map[normalized] ?? initialStage;
}

function nextActionForStage(
  stage: WorkflowStage,
  priority: AttendancePriority,
) {
  if (stage === "Jurídico") {
    return "Validar documentação e encaminhamento jurídico.";
  }

  if (stage === "Quebra" || stage === "Crítico" || priority === "Crítica") {
    return "Priorizar contato humano e revisar alternativa de acordo.";
  }

  if (stage === "Promessa de pagamento" || stage === "Acordo") {
    return "Acompanhar compromisso ativo antes de retomar acionamento.";
  }

  if (stage === "Negociação") {
    return "Conduzir proposta e registrar contraproposta do cliente.";
  }

  if (priority === "Alta") {
    return "Confirmar canal preferencial e formalizar proposta.";
  }

  if (priority === "Média") {
    return "Registrar retorno e conduzir régua multicanal.";
  }

  return "Registrar retorno e confirmar canal prioritario.";
}

function buildQueueSuggestion() {
  return EMPTY_FIELD;
}

function buildEmptyAgreement(input: {
  clientName: string;
  enterpriseName: string;
  operator: string;
  priority: AttendancePriority;
  riskScore: number;
  unitLabel: string;
  value: number;
}): QueueClient["agreement"] {
  return {
    aiSuggestion: {
      breakChance: input.riskScore,
      composition: EMPTY_FIELD,
      nextAction: EMPTY_FIELD,
      operationalRisk: EMPTY_FIELD as AgreementRisk,
    },
    breakRate: input.riskScore,
    client: input.clientName,
    discount: EMPTY_FIELD,
    dueDates: [],
    enterprise: input.enterpriseName,
    entry: EMPTY_FIELD,
    id: `c2x-agreement-${input.clientName}`,
    installmentsCount: 0,
    negotiatedValue: EMPTY_FIELD,
    operator: input.operator,
    originalDebt: toMoney(input.value),
    recoveredValue: EMPTY_FIELD,
    recoveryRate: 0,
    risk: EMPTY_FIELD as AgreementRisk,
    status: EMPTY_FIELD as QueueClient["agreement"]["status"],
    unit: input.unitLabel,
  };
}

function metadataString(
  metadata: Record<string, unknown> | null,
  key: string,
  fallback: string,
) {
  const value = metadata?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function metadataRecord(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function metadataStringArray(
  metadata: Record<string, unknown> | null,
  key: string,
) {
  const value = metadata?.[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function metadataRecordArray(
  metadata: Record<string, unknown> | null,
  key: string,
) {
  const value = metadata?.[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

function parseBlockFromUnitLabel(value: string) {
  const match = value.match(/\bQ(?:uadra)?\s*([A-Za-z0-9-]+)/i);

  return match?.[1] ? `Q${match[1]}` : "-";
}

function parseLotFromUnitLabel(value: string) {
  const match = value.match(/\bL(?:ote)?\s*([A-Za-z0-9-]+)/i);

  return match?.[1] ? `L${match[1]}` : "-";
}

function formatSyncedAt(value: string | null) {
  if (!value) {
    return "Agora";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Agora";
  }

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function toMoney(value: number) {
  return value.toLocaleString("pt-BR", {
    currency: "BRL",
    style: "currency",
  });
}
