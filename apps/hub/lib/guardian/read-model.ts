import { createSupabaseAdminClient } from "@/lib/guardian/read-model-sync";
import type {
  GuardianDistributionBucket,
  GuardianEnterprisePerformance,
  GuardianOverviewSnapshot,
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
  metadata: Record<string, unknown> | null;
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
  limit?: number;
};

export async function loadGuardianOverviewReadModel(): Promise<GuardianOverviewSnapshot | null> {
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

  const [enterpriseResult, agingResult, compositionResult] = await Promise.all([
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
  ]);

  if (enterpriseResult.error || agingResult.error || compositionResult.error) {
    return null;
  }

  return {
    billingComposition: mapDistributionRows(compositionResult.data ?? []),
    enterprisePerformance: mapEnterpriseRows(enterpriseResult.data ?? []),
    generatedAt: snapshot.snapshot_at ?? snapshot.created_at ?? new Date().toISOString(),
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
      overdueClients: toNumber(snapshot.overdue_clients),
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

export async function loadGuardianAttendanceQueueReadModel(
  options: AttendanceQueueReadModelOptions = {},
): Promise<
  QueueClient[] | null
> {
  const adminClient = createSupabaseAdminClient();

  if (!adminClient) {
    return null;
  }

  const limit = normalizeQueueLimit(options.limit);
  let query = adminClient
    .from("c2x_guardian_attendance_queue")
    .select("*")
    .eq("is_current", true)
    .order("overdue_payments", { ascending: false })
    .order("overdue_days", { ascending: false })
    .order("overdue_amount", { ascending: false });

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query.returns<AttendanceQueueRow[]>();

  if (error || !data?.length) {
    return null;
  }

  return data.map(mapAttendanceQueueRow);
}

export async function countGuardianAttendanceQueueReadModel(): Promise<number | null> {
  const adminClient = createSupabaseAdminClient();

  if (!adminClient) {
    return null;
  }

  const { count, error } = await adminClient
    .from("c2x_guardian_attendance_queue")
    .select("id", { count: "exact", head: true })
    .eq("is_current", true);

  if (error) {
    return null;
  }

  return count ?? null;
}

function mapEnterpriseRows(
  rows: EnterprisePerformanceRow[],
): GuardianEnterprisePerformance[] {
  return rows.map((row) => ({
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

function mapDistributionRows(rows: DistributionRow[]): GuardianDistributionBucket[] {
  return [...rows]
    .sort((first, second) => toNumber(first.sort_order) - toNumber(second.sort_order))
    .map((row) => ({
      label: row.label,
      total: toNumber(row.payments),
    }));
}

function mapAttendanceQueueRow(row: AttendanceQueueRow): QueueClient {
  const clientName = row.client_name?.trim() || "Cliente C2X";
  const enterpriseName = row.enterprise_name?.trim() || "Empreendimento";
  const unitLabel = row.unit_label?.trim() || "Unidade vinculada";
  const linkedPartyName =
    row.linked_party_name?.trim() || "Sem vinculo comercial";
  const overdueAmount = toNumber(row.overdue_amount);
  const overduePayments = toNumber(row.overdue_payments);
  const overdueDays = toNumber(row.overdue_days);
  const riskScore = Math.min(Math.max(Math.round(toNumber(row.risk_score)), 0), 100);
  const priority = mapGuardianPriority(row.priority);
  const workflowStage = mapWorkflowStage(row.workflow_status);
  const nextAction = nextActionForStage(workflowStage, priority);
  const rowId = String(row.client_c2x_id ?? row.id);
  const unitIds = metadataStringArray(row.metadata, "unitIds");
  const unitId = unitIds[0] ?? `c2x-unit-${rowId}`;
  const metadataUnits = metadataRecordArray(row.metadata, "units");
  const phone = row.phone?.trim() || "Sem telefone";
  const dados360Metadata = metadataRecord(row.metadata, "dados360");
  const conjugeMetadata = metadataRecord(dados360Metadata, "conjugeDados");
  const fallbackUnit = {
    area: "-",
    empreendimento: enterpriseName,
    id: unitId,
    imobiliariaCorretor: linkedPartyName,
    lote: parseLotFromUnitLabel(unitLabel),
    matricula: unitLabel,
    quadra: parseBlockFromUnitLabel(unitLabel),
    statusVenda: "Contrato ativo",
    unidadeLote: unitLabel,
    valorTabela: "-",
  };
  const units =
    metadataUnits.length > 0
      ? metadataUnits.map((unit, index) => ({
          area: metadataString(unit, "area", fallbackUnit.area),
          empreendimento: metadataString(unit, "empreendimento", enterpriseName),
          id: metadataString(unit, "id", unitIds[index] ?? `c2x-unit-${rowId}-${index + 1}`),
          imobiliariaCorretor: metadataString(unit, "imobiliariaCorretor", linkedPartyName),
          lote: metadataString(unit, "lote", fallbackUnit.lote),
          matricula: metadataString(unit, "matricula", metadataString(unit, "unidadeLote", unitLabel)),
          quadra: metadataString(unit, "quadra", fallbackUnit.quadra),
          signedContractDocumentId: metadataString(unit, "signedContractDocumentId", "") || undefined,
          signedContractStatus: metadataString(unit, "signedContractStatus", "") || undefined,
          signedContractUrl: metadataString(unit, "signedContractUrl", "") || undefined,
          statusVenda: metadataString(unit, "statusVenda", "Contrato ativo"),
          unidadeLote: metadataString(unit, "unidadeLote", unitLabel),
          valorTabela: metadataString(unit, "valorTabela", "-"),
        }))
      : [fallbackUnit];

  return {
    agreement: buildEmptyAgreement({
      clientName,
      enterpriseName,
      operator: "Sistema Guardian",
      priority,
      riskScore,
      unitLabel,
      value: overdueAmount,
    }),
    aiSuggestion: buildQueueSuggestion(priority, overduePayments, overdueDays),
    atrasoDias: overdueDays,
    carteira: {
      empreendimento: enterpriseName,
      imobiliariaCorretor: linkedPartyName,
      unidades: units,
    },
    c2xInstallments: [],
    c2xInstallmentsLoaded: false,
    commitments: [],
    cpf: row.document?.trim() || "Nao informado",
    dados360: {
      bairro: metadataString(dados360Metadata, "bairro", "Nao informado"),
      cep: metadataString(dados360Metadata, "cep", "Nao informado"),
      cidade: metadataString(dados360Metadata, "cidade", "Nao informado"),
      complementoEndereco: metadataString(dados360Metadata, "complementoEndereco", "Nao informado"),
      conjuge: metadataString(dados360Metadata, "conjuge", "Nao informado"),
      conjugeDados: {
        cpf: metadataString(conjugeMetadata, "cpf", metadataString(dados360Metadata, "cpfConjuge", "Nao informado")),
        documentoIdentidade: metadataString(conjugeMetadata, "documentoIdentidade", "Nao informado"),
        email: metadataString(conjugeMetadata, "email", "Nao informado"),
        endereco: metadataString(conjugeMetadata, "endereco", "Nao informado"),
        idade: metadataString(conjugeMetadata, "idade", "Nao informado"),
        nacionalidade: metadataString(conjugeMetadata, "nacionalidade", "Nao informado"),
        nascimento: metadataString(conjugeMetadata, "nascimento", "Nao informado"),
        naturalidade: metadataString(conjugeMetadata, "naturalidade", "Nao informado"),
        nome: metadataString(conjugeMetadata, "nome", metadataString(dados360Metadata, "conjuge", "Nao informado")),
        profissao: metadataString(conjugeMetadata, "profissao", "Nao informado"),
        sexo: metadataString(conjugeMetadata, "sexo", "Nao informado"),
        telefone: metadataString(conjugeMetadata, "telefone", "Nao informado"),
      },
      cpfConjuge: metadataString(dados360Metadata, "cpfConjuge", "Nao informado"),
      documentoIdentidade: metadataString(dados360Metadata, "documentoIdentidade", "Nao informado"),
      email: metadataString(dados360Metadata, "email", "Nao informado"),
      endereco: metadataString(dados360Metadata, "endereco", "Nao informado"),
      escolaridade: metadataString(dados360Metadata, "escolaridade", "Nao informado"),
      estadoCivil: metadataString(dados360Metadata, "estadoCivil", "Nao informado"),
      faixaSalarial: metadataString(dados360Metadata, "faixaSalarial", "Nao informado"),
      idade: metadataString(dados360Metadata, "idade", "Nao informado"),
      nacionalidade: metadataString(dados360Metadata, "nacionalidade", "Brasileira"),
      nascimento: metadataString(dados360Metadata, "nascimento", "Nao informado"),
      naturalidade: metadataString(dados360Metadata, "naturalidade", "Nao informado"),
      nomeFantasia: metadataString(dados360Metadata, "nomeFantasia", "Nao informado"),
      nomeMae: metadataString(dados360Metadata, "nomeMae", "Nao informado"),
      numeroEndereco: metadataString(dados360Metadata, "numeroEndereco", "Nao informado"),
      profissao: metadataString(dados360Metadata, "profissao", "Nao informado"),
      razaoSocial: metadataString(dados360Metadata, "razaoSocial", "Nao informado"),
      regimeBens: metadataString(dados360Metadata, "regimeBens", "Nao informado"),
      relacionamento: metadataString(row.metadata, "relationship", "Cliente C2X"),
      rg: metadataString(dados360Metadata, "rg", "Nao informado"),
      sexo: metadataString(dados360Metadata, "sexo", "Nao informado"),
      telefone: metadataString(dados360Metadata, "telefone", phone),
      tipoPessoa: metadataString(dados360Metadata, "tipoPessoa", "Fisica"),
    },
    id: `c2x-client-${rowId}`,
    nome: clientName,
    parcelas: {
      abertas: overduePayments,
      proximaAcao: nextAction,
      ultimaParcela:
        overduePayments > 0 ? toMoney(overdueAmount / overduePayments) : toMoney(0),
      vencidas: overduePayments,
    },
    prioridade: priority,
    responsavel: "Sistema Guardian",
    saldoDevedor: toMoney(overdueAmount),
    scoreRisco: riskScore,
    segmento: metadataString(row.metadata, "segment", "Cliente C2X"),
    timeline: [],
    workflow: {
      history: [
        {
          changedAt: formatSyncedAt(row.synced_at),
          from: "Entrada",
          id: `c2x-workflow-${row.id}`,
          operator: "Sistema Guardian",
          reason: `${overduePayments} parcela(s) vencida(s) importada(s) do C2X para a fila operacional.`,
          to: workflowStage,
        },
      ],
      nextAction,
      owner: "Sistema Guardian",
      stage: workflowStage,
      updatedAt: formatSyncedAt(row.synced_at),
    },
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

function mapGuardianPriority(value: string | null): AttendancePriority {
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

function mapWorkflowStage(value: string | null): WorkflowStage {
  const stages: WorkflowStage[] = [
    "Novo atraso",
    "Primeiro contato",
    "Sem retorno",
    "Em negociação",
    "Promessa realizada",
    "Aguardando pagamento",
    "Pago",
    "Quebra de promessa",
    "Crítico",
    "Jurídico",
    "Distrato/Evasão",
  ];

  return stages.includes(value as WorkflowStage)
    ? (value as WorkflowStage)
    : "Primeiro contato";
}

function nextActionForStage(stage: WorkflowStage, priority: AttendancePriority) {
  if (stage === "Jurídico") {
    return "Validar documentação e manter trilha amigável.";
  }

  if (stage === "Crítico" || priority === "Crítica") {
    return "Priorizar contato humano e revisar alternativa de acordo.";
  }

  if (priority === "Alta") {
    return "Confirmar canal preferencial e formalizar proposta.";
  }

  if (priority === "Média") {
    return "Registrar retorno e conduzir régua multicanal.";
  }

  return "Registrar retorno e confirmar canal prioritario.";
}

function buildQueueSuggestion(
  priority: AttendancePriority,
  overduePayments: number,
  overdueDays: number,
) {
  if (priority === "Crítica") {
    return `Cliente com ${overduePayments} parcela(s) vencida(s) e ${overdueDays} dias de atraso. Priorizar atendimento humano.`;
  }

  if (priority === "Alta") {
    return "Risco alto. Confirmar condição de pagamento e formalizar proposta no mesmo dia.";
  }

  if (priority === "Média") {
    return "Risco médio. Conduzir primeiro contato e registrar retorno operacional.";
  }

  return "Risco baixo. Manter acompanhamento preventivo e registrar canal de contato.";
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
  const risk = agreementRiskFromPriority(input.priority);

  return {
    aiSuggestion: {
      breakChance: input.riskScore,
      composition: "Acordo ainda nao iniciado no Guardian.",
      nextAction: "Abrir ticket para iniciar atendimento operacional.",
      operationalRisk: risk,
    },
    breakRate: input.riskScore,
    client: input.clientName,
    discount: "0%",
    dueDates: [],
    enterprise: input.enterpriseName,
    entry: toMoney(0),
    id: `c2x-agreement-${input.clientName}`,
    installmentsCount: 0,
    negotiatedValue: toMoney(0),
    operator: input.operator,
    originalDebt: toMoney(input.value),
    recoveredValue: toMoney(0),
    recoveryRate: 0,
    risk,
    status: "Em negociação",
    unit: input.unitLabel,
  };
}

function agreementRiskFromPriority(priority: AttendancePriority): AgreementRisk {
  if (priority === "Crítica") {
    return "Crítico";
  }

  if (priority === "Alta") {
    return "Alto";
  }

  if (priority === "Média") {
    return "Moderado";
  }

  return "Baixo";
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

function metadataStringArray(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function metadataRecordArray(metadata: Record<string, unknown> | null, key: string) {
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
