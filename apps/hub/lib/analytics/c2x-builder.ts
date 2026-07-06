import {
  ENTERPRISE_GROUPS,
  EXCLUDED_ENTERPRISE_CODES,
  STAGE,
} from "@/lib/guardian/c2x-analytics";

import type {
  C2xAgruparPor,
  C2xMetrica,
  PanteonFiltros,
  PanteonRange,
} from "./registry";

// Builder SQL do módulo C2X do SUPER MOTOR. PURO (não toca banco/env) pra ser validável por
// script contra o C2X real. Todo identificador do SQL sai das whitelists deste arquivo; valor
// de filtro entra SEMPRE como parâmetro (?). Regras validadas (ver [[reference-c2x-vendas-model]]):
// - movimentação = transições de estágio em acquisition_request_historics (mesma conta do
//   loadC2xMovimentacaoResumo);
// - "vendido" oficial do painel = enterprise_unities.sale_status_id = 4;
// - venda faturada com comprador = acquisition_requests em estágio FATURADO, unidade distinta;
// - imobiliária = vínculo do CLIENTE comprador (users.vinculed_by_id) — corretor_id é nulo;
// - inadimplência = payments.payment_status_id = 7 (parcela vencida) ativa (mesma conta do Hades);
// - PERFIL do cliente (idade/sexo/estado civil/renda/escolaridade) vem da tabela users +
//   lookups (sexes/civil_states/salary_ranges/schoolings) — dimensões pra cruzar quem compra/
//   quem atrasa. Fill rate validado (compradores ~97%; sexo ~60% → bucket "(não informado)");
// - exclui empreendimentos de teste/masterplan (EXCLUDED_ENTERPRISE_CODES) em TODAS as contas.

export type C2xBuilderInput = {
  metrica: C2xMetrica;
  agruparPor: C2xAgruparPor | null;
  filtros: PanteonFiltros;
  range: PanteonRange | null;
};

export type C2xQueryPlan = {
  sql: string;
  params: unknown[];
  // empreendimento: linhas vêm com grupo_code/grupo_nome e são consolidadas em JS
  // (Lavra do Ouro = LOS+LOU etc.); sql: grupo já vem pronto; none: linha única.
  groupMode: "none" | "sql" | "empreendimento";
};

// Métricas cujo agregado é DISTINCT: a soma dos grupos pode passar do total real (o mesmo
// cliente/unidade pode aparecer em mais de um grupo) — o dispatcher busca o total à parte.
export function isDistinctC2xMetrica(metrica: C2xMetrica): boolean {
  return (
    metrica === "clientes_faturados" ||
    metrica === "unidades_faturadas" ||
    metrica === "inadimplentes"
  );
}

// Valor em aberto de uma parcela vencida (mesma expressão do Hades/attendance).
const OVERDUE_OUTSTANDING =
  "coalesce(nullif(p.paid_value, 0), coalesce(p.initial_value, 0) + coalesce(p.interest_value, 0) + coalesce(p.mulct_value, 0), 0)";

type MetricaSql =
  | { base: "evento"; stages: number[]; agg: string }
  | { base: "estado_unidade"; saleStatusId: number | null; agg: string }
  | { base: "estado_faturado"; agg: string }
  | { base: "inadimplencia"; agg: string };

