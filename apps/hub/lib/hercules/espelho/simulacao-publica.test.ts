import { describe, expect, it } from "vitest";

import { precoNoPlano } from "../ajuste-de-preco";
import { entradaMinima } from "../composicoes";
import { pisoDaEntradaNoPrazo } from "../faixa-do-plano";
import { ENTRADA_VEZES_MAXIMA } from "../proposta";
import { descontoDoPlanoNoPrazo } from "../tabela-do-lote";
import { valoresDaSimulacaoPublica } from "./simulacao-publica";

// O que a rota pública do PDF da simulação aceita: o valor até a tabela, sem piso; o prazo até o do
// plano; as anuais até uma por aniversário; a entrada que vier da tela; a entrada em 1 a
// `ENTRADA_VEZES_MAXIMA` vezes.
//
// ⚠️ O PISO DO PREÇO SAIU DE VEZ EM 23/09/2026, EM DOIS PASSOS NO MESMO DIA. Até a revisão 3 (18/09)
// ele era o preço do PLANO ESCOLHIDO no prazo pedido, e o número da tela era PRESO nele; com o campo
// de desconto liberado no espelho público (Lucas: **"Liberar para todo mundo"**), prender viraria a
// folha desmentindo a tela em silêncio, e o piso virou um teto de desconto de 15%; perguntado sobre
// o teto, Lucas: **"pode liberar tudo"**, e o teto saiu também. Hoje NÃO HÁ PISO: desconto de
// qualquer tamanho passa, e o número da tela vai ao papel como está.
//
// ⚠️ O QUE NÃO SAIU, E ESTE ARQUIVO GUARDA: preço ACIMA da tabela é RECUSA (não é desconto, é a
// página anunciando a unidade mais cara do que a casa vende); lixo, negativo, zero ou ausente é a
// tabela; o prazo, as anuais e a entrada continuam presos no plano. Os casos da liberação estão em
// `simulacao-publica.desconto-liberado.test.ts`.

const NORMAL = {
  anuaisQuantidade: 5,
  anuaisValor: 25_000,
  descontoPercentual: 0,
  entradaPercentual: 10,
  nome: "NORMAL",
  parcelas: 60,
};
const PARCELADO = {
  anuaisQuantidade: 4,
  anuaisValor: 25_000,
  descontoPercentual: 8,
  entradaPercentual: 8,
  nome: "INVESTIDOR PARCELADO",
  parcelas: 84,
};
const INVESTIDOR = {
  anuaisQuantidade: 3,
  anuaisValor: 30_000,
  descontoPercentual: 12,
  entradaPercentual: 40,
  nome: "INVESTIDOR",
  parcelas: 36,
};
const GARDEN = [NORMAL, PARCELADO, INVESTIDOR];

type Pedido = {
  anuais?: { quantidade?: unknown; valor?: unknown };
  entrada?: unknown;
  parcelas?: unknown;
  piso?: null | number;
  plano?: typeof NORMAL;
  tabela?: number;
  valor?: unknown;
};

const aceito = (p: Pedido) => {
  const r = valoresDaSimulacaoPublica({
    anuaisPedidas: p.anuais,
    entradaMinimaPercentual: p.piso === undefined ? 8 : p.piso,
    entradaPedida: p.entrada,
    parcelasPedidas: p.parcelas,
    plano: p.plano ?? PARCELADO,
    planos: GARDEN,
    precoDeTabela: p.tabela ?? 421_500,
    valorPedido: p.valor,
  });
  if (!r.ok) throw new Error(r.mensagem);
  return r;
};

