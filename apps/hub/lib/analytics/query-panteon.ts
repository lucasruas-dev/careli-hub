import type { SupabaseClient } from "@supabase/supabase-js";
import type { RowDataPacket } from "mysql2/promise";

import { displayEnterprise } from "@/lib/guardian/c2x-analytics";
import { getHadesDbPool, sanitizeHadesDbError } from "@/lib/guardian/db";

import {
  buildC2xAnalyticsQuery,
  type C2xBuilderInput,
  isDistinctC2xMetrica,
} from "./c2x-builder";
import { type IrisBuilderInput, runIrisAnalyticsQuery } from "./iris-builder";
import {
  type C2xAgruparPor,
  type C2xMetrica,
  type IrisAgruparPor,
  type IrisMetrica,
  type PanteonInputNormalizado,
  validatePanteonInput,
} from "./registry";

// Dispatcher do SUPER MOTOR: valida o pedido contra o catálogo (registry), monta o SQL pelo
// builder da fonte e executa READ-ONLY. Devolve um resultado estruturado + formatador de
// texto pra tool consultar_panteon da CACÁ. Erro volta como mensagem legível (a CACÁ corrige
// o pedido no próximo turno), nunca como exceção pro loop do agente.

export type PanteonResultado = {
  titulo: string;
  periodoLabel: string | null;
  filtrosLabel: string | null;
  agruparPor: string | null;
  formato: "int" | "brl";
  grupos: { grupo: string; valor: number }[] | null;
  total: number;
  observacoes: string[];
};

export type PanteonQueryOutcome =
  | { ok: true; resultado: PanteonResultado }
  | { ok: false; erro: string };

type ValorRow = RowDataPacket & {
  valor: number | string | null;
  grupo?: string | number | null;
  grupo_code?: string | null;
  grupo_nome?: string | null;
};

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}

// yearweek(x, 3) devolve AAAASS (ex.: 202627) — vira "semana 27/2026".
function formatGrupoLabel(
  agruparPor: string | null,
  grupo: string | number | null | undefined,
): string {
  const raw = String(grupo ?? "-");

  if (agruparPor === "semana") {
    const match = /^(\d{4})(\d{2})$/.exec(raw);

    if (match) {
      return `semana ${Number(match[2])}/${match[1]}`;
    }
  }

  return raw;
}

// O motor da Iris precisa do Supabase client (service role do contexto da CACÁ). O C2X usa o
// pool MySQL do guardian e não depende do client.
export async function queryPanteon(
  raw: {
    modulo?: unknown;
    metrica?: unknown;
    agrupar_por?: unknown;
    filtros?: unknown;
    periodo?: unknown;
    data_inicio?: unknown;
    data_fim?: unknown;
  },
  deps?: { supabase?: SupabaseClient | null },
): Promise<PanteonQueryOutcome> {
  const validation = validatePanteonInput(raw);

  if (!validation.ok) {
    return { erro: validation.erro, ok: false };
  }

  const input = validation.input;

  try {
    const parcial =
      input.modulo === "iris"
        ? await runIrisModule(input, deps?.supabase ?? null)
        : await runC2xModule(input);

    if (!parcial.ok) {
      return parcial;
    }

    const filtrosLabel = Object.entries(input.filtros)
      .map(([key, value]) => `${key} ~ "${value}"`)
      .join(" · ");

    return {
      ok: true,
      resultado: {
        agruparPor: input.agruparPor,
        filtrosLabel: filtrosLabel || null,
        formato: input.spec.formato,
        grupos: parcial.grupos,
        observacoes: parcial.observacoes,
        periodoLabel: input.range?.label ?? null,
        titulo: input.spec.titulo,
        total: parcial.total,
      },
    };
  } catch (error) {
    console.error("[panteon] queryPanteon failed", sanitizeHadesDbError(error));

    return {
      erro: "Falha ao consultar agora. Tente novamente em instantes.",
      ok: false,
    };
  }
}

type ModuloParcial =
  | {
      ok: true;
      grupos: { grupo: string; valor: number }[] | null;
      total: number;
      observacoes: string[];
    }
  | { ok: false; erro: string };

