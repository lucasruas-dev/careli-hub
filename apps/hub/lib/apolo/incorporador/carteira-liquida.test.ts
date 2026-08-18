import { describe, expect, it } from "vitest";

import type { PoliticaDoEmpreendimento } from "@/lib/apolo/liquido-incorporador";

import {
  agregarPorUnidade,
  lerSplit,
  type LinhaCruaDaCarteira,
  montarIndicadores,
  perfilDaParcela,
  situacaoDaLinha,
} from "./carteira-liquida";

// O DIA DO TESTE É FIXO: 17/08/2026 (a data do pedido do Lucas). Toda classificação de "vencida"
// e a janela de 12 meses da série dependem de "hoje", e teste que depende do relógio da máquina é
// teste que quebra em janeiro sem ninguém ter mexido em nada.
const HOJE = "2026-08-17";
const AGORA_MS = Date.parse("2026-08-17T12:00:00Z");

// Gestão de carteira de 50% de propósito: 0,5 é exato em ponto flutuante, então as somas do
// teste comparam com toEqual sem tolerância. (O C2X grava percentuais como 50 e como 0,50 — a
// regra normaliza os dois formatos.)
const POLITICA: PoliticaDoEmpreendimento = {
  comissaoPct: 7,
  entradaPct: 30,
  gestaoCarteiraPct: 50,
};

const POLITICAS = new Map<string, PoliticaDoEmpreendimento>([["VAL", POLITICA]]);

/** Linha crua de fábrica: parcela mensal PAGA de R$ 1.000 na unidade Q01 L01. */
function linha(sobrescreve: Partial<LinhaCruaDaCarteira> = {}): LinhaCruaDaCarteira {
  return {
    cliente: "Maria da Silva",
    competence: "07/2026",
    due_date: "2026-07-10",
    enterprise_code: "VAL",
    entrada_contratada: 30,
    imobiliaria: "Imobiliária X",
    parcel_type: "Parcela",
    parcela_n: 3,
    parcela_total: 120,
    payment_date: "2026-07-12",
    payment_id: 1,
    plano_personalizado: null,
    split_data: null,
    status_id: 5,
    unit_block: "Q01",
    unit_id: 10,
    unit_lot: "L01",
    unit_price: 100000,
    valor: 1000,
    valor_previsto: 1000,
    ...sobrescreve,
  };
}

/** O cenário-padrão dos indicadores: 4 parcelas, 2 unidades, 2 clientes. */
function cenario(): LinhaCruaDaCarteira[] {
  return [
    // Paga em julho, com split real apontando o incorporador: líquido 970.
    linha({
      payment_id: 1,
      split_data: JSON.stringify([
        { fixedValue: 970, name: "LOTEADORA VAL", profile: "Incorporador" },
      ]),
    }),
    // Vencida (venceu 01/08 e "hoje" é 17/08), ainda não paga: entra como inadimplente, pela
    // fórmula (50% de gestão): líquido 250.
    linha({
      cliente: "MARIA DA SILVA", // caixa diferente de propósito: é o MESMO cliente.
      due_date: "2026-08-01",
      payment_date: null,
      payment_id: 2,
      status_id: 6,
      valor: null,
      valor_previsto: 500,
    }),
    // A vencer em setembro (fora da janela da série, dentro dos KPIs): líquido 400.
    linha({
      cliente: "João Pereira",
      due_date: "2026-09-10",
      payment_date: null,
      payment_id: 3,
      status_id: 6,
      unit_block: "Q02",
      unit_id: 20,
      unit_lot: "L05",
      valor: null,
      valor_previsto: 800,
    }),
    // Ato pago em junho com split ÍNTEGRO SEM o incorporador: o rateio real diz que ele não
    // recebe nada nesta parcela — líquido 0 é FATO, não lacuna.
    linha({
      cliente: "João Pereira",
      due_date: "2026-06-05",
      parcel_type: "Ato",
      payment_date: "2026-06-06",
      payment_id: 4,
      split_data: JSON.stringify([{ name: "IMOBILIÁRIA X", value: 2000 }]),
      unit_block: "Q02",
      unit_id: 20,
      unit_lot: "L05",
      valor: 2000,
      valor_previsto: 2000,
    }),
  ];
}

