// Carteira financeira de um EMPREENDIMENTO (Apolo). Espelha o cenário do Hades, com a MESMA
// matemática (pra os números baterem), mas escopado a um empreendimento e com uma visão nova:
// por UNIDADE (o Hades é centrado no comprador). Ver [[project-apolo-crm-grafo]].
import type { RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";

import { deterministicUuid } from "@/lib/apolo/server";
import { EXCLUDED_ENTERPRISE_CODES } from "@/lib/guardian/c2x-analytics";
import { getHadesDbPool } from "@/lib/guardian/db";

// Expressões idênticas às do Hades (lib/guardian/overview.ts). Mantidas em sincronia à mão.
// ⚠️ O `paid_value` SÓ é dinheiro recebido quando `payment_date` existe. A integração Asaas
// PRÉ-PREENCHE paid_value com o valor esperado ao emitir o boleto (medido 18/08/2026: vencidas
// com status 7, payment_date NULL e paid_value = initial_value) — subtraí-lo sem conferir a data
// zerava o vencido de 4 unidades do Vista Alegre e o total geral contava só 2 de 6 clientes.
const ACTIVE = "(p.payment_to_delete is null or p.payment_to_delete = 0)";
const PORTFOLIO = `p.payment_status_id in (5, 6, 7) and ${ACTIVE}`; // carteira ativa
const PRINCIPAL = "coalesce(p.initial_value, 0)";
const OUTSTANDING = `greatest(coalesce(p.initial_value,0)+coalesce(p.interest_value,0)+coalesce(p.mulct_value,0)-(case when p.payment_date is not null then coalesce(p.paid_value,0) else 0 end), 0)`;
const OVERDUE = `((p.payment_status_id = 7 or (p.due_date < curdate() and p.payment_status_id not in (1,2,5))) and ${ACTIVE})`;

export type ApoloCarteiraSummary = {
  clients: number;
  contracts: number;
  criticalContracts: number;
  /**
   * Inadimplência A VALOR PRESENTE: vencido em aberto ÷ o que JÁ deveria ter sido recebido.
   *
   * ⚠️ O DENOMINADOR MUDOU EM 20/08/2026, a pedido do Lucas: *"a inadimplência o cálculo tem que
   * ser no valor presente... não sobre o contrato total mas sim sobre o que deveríamos ter
   * recebido até a data presente"*. Antes era `overdueAmount / totalPortfolio`, e isso não media
   * inadimplência: dividia o vencido pelo contrato INTEIRO, incluindo parcela que só vence em
   * 2039. No CER dava 0,8% onde o número real é 10,3% — um indicador que tranquiliza justamente
   * quando deveria alertar, e que só melhora quanto mais longo for o financiamento.
   */
  delinquencyRate: number;
  /** O denominador do `delinquencyRate`: principal de tudo que venceu até hoje, pago ou não. */
  expectedToDate: number;
  overdueAmount: number;
  overdueClients: number;
  overdueInstallments: number;
  paidAmount: number;
  recoveryAmount: number;
  toReceiveAmount: number;
  totalPortfolio: number;
};

export type ApoloCarteiraUnitParty = {
  entityId: string;
  name: string;
};

export type ApoloCarteiraUnit = {
  block: string | null;
  client: ApoloCarteiraUnitParty | null;
  code: string;
  // Empreendimento da unidade — dimensão do drill-down da carteira por papel. (Corretor NÃO
  // entra: o C2X não liga corretor à venda; ver loadApoloCarteiraScoped.)
  enterpriseCode: string;
  enterpriseName: string | null;
  contractCode: string | null;
  // ID do documento no D4Sign (uuidDoc). O link salvo no C2X expira, entao usamos
  // esse ID pra pedir um PDF fresco pela API na hora de abrir. Ver [[project-apolo-crm-grafo]].
  contractDocumentId: string | null;
  // Data em que a proposta chegou a "Faturado" (stage 4) — a referência de virada da venda.
  faturadoAt: string | null;
  id: string;
  imobiliaria: ApoloCarteiraUnitParty | null;
  lot: string | null;
  maxOverdueDays: number;
  overdueAmount: number;
  overdueInstallments: number;
  paidAmount: number;
  toReceiveAmount: number;
  totalContract: number;
};

export type ApoloCarteiraData = {
  summary: ApoloCarteiraSummary;
  units: ApoloCarteiraUnit[];
};

type SummaryRow = RowDataPacket & Record<string, number | string | null>;
type UnitRow = RowDataPacket & Record<string, number | string | null>;

export async function loadApoloEnterpriseCarteira(
  codes: string[],
): Promise<
  { data: ApoloCarteiraData; ok: true } | { error: string; ok: false }
> {
  const validCodes = codes
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code && !EXCLUDED_ENTERPRISE_CODES.includes(code));

  if (!validCodes.length) {
    return { data: { summary: emptySummary(), units: [] }, ok: true };
  }

  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return {
      error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`,
      ok: false,
    };
  }

  const inCodes = validCodes.map(() => "?").join(", ");
  const data = await runCarteiraQueries(
    poolResult.pool,
    `where e.code in (${inCodes})`,
    validCodes,
  );
  return { data, ok: true };
}

export type ApoloCarteiraScope = {
  c2xId: number;
  kind: "comprador" | "corretor" | "imobiliaria" | "incorporador";
};

// Carteira escopada pelo PAPEL da entidade, reusando a MESMA matemática. As unidades vêm
// com as dimensões que o C2X liga à venda (empreendimento/imobiliária/comprador) pro drill-down.
export async function loadApoloCarteiraScoped(
  scope: ApoloCarteiraScope,
): Promise<
  { data: ApoloCarteiraData; ok: true } | { error: string; ok: false }
> {
  if (!scope.c2xId || scope.c2xId <= 0) {
    return { data: { summary: emptySummary(), units: [] }, ok: true };
  }

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) {
    return {
      error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`,
      ok: false,
    };
  }

  // Cada papel é um recorte diferente sobre o MESMO join (payments->ar->unity->enterprise):
  //  - comprador: as vendas dele;
  //  - imobiliária: as vendas dos compradores vinculados a ela (users.vinculed_by_id);
  //  - incorporador: as vendas dos empreendimentos dele (enterprises.incorporador_id);
  //  - corretor: as vendas dos empreendimentos em que ele atua. O C2X NÃO liga corretor à
  //    venda (acquisition_requests.corretor_id é sempre nulo); o único vínculo é
  //    corretor<->empreendimento em `corretores_enterprises`. Por isso o corretor NÃO é uma
  //    camada por-comprador do drill-down — é um filtro de escopo por empreendimento.
  const filterByKind: Record<ApoloCarteiraScope["kind"], string> = {
    comprador: "ar.client_id = ?",
    corretor:
      "e.id in (select enterprise_id from corretores_enterprises where corretor_id = ?)",
    imobiliaria: "ar.client_id in (select id from users where vinculed_by_id = ?)",
    incorporador: "e.incorporador_id = ?",
  };
  const excluded = EXCLUDED_ENTERPRISE_CODES.map(() => "?").join(", ");
  const whereScope = `where ${filterByKind[scope.kind]} and e.code not in (${excluded})`;
  const params: Array<number | string> = [scope.c2xId, ...EXCLUDED_ENTERPRISE_CODES];

  try {
    const data = await runCarteiraQueries(poolResult.pool, whereScope, params);
    return { data, ok: true };
  } catch {
    return { error: "Nao foi possivel carregar a carteira.", ok: false };
  }
}

