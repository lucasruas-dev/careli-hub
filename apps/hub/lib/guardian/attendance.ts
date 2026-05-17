import type { Pool, RowDataPacket } from "mysql2/promise";

import { getGuardianDbPool, sanitizeGuardianDbError } from "@/lib/guardian/db";
import { buildQueueClientsFromSources } from "@/modules/guardian/attendance/data";
import type {
  GuardianAttendanceSourceClient,
  GuardianAttendanceSourceUnit,
} from "@/modules/guardian/attendance/data";
import type { AttendancePriority, QueueClient } from "@/modules/guardian/attendance/types";

type AttendanceContractRow = RowDataPacket & {
  acquisition_request_code: string | null;
  acquisition_request_id: number | string;
  area: number | string | null;
  birthday: Date | string | null;
  block: string | null;
  cellphone: string | null;
  client_address: string | null;
  client_address_complement: string | null;
  client_address_district: string | null;
  client_address_number: string | null;
  client_address_zipcode: string | null;
  client_city_name: string | null;
  civil_state_name: string | null;
  client_email: string | null;
  client_fantasy_name: string | null;
  client_id: number | string | null;
  client_name: string | null;
  client_social_name: string | null;
  cnpj: string | null;
  contact_phone: string | null;
  cpf: string | null;
  document_type_name: string | null;
  enterprise_code: string | null;
  enterprise_name: string | null;
  identification_number: string | null;
  liquidated_payments: number | string;
  lot: string | null;
  max_overdue_days: number | string | null;
  mother_name: string | null;
  nacionality: string | null;
  naturalness: string | null;
  oldest_due_date: Date | string | null;
  overdue_amount: number | string | null;
  overdue_payments: number | string;
  parcel_payments: number | string;
  pending_payments: number | string;
  person_type_name: string | null;
  phone: string | null;
  profession_name: string | null;
  property_regime_name: string | null;
  recovered_amount: number | string | null;
  rg: string | null;
  salary_range_name: string | null;
  schooling_name: string | null;
  sex_name: string | null;
  signed_contract_document_id: string | null;
  signed_contract_status: string | null;
  signed_contract_url: string | null;
  signal_payments: number | string;
  total_payments: number | string;
  unity_id: number | string | null;
  unity_name: string | null;
  unit_price: number | string | null;
  client_state_acronym: string | null;
  spouse_address: string | null;
  spouse_address_complement: string | null;
  spouse_address_district: string | null;
  spouse_address_number: string | null;
  spouse_address_zipcode: string | null;
  spouse_birthday: Date | string | null;
  spouse_cellphone: string | null;
  spouse_city_name: string | null;
  spouse_cpf: string | null;
  spouse_document_type_name: string | null;
  spouse_email: string | null;
  spouse_identification_number: string | null;
  spouse_nacionality: string | null;
  spouse_name: string | null;
  spouse_profession_name: string | null;
  spouse_sex_name: string | null;
  spouse_state_acronym: string | null;
  vinculed_name: string | null;
};

type AttendanceInstallmentRow = RowDataPacket & {
  acquisition_request_id: number | string;
  current_signal_parcel: number | string | null;
  current_total_parcel: number | string | null;
  due_date: Date | string | null;
  due_date_value: string | null;
  id: number | string;
  initial_value: number | string | null;
  interest_value: number | string | null;
  invoice_url: string | null;
  asaas_payment_id: string | null;
  mulct_value: number | string | null;
  payment_date_value: string | null;
  paid_value: number | string | null;
  parcel_type_id: number | string | null;
  parcel_type_name: string | null;
  payment_status_id: number | string | null;
  payment_url: string | null;
  total_parcels: number | string | null;
  total_signal_parcels: number | string | null;
};

type AttendanceQueueOptions = {
  clientId?: string;
  includeClientsWithoutOverdue?: boolean;
  includeInstallments?: boolean;
  limit?: number;
  strict?: boolean;
};

const activePaymentWhere =
  "(p.payment_to_delete is null or p.payment_to_delete = 0)";

const outstandingAmountExpression = `
  coalesce(
    nullif(p.paid_value, 0),
    coalesce(p.initial_value, 0)
      + coalesce(p.interest_value, 0)
      + coalesce(p.mulct_value, 0),
    0
  )
`;

const monthlyRecoveryWhere = `
  p.payment_status_id = 5
  and p.payment_date is not null
  and p.due_date is not null
  and p.payment_date >= cast(date_format(curdate(), '%Y-%m-01') as date)
  and p.payment_date < date_add(cast(date_format(curdate(), '%Y-%m-01') as date), interval 1 month)
  and datediff(p.payment_date, p.due_date) > 10
`;

const enterpriseDisplayExpression = `
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

const validEnterpriseWhere = `
  e.id is not null
  and upper(trim(coalesce(e.code, ''))) in (
    'REP', 'EDL', 'LOU', 'LOS', 'PDV', 'PVS', 'RDP', 'RPS', 'RPC',
    'LBR', 'LBP', 'LBF', 'MDS', 'MLN', 'VDO', 'VAL', 'VDP'
  )
