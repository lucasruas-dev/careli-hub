import type { RowDataPacket } from "mysql2/promise";

import { getHadesDbPool, sanitizeHadesDbError } from "./db";

// Analytics READ-ONLY do C2X para o modo ASSISTENTE da CACÁ (os proprietários). Nunca escreve.
// Regras e vocabulário validados contra o C2X. Ver [[reference-c2x-vendas-model]] e
// [[project-caca-admin-assistant-mode]].

// Estágios da aquisição (acquisition_request_stages). Exportado pro motor de análise
// (lib/analytics) usar a MESMA fonte de verdade.
export const STAGE = {
  RESERVADO: 1,
  ANALISE: 2,
  CONTRATO_GERADO: 3,
  FATURADO: 4,
  EM_ASSINATURA: 5,
  FINALIZADO: 6,
  CANCELADO: 7,
  REPROVADO: 8,
  PROPOSTA: 9,
  EM_DISTRATO: 10,
  DISTRATADO: 11,
} as const;

// Empreendimentos que NÃO entram nas análises da CACÁ (teste + masterplan/aditivo da Lagoa
// Bonita) — decisão do Lucas. Por código (sigla).
export const EXCLUDED_ENTERPRISE_CODES = ["TSC", "SDT", "LAB", "LAG"];

// Consolidação de empreendimentos com o mesmo produto (regras do diário/Lucas): soma etapas.
// Fonte única — o displayEnterprise e o filtro por empreendimento do motor derivam daqui.
export const ENTERPRISE_GROUPS: { display: string; codes: string[] }[] = [
  { codes: ["LOS", "LOU"], display: "Lavra do Ouro" },
  { codes: ["RDP", "RPC", "RPS"], display: "Rio de Pedras" },
  { codes: ["PDV", "PVS"], display: "Portal dos Vales" },
  { codes: ["LBF", "LBR", "LBP"], display: "Lagoa Bonita" },
];

export function displayEnterprise(
  code: string | null,
  name: string | null,
): string {
  const c = String(code ?? "").toUpperCase();
  const group = ENTERPRISE_GROUPS.find((entry) => entry.codes.includes(c));

  if (group) {
    return group.display;
  }

  return (name ?? "Empreendimento").trim();
}

export type C2xPeriodo =
  | "hoje"
  | "ontem"
  | "esta_semana"
  | "este_mes"
  | "mes_passado"
  | "este_ano"
  | "ultimos_7_dias"
  | "ultimos_30_dias"
  | "desde_o_inicio";

// São Paulo é UTC-3 fixo (Brasil sem horário de verão desde 2019). Meia-noite SP -> instante UTC.
function spMidnightUtc(year: number, month: number, day: number): Date {
  const pad = (n: number) => String(n).padStart(2, "0");

  return new Date(`${year}-${pad(month)}-${pad(day)}T00:00:00-03:00`);
}

function spPartsNow(): { year: number; month: number; day: number; weekday: number } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    year: "numeric",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((part) => [part.type, part.value]),
  );
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    day: Number(parts.day),
    month: Number(parts.month),
    weekday: weekdayMap[parts.weekday ?? "Sun"] ?? 0,
    year: Number(parts.year),
  };
}

// Intervalo [from, to) para o período pedido, em instantes reais (UTC), com base no dia de SP.
export function resolvePeriodoRange(periodo: C2xPeriodo): {
  from: Date;
  label: string;
  to: Date;
} {
  const now = new Date();
  const { year, month, day, weekday } = spPartsNow();
  const todayStart = spMidnightUtc(year, month, day);
  const DAY = 24 * 60 * 60 * 1000;

  switch (periodo) {
    case "hoje":
      return { from: todayStart, label: "hoje", to: now };
    case "ontem":
      return {
        from: new Date(todayStart.getTime() - DAY),
        label: "ontem",
        to: todayStart,
      };
    case "esta_semana": {
      // semana começa na segunda-feira
      const backToMonday = (weekday + 6) % 7;
      return {
        from: new Date(todayStart.getTime() - backToMonday * DAY),
        label: "esta semana",
        to: now,
      };
    }
    case "este_mes":
      return { from: spMidnightUtc(year, month, 1), label: "este mês", to: now };
    case "mes_passado": {
      const prevYear = month === 1 ? year - 1 : year;
      const prevMonth = month === 1 ? 12 : month - 1;

      return {
        from: spMidnightUtc(prevYear, prevMonth, 1),
        label: "mês passado",
        to: spMidnightUtc(year, month, 1),
      };
    }
    case "este_ano":
      return { from: spMidnightUtc(year, 1, 1), label: "este ano", to: now };
    case "desde_o_inicio":
      return {
        from: spMidnightUtc(2000, 1, 1),
        label: "desde o início",
        to: now,
      };
    case "ultimos_7_dias":
      return {
        from: new Date(now.getTime() - 7 * DAY),
        label: "últimos 7 dias",
        to: now,
      };
    case "ultimos_30_dias":
    default:
      return {
        from: new Date(now.getTime() - 30 * DAY),
        label: "últimos 30 dias",
        to: now,
      };
  }
}

