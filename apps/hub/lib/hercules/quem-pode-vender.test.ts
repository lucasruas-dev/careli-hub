import { describe, expect, it } from "vitest";

import { familiaDoEmpreendimento } from "./quem-pode-vender";

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
