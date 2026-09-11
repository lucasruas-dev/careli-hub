import { describe, expect, it } from "vitest";

import { repartirVenda } from "./comissao";

// O QUE ESTES TESTES TRAVAM (pedido do Lucas em 11/09/2026): o dossiê tem que separar o que é
// valor de venda da unidade e o que é corretagem, e a regra dele para a origem do percentual é
// "tudo relacionado ao comercial vem do Panteon; do C2X só financeiro, pagamento e parcelas".
// Até aqui o dossiê lia `commercial_policies.total_value_commission` do MySQL legado.

describe("repartirVenda", () => {
  // ⚠️ ESTE É O CASO MEDIDO NO TÊMIS, e está aqui de propósito: a mesma venda tem que dar o
  // mesmo número no contrato e no dossiê. Somada em reais, a conta dá 11050.6552, que vira
  // R$ 11.050,66 — um centavo A MAIS do que as duas quantias impressas logo acima. Documento
  // que se contradiz por um centavo volta do jurídico.
  it("soma em centavos inteiros, como o contrato faz", () => {
    const r = repartirVenda(170010.08, {
      coordenadoraPercent: 1.5,
      imobiliariaPercent: 5,
    });

    expect(r.corretagemCoordenadora).toBe(2550.15);
    expect(r.corretagemImobiliaria).toBe(8500.5);
    expect(r.valorCorretagem).toBe(11050.65);
    expect(r.valorCorretagem).not.toBe(11050.66);
  });

  it("o que sobra do preço é o valor de venda da unidade", () => {
    const r = repartirVenda(170010.08, {
      coordenadoraPercent: 1.5,
      imobiliariaPercent: 5,
    });

    expect(r.valorTotalLote).toBe(158959.43);
    expect(
      Number(((r.valorTotalLote ?? 0) + (r.valorCorretagem ?? 0)).toFixed(2)),
    ).toBe(170010.08);
  });

  it("o percentual total é a soma das duas pontas", () => {
    expect(
      repartirVenda(100000, { coordenadoraPercent: 1.5, imobiliariaPercent: 4.5 })
        .percentualTotal,
    ).toBe(6);
  });

  // ⚠️ O ARREDONDAMENTO É O DO CENTAVO, não o da casa decimal do percentual.
  it("arredonda no centavo", () => {
    const r = repartirVenda(187333.33, {
      coordenadoraPercent: 1.5,
      imobiliariaPercent: 0,
    });

    expect(r.corretagemCoordenadora).toBe(2810);
  });

  // ⚠️ ZERO É DECISÃO, NULO É ESQUECIMENTO — a mesma distinção que o contrato faz. Um
  // empreendimento em que a imobiliária não recebe tem 0 cadastrado, e a conta segue.
  it("zero explícito entra na conta", () => {
    const r = repartirVenda(100000, {
      coordenadoraPercent: 0,
      imobiliariaPercent: 4.5,
    });

    expect(r.percentualTotal).toBe(4.5);
    expect(r.corretagemCoordenadora).toBe(0);
    expect(r.corretagemImobiliaria).toBe(4500);
    expect(r.valorCorretagem).toBe(4500);
  });

  // ⚠️ COM UMA PONTA FALTANDO, A CORRETAGEM É DESCONHECIDA, NÃO É A OUTRA SOZINHA. Imprimir só
  // a ponta cadastrada daria ao jurídico uma corretagem menor que a real, e um valor de venda
  // maior — exatamente o erro que o relatório existe para não cometer.
  it("uma ponta sem cadastro deixa tudo não apurado", () => {
    const so1 = repartirVenda(100000, {
      coordenadoraPercent: 1.5,
      imobiliariaPercent: null,
    });
    const so2 = repartirVenda(100000, {
      coordenadoraPercent: null,
      imobiliariaPercent: 4.5,
    });

    for (const r of [so1, so2]) {
      expect(r.percentualTotal).toBeNull();
      expect(r.valorCorretagem).toBeNull();
      expect(r.valorTotalLote).toBeNull();
    }
  });

  it("sem cadastro nenhum, não apura nada e não inventa zero", () => {
    const r = repartirVenda(100000, {
      coordenadoraPercent: null,
      imobiliariaPercent: null,
    });

    expect(r.percentualTotal).toBeNull();
    expect(r.valorCorretagem).toBeNull();
    expect(r.valorTotalLote).toBeNull();
    expect(r.corretagemCoordenadora).toBeNull();
  });

  // Preço ausente acontece em unidade sem `price` no C2X. Sem preço não há o que repartir, e
  // devolver zero faria o PDF imprimir "R$ 0,00" como se fosse apurado.
  it("sem preço não reparte", () => {
    const r = repartirVenda(0, {
      coordenadoraPercent: 1.5,
      imobiliariaPercent: 4.5,
    });

    expect(r.valorCorretagem).toBeNull();
    expect(r.valorTotalLote).toBeNull();
    expect(r.percentualTotal).toBe(6);
  });

  it("percentual inválido não vira conta", () => {
    const r = repartirVenda(100000, {
      coordenadoraPercent: Number.NaN,
      imobiliariaPercent: 4.5,
    });

    expect(r.percentualTotal).toBeNull();
    expect(r.valorCorretagem).toBeNull();
  });
});