export type C2xMovimentacaoResumo = {
  periodoLabel: string;
  propostas: number; // viraram "Proposta realizada"
  contratoGerado: number;
  emAssinatura: number;
  faturado: number; // vendas fechadas (Faturado)
  vendas: number; // contrato gerado + em assinatura + faturado (pipeline de venda)
  cancelados: number;
  distratos: number; // em distrato + distratado
  reservas: number;
};

// Movimentação por período: quantas aquisições VIRARAM cada estágio no intervalo (via
// acquisition_request_historics). Exclui empreendimentos de teste/masterplan/aditivo.
export async function loadC2xMovimentacaoResumo(
  periodo: C2xPeriodo,
): Promise<C2xMovimentacaoResumo | null> {
  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return null;
  }

  const { from, to, label } = resolvePeriodoRange(periodo);

  try {
    const [rows] = await poolResult.pool.query<
      (RowDataPacket & { stage_id: number; n: number | string })[]
    >(
      `
      select h.new_acquisition_request_stage_id as stage_id, count(*) as n
      from acquisition_request_historics h
      join acquisition_requests ar on ar.id = h.acquisition_request_id
      join enterprise_unities eu on eu.id = ar.enterprise_unity_id
      join enterprises e on e.id = eu.enterprise_id
      where h.created_at >= ? and h.created_at < ?
        and e.code not in (${EXCLUDED_ENTERPRISE_CODES.map(() => "?").join(", ")})
      group by h.new_acquisition_request_stage_id
      `,
      [from, to, ...EXCLUDED_ENTERPRISE_CODES],
    );

    const byStage = new Map<number, number>();
    for (const row of rows) {
      byStage.set(Number(row.stage_id), Number(row.n));
    }
    const get = (stage: number) => byStage.get(stage) ?? 0;

    const faturado = get(STAGE.FATURADO);
    const contratoGerado = get(STAGE.CONTRATO_GERADO);
    const emAssinatura = get(STAGE.EM_ASSINATURA);

    return {
      cancelados: get(STAGE.CANCELADO),
      contratoGerado,
      distratos: get(STAGE.EM_DISTRATO) + get(STAGE.DISTRATADO),
      emAssinatura,
      faturado,
      periodoLabel: label,
      propostas: get(STAGE.PROPOSTA),
      reservas: get(STAGE.RESERVADO),
      vendas: contratoGerado + emAssinatura + faturado,
    };
  } catch (error) {
    console.error(
      "[guardian] loadC2xMovimentacaoResumo failed",
      sanitizeHadesDbError(error),
    );

    return null;
  }
}

export type C2xMovimentacaoTipo =
  | "propostas"
  | "vendas"
  | "faturado"
  | "cancelamentos";

export type C2xMovimentacaoItem = {
  data: string; // ISO
  estagio: string;
  empreendimento: string;
  quadraLote: string;
  area: number | null;
  valorLote: number | null;
  cliente: string | null;
  corretor: string | null;
  imobiliaria: string | null;
};

function stagesForTipo(tipo: C2xMovimentacaoTipo): number[] {
  switch (tipo) {
    case "propostas":
      return [STAGE.PROPOSTA];
    case "faturado":
      return [STAGE.FATURADO];
    case "cancelamentos":
      return [STAGE.CANCELADO, STAGE.EM_DISTRATO, STAGE.DISTRATADO];
    case "vendas":
    default:
      return [STAGE.CONTRATO_GERADO, STAGE.EM_ASSINATURA, STAGE.FATURADO];
  }
}

