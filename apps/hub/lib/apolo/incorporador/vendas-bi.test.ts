import { describe, expect, it } from "vitest";

import type { ApoloVendaStage, ApoloVendaUnit } from "@/lib/apolo/vendas";

import {
  type EventoDeVenda,
  montarIndicadoresDeVendasBI,
  rankingDeImobiliarias,
} from "./vendas-bi";

// A régua destes testes é a regra do BI do Lucas ("Careli - Dashboard Recanto.pbit"):
// proposta = estágio 9, faturada = 4, cancelada = 7 com old_stage <> 1, tudo POR UNIDADE.

const AGORA = Date.parse("2026-08-17T15:00:00.000Z");

function evento(
  novoEstagio: number,
  em: string,
  extras: Partial<EventoDeVenda> = {},
): EventoDeVenda {
  return {
    arId: 1,
    em,
    estagioAnterior: 9,
    novoEstagio,
    precoDaUnidade: 100_000,
    unitId: "u1",
    ...extras,
  };
}

function unidade(
  stage: ApoloVendaStage,
  imobiliaria: null | string,
  vgv = 89_900,
): ApoloVendaUnit {
  return {
    arId: null,
    block: "Q01",
    blocked: false,
    client: stage === "disponivel" ? null : { code: null, entityId: "e1", name: "Fulano" },
    code: "VALQ0101",
    id: "1",
    imobiliaria: imobiliaria ? { code: null, entityId: "e2", name: imobiliaria } : null,
    lot: "L01",
    stage,
    stageSince: null,
    vgv,
  };
}

describe("os indicadores de vendas do BI", () => {
  it("classifica proposta (9), faturada (4) e cancelada (7 com old_stage <> 1)", () => {
    const bi = montarIndicadoresDeVendasBI(
      [
        evento(9, "2026-07-01T12:00:00.000Z", { unitId: "u1" }),
        evento(4, "2026-07-20T12:00:00.000Z", { unitId: "u1" }),
        evento(9, "2026-07-02T12:00:00.000Z", { arId: 2, unitId: "u2" }),
        evento(7, "2026-07-10T12:00:00.000Z", { arId: 2, unitId: "u2" }),
      ],
      [],
      AGORA,
    );

    expect(bi.propostas).toEqual({ un: 2, vgv: 200_000 });
    expect(bi.faturadas).toEqual({ un: 1, vgv: 100_000 });
    expect(bi.canceladas).toEqual({ un: 1, vgv: 100_000 });
    expect(bi.cancelamentoPct).toBe(50);
  });

  it("⚠️ cancelamento direto da reserva (old_stage = 1) NÃO conta — regra do BI", () => {
    const bi = montarIndicadoresDeVendasBI(
      [evento(7, "2026-07-10T12:00:00.000Z", { estagioAnterior: 1 })],
      [],
      AGORA,
    );

    expect(bi.canceladas.un).toBe(0);
  });

  it("cancelamento sem estágio anterior registrado conta como perda, não some", () => {
    const bi = montarIndicadoresDeVendasBI(
      [evento(7, "2026-07-10T12:00:00.000Z", { estagioAnterior: null })],
      [],
      AGORA,
    );

    expect(bi.canceladas.un).toBe(1);
  });

  it("⚠️ conta POR UNIDADE: duas propostas na mesma unidade são UMA proposta gerada", () => {
    const bi = montarIndicadoresDeVendasBI(
      [
        evento(9, "2026-06-01T12:00:00.000Z", { arId: 1, unitId: "u1" }),
        evento(9, "2026-07-01T12:00:00.000Z", { arId: 2, unitId: "u1" }),
      ],
      [],
      AGORA,
    );

    expect(bi.propostas).toEqual({ un: 1, vgv: 100_000 });
  });

  it("o deadline é da ÚLTIMA proposta antes do faturamento até o faturamento, na média", () => {
    const bi = montarIndicadoresDeVendasBI(
      [
        // Contrato 1: proposta em 01/07, outra em 05/07, faturado em 15/07 → 10 dias.
        evento(9, "2026-07-01T12:00:00.000Z", { arId: 1, unitId: "u1" }),
        evento(9, "2026-07-05T12:00:00.000Z", { arId: 1, unitId: "u1" }),
        evento(4, "2026-07-15T12:00:00.000Z", { arId: 1, unitId: "u1" }),
        // Contrato 2: proposta em 01/07, faturado em 21/07 → 20 dias.
        evento(9, "2026-07-01T12:00:00.000Z", { arId: 2, unitId: "u2" }),
        evento(4, "2026-07-21T12:00:00.000Z", { arId: 2, unitId: "u2" }),
      ],
      [],
      AGORA,
    );

    expect(bi.deadlineMedioDias).toBe(15);
  });

  it("sem faturamento medível, o deadline é nulo (a tela diz 'sem dado'), nunca zero", () => {
    const bi = montarIndicadoresDeVendasBI(
      [evento(9, "2026-07-01T12:00:00.000Z")],
      [],
      AGORA,
    );

    expect(bi.deadlineMedioDias).toBeNull();
  });

  it("a série tem 12 meses no fuso de São Paulo, e o evento cai no mês em que aconteceu", () => {
    const bi = montarIndicadoresDeVendasBI(
      // 01/02 01:00 UTC = 31/01 22:00 em São Paulo → conta em JANEIRO.
      [evento(9, "2026-02-01T01:00:00.000Z")],
      [],
      AGORA,
    );

    expect(bi.serieMensal).toHaveLength(12);
    expect(bi.serieMensal[0]?.mes).toBe("2025-09");
    expect(bi.serieMensal[11]?.mes).toBe("2026-08");
    expect(bi.serieMensal.find((m) => m.mes === "2026-01")?.propostas.un).toBe(1);
    expect(bi.serieMensal.find((m) => m.mes === "2026-02")?.propostas.un).toBe(0);
  });

  it("evento fora da janela fica fora da série, mas segue nos totais", () => {
    const bi = montarIndicadoresDeVendasBI(
      [evento(9, "2024-03-10T12:00:00.000Z")],
      [],
      AGORA,
    );

    expect(bi.propostas.un).toBe(1);
    expect(bi.serieMensal.every((m) => m.propostas.un === 0)).toBe(true);
  });
});

