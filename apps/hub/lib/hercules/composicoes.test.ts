import { describe, expect, it } from "vitest";

import {
  composicoesQueFecham,
  ENTRADA_MINIMA_PERCENTUAL,
  entradaMinima,
  type PlanoDaComposicao,
} from "./composicoes";
import { montarProposta, valorPresenteDosBaloes } from "./simulacao";

/**
 * ⚠️ ESTES PLANOS SÃO PRICE, E ISSO PASSOU A SER DECLARADO EM 04/09/2026.
 *
 * Até essa data `PlanoDaComposicao` não carregava o sistema de amortização e a varredura calculava
 * Price para todo mundo — inclusive nos 21 de 24 empreendimentos que vendem em SACOC. Os números
 * congelados na suíte abaixo são os DE ENTÃO, e continuam valendo: eles descrevem um plano Price,
 * que é o que os três agora dizem ser. O comportamento em SACOC — que é o da maioria da casa, e o
 * que mudou de verdade — está na suíte do fim do arquivo.
 */
const PLANOS: PlanoDaComposicao[] = [
  {
    entradaPercentual: 20,
    nome: "Investidor",
    parcelas: 24,
    sistemaAmortizacao: "price",
    taxaAoMes: 0.0072,
  },
  {
    entradaPercentual: 20,
    nome: "Curto",
    parcelas: 36,
    sistemaAmortizacao: "price",
    taxaAoMes: 0.0072,
  },
  {
    entradaPercentual: 10,
    nome: "Normal",
    parcelas: 156,
    sistemaAmortizacao: "price",
    taxaAoMes: 0.0072,
  },
];

/** Os mesmos três planos como a casa de fato vende: SACOC, a parcela é a amortização pura. */
const PLANOS_SACOC: PlanoDaComposicao[] = PLANOS.map((p) => ({
  ...p,
  sistemaAmortizacao: "sacoc",
}));

