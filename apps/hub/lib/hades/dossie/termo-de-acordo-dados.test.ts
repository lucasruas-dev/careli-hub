import { describe, expect, it } from "vitest";

import {
  type AcordoParaOTermo,
  type ClienteDoHadesParaOTermo,
  dataCurta,
  diaEmBrasilia,
  hojeEmBrasilia,
  idsDasParcelasCobertas,
  montarDadosDoTermoDeAcordo,
  numeroDaParcela,
  quantasDas,
  unidadeEmTexto,
  vencimentoConsiderado,
} from "./termo-de-acordo-dados";
import { MOTIVOS_DO_TERMO } from "./termo-de-acordo-gate";
import { montarTermoDeAcordoPdf, totalNominalEmAtraso } from "./termo-de-acordo-pdf";

// ⚠️ OS NÚMEROS DESTA SUÍTE TÊM A FORMA DE UM ACORDO DE PRODUÇÃO, E NENHUM DADO DE CLIENTE. O
// formato (ids de `payments` do C2X como texto, `original_amount` + 1% de juros + 2% de multa =
// `agreement_amount`, `submitted_at` em UTC, unidade "LOS2409") foi medido em 16/09/2026 nos 18
// acordos de `guardian_compromissos`. Nome, CPF e endereço são inventados.

const ACORDO: AcordoParaOTermo = {
  acquisitionRequestC2xId: 467,
  approvalStatus: "aprovado",
  createdAt: "2026-09-14T18:21:53.435Z",
  kind: "acordo",
  metadata: {
    agreement_amount: 309,
    c2x_parcelas: ["286086", "286085"],
    original_amount: 300,
  },
  parcelas: [
    { amount: 103, dueDate: "2026-11-25", sequence: 2 },
    { amount: 103, dueDate: "2026-10-25", sequence: 1 },
    { amount: 103, dueDate: "2026-12-25", sequence: 3 },
  ],
  status: "ativo",
  // 01h de 15/09 em UTC = 22h de 14/09 em Brasília.
  submittedAt: "2026-09-15T01:10:00.000Z",
  totalAmount: 309,
};

const CLIENTE: ClienteDoHadesParaOTermo = {
  c2xInstallments: [
    {
      acquisitionRequestId: "467",
      dueDateInput: "2026-07-10",
      id: "286086",
      number: "Parcela 12/144",
      status: "Vencida",
      unitCode: "LOS2409",
      valueNumber: 150,
    },
    {
      acquisitionRequestId: "467",
      dueDateInput: "2026-06-10",
      id: "286085",
      number: "Parcela 11/144",
      status: "Vencida",
      unitCode: "LOS2409",
      valueNumber: 150,
    },
    // Parcela de OUTRO contrato do mesmo cliente: não pode entrar no termo.
    {
      acquisitionRequestId: "999",
      dueDateInput: "2026-06-10",
      id: "500001",
      number: "Parcela 03/120",
      status: "Vencida",
      unitCode: "LOS0101",
      valueNumber: 80,
    },
  ],
  carteira: {
    unidades: [
      { empreendimento: "Lavra Do Ouro", lote: "L01", matricula: "LOS0101", quadra: "Q01" },
      { empreendimento: "Lavra Do Ouro", lote: "L09", matricula: "LOS2409", quadra: "Q24" },
    ],
  },
  cpf: "123.456.789-09",
  dados360: {
    endereco: "Rua Inventada - 10 - Centro - Itaúna/MG - CEP 35.680-000",
    estadoCivil: "Solteiro(a)",
    nacionalidade: "Brasileira",
    profissao: "Operador De Máquina",
  },
  nome: "Fulano De Teste",
};

const EMITIDO = new Date(2026, 8, 16);

function montar(
  acordo: Partial<AcordoParaOTermo> = {},
  cliente: Partial<ClienteDoHadesParaOTermo> = {},
) {
  return montarDadosDoTermoDeAcordo({
    acordo: { ...ACORDO, ...acordo },
    cliente: { ...CLIENTE, ...cliente },
    emitidoEm: EMITIDO,
  });
}

function dadosOk() {
  const resultado = montar();
  if (!resultado.ok) throw new Error(`esperava ok, veio: ${resultado.motivo}`);
  return resultado.dados;
}