`;

function guardianDbConfigError(missing: string[]) {
  return Object.assign(
    new Error(`Configuracao do banco C2X ausente: ${missing.join(", ")}`),
    { code: "GUARDIAN_DB_CONFIG_MISSING" },
  );
}

export async function loadGuardianAttendanceQueue(
  options: AttendanceQueueOptions = {},
): Promise<QueueClient[]> {
  const poolResult = getGuardianDbPool();

  if (!poolResult.ok) {
    if (options.strict) {
      throw guardianDbConfigError(poolResult.missing);
    }

    return [];
  }

  const { pool } = poolResult;
  const c2xClientId = c2xClientIdFromQueueId(options.clientId);
  const includeClientsWithoutOverdue = options.includeClientsWithoutOverdue ?? false;
  const includeInstallments = options.includeInstallments ?? false;
  const queueLimit = normalizeQueueLimit(options.limit);
  const queryParams: Array<number | string> = [];
  const clientFilter = c2xClientId ? "and ar.client_id = ?" : "";
  const overdueFilter = includeClientsWithoutOverdue ? "" : "having overdue_payments > 0";
  const limitClause = c2xClientId ? "" : "limit ?";

  if (c2xClientId) {
    queryParams.push(c2xClientId);
  }

  if (!c2xClientId) {
    queryParams.push(queueLimit);
  }

  try {
    const [contractRows] = await pool.query<AttendanceContractRow[]>(`
    select
      ar.id as acquisition_request_id,
      ar.code as acquisition_request_code,
      ar.client_id,
      client.name as client_name,
      client.fantasy_name as client_fantasy_name,
      client.social_name as client_social_name,
      client.cpf,
      client.rg,
      client.cnpj,
      client.email as client_email,
      client.phone,
      client.cellphone,
      (
        select ph.phone
        from phones ph
        where ph.ownertable_type = 'User'
          and ph.ownertable_id = client.id
          and trim(coalesce(ph.phone, '')) <> ''
        order by ph.is_whatsapp desc, ph.updated_at desc, ph.id desc
        limit 1
      ) as contact_phone,
      client.birthday,
      client.identification_number,
      client.mother_name,
      client.nacionality,
      client.naturalness,
      person_type.name as person_type_name,
      sex.name as sex_name,
      civil.name as civil_state_name,
      document_type.name as document_type_name,
      profession.name as profession_name,
      property_regime.name as property_regime_name,
      salary.name as salary_range_name,
      schooling.name as schooling_name,
      client_address.zipcode as client_address_zipcode,
      client_address.address as client_address,
      client_address.number as client_address_number,
      client_address.complement as client_address_complement,
      client_address.district as client_address_district,
      client_city.name as client_city_name,
      client_state.acronym as client_state_acronym,
      spouse.name as spouse_name,
      spouse.cpf as spouse_cpf,
      spouse.cellphone as spouse_cellphone,
      spouse.birthday as spouse_birthday,
      spouse.email as spouse_email,
      spouse.identification_number as spouse_identification_number,
      spouse.nacionality as spouse_nacionality,
      spouse_document_type.name as spouse_document_type_name,
      spouse_sex.name as spouse_sex_name,
      spouse_profession.name as spouse_profession_name,
      spouse_address.zipcode as spouse_address_zipcode,
      spouse_address.address as spouse_address,
      spouse_address.number as spouse_address_number,
      spouse_address.complement as spouse_address_complement,
      spouse_address.district as spouse_address_district,
      spouse_city.name as spouse_city_name,
      spouse_state.acronym as spouse_state_acronym,
      coalesce(
        nullif(trim(vinculed.fantasy_name), ''),
        nullif(trim(vinculed.social_name), ''),
        nullif(trim(vinculed.name), '')
      ) as vinculed_name,
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
      eu.id as unity_id,
      eu.name as unity_name,
      eu.block,
      eu.lot,
      eu.area,
      eu.price as unit_price,
      e.code as enterprise_code,
      ${enterpriseDisplayExpression} as enterprise_name,
      count(case when p.payment_status_id in (5, 6, 7) then p.id end) as total_payments,
      count(case when p.payment_status_id = 5 then p.id end) as liquidated_payments,
      count(case when p.payment_status_id = 6 then p.id end) as pending_payments,
      count(case when p.payment_status_id = 7 then p.id end) as overdue_payments,
      count(case when p.parcel_type_id = 2 then p.id end) as signal_payments,
      count(case when p.parcel_type_id = 3 then p.id end) as parcel_payments,
      coalesce(sum(case when p.payment_status_id = 7 then ${outstandingAmountExpression} else 0 end), 0) as overdue_amount,
      coalesce(sum(case when ${monthlyRecoveryWhere} then coalesce(p.paid_value, 0) else 0 end), 0) as recovered_amount,
      min(case when p.payment_status_id = 7 then p.due_date else null end) as oldest_due_date,
      max(case when p.payment_status_id = 7 and p.due_date is not null then datediff(curdate(), p.due_date) else 0 end) as max_overdue_days
    from payments p
    left join acquisition_requests ar on ar.id = p.acquisition_request_id
    left join users client on client.id = ar.client_id
    left join users vinculed on vinculed.id = client.vinculed_by_id
    left join person_types person_type on person_type.id = client.person_type_id
    left join sexes sex on sex.id = client.sex_id
    left join civil_states civil on civil.id = client.civil_state_id
    left join document_types document_type on document_type.id = client.document_type_id
    left join professions profession on profession.id = client.profession_id
    left join property_regimes property_regime on property_regime.id = client.property_regime_id
    left join salary_ranges salary on salary.id = client.salary_range_id
    left join schoolings schooling on schooling.id = client.schooling_id
    left join addresses client_address on client_address.id = (
      select addr.id
      from addresses addr
      where addr.ownertable_type = 'User'
        and addr.ownertable_id = client.id
      order by addr.updated_at desc, addr.id desc
      limit 1
    )
    left join cities client_city on client_city.id = client_address.city_id
    left join states client_state on client_state.id = coalesce(client_address.state_id, client_city.state_id)
    left join spouses spouse on spouse.id = (
      select sp.id
      from spouses sp
      where sp.ownertable_type = 'User'
        and sp.ownertable_id = client.id
      order by sp.updated_at desc, sp.id desc
      limit 1
    )
    left join document_types spouse_document_type on spouse_document_type.id = spouse.document_type_id
    left join sexes spouse_sex on spouse_sex.id = spouse.sex_id
    left join professions spouse_profession on spouse_profession.id = spouse.profession_id
    left join addresses spouse_address on spouse_address.id = (
      select addr.id
      from addresses addr
      where addr.ownertable_type = 'Spouse'
        and addr.ownertable_id = spouse.id
      order by addr.updated_at desc, addr.id desc
      limit 1
    )
    left join cities spouse_city on spouse_city.id = spouse_address.city_id
    left join states spouse_state on spouse_state.id = coalesce(spouse_address.state_id, spouse_city.state_id)
    left join enterprise_unities eu on eu.id = ar.enterprise_unity_id
    left join enterprises e on e.id = eu.enterprise_id
    where p.payment_status_id in (5, 6, 7)
      and ${activePaymentWhere}
      and ${validEnterpriseWhere}
      and ar.id is not null
      ${clientFilter}
    group by
      ar.id,
      ar.code,
      ar.client_id,
      client.name,
      client.fantasy_name,
      client.social_name,
      client.cpf,
      client.rg,
      client.cnpj,
      client.email,
      client.phone,
      client.cellphone,
      client.birthday,
      client.identification_number,
      client.mother_name,
      client.nacionality,
      client.naturalness,
      person_type.name,
      sex.name,
      civil.name,
      document_type.name,
      profession.name,
      property_regime.name,
      salary.name,
      schooling.name,
      client_address.zipcode,
      client_address.address,
      client_address.number,
      client_address.complement,
      client_address.district,
      client_city.name,
      client_state.acronym,
      spouse.name,
      spouse.cpf,
      spouse.cellphone,
      spouse.birthday,
      spouse.email,
      spouse.identification_number,
      spouse.nacionality,
      spouse_document_type.name,
      spouse_sex.name,
      spouse_profession.name,
      spouse_address.zipcode,
      spouse_address.address,
      spouse_address.number,
      spouse_address.complement,
      spouse_address.district,
      spouse_city.name,
      spouse_state.acronym,
      vinculed.fantasy_name,
      vinculed.social_name,
      vinculed.name,
      eu.id,
      eu.name,
      eu.block,
      eu.lot,
      eu.area,
      eu.price,
      e.id,
      e.code,
      e.name,
      e.divulgation_name
    ${overdueFilter}
    order by overdue_payments desc, max_overdue_days desc, overdue_amount desc, ar.id desc
    ${limitClause}
    `, queryParams);

    if (contractRows.length === 0) {
      return [];
    }

    const requestIds = contractRows
      .map((row) => toNumber(row.acquisition_request_id))
      .filter((id) => id > 0);
    const installmentsByRequestId = includeInstallments
      ? await loadInstallmentsByRequestId(pool, requestIds, contractRows)
      : new Map<string, QueueClient["c2xInstallments"]>();
    const sourceClients = groupContractRowsByClient(
      contractRows,
      installmentsByRequestId,
      includeInstallments,
    );

    return buildQueueClientsFromSources(sourceClients);
  } catch (error) {
    console.error("[guardian-attendance] C2X query failed", sanitizeGuardianDbError(error));
    if (options.strict) {
      throw error;
    }

    return [];
  }
}

export async function loadGuardianAttendanceClient(clientId: string) {
  const clients = await loadGuardianAttendanceQueue({
    clientId,
    includeClientsWithoutOverdue: true,
    includeInstallments: true,
    strict: true,
  });

  return clients[0] ?? null;
}

async function loadInstallmentsByRequestId(
  pool: Pool,
  requestIds: number[],
  contracts: AttendanceContractRow[],
) {
  if (requestIds.length === 0) {
    return new Map<string, QueueClient["c2xInstallments"]>();
  }

  const unitByRequestId = new Map(
    contracts.map((row) => {
      const block = normalizeBlock(row.block);
      const lot = normalizeLot(row.lot);
      const code = row.unity_name ?? unitCode(row.enterprise_code, block, lot);
      const enterpriseName = formatName(row.enterprise_name ?? "Empreendimento");

      return [
        String(row.acquisition_request_id),
        {
          code,
          id: buildUnitId(row.acquisition_request_id, row.unity_id),
          label: `${enterpriseName} Q${formatBlockForLabel(block)} L${formatLotForLabel(lot)}`,
        },
      ];
    }),
  );
  const [rows] = await pool.query<AttendanceInstallmentRow[]>(
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
        and ${activePaymentWhere}
      order by p.acquisition_request_id asc, p.due_date asc, p.id asc
    `,
    [requestIds],
  );
  const installmentsByRequestId = new Map<string, QueueClient["c2xInstallments"]>();

  rows.forEach((row) => {
    const requestId = String(row.acquisition_request_id);
    const current = installmentsByRequestId.get(requestId) ?? [];
    const status = installmentStatus(row.payment_status_id);
    const unit = unitByRequestId.get(requestId);
    const dueDateInput = normalizeDateOnly(row.due_date_value) || formatDateInput(toDate(row.due_date));
    const originalDueDateInput = dueDateInput;
    const paymentDateInput = normalizeDateOnly(row.payment_date_value);
    const referenceInput = originalDueDateInput || dueDateInput;
    const valueNumber = amountFromRow(row);

    current.push({
      acquisitionRequestId: requestId,
      dueDate: formatDateFromDateOnly(dueDateInput),
      dueDateChanged: Boolean(originalDueDateInput && dueDateInput && originalDueDateInput !== dueDateInput),
      dueDateInput,
      dueDateOriginal: formatDateFromDateOnly(originalDueDateInput),
      dueDateOriginalInput: originalDueDateInput,
      id: String(row.id),
      asaasPaymentId: firstFilled(row.asaas_payment_id) ?? undefined,
      invoiceUrl: firstFilled(row.invoice_url) ?? undefined,
      number: parcelNumber(row),
      overdueDays:
        status === "Vencida" && dueDateInput
          ? Math.max(daysBetweenDateOnly(dueDateInput, new Date()), 1)
          : 0,
      paymentDate: paymentDateInput ? formatDateFromDateOnly(paymentDateInput) : undefined,
      paymentDateInput,
      paymentUrl: firstFilled(row.payment_url) ?? undefined,
      reference: formatReferenceFromDateOnly(referenceInput),
      referenceValue: referenceValueFromDateOnly(referenceInput),
      status,
      unitCode: unit?.code,
      unitId: unit?.id ?? buildUnitId(requestId, null),
      unitLabel: unit?.label,
      value: formatCurrency(valueNumber),
      valueNumber,
    });
    installmentsByRequestId.set(requestId, current);
  });

  return installmentsByRequestId;
}

