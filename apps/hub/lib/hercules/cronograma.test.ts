import { describe, expect, it } from "vitest";

import { type PlanoComercial, taxaMensal } from "@/lib/apolo/planos-comerciais";
import { montarProposta } from "@/lib/hercules/simulacao";

import { montarCronograma, repartirEmPartesIguais } from "./cronograma";

/** O plano mais comum da casa: SACOC, sem juros — 21 dos 24 empreendimentos são SACOC. */
const SACOC_SEM_JUROS: PlanoComercial = {
  entradaPercentual: 10,
  indiceCorrecao: "IPCA_ANUAL",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  jurosTaxa: null,
  nome: "NORMAL",
  parcelas: 120,
  sistemaAmortizacao: "sacoc",
  slot: "normal",
};

/** O mesmo plano com os 8% ao ano da Lavra do Ouro — o que faz a parcela subir de degrau. */
const SACOC_COM_JUROS: PlanoComercial = { ...SACOC_SEM_JUROS, jurosTaxa: 8 };

const PRICE: PlanoComercial = { ...SACOC_SEM_JUROS, jurosTaxa: 8, sistemaAmortizacao: "price" };

/** O caso que o Lucas ditou: lote de 100 mil, 10% de entrada em 2×, vencimento no dia 10. */
const EXEMPLO_DO_LUCAS = {
  anuaisQuantidade: 0,
  anuaisValor: 0,
  diaDeVencimento: 10,
  entradaValor: 10_000,
  entradaVezes: 2,
  parcelasMensais: 120,
  plano: SACOC_SEM_JUROS,
  primeiraParcelaDaEntrada: "2026-10-10",
  valorNegociado: 100_000,
};

describe("montarCronograma — o exemplo que o Lucas ditou", () => {
  it("10 mil em 2× sai 5 mil em 10/10 e 5 mil em 10/11, e a primeira mensal cai em 10/12", () => {
    const c = montarCronograma(EXEMPLO_DO_LUCAS);

    expect(c.entrada).toEqual([
      { numero: 1, total: 2, valor: 5_000, vencimento: "2026-10-10" },
      { numero: 2, total: 2, valor: 5_000, vencimento: "2026-11-10" },
    ]);
    // A mensal nasce no mês seguinte à ÚLTIMA da entrada, e não à primeira.
    expect(c.mensais[0]).toEqual({ numero: 1, total: 120, valor: 750, vencimento: "2026-12-10" });
  });

  it("a entrada NÃO é descontada a valor presente: 10% de 100 mil são 10 mil, e ponto", () => {
    const c = montarCronograma(EXEMPLO_DO_LUCAS);
    expect(c.totais.entrada).toBe(10_000);
    expect(c.totais.financiado).toBe(90_000);
    expect(c.totais.geral).toBe(100_000);
  });

  it("120 parcelas a partir de 10/12/2026 terminam em 10/11/2036", () => {
    const c = montarCronograma(EXEMPLO_DO_LUCAS);
    expect(c.mensais).toHaveLength(120);
    expect(c.mensais[119]?.vencimento).toBe("2036-11-10");
  });
});

describe("⚠️ o resto da divisão da entrada não pode sumir", () => {
  it("10 mil em 3× fecha exatamente em 10 mil, com o centavo na primeira", () => {
    expect(repartirEmPartesIguais(10_000, 3)).toEqual([3_333.34, 3_333.33, 3_333.33]);
  });

  it("no cronograma, a soma das parcelas da entrada bate com o valor negociado da entrada", () => {
    const c = montarCronograma({
      ...EXEMPLO_DO_LUCAS,
      entradaValor: 10_000,
      entradaVezes: 3,
    });
    // 3.333,33 × 3 daria 9.999,99 — um centavo a menos de entrada num documento assinado.
    expect(c.totais.entrada).toBe(10_000);
    expect(c.entrada.map((p) => p.valor)).toEqual([3_333.34, 3_333.33, 3_333.33]);
  });

  it("as demais ficam todas iguais, que é como o corretor anuncia o parcelamento", () => {
    const valores = repartirEmPartesIguais(1_000, 7);
    expect(new Set(valores.slice(1)).size).toBe(1);
    expect(valores.reduce((a, b) => a + b, 0)).toBeCloseTo(1_000, 10);
  });
});

