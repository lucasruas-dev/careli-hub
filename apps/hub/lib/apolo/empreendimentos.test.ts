import { describe, expect, it } from "vitest";

import {
  buildApoloEnterprisesData,
  mapEnterpriseRow,
} from "./empreendimentos";

// Números REAIS do C2X, medidos em 18/08/2026 (scripts/apolo/medir-espelho-vale-do-ouro.mjs):
//   VLO 35  espelho          298 un · R$ 27.768.889,00
//   VOL 36  carteira do Lino 141 un · R$ 14.024.417,00
//   VOC 37  carteira Cecílio 157 un · R$ 13.744.472,00
//   VOR 41  "extras"           3 un · R$    604.900,00   (empreendimento de verdade)
//   resto do sistema        3.961 un · R$ 1.011.899.553,43
// Com o espelho:  4.560 un · R$ 1.068.042.231,43  ← o que a tela mostrava
// Sem o espelho:  4.262 un · R$ 1.040.273.342,43  ← o certo

type LinhaCrua = {
  code: string;
  id: number;
  name: string;
  units: number;
  value: number;
};

const C2X: LinhaCrua[] = [
  { code: "VLO", id: 35, name: "VALE DO OURO", units: 298, value: 27_768_889 },
  { code: "VOL", id: 36, name: "VALE DO OURO", units: 141, value: 14_024_417 },
  { code: "VOC", id: 37, name: "VALE DO OURO", units: 157, value: 13_744_472 },
  {
    code: "VOR",
    id: 41,
    name: "VALE DO OURO - EXTRAS",
    units: 3,
    value: 604_900,
  },
  // Todo o resto do C2X num pacote só: o que interessa aqui é o total geral fechar.
  {
    code: "JDG",
    id: 40,
    name: "JARDIM DAS GERAIS",
    units: 3_961,
    value: 1_011_899_553.43,
  },
];

// Uma linha do `select` de `loadApoloEnterprises`, reduzida ao que o teste usa. O cenário todo
// cai em "disponível" — a regra do espelho é sobre a SOMA, não sobre o balde.
function linhaDoBanco(linha: LinhaCrua) {
  return {
    bloqueado_units: 0,
    bloqueado_value: 0,
    city: "Bom Despacho",
    code: linha.code,
    disponivel_units: linha.units,
    disponivel_value: linha.value,
    id: linha.id,
    incorporador: null,
    name: linha.name,
    negociacao_units: 0,
    negociacao_value: 0,
    reservado_units: 0,
    reservado_value: 0,
    state: "MG",
    total_units: linha.units,
    total_value: linha.value,
    vendido_units: 0,
    vendido_value: 0,
  } as unknown as Parameters<typeof mapEnterpriseRow>[0];
}

const dados = buildApoloEnterprisesData(C2X.map(linhaDoBanco).map(mapEnterpriseRow));

describe("espelho do Vale do Ouro na tela de empreendimentos", () => {
  it("o total geral NÃO conta o espelho (4.262 un · R$ 1.040.273.342,43)", () => {
    expect(dados.totals.total.units).toBe(4_262);
    expect(dados.totals.total.value).toBeCloseTo(1_040_273_342.43, 2);
  });

  it("a diferença para o total antigo é EXATAMENTE o espelho", () => {
    const comEspelho = C2X.reduce(
      (acc, linha) => ({
        units: acc.units + linha.units,
        value: acc.value + linha.value,
      }),
      { units: 0, value: 0 },
    );

    expect(comEspelho.units).toBe(4_560);
    expect(comEspelho.value).toBeCloseTo(1_068_042_231.43, 2);
    expect(comEspelho.units - dados.totals.total.units).toBe(298);
    expect(comEspelho.value - dados.totals.total.value).toBeCloseTo(
      27_768_889,
      2,
    );
  });

  it("o balde também fica sem o espelho (a soma é por balde, não só no total)", () => {
    expect(dados.totals.disponivel.units).toBe(4_262);
    expect(dados.totals.disponivel.value).toBeCloseTo(1_040_273_342.43, 2);
  });

  it("🔴 a LINHA do espelho continua na listagem, marcada como histórica", () => {
    // Ela é o caminho para o masterplan do Vale do Ouro e para as CADs da esteira (todas no
    // enterprise_id 35). Tirar a linha resolveria o total e quebraria as duas coisas.
    const vlo = dados.rows.find((row) => row.code === "VLO");

    expect(vlo).toBeDefined();
    expect(vlo?.id).toBe("35");
    expect(vlo?.mirror).toBe(true);
    expect(vlo?.mirrorLabel).toContain("VOC + VOL");
    // O cenário dela continua completo: quem abre a ficha vê as 298 unidades.
    expect(vlo?.scenario.total.units).toBe(298);
  });

  it("as divisões vivas seguem normais e somáveis", () => {
    for (const code of ["VOC", "VOL", "VOR"]) {
      const row = dados.rows.find((entry) => entry.code === code);

      expect(row?.mirror).toBe(false);
      expect(row?.mirrorLabel).toBeNull();
    }
  });

  it("a soma das linhas somáveis bate com o total", () => {
    const soma = dados.rows
      .filter((row) => !row.mirror)
      .reduce(
        (acc, row) => ({
          units: acc.units + row.scenario.total.units,
          value: acc.value + row.scenario.total.value,
        }),
        { units: 0, value: 0 },
      );

    expect(soma.units).toBe(dados.totals.total.units);
    expect(soma.value).toBeCloseTo(dados.totals.total.value, 2);
  });
});
