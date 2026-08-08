import { describe, expect, it } from "vitest";

import { normalizarCarteira, recorteDaCarteira } from "./bi-vale-do-ouro";

// O QUE ESTE TESTE PROTEGE: o recorte por carteira do BI do Vale do Ouro.
// Dois erros aqui saem caros e silenciosos no painel público:
//   1) filtrar a carteira por `eu.enterprise_id` puro faria as propostas ÓRFÃS do master (35)
//      sumirem dos dois painéis — VOC + VOL passaria a dar MENOS que o lançamento inteiro;
//   2) contar unidades do 35 junto com 36/37 dobraria o empreendimento (as unidades do master
//      são as MESMAS, aposentadas).
// O teste é de SQL montado (sem banco): é a peça que decide os dois pontos.

describe("normalizarCarteira", () => {
  it("aceita voc e vol", () => {
    expect(normalizarCarteira("voc")).toBe("voc");
    expect(normalizarCarteira("VOL")).toBe("vol");
    expect(normalizarCarteira(" voc ")).toBe("voc");
  });

  it("cai no lançamento inteiro com valor ausente ou desconhecido", () => {
    expect(normalizarCarteira(null)).toBe("todos");
    expect(normalizarCarteira(undefined)).toBe("todos");
    expect(normalizarCarteira("")).toBe("todos");
    expect(normalizarCarteira("35")).toBe("todos");
    expect(normalizarCarteira("voc; DROP TABLE users")).toBe("todos");
  });
});

describe("recorteDaCarteira", () => {
  it("no recorte inteiro não filtra proposta e conta as duas carteiras vivas", () => {
    const r = recorteDaCarteira("todos");

    expect(r.filtroCarteira).toBe("");
    expect(r.listaUnidades).toBe("36, 37");
  });

  it("no VOC conta só as unidades do 37", () => {
    expect(recorteDaCarteira("voc").listaUnidades).toBe("37");
  });

  it("no VOL conta só as unidades do 36", () => {
    expect(recorteDaCarteira("vol").listaUnidades).toBe("36");
  });

  it("nunca conta as unidades aposentadas do master (35)", () => {
    for (const carteira of ["todos", "voc", "vol"] as const) {
      expect(recorteDaCarteira(carteira).listaUnidades).not.toMatch(/\b35\b/);
    }
  });

  it("filtra a proposta pela carteira do LOTE GÊMEO, não pelo empreendimento cru", () => {
    const voc = recorteDaCarteira("voc").filtroCarteira;

    // A órfã do 35 entra pelo gêmeo (casamento por número do lote), então o filtro precisa
    // passar pelo COALESCE/NULLIF — `AND eu.enterprise_id = 37` seco perderia as 9 vendas e as
    // 31 reservas que ficaram no master.
    expect(voc).toContain("gemeo.enterprise_id");
    expect(voc).toContain("NULLIF(eu.enterprise_id, 35)");
    expect(voc).toMatch(/=\s*37$/);
    expect(voc).not.toMatch(/^AND eu\.enterprise_id/);
  });

  it("não usa o tipo da unidade (interna/externa) para decidir a carteira", () => {
    for (const carteira of ["todos", "voc", "vol"] as const) {
      const r = recorteDaCarteira(carteira);
      expect(r.filtroCarteira).not.toMatch(/enterprise_unity_type|interna|externa/i);
    }
  });
});