type ClientSourceAggregate = {
  liquidatedPayments: number;
  maxOverdueDays: number;
  oldestDueDate: Date | null;
  overdueAmount: number;
  overduePayments: number;
  parcelPayments: number;
  pendingPayments: number;
  recoveredAmount: number;
  requestCount: number;
  signalPayments: number;
  source: GuardianAttendanceSourceClient;
  totalPayments: number;
  unitIds: Set<string>;
};

function groupContractRowsByClient(
  rows: AttendanceContractRow[],
  installmentsByRequestId: Map<string, QueueClient["c2xInstallments"]>,
  installmentsLoaded: boolean,
) {
  const aggregates = new Map<string, ClientSourceAggregate>();

  rows.forEach((row) => {
    const source = mapContractRowToSourceClient(row, installmentsByRequestId, installmentsLoaded);
    const key = row.client_id
      ? `c2x-client-${String(row.client_id)}`
      : source.id;
    const unit = source.c2xUnits?.[0];
    const existing = aggregates.get(key);

    if (!existing) {
      source.id = key;
      aggregates.set(key, {
        liquidatedPayments: toNumber(row.liquidated_payments),
        maxOverdueDays: toNumber(row.max_overdue_days),
        oldestDueDate: toDate(row.oldest_due_date),
        overdueAmount: toNumber(row.overdue_amount),
        overduePayments: toNumber(row.overdue_payments),
        parcelPayments: toNumber(row.parcel_payments),
        pendingPayments: toNumber(row.pending_payments),
        recoveredAmount: toNumber(row.recovered_amount),
        requestCount: 1,
        signalPayments: toNumber(row.signal_payments),
        source,
        totalPayments: toNumber(row.total_payments),
        unitIds: new Set(unit ? [unit.id] : []),
      });
      return;
    }

    existing.requestCount += 1;
    existing.totalPayments += toNumber(row.total_payments);
    existing.liquidatedPayments += toNumber(row.liquidated_payments);
    existing.pendingPayments += toNumber(row.pending_payments);
    existing.overduePayments += toNumber(row.overdue_payments);
    existing.signalPayments += toNumber(row.signal_payments);
    existing.parcelPayments += toNumber(row.parcel_payments);
    existing.overdueAmount += toNumber(row.overdue_amount);
    existing.recoveredAmount += toNumber(row.recovered_amount);
    existing.maxOverdueDays = Math.max(existing.maxOverdueDays, toNumber(row.max_overdue_days));
    existing.oldestDueDate = earliestDate(existing.oldestDueDate, toDate(row.oldest_due_date));
    existing.source.parcelasTotal += source.parcelasTotal;
    existing.source.parcelasLiquidadas += source.parcelasLiquidadas;
    existing.source.parcelasAVencer += source.parcelasAVencer;
    existing.source.parcelasVencidas += source.parcelasVencidas;
    existing.source.saldoAtraso += source.saldoAtraso;
    existing.source.recuperado += source.recuperado;
    existing.source.valorUnidade += source.valorUnidade;
    existing.source.c2xInstallments = [
      ...(existing.source.c2xInstallments ?? []),
      ...(source.c2xInstallments ?? []),
    ];

    if (unit && !existing.unitIds.has(unit.id)) {
      existing.unitIds.add(unit.id);
      existing.source.c2xUnits = [...(existing.source.c2xUnits ?? []), unit];
    }
  });

  return Array.from(aggregates.values())
    .map((aggregate) => {
      const risk = riskAnalysisFor({
        liquidatedPayments: aggregate.liquidatedPayments,
        overdueAmount: aggregate.overdueAmount,
        overdueDays: aggregate.maxOverdueDays,
        overduePayments: aggregate.overduePayments,
        totalPayments: aggregate.totalPayments,
      });
      const priority = risk.priority;
      const source = aggregate.source;

      source.parcelasTotal = aggregate.totalPayments;
      source.parcelasLiquidadas = aggregate.liquidatedPayments;
      source.parcelasAVencer = aggregate.pendingPayments;
      source.parcelasVencidas = aggregate.overduePayments;
      source.saldoAtraso = aggregate.overdueAmount;
      source.recuperado = aggregate.recoveredAmount;
      source.atrasoDias = aggregate.maxOverdueDays;
      source.scoreRisco = risk.score;
      source.prioridade = priority;
      source.status = statusFor(priority, aggregate.maxOverdueDays, aggregate.overduePayments);
      source.perfilParcela =
        aggregate.parcelPayments > 0 && aggregate.parcelPayments >= aggregate.signalPayments
          ? "Parcela"
          : aggregate.signalPayments > 0
            ? "Sinal"
            : "Ato";
      source.vencimento = formatDateInput(aggregate.oldestDueDate);
      source.relacionamento =
        aggregate.requestCount > 1
          ? `${aggregate.requestCount} contratos C2X`
          : source.relacionamento;

      return source;
    })
    .sort((first, second) => {
      if (second.atrasoDias !== first.atrasoDias) {
        return second.atrasoDias - first.atrasoDias;
      }

      return second.saldoAtraso - first.saldoAtraso;
    });
}

