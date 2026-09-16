import { StandardFonts, PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";

import {
  alturaDeParagrafos,
  blocoDeAssinatura,
  dataPorExtenso,
  desenharTabelaLimpa,
  dinheiro,
  limpar,
  mesPorExtenso,
  quebrar,
  sanitizarNomeDeArquivo,
} from "./pdf-timbrado";

// ⚠️ ESTE ARQUIVO EXISTE PORQUE `pdf-timbrado.ts` PASSOU MESES SEM GERAR UMA FOLHA. Ele foi
// extraído do extrato do cliente em 15/09/2026 e ficou sem consumidor, sem teste e sem execução —
// e três defeitos só apareceram quando o relatório de rescisão imprimiu o primeiro PDF de verdade.
// Os consertos daquele dia estão travados aqui: são a régua de TRÊS documentos, e o segundo a
// quebrá-la não teria como saber.

let font: Awaited<ReturnType<PDFDocument["embedFont"]>>;

beforeAll(async () => {
  const doc = await PDFDocument.create();
  font = await doc.embedFont(StandardFonts.Helvetica);
});

describe("quebrar", () => {
  // ⚠️ O DEFEITO REAL, VISTO NO PAPEL: "...corresponde a R$" fechava a linha e "963,88" abria a
  // seguinte. Num documento financeiro o símbolo e o número são uma unidade de leitura.
  it("nunca deixa o 'R$' sozinho no fim da linha", () => {
    const largura = font.widthOfTextAtSize("O valor total corresponde a R$", 7.8) + 6;
    const linhas = quebrar("O valor total corresponde a R$ 963,88, e segue devido.", font, 7.8, largura);

    expect(linhas.some((linha) => linha.trim().endsWith("R$"))).toBe(false);
    expect(linhas.join(" ")).toContain("R$ 963,88,");
  });

  it("devolve uma linha vazia para texto vazio, em vez de estourar", () => {
    expect(quebrar("   ", font, 8, 100)).toEqual([""]);
  });
});

describe("dataPorExtenso", () => {
  // ⚠️ `new Date("2026-06-25")` É MEIA-NOITE EM UTC: no fuso de Brasília o `getDate()` devolve 24,
  // e o documento sairia datado de um dia antes do que está no banco.
  it("lê 'YYYY-MM-DD' sem passar por fuso", () => {
    expect(dataPorExtenso("2026-06-25")).toBe("25 de junho de 2026");
    expect(dataPorExtenso("2026-01-01")).toBe("1 de janeiro de 2026");
  });

  it("continua aceitando Date, como o extrato chamava", () => {
    expect(dataPorExtenso(new Date(2026, 5, 25))).toBe("25 de junho de 2026");
  });

  it("texto que não é data não vira 'NaN de undefined'", () => {
    expect(dataPorExtenso("sem data")).toBe("-");
  });
});

describe("mesPorExtenso", () => {
  it("escreve a competência como o documento escreve", () => {
    expect(mesPorExtenso("2024-10")).toBe("outubro de 2024");
    expect(mesPorExtenso("2026-04-15")).toBe("abril de 2026");
  });

  it("devolve nulo quando não há competência, para a frase omitir o trecho", () => {
    expect(mesPorExtenso(null)).toBeNull();
    expect(mesPorExtenso("2026-13")).toBeNull();
  });
});

describe("alturaDeParagrafos", () => {
  it("cresce com o número de linhas e com o espaço entre parágrafos", () => {
    const uma = alturaDeParagrafos(["curto"], font, 7.8);
    const duas = alturaDeParagrafos(["curto", "outro"], font, 7.8);

    expect(duas).toBeCloseTo(uma * 2, 5);
    expect(alturaDeParagrafos(["curto", "outro"], font, 7.8, 4)).toBeCloseTo(duas + 4, 5);
  });
});

describe("limpar", () => {
  it("mantém o acento latino e derruba o que o WinAnsi não escreve", () => {
    expect(limpar("Itaúna/MG - área 300 m²")).toBe("Itaúna/MG - área 300 m²");
    expect(limpar("traço — e emoji 🙂")).toBe("traço - e emoji ");
  });
});

describe("sanitizarNomeDeArquivo", () => {
  it("tira acento e o que quebra nome de arquivo no Windows", () => {
    expect(sanitizarNomeDeArquivo("Relatório de Rescisão - LOS/0610.pdf")).toBe(
      "Relatorio de Rescisao - LOS-0610.pdf",
    );
  });
});

describe("dinheiro", () => {
  // ⚠️ A RÉGUA DO DINHEIRO SUBIU PARA CÁ EM 15/09/2026, e o motivo é o número de cópias: `reais`
  // em `lib/apolo/rescisao.ts` (que fica lá porque o arquivo do CÁLCULO não pode importar pdf-lib),
  // `dinheiro` em `lib/apolo/extrato-cliente.ts` — que NÃO troca o NBSP — e uma terceira escrita
  // dentro do termo de acordo. Documento timbrado formata dinheiro de um jeito só.
  it("escreve o real com espaço normal, e nunca com o não-quebrável", () => {
    const naoQuebravel = String.fromCharCode(160);

    expect(dinheiro(1)).toBe("R$ 1,00");
    expect(dinheiro(1)).not.toContain(naoQuebravel);
    expect(dinheiro(2364.33)).toBe("R$ 2.364,33");
    expect(dinheiro(2364.33)).not.toContain(naoQuebravel);
  });

  // ⚠️ SEM O ARREDONDAMENTO, a soma de ponto flutuante imprime o centavo do vizinho e o papel
  // deixa de fechar com a própria linha de total.
  it("arredonda o centavo antes de formatar e não quebra com número inválido", () => {
    expect(dinheiro(0.1 + 0.2)).toBe("R$ 0,30");
    expect(dinheiro(591.085)).toBe("R$ 591,09");
    expect(dinheiro(Number.NaN)).toBe("R$ 0,00");
  });
});

describe("blocoDeAssinatura", () => {
  // ⚠️ O MODELO DO ACORDO NÃO TEM "Atenciosamente,"; o da rescisão tem. Enquanto a saudação era
  // texto fixo do bloco compartilhado, o instrumento particular saía com uma linha de carta que o
  // papel aprovado pela Careli não traz.
  it("imprime a saudação por padrão e a omite quando recebe null", async () => {
    const semSaudacao = await folhaComAssinatura(null);
    const comSaudacao = await folhaComAssinatura(undefined);

    expect(comSaudacao).toContain("Atenciosamente,");
    expect(semSaudacao).not.toContain("Atenciosamente,");
    expect(semSaudacao).toContain("Nívea Careli");
  });
});

/** Gera uma folha só com o bloco de assinatura e devolve o texto que foi escrito nela. */
async function folhaComAssinatura(saudacao: null | string | undefined): Promise<string> {
  const escritos: string[] = [];
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const original = page.drawText.bind(page);
  page.drawText = (texto: string, opcoes?: Parameters<typeof original>[1]) => {
    escritos.push(texto);
    return original(texto, opcoes);
  };

  blocoDeAssinatura(
    { bold, doc, font, page, y: 700 },
    {
      cargo: "Diretora Executiva",
      cidade: "Belo Horizonte/MG",
      data: "2026-07-10",
      nome: "Nívea Careli",
      ...(saudacao === undefined ? {} : { saudacao }),
    },
  );

  return escritos.join(" | ");
}

describe("desenharTabelaLimpa", () => {
  const CALCULO_LONGO = "0,75% ao mês sobre R$ 198.450,12, por 21,5 meses, pro rata die";

  // ⚠️ DESLIGADA, É A TABELA DO EXTRATO: célula que não cabe sai cortada e a linha tem altura fixa.
  it("sem quebrarCelulas, corta com reticências e anda uma linha por linha", async () => {
    const { escritos, yFinal } = await tabelaEstreita(false);

    expect(escritos.some((texto) => texto.endsWith("..."))).toBe(true);
    expect(yFinal).toBeCloseTo(700 - 15 - 11.5, 5);
  });

  // ⚠️ LIGADA, A BASE DE CÁLCULO SAI INTEIRA: é a frase que o jurídico confere, e cortada ela deixa
  // de ser conferível. A linha cresce com as linhas da célula, e o valor à direita não quebra.
  it("com quebrarCelulas, escreve todas as palavras e a linha cresce", async () => {
    const { escritos, yFinal } = await tabelaEstreita(true);

    expect(escritos.some((texto) => texto.endsWith("..."))).toBe(false);
    expect(escritos.filter((texto) => texto !== "CÁLCULO" && texto !== "VALOR").join(" ")).toContain(
      "R$ 32.000,08",
    );
    const palavras = escritos.join(" ").split(/\s+/);
    for (const palavra of CALCULO_LONGO.split(" ")) expect(palavras).toContain(palavra);
    expect(yFinal).toBeLessThan(700 - 15 - 11.5);
  });

  /** Uma tabela de uma linha com a coluna do cálculo estreita, e o texto que foi escrito nela. */
  async function tabelaEstreita(
    quebrarCelulas: boolean,
  ): Promise<{ escritos: string[]; yFinal: number }> {
    const escritos: string[] = [];
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const original = page.drawText.bind(page);
    page.drawText = (texto: string, opcoes?: Parameters<typeof original>[1]) => {
      escritos.push(texto);
      return original(texto, opcoes);
    };

    const ctx = { bold, doc, font, page, y: 700 };
    desenharTabelaLimpa(ctx, {
      colunas: [
        { label: "Cálculo", peso: 0.3 },
        { align: "right", label: "Valor", peso: 0.7 },
      ],
      linhas: [[CALCULO_LONGO, "R$ 32.000,08"]],
      quebrarCelulas,
      vazio: "-",
    });

    return { escritos, yFinal: ctx.y };
  }
});
