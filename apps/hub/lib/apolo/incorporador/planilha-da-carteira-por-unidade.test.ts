import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  COLUNAS_DA_PLANILHA,
  linhaDaUnidade,
  nomeDoArquivo,
  nomeDoRecorte,
  planilhaDaCarteiraPorUnidade,
  type ProdutoDoSeletor,
  RECORTE_NAO_IDENTIFICADO,
  recorteDaConsulta,
  situacaoDaUnidade,
  type UnidadeDaPlanilha,
} from "@/lib/apolo/incorporador/planilha-da-carteira-por-unidade";

function unidade(sobrescreve: Partial<UnidadeDaPlanilha> = {}): UnidadeDaPlanilha {
  return {
    block: "01",
    client: "Maria da Silva",
    code: "Q01 L05",
    contractCode: "000123",
    empreendimento: "Vale do Ouro",
    // ⚠️ MEIA-NOITE EM UTC: é assim que o dia chega do MySQL. No fuso de São Paulo isso é 31/07 às
    // 21h, e a planilha tem de dizer 01/08.
    faturadoAt: "2026-08-01T00:00:00.000Z",
    imobiliaria: "Imobiliária Centro",
    liquido: { liquido: 400.5, semLiquido: 0 },
    lot: "05",
    maxOverdueDays: 0,
    overdueAmount: 0,
    overdueInstallments: 0,
    paidAmount: 12000,
    temContrato: true,
    toReceiveAmount: 88000,
    totalContract: 100000,
    ...sobrescreve,
  };
}

const PADRAO = {
  busca: "",
  consultadoEm: null,
  filtro: "todos" as const,
  liquido: { parcial: false },
  ordem: { coluna: "vencido" as const, direcao: "desc" as const },
  recorte: "Vale do Ouro",
};

/** Lê o arquivo gerado de volta: é a única prova de que ele abre. */
async function abrir(buffer: ArrayBuffer) {
  const livro = new ExcelJS.Workbook();
  await livro.xlsx.load(buffer);
  const aba = livro.getWorksheet("Carteira");
  const sobre = livro.getWorksheet("Sobre");
  if (!aba || !sobre) throw new Error("aba não encontrada");
  return { aba, sobre };
}

function coluna(chave: (typeof COLUNAS_DA_PLANILHA)[number]["chave"]): number {
  return COLUNAS_DA_PLANILHA.findIndex((c) => c.chave === chave) + 1;
}

/** A aba "Sobre" como mapa campo -> valor. */
function camposDoSobre(sobre: ExcelJS.Worksheet): Map<string, unknown> {
  const campos = new Map<string, unknown>();
  sobre.eachRow((linha) => {
    campos.set(String(linha.getCell(1).value), linha.getCell(2).value);
  });
  return campos;
}

describe("situacaoDaUnidade", () => {
  it("o mesmo critério do seletor da tela: parcela vencida é inadimplente, nenhuma é em dia", () => {
    expect(situacaoDaUnidade({ overdueInstallments: 0 })).toBe("Em dia");
    expect(situacaoDaUnidade({ overdueInstallments: 1 })).toBe("Inadimplente");
    expect(situacaoDaUnidade({ overdueInstallments: 7 })).toBe("Inadimplente");
  });
});

describe("linhaDaUnidade", () => {
  it("faturado à meia-noite UTC continua no mesmo dia, e vai como TEXTO", () => {
    const linha = linhaDaUnidade(unidade());
    expect(linha.faturado).toBe("01/08/2026");
    expect(typeof linha.faturado).toBe("string");
  });

  it("faturado ausente vira vazio, e não '-' nem 01/01/1970", () => {
    expect(linhaDaUnidade(unidade({ faturadoAt: null })).faturado).toBe("");
  });

  it("quadra e lote continuam texto: '05' não pode virar 5", () => {
    const linha = linhaDaUnidade(unidade());
    expect(linha.quadra).toBe("01");
    expect(linha.lote).toBe("05");
    expect(linha.contrato).toBe("000123");
  });

  it("líquido nulo continua nulo, e a contagem de parcelas sem líquido também", () => {
    const linha = linhaDaUnidade(unidade({ liquido: null }));
    expect(linha.liquido).toBeNull();
    expect(linha.parcelasSemLiquido).toBeNull();
  });

  it("contrato assinado vira Sim/Não, e a situação sai do número de vencidas", () => {
    expect(linhaDaUnidade(unidade()).contratoAssinado).toBe("Sim");
    expect(linhaDaUnidade(unidade({ temContrato: false })).contratoAssinado).toBe("Não");
    expect(linhaDaUnidade(unidade({ overdueInstallments: 2 })).situacao).toBe("Inadimplente");
  });

  it("quebra de linha vinda do cadastro vira espaço", () => {
    expect(linhaDaUnidade(unidade({ client: "Maria\nda  Silva " })).comprador).toBe(
      "Maria da Silva",
    );
  });
});

