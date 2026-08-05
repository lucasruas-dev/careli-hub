import { describe, expect, it } from "vitest";

import { atualizarParcela, extrairEncargosDoContrato, somarAtualizacao } from "./encargos";

// A REGRA QUE VAI PARA O PROCESSO. O que está travado aqui é a origem do número: multa e juros
// saem do CONTRATO do cliente (pedido do Lucas, 03/08), e o dossiê precisa citar a cláusula.

const TRECHO_REAL =
  "<p>Em caso de atraso, a parcela n&atilde;o paga at&eacute; o vencimento ser&aacute; acrescida de " +
  "multa morat&oacute;ria de 2% (dois por cento), juros de mora de 1% (um por cento) ao m&ecirc;s, " +
  "pro rata die, e atualiza&ccedil;&atilde;o monet&aacute;ria pelo &iacute;ndice contratual, sem preju&iacute;zo das despesas.</p>" +
  "<p>VII - CORRE&Ccedil;&Atilde;O MONET&Aacute;RIA Corre&ccedil;&atilde;o monet&aacute;ria: varia&ccedil;&atilde;o positiva do IPCA , com periodicidade ANUAL.</p>";

describe("extrairEncargosDoContrato", () => {
  it("tira multa, juros e indice do texto real do contrato, com a clausula citavel", () => {
    const e = extrairEncargosDoContrato(TRECHO_REAL);

    expect(e.multaPercent).toBe(2);
    expect(e.jurosMesPercent).toBe(1);
    expect(e.indiceCorrecao).toBe("IPCA");
    expect(e.origem).toBe("contrato");
    // A citação é o que sustenta o número no processo: sem ela o dossiê vira palpite.
    expect(e.clausula).toContain("multa morat");
  });

  // Contrato antigo/minuta diferente: não pode explodir nem inventar — cai no padrão SINALIZADO.
  it("sem clausula no texto, marca origem 'padrao' para o dossie avisar", () => {
    const e = extrairEncargosDoContrato("<p>Contrato sem clausula de mora.</p>");

    expect(e.origem).toBe("padrao");
    expect(e.multaPercent).toBe(2);
    expect(e.clausula).toBeNull();
  });

  it("contrato ausente nao quebra a geracao", () => {
    expect(extrairEncargosDoContrato(null).origem).toBe("padrao");
  });

  // Percentual com vírgula (0,5%) é comum em minuta antiga.
  it("aceita percentual com virgula", () => {
    const e = extrairEncargosDoContrato(
      "multa moratória de 2,5% (dois e meio) e juros de mora de 0,5% (meio) ao mês.",
    );

    expect(e.multaPercent).toBe(2.5);
    expect(e.jurosMesPercent).toBe(0.5);
  });
});

describe("atualizarParcela", () => {
  const encargos = extrairEncargosDoContrato(TRECHO_REAL);

  it("multa e fixa e juros sao pro rata die (1% ao mes / 30 x dias)", () => {
    const p = atualizarParcela({
      encargos,
      hoje: new Date("2026-08-03T12:00:00Z"),
      numero: "12",
      valorOriginal: 1000,
      vencimento: new Date("2026-07-04T12:00:00Z"),
    });

    expect(p.diasAtraso).toBe(30);
    expect(p.multa).toBeCloseTo(20, 2);
    expect(p.juros).toBeCloseTo(10, 2);
    expect(p.atualizado).toBeCloseTo(1030, 2);
  });

  // Parcela que vence hoje não tem juros — e não pode dar número negativo se a data for futura.
  it("sem dias de atraso, cobra so a multa e nunca juros negativos", () => {
    const p = atualizarParcela({
      encargos,
      hoje: new Date("2026-08-03T12:00:00Z"),
      numero: "13",
      valorOriginal: 1000,
      vencimento: new Date("2026-09-10T12:00:00Z"),
    });

    expect(p.diasAtraso).toBe(0);
    expect(p.juros).toBe(0);
    expect(p.atualizado).toBeCloseTo(1020, 2);
  });
});

