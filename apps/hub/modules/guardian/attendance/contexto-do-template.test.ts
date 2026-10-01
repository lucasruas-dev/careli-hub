import { describe, expect, it } from "vitest";

import {
  contextoDoTemplateDeCobranca,
  parametrosDaPrevia,
  valoresDaPrevia,
} from "@/modules/guardian/attendance/contexto-do-template";

// O toLocaleString de moeda separa "R$" do número com espaço inseparável (U+00A0).
const R = (texto: string) => texto.replace(" ", " ");

function parcela(
  unitCode: string,
  valueNumber: number,
  overdueDays: number,
  dueDate: string,
  paymentUrl?: string,
) {
  return { dueDate, overdueDays, paymentUrl, unitCode, valueNumber };
}

const VENCIDAS = [
  parcela("LOU2012", 300, 270, "10/01/2025", "https://boleto/1"),
  parcela("LOU2012", 300, 210, "10/03/2025"),
  parcela("LOU2013", 400, 60, "10/08/2025"),
];

// Template real "Cobrança · Parcelas vencidas do empreendimento" (metadata.variables no banco).
const VARIAVEIS_PARCELAS_VENCIDAS = [
  { key: "primeiro_nome", placeholder: "{{1}}" },
  { key: "empreendimento", placeholder: "{{2}}" },
  { key: "unidade", placeholder: "{{3}}" },
  { key: "parcelas", placeholder: "{{4}}" },
  { key: "saldo_aberto", placeholder: "{{5}}" },
];

describe("contextoDoTemplateDeCobranca", () => {
  it("manda empreendimento, unidade e saldo — o que saía '-' desde julho", () => {
    const contexto = contextoDoTemplateDeCobranca({
      empreendimento: "Lavra do Ouro",
      saldoDevedor: "R$ 9.999,00",
      selecionadas: VENCIDAS.slice(0, 2),
      vencidas: VENCIDAS,
    });

    expect(contexto.relatedEnterprise).toBe("Lavra do Ouro");
    expect(contexto.relatedUnit).toBe("LOU2012");
    // Saldo é tudo o que está vencido (300+300+400), não só a seleção, e vem das parcelas vivas.
    expect(contexto.relatedOpenBalance).toBe(R("R$ 1.000,00"));
    expect(contexto.relatedInstallmentsTotal).toBe(R("R$ 600,00"));
    expect(contexto.relatedDueDate).toBe("10/01/2025");
    expect(contexto.relatedDaysLate).toBe("270 dias");
    expect(contexto.relatedBoletoLink).toBe("https://boleto/1");
  });

  it("sem seleção, a unidade sai das vencidas (como o 'Código de unidade' do modal)", () => {
    const contexto = contextoDoTemplateDeCobranca({
      empreendimento: "Lavra do Ouro",
      saldoDevedor: null,
      selecionadas: [],
      vencidas: VENCIDAS,
    });

    expect(contexto.relatedUnit).toBe("LOU2012, LOU2013");
    expect(contexto.relatedInstallmentsTotal).toBe("");
    expect(contexto.relatedDueDate).toBe("");
  });

  it("sem parcelas carregadas, o saldo cai no saldo devedor da fila", () => {
    const contexto = contextoDoTemplateDeCobranca({
      empreendimento: "Lavra do Ouro",
      saldoDevedor: "R$ 3.600,00",
      selecionadas: [],
      vencidas: [],
    });

    expect(contexto.relatedOpenBalance).toBe("R$ 3.600,00");
  });

  it("o '-' da fila não é valor: não vai para o cliente como empreendimento", () => {
    const contexto = contextoDoTemplateDeCobranca({
      empreendimento: "-",
      saldoDevedor: "-",
      selecionadas: [],
      vencidas: [],
    });

    expect(contexto.relatedEnterprise).toBe("");
    expect(contexto.relatedOpenBalance).toBe("");
  });
});

describe("parametrosDaPrevia", () => {
  const contexto = contextoDoTemplateDeCobranca({
    empreendimento: "Lavra do Ouro",
    saldoDevedor: null,
    selecionadas: VENCIDAS.slice(0, 1),
    vencidas: VENCIDAS,
  });
  const valores = valoresDaPrevia({
    assunto: "Contato",
    contexto,
    nomeCompleto: "Maria da Silva",
    primeiroNome: "Maria",
    resumoDasParcelas: "LOU2012 · Parcela 11/144 · 01/2025",
  });

  it("resolve por chave, na ordem que o template declara", () => {
    expect(parametrosDaPrevia(VARIAVEIS_PARCELAS_VENCIDAS, valores)).toEqual([
      "Maria",
      "Lavra do Ouro",
      "LOU2012",
      "LOU2012 · Parcela 11/144 · 01/2025",
      R("R$ 1.000,00"),
    ]);
  });

  it("template sem variáveis declaradas cai na ordem legada (nome, parcelas, protocolo)", () => {
    expect(parametrosDaPrevia([], valores)).toEqual([
      "Maria",
      "LOU2012 · Parcela 11/144 · 01/2025",
      "(gerado na abertura)",
    ]);
  });

  it("chave desconhecida também cai na ordem legada, como na rota", () => {
    expect(
      parametrosDaPrevia([{ key: "variavel_2", placeholder: "{{2}}" }], valores),
    ).toEqual(["Maria", "LOU2012 · Parcela 11/144 · 01/2025", "(gerado na abertura)"]);
  });
});