describe("situacaoDaLinha", () => {
  it("paga quando há valor pago e data de pagamento", () => {
    expect(situacaoDaLinha(linha(), HOJE)).toBe("paga");
  });

  it("vencida pelo status 7, mesmo sem data de vencimento", () => {
    expect(
      situacaoDaLinha(
        linha({ due_date: null, payment_date: null, status_id: 7, valor: null }),
        HOJE,
      ),
    ).toBe("vencida");
  });

  it("vencida quando o vencimento passou e o status é cobrável", () => {
    expect(
      situacaoDaLinha(
        linha({ due_date: "2026-08-01", payment_date: null, status_id: 6, valor: null }),
        HOJE,
      ),
    ).toBe("vencida");
  });

  it("a vencer quando o vencimento ainda não chegou", () => {
    expect(
      situacaoDaLinha(
        linha({ due_date: "2026-09-01", payment_date: null, status_id: 6, valor: null }),
        HOJE,
      ),
    ).toBe("a_vencer");
  });

  it("status não cobrável (1, 2) vencido no papel NÃO vira inadimplência", () => {
    expect(
      situacaoDaLinha(
        linha({ due_date: "2026-01-01", payment_date: null, status_id: 2, valor: null }),
        HOJE,
      ),
    ).toBe("a_vencer");
  });
});

describe("agregarPorUnidade", () => {
  it("soma o líquido POR unidade, contando só as pagas, ordenado pelo rótulo", () => {
    const unidades = agregarPorUnidade(cenario(), POLITICAS, "Loteadora VAL", HOJE);

    // As duas em aberto (payment_id 2 e 3) ficam de fora: carteira é o que já entrou.
    expect(unidades).toEqual([
      {
        bruto: 1000,
        liquido: 970,
        parcelasPagas: 1,
        semLiquido: 0,
        unidade: "Q01 L01",
        unitId: "10",
      },
      {
        // O Ato com split íntegro sem o incorporador: líquido 0 é o rateio real, não falta de dado.
        bruto: 2000,
        liquido: 0,
        parcelasPagas: 1,
        semLiquido: 0,
        unidade: "Q02 L05",
        unitId: "20",
      },
    ]);
  });

  it("parcela sem como calcular entra em semLiquido, nunca como R$ 0", () => {
    const semPolitica = new Map<string, PoliticaDoEmpreendimento>();
    const unidades = agregarPorUnidade([linha()], semPolitica, null, HOJE);

    expect(unidades).toEqual([
      {
        bruto: 1000,
        liquido: 0,
        parcelasPagas: 1,
        semLiquido: 1,
        unidade: "Q01 L01",
        unitId: "10",
      },
    ]);
  });
});

