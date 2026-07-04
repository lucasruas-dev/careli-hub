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
  return metrica === "clientes_faturados" || metrica === "unidades_faturadas";
}

type MetricaSql =
  | {
      base: "evento";
      stages: number[];
      agg: string;
    }
  | {
      base: "estado_unidade"; // fotografia por sale_status da unidade
      saleStatusId: number | null;
      agg: string;
    }
  | {
      base: "estado_faturado"; // aquisições vivas em FATURADO (tem comprador)
      agg: string;
    };

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
  vendas: {
    agg: "count(*)",
    base: "evento",
    stages: [STAGE.CONTRATO_GERADO, STAGE.EM_ASSINATURA, STAGE.FATURADO],
  },
};

// Nome exibível da imobiliária (mesma regra do ranking validado loadC2xVendasPorImobiliaria).
const IMOB_NOME_SQL =
  "coalesce(nullif(trim(imob.fantasy_name), ''), nullif(trim(imob.social_name), ''), nullif(trim(imob.name), ''), '(venda direta / sem imobiliária)')";

type GrupoSql = {
  select: string;
  groupBy: string;
  needsCli: boolean;
  needsImob: boolean;
  needsEstagio: boolean;
  // buckets de tempo saem em ordem cronológica; ranking sai por valor desc + limit
  isTimeBucket: boolean;
};

function grupoSql(agruparPor: C2xAgruparPor): GrupoSql {
  switch (agruparPor) {
    case "empreendimento":
      return {
        groupBy: "e.code, e.name",
        isTimeBucket: false,
        needsCli: false,
        needsEstagio: false,
        needsImob: false,
        select: "e.code as grupo_code, e.name as grupo_nome",
      };
    case "imobiliaria":
      return {
        groupBy: "grupo",
        isTimeBucket: false,
        needsCli: true,
        needsEstagio: false,
        needsImob: true,
        select: `${IMOB_NOME_SQL} as grupo`,
      };
    case "cliente":
      return {
        groupBy: "grupo",
        isTimeBucket: false,
        needsCli: true,
        needsEstagio: false,
        needsImob: false,
        select: "coalesce(nullif(trim(cli.name), ''), '(sem nome)') as grupo",
      };
    case "estagio":
      return {
        groupBy: "grupo",
        isTimeBucket: false,
        needsCli: false,
        needsEstagio: true,
        needsImob: false,
        select: "s.name as grupo",
      };
    case "dia":
      return {
        groupBy: "grupo",
        isTimeBucket: true,
        needsCli: false,
        needsEstagio: false,
        needsImob: false,
        select:
          "date_format(date_sub(h.created_at, interval 3 hour), '%Y-%m-%d') as grupo",
      };
    case "semana":
      return {
        groupBy: "grupo",
        isTimeBucket: true,
        needsCli: false,
        needsEstagio: false,
        needsImob: false,
        select:
          "yearweek(date_sub(h.created_at, interval 3 hour), 3) as grupo",
      };
    case "mes":
    default:
      return {
        groupBy: "grupo",
        isTimeBucket: true,
        needsCli: false,
        needsEstagio: false,
        needsImob: false,
        select:
          "date_format(date_sub(h.created_at, interval 3 hour), '%Y-%m') as grupo",
      };
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
  needsCli: boolean;
  needsImob: boolean;
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
      needsCli: false,
      needsImob: false,
      params: [...group.codes],
    };
  }

  return {
    clause:
      "(upper(e.code) = upper(?) or e.name like ? or e.divulgation_name like ?)",
    needsCli: false,
    needsImob: false,
    params: [term, `%${term}%`, `%${term}%`],
  };
}

function filtroImobiliaria(term: string): FiltroSql {
  return {
    clause:
      "(imob.fantasy_name like ? or imob.social_name like ? or imob.name like ?)",
    needsCli: true,
    needsImob: true,
    params: [`%${term}%`, `%${term}%`, `%${term}%`],
  };
}

function filtroCliente(term: string): FiltroSql {
  const digits = term.replace(/\D/g, "");

  if (digits.length >= 11) {
    return {
      clause:
        "replace(replace(replace(replace(coalesce(cli.cpf, cli.cnpj, ''), '.', ''), '-', ''), '/', ''), ' ', '') = ?",
      needsCli: true,
      needsImob: false,
      params: [digits],
    };
  }

  return {
    clause: "cli.name like ?",
    needsCli: true,
    needsImob: false,
    params: [`%${term}%`],
  };
}

