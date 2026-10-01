import { describe, expect, it } from "vitest";

import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";
import { reguaDoCadastro } from "@/lib/hercules/regua-do-cadastro";

import { agrupar } from "./catalogo-empreendimentos";
import { agruparPeloCadastro, buildApoloEnterprisesData, mapEnterpriseRow } from "./empreendimentos";

// O CATÁLOGO E A LISTA DO APOLO PELO CADASTRO (PAN-124, F7). Linhas do C2X e cadastro de 01/10/2026.
// O que estes testes cobram:
//   1. os mesmos ids de entrada e os mesmos codes/stageIds como conjunto que a lista fixa dava;
//   2. o nome vem do cadastro; renomear o pai muda o nome e NÃO muda o id do grupo;
//   3. a lista do Apolo leva o panteonId, e o pai espelho (VLO 35) continua vestindo o grupo;
//   4. sem o cadastro, a regra de antes.

type Crua = [codigo: string, nome: string, c2x: null | string, pai: null | string, chave?: string, cidade?: string];

const CRUAS: Crua[] = [
  ["LAB", "Lagoa Bonita", "31", null, "Lagoa Bonita", "Governador Valadares"],
  ["LBF", "Lagoa Bonita · LBF", "33", "LAB"],
  ["LBP", "Lagoa Bonita · LBP", "32", "LAB"],
  ["LBR", "Lagoa Bonita · LBR", "27", "LAB"],
  ["VLO", "Vale do Ouro", "35", null, "Vale do Ouro", "Pará de Minas"],
  ["VOC", "Vale do Ouro · VOC", "37", "VLO"],
  ["VOL", "Vale do Ouro · VOL", "36", "VLO"],
  ["VOR", "Vale do Ouro · VOR", "41", "VLO"],
  ["RVP", "Villa Paris", "38", null, undefined, "João Monlevade"],
  ["GDN", "Garden", "39", null, undefined, "Pará de Minas"],
];

function cadastroDe(cruas: Crua[]): LinhaDoCadastro[] {
  return cruas.map(([codigo, nome, c2x, pai, chave, cidade], ordem) => ({
    c2xEnterpriseId: c2x,
    chaveDoGrupo: chave ?? null,
    cidade: cidade ?? null,
    codigo,
    id: `u-${codigo.toLowerCase()}`,
    nome,
    ordem,
    paiId: pai ? `u-${pai.toLowerCase()}` : null,
    uf: "MG",
    vendendo: true,
  }));
}

const CADASTRO = cadastroDe(CRUAS);

// O que o C2X devolve (sem 2, 31 e 34, que a consulta exclui), na ordem da sigla.
const DO_C2X = [
  { code: "GDN", id: 39, name: "GARDEN" },
  { code: "LBF", id: 33, name: "LAGOA BONITA" },
  { code: "LBP", id: 32, name: "LAGOA BONITA" },
  { code: "LBR", id: 27, name: "LAGOA BONITA" },
  { code: "RVP", id: 38, name: "RESIDENCIAL VILLA PARIS" },
  { code: "VLO", id: 35, name: "VALE DO OURO" },
  { code: "VOC", id: 37, name: "VALE DO OURO" },
  { code: "VOL", id: 36, name: "VALE DO OURO" },
  { code: "VOR", id: 41, name: "VALE DO OURO" },
];