describe("nomeDoRecorte", () => {
  it("sem nada escolhido é Todos (null)", () => {
    expect(nomeDoRecorte(null, null)).toBeNull();
  });

  it("só o produto", () => {
    expect(nomeDoRecorte("Jardim Guarujá", null)).toBe("Jardim Guarujá");
  });

  it("produto e filho", () => {
    expect(nomeDoRecorte("Vale do Ouro", "Chácaras")).toBe("Vale do Ouro, Chácaras");
  });

  it("o filho que já leva o nome do pai não o repete", () => {
    expect(nomeDoRecorte("Vale do Ouro", "Vale do Ouro Comercial")).toBe("Vale do Ouro Comercial");
  });
});

describe("recorteDaConsulta", () => {
  // A lista como a rota da carteira a manda: o produto com "pai:<uuid>", o recorte com o id do C2X.
  const PRODUTOS: ProdutoDoSeletor[] = [
    { filhos: [], id: "pai:lagoa", nome: "Lagoa Bonita" },
    {
      filhos: [
        { id: "101", nome: "Chácaras" },
        { id: "102", nome: "Vale do Ouro Comercial" },
      ],
      id: "pai:vale",
      nome: "Vale do Ouro",
    },
  ];

  it("sem filtro e com vários produtos é Todos (null)", () => {
    expect(recorteDaConsulta(null, PRODUTOS)).toBeNull();
    expect(recorteDaConsulta(undefined, PRODUTOS)).toBeNull();
  });

  it("sem filtro e com um produto só, o nome dele (a regra da tela)", () => {
    expect(recorteDaConsulta(null, [PRODUTOS[1]!])).toBe("Vale do Ouro");
  });

  it("o filtro de um produto dá o nome do produto", () => {
    expect(recorteDaConsulta("pai:vale", PRODUTOS)).toBe("Vale do Ouro");
    expect(recorteDaConsulta("pai:lagoa", PRODUTOS)).toBe("Lagoa Bonita");
  });

  it("o filtro de um recorte dá o pai e o filho, sem repetir o nome do pai", () => {
    expect(recorteDaConsulta("101", PRODUTOS)).toBe("Vale do Ouro, Chácaras");
    expect(recorteDaConsulta("102", PRODUTOS)).toBe("Vale do Ouro Comercial");
  });

  it("o produto vence o recorte quando os ids coincidem (a precedência do extrato)", () => {
    const colidem: ProdutoDoSeletor[] = [
      { filhos: [{ id: "35", nome: "Filho" }], id: "pai:x", nome: "Pai X" },
      { id: "35", nome: "Produto 35" },
    ];
    expect(recorteDaConsulta("35", colidem)).toBe("Produto 35");
  });

  it("filtro que a lista não conhece NUNCA vira Todos", () => {
    expect(recorteDaConsulta("pai:outro", PRODUTOS)).toBe(RECORTE_NAO_IDENTIFICADO);
    expect(recorteDaConsulta("pai:outro", [])).toBe(RECORTE_NAO_IDENTIFICADO);
  });
});

describe("nomeDoArquivo", () => {
  it("tira acento, vírgula e espaço do recorte", () => {
    expect(nomeDoArquivo("Jardim Guarujá, Fase Única", "2026-09-29")).toBe(
      "carteira-jardim-guaruja-fase-unica-2026-09-29.xlsx",
    );
  });

  it("sem recorte (Todos), só a data", () => {
    expect(nomeDoArquivo(null, "2026-09-29T15:00:00.000Z")).toBe("carteira-2026-09-29.xlsx");
  });
});

