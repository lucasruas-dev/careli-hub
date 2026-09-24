import { describe, expect, it } from "vitest";

import { parcelaDoCicloSacoc } from "@/lib/apolo/planos-comerciais";
import {
  jurosAnualDoContrato,
  montarQuadroAnual,
  primeiroVencimentoDoContrato,
  sistemaDeclarado,
  sistemaDoContrato,
  somarMeses,
  taxaMensalDoAniversario,
} from "@/lib/apolo/reajuste/quadro-anual";
import { mesAnterior, type SerieMensal } from "@/lib/apolo/reajuste/serie-de-indice";

/** Série sintética: `meses` meses terminando em `ate`, todos com a mesma variação. */
function serieDe(ate: string, meses: number, variacao: number): SerieMensal {
  const serie: SerieMensal = new Map();
  let cursor = ate;
  for (let i = 0; i < meses; i += 1) {
    serie.set(cursor, variacao);
    cursor = mesAnterior(cursor);
  }
  return serie;
}

const trunc = (v: number) => Math.floor(v * 100 + 1e-9) / 100;

// O contrato do print do Lucas: LOS0617, ato em 02/08/2024, primeira parcela em 20/09/2024,
// R$ 452,43 × 144, 8% a.a., IPCA anual.
const LOS0617 = {
  dataDoContrato: "2024-08-02",
  jurosAnualPct: 8,
  mesTipicoPct: 0.35,
  parcelaBase: 452.43,
  prazo: 144,
  primeiroVencimento: "2024-09-20",
  sistema: "sacoc" as const,
};

describe("a regra da Lavra, peça por peça", () => {
  it("⚠️ a taxa do ano é índice + juros em SOMA SIMPLES, mensalizada composta e TRUNCADA", () => {
    // (1 + 0,1226)^(1/12) − 1 = 0,00968388…, truncada em 7 casas.
    expect(taxaMensalDoAniversario(8, 4.26)).toBe(0.0096838);
    // Só os juros: (1,08)^(1/12) − 1 = 0,0064340…
    expect(taxaMensalDoAniversario(8, 0)).toBe(0.006434);
  });

  it("⚠️ REPRODUZ O APLICADO: LOS0617, R$ 452,43 com IPCA 4,26% + 8% vira R$ 481,94 exato", () => {
    // É o contrato do print do Lucas. A curva da casa (a mesma do gerador de proposta) bate a
    // centavo com o que a Lavra lançou no C2X.
    const m = taxaMensalDoAniversario(8, 4.26);
    expect(trunc(parcelaDoCicloSacoc(452.43 * 144, m, 144, 2))).toBe(481.94);
  });
});

describe("jurosAnualDoContrato", () => {
  it("8.0000 é ao ano (Lavra do Ouro), e passa como está", () => {
    expect(jurosAnualDoContrato(8)).toBe(8);
  });

  it("⚠️ 0.6434 é ao MÊS (Villa Paris) e vira ~8% ao ano por composição, não 0,64%", () => {
    expect(jurosAnualDoContrato(0.6434)).toBeCloseTo(8.0, 1);
    expect(jurosAnualDoContrato(0.7207)).toBeCloseTo(9.0, 1);
  });

  it("⚠️ taxa AUSENTE é null (desconhecida), e não zero: juro zero é outra coisa", () => {
    // LOS0619: pedido sem plano ligado, mesmo produto de 8% + IPCA do LOS0617. Devolver 0 fazia o
    // quadro afirmar "0,00% a.a." e um total R$ 71 mil abaixo do real.
    expect(jurosAnualDoContrato(null)).toBeNull();
    expect(jurosAnualDoContrato(undefined)).toBeNull();
    expect(jurosAnualDoContrato(Number.NaN)).toBeNull();
    // O plano curto da Lavra tem juro ZERO de verdade, e esse continua sendo zero.
    expect(jurosAnualDoContrato(0)).toBe(0);
  });
});

describe("sistemaDeclarado", () => {
  it("⚠️ o nome do plano vem antes: o Veredas do Ouro vende as duas tabelas no mesmo empreendimento", () => {
    expect(
      sistemaDeclarado({ planoNome: "PLANO NORMAL PRICE", tabelaDoEmpreendimento: "SACOOC" }),
    ).toBe("price");
    expect(
      sistemaDeclarado({ planoNome: "PLANO NORMAL SACOC", tabelaDoEmpreendimento: "PRICE" }),
    ).toBe("sacoc");
  });

  it("sem sistema no nome, vale a tabela do empreendimento (o MDS é PRICE)", () => {
    expect(sistemaDeclarado({ planoNome: "MDS-NORMAL", tabelaDoEmpreendimento: "PRICE" })).toBe(
      "price",
    );
    expect(sistemaDeclarado({ planoNome: "PLANO-NORMAL", tabelaDoEmpreendimento: "SACOOC" })).toBe(
      "sacoc",
    );
  });

  it("sem nada declarado, devolve null e a dedução pela parcela decide", () => {
    expect(sistemaDeclarado({ planoNome: null, tabelaDoEmpreendimento: null })).toBeNull();
    expect(sistemaDeclarado({ planoNome: "12% ENTRADA + 36 VEZES", tabelaDoEmpreendimento: "" })).toBeNull();
  });
});