// Roda as 3 queries da carteira (totais, contratos críticos, unidades) com o filtro
// (whereScope) injetado — mesmo caminho do Hades: payments -> acquisition_requests ->
// enterprise_unities -> enterprises. Reusado pela carteira do empreendimento E pela por papel.
async function runCarteiraQueries(
  pool: Pool,
  whereScope: string,
  params: Array<number | string>,
): Promise<ApoloCarteiraData> {
  const fromJoins = `
    from payments p
    join acquisition_requests ar on ar.id = p.acquisition_request_id
    join enterprise_unities eu on eu.id = ar.enterprise_unity_id
    join enterprises e on e.id = eu.enterprise_id`;
  const scope = `${fromJoins} ${whereScope}`;
  const nameSql = (a: string) =>
    `coalesce(nullif(trim(${a}.name), ''), nullif(trim(${a}.fantasy_name), ''), nullif(trim(${a}.social_name), ''))`;

  const [summaryRows] = await pool.query<SummaryRow[]>(
    `select
       coalesce(sum(case when ${PORTFOLIO} then ${PRINCIPAL} else 0 end), 0) as total_portfolio,
       -- O DENOMINADOR DA INADIMPLENCIA A VALOR PRESENTE: o que ja venceu ate hoje, pago ou nao.
       -- O "due_date <= curdate()" e a regra inteira; o resto e a mesma carteira ativa de sempre.
       coalesce(sum(case when ${PORTFOLIO} and p.due_date <= curdate() then ${PRINCIPAL} else 0 end), 0) as expected_to_date,
       coalesce(sum(case when p.payment_status_id = 5 and ${ACTIVE} then ${PRINCIPAL} else 0 end), 0) as paid_amount,
       coalesce(sum(case when p.payment_status_id = 6 and ${ACTIVE} then ${PRINCIPAL} else 0 end), 0) as to_receive_amount,
       coalesce(sum(case when ${OVERDUE} then ${OUTSTANDING} else 0 end), 0) as overdue_amount,
       sum(case when ${OVERDUE} then 1 else 0 end) as overdue_installments,
       count(distinct case when ${OVERDUE} then ar.client_id end) as overdue_clients,
       count(distinct ar.client_id) as clients,
       count(distinct ar.id) as contracts,
       coalesce(sum(case when p.payment_status_id = 5 and ${ACTIVE}
             and p.payment_date >= cast(date_format(curdate(), '%Y-%m-01') as date)
             and p.payment_date < date_add(cast(date_format(curdate(), '%Y-%m-01') as date), interval 1 month)
           then coalesce(p.paid_value, 0) else 0 end), 0) as recovery_amount
     ${scope}`,
    params,
  );

  const [criticalRows] = await pool.query<SummaryRow[]>(
    `select count(*) as critical from (
        select ar.id
        ${scope} and ${OVERDUE}
        group by ar.id
        having count(*) > 3
      ) t`,
    params,
  );

  const [unitRows] = await pool.query<UnitRow[]>(
    `select
       eu.id as unit_id, e.code as enterprise_code, e.name as enterprise_name, eu.block, eu.lot,
       ar.id as ar_id, ar.code as contract_code,
       cli.id as client_id, ${nameSql("cli")} as client_name,
       imo.id as imobiliaria_id, ${nameSql("imo")} as imobiliaria_name,
       (select max(arh.created_at) from acquisition_request_historics arh
         where arh.acquisition_request_id = ar.id
           and arh.new_acquisition_request_stage_id = 4) as faturado_at,
       (select nullif(trim(cs.uuidDoc), '')
          from contract_signatures cs
          left join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
         where arc.acquisition_request_id = ar.id
           and trim(coalesce(cs.uuidDoc, '')) <> ''
         order by cs.updated_at desc, cs.id desc limit 1) as contract_doc,
       coalesce(sum(case when ${PORTFOLIO} then ${PRINCIPAL} else 0 end), 0) as total_contract,
       coalesce(sum(case when p.payment_status_id = 5 and ${ACTIVE} then ${PRINCIPAL} else 0 end), 0) as paid_amount,
       coalesce(sum(case when p.payment_status_id = 6 and ${ACTIVE} then ${PRINCIPAL} else 0 end), 0) as to_receive_amount,
       coalesce(sum(case when ${OVERDUE} then ${OUTSTANDING} else 0 end), 0) as overdue_amount,
       sum(case when ${OVERDUE} then 1 else 0 end) as overdue_installments,
       coalesce(max(case when ${OVERDUE} then datediff(curdate(), p.due_date) else 0 end), 0) as max_overdue_days
     ${fromJoins}
     left join users cli on cli.id = ar.client_id
     left join users imo on imo.id = cli.vinculed_by_id
     ${whereScope}
     group by eu.id, e.code, e.name, eu.block, eu.lot, ar.id, ar.code,
              cli.id, client_name, imo.id, imobiliaria_name
     having total_contract > 0 or overdue_amount > 0
     order by overdue_amount desc, eu.block, eu.lot`,
    params,
  );

  return {
    summary: mapSummary(summaryRows[0], toNumber(criticalRows[0]?.critical)),
    units: unitRows.map(mapUnit),
  };
}

