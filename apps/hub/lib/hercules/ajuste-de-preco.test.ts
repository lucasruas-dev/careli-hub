import { describe, expect, it } from "vitest";

import {
  aplicarAjuste,
  ajusteEntreValores,
  descreverAjuste,
  SEM_AJUSTE,
} from "./ajuste-de-preco";

// O lote do print do Lucas, para os números baterem com o que ele viu na tela.
const TABELA = 150_000;

describe("o desconto em percentual", () => {
  it("5% de desconto num lote de 150 mil dá 142.500", () => {
    const r = aplicarAjuste(TABELA, { modo: "percentual", valor: -5 });
    expect(r.valor).toBe(142_500);
    expect(r.emReais).toBe(-7_500);
    expect(r.emPercentual).toBe(-5);
  });

  // ⚠️ A TABELA NUNCA MUDA — é o pedido literal do Lucas: *"isso não pode mudar o valor original de
  // tabela"*. Ela viaja no resultado justamente para a tela poder mostrar as duas linhas.
  it("não toca no preço de tabela", () => {
    expect(aplicarAjuste(TABELA, { modo: "percentual", valor: -50 }).tabela).toBe(TABELA);
    expect(aplicarAjuste(TABELA, { modo: "reais", valor: -90_000 }).tabela).toBe(TABELA);
  });

  it("acréscimo em percentual sobe o preço", () => {
    const r = aplicarAjuste(TABELA, { modo: "percentual", valor: 2 });
    expect(r.valor).toBe(153_000);
    expect(r.emReais).toBe(3_000);
  });
});

describe("o desconto em reais", () => {
  it("R$ 7.500 de desconto viram 5% na outra medida", () => {
    const r = aplicarAjuste(TABELA, { modo: "reais", valor: -7_500 });
    expect(r.valor).toBe(142_500);
    expect(r.emPercentual).toBe(-5);
  });

  it("acréscimo de R$ 3.000 dá 2%", () => {
    const r = aplicarAjuste(TABELA, { modo: "reais", valor: 3_000 });
    expect(r.valor).toBe(153_000);
    expect(r.emPercentual).toBe(2);
  });
});

describe("os centavos, que é onde o contrato erra", () => {
  // ⚠️ `150000 * 0.95` em ponto flutuante dá 142499.99999999997. Sem a conta em centavos inteiros,
  // esse número vira o preço impresso no contrato — e a soma da tela não fecha com ela mesma.
  it("não arrasta ponto flutuante", () => {
    const r = aplicarAjuste(TABELA, { modo: "percentual", valor: -5 });
    expect(Number.isInteger(Math.round(r.valor * 100))).toBe(true);
    expect(r.valor + Math.abs(r.emReais)).toBe(TABELA);
  });

  it("as duas medidas fecham entre si em preço quebrado", () => {
    const r = aplicarAjuste(178_133.37, { modo: "percentual", valor: -7.5 });
    // O desconto somado de volta devolve exatamente a tabela, até o centavo.
    expect(Math.round((r.valor - r.emReais) * 100)).toBe(Math.round(178_133.37 * 100));
  });

  it("arredonda o centavo do percentual em vez de truncar", () => {
    // 1% de 150.000,01 = 1.500,0001 → um centavo e meio de arredondamento.
    const r = aplicarAjuste(150_000.01, { modo: "percentual", valor: -1 });
    expect(r.emReais).toBe(-1_500);
  });
});

