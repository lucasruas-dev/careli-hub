import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { type ExtratoParcela } from "@/lib/apolo/incorporador/carteira-liquida";
import {
  COLUNAS_DO_ARQUIVO,
  linhaDoArquivo,
  nomeDoArquivo,
  planilhaDoExtrato,
} from "@/lib/apolo/incorporador/planilha-do-extrato";

function parcela(sobrescreve: Partial<ExtratoParcela> = {}): ExtratoParcela {
  return {
    cliente: "Maria da Silva",
    documento: "06451043613",
    empreendimento: "Vale do Ouro",
    imobiliaria: "Imobiliária X",
    liquido: 400,
    numero: "3/120",
    pagoEm: "2026-07-12",
    perfil: "Parcela",
    situacao: "paga",
    unidade: "Q01 L01",
    valor: 1000,
    vencimento: "2026-07-10",
    ...sobrescreve,
  };
}

describe("linhaDoArquivo", () => {
  it("formata o documento e as datas no padrão de quem abre a planilha no Brasil", () => {
    const linha = linhaDoArquivo(parcela());

    expect(linha.documento).toBe("064.510.436-13");
    // ⚠️ TEXTO, e não `Date`: o serial do ExcelJS nasce em UTC e mostraria o dia anterior aqui.
    expect(linha.vencimento).toBe("10/07/2026");
    expect(linha.pagamento).toBe("12/07/2026");
  });

  it("formata CNPJ do comprador PJ (18 dos 856 clientes medidos)", () => {
    expect(linhaDoArquivo(parcela({ documento: "12345678000199" })).documento).toBe(
      "12.345.678/0001-99",
    );
  });

  it("documento ausente vira célula vazia, nunca 'null' escrito por extenso", () => {
    expect(linhaDoArquivo(parcela({ documento: null })).documento).toBe("");
  });

  it("data ausente vira vazio, e não 01/01/1970", () => {
    expect(linhaDoArquivo(parcela({ pagoEm: null })).pagamento).toBe("");
  });

  it("líquido nulo continua nulo: zero somaria como se a parcela não rendesse nada", () => {
    expect(linhaDoArquivo(parcela({ liquido: null })).liquido).toBeNull();
  });
});

describe("nomeDoArquivo", () => {
  it("tira acento e espaço do empreendimento", () => {
    expect(nomeDoArquivo("Jardim Guarujá", "2026-09-23")).toBe(
      "extrato-jardim-guaruja-2026-09-23.xlsx",
    );
  });

  it("sem empreendimento (carteira consolidada), só a data", () => {
    expect(nomeDoArquivo(null, "2026-09-23")).toBe("extrato-2026-09-23.xlsx");
  });
});

describe("planilhaDoExtrato", () => {
  /** Lê o arquivo gerado de volta: é a única prova de que ele abre. */
  async function abrir(buffer: ArrayBuffer) {
    const livro = new ExcelJS.Workbook();
    await livro.xlsx.load(buffer);
    const aba = livro.getWorksheet("Extrato");
    if (!aba) throw new Error("aba não encontrada");
    return aba;
  }

  it("gera um arquivo que abre, com cabeçalho, linhas e total", async () => {
    const aba = await abrir(
      await planilhaDoExtrato({
        carteira: "Vale do Ouro",
        parcelas: [parcela(), parcela({ liquido: 200, valor: 500 })],
        total: 2,
      }),
    );

    // Cabeçalho + 2 linhas + total.
    expect(aba.rowCount).toBe(4);

    const cabecalho = aba.getRow(1).values as unknown[];
    expect(cabecalho.slice(1)).toEqual(COLUNAS_DO_ARQUIVO.map((c) => c.titulo));

    // ⚠️ O VALOR É NÚMERO, e não texto "R$ 1.000,00": a planilha tem que somar e filtrar.
    const coluna = COLUNAS_DO_ARQUIVO.findIndex((c) => c.chave === "valor") + 1;
    expect(aba.getRow(2).getCell(coluna).value).toBe(1000);

    // O total soma as duas linhas.
    expect(aba.getRow(4).getCell(coluna).value).toBe(1500);
  });

  it("o documento vai como TEXTO: só dígitos, o Excel comeria o zero à esquerda", async () => {
    const aba = await abrir(
      await planilhaDoExtrato({ carteira: null, parcelas: [parcela()], total: 1 }),
    );

    const coluna = COLUNAS_DO_ARQUIVO.findIndex((c) => c.chave === "documento") + 1;
    const celula = aba.getRow(2).getCell(coluna);
    expect(celula.value).toBe("064.510.436-13");
    expect(typeof celula.value).toBe("string");
  });

  it("recorte cortado pelo teto DIZ que está cortado, em vez de mentir um total", async () => {
    const aba = await abrir(
      await planilhaDoExtrato({ carteira: null, parcelas: [parcela()], total: 9000 }),
    );

    const linhaDoTotal = aba.getRow(3);
    expect(String(linhaDoTotal.getCell(1).value)).toBe("1 parcela(s)");
    expect(String(linhaDoTotal.getCell(2).value)).toBe("de 9000 do filtro");
  });

  it("leitura truncada avisa DENTRO do arquivo, e ganha do aviso do filtro", async () => {
    // Medido em 23/09/2026: LOS tem 37.956 parcelas e a leitura do C2X para em 30.000. Sem este
    // aviso, quem abre soma 30.000 linhas e acha que é a carteira inteira.
    const aba = await abrir(
      await planilhaDoExtrato({
        carteira: null,
        leituraParcial: true,
        parcelas: [parcela()],
        total: 30000,
      }),
    );

    expect(String(aba.getRow(3).getCell(2).value)).toBe("PARCIAL: a leitura bateu no teto");
  });

  it("recorte inteiro não escreve aviso de corte", async () => {
    const aba = await abrir(
      await planilhaDoExtrato({ carteira: null, parcelas: [parcela()], total: 1 }),
    );

    expect(String(aba.getRow(3).getCell(2).value ?? "")).toBe("");
  });
});
