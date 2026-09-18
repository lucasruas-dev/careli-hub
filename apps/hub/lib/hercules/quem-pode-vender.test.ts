import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { escopoDeQuemVende, familiaDoEmpreendimento } from "./quem-pode-vender";

// O CADASTRO REAL do Vale do Ouro e do Garden, lido do banco em 03/09/2026.
const CADASTRO = [
  { c2xEnterpriseId: "35", id: "uuid-vlo", paiId: null },
  { c2xEnterpriseId: "37", id: "uuid-voc", paiId: "uuid-vlo" },
  { c2xEnterpriseId: "36", id: "uuid-vol", paiId: "uuid-vlo" },
  { c2xEnterpriseId: "39", id: "uuid-gdn", paiId: null },
];

describe("familiaDoEmpreendimento", () => {
  it("⚠️ o FILHO enxerga o pai e os irmãos", () => {
    // É o bug que o Lucas encontrou na primeira reserva: as unidades do Vale do Ouro estão em
    // VLO/VOL/VOC, mas as 37 imobiliárias credenciadas estão vinculadas só ao VLO (35). Perguntar
    // pelo 37 sozinho devolvia "nenhuma imobiliária habilitada".
    expect(familiaDoEmpreendimento(CADASTRO, "37").sort()).toEqual(["35", "36", "37"]);
  });

  it("o PAI enxerga os filhos", () => {
    expect(familiaDoEmpreendimento(CADASTRO, "35").sort()).toEqual(["35", "36", "37"]);
  });

  it("empreendimento sem filhos devolve ele mesmo", () => {
    expect(familiaDoEmpreendimento(CADASTRO, "39")).toEqual(["39"]);
  });

  it("⚠️ fora do cadastro NÃO vira lista vazia", () => {
    // Lista vazia bloquearia toda reserva do empreendimento sem dizer por quê; devolver o próprio
    // id mantém o comportamento antigo, que é pior mas não é mudo.
    expect(familiaDoEmpreendimento(CADASTRO, "99")).toEqual(["99"]);
    expect(familiaDoEmpreendimento([], "35")).toEqual(["35"]);
  });

  it("id vazio não vira consulta", () => {
    expect(familiaDoEmpreendimento(CADASTRO, "")).toEqual([]);
    expect(familiaDoEmpreendimento(CADASTRO, "   ")).toEqual([]);
  });
});

// O Lagoa Bonita REAL, lido do banco em 18/09/2026: LAB (31) é o pai, LBF (33), LBP (32) e LBR (27)
// os filhos. No catálogo o loteamento é UM item, "group:Lagoa Bonita", com as três divisões.
const LAGOA_BONITA = [
  { c2xEnterpriseId: "31", id: "uuid-lab", paiId: null },
  { c2xEnterpriseId: "33", id: "uuid-lbf", paiId: "uuid-lab" },
  { c2xEnterpriseId: "32", id: "uuid-lbp", paiId: "uuid-lab" },
  { c2xEnterpriseId: "27", id: "uuid-lbr", paiId: "uuid-lab" },
];
const CATALOGO = [
  { id: "group:Lagoa Bonita", stageIds: ["33", "27", "32"] },
  { id: "group:Vale do Ouro", stageIds: ["37", "36", "41"] },
  { id: "20", stageIds: ["20"] },
];

describe("escopoDeQuemVende", () => {
  it("⚠️ o lote do Lagoa Bonita enxerga a imobiliária habilitada no GRUPO", () => {
    // O caso da MORVIAN (18/09/2026): habilitada como "group:Lagoa Bonita", que é como o
    // credenciamento público grava, e fora da lista da reserva no lote C09 07 do LBF. A reserva
    // procurava só por 33, 31, 32 e 27.
    expect(escopoDeQuemVende(LAGOA_BONITA, CATALOGO, "33").sort()).toEqual(
      ["27", "31", "32", "33", "group:Lagoa Bonita"].sort(),
    );
  });

  it("vale para o lote de qualquer divisão, e para o do pai", () => {
    for (const divisao of ["27", "32", "31"]) {
      expect(escopoDeQuemVende(LAGOA_BONITA, CATALOGO, divisao)).toContain("group:Lagoa Bonita");
    }
  });

  it("não puxa o grupo de outro loteamento", () => {
    expect(escopoDeQuemVende(CADASTRO, CATALOGO, "37")).not.toContain("group:Lagoa Bonita");
  });

  it("o grupo só entra quando a família cobre TODAS as divisões dele", () => {
    // Família com duas das três divisões: habilitação no grupo não é habilitação em parte dele.
    const parcial = LAGOA_BONITA.filter((l) => l.c2xEnterpriseId !== "27");
    expect(escopoDeQuemVende(parcial, CATALOGO, "33")).not.toContain("group:Lagoa Bonita");
  });

  it("sem catálogo (C2X fora do ar) continua devolvendo a família, sem grupo", () => {
    expect(escopoDeQuemVende(LAGOA_BONITA, [], "33").sort()).toEqual(["27", "31", "32", "33"]);
  });

  // ⚠️ A LISTA E A GRAVAÇÃO TÊM DE USAR O MESMO ESCOPO. Se só a lista ganhasse o grupo, a Morvian
  // apareceria na tela e o POST recusaria a reserva com "não está habilitada".
  it("a rota de reserva usa este escopo na lista E na gravação", () => {
    const rota = readFileSync(
      join(__dirname, "..", "..", "app", "api", "incorporador", "venda", "reserva", "route.ts"),
      "utf8",
    );
    expect(rota.match(/escopoDeQuemVende\(/g)?.length).toBe(2);
    expect(rota).not.toContain("familiaDoEmpreendimento(");
  });
});