describe("valoresDaSimulacaoPublica: o preço (item 2)", () => {
  it("o preço do plano passa intacto, com os centavos", () => {
    // INVESTIDOR PARCELADO: 421.500 × 0,92 = 387.780; a entrada do plano arredondada para cima.
    expect(aceito({ entrada: 31_023, valor: 387_780 })).toMatchObject({
      entrada: 31_023,
      valor: 387_780,
    });
    // ⚠️ O CENTAVO ABAIXO DO PREÇO DO PLANO ERA EMPURRADO PARA 387.780 ATÉ 22/09/2026, porque o
    // preço do plano era o piso. Agora ele é um desconto à mão de 8,000002%, cabe no teto e vai ao
    // papel como está: é o número que a tela mostrou.
    expect(aceito({ entrada: 31_022.4, valor: 387_779.99 })).toMatchObject({
      entrada: 31_022.4,
      valor: 387_779.99,
    });
  });

  it("⚠️ o piso do preço acabou: metade do preço passa nos três planos, e o desconto do plano continua sendo lido", () => {
    // ⚠️ A PRIMEIRA METADE DESTE CASO VIROU DE LADO EM 23/09/2026, E É DECISÃO DO LUCAS. Ela pedia
    // recusa com a frase "15% de desconto" para os R$ 210.750 (50% de R$ 421.500); antes disso, na
    // revisão 3, ela pedia que o valor fosse EMPURRADO para o preço de cada plano. Perguntado com o
    // risco escrito na frente, Lucas: *"Liberar para todo mundo"* e, sobre o teto, **"pode liberar
    // tudo"**. Quem reintroduzir piso ou teto aqui está desfazendo a decisão dele.
    for (const plano of GARDEN)
      expect(aceito({ parcelas: plano.parcelas, plano, valor: 210_750 }).valor).toBe(210_750);
    // ⚠️ E A SEGUNDA METADE É A COBERTURA QUE NÃO PODE SE PERDER COM A PRIMEIRA: o desconto DO
    // PLANO continua sendo lido no prazo do plano, porque é ele que a folha chama de desconto de
    // tabela — e é o que separa "a casa deu 12%" de "alguém digitou 12% na página sem login".
    expect(aceito({ plano: PARCELADO, valor: 387_780 }).descontoPercentual).toBe(8);
    expect(aceito({ parcelas: 36, plano: INVESTIDOR, valor: 370_920 }).descontoPercentual).toBe(12);
    expect(aceito({ parcelas: 60, plano: NORMAL, valor: 421_500 }).descontoPercentual).toBe(0);
  });

  it("⚠️ fora do prazo do plano o desconto do plano zera, e o preço da tela passa inteiro", () => {
    // INVESTIDOR encurtado para 30 vezes: os 12% são de 36 vezes, então aqui eles são desconto à
    // MÃO. Até 22/09/2026 o valor era empurrado de volta para a tabela; agora ele passa — e o que a
    // folha não pode é chamar isso de desconto de tabela.
    const r = aceito({ parcelas: 30, plano: INVESTIDOR, valor: 370_920 });
    expect(r.descontoPercentual).toBe(0);
    expect(r.valor).toBe(370_920);
    // INVESTIDOR PARCELADO em 60 vezes: idem.
    expect(aceito({ parcelas: 60, valor: 387_780 }).valor).toBe(387_780);
    // No prazo do plano, o desconto dele.
    expect(aceito({ parcelas: 84, valor: 387_780 })).toMatchObject({
      descontoPercentual: 8,
      valor: 387_780,
    });
    // ⚠️ ESTAS DUAS LINHAS MEDIAM O TETO DE 15% FORA DO PRAZO DO PLANO (421.500 × 0,85 = 358.275:
    // o valor passava, o centavo abaixo dele era recusa). O teto saiu em 23/09/2026 por decisão do
    // Lucas (**"pode liberar tudo"**), e as duas passam a medir o que sobrou no lugar dele: fora do
    // prazo do plano NÃO há piso nenhum, e o centavo continua não sendo arredondado no caminho.
    expect(aceito({ parcelas: 30, plano: INVESTIDOR, valor: 358_275 }).valor).toBe(358_275);
    expect(aceito({ parcelas: 30, plano: INVESTIDOR, valor: 358_274.99 }).valor).toBe(358_274.99);
  });

  it("acima da tabela é RECUSA, e não uma descida silenciosa; lixo, negativo, zero ou ausente é a tabela", () => {
    // ⚠️ MUDOU EM 23/09/2026 JUNTO COM O CAMPO. Enquanto o campo do lote era somente leitura no
    // espelho, a tela não tinha como pedir mais que a tabela e prender era inofensivo. Com o botão
    // de acréscimo à mão de qualquer visitante, prender viraria a mesma troca silenciosa do piso.
    expect(() => aceito({ valor: 1_000_000 })).toThrow(/tabela/);
    for (const valor of [undefined, "abc", -5, 0])
      expect(aceito({ valor }).valor).toBe(421_500);
  });
});

