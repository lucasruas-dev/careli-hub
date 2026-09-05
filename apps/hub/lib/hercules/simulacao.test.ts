import { describe, expect, it } from "vitest";

import { type PlanoComercial, taxaMensal } from "@/lib/apolo/planos-comerciais";
import { montarCronograma } from "@/lib/hercules/cronograma";

import {
  entradaParaAParcela,
  fatorDeAnuidade,
  fatorDoFinanciado,
  montarProposta,
  parcelaDoFinanciado,
  sistemaDoCadastro,
  somaDasMensais,
  valorPresenteDosBaloes,
} from "./simulacao";

/**
 * O plano NORMAL da casa: SACOC, 8% ao ano na convenção equivalente, 120 parcelas.
 *
 * ⚠️ É O PLANO DE 21 DOS 24 EMPREENDIMENTOS, e é por isso que o cenário desta suíte é ele. A taxa
 * mensal sai de `taxaMensal` (0,6434% a.m.), como em toda a casa.
 */
const NORMAL_SACOC: PlanoComercial = {
  entradaPercentual: 10,
  indiceCorrecao: "SEM_CORRECAO",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  jurosTaxa: 8,
  nome: "NORMAL",
  parcelas: 120,
  sistemaAmortizacao: "sacoc",
  slot: "normal",
};

const I_SACOC = taxaMensal(NORMAL_SACOC);

describe("fatorDeAnuidade", () => {
  it("sem juros, é o próprio número de parcelas", () => {
    expect(fatorDeAnuidade(120, 0)).toBe(120);
  });

  it("com juros, vale menos que o número de parcelas", () => {
    // 1% ao mês em 120 meses: o fator é ~69,7 — cada real futuro vale menos que um real hoje.
    expect(fatorDeAnuidade(120, 0.01)).toBeCloseTo(69.7005, 3);
  });
});

describe("valorPresenteDosBaloes", () => {
  it("sem juros, é o valor de face", () => {
    expect(valorPresenteDosBaloes(3, 20_000, 0)).toBe(60_000);
  });

  it("⚠️ com juros, o balão vale MENOS do que o valor de face", () => {
    // Três balões anuais de 20 mil a 1% a.m.: o terceiro cai daqui a 36 meses. Somá-los pelo valor
    // de face reduziria a parcela além do que a conta permite, e a proposta sairia mais barata do
    // que o contrato consegue cumprir.
    const vp = valorPresenteDosBaloes(3, 20_000, 0.01);
    expect(vp).toBeLessThan(60_000);
    expect(vp).toBeCloseTo(47_478.81, 1);
  });

  it("zero balão é zero", () => {
    expect(valorPresenteDosBaloes(0, 20_000, 0.01)).toBe(0);
    expect(valorPresenteDosBaloes(3, 0, 0.01)).toBe(0);
  });
});

describe("sistemaDoCadastro", () => {
  it("lê o que o cadastro escreve", () => {
    expect(sistemaDoCadastro("price")).toBe("price");
    expect(sistemaDoCadastro("PRICE")).toBe("price");
    expect(sistemaDoCadastro(" sac ")).toBe("sac");
    expect(sistemaDoCadastro("sacoc")).toBe("sacoc");
  });

  it("⚠️ o desconhecido cai em SACOC, e não em Price", () => {
    // É para onde a cascata de `calcularParcela` e a de `montarCronograma` mandam qualquer coisa
    // que não seja `price` nem `sac`. Se aqui caísse em Price, um campo em branco (ou uma grafia
    // nova, "SACOOC") faria a tela calcular Price e o PDF calcular SACOC — as duas parcelas
    // diferentes na mesma modal, de volta.
    expect(sistemaDoCadastro("SACOOC")).toBe("sacoc");
    expect(sistemaDoCadastro("")).toBe("sacoc");
    expect(sistemaDoCadastro(null)).toBe("sacoc");
    expect(sistemaDoCadastro(undefined)).toBe("sacoc");
  });
});

