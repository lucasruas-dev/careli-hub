import type { RowDataPacket } from "mysql2/promise";

import { getGuardianDbPool } from "@/lib/guardian/db";

export type GuardianOverviewSummary = {
  availableUnits: number;
  criticalContracts: number;
  liquidatedAmount: number;
  liquidatedPayments: number;
  finalizedProposals: number;
  inSignatureProposals: number;
  overdueAmount: number;
  overdueClients: number;
  overduePrincipalAmount: number;
  overduePrincipalPayments: number;
  overduePayments: number;
  monthlyRecoveryAmount: number;
  monthlyRecoveryPayments: number;
  openProposals: number;
  pendingSignatures: number;
  pendingAmount: number;
  pendingPayments: number;
  totalPortfolioAmount: number;
  totalPortfolioPayments: number;
  totalProposals: number;
};

export type GuardianStageBucket = {
  amount: number;
  id: number;
  name: string;
  total: number;
};

export type GuardianPaymentStatusBucket = {
  amount: number;
  id: number;
  name: string;
  total: number;
};

export type GuardianDistributionBucket = {
  label: string;
  total: number;
};

export type GuardianEnterpriseDistributions = {
  billingComposition: GuardianDistributionBucket[];
  enterpriseName: string;
  generatedAt: string;
  overdueAging: GuardianDistributionBucket[];
};

export type GuardianEnterprisePerformance = {
  delinquencyBaseAmount: number;
  enterpriseName: string;
  monthlyRecoveryAmount: number;
  monthlyRecoveryPayments: number;
  overdueClients: number;
  overduePrincipalAmount: number;
  overduePrincipalPayments: number;
  totalPortfolioAmount: number;
  totalPortfolioPayments: number;
};

export type GuardianProposalListItem = {
  amount: number;
  brokerName?: string;
  clientName?: string;
  code?: string;
  createdAt?: string;
  enterpriseName?: string;
  id: number;
  isOpen: boolean;
  stageName?: string;
  typeName?: string;
  unitLabel?: string;
  updatedAt?: string;
};

export type GuardianPaymentListItem = {
  amount: number;
  code?: string;
  clientName?: string;
  dueDate?: string;
  enterpriseName?: string;
  id: number;
  parcelLabel?: string;
  statusName?: string;
  unitLabel?: string;
};

export type GuardianSignatureListItem = {
  clientName?: string;
  code?: string;
  contractId: number;
  contractType?: string;
  enterpriseName?: string;
  id: number;
  statusName?: string;
  unitLabel?: string;
  updatedAt?: string;
};

export type GuardianOverviewSnapshot = {
  billingComposition: GuardianDistributionBucket[];
  enterprisePerformance: GuardianEnterprisePerformance[];
  generatedAt: string;
  overduePayments: GuardianPaymentListItem[];
  overdueAging: GuardianDistributionBucket[];
  paymentStatuses: GuardianPaymentStatusBucket[];
  recentProposals: GuardianProposalListItem[];
  signatureQueue: GuardianSignatureListItem[];
  stages: GuardianStageBucket[];
  summary: GuardianOverviewSummary;
};

type SummaryRow = RowDataPacket & {
  available_units: number | string;
  critical_contracts: number | string;
  finalized: number | string;
  in_signature: number | string;
  liquidated_amount: number | string;
  liquidated_payments: number | string;
  monthly_recovery_amount: number | string;
  monthly_recovery_payments: number | string;
  overdue_amount: number | string;
  overdue_clients: number | string;
  overdue_principal_amount: number | string;
  overdue_principal_payments: number | string;
  overdue_payments: number | string;
  pending_amount: number | string;
  pending_payments: number | string;
  proposals_open: number | string;
  proposals_total: number | string;
  signatures_pending: number | string;
  total_portfolio_amount: number | string;
  total_portfolio_payments: number | string;
};

type StageRow = RowDataPacket & {
  amount: number | string | null;
  id: number | string;
  name: string;
  total: number | string;
};

type PaymentStatusRow = StageRow;

type DistributionRow = RowDataPacket & {
  label: string;
  sort_order: number | string;
  total: number | string;
};

type EnterpriseDistributionRow = DistributionRow & {
  enterprise_name: string;
};

