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
  city: string | null;
  // Código C2X (ex.: LBR). No grupo consolidado, o rótulo das etapas ("LBF + LBR + LBP").
  code: string;
  // Códigos reais (1 na linha simples; N no produto consolidado). Usado pra buscar unidades.
  codes: string[];
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

// Player ligado ao empreendimento no C2X. É a semente das arestas do grafo.
//
// PAPÉIS ACUMULÁVEIS (regra do Lucas): o `profile` declarado no C2X (Imobiliária, Corretor,
// Incorporador...) é UM papel; a FUNÇÃO no empreendimento é outro — e eles se somam na mesma
// entidade. Ex.: Luna Negócios é `Imobiliária` (perfil) E `Coordenador de Vendas` (função).
//
// Tradução de nome: no Apolo o `manager_id` do C2X chama-se COORDENADOR DE VENDAS (no C2X o
// campo continua "gerente"). Nome de PJ mora em fantasy_name/social_name — daí o coalesce.
export type ApoloEnterprisePlayerRelation =
  | "captador"
  | "coordenador"
  | "coordenador_vendas"
  | "incorporador";

export type ApoloEnterprisePlayer = {
  name: string;
  // Função DESTE player no empreendimento (a futura aresta do grafo).
  relation: ApoloEnterprisePlayerRelation;
  // Papéis acumulados (perfil do C2X + a função aqui), já deduplicados.
  roles: string[];
};

const relationLabels: Record<ApoloEnterprisePlayerRelation, string> = {
  captador: "Captador",
  coordenador: "Coordenador",
  coordenador_vendas: "Coordenador de Vendas",
  incorporador: "Incorporador",
};

export type ApoloEnterpriseCadastro = {
  actValue: number | null;
  city: string | null;
  code: string;
  createdAt: string | null;
  divulgationName: string | null;
  expectedDelivery: string | null;
  focalEmail: string | null;
  focalName: string | null;
  focalPhone: string | null;
  kind: string | null;
  name: string;
  players: ApoloEnterprisePlayer[];
  state: string | null;
};

type CadastroQueryRow = RowDataPacket & {
  act_value: string | number | null;
  captador: string | null;
  captador_perfil: string | null;
  city: string | null;
  code: string | null;
  coordenador: string | null;
  coordenador_perfil: string | null;
  created_at: Date | string | null;
  divulgation_name: string | null;
  expected_delivery_date: Date | string | null;
  focal_email: string | null;
  focal_name: string | null;
  focal_phone: string | null;
  gerente: string | null;
  gerente_perfil: string | null;
  incorporador: string | null;
  incorporador_perfil: string | null;
  kind: string | null;
  name: string | null;
  state: string | null;
};

// Nome do player: PJ guarda em fantasy_name/social_name; PF em name.
const PLAYER_NAME_SQL = `coalesce(nullif(trim(pu.name), ''), nullif(trim(pu.fantasy_name), ''), nullif(trim(pu.social_name), ''))`;

function playerSelect(column: string, alias: string): string {
  return `(select ${PLAYER_NAME_SQL} from users pu where pu.id = e.${column}) as ${alias},
          (select pp.name from users pu join profiles pp on pp.id = pu.profile_id where pu.id = e.${column}) as ${alias}_perfil`;
}

// Cadastro do empreendimento (uma ficha por CÓDIGO — o produto consolidado tem N).
export async function loadApoloEnterpriseCadastro(
  codes: string[],
): Promise<
  { cadastros: ApoloEnterpriseCadastro[]; ok: true } | { error: string; ok: false }