describe("⚠️ a MESMA MODAL não pode anunciar duas parcelas", () => {
  // Medido em 04/09/2026, e é o defeito que esta suíte trava: até aqui o simulador calculava TUDO
  // em Price e ignorava o `sistemaAmortizacao` do plano, enquanto `montarCronograma` — que
  // alimenta o rodapé "O que vai sair", o PDF e o WhatsApp — sempre respeitou o sistema.
  const CENARIO = {
    baloesQuantidade: 0,
    baloesValor: 0,
    entrada: 20_000,
    parcelas: 120,
    taxaAoMes: I_SACOC,
    valor: 200_000,
  };

  it("no SACOC a parcela é a amortização pura, e não a Price de R$ 2.157,44", () => {
    const sacoc = montarProposta({ ...CENARIO, sistemaAmortizacao: "sacoc" });
    const price = montarProposta({ ...CENARIO, sistemaAmortizacao: "price" });

    expect(sacoc.financiado).toBeCloseTo(180_000, 2);
    // 180.000 ÷ 120. É o que o C2X emite no primeiro ano — conferido contra `payments` em 9 de 9
    // empreendimentos SACOOC com parcelas emitidas.
    expect(sacoc.parcela).toBeCloseTo(1_500, 2);
    // O número ANTIGO da tela, que continua correto para quem de fato vende em Price: 44% acima.
    expect(price.parcela).toBeCloseTo(2_157.44, 2);
    expect(price.parcela / sacoc.parcela).toBeGreaterThan(1.4);
  });

  it("e o cartão do simulador fecha com o cronograma do PDF, parcela e total", () => {
    const doSimulador = montarProposta({ ...CENARIO, sistemaAmortizacao: "sacoc" });
    const c = montarCronograma({
      anuaisQuantidade: 0,
      anuaisValor: 0,
      diaDeVencimento: 10,
      entradaValor: 20_000,
      entradaVezes: 2,
      parcelasMensais: 120,
      plano: NORMAL_SACOC,
      primeiraParcelaDaEntrada: "2026-10-10",
      valorNegociado: 200_000,
    });

    expect(c.totais.financiado).toBeCloseTo(doSimulador.financiado, 2);
    expect(c.mensais[0]?.valor).toBeCloseTo(doSimulador.parcela, 2);
    // O total soma 120 parcelas já arredondadas no centavo, daí a folga de um real.
    expect(Math.abs(c.totais.geral - doSimulador.total)).toBeLessThan(1);
  });

  it("⚠️ o total do SACOC não é a parcela do primeiro ano vezes o prazo", () => {
    // O degrau do aniversário está dentro do total: `1.500 × 120 + 20.000` daria R$ 200.000 e a
    // tela diria "+0% sobre a tabela" num contrato que custa ~36% a mais que o preço de lista.
    const r = montarProposta({ ...CENARIO, sistemaAmortizacao: "sacoc" });
    // R$ 20.000 de entrada + R$ 252.401,82 de série mensal.
    expect(r.total).toBeCloseTo(272_401.82, 2);
    expect(r.total).toBeGreaterThan(20_000 + r.parcela * 120);
  });

  it("com os reforços anuais, os dois continuam contando a mesma história", () => {
    const doSimulador = montarProposta({
      ...CENARIO,
      baloesQuantidade: 3,
      baloesValor: 20_000,
      sistemaAmortizacao: "sacoc",
    });
    const c = montarCronograma({
      anuaisQuantidade: 3,
      anuaisValor: 20_000,
      diaDeVencimento: 10,
      entradaValor: 20_000,
      entradaVezes: 2,
      parcelasMensais: 120,
      plano: NORMAL_SACOC,
      primeiraParcelaDaEntrada: "2026-10-10",
      valorNegociado: 200_000,
    });

    // O reforço abate o saldo pelo VALOR PRESENTE nos dois lados — é a conta que já existia, e ela
    // não mudou com o sistema de amortização.
    expect(c.totais.financiado).toBeCloseTo(doSimulador.financiado, 2);
    expect(doSimulador.financiado).toBeLessThan(180_000);
    expect(c.mensais[0]?.valor).toBeCloseTo(doSimulador.parcela, 2);
    expect(Math.abs(c.totais.geral - doSimulador.total)).toBeLessThan(1);
  });
});

describe("parcelaDoFinanciado", () => {
  it("cada sistema divide o saldo do seu jeito", () => {
    const comum = { financiado: 180_000, parcelas: 120, taxaAoMes: I_SACOC };
    expect(parcelaDoFinanciado({ ...comum, sistemaAmortizacao: "price" })).toBeCloseTo(2_157.44, 2);
    // SACOC: só amortização no primeiro ciclo.
    expect(parcelaDoFinanciado({ ...comum, sistemaAmortizacao: "sacoc" })).toBeCloseTo(1_500, 2);
    // SAC: a primeira é a maior, amortização mais juros sobre o saldo cheio.
    expect(parcelaDoFinanciado({ ...comum, sistemaAmortizacao: "sac" })).toBeCloseTo(
      1_500 + 180_000 * I_SACOC,
      2,
    );
  });

  it("sem prazo não existe parcela", () => {
    expect(
      parcelaDoFinanciado({
        financiado: 180_000,
        parcelas: 0,
        sistemaAmortizacao: "sacoc",
        taxaAoMes: I_SACOC,
      }),
    ).toBe(0);
  });
});