describe("o ranking de imobiliárias", () => {
  it("conta só unidade VENDIDA, agrupada por imobiliária, da maior para a menor", () => {
    const ranking = rankingDeImobiliarias([
      unidade("faturado", "Imob A", 100_000),
      unidade("faturado", "Imob A", 90_000),
      unidade("faturado", "Imob B", 200_000),
      unidade("assinatura", "Imob C", 300_000), // em negociação: não é venda ainda
      unidade("disponivel", null),
    ]);

    expect(ranking).toEqual([
      { nome: "Imob A", unidades: 2, vgv: 190_000 },
      { nome: "Imob B", unidades: 1, vgv: 200_000 },
    ]);
  });

  it("venda sem imobiliária não vira linha fantasma", () => {
    expect(rankingDeImobiliarias([unidade("faturado", null)])).toEqual([]);
  });
});

// ── FATURAMENTO DESFEITO POR CANCELAMENTO ───────────────────────────────────
//
// O QUE ESTE BLOCO PROTEGE: a faixa de indicadores não pode se contradizer. O caso real que gerou
// a regra (portal do CER, 18/08/2026): a VOC1221 foi faturada em 12/08 e cancelada depois, e a
// tela mostrava "Faturadas 1 · R$ 148.401" ao lado de "Unidades vendidas 0". Cada número estava
// certo pela própria régua — uma conta EVENTO, a outra conta ESTADO ATUAL — e juntos mentiam: a
// mesma unidade aparecia como venda e como perda ao mesmo tempo.
describe("faturada que depois foi cancelada", () => {
  it("⚠️ não conta como faturada, e continua contando como cancelada", () => {
    const bi = montarIndicadoresDeVendasBI(
      [
        evento(9, "2026-07-01T12:00:00.000Z"),
        evento(4, "2026-07-10T12:00:00.000Z"),
        evento(7, "2026-08-12T12:00:00.000Z", { estagioAnterior: 4 }),
      ],
      [],
      AGORA,
    );

    expect(bi.faturadas).toEqual({ un: 0, vgv: 0 });
    expect(bi.canceladas.un).toBe(1);
  });

  it("some também do MÊS em que tinha sido somada: o gráfico não guarda venda que não houve", () => {
    const bi = montarIndicadoresDeVendasBI(
      [
        evento(4, "2026-07-10T12:00:00.000Z"),
        evento(7, "2026-08-12T12:00:00.000Z", { estagioAnterior: 4 }),
      ],
      [],
      AGORA,
    );
    const julho = bi.serieMensal.find((mes) => mes.mes === "2026-07");

    expect(julho?.faturadas).toEqual({ un: 0, vgv: 0 });
  });

  it("faturar DE NOVO depois do cancelamento volta a contar: aí a venda existe", () => {
    const bi = montarIndicadoresDeVendasBI(
      [
        evento(4, "2026-07-10T12:00:00.000Z"),
        evento(7, "2026-08-01T12:00:00.000Z", { estagioAnterior: 4 }),
        evento(4, "2026-08-20T12:00:00.000Z"),
      ],
      [],
      AGORA,
    );

    expect(bi.faturadas.un).toBe(1);
  });

  it("cancelar SEM ter faturado não mexe em faturadas (não há o que desfazer)", () => {
    const bi = montarIndicadoresDeVendasBI(
      [
        evento(9, "2026-07-01T12:00:00.000Z"),
        evento(7, "2026-08-12T12:00:00.000Z"),
      ],
      [],
      AGORA,
    );

    expect(bi.faturadas).toEqual({ un: 0, vgv: 0 });
    expect(bi.canceladas.un).toBe(1);
  });
});
