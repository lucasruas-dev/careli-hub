import { describe, expect, it } from "vitest";

import { ENTERPRISES_DO_C2X_EM_25_09_2026 } from "@/lib/apolo/c2x-pelo-id.fixture";
import {
  ANALYTICS_EXCLUDED_ENTERPRISE_IDS,
  ENTERPRISE_GROUPS,
  ENTERPRISE_MIRRORS,
  ENTERPRISE_SUB_ALIASES,
} from "@/lib/guardian/c2x-analytics";

import { buildC2xAnalyticsQuery, type C2xBuilderInput } from "./c2x-builder";
import type { C2xMetrica } from "./registry";

// O BUILDER DO MOTOR DA CACÁ FILTRA O EMPREENDIMENTO PELO ID DO C2X (PAN-124, 25/09/2026).
//
// Até aqui a exclusão, a gleba chamada por apelido, o espelho e o grupo consolidado iam ao C2X pela
// SIGLA (`e.code in (...)`). A sigla muda quando alguém renomeia no legado: o 43 foi de RDV para PDI
// em 24/09/2026, e o 30 foi de LAG para ADT em 16/07, quando a exclusão pelo "LAG" parou de excluir
// quem devia. Estes testes prendem as duas metades da troca: o SQL não carrega mais sigla nenhuma
// nesses filtros, e os ids que ele carrega são, no retrato do C2X de 25/09/2026, exatamente os
// empreendimentos que as siglas de antes achavam (o resultado de hoje não muda).

const SIGLA_POR_ID = new Map(ENTERPRISES_DO_C2X_EM_25_09_2026.map((e) => [e.id, e.code]));

function plano(metrica: C2xMetrica, filtros: Record<string, string> = {}): ReturnType<
  typeof buildC2xAnalyticsQuery
> {
  const input: C2xBuilderInput = {
    agruparPor: null,
    filtros,
    metrica,
    range: { from: new Date("2026-01-01T03:00:00Z"), label: "2026", to: new Date("2027-01-01T03:00:00Z") },
  };
  return buildC2xAnalyticsQuery(input);
}

/** Os parâmetros do filtro de empreendimento no plano de `unidades_total` (base sem período). */
function paramsDoEmpreendimento(termo: string): unknown[] {
  // `unidades_total` monta `[...exclusão, ...filtro]`, sem status: o filtro é o que sobra.
  return plano("unidades_total", { empreendimento: termo }).params.slice(
    ANALYTICS_EXCLUDED_ENTERPRISE_IDS.length,
  );
}

