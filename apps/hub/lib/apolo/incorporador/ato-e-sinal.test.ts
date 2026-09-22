import { describe, expect, it } from "vitest";

import { agruparAtoESinalPorPedido, type LinhaDeAtoESinal } from "./ato-e-sinal";

// O CASO REAL, medido no legado em 21/09/2026 (unidade 5762 = VOC 12/21):
//
//   pedido 4770  CANCELADO   Nívea    Ato R$ 30 pago  ·  Sinal 1/2 R$ 50 pago  ·  Sinal 2/2 R$ 30 pago
//   pedido 4792  CANCELADO   Nívea    Sinal 1/2 R$ 30 pago
//   pedido 4807  FATURADO    Carlos   Sinal 1/4 R$ 3.710 pago  ·  Sinal 2/4 R$ 3.710 VENCIDA  ·  …
//
// A tela mostrava as 9 parcelas (R$ 14.980,13) em CADA linha da unidade, e as duas linhas da
// compradora do pedido cancelado carregavam o vencido do pedido vivo. Aqui os números são
// reduzidos ao mínimo que prova a mistura.

const base: Omit<LinhaDeAtoESinal, "ar_id" | "payment_id" | "situacao" | "valor_previsto"> = {
  dias_atraso: 0,
  due_date: "2026-09-20",
  invoice_url: null,
  ja_venceu: 1,
  pago_no_mes: 0,
  parcel_type: "Sinal",
  parcela_n: 0,
  parcela_total: 156,
  payment_date: null,
  payment_url: null,
  sinal_n: 2,
  sinal_total: 2,
  unit_id: 5762,
  valor_em_aberto: 0,
  valor_pago: 0,
};

const linha = (extra: Partial<LinhaDeAtoESinal>): LinhaDeAtoESinal => ({
  ...base,
  ar_id: 4770,
  payment_id: 1,
  situacao: "paga",
  valor_previsto: 30,
  ...extra,
});

describe("as parcelas de ato e sinal", () => {
  it("ficam no PEDIDO, e não escorrem para o outro pedido da mesma unidade", () => {
    const { porPedido } = agruparAtoESinalPorPedido([
      linha({ ar_id: 4770, payment_id: 330081, valor_previsto: 30 }),
      linha({
        ar_id: 4807,
        payment_id: 362745,
        situacao: "vencida",
        valor_em_aberto: 3710.03,
        valor_previsto: 3710.03,
      }),
    ]);

    // Duas linhas na mesma unidade, dois baldes — cada um com o SEU dinheiro.
    expect([...porPedido.keys()].sort()).toEqual(["4770", "4807"]);
    expect(porPedido.get("4770")).toHaveLength(1);
    expect(porPedido.get("4770")?.[0]?.valor).toBe(30);
    expect(porPedido.get("4807")).toHaveLength(1);
    expect(porPedido.get("4807")?.[0]?.valor).toBe(3710.03);
  });

  it("não leva a VENCIDA de um pedido para o balde do outro", () => {
    const { porPedido } = agruparAtoESinalPorPedido([
      linha({ ar_id: 4770, payment_id: 330081 }),
      linha({ ar_id: 4792, payment_id: 330404 }),
      linha({
        ar_id: 4807,
        payment_id: 362745,
        situacao: "vencida",
        valor_em_aberto: 3710.03,
        valor_previsto: 3710.03,
      }),
    ]);

    const vencidasDe = (pedido: string) =>
      (porPedido.get(pedido) ?? []).filter((p) => p.situacao === "vencida");

    // ⚠️ É ESTE O DEFEITO QUE O LUCAS VIU: o vencido do comprador vivo cobrado no nome de quem
    // teve o pedido cancelado.
    expect(vencidasDe("4770")).toHaveLength(0);
    expect(vencidasDe("4792")).toHaveLength(0);
    expect(vencidasDe("4807")).toHaveLength(1);
  });

  it("soma, por pedido, o que a linha da carteira vai mostrar", () => {
    const { porPedido } = agruparAtoESinalPorPedido([
      linha({ ar_id: 4770, payment_id: 1, valor_previsto: 30 }),
      linha({ ar_id: 4770, payment_id: 2, parcel_type: "Ato", valor_previsto: 50 }),
      linha({ ar_id: 4807, payment_id: 3, valor_previsto: 3710.03 }),
      linha({ ar_id: 4807, payment_id: 4, valor_previsto: 3710.03 }),
    ]);

    const total = (pedido: string) =>
      (porPedido.get(pedido) ?? []).reduce((soma, p) => soma + p.valor, 0);

    expect(total("4770")).toBe(80);
    expect(total("4807")).toBe(7420.06);
  });

  it("descarta o que não é ato nem sinal, mesmo que o SQL deixe passar", () => {
    const { porPedido } = agruparAtoESinalPorPedido([
      linha({ ar_id: 4807, parcel_type: "Parcela mensal", payment_id: 9 }),
      linha({ ar_id: 4807, parcel_type: "Taxa de boleto", payment_id: 10 }),
      linha({ ar_id: 4807, parcel_type: "Ato", payment_id: 11 }),
    ]);

    expect(porPedido.get("4807")).toHaveLength(1);
    expect(porPedido.get("4807")?.[0]?.perfil).toBe("Ato");
  });

  it("parcela sem pedido não entra em balde nenhum", () => {
    const { porPedido } = agruparAtoESinalPorPedido([
      linha({ ar_id: "", payment_id: 12 }),
      linha({ ar_id: 4807, payment_id: 13 }),
    ]);

    expect([...porPedido.keys()]).toEqual(["4807"]);
  });

  it("numera Ato e Sinal pela régua compartilhada", () => {
    const { porPedido } = agruparAtoESinalPorPedido([
      linha({ ar_id: 1, parcel_type: "Ato", payment_id: 20, sinal_n: 0, sinal_total: 4 }),
      linha({ ar_id: 1, parcel_type: "Sinal", payment_id: 21, sinal_n: 3, sinal_total: 4 }),
    ]);

    expect(porPedido.get("1")?.map((p) => p.numero)).toEqual(["1/1", "3/4"]);
  });
});