function mapContractRowToSourceClient(
  row: AttendanceContractRow,
  installmentsByRequestId: Map<string, QueueClient["c2xInstallments"]>,
  installmentsLoaded: boolean,
): GuardianAttendanceSourceClient {
  const requestId = String(row.acquisition_request_id);
  const overduePayments = toNumber(row.overdue_payments);
  const pendingPayments = toNumber(row.pending_payments);
  const liquidatedPayments = toNumber(row.liquidated_payments);
  const totalPayments = toNumber(row.total_payments);
  const maxOverdueDays = toNumber(row.max_overdue_days);
  const overdueAmount = toNumber(row.overdue_amount);
  const risk = riskAnalysisFor({
    liquidatedPayments,
    overdueAmount,
    overdueDays: maxOverdueDays,
    overduePayments,
    totalPayments,
  });
  const priority = risk.priority;
  const enterpriseName = formatName(row.enterprise_name ?? "Empreendimento");
  const block = normalizeBlock(row.block);
  const lot = normalizeLot(row.lot);
  const unitId = buildUnitId(row.acquisition_request_id, row.unity_id);
  const clientAddress = formatAddress({
    address: row.client_address,
    city: row.client_city_name,
    complement: row.client_address_complement,
    district: row.client_address_district,
    number: row.client_address_number,
    state: row.client_state_acronym,
    zipcode: row.client_address_zipcode,
  });
  const spouseAddress = formatAddress({
    address: row.spouse_address,
    city: row.spouse_city_name,
    complement: row.spouse_address_complement,
    district: row.spouse_address_district,
    number: row.spouse_address_number,
    state: row.spouse_state_acronym,
    zipcode: row.spouse_address_zipcode,
  });
  const clientCity = formatCityState(row.client_city_name, row.client_state_acronym);
  const spouseName = firstFilled(row.spouse_name);
  const personType = formatName(firstFilled(row.person_type_name) ?? "Fisica");
  const unit: GuardianAttendanceSourceUnit = {
    area: formatArea(row.area),
    empreendimento: enterpriseName,
    id: unitId,
    imobiliariaCorretor: formatPersonName(
      firstFilled(row.vinculed_name, "Sem vinculo comercial") ?? "Sem vinculo comercial",
    ),
    lote: lot,
    matricula: row.unity_name ?? unitCode(row.enterprise_code, block, lot),
    quadra: block,
    statusVenda: "Contrato ativo",
    signedContractDocumentId: firstFilled(row.signed_contract_document_id) ?? undefined,
    signedContractStatus: firstFilled(row.signed_contract_status) ?? undefined,
    signedContractUrl: firstFilled(row.signed_contract_url) ?? undefined,
    unidadeLote: unitLabel(block, lot, row.unity_name),
    valorUnidade: toNumber(row.unit_price),
  };

  return {
    id: `c2x-${requestId}`,
    nome: formatPersonName(row.client_name ?? "Cliente sem nome"),
    cpf: formatDocument(firstFilled(row.cpf, row.cnpj)),
    telefone: formatPhone(firstFilled(row.contact_phone, row.cellphone, row.phone)),
    idade: ageFromBirthDate(row.birthday),
    sexo: formatName(row.sex_name ?? "Nao informado"),
    estadoCivil: formatName(row.civil_state_name ?? "Nao informado"),
    profissao: formatName(row.profession_name ?? "Nao informado"),
    renda: formatName(row.salary_range_name ?? "Nao informado"),
    cidade: clientCity,
    escolaridade: formatName(row.schooling_name ?? "Nao informado"),
    empreendimento: enterpriseName,
    unidadeLote: unitLabel(block, lot, row.unity_name),
    quadra: block,
    lote: lot,
    area: formatArea(row.area),
    valorUnidade: toNumber(row.unit_price),
    parcelasTotal: totalPayments,
    parcelasLiquidadas: liquidatedPayments,
    parcelasVencidas: overduePayments,
    parcelasAVencer: pendingPayments,
    saldoAtraso: overdueAmount,
    atrasoDias: maxOverdueDays,
    scoreRisco: risk.score,
    prioridade: priority,
    responsavel: responsibleFor(requestId),
    status: statusFor(priority, maxOverdueDays, overduePayments),
    perfilParcela: parcelProfile(row),
    vencimento: formatDateInput(toDate(row.oldest_due_date)),
    recuperado: toNumber(row.recovered_amount),
    c2xAcquisitionRequestId: requestId,
    c2xInstallmentsLoaded: installmentsLoaded,
    c2xInstallments: installmentsByRequestId.get(requestId) ?? [],
    c2xUnits: [unit],
    email: row.client_email ?? undefined,
    tipoPessoa: personType,
    documentoIdentidade: formatDocumentLabel(row.document_type_name, row.identification_number),
    rg: firstFilled(row.rg) ?? "Nao informado",
    razaoSocial: formatPersonName(firstFilled(row.client_social_name) ?? "Nao informado"),
    nomeFantasia: formatPersonName(firstFilled(row.client_fantasy_name) ?? "Nao informado"),
    endereco: clientAddress,
    cep: formatZipcode(row.client_address_zipcode),
    bairro: formatName(row.client_address_district ?? "Nao informado"),
    numeroEndereco: firstFilled(row.client_address_number) ?? "Nao informado",
    complementoEndereco: firstFilled(row.client_address_complement) ?? "Nao informado",
    naturalidade: formatName(row.naturalness ?? "Nao informado"),
    nacionalidade: formatName(row.nacionality ?? "Brasileira"),
    nomeMae: formatPersonName(firstFilled(row.mother_name) ?? "Nao informado"),
    regimeBens: formatName(row.property_regime_name ?? "Nao informado"),
    conjuge: spouseName ? formatPersonName(spouseName) : "Nao informado",
    cpfConjuge: formatDocument(row.spouse_cpf),
    conjugeDados: {
      cpf: formatDocument(row.spouse_cpf),
      documentoIdentidade: formatDocumentLabel(row.spouse_document_type_name, row.spouse_identification_number),
      email: firstFilled(row.spouse_email) ?? "Nao informado",
      endereco: spouseAddress,
      idade: ageFromBirthDate(row.spouse_birthday),
      nacionalidade: formatName(row.spouse_nacionality ?? "Nao informado"),
      nascimento: formatDate(toDate(row.spouse_birthday)),
      nome: spouseName ? formatPersonName(spouseName) : "Nao informado",
      profissao: formatName(row.spouse_profession_name ?? "Nao informado"),
      naturalidade: "Nao informado",
      sexo: formatName(row.spouse_sex_name ?? "Nao informado"),
      telefone: formatPhone(row.spouse_cellphone),
    },
    imobiliariaCorretor: formatPersonName(
      firstFilled(row.vinculed_name, "Sem vinculo comercial") ?? "Sem vinculo comercial",
    ),
    matricula: row.unity_name ?? unitCode(row.enterprise_code, block, lot),
    nascimento: formatDate(toDate(row.birthday)),
    relacionamento: row.acquisition_request_code
      ? `Pedido ${row.acquisition_request_code}`
      : `Pedido C2X ${requestId}`,
    unitId,
  };
}