describe("somarAtualizacao", () => {
  it("soma o quadro inteiro para o total do dossie", () => {
    const encargos = extrairEncargosDoContrato(TRECHO_REAL);
    const hoje = new Date("2026-08-03T12:00:00Z");
    const parcelas = [
      atualizarParcela({ encargos, hoje, numero: "1", valorOriginal: 1000, vencimento: new Date("2026-07-04T12:00:00Z") }),
      atualizarParcela({ encargos, hoje, numero: "2", valorOriginal: 500, vencimento: new Date("2026-07-04T12:00:00Z") }),
    ];

    const total = somarAtualizacao(parcelas);

    expect(total.original).toBe(1500);
    expect(total.multa).toBeCloseTo(30, 2);
    expect(total.juros).toBeCloseTo(15, 2);
    expect(total.atualizado).toBeCloseTo(1545, 2);
  });
});

// A MINUTA ANTIGA (Lavra do Ouro) — os contratos que de fato vão ao jurídico hoje. Redação e
// ORDEM diferentes: juros primeiro, multa depois, e índice "poupança" em vez de IPCA.
const TRECHO_MINUTA_ANTIGA =
  "2.8 Em caso de atraso no pagamento, o valor do d&eacute;bito ficar&aacute; sujeito &agrave; " +
  "atualiza&ccedil;&atilde;o deste d&eacute;bito, pelo &iacute;ndice acumulado de reajuste da poupan&ccedil;a, " +
  "acrescidos de juros compensat&oacute;rios de 1% (um por cento) ao m&ecirc;s e multa penal de 2% (dois por cento) " +
  "sobre o valor do d&eacute;bito, sem preju&iacute;zo da rescis&atilde;o contratual.";

describe("minuta antiga (contratos que vao ao juridico)", () => {
  it("le juros ANTES da multa e reconhece o indice poupanca", () => {
    const e = extrairEncargosDoContrato(TRECHO_MINUTA_ANTIGA);

    expect(e.origem).toBe("contrato");
    expect(e.multaPercent).toBe(2);
    expect(e.jurosMesPercent).toBe(1);
    expect(e.indiceCorrecao?.toLowerCase()).toContain("poupan");
    expect(e.clausula).toContain("juros compensat");
  });
});

// CORREÇÃO MONETÁRIA MANUAL (decisão do Lucas, 03/08). O sistema não tem os índices alimentados,
// então quem gera o dossiê digita o percentual. O que precisa estar travado: sem percentual a
// correção é ZERO (não some no atualizado disfarçada), e com percentual ela entra em linha própria.
describe("correcao monetaria manual", () => {
  const encargos = extrairEncargosDoContrato(TRECHO_REAL);
  const base = {
    encargos,
    hoje: new Date("2026-08-03T12:00:00Z"),
    numero: "1",
    valorOriginal: 1000,
    vencimento: new Date("2026-07-04T12:00:00Z"), // 30 dias
  };

  it("sem percentual informado, nao soma nada", () => {
    const p = atualizarParcela(base);

    expect(p.correcao).toBe(0);
    // 1000 + 2% de multa + 1% de juros no mês cheio.
    expect(p.atualizado).toBeCloseTo(1030, 2);
  });

  it("com percentual, aplica sobre o valor ORIGINAL e soma ao atualizado", () => {
    const p = atualizarParcela({ ...base, correcaoPercent: 4.5 });

    expect(p.correcao).toBeCloseTo(45, 2);
    expect(p.atualizado).toBeCloseTo(1075, 2);
    // A correção não pode contaminar multa e juros — elas continuam sobre o valor original.
    expect(p.multa).toBeCloseTo(20, 2);
    expect(p.juros).toBeCloseTo(10, 2);
  });

  it("percentual zero, negativo ou lixo nao vira correcao", () => {
    for (const pct of [0, -3, Number.NaN, null, undefined]) {
      expect(atualizarParcela({ ...base, correcaoPercent: pct }).correcao).toBe(0);
    }
  });

  it("o total traz a correcao somada e separada", () => {
    const parcelas = [
      atualizarParcela({ ...base, correcaoPercent: 10 }),
      atualizarParcela({ ...base, correcaoPercent: 10, numero: "2", valorOriginal: 500 }),
    ];

    const total = somarAtualizacao(parcelas);

    expect(total.original).toBe(1500);
    expect(total.correcao).toBeCloseTo(150, 2);
    // original + multa (30) + juros (15) + correção (150)
    expect(total.atualizado).toBeCloseTo(1695, 2);
  });
});
