import { describe, expect, it } from "vitest";

import {
  type DadosDoRecibo,
  reciboParaWhatsApp,
  valorPorExtenso,
} from "./recibo-whatsapp";

function dados(parcial: Partial<DadosDoRecibo> = {}): DadosDoRecibo {
  return {
    dataExtensa: "28 de agosto de 2026",
    documento: "149.970.766-51",
    formaDePagamento: "PIX",
    lancamento: "RESIDENCIAL VILLA PARIS",
    pagador: "MARIA EDUARDA BOTELHO MAGALHAES",
    referencia: "RSV-CA332A",
    unidades: [{ lote: "06", quadra: "G" }],
    valor: 1000,
    ...parcial,
  };
}

describe("valor por extenso", () => {
  it("os valores redondos de sinal", () => {
    expect(valorPorExtenso(1000)).toBe("mil reais");
    expect(valorPorExtenso(5000)).toBe("cinco mil reais");
    expect(valorPorExtenso(14900)).toBe("quatorze mil e novecentos reais");
    expect(valorPorExtenso(29800)).toBe("vinte e nove mil e oitocentos reais");
  });

  it("centavos entram", () => {
    expect(valorPorExtenso(1000.5)).toBe("mil reais e cinquenta centavos");
    expect(valorPorExtenso(2897.22)).toContain("centavos");
  });

  it("singular de real", () => {
    expect(valorPorExtenso(1)).toBe("um real");
  });

  it("cem é cem, não cento", () => {
    expect(valorPorExtenso(100)).toBe("cem reais");
    expect(valorPorExtenso(150)).toBe("cento e cinquenta reais");
  });

  it("milhão redondo pede a preposição", () => {
    expect(valorPorExtenso(1_000_000)).toBe("um milhão de reais");
    expect(valorPorExtenso(2_000_000)).toBe("dois milhões de reais");
    // Com resto, o "de" some: "um milhão e quinhentos mil reais".
    expect(valorPorExtenso(1_500_000)).toBe("um milhão e quinhentos mil reais");
  });

  // ⚠️ Melhor sem extenso do que com extenso errado: recibo com valor por extenso divergente do
  // número é justamente o que um advogado usa para contestar o documento.
  it("acima do teto devolve vazio em vez de inventar escala", () => {
    expect(valorPorExtenso(1_000_000_000)).toBe("");
  });
});

describe("a mensagem do recibo", () => {
  it("traz quem pagou, o documento, o valor e a data", () => {
    const texto = reciboParaWhatsApp(dados());
    expect(texto).toContain("MARIA EDUARDA BOTELHO MAGALHAES");
    expect(texto).toContain("CPF 149.970.766-51");
    expect(texto).toContain("R$ 1.000,00");
    expect(texto).toContain("mil reais");
    expect(texto).toContain("28 de agosto de 2026");
  });

  it("descreve o que foi pago: lançamento e unidade", () => {
    const texto = reciboParaWhatsApp(dados());
    expect(texto).toContain("RESIDENCIAL VILLA PARIS");
    expect(texto).toContain("Quadra G, Lote 06");
  });

  it("amarra o recibo à reserva", () => {
    expect(reciboParaWhatsApp(dados())).toContain("RSV-CA332A");
  });

  it("lista todas as unidades do cupom", () => {
    const texto = reciboParaWhatsApp(
      dados({
        unidades: [
          { lote: "06", quadra: "G" },
          { lote: "07", quadra: "G" },
        ],
      }),
    );
    expect(texto).toContain("Quadra G, Lote 06");
    expect(texto).toContain("Quadra G, Lote 07");
  });

  // ⚠️ No WhatsApp o negrito é UM asterisco. Dois viram literais na tela do cliente.
  it("usa o negrito do WhatsApp, não o do markdown", () => {
    const texto = reciboParaWhatsApp(dados());
    expect(texto).toContain("*RECIBO DE SINAL*");
    expect(texto).not.toContain("**");
  });

  // Regra da casa: nada de travessão em texto que vai para cliente.
  it("não usa travessão", () => {
    expect(reciboParaWhatsApp(dados())).not.toContain("—");
  });

  it("sem CPF ou sem forma de pagamento, a linha some sem deixar buraco", () => {
    const texto = reciboParaWhatsApp(
      dados({ documento: null, formaDePagamento: null, referencia: null }),
    );
    expect(texto).not.toContain("CPF");
    expect(texto).not.toContain("pagos por");
    expect(texto).not.toContain("Reserva:");
    expect(texto).not.toMatch(/\n\n\n/);
  });
});
