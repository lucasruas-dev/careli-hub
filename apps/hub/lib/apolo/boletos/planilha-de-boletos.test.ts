import { describe, expect, it } from "vitest";

import {
  COLUNAS_DA_PLANILHA,
  LIMITE_DE_LINHAS,
  linhasDaPlanilha,
  nomeDoArquivo,
} from "./planilha-de-boletos";

// O corpo vem do NAVEGADOR: o que se mede aqui é o recorte, não a beleza da planilha.

describe("o que chega da tela", () => {
  it("recorta os campos que a planilha usa e ignora o resto", () => {
    const [linha] = linhasDaPlanilha([
      {
        cliente: "WELLINGTON JUNIO SILVA",
        documento: "130.430.386-14",
        enviado: "02/09/2026",
        pagamento: "",
        predio: "Ed. Cristal",
        segredo: "não vai para lugar nenhum",
        situacao: "Em aberto",
        telefone: "(37) 99111-4318",
        unidade: "101",
        valor: 1520.92,
        vencimento: "15/09/2026",
      },
    ]);

    expect(linha).toEqual({
      cliente: "WELLINGTON JUNIO SILVA",
      documento: "130.430.386-14",
      enviado: "02/09/2026",
      pagamento: "",
      predio: "Ed. Cristal",
      situacao: "Em aberto",
      telefone: "(37) 99111-4318",
      unidade: "101",
      valor: 1520.92,
      vencimento: "15/09/2026",
    });
  });

  it("valor que não é número vira zero, em vez de escrever 'NaN' na célula", () => {
    const [linha] = linhasDaPlanilha([{ cliente: "X", valor: "mil e quinhentos" }]);
    expect(linha?.valor).toBe(0);
  });

  it("aceita valor em texto, que é como o JSON de um corpo montado à mão costuma chegar", () => {
    const [linha] = linhasDaPlanilha([{ cliente: "X", valor: "1520.92" }]);
    expect(linha?.valor).toBe(1520.92);
  });

  it("campo ausente vira célula vazia, e não o texto 'undefined'", () => {
    const [linha] = linhasDaPlanilha([{ cliente: "X" }]);
    expect(linha?.telefone).toBe("");
    expect(linha?.pagamento).toBe("");
  });

  it("tira quebra de linha e corta texto gigante", () => {
    const [linha] = linhasDaPlanilha([{ cliente: `MARIA\nDA SILVA`, predio: "a".repeat(500) }]);
    expect(linha?.cliente).toBe("MARIA DA SILVA");
    expect(linha?.predio).toHaveLength(200);
  });

  it("respeita o teto de linhas", () => {
    const muitas = Array.from({ length: LIMITE_DE_LINHAS + 40 }, () => ({ cliente: "X" }));
    expect(linhasDaPlanilha(muitas)).toHaveLength(LIMITE_DE_LINHAS);
  });

  it("corpo que não é lista não vira planilha", () => {
    expect(linhasDaPlanilha(null)).toEqual([]);
    expect(linhasDaPlanilha({ cliente: "X" })).toEqual([]);
    // Linha que não é objeto some sem derrubar as outras.
    expect(linhasDaPlanilha(["texto solto", { cliente: "X" }])).toHaveLength(1);
  });
});

describe("o arquivo", () => {
  it("leva a carteira e a competência no nome, sem acento nem espaço", () => {
    expect(nomeDoArquivo("2026-09", "Vale do Ouro - 2")).toBe("boletos-vale-do-ouro-2-2026-09.xlsx");
    expect(nomeDoArquivo("2026-09", "Guaimbê")).toBe("boletos-guaimbe-2026-09.xlsx");
  });

  it("sem carteira, só a competência", () => {
    expect(nomeDoArquivo("2026-09", null)).toBe("boletos-2026-09.xlsx");
  });

  it("as colunas da planilha são as da tela, e só uma é moeda", () => {
    expect(COLUNAS_DA_PLANILHA.map((c) => c.titulo)).toEqual([
      "Cliente",
      "Prédio",
      "Unidade",
      "CPF/CNPJ",
      "Telefone",
      "Valor",
      "Vencimento",
      "Pagamento",
      "Situação",
      "Enviado",
    ]);
    expect(COLUNAS_DA_PLANILHA.filter((c) => c.moeda).map((c) => c.chave)).toEqual(["valor"]);
  });
});
