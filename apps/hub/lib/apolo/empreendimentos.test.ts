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

  // ⚠️ AQUI HAVIA O TESTE OPOSTO, e ele guardava uma decisão que o Lucas derrubou. Ele exigia que a
  // linha do VLO continuasse SOLTA na listagem, marcada como "histórica" — e era isso que produzia
  // DUAS linhas "Vale do Ouro" na tela, 302 e 298 unidades. Lucas, 14/09/2026: *"VLO é o pai, porque
  // tem dois vale do ouro, já expliquei isso para vc"* e, depois da primeira tentativa, *"ainda estou
  // vendo dois vale do ouro"*.
  //
  // O cadastro sempre concordou com ele: em `hercules_empreendimentos`, VLO tem `pai_id` nulo e VOC,
  // VOL e VOR apontam para ele. O pai não é histórico — ele é o conjunto.
  it("há UMA linha de Vale do Ouro, e ela é o pai", () => {
    const doVale = dados.rows.filter((row) => row.name === "Vale do Ouro");

    expect(doVale).toHaveLength(1);

    // ⚠️ E O ID É O DO PAI, não um id sintético. Clicar na linha abre a ficha do VLO, que é a casa
    // do masterplan, de TODAS as CADs da esteira (enterprise_id 35) e do eixo do painel do
    // coordenador. Um `group:Vale do Ouro` deixaria os três sem porta de entrada.
    const [vale] = doVale;

    expect(vale?.id).toBe("35");
    expect(vale?.code).toBe("VLO");
    expect(vale?.mirror).toBe(false);
    expect(vale?.mirrorLabel).toBeNull();

    // ⚠️ OS NÚMEROS SÃO A SOMA DOS FILHOS, e não os 298 do pai: os lotes são os MESMOS, e contar
    // os dois seria contar o loteamento duas vezes.
    expect(vale?.scenario.total.units).toBe(301);
    expect([...(vale?.stages ?? [])].map((stage) => stage.code).sort()).toEqual([
      "VOC",
      "VOL",
      "VOR",
    ]);
  });

  it("as divisões vivas seguem normais e somáveis, agora DENTRO da linha agrupada", () => {
    // ⚠️ AS TRÊS DEIXARAM DE SER LINHA DE PRIMEIRO NÍVEL em 08/09/2026, quando o Vale do Ouro
    // entrou em ENTERPRISE_GROUPS (Lucas: *"na tela da gurgel, vale do ouro está agrupado, no
    // apolo não"*). Elas viraram `stages` do produto consolidado — o mesmo lugar onde LBF/LBR/LBP
    // já viviam —, e é isto que faz a tela desenhar "(3 etapas)" com o chevron em vez de três
    // linhas de mesmo nome e mesma cidade.
    // ⚠️ PELO ID DO PAI, e não por `group:Vale do Ouro`: o registro do pai agora VESTE o grupo.
    const grupo = dados.rows.find((row) => row.id === "35");

    expect(grupo).toBeDefined();
    expect(grupo?.mirror).toBe(false);
    expect([...(grupo?.stages ?? [])].map((stage) => stage.code).sort()).toEqual([
      "VOC",
      "VOL",
      "VOR",
    ]);
    // 141 (VOL) + 157 (VOC) + 3 (VOR) = 301, contra as 298 do espelho.
    expect(grupo?.scenario.total.units).toBe(301);

    for (const code of ["VOC", "VOL", "VOR"]) {
      const stage = grupo?.stages.find((entry) => entry.code === code);

      expect(stage?.mirror).toBe(false);
      expect(stage?.mirrorLabel).toBeNull();
    }
  });

  // ⚠️ O MEDO QUE ESTE TESTE GUARDAVA ERA LEGÍTIMO, e a solução dele é que estava errada. Ele exigia
  // que o VLO ficasse como linha PRÓPRIA para não sumir da listagem — porque é por ele que se chega
  // ao masterplan (35) e às CADs da esteira. O preço disso eram duas linhas "Vale do Ouro" na tela.
  //
  // Agora o pai NÃO some E não duplica: ele VESTE a linha do grupo, com o próprio id. A porta
  // continua aberta, e ela é uma só.
  it("o pai continua alcançável — sem virar etapa e sem virar segunda linha", () => {
    const vale = dados.rows.find((row) => row.id === "35");

    // ⚠️ O PAI NÃO ENTRA EM `codes`: é por ele que a tela busca UNIDADES, e incluir o VLO traria as
    // mesmas 298 dos filhos de volta — a duplicidade voltaria por baixo, agora invisível.
    expect(vale?.codes).not.toContain("VLO");
    expect([...(vale?.stages ?? [])].map((s) => s.code)).not.toContain("VLO");

    // E não sobrou nenhuma linha solta do pai.
    expect(dados.rows.filter((row) => row.code === "VLO")).toHaveLength(1);
    expect(dados.rows.some((row) => row.id === "group:Vale do Ouro")).toBe(false);
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