describe("catálogo pelo cadastro", () => {
  const antigo = agrupar(DO_C2X);
  const novo = agrupar(DO_C2X, reguaDoCadastro(CADASTRO));

  it("os mesmos ids de entrada, e os mesmos codes e stageIds como conjunto", () => {
    expect(novo.map((e) => e.id).sort()).toEqual(antigo.map((e) => e.id).sort());
    for (const a of antigo) {
      const n = novo.find((e) => e.id === a.id)!;
      expect([...n.codes].sort()).toEqual([...a.codes].sort());
      expect([...n.stageIds].sort()).toEqual([...a.stageIds].sort());
    }
  });

  it("o VLO 35 continua simples ao lado do grupo Vale do Ouro", () => {
    expect(novo.find((e) => e.id === "35")?.codes).toEqual(["VLO"]);
    expect(novo.find((e) => e.id === "group:Vale do Ouro")?.stageIds).toEqual(["37", "36", "41"]);
  });

  it("a Lagoa Bonita sai na ordem do cadastro: LBF, LBP, LBR", () => {
    expect(novo.find((e) => e.id === "group:Lagoa Bonita")?.codes).toEqual(["LBF", "LBP", "LBR"]);
  });

  it("o nome vem do cadastro, em caixa alta", () => {
    expect(novo.find((e) => e.id === "38")?.name).toBe("VILLA PARIS");
    expect(novo.find((e) => e.id === "group:Lagoa Bonita")?.name).toBe("LAGOA BONITA");
  });

  it("renomear o pai muda o nome e NÃO muda o id do grupo (a chave da F4)", () => {
    const renomeado = cadastroDe(CRUAS.map((c) => (c[0] === "LAB" ? ["LAB", "Lagoa Bonita Residencial", "31", null, "Lagoa Bonita"] : c)));
    const depois = agrupar(DO_C2X, reguaDoCadastro(renomeado));
    const grupo = depois.find((e) => e.id === "group:Lagoa Bonita");
    expect(grupo?.name).toBe("LAGOA BONITA RESIDENCIAL");
    expect(grupo?.stageIds).toEqual(["33", "32", "27"]);
  });

  it("sem o cadastro, a regra de antes (lista fixa e nome do C2X)", () => {
    expect(agrupar(DO_C2X, null)).toEqual(antigo);
    expect(antigo.find((e) => e.id === "38")?.name).toBe("RESIDENCIAL VILLA PARIS");
  });
});

describe("lista do Apolo pelo cadastro", () => {
  const crus = DO_C2X.map((linha) =>
    mapEnterpriseRow({
      ...linha,
      bloqueado_units: 0,
      bloqueado_value: 0,
      city: "C2X",
      disponivel_units: 10,
      disponivel_value: 100,
      incorporador: null,
      negociacao_units: 0,
      negociacao_value: 0,
      reservado_units: 0,
      reservado_value: 0,
      state: "MG",
      total_units: 10,
      total_value: 100,
      vendido_units: 0,
      vendido_value: 0,
    } as never),
  );
  const cadastro = { linhas: CADASTRO, regua: reguaDoCadastro(CADASTRO) };
  const nova = agruparPeloCadastro(crus, cadastro);
  const antiga = buildApoloEnterprisesData(crus).rows;

  it("as mesmas linhas (id e siglas) da regra de antes", () => {
    const chave = (l: { codes: string[]; id: string }) => `${l.id}|${[...l.codes].sort().join("+")}`;
    expect(nova.map(chave).sort()).toEqual(antiga.map(chave).sort());
  });

  it("o VLO 35 veste o grupo, e os números são a soma das divisões", () => {
    const vale = nova.find((l) => l.id === "35")!;
    expect(vale.codes.sort()).toEqual(["VOC", "VOL", "VOR"]);
    expect(vale.scenario.total.units).toBe(30);
    expect(vale.name).toBe("Vale do Ouro");
    expect(vale.city).toBe("Pará de Minas");
  });

  it("toda linha com cadastro leva o panteonId, inclusive o grupo sem pai no C2X", () => {
    expect(nova.find((l) => l.id === "35")?.panteonId).toBe("u-vlo");
    expect(nova.find((l) => l.id === "group:Lagoa Bonita")?.panteonId).toBe("u-lab");
    expect(nova.find((l) => l.id === "38")?.panteonId).toBe("u-rvp");
  });

  it("o simples tira nome e cidade do cadastro, em caixa alta como sempre saiu", () => {
    const vp = nova.find((l) => l.id === "38")!;
    expect(vp.name).toBe("VILLA PARIS");
    expect(vp.city).toBe("João Monlevade");
  });

  it("buildApoloEnterprisesData com o cadastro usa a regra nova; sem, a de antes", () => {
    expect(buildApoloEnterprisesData(crus, cadastro).rows.map((l) => l.id).sort()).toEqual(nova.map((l) => l.id).sort());
    expect(buildApoloEnterprisesData(crus).rows.find((l) => l.id === "38")?.panteonId).toBeUndefined();
  });
});
