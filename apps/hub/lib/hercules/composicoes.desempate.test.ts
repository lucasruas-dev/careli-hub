import { describe, expect, it } from "vitest";

import { taxaMensal } from "@/lib/apolo/planos-comerciais";

import { composicoesQueFecham, type PlanoDaComposicao } from "./composicoes";

// O DESEMPATE DA LISTA DE COMPOSIÇÕES — qual linha vira a RECOMENDADA.
//
// ⚠️ O QUE ESTE ARQUIVO PROTEGE É O CARTÃO GRANDE. `composicoes[0]` é o `principal` do simulador: a
// entrada, o reforço e a parcela que o corretor lê em voz alta e promete ao cliente. Até 22/09/2026
// a ordem era `a.entrada - b.entrada || a.total - b.total`, e o segundo critério fazia trabalho de
// verdade porque o `total` ainda era a soma das mensais com o degrau do SACOC dentro. Quando o total
// passou a fechar com o preço do lote, todas as composições do mesmo plano passaram a somar o MESMO
// número: o desempate virou empate, e a primeira linha passou a sair da ordem de geração — os
// valores de `anuaisPossiveis` na ordem em que estão escritos no módulo.
//
// Os números abaixo são os do Garden (lote de R$ 435.000, três planos como `temis_planos` os tem em
// 18/09/2026), medidos rodando a própria `composicoesQueFecham`.

/** 6% ao ano, equivalente — a taxa dos planos do Garden, convertida pela régua da casa. */
const AO_MES = (aoAno: number) =>
  taxaMensal({
    jurosConvencao: "equivalente",
    jurosPeriodicidade: "anual",
    jurosTaxa: aoAno,
  } as Parameters<typeof taxaMensal>[0]);

const GARDEN: PlanoDaComposicao[] = [
  {
    anuaisQuantidade: 5,
    anuaisValor: 25_000,
    descontoPercentual: 0,
    entradaPercentual: 10,
    nome: "NORMAL",
    parcelas: 60,
    sistemaAmortizacao: "sacoc",
    taxaAoMes: AO_MES(6),
  },
  {
    anuaisQuantidade: 4,
    anuaisValor: 25_000,
    descontoPercentual: 8,
    entradaPercentual: 8,
    nome: "INVESTIDOR PARCELADO",
    parcelas: 84,
    sistemaAmortizacao: "sacoc",
    taxaAoMes: AO_MES(6),
  },
  {
    anuaisQuantidade: 3,
    anuaisValor: 30_000,
    descontoPercentual: 12,
    entradaPercentual: 40,
    nome: "INVESTIDOR",
    parcelas: 36,
    sistemaAmortizacao: "sacoc",
    taxaAoMes: AO_MES(0),
  },
];

const noGarden = (parcelaAlvo: number) =>
  composicoesQueFecham({
    entradaMinimaPercentual: 8,
    parcelaAlvo,
    planos: GARDEN,
    precoDeTabela: 435_000,
    valor: 435_000,
  });

const centavos = (v: number) => Math.round(v * 100);
const recomendada = (parcelaAlvo: number) => noGarden(parcelaAlvo)[0]!;

