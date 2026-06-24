import type { OperationsRiskLevel } from "./monitoring";

// Custo D-1 (trilho anti-Hermes). Vercel = custo de USO real via API oficial de
// billing (FOCUS); Supabase = estimativa pelo plano. Tudo best-effort: qualquer
// falha aqui NUNCA pode quebrar o snapshot de monitoring.

const VERCEL_BILLING_API = "https://api.vercel.com/v1/billing/charges";
const VERCEL_BILLING_TEAM_ID =
  process.env.VERCEL_BILLING_TEAM_ID?.trim() ||
  "team_0AsY43vvHN2fwEkcN8u5LKXX";
const VERCEL_MONTHLY_PLAN_USD = readNumberEnv("VERCEL_MONTHLY_PLAN_USD", 40);
const SUPABASE_MONTHLY_PLAN_USD = readNumberEnv("SUPABASE_MONTHLY_PLAN_USD", 25);
// Corte do ciclo de faturamento da Vercel (dia do mes). Confirmado no painel
// ("June 20 - July 20"). Configuravel por env caso a Vercel mude o corte.
const VERCEL_BILLING_CYCLE_DAY = readNumberEnv("VERCEL_BILLING_CYCLE_DAY", 20);

// Regua do custo diario VARIAVEL (USD/dia). Configuravel por env.
const DAILY_COST_MEDIO_USD = readNumberEnv("OPS_COST_DAILY_MEDIO_USD", 5);
const DAILY_COST_ALTO_USD = readNumberEnv("OPS_COST_DAILY_ALTO_USD", 15);
const DAILY_COST_CRITICO_USD = readNumberEnv("OPS_COST_DAILY_CRITICO_USD", 40);

// O dado de billing muda 1x/dia; cacheamos para nao chamar a Vercel a cada poll.
const COST_CACHE_TTL_MS = 30 * 60 * 1000;

export type OperationsCostServiceItem = {
  cost: number;
  service: string;
};

export type OperationsCostDailyPoint = {
  cost: number;
  day: string;
};

export type OperationsVercelCost = {
  configured: boolean;
  dailySeries: OperationsCostDailyPoint[];
  day: string | null;
  error?: string;
  monthAccumulated: number;
  monthProjection: number;
  monthlyFixedCost: number;
  risk: OperationsRiskLevel;
  topServices: OperationsCostServiceItem[];
  trend: "down" | "flat" | "up";
  typicalDailyCost: number;
  variableCost: number;
};

export type OperationsSupabaseCost = {
  estimateMonthlyCost: number;
  estimateDailyCost: number;
  monthAccumulated: number;
  note: string;
};

export type OperationsCostSnapshot = {
  currency: string;
  generatedAt: string;
  monthAccumulated: number;
  monthLabel: string;
  monthProjection: number;
  supabase: OperationsSupabaseCost;
  vercel: OperationsVercelCost;
};

let costCache: { at: number; value: OperationsCostSnapshot } | null = null;

export async function getOperationsCostSnapshot(): Promise<OperationsCostSnapshot> {
  if (costCache && Date.now() - costCache.at < COST_CACHE_TTL_MS) {
    return costCache.value;
  }

  const cycle = getCycleContext();
  const vercel = await getVercelCost(cycle);
  const supabase = getSupabaseEstimate(cycle);

  const value: OperationsCostSnapshot = {
    currency: "USD",
    generatedAt: new Date().toISOString(),
    // Acumulado do CICLO (destaque) + expectativa final (projecao ate o fim do ciclo),
    // somando Vercel (fatura real) + Supabase (estimativa por plano).
    monthAccumulated: round2(vercel.monthAccumulated + supabase.monthAccumulated),
    monthLabel: cycle.label,
    monthProjection: round2(vercel.monthProjection + supabase.estimateMonthlyCost),
    supabase,
    vercel,
  };

  costCache = { at: Date.now(), value };
  return value;
}

export type OperationsCostHistory = {
  configured: boolean;
  days: OperationsCostDailyPoint[];
  error?: string;
  from: string;
  to: string;
  total: number;
};

