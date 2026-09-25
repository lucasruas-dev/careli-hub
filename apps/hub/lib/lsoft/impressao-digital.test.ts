import { describe, expect, it } from "vitest";

import { digitalDaParcela, digitar } from "./impressao-digital";

// ⚠️ OS HASHES ABAIXO NÃO FORAM CALCULADOS AQUI: são as impressões digitais REAIS gravadas em
// `lsoft_classificacao_de_parcela`, lidas do banco em 24/09/2026, junto com os campos da parcela a
// que pertencem. É o que torna este teste uma prova e não uma tautologia: se alguém mexer na ordem
// dos campos, na normalização do valor ou no tratamento de nulo, ele falha contra o dado que já
// está no banco de produção, e não contra uma expectativa que o próprio código gerou.
describe("a digital reproduz o que o Postgres gravou", () => {
  it("casa com as marcas reais do Vale do Sol", () => {
    expect(
      digitalDaParcela({
        cliente_codigo: "00000642",
        empreendimento: "Vale do Sol",
        observacoes: "10.000 SINAL APTO 10 BL 01 VALE DO SOL",
        origem: "recebido",
        parcela: "001/001",
        valor: "10000.00",
        vencimento: "2026-06-19",
      }),
    ).toBe("4e004eff755ea8f90dc6560d7e7634a6");

    expect(
      digitalDaParcela({
        cliente_codigo: "00000642",
        empreendimento: "Vale do Sol",
        observacoes: "160.341,65 FINANC APTO 10 BL 01 VALE DO SOL",
        origem: "receber",
        parcela: "001/001",
        valor: "160341.65",
        vencimento: "2026-08-15",
      }),
    ).toBe("ec6b7dad52de22be92d336afbffab0dd");

    // Com acento na observação: prova que o md5 lê os mesmos bytes que o Postgres.
    expect(
      digitalDaParcela({
        cliente_codigo: "00000459",
        empreendimento: "Vale do Sol",
        observacoes: "APTO 01 BL 04 VALE DO SOL - FINANCIAMENTO/SUBSÍDIO",
        origem: "receber",
        parcela: "001/001",
        valor: "156303.65",
        vencimento: "2031-12-20",
      }),
    ).toBe("6bf6f2b0d8665a0949e63a3823de1ea2");
  });

  it("aceita o valor como número e chega no mesmo hash", () => {
    // O banco devolve numeric como string; o servidor às vezes tem o número. Os dois têm de dar
    // no mesmo lugar, senão a digital gravada na edição não casa com a do reconciliador.
    const comoTexto = digitalDaParcela({
      cliente_codigo: "00000640",
      empreendimento: "Vale do Sol",
      observacoes: "173.880,00 FINANCIMENTO APTO 03 BL 04 VALE DO SOL",
      origem: "receber",
      parcela: "001/001",
      valor: "173880.00",
      vencimento: "2026-08-10",
    });
    const comoNumero = digitalDaParcela({
      cliente_codigo: "00000640",
      empreendimento: "Vale do Sol",
      observacoes: "173.880,00 FINANCIMENTO APTO 03 BL 04 VALE DO SOL",
      origem: "receber",
      parcela: "001/001",
      valor: 173880,
      vencimento: "2026-08-10",
    });
    expect(comoTexto).toBe("451f56961f6f72d66a80bb4ec7c3f822");
    expect(comoNumero).toBe(comoTexto);
  });
});

describe("as regras que fazem a fórmula bater com o concat_ws", () => {
  it("PULA o nulo em vez de virar string vazia", () => {
    // ⚠️ É a diferença que mais quebra na prática: concat_ws descarta o nulo, então "a|c" e não "a||c".
    expect(digitar(["a", null, "c"])).toBe(digitar(["a", "c"]));
    expect(digitar(["a", null, "c"])).not.toBe(digitar(["a", "", "c"]));
    expect(digitar(["a", undefined, "c"])).toBe(digitar(["a", "c"]));
  });

  it("dá duas casas ao valor, como o numeric(14,2) do banco", () => {
    const base = {
      cliente_codigo: "X",
      empreendimento: "Y",
      observacoes: null,
      origem: "receber",
      parcela: "1/1",
      vencimento: "2026-01-01",
    };
    // 2119 e "2119.00" são o mesmo dinheiro; sem o toFixed(2) dariam hashes diferentes.
    expect(digitalDaParcela({ ...base, valor: 2119 })).toBe(digitalDaParcela({ ...base, valor: "2119.00" }));
    expect(digitalDaParcela({ ...base, valor: 2119.5 })).toBe(digitalDaParcela({ ...base, valor: "2119.50" }));
  });

  it("a ordem dos campos é parte do contrato", () => {
    // Trocar dois de lugar produz um hash válido e errado, que não casa com nada já gravado.
    expect(digitar(["a", "b"])).not.toBe(digitar(["b", "a"]));
  });

  it("parcelas diferentes em um único campo têm digitais diferentes", () => {
    const base = {
      cliente_codigo: "00000642",
      empreendimento: "Vale do Sol",
      observacoes: "APTO 10",
      origem: "receber" as const,
      parcela: "001/001",
      valor: "10000.00",
      vencimento: "2026-06-19",
    };
    expect(digitalDaParcela({ ...base, origem: "recebido" })).not.toBe(digitalDaParcela(base));
    expect(digitalDaParcela({ ...base, vencimento: "2026-06-20" })).not.toBe(digitalDaParcela(base));
    expect(digitalDaParcela({ ...base, valor: "10000.01" })).not.toBe(digitalDaParcela(base));
  });

  it("não quebra com a parcela toda vazia", () => {
    expect(() =>
      digitalDaParcela({
        cliente_codigo: null,
        empreendimento: null,
        observacoes: null,
        origem: null,
        parcela: null,
        valor: null,
        vencimento: null,
      }),
    ).not.toThrow();
  });
});
