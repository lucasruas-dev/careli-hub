// Extrato por participante (Apolo) — espelha o relatório do C2X "Extrato por participante":
// o SPLIT dos pagamentos PAGOS, escopado a uma entidade (imobiliária/incorporador/corretor/
// papel fixo). O C2X não materializa o split; é calculado aplicando os percentuais de
// `split_enterprise_group_values` (por empreendimento + tipo de parcela) sobre o valor pago.
// Ver [[project-apolo-empreendimento-tela]] e [[project-apolo-acessos-externos]].
import type { RowDataPacket } from "mysql2";

import { EXCLUDED_ENTERPRISE_CODES } from "@/lib/guardian/c2x-analytics";
import { getHadesDbPool } from "@/lib/guardian/db";

export type ApoloStatementRow = {
  // Rastreio no Asaas: id da cobrança + link da fatura (página) e do boleto (PDF).
  asaasId: string | null;
  asaasInvoiceUrl: string | null;
  asaasUrl: string | null;
  clientName: string | null;
  enterpriseCode: string;
  enterpriseName: string | null;
  feeValue: number;
  grossValue: number;
  id: string;
  netValue: number;
  parcela: string;
  paymentDate: string;
  role: string;
  // Unidade (lote) da venda.
  unitBlock: string | null;
  unitCode: string;
  unitLot: string | null;
};

export type ApoloStatementSummary = {
  count: number;
  fees: number;
  gross: number;
  net: number;
};

export type ApoloStatementEnterprise = {
  code: string;
  name: string | null;
};

export type ApoloStatementData = {
  enterprises: ApoloStatementEnterprise[];
  rows: ApoloStatementRow[];
  summary: ApoloStatementSummary;
};

export type ApoloStatementScope = {
  c2xId: number;
  end: string;
  enterpriseCode?: string | null;
  start: string;
};

type StatementRow = RowDataPacket & {
  asaas_id: string | null;
  asaas_invoice_url: string | null;
  asaas_url: string | null;
  client_name: string | null;
  current_parcel: number | null;
  enterprise_code: string | null;
  enterprise_name: string | null;
  gross_value: string | number | null;
  payment_date: Date | string | null;
  payment_id: number;
  profile_name: string | null;
  split_group_value_id: number;
  total_admin_fee: string | number | null;
  total_parcels: number | null;
  unit_block: string | null;
  unit_lot: string | null;
};

// Mapeia o tipo de parcela do pagamento (parcel_types) pro grupo de split (split_group_names).
// Sinal usa o grupo "Sinal (Imobiliária)" — o "Sinal (Corretor)" só se aplica quando a venda
// tem corretor identificado, o que o C2X não registra na venda (corretor_id sempre nulo).
const GROUP_BY_PARCEL = "((pt.name = 'Ato' and sgn.name = 'Ato') or (pt.name = 'Parcela' and sgn.name = 'Mensal') or (pt.name = 'Sinal' and sgn.name = 'Sinal (Imobiliária)'))";

export async function loadApoloParticipantStatement(
  scope: ApoloStatementScope,
): Promise<
  { data: ApoloStatementData; ok: true } | { error: string; ok: false }
