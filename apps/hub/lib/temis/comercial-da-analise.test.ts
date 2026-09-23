import { describe, expect, it } from "vitest";

import { comercialDaProposta, descontoDaProposta } from "./comercial-da-analise";

// A RÉGUA QUE DECIDE SE A TÊMIS APONTA DESCONTO.
//
// Lucas (10/09/2026): *"se tiver desconto tem que vir falando"*. O outro lado disso é não falar
// quando não há — um alerta que dispara à toa ensina o operador a ignorar todos, e aí o desconto
// de verdade passa junto com o ruído.

const TABELA = 150_000;

/**
 * O valor em reais com o espaço que o `Intl` do pt-BR realmente usa entre o símbolo e o número.
 *
 * ⚠️ É U+00A0 (não separável), e não o espaço da barra. Escrever o literal com espaço comum
 * produz um diff que parece idêntico na tela e falha mesmo assim — custou uma rodada aqui.
 */
function moeda(texto: string): string {
  return `R$\u00a0${texto}`;
}


describe("descontoDaProposta — quando o alerta aparece", () => {
  it("aponta o desconto com as duas medidas e a tabela do dia", () => {
    const d = descontoDaProposta(
      { ajuste_modo: "percentual", ajuste_valor: -5, preco_tabela: TABELA },
      142_500,
    );

    expect(d).not.toBeNull();
    expect(d?.acrescimo).toBe(false);
    expect(d?.emReais).toBe(moeda("7.500,00"));
    expect(d?.emPercentual).toBe("5%");
    expect(d?.tabela).toBe(moeda("150.000,00"));
    // Quem aprova desconto pensa em percentual; a moeda em que foi PENSADO é parte do que se
    // analisa, e some se guardarmos só o resultado.
    expect(d?.modo).toBe("percentual");
  });

  it("guarda que foi pensado em reais quando foi digitado em reais", () => {
    const d = descontoDaProposta(
      { ajuste_modo: "reais", ajuste_valor: -7_500, preco_tabela: TABELA },
      142_500,
    );

    // Mesmo número, outra intenção: R$ 7.500 e 5% coincidem neste lote e só neste.
    expect(d?.modo).toBe("reais");
    expect(d?.emReais).toBe(moeda("7.500,00"));
    expect(d?.emPercentual).toBe("5%");
  });

  it("chama acréscimo de acréscimo, e não de desconto negativo", () => {
    const d = descontoDaProposta(
      { ajuste_modo: "reais", ajuste_valor: 3_000, preco_tabela: TABELA },
      153_000,
    );

    expect(d?.acrescimo).toBe(true);
    // O valor sai sem sinal: quem diz a direção é a bandeira, não um menos escondido no texto.
    expect(d?.emReais).toBe(moeda("3.000,00"));
  });

  it("lê os números como o Postgres devolve — string", () => {
    // ⚠️ `numeric` do Postgres chega no cliente como STRING. Tratar só `number` faria a régua
    // devolver `null` para toda proposta real e o alerta nunca aparecer — calado, que é pior.
    const d = descontoDaProposta(
      { ajuste_modo: "percentual", ajuste_valor: "-5", preco_tabela: "150000.00" },
      142_500,
    );

    expect(d?.emReais).toBe(moeda("7.500,00"));
  });
});

