import { describe, expect, it } from "vitest";

import { descontoDaProposta } from "./comercial-da-analise";

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
