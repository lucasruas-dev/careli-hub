// Cenário comercial dos EMPREENDIMENTOS (Apolo). Lê o C2X (read-only) e aplica a regra de
// governança do Hades — fonte única em lib/guardian/c2x-analytics.ts:
//   - EXCLUDED_ENTERPRISE_CODES: TSC/SDT/LAB/LAG ficam de fora (teste + masterplan/aditivo).
//   - ENTERPRISE_GROUPS: etapas do mesmo produto viram UMA linha consolidada (Lavra do Ouro =
//     LOS+LOU, Lagoa Bonita = LBF+LBR+LBP...), com as etapas como sub-linhas expansíveis.
//
// Baldes de unidade (mutuamente exclusivos, somam o total). O status 5 ("Bloqueado para venda")
// está ZERADO no C2X: o bloqueio real é o flag `enterprise_unities.sale_blocked`, e hoje todas
// as bloqueadas estão como "Disponível" — por isso Disponível DESCONTA as bloqueadas.
import type { RowDataPacket } from "mysql2";

import {
  ENTERPRISE_GROUPS,
  EXCLUDED_ENTERPRISE_CODES,
} from "@/lib/guardian/c2x-analytics";
import { getHadesDbPool } from "@/lib/guardian/db";

const SALE_STATUS = {
  DISPONIVEL: 1,
  RESERVADO: 2,
  EM_NEGOCIACAO: 3,
  VENDIDO: 4,
} as const;

export type ApoloEnterpriseBucket =
  | "disponivel"
  | "reservado"
  | "negociacao"
  | "vendido"
  | "bloqueado";

export type ApoloEnterpriseTally = {
  units: number;
  value: number;
};

export type ApoloEnterpriseScenario = Record<
  ApoloEnterpriseBucket | "total",
  ApoloEnterpriseTally
>;

export type ApoloEnterpriseRow = {
  // Código C2X (ex.: LBR). No grupo consolidado, é a lista das etapas.
  code: string;
  city: string | null;
  id: string;
  incorporador: string | null;
  name: string;
  scenario: ApoloEnterpriseScenario;
  state: string | null;
  // Etapas do produto (só no grupo consolidado). Vazio = linha simples.
  stages: ApoloEnterpriseRow[];
};

export type ApoloEnterprisesData = {
  rows: ApoloEnterpriseRow[];
  totals: ApoloEnterpriseScenario;
};

type EnterpriseQueryRow = RowDataPacket & {
  bloqueado_units: number | string | null;
  bloqueado_value: string | number | null;
  city: string | null;
  code: string | null;
  disponivel_units: number | string | null;
  disponivel_value: string | number | null;
  id: number;
  incorporador: string | null;
  name: string | null;
  negociacao_units: number | string | null;
  negociacao_value: string | number | null;
  reservado_units: number | string | null;
  reservado_value: string | number | null;
  state: string | null;
  total_units: number | string | null;
  total_value: string | number | null;
  vendido_units: number | string | null;
  vendido_value: string | number | null;
};

export async function loadApoloEnterprises(): Promise<
  { data: ApoloEnterprisesData; ok: true } | { error: string; ok: false }