> {
  const validCodes = codes
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code && !EXCLUDED_ENTERPRISE_CODES.includes(code));

  if (!validCodes.length) {
    return { cadastros: [], ok: true };
  }

  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return {
      error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`,
      ok: false,
    };
  }

  const placeholders = validCodes.map(() => "?").join(", ");
  const [rows] = await poolResult.pool.query<CadastroQueryRow[]>(
    `select e.code, e.name, e.divulgation_name,
            et.name as kind,
            ci.name as city, st.acronym as state,
            e.expected_delivery_date, e.act_value, e.created_at,
            e.focal_name, e.focal_phone, e.focal_email,
            ${playerSelect("incorporador_id", "incorporador")},
            ${playerSelect("manager_id", "gerente")},
            ${playerSelect("captivator_id", "captador")},
            ${playerSelect("coordenador_id", "coordenador")}
     from enterprises e
     left join enterprise_types et on et.id = e.enterprise_type_id
     left join cities ci on ci.id = e.city_id
     left join states st on st.id = ci.state_id
     where e.code in (${placeholders})
     order by e.code`,
    validCodes,
  );

  return { cadastros: rows.map(mapCadastroRow), ok: true };
}

function mapCadastroRow(row: CadastroQueryRow): ApoloEnterpriseCadastro {
  // Papéis = perfil do C2X + a função no empreendimento (acumulam, sem duplicar).
  const player = (
    relation: ApoloEnterprisePlayerRelation,
    name: string | null,
    profile: string | null,
  ): ApoloEnterprisePlayer | null => {
    const cleaned = cleanText(name);

    if (!cleaned) {
      return null;
    }

    const roles = Array.from(
      new Set(
        [cleanText(profile), relationLabels[relation]].filter(
          (role): role is string => Boolean(role),
        ),
      ),
    );

    return { name: cleaned, relation, roles };
  };

  const players = [
    player("incorporador", row.incorporador, row.incorporador_perfil),
    // C2X `manager_id` = "gerente"; no Apolo é o COORDENADOR DE VENDAS.
    player("coordenador_vendas", row.gerente, row.gerente_perfil),
    player("captador", row.captador, row.captador_perfil),
    // Mantido no dado (o Lucas vai apontar no C2X quando houver escrita), mas a tela não exibe.
    player("coordenador", row.coordenador, row.coordenador_perfil),
  ].filter((entry): entry is ApoloEnterprisePlayer => Boolean(entry));

  return {
    actValue: row.act_value === null ? null : toNumber(row.act_value),
    city: cleanText(row.city),
    code: cleanText(row.code) ?? "",
    createdAt: toIsoDate(row.created_at),
    divulgationName: cleanText(row.divulgation_name),
    expectedDelivery: toIsoDate(row.expected_delivery_date),
    focalEmail: cleanText(row.focal_email),
    focalName: cleanText(row.focal_name),
    focalPhone: cleanText(row.focal_phone),
    kind: cleanText(row.kind),
    name: cleanText(row.name) ?? "Empreendimento",
    players,
    state: cleanText(row.state),
  };
}

function toIsoDate(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export type ApoloEnterpriseUnit = {
  area: number | null;
  block: string | null;
  bucket: ApoloEnterpriseBucket;
  enterpriseCode: string;
  id: string;
  lot: string | null;
  name: string | null;
  price: number;
  status: string;
};

type UnitQueryRow = RowDataPacket & {
  area: string | number | null;
  block: string | null;
  enterprise_code: string | null;
  id: number;
  lot: string | null;
  name: string | null;
  price: string | number | null;
  sale_blocked: number | null;
  sale_status_id: number | null;
  status: string | null;
};

// Unidades de um empreendimento (ou do produto consolidado: aceita N códigos).
export async function loadApoloEnterpriseUnits(
  codes: string[],
): Promise<
  { ok: true; units: ApoloEnterpriseUnit[] } | { error: string; ok: false }
> {
  const validCodes = codes
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code && !EXCLUDED_ENTERPRISE_CODES.includes(code));

  if (!validCodes.length) {
    return { ok: true, units: [] };
  }

  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return {
      error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`,
      ok: false,
    };
  }

  const placeholders = validCodes.map(() => "?").join(", ");
  const [rows] = await poolResult.pool.query<UnitQueryRow[]>(
    `select u.id, u.name, u.block, u.lot, u.area, u.price,
            u.sale_status_id, u.sale_blocked,
            ss.name as status, e.code as enterprise_code
     from enterprise_unities u
     join enterprises e on e.id = u.enterprise_id
     left join sale_statuses ss on ss.id = u.sale_status_id
     where e.code in (${placeholders})
     order by e.code, u.block, u.lot, u.name`,
    validCodes,
  );

  return { ok: true, units: rows.map(mapUnitRow) };
}

function mapUnitRow(row: UnitQueryRow): ApoloEnterpriseUnit {
  const blocked = Number(row.sale_blocked ?? 0) === 1;
  const statusId = Number(row.sale_status_id ?? 0);
  const bucket: ApoloEnterpriseBucket =
    statusId === SALE_STATUS.VENDIDO
      ? "vendido"
      : statusId === SALE_STATUS.EM_NEGOCIACAO
        ? "negociacao"
        : statusId === SALE_STATUS.RESERVADO
          ? "reservado"
          : blocked
            ? "bloqueado"
            : "disponivel";

  return {
    area: row.area === null ? null : toNumber(row.area),
    block: cleanText(row.block),
    bucket,
    enterpriseCode: cleanText(row.enterprise_code) ?? "",
    id: String(row.id),
    lot: cleanText(row.lot),
    name: cleanText(row.name),
    price: toNumber(row.price),
    // O status 5 nunca é usado no C2X; bloqueado vem do flag.
    status: blocked ? "Bloqueado" : (cleanText(row.status) ?? "Sem status"),
  };
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
      codes: stages.map((stage) => stage.code),
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
  const code = cleanText(row.code) ?? String(row.id);

  return {
    city: cleanText(row.city),
    code,
    codes: [code],
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