describe("descontoDaProposta — quando fica calado", () => {
  it("cala nas propostas anteriores à 0151, que não congelaram a tabela", () => {
    // As 4.857 importadas do C2X e todas as nativas antes da migration. Sem tabela do dia, a
    // diferença entre `valor` e o cadastro de hoje não prova desconto nenhum.
    expect(
      descontoDaProposta(
        { ajuste_modo: null, ajuste_valor: null, preco_tabela: null },
        142_500,
      ),
    ).toBeNull();
  });

  it("cala quando há tabela mas ninguém registrou ajuste", () => {
    // ⚠️ ESTE É O CASO QUE IMPEDE A TAUTOLOGIA. A carga do C2X escreveu o MESMO número em
    // `valor` e no preço da unidade; sem ajuste registrado, uma diferença qualquer entre os dois
    // é resíduo de cadastro, não desconto negociado — medido: 4.856 de 4.863 batem ao centavo.
    expect(
      descontoDaProposta(
        { ajuste_modo: null, ajuste_valor: null, preco_tabela: TABELA },
        142_500,
      ),
    ).toBeNull();
  });

  it("cala quando o ajuste existe mas o preço não mudou", () => {
    expect(
      descontoDaProposta(
        { ajuste_modo: "percentual", ajuste_valor: -5, preco_tabela: TABELA },
        TABELA,
      ),
    ).toBeNull();
  });

  it("recusa modo que a constraint não aceita", () => {
    // O CHECK da 0151 só admite 'percentual' e 'reais'. Um modo estranho no banco significa dado
    // que ninguém sabe interpretar — apontar desconto em cima dele seria inventar.
    expect(
      descontoDaProposta(
        { ajuste_modo: "porcentagem", ajuste_valor: -5, preco_tabela: TABELA },
        142_500,
      ),
    ).toBeNull();
  });

  it("cala com tabela zerada ou negativa, em vez de dividir por zero", () => {
    for (const tabela of [0, -1]) {
      expect(
        descontoDaProposta(
          { ajuste_modo: "reais", ajuste_valor: -100, preco_tabela: tabela },
          142_500,
        ),
      ).toBeNull();
    }
  });

  it("ignora diferença de menos de um centavo", () => {
    // Arredondamento do cronograma não é desconto.
    expect(
      descontoDaProposta(
        { ajuste_modo: "reais", ajuste_valor: -0.004, preco_tabela: TABELA },
        149_999.999,
      ),
    ).toBeNull();
  });
});

// ── O BEM E A PERMUTA NA ANÁLISE JURÍDICA ────────────────────────────────────
//
// ⚠️ O TOTAL DEIXOU DE BATER COM AS PRÓPRIAS LINHAS EM 22/09/2026. `totais.geral` passou a somar os
// bens e permutas (`cronograma.ts`: *"o total geral de uma venda com carro de R$ 80.000 sairia
// R$ 80.000 menor que o lote"*), e os destaques ao lado continuaram sendo só entrada e financiado.
// Num lote de R$ 200.000 com permuta de R$ 80.000, quem analisa lê Entrada R$ 20.000, Financiado
// R$ 100.000 e um desembolso que traz oitenta mil reais que nenhuma linha da tela explica.
//
// ⚠️ NADA DE BANCO: o cliente é um duplo que devolve a linha da proposta e a área da unidade. O que
// se prova é a LEITURA, não o SQL.
function clienteFalso(proposta: unknown, area: null | number = 300) {
  const encadeia = (dados: unknown): unknown => {
    const alvo: Record<string, unknown> = {
      maybeSingle: () => Promise.resolve({ data: dados, error: null }),
    };
    return new Proxy(alvo, {
      get(_a, prop: string) {
        if (prop === "maybeSingle") return alvo.maybeSingle;
        return () => encadeia(dados);
      },
    });
  };
  return {
    from: (tabela: string) =>
      encadeia(tabela === "hercules_propostas" ? proposta : area === null ? null : { area }),
  } as never;
}

/** O lote de R$ 200.000 com permuta de R$ 80.000 — o caso que o Lucas descreveu em 22/09/2026. */
const COM_PERMUTA = {
  ajuste_modo: null,
  ajuste_valor: null,
  condicoes: {
    anuais: [],
    entrada: [{ numero: 1, total: 1, valor: 20_000, vencimento: "2026-10-10" }],
    mensais: Array.from({ length: 100 }, (_, k) => ({
      numero: k + 1,
      valor: 1_000,
      vencimento: "2026-11-10",
    })),
    reajustes: [],
    totais: {
      anuais: 0,
      bensEPermutas: 80_000,
      entrada: 20_000,
      financiado: 100_000,
      geral: 200_000,
      mensais: 100_000,
    },
  },
  contrato_parcelas: 100,
  dia_vencimento: 10,
  plano_correcao: null,
  plano_juros: null,
  plano_nome: "NORMAL",
  plano_parcelas: 100,
  preco_tabela: 200_000,
  unidade_id: "dddddddd-0000-0000-0000-000000000001",
  valor: 200_000,
};

