import { describe, expect, it } from "vitest";

import type { ApoloTimelineEntry } from "@/lib/apolo/timeline";

import {
  eventoDePagamento,
  eventoDeReuniao,
  eventoDeVenda,
  ordenarHistorico,
  type LinhaPagamentoHistorico,
  type LinhaVendaHistorico,
} from "./historico";

// O HISTÓRICO DO PORTAL É A FICHA CORRIDA NA TELA DE UM CLIENTE EXTERNO. Os testes cobrem o
// filtro do que sai (só venda/pagamento/reunião — atendimento e nota interna NÃO) e o contrato
// de cada evento.

const venda = (over: Partial<LinhaVendaHistorico>): LinhaVendaHistorico => ({
  block: "02",
  enterprise_name: "VISTA ALEGRE",
  hist_id: 1,
  lot: "18",
  occurred_at: "2026-05-10T14:00:00-03:00",
  stage_id: 4,
  stage_name: "Faturado",
  ...over,
});

const pagamento = (over: Partial<LinhaPagamentoHistorico>): LinhaPagamentoHistorico => ({
  enterprise_name: "VISTA ALEGRE",
  paid_value: 1500,
  parcel_label: "3/48",
  parcel_type: "Parcela",
  payment_day: "2026-06-05",
  payment_id: 9,
  ...over,
});

const entrada = (over: Partial<ApoloTimelineEntry>): ApoloTimelineEntry => ({
  amount: null,
  author: null,
  date: "2026-04-01T10:00:00Z",
  dateOnly: false,
  description: "Reunião · alinhamento",
  id: "chronos:m1",
  manual: false,
  reference: null,
  source: "chronos",
  status: "info",
  title: "Reunião de assinatura",
  ...over,
});

describe("eventoDeVenda", () => {
  it("marco de avanço vira evento com unidade e empreendimento na descrição", () => {
    const evento = eventoDeVenda(venda({}));

    expect(evento).toEqual({
      categoria: "venda",
      data: "2026-05-10T14:00:00-03:00",
      dataSemHora: false,
      descricao: "Q02·L18 · VISTA ALEGRE",
      id: "venda:1",
      titulo: "Faturado",
      valor: null,
    });
  });

  it("⚠️ cancelado/reprovado/distrato NÃO saem na ficha do cliente externo", () => {
    // Ruptura de contrato é conversa da Careli com o comprador antes de ser linha do extrato do
    // loteador (pendente ratificação do Lucas; a aba Vendas já agrega os cancelamentos).
    for (const stage of [7, 8, 10, 11]) {
      expect(eventoDeVenda(venda({ stage_id: stage }))).toBeNull();
    }
  });
});

describe("eventoDePagamento", () => {
  it("pagamento vira evento com valor e SÓ a data (o C2X não tem hora)", () => {
    const evento = eventoDePagamento(pagamento({}));

    expect(evento).toEqual({
      categoria: "pagamento",
      data: "2026-06-05T12:00:00-03:00",
      dataSemHora: true,
      descricao: "Parcela 3/48 · VISTA ALEGRE",
      id: "pagamento:9",
      titulo: "Pagamento realizado",
      valor: 1500,
    });
  });

  it("linha sem data de pagamento não vira evento (não afirmar pagamento sem data)", () => {
    expect(eventoDePagamento(pagamento({ payment_day: null }))).toBeNull();
  });

  it("valor não numérico vira nulo, nunca NaN na tela", () => {
    expect(eventoDePagamento(pagamento({ paid_value: "abc" }))?.valor).toBeNull();
  });
});

describe("eventoDeReuniao", () => {
  it("entrada do Chronos vira reunião", () => {
    const evento = eventoDeReuniao(entrada({}));

    expect(evento?.categoria).toBe("reuniao");
    expect(evento?.titulo).toBe("Reunião de assinatura");
  });

  it("⚠️ qualquer outra fonte é recusada — Iris/Hades/manual são operação interna", () => {
    for (const source of ["iris", "hades", "manual", "pagamento", "venda"] as const) {
      expect(eventoDeReuniao(entrada({ source }))).toBeNull();
    }
  });
});

describe("ordenarHistorico", () => {
  it("junta as fontes do mais recente para o mais antigo, comparando por TIMESTAMP", () => {
    // Offset -03:00 (C2X) e Z (Chronos) misturados: comparar texto ordenaria errado.
    const eventos = ordenarHistorico(
      [
        eventoDePagamento(pagamento({ payment_day: "2026-06-05" })),
        eventoDeVenda(venda({ occurred_at: "2026-06-05T13:30:00-03:00" })),
        eventoDeReuniao(entrada({ date: "2026-06-05T16:00:00Z" })),
      ],
      "2026-08-18T12:00:00Z",
    );

    expect(eventos.map((evento) => evento.categoria)).toEqual([
      "venda", // 13:30-03:00 = 16:30Z
      "reuniao", // 16:00Z
      "pagamento", // 12:00-03:00 = 15:00Z
    ]);
  });

  it("descarta nulos e o que ainda não aconteceu (agenda não é ficha corrida)", () => {
    const eventos = ordenarHistorico(
      [
        null,
        eventoDeReuniao(entrada({ date: "2087-01-01T10:00:00Z" })),
        eventoDeReuniao(entrada({ date: "2026-04-01T10:00:00Z", id: "chronos:ok" })),
      ],
      "2026-08-18T12:00:00Z",
    );

    expect(eventos.map((evento) => evento.id)).toEqual(["chronos:ok"]);
  });
});