describe("⚠️ dia 31 em mês de 30", () => {
  it("cai no último dia do mês curto, sem inventar 31/11", () => {
    const c = montarCronograma({
      ...EXEMPLO_DO_LUCAS,
      diaDeVencimento: 31,
      entradaValor: 4_000,
      entradaVezes: 4,
      primeiraParcelaDaEntrada: "2026-10-31",
    });
    expect(c.entrada.map((p) => p.vencimento)).toEqual([
      "2026-10-31",
      "2026-11-30",
      "2026-12-31",
      "2027-01-31",
    ]);
  });

  it("o mês curto não contamina os seguintes: depois de 30/11 volta para o 31", () => {
    const c = montarCronograma({
      ...EXEMPLO_DO_LUCAS,
      diaDeVencimento: 31,
      entradaValor: 4_000,
      entradaVezes: 4,
      primeiraParcelaDaEntrada: "2026-10-31",
    });
    // Rolando "mais um mês" em cima do anterior a série teria virado 30/12 e 30/01 para sempre.
    expect(c.entrada[2]?.vencimento).toBe("2026-12-31");
    expect(c.entrada[3]?.vencimento).toBe("2027-01-31");
    // E fevereiro encolhe só fevereiro.
    expect(c.mensais[0]?.vencimento).toBe("2027-02-28");
  });
});

describe("⚠️ vencimento é DIA, não instante", () => {
  it("10/10/2026 não vira 09/10 quando a data chega como `YYYY-MM-DD`", () => {
    // `Date.parse("2026-10-10")` é meia-noite em UTC; deslocada para −03:00 ela cai em 09/10 21h.
    const c = montarCronograma({ ...EXEMPLO_DO_LUCAS, primeiraParcelaDaEntrada: "2026-10-10" });
    expect(c.entrada[0]?.vencimento).toBe("2026-10-10");
  });

  it("ISO com hora é lido no fuso da operação (−03:00), não em UTC", () => {
    const meiaNoiteEmBrasilia = montarCronograma({
      ...EXEMPLO_DO_LUCAS,
      primeiraParcelaDaEntrada: "2026-10-10T03:00:00.000Z",
    });
    expect(meiaNoiteEmBrasilia.entrada[0]?.vencimento).toBe("2026-10-10");

    const aindaDiaNove = montarCronograma({
      ...EXEMPLO_DO_LUCAS,
      primeiraParcelaDaEntrada: "2026-10-10T02:00:00.000Z",
    });
    expect(aindaDiaNove.entrada[0]?.vencimento).toBe("2026-10-09");
  });

  it("⚠️ ISO com hora e SEM fuso é lido em −03:00, não no fuso da MÁQUINA", () => {
    // É o que uma coluna `timestamp` do Postgres devolve. Pelo `Date.parse`, esta mesma string
    // vira 10/10 no notebook (America/Sao_Paulo) e 09/10 na Vercel (UTC) — e a série mensal
    // inteira anda um dia junto com ela.
    const c = montarCronograma({
      ...EXEMPLO_DO_LUCAS,
      primeiraParcelaDaEntrada: "2026-10-10T00:00:00",
    });
    expect(c.entrada[0]?.vencimento).toBe("2026-10-10");
    expect(c.mensais[0]?.vencimento).toBe("2026-12-10");
  });

  it("⚠️ o MESMO dia em TZ=UTC e em TZ=America/Sao_Paulo, para todas as bordas do relógio", () => {
    const fusoOriginal = process.env.TZ;
    const emCadaFuso = (data: string): string[] =>
      ["America/Sao_Paulo", "UTC"].map((fuso) => {
        process.env.TZ = fuso;
        const c = montarCronograma({ ...EXEMPLO_DO_LUCAS, primeiraParcelaDaEntrada: data });
        return c.entrada[0]?.vencimento ?? "";
      });

    try {
      // Meia-noite e a última hora do dia: as duas pontas em que o deslocamento de fuso troca a
      // data. Se um dia isto voltar a passar pelo `Date`, uma das duas linhas cai.
      expect(emCadaFuso("2026-10-10T00:00:00")).toEqual(["2026-10-10", "2026-10-10"]);
      expect(emCadaFuso("2026-10-10T23:59:59")).toEqual(["2026-10-10", "2026-10-10"]);
      // O separador com espaço é o mesmo dado: alguns drivers devolvem assim.
      expect(emCadaFuso("2026-10-10 00:00:00")).toEqual(["2026-10-10", "2026-10-10"]);
      expect(emCadaFuso("2026-10-10T00:00:00.000")).toEqual(["2026-10-10", "2026-10-10"]);
    } finally {
      process.env.TZ = fusoOriginal;
    }
  });

  it("mas com Z ou offset explícito quem manda é o fuso da STRING, e não o −03:00", () => {
    // Aqui não há ambiguidade nenhuma para resolver: a string diz em que instante está.
    const c = montarCronograma({
      ...EXEMPLO_DO_LUCAS,
      primeiraParcelaDaEntrada: "2026-10-10T02:00:00.000Z",
    });
    expect(c.entrada[0]?.vencimento).toBe("2026-10-09");
  });

  it("data ilegível não sai calada: quebra na hora de montar", () => {
    expect(() =>
      montarCronograma({ ...EXEMPLO_DO_LUCAS, primeiraParcelaDaEntrada: "amanhã" }),
    ).toThrow(/inválida/);
  });
});