// Detalhe da movimentação: lista as aquisições que viraram o estágio pedido no período, com
// unidade, valor, metragem, cliente, corretor e imobiliária. Limite baixo (executivo).
export async function loadC2xMovimentacaoDetalhe(
  periodo: C2xPeriodo,
  tipo: C2xMovimentacaoTipo,
  limit = 25,
): Promise<C2xMovimentacaoItem[]> {
  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return [];
  }

  const { from, to } = resolvePeriodoRange(periodo);
  const stages = stagesForTipo(tipo);
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);

  try {
    const [rows] = await poolResult.pool.query<
      (RowDataPacket & {
        data: Date | string;
        estagio: string | null;
        emp_code: string | null;
        emp_name: string | null;
        block: string | null;
        lot: string | null;
        area: number | string | null;
        price: number | string | null;
        cliente: string | null;
        corretor: string | null;
        imobiliaria: string | null;
      })[]
    >(
      `
      select h.created_at as data, s.name as estagio,
             e.code as emp_code, e.name as emp_name,
             eu.block, eu.lot, eu.area, eu.price,
             cli.name as cliente, cor.name as corretor,
             coalesce(
               nullif(trim(imob.fantasy_name), ''),
               nullif(trim(imob.social_name), ''),
               nullif(trim(imob.name), '')
             ) as imobiliaria
      from acquisition_request_historics h
      join acquisition_requests ar on ar.id = h.acquisition_request_id
      join acquisition_request_stages s on s.id = h.new_acquisition_request_stage_id
      join enterprise_unities eu on eu.id = ar.enterprise_unity_id
      join enterprises e on e.id = eu.enterprise_id
      left join users cli on cli.id = ar.client_id
      left join users cor on cor.id = ar.corretor_id
      -- Imobiliária pelo VÍNCULO do comprador (users.vinculed_by_id), não pelo corretor_id
      -- (sempre NULO no C2X). Mesma fonte do ranking/motor. Ver [[reference-c2x-vendas-model]].
      left join users imob on imob.id = cli.vinculed_by_id
      where h.created_at >= ? and h.created_at < ?
        and h.new_acquisition_request_stage_id in (${stages.map(() => "?").join(", ")})
        and e.code not in (${EXCLUDED_ENTERPRISE_CODES.map(() => "?").join(", ")})
      order by h.created_at desc
      limit ${safeLimit}
      `,
      [from, to, ...stages, ...EXCLUDED_ENTERPRISE_CODES],
    );

    return rows.map((row) => ({
      area: row.area == null ? null : Number(row.area),
      cliente: row.cliente,
      corretor: row.corretor,
      data:
        row.data instanceof Date ? row.data.toISOString() : String(row.data),
      empreendimento: displayEnterprise(row.emp_code, row.emp_name),
      estagio: row.estagio ?? "-",
      imobiliaria: row.imobiliaria,
      quadraLote: `Q${row.block ?? "?"} L${row.lot ?? "?"}`,
      valorLote: row.price == null ? null : Number(row.price),
    }));
  } catch (error) {
    console.error(
      "[guardian] loadC2xMovimentacaoDetalhe failed",
      sanitizeHadesDbError(error),
    );

    return [];
  }
}

export type C2xImobiliariaVendas = {
  imobiliaria: string;
  unidades: number;
};

// Ranking de imobiliárias por vendas (unidades faturadas distintas). A imobiliária vem do
// VÍNCULO do cliente comprador (`users.vinculed_by_id`), não de corretor_id (que é sempre
// nulo no C2X). Nome pela fantasia/social/name. Ver [[reference-c2x-vendas-model]].
export async function loadC2xVendasPorImobiliaria(
  limit = 12,
): Promise<C2xImobiliariaVendas[]> {
  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return [];
  }

  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 30);

  try {
    const [rows] = await poolResult.pool.query<
      (RowDataPacket & { imobiliaria: string | null; unidades: number | string })[]
    >(
      `
      select coalesce(
               nullif(trim(imob.fantasy_name), ''),
               nullif(trim(imob.social_name), ''),
               nullif(trim(imob.name), ''),
               '(venda direta / sem imobiliária)'
             ) as imobiliaria,
             count(distinct ar.enterprise_unity_id) as unidades
      from acquisition_requests ar
      join enterprise_unities eu on eu.id = ar.enterprise_unity_id
      join enterprises e on e.id = eu.enterprise_id
      join users cli on cli.id = ar.client_id
      left join users imob on imob.id = cli.vinculed_by_id
      where ar.acquisition_request_stage_id = 4
        and e.code not in (${EXCLUDED_ENTERPRISE_CODES.map(() => "?").join(", ")})
      group by imobiliaria
      order by unidades desc
      limit ${safeLimit}
      `,
      [...EXCLUDED_ENTERPRISE_CODES],
    );

    return rows.map((row) => ({
      imobiliaria: row.imobiliaria ?? "-",
      unidades: Number(row.unidades),
    }));
  } catch (error) {
    console.error(
      "[guardian] loadC2xVendasPorImobiliaria failed",
      sanitizeHadesDbError(error),
    );

    return [];
  }
}