const METRICA_SQL: Record<C2xMetrica, MetricaSql> = {
  cancelamentos: {
    agg: "count(*)",
    base: "evento",
    stages: [STAGE.CANCELADO, STAGE.EM_DISTRATO, STAGE.DISTRATADO],
  },
  clientes_faturados: {
    agg: "count(distinct ar.client_id)",
    base: "evento",
    stages: [STAGE.FATURADO],
  },
  faturamentos: { agg: "count(*)", base: "evento", stages: [STAGE.FATURADO] },
  inadimplentes: { agg: "count(distinct cli.id)", base: "inadimplencia" },
  parcelas_vencidas: { agg: "count(*)", base: "inadimplencia" },
  propostas: { agg: "count(*)", base: "evento", stages: [STAGE.PROPOSTA] },
  reservas: { agg: "count(*)", base: "evento", stages: [STAGE.RESERVADO] },
  unidades_disponiveis: {
    agg: "count(*)",
    base: "estado_unidade",
    saleStatusId: 1,
  },
  unidades_faturadas: {
    agg: "count(distinct ar.enterprise_unity_id)",
    base: "estado_faturado",
  },
  unidades_total: { agg: "count(*)", base: "estado_unidade", saleStatusId: null },
  unidades_vendidas: {
    agg: "count(*)",
    base: "estado_unidade",
    saleStatusId: 4,
  },
  valor_carteira_vendida: {
    agg: "coalesce(sum(eu.price), 0)",
    base: "estado_unidade",
    saleStatusId: 4,
  },
  valor_faturado: {
    agg: "coalesce(sum(eu.price), 0)",
    base: "evento",
    stages: [STAGE.FATURADO],
  },
  valor_vencido: {
    agg: `coalesce(sum(${OVERDUE_OUTSTANDING}), 0)`,
    base: "inadimplencia",
  },
  vendas: {
    agg: "count(*)",
    base: "evento",
    stages: [STAGE.CONTRATO_GERADO, STAGE.EM_ASSINATURA, STAGE.FATURADO],
  },
};

// Nome exibível da imobiliária (mesma regra do ranking validado loadC2xVendasPorImobiliaria).
const IMOB_NOME_SQL =
  "coalesce(nullif(trim(imob.fantasy_name), ''), nullif(trim(imob.social_name), ''), nullif(trim(imob.name), ''), '(venda direta / sem imobiliária)')";

// Faixa etária a partir de users.birthday (rótulo limpo; ausência vira "(não informado)").
const AGE_BUCKET_SQL = `case
    when cli.birthday is null then '(não informado)'
    when timestampdiff(year, cli.birthday, curdate()) < 25 then 'até 24 anos'
    when timestampdiff(year, cli.birthday, curdate()) < 35 then '25 a 34 anos'
    when timestampdiff(year, cli.birthday, curdate()) < 45 then '35 a 44 anos'
    when timestampdiff(year, cli.birthday, curdate()) < 55 then '45 a 54 anos'
    when timestampdiff(year, cli.birthday, curdate()) < 65 then '55 a 64 anos'
    else '65 anos ou mais'
  end`;

// O que cada join demográfico precisa. Todos penduram em `cli` (o comprador/inadimplente).
type Needs = {
  cli: boolean;
  imob: boolean;
  estagio: boolean;
  sex: boolean;
  civil: boolean;
  salary: boolean;
  school: boolean;
  // status de venda da UNIDADE (sale_statuses via eu.sale_status_id) — só base estado_unidade
  saleStatus: boolean;
};

type GrupoSql = {
  select: string;
  groupBy: string;
  isTimeBucket: boolean;
  needs: Partial<Needs>;
};

function grupo(select: string, groupBy: string, extra?: Partial<GrupoSql>): GrupoSql {
  return {
    groupBy,
    isTimeBucket: false,
    needs: {},
    select,
    ...extra,
  };
}