describe("valoresDaSimulacaoPublica: as regras do plano (item 3)", () => {
  it("⚠️ a entrada é o MAIOR entre o piso do empreendimento e a faixa do prazo (no Garden, a do plano no prazo dele)", () => {
    // INVESTIDOR, R$ 435.000 com 12%: a faixa de 36 é o próprio INVESTIDOR, 40% de 382.800 = 153.120
    // (o piso de 8% seria 30.624).
    expect(
      aceito({ entrada: undefined, plano: INVESTIDOR, tabela: 435_000, valor: 382_800 })
        .entrada,
    ).toBe(153_120);
    // INVESTIDOR PARCELADO: 8% do preço do plano, em centavos (421.500 → 387.780 → 31.022,40).
    expect(aceito({ entrada: undefined, valor: 387_780 }).entrada).toBe(31_022.4);
    // Nunca acima do valor.
    expect(aceito({ entrada: 999_999, valor: 387_780 }).entrada).toBe(387_780);
  });

  it("o piso do empreendimento vale quando é maior que o do plano; nulo é o padrão da casa (10%)", () => {
    expect(aceito({ entrada: undefined, piso: null, valor: 387_780 }).entrada).toBe(
      38_778,
    );
    expect(aceito({ entrada: undefined, piso: 15, valor: 387_780 }).entrada).toBe(
      58_167,
    );
  });

  it("⚠️ prazo encurtado cai no degrau da tabela (a faixa do prazo, a mesma régua da tela)", () => {
    // INVESTIDOR PARCELADO em 50 vezes: o degrau de 50 é o NORMAL (60x, 10%), sem o desconto do plano.
    expect(aceito({ entrada: undefined, parcelas: 50 }).entrada).toBe(42_150);
    // NORMAL em 24 vezes: o degrau é o INVESTIDOR (40%).
    expect(aceito({ entrada: undefined, parcelas: 24, plano: NORMAL }).entrada).toBe(
      168_600,
    );
  });

  it("⚠️ as anuais vão até uma por aniversário do prazo", () => {
    expect(
      aceito({ anuais: { quantidade: 10, valor: 10_000 }, plano: INVESTIDOR })
        .anuais,
    ).toEqual({
      quantidade: 3,
      valor: 10_000,
    });
    expect(
      aceito({
        anuais: { quantidade: 10, valor: 10_000 },
        parcelas: 30,
        plano: INVESTIDOR,
      }).anuais,
    ).toEqual({
      quantidade: 2,
      valor: 10_000,
    });
    // Ausentes: as do plano. Zero: nenhuma.
    expect(aceito({}).anuais).toEqual({ quantidade: 4, valor: 25_000 });
    expect(aceito({ anuais: { quantidade: 0, valor: 25_000 } }).anuais).toEqual(
      { quantidade: 0, valor: 0 },
    );
    // Prazo de menos de um ano não tem aniversário.
    expect(aceito({ anuais: { quantidade: 3 }, parcelas: 11 }).anuais).toEqual({
      quantidade: 0,
      valor: 0,
    });
  });

  it("⚠️ prazo além do plano é recusado, com a frase que diz até onde ele vai", () => {
    const r = valoresDaSimulacaoPublica({
      entradaMinimaPercentual: 8,
      entradaPedida: 0,
      parcelasPedidas: 180,
      plano: INVESTIDOR,
      planos: GARDEN,
      precoDeTabela: 435_000,
      valorPedido: 382_800,
    });
    expect(r).toEqual({
      mensagem:
        "O plano INVESTIDOR vai até 36 parcelas. Para um prazo maior, escolha outro plano.",
      ok: false,
    });
  });

  it("prazo ausente, zero ou lixo é o do plano", () => {
    for (const parcelas of [undefined, 0, "abc", -3])
      expect(aceito({ parcelas }).parcelas).toBe(84);
  });

  it("empreendimento sem desconto e sem anual: o valor é a tabela e a entrada, a pedida acima do piso", () => {
    const CURTO = {
      anuaisQuantidade: 0,
      anuaisValor: 0,
      descontoPercentual: 0,
      entradaPercentual: 20,
      nome: "Curto",
      parcelas: 36,
    };
    const r = valoresDaSimulacaoPublica({
      entradaMinimaPercentual: 10,
      entradaPedida: 40_000,
      plano: CURTO,
      planos: [CURTO],
      precoDeTabela: 185_400.5,
      // ⚠️ ERA `100_000` ATÉ 23/09/2026, quando o piso empurrava qualquer valor de volta ao preço do
      // plano. Com o teto de 15%, 100.000 num lote de 185.400,50 é 46% de desconto e vira recusa —
      // o que este caso mede é o empreendimento SEM desconto, e para isso o valor da tela é a tabela.
      valorPedido: 185_400.5,
    });
    expect(r).toEqual({
      anuais: { quantidade: 0, valor: 0 },
      // ⚠️ VAZIA, E NÃO AUSENTE (23/09/2026): o corpo não mandou bem nenhum, e a régua devolve a
      // lista conferida mesmo assim. Esta é a única asserção de FORMA INTEIRA da resposta, e é por
      // ela que um campo novo aparece na revisão em vez de passar despercebido.
      bens: [],
      descontoPercentual: 0,
      entrada: 40_000,
      // Sem montagem à mão no corpo, a entrada em vezes é repartida pelo cronograma como sempre, e
      // as datas são as calculadas.
      entradaDatas: null,
      entradaParcelas: null,
      entradaVezes: 1,
      ok: true,
      parcelas: 36,
      valor: 185_400.5,
    });
  });

  it("⚠️ escada irregular (o 20): o Curto encurtado para 24 vezes cai na faixa do Investidor, e a entrada é a da tela", () => {
    // SELECT em temis_planos (18/09/2026): Investidor 24x 0%, Curto 36x 20%, Normal 120x 10%; piso 10%.
    const INVESTIDOR_20 = { anuaisQuantidade: 0, anuaisValor: 0, descontoPercentual: 0, entradaPercentual: 0, nome: "Investidor", parcelas: 24 };
    const CURTO_20 = { ...INVESTIDOR_20, entradaPercentual: 20, nome: "Curto", parcelas: 36 };
    const NORMAL_20 = { ...INVESTIDOR_20, entradaPercentual: 10, nome: "Normal", parcelas: 120 };
    const doVinte = (parcelasPedidas: number, entradaPedida: unknown) =>
      valoresDaSimulacaoPublica({
        entradaMinimaPercentual: 10,
        entradaPedida,
        parcelasPedidas,
        plano: CURTO_20,
        planos: [INVESTIDOR_20, CURTO_20, NORMAL_20],
        precoDeTabela: 92_900,
        valorPedido: 92_900,
      });
    // Na primeira versão da rodada 3 saía R$ 18.580 (os 20% do Curto), contra R$ 9.290 na tela.
    expect(doVinte(24, 9_290)).toMatchObject({ entrada: 9_290, ok: true, parcelas: 24 });
    expect(doVinte(24, undefined)).toMatchObject({ entrada: 9_290, ok: true });
    // ⚠️ E DESDE 22/09/2026 A ENTRADA DIGITADA MANDA TAMBÉM NO PRAZO DO PLANO. Aqui o Curto em 36
    // vezes sugere os 20% (R$ 18.580), mas quem digitou R$ 9.290 recebe a folha com R$ 9.290: era
    // exatamente este empurrão, no Cecílio Rocha, que trocava a entrada do corretor no papel. A
    // sugestão continua existindo para quem NÃO escolheu (a chave ausente, logo abaixo).
    expect(doVinte(36, 9_290)).toMatchObject({ entrada: 9_290, ok: true });
    expect(doVinte(36, undefined)).toMatchObject({ entrada: 18_580, ok: true });
  });
});

