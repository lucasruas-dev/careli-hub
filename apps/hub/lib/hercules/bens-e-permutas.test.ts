import { describe, expect, it } from "vitest";

import { type PlanoComercial } from "@/lib/apolo/planos-comerciais";

import {
  type BemOuPermuta,
  somarBensEPermutas,
  somarBensQueContamNaEntrada,
} from "./bens-e-permutas";
import { composicoesQueFecham, type PlanoDaComposicao } from "./composicoes";
import { montarCronograma } from "./cronograma";
import { conferirProposta, type PedidoDeProposta } from "./proposta";
import { entradaParaAParcela, montarProposta } from "./simulacao";

/**
 * O caso que o Lucas descreveu em 22/09/2026: lote de R$ 200.000, um carro de R$ 80.000 recebido na
 * aquisição e R$ 5.000 em dinheiro. O que muda entre os dois `entraComo` é SÓ a entrada mínima.
 */
const CARRO_NA_ENTRADA: BemOuPermuta = {
  descricao: "Ford Ka 2019 placa ABC1D23",
  entraComo: "entrada",
  tipo: "bem",
  valor: 80_000,
};

const CARRO_SO_ABATENDO: BemOuPermuta = { ...CARRO_NA_ENTRADA, entraComo: "abatimento" };

const LOTE_EM_ANAPOLIS: BemOuPermuta = {
  descricao: "lote 12 da quadra 4 em Anápolis",
  entraComo: "entrada",
  tipo: "permuta",
  valor: 15_000,
};