describe("somaDasMensais", () => {
  it("na Price é a parcela vezes o prazo, porque todas são iguais", () => {
    const comum = {
      financiado: 180_000,
      parcelas: 120,
      sistemaAmortizacao: "price",
      taxaAoMes: I_SACOC,
    } as const;
    expect(somaDasMensais(comum)).toBeCloseTo(parcelaDoFinanciado(comum) * 120, 6);
    // ~R$ 258.892 — e o cliente ainda desembolsa a entrada por fora.
    expect(somaDasMensais(comum)).toBeCloseTo(258_892, -2);
  });

  it("⚠️ no SACOC vale mais que o financiado, porque o degrau do aniversário está lá dentro", () => {
    const soma = somaDasMensais({
      financiado: 180_000,
      parcelas: 120,
      sistemaAmortizacao: "sacoc",
      taxaAoMes: I_SACOC,
    });
    expect(soma).toBeGreaterThan(180_000);
    expect(soma).toBeCloseTo(252_401.82, 2);
  });

  it("SACOC sem juros é o próprio financiado — não há degrau nenhum", () => {
    expect(
      somaDasMensais({
        financiado: 180_000,
        parcelas: 120,
        sistemaAmortizacao: "sacoc",
        taxaAoMes: 0,
      }),
    ).toBeCloseTo(180_000, 6);
  });

  it("⚠️ prazo que não fecha em anos inteiros também bate com o cronograma", () => {
    // 130 meses = dez ciclos cheios e um de dez boletos. É onde a soma telescópica deixaria de
    // valer, e é por isso que o laço espelha o do cronograma em vez de usar fórmula fechada.
    const plano: PlanoComercial = { ...NORMAL_SACOC, parcelas: 130 };
    const c = montarCronograma({
      anuaisQuantidade: 0,
      anuaisValor: 0,
      diaDeVencimento: 10,
      entradaValor: 20_000,
      entradaVezes: 1,
      parcelasMensais: 130,
      plano,
      primeiraParcelaDaEntrada: "2026-10-10",
      valorNegociado: 200_000,
    });
    const soma = somaDasMensais({
      financiado: 180_000,
      parcelas: 130,
      sistemaAmortizacao: "sacoc",
      taxaAoMes: I_SACOC,
    });
    expect(Math.abs(c.totais.mensais - soma)).toBeLessThan(1);
  });
});

describe("montarProposta", () => {
  it("sem juros e sem balão, é divisão simples", () => {
    const r = montarProposta({
      baloesQuantidade: 0,
      baloesValor: 0,
      entrada: 20_000,
      parcelas: 100,
      sistemaAmortizacao: "price",
      taxaAoMes: 0,
      valor: 120_000,
    });
    expect(r.financiado).toBe(100_000);
    expect(r.parcela).toBe(1_000);
    expect(r.total).toBe(120_000);
  });

  it("com juros, a parcela cobre o custo do financiamento", () => {
    const r = montarProposta({
      baloesQuantidade: 0,
      baloesValor: 0,
      entrada: 20_000,
      parcelas: 100,
      sistemaAmortizacao: "price",
      taxaAoMes: 0.01,
      valor: 120_000,
    });
    // 100 mil financiados a 1% em 100 meses: a parcela passa de 1.000 e o total supera o preço.
    expect(r.parcela).toBeGreaterThan(1_000);
    expect(r.total).toBeGreaterThan(120_000);
  });

  it("o balão reduz a parcela, e o total continua fechando", () => {
    const sem = montarProposta({
      baloesQuantidade: 0,
      baloesValor: 0,
      entrada: 20_000,
      parcelas: 120,
      sistemaAmortizacao: "price",
      taxaAoMes: 0.007,
      valor: 200_000,
    });
    const com = montarProposta({
      baloesQuantidade: 3,
      baloesValor: 20_000,
      entrada: 20_000,
      parcelas: 120,
      sistemaAmortizacao: "price",
      taxaAoMes: 0.007,
      valor: 200_000,
    });

    expect(com.parcela).toBeLessThan(sem.parcela);
    // O que sai do bolso é entrada + 120 parcelas + os três balões. Na Price, e só nela, a série
    // inteira é a parcela vezes o prazo.
    expect(com.total).toBeCloseTo(20_000 + com.parcela * 120 + 60_000, 2);
  });

  it("entrada maior que o valor não deixa o financiado negativo", () => {
    const r = montarProposta({
      baloesQuantidade: 0,
      baloesValor: 0,
      entrada: 300_000,
      parcelas: 60,
      sistemaAmortizacao: "price",
      taxaAoMes: 0.01,
      valor: 200_000,
    });
    expect(r.financiado).toBe(0);
    expect(r.parcela).toBe(0);
  });
});