export type C2xUnidadeDetalhe = {
  empreendimento: string;
  quadraLote: string;
  area: number | null;
  valor: number | null;
  statusVenda: string; // sale_status da unidade (Disponível/Reservado/Em negociação/Vendido/Bloqueado)
  estagioAtual: string | null; // estágio da aquisição viva (Faturado/Em assinatura/...)
  comprador: string | null;
  corretor: string | null;
};

// Consulta PONTUAL de unidade(s) por empreendimento + quadra + lote. Traz status de venda,
// área, valor e o comprador/estágio da aquisição viva (ignora canceladas/distratos). quadra/
// lote aceitam com ou sem zero à esquerda e prefixo C. Ver [[reference-c2x-vendas-model]].
export async function loadC2xUnidade(filters: {
  empreendimento?: string | null;
  quadra?: string | null;
  lote?: string | null;
}): Promise<C2xUnidadeDetalhe[]> {
  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return [];
  }

  const emp = String(filters.empreendimento ?? "").trim();
  const quadra = String(filters.quadra ?? "").trim();
  const lote = String(filters.lote ?? "").trim();

  if (!emp || !lote) {
    return [];
  }

  const where: string[] = [
    `e.code not in (${EXCLUDED_ENTERPRISE_CODES.map(() => "?").join(", ")})`,
    "(upper(e.code) = upper(?) or e.name like ? or e.divulgation_name like ?)",
    "(eu.lot = ? or eu.lot = lpad(?, 2, '0'))",
  ];
  const params: unknown[] = [
    ...EXCLUDED_ENTERPRISE_CODES,
    emp,
    `%${emp}%`,
    `%${emp}%`,
    lote,
    lote,
  ];

  if (quadra) {
    where.push(
      "(eu.block = ? or eu.block = lpad(?, 2, '0') or upper(eu.block) = concat('C', lpad(?, 2, '0')) or upper(eu.block) = concat('C', upper(?)))",
    );
    params.push(quadra, quadra, quadra, quadra);
  }

  try {
    const [rows] = await poolResult.pool.query<
      (RowDataPacket & {
        emp_code: string | null;
        emp_name: string | null;
        block: string | null;
        lot: string | null;
        area: number | string | null;
        price: number | string | null;
        sale_status: string | null;
        estagio: string | null;
        comprador: string | null;
        corretor: string | null;
      })[]
    >(
      `
      select e.code as emp_code, e.name as emp_name, eu.block, eu.lot, eu.area, eu.price,
             ss.name as sale_status, s.name as estagio, cli.name as comprador, cor.name as corretor
      from enterprise_unities eu
      join enterprises e on e.id = eu.enterprise_id
      left join sale_statuses ss on ss.id = eu.sale_status_id
      left join acquisition_requests ar on ar.id = (
        select ar2.id from acquisition_requests ar2
        where ar2.enterprise_unity_id = eu.id
          and ar2.acquisition_request_stage_id not in (7, 8, 10, 11)
        order by field(ar2.acquisition_request_stage_id, 4, 6, 5, 3, 9, 2, 1) desc, ar2.id desc
        limit 1
      )
      left join acquisition_request_stages s on s.id = ar.acquisition_request_stage_id
      left join users cli on cli.id = ar.client_id
      left join users cor on cor.id = ar.corretor_id
      where ${where.join(" and ")}
      order by eu.block, eu.lot
      limit 20
      `,
      params,
    );

    return rows.map((row) => ({
      area: row.area == null ? null : Number(row.area),
      comprador: row.comprador,
      corretor: row.corretor,
      empreendimento: displayEnterprise(row.emp_code, row.emp_name),
      estagioAtual: row.estagio,
      quadraLote: `Q${row.block ?? "?"} L${row.lot ?? "?"}`,
      statusVenda: row.sale_status ?? "-",
      valor: row.price == null ? null : Number(row.price),
    }));
  } catch (error) {
    console.error("[guardian] loadC2xUnidade failed", sanitizeHadesDbError(error));

    return [];
  }
}