function grupoSql(agruparPor: C2xAgruparPor): GrupoSql {
  switch (agruparPor) {
    case "empreendimento":
      return grupo("e.code as grupo_code, e.name as grupo_nome", "e.code, e.name");
    case "imobiliaria":
      return grupo(`${IMOB_NOME_SQL} as grupo`, "grupo", {
        needs: { cli: true, imob: true },
      });
    case "cliente":
      return grupo(
        "coalesce(nullif(trim(cli.name), ''), '(sem nome)') as grupo",
        "grupo",
        { needs: { cli: true } },
      );
    case "estagio":
      return grupo("s.name as grupo", "grupo", { needs: { estagio: true } });
    case "status_venda":
      return grupo(
        "coalesce(ss.name, '(sem status)') as grupo",
        "grupo",
        { needs: { saleStatus: true } },
      );
    case "faixa_etaria":
      return grupo(`${AGE_BUCKET_SQL} as grupo`, "grupo", {
        needs: { cli: true },
      });
    case "sexo":
      return grupo(
        "coalesce(dsex.name, '(não informado)') as grupo",
        "grupo",
        { needs: { cli: true, sex: true } },
      );
    case "estado_civil":
      return grupo(
        "coalesce(dciv.name, '(não informado)') as grupo",
        "grupo",
        { needs: { cli: true, civil: true } },
      );
    case "faixa_renda":
      return grupo(
        "coalesce(dsal.name, '(não informado)') as grupo",
        "grupo",
        { needs: { cli: true, salary: true } },
      );
    case "escolaridade":
      return grupo(
        "coalesce(dsch.name, '(não informado)') as grupo",
        "grupo",
        { needs: { cli: true, school: true } },
      );
    case "dia":
      return grupo(
        "date_format(date_sub(h.created_at, interval 3 hour), '%Y-%m-%d') as grupo",
        "grupo",
        { isTimeBucket: true },
      );
    case "semana":
      return grupo(
        "yearweek(date_sub(h.created_at, interval 3 hour), 3) as grupo",
        "grupo",
        { isTimeBucket: true },
      );
    case "mes":
    default:
      return grupo(
        "date_format(date_sub(h.created_at, interval 3 hour), '%Y-%m') as grupo",
        "grupo",
        { isTimeBucket: true },
      );
  }
}

function normalizeTerm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

type FiltroSql = {
  clause: string;
  params: unknown[];
  needs: Partial<Needs>;
};

// Filtro de empreendimento: casa primeiro com os GRUPOS consolidados (ex.: "Lavra do Ouro"
// = LOS+LOU, pra fechar com o número do painel); senão, sigla exata ou nome LIKE.
function filtroEmpreendimento(term: string): FiltroSql {
  const norm = normalizeTerm(term);
  const group = ENTERPRISE_GROUPS.find((entry) => {
    const display = normalizeTerm(entry.display);

    return display === norm || (norm.length >= 4 && display.includes(norm));
  });

  if (group) {
    return {
      clause: `e.code in (${group.codes.map(() => "?").join(", ")})`,
      needs: {},
      params: [...group.codes],
    };
  }

  return {
    clause:
      "(upper(e.code) = upper(?) or e.name like ? or e.divulgation_name like ?)",
    needs: {},
    params: [term, `%${term}%`, `%${term}%`],
  };
}

function buildFiltros(filtros: PanteonFiltros): FiltroSql[] {
  const parts: FiltroSql[] = [];

  if (filtros.empreendimento) {
    parts.push(filtroEmpreendimento(filtros.empreendimento));
  }

  if (filtros.imobiliaria) {
    parts.push({
      clause:
        "(imob.fantasy_name like ? or imob.social_name like ? or imob.name like ?)",
      needs: { cli: true, imob: true },
      params: [
        `%${filtros.imobiliaria}%`,
        `%${filtros.imobiliaria}%`,
        `%${filtros.imobiliaria}%`,
      ],
    });
  }

  if (filtros.cliente) {
    const digits = filtros.cliente.replace(/\D/g, "");

    parts.push(
      digits.length >= 11
        ? {
            clause:
              "replace(replace(replace(replace(coalesce(cli.cpf, cli.cnpj, ''), '.', ''), '-', ''), '/', ''), ' ', '') = ?",
            needs: { cli: true },
            params: [digits],
          }
        : {
            clause: "cli.name like ?",
            needs: { cli: true },
            params: [`%${filtros.cliente}%`],
          },
    );
  }

  // Filtros de PERFIL (demografia): casam pelo NOME do lookup (vocabulário controlado),
  // então um LIKE tolerante resolve ("feminino" → "Feminino", "casado" → "Casado (a)").
  const demog: [string | undefined, string, keyof Needs][] = [
    [filtros.sexo, "dsex.name", "sex"],
    [filtros.estado_civil, "dciv.name", "civil"],
    [filtros.faixa_renda, "dsal.name", "salary"],
    [filtros.escolaridade, "dsch.name", "school"],
  ];

  for (const [term, column, need] of demog) {
    if (term) {
      parts.push({
        clause: `${column} like ?`,
        needs: { cli: true, [need]: true },
        params: [`%${term}%`],
      });
    }
  }

  return parts;
}