describe("a composição RECOMENDADA do Garden: empate de entrada e de total, desempate na parcela", () => {
  // Os três alvos que TROCARAM de primeira linha quando o desempate por parcela entrou. Em todos,
  // as duas candidatas têm a MESMA entrada e o MESMO total: sem o terceiro critério, quem ficava na
  // frente era a que a varredura gerou primeiro.
  it("R$ 3.500: 4 anuais de R$ 25.000 com parcela R$ 3.180,95, e não 5 de R$ 15.000 com R$ 3.478,57", () => {
    const c = recomendada(3_500);
    expect(c.plano).toBe("INVESTIDOR PARCELADO");
    expect(c.anuais).toEqual({ quantidade: 4, valor: 25_000 });
    expect(c.entrada).toBe(33_000);
    expect(centavos(c.parcela)).toBe(centavos(3_180.95));

    // A perdedora continua na lista, logo atrás, com a mesma entrada e o mesmo total: é isso que
    // fazia a escolha cair na ordem de geração.
    const segunda = noGarden(3_500)[1]!;
    expect(segunda.anuais).toEqual({ quantidade: 5, valor: 15_000 });
    expect(segunda.entrada).toBe(c.entrada);
    expect(centavos(segunda.total)).toBe(centavos(c.total));
    expect(centavos(segunda.parcela)).toBe(centavos(3_478.57));
  });

  it("R$ 4.500: 1 anual de R$ 15.000 com parcela R$ 4.192,86, e não a sem reforço com R$ 4.371,43", () => {
    const c = recomendada(4_500);
    expect(c.plano).toBe("INVESTIDOR PARCELADO");
    expect(c.anuais).toEqual({ quantidade: 1, valor: 15_000 });
    expect(c.entrada).toBe(33_000);
    expect(centavos(c.parcela)).toBe(centavos(4_192.86));
  });

  it("R$ 5.000: 5 anuais de R$ 25.000 com parcela R$ 4.433,33, e não 5 de R$ 20.000 com R$ 4.850,00", () => {
    const c = recomendada(5_000);
    expect(c.plano).toBe("NORMAL");
    expect(c.anuais).toEqual({ quantidade: 5, valor: 25_000 });
    expect(c.entrada).toBe(44_000);
    expect(centavos(c.parcela)).toBe(centavos(4_433.33));
  });

  it("R$ 7.000: 1 anual de R$ 15.000 com parcela R$ 6.266,67, e não a sem reforço com R$ 6.516,67", () => {
    const c = recomendada(7_000);
    expect(c.plano).toBe("NORMAL");
    expect(c.anuais).toEqual({ quantidade: 1, valor: 15_000 });
    expect(c.entrada).toBe(44_000);
    expect(centavos(c.parcela)).toBe(centavos(6_266.67));
  });

  // Os alvos em que a entrada já separava as candidatas: nada muda, e é o que se quer — o critério
  // novo é o TERCEIRO, não um critério novo por cima dos dois que sempre mandaram.
  it("a menor entrada continua mandando: nos outros seis alvos a recomendada é a mesma de antes", () => {
    expect(
      [2_500, 3_000, 4_000, 5_500, 6_000, 6_500].map((alvo) => {
        const c = recomendada(alvo);
        return `${c.plano} ${c.anuais.quantidade}x${c.anuais.valor} ent=${c.entrada}`;
      }),
    ).toEqual([
      "INVESTIDOR PARCELADO 6x30000 ent=33000",
      "INVESTIDOR PARCELADO 6x20000 ent=33000",
      "INVESTIDOR PARCELADO 3x15000 ent=33000",
      "NORMAL 5x15000 ent=44000",
      "NORMAL 3x15000 ent=44000",
      "NORMAL 1x15000 ent=44000",
    ]);
  });

  it("⚠️ a recomendada é DETERMINÍSTICA: a lista inteira sai igual com os planos em qualquer ordem", () => {
    const chave = (c: ReturnType<typeof noGarden>[number]) =>
      `${c.plano}|${c.anuais.quantidade}x${c.anuais.valor}|${c.entrada}|${centavos(c.total)}|${centavos(c.parcela)}`;

    for (const alvo of [2_500, 3_000, 3_500, 4_000, 4_500, 5_000, 5_500, 6_000, 6_500, 7_000]) {
      const daCasa = composicoesQueFecham({
        entradaMinimaPercentual: 8,
        parcelaAlvo: alvo,
        planos: GARDEN,
        precoDeTabela: 435_000,
        valor: 435_000,
      });
      // ⚠️ A ORDEM DOS PLANOS NÃO É CONTRATO: ela vem do `order('ordem')` do banco de um lado e da
      // ordem do legado do outro. Se ela mexer na recomendada, a mesma busca responde diferente em
      // dois empreendimentos que vendem a mesma coisa.
      const deTrasParaFrente = composicoesQueFecham({
        entradaMinimaPercentual: 8,
        parcelaAlvo: alvo,
        planos: [...GARDEN].reverse(),
        precoDeTabela: 435_000,
        valor: 435_000,
      });
      expect(deTrasParaFrente.map(chave)).toEqual(daCasa.map(chave));
    }
  });
});
