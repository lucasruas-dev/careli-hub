import { describe, expect, it } from "vitest";

import { agrupar } from "./catalogo-empreendimentos";

// Os dados abaixo são os REAIS do C2X (lidos em 17/08/2026), não inventados: é o que fez o Lagoa
// Bonita sumir do filtro do Board.

const REAIS = [
  { code: "ACP", id: 42, name: "ALDEIA DAS CACHOEIRAS DAS PEDRAS" },
  { code: "JDG", id: 40, name: "JARDIM DAS GERAIS" },
  { code: "LBF", id: 33, name: "LAGOA BONITA" },
  { code: "LBP", id: 32, name: "LAGOA BONITA" },
  { code: "LBR", id: 27, name: "LAGOA BONITA" },
  { code: "REP", id: 20, name: "CONDOMINIO RECANTO DO PARA" },
  { code: "RVP", id: 38, name: "RESIDENCIAL VILLA PARIS" },
  { code: "VLO", id: 35, name: "VALE DO OURO" },
  { code: "VOC", id: 37, name: "VALE DO OURO" },
  { code: "VOL", id: 36, name: "VALE DO OURO" },
];

describe("agrupar", () => {
  it("junta as três divisões do Lagoa Bonita num empreendimento só", () => {
    const grupo = agrupar(REAIS).find((emp) => emp.name === "LAGOA BONITA");

    expect(grupo).toBeDefined();
    expect(grupo?.id).toBe("group:Lagoa Bonita");
    // A ordem segue ENTERPRISE_GROUPS (LBF, LBR, LBP), não a da entrada.
    expect(grupo?.stageIds.sort()).toEqual(["27", "32", "33"]);
  });

  it("o vínculo de QUALQUER divisão encontra o nome do empreendimento", () => {
    // É esta a tradução que faltava: a DANY CASTRO tem vínculo com 33, 27 e 32, e o card dela
    // aparecia sem empreendimento nenhum.
    const porId = new Map<string, string>();
    for (const emp of agrupar(REAIS)) {
      for (const id of emp.stageIds) porId.set(id, emp.name);
    }

    expect(porId.get("33")).toBe("LAGOA BONITA");
    expect(porId.get("27")).toBe("LAGOA BONITA");
    expect(porId.get("32")).toBe("LAGOA BONITA");
  });

  it("empreendimento simples também tem stageIds, apontando para ele mesmo", () => {
    // Assim quem traduz um id não precisa de dois caminhos.
    const jdg = agrupar(REAIS).find((emp) => emp.name === "JARDIM DAS GERAIS");

    expect(jdg?.id).toBe("40");
    expect(jdg?.stageIds).toEqual(["40"]);
  });

  it("VOC e VOL NÃO viram grupo: o Vale do Ouro não está em ENTERPRISE_GROUPS", () => {
    // Registro de uma diferença real entre os dois casos. A divisão VLO→VOC+VOL foi feita depois,
    // e o agrupamento dela ainda não existe — então os três aparecem separados, cada um com o
    // mesmo nome de mercado. Quem mexer em ENTERPRISE_GROUPS um dia vai quebrar este teste, e é
    // exatamente aí que se deve conferir se o filtro do Board continua fazendo sentido.
    const doValeDoOuro = agrupar(REAIS).filter((emp) => emp.name === "VALE DO OURO");

    expect(doValeDoOuro).toHaveLength(3);
    expect(doValeDoOuro.map((emp) => emp.id).sort()).toEqual(["35", "36", "37"]);
  });

  it("sai ordenado por nome", () => {
    const nomes = agrupar(REAIS).map((emp) => emp.name);

    expect(nomes[0]).toBe("ALDEIA DAS CACHOEIRAS DAS PEDRAS");
    expect([...nomes]).toEqual([...nomes].sort((a, b) => a.localeCompare(b, "pt-BR")));
  });

  it("linha sem código é ignorada em vez de virar empreendimento fantasma", () => {
    const comLixo = agrupar([...REAIS, { code: null, id: 999, name: "SEM CODIGO" }]);

    expect(comLixo.some((emp) => emp.name === "SEM CODIGO")).toBe(false);
  });

  it("grupo cujas divisões não existem na base não vira entrada vazia", () => {
    // Rio de Pedras está em ENTERPRISE_GROUPS mas não está nesta amostra.
    const so = agrupar([{ code: "JDG", id: 40, name: "JARDIM DAS GERAIS" }]);

    expect(so).toHaveLength(1);
    expect(so[0]?.name).toBe("JARDIM DAS GERAIS");
  });
});
