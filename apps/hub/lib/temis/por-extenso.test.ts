import { describe, expect, it } from "vitest";

import {
  areaPorExtenso,
  dinheiroPorExtenso,
  inteiroPorExtenso,
  quantidadePorExtenso,
} from "./por-extenso";

// ⚠️ CADA CASO AQUI É UM JEITO DE UM CONTRATO SAIR ERRADO. Valor por extenso divergente do número
// é motivo de devolução no cartório e de questionamento do comprador — e ninguém confere 27
// páginas antes de mandar assinar.

describe("as exceções que quase todo mundo erra", () => {
  it("“um mil”, a convenção de documento financeiro", () => {
    // Na fala é "mil reais"; em contrato e cheque escreve-se "um mil reais", porque a palavra na
    // frente impede que alguém acrescente um dígito. Decisão do Lucas.
    expect(inteiroPorExtenso(1000)).toBe("um mil");
    expect(dinheiroPorExtenso(1000)).toBe("um mil reais");
  });

  it("mas “um milhão” se escreve", () => {
    expect(inteiroPorExtenso(1_000_000)).toBe("um milhão");
  });

  it("cem é exato; acima disso é cento", () => {
    expect(inteiroPorExtenso(100)).toBe("cem");
    expect(inteiroPorExtenso(101)).toBe("cento e um");
    expect(inteiroPorExtenso(199)).toBe("cento e noventa e nove");
  });

  it("dois mil leva o “dois”", () => {
    expect(inteiroPorExtenso(2000)).toBe("dois mil");
  });

  it("zero existe e é valor legítimo (parcela de ato R$ 0,00 no C2X)", () => {
    expect(inteiroPorExtenso(0)).toBe("zero");
    expect(dinheiroPorExtenso(0)).toBe("zero reais");
  });
});

describe("a regra do “e” antes da última classe", () => {
  it("entra quando o final é menor que cem", () => {
    expect(inteiroPorExtenso(1015)).toBe("um mil e quinze");
  });

  it("entra quando o final é centena redonda", () => {
    expect(inteiroPorExtenso(1400)).toBe("um mil e quatrocentos");
    expect(inteiroPorExtenso(2_000_100)).toBe("dois milhões e cem");
  });

  it("NÃO entra quando a centena tem resto", () => {
    // "um mil duzentos e trinta e quatro", não "um mil E duzentos e trinta e quatro".
    expect(inteiroPorExtenso(1234)).toBe("um mil duzentos e trinta e quatro");
  });
});

describe("dinheiro, como sai no contrato", () => {
  it("o preço do lote do Villa Paris", () => {
    // R$ 185.400,00 — o valor real do contrato que auditamos.
    expect(dinheiroPorExtenso(185_400)).toBe("cento e oitenta e cinco mil e quatrocentos reais");
  });

  it("com centavos", () => {
    expect(dinheiroPorExtenso(1234.56)).toBe(
      "um mil duzentos e trinta e quatro reais e cinquenta e seis centavos",
    );
  });

  it("um real no singular, e um centavo também", () => {
    expect(dinheiroPorExtenso(1)).toBe("um real");
    expect(dinheiroPorExtenso(0.01)).toBe("um centavo");
  });

  it("só centavos, sem parte inteira", () => {
    expect(dinheiroPorExtenso(0.5)).toBe("cinquenta centavos");
  });

  it("a parcela de 452,43 do contrato do Thiago", () => {
    expect(dinheiroPorExtenso(452.43)).toBe(
      "quatrocentos e cinquenta e dois reais e quarenta e três centavos",
    );
  });

  it("arredonda o centavo em vez de truncar", () => {
    // 0,005 não existe em dinheiro; truncar produziria "zero reais" para um valor não-zero.
    expect(dinheiroPorExtenso(10.005)).toBe("dez reais e um centavo");
  });
});

describe("área — e o bug que motivou este arquivo", () => {
  it("a área do lote do Villa Paris, sem repetir a unidade", () => {
    // O contrato real saiu com "trezentos metros quadrados metros quadrados" porque o dado guardado
    // já trazia a unidade e o template acrescentou de novo. Aqui a unidade sai UMA vez, e só daqui.
    const texto = areaPorExtenso(300);
    expect(texto).toBe("trezentos metros quadrados");
    expect(texto.match(/metros quadrados/g)).toHaveLength(1);
  });

  it("a parte decimal é decímetro quadrado, como na matrícula", () => {
    expect(areaPorExtenso(302.45)).toBe(
      "trezentos e dois metros quadrados e quarenta e cinco decímetros quadrados",
    );
  });

  it("singular quando é um só", () => {
    expect(areaPorExtenso(1)).toBe("um metro quadrado");
    expect(areaPorExtenso(2.01)).toBe("dois metros quadrados e um decímetro quadrado");
  });

  it("o número puro NÃO traz unidade — é o que impede a duplicação", () => {
    expect(inteiroPorExtenso(300)).toBe("trezentos");
    expect(inteiroPorExtenso(300)).not.toContain("metro");
  });
});

describe("quantidade, para “em 120 (cento e vinte) parcelas”", () => {
  it("os planos reais do JDG e do ACP", () => {
    expect(quantidadePorExtenso(120)).toBe("cento e vinte");
    expect(quantidadePorExtenso(36)).toBe("trinta e seis");
    expect(quantidadePorExtenso(24)).toBe("vinte e quatro");
    expect(quantidadePorExtenso(12)).toBe("doze");
  });
});

describe("valores grandes, que aparecem em contrato de área maior", () => {
  it("milhão com resto", () => {
    expect(dinheiroPorExtenso(1_250_000)).toBe("um milhão duzentos e cinquenta mil reais");
  });

  it("o maior valor visto na carteira (parcela de R$ 125.746,40)", () => {
    expect(dinheiroPorExtenso(125_746.4)).toBe(
      "cento e vinte e cinco mil setecentos e quarenta e seis reais e quarenta centavos",
    );
  });
});