/** Nenhuma comparação de sigla com `in`/`not in`/`=` fora do termo livre. */
const SIGLA_FILTRADA = /e\.code\s+(not\s+)?in\s*\(|e\.code\s*=\s*\?/i;

describe("a exclusão de toda conta é pelo id: SDT, LAB, TSC e o espelho VLO", () => {
  const metricas: C2xMetrica[] = [
    "vendas",
    "unidades_total",
    "unidades_vendidas",
    "unidades_faturadas",
    "inadimplentes",
    "valor_vencido",
  ];

  it.each(metricas)("%s: `e.id not in`, e nunca `e.code not in`", (metrica) => {
    const { params, sql } = plano(metrica);
    expect(sql).toContain(
      `e.id not in (${ANALYTICS_EXCLUDED_ENTERPRISE_IDS.map(() => "?").join(", ")})`,
    );
    expect(sql).not.toMatch(SIGLA_FILTRADA);
    // Os ids vão como parâmetro, na posição em que as siglas iam.
    for (const id of ANALYTICS_EXCLUDED_ENTERPRISE_IDS) expect(params).toContain(id);
    expect(params.some((p) => typeof p === "string" && /^[A-Z]{3}$/.test(p))).toBe(false);
  });

  it("os ids excluídos são, em 25/09/2026, as siglas que a lista antiga excluía e ainda casavam", () => {
    // "LAG" não casava com nada desde 16/07/2026 (o 30 virou ADT e depois ACT): fica de fora do id.
    expect(ANALYTICS_EXCLUDED_ENTERPRISE_IDS.map((id) => SIGLA_POR_ID.get(id)).sort()).toEqual([
      "LAB",
      "SDT",
      "TSC",
      "VLO",
    ]);
  });
});

describe("o filtro de empreendimento pelo id", () => {
  it("a gleba pelo apelido vai por `e.id = ?` com o id dela (raposo = LBR = 27)", () => {
    const { sql } = plano("unidades_total", { empreendimento: "Raposo" });
    expect(sql).toContain("e.id = ?");
    expect(sql).not.toMatch(SIGLA_FILTRADA);
    expect(paramsDoEmpreendimento("Raposo")).toEqual([27]);
    expect(paramsDoEmpreendimento("lbf")).toEqual([33]);
    expect(paramsDoEmpreendimento("paulo")).toEqual([32]);
  });

  it("o ESPELHO pedido pela sigla responde pelas divisões vivas, pelos ids (VLO = 37, 36, 41)", () => {
    const { sql } = plano("unidades_total", { empreendimento: "VLO" });
    expect(sql).toContain("e.id in (?, ?, ?)");
    expect(sql).not.toMatch(SIGLA_FILTRADA);
    expect(paramsDoEmpreendimento("VLO")).toEqual([37, 36, 41]);
  });

  it("o grupo consolidado vai pelos ids das divisões, na mesma ordem das siglas de antes", () => {
    expect(paramsDoEmpreendimento("Lavra do Ouro")).toEqual([4, 1]);
    expect(paramsDoEmpreendimento("Rio de Pedras")).toEqual([13, 15, 14]);
    expect(paramsDoEmpreendimento("Portal dos Vales")).toEqual([7, 10]);
    // Termo parcial (4+ letras) continua casando o grupo.
    expect(paramsDoEmpreendimento("lagoa")).toEqual([33, 27, 32]);
    expect(paramsDoEmpreendimento("Vale do Ouro")).toEqual([37, 36, 41]);
    expect(plano("faturamentos", { empreendimento: "Lavra do Ouro" }).sql).not.toMatch(
      SIGLA_FILTRADA,
    );
  });

  it("o termo livre continua pela sigla e pelo nome: é o que a pessoa DIGITOU", () => {
    const { sql } = plano("unidades_total", { empreendimento: "Garden" });
    expect(sql).toContain("(upper(e.code) = upper(?) or e.name like ? or e.divulgation_name like ?)");
    expect(paramsDoEmpreendimento("Garden")).toEqual(["Garden", "%Garden%", "%Garden%"]);
  });
});

describe("resultado idêntico ao de hoje, e imune a renome", () => {
  it("cada id que o builder manda é, no C2X de 25/09/2026, a sigla que ele mandava antes", () => {
    for (const grupo of ENTERPRISE_GROUPS) {
      expect(paramsDoEmpreendimento(grupo.display).map((id) => SIGLA_POR_ID.get(Number(id)))).toEqual(
        grupo.codes,
      );
    }
    for (const espelho of ENTERPRISE_MIRRORS) {
      expect(paramsDoEmpreendimento(espelho.code).map((id) => SIGLA_POR_ID.get(Number(id)))).toEqual(
        espelho.divisions,
      );
    }
    for (const sub of ENTERPRISE_SUB_ALIASES) {
      expect(SIGLA_POR_ID.get(Number(paramsDoEmpreendimento(sub.alias)[0]))).toBe(sub.code);
    }
  });

  it("nenhum desses filtros carrega sigla: renomear no C2X não muda o que eles acham", () => {
    // Pela sigla, "Lavra do Ouro" mandava ["LOS", "LOU"]: renomear o LOS no C2X tirava metade do
    // loteamento da resposta da CACÁ, calado. Pelo id, o 4 continua sendo o 4.
    for (const termo of ["Lavra do Ouro", "Rio de Pedras", "lagoa", "VLO", "raposo", "Vale do Ouro"]) {
      const params = paramsDoEmpreendimento(termo);
      expect(params.length).toBeGreaterThan(0);
      expect(params.every((p) => typeof p === "number")).toBe(true);
    }
  });
});
