// Cenário de VENDAS de um empreendimento (Apolo): o funil por estágio + a lista
// por unidade. Fonte = C2X (enterprise_unities + acquisition_requests). Cada
// unidade fica no seu ESTADO ATUAL (a proposta mais recente, ou disponível se não
// há venda ativa). Cancelado/Distrato são eventos de proposta, num cluster à parte.
// Ver [[project-apolo-crm-grafo]].
import type { RowDataPacket } from "mysql2";

import {
  loadApoloUnitInstallments,
  type ApoloUnitInstallment,
} from "@/lib/apolo/carteira";
import { EXCLUDED_ENTERPRISE_CODES } from "@/lib/guardian/c2x-analytics";
import { getHadesDbPool } from "@/lib/guardian/db";
import { deterministicUuid } from "@/lib/apolo/server";

// Os 6 estados do fluxo (nível unidade, cada uma em um só).
export type ApoloVendaStage =
  | "assinatura"
  | "contrato"
  | "disponivel"
  | "faturado"
  | "proposta"
  | "reservado";

// Terminais (nível proposta): a venda que caiu.
export type ApoloVendaTerminal = "cancelado" | "distrato";

// Ordem canônica do funil (o id do estágio no C2X NÃO reflete a ordem).
export const APOLO_VENDA_STAGE_ORDER: ApoloVendaStage[] = [
  "disponivel",
  "reservado",
  "proposta",
  "contrato",
  "assinatura",
  "faturado",
];

export const APOLO_VENDA_STAGE_LABELS: Record<ApoloVendaStage, string> = {
  assinatura: "Em assinatura",
  contrato: "Contrato gerado",
  disponivel: "Disponível",
  faturado: "Faturado",
  proposta: "Proposta emitida",
  reservado: "Reservado",
};

export const APOLO_VENDA_TERMINAL_LABELS: Record<ApoloVendaTerminal, string> = {
  cancelado: "Cancelado",
  distrato: "Distrato",
};

// Dobra dos 11 estágios do C2X nos 6+2 do fluxo (decisão do Lucas: Análise→Proposta,
// Finalizado→Faturado, Reprovado→Cancelado).
const STAGE_MAP: Record<number, ApoloVendaStage | ApoloVendaTerminal> = {
  1: "reservado",
  2: "proposta", // Análise de crédito
  3: "contrato",
  4: "faturado",
  5: "assinatura",
  6: "faturado", // Finalizado
  7: "cancelado",
  8: "cancelado", // Reprovado análise
  9: "proposta", // Proposta realizada
  10: "distrato", // Em distrato
  11: "distrato", // Distratado
};

const ACTIVE_STAGES = new Set<ApoloVendaStage>([
  "reservado",
  "proposta",
  "contrato",
  "assinatura",
  "faturado",
]);

// Nomes reais dos 11 estágios do C2X, para o feed de movimentação (mostra a
// transição fiel, sem a dobra do funil).
const STAGE_C2X_LABELS: Record<number, string> = {
  1: "Reservado",
  2: "Análise de crédito",
  3: "Contrato gerado",
  4: "Faturado",
  5: "Em assinatura",
  6: "Finalizado",
  7: "Cancelado",
  8: "Reprovado análise",
  9: "Proposta realizada",
  10: "Em distrato",
  11: "Distratado",
};

export type ApoloVendaParty = {
  code: string | null;
  entityId: string;
  name: string;
};

export type ApoloVendaStageBucket = {
  stage: ApoloVendaStage;
  units: number;
  vgv: number;
};

export type ApoloVendaTerminalBucket = {
  proposals: number;
  terminal: ApoloVendaTerminal;
  vgv: number;
};

export type ApoloVendaUnit = {
  arId: number | null;
  block: string | null;
  client: ApoloVendaParty | null;
  code: string;
  id: string;
  imobiliaria: ApoloVendaParty | null;
  lot: string | null;
  stage: ApoloVendaStage;
  stageSince: string | null;
  vgv: number;
};

// Uma proposta terminada (cancelada/distratada) — para o "apontar" das perdas.
export type ApoloVendaTerminalItem = {
  at: string | null;
  client: string | null;
  code: string;
  id: string;
  imobiliaria: string | null;
  reason: string | null;
  terminal: ApoloVendaTerminal;
  vgv: number;
};

// Uma transição de estágio (feed de movimentação).
export type ApoloVendaMovement = {
  at: string;
  client: string | null;
  code: string;
  fromStage: string | null;
  imobiliaria: string | null;
  toStage: string | null;
  vgv: number;
};