function mapSummary(
  row: SummaryRow | undefined,
  criticalContracts: number,
): ApoloCarteiraSummary {
  const totalPortfolio = toNumber(row?.total_portfolio);
  const overdueAmount = toNumber(row?.overdue_amount);
  const expectedToDate = toNumber(row?.expected_to_date);

  return {
    clients: toNumber(row?.clients),
    contracts: toNumber(row?.contracts),
    criticalContracts,
    // ⚠️ SOBRE O PREVISTO ATE HOJE, nao sobre o contrato inteiro. Ver o comentario do tipo.
    // Carteira que ainda nao teve nenhum vencimento devolve 0, e nao divisao por zero: nao ha
    // inadimplencia possivel antes do primeiro vencimento.
    delinquencyRate: expectedToDate > 0 ? overdueAmount / expectedToDate : 0,
    expectedToDate,
    overdueAmount,
    overdueClients: toNumber(row?.overdue_clients),
    overdueInstallments: toNumber(row?.overdue_installments),
    paidAmount: toNumber(row?.paid_amount),
    recoveryAmount: toNumber(row?.recovery_amount),
    toReceiveAmount: toNumber(row?.to_receive_amount),
    totalPortfolio,
  };
}

function mapUnit(row: UnitRow): ApoloCarteiraUnit {
  const enterpriseCode = String(row.enterprise_code ?? "");
  const party = (
    id: number | string | null,
    name: string | null,
  ): ApoloCarteiraUnitParty | null => {
    const cleaned = typeof name === "string" ? name.trim() : "";

    return id && cleaned
      ? { entityId: deterministicUuid(`apolo:c2x:users:${id}`), name: cleaned }
      : null;
  };

  return {
    block: text(row.block),
    client: party(row.client_id, text(row.client_name)),
    code: buildUnitCode(enterpriseCode, text(row.block), text(row.lot)),
    contractCode: text(row.contract_code),
    contractDocumentId: text(row.contract_doc),
    enterpriseCode,
    enterpriseName: text(row.enterprise_name),
    faturadoAt: dateOrNull(row.faturado_at),
    id: String(row.unit_id),
    imobiliaria: party(row.imobiliaria_id, text(row.imobiliaria_name)),
    lot: text(row.lot),
    maxOverdueDays: toNumber(row.max_overdue_days),
    overdueAmount: toNumber(row.overdue_amount),
    overdueInstallments: toNumber(row.overdue_installments),
    paidAmount: toNumber(row.paid_amount),
    toReceiveAmount: toNumber(row.to_receive_amount),
    totalContract: toNumber(row.total_contract),
  };
}