export type C2xClienteUnidade = {
  empreendimento: string;
  quadraLote: string;
  estagio: string | null;
  valor: number | null;
};

export type C2xClientePerfil = {
  idade: number | null;
  sexo: string | null;
  estadoCivil: string | null;
  escolaridade: string | null;
  renda: string | null;
  profissao: string | null;
  cidadeUf: string | null;
  email: string | null;
  telefone: string | null;
};

export type C2xClienteResumo = {
  nome: string;
  documento: string | null;
  // Imobiliária vinculada ao cliente/prospect (users.vinculed_by_id). TODO cliente/prospect
  // tem imobiliária cadastrada — NÃO depende de ter venda/unidade. (Decisão do Lucas 4/jul.)
  imobiliaria: string | null;
  perfil: C2xClientePerfil;
  unidades: C2xClienteUnidade[];
};

// Consulta PONTUAL de um cliente/prospect por nome ou CPF/CNPJ (modo admin, sem restrição de
// vínculo). Traz o CADASTRO completo da tabela users (idade, sexo, estado civil, escolaridade,
// renda, profissão, cidade, contato), a IMOBILIÁRIA vinculada (independe de venda) e as
// unidades vivas dele, se houver. Ver [[reference-c2x-vendas-model]].
export async function loadC2xClienteResumo(
  termo: string,
): Promise<C2xClienteResumo | null> {
  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return null;
  }

  const clean = String(termo ?? "").trim();
  const digits = clean.replace(/\D/g, "");

  if (!clean) {
    return null;
  }

  const cadastroSelect = `
    select u.id, u.name, u.cpf, u.cnpj, u.email, u.cellphone, u.phone,
           timestampdiff(year, u.birthday, curdate()) as idade,
           sx.name as sexo, cv.name as estado_civil, sal.name as renda,
           sch.name as escolaridade, prof.name as profissao,
           coalesce(nullif(trim(imob.fantasy_name), ''), nullif(trim(imob.social_name), ''),
                    nullif(trim(imob.name), '')) as imobiliaria,
           city.name as cidade, st.acronym as uf
    from users u
    left join users imob on imob.id = u.vinculed_by_id
    left join sexes sx on sx.id = u.sex_id
    left join civil_states cv on cv.id = u.civil_state_id
    left join salary_ranges sal on sal.id = u.salary_range_id
    left join schoolings sch on sch.id = u.schooling_id
    left join professions prof on prof.id = u.profession_id
    left join addresses addr on addr.id = (
      select a.id from addresses a
      where a.ownertable_type = 'User' and a.ownertable_id = u.id
      order by a.updated_at desc, a.id desc limit 1
    )
    left join cities city on city.id = addr.city_id
    left join states st on st.id = coalesce(addr.state_id, city.state_id)
  `;

  try {
    const [clientes] = await poolResult.pool.query<
      (RowDataPacket & {
        id: number;
        name: string | null;
        cpf: string | null;
        cnpj: string | null;
        email: string | null;
        cellphone: string | null;
        phone: string | null;
        idade: number | string | null;
        sexo: string | null;
        estado_civil: string | null;
        renda: string | null;
        escolaridade: string | null;
        profissao: string | null;
        imobiliaria: string | null;
        cidade: string | null;
        uf: string | null;
      })[]
    >(
      digits.length >= 11
        ? `${cadastroSelect}
             where replace(replace(replace(replace(coalesce(u.cpf, u.cnpj, ''), '.', ''), '-', ''), '/', ''), ' ', '') = ?
             limit 1`
        : `${cadastroSelect} where u.profile_id = 2 and u.name like ? order by u.name limit 1`,
      digits.length >= 11 ? [digits] : [`%${clean}%`],
    );

    const cliente = clientes[0];
    if (!cliente) {
      return null;
    }

    const [unidades] = await poolResult.pool.query<
      (RowDataPacket & {
        emp_code: string | null;
        emp_name: string | null;
        block: string | null;
        lot: string | null;
        price: number | string | null;
        estagio: string | null;
      })[]
    >(
      `
      select distinct e.code as emp_code, e.name as emp_name, eu.block, eu.lot, eu.price,
             s.name as estagio
      from acquisition_requests ar
      join enterprise_unities eu on eu.id = ar.enterprise_unity_id
      join enterprises e on e.id = eu.enterprise_id
      left join acquisition_request_stages s on s.id = ar.acquisition_request_stage_id
      where ar.client_id = ?
        and ar.acquisition_request_stage_id not in (7, 8, 10, 11)
        and e.code not in (${EXCLUDED_ENTERPRISE_CODES.map(() => "?").join(", ")})
      order by e.name, eu.block, eu.lot
      limit 50
      `,
      [cliente.id, ...EXCLUDED_ENTERPRISE_CODES],
    );

    const cidadeUf = [cliente.cidade, cliente.uf].filter(Boolean).join("/") || null;

    return {
      documento: cliente.cpf ?? cliente.cnpj ?? null,
      imobiliaria: cliente.imobiliaria ?? null,
      nome: cliente.name ?? "-",
      perfil: {
        cidadeUf,
        email: cliente.email?.trim() || null,
        escolaridade: cliente.escolaridade ?? null,
        estadoCivil: cliente.estado_civil ?? null,
        idade: cliente.idade == null ? null : Number(cliente.idade),
        profissao: cliente.profissao ?? null,
        renda: cliente.renda ?? null,
        sexo: cliente.sexo ?? null,
        telefone: cliente.cellphone?.trim() || cliente.phone?.trim() || null,
      },
      unidades: unidades.map((row) => ({
        empreendimento: displayEnterprise(row.emp_code, row.emp_name),
        estagio: row.estagio,
        quadraLote: `Q${row.block ?? "?"} L${row.lot ?? "?"}`,
        valor: row.price == null ? null : Number(row.price),
      })),
    };
  } catch (error) {
    console.error(
      "[guardian] loadC2xClienteResumo failed",
      sanitizeHadesDbError(error),
    );

    return null;
  }
}

