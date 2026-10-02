import { describe, expect, it } from "vitest";

import { ATO, ATRASADO, AVULSO, PAGO, type ParcelaDoC2x, type PedidoDoC2x, SINAL, situacaoDaEntrada } from "./regra";

// A ENTRADA DO PEDIDO, COMO O CARD DO PRÉ-FATURAMENTO A MOSTRA (Lucas, 02/10/2026).
//
// Os casos são os medidos no C2X em 02/10/2026 (só SELECT), com os números trocados onde não importam:
//   • o Ato de R$ 0,00 "Pago" de toda venda redigitada NÃO é a entrada (defeito da F8): o Antonio X.
//     (VOC1102) e a Stefany M. (VOR1401) têm o Sinal atrasado e sairiam como "entrada paga";
//   • o REP D L163 (pedido 5020): Ato R$ 1.000 e Sinal R$ 8.390 Atrasado, e dois Avulso pagos em
//     28/09 no mesmo valor. O Avulso vem à parte, e quem decide é o time (*"Mostrar e eu decido"*).

const HOJE = "2026-10-02";
const AGUARDANDO = 6;

let proximoId = 1;
function parcela(campos: Partial<ParcelaDoC2x> & Pick<ParcelaDoC2x, "tipo">): ParcelaDoC2x {
  return {
    apagada: false,
    id: proximoId++,
    marcadoEm: null,
    pagoEm: null,
    parcelaDoSinal: campos.tipo === SINAL ? 1 : 0,
    status: AGUARDANDO,
    totalDoSinal: 1,
    valor: 1000,
    vencimento: "2026-09-25",
    ...campos,
  };
}

const pedido = (parcelas: ParcelaDoC2x[], estagio: null | number = 4, totalDeParcelas: null | number = parcelas.length): PedidoDoC2x => ({
  arId: 5000,
  estagio,
  parcelas,
  totalDeParcelas,
});