function buildFiltros(filtros: PanteonFiltros): FiltroSql[] {
  const parts: FiltroSql[] = [];

  if (filtros.empreendimento) {
    parts.push(filtroEmpreendimento(filtros.empreendimento));
  }

  if (filtros.imobiliaria) {
    parts.push(filtroImobiliaria(filtros.imobiliaria));
  }

  if (filtros.cliente) {
    parts.push(filtroCliente(filtros.cliente));
  }

  return parts;
}

const RANKING_LIMIT = 30;

export function buildC2xAnalyticsQuery(input: C2xBuilderInput): C2xQueryPlan {
  const spec = METRICA_SQL[input.metrica];
  const grupo = input.agruparPor ? grupoSql(input.agruparPor) : null;
  const filtros = buildFiltros(input.filtros);

  const needsCli =
    (grupo?.needsCli ?? false) || filtros.some((filtro) => filtro.needsCli);
  const needsImob =
    (grupo?.needsImob ?? false) || filtros.some((filtro) => filtro.needsImob);

  const where: string[] = [
    `e.code not in (${EXCLUDED_ENTERPRISE_CODES.map(() => "?").join(", ")})`,
  ];
  const whereParams: unknown[] = [...EXCLUDED_ENTERPRISE_CODES];

  for (const filtro of filtros) {
    where.push(filtro.clause);
    whereParams.push(...filtro.params);
  }

  const selectGrupo = grupo ? `${grupo.select}, ` : "";
  const groupByClause = grupo ? `group by ${grupo.groupBy}` : "";

  // Ordenação/limite: bucket de tempo em ordem cronológica; ranking por valor (limite
  // executivo); empreendimento sem limite no SQL (consolida e ordena em JS).
  let tail = "";

  if (grupo) {
    if (grupo.isTimeBucket) {
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
    if (needsCli) {
      joins.push("left join users cli on cli.id = ar.client_id");
    }

    if (needsImob) {
      joins.push("left join users imob on imob.id = cli.vinculed_by_id");
    }

    if (grupo?.needsEstagio) {
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
      groupMode: grupo
        ? input.agruparPor === "empreendimento"
          ? "empreendimento"
          : "sql"
        : "none",
      params: [input.range.from, input.range.to, ...spec.stages, ...whereParams],
      sql,
    };
  }

  if (spec.base === "estado_unidade") {
    const statusClause =
      spec.saleStatusId != null ? "and eu.sale_status_id = ?" : "";
    const statusParams = spec.saleStatusId != null ? [spec.saleStatusId] : [];

    const sql = `
      select ${selectGrupo}${spec.agg} as valor
      from enterprise_unities eu
      join enterprises e on e.id = eu.enterprise_id
      where ${where.join("\n        and ")}
        ${statusClause}
      ${groupByClause}
      ${tail}
    `;

    return {
      groupMode: grupo
        ? input.agruparPor === "empreendimento"
          ? "empreendimento"
          : "sql"
        : "none",
      params: [...whereParams, ...statusParams],
      sql,
    };
  }

  // estado_faturado — espelha o ranking validado: cli em INNER join (a aquisição faturada
  // tem comprador), imob em LEFT (venda direta cai no bucket "(venda direta)").
  const joins = [
    "join enterprise_unities eu on eu.id = ar.enterprise_unity_id",
    "join enterprises e on e.id = eu.enterprise_id",
    "join users cli on cli.id = ar.client_id",
  ];

  if (needsImob) {
    joins.push("left join users imob on imob.id = cli.vinculed_by_id");
  }

  const sql = `
    select ${selectGrupo}${spec.agg} as valor
    from acquisition_requests ar
    ${joins.join("\n    ")}
    where ar.acquisition_request_stage_id = ${STAGE.FATURADO}
      and ${where.join("\n      and ")}
    ${groupByClause}
    ${tail}
  `;

  return {
    groupMode: grupo
      ? input.agruparPor === "empreendimento"
        ? "empreendimento"
        : "sql"
      : "none",
    params: whereParams,
    sql,
  };
}