describe("planilhaDaCarteiraPorUnidade", () => {
  it("gera um arquivo que abre, com o cabeçalho, as linhas na ordem da tela e o total", async () => {
    const { aba } = await abrir(
      await planilhaDaCarteiraPorUnidade({
        ...PADRAO,
        unidades: [
          unidade({ code: "Q02 L01", overdueAmount: 1500.25, overdueInstallments: 3 }),
          unidade({ code: "Q01 L05", liquido: { liquido: 100, semLiquido: 2 } }),
        ],
      }),
    );

    // Cabeçalho + 2 linhas + total.
    expect(aba.rowCount).toBe(4);
    expect((aba.getRow(1).values as unknown[]).slice(1)).toEqual(
      COLUNAS_DA_PLANILHA.map((c) => c.titulo),
    );
    expect(aba.getRow(1).font?.bold).toBe(true);

    // A ordem é a que chegou (a da tela), e não uma reordenação por código.
    expect(aba.getRow(2).getCell(coluna("unidade")).value).toBe("Q02 L01");
    expect(aba.getRow(3).getCell(coluna("unidade")).value).toBe("Q01 L05");

    // A situação casa com o seletor da tela.
    expect(aba.getRow(2).getCell(coluna("situacao")).value).toBe("Inadimplente");
    expect(aba.getRow(3).getCell(coluna("situacao")).value).toBe("Em dia");
    expect(aba.getRow(2).getCell(coluna("parcelasVencidas")).value).toBe(3);
    expect(aba.getRow(3).getCell(coluna("parcelasSemLiquido")).value).toBe(2);

    // O total: contagem de unidades e as somas de dinheiro.
    const total = aba.getRow(4);
    expect(total.font?.bold).toBe(true);
    expect(total.getCell(coluna("unidade")).value).toBe("2 unidade(s)");
    expect(total.getCell(coluna("vgv")).value).toBe(200000);
    expect(total.getCell(coluna("pago")).value).toBe(24000);
    expect(total.getCell(coluna("aReceber")).value).toBe(176000);
    expect(total.getCell(coluna("vencido")).value).toBe(1500.25);
    expect(total.getCell(coluna("liquido")).value).toBe(500.5);
    // Sem aviso quando o líquido veio inteiro.
    expect(total.getCell(coluna("empreendimento")).value).toBeNull();
  });

  it("dinheiro vai como NÚMERO, com formato de moeda e alinhado à direita", async () => {
    const { aba } = await abrir(
      await planilhaDaCarteiraPorUnidade({ ...PADRAO, unidades: [unidade()] }),
    );

    for (const chave of ["vgv", "pago", "aReceber", "vencido", "liquido"] as const) {
      const celula = aba.getRow(2).getCell(coluna(chave));
      expect(typeof celula.value).toBe("number");
      expect(celula.numFmt).toBe("R$ #,##0.00");
      expect(celula.alignment?.horizontal).toBe("right");
    }
    expect(aba.getRow(2).getCell(coluna("liquido")).value).toBe(400.5);
  });

  it("data como TEXTO dd/mm/aaaa, inclusive a meia-noite UTC que cairia no dia anterior", async () => {
    const { aba } = await abrir(
      await planilhaDaCarteiraPorUnidade({
        ...PADRAO,
        unidades: [unidade(), unidade({ faturadoAt: "2026-03-15" })],
      }),
    );

    const faturado = aba.getRow(2).getCell(coluna("faturado"));
    expect(faturado.value).toBe("01/08/2026");
    expect(typeof faturado.value).toBe("string");
    expect(aba.getRow(3).getCell(coluna("faturado")).value).toBe("15/03/2026");
  });

  it("quadra, lote e contrato continuam texto dentro do arquivo", async () => {
    const { aba } = await abrir(
      await planilhaDaCarteiraPorUnidade({ ...PADRAO, unidades: [unidade()] }),
    );

    expect(aba.getRow(2).getCell(coluna("quadra")).value).toBe("01");
    expect(aba.getRow(2).getCell(coluna("lote")).value).toBe("05");
    expect(aba.getRow(2).getCell(coluna("contrato")).value).toBe("000123");
  });

  it("líquido nulo é célula VAZIA, e não zero; o total soma só o que foi apurado", async () => {
    const { aba } = await abrir(
      await planilhaDaCarteiraPorUnidade({
        ...PADRAO,
        unidades: [unidade({ liquido: null, faturadoAt: null }), unidade()],
      }),
    );

    expect(aba.getRow(2).getCell(coluna("liquido")).value).toBeNull();
    expect(aba.getRow(2).getCell(coluna("parcelasSemLiquido")).value).toBeNull();
    expect(aba.getRow(2).getCell(coluna("faturado")).value).toBeNull();
    expect(aba.getRow(4).getCell(coluna("liquido")).value).toBe(400.5);
  });

  it("líquido PARCIAL: a linha do total avisa, e a aba Sobre também", async () => {
    const { aba, sobre } = await abrir(
      await planilhaDaCarteiraPorUnidade({
        ...PADRAO,
        liquido: { parcial: true },
        unidades: [unidade()],
      }),
    );

    const aviso = String(aba.getRow(3).getCell(coluna("empreendimento")).value);
    expect(aviso).toMatch(/^PARCIAL/);
    expect(aviso).toContain("teto");
    expect(String(camposDoSobre(sobre).get("Aviso"))).toContain("incompletos");
  });

  it("sem líquido nenhum, o total do líquido fica vazio (e não R$ 0,00) e o arquivo diz", async () => {
    const { aba, sobre } = await abrir(
      await planilhaDaCarteiraPorUnidade({
        ...PADRAO,
        liquido: null,
        unidades: [unidade({ liquido: null })],
      }),
    );

    expect(aba.getRow(3).getCell(coluna("liquido")).value).toBeNull();
    expect(String(aba.getRow(3).getCell(coluna("empreendimento")).value)).toMatch(
      /^SEM VALOR LÍQUIDO/,
    );
    expect(camposDoSobre(sobre).has("Aviso")).toBe(true);
  });

  it("a aba Sobre diz de onde o arquivo veio: tela, recorte, busca, filtro, ordem, hora e contagem", async () => {
    const { sobre } = await abrir(
      await planilhaDaCarteiraPorUnidade({
        busca: " silva ",
        // 17:32 UTC = 14:32 em São Paulo.
        consultadoEm: new Date("2026-09-29T17:32:00.000Z"),
        filtro: "inadimplente",
        liquido: { parcial: false },
        ordem: { coluna: "vgv", direcao: "asc" },
        recorte: null,
        unidades: [unidade(), unidade({ liquido: null })],
      }),
    );

    const campos = camposDoSobre(sobre);
    // Só o título da tabela: a aba é "Financeiro" no Cecílio e "Carteira" no portal padrão.
    expect(campos.get("Tela")).toBe("Carteira por unidade");
    expect(campos.get("Recorte")).toBe("Todos");
    expect(campos.get("Busca")).toBe("silva");
    expect(campos.get("Filtro")).toBe("Inadimplentes");
    expect(campos.get("Ordem")).toBe("VGV, crescente");
    expect(campos.get("Consultado em")).toBe("29/09/2026 às 14:32");
    expect(campos.get("Unidades")).toBe(2);
    expect(campos.get("Unidades sem líquido")).toBe(1);
    // Sem parcial e com líquido calculado, não há aviso.
    expect(campos.has("Aviso")).toBe(false);
  });

  it("o texto visível do arquivo não usa travessão", async () => {
    const { aba, sobre } = await abrir(
      await planilhaDaCarteiraPorUnidade({
        ...PADRAO,
        liquido: { parcial: true },
        unidades: [unidade()],
      }),
    );

    const textos: string[] = [];
    for (const folha of [aba, sobre]) {
      folha.eachRow((linha) => {
        linha.eachCell((celula) => textos.push(String(celula.value ?? "")));
      });
    }
    expect(textos.join(" ")).not.toContain(String.fromCodePoint(0x2014));
  });
});
