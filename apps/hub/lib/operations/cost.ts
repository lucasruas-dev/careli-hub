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
  note: string;
};

export type OperationsCostSnapshot = {
  currency: string;
  generatedAt: string;
  supabase: OperationsSupabaseCost;
  vercel: OperationsVercelCost;
};

let costCache: { at: number; value: OperationsCostSnapshot } | null = null;

export async function getOperationsCostSnapshot(): Promise<OperationsCostSnapshot> {
  if (costCache && Date.now() - costCache.at < COST_CACHE_TTL_MS) {
    return costCache.value;
  }

  const value: OperationsCostSnapshot = {
    currency: "USD",
    generatedAt: new Date().toISOString(),
    supabase: getSupabaseEstimate(),
    vercel: await getVercelCost(),
  };

  costCache = { at: Date.now(), value };
  return value;
}

async function getVercelCost(): Promise<OperationsVercelCost> {
  const token = process.env.VERCEL_API_TOKEN?.trim();

  const base: OperationsVercelCost = {
    configured: Boolean(token),
    dailySeries: [],
    day: null,
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
    const from = new Date(today.getTime() - 8 * 86400000).toISOString();
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
    const variableServiceByDay = new Map<string, Map<string, number>>();

    for (const row of rows) {
      const day = String(row.ChargePeriodStart ?? "").slice(0, 10);

      if (!day) {
        continue;
      }

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
      ...new Set([...variableByDay.keys(), ...fixedByDay.keys()]),
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

    // Serie diaria do uso variavel (mini grafico) — ultimos (ate) 8 dias com dados.
    const dailySeries = availableDays.slice(-8).map((day) => ({
      cost: round2(variableByDay.get(day) ?? 0),
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

    return {
      ...base,
      dailySeries,
      day: d1,
      monthlyFixedCost,
      risk: costToRisk(variableCost),
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

function getSupabaseEstimate(): OperationsSupabaseCost {
  // Custo do Supabase e dominado pelo plano fixo (Pro). O uso variavel costuma
  // ficar dentro da franquia. Estimativa configuravel por env.
  return {
    estimateDailyCost: round2(SUPABASE_MONTHLY_PLAN_USD / 30),
    estimateMonthlyCost: SUPABASE_MONTHLY_PLAN_USD,
    note: "Estimativa pelo plano (uso dentro da franquia).",
  };
}

type BillingCharge = {
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
