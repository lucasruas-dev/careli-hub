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
  // ⚠️ O VOR (41, "VALE DO OURO - EXTRAS") FALTAVA NA AMOSTRA e é a terceira carteira viva do
  // Vale do Ouro: 3 unidades, medidas em 08/09/2026 (VLO 298 · VOC 157 · VOL 141 · VOR 3). Sem
  // ele, o teste do grupo não provaria nada sobre a divisão que nasceu depois da lista.
  { code: "VOR", id: 41, name: "VALE DO OURO - EXTRAS" },
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

  it("VOC, VOL e VOR viram UM grupo; o espelho VLO continua linha própria", () => {
    // ⚠️ ESTE TESTE MUDOU DE LADO EM 08/09/2026, e a versão anterior mandava fazer exatamente
    // isto: "quem mexer em ENTERPRISE_GROUPS um dia vai quebrar este teste, e é exatamente aí que
    // se deve conferir se o filtro do Board continua fazendo sentido". Lucas, comparando com o
    // portal da Gurgel: *"na tela da gurgel, vale do ouro está agrupado, no apolo não"*.
    //
    // O agrupamento não faltava por decisão: a divisão VLO → VOC + VOL foi feita DEPOIS de a
    // lista ter sido escrita, e o VOR nasceu depois disso.
    //
    // ⚠️ O ESPELHO NÃO ENTRA NO GRUPO. As 298 unidades do VLO são as mesmas das carteiras vivas
    // (301 em 08/09/2026), então somá-lo contaria o loteamento duas vezes — que é o que
    // ANALYTICS_EXCLUDED_ENTERPRISE_CODES existe para impedir. Ele segue LISTADO, porque é a casa
    // do masterplan, das CADs da esteira e do painel do coordenador.
    //
    // ⚠️ O FILTRO DO BOARD NÃO MUDA DE RESULTADO, conferido em 08/09/2026: o nome de todas as
    // quatro linhas já era "VALE DO OURO" (`agrupar` põe o nome do C2X em caixa alta no simples e
    // o `display` em caixa alta no grupo), e o Board filtra por NOME, não por id. Antes eram
    // quatro entradas de catálogo com o mesmo rótulo, que o `new Set` do seletor colapsava numa
    // opção só; agora são duas. Nenhuma CAD entra ou sai — ver o teste abaixo.
    const catalogo = agrupar(REAIS);
    const grupo = catalogo.find((emp) => emp.id === "group:Vale do Ouro");

    expect(grupo).toBeDefined();
    expect(grupo?.name).toBe("VALE DO OURO");
    expect([...(grupo?.stageIds ?? [])].sort()).toEqual(["36", "37", "41"]);
    expect([...(grupo?.codes ?? [])].sort()).toEqual(["VOC", "VOL", "VOR"]);

    const espelho = catalogo.find((emp) => emp.id === "35");

    expect(espelho?.codes).toEqual(["VLO"]);
    expect(grupo?.stageIds).not.toContain("35");
  });

  it("o filtro do Board vê o MESMO nome antes e depois do agrupamento", () => {
    // A prova de que o agrupamento não mexe na fila: o Board traduz `enterprise_id` → nome pelos
    // `stageIds` do catálogo e depois filtra os cards por NOME. Os quatro ids do Vale do Ouro
    // continuam traduzindo para "VALE DO OURO", então a CAD gravada em 35, 36, 37 ou 41 responde
    // ao mesmo filtro de sempre.
    const porId = new Map<string, string>();
    for (const emp of agrupar(REAIS)) {
      for (const id of emp.stageIds) porId.set(id, emp.name);
    }

    expect(porId.get("35")).toBe("VALE DO OURO");
    expect(porId.get("36")).toBe("VALE DO OURO");
    expect(porId.get("37")).toBe("VALE DO OURO");
    // ⚠️ O VOR É A ÚNICA MUDANÇA DE RÓTULO: solto, o nome dele no C2X é "VALE DO OURO - EXTRAS",
    // e um card dele ficaria fora do filtro "VALE DO OURO". Dentro do grupo, entra.
    expect(porId.get("41")).toBe("VALE DO OURO");
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