// Historico por periodo (popup com filtro). On-demand, sem cache. Soma BilledCost
// (fatura real) por dia no intervalo [from, to] (inclusivo, datas "YYYY-MM-DD").
export async function getVercelCostHistory(
  fromKey: string,
  toKey: string,
): Promise<OperationsCostHistory> {
  const token = process.env.VERCEL_API_TOKEN?.trim();
  const base: OperationsCostHistory = {
    configured: Boolean(token),
    days: [],
    from: fromKey,
    to: toKey,
    total: 0,
  };

  if (!token || !/^\d{4}-\d{2}-\d{2}$/.test(fromKey) || !/^\d{4}-\d{2}-\d{2}$/.test(toKey)) {
    return base;
  }

  try {
    const from = new Date(
      Date.parse(`${fromKey}T00:00:00Z`) - 2 * 86400000,
    ).toISOString();
    const to = new Date(
      Date.parse(`${toKey}T00:00:00Z`) + 86400000,
    ).toISOString();
    const url = `${VERCEL_BILLING_API}?teamId=${encodeURIComponent(
      VERCEL_BILLING_TEAM_ID,
    )}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      return { ...base, error: `HTTP ${response.status}` };
    }

    const billedByDay = new Map<string, number>();
    for (const line of (await response.text()).split("\n")) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      const row = safeParse(trimmed);
      const day = row ? String(row.ChargePeriodStart ?? "").slice(0, 10) : "";

      if (!day || day < fromKey || day > toKey) {
        continue;
      }

      billedByDay.set(
        day,
        (billedByDay.get(day) ?? 0) + (Number(row?.BilledCost) || 0),
      );
    }

    const days = [...billedByDay.keys()]
      .sort()
      .map((day) => ({ cost: round2(billedByDay.get(day) ?? 0), day }));

    return {
      ...base,
      days,
      total: round2(days.reduce((total, item) => total + item.cost, 0)),
    };
  } catch (error: unknown) {
    return {
      ...base,
      error:
        error instanceof Error ? error.message : "falha ao ler historico Vercel",
    };
  }
}

type CycleContext = {
  daysElapsed: number;
  daysInCycle: number;
  label: string;
  startKey: string;
  startMs: number;
  todayKey: string;
};

// Ciclo de faturamento da Vercel (corte no dia VERCEL_BILLING_CYCLE_DAY). A fatura e
// por ciclo (ex.: 20/06 a 20/07), NAO por mes-calendario — por isso o acumulado e a
// projecao seguem o ciclo.
function getCycleContext(): CycleContext {
  const todayKey = pacificDateKey(new Date()); // "YYYY-MM-DD"
  const year = Number(todayKey.slice(0, 4));
  const monthIndex = Number(todayKey.slice(5, 7)); // 1-based
  const dayOfMonth = Number(todayKey.slice(8));
  const cycleDay = Math.min(
    Math.max(Math.round(VERCEL_BILLING_CYCLE_DAY), 1),
    28,
  );

  let startYear = year;
  let startMonth = monthIndex;
  if (dayOfMonth < cycleDay) {
    startMonth -= 1;
    if (startMonth < 1) {
      startMonth = 12;
      startYear -= 1;
    }
  }

  let endYear = startYear;
  let endMonth = startMonth + 1;
  if (endMonth > 12) {
    endMonth = 1;
    endYear += 1;
  }

  const startKey = `${pad(startYear, 4)}-${pad(startMonth, 2)}-${pad(cycleDay, 2)}`;
  const endKey = `${pad(endYear, 4)}-${pad(endMonth, 2)}-${pad(cycleDay, 2)}`;
  const startMs = Date.parse(`${startKey}T00:00:00Z`);
  const endMs = Date.parse(`${endKey}T00:00:00Z`);
  const todayMs = Date.parse(`${todayKey}T00:00:00Z`);
  const daysInCycle = Math.max(Math.round((endMs - startMs) / 86400000), 1);
  const daysElapsed = Math.min(
    Math.max(Math.round((todayMs - startMs) / 86400000), 1),
    daysInCycle,
  );

  return {
    daysElapsed,
    daysInCycle,
    label: `${pad(cycleDay, 2)}/${pad(startMonth, 2)}/${pad(startYear % 100, 2)} – ${pad(cycleDay, 2)}/${pad(endMonth, 2)}/${pad(endYear % 100, 2)}`,
    startKey,
    startMs,
    todayKey,
  };
}

function pad(value: number, size: number) {
  return String(value).padStart(size, "0");
}

async function getVercelCost(
  cycle: CycleContext,
): Promise<OperationsVercelCost> {
  const token = process.env.VERCEL_API_TOKEN?.trim();

  const base: OperationsVercelCost = {
    configured: Boolean(token),
    dailySeries: [],
    day: null,
    monthAccumulated: round2(
      (VERCEL_MONTHLY_PLAN_USD * cycle.daysElapsed) / cycle.daysInCycle,
    ),
    monthProjection: VERCEL_MONTHLY_PLAN_USD,
    monthlyFixedCost: VERCEL_MONTHLY_PLAN_USD,
    risk: "baixo",
    topServices: [],
    trend: "flat",
    typicalDailyCost: 0,
    variableCost: 0,
  };

  if (!token) {
    return base;
  }

  try {
    const today = utcMidnight(new Date());
    // Janela = inicio do CICLO atual (com buffer) ate hoje, mais ~14 dias antes do
    // corte para o grafico mostrar o fim do ciclo anterior (historico do pico).
    const from = new Date(cycle.startMs - 16 * 86400000).toISOString();
    const to = today.toISOString();
    const url = `${VERCEL_BILLING_API}?teamId=${encodeURIComponent(
      VERCEL_BILLING_TEAM_ID,
    )}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      return { ...base, error: `HTTP ${response.status}` };
    }

    const text = await response.text();
    const rows = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => safeParse(line))
      .filter((row): row is BillingCharge => row !== null);

    // Separa ASSINATURA (plano fixo: ServiceCategory "Subscription Licenses") do USO
    // variavel. So o uso variavel e o trilho anti-abuso (dispara em pico). EffectiveCost
    // = custo de uso real, antes do credito incluido (BilledCost fica ~0 ate estourar).
    const variableByDay = new Map<string, number>();
    const fixedByDay = new Map<string, number>();
    const billedByDay = new Map<string, number>();
    const variableServiceByDay = new Map<string, Map<string, number>>();

    for (const row of rows) {
      const day = String(row.ChargePeriodStart ?? "").slice(0, 10);

      if (!day) {
        continue;
      }

      // BilledCost = valor REAL faturado (base da invoice) — todos os servicos. E o
      // numero do acumulado e da projecao (a fatura que o time paga de fato).
      billedByDay.set(
        day,
        (billedByDay.get(day) ?? 0) + (Number(row.BilledCost) || 0),
      );

      const cost = Number(row.EffectiveCost) || 0;

      if (row.ServiceCategory === "Subscription Licenses") {
        fixedByDay.set(day, (fixedByDay.get(day) ?? 0) + cost);
        continue;
      }

      variableByDay.set(day, (variableByDay.get(day) ?? 0) + cost);

      const serviceMap = variableServiceByDay.get(day) ?? new Map<string, number>();
      const service = String(row.ServiceName ?? "Outros");
      serviceMap.set(service, (serviceMap.get(service) ?? 0) + cost);
      variableServiceByDay.set(day, serviceMap);
    }

    // O billing da Vercel atrasa ~1-2 dias: "ontem" pode ainda nao estar fechado.
    // Por isso usamos o DIA MAIS RECENTE COM DADOS (anterior a hoje), nao a data fixa.
    const todayKey = pacificDateKey(new Date());
    const availableDays = [
      ...new Set([
        ...variableByDay.keys(),
        ...fixedByDay.keys(),
        ...billedByDay.keys(),
      ]),
    ]
      .filter((day) => day < todayKey)
      .sort();
    const d1 = availableDays.length
      ? availableDays[availableDays.length - 1]!
      : null;
    const variableCost = d1 ? round2(variableByDay.get(d1) ?? 0) : 0;

    // Baseline "tipico" = MEDIANA do uso variavel dos dias com dados (robusto a picos
    // como os de 16-18/jun, que a media distorceria).
    const typicalDailyCost = round2(
      median(availableDays.map((day) => variableByDay.get(day) ?? 0)),
    );

    // Serie diaria do CUSTO real faturado (mini grafico) — ultimos (ate) 14 dias, p/
    // o pico aparecer junto com a normalizacao recente.
    const billedDaily = d1 ? round2(billedByDay.get(d1) ?? 0) : 0;
    const dailySeries = availableDays.slice(-14).map((day) => ({
      cost: round2(billedByDay.get(day) ?? 0),
      day,
    }));

    // Plano fixo REAL: assinatura/dia do D-1 projetada no mes (fallback no config).
    const fixedDaily = d1 ? (fixedByDay.get(d1) ?? 0) : 0;
    const monthlyFixedCost =
      fixedDaily > 0 ? round2(fixedDaily * 30.4) : VERCEL_MONTHLY_PLAN_USD;

    const topServices = d1
      ? [...(variableServiceByDay.get(d1) ?? new Map<string, number>()).entries()]
          .map(([service, cost]) => ({ cost: round2(cost), service }))
          .filter((item) => item.cost > 0)
          .sort((first, second) => second.cost - first.cost)
          .slice(0, 4)
      : [];

    // Acumulado do CICLO = soma do BilledCost (fatura real) dos dias do ciclo atual.
    // Projecao = max(plano, acumulado + ritmo do CICLO * dias que faltam). O ritmo usa
    // SO os dias do ciclo (nao cruza o corte, p/ nao herdar o pico do ciclo anterior);
    // e nunca abaixo do plano fixo (a fatura minima do ciclo).
    const cycleDays = availableDays.filter((day) => day >= cycle.startKey);
    const monthAccumulated = round2(
      cycleDays.reduce((total, day) => total + (billedByDay.get(day) ?? 0), 0),
    );
    const lastCycleDayMs = cycleDays.length
      ? Date.parse(`${cycleDays[cycleDays.length - 1]!}T00:00:00Z`)
      : cycle.startMs;
    const daysCovered = Math.max(
      Math.round((lastCycleDayMs - cycle.startMs) / 86400000) + 1,
      0,
    );
    const daysRemaining = Math.max(cycle.daysInCycle - daysCovered, 0);
    const cycleDailyRate = median(
      cycleDays.map((day) => billedByDay.get(day) ?? 0),
    );
    const monthProjection = round2(
      Math.max(
        VERCEL_MONTHLY_PLAN_USD,
        monthAccumulated + cycleDailyRate * daysRemaining,
      ),
    );

    return {
      ...base,
      dailySeries,
      day: d1,
      monthAccumulated,
      monthProjection,
      monthlyFixedCost,
      risk: costToRisk(billedDaily),
      topServices,
      trend: getTrend(variableCost, typicalDailyCost),
      typicalDailyCost,
      variableCost,
    };
  } catch (error: unknown) {
    return {
      ...base,
      error: error instanceof Error ? error.message : "falha ao ler custo Vercel",
    };
  }
}