type EnterprisePerformanceRow = RowDataPacket & {
  delinquency_base_amount: number | string | null;
  enterprise_name: string;
  monthly_recovery_amount: number | string | null;
  monthly_recovery_payments: number | string;
  overdue_clients: number | string;
  overdue_principal_amount: number | string | null;
  overdue_principal_payments: number | string;
  total_portfolio_amount: number | string | null;
  total_portfolio_payments: number | string;
};

type ProposalRow = RowDataPacket & {
  annual_value: number | string | null;
  block: string | null;
  broker_name: string | null;
  client_name: string | null;
  code: string | null;
  created_at: Date | string | null;
  enterprise_name: string | null;
  id: number | string;
  lot: string | null;
  open: number | string | null;
  stage_name: string | null;
  type_name: string | null;
  unity_name: string | null;
  updated_at: Date | string | null;
};

type PaymentRow = RowDataPacket & {
  amount: number | string | null;
  client_name: string | null;
  code: string | null;
  current_total_parcel: number | string | null;
  due_date: Date | string | null;
  enterprise_name: string | null;
  id: number | string;
  parcel_type_name: string | null;
  status_name: string | null;
  total_parcels: number | string | null;
  unity_name: string | null;
};

type SignatureRow = RowDataPacket & {
  client_name: string | null;
  code: string | null;
  contract_id: number | string;
  contract_type: string | null;
  enterprise_name: string | null;
  id: number | string;
  status_name: string | null;
  unity_name: string | null;
  updated_at: Date | string | null;
};

const overdueWhere = `
  (
    p.payment_status_id = 7
    or (
      p.due_date < curdate()
      and p.payment_status_id not in (1, 2, 5)
    )
  )
  and (p.payment_to_delete is null or p.payment_to_delete = 0)
`;

const outstandingAmountExpression = `
  greatest(
    coalesce(p.initial_value, 0)
    + coalesce(p.interest_value, 0)
    + coalesce(p.mulct_value, 0)
    - coalesce(p.paid_value, 0),
    0
  )
`;

const principalAmountExpression = "coalesce(p.initial_value, 0)";
const activePaymentWhere =
  "(p.payment_to_delete is null or p.payment_to_delete = 0)";
const monthlyRecoveryWhere = `
  p.payment_status_id = 5
  and ${activePaymentWhere}
  and p.payment_date is not null
  and p.due_date is not null
  and p.payment_date >= cast(date_format(curdate(), '%Y-%m-01') as date)
  and p.payment_date < date_add(cast(date_format(curdate(), '%Y-%m-01') as date), interval 1 month)
  and datediff(p.payment_date, p.due_date) > 10
`;
const enterpriseDisplayExpression = `
  case
    when upper(trim(e.code)) = 'REP' then 'Recanto do Pará'
    when upper(trim(e.code)) = 'EDL' then 'Estância do Lago'
    when upper(trim(e.code)) in ('LOU', 'LOS') then 'Lavra do Ouro'
    when upper(trim(e.code)) in ('PDV', 'PVS') then 'Portal dos Vales'
    when upper(trim(e.code)) in ('RDP', 'RPS', 'RPC') then 'Rio de Pedras'
    when upper(trim(e.code)) in ('LBR', 'LBP', 'LBF') then concat('Lagoa Bonita - ', upper(trim(e.code)))
    when upper(trim(e.code)) = 'MDS' then 'Morada da Serra'
    when upper(trim(e.code)) = 'MLN' then 'Milenium'
    when upper(trim(e.code)) = 'VDO' then 'Veredas do Ouro'
    when upper(trim(e.code)) = 'VAL' then 'Vista Alegre'
    when upper(trim(e.code)) = 'VDP' then 'Vistas da Praia'
    else trim(coalesce(nullif(e.name, ''), nullif(e.divulgation_name, ''), concat('Empreendimento ', e.id)))
  end
`;
const validEnterpriseWhere = `
  e.id is not null
  and upper(trim(coalesce(e.code, ''))) not in ('SDT', 'TSC')
  and not (
    upper(trim(coalesce(e.name, ''))) like 'LAGOA BONITA%'
    and upper(trim(coalesce(e.code, ''))) not in ('LBR', 'LBP', 'LBF')
  )
`;

const overdueAgingLabels = [
  "1 a 15 dias",
  "16 a 30 dias",
  "31 a 60 dias",
  "61 a 90 dias",
  "90+ dias",
];

const billingCompositionLabels = ["Ato", "Sinal", "Parcela"];