describe("os limites — o que impede o lote de graça", () => {
  // ⚠️ MEDIDO EM 08/09/2026: a régua do servidor só exigia `valorNegociado > 0`. Dava para gerar
  // proposta de R$ 1,00 num lote de R$ 178.100 e o PDF saía. Isto não substitui a alçada comercial
  // (que é decisão de negócio e não existe ainda) — é sanidade de digitação.
  it("100% de desconto para no piso de um centavo, não em zero", () => {
    const r = aplicarAjuste(TABELA, { modo: "percentual", valor: -100 });
    expect(r.valor).toBe(0.01);
    expect(r.limitado).toBe(true);
  });

  it("desconto maior que a tabela é recortado", () => {
    const r = aplicarAjuste(TABELA, { modo: "reais", valor: -500_000 });
    expect(r.valor).toBe(0.01);
    expect(r.limitado).toBe(true);
  });

  // ⚠️ O QUE A TELA MOSTRA É O QUE ACONTECEU, não o que foi pedido. Quem digita -500.000 num lote de
  // 150.000 tem de ver o desconto real de R$ 149.999,99 — mostrar o pedido faria a subtração exibida
  // na tela não bater com o próprio total exibido logo abaixo.
  it("o ajuste mostrado é o efetivo, não o pedido", () => {
    const r = aplicarAjuste(TABELA, { modo: "reais", valor: -500_000 });
    expect(r.emReais).toBe(-149_999.99);
    expect(r.valor - r.emReais).toBe(TABELA);
  });

  it("percentual absurdo no modo errado não zera o lote", () => {
    // O caso real: queria R$ 500 de desconto e digitou -500 com o botão em "%".
    const r = aplicarAjuste(TABELA, { modo: "percentual", valor: -500 });
    expect(r.valor).toBe(0.01);
    expect(r.limitado).toBe(true);
  });
});

describe("os casos degenerados", () => {
  it("sem ajuste devolve a tabela intacta", () => {
    const r = aplicarAjuste(TABELA, SEM_AJUSTE);
    expect(r.valor).toBe(TABELA);
    expect(r.emReais).toBe(0);
    expect(r.limitado).toBe(false);
  });

  it("tabela zerada não inventa preço", () => {
    expect(aplicarAjuste(0, { modo: "reais", valor: -1_000 }).valor).toBe(0);
    expect(aplicarAjuste(0, { modo: "percentual", valor: -5 }).emPercentual).toBe(0);
  });

  it("número inválido não vira NaN no contrato", () => {
    expect(aplicarAjuste(TABELA, { modo: "reais", valor: Number.NaN }).valor).toBe(TABELA);
    expect(aplicarAjuste(Number.NaN, { modo: "reais", valor: -10 }).valor).toBe(0);
    expect(aplicarAjuste(TABELA, { modo: "reais", valor: Number.POSITIVE_INFINITY }).limitado).toBe(
      true,
    );
  });
});

describe("o ajuste lido de volta, a partir de dois valores", () => {
  // ⚠️ SERVE PARA A PROPOSTA JÁ GRAVADA e para o retrato da tabela: o preço de `hercules_unidades`
  // vem de uma CARGA do C2X, não de sincronização. Quando a tabela muda, a diferença entre ela e o
  // valor da proposta antiga não é mais um desconto concedido — é a tabela que andou.
  it("reconstrói o desconto de uma proposta gravada", () => {
    const r = ajusteEntreValores(TABELA, 142_500);
    expect(r.emReais).toBe(-7_500);
    expect(r.emPercentual).toBe(-5);
  });

  it("reconhece acréscimo", () => {
    expect(ajusteEntreValores(TABELA, 153_000).emPercentual).toBe(2);
  });

  it("valores iguais não são ajuste", () => {
    expect(ajusteEntreValores(TABELA, TABELA).emReais).toBe(0);
  });
});

describe("como a tela escreve", () => {
  it("desconto e acréscimo têm palavras diferentes", () => {
    expect(descreverAjuste(aplicarAjuste(TABELA, { modo: "percentual", valor: -5 }))).toBe(
      "Desconto de 5%",
    );
    expect(descreverAjuste(aplicarAjuste(TABELA, { modo: "reais", valor: 3_000 }))).toBe(
      "Acréscimo de 2%",
    );
  });

  it("sem ajuste não escreve nada", () => {
    expect(descreverAjuste(aplicarAjuste(TABELA, SEM_AJUSTE))).toBe("");
  });

  it("percentual quebrado sai com vírgula, no formato do Brasil", () => {
    expect(descreverAjuste(aplicarAjuste(TABELA, { modo: "reais", valor: -1_000 }))).toBe(
      "Desconto de 0,67%",
    );
  });
});