export type ApoloEnterpriseVendas = {
  bloqueadas: { units: number; vgv: number };
  funnel: ApoloVendaStageBucket[];
  movements: ApoloVendaMovement[];
  terminalItems: ApoloVendaTerminalItem[];
  terminals: ApoloVendaTerminalBucket[];
  totalUnits: number;
  units: ApoloVendaUnit[];
};

// Detalhe da proposta de uma unidade (o modal "trazer tudo").
export type ApoloVendaPropostaPlan = {
  atoAt: string | null;
  billingAt: string | null;
  client: ApoloVendaParty | null;
  code: string | null;
  corretor: string | null;
  correctionRate: number | null;
  entrada: number | null;
  firstSignalAt: string | null;
  imobiliaria: ApoloVendaParty | null;
  interestRate: number | null;
  isCustom: boolean;
  observacao: string | null;
  parcels: number | null;
  planName: string | null;
  signAt: string | null;
  signalParcels: number | null;
  stageLabel: string | null;
  vgv: number;
};

export type ApoloVendaPropostaMovement = {
  at: string;
  fromStage: string | null;
  toStage: string | null;
};

export type ApoloVendaProposta = {
  movimentacao: ApoloVendaPropostaMovement[];
  parcelamento: ApoloUnitInstallment[];
  plan: ApoloVendaPropostaPlan;
};

type UnitRow = RowDataPacket & Record<string, number | string | null>;
type TerminalRow = RowDataPacket & Record<string, number | string | null>;

export async function loadApoloEnterpriseVendas(
  codes: string[],
): Promise<
  { data: ApoloEnterpriseVendas; ok: true } | { error: string; ok: false }