describe("primeiroVencimentoDoContrato", () => {
  const mensaisDesde = (ordem: number, vencimento: string, quantas: number) =>
    Array.from({ length: quantas }, (_, i) => {
      const total = Number(vencimento.slice(0, 4)) * 12 + Number(vencimento.slice(5, 7)) - 1 + i;
      const mes = String((total % 12) + 1).padStart(2, "0");
      return { ordem: ordem + i, vencimento: `${Math.floor(total / 12)}-${mes}${vencimento.slice(7)}` };
    });

  it("contrato inteiro: a parcela 1 é o primeiro vencimento", () => {
    expect(primeiroVencimentoDoContrato(mensaisDesde(1, "2024-09-20", 144))).toBe("2024-09-20");
  });

  it("⚠️ LOS0404: o C2X começa na 18ª parcela, e a parcela 1 é reconstruída para set/2024", () => {
    // Antes: a primeira que sobrou virava parcela 1, e o contrato terminava em jan/2038.
    expect(primeiroVencimentoDoContrato(mensaisDesde(18, "2026-02-20", 127))).toBe("2024-09-20");
  });

  it("⚠️ uma parcela renegociada (vencimento mudado por acordo) não arrasta a âncora", () => {
    const mensais = mensaisDesde(1, "2024-09-20", 20);
    mensais[0] = { ordem: 1, vencimento: "2025-03-10" };
    expect(primeiroVencimentoDoContrato(mensais)).toBe("2024-09-20");
  });

  it("dia 31 recuado para fevereiro fica no último dia do mês, sem virar março", () => {
    expect(primeiroVencimentoDoContrato([{ ordem: 2, vencimento: "2025-03-31" }])).toBe("2025-02-28");
  });

  it("sem número de parcela, cai no menor vencimento", () => {
    expect(
      primeiroVencimentoDoContrato([
        { ordem: 0, vencimento: "2025-05-10" },
        { ordem: 0, vencimento: "2025-04-10" },
      ]),
    ).toBe("2025-04-10");
    expect(primeiroVencimentoDoContrato([])).toBeNull();
  });
});

describe("sistemaDoContrato", () => {
  it("o LOS0617 é SACOC: R$ 65.149,20 ÷ 144 = R$ 452,42, e a parcela é R$ 452,43", () => {
    expect(
      sistemaDoContrato({ financiado: 65149.2, jurosAnualPct: 8, parcela: 452.43, prazo: 144 }),
    ).toBe("sacoc");
  });

  it("a mesma dívida em PRICE a 8% dá ~R$ 695, e é reconhecida como PRICE", () => {
    expect(
      sistemaDoContrato({ financiado: 65149.2, jurosAnualPct: 8, parcela: 695.28, prazo: 144 }),
    ).toBe("price");
  });

  it("sem financiado conhecido, vale a SACOC, que é a regra da carteira", () => {
    expect(
      sistemaDoContrato({ financiado: null, jurosAnualPct: 8, parcela: 452.43, prazo: 144 }),
    ).toBe("sacoc");
  });
});

