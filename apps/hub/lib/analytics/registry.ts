import {
  type C2xPeriodo,
  resolvePeriodoRange,
} from "@/lib/guardian/c2x-analytics";

// SUPER MOTOR do Panteon — CATÁLOGO (whitelist) do cubo de análise da CACÁ (modo admin).
// Modelo: { modulo, metrica, agrupar_por?, filtros{}, periodo? }. O motor monta a consulta
// SEGURA só a partir do que está declarado aqui — NUNCA SQL livre. As regras de negócio
// validadas (exclusões, consolidação, imobiliária = vínculo do cliente) vivem nos builders.
// Staged: começa pelo C2X; Iris/Hermes/Hades entram como novos módulos deste catálogo.
// Ver [[reference-panteon-super-motor]] e docs/operations/caca-super-motor-handoff-startup-2026-07-04.md.

export type PanteonModulo = "c2x";

export type C2xMetrica =
  | "propostas"
  | "vendas"
  | "faturamentos"
  | "cancelamentos"
  | "reservas"
  | "clientes_faturados"
  | "valor_faturado"
  | "unidades_vendidas"
  | "unidades_disponiveis"
  | "unidades_total"
  | "unidades_faturadas"
  | "valor_carteira_vendida";

export type C2xAgruparPor =
  | "empreendimento"
  | "imobiliaria"
  | "cliente"
  | "estagio"
  | "dia"
  | "semana"
  | "mes";

export type C2xFiltroKey = "empreendimento" | "imobiliaria" | "cliente";

export type PanteonFiltros = Partial<Record<C2xFiltroKey, string>>;

export type PanteonQueryInput = {
  modulo: PanteonModulo;
  metrica: C2xMetrica;
  agrupar_por?: C2xAgruparPor | null;
  filtros?: PanteonFiltros | null;
  periodo?: C2xPeriodo | null;
  // Janela custom (sobrepõe `periodo`): dias no fuso de São Paulo, fim INCLUSIVO.
  data_inicio?: string | null; // YYYY-MM-DD
  data_fim?: string | null; // YYYY-MM-DD
};

export type C2xMetricaSpec = {
  titulo: string;
  // evento = transições de estágio no período (acquisition_request_historics);
  // estado = fotografia atual (período não se aplica).
  kind: "evento" | "estado";
  formato: "int" | "brl";
  agrupaveis: readonly C2xAgruparPor[];
  filtraveis: readonly C2xFiltroKey[];
};

const DIMENSOES_EVENTO: readonly C2xAgruparPor[] = [
  "empreendimento",
  "imobiliaria",
  "cliente",
  "dia",
  "semana",
  "mes",
];

const FILTROS_PADRAO: readonly C2xFiltroKey[] = [
  "empreendimento",
  "imobiliaria",
  "cliente",
];

export const C2X_METRICAS: Record<C2xMetrica, C2xMetricaSpec> = {
  cancelamentos: {
    agrupaveis: [...DIMENSOES_EVENTO, "estagio"],
    filtraveis: FILTROS_PADRAO,
    formato: "int",
    kind: "evento",
    titulo: "Cancelamentos (cancelado + em distrato + distratado)",
  },
  clientes_faturados: {
    agrupaveis: ["empreendimento", "imobiliaria", "dia", "semana", "mes"],
    filtraveis: FILTROS_PADRAO,
    formato: "int",
    kind: "evento",
    titulo: "Clientes distintos com venda faturada",
  },
  faturamentos: {
    agrupaveis: DIMENSOES_EVENTO,
    filtraveis: FILTROS_PADRAO,
    formato: "int",
    kind: "evento",
    titulo: "Vendas fechadas (faturado)",
  },
  propostas: {
    agrupaveis: DIMENSOES_EVENTO,
    filtraveis: FILTROS_PADRAO,
    formato: "int",
    kind: "evento",
    titulo: "Propostas geradas",
  },
  reservas: {
    agrupaveis: DIMENSOES_EVENTO,
    filtraveis: FILTROS_PADRAO,
    formato: "int",
    kind: "evento",
    titulo: "Reservas feitas",
  },
  unidades_disponiveis: {
    agrupaveis: ["empreendimento"],
    filtraveis: ["empreendimento"],
    formato: "int",
    kind: "estado",
    titulo: "Unidades disponíveis (estado atual)",
  },
  unidades_faturadas: {
    agrupaveis: ["empreendimento", "imobiliaria", "cliente"],
    filtraveis: FILTROS_PADRAO,
    formato: "int",
    kind: "estado",
    titulo: "Unidades com venda faturada (estado atual)",
  },
  unidades_total: {
    agrupaveis: ["empreendimento"],
    filtraveis: ["empreendimento"],
    formato: "int",
    kind: "estado",
    titulo: "Total de unidades",
  },
  unidades_vendidas: {
    agrupaveis: ["empreendimento"],
    filtraveis: ["empreendimento"],
    formato: "int",
    kind: "estado",
    titulo: "Unidades vendidas (status oficial do painel)",
  },
  valor_carteira_vendida: {
    agrupaveis: ["empreendimento"],
    filtraveis: ["empreendimento"],
    formato: "brl",
    kind: "estado",
    titulo: "Valor da carteira vendida (estado atual)",
  },
  valor_faturado: {
    agrupaveis: DIMENSOES_EVENTO,
    filtraveis: FILTROS_PADRAO,
    formato: "brl",
    kind: "evento",
    titulo: "Valor faturado (soma dos lotes)",
  },
  vendas: {
    agrupaveis: [...DIMENSOES_EVENTO, "estagio"],
    filtraveis: FILTROS_PADRAO,
    formato: "int",
    kind: "evento",
    titulo: "Vendas (contrato gerado + em assinatura + faturado)",
  },
};