/** A MESMA venda sem bem nenhum: a entrada cobre o que a permuta cobria. */
const SEM_PERMUTA = {
  ...COM_PERMUTA,
  condicoes: {
    ...COM_PERMUTA.condicoes,
    totais: { ...COM_PERMUTA.condicoes.totais, bensEPermutas: 0, financiado: 180_000 },
  },
};

const valorDo = (
  destaques: readonly { rotulo: string; valor: string }[],
  rotulo: string,
): string | undefined => destaques.find((d) => d.rotulo === rotulo)?.valor;

describe("a análise jurídica mostra entrada, bem, financiado e total coerentes", () => {
  it("⚠️ o bem ganha destaque próprio, e os quatro números fecham entre si", async () => {
    const c = await comercialDaProposta(clienteFalso(COM_PERMUTA), "p1");

    expect(valorDo(c?.destaques ?? [], "Valor da unidade")).toBe(moeda("200.000,00"));
    expect(valorDo(c?.destaques ?? [], "Entrada")).toBe(moeda("20.000,00"));
    expect(valorDo(c?.destaques ?? [], "Bem e permuta")).toBe(moeda("80.000,00"));
    expect(valorDo(c?.destaques ?? [], "Financiado")).toBe(moeda("100.000,00"));
    // 20.000 + 80.000 + 100.000 = 200.000: a conta que quem analisa refaz na ponta do lápis.
    expect(c?.total).toBe(moeda("200.000,00"));
  });

  it("o destaque do bem diz o que ele faz com o saldo", async () => {
    const c = await comercialDaProposta(clienteFalso(COM_PERMUTA), "p1");
    const bem = c?.destaques.find((d) => d.rotulo === "Bem e permuta");

    expect(bem?.detalhe).toContain("40%");
    expect(bem?.detalhe).toContain("abate o saldo");
  });

  // ⚠️ A IMENSA MAIORIA DAS VENDAS NÃO TEM BEM NENHUM — inclusive as 4.857 importadas do C2X, cujo
  // `condicoes` sequer tem a chave. A tela delas tem de sair idêntica à de hoje: "Bem e permuta:
  // R$ 0,00" no meio dos destaques parece defeito do sistema, e é o tipo de ruído que ensina o
  // operador a ignorar a tela inteira.
  it("⚠️ sem bem, os destaques são os MESMOS de antes", async () => {
    const comZero = await comercialDaProposta(clienteFalso(SEM_PERMUTA), "p1");

    const semAChave = {
      ...SEM_PERMUTA,
      condicoes: {
        ...SEM_PERMUTA.condicoes,
        totais: {
          anuais: 0,
          entrada: 20_000,
          financiado: 180_000,
          geral: 200_000,
          mensais: 100_000,
        },
      },
    };
    const comoAsImportadas = await comercialDaProposta(clienteFalso(semAChave), "p1");

    expect(comZero?.destaques.map((d) => d.rotulo)).not.toContain("Bem e permuta");
    expect(comoAsImportadas?.destaques).toEqual(comZero?.destaques);
    expect(comoAsImportadas?.condicoes).toEqual(comZero?.condicoes);
  });

  it("⚠️ o bem entra ENTRE a entrada e o financiado, que é a ordem da conta", async () => {
    const c = await comercialDaProposta(clienteFalso(COM_PERMUTA), "p1");
    const rotulos = (c?.destaques ?? []).map((d) => d.rotulo);

    expect(rotulos.indexOf("Entrada")).toBeLessThan(rotulos.indexOf("Bem e permuta"));
    expect(rotulos.indexOf("Bem e permuta")).toBeLessThan(rotulos.indexOf("Financiado"));
  });
});