export async function loadGuardianEnterpriseDistributions(
  enterpriseName: string,
): Promise<
  | { data: GuardianEnterpriseDistributions; ok: true }
  | { missing: string[]; ok: false }
> {
  const poolResult = getGuardianDbPool();

  if (!poolResult.ok) {
    return poolResult;
  }

  const { pool } = poolResult;
  const [overdueAgingResult, billingCompositionResult] = await Promise.all([
    pool.query<EnterpriseDistributionRow[]>(`
      select bucket.enterprise_name, bucket.label, count(*) as total, bucket.sort_order
      from (
        select
          ${enterpriseDisplayExpression} as enterprise_name,
          case
            when datediff(curdate(), p.due_date) between 1 and 15 then '1 a 15 dias'
            when datediff(curdate(), p.due_date) between 16 and 30 then '16 a 30 dias'
            when datediff(curdate(), p.due_date) between 31 and 60 then '31 a 60 dias'
            when datediff(curdate(), p.due_date) between 61 and 90 then '61 a 90 dias'
            else '90+ dias'
          end as label,
          case
            when datediff(curdate(), p.due_date) between 1 and 15 then 1
            when datediff(curdate(), p.due_date) between 16 and 30 then 2
            when datediff(curdate(), p.due_date) between 31 and 60 then 3
            when datediff(curdate(), p.due_date) between 61 and 90 then 4
            else 5
          end as sort_order
        from payments p
        left join acquisition_requests ar on ar.id = p.acquisition_request_id
        left join enterprise_unities eu on eu.id = ar.enterprise_unity_id
        left join enterprises e on e.id = eu.enterprise_id
        where p.payment_status_id = 7
          and p.due_date is not null
          and ${activePaymentWhere}
          and ${validEnterpriseWhere}
      ) bucket
      group by bucket.enterprise_name, bucket.label, bucket.sort_order
      order by bucket.enterprise_name asc, bucket.sort_order asc
    `),
    pool.query<EnterpriseDistributionRow[]>(`
      select
        ${enterpriseDisplayExpression} as enterprise_name,
        pt.name as label,
        count(p.id) as total,
        pt.id as sort_order
      from payments p
      left join parcel_types pt on pt.id = p.parcel_type_id
      left join acquisition_requests ar on ar.id = p.acquisition_request_id
      left join enterprise_unities eu on eu.id = ar.enterprise_unity_id
      left join enterprises e on e.id = eu.enterprise_id
      where pt.id in (1, 2, 3)
        and p.payment_status_id in (5, 6, 7)
        and ${activePaymentWhere}
        and ${validEnterpriseWhere}
      group by enterprise_name, pt.id, pt.name
      order by enterprise_name asc, pt.id asc
    `),
  ]);
  const filteredAgingRows = filterEnterpriseDistributionRows(
    overdueAgingResult[0],
    enterpriseName,
  );
  const filteredCompositionRows = filterEnterpriseDistributionRows(
    billingCompositionResult[0],
    enterpriseName,
  );

  return {
    data: {
      billingComposition: completeDistribution(
        filteredCompositionRows,
        billingCompositionLabels,
      ),
      enterpriseName,
      generatedAt: new Date().toISOString(),
      overdueAging: completeDistribution(filteredAgingRows, overdueAgingLabels),
    },
    ok: true,
  };
}

export async function loadGuardianOverview(): Promise<
  | { data: GuardianOverviewSnapshot; ok: true }
  | { missing: string[]; ok: false }