type RiskAnalysisInput = {
  liquidatedPayments: number;
  overdueAmount: number;
  overdueDays: number;
  overduePayments: number;
  totalPayments: number;
};

function riskAnalysisFor(input: RiskAnalysisInput) {
  const score =
    overdueDaysScore(input.overdueDays) +
    overduePaymentsScore(input.overduePayments) +
    overdueAmountScore(input.overdueAmount) +
    delinquencyRateScore(input.overduePayments, input.liquidatedPayments, input.totalPayments) +
    guardianHistoryScore(input.overdueDays, input.overduePayments) +
    specialSituationScore(input.overdueDays, input.overduePayments);

  const normalizedScore = Math.min(Math.round(score), 99);

  return {
    priority: priorityFor(normalizedScore, input.overdueDays, input.overduePayments),
    score: normalizedScore,
  };
}

function priorityFor(
  score: number,
  overdueDays: number,
  overduePayments: number,
): AttendancePriority {
  let priority = priorityByScore(score);

  if (overduePayments > 12) {
    priority = highestPriority(priority, "Crítica");
  } else if (overduePayments >= 7) {
    priority = highestPriority(priority, "Alta");
  }

  if (overdueDays >= 180) {
    priority = highestPriority(priority, "Crítica");
  } else if (overdueDays >= 90) {
    priority = highestPriority(priority, "Alta");
  }

  return priority;
}

