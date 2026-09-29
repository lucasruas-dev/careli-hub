import { describe, expect, it } from "vitest";

import {
  momentoDaHabilitacao,
  origemDoVinculo,
  tituloDoSeloSemFila,
  ultimaHabilitacaoPorEntidade,
} from "./habilitada-sem-fila";

// A REGRA DO "SEM FILA" (Lucas, 24/09/2026, "3 - Isso ae"): de qual porta veio cada vínculo de
// empreendimento `verified`, medido nas origens que existem no banco em 24/09/2026.

const OPERADOR = "766e2df4-c404-472e-9c33-bd65cbf150d8";

describe("origemDoVinculo", () => {
  it("página pública, caminho 'já credenciada' (a CONECTTA no 43): automática", () => {
    expect(origemDoVinculo({ enterpriseId: "43", source: "publico-imobiliaria" })).toBe("automatica");
  });

  it("⚠️ `apolo` COM autor é o wizard ou o modal (a VIDA IMOVEIS no 43): interna", () => {
    expect(origemDoVinculo({ createdBy: OPERADOR, enterpriseId: "43", source: "apolo" })).toBe("interna");
  });

  it("⚠️ `apolo` SEM autor é o cadastro PÚBLICO de imobiliária, decidido no Board: fila", () => {
    // Os dois passam por `createApoloEntity` com `source: "apolo"`; ler só o source poria o selo
    // "cadastro interno" nas 42 imobiliárias que se cadastraram sozinhas e foram habilitadas no Board.
    expect(origemDoVinculo({ enterpriseId: "43", source: "apolo" })).toBe("fila");
    expect(origemDoVinculo({ createdBy: "", enterpriseId: "43", source: "apolo" })).toBe("fila");
  });

  it("o vínculo que o próprio Board cria ao habilitar: fila", () => {
    expect(origemDoVinculo({ enterpriseId: "43", source: "apolo-credenciamento" })).toBe("fila");
  });

  it("vínculo de CAD de cliente (formulário público e Mover CAD) não é habilitação", () => {
    expect(origemDoVinculo({ enterpriseId: "35", source: "publico-cad" })).toBe("cad");
    expect(
      origemDoVinculo({ createdBy: OPERADOR, enterpriseId: "35", origem: "mover-cad", source: "apolo" }),
    ).toBe("cad");
  });

  it("script e teste (sem source, setup do portal) foram feitos por dentro: interna", () => {
    expect(origemDoVinculo({ enterpriseId: "9001", origem: "teste-reserva-2026-09-03" })).toBe("interna");
    expect(origemDoVinculo({ enterpriseId: "39", source: "setup-portal-cecilio-2026-09-23" })).toBe("interna");
    expect(origemDoVinculo(null)).toBe("interna");
  });
});

describe("ultimaHabilitacaoPorEntidade", () => {
  it("a mais recente vale; decisão do Board depois da automática tira o selo", () => {
    const mapa = ultimaHabilitacaoPorEntidade([
      { created_at: "2026-09-01T10:00:00+00:00", entity_id: "a", metadata: { source: "publico-imobiliaria" } },
      { created_at: "2026-09-10T10:00:00+00:00", entity_id: "a", metadata: { source: "apolo-credenciamento" } },
      { created_at: "2026-09-24T19:55:00+00:00", entity_id: "b", metadata: { source: "publico-imobiliaria" } },
      { created_at: "2026-09-20T10:00:00+00:00", entity_id: "b", metadata: { source: "apolo" } },
    ]);
    expect(mapa.get("a")).toEqual({ em: "2026-09-10T10:00:00+00:00", enterpriseIds: [], origem: null });
    expect(mapa.get("b")).toEqual({ em: "2026-09-24T19:55:00+00:00", enterpriseIds: [], origem: "automatica" });
  });

  it("⚠️ guarda EM QUAIS empreendimentos foi a habilitação que venceu (a mesma gravação, a mesma porta)", () => {
    // A CONECTTA: Vale do Ouro pelo modal em 02/08, e o 43 automático em 24/09. O selo é do 43.
    const conectta = ultimaHabilitacaoPorEntidade([
      { created_at: "2026-08-02T10:00:00+00:00", entity_id: "c", metadata: { createdBy: OPERADOR, enterpriseId: "35", source: "apolo" } },
      { created_at: "2026-09-24T19:55:00+00:00", entity_id: "c", metadata: { enterpriseId: "43", source: "publico-imobiliaria" } },
    ]).get("c");
    expect(conectta).toEqual({ em: "2026-09-24T19:55:00+00:00", enterpriseIds: ["43"], origem: "automatica" });

    // Uma gravação só que habilitou dois produtos: os dois; a linha da fila no mesmo segundo não entra.
    const emLote = ultimaHabilitacaoPorEntidade([
      { created_at: "2026-09-24T10:00:00+00:00", entity_id: "w", metadata: { createdBy: OPERADOR, enterpriseId: "43", source: "apolo" } },
      { created_at: "2026-09-24T10:00:00+00:00", entity_id: "w", metadata: { createdBy: OPERADOR, enterpriseId: "29", source: "apolo" } },
      { created_at: "2026-09-24T10:00:00+00:00", entity_id: "w", metadata: { enterpriseId: "40", source: "apolo-credenciamento" } },
    ]).get("w");
    expect(emLote).toEqual({ em: "2026-09-24T10:00:00+00:00", enterpriseIds: ["43", "29"], origem: "interna" });
  });

  it("⚠️ o pedido antigo PROMOVIDO pela página pública conta pela hora da promoção, como automática", () => {
    const promovido = {
      created_at: "2026-07-10T12:00:00+00:00",
      entity_id: "p",
      metadata: {
        enterpriseId: "43",
        habilitadoEm: "2026-09-24T19:00:00.000Z",
        habilitadoPela: "publico-imobiliaria",
        source: "apolo",
      },
    };
    expect(origemDoVinculo(promovido.metadata)).toBe("automatica");
    expect(momentoDaHabilitacao(promovido)).toBe("2026-09-24T19:00:00.000Z");
    expect(ultimaHabilitacaoPorEntidade([promovido]).get("p")).toEqual({
      em: "2026-09-24T19:00:00.000Z",
      enterpriseIds: ["43"],
      origem: "automatica",
    });
    // Data ilegível na marca: vale a criação.
    expect(momentoDaHabilitacao({ ...promovido, metadata: { habilitadoEm: "ontem" } })).toBe(
      "2026-07-10T12:00:00+00:00",
    );
  });

  it("vínculo de CAD e linha sem data ou sem entidade ficam de fora", () => {
    const mapa = ultimaHabilitacaoPorEntidade([
      { created_at: "2026-09-24T10:00:00+00:00", entity_id: "cliente", metadata: { source: "publico-cad" } },
      { created_at: null, entity_id: "sem-data", metadata: { source: "publico-imobiliaria" } },
      { created_at: "2026-09-24T10:00:00+00:00", entity_id: null, metadata: { source: "publico-imobiliaria" } },
    ]);
    expect(mapa.size).toBe(0);
  });

  it("empate de horário (mesma gravação): a origem sem fila ganha, na ordem que vier", () => {
    const emLote = [
      { created_at: "2026-09-24T10:00:00+00:00", entity_id: "a", metadata: { source: "apolo" } },
      { created_at: "2026-09-24T10:00:00+00:00", entity_id: "a", metadata: { createdBy: OPERADOR, source: "apolo" } },
    ];
    expect(ultimaHabilitacaoPorEntidade(emLote).get("a")?.origem).toBe("interna");
    expect(ultimaHabilitacaoPorEntidade([...emLote].reverse()).get("a")?.origem).toBe("interna");
  });
});

