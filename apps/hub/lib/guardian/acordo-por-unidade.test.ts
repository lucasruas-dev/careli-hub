import { describe, expect, it } from "vitest";

import {
  contratoDaSelecao,
  unidadesEmAtraso,
  type ParcelaParaAcordo,
} from "./acordo-por-unidade";

// O QUE ESTES TESTES TRAVAM (pedido do Lucas em 11/09/2026): "se o cliente tiver mais de uma
// unidade, eu não consigo fazer acordos por unidade (...) quando eu abrir o painel de acordos,
// se tiver mais de uma unidade, uma tela de escolha tem que existir".
//
// Medido na produção no mesmo dia: os 2 únicos acordos existentes misturam DUAS unidades cada
// (AC-000012 = LOU1822 + LOU1823; AC-000014 = MDS0802 + MDS0306), e `acquisition_request_c2x_id`
// está NULL em 7 de 7 compromissos. No C2X, 56 dos 295 clientes com parcela vencida (19%) têm
// mais de um contrato em atraso, somando R$ 412.072,34.

function parcela(
  contrato: string,
  numero: string,
  valor: number,
  extra: Partial<ParcelaParaAcordo> = {},
): ParcelaParaAcordo {
  return {
    acquisitionRequestId: contrato,
    id: `${contrato}-${numero}`,
    number: numero,
    status: "Vencida",
    unitCode: `COD${contrato}`,
    unitLabel: `Unidade ${contrato}`,
    valueNumber: valor,
    ...extra,
  };
}

describe("unidadesEmAtraso", () => {
  it("agrupa as parcelas por contrato, com a conta de cada um", () => {
    const unidades = unidadesEmAtraso([
      parcela("326", "1", 100),
      parcela("292", "1", 250),
      parcela("326", "2", 150),
    ]);

    expect(unidades).toHaveLength(2);
    expect(unidades[0]).toMatchObject({
      acquisitionRequestId: "292",
      parcelas: 1,
      total: 250,
    });
    expect(unidades[1]).toMatchObject({
      acquisitionRequestId: "326",
      parcelas: 2,
      total: 250,
    });
  });

  // ⚠️ A CHAVE É O CONTRATO, NÃO O `unitId`. Em `lib/guardian/attendance.ts` o `unitId` da
  // parcela vem de um lookup que, no cliente achatado, colapsa todas as unidades no id da
  // primeira. O `acquisitionRequestId` vem do C2X em cada linha de parcela e não tem esse
  // problema — agrupar por ele é o que separa os dois lotes do mesmo cliente.
  it("separa contratos mesmo quando o unitId vem repetido", () => {
    const unidades = unidadesEmAtraso([
      parcela("326", "1", 100, { unitId: "c2x-unit-999" }),
      parcela("292", "1", 250, { unitId: "c2x-unit-999" }),
    ]);

    expect(unidades).toHaveLength(2);
  });

  it("só conta o que está vencido", () => {
    const unidades = unidadesEmAtraso([
      parcela("326", "1", 100),
      parcela("326", "2", 500, { status: "A vencer" }),
      parcela("326", "3", 50, { status: "Liquidada" }),
    ]);

    expect(unidades).toHaveLength(1);
    expect(unidades[0]).toMatchObject({ parcelas: 1, total: 100 });
  });

  it("sem parcela vencida não há unidade para escolher", () => {
    expect(unidadesEmAtraso([])).toEqual([]);
    expect(unidadesEmAtraso([parcela("326", "1", 100, { status: "Liquidada" })])).toEqual([]);
  });

  // O rótulo é o que a operadora lê na hora de escolher. Sem código nem label, o número do
  // contrato é melhor do que uma linha em branco.
  it("cai no número do contrato quando não há rótulo", () => {
    const unidades = unidadesEmAtraso([
      parcela("326", "1", 100, { unitCode: undefined, unitLabel: undefined }),
    ]);

    expect(unidades[0]?.rotulo).toBe("Contrato 326");
  });

  it("prefere o código da unidade como rótulo", () => {
    const unidades = unidadesEmAtraso([
      parcela("326", "1", 100, { unitCode: "MDS0306", unitLabel: "Quadra 3 Lote 6" }),
    ]);

    expect(unidades[0]?.rotulo).toBe("MDS0306");
  });
});

describe("contratoDaSelecao", () => {
  it("devolve o contrato quando a seleção é toda dele", () => {
    expect(
      contratoDaSelecao([parcela("326", "1", 100), parcela("326", "2", 150)]),
    ).toBe("326");
  });

  // ⚠️ ESTE É O CASO QUE OS DOIS ACORDOS DE PRODUÇÃO VIOLARAM. Misturar contratos num acordo só
  // torna impossível dizer quanto da entrada pertence a cada unidade — e o termo de acordo, que
  // formaliza a dívida de uma unidade, fica sem objeto.
  it("recusa seleção que mistura contratos", () => {
    expect(
      contratoDaSelecao([parcela("326", "1", 100), parcela("292", "1", 250)]),
    ).toBeNull();
  });

  it("seleção vazia não tem contrato", () => {
    expect(contratoDaSelecao([])).toBeNull();
  });
});