describe("as parcelas anuais", () => {
  it("caem uma por ano, a primeira doze meses depois da primeira mensal", () => {
    const c = montarCronograma({
      ...EXEMPLO_DO_LUCAS,
      anuaisQuantidade: 3,
      anuaisValor: 2_000,
    });
    expect(c.anuais.map((p) => p.vencimento)).toEqual([
      "2027-12-10",
      "2028-12-10",
      "2029-12-10",
    ]);
    expect(c.totais.anuais).toBe(6_000);
  });

  it("num plano SEM juros, valor presente e face são a mesma coisa: o saldo cai 6 mil", () => {
    const c = montarCronograma({
      ...EXEMPLO_DO_LUCAS,
      anuaisQuantidade: 3,
      anuaisValor: 2_000,
    });
    // Sem taxa não há desconto no tempo — 3 × 2.000 hoje ou em três aniversários dá no mesmo.
    expect(c.totais.financiado).toBe(84_000);
    expect(c.mensais[0]?.valor).toBe(700);
  });

  it("⚠️ COM juros o saldo cai pelo VALOR PRESENTE, e não pelo total de face", () => {
    const c = montarCronograma({
      ...EXEMPLO_DO_LUCAS,
      anuaisQuantidade: 3,
      anuaisValor: 20_000,
      entradaVezes: 1,
      plano: PRICE,
    });

    // 3 × 20.000 nos aniversários valem 51.541,94 hoje: 100.000 − 10.000 − 51.541,94.
    // Abatendo os 60.000 de face o saldo cairia para 30.000 e a parcela para R$ 359,57 — uma
    // proposta mais barata do que o contrato consegue cumprir.
    expect(c.totais.financiado).toBe(38_458.06);
    expect(c.mensais[0]?.valor).toBe(460.95);

    // Mas o comprador continua desembolsando o face: o boleto do aniversário é de 20 mil.
    expect(c.anuais.map((p) => p.valor)).toEqual([20_000, 20_000, 20_000]);
    expect(c.totais.anuais).toBe(60_000);
  });

  it("⚠️ o PDF não pode divergir do simulador que o coordenador acabou de usar", () => {
    const condicoes = {
      ...EXEMPLO_DO_LUCAS,
      anuaisQuantidade: 3,
      anuaisValor: 20_000,
      entradaVezes: 1,
      plano: PRICE,
    };
    const c = montarCronograma(condicoes);
    const doSimulador = montarProposta({
      baloesQuantidade: condicoes.anuaisQuantidade,
      baloesValor: condicoes.anuaisValor,
      entrada: condicoes.entradaValor,
      parcelas: condicoes.parcelasMensais,
      // O simulador só fecha com o cronograma se souber o sistema do plano — aqui, PRICE. Ver o
      // teste cruzado em SACOC, em `simulacao.test.ts`.
      sistemaAmortizacao: condicoes.plano.sistemaAmortizacao,
      taxaAoMes: taxaMensal(condicoes.plano),
      valor: condicoes.valorNegociado,
    });

    // Se estes dois números se separarem, a tela e o papel passam a contar histórias diferentes
    // sobre a MESMA proposta — e quem assina é o comprador.
    expect(c.totais.financiado).toBeCloseTo(doSimulador.financiado, 2);
    expect(c.mensais[0]?.valor).toBeCloseTo(doSimulador.parcela, 2);
  });

  it("sem valor não existem, mesmo que a quantidade venha preenchida", () => {
    const c = montarCronograma({ ...EXEMPLO_DO_LUCAS, anuaisQuantidade: 5, anuaisValor: 0 });
    expect(c.anuais).toEqual([]);
  });
});