function mergeNeeds(grupo: GrupoSql | null, filtros: FiltroSql[]): Needs {
  const sources = [grupo?.needs ?? {}, ...filtros.map((filtro) => filtro.needs)];
  const has = (key: keyof Needs) => sources.some((source) => source[key]);

  const needs: Needs = {
    civil: has("civil"),
    cli: false,
    estagio: has("estagio"),
    imob: has("imob"),
    salary: has("salary"),
    saleStatus: has("saleStatus"),
    school: has("school"),
    sex: has("sex"),
  };

  // Toda demografia + imobiliária penduram em `cli`.
  needs.cli =
    has("cli") ||
    needs.imob ||
    needs.sex ||
    needs.civil ||
    needs.salary ||
    needs.school;

  return needs;
}

// Joins que dependem do comprador (`cli`): imobiliária + lookups de perfil.
function clientJoins(needs: Needs): string[] {
  const joins: string[] = [];

  if (needs.imob) {
    joins.push("left join users imob on imob.id = cli.vinculed_by_id");
  }
  if (needs.sex) {
    joins.push("left join sexes dsex on dsex.id = cli.sex_id");
  }
  if (needs.civil) {
    joins.push("left join civil_states dciv on dciv.id = cli.civil_state_id");
  }
  if (needs.salary) {
    joins.push("left join salary_ranges dsal on dsal.id = cli.salary_range_id");
  }
  if (needs.school) {
    joins.push("left join schoolings dsch on dsch.id = cli.schooling_id");
  }

  return joins;
}

const RANKING_LIMIT = 30;

function resolveGroupMode(
  grupo: GrupoSql | null,
  agruparPor: C2xAgruparPor | null,
): C2xQueryPlan["groupMode"] {
  if (!grupo) {
    return "none";
  }

  return agruparPor === "empreendimento" ? "empreendimento" : "sql";
}