describe("composicoesQueFecham (planos PRICE — os números antigos, que continuam valendo aqui)", () => {
  it("devolve uma composição por plano, partindo da parcela", () => {
    const r = composicoesQueFecham({ parcelaAlvo: 3_450, planos: PLANOS, valor: 136_521 });

    expect(r.length).toBeGreaterThan(0);
    expect(new Set(r.map((c) => c.plano)).size).toBeGreaterThan(1);
    // Toda composição devolvida entrega a parcela pedida, ou menos (a entrada foi arredondada
    // para cima, e isso só derruba a parcela).
    for (const c of r) expect(c.parcela).toBeLessThanOrEqual(3_450 + 0.01);
  });

  it("⚠️ ordena pela MENOR ENTRADA — é ela que trava a venda", () => {
    // O cliente já disse que a parcela cabe; o que falta é o dinheiro de agora. Ordenar por total
    // pago colocaria na frente a proposta com a maior entrada, que é justamente a que ele não tem.
    const r = composicoesQueFecham({ parcelaAlvo: 3_450, planos: PLANOS, valor: 136_521 });
    const entradas = r.map((c) => c.entrada);
    expect([...entradas].sort((a, b) => a - b)).toEqual(entradas);
  });

  it("⚠️ parcela que já paga o lote não vira composição com entrada zero", () => {
    // 156 × 5.000 = 780 mil para um lote de 136 mil. Devolver "entrada zero" faria o corretor
    // prometer o que não existe; a resposta certa é não oferecer aquela composição.
    const r = composicoesQueFecham({ parcelaAlvo: 5_000, planos: PLANOS, valor: 136_521 });
    for (const c of r) expect(c.entrada).toBeGreaterThan(0);
  });

  it("⚠️ nenhuma composição fica abaixo do MÍNIMO de 10%", () => {
    // Lucas, 03/09/2026: *"lembrando que temos um valor mínimo de entrada, 10%"*. Antes disso a
    // varredura oferecia "entrada R$ 3.000" num lote de R$ 136.521 — 2%, que a casa não vende.
    const r = composicoesQueFecham({ parcelaAlvo: 3_450, planos: PLANOS, valor: 136_521 });
    expect(r.length).toBeGreaterThan(0);
    for (const c of r) expect(c.entrada).toBeGreaterThanOrEqual(entradaMinima(136_521));
    expect(ENTRADA_MINIMA_PERCENTUAL).toBe(10);
  });

  it("⚠️ parcela alta ANCORA no piso em vez de sumir, e a parcela cai junto", () => {
    // Com entrada no mínimo, a parcela sai MENOR que a pedida — é notícia boa, não motivo para
    // esconder a composição.
    const r = composicoesQueFecham({ parcelaAlvo: 4_000, planos: PLANOS, valor: 136_521 });
    expect(r.length).toBeGreaterThan(0);
    for (const c of r) expect(c.parcela).toBeLessThanOrEqual(4_000 + 0.01);
  });

  it("⚠️ o mínimo do EMPREENDIMENTO manda sobre o padrão da casa", () => {
    // Lucas, 03/09/2026: *"vamos ter um campo dentro da parte que vamos cadastrar a política
    // comercial e lá vamos apontar a % mínima"*. O Garden vende a 8% onde os outros exigem 10%.
    const r = composicoesQueFecham({
      entradaMinimaPercentual: 8,
      parcelaAlvo: 3_450,
      planos: PLANOS,
      valor: 136_521,
    });
    expect(r.length).toBeGreaterThan(0);
    for (const c of r) expect(c.entrada).toBeGreaterThanOrEqual(entradaMinima(136_521, 8));
  });

  it("⚠️ mínimo ZERO é uma decisão, e não vira o padrão da casa", () => {
    // Empreendimento que aceita venda sem entrada é cadastrável; tratar 0 como "não cadastrado"
    // desfaria essa decisão em silêncio.
    expect(entradaMinima(136_521, 0)).toBe(0);
    const r = composicoesQueFecham({
      entradaMinimaPercentual: 0,
      parcelaAlvo: 3_450,
      planos: PLANOS,
      valor: 136_521,
    });
    const minimaDelas = Math.min(...r.map((c) => c.entrada));
    expect(minimaDelas).toBeLessThan(entradaMinima(136_521));
  });

  it("nulo cai no padrão da casa", () => {
    expect(entradaMinima(136_521, null)).toBe(entradaMinima(136_521));
    expect(entradaMinima(136_521, undefined)).toBe(entradaMinima(136_521));
  });

  it("respeita o teto de entrada do cliente", () => {
    const r = composicoesQueFecham({
      parcelaAlvo: 3_450,
      planos: PLANOS,
      tetoDaEntrada: 30_000,
      valor: 136_521,
    });
    expect(r.length).toBeGreaterThan(0);
    for (const c of r) expect(c.entrada).toBeLessThanOrEqual(30_000);
  });

  it("o reforço anual baixa a entrada, e aparece como alternativa", () => {
    const r = composicoesQueFecham({ parcelaAlvo: 3_450, planos: PLANOS, valor: 136_521 });
    const comReforco = r.filter((c) => c.anuais.quantidade > 0);
    const semReforco = r.filter((c) => c.anuais.quantidade === 0);

    expect(comReforco.length).toBeGreaterThan(0);
    // Para o MESMO plano, a versão com reforço pede menos entrada.
    for (const c of comReforco) {
      const par = semReforco.find((s) => s.plano === c.plano);
      if (par) expect(c.entrada).toBeLessThanOrEqual(par.entrada);
    }
  });

  it("⚠️ a entrada sai arredondada para o milhar", () => {
    // "Entrada de R$ 27.304" é resultado de planilha; "R$ 28.000" é o que se fala numa mesa.
    const r = composicoesQueFecham({ parcelaAlvo: 3_450, planos: PLANOS, valor: 136_521 });
    for (const c of r) expect(c.entrada % 1_000).toBe(0);
  });

  it("cada composição fecha a conta: entrada + parcelas + reforços = total", () => {
    const r = composicoesQueFecham({ parcelaAlvo: 3_450, planos: PLANOS, valor: 136_521 });
    for (const c of r) {
      const conferida = montarProposta({
        baloesQuantidade: c.anuais.quantidade,
        baloesValor: c.anuais.valor,
        entrada: c.entrada,
        parcelas: c.parcelas,
        sistemaAmortizacao: "price",
        taxaAoMes: 0.0072,
        valor: 136_521,
      });
      expect(c.total).toBeCloseTo(conferida.total, 2);
    }
  });

  it("⚠️ o reforço anual não passa do PRAZO do plano", () => {
    // O k-ésimo reforço cai no mês 12k. Num plano de 24 meses cabem dois; oferecer cinco cobraria
    // dinheiro depois da última parcela, e a conta desconta esse dinheiro do saldo hoje.
    const r = composicoesQueFecham({ parcelaAlvo: 3_450, planos: PLANOS, valor: 136_521 });
    for (const c of r) {
      expect(c.anuais.quantidade).toBeLessThanOrEqual(Math.floor(c.parcelas / 12));
    }
  });

  it("sem parcela ou sem valor, não inventa nada", () => {
    expect(composicoesQueFecham({ parcelaAlvo: 0, planos: PLANOS, valor: 136_521 })).toEqual([]);
    expect(composicoesQueFecham({ parcelaAlvo: 3_450, planos: PLANOS, valor: 0 })).toEqual([]);
    expect(composicoesQueFecham({ parcelaAlvo: 3_450, planos: [], valor: 136_521 })).toEqual([]);
  });
});