describe("⚠️ entrada + anuais maiores que o lote não saem caladas", () => {
  it("quebra em vez de emitir 36 boletos de R$ 0,00 num lote de 100 mil", () => {
    // Antes: `Math.max(0, …)` zerava o saldo, a série mensal inteira saía em R$ 0,00 e o total
    // geral fechava em R$ 130.000 — num documento que o comprador assina.
    expect(() =>
      montarCronograma({
        ...EXEMPLO_DO_LUCAS,
        anuaisQuantidade: 6,
        anuaisValor: 20_000,
        entradaVezes: 1,
        parcelasMensais: 36,
      }),
    ).toThrow(/composição não fecha/i);
  });

  it("mesmo com juros descontando os balões, o que não fecha continua não fechando", () => {
    expect(() =>
      montarCronograma({
        ...EXEMPLO_DO_LUCAS,
        anuaisQuantidade: 6,
        anuaisValor: 20_000,
        entradaVezes: 1,
        parcelasMensais: 36,
        plano: PRICE,
      }),
    ).toThrow(/composição não fecha/i);
  });

  it("⚠️ saldo ZERO não quebra: entrada de 100% é venda à vista, e é legítima", () => {
    const c = montarCronograma({
      ...EXEMPLO_DO_LUCAS,
      entradaValor: 100_000,
      entradaVezes: 1,
      parcelasMensais: 0,
    });
    expect(c.totais.financiado).toBe(0);
    expect(c.totais.geral).toBe(100_000);
  });
});

