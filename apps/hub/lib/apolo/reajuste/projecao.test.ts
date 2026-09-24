import { describe, expect, it } from "vitest";

import {
  acumuladoDoUltimoAno,
  correcaoRepresada,
  mesTipico,
  projetarParcela,
} from "@/lib/apolo/reajuste/projecao";
import {
  acumulado,
  acumuladoEntre,
  indiceDoNome,
  mesAnterior,
  mesesEntre,
  type SerieMensal,
} from "@/lib/apolo/reajuste/serie-de-indice";

/** Série sintética: `meses` meses terminando em `ate`, todos com a mesma variação. */
function serieDe(ate: string, meses: number, variacao: number): SerieMensal {
  const serie: SerieMensal = new Map();
  let cursor = ate;
  for (let i = 0; i < meses; i += 1) {
    serie.set(cursor, variacao);
    cursor = mesAnterior(cursor);
  }
  return serie;
}

describe("mesAnterior e mesesEntre", () => {
  it("vira o ano para trás em janeiro", () => {
    expect(mesAnterior("202601")).toBe("202512");
    expect(mesAnterior("202603")).toBe("202602");
  });

  it("conta os dois extremos", () => {
    expect(mesesEntre("202601", "202601")).toBe(1);
    expect(mesesEntre("202601", "202612")).toBe(12);
    expect(mesesEntre("202501", "202612")).toBe(24);
  });
});

describe("acumulado", () => {
  it("COMPÕE, não soma: doze meses de 1% dão 12,68%, e não 12%", () => {
    const serie = serieDe("202612", 12, 1);
    expect(acumulado(serie, "202612", 12)).toBeCloseTo(12.6825, 3);
  });

  it("⚠️ devolve null se faltar UM mês da janela, em vez de pular e errar para menos", () => {
    const serie = serieDe("202612", 12, 1);
    serie.delete("202606");
    expect(acumulado(serie, "202612", 12)).toBeNull();
    // A janela que não passa pelo buraco continua valendo.
    expect(acumulado(serie, "202612", 6)).toBeCloseTo(6.152, 3);
  });

  it("janela de tamanho zero ou negativo é nula, não 0%", () => {
    const serie = serieDe("202612", 12, 1);
    expect(acumulado(serie, "202612", 0)).toBeNull();
    expect(acumulado(serie, "202612", -3)).toBeNull();
  });

  it("acumuladoEntre cobre os dois extremos", () => {
    const serie = serieDe("202612", 24, 1);
    expect(acumuladoEntre(serie, "202612", "202612")).toBeCloseTo(1, 6);
    expect(acumuladoEntre(serie, "202601", "202612")).toBeCloseTo(12.6825, 3);
    // Intervalo invertido não vale.
    expect(acumuladoEntre(serie, "202612", "202601")).toBeNull();
  });
});

describe("indiceDoNome", () => {
  it("reconhece a família, não a periodicidade, nas grafias do legado", () => {
    expect(indiceDoNome("IPCA ANUAL")).toBe("IPCA");
    expect(indiceDoNome("IPCA-MENSAL")).toBe("IPCA");
    expect(indiceDoNome("INCC-M")).toBe("INCC-M");
    expect(indiceDoNome("INCC")).toBe("INCC-M");
    expect(indiceDoNome("IGP-M ANUAL")).toBe("IGP-M");
  });

  it("aguenta acento e caixa do legado", () => {
    expect(indiceDoNome("ipca anual")).toBe("IPCA");
    expect(indiceDoNome("Índice IPCA")).toBe("IPCA");
  });

  it("⚠️ o que não dá para reconhecer vira null, e NUNCA um índice no chute", () => {
    expect(indiceDoNome("SEM CORREÇÃO")).toBeNull();
    expect(indiceDoNome("CUB/m²")).toBeNull();
    expect(indiceDoNome("")).toBeNull();
    expect(indiceDoNome(null)).toBeNull();
    expect(indiceDoNome("qualquer coisa")).toBeNull();
  });
});

describe("correcaoRepresada", () => {
  const serie = serieDe("202608", 120, 0.5);

  it("contrato em dia: zero, e não null", () => {
    expect(correcaoRepresada({ hoje: "202609", serie, ultimaCorrecaoEm: "202608" })).toBe(0);
  });

  it("⚠️ conta do mês SEGUINTE à última correção: o mês dela já entrou no degrau que a aplicou", () => {
    // Última correção em 06/2026, publicado até 08/2026 -> julho e agosto, dois meses de 0,5%.
    const r = correcaoRepresada({ hoje: "202609", serie, ultimaCorrecaoEm: "202606" });
    expect(r).toBeCloseTo(1.0025, 3);
  });

  it("três anos parados viram três anos de índice, que é o caso de LOS e LOU", () => {
    // De 09/2023 a 08/2026 são 36 meses de 0,5%.
    const r = correcaoRepresada({ hoje: "202609", serie, ultimaCorrecaoEm: "202308" });
    expect(r).toBeCloseTo(19.668, 2);
  });

  it("sem saber a última correção, devolve null: não é zero, é desconhecido", () => {
    expect(correcaoRepresada({ hoje: "202609", serie, ultimaCorrecaoEm: null })).toBeNull();
  });
});