describe("valoresDaSimulacaoPublica: a entrada é a régua da tela, em todo plano real (revisão de 18/09/2026)", () => {
  // ⚠️ O QUE A TELA ACEITA SEM O AVISO "ABAIXO DO MÍNIMO" É O QUE A FOLHA IMPRIME. Os planos ATIVOS de
  // `temis_planos` (os que o espelho mostra), o piso de `apolo_enterprise_settings` e um lote real
  // disponível de cada empreendimento (SELECT de 18/09/2026). A primeira versão da rodada 3 subia a
  // entrada da tela em 72 destas combinações (24 no 20, 12 no 29, 12 no 38 e 24 no 42).
  type P = [nome: string, parcelas: number, entrada: number, desconto?: number];
  const EMPREENDIMENTOS: Array<{ emp: string; piso: null | number; planos: P[]; tabela: number }> = [
    { emp: "19", piso: 10, planos: [["CURTO", 36, 10], ["INVESTIDOR", 24, 10], ["NORMAL - PRICE", 168, 10], ["NORMAL - SACOC", 168, 10]], tabela: 213_064 },
    { emp: "20", piso: 10, planos: [["Curto", 36, 20], ["Investidor", 24, 0], ["Normal", 120, 10]], tabela: 92_900 },
    { emp: "27", piso: 12, planos: [["INVESTIDOR 01", 36, 20], ["INVESTIDOR 02", 48, 12], ["NORMAL 01", 72, 12], ["NORMAL 02", 120, 12]], tabela: 575_081.63 },
    { emp: "29", piso: 10, planos: [["CURTO", 24, 30], ["INVESTIDOR", 12, 20], ["NORMAL", 120, 10]], tabela: 79_900 },
    { emp: "33", piso: null, planos: [["INVESTIDOR 01", 36, 20], ["INVESTIDOR 02", 48, 20], ["NORMAL 01", 72, 20], ["NORMAL 02", 120, 12]], tabela: 434_907 },
    { emp: "35", piso: 10, planos: [["CURTO", 36, 20], ["INVESTIDOR", 24, 20], ["NORMAL", 156, 10]], tabela: 143_451 },
    { emp: "38", piso: 10, planos: [["CURTO", 24, 30], ["INVESTIDOR", 12, 20], ["NORMAL", 180, 10]], tabela: 220_000 },
    { emp: "39", piso: 8, planos: [["NORMAL", 60, 10, 0], ["INVESTIDOR PARCELADO", 84, 8, 8], ["INVESTIDOR", 36, 40, 12]], tabela: 421_500 },
    { emp: "40", piso: 10, planos: [["Curto", 36, 20], ["Investidor", 24, 20]], tabela: 304_515 },
    { emp: "42", piso: 0, planos: [["Curto", 36, 30], ["Investidor", 12, 0], ["Normal - Price", 120, 10]], tabela: 253_000 },
    { emp: "9001", piso: 10, planos: [["CURTO", 36, 10], ["INVESTIDOR", 24, 10], ["NORMAL - PRICE", 168, 10], ["NORMAL - SACOC", 168, 10]], tabela: 150_000 },
  ];

  it("em todo plano × prazo de todos os empreendimentos, a entrada da folha é a mínima da tela", () => {
    let combinacoes = 0;
    const divergentes: string[] = [];
    for (const { emp, piso, planos: linhas, tabela } of EMPREENDIMENTOS) {
      const planos = linhas.map(([nome, parcelas, entradaPercentual, descontoPercentual = 0]) => ({
        anuaisQuantidade: 0,
        anuaisValor: 0,
        descontoPercentual,
        entradaPercentual,
        nome,
        parcelas,
      }));
      for (const plano of planos) {
        for (let prazo = 1; prazo <= plano.parcelas; prazo += 1) {
          // O preço que a tela manda: a tabela com o desconto do plano no prazo dele (só o Garden tem).
          const valor = precoNoPlano(
            tabela,
            descontoDoPlanoNoPrazo({
              descontoDoPlano: plano.descontoPercentual,
              parcelasDoPlano: plano.parcelas,
              parcelasEfetivas: prazo,
            }),
          );
          // A régua do simulador (`pisoDoPrazo`, SimuladorDeProposta.tsx), escrita como ele a escreve.
          const daTela = pisoDaEntradaNoPrazo({
            parcelas: prazo,
            pisoDaCasaEmReais: entradaMinima(valor, piso),
            planos,
            valorNegociado: valor,
          }).emReais;
          for (const pedida of [daTela, undefined]) {
            const r = valoresDaSimulacaoPublica({
              entradaMinimaPercentual: piso,
              entradaPedida: pedida,
              parcelasPedidas: prazo,
              plano,
              planos,
              precoDeTabela: tabela,
              valorPedido: valor,
            });
            combinacoes += 1;
            if (!r.ok || r.valor !== valor || Math.round(r.entrada * 100) !== Math.round(daTela * 100))
              divergentes.push(
                `${emp} ${plano.nome} em ${prazo}x: tela ${daTela}, folha ${r.ok ? r.entrada : r.mensagem}`,
              );
          }
        }
      }
    }
    expect(combinacoes).toBeGreaterThan(5_000);
    expect(divergentes).toEqual([]);
  });
});