export const PANTEON_PERIODOS: readonly C2xPeriodo[] = [
  "hoje",
  "ontem",
  "esta_semana",
  "este_mes",
  "mes_passado",
  "este_ano",
  "ultimos_7_dias",
  "ultimos_30_dias",
  "desde_o_inicio",
];

export type PanteonRange = { from: Date; label: string; to: Date };

export type PanteonInputNormalizado = {
  metrica: C2xMetrica;
  spec: C2xMetricaSpec;
  agruparPor: C2xAgruparPor | null;
  filtros: PanteonFiltros;
  // null = métrica de estado (período não se aplica)
  range: PanteonRange | null;
  observacoes: string[];
};

export type PanteonValidation =
  | { ok: true; input: PanteonInputNormalizado }
  | { ok: false; erro: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function spDate(iso: string, plusDays = 0): Date {
  // Meia-noite de São Paulo (UTC-3 fixo) do dia pedido, deslocada em `plusDays`.
  const base = new Date(`${iso}T00:00:00-03:00`);

  return new Date(base.getTime() + plusDays * 24 * 60 * 60 * 1000);
}

// Valida e normaliza o pedido contra o catálogo. Qualquer coisa fora da whitelist volta como
// erro LEGÍVEL pra CACÁ se corrigir sozinha no próximo turno (não estoura exceção).
export function validatePanteonInput(raw: {
  modulo?: unknown;
  metrica?: unknown;
  agrupar_por?: unknown;
  filtros?: unknown;
  periodo?: unknown;
  data_inicio?: unknown;
  data_fim?: unknown;
}): PanteonValidation {
  if (raw.modulo !== "c2x") {
    return {
      erro: `Módulo inválido: ${String(raw.modulo)}. Disponível por enquanto: c2x.`,
      ok: false,
    };
  }

  const metrica = String(raw.metrica ?? "") as C2xMetrica;
  const spec = C2X_METRICAS[metrica];

  if (!spec) {
    return {
      erro: `Métrica inválida: ${String(raw.metrica)}. Disponíveis: ${Object.keys(C2X_METRICAS).join(", ")}.`,
      ok: false,
    };
  }

  const observacoes: string[] = [];

  let agruparPor: C2xAgruparPor | null = null;

  if (raw.agrupar_por != null && raw.agrupar_por !== "") {
    const candidate = String(raw.agrupar_por) as C2xAgruparPor;

    if (!spec.agrupaveis.includes(candidate)) {
      return {
        erro: `A métrica ${metrica} não agrupa por ${candidate}. Agrupamentos válidos: ${spec.agrupaveis.join(", ")}.`,
        ok: false,
      };
    }

    agruparPor = candidate;
  }

  const filtros: PanteonFiltros = {};

  if (raw.filtros && typeof raw.filtros === "object") {
    for (const [key, value] of Object.entries(
      raw.filtros as Record<string, unknown>,
    )) {
      const term = typeof value === "string" ? value.trim() : "";

      if (!term) {
        continue;
      }

      if (!spec.filtraveis.includes(key as C2xFiltroKey)) {
        return {
          erro: `A métrica ${metrica} não aceita o filtro ${key}. Filtros válidos: ${spec.filtraveis.join(", ") || "nenhum"}.`,
          ok: false,
        };
      }

      filtros[key as C2xFiltroKey] = term;
    }
  }

  let range: PanteonRange | null = null;

  if (spec.kind === "evento") {
    const dataInicio =
      typeof raw.data_inicio === "string" ? raw.data_inicio.trim() : "";
    const dataFim = typeof raw.data_fim === "string" ? raw.data_fim.trim() : "";

    if (dataInicio || dataFim) {
      if (dataInicio && !DATE_RE.test(dataInicio)) {
        return { erro: "data_inicio inválida — use YYYY-MM-DD.", ok: false };
      }

      if (dataFim && !DATE_RE.test(dataFim)) {
        return { erro: "data_fim inválida — use YYYY-MM-DD.", ok: false };
      }

      if (!dataInicio) {
        return {
          erro: "Pra usar janela custom, informe pelo menos data_inicio.",
          ok: false,
        };
      }

      const from = spDate(dataInicio);
      const to = dataFim ? spDate(dataFim, 1) : new Date();

      if (!(from.getTime() < to.getTime())) {
        return {
          erro: "Janela custom inválida: data_inicio precisa ser antes de data_fim.",
          ok: false,
        };
      }

      range = {
        from,
        label: dataFim ? `${dataInicio} a ${dataFim}` : `desde ${dataInicio}`,
        to,
      };
    } else {
      const periodo = raw.periodo != null ? String(raw.periodo) : "";

      if (periodo && !PANTEON_PERIODOS.includes(periodo as C2xPeriodo)) {
        return {
          erro: `Período inválido: ${periodo}. Válidos: ${PANTEON_PERIODOS.join(", ")} (ou data_inicio/data_fim).`,
          ok: false,
        };
      }

      if (!periodo) {
        observacoes.push("Período não informado — considerei ESTE MÊS.");
      }

      range = resolvePeriodoRange((periodo || "este_mes") as C2xPeriodo);
    }
  } else if (raw.periodo || raw.data_inicio || raw.data_fim) {
    observacoes.push(
      "Esta métrica é uma fotografia do ESTADO ATUAL — o período informado foi ignorado.",
    );
  }

  return {
    input: { agruparPor, filtros, metrica, observacoes, range, spec },
    ok: true,
  };
}