function priorityByScore(score: number): AttendancePriority {
  if (score >= 85) return "Crítica";
  if (score >= 65) return "Alta";
  if (score >= 40) return "Média";

  return "Baixa";
}

function highestPriority(current: AttendancePriority, minimum: AttendancePriority) {
  const order: Record<AttendancePriority, number> = {
    Baixa: 1,
    Média: 2,
    Alta: 3,
    Crítica: 4,
  };

  return order[current] >= order[minimum] ? current : minimum;
}

function overdueDaysScore(overdueDays: number) {
  if (overdueDays >= 91) return 30;
  if (overdueDays >= 61) return 24;
  if (overdueDays >= 31) return 18;
  if (overdueDays >= 16) return 12;
  if (overdueDays >= 1) return 6;

  return 0;
}

function overduePaymentsScore(overduePayments: number) {
  if (overduePayments > 12) return 25;
  if (overduePayments >= 7) return 20;
  if (overduePayments >= 3) return 13;
  if (overduePayments >= 1) return 6;

  return 0;
}

function overdueAmountScore(overdueAmount: number) {
  if (overdueAmount >= 50000) return 15;
  if (overdueAmount >= 15000) return 14;
  if (overdueAmount >= 10000) return 10;
  if (overdueAmount >= 5000) return 6;
  if (overdueAmount > 0) return 3;

  return 0;
}