describe("as pequenas réguas", () => {
  it("data curta sem passar por fuso", () => {
    expect(dataCurta("2026-05-15")).toBe("15/05/2026");
    expect(dataCurta(undefined)).toBe("-");
  });

  it("o dia do envio é o dia de Brasília, não o de UTC", () => {
    expect(diaEmBrasilia("2026-09-15T01:10:00.000Z")).toBe("14/09/2026");
    expect(diaEmBrasilia(null)).toBe("-");
  });

  it("hoje, à noite em Brasília, ainda é hoje", () => {
    // 23h30 de 16/09 em Brasília = 02h30 de 17/09 em UTC.
    const hoje = hojeEmBrasilia(new Date("2026-09-17T02:30:00.000Z"));
    expect([hoje.getDate(), hoje.getMonth() + 1, hoje.getFullYear()]).toEqual([16, 9, 2026]);
  });

  it("tira o 'Parcela' que o papel já escreve, e mantém Sinal e Ato", () => {
    expect(numeroDaParcela("Parcela 06/120")).toBe("06/120");
    expect(numeroDaParcela("Sinal 01/04")).toBe("Sinal 01/04");
    expect(numeroDaParcela("Ato")).toBe("Ato");
  });

  it("unidade em texto, e o código quando não há quadra nem lote", () => {
    expect(unidadeEmTexto({ lote: "L09", matricula: "LOS2409", quadra: "Q24" })).toBe(
      "Quadra 24 - Lote 09",
    );
    expect(unidadeEmTexto({ lote: "Sem lote", matricula: "APTO12", quadra: "Sem quadra" })).toBe(
      "APTO12",
    );
  });

  it("vencimento considerado: a data, ou o intervalo quando são várias", () => {
    expect(vencimentoConsiderado(["2026-05-15"])).toBe("15/05/2026");
    expect(vencimentoConsiderado(["2026-07-10", "2026-06-10", "2026-06-10"])).toBe(
      "10/06/2026 a 10/07/2026",
    );
    expect(vencimentoConsiderado([])).toBe("-");
  });

  it("os ids das parcelas cobertas aceitam número e texto, e ignoram lixo", () => {
    expect(idsDasParcelasCobertas({ c2x_parcelas: ["1", 2, null, " "] })).toEqual(["1", "2"]);
    expect(idsDasParcelasCobertas({})).toEqual([]);
  });

  it("a concordância das frases de recusa", () => {
    expect(quantasDas(1, 6, "já consta paga", "já constam pagas")).toBe("1 das 6 parcelas já consta paga");
    expect(quantasDas(5, 6, "já consta paga", "já constam pagas")).toBe("5 das 6 parcelas já constam pagas");
    expect(quantasDas(1, 1, "já consta paga", "já constam pagas")).toBe("A parcela já consta paga");
  });
});

describe("o termo montado a partir do acordo gravado", () => {
  it("o valor atualizado é o agreement_amount gravado, e não uma conta nova", () => {
    expect(dadosOk().debito.valorAtualizado).toBe(309);
  });

  it("o débito é congelado na data do envio, no dia de Brasília", () => {
    expect(dadosOk().debito.apuradoEm).toBe("14/09/2026");
  });

  it("sem submitted_at (registro antigo), congela na criação", () => {
    const resultado = montar({ submittedAt: null });
    expect(resultado.ok && resultado.dados.debito.apuradoEm).toBe("14/09/2026");
  });

  it("as parcelas em atraso são só as do acordo, em ordem de vencimento, e somam o nominal gravado", () => {
    const { debito } = dadosOk();
    expect(debito.parcelas).toEqual([
      { numero: "11/144", valor: 150, vencimento: "10/06/2026" },
      { numero: "12/144", valor: 150, vencimento: "10/07/2026" },
    ]);
    expect(totalNominalEmAtraso(debito.parcelas)).toBe(300);
    expect(debito.vencimentoConsiderado).toBe("10/06/2026 a 10/07/2026");
  });

  it("as parcelas do acordo seguem a sequência, e a previsão de pagamento é a última delas", () => {
    const dados = dadosOk();
    expect(dados.parcelasDoAcordo.map((parcela) => parcela.vencimento)).toEqual([
      "25/10/2026",
      "25/11/2026",
      "25/12/2026",
    ]);
    expect(dados.debito.previsaoDePagamento).toBe("25/12/2026");
  });

  it("a unidade é a do contrato do acordo, e o PV é o código da unidade no C2X", () => {
    const dados = dadosOk();
    expect(dados.pv).toBe("LOS2409");
    expect(dados.unidade).toBe("Quadra 24 - Lote 09");
    expect(dados.empreendimento).toBe("Lavra Do Ouro");
  });

  it("a qualificação é a da ficha do Hades, sem RG nem documento de identificação", () => {
    const { comprador } = dadosOk();
    expect(comprador).toEqual({
      cpf: "123.456.789-09",
      endereco: "Rua Inventada - 10 - Centro - Itaúna/MG - CEP 35.680-000",
      estadoCivil: "Solteiro(a)",
      nacionalidade: "Brasileira",
      nome: "Fulano De Teste",
      profissao: "Operador De Máquina",
    });
    expect(Object.keys(comprador)).not.toContain("rg");
  });

  it("registro antigo sem agreement_amount cai no total das parcelas", () => {
    const resultado = montar({ metadata: { c2x_parcelas: ["286085", "286086"] } });
    expect(resultado.ok && resultado.dados.debito.valorAtualizado).toBe(309);
  });

  it("e o que sai daqui vira PDF de verdade", async () => {
    const bytes = await montarTermoDeAcordoPdf(dadosOk());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });
});