async function runC2xModule(
  input: PanteonInputNormalizado,
): Promise<ModuloParcial> {
  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return {
      erro: "Banco do C2X indisponível agora — não consegui consultar.",
      ok: false,
    };
  }

  const builderInput: C2xBuilderInput = {
    agruparPor: input.agruparPor as C2xAgruparPor | null,
    filtros: input.filtros,
    metrica: input.metrica as C2xMetrica,
    range: input.range,
  };

  const observacoes = [...input.observacoes];
  const plan = buildC2xAnalyticsQuery(builderInput);
  const [rows] = await poolResult.pool.query<ValorRow[]>(plan.sql, plan.params);

  let grupos: { grupo: string; valor: number }[] | null = null;
  let total = 0;

  if (plan.groupMode === "none") {
    total = toNumber(rows[0]?.valor);
  } else if (plan.groupMode === "empreendimento") {
    const byDisplay = new Map<string, number>();

    for (const row of rows) {
      const key = displayEnterprise(
        row.grupo_code ?? null,
        row.grupo_nome ?? null,
      );

      byDisplay.set(key, (byDisplay.get(key) ?? 0) + toNumber(row.valor));
    }

    grupos = Array.from(byDisplay.entries())
      .map(([grupo, valor]) => ({ grupo, valor }))
      .sort((first, second) => second.valor - first.valor);
    total = grupos.reduce((sum, entry) => sum + entry.valor, 0);
  } else {
    grupos = rows.map((row) => ({
      grupo: formatGrupoLabel(input.agruparPor, row.grupo),
      valor: toNumber(row.valor),
    }));
    total = grupos.reduce((sum, entry) => sum + entry.valor, 0);

    if (grupos.length >= 30 && input.agruparPor !== "dia") {
      observacoes.push("Mostrando os 30 primeiros grupos.");
    }
  }

  // Agregado DISTINCT agrupado: a soma dos grupos pode repetir quem aparece em mais de um
  // grupo (ex.: cliente com unidades em 2 empreendimentos). Busca o total exato à parte; só
  // avisa se a soma REALMENTE passar do total (por perfil/imobiliária não passa — 1 valor por
  // pessoa).
  if (input.agruparPor && isDistinctC2xMetrica(input.metrica as C2xMetrica)) {
    const somaDosGrupos = total;
    const totalPlan = buildC2xAnalyticsQuery({
      ...builderInput,
      agruparPor: null,
    });
    const [totalRows] = await poolResult.pool.query<ValorRow[]>(
      totalPlan.sql,
      totalPlan.params,
    );

    total = toNumber(totalRows[0]?.valor);

    if (somaDosGrupos > total) {
      observacoes.push(
        "O total é de pessoas DISTINTAS (sem repetição); a soma dos grupos é maior porque o mesmo cliente aparece em mais de um grupo.",
      );
    }
  }

  return { grupos, observacoes, ok: true, total };
}

async function runIrisModule(
  input: PanteonInputNormalizado,
  supabase: SupabaseClient | null,
): Promise<ModuloParcial> {
  if (!supabase) {
    return {
      erro: "Consulta da Iris indisponível neste contexto (sem conexão).",
      ok: false,
    };
  }

  const builderInput: IrisBuilderInput = {
    agruparPor: input.agruparPor as IrisAgruparPor | null,
    filtros: input.filtros,
    metrica: input.metrica as IrisMetrica,
    range: input.range,
  };

  const result = await runIrisAnalyticsQuery(supabase, builderInput);

  return {
    grupos: result.grupos,
    observacoes: [...input.observacoes, ...result.observacoes],
    ok: true,
    total: result.total,
  };
}

function formatValor(valor: number, formato: "int" | "brl"): string {
  if (formato === "brl") {
    return valor.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
  }

  return valor.toLocaleString("pt-BR");
}

// Texto pra CACÁ (retorno da tool): título + período + filtros + total + grupos + notas.
export function formatPanteonResultado(resultado: PanteonResultado): string {
  const cab = [
    resultado.titulo,
    resultado.periodoLabel ? `(${resultado.periodoLabel})` : null,
    resultado.filtrosLabel ? `[filtros: ${resultado.filtrosLabel}]` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const linhas = [cab, `Total: ${formatValor(resultado.total, resultado.formato)}`];

  if (resultado.grupos) {
    if (resultado.grupos.length === 0) {
      linhas.push("Nenhum grupo com resultado no recorte pedido.");
    } else {
      linhas.push(`Por ${resultado.agruparPor}:`);
      for (const entry of resultado.grupos) {
        linhas.push(
          `- ${entry.grupo}: ${formatValor(entry.valor, resultado.formato)}`,
        );
      }
    }
  }

  for (const nota of resultado.observacoes) {
    linhas.push(`Obs.: ${nota}`);
  }

  return linhas.join("\n");
}
