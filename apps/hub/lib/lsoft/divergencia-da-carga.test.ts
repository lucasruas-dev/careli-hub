import { describe, expect, it } from "vitest";

import { type EdicaoDaTrilha, type ParcelaDaCarga, divergenciasDaCarga } from "./divergencia-da-carga";
import { digitalDaParcela } from "./impressao-digital";

// A pergunta de cada teste: se a carga rodar agora, o que o time fez na tela sobrevive?

const parcela = (id: string, sobre: Partial<ParcelaDaCarga> = {}): ParcelaDaCarga => ({
  cliente_codigo: "00000403",
  data_recebido: null,
  empreendimento: "Garden",
  id,
  observacoes: "LOTE: 109 QUADRA: 08",
  origem: "receber",
  paga: false,
  parcela: "007/084",
  valor: "2119.05",
  valor_recebido: 0,
  vencimento: "2026-09-10",
  ...sobre,
});

/** A baixa que a tela grava: três linhas, como `salvarParcelaDoLsoft` faz. */
const baixaNaTela = (antes: ParcelaDaCarga, valorRecebido: string, data: string, quando = "2026-09-22T15:47:16Z"): EdicaoDaTrilha[] => {
  const base = {
    cliente_codigo: antes.cliente_codigo,
    criado_em: quando,
    empreendimento_no_momento: antes.empreendimento,
    impressao_digital: digitalDaParcela(antes),
    ordinal: 1,
    parcela_id: "id-do-espelho",
    parcela_rotulo: `${antes.parcela} · 10/09/2026`,
    valor_no_momento: antes.valor,
    vencimento_no_momento: antes.vencimento,
  };
  return [
    { ...base, campo: "parcela.paga", id: `${antes.id}-p`, valor_novo: "paga" },
    { ...base, campo: "parcela.valor_recebido", id: `${antes.id}-v`, valor_novo: valorRecebido },
    { ...base, campo: "parcela.data_recebido", id: `${antes.id}-d`, valor_novo: data },
  ];
};

describe("a carga desfaria o que o time fez?", () => {
  it("o time deu baixa só na tela, e o Access ainda tem a parcela em aberto: DIVERGE nos três campos", () => {
    // ⚠️ O caso que motiva a trava. A carga traz a parcela do Access sem a baixa, e a tela voltaria
    // a mostrar em aberto uma parcela que o cliente já pagou.
    const antes = parcela("a");
    const doAccess = parcela("nova");
    const r = divergenciasDaCarga(baixaNaTela(antes, "2187.67", "2026-09-22"), [doAccess]);

    expect(r.parcelasEditadas).toBe(1);
    expect(r.divergencias.map((d) => d.campo).sort()).toEqual([
      "parcela.data_recebido",
      "parcela.paga",
      "parcela.valor_recebido",
    ]);
    expect(r.divergencias.find((d) => d.campo === "parcela.paga")).toMatchObject({ naCarga: "em aberto", naTela: "paga" });
  });

  it("a mesma baixa também foi dada no Access: NÃO diverge, a carga pode rodar", () => {
    // Foi o que o Lucas fez em 22/09/2026 com as baixas de setembro. No Access a parcela pago sai de
    // RECEBER para RECEBIDOS: a origem muda, a digital muda, e o religamento casa por vencimento e valor.
    const antes = parcela("a");
    const doAccess = parcela("nova", { data_recebido: "2026-09-22", origem: "recebido", paga: true, valor_recebido: 2187.67 });
    const r = divergenciasDaCarga(baixaNaTela(antes, "2187.67", "2026-09-22"), [doAccess]);

    expect(r.divergencias).toEqual([]);
    expect(r.semParcela).toEqual([]);
  });

  it("baixa nos dois lados, mas com valor recebido diferente: diverge SÓ no valor", () => {
    const antes = parcela("a");
    const doAccess = parcela("nova", { data_recebido: "2026-09-22", origem: "recebido", paga: true, valor_recebido: "2119.05" });
    const r = divergenciasDaCarga(baixaNaTela(antes, "2187.67", "2026-09-22"), [doAccess]);

    expect(r.divergencias).toEqual([
      {
        campo: "parcela.valor_recebido",
        cliente_codigo: "00000403",
        naCarga: "2119.05",
        naTela: "2187.67",
        parcela_rotulo: "007/084 · 10/09/2026",
      },
    ]);
  });

  it("vale a ÚLTIMA edição de cada campo: data corrigida depois não conta como divergência velha", () => {
    // Na base real a data_recebido foi mudada duas vezes na mesma parcela (320 linhas em 160 parcelas).
    const antes = parcela("a");
    const primeira = baixaNaTela(antes, "2187.67", "2026-09-10", "2026-09-22T15:47:16Z");
    const correcao: EdicaoDaTrilha = {
      ...primeira[2]!,
      criado_em: "2026-09-22T17:14:46Z",
      id: "a-d2",
      valor_novo: "2026-09-22",
    };
    const doAccess = parcela("nova", { data_recebido: "2026-09-22", origem: "recebido", paga: true, valor_recebido: 2187.67 });

    const r = divergenciasDaCarga([...primeira, correcao], [doAccess]);
    expect(r.divergencias).toEqual([]);
  });

  it("a parcela editada não existe mais na carga: a edição fica sem parcela, e isso é relatado", () => {
    const antes = parcela("a");
    const outra = parcela("nova", { parcela: "008/084", valor: "999.00", vencimento: "2026-10-10" });
    const r = divergenciasDaCarga(baixaNaTela(antes, "2187.67", "2026-09-22"), [outra]);

    expect(r.semParcela).toHaveLength(1);
    expect(r.semParcela[0]?.campos).toEqual(["parcela.data_recebido", "parcela.paga", "parcela.valor_recebido"]);
  });

  it("empreendimento novo, sem nenhuma edição do time: zero divergência, a carga passa", () => {
    const r = divergenciasDaCarga([], [parcela("n1", { empreendimento: "Giant Towers" })]);
    expect(r).toEqual({ divergencias: [], parcelasEditadas: 0, semParcela: [] });
  });

  it("valor editado e revertido no mesmo dia: o que vale é o último, e ele bate com o Access", () => {
    // O incidente de 22/09: 154 parcelas tiveram o valor trocado e devolvido ao original.
    const antes = parcela("a");
    const base = baixaNaTela(antes, "0", "2026-09-22")[0]!;
    const trocou: EdicaoDaTrilha = { ...base, campo: "parcela.valor", criado_em: "2026-09-22T15:47:16Z", id: "v1", valor_novo: "2206.83" };
    const voltou: EdicaoDaTrilha = { ...base, campo: "parcela.valor", criado_em: "2026-09-22T17:36:08Z", id: "v2", valor_novo: "2119.05" };

    const r = divergenciasDaCarga([trocou, voltou], [parcela("nova")]);
    expect(r.divergencias).toEqual([]);
  });
});