> {
  const poolResult = getGuardianDbPool();

  if (!poolResult.ok) {
    return poolResult;
  }

  const { pool } = poolResult;
  const [
    summaryResult,
    stageResult,
    paymentStatusResult,
    enterprisePerformanceResult,
    overdueAgingResult,
    billingCompositionResult,
    recentProposalResult,
    overduePaymentResult,
    signatureQueueResult,
  ] = await Promise.all([
    pool.query<SummaryRow[]>(`
      select
        (select count(*) from acquisition_requests) as proposals_total,
        (select count(*) from acquisition_requests where open = 1) as proposals_open,
        (select count(*) from acquisition_requests where acquisition_request_stage_id = 5) as in_signature,
        (select count(*) from acquisition_requests where acquisition_request_stage_id = 6) as finalized,
        (select count(*) from payments p where ${overdueWhere}) as overdue_payments,
        (select coalesce(sum(${outstandingAmountExpression}), 0) from payments p where ${overdueWhere}) as overdue_amount,
        (select count(*) from payments p where p.payment_status_id in (5, 6, 7) and ${activePaymentWhere}) as total_portfolio_payments,
        (select coalesce(sum(${principalAmountExpression}), 0) from payments p where p.payment_status_id in (5, 6, 7) and ${activePaymentWhere}) as total_portfolio_amount,
        (select count(*) from payments p where p.payment_status_id = 5 and ${activePaymentWhere}) as liquidated_payments,
        (select coalesce(sum(${principalAmountExpression}), 0) from payments p where p.payment_status_id = 5 and ${activePaymentWhere}) as liquidated_amount,
        (select count(*) from payments p where p.payment_status_id = 6 and ${activePaymentWhere}) as pending_payments,
        (select coalesce(sum(${principalAmountExpression}), 0) from payments p where p.payment_status_id = 6 and ${activePaymentWhere}) as pending_amount,
        (select count(*) from payments p where p.payment_status_id = 7 and ${activePaymentWhere}) as overdue_principal_payments,
        (select coalesce(sum(${principalAmountExpression}), 0) from payments p where p.payment_status_id = 7 and ${activePaymentWhere}) as overdue_principal_amount,
        (select count(*) from payments p where ${monthlyRecoveryWhere}) as monthly_recovery_payments,
        (select coalesce(sum(coalesce(p.paid_value, 0)), 0) from payments p where ${monthlyRecoveryWhere}) as monthly_recovery_amount,
        (
          select count(distinct ar.client_id)
          from payments p
          left join acquisition_requests ar on ar.id = p.acquisition_request_id
          where p.payment_status_id = 7
            and ${activePaymentWhere}
            and ar.client_id is not null
        ) as overdue_clients,
        (
          select count(*)
          from (
            select p.acquisition_request_id
            from payments p
            where p.payment_status_id = 7
              and ${activePaymentWhere}
              and p.acquisition_request_id is not null
            group by p.acquisition_request_id
            having count(*) > 3
          ) critical_contracts
        ) as critical_contracts,
        (select count(*) from contract_signatures where contract_signature_status_id in (1, 2, 3, 7)) as signatures_pending,
        (select count(*) from enterprise_unities where sale_status_id = 1) as available_units
    `),
    pool.query<StageRow[]>(`
      select
        s.id,
        s.name,
        count(ar.id) as total,
        coalesce(sum(ar.annual_value), 0) as amount
      from acquisition_request_stages s
      left join acquisition_requests ar on ar.acquisition_request_stage_id = s.id
      group by s.id, s.name
      order by s.id asc
    `),
    pool.query<PaymentStatusRow[]>(`
      select
        ps.id,
        ps.name,
        count(p.id) as total,
        coalesce(sum(${outstandingAmountExpression}), 0) as amount
      from payment_statuses ps
      left join payments p on p.payment_status_id = ps.id
        and (p.payment_to_delete is null or p.payment_to_delete = 0)
      group by ps.id, ps.name
      order by ps.id asc
    `),
    pool.query<EnterprisePerformanceRow[]>(`
      select
        enterprise_name,
        sum(case when payment_status_id in (5, 6, 7) then 1 else 0 end) as total_portfolio_payments,
        coalesce(sum(case when payment_status_id in (5, 6, 7) then initial_amount else 0 end), 0) as total_portfolio_amount,
        coalesce(sum(case when payment_status_id in (5, 7) then initial_amount else 0 end), 0) as delinquency_base_amount,
        sum(case when payment_status_id = 7 then 1 else 0 end) as overdue_principal_payments,
        coalesce(sum(case when payment_status_id = 7 then initial_amount else 0 end), 0) as overdue_principal_amount,
        count(distinct case when payment_status_id = 7 then client_id else null end) as overdue_clients,
        sum(case when is_monthly_recovery = 1 then 1 else 0 end) as monthly_recovery_payments,
        coalesce(sum(case when is_monthly_recovery = 1 then paid_amount else 0 end), 0) as monthly_recovery_amount
      from (
        select
          p.id,
          p.payment_status_id,
          coalesce(p.initial_value, 0) as initial_amount,
          coalesce(p.paid_value, 0) as paid_amount,
          ar.client_id,
          ${enterpriseDisplayExpression} as enterprise_name,
          case
            when p.payment_status_id = 5
              and p.payment_date is not null
              and p.due_date is not null
              and p.payment_date >= cast(date_format(curdate(), '%Y-%m-01') as date)
              and p.payment_date < date_add(cast(date_format(curdate(), '%Y-%m-01') as date), interval 1 month)
              and datediff(p.payment_date, p.due_date) > 10
            then 1
            else 0
          end as is_monthly_recovery
        from payments p
        left join acquisition_requests ar on ar.id = p.acquisition_request_id
        left join enterprise_unities eu on eu.id = ar.enterprise_unity_id
        left join enterprises e on e.id = eu.enterprise_id
        where ${activePaymentWhere}
          and ${validEnterpriseWhere}
      ) enterprise_payments
      group by enterprise_name
      having total_portfolio_amount > 0
        or overdue_principal_amount > 0
        or monthly_recovery_amount > 0
      order by total_portfolio_amount desc, enterprise_name asc
      limit 20
    `),
    pool.query<DistributionRow[]>(`
      select bucket.label, count(*) as total, bucket.sort_order
      from (
        select
          case
            when datediff(curdate(), p.due_date) between 1 and 15 then '1 a 15 dias'
            when datediff(curdate(), p.due_date) between 16 and 30 then '16 a 30 dias'
            when datediff(curdate(), p.due_date) between 31 and 60 then '31 a 60 dias'
            when datediff(curdate(), p.due_date) between 61 and 90 then '61 a 90 dias'
            else '90+ dias'
          end as label,
          case
            when datediff(curdate(), p.due_date) between 1 and 15 then 1
            when datediff(curdate(), p.due_date) between 16 and 30 then 2
            when datediff(curdate(), p.due_date) between 31 and 60 then 3
            when datediff(curdate(), p.due_date) between 61 and 90 then 4
            else 5
          end as sort_order
        from payments p
        left join acquisition_requests ar on ar.id = p.acquisition_request_id
        left join enterprise_unities eu on eu.id = ar.enterprise_unity_id
        left join enterprises e on e.id = eu.enterprise_id
        where p.payment_status_id = 7
          and p.due_date is not null
          and ${activePaymentWhere}
          and ${validEnterpriseWhere}
      ) bucket
      group by bucket.label, bucket.sort_order
      order by bucket.sort_order asc
    `),
    pool.query<DistributionRow[]>(`
      select
        pt.name as label,
        count(p.id) as total,
        pt.id as sort_order
      from parcel_types pt
      left join payments p on p.parcel_type_id = pt.id
        and p.payment_status_id in (5, 6, 7)
        and ${activePaymentWhere}
      left join acquisition_requests ar on ar.id = p.acquisition_request_id
      left join enterprise_unities eu on eu.id = ar.enterprise_unity_id
      left join enterprises e on e.id = eu.enterprise_id
      where pt.id in (1, 2, 3)
        and (
          p.id is null
          or (${validEnterpriseWhere})
        )
      group by pt.id, pt.name
      order by pt.id asc
    `),
    pool.query<ProposalRow[]>(`
      select
        ar.id,
        ar.code,
        ar.annual_value,
        ar.created_at,
        ar.updated_at,
        ar.open,
        ars.name as stage_name,
        art.name as type_name,
        client.name as client_name,
        broker.name as broker_name,
        coalesce(e.divulgation_name, e.name) as enterprise_name,
        eu.name as unity_name,
        eu.block,
        eu.lot
      from acquisition_requests ar
      left join acquisition_request_stages ars on ars.id = ar.acquisition_request_stage_id
      left join acquisition_request_types art on art.id = ar.acquisition_request_type_id
      left join users client on client.id = ar.client_id
      left join users broker on broker.id = ar.corretor_id
      left join enterprise_unities eu on eu.id = ar.enterprise_unity_id
      left join enterprises e on e.id = eu.enterprise_id
      order by ar.updated_at desc
      limit 12
    `),
    pool.query<PaymentRow[]>(`
      select
        p.id,
        ${outstandingAmountExpression} as amount,
        p.current_total_parcel,
        p.total_parcels,
        p.due_date,
        ps.name as status_name,
        pt.name as parcel_type_name,
        ar.code,
        client.name as client_name,
        coalesce(e.divulgation_name, e.name) as enterprise_name,
        eu.name as unity_name
      from payments p
      left join payment_statuses ps on ps.id = p.payment_status_id
      left join parcel_types pt on pt.id = p.parcel_type_id
      left join acquisition_requests ar on ar.id = p.acquisition_request_id
      left join users client on client.id = ar.client_id
      left join enterprise_unities eu on eu.id = ar.enterprise_unity_id
      left join enterprises e on e.id = eu.enterprise_id
      where ${overdueWhere}
      order by p.due_date asc, p.id asc
      limit 12
    `),
    pool.query<SignatureRow[]>(`
      select
        cs.id,
        cs.updated_at,
        cs.contract_type,
        css.name as status_name,
        arc.id as contract_id,
        ar.code,
        client.name as client_name,
        coalesce(e.divulgation_name, e.name) as enterprise_name,
        eu.name as unity_name
      from contract_signatures cs
      left join contract_signature_statuses css on css.id = cs.contract_signature_status_id
      left join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
      left join acquisition_requests ar on ar.id = arc.acquisition_request_id
      left join users client on client.id = ar.client_id
      left join enterprise_unities eu on eu.id = ar.enterprise_unity_id
      left join enterprises e on e.id = eu.enterprise_id
      where cs.contract_signature_status_id in (1, 2, 3, 7)
      order by cs.updated_at desc
      limit 12
    `),
  ]);

  const summary = summaryResult[0][0] ?? {
    available_units: 0,
    critical_contracts: 0,
    finalized: 0,
    in_signature: 0,
    liquidated_amount: 0,
    liquidated_payments: 0,
    monthly_recovery_amount: 0,
    monthly_recovery_payments: 0,
    overdue_amount: 0,
    overdue_clients: 0,
    overdue_principal_amount: 0,
    overdue_principal_payments: 0,
    overdue_payments: 0,
    pending_amount: 0,
    pending_payments: 0,
    proposals_open: 0,
    proposals_total: 0,
    signatures_pending: 0,
    total_portfolio_amount: 0,
    total_portfolio_payments: 0,
  };

  return {
    data: {
      billingComposition: billingCompositionResult[0].map(mapDistribution),
      enterprisePerformance: enterprisePerformanceResult[0].map(
        mapEnterprisePerformance,
      ),
      generatedAt: new Date().toISOString(),
      overduePayments: overduePaymentResult[0].map(mapPayment),
      overdueAging: completeDistribution(overdueAgingResult[0], overdueAgingLabels),
      paymentStatuses: paymentStatusResult[0].map(mapPaymentStatus),
      recentProposals: recentProposalResult[0].map(mapProposal),
      signatureQueue: signatureQueueResult[0].map(mapSignature),
      stages: stageResult[0].map(mapStage),
      summary: {
        availableUnits: toNumber(summary.available_units),
        criticalContracts: toNumber(summary.critical_contracts),
        liquidatedAmount: toNumber(summary.liquidated_amount),
        liquidatedPayments: toNumber(summary.liquidated_payments),
        finalizedProposals: toNumber(summary.finalized),
        inSignatureProposals: toNumber(summary.in_signature),
        monthlyRecoveryAmount: toNumber(summary.monthly_recovery_amount),
        monthlyRecoveryPayments: toNumber(summary.monthly_recovery_payments),
        overdueAmount: toNumber(summary.overdue_amount),
        overdueClients: toNumber(summary.overdue_clients),
        overduePrincipalAmount: toNumber(summary.overdue_principal_amount),
        overduePrincipalPayments: toNumber(summary.overdue_principal_payments),
        overduePayments: toNumber(summary.overdue_payments),
        openProposals: toNumber(summary.proposals_open),
        pendingSignatures: toNumber(summary.signatures_pending),
        pendingAmount: toNumber(summary.pending_amount),
        pendingPayments: toNumber(summary.pending_payments),
        totalPortfolioAmount: toNumber(summary.total_portfolio_amount),
        totalPortfolioPayments: toNumber(summary.total_portfolio_payments),
        totalProposals: toNumber(summary.proposals_total),
      },
    },
    ok: true,
  };
}