export function buildC2xAnalyticsQuery(input: C2xBuilderInput): C2xQueryPlan {
  const spec = METRICA_SQL[input.metrica];
  const grupoResolved = input.agruparPor ? grupoSql(input.agruparPor) : null;
  const filtros = buildFiltros(input.filtros);
  const needs = mergeNeeds(grupoResolved, filtros);

  const where: string[] = [
    `e.code not in (${EXCLUDED_ENTERPRISE_CODES.map(() => "?").join(", ")})`,
  ];
  const whereParams: unknown[] = [...EXCLUDED_ENTERPRISE_CODES];

  for (const filtro of filtros) {
    where.push(filtro.clause);
    whereParams.push(...filtro.params);
  }

  const selectGrupo = grupoResolved ? `${grupoResolved.select}, ` : "";
  const groupByClause = grupoResolved ? `group by ${grupoResolved.groupBy}` : "";
  const groupMode = resolveGroupMode(grupoResolved, input.agruparPor);

  // Ordenação/limite: bucket de tempo em ordem cronológica; ranking por valor (limite
  // executivo); empreendimento sem limite no SQL (consolida e ordena em JS).
  let tail = "";

  if (grupoResolved) {
    if (grupoResolved.isTimeBucket) {
      tail = "order by grupo asc limit 400";
    } else if (input.agruparPor !== "empreendimento") {
      tail = `order by valor desc limit ${RANKING_LIMIT}`;
    }
  }

  if (spec.base === "evento") {
    if (!input.range) {
      throw new Error("Métrica de evento exige período resolvido.");
    }

    const joins = [
      "join acquisition_requests ar on ar.id = h.acquisition_request_id",
      "join enterprise_unities eu on eu.id = ar.enterprise_unity_id",
      "join enterprises e on e.id = eu.enterprise_id",
    ];

    // LEFT pra não mudar a contagem validada do resumo de movimentação (que não tem
    // esse join): evento sem cliente vinculado continua contando.
    if (needs.cli) {
      joins.push("left join users cli on cli.id = ar.client_id");
    }

    joins.push(...clientJoins(needs));

    if (needs.estagio) {
      joins.push(
        "join acquisition_request_stages s on s.id = h.new_acquisition_request_stage_id",
      );
    }

    const sql = `
      select ${selectGrupo}${spec.agg} as valor
      from acquisition_request_historics h
      ${joins.join("\n      ")}
      where h.created_at >= ? and h.created_at < ?
        and h.new_acquisition_request_stage_id in (${spec.stages.map(() => "?").join(", ")})
        and ${where.join("\n        and ")}
      ${groupByClause}
      ${tail}
    `;

    return {
      groupMode,
      params: [input.range.from, input.range.to, ...spec.stages, ...whereParams],
      sql,
    };
  }

  if (spec.base === "estado_unidade") {
    const statusClause =
      spec.saleStatusId != null ? "and eu.sale_status_id = ?" : "";
    const statusParams = spec.saleStatusId != null ? [spec.saleStatusId] : [];
    const statusJoin = needs.saleStatus
      ? "\n      left join sale_statuses ss on ss.id = eu.sale_status_id"
      : "";

    const sql = `
      select ${selectGrupo}${spec.agg} as valor
      from enterprise_unities eu
      join enterprises e on e.id = eu.enterprise_id${statusJoin}
      where ${where.join("\n        and ")}
        ${statusClause}
      ${groupByClause}
      ${tail}
    `;

    return {
      groupMode,
      params: [...whereParams, ...statusParams],
      sql,
    };
  }

  if (spec.base === "inadimplencia") {
    // Inadimplência = parcela vencida ATIVA (payment_status_id = 7), pela unidade/aquisição
    // → comprador. Fotografia atual (sem período). cli sempre presente (é sobre a pessoa).
    const joins = [
      "join acquisition_requests ar on ar.id = p.acquisition_request_id",
      "join enterprise_unities eu on eu.id = ar.enterprise_unity_id",
      "join enterprises e on e.id = eu.enterprise_id",
      "join users cli on cli.id = ar.client_id",
      ...clientJoins(needs),
    ];

    const sql = `
      select ${selectGrupo}${spec.agg} as valor
      from payments p
      ${joins.join("\n      ")}
      where p.payment_status_id = 7
        and (p.payment_to_delete is null or p.payment_to_delete = 0)
        and ${where.join("\n        and ")}
      ${groupByClause}
      ${tail}
    `;

    return { groupMode, params: whereParams, sql };
  }

  // estado_faturado — espelha o ranking validado: cli em INNER join (a aquisição faturada
  // tem comprador), imob/perfil em LEFT.
  const joins = [
    "join enterprise_unities eu on eu.id = ar.enterprise_unity_id",
    "join enterprises e on e.id = eu.enterprise_id",
    "join users cli on cli.id = ar.client_id",
    ...clientJoins(needs),
  ];

  const sql = `
    select ${selectGrupo}${spec.agg} as valor
    from acquisition_requests ar
    ${joins.join("\n    ")}
    where ar.acquisition_request_stage_id = ${STAGE.FATURADO}
      and ${where.join("\n      and ")}
    ${groupByClause}
    ${tail}
  `;

  return { groupMode, params: whereParams, sql };
}