export type C2xVendasEmpreendimento = {
  empreendimento: string;
  total: number;
  vendidas: number;
  disponiveis: number;
};

// Snapshot da carteira por empreendimento (estado atual, sale_status da unidade), com as
// regras de consolidação/exclusão. "Vendido" = sale_status_id 4. Ver [[reference-c2x-vendas-model]].
export async function loadC2xVendasPorEmpreendimento(): Promise<
  C2xVendasEmpreendimento[]
> {
  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return [];
  }

  try {
    const [rows] = await poolResult.pool.query<
      (RowDataPacket & {
        code: string | null;
        name: string | null;
        total: number | string;
        vendidas: number | string;
        disponiveis: number | string;
      })[]
    >(
      `
      select e.code, e.name,
             count(*) as total,
             sum(eu.sale_status_id = 4) as vendidas,
             sum(eu.sale_status_id = 1) as disponiveis
      from enterprise_unities eu
      join enterprises e on e.id = eu.enterprise_id
      where e.code not in (${EXCLUDED_ENTERPRISE_CODES.map(() => "?").join(", ")})
      group by e.code, e.name
      `,
      [...EXCLUDED_ENTERPRISE_CODES],
    );

    // Consolida os que compartilham produto (Lavra do Ouro, Rio de Pedras, Portal, Lagoa Bonita).
    const byDisplay = new Map<string, C2xVendasEmpreendimento>();
    for (const row of rows) {
      const key = displayEnterprise(row.code, row.name);
      const current = byDisplay.get(key) ?? {
        disponiveis: 0,
        empreendimento: key,
        total: 0,
        vendidas: 0,
      };
      current.total += Number(row.total);
      current.vendidas += Number(row.vendidas);
      current.disponiveis += Number(row.disponiveis);
      byDisplay.set(key, current);
    }

    return Array.from(byDisplay.values()).sort(
      (first, second) => second.vendidas - first.vendidas,
    );
  } catch (error) {
    console.error(
      "[guardian] loadC2xVendasPorEmpreendimento failed",
      sanitizeHadesDbError(error),
    );

    return [];
  }
}
