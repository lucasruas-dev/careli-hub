import { describe, expect, it } from "vitest";

import {
  apenasDaCompetencia,
  descricaoDoBoleto,
  diferencaDoArredondamento,
  lerReferencia,
  referenciaDaCobranca,
  valorParaOAsaas,
} from "./emissao";

// ⚠️ ISTO É DINHEIRO INDO PARA O BOLETO DE UMA PESSOA. Cada caso aqui é um centavo que sai errado
// na conta de alguém — para mais ou para menos — e ninguém confere 142 boletos à mão.

describe("o arredondamento para cima", () => {
  it("sobe o centavo quando há casas além da segunda", () => {
    // Decisão do Lucas (01/09/2026): "arredonda para cima". Os valores da planilha vêm com 13 casas.
    expect(valorParaOAsaas(2207.1729284232347)).toBe(2207.18);
    expect(valorParaOAsaas(2231.973092376779)).toBe(2231.98);
    expect(valorParaOAsaas(10.001)).toBe(10.01);
  });

  it("NÃO mexe em valor que já tem duas casas", () => {
    // ⚠️ ESTE É O TESTE QUE IMPEDE O CENTAVO A MAIS DE GRAÇA. Sem limpar o ruído de ponto flutuante
    // antes, `1.09 * 100` dá 109.00000000000001 e o arredondamento para cima o transformaria em
    // R$ 1,10. Achei seis casos assim só entre R$ 0,01 e R$ 50,00.
    for (const v of [0.07, 0.14, 0.28, 0.55, 0.56, 1.09, 8.11, 1.15, 100.1, 2207.17]) {
      expect(valorParaOAsaas(v), `${v} não devia subir`).toBe(v);
    }
  });

  it("nunca devolve valor MENOR que o da planilha", () => {
    // É o que "para cima" garante: a diferença nunca é contra a empresa.
    for (const v of [1.001, 99.999, 1234.5678, 0.011, 7.4999999]) {
      expect(valorParaOAsaas(v)).toBeGreaterThanOrEqual(v);
    }
  });

  it("a diferença nunca passa de um centavo", () => {
    // Se passar, o arredondamento está errado, não generoso.
    for (const v of [2207.1729284232347, 1.001, 99.999, 0.011, 33.077777]) {
      expect(valorParaOAsaas(v) - v).toBeLessThan(0.01);
    }
  });

  it("valor com duas casas exatas atravessa sem toque, do centavo ao milhão", () => {
    for (let centavos = 1; centavos <= 2000; centavos += 1) {
      const v = centavos / 100;
      expect(valorParaOAsaas(v), `R$ ${v}`).toBe(v);
    }
    expect(valorParaOAsaas(1_000_000.99)).toBe(1_000_000.99);
  });

  it("zero continua zero", () => {
    expect(valorParaOAsaas(0)).toBe(0);
  });
});

describe("o que a tela mostra antes do clique", () => {
  it("soma a planilha e o emitido, e conta quantas linhas subiram", () => {
    const valores = [100.005, 200.5, 300.12];
    const d = diferencaDoArredondamento(valores);

    expect(d.planilha).toBe(600.63);
    // 100.005 -> 100.01 | 200.5 -> 200.5 | 300.12 -> 300.12
    expect(d.emitido).toBe(600.63);
    expect(d.linhasAjustadas).toBe(1);
  });

  it("com os valores reais da planilha, a diferença aparece", () => {
    const d = diferencaDoArredondamento([2207.1729284232347, 2231.973092376779]);
    expect(d.linhasAjustadas).toBe(2);
    expect(d.emitido).toBeGreaterThan(d.planilha);
    // Dois boletos, no máximo dois centavos.
    expect(d.emitido - d.planilha).toBeLessThan(0.02);
  });

  it("lote sem nenhuma casa sobrando não acusa ajuste", () => {
    const d = diferencaDoArredondamento([100.5, 200.25, 300.1]);
    expect(d.linhasAjustadas).toBe(0);
    expect(d.emitido).toBe(d.planilha);
  });
});

