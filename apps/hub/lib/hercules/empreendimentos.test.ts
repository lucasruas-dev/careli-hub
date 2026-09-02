import { describe, expect, it } from "vitest";

import {
  arvoreDeEmpreendimentos,
  cardsConsolidados,
  type LinhaDeEmpreendimento,
  type UnidadeParaSomar,
} from "./empreendimentos";

const linha = (p: Partial<LinhaDeEmpreendimento> & { codigo: string; id: string }): LinhaDeEmpreendimento => ({
  c2xEnterpriseId: null,
  cidade: null,
  nome: p.codigo,
  ordem: 0,
  paiId: null,
  uf: null,
  vendendo: true,
  ...p,
});

// `noUncheckedIndexedAccess`: o primeiro da árvore pode não existir, e o teste diz isso em voz alta.
function primeiro<T>(lista: T[]): T {
  const item = lista[0];
  if (item === undefined) throw new Error("árvore vazia");
  return item;
}

const unidade = (p: Partial<UnidadeParaSomar> & { enterpriseId: string }): UnidadeParaSomar => ({
  precoTabela: 100,
  segmentoId: null,
  situacao: "disponivel",
  ...p,
});

describe("arvoreDeEmpreendimentos", () => {
  // O caso que o Lucas viu solto: VLO, VOC e VOL como três linhas. Agora é UM pai (o espelho VLO)
  // com três visões, e o total é o do espelho — sem somar as visões por cima.
  it("Vale do Ouro: as unidades são do pai (espelho) e as visões recortam por segmento", () => {
    const linhas = [
      linha({ c2xEnterpriseId: "35", codigo: "VLO", id: "pai", nome: "Vale do Ouro" }),
      linha({ c2xEnterpriseId: "37", codigo: "VOC", id: "voc", paiId: "pai" }),
      linha({ c2xEnterpriseId: "36", codigo: "VOL", id: "vol", paiId: "pai" }),
    ];
    const unidades = [
      unidade({ enterpriseId: "35", segmentoId: "voc", situacao: "vendida", precoTabela: 300 }),
      unidade({ enterpriseId: "35", segmentoId: "vol" }),
      unidade({ enterpriseId: "35", segmentoId: null, situacao: "bloqueada" }),
      // As cópias burocráticas do C2X (VOC 37, VOL 36) NÃO entram: seriam a mesma unidade de novo.
      unidade({ enterpriseId: "37" }),
      unidade({ enterpriseId: "36" }),
    ];

    const pai = primeiro(arvoreDeEmpreendimentos(linhas, unidades));

    expect(pai.codigo).toBe("VLO");
    expect(pai.cards.total).toEqual({ unidades: 3, valor: 500 });
    expect(pai.cards.vendida).toEqual({ unidades: 1, valor: 300 });
    expect(pai.visoes.map((v) => [v.codigo, v.cards.total.unidades])).toEqual([
      ["VOC", 1],
      ["VOL", 1],
    ]);
  });

  it("pai sem id do C2X (Lavra do Ouro): o conjunto é a união dos filhos, e cada visão é dona das suas", () => {
    const linhas = [
      linha({ codigo: "LOX", id: "pai", nome: "Lavra do Ouro", vendendo: false }),
      linha({ c2xEnterpriseId: "4", codigo: "LOS", id: "los", paiId: "pai" }),
      linha({ c2xEnterpriseId: "1", codigo: "LOU", id: "lou", paiId: "pai" }),
    ];
    const unidades = [
      unidade({ enterpriseId: "4" }),
      unidade({ enterpriseId: "4", situacao: "vendida" }),
      unidade({ enterpriseId: "1" }),
      unidade({ enterpriseId: "99" }), // de outro empreendimento: fora
    ];

    const pai = primeiro(arvoreDeEmpreendimentos(linhas, unidades));

    expect(pai.cards.total.unidades).toBe(3);
    expect(pai.visoes.map((v) => [v.codigo, v.cards.total.unidades])).toEqual([
      ["LOS", 2],
      ["LOU", 1],
    ]);
  });

  it("visão ainda não segmentada mostra ZERO, nunca o conjunto do pai", () => {
    const linhas = [
      linha({ c2xEnterpriseId: "31", codigo: "LAB", id: "pai" }),
      linha({ c2xEnterpriseId: "33", codigo: "LBF", id: "lbf", paiId: "pai" }),
    ];
    const unidades = [unidade({ enterpriseId: "31" }), unidade({ enterpriseId: "31" })];

    const pai = primeiro(arvoreDeEmpreendimentos(linhas, unidades));

    expect(pai.cards.total.unidades).toBe(2);
    expect(pai.visoes[0]?.cards.total.unidades).toBe(0);
  });

  it("quem está vendendo vem primeiro; depois ordem; depois nome", () => {
    const linhas = [
      linha({ codigo: "B", id: "b", nome: "Beta", ordem: 1, vendendo: false }),
      linha({ codigo: "A", id: "a", nome: "Alfa", ordem: 2, vendendo: false }),
      linha({ codigo: "Z", id: "z", nome: "Zeta", ordem: 9, vendendo: true }),
    ];

    expect(arvoreDeEmpreendimentos(linhas, []).map((p) => p.codigo)).toEqual(["Z", "B", "A"]);
  });

  it("os cards consolidados somam os pais, e só os pais", () => {
    const linhas = [
      linha({ c2xEnterpriseId: "35", codigo: "VLO", id: "vlo" }),
      linha({ c2xEnterpriseId: "37", codigo: "VOC", id: "voc", paiId: "vlo" }),
      linha({ c2xEnterpriseId: "39", codigo: "GDN", id: "gdn" }),
    ];
    const unidades = [
      unidade({ enterpriseId: "35", segmentoId: "voc", situacao: "reservada" }),
      unidade({ enterpriseId: "39", situacao: "bloqueada", precoTabela: 50 }),
      unidade({ enterpriseId: "39", situacao: "situacao-estranha" }),
    ];

    const total = cardsConsolidados(arvoreDeEmpreendimentos(linhas, unidades));

    expect(total.total).toEqual({ unidades: 3, valor: 250 });
    expect(total.reservada.unidades).toBe(1);
    expect(total.bloqueada).toEqual({ unidades: 1, valor: 50 });
  });
});
