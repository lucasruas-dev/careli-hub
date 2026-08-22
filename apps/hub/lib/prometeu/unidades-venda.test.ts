import { describe, expect, it } from "vitest";

import { etapaEhVenda, passoEhSaida } from "./reservas-c2x";

// O QUE CONTA COMO VENDA, e o que ainda pode cair.
//
// O card "Vendas fechadas" e o funil passaram a somar UNIDADES do C2X em vez de pessoas (Lucas,
// 22/08: "vão ter clientes que vão comprar mais de uma unidade"). Com isso, a linha entre "já é
// venda" e "ainda é reserva" virou a regra que decide o número do dia — e ela não é opinião: no
// Villa Paris a RVPC02 caiu às 09:33 e o mesmo cliente pegou a RVPD02 nove minutos depois.

describe("etapaEhVenda", () => {
  it("conta contrato em diante como venda", () => {
    expect(etapaEhVenda("Contrato gerado")).toBe(true);
    expect(etapaEhVenda("Em assinatura")).toBe(true);
    expect(etapaEhVenda("Faturado")).toBe(true);
    expect(etapaEhVenda("Finalizado")).toBe(true);
  });

  it("NÃO conta reserva nem proposta: nessas duas o lote ainda volta para a prateleira", () => {
    expect(etapaEhVenda("Reservado")).toBe(false);
    expect(etapaEhVenda("Proposta realizada")).toBe(false);
  });

  it("não conta o que morreu", () => {
    expect(etapaEhVenda("Cancelado")).toBe(false);
    expect(etapaEhVenda("Distratado")).toBe(false);
    expect(etapaEhVenda("Reprovado análise de crédito")).toBe(false);
  });

  it("aguenta espaço e vazio sem quebrar o card", () => {
    expect(etapaEhVenda("  Contrato gerado  ")).toBe(true);
    expect(etapaEhVenda("")).toBe(false);
  });
});

describe("passoEhSaida", () => {
  const passo = (para: string) => ({
    de: "Reservado",
    em: "2026-08-22T12:33:00.000Z",
    lote: "02",
    motivo: null,
    operador: null,
    para,
    quadra: "C",
    unidade: "RVPC02",
  });

  it("reconhece a devolução do lote — é o passo que a ficha precisa mostrar em vermelho", () => {
    expect(passoEhSaida(passo("Cancelado"))).toBe(true);
    expect(passoEhSaida(passo("Distratado"))).toBe(true);
    expect(passoEhSaida(passo("Reprovado análise de crédito"))).toBe(true);
  });

  it("avanço na esteira não é saída", () => {
    expect(passoEhSaida(passo("Proposta realizada"))).toBe(false);
    expect(passoEhSaida(passo("Contrato gerado"))).toBe(false);
  });
});