describe("situacaoDaEntrada", () => {
  it("Ato zerado e Pago com o Sinal atrasado: a entrada é o Sinal, e NÃO está paga (Stefany M., VOR1401)", () => {
    const r = situacaoDaEntrada(
      pedido([
        parcela({ pagoEm: "2026-09-25", status: PAGO, tipo: ATO, valor: 0, vencimento: "2026-09-25" }),
        parcela({ parcelaDoSinal: 1, status: ATRASADO, tipo: SINAL, totalDoSinal: 2, valor: 15000, vencimento: "2026-09-28" }),
        parcela({ parcelaDoSinal: 2, status: AGUARDANDO, tipo: SINAL, totalDoSinal: 2, valor: 8990, vencimento: "2026-10-20" }),
      ]),
      HOJE,
    );
    expect(r.paga).toBe(false);
    expect(r.entrada).toMatchObject({ contaComoEntrada: true, rotulo: "Sinal 1/2", situacao: "vencida", valor: 15000 });
    // O Ato de R$ 0,00 nem aparece: na tela ele diria "pago" ao lado de uma entrada que não foi paga.
    expect(r.parcelas.map((p) => p.rotulo)).toEqual(["Sinal 1/2", "Sinal 2/2"]);
    expect(r.parcelas[1]).toMatchObject({ contaComoEntrada: false, situacao: "em_aberto" });
  });

  it("Ato zerado Pago SEM data (o 0,01 do Asaas) também não conta", () => {
    const r = situacaoDaEntrada(
      pedido([
        parcela({ marcadoEm: "2026-09-23T10:36:00-03:00", status: PAGO, tipo: ATO, valor: 0, vencimento: "2026-09-23" }),
        parcela({ status: ATRASADO, tipo: SINAL, totalDoSinal: 3, valor: 5144.7, vencimento: "2026-09-25" }),
      ]),
      HOJE,
    );
    expect(r.paga).toBe(false);
    expect(r.entrada?.rotulo).toBe("Sinal 1/3");
  });

  it("Sinal 1/3 pago: a entrada está paga no dia da payment_date (VAL C L22)", () => {
    const r = situacaoDaEntrada(
      pedido([
        parcela({ pagoEm: "2026-09-23", status: PAGO, tipo: ATO, valor: 0, vencimento: "2026-09-23" }),
        parcela({ pagoEm: "2026-09-29", status: PAGO, tipo: SINAL, totalDoSinal: 3, valor: 2996.67, vencimento: "2026-09-29" }),
        parcela({ parcelaDoSinal: 2, tipo: SINAL, totalDoSinal: 3, valor: 2996.67, vencimento: "2026-10-10" }),
        parcela({ parcelaDoSinal: 3, tipo: SINAL, totalDoSinal: 3, valor: 2996.67, vencimento: "2026-11-10" }),
      ]),
      HOJE,
    );
    expect(r.paga).toBe(true);
    expect(r.entrada).toMatchObject({ pagaPelaMarcacao: false, pagoEm: "2026-09-29", rotulo: "Sinal 1/3", situacao: "paga", valor: 2996.67 });
    expect(r.parcelas.filter((p) => p.contaComoEntrada)).toHaveLength(1);
    expect(r.parcelas.map((p) => p.situacao)).toEqual(["paga", "em_aberto", "em_aberto"]);
  });

  it("Pago sem payment_date usa o dia da marcação (updated_at), em Brasília (decisão de 29/09)", () => {
    const r = situacaoDaEntrada(
      pedido([
        // 23:30 de Brasília do dia 28 é 02:30Z do dia 29: o dia que vale é 28.
        parcela({ marcadoEm: "2026-09-28T23:30:00-03:00", status: PAGO, tipo: SINAL, valor: 4000, vencimento: "2026-09-29" }),
      ]),
      HOJE,
    );
    expect(r.paga).toBe(true);
    expect(r.entrada).toMatchObject({ pagaPelaMarcacao: true, pagoEm: "2026-09-28", situacao: "paga" });
  });

  it("Pago sem data nenhuma: não conta como paga, e a tela não diz 'em aberto'", () => {
    const r = situacaoDaEntrada(pedido([parcela({ status: PAGO, tipo: SINAL, valor: 4000 })]), HOJE);
    expect(r.paga).toBe(false);
    expect(r.entrada?.situacao).toBe("pago_sem_data");
  });

  it("vencida: Aguardando com o vencimento passado; vencendo hoje ainda está em aberto", () => {
    const r = situacaoDaEntrada(
      pedido([
        parcela({ status: AGUARDANDO, tipo: SINAL, vencimento: "2026-10-01" }),
        parcela({ parcelaDoSinal: 2, status: AGUARDANDO, tipo: SINAL, vencimento: HOJE }),
      ]),
      HOJE,
    );
    expect(r.parcelas.map((p) => p.situacao)).toEqual(["vencida", "em_aberto"]);
    expect(r.paga).toBe(false);
  });

  it("Avulso pago vem À PARTE e não quita a entrada (REP D L163, pedido 5020)", () => {
    const r = situacaoDaEntrada(
      pedido([
        parcela({ status: ATRASADO, tipo: ATO, valor: 1000, vencimento: "2026-09-28" }),
        parcela({ status: ATRASADO, tipo: SINAL, totalDoSinal: 1, valor: 8390, vencimento: "2026-09-29" }),
        parcela({ id: 900, pagoEm: "2026-09-28", status: PAGO, tipo: AVULSO, valor: 8390, vencimento: "2026-09-28" }),
        parcela({ id: 901, pagoEm: "2026-09-28", status: PAGO, tipo: AVULSO, valor: 1000, vencimento: "2026-09-28" }),
        // Avulso em aberto, apagado ou zerado não aparece.
        parcela({ status: AGUARDANDO, tipo: AVULSO, valor: 500 }),
        parcela({ apagada: true, pagoEm: "2026-09-28", status: PAGO, tipo: AVULSO, valor: 500 }),
        parcela({ pagoEm: "2026-09-28", status: PAGO, tipo: AVULSO, valor: 0 }),
      ]),
      HOJE,
    );
    expect(r.paga).toBe(false);
    expect(r.entrada).toMatchObject({ rotulo: "Ato", situacao: "vencida", valor: 1000 });
    expect(r.parcelas.map((p) => `${p.rotulo} ${p.valor} ${p.situacao}`)).toEqual(["Ato 1000 vencida", "Sinal 1/1 8390 vencida"]);
    expect(r.avulsosPagos.map((p) => `${p.rotulo} ${p.valor} ${p.pagoEm} ${p.contaComoEntrada}`)).toEqual([
      "Avulso 8390 2026-09-28 false",
      "Avulso 1000 2026-09-28 false",
    ]);
  });

  it("só Ato e Sinal de valor zero: o pedido não tem entrada", () => {
    const r = situacaoDaEntrada(
      pedido([
        parcela({ pagoEm: "2026-09-25", status: PAGO, tipo: ATO, valor: 0 }),
        parcela({ status: ATRASADO, tipo: SINAL, valor: 0 }),
        parcela({ status: ATRASADO, tipo: SINAL, valor: null }),
      ]),
      HOJE,
    );
    expect(r).toMatchObject({ avulsosPagos: [], entrada: null, paga: false, parcelas: [] });
    // Tem parcela lançada (as três zeradas): NÃO é "sem financeiro", a frase da tela é outra.
    expect(r.semFinanceiro).toBe(false);
  });

  it("pedido sem NENHUMA parcela no C2X: sem financeiro, e não 'entrada zerada' (revisão de 02/10/2026)", () => {
    const vazio = situacaoDaEntrada(pedido([], 4, 0), HOJE);
    expect(vazio).toMatchObject({ entrada: null, paga: false, parcelas: [], semFinanceiro: true });
    // Só mensais lançadas (nenhum Ato, Sinal ou Avulso lido): tem financeiro, só não tem entrada.
    expect(situacaoDaEntrada(pedido([], 4, 120), HOJE).semFinanceiro).toBe(false);
    // Total que não se sabe não vira "sem financeiro".
    expect(situacaoDaEntrada(pedido([], 4, null), HOJE).semFinanceiro).toBe(false);
  });

  it("Ato antes de Sinal no mesmo vencimento; apagada e cancelada não entram", () => {
    const r = situacaoDaEntrada(
      pedido([
        parcela({ tipo: SINAL, valor: 3000, vencimento: "2026-09-20" }),
        parcela({ tipo: ATO, valor: 1000, vencimento: "2026-09-20" }),
        parcela({ apagada: true, tipo: ATO, valor: 999, vencimento: "2026-09-01" }),
        parcela({ status: 8, tipo: ATO, valor: 999, vencimento: "2026-09-01" }),
      ]),
      HOJE,
    );
    expect(r.parcelas.map((p) => p.rotulo)).toEqual(["Ato", "Sinal 1/1"]);
    expect(r.entrada?.rotulo).toBe("Ato");
  });

  it("pedido desfeito no C2X: a leitura avisa", () => {
    expect(situacaoDaEntrada(pedido([], 7), HOJE).pedidoDesfeito).toBe(true);
    expect(situacaoDaEntrada(pedido([], 5), HOJE).pedidoDesfeito).toBe(false);
  });
});