describe("entradaParaAParcela", () => {
  it("⚠️ é o caminho inverso, e fecha com montarProposta — nos TRÊS sistemas", () => {
    // "Consigo pagar 1.500" é como o comprador fala. Sair disso para a entrada, na mão, é tentativa
    // e erro — e as duas contas têm de dar no mesmo ponto. Inverter tudo pela fórmula da Price,
    // como se fazia até 04/09/2026, devolvia uma entrada que NÃO produzia a parcela prometida.
    const alvo = 1_500;
    for (const sistema of ["price", "sac", "sacoc"] as const) {
      const { entrada } = entradaParaAParcela({
        baloesQuantidade: 2,
        baloesValor: 15_000,
        parcela: alvo,
        parcelas: 120,
        sistemaAmortizacao: sistema,
        taxaAoMes: 0.007,
        valor: 250_000,
      });

      const volta = montarProposta({
        baloesQuantidade: 2,
        baloesValor: 15_000,
        entrada,
        parcelas: 120,
        sistemaAmortizacao: sistema,
        taxaAoMes: 0.007,
        valor: 250_000,
      });

      expect(volta.parcela).toBeCloseTo(alvo, 6);
    }
  });

  it("⚠️ no SACOC o saldo sai direto de parcela × prazo, e a entrada é bem menor", () => {
    // 120 × 1.500 = 180.000 amortizados; num lote de 200.000 sobram 20.000 de entrada. Pela
    // inversão da Price o mesmo pedido devolvia ~R$ 76 mil de entrada — dinheiro de agora que o
    // cliente não precisava pôr, no plano que quase toda a casa vende.
    const sacoc = entradaParaAParcela({
      baloesQuantidade: 0,
      baloesValor: 0,
      parcela: 1_500,
      parcelas: 120,
      sistemaAmortizacao: "sacoc",
      taxaAoMes: I_SACOC,
      valor: 200_000,
    });
    const price = entradaParaAParcela({
      baloesQuantidade: 0,
      baloesValor: 0,
      parcela: 1_500,
      parcelas: 120,
      sistemaAmortizacao: "price",
      taxaAoMes: I_SACOC,
      valor: 200_000,
    });

    expect(sacoc.entrada).toBeCloseTo(20_000, 2);
    expect(price.entrada).toBeGreaterThan(70_000);
  });

  it("⚠️ o balão continua abatendo pelo VALOR PRESENTE, seja qual for o sistema", () => {
    // O reforço é dinheiro do futuro derrubando saldo de hoje; a pergunta não muda quando muda o
    // jeito de dividir o saldo. Descontar o face abateria mais do que o balão vale.
    const vp = valorPresenteDosBaloes(3, 20_000, I_SACOC);
    const r = entradaParaAParcela({
      baloesQuantidade: 3,
      baloesValor: 20_000,
      parcela: 1_200,
      parcelas: 120,
      sistemaAmortizacao: "sacoc",
      taxaAoMes: I_SACOC,
      valor: 200_000,
    });

    expect(vp).toBeLessThan(60_000);
    // 200.000 − VP dos balões − (1.200 × 120).
    expect(r.entrada).toBeCloseTo(200_000 - vp - 144_000, 2);
  });

  it("parcela alta demais devolve entrada zero e diz quanto sobra", () => {
    const r = entradaParaAParcela({
      baloesQuantidade: 0,
      baloesValor: 0,
      parcela: 10_000,
      parcelas: 120,
      sistemaAmortizacao: "price",
      taxaAoMes: 0,
      valor: 200_000,
    });
    expect(r.entrada).toBe(0);
    // 120 × 10.000 = 1,2 mi para um lote de 200 mil: sobra 1 milhão.
    expect(r.sobra).toBe(1_000_000);
  });
});

describe("fatorDoFinanciado", () => {
  it("⚠️ é a inversa da ida, e o teste é a própria identidade", () => {
    // `parcelaDoFinanciado(parcela × fator) === parcela`. Se alguém mexer num lado só, a tela passa
    // a oferecer uma entrada que não produz a parcela que ela mesma prometeu.
    for (const sistema of ["price", "sac", "sacoc"] as const) {
      const fator = fatorDoFinanciado({ parcelas: 120, sistemaAmortizacao: sistema, taxaAoMes: 0.007 });
      const financiado = 1_500 * fator;
      expect(
        parcelaDoFinanciado({ financiado, parcelas: 120, sistemaAmortizacao: sistema, taxaAoMes: 0.007 }),
      ).toBeCloseTo(1_500, 6);
    }
  });

  it("sem juros os três sistemas coincidem no próprio prazo", () => {
    for (const sistema of ["price", "sac", "sacoc"] as const) {
      expect(fatorDoFinanciado({ parcelas: 120, sistemaAmortizacao: sistema, taxaAoMes: 0 })).toBe(120);
    }
  });
});