describe("tituloDoSeloSemFila", () => {
  it("diz a porta e a data, sem travessão", () => {
    const automatica = tituloDoSeloSemFila({ em: "2026-09-24T19:55:00+00:00", origem: "automatica" });
    const interna = tituloDoSeloSemFila({ em: "2026-09-24T18:46:00+00:00", origem: "interna" });
    expect(automatica).toContain("24/09/2026");
    expect(automatica).toContain("página pública");
    expect(interna).toContain("cadastro interno");
    for (const texto of [automatica, interna]) {
      expect(texto).not.toMatch(/[—–]/);
    }
  });

  it("data ilegível não quebra o texto", () => {
    expect(tituloDoSeloSemFila({ em: "x", origem: "interna" })).toBe("Habilitada sem fila: pelo cadastro interno.");
  });

  it("⚠️ diz EM QUAL produto foi (o card da CONECTTA aparece também no filtro do Vale do Ouro)", () => {
    expect(
      tituloDoSeloSemFila({ em: "x", empreendimentos: ["PORTAL DO IBITURUNA"], origem: "automatica" }),
    ).toBe(
      "Habilitada sem fila para PORTAL DO IBITURUNA: automática, pela página pública (a imobiliária já era credenciada).",
    );
    const dois = tituloDoSeloSemFila({
      em: "2026-09-24T18:46:00+00:00",
      empreendimentos: ["PORTAL DO IBITURUNA", "VISTA ALEGRE", "PORTAL DO IBITURUNA"],
      origem: "interna",
    });
    expect(dois).toBe("Habilitada sem fila para PORTAL DO IBITURUNA e VISTA ALEGRE em 24/09/2026: pelo cadastro interno.");
    expect(dois).not.toMatch(/[—–]/);
  });
});

describe("ultimaHabilitacaoPorEntidade: datas em formatos diferentes", () => {
  it("compara pelo instante: a promoção ('...Z') e o created_at do banco ('+00:00', microssegundos)", () => {
    // O pedido PROMOVIDO às 19:00:00.500Z e uma decisão do Board às 19:00:00.400123 no mesmo dia: como
    // texto, "19:00:00.400123+00:00" > "19:00:00.500Z" e a decisão do Board venceria sem ser a mais nova.
    const mapa = ultimaHabilitacaoPorEntidade([
      {
        created_at: "2026-07-10T12:00:00+00:00",
        entity_id: "p",
        metadata: { enterpriseId: "43", habilitadoEm: "2026-09-24T19:00:00.500Z", habilitadoPela: "publico-imobiliaria", source: "apolo" },
      },
      { created_at: "2026-09-24T19:00:00.400123+00:00", entity_id: "p", metadata: { enterpriseId: "40", source: "apolo-credenciamento" } },
    ]);
    expect(mapa.get("p")).toEqual({ em: "2026-09-24T19:00:00.500Z", enterpriseIds: ["43"], origem: "automatica" });
  });
});