/** O plano de 21 dos 24 empreendimentos: SACOC, sem juros, 120 parcelas. */
const SACOC: PlanoComercial = {
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

const CONDICOES = {
  anuaisQuantidade: 0,
  anuaisValor: 0,
  diaDeVencimento: 10,
  entradaValor: 5_000,
  entradaVezes: 1,
  parcelasMensais: 120,
  plano: SACOC,
  primeiraParcelaDaEntrada: "2026-10-10",
  valorNegociado: 200_000,
};

const PEDIDO: PedidoDeProposta = {
  compradores: [
    { cpf: "529.982.247-25", nome: "Maria da Silva", participacao: 100, titular: true },
  ],
  entradaMinimaPercentual: null,
  entradaValor: 5_000,
  entradaVezes: 1,
  parcelas: 120,
  primeiraParcelaEm: "2026-10-10",
  reservaId: "res-1",
  unidadeId: "uni-1",
  validadeEm: "2026-09-29T02:59:59.000Z",
  valorNegociado: 200_000,
  vencimentoDia: 10,
};

const AGORA = "2026-09-22T17:00:00.000Z";

describe("somarBensEPermutas", () => {
  it("soma os dois `entraComo`, porque os dois abatem o saldo a financiar", () => {
    expect(somarBensEPermutas([CARRO_NA_ENTRADA, CARRO_SO_ABATENDO])).toBe(160_000);
  });

  it("lista ausente, nula ou vazia vale zero", () => {
    expect(somarBensEPermutas(undefined)).toBe(0);
    expect(somarBensEPermutas(null)).toBe(0);
    expect(somarBensEPermutas([])).toBe(0);
  });

  it("ignora valor que não é número positivo", () => {
    expect(
      somarBensEPermutas([
        { ...CARRO_NA_ENTRADA, valor: Number.NaN },
        { ...CARRO_NA_ENTRADA, valor: -10 },
        { ...CARRO_NA_ENTRADA, valor: 0 },
        LOTE_EM_ANAPOLIS,
      ]),
    ).toBe(15_000);
  });
});

describe("somarBensQueContamNaEntrada", () => {
  it("só os `entraComo: entrada` entram — é essa a diferença entre os dois modos", () => {
    expect(
      somarBensQueContamNaEntrada([CARRO_NA_ENTRADA, CARRO_SO_ABATENDO, LOTE_EM_ANAPOLIS]),
    ).toBe(95_000);
  });

  it("só abatimento na lista vale zero para a entrada mínima", () => {
    expect(somarBensQueContamNaEntrada([CARRO_SO_ABATENDO])).toBe(0);
  });
});

describe("montarCronograma com bem ou permuta", () => {
  it("o carro de R$ 80.000 abate o saldo pelo valor CHEIO: financiado R$ 115.000", () => {
    const c = montarCronograma({ ...CONDICOES, bensEPermutas: [CARRO_NA_ENTRADA] });

    expect(c.totais.bensEPermutas).toBe(80_000);
    expect(c.totais.financiado).toBe(115_000);
    // 115.000 ÷ 120 = R$ 958,33 por mês (a amortização pura do SACOC sem juros).
    expect(c.mensais[0]?.valor).toBe(958.33);
  });

  it("o `entraComo` NÃO muda o financiado — só a entrada mínima olha para ele", () => {
    const comoEntrada = montarCronograma({ ...CONDICOES, bensEPermutas: [CARRO_NA_ENTRADA] });
    const comoAbatimento = montarCronograma({ ...CONDICOES, bensEPermutas: [CARRO_SO_ABATENDO] });

    expect(comoAbatimento.totais.financiado).toBe(115_000);
    expect(comoAbatimento.totais.financiado).toBe(comoEntrada.totais.financiado);
  });

  it("dois bens na mesma proposta somam: financiado R$ 100.000", () => {
    const c = montarCronograma({
      ...CONDICOES,
      bensEPermutas: [CARRO_NA_ENTRADA, LOTE_EM_ANAPOLIS],
    });

    expect(c.totais.bensEPermutas).toBe(95_000);
    expect(c.totais.financiado).toBe(100_000);
  });

  it("o total geral conta o bem: o comprador entrega dinheiro E o carro", () => {
    const c = montarCronograma({ ...CONDICOES, bensEPermutas: [CARRO_NA_ENTRADA] });

    // 5.000 de entrada + 80.000 do carro + 120 × 958,33 = R$ 199.999,60. Os 40 centavos que faltam
    // para os 200.000 são o arredondamento da mensal, e são os mesmos de sempre.
    expect(c.totais.mensais).toBe(114_999.6);
    expect(c.totais.geral).toBe(199_999.6);
  });

  it("entrada mais bem passando do lote quebra, e o texto diz que o bem entrou na conta", () => {
    expect(() =>
      montarCronograma({
        ...CONDICOES,
        bensEPermutas: [CARRO_NA_ENTRADA],
        entradaValor: 150_000,
      }),
    ).toThrow(/bens e permutas/i);
  });

  it("lista vazia e lista ausente se comportam como hoje", () => {
    const semCampo = montarCronograma(CONDICOES);
    const listaVazia = montarCronograma({ ...CONDICOES, bensEPermutas: [] });
    const listaNula = montarCronograma({ ...CONDICOES, bensEPermutas: null });

    expect(semCampo.totais.financiado).toBe(195_000);
    expect(semCampo.totais.bensEPermutas).toBe(0);
    expect(listaVazia).toEqual(semCampo);
    expect(listaNula).toEqual(semCampo);
  });
});

describe("conferirProposta com bem ou permuta", () => {
  it("o carro como `entrada` CUMPRE o piso de 10%: R$ 5.000 em espécie bastam", () => {
    expect(
      conferirProposta({ ...PEDIDO, bensEPermutas: [CARRO_NA_ENTRADA] }, AGORA),
    ).toEqual([]);
  });

  it("o mesmo carro como `abatimento` NÃO cumpre o piso — só os R$ 5.000 em espécie contam", () => {
    const erros = conferirProposta({ ...PEDIDO, bensEPermutas: [CARRO_SO_ABATENDO] }, AGORA);

    expect(erros.map((e) => e.campo)).toContain("entrada");
    expect(erros.some((e) => /entrada mínima/i.test(e.mensagem))).toBe(true);
  });

  it("dois bens somam para o piso", () => {
    // Piso de 10% de R$ 400.000 = R$ 40.000. Em espécie são R$ 5.000; o carro e o lote fecham.
    expect(
      conferirProposta(
        {
          ...PEDIDO,
          bensEPermutas: [CARRO_NA_ENTRADA, LOTE_EM_ANAPOLIS],
          valorNegociado: 400_000,
        },
        AGORA,
      ),
    ).toEqual([]);
  });

  it("entrada de 100% mais permuta é reprovada pelo teto, com mensagem que explica", () => {
    const erros = conferirProposta(
      { ...PEDIDO, bensEPermutas: [CARRO_NA_ENTRADA], entradaValor: 200_000 },
      AGORA,
    );

    expect(erros.map((e) => e.campo)).toContain("entrada");
    expect(erros.some((e) => /bens e permutas/i.test(e.mensagem))).toBe(true);
  });

  it("entrada de 100% SEM permuta continua passando: é a venda à vista", () => {
    expect(conferirProposta({ ...PEDIDO, entradaValor: 200_000 }, AGORA)).toEqual([]);
  });

  it("bem sem descrição ou sem valor é recusado no campo dele", () => {
    const erros = conferirProposta(
      {
        ...PEDIDO,
        bensEPermutas: [
          { ...CARRO_NA_ENTRADA, descricao: "   " },
          { ...LOTE_EM_ANAPOLIS, valor: 0 },
        ],
      },
      AGORA,
    );

    expect(erros.map((e) => e.campo)).toContain("bensEPermutas");
  });

  it("lista vazia e lista ausente se comportam como hoje", () => {
    const comoHoje = conferirProposta(PEDIDO, AGORA);

    expect(conferirProposta({ ...PEDIDO, bensEPermutas: [] }, AGORA)).toEqual(comoHoje);
    expect(conferirProposta({ ...PEDIDO, bensEPermutas: null }, AGORA)).toEqual(comoHoje);
  });
});

describe("montarProposta com bem ou permuta", () => {
  it("abate o saldo pelo valor cheio, igual ao cronograma", () => {
    const montada = montarProposta({
      baloesQuantidade: 0,
      baloesValor: 0,
      bensEPermutas: [CARRO_NA_ENTRADA],
      entrada: 5_000,
      parcelas: 120,
      sistemaAmortizacao: "sacoc",
      taxaAoMes: 0,
      valor: 200_000,
    });

    expect(montada.financiado).toBe(115_000);
    expect(montada.parcela).toBeCloseTo(115_000 / 120, 6);
    // O total soma o que o comprador entrega: R$ 5.000 + o carro + a série inteira.
    expect(montada.total).toBeCloseTo(5_000 + 80_000 + 115_000, 6);
  });

  it("lista vazia e lista ausente se comportam como hoje", () => {
    const base = {
      baloesQuantidade: 0,
      baloesValor: 0,
      entrada: 5_000,
      parcelas: 120,
      sistemaAmortizacao: "sacoc" as const,
      taxaAoMes: 0,
      valor: 200_000,
    };

    expect(montarProposta({ ...base, bensEPermutas: [] })).toEqual(montarProposta(base));
    expect(montarProposta({ ...base, bensEPermutas: null })).toEqual(montarProposta(base));
    expect(montarProposta(base).financiado).toBe(195_000);
  });
});

describe("entradaParaAParcela com bem ou permuta — a ida e a volta", () => {
  /**
   * ⚠️ É O TESTE QUE PRENDE OS DOIS LADOS. Se o bem entrar só na ida (`montarProposta`), a entrada
   * que a volta sugere produz outra parcela, e a tela oferece um número que o contrato não emite.
   */
  it.each([
    { sistemaAmortizacao: "sacoc" as const, taxaAoMes: 0.006434 },
    { sistemaAmortizacao: "price" as const, taxaAoMes: 0.006434 },
    { sistemaAmortizacao: "sac" as const, taxaAoMes: 0.006434 },
  ])("a entrada devolvida produz a parcela pedida em $sistemaAmortizacao", (plano) => {
    const alvo = 800;
    const bensEPermutas = [CARRO_NA_ENTRADA];

    const { entrada, sobra } = entradaParaAParcela({
      baloesQuantidade: 0,
      baloesValor: 0,
      bensEPermutas,
      parcela: alvo,
      parcelas: 120,
      valor: 200_000,
      ...plano,
    });

    expect(sobra).toBe(0);
    const montada = montarProposta({
      baloesQuantidade: 0,
      baloesValor: 0,
      bensEPermutas,
      entrada,
      parcelas: 120,
      valor: 200_000,
      ...plano,
    });

    expect(montada.parcela).toBeCloseTo(alvo, 6);
  });

  it("no SACOC a conta é direta: 200.000 − 80.000 − 800 × 120 = R$ 24.000 de entrada", () => {
    expect(
      entradaParaAParcela({
        baloesQuantidade: 0,
        baloesValor: 0,
        bensEPermutas: [CARRO_NA_ENTRADA],
        parcela: 800,
        parcelas: 120,
        sistemaAmortizacao: "sacoc",
        taxaAoMes: 0,
        valor: 200_000,
      }),
    ).toEqual({ entrada: 24_000, sobra: 0 });
  });

  it("lista vazia e lista ausente se comportam como hoje", () => {
    const base = {
      baloesQuantidade: 0,
      baloesValor: 0,
      parcela: 800,
      parcelas: 120,
      sistemaAmortizacao: "sacoc" as const,
      taxaAoMes: 0,
      valor: 200_000,
    };

    expect(entradaParaAParcela({ ...base, bensEPermutas: [] })).toEqual(
      entradaParaAParcela(base),
    );
    expect(entradaParaAParcela(base)).toEqual({ entrada: 104_000, sobra: 0 });
  });
});

describe("composicoesQueFecham com bem ou permuta", () => {
  const PLANOS: PlanoDaComposicao[] = [
    {
      entradaPercentual: 20,
      nome: "Investidor",
      parcelas: 24,
      sistemaAmortizacao: "sacoc",
      taxaAoMes: 0.0072,
    },
    {
      entradaPercentual: 10,
      nome: "Normal",
      parcelas: 60,
      sistemaAmortizacao: "sacoc",
      taxaAoMes: 0.0072,
    },
  ];

  /**
   * ⚠️ A VARREDURA E O RAMO MONTADO TÊM QUE DAR O MESMO FINANCIADO. Sem o bem na varredura, a mesma
   * tela mostra dois números para a mesma venda: o cartão da composição recomendada e o rodapé
   * "O que vai sair" — que é o que vira PDF.
   */
  it("o financiado da composição já desconta o bem", () => {
    const achadas = composicoesQueFecham({
      bensEPermutas: [CARRO_NA_ENTRADA],
      parcelaAlvo: 1_000,
      planos: PLANOS,
      valor: 200_000,
    });

    expect(achadas.length).toBeGreaterThan(0);
    for (const c of achadas) {
      const plano = PLANOS.find((p) => p.nome === c.plano);
      expect(plano).toBeTruthy();
      const montada = montarProposta({
        baloesQuantidade: c.anuais.quantidade,
        baloesValor: c.anuais.valor,
        bensEPermutas: [CARRO_NA_ENTRADA],
        entrada: c.entrada,
        parcelas: c.parcelas,
        sistemaAmortizacao: plano?.sistemaAmortizacao ?? "sacoc",
        taxaAoMes: plano?.taxaAoMes ?? 0,
        valor: c.valor,
      });

      expect(c.financiado).toBeCloseTo(montada.financiado, 6);
      expect(c.parcela).toBeCloseTo(montada.parcela, 6);
      expect(c.financiado).toBeGreaterThan(0);
    }
  });

  it("sem bem, a lista sai idêntica à de hoje", () => {
    const base = { parcelaAlvo: 1_000, planos: PLANOS, valor: 200_000 };

    expect(composicoesQueFecham({ ...base, bensEPermutas: [] })).toEqual(
      composicoesQueFecham(base),
    );
    expect(composicoesQueFecham({ ...base, bensEPermutas: null })).toEqual(
      composicoesQueFecham(base),
    );
  });
});