describe("as faixas de reajuste", () => {
  it("⚠️ plano sem juros devolve UMA faixa só, e sem a marca do IPCA", () => {
    const c = montarCronograma(EXEMPLO_DO_LUCAS);
    expect(c.reajustes).toEqual([
      {
        ate: "2036-11-10",
        ciclo: 1,
        de: "2026-12-10",
        parcelaFinal: 120,
        parcelaInicial: 1,
        temIpca: false,
        valor: 750,
      },
    ]);
  });

  it("⚠️ PRICE também é faixa única: a parcela não sobe de degrau nenhum", () => {
    const c = montarCronograma({ ...EXEMPLO_DO_LUCAS, plano: PRICE });
    expect(c.reajustes).toHaveLength(1);
    expect(c.reajustes[0]?.valor).toBe(1_078.72);
    expect(c.reajustes[0]?.temIpca).toBe(false);
  });

  it("⚠️ o primeiro ano do SACOC é a AMORTIZAÇÃO PURA, e a nivelada só entra no segundo", () => {
    const c = montarCronograma({
      ...EXEMPLO_DO_LUCAS,
      entradaVezes: 1,
      parcelasMensais: 24,
      plano: SACOC_COM_JUROS,
    });

    expect(c.reajustes).toHaveLength(2);
    expect(c.reajustes[0]).toEqual({
      ate: "2027-10-10",
      ciclo: 1,
      de: "2026-11-10",
      parcelaFinal: 12,
      parcelaInicial: 1,
      temIpca: false,
      // 90.000 ÷ 24, sem um centavo de juros: é o que o boleto do primeiro ano cobra. A tabela
      // deslocada imprimia aqui a nivelada (3.910,59) — uma parcela maior do que o primeiro
      // boleto, num papel que promete o que o C2X vai emitir.
      valor: 3_750,
    });
    expect(c.reajustes[1]).toEqual({
      ate: "2028-10-10",
      ciclo: 2,
      de: "2027-11-10",
      parcelaFinal: 24,
      parcelaInicial: 13,
      // ⚠️ O segundo ciclo carrega a marca: o valor é só juros, e o IPCA ainda soma em cima.
      temIpca: true,
      // A nivelada da janela do ciclo 1 — os juros teóricos do primeiro ano, diluídos, é o que o
      // cliente passa a pagar do 13º mês em diante. A tabela deslocada dava 4.223,44 aqui.
      valor: 3_910.59,
    });
  });

  it("⚠️ o IPCA NÃO é projetado: o degrau do 2º ano é só o juro contratual", () => {
    const c = montarCronograma({
      ...EXEMPLO_DO_LUCAS,
      entradaVezes: 1,
      parcelasMensais: 24,
      plano: SACOC_COM_JUROS,
    });
    const primeira = c.reajustes[0]?.valor ?? 0;
    const segunda = c.reajustes[1]?.valor ?? 0;
    // 8% ao ano equivalente sobre a amortização dá ~8% de degrau. Somar IPCA aqui inflaria o
    // número num documento que o comprador assina, e ele estaria errado no primeiro aniversário.
    expect(segunda / primeira).toBeLessThan(1.09);
    expect(segunda).toBeGreaterThan(primeira);
  });

  it("⚠️ plano SEM_CORRECAO nunca ganha a marca, mesmo depois do primeiro degrau", () => {
    const c = montarCronograma({
      ...EXEMPLO_DO_LUCAS,
      entradaVezes: 1,
      parcelasMensais: 24,
      plano: { ...SACOC_COM_JUROS, indiceCorrecao: "SEM_CORRECAO" },
    });
    expect(c.reajustes.map((r) => r.temIpca)).toEqual([false, false]);
  });

  it("a mensal do fluxo e a faixa do reajuste contam a MESMA história", () => {
    const c = montarCronograma({
      ...EXEMPLO_DO_LUCAS,
      entradaVezes: 1,
      parcelasMensais: 24,
      plano: SACOC_COM_JUROS,
    });
    // Se o fluxo mensal e a tabela de reajuste divergirem, o papel se contradiz sozinho.
    expect(c.mensais[0]?.valor).toBe(c.reajustes[0]?.valor);
    expect(c.mensais[12]?.valor).toBe(c.reajustes[1]?.valor);
    expect(c.mensais[11]?.valor).toBe(c.reajustes[0]?.valor);
  });
});

describe("as bordas que a tela consegue produzir", () => {
  it("sem entrada, a primeira mensal é a própria data informada — não há mês de carência de graça", () => {
    const c = montarCronograma({ ...EXEMPLO_DO_LUCAS, entradaValor: 0, entradaVezes: 2 });
    expect(c.entrada).toEqual([]);
    expect(c.mensais[0]?.vencimento).toBe("2026-10-10");
    expect(c.totais.financiado).toBe(100_000);
  });

  it("sem parcela mensal não há fluxo mensal nem faixa de reajuste", () => {
    const c = montarCronograma({
      ...EXEMPLO_DO_LUCAS,
      entradaValor: 100_000,
      entradaVezes: 1,
      parcelasMensais: 0,
    });
    expect(c.mensais).toEqual([]);
    expect(c.reajustes).toEqual([]);
    expect(c.totais.geral).toBe(100_000);
  });

  it("um ciclo incompleto no fim do contrato vira faixa mesmo assim", () => {
    const c = montarCronograma({
      ...EXEMPLO_DO_LUCAS,
      entradaVezes: 1,
      parcelasMensais: 18,
      plano: SACOC_COM_JUROS,
    });
    expect(c.reajustes).toHaveLength(2);
    expect(c.reajustes[1]?.parcelaInicial).toBe(13);
    expect(c.reajustes[1]?.parcelaFinal).toBe(18);
  });
});