export type ApoloInstallmentStatus = "liquidada" | "vencida" | "a_vencer";

export type ApoloUnitInstallment = {
  amount: number;
  competence: string | null;
  dueDate: string | null;
  id: string;
  invoiceUrl: string | null;
  number: string;
  overdueDays: number;
  paidAmount: number;
  paidAt: string | null;
  paymentUrl: string | null;
  status: ApoloInstallmentStatus;
  type: string | null;
};

type InstallmentRow = RowDataPacket & Record<string, number | string | null>;

// Parcelas (boletos) da unidade — a carteira detalhada, no estilo do Hades.
export async function loadApoloUnitInstallments(
  unitId: string,
): Promise<
  { installments: ApoloUnitInstallment[]; ok: true } | { error: string; ok: false }
> {
  const id = Number(unitId);

  if (!Number.isInteger(id) || id <= 0) {
    return { error: "Unidade invalida.", ok: false };
  }

  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return {
      error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`,
      ok: false,
    };
  }

  const [rows] = await poolResult.pool.query<InstallmentRow[]>(
    `select
       p.id,
       p.current_total_parcel as parcel, p.total_parcels as total_parcels,
       p.current_signal_parcel as signal_parcel, p.total_signal_parcels as total_signal_parcels,
       pt.name as type,
       p.reference_date as competence, p.due_date, p.payment_date,
       p.payment_status_id as status_id,
       ${OUTSTANDING} as outstanding,
       ${PRINCIPAL} as principal,
       coalesce(p.paid_value, 0) as paid_value,
       case when ${OVERDUE} then datediff(curdate(), p.due_date) else 0 end as overdue_days,
       p.payment_asaas_url as payment_url,
       p.payment_asaas_invoice_url as invoice_url
     from payments p
     join acquisition_requests ar on ar.id = p.acquisition_request_id
     left join parcel_types pt on pt.id = p.parcel_type_id
     where ar.enterprise_unity_id = ? and ${ACTIVE}
     order by p.due_date, p.id`,
    [id],
  );

  return { installments: rows.map(mapInstallment), ok: true };
}

function mapInstallment(row: InstallmentRow): ApoloUnitInstallment {
  const statusId = Number(row.status_id ?? 0);
  const overdueDays = toNumber(row.overdue_days);
  const status: ApoloInstallmentStatus =
    statusId === 5
      ? "liquidada"
      : overdueDays > 0 || statusId === 7
        ? "vencida"
        : "a_vencer";
  // Parcela liquidada mostra o principal; em aberto/vencida mostra o outstanding (com encargos).
  const amount =
    status === "liquidada" ? toNumber(row.principal) : toNumber(row.outstanding);

  return {
    amount,
    competence: dateOrNull(row.competence),
    dueDate: dateOrNull(row.due_date),
    id: String(row.id),
    invoiceUrl: httpOrNull(row.invoice_url),
    number: numeroDaParcela(row),
    overdueDays,
    paidAmount: toNumber(row.paid_value),
    paidAt: dateOrNull(row.payment_date),
    paymentUrl: httpOrNull(row.payment_url),
    status,
    type: text(row.type),
  };
}

/**
 * "1 de 3", "12 de 156" — a numeração que a linha mostra, POR TIPO DE PAGAMENTO.
 *
 * ⚠️ CADA TIPO TEM O PRÓPRIO CONTADOR, e misturá-los foi o defeito que o Lucas pegou em
 * 18/08/2026 comparando a tela com o C2X: o Ato e as três parcelas do Sinal apareciam como
 * "0/156". A causa é uma pegadinha conhecida do legado — `current_total_parcel` e
 * `current_signal_parcel` vêm **ZERO, não NULL**, quando não se aplicam ao tipo daquela linha,
 * então um `??` puro nunca cai no valor alternativo (o mesmo tropeço já documentado na
 * integração GLOTES). Daí o `nullif(0)` feito à mão aqui.
 *
 * O Ato é sempre "1/1": ele é pagamento único por definição, e no C2X a coluna de parcela dele
 * vem vazia — mostrar "-" obrigaria quem lê a saber isso de cabeça.
 */
function numeroDaParcela(row: InstallmentRow): string {
  // `text` devolve nulo quando o C2X não classificou o pagamento: sem tipo, cai na régua das
  // parcelas, que é o caso da esmagadora maioria das linhas.
  const tipo = (text(row.type) ?? "").toLowerCase();
  const naoZero = (valor: unknown): null | number => {
    const numero = Number(valor);
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  };

  if (tipo.includes("ato")) return "1/1";

  // Desestruturar a tupla faria o TS perder o refinamento de nulo nas duas pontas; nomear os dois
  // campos primeiro é mais chato de ler e é o que o compilador entende.
  const doSinal = tipo.includes("sinal");
  const atual = doSinal ? naoZero(row.signal_parcel) : naoZero(row.parcel);
  const total = doSinal ? naoZero(row.total_signal_parcels) : naoZero(row.total_parcels);

  if (atual === null && total === null) return "-";

  return `${atual ?? "-"}/${total ?? "-"}`;
}

function dateOrNull(value: unknown): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(String(value));

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function httpOrNull(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";

  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function emptySummary(): ApoloCarteiraSummary {
  return {
    clients: 0,
    contracts: 0,
    criticalContracts: 0,
    delinquencyRate: 0,
    expectedToDate: 0,
    overdueAmount: 0,
    overdueClients: 0,
    overdueInstallments: 0,
    paidAmount: 0,
    recoveryAmount: 0,
    toReceiveAmount: 0,
    totalPortfolio: 0,
  };
}

// Mesmo padrão de código do Hades e da aba Unidades.
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

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";

  return trimmed ? trimmed : null;
}