> {
  if (!scope.c2xId || scope.c2xId <= 0) {
    return { data: emptyData(), ok: true };
  }

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) {
    return {
      error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`,
      ok: false,
    };
  }

  const excluded = EXCLUDED_ENTERPRISE_CODES.map(() => "?").join(", ");

  // O participante é a entidade em qualquer papel do split: OU um papel FIXO (o split aponta
  // segv.user_id = ele — incorporador, captador, gerente, coordenação, gestora), OU a
  // IMOBILIÁRIA da venda (segv.user_id null no perfil Imobiliária/Corretor; resolvida por
  // users.vinculed_by_id do comprador).
  const participantWhere =
    "(segv.user_id = ? or (segv.user_id is null and sp.name like 'Imobili%' and cli.vinculed_by_id = ?))";

  const params: Array<number | string> = [
    scope.start,
    scope.end,
    ...EXCLUDED_ENTERPRISE_CODES,
    scope.c2xId,
    scope.c2xId,
  ];

  const enterpriseFilter = scope.enterpriseCode
    ? "and e.code = ?"
    : "";
  if (scope.enterpriseCode) {
    params.push(scope.enterpriseCode);
  }

  const fromWhere = `
    from payments p
    left join payment_admin_fees paf on paf.payment_id = p.id
    join acquisition_requests ar on ar.id = p.acquisition_request_id
    join enterprise_unities eu on eu.id = ar.enterprise_unity_id
    join enterprises e on e.id = eu.enterprise_id
    left join users cli on cli.id = ar.client_id
    join parcel_types pt on pt.id = p.parcel_type_id
    join split_enterprises se on se.enterprise_id = e.id and se.currently_active = 1
    join split_enterprise_groups seg on seg.split_enterprise_id = se.id
    join split_group_names sgn on sgn.id = seg.split_group_name_id
    join split_enterprise_group_values segv on segv.split_enterprise_group_id = seg.id
    join split_profiles sp on sp.id = segv.split_profile_id
    where p.payment_status_id = 5
      and p.payment_date >= ? and p.payment_date < date_add(?, interval 1 day)
      and e.code not in (${excluded})
      and ${GROUP_BY_PARCEL}
      and ${participantWhere}
      ${enterpriseFilter}`;

  try {
    const [rows] = await poolResult.pool.query<StatementRow[]>(
      `select
         p.id as payment_id,
         segv.id as split_group_value_id,
         p.payment_date,
         e.code as enterprise_code,
         e.name as enterprise_name,
         ${nameSql("cli")} as client_name,
         eu.block as unit_block,
         eu.lot as unit_lot,
         p.current_total_parcel as current_parcel,
         p.total_parcels,
         sp.name as profile_name,
         p.paid_value * segv.percent / 100 as gross_value,
         coalesce(paf.total_admin_fee, 0) as total_admin_fee,
         nullif(trim(p.payment_asaas_id), '') as asaas_id,
         nullif(trim(p.payment_asaas_url), '') as asaas_url,
         nullif(trim(p.payment_asaas_invoice_url), '') as asaas_invoice_url
       ${fromWhere}
       order by p.payment_date desc, e.code, p.id
       limit 2000`,
      params,
    );

    const statementRows = rows.map(mapRow);
    const enterprises = uniqueEnterprises(statementRows);
    const summary = statementRows.reduce<ApoloStatementSummary>(
      (acc, row) => ({
        count: acc.count + 1,
        fees: acc.fees + row.feeValue,
        gross: acc.gross + row.grossValue,
        net: acc.net + row.netValue,
      }),
      { count: 0, fees: 0, gross: 0, net: 0 },
    );

    return { data: { enterprises, rows: statementRows, summary }, ok: true };
  } catch (error) {
    console.error("[apolo][extrato] falha ao carregar extrato por participante", error);
    return { error: "Nao foi possivel carregar o extrato.", ok: false };
  }
}

function nameSql(alias: string) {
  return `coalesce(nullif(trim(${alias}.name), ''), nullif(trim(${alias}.fantasy_name), ''), nullif(trim(${alias}.social_name), ''))`;
}

function mapRow(row: StatementRow): ApoloStatementRow {
  const gross = toNumber(row.gross_value);
  const fees = toNumber(row.total_admin_fee);
  const enterpriseCode = String(row.enterprise_code ?? "");

  return {
    asaasId: text(row.asaas_id),
    asaasInvoiceUrl: text(row.asaas_invoice_url),
    asaasUrl: text(row.asaas_url),
    clientName: text(row.client_name),
    enterpriseCode,
    enterpriseName: text(row.enterprise_name),
    feeValue: fees,
    grossValue: gross,
    id: `${row.payment_id}:${row.split_group_value_id}`,
    netValue: Math.max(gross - fees, 0),
    parcela: `${row.current_parcel ?? "-"}/${row.total_parcels ?? "-"}`,
    paymentDate: dateOnly(row.payment_date),
    role: text(row.profile_name) ?? "-",
    unitBlock: text(row.unit_block),
    unitCode: buildUnitCode(enterpriseCode, text(row.unit_block), text(row.unit_lot)),
    unitLot: text(row.unit_lot),
  };
}

// Código curto da unidade (ex.: VALH05) — mesmo formato da carteira. Ver [[project-apolo-crm-grafo]].
function buildUnitCode(
  enterpriseCode: string,
  block: string | null,
  lot: string | null,
): string {
  const prefix = enterpriseCode.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 3).padEnd(3, "X");
  const blockCode = (block ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  const lotCode = (lot ?? "").replace(/[^a-z0-9]/gi, "").replace(/^L/i, "").toUpperCase();

  return `${prefix}${blockCode}${lotCode}`;
}

function uniqueEnterprises(rows: ApoloStatementRow[]): ApoloStatementEnterprise[] {
  const map = new Map<string, ApoloStatementEnterprise>();
  for (const row of rows) {
    if (row.enterpriseCode && !map.has(row.enterpriseCode)) {
      map.set(row.enterpriseCode, { code: row.enterpriseCode, name: row.enterpriseName });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
}

function emptyData(): ApoloStatementData {
  return { enterprises: [], rows: [], summary: { count: 0, fees: 0, gross: 0, net: 0 } };
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

function dateOnly(value: Date | string | null): string {
  if (!value) {
    return "-";
  }
  const iso = value instanceof Date ? value.toISOString() : String(value);
  return iso.slice(0, 10);
}