describe("a data que não existe no calendário", () => {
  // ⚠️ ANTES DO CAMINHO SEM FUSO, quem recusava essas strings era o Date.parse. Ao passar a ler os
  // dígitos direto — para o vencimento não andar um dia entre o notebook e a Vercel — a proteção
  // sumiu junto por um momento: "2026-13-10 10:00" era aceito e virava janeiro de 2027, e
  // "2026-10-10T99:99" passava calado. Estes testes existem para isso não voltar.
  const condicoes = (primeiraParcelaDaEntrada: string) => ({
    anuaisQuantidade: 0,
    anuaisValor: 0,
    diaDeVencimento: 10,
    entradaValor: 10_000,
    entradaVezes: 2,
    parcelasMensais: 120,
    plano: SACOC_SEM_JUROS,
    primeiraParcelaDaEntrada,
    valorNegociado: 100_000,
  });

  it("mês 13 não vira janeiro do ano seguinte — quebra", () => {
    expect(() => montarCronograma(condicoes("2026-13-10"))).toThrow(/inválida/i);
    expect(() => montarCronograma(condicoes("2026-13-10 10:00"))).toThrow(/inválida/i);
  });

  it("dia que não existe no mês quebra, e não escorrega para o dia seguinte", () => {
    expect(() => montarCronograma(condicoes("2026-11-31"))).toThrow(/inválida/i);
    expect(() => montarCronograma(condicoes("2026-02-30T12:00:00"))).toThrow(/inválida/i);
  });

  it("hora impossível quebra, mesmo com o dia certo", () => {
    expect(() => montarCronograma(condicoes("2026-10-10T99:99"))).toThrow(/inválida/i);
    expect(() => montarCronograma(condicoes("2026-10-10T25:00:00"))).toThrow(/inválida/i);
  });

  it("e o que É data continua passando", () => {
    expect(montarCronograma(condicoes("2026-10-10")).entrada[0]?.vencimento).toBe("2026-10-10");
    expect(montarCronograma(condicoes("2026-10-10T14:30:00")).entrada[0]?.vencimento).toBe(
      "2026-10-10",
    );
    // 29/02 existe em 2028, que é bissexto.
    expect(montarCronograma(condicoes("2028-02-29")).entrada[0]?.vencimento).toBe("2028-02-29");
  });
});

describe("⚠️ a entrada montada à mão", () => {
  const BASE = {
    anuaisQuantidade: 0,
    anuaisValor: 0,
    diaDeVencimento: 10,
    entradaValor: 28_000,
    entradaVezes: 4,
    parcelasMensais: 60,
    plano: SACOC_SEM_JUROS,
    primeiraParcelaDaEntrada: "2026-10-10",
    valorNegociado: 140_000,
  };

  it("sem lista, continua dividindo em partes iguais", () => {
    const c = montarCronograma(BASE);
    expect(c.entrada.map((p) => p.valor)).toEqual([7_000, 7_000, 7_000, 7_000]);
  });

  it("com lista, ela manda — e as datas continuam mês a mês no dia escolhido", () => {
    // O caso do Lucas: "10 mil na primeira, o resto dividido".
    const c = montarCronograma({ ...BASE, entradaParcelas: [10_000, 6_000, 6_000, 6_000] });
    expect(c.entrada.map((p) => p.valor)).toEqual([10_000, 6_000, 6_000, 6_000]);
    expect(c.entrada.map((p) => p.vencimento)).toEqual([
      "2026-10-10",
      "2026-11-10",
      "2026-12-10",
      "2027-01-10",
    ]);
    expect(c.totais.entrada).toBe(28_000);
  });

  it("⚠️ somando MAIS que o combinado, o financiado CAI junto", () => {
    // *"maior pode; ao ser maior, atualizar o valor de entrada"* — e o resto da conta acompanha,
    // senão o papel sairia com uma entrada maior e a mesma parcela de antes.
    const c = montarCronograma({ ...BASE, entradaParcelas: [10_000, 7_000, 7_000, 7_000] });
    expect(c.totais.entrada).toBe(31_000);
    expect(c.totais.financiado).toBe(109_000); // 140.000 − 31.000
  });

  it("lista com zeros (tela em preenchimento) não vira entrada zero", () => {
    // Sem esta guarda o cronograma sairia com o financiado inteiro na série mensal.
    const c = montarCronograma({ ...BASE, entradaParcelas: [0, 0, 0, 0] });
    expect(c.totais.entrada).toBe(28_000);
  });

  it("lista nula é o mesmo que não mandar nada", () => {
    const c = montarCronograma({ ...BASE, entradaParcelas: null });
    expect(c.entrada.map((p) => p.valor)).toEqual([7_000, 7_000, 7_000, 7_000]);
  });
});