describe("mesTipico", () => {
  const serie = serieDe("202608", 240, 0.5);

  it("a tendência devolve a média geométrica da janela", () => {
    expect(mesTipico(serie, "tendencia")).toBeCloseTo(0.5, 6);
  });

  it("⚠️ conservador e otimista abrem leque: cenário que não abre não é cenário", () => {
    const t = mesTipico(serie, "tendencia") ?? 0;
    const c = mesTipico(serie, "conservador") ?? 0;
    const o = mesTipico(serie, "otimista") ?? 0;
    expect(c).toBeGreaterThan(t);
    expect(o).toBeLessThan(t);
  });

  it("série curta cai para uma janela menor em vez de devolver null", () => {
    const curta = serieDe("202608", 14, 0.4);
    expect(mesTipico(curta, "conservador")).toBeCloseTo(0.4 * 1.25, 4);
  });

  it("série vazia é null", () => {
    expect(mesTipico(new Map())).toBeNull();
  });
});

describe("projetarParcela", () => {
  const serie = serieDe("202608", 240, 0.5);

  const base = {
    hoje: "202609",
    indice: "IPCA" as const,
    meses: 36,
    serie,
    ultimaCorrecaoEm: "202608",
    valorDeHoje: 1000,
  };

  it("contrato em dia: a primeira linha é o valor REAL, sem degrau de represado", () => {
    const p = projetarParcela(base);
    expect(p.represadoPct).toBe(0);
    expect(p.valorComRepresado).toBe(1000);
    expect(p.linhas[0]).toEqual({ competencia: "202609", origem: "real", valor: 1000 });
    expect(p.linhas.some((l) => l.origem === "represado")).toBe(false);
  });

  it("⚠️ o represado entra como linha PRÓPRIA, separada do projetado", () => {
    const p = projetarParcela({ ...base, ultimaCorrecaoEm: "202308" });
    expect(p.represadoPct).toBeCloseTo(19.668, 2);

    const doRepresado = p.linhas.filter((l) => l.origem === "represado");
    expect(doRepresado).toHaveLength(1);
    expect(doRepresado[0]?.valor).toBeCloseTo(1196.68, 1);

    // E o projetado parte DE CIMA do represado, nunca do valor de hoje.
    const primeiroProjetado = p.linhas.find((l) => l.origem === "projetado");
    expect(primeiroProjetado?.valor ?? 0).toBeGreaterThan(1196.68);
  });

  it("⚠️ sobe em DEGRAU anual, e não em rampa mensal", () => {
    const p = projetarParcela(base);
    const projetadas = p.linhas.filter((l) => l.origem === "projetado");
    // 36 meses com degrau anual = 3 degraus, não 36.
    expect(projetadas).toHaveLength(3);
    expect(projetadas.map((l) => l.competencia)).toEqual(["202709", "202809", "202909"]);
  });

  it("cada degrau é o mês típico composto por 12 meses", () => {
    const p = projetarParcela(base);
    const primeiro = p.linhas.find((l) => l.origem === "projetado");
    // 1,005^12 = 1,0617
    expect(primeiro?.valor ?? 0).toBeCloseTo(1061.68, 1);
  });

  it("periodicidade diferente muda o passo do degrau", () => {
    const p = projetarParcela({ ...base, meses: 24, periodicidadeEmMeses: 6 });
    const projetadas = p.linhas.filter((l) => l.origem === "projetado");
    expect(projetadas).toHaveLength(4);
  });

  it("⚠️ sem índice reconhecido, DIZ o motivo em vez de devolver tabela vazia", () => {
    const p = projetarParcela({ ...base, indice: null });
    expect(p.linhas).toHaveLength(0);
    expect(p.motivo).toContain("índice de correção reconhecido");
  });

  it("sem série, diz o motivo e nomeia o índice que falta", () => {
    const p = projetarParcela({ ...base, serie: new Map() });
    expect(p.motivo).toContain("IPCA");
  });

  it("sem mensalidade vigente, diz o motivo", () => {
    const p = projetarParcela({ ...base, valorDeHoje: 0 });
    expect(p.motivo).toContain("mensalidade vigente");
  });

  it("⚠️ última correção desconhecida NÃO vira represado zero calado: projeta, mas sem degrau", () => {
    const p = projetarParcela({ ...base, ultimaCorrecaoEm: null });
    expect(p.represadoPct).toBe(0);
    expect(p.linhas.some((l) => l.origem === "represado")).toBe(false);
    // E continua projetando o futuro, que independe de saber a última correção.
    expect(p.linhas.filter((l) => l.origem === "projetado").length).toBeGreaterThan(0);
  });

  it("carrega até onde o índice está publicado, para a tela poder dizer", () => {
    const p = projetarParcela(base);
    expect(p.indicePublicadoAte).toBe("202608");
  });
});

describe("acumuladoDoUltimoAno", () => {
  it("usa o último mês PUBLICADO, e não o mês corrente (a fonte atrasa um mês)", () => {
    const serie = serieDe("202608", 24, 0.5);
    expect(acumuladoDoUltimoAno(serie)).toBeCloseTo(6.1678, 3);
  });

  it("série vazia é null", () => {
    expect(acumuladoDoUltimoAno(new Map())).toBeNull();
  });
});