describe("montarIndicadores", () => {
  const indicadores = montarIndicadores(cenario(), {
    agoraMs: AGORA_MS,
    nomeDoIncorporador: "Loteadora VAL",
    nomePorCode: new Map([["VAL", "Vista Alegre"]]),
    politicaPorCode: POLITICAS,
  });

  it("os KPIs do BI: receita, transferida, inadimplente e a % já em 0–100", () => {
    // Receita líquida = TODAS: 970 (paga) + 250 (vencida) + 400 (a vencer) + 0 (ato) = 1620.
    expect(indicadores.kpis.receitaLiquida).toEqual({
      bruto: 4300,
      liquido: 1620,
      parcelas: 4,
      semLiquido: 0,
    });
    // Transferida = só as pagas, e o ato entra com líquido 0.
    expect(indicadores.kpis.transferida).toEqual({
      bruto: 3000,
      liquido: 970,
      parcelas: 2,
      semLiquido: 0,
    });
    // Inadimplente = vencida não paga.
    expect(indicadores.kpis.inadimplente).toEqual({
      bruto: 500,
      liquido: 250,
      parcelas: 1,
      semLiquido: 0,
    });
    // ⚠️ JÁ multiplicado por 100 — a lição do bug da TelaCarteira (0,3% onde era 30%).
    expect(indicadores.kpis.inadimplenciaPct).toBeCloseTo((250 / 1620) * 100, 6);
  });

  it("contadores: clientes únicos por nome (ignorando caixa) e unidades únicas", () => {
    expect(indicadores.contadores).toEqual({ clientes: 2, parcelas: 4, unidades: 2 });
  });

  it("série mensal: 12 meses terminando no mês atual, previsto pelo VENCIMENTO e transferido pelo PAGAMENTO", () => {
    expect(indicadores.serieMensal).toHaveLength(12);
    expect(indicadores.serieMensal[0]?.mes).toBe("2025-09");
    expect(indicadores.serieMensal[11]?.mes).toBe("2026-08");

    const porMes = Object.fromEntries(indicadores.serieMensal.map((m) => [m.mes, m]));

    // Julho: a parcela paga venceu E foi paga no mês.
    expect(porMes["2026-07"]).toEqual({
      inadimplenciaPct: 0,
      inadimplente: 0,
      mes: "2026-07",
      previsto: 970,
      transferido: 970,
    });
    // Agosto: só a vencida — 100% de inadimplência no mês.
    expect(porMes["2026-08"]).toEqual({
      inadimplenciaPct: 100,
      inadimplente: 250,
      mes: "2026-08",
      previsto: 250,
      transferido: 0,
    });
    // Junho: o ato tem líquido 0 dos dois lados — presença sem valor.
    expect(porMes["2026-06"]).toEqual({
      inadimplenciaPct: 0,
      inadimplente: 0,
      mes: "2026-06",
      previsto: 0,
      transferido: 0,
    });
    // Setembro está FORA da janela (o mês atual fecha a série), mas a parcela conta nos KPIs.
    expect(porMes["2026-09"]).toBeUndefined();
  });

  it("extrato: mais recente por vencimento primeiro, com nome de mercado e SEM dado sensível", () => {
    expect(indicadores.extratoTotal).toBe(4);
    expect(indicadores.extrato.map((p) => p.vencimento)).toEqual([
      "2026-09-10",
      "2026-08-01",
      "2026-07-10",
      "2026-06-05",
    ]);

    expect(indicadores.extrato[0]).toEqual({
      cliente: "João Pereira",
      empreendimento: "Vista Alegre",
      imobiliaria: "Imobiliária X",
      liquido: 400,
      motivo: undefined,
      numero: "3/120",
      pagoEm: null,
      perfil: "Parcela",
      situacao: "a_vencer",
      unidade: "Q02 L05",
      valor: 800,
      vencimento: "2026-09-10",
    });

    // ⚠️ A REGRA DO PORTAL: nenhuma linha do extrato carrega documento, telefone, e-mail, link de
    // boleto ou id interno de entidade. Se alguém adicionar um campo desses, este teste acusa.
    for (const parcela of indicadores.extrato) {
      const chaves = Object.keys(parcela);
      for (const proibida of ["cpf", "cnpj", "document", "documento", "email", "entityId", "phone", "telefone", "url"]) {
        expect(chaves.some((c) => c.toLowerCase().includes(proibida.toLowerCase()))).toBe(false);
      }
    }
  });

  it("parcela sem política entra nos motivos e em semLiquido, sem sumir da conta", () => {
    const semPolitica = montarIndicadores([linha()], {
      agoraMs: AGORA_MS,
      politicaPorCode: new Map(),
    });

    expect(semPolitica.kpis.receitaLiquida.semLiquido).toBe(1);
    expect(semPolitica.motivos.length).toBeGreaterThan(0);
  });
});

describe("perfilDaParcela", () => {
  it("traduz os nomes de negócio do C2X para os quatro perfis do rateio", () => {
    expect(perfilDaParcela("Ato")).toBe("ato");
    expect(perfilDaParcela("Sinal")).toBe("sinal");
    expect(perfilDaParcela("Parcela")).toBe("parcela");
    expect(perfilDaParcela("Balão")).toBe("parcela");
    expect(perfilDaParcela("Taxa de acordo")).toBe("outro");
    expect(perfilDaParcela(null)).toBe("outro");
  });
});

describe("lerSplit", () => {
  it("lê o formato em lista e o formato { splits: [...] }, string ou objeto", () => {
    const linhas = lerSplit(JSON.stringify([{ fixedValue: 970, name: "A", profile: "Incorporador" }]));
    expect(linhas).toEqual([{ nome: "A", perfil: "Incorporador", valor: 970 }]);

    const aninhado = lerSplit({ splits: [{ nome: "B", perfil: null, valor: 30 }] });
    expect(aninhado).toEqual([{ nome: "B", perfil: null, valor: 30 }]);
  });

  it("JSON estragado ou vazio devolve null, nunca lança", () => {
    expect(lerSplit("{quebrado")).toBeNull();
    expect(lerSplit(null)).toBeNull();
    expect(lerSplit([])).toBeNull();
  });
});