function mapStage(row: StageRow): GuardianStageBucket {
  return {
    amount: toNumber(row.amount),
    id: toNumber(row.id),
    name: row.name,
    total: toNumber(row.total),
  };
}

function mapPaymentStatus(row: PaymentStatusRow): GuardianPaymentStatusBucket {
  return mapStage(row);
}

function mapDistribution(row: DistributionRow): GuardianDistributionBucket {
  return {
    label: row.label,
    total: toNumber(row.total),
  };
}

function completeDistribution(rows: DistributionRow[], labels: string[]) {
  const totalsByLabel = new Map(
    rows.map((row) => [row.label, toNumber(row.total)]),
  );

  return labels.map((label) => ({
    label,
    total: totalsByLabel.get(label) ?? 0,
  }));
}

function filterEnterpriseDistributionRows(
  rows: EnterpriseDistributionRow[],
  enterpriseName: string,
) {
  const targetName = formatEnterpriseName(enterpriseName);

  return rows.filter(
    (row) => formatEnterpriseName(row.enterprise_name) === targetName,
  );
}

function mapEnterprisePerformance(
  row: EnterprisePerformanceRow,
): GuardianEnterprisePerformance {
  return {
    delinquencyBaseAmount: toNumber(row.delinquency_base_amount),
    enterpriseName: formatEnterpriseName(row.enterprise_name),
    monthlyRecoveryAmount: toNumber(row.monthly_recovery_amount),
    monthlyRecoveryPayments: toNumber(row.monthly_recovery_payments),
    overdueClients: toNumber(row.overdue_clients),
    overduePrincipalAmount: toNumber(row.overdue_principal_amount),
    overduePrincipalPayments: toNumber(row.overdue_principal_payments),
    totalPortfolioAmount: toNumber(row.total_portfolio_amount),
    totalPortfolioPayments: toNumber(row.total_portfolio_payments),
  };
}