function getSupabaseEstimate(cycle: CycleContext): OperationsSupabaseCost {
  // Custo do Supabase e dominado pelo plano fixo (Pro). O uso variavel costuma
  // ficar dentro da franquia. Estimativa configuravel por env, proporcional ao ciclo.
  return {
    estimateDailyCost: round2(SUPABASE_MONTHLY_PLAN_USD / 30),
    estimateMonthlyCost: SUPABASE_MONTHLY_PLAN_USD,
    monthAccumulated: round2(
      (SUPABASE_MONTHLY_PLAN_USD * cycle.daysElapsed) / cycle.daysInCycle,
    ),
    note: "Estimativa pelo plano (uso dentro da franquia).",
  };
}

type BillingCharge = {
  BilledCost?: number | string;
  ChargePeriodStart?: string;
  EffectiveCost?: number | string;
  ServiceCategory?: string;
  ServiceName?: string;
};

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function safeParse(line: string): BillingCharge | null {
  try {
    return JSON.parse(line) as BillingCharge;
  } catch {
    return null;
  }
}

function costToRisk(dailyCost: number): OperationsRiskLevel {
  if (dailyCost >= DAILY_COST_CRITICO_USD) {
    return "critico";
  }

  if (dailyCost >= DAILY_COST_ALTO_USD) {
    return "alto";
  }

  if (dailyCost >= DAILY_COST_MEDIO_USD) {
    return "medio";
  }

  return "baixo";
}

function getTrend(value: number, average: number): "down" | "flat" | "up" {
  if (average <= 0) {
    return value > 0 ? "up" : "flat";
  }

  if (value > average * 1.2) {
    return "up";
  }

  if (value < average * 0.8) {
    return "down";
  }

  return "flat";
}

function utcMidnight(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

// A Vercel agrega o billing por dia do fuso Pacifico (America/Los_Angeles).
const pacificDateFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Los_Angeles",
  year: "numeric",
});

function pacificDateKey(date: Date) {
  return pacificDateFormatter.format(date);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function readNumberEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