describe("quando o termo é recusado, a recusa é uma frase", () => {
  it("o gate vem primeiro, com 409", () => {
    expect(montar({ approvalStatus: "pendente" })).toEqual({
      motivo: MOTIVOS_DO_TERMO.pendente,
      ok: false,
      status: 409,
    });
  });

  it("acordo sem as parcelas cobertas registradas", () => {
    const resultado = montar({ metadata: { agreement_amount: 309 } });
    expect(resultado.ok).toBe(false);
    expect(!resultado.ok && resultado.motivo).toContain("não registra quais parcelas");
  });

  it("contrato que sumiu da carteira ativa (distrato) tem frase própria", () => {
    const resultado = montar({}, {
      c2xInstallments: (CLIENTE.c2xInstallments ?? []).filter((p) => p.acquisitionRequestId !== "467"),
    });
    expect(!resultado.ok && resultado.motivo).toContain("não aparece mais na carteira ativa");
  });

  // ⚠️ O CASO AC-000027, medido em 16/09/2026: as duas parcelas não existem mais no C2X.
  it("parcela coberta que não existe mais no C2X", () => {
    const resultado = montar({
      metadata: { ...ACORDO.metadata, c2x_parcelas: ["286085", "286086", "777777"] },
    });
    expect(resultado).toMatchObject({ ok: false, status: 422 });
    expect(!resultado.ok && resultado.motivo).toBe(
      "1 das 3 parcelas que este acordo cobre não existe mais no C2X (cancelada ou reemitida); revise o acordo antes de emitir o termo.",
    );
  });

  it("parcela de outra unidade no mesmo acordo", () => {
    const resultado = montar({
      metadata: { ...ACORDO.metadata, c2x_parcelas: ["286085", "500001"] },
    });
    expect(!resultado.ok && resultado.motivo).toContain("é de outra unidade");
  });

  // ⚠️ O CASO AC-000023, medido em 16/09/2026: 5 das 6 parcelas pagas depois do envio.
  it("parcela paga depois do acordo: o termo não afirma débito que não existe", () => {
    const pagas = (CLIENTE.c2xInstallments ?? []).map((parcela) => ({
      ...parcela,
      status: "Liquidada",
    }));
    const resultado = montar({}, { c2xInstallments: pagas });
    expect(!resultado.ok && resultado.motivo).toBe(
      "2 das 2 parcelas que este acordo cobre já constam pagas no C2X, e o termo diria que estão em aberto; revise o acordo antes de emitir o termo.",
    );
  });

  it("valor no C2X diferente do nominal congelado", () => {
    const mudadas = (CLIENTE.c2xInstallments ?? []).map((parcela) =>
      parcela.id === "286085" ? { ...parcela, valueNumber: 160.5 } : parcela,
    );
    const resultado = montar({}, { c2xInstallments: mudadas });
    expect(!resultado.ok && resultado.motivo).toMatch(
      /somam hoje R\$\s310,50 no C2X, mas o acordo foi montado sobre R\$\s300,00/,
    );
  });

  it("parcelas do acordo que não fecham com o valor acordado: a frase da lib do desenho, sem 500", () => {
    const resultado = montar({ metadata: { ...ACORDO.metadata, agreement_amount: 350 } });
    expect(resultado).toMatchObject({ ok: false, status: 422 });
    expect(!resultado.ok && resultado.motivo).toContain("Confira o acordo antes de emitir o termo.");
  });

  it("unidade que não está na carteira do cliente", () => {
    const resultado = montar({}, { carteira: { unidades: [] } });
    expect(!resultado.ok && resultado.motivo).toContain("unidade deste acordo não foi encontrada");
  });
});