describe("⚠️ a montagem com parcela zerada não dá carência de graça", () => {
  const BASE_Z = {
    anuaisQuantidade: 0,
    anuaisValor: 0,
    diaDeVencimento: 10,
    entradaValor: 28_000,
    entradaVezes: 4,
    parcelasMensais: 60,
    plano: SACOC_SEM_JUROS,
    primeiraParcelaDaEntrada: "2026-10-10",
    valorNegociado: 140_000,
  };

  it("as mensais começam depois da última entrada REAL, e não do `entradaVezes` declarado", () => {
    // Com [15.000, 0, 0, 13.000] as duas linhas zeradas somem da série: a entrada tem 2 parcelas,
    // não 4. Contando pelo número declarado, a primeira mensal caía dois meses depois do fim da
    // entrada — dois meses de carência que ninguém negociou, no papel do cliente.
    const c = montarCronograma({ ...BASE_Z, entradaParcelas: [15_000, 0, 0, 13_000] });

    expect(c.entrada).toHaveLength(2);
    expect(c.entrada.map((p) => p.vencimento)).toEqual(["2026-10-10", "2026-11-10"]);
    expect(c.mensais[0]?.vencimento).toBe("2026-12-10");
  });

  it("na divisão igual nada muda: os dois números coincidem", () => {
    const c = montarCronograma(BASE_Z);
    expect(c.entrada).toHaveLength(4);
    expect(c.mensais[0]?.vencimento).toBe("2027-02-10");
  });
});

describe("⚠️ venda à vista não imprime boleto de R$ 0,00", () => {
  it("entrada cobrindo o lote inteiro não gera série mensal", () => {
    // O plano À VISTA (1x, 100%) zerava o financiado e a série saía com o prazo declarado e valor
    // R$ 0,00 em cada linha: o PDF imprimia "Parcela 1 de 1 · R$ 0,00" e o WhatsApp anunciava
    // "1x a partir de R$ 0,00 (com reajuste anual)" para o comprador.
    const c = montarCronograma({
      anuaisQuantidade: 0,
      anuaisValor: 0,
      diaDeVencimento: 10,
      entradaValor: 140_000,
      entradaVezes: 1,
      parcelasMensais: 1,
      plano: SACOC_SEM_JUROS,
      primeiraParcelaDaEntrada: "2026-10-10",
      valorNegociado: 140_000,
    });

    expect(c.totais.entrada).toBe(140_000);
    expect(c.totais.financiado).toBe(0);
    expect(c.mensais).toEqual([]);
    expect(c.reajustes).toEqual([]);
  });

  it("com saldo, a série continua saindo normalmente", () => {
    const c = montarCronograma({
      anuaisQuantidade: 0,
      anuaisValor: 0,
      diaDeVencimento: 10,
      entradaValor: 14_000,
      entradaVezes: 1,
      parcelasMensais: 120,
      plano: SACOC_SEM_JUROS,
      primeiraParcelaDaEntrada: "2026-10-10",
      valorNegociado: 140_000,
    });
    expect(c.mensais).toHaveLength(120);
    expect(c.mensais[0]?.valor).toBe(1_050);
  });
});
