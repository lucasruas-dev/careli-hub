import { describe, expect, it } from "vitest";

import { faixaDoPrazo, type PlanoDaFaixa, pisoDaEntradaNoPrazo } from "./faixa-do-plano";

/** A tabela do ZZ TESTE, como ela está cadastrada — e o exemplo que o Lucas usou para explicar. */
const TABELA: PlanoDaFaixa[] = [
  { entradaPercentual: 10, nome: "PLANO NORMAL", parcelas: 120 },
  { entradaPercentual: 20, nome: "PLANO CURTO", parcelas: 60 },
  { entradaPercentual: 40, nome: "PLANO INVESTIDOR", parcelas: 36 },
  { entradaPercentual: 100, nome: "PLANO A VISTA", parcelas: 1 },
];

const LOTE = 140_000;

describe("faixaDoPrazo — o degrau que comporta o parcelamento", () => {
  it("⚠️ 30 parcelas caem no INVESTIDOR, não no normal", () => {
    // Lucas: *"se eu colocar o parcelamento de 30 vezes eu não posso ter uma entrada menor que
    // 56k, pois está dentro do plano investidor"*. 30 não escolhe o plano de 120: escolhe o
    // primeiro degrau que cabe.
    expect(faixaDoPrazo(TABELA, 30)?.nome).toBe("PLANO INVESTIDOR");
  });

  it("⚠️ 48 parcelas caem no CURTO", () => {
    // *"se eu colocar 48 eu não posso ter uma entrada menor que 28k"*.
    expect(faixaDoPrazo(TABELA, 48)?.nome).toBe("PLANO CURTO");
  });

  it("o prazo exato do plano cai nele mesmo, e não no seguinte", () => {
    expect(faixaDoPrazo(TABELA, 36)?.nome).toBe("PLANO INVESTIDOR");
    expect(faixaDoPrazo(TABELA, 60)?.nome).toBe("PLANO CURTO");
    expect(faixaDoPrazo(TABELA, 120)?.nome).toBe("PLANO NORMAL");
    expect(faixaDoPrazo(TABELA, 1)?.nome).toBe("PLANO A VISTA");
  });

  it("prazo que nenhum plano comporta não inventa faixa", () => {
    // Pedir 180 numa tabela que vai até 120: quem chama decide o que dizer.
    expect(faixaDoPrazo(TABELA, 180)).toBeNull();
  });

  it("prazo inválido não vira faixa", () => {
    expect(faixaDoPrazo(TABELA, 0)).toBeNull();
    expect(faixaDoPrazo(TABELA, -5)).toBeNull();
    expect(faixaDoPrazo(TABELA, Number.NaN)).toBeNull();
  });

  it("⚠️ a ordem da lista não muda a resposta", () => {
    // A lista chega do banco sem `order` e do C2X na ordem do legado: sem ordenar, o mesmo prazo
    // cairia ora num plano, ora noutro, e a entrada mínima mudaria entre dois cliques iguais.
    const embaralhada = [TABELA[2]!, TABELA[0]!, TABELA[3]!, TABELA[1]!];
    expect(faixaDoPrazo(embaralhada, 30)?.nome).toBe("PLANO INVESTIDOR");
    expect(faixaDoPrazo(embaralhada, 48)?.nome).toBe("PLANO CURTO");
  });

  it("tabela vazia não quebra", () => {
    expect(faixaDoPrazo([], 60)).toBeNull();
  });
});

describe("pisoDaEntradaNoPrazo — quanto o prazo exige, em reais", () => {
  const piso = (parcelas: number, pisoDaCasaEmReais = 14_000) =>
    pisoDaEntradaNoPrazo({ parcelas, pisoDaCasaEmReais, planos: TABELA, valorNegociado: LOTE });

  it("⚠️ os dois números que o Lucas ditou", () => {
    expect(piso(30).emReais).toBe(56_000); // 40% de 140.000
    expect(piso(48).emReais).toBe(28_000); // 20% de 140.000
  });

  it("no prazo longo vale o piso da casa, que é o mesmo 10%", () => {
    expect(piso(120).emReais).toBe(14_000);
  });

  it("⚠️ o piso da casa continua valendo por baixo", () => {
    // Um empreendimento cujo plano longo pede 8% não passa a vender abaixo do mínimo da Careli só
    // porque a tabela dele diz isso.
    const comPisoMaior = pisoDaEntradaNoPrazo({
      parcelas: 120,
      pisoDaCasaEmReais: 20_000,
      planos: TABELA,
      valorNegociado: LOTE,
    });
    expect(comPisoMaior.emReais).toBe(20_000);
  });

  it("⚠️ arredonda no centavo e para CIMA — nunca abaixo do que a tabela manda", () => {
    // 40% de R$ 145.451 é R$ 58.180,40. Truncar no real daria um piso abaixo da tabela, e a tela
    // acusaria "abaixo do mínimo" no próprio número que ela sugeriu.
    const r = pisoDaEntradaNoPrazo({
      parcelas: 30,
      pisoDaCasaEmReais: 0,
      planos: TABELA,
      valorNegociado: 145_451,
    });
    expect(r.emReais).toBe(58_180.4);
  });

  it("prazo sem plano devolve só o piso da casa, e diz que não achou faixa", () => {
    const r = piso(180);
    expect(r.faixa).toBeNull();
    expect(r.emReais).toBe(14_000);
  });

  it("valor de lote ausente não vira piso negativo nem NaN", () => {
    const r = pisoDaEntradaNoPrazo({
      parcelas: 30,
      pisoDaCasaEmReais: 14_000,
      planos: TABELA,
      valorNegociado: Number.NaN,
    });
    expect(r.emReais).toBe(14_000);
  });

  it("a faixa volta junto, para a tela poder dizer de quem é a régua", () => {
    expect(piso(30).faixa?.nome).toBe("PLANO INVESTIDOR");
    expect(piso(30).faixa?.parcelas).toBe(36);
  });
});