function delinquencyRateScore(
  overduePayments: number,
  liquidatedPayments: number,
  totalPayments: number,
) {
  const accumulatedPayments = liquidatedPayments + overduePayments;
  const denominator = accumulatedPayments > 0 ? accumulatedPayments : totalPayments;
  const rate = denominator > 0 ? overduePayments / denominator : 0;

  if (rate >= 0.75) return 10;
  if (rate >= 0.5) return 8;
  if (rate >= 0.25) return 5;
  if (rate >= 0.1) return 3;
  if (rate > 0) return 1;

  return 0;
}

function guardianHistoryScore(overdueDays: number, overduePayments: number) {
  if (overdueDays >= 180 || overduePayments > 12) return 15;
  if (overdueDays >= 90 || overduePayments >= 7) return 10;
  if (overdueDays >= 31 || overduePayments >= 3) return 5;

  return 0;
}

function specialSituationScore(overdueDays: number, overduePayments: number) {
  if (overdueDays >= 180 || overduePayments > 12) return 5;

  return 0;
}

function statusFor(
  priority: AttendancePriority,
  overdueDays: number,
  overduePayments: number,
): GuardianAttendanceSourceClient["status"] {
  if (priority === "Crítica") return "Escalado";
  if (priority === "Alta") return overduePayments >= 3 ? "Em negociação" : "Proposta enviada";
  if (priority === "Média") return overdueDays >= 20 ? "Aguardando retorno" : "Contato programado";

  return "Contato programado";
}

function responsibleFor(seed: string): "Gustavo Freitas" | "Cinthia Cruz" {
  return toNumber(seed) % 2 === 0 ? "Gustavo Freitas" : "Cinthia Cruz";
}

function parcelProfile(row: AttendanceContractRow): GuardianAttendanceSourceClient["perfilParcela"] {
  const signal = toNumber(row.signal_payments);
  const parcel = toNumber(row.parcel_payments);

  if (parcel >= signal) return "Parcela";
  if (signal > 0) return "Sinal";

  return "Ato";
}

function parcelNumber(row: AttendanceInstallmentRow) {
  const parcelTypeId = toNumber(row.parcel_type_id);
  const current =
    parcelTypeId === 2
      ? toNumber(row.current_signal_parcel)
      : toNumber(row.current_total_parcel);
  const total =
    parcelTypeId === 2
      ? toNumber(row.total_signal_parcels)
      : toNumber(row.total_parcels);
  const label = row.parcel_type_name ? formatName(row.parcel_type_name) : "Parcela";

  if (current > 0 && total > 0) {
    return `${String(current).padStart(2, "0")}/${String(total).padStart(2, "0")}`;
  }

  return label;
}

function installmentStatus(value: number | string | null | undefined): "Vencida" | "A vencer" | "Liquidada" {
  const status = toNumber(value);

  if (status === 5) return "Liquidada";
  if (status === 6) return "A vencer";

  return "Vencida";
}

function amountFromRow(row: AttendanceInstallmentRow) {
  const paidValue = toNumber(row.paid_value);
  const baseValue =
    toNumber(row.initial_value) +
    toNumber(row.interest_value) +
    toNumber(row.mulct_value);

  return Math.max(paidValue || baseValue, 0);
}

function buildUnitId(requestId: number | string | null | undefined, unitId: number | string | null | undefined) {
  return `c2x-unit-${unitId ?? requestId ?? "unknown"}`;
}

function unitCode(enterpriseCode: string | null, block: string, lot: string) {
  const code = (enterpriseCode ?? "C2X").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 3).padEnd(3, "X");
  const blockCode = block.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const lotCode = lot.replace(/[^a-z0-9]/gi, "").replace(/^L/i, "").toUpperCase();

  return `${code}${blockCode}${lotCode}`;
}

function unitLabel(block: string, lot: string, unityName: string | null) {
  if (block !== "Sem quadra" || lot !== "Sem lote") {
    return `${block} · Lote ${lot.replace(/^L/i, "")}`;
  }

  return unityName ?? "Unidade C2X";
}

function normalizeBlock(value: string | null) {
  const clean = String(value ?? "").trim();

  if (!clean) return "Sem quadra";
  if (/^q/i.test(clean)) return clean.toUpperCase();

  return `Q${clean}`;
}

function normalizeLot(value: string | null) {
  const clean = String(value ?? "").trim();

  if (!clean) return "Sem lote";
  if (/^l/i.test(clean)) return clean.toUpperCase();

  return `L${clean}`;
}

function formatBlockForLabel(value: string) {
  return value.replace(/^Q/i, "") || value;
}

function formatLotForLabel(value: string) {
  return value.replace(/^L/i, "") || value;
}

function formatArea(value: number | string | null) {
  const area = toNumber(value);

  return area > 0 ? `${area.toLocaleString("pt-BR")} m2` : "Nao informado";
}

function formatDocument(value: string | null | undefined) {
  const rawValue = String(value ?? "").trim();
  const digits = rawValue.replace(/\D/g, "");

  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }

  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }

  return rawValue || "Nao informado";
}

function formatDocumentLabel(type: string | null | undefined, number: string | null | undefined) {
  const cleanNumber = firstFilled(number);

  if (!cleanNumber) {
    return "Nao informado";
  }

  const cleanType = firstFilled(type);

  return cleanType ? `${formatName(cleanType)} ${cleanNumber.trim()}` : cleanNumber.trim();
}