describe("a referência que identifica a cobrança", () => {
  it("junta empreendimento, unidade e competência", () => {
    // ⚠️ É por ela que a próxima rodada descobre que o boleto já existe. Sem isso, a única saída
    // seria casar por nome e valor — que é como se emite o mesmo boleto duas vezes.
    expect(
      referenciaDaCobranca({ competencia: "2026-09", empreendimento: "guaimbe", unidade: "307" }),
    ).toBe("boleto:guaimbe:307:2026-09");
  });

  it("unidade com espaço não quebra a referência", () => {
    // O Vale do Sol traz unidades como "00000430"; outras abas trazem "QD 3 LT 10".
    expect(
      referenciaDaCobranca({ competencia: "2026-09", empreendimento: "vale-do-sol", unidade: "QD 3 LT 10" }),
    ).toBe("boleto:vale-do-sol:QD-3-LT-10:2026-09");
  });

  it("a mesma unidade em meses diferentes gera referências diferentes", () => {
    const a = referenciaDaCobranca({ competencia: "2026-09", empreendimento: "on-sky", unidade: "101" });
    const b = referenciaDaCobranca({ competencia: "2026-10", empreendimento: "on-sky", unidade: "101" });
    expect(a).not.toBe(b);
  });
});

describe("a descrição que separa as carteiras no extrato", () => {
  it("nomeia o empreendimento, a unidade e a competência", () => {
    // ⚠️ Jade, Ruby, Cristal e Esmeralda emitem todos pela conta CER. No extrato dela as quatro
    // carteiras chegam misturadas: sem o nome na descrição, a conciliação não sabe de qual prédio
    // veio cada pagamento.
    expect(
      descricaoDoBoleto({ competencia: "2026-09", empreendimento: "Ed. Rubi", unidade: "301" }),
    ).toBe("Ed. Rubi - Unidade 301 - Competência 09/2026");
  });

  it("cada edifício da CER sai com o próprio nome", () => {
    const nomes = ["Ed. Jade", "Ed. Rubi", "Ed. Cristal", "Ed. Esmeralda"];
    const saidas = nomes.map((e) =>
      descricaoDoBoleto({ competencia: "2026-09", empreendimento: e, unidade: "101" }),
    );
    expect(new Set(saidas).size).toBe(4);
    for (const [i, s] of saidas.entries()) expect(s).toContain(nomes[i]!);
  });

  it("unidade em branco não vira 'Unidade null' no boleto do cliente", () => {
    expect(
      descricaoDoBoleto({ competencia: "2026-09", empreendimento: "On Sky", unidade: null }),
    ).toBe("On Sky - Competência 09/2026");
    expect(
      descricaoDoBoleto({ competencia: "2026-09", empreendimento: "On Sky", unidade: "  " }),
    ).not.toContain("Unidade");
  });

  it("usa a grafia da planilha, não a de uma lista nossa", () => {
    // "segue o que está na planilha" (Lucas). A planilha escreve "Ed. Rubi"; uma conversa dizia
    // "EDIFICIO RUBY". Quem manda é o arquivo que o administrativo confere.
    const d = descricaoDoBoleto({ competencia: "2026-09", empreendimento: "Ed. Rubi", unidade: "1" });
    expect(d).toContain("Ed. Rubi");
    expect(d).not.toContain("RUBY");
  });
});

describe("ler de volta o que foi emitido", () => {
  const cobranca = (ref: null | string) =>
    ({ customer: "c", dueDate: "2026-09-15", externalReference: ref, id: "p", status: "PENDING", value: 10 });

  it("separa as cobranças desta tela das outras da conta", () => {
    // ⚠️ A conta CER também recebe cobranças de outras origens. Sem o filtro, a tela mostraria
    // pagamentos que não têm nada a ver com o lote do mês.
    const lista = [
      cobranca("boleto:guaimbe:307:2026-09"),
      cobranca("proposta-avulsa-123"),
      cobranca(null),
      cobranca("boleto:guaimbe:307:2026-08"),
    ];
    const so = apenasDaCompetencia(lista as never, "2026-09");
    expect(so).toHaveLength(1);
    expect(so[0]!.externalReference).toBe("boleto:guaimbe:307:2026-09");
  });

  it("lê o empreendimento e a unidade de volta", () => {
    expect(lerReferencia("boleto:ed-rubi:301:2026-09")).toEqual({
      competencia: "2026-09",
      empreendimento: "ed-rubi",
      unidade: "301",
    });
  });

  it("referência de outra origem devolve nulo em vez de inventar", () => {
    expect(lerReferencia("proposta-avulsa-123")).toBeNull();
    expect(lerReferencia(null)).toBeNull();
    expect(lerReferencia("boleto:incompleta")).toBeNull();
  });
});