describe("valoresDaSimulacaoPublica: a entrada em vezes (revisão de 18/09/2026)", () => {
  const vezes = (entradaVezesPedidas: unknown) =>
    valoresDaSimulacaoPublica({
      entradaMinimaPercentual: 8,
      entradaPedida: 32_016,
      entradaVezesPedidas,
      plano: PARCELADO,
      planos: GARDEN,
      precoDeTabela: 435_000,
      valorPedido: 400_200,
    });

  it("o teto é o do contador da tela (12)", () => {
    expect(ENTRADA_VEZES_MAXIMA).toBe(12);
  });

  it("dentro do teto passa intacto; acima, preso ao teto (84, 240, 20.000, 1e10)", () => {
    for (const [pedida, esperada] of [
      [1, 1],
      [2, 2],
      [12, 12],
      ["6", 6],
      [3.6, 4],
      [13, 12],
      [84, 12],
      [240, 12],
      [20_000, 12],
      [1e10, 12],
    ] as const) {
      expect(vezes(pedida)).toMatchObject({ entradaVezes: esperada, ok: true });
    }
  });

  it("ausente, zero, negativo ou lixo é à vista (1)", () => {
    for (const pedida of [undefined, null, "", 0, -3, "abc", Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      expect(vezes(pedida)).toMatchObject({ entradaVezes: 1, ok: true });
    }
  });
});
