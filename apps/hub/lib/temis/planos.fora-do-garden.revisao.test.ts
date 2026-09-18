import { describe, expect, it } from "vitest";

import { calcularParcela } from "@/lib/apolo/planos-comerciais";

import { conferirNaUnidade, paraCalculo, type PlanoDoTemis } from "./planos";

// REVISÃO DE 18/09/2026, LENTE "REGRESSÃO FORA DO GARDEN" (rodada 3 do fix/planos-como-mmendes).
//
// A aba de planos do Apolo ("Nessa unidade: sinal de ... e N parcelas de ...") trocou de conta em
// TODO empreendimento: era `calcularParcela(paraCalculo(plano), preco)` (sinal = preço × % do plano,
// sem piso e sem arredondar) e passou a ser `conferirNaUnidade` (a conta da Mesa: sinal com o piso do
// empreendimento e arredondado para cima no real). Medido nos 40 planos fora do Garden (SELECT em
// `temis_planos`, preço = um lote mediano disponível de `hercules_unidades`, 18/09/2026): 19 dos 40
// mudam de número na tela. O Lucas decidiu *"So no Garden"* para a mudança de conta desta rodada.
//
// ⚠️ CORRIGIDO NA RODADA 3 (18/09/2026), PELA REGRA "SO NO GARDEN": a aba voltou a `calcularParcela`
// quando o plano não tem anual cadastrada nem desconto, e os dois casos abaixo (que eram DEFEITO)
// saem como na origin/main. A conta da Mesa concorda com o que a Mesa vende (o cartão da Mesa do 20
// diz entrada R$ 9.290 no Investidor); levá-la para fora do Garden fica para o Lucas decidir.

const plano = (p: Partial<PlanoDoTemis> & Pick<PlanoDoTemis, "entradaPercentual" | "nome" | "parcelas">): PlanoDoTemis => ({
  anuaisQuantidade: null,
  anuaisValor: null,
  ativo: true,
  categoriaId: null,
  categoriaNome: null,
  criadoEm: "2026-09-18",
  descontoPercentual: 0,
  id: p.nome,
  indiceCorrecao: "IPCA_ANUAL",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "mensal",
  jurosTaxa: 0,
  minutaId: null,
  minutaNome: null,
  observacao: null,
  ordem: 0,
  ressalva: null,
  sistemaAmortizacao: "sacoc",
  slot: null,
  ...p,
});

const centavos = (v: null | number | undefined) => Math.round((v ?? 0) * 100) / 100;