function formatEnterpriseName(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  const minorWords = new Set(["a", "as", "da", "das", "de", "do", "dos", "e"]);
  const preservedCodes = new Set(["LBF", "LBP", "LBR"]);

  return normalized
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((word, index) => {
      const rawWord = normalized.split(" ")[index] ?? word;

      if (index > 0 && minorWords.has(word)) {
        return word;
      }

      if (preservedCodes.has(rawWord)) {
        return rawWord;
      }

      return word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1);
    })
    .join(" ");
}

function mapProposal(row: ProposalRow): GuardianProposalListItem {
  return {
    amount: toNumber(row.annual_value),
    brokerName: row.broker_name ?? undefined,
    clientName: row.client_name ?? undefined,
    code: row.code ?? undefined,
    createdAt: toIsoString(row.created_at),
    enterpriseName: row.enterprise_name ?? undefined,
    id: toNumber(row.id),
    isOpen: row.open === 1 || row.open === "1",
    stageName: row.stage_name ?? undefined,
    typeName: row.type_name ?? undefined,
    unitLabel: getUnitLabel(row.unity_name, row.block, row.lot),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapPayment(row: PaymentRow): GuardianPaymentListItem {
  return {
    amount: toNumber(row.amount),
    clientName: row.client_name ?? undefined,
    code: row.code ?? undefined,
    dueDate: toIsoString(row.due_date),
    enterpriseName: row.enterprise_name ?? undefined,
    id: toNumber(row.id),
    parcelLabel: getParcelLabel(
      row.parcel_type_name,
      row.current_total_parcel,
      row.total_parcels,
    ),
    statusName: row.status_name ?? undefined,
    unitLabel: row.unity_name ?? undefined,
  };
}

function mapSignature(row: SignatureRow): GuardianSignatureListItem {
  return {
    clientName: row.client_name ?? undefined,
    code: row.code ?? undefined,
    contractId: toNumber(row.contract_id),
    contractType: row.contract_type ?? undefined,
    enterpriseName: row.enterprise_name ?? undefined,
    id: toNumber(row.id),
    statusName: row.status_name ?? undefined,
    unitLabel: row.unity_name ?? undefined,
    updatedAt: toIsoString(row.updated_at),
  };
}

function getParcelLabel(
  parcelType: string | null,
  currentParcel: number | string | null,
  totalParcels: number | string | null,
) {
  const current = toNumber(currentParcel);
  const total = toNumber(totalParcels);
  const prefix = parcelType ?? "Parcela";

  if (current > 0 && total > 0) {
    return `${prefix} ${current}/${total}`;
  }

  return prefix;
}

function getUnitLabel(
  unityName: string | null,
  block: string | null,
  lot: string | null,
) {
  if (unityName) {
    return unityName;
  }

  return [block ? `Quadra ${block}` : null, lot ? `Lote ${lot}` : null]
    .filter(Boolean)
    .join(" / ") || undefined;
}

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoString(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