> {
  const validCodes = codes
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code && !EXCLUDED_ENTERPRISE_CODES.includes(code));

  if (!validCodes.length) {
    return { data: emptyVendas(), ok: true };
  }

  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return {
      error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`,
      ok: false,
    };
  }

  const placeholders = validCodes.map(() => "?").join(", ");
  const nameSql = (alias: string) =>
    `coalesce(nullif(trim(${alias}.name), ''), nullif(trim(${alias}.fantasy_name), ''), nullif(trim(${alias}.social_name), ''))`;

  // Uma linha por unidade, com a proposta MAIS RECENTE (mesmo padrão da aba Unidades)
  // + a data em que ela entrou no estágio atual (histórico).
  const [rows] = await poolResult.pool.query<UnitRow[]>(
    `select u.id, u.block, u.lot, u.price, u.sale_blocked,
            e.code as enterprise_code,
            ar.id as ar_id,
            ar.acquisition_request_stage_id as stage_id,
            (select max(h.created_at) from acquisition_request_historics h
               where h.acquisition_request_id = ar.id
                 and h.new_acquisition_request_stage_id = ar.acquisition_request_stage_id) as stage_since,
            cli.id as client_id, cli.user_code as client_code, ${nameSql("cli")} as client_name,
            imo.id as imobiliaria_id, imo.user_code as imobiliaria_code, ${nameSql("imo")} as imobiliaria_name
       from enterprise_unities u
       join enterprises e on e.id = u.enterprise_id
       left join acquisition_requests ar on ar.id = (
              select ar2.id from acquisition_requests ar2
               where ar2.enterprise_unity_id = u.id
               order by ar2.created_at desc, ar2.id desc
               limit 1)
       left join users cli on cli.id = ar.client_id
       left join users imo on imo.id = cli.vinculed_by_id
      where e.code in (${placeholders})
      order by e.code, u.block, u.lot`,
    validCodes,
  );

  // Terminais = TODAS as propostas canceladas/distratadas (inclui histórico de
  // unidades depois revendidas), por proposta.
  const [terminalRows] = await poolResult.pool.query<TerminalRow[]>(
    `select ar.acquisition_request_stage_id as stage_id, count(*) as n,
            coalesce(sum(u.price), 0) as vgv
       from acquisition_requests ar
       join enterprise_unities u on u.id = ar.enterprise_unity_id
       join enterprises e on e.id = u.enterprise_id
      where e.code in (${placeholders})
        and ar.acquisition_request_stage_id in (7, 8, 10, 11)
      group by ar.acquisition_request_stage_id`,
    validCodes,
  );

  // Movimentação: as transições de estágio mais recentes (feed do "o que mudou").
  const [movementRows] = await poolResult.pool.query<UnitRow[]>(
    `select h.created_at as at,
            h.old_acquisition_request_stage_id as from_stage,
            h.new_acquisition_request_stage_id as to_stage,
            e.code as enterprise_code, u.block, u.lot, u.price,
            cli.id as client_id, ${nameSql("cli")} as client_name,
            imo.id as imobiliaria_id, ${nameSql("imo")} as imobiliaria_name
       from acquisition_request_historics h
       join acquisition_requests ar on ar.id = h.acquisition_request_id
       join enterprise_unities u on u.id = ar.enterprise_unity_id
       join enterprises e on e.id = u.enterprise_id
       left join users cli on cli.id = ar.client_id
       left join users imo on imo.id = cli.vinculed_by_id
      where e.code in (${placeholders})
        and h.new_acquisition_request_stage_id is not null
      order by h.created_at desc
      limit 40`,
    validCodes,
  );

  // Detalhe das propostas canceladas/distratadas (para o "apontar" das perdas).
  const [terminalItemRows] = await poolResult.pool.query<UnitRow[]>(
    `select ar.id as ar_id, ar.acquisition_request_stage_id as stage_id,
            ar.rejection_reason, ar.observation, e.code as enterprise_code,
            u.block, u.lot, u.price,
            (select max(h.created_at) from acquisition_request_historics h
               where h.acquisition_request_id = ar.id
                 and h.new_acquisition_request_stage_id = ar.acquisition_request_stage_id) as terminal_at,
            cli.id as client_id, ${nameSql("cli")} as client_name,
            imo.id as imobiliaria_id, ${nameSql("imo")} as imobiliaria_name
       from acquisition_requests ar
       join enterprise_unities u on u.id = ar.enterprise_unity_id
       join enterprises e on e.id = u.enterprise_id
       left join users cli on cli.id = ar.client_id
       left join users imo on imo.id = cli.vinculed_by_id
      where e.code in (${placeholders})
        and ar.acquisition_request_stage_id in (7, 8, 10, 11)
      order by terminal_at desc
      limit 300`,
    validCodes,
  );

  const units = rows.map(mapVendaUnit);
  const movements = movementRows.map(mapVendaMovement);
  const terminalItems = terminalItemRows
    .map(mapTerminalItem)
    .filter((item): item is ApoloVendaTerminalItem => item !== null);

  // Funil por unidade.
  const funnelMap = new Map<ApoloVendaStage, ApoloVendaStageBucket>(
    APOLO_VENDA_STAGE_ORDER.map((stage) => [
      stage,
      { stage, units: 0, vgv: 0 },
    ]),
  );
  let blockedUnits = 0;
  let blockedVgv = 0;

  for (const row of rows) {
    const blocked = toNumber(row.sale_blocked) === 1;
    const stage = deriveStage(row);
    const price = toNumber(row.price);

    // Bloqueada só conta à parte quando NÃO tem venda ativa (senão o estágio manda).
    if (stage === "disponivel" && blocked) {
      blockedUnits += 1;
      blockedVgv += price;
      continue;
    }

    const bucket = funnelMap.get(stage);
    if (bucket) {
      bucket.units += 1;
      bucket.vgv += price;
    }
  }

  // Terminais dobrados (7,8 → cancelado; 10,11 → distrato).
  const terminalMap = new Map<ApoloVendaTerminal, ApoloVendaTerminalBucket>([
    ["cancelado", { proposals: 0, terminal: "cancelado", vgv: 0 }],
    ["distrato", { proposals: 0, terminal: "distrato", vgv: 0 }],
  ]);
  for (const row of terminalRows) {
    const mapped = STAGE_MAP[toNumber(row.stage_id)];
    if (mapped !== "cancelado" && mapped !== "distrato") {
      continue;
    }
    const bucket = terminalMap.get(mapped);
    if (bucket) {
      bucket.proposals += toNumber(row.n);
      bucket.vgv += toNumber(row.vgv);
    }
  }

  return {
    data: {
      bloqueadas: { units: blockedUnits, vgv: round2(blockedVgv) },
      funnel: APOLO_VENDA_STAGE_ORDER.map((stage) => {
        const bucket = funnelMap.get(stage)!;
        return { ...bucket, vgv: round2(bucket.vgv) };
      }),
      movements,
      terminalItems,
      terminals: [
        terminalMap.get("cancelado")!,
        terminalMap.get("distrato")!,
      ].map((bucket) => ({ ...bucket, vgv: round2(bucket.vgv) })),
      totalUnits: rows.length,
      units,
    },
    ok: true,
  };
}

// Detalhe da proposta mais recente da unidade: plano comercial + parcelamento
// (reaproveita a carteira) + a movimentação (histórico) daquela unidade.
export async function loadApoloVendaProposta(
  unitId: string,
): Promise<
  | { data: ApoloVendaProposta | null; ok: true }
  | { error: string; ok: false }
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

  const nameSql = (alias: string) =>
    `coalesce(nullif(trim(${alias}.name), ''), nullif(trim(${alias}.fantasy_name), ''), nullif(trim(${alias}.social_name), ''))`;

  const [rows] = await poolResult.pool.query<UnitRow[]>(
    `select ar.id as ar_id, ar.code, ar.quantity_signal_parcels, ar.first_signal_payment,
            ar.act_date, ar.sign_date, ar.billing_date, ar.observation,
            ar.acquisition_request_stage_id as stage_id, u.price,
            coalesce(nullif(trim(cps.name), ''), nullif(trim(cpc.name), '')) as plan_name,
            coalesce(cps.initial_input_value, cpc.initial_input_value) as entrada,
            coalesce(cps.parcels, cpc.parcels) as parcels,
            coalesce(cps.financing_interest_rate, cpc.financing_interest_rate) as interest_rate,
            coalesce(cps.correction_rate, cpc.correction_rate) as correction_rate,
            ar.custom_commercial_plan as is_custom,
            cli.id as client_id, cli.user_code as client_code, ${nameSql("cli")} as client_name,
            imo.id as imobiliaria_id, imo.user_code as imobiliaria_code, ${nameSql("imo")} as imobiliaria_name,
            ${nameSql("cor")} as corretor_name
       from acquisition_requests ar
       join enterprise_unities u on u.id = ar.enterprise_unity_id
       left join commercial_plans cps on cps.id = ar.commercial_plan_id
       left join commercial_plans cpc on cpc.id = (
              select cp2.id from commercial_plans cp2
               where cp2.acquisition_request_id = ar.id
               order by cp2.id desc
               limit 1)
       left join users cli on cli.id = ar.client_id
       left join users imo on imo.id = cli.vinculed_by_id
       left join users cor on cor.id = ar.corretor_id
      where ar.enterprise_unity_id = ?
      order by ar.created_at desc, ar.id desc
      limit 1`,
    [id],
  );

  const row = rows[0];

  if (!row) {
    return { data: null, ok: true };
  }

  const arId = toNumber(row.ar_id);

  const [movementRows] = await poolResult.pool.query<UnitRow[]>(
    `select h.created_at as at,
            h.old_acquisition_request_stage_id as from_stage,
            h.new_acquisition_request_stage_id as to_stage
       from acquisition_request_historics h
      where h.acquisition_request_id = ?
        and h.new_acquisition_request_stage_id is not null
      order by h.created_at desc`,
    [arId],
  );

  const installments = await loadApoloUnitInstallments(unitId);

  const party = (
    partyId: number | string | null,
    code: number | string | null,
    name: number | string | null,
  ): ApoloVendaParty | null => {
    const cleaned = typeof name === "string" ? name.trim() : "";

    return partyId && cleaned
      ? {
          code: typeof code === "string" ? code.trim() || null : null,
          entityId: deterministicUuid(`apolo:c2x:users:${partyId}`),
          name: cleaned,
        }
      : null;
  };

  const stageId = toNumber(row.stage_id);

  return {
    data: {
      movimentacao: movementRows.map((movement) => ({
        at: dateOrNull(movement.at) ?? "",
        fromStage:
          toNumber(movement.from_stage) > 0
            ? STAGE_C2X_LABELS[toNumber(movement.from_stage)] ?? null
            : null,
        toStage:
          toNumber(movement.to_stage) > 0
            ? STAGE_C2X_LABELS[toNumber(movement.to_stage)] ?? null
            : null,
      })),
      parcelamento: installments.ok ? installments.installments : [],
      plan: {
        atoAt: dateOrNull(row.act_date),
        billingAt: dateOrNull(row.billing_date),
        client: party(row.client_id, row.client_code, row.client_name),
        code: text(row.code),
        corretor: text(row.corretor_name),
        correctionRate: nullableNumber(row.correction_rate),
        entrada: nullableNumber(row.entrada),
        firstSignalAt: dateOrNull(row.first_signal_payment),
        imobiliaria: party(row.imobiliaria_id, row.imobiliaria_code, row.imobiliaria_name),
        interestRate: nullableNumber(row.interest_rate),
        isCustom: toNumber(row.is_custom) === 1,
        observacao: text(row.observation),
        parcels: nullableNumber(row.parcels),
        planName: text(row.plan_name),
        signAt: dateOrNull(row.sign_date),
        signalParcels: nullableNumber(row.quantity_signal_parcels),
        stageLabel: stageId > 0 ? STAGE_C2X_LABELS[stageId] ?? null : null,
        vgv: toNumber(row.price),
      },
    },
    ok: true,
  };
}

// Estado da unidade: se a proposta mais recente está num estágio ATIVO, esse; senão
// (terminal, ou sem proposta) a unidade está disponível de novo.
function deriveStage(row: UnitRow): ApoloVendaStage {
  const stageId = toNumber(row.stage_id);
  const mapped = stageId > 0 ? STAGE_MAP[stageId] : undefined;

  if (mapped && ACTIVE_STAGES.has(mapped as ApoloVendaStage)) {
    return mapped as ApoloVendaStage;
  }

  return "disponivel";
}

function mapVendaUnit(row: UnitRow): ApoloVendaUnit {
  const enterpriseCode = String(row.enterprise_code ?? "");
  const stage = deriveStage(row);
  const party = (
    id: number | string | null,
    code: number | string | null,
    name: number | string | null,
  ): ApoloVendaParty | null => {
    const cleaned = typeof name === "string" ? name.trim() : "";

    return id && cleaned
      ? {
          code: typeof code === "string" ? code.trim() || null : null,
          entityId: deterministicUuid(`apolo:c2x:users:${id}`),
          name: cleaned,
        }
      : null;
  };

  // Disponível não carrega comprador (a proposta que existia caiu).
  const showParty = stage !== "disponivel";

  return {
    arId: row.ar_id ? toNumber(row.ar_id) : null,
    block: text(row.block),
    client: showParty ? party(row.client_id, row.client_code, row.client_name) : null,
    code: buildUnitCode(enterpriseCode, text(row.block), text(row.lot)),
    id: String(row.id),
    imobiliaria: showParty
      ? party(row.imobiliaria_id, row.imobiliaria_code, row.imobiliaria_name)
      : null,
    lot: text(row.lot),
    stage,
    stageSince: dateOrNull(row.stage_since),
    vgv: toNumber(row.price),
  };
}

function buildUnitCode(
  enterpriseCode: string,
  block: string | null,
  lot: string | null,
): string {
  const prefix = enterpriseCode
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, "X");
  const blockCode = (block ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  const lotCode = (lot ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .replace(/^L/i, "")
    .toUpperCase();

  return `${prefix}${blockCode}${lotCode}`;
}

function mapVendaMovement(row: UnitRow): ApoloVendaMovement {
  const enterpriseCode = String(row.enterprise_code ?? "");
  const fromId = toNumber(row.from_stage);
  const toId = toNumber(row.to_stage);

  return {
    at: dateOrNull(row.at) ?? "",
    client: text(row.client_name),
    code: buildUnitCode(enterpriseCode, text(row.block), text(row.lot)),
    fromStage: fromId > 0 ? STAGE_C2X_LABELS[fromId] ?? null : null,
    imobiliaria: text(row.imobiliaria_name),
    toStage: toId > 0 ? STAGE_C2X_LABELS[toId] ?? null : null,
    vgv: toNumber(row.price),
  };
}

function mapTerminalItem(row: UnitRow): ApoloVendaTerminalItem | null {
  const mapped = STAGE_MAP[toNumber(row.stage_id)];
  if (mapped !== "cancelado" && mapped !== "distrato") {
    return null;
  }

  const enterpriseCode = String(row.enterprise_code ?? "");

  return {
    at: dateOrNull(row.terminal_at),
    client: text(row.client_name),
    code: buildUnitCode(enterpriseCode, text(row.block), text(row.lot)),
    id: String(row.ar_id),
    imobiliaria: text(row.imobiliaria_name),
    reason: text(row.rejection_reason) ?? text(row.observation),
    terminal: mapped,
    vgv: toNumber(row.price),
  };
}

function emptyVendas(): ApoloEnterpriseVendas {
  return {
    bloqueadas: { units: 0, vgv: 0 },
    funnel: APOLO_VENDA_STAGE_ORDER.map((stage) => ({ stage, units: 0, vgv: 0 })),
    movements: [],
    terminalItems: [],
    terminals: [
      { proposals: 0, terminal: "cancelado", vgv: 0 },
      { proposals: 0, terminal: "distrato", vgv: 0 },
    ],
    totalUnits: 0,
    units: [],
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateOrNull(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