> {
  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return {
      error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`,
      ok: false,
    };
  }

  const placeholders = EXCLUDED_ENTERPRISE_CODES.map(() => "?").join(", ");
  const [rows] = await poolResult.pool.query<EnterpriseQueryRow[]>(
    `select
       e.id,
       e.code,
       e.name,
       ci.name as city,
       s.acronym as state,
       inc.name as incorporador,
       count(u.id) as total_units,
       coalesce(sum(u.price), 0) as total_value,
       sum(case when u.sale_status_id = ? and coalesce(u.sale_blocked, 0) = 0 then 1 else 0 end) as disponivel_units,
       coalesce(sum(case when u.sale_status_id = ? and coalesce(u.sale_blocked, 0) = 0 then u.price else 0 end), 0) as disponivel_value,
       sum(case when u.sale_status_id = ? and coalesce(u.sale_blocked, 0) = 1 then 1 else 0 end) as bloqueado_units,
       coalesce(sum(case when u.sale_status_id = ? and coalesce(u.sale_blocked, 0) = 1 then u.price else 0 end), 0) as bloqueado_value,
       sum(case when u.sale_status_id = ? then 1 else 0 end) as reservado_units,
       coalesce(sum(case when u.sale_status_id = ? then u.price else 0 end), 0) as reservado_value,
       sum(case when u.sale_status_id = ? then 1 else 0 end) as negociacao_units,
       coalesce(sum(case when u.sale_status_id = ? then u.price else 0 end), 0) as negociacao_value,
       sum(case when u.sale_status_id = ? then 1 else 0 end) as vendido_units,
       coalesce(sum(case when u.sale_status_id = ? then u.price else 0 end), 0) as vendido_value
     from enterprises e
     left join enterprise_unities u on u.enterprise_id = e.id
     left join cities ci on ci.id = e.city_id
     left join states s on s.id = ci.state_id
     left join users inc on inc.id = e.incorporador_id
     where e.code not in (${placeholders})
     group by e.id, e.code, e.name, ci.name, s.acronym, inc.name
     order by e.code`,
    [
      SALE_STATUS.DISPONIVEL,
      SALE_STATUS.DISPONIVEL,
      SALE_STATUS.DISPONIVEL,
      SALE_STATUS.DISPONIVEL,
      SALE_STATUS.RESERVADO,
      SALE_STATUS.RESERVADO,
      SALE_STATUS.EM_NEGOCIACAO,
      SALE_STATUS.EM_NEGOCIACAO,
      SALE_STATUS.VENDIDO,
      SALE_STATUS.VENDIDO,
      ...EXCLUDED_ENTERPRISE_CODES,
    ],
  );

  const mapped = rows.map(mapEnterpriseRow);

  return { data: { rows: groupEnterpriseRows(mapped), totals: sumScenarios(mapped) }, ok: true };
}

// Consolida as etapas do mesmo produto numa linha só (regra ENTERPRISE_GROUPS); as etapas
// viram `stages` (sub-linhas expansíveis). O que não está em grupo vira linha simples.
function groupEnterpriseRows(rows: ApoloEnterpriseRow[]): ApoloEnterpriseRow[] {
  const byCode = new Map(rows.map((row) => [row.code.toUpperCase(), row]));
  const grouped: ApoloEnterpriseRow[] = [];
  const consumed = new Set<string>();

  for (const group of ENTERPRISE_GROUPS) {
    const stages = group.codes
      .map((code) => byCode.get(code.toUpperCase()))
      .filter((row): row is ApoloEnterpriseRow => Boolean(row));

    if (!stages.length) {
      continue;
    }

    for (const stage of stages) {
      consumed.add(stage.code.toUpperCase());
    }

    const first = stages[0];

    grouped.push({
      city: first?.city ?? null,
      code: stages.map((stage) => stage.code).join(" + "),
      id: `group:${group.display}`,
      incorporador:
        stages.find((stage) => stage.incorporador)?.incorporador ?? null,
      name: group.display,
      scenario: sumScenarios(stages),
      state: first?.state ?? null,
      stages,
    });
  }

  for (const row of rows) {
    if (!consumed.has(row.code.toUpperCase())) {
      grouped.push(row);
    }
  }

  return grouped.sort(
    (left, right) => right.scenario.total.units - left.scenario.total.units,
  );
}

function sumScenarios(rows: ApoloEnterpriseRow[]): ApoloEnterpriseScenario {
  const buckets: Array<ApoloEnterpriseBucket | "total"> = [
    "total",
    "disponivel",
    "reservado",
    "negociacao",
    "vendido",
    "bloqueado",
  ];

  return buckets.reduce((accumulator, bucket) => {
    accumulator[bucket] = rows.reduce(
      (tally, row) => ({
        units: tally.units + row.scenario[bucket].units,
        value: tally.value + row.scenario[bucket].value,
      }),
      { units: 0, value: 0 },
    );

    return accumulator;
  }, {} as ApoloEnterpriseScenario);
}

function mapEnterpriseRow(row: EnterpriseQueryRow): ApoloEnterpriseRow {
  const tally = (
    units: number | string | null,
    value: number | string | null,
  ): ApoloEnterpriseTally => ({
    units: toNumber(units),
    value: toNumber(value),
  });

  return {
    city: cleanText(row.city),
    code: cleanText(row.code) ?? String(row.id),
    id: String(row.id),
    incorporador: cleanText(row.incorporador),
    name: cleanText(row.name) ?? "Empreendimento",
    scenario: {
      bloqueado: tally(row.bloqueado_units, row.bloqueado_value),
      disponivel: tally(row.disponivel_units, row.disponivel_value),
      negociacao: tally(row.negociacao_units, row.negociacao_value),
      reservado: tally(row.reservado_units, row.reservado_value),
      total: tally(row.total_units, row.total_value),
      vendido: tally(row.vendido_units, row.vendido_value),
    },
    state: cleanText(row.state),
    stages: [],
  };
}

function toNumber(value: number | string | null): number {
  const parsed = Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}