describe("⚠️ composicoesQueFecham em SACOC — o plano de 21 dos 24 empreendimentos", () => {
  it("a parcela de volta é a amortização pura do saldo, e não a Price", () => {
    // A composição que a lista devolve tem que ser a mesma que o cronograma vai emitir: sem isto, o
    // corretor lê uma parcela no cartão e o PDF gerado em seguida traz outra.
    const r = composicoesQueFecham({ parcelaAlvo: 3_450, planos: PLANOS_SACOC, valor: 136_521 });

    expect(r.length).toBeGreaterThan(0);
    for (const c of r) {
      const vp = valorPresenteDosBaloes(c.anuais.quantidade, c.anuais.valor, 0.0072);
      expect(c.parcela).toBeCloseTo((136_521 - c.entrada - vp) / c.parcelas, 2);
      expect(c.parcela).toBeLessThanOrEqual(3_450 + 0.01);
    }
  });

  it("⚠️ para a MESMA parcela, o SACOC pede muito menos entrada que a conta antiga", () => {
    // O cenário medido em 04/09/2026: lote de R$ 200.000, cliente que pode pagar R$ 1.500 por mês,
    // 120 meses a 8% a.a. Em SACOC 120 × 1.500 amortizam R$ 180.000 e a entrada é R$ 20.000; pela
    // inversão da Price — a que a varredura usava para todo mundo — a mesma parcela pedia mais de
    // R$ 70 mil de entrada, e a lista escondia a proposta que a casa de fato vende.
    const plano = { entradaPercentual: 10, nome: "Normal", parcelas: 120, taxaAoMes: 0.0064340 };
    const sacoc = composicoesQueFecham({
      anuaisPossiveis: [0],
      parcelaAlvo: 1_500,
      planos: [{ ...plano, sistemaAmortizacao: "sacoc" }],
      valor: 200_000,
    });
    const price = composicoesQueFecham({
      anuaisPossiveis: [0],
      parcelaAlvo: 1_500,
      planos: [{ ...plano, sistemaAmortizacao: "price" }],
      valor: 200_000,
    });

    expect(sacoc[0]?.entrada).toBe(20_000);
    expect(sacoc[0]?.parcela).toBeCloseTo(1_500, 2);
    expect(price[0]?.entrada).toBeGreaterThan(70_000);
  });

  it("⚠️ parcela que amortiza o lote inteiro antes do prazo não vira composição", () => {
    // 156 × 3.450 = R$ 538.200 amortizados num lote de R$ 136.521: em SACOC essa parcela paga o
    // lote quatro vezes. O plano longo SAI da lista, em vez de aparecer com entrada zero.
    const r = composicoesQueFecham({ parcelaAlvo: 3_450, planos: PLANOS_SACOC, valor: 136_521 });
    expect(r.some((c) => c.parcelas === 156)).toBe(false);
    for (const c of r) expect(c.entrada).toBeGreaterThan(0);
  });

  it("⚠️ o total soma a série inteira, com o degrau do aniversário dentro", () => {
    // `parcela × prazo` esconderia os juros que o SACOC cobra a partir do 13º mês — e a lista
    // ordena o desempate por total.
    const r = composicoesQueFecham({ parcelaAlvo: 3_450, planos: PLANOS_SACOC, valor: 136_521 });
    for (const c of r) {
      const face = c.anuais.quantidade * c.anuais.valor;
      expect(c.total).toBeGreaterThan(c.entrada + c.parcela * c.parcelas + face);
    }
  });
});

describe("⚠️ o financiado da composição é o mesmo que o PDF imprime", () => {
  it("desconta o valor presente dos reforços, e não o valor de face", () => {
    // O defeito que isto prende: a tela mostrava `valor − entrada` no cartão "A financiar" e o PDF
    // imprimia o saldo com os balões descontados a valor presente. Na mesma venda, com 3 reforços
    // de R$ 15.000 num contrato de 120 meses, eram R$ 38.656 de diferença entre o número que o
    // coordenador leu na mesa e o que o comprador recebeu no papel.
    const r = composicoesQueFecham({
      parcelaAlvo: 1_200,
      planos: PLANOS_SACOC,
      valor: 200_000,
    });

    const comReforco = r.filter((c) => c.anuais.quantidade > 0);
    expect(comReforco.length).toBeGreaterThan(0);

    for (const c of comReforco) {
      // O financiado é MENOR que `valor − entrada`, porque os balões abatem parte do saldo…
      expect(c.financiado).toBeLessThan(200_000 - c.entrada);
      // …e é exatamente `valor − entrada − valorPresenteDosBaloes`, que é a conta do cronograma.
      const plano = PLANOS_SACOC.find((p) => p.nome === c.plano);
      expect(plano).toBeDefined();
      const presente = valorPresenteDosBaloes(
        c.anuais.quantidade,
        c.anuais.valor,
        plano?.taxaAoMes ?? 0,
      );
      expect(c.financiado).toBeCloseTo(200_000 - c.entrada - presente, 2);
    }
  });

  it("no SACOC a parcela anunciada é o financiado dividido pelo prazo", () => {
    // A contradição que isto prende: o cartão mostrava saldo de R$ 180.000 e, logo abaixo, parcela
    // de R$ 1.384,26 — mas 180.000 ÷ 120 é R$ 1.500,00. Os dois números do mesmo cartão não
    // fechavam entre si, porque só um deles conhecia os reforços.
    const r = composicoesQueFecham({ parcelaAlvo: 1_500, planos: PLANOS_SACOC, valor: 200_000 });
    for (const c of r) expect(c.parcela).toBeCloseTo(c.financiado / c.parcelas, 2);
  });
});