describe("montarQuadroAnual", () => {
  const serie = serieDe("202608", 240, 0.35);

  it("⚠️ o aniversário é o do CONTRATO: o 1º ciclo do LOS0617 tem 11 parcelas, não 12", () => {
    // Ato em 02/08/2024, primeira parcela em 20/09/2024: o reajuste entra na parcela de ago/2025.
    const q = montarQuadroAnual({ ...LOS0617, serie });
    expect(q.linhas[0]).toMatchObject({ ate: "202507", de: "202409", deParcela: 1, ateParcela: 11 });
    expect(q.linhas[1]).toMatchObject({ ate: "202607", de: "202508", deParcela: 12, ateParcela: 23 });
  });

  it("vai da PRIMEIRA à ÚLTIMA parcela, sem perder nenhuma", () => {
    const q = montarQuadroAnual({ ...LOS0617, serie });
    const parcelas = q.linhas.reduce((t, l) => t + (l.ateParcela - l.deParcela + 1), 0);
    expect(parcelas).toBe(144);
    // A 144ª vence em ago/2036, depois do 12º aniversário (02/08/2036): cai num 13º ciclo sozinha.
    expect(q.linhas.at(-1)).toMatchObject({ ateParcela: 144, deParcela: 144, de: "203608" });
  });

  it("sem data do contrato, conta do primeiro vencimento (ciclos de 12 parcelas)", () => {
    const q = montarQuadroAnual({ ...LOS0617, dataDoContrato: null, serie });
    expect(q.linhas[0]).toMatchObject({ deParcela: 1, ateParcela: 12 });
  });

  it("o primeiro ano é SÓ a amortização: sem juros e sem correção", () => {
    const q = montarQuadroAnual({ ...LOS0617, serie });
    expect(q.linhas[0]).toMatchObject({
      amortizacao: 452.43,
      correcao: 0,
      juros: 0,
      origem: "sem-reajuste",
      parcela: 452.43,
    });
  });

  it("⚠️ a parcela FECHA: amortização + juros + correção = parcela, em todo ciclo", () => {
    const q = montarQuadroAnual({ ...LOS0617, serie });
    for (const l of q.linhas) {
      expect(l.amortizacao + l.juros + l.correcao).toBeCloseTo(l.parcela, 2);
    }
  });

  it("⚠️ juros e correção são partes da MESMA taxa, e a correção é a sobra sobre só-juros", () => {
    const q = montarQuadroAnual({ ...LOS0617, serie });
    const ano2 = q.linhas[1];
    const soJuros = trunc(parcelaDoCicloSacoc(452.43 * 144, taxaMensalDoAniversario(8, 0), 144, 2));
    expect(ano2?.juros).toBeCloseTo(soJuros - 452.43, 2);
    expect(ano2?.correcao).toBeGreaterThan(0);
    // A taxa do ano é a soma simples.
    expect(ano2?.taxaDoAnoPct).toBeCloseTo(8 + (ano2?.indicePct ?? 0), 6);
  });

  it("⚠️ PRICE: o juro já está na parcela, o aniversário traz SÓ a correção, acumulada", () => {
    const q = montarQuadroAnual({ ...LOS0617, serie, sistema: "price" });
    expect(q.jurosAnualPct).toBe(0);
    for (const l of q.linhas) expect(l.juros).toBe(0);
    const ano2 = q.linhas[1];
    const ano3 = q.linhas[2];
    expect(ano2?.parcela).toBeCloseTo(trunc(452.43 * (1 + (ano2?.indicePct ?? 0) / 100)), 2);
    // Acumula: o ano 3 sai de cima do ano 2.
    expect(ano3?.parcela ?? 0).toBeGreaterThan(ano2?.parcela ?? 0);
  });

  it("⚠️ o total FECHA: amortização × prazo + juros + correção = soma das parcelas", () => {
    const q = montarQuadroAnual({ ...LOS0617, serie });
    const somaDasLinhas = q.linhas.reduce((t, l) => t + l.totalDoCiclo, 0);
    expect(q.totalDoContrato).toBeCloseTo(somaDasLinhas, 1);
    expect(q.totalDeAmortizacao + q.totalDeJuros + q.totalDeCorrecao).toBeCloseTo(
      q.totalDoContrato,
      0,
    );
  });

  it("marca PUBLICADO quando os 12 meses já saíram, e ESTIMADO quando algum falta", () => {
    const q = montarQuadroAnual({ ...LOS0617, serie });
    expect(q.linhas[1]?.origem).toBe("publicado");
    expect(q.linhas[2]?.origem).toBe("publicado");
    expect(q.linhas[3]?.origem).toBe("estimado");
  });

  it("⚠️ otimista e conservador divergem SÓ no futuro: o passado é o mesmo", () => {
    const otimista = montarQuadroAnual({ ...LOS0617, mesTipicoPct: 0.2, serie });
    const conservador = montarQuadroAnual({ ...LOS0617, mesTipicoPct: 0.6, serie });
    expect(otimista.linhas[2]?.parcela).toBe(conservador.linhas[2]?.parcela);
    expect(conservador.linhas[5]?.parcela ?? 0).toBeGreaterThan(otimista.linhas[5]?.parcela ?? 0);
  });

  it("⚠️ série indisponível NÃO vira correção calada: a origem diz, e os juros continuam", () => {
    const q = montarQuadroAnual({ ...LOS0617, correcao: "indisponivel", serie: null });
    expect(q.linhas[1]?.origem).toBe("indisponivel");
    expect(q.linhas[1]?.correcao).toBe(0);
    expect(q.linhas[1]?.juros ?? 0).toBeGreaterThan(0);
  });

  it("contrato sem correção monetária: só os juros", () => {
    const q = montarQuadroAnual({ ...LOS0617, correcao: "sem-correcao", serie: null });
    expect(q.linhas[1]?.origem).toBe("sem-correcao");
    expect(q.linhas[1]?.correcao).toBe(0);
  });

  it("prazo curto: o último ciclo leva só as parcelas que sobram", () => {
    const q = montarQuadroAnual({ ...LOS0617, prazo: 30, serie });
    expect(q.linhas).toHaveLength(3);
    expect(q.linhas[2]).toMatchObject({ ateParcela: 30, deParcela: 24 });
    expect(q.linhas[2]?.totalDoCiclo).toBeCloseTo((q.linhas[2]?.parcela ?? 0) * 7, 2);
  });

  it("⚠️ o índice é o dos 12 meses que TERMINAM no mês do aniversário, mês a mês", () => {
    // Série com um salto isolado em ago/2025: ele entra no aniversário de 02/08/2025 (acumulado de
    // set/2024 a ago/2025). Se a janela terminasse em jul/2025, o salto ficaria de fora.
    const comSalto = serieDe("202608", 240, 0.3);
    comSalto.set("202508", 5);
    const q = montarQuadroAnual({ ...LOS0617, serie: comSalto });
    const esperado = ((1.003 ** 11) * 1.05 - 1) * 100;
    expect(q.linhas[1]?.indicePct).toBeCloseTo(esperado, 6);
  });

  it("nenhum valor sai como zero negativo (que a tela imprimiria como -R$ 0,00)", () => {
    const q = montarQuadroAnual({ ...LOS0617, serie, sistema: "price" });
    for (const l of q.linhas) expect(Object.is(l.juros, -0)).toBe(false);
  });

  describe("⚠️ carência: a primeira mensal vence DEPOIS do 1º aniversário", () => {
    // O LOS0617 com o ato um ano antes: o 1º ciclo de aniversário fica sem parcela nenhuma.
    const comCarencia = { ...LOS0617, dataDoContrato: "2023-08-02" };

    it("o primeiro ano PAGO continua sendo só a amortização", () => {
      const q = montarQuadroAnual({ ...comCarencia, serie });
      expect(q.linhas[0]).toMatchObject({
        correcao: 0,
        deParcela: 1,
        juros: 0,
        origem: "sem-reajuste",
        parcela: 452.43,
      });
    });

    it("⚠️ nenhum ciclo do fim volta para a amortização pura (a janela da curva não estoura)", () => {
      // Antes: o último ciclo saía a R$ 452,43, com juros e correção zerados, logo depois de um
      // ciclo a R$ 1.700 e tantos, porque o número do aniversário ia direto para a curva.
      const q = montarQuadroAnual({ ...comCarencia, serie });
      const parcelas = q.linhas.reduce((t, l) => t + (l.ateParcela - l.deParcela + 1), 0);
      expect(parcelas).toBe(144);
      for (const l of q.linhas.slice(1)) {
        expect(l.juros).toBeGreaterThan(0);
        expect(l.parcela).toBeGreaterThan(l.amortizacao);
      }
      const ultima = q.linhas.at(-1);
      const penultima = q.linhas.at(-2);
      expect(ultima?.parcela ?? 0).toBeGreaterThanOrEqual(penultima?.parcela ?? 0);
    });

    it("com a carência, a curva é a MESMA de um contrato sem ela: só o índice muda de mês", () => {
      const sem = montarQuadroAnual({ ...LOS0617, correcao: "sem-correcao", serie: null });
      const com = montarQuadroAnual({ ...comCarencia, correcao: "sem-correcao", serie: null });
      expect(com.linhas.map((l) => l.parcela)).toEqual(sem.linhas.map((l) => l.parcela));
    });

    it("no formato do MDS0306 (ato em 05/2024, 1ª parcela em 03/2026), o fim não despenca", () => {
      const q = montarQuadroAnual({
        ...LOS0617,
        dataDoContrato: "2024-05-19",
        primeiroVencimento: "2026-03-20",
        serie,
      });
      for (const l of q.linhas.slice(1)) expect(l.parcela).toBeGreaterThan(l.amortizacao);
    });
  });

  it("⚠️ índice NEGATIVO (IGP-M de 2023/24) entra com sinal, e a parcela continua fechando", () => {
    const negativa = serieDe("202608", 240, -0.6);
    const q = montarQuadroAnual({ ...LOS0617, serie: negativa });
    const ano2 = q.linhas[1];
    expect(ano2?.indicePct ?? 0).toBeLessThan(0);
    expect(ano2?.correcao ?? 0).toBeLessThan(0);
    expect((ano2?.amortizacao ?? 0) + (ano2?.juros ?? 0) + (ano2?.correcao ?? 0)).toBeCloseTo(
      ano2?.parcela ?? 0,
      2,
    );
  });
});

describe("somarMeses", () => {
  it("vira o ano", () => {
    expect(somarMeses("202409", 11)).toBe("202508");
    expect(somarMeses("202412", 1)).toBe("202501");
  });
});