describe("aba de planos do Apolo fora do Garden", () => {
  it("planos com entrada acima do piso e preço redondo continuam iguais (38 NORMAL, 42 Normal - Price)", () => {
    const normal38 = plano({ entradaPercentual: 10, jurosTaxa: 0.6434, nome: "NORMAL", parcelas: 180 });
    const antes38 = calcularParcela(paraCalculo(normal38), 220_000);
    const agora38 = conferirNaUnidade(normal38, 220_000, 10);
    expect([centavos(agora38?.entrada), centavos(agora38?.parcela)]).toEqual([
      centavos(antes38.sinal),
      centavos(antes38.parcela),
    ]);

    const price42 = plano({ entradaPercentual: 10, jurosTaxa: 0.6434, nome: "Normal - Price", parcelas: 120, sistemaAmortizacao: "price" });
    const antes42 = calcularParcela(paraCalculo(price42), 253_000);
    const agora42 = conferirNaUnidade(price42, 253_000, 0);
    expect([centavos(agora42?.entrada), centavos(agora42?.parcela)]).toEqual([
      centavos(antes42.sinal),
      centavos(antes42.parcela),
    ]);
  });

  it("20 Investidor (0% de entrada, piso 10%) em R$ 92.900: era sinal R$ 0,00 e 24 × R$ 3.870,83", () => {
    const investidor20 = plano({ entradaPercentual: 0, indiceCorrecao: "SEM_CORRECAO", nome: "Investidor", parcelas: 24 });
    const antes = calcularParcela(paraCalculo(investidor20), 92_900);
    expect([centavos(antes.sinal), centavos(antes.parcela)]).toEqual([0, 3_870.83]);
    const agora = conferirNaUnidade(investidor20, 92_900, 10);
    // Na primeira versão da rodada 3: sinal R$ 9.290,00 e 24 × R$ 3.483,75.
    expect([centavos(agora?.entrada), centavos(agora?.parcela)]).toEqual([0, 3_870.83]);
  });

  it("19 INVESTIDOR (10%) em R$ 213.064: era sinal R$ 21.306,40 e 24 × R$ 7.989,90", () => {
    const investidor19 = plano({ entradaPercentual: 10, indiceCorrecao: "SEM_CORRECAO", jurosPeriodicidade: "anual", jurosTaxa: null, nome: "INVESTIDOR", parcelas: 24 });
    const antes = calcularParcela(paraCalculo(investidor19), 213_064);
    expect([centavos(antes.sinal), centavos(antes.parcela)]).toEqual([21_306.4, 7_989.9]);
    const agora = conferirNaUnidade(investidor19, 213_064, 10);
    // Na primeira versão da rodada 3: sinal R$ 21.307,00 e 24 × R$ 7.989,88 (arredondada no real).
    expect([centavos(agora?.entrada), centavos(agora?.parcela)]).toEqual([21_306.4, 7_989.9]);
  });

  it("os 40 planos reais de fora do Garden (SELECT de 18/09/2026) saem com a conta de sempre, ao centavo", () => {
    // Um por linha: [empreendimento, nome, parcelas, entrada %, juros, periodicidade, índice, sistema].
    const reais: Array<[string, string, number, number, null | number, string, string, string]> = [
      ["19", "CURTO", 36, 10, 0, "mensal", "IPCA_MENSAL", "sacoc"],
      ["19", "INVESTIDOR", 24, 10, null, "anual", "SEM_CORRECAO", "sacoc"],
      ["19", "NORMAL - PRICE", 168, 10, 0.5, "mensal", "IPCA_MENSAL", "price"],
      ["19", "NORMAL - SACOC", 168, 10, 0.5, "mensal", "IPCA_MENSAL", "sacoc"],
      ["20", "Curto", 36, 20, 0, "mensal", "IPCA_ANUAL", "sacoc"],
      ["20", "Investidor", 24, 0, 0, "mensal", "SEM_CORRECAO", "sacoc"],
      ["20", "Normal", 120, 10, 0.6434, "mensal", "IPCA_ANUAL", "sacoc"],
      ["27", "INVESTIDOR 01", 36, 20, 0, "mensal", "SEM_CORRECAO", "sacoc"],
      ["27", "INVESTIDOR 02", 48, 12, 0, "mensal", "IPCA_ANUAL", "sacoc"],
      ["27", "NORMAL 01", 72, 12, 0.8, "mensal", "IPCA_ANUAL", "sacoc"],
      ["27", "NORMAL 02", 120, 12, 0.8, "mensal", "IPCA_ANUAL", "sacoc"],
      ["29", "CURTO", 24, 30, 0, "mensal", "IPCA_ANUAL", "sacoc"],
      ["29", "INVESTIDOR", 12, 20, 0, "mensal", "SEM_CORRECAO", "sacoc"],
      ["29", "NORMAL", 120, 10, 0.5, "mensal", "IPCA_ANUAL", "sacoc"],
      ["33", "INVESTIDOR 01", 36, 20, 0, "mensal", "SEM_CORRECAO", "sacoc"],
      ["33", "Investidor 02", 60, 12, 0.8, "mensal", "IPCA_ANUAL", "sacoc"],
      ["33", "INVESTIDOR 02", 48, 20, null, "mensal", "IPCA_ANUAL", "sacoc"],
      ["33", "Normal 01", 72, 12, 0.8, "mensal", "IPCA_ANUAL", "sacoc"],
      ["33", "NORMAL 01", 72, 20, 0.8, "mensal", "IPCA_ANUAL", "sacoc"],
      ["33", "NORMAL 02", 120, 12, 0.8, "mensal", "IPCA_ANUAL", "sacoc"],
      ["35", "CURTO", 36, 20, 0, "mensal", "IPCA_ANUAL", "sacoc"],
      ["35", "INVESTIDOR", 24, 20, 0, "mensal", "SEM_CORRECAO", "sacoc"],
      ["35", "NORMAL", 156, 10, 0.7207, "mensal", "IPCA_ANUAL", "sacoc"],
      ["37", "CURTO", 36, 20, 0, "mensal", "IPCA_ANUAL", "sacoc"],
      ["37", "INVESTIDOR", 24, 20, 0, "mensal", "SEM_CORRECAO", "sacoc"],
      ["37", "NORMAL", 156, 10, 0.7207, "mensal", "IPCA_ANUAL", "sacoc"],
      ["38", "CURTO", 24, 30, 0, "anual", "IPCA_ANUAL", "sacoc"],
      ["38", "INVESTIDOR", 12, 20, 0, "anual", "SEM_CORRECAO", "sacoc"],
      ["38", "NORMAL", 180, 10, 0.6434, "mensal", "IPCA_ANUAL", "sacoc"],
      ["40", "Curto", 36, 20, 0, "mensal", "IPCA_ANUAL", "sacoc"],
      ["40", "Investidor", 24, 20, 0, "mensal", "SEM_CORRECAO", "sacoc"],
      ["40", "Normal", 120, 10, 0.5, "mensal", "IPCA_ANUAL", "sacoc"],
      ["42", "Curto", 36, 30, 0, "anual", "IPCA_ANUAL", "sacoc"],
      ["42", "Investidor", 12, 0, 0, "anual", "SEM_CORRECAO", "sacoc"],
      ["42", "Normal - Price", 120, 10, 0.6434, "mensal", "IPCA_ANUAL", "price"],
      ["42", "Price Teste", 120, 10, 8, "anual", "IPCA_ANUAL", "price"],
      ["9001", "CURTO", 36, 10, 0, "mensal", "IPCA_MENSAL", "sacoc"],
      ["9001", "INVESTIDOR", 24, 10, null, "anual", "SEM_CORRECAO", "sacoc"],
      ["9001", "NORMAL - PRICE", 168, 10, 0.5, "mensal", "IPCA_MENSAL", "price"],
      ["9001", "NORMAL - SACOC", 168, 10, 0.5, "mensal", "IPCA_MENSAL", "sacoc"],
    ];
    // O piso de `apolo_enterprise_settings` e o lote mediano disponível (SELECT de 18/09/2026).
    const pisos: Record<string, null | number> = { "19": 10, "20": 10, "27": 12, "29": 10, "33": null, "35": 10, "37": 10, "38": 10, "40": 10, "42": 0, "9001": 10 };
    const precos: Record<string, number> = { "19": 213_064, "20": 92_900, "27": 575_081.63, "29": 79_900, "33": 434_907, "35": 143_451, "37": 129_900, "38": 220_000, "40": 304_515, "42": 253_000, "9001": 150_000 };
    expect(reais).toHaveLength(40);
    for (const [emp, nome, parcelas, entradaPercentual, jurosTaxa, jurosPeriodicidade, indiceCorrecao, sistemaAmortizacao] of reais) {
      const p = plano({ entradaPercentual, indiceCorrecao, jurosPeriodicidade, jurosTaxa, nome, parcelas, sistemaAmortizacao });
      const antes = calcularParcela(paraCalculo(p), precos[emp]!);
      const agora = conferirNaUnidade(p, precos[emp]!, pisos[emp]!);
      expect({ emp, nome, parcela: agora?.parcela, sinal: agora?.entrada }).toEqual({ emp, nome, parcela: antes.parcela, sinal: antes.sinal });
      expect(agora?.anuais).toEqual({ quantidade: 0, valor: 0 });
      expect(agora?.naturezaDaParcela).toBe(antes.naturezaDaParcela);
    }
  });
});