function formatPhone(value: string | null) {
  const digits = String(value ?? "").replace(/\D/g, "");

  if (digits.length >= 11) {
    const clean = digits.slice(-11);
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`;
  }

  if (digits.length >= 10) {
    const clean = digits.slice(-10);
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
  }

  return value?.trim() || "Sem telefone";
}

function formatZipcode(value: string | null | undefined) {
  const rawValue = String(value ?? "").trim();
  const digits = rawValue.replace(/\D/g, "");

  if (digits.length === 8) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}-${digits.slice(5)}`;
  }

  return rawValue || "Nao informado";
}

function formatCityState(city: string | null | undefined, state: string | null | undefined) {
  const cleanCity = firstFilled(city);
  const cleanState = firstFilled(state);

  if (cleanCity && cleanState) {
    return `${formatName(cleanCity)}/${cleanState.trim().toUpperCase()}`;
  }

  if (cleanCity) {
    return formatName(cleanCity);
  }

  if (cleanState) {
    return cleanState.trim().toUpperCase();
  }

  return "Nao informado";
}

function formatAddress({
  address,
  city,
  complement,
  district,
  number,
  state,
  zipcode,
}: {
  address: string | null | undefined;
  city: string | null | undefined;
  complement: string | null | undefined;
  district: string | null | undefined;
  number: string | null | undefined;
  state: string | null | undefined;
  zipcode: string | null | undefined;
}) {
  const street = firstFilled(address);

  if (!street) {
    return "Nao informado";
  }

  const districtValue = firstFilled(district);
  const cityState = formatCityState(city, state);
  const zipcodeValue = formatZipcode(zipcode);
  const parts = [
    formatName(street),
    firstFilled(number),
    firstFilled(complement),
    districtValue ? formatName(districtValue) : null,
    cityState !== "Nao informado" ? cityState : null,
    zipcodeValue !== "Nao informado" ? `CEP ${zipcodeValue}` : null,
  ].filter(Boolean);

  return parts.join(" - ");
}

function firstFilled(...values: Array<string | null | undefined>) {
  return values.find((value) => String(value ?? "").trim().length > 0) ?? null;
}

function c2xClientIdFromQueueId(value: string | null | undefined) {
  const clean = String(value ?? "").trim();

  if (!clean) {
    return null;
  }

  const match = clean.match(/^c2x-client-(\d+)$/);

  if (match) {
    return match[1];
  }

  return /^\d+$/.test(clean) ? clean : null;
}

function ageFromBirthDate(value: Date | string | null) {
  const birthDate = toDate(value);

  if (!birthDate) {
    return "Nao informado";
  }

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const currentMonth = today.getMonth();
  const birthMonth = birthDate.getMonth();

  if (currentMonth < birthMonth || (currentMonth === birthMonth && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }

  return `${Math.max(age, 0)} anos`;
}

function formatPersonName(value: string) {
  return formatName(value)
    .split(" ")
    .map((word) => (word.length <= 2 ? word.toLocaleLowerCase("pt-BR") : word))
    .join(" ");
}

function formatName(value: string) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized) {
    return "Nao informado";
  }

  const preserved = new Set(["LBF", "LBP", "LBR", "C2X"]);

  return normalized
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((word, index) => {
      const original = normalized.split(" ")[index] ?? word;

      if (index > 0 && ["a", "as", "da", "das", "de", "do", "dos", "e"].includes(word)) {
        return word;
      }

      if (preserved.has(original.toUpperCase())) {
        return original.toUpperCase();
      }

      return word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1);
    })
    .join(" ");
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", {
    currency: "BRL",
    style: "currency",
  });
}

function formatDate(value: Date | null) {
  if (!value) return "Nao informado";

  return `${String(value.getDate()).padStart(2, "0")}/${String(value.getMonth() + 1).padStart(2, "0")}/${value.getFullYear()}`;
}

function formatDateInput(value: Date | null) {
  if (!value) return "";

  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function normalizeDateOnly(value: Date | string | null | undefined) {
  if (!value) {
    return "";
  }

  if (value instanceof Date) {
    return formatDateInput(value);
  }

  const clean = String(value).trim();
  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);

  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function formatDateFromDateOnly(value: string | null | undefined) {
  const clean = normalizeDateOnly(value);

  if (!clean) return "Nao informado";

  const [year, month, day] = clean.split("-");

  return `${day}/${month}/${year}`;
}

function formatReferenceFromDateOnly(value: string | null | undefined) {
  const clean = normalizeDateOnly(value);

  if (!clean) return "Sem referencia";

  const [year, month] = clean.split("-");

  return `${month}/${year}`;
}

function referenceValueFromDateOnly(value: string | null | undefined) {
  const clean = normalizeDateOnly(value);

  if (!clean) return 0;

  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return 0;

  const year = Number(match[1]);
  const month = Number(match[2]);

  return year * 100 + month;
}

function daysBetweenDateOnly(start: string, end: Date) {
  const clean = normalizeDateOnly(start);

  if (!clean) return 0;

  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return 0;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const startDate = Date.UTC(year, month - 1, day);
  const endDate = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());

  return Math.floor((endDate - startDate) / 86400000);
}

function earliestDate(first: Date | null, second: Date | null) {
  if (!first) {
    return second;
  }

  if (!second) {
    return first;
  }

  return second.getTime() < first.getTime() ? second : first;
}

function toDate(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeQueueLimit(value: number | null | undefined) {
  const parsed = Number(value ?? 1_000);

  if (!Number.isFinite(parsed)) {
    return 1_000;
  }

  return Math.min(Math.max(Math.trunc(parsed), 20), 2_000);
}
