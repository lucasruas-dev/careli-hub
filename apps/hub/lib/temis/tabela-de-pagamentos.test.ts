import { describe, expect, it } from "vitest";

import { documentoParaHtml } from "./documento-html";
import { tabelaGeralDePagamentos } from "./tabela-de-pagamentos";

// O QUADRO DE PAGAMENTO DO CONTRATO — `[tabela_geral_pagamentos]`.
//
// Lucas (20/09/2026), gerando o contrato do Vale do Ouro: *"Falta a tabela de pagamentos"* e, depois
// de trocar o nome da variável na minuta, *"mudamos a variavel e mesmo assim não veio a tabela"*.
// Nenhuma das duas vinha: as cinco variáveis do grupo "gerado" do catálogo (os três parágrafos e as
// duas tabelas) estavam declaradas e NINGUÉM as montava.
//
// Os números abaixo são os da proposta real da VITORIA SILVA ARAUJO (lote de R$ 133.551,00, plano
// NORMAL de 156x), lidos do banco em 20/09/2026.
const CONDICOES = {
  anuais: [],
  entrada: [{ numero: 1, total: 1, valor: 13355.1, vencimento: "2026-09-18" }],
  mensais: [
    { numero: 1, total: 156, valor: 770.49, vencimento: "2026-10-10" },
    { numero: 2, total: 156, valor: 770.49, vencimento: "2026-11-10" },
    { numero: 156, total: 156, valor: 2083.74, vencimento: "2039-09-10" },
  ],
  plano: {
    entradaPercentual: 10,
    indiceCorrecao: "IPCA_ANUAL",
    jurosPeriodicidade: "mensal",
    jurosTaxa: 0.7207,
    nome: "NORMAL",
    parcelas: 156,
    sistemaAmortizacao: "sacoc",
  },
  totais: { anuais: 0, entrada: 13355.1, financiado: 120195.9, geral: 217772.1, mensais: 204417 },
};

const texto = (no: unknown) =>
  documentoParaHtml([no as never])
    .replace(/<\/(td|th|tr|table|p)>/g, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

// OS TREZE DEGRAUS DA MESMA PROPOSTA, lidos do cronograma congelado em 22/09/2026. É o contrato do
// print da Nívea: 156 mensais que começam em R$ 770,49 e terminam em R$ 2.083,74, subindo uma vez
// por ano com o IPCA. A soma dos treze dá exatamente os R$ 204.417,00 que o quadro sempre mostrou.
const DEGRAUS: readonly (readonly [number, string])[] = [
  [770.49, "2026-10-10"],
  [807.55, "2027-10-10"],
  [880.23, "2028-10-10"],
  [959.44, "2029-10-10"],
  [1045.79, "2030-10-10"],
  [1139.91, "2031-10-10"],
  [1242.49, "2032-10-10"],
  [1354.31, "2033-10-10"],
  [1476.2, "2034-10-10"],
  [1609.05, "2035-10-10"],
  [1753.86, "2036-10-10"],
  [1911.69, "2037-10-10"],
  [2083.74, "2038-10-10"],
] as const;

/** As 156 mensais, uma a uma, como a proposta as congelou. */
const MENSAIS_COMPLETAS = DEGRAUS.flatMap(([valor, vencimento], degrau) =>
  Array.from({ length: 12 }, (_, i) => ({
    numero: degrau * 12 + i + 1,
    total: 156,
    valor,
    vencimento,
  })),
);

describe("tabelaGeralDePagamentos", () => {
  // ⚠️ UMA MENÇÃO SÓ, A DA PRIMEIRA PARCELA — e não um degrau por ciclo de reajuste. Lucas,
  // 22/09/2026, com o modelo do quadro que o jurídico usa: *"no quadro, tabela de pagamento e para
  // vir somente a mencao da primeira parcela, igual ao plano"*.
  //
  // ⚠️ O QUADRO EM DEGRAUS DUROU UM DIA, e a lição fica escrita aqui. De manhã eu quebrei a série
  // em 13 linhas para os números fecharem (156 x 770,49 não dá os R$ 204.417,00 do total), e a
  // Nívea recusou: *"nao da para ter a tabela com a projecao dos juros"*. A leitura dela partia de
  // uma premissa errada — medido no dia, os degraus são JUROS CONTRATADOS, (1+0,007207)^12 = 9% ao
  // ano, e não projeção de IPCA — mas o desconforto era justo: um quadro com o valor de 2038 impresso
  // convida a ler aquilo como promessa.
  //
  // ⚠️ E O TOTAL É O NOMINAL, não a projeção. A decisão mudou no fim do dia 22/09/2026, depois de
  // ler no C2X o contrato do Villa Paris que o jurídico já usa (venda 4834, lote RVPA01): lá a
  // linha MENSAL diz 180 parcelas de R$ 1.195,00 e total de R$ 215.100,00 — e 180 x 1.195,00 dá
  // exatamente R$ 215.100,00. A correção e os juros não entram nos valores: ficam DECLARADOS nas
  // colunas ("IPCA ANUAL", "0,64%") e detalhados na cláusula VII. O quadro inteiro soma
  // R$ 222.270,00, que é o próprio 6.1 PREÇO DO LOTE daquele contrato.
  //
  // ⚠️ E É ISSO QUE FAZ O NOSSO QUADRO FECHAR. Pelo nominal, a venda da VITORIA dá
  // 5.342,04 + 120.195,90 = R$ 125.537,94, que é o 6.1 impresso duas linhas acima. Pela projeção
  // dava R$ 209.759,04 embaixo de um 6.1 de R$ 125.537,94: o documento se contradizia na mesma
  // página, que é o defeito que volta do jurídico.
  it("⚠️ a série mensal sai em UMA linha, com a primeira parcela e o total NOMINAL", () => {
    const saida = texto(tabelaGeralDePagamentos({ ...CONDICOES, mensais: MENSAIS_COMPLETAS }));

    expect(saida).toContain("Mensal");
    expect(saida).not.toContain("Mensais 1 a 12");
    expect(saida).not.toContain("Mensais 145 a 156");

    // A primeira parcela e o primeiro vencimento; o valor de 2038 não entra no papel.
    expect(saida).toContain("R$ 770,49");
    expect(saida).toContain("10/10/2026");
    expect(saida).not.toContain("R$ 2.083,74");
    expect(saida).not.toContain("10/10/2038");

    // O total é o saldo financiado nominal, e não a soma do cronograma com o IPCA projetado.
    expect(saida).toContain("R$ 120.195,90");
    expect(saida).not.toContain("R$ 204.417,00");
  });

  // ⚠️ A ENTRADA VAI UMA LINHA POR PARCELA, com o vencimento de cada uma, e o nome é ENTRADA.
  // Lucas, 22/09/2026, sobre o modelo que usa "SINAL": *"nao gosto da palavra sinal, acho que 1
  // Entrada, ou algo do tipo"*.
  it("entrada parcelada vira uma linha por parcela, numerada", () => {
    const saida = texto(
      tabelaGeralDePagamentos({
        ...CONDICOES,
        entrada: [
          { numero: 1, total: 3, valor: 2400, vencimento: "2026-09-04" },
          { numero: 2, total: 3, valor: 2385, vencimento: "2026-10-20" },
          { numero: 3, total: 3, valor: 2385, vencimento: "2026-11-20" },
        ],
      }),
    );

    expect(saida).toContain("Entrada 1");
    expect(saida).toContain("Entrada 2");
    expect(saida).toContain("Entrada 3");
    expect(saida).toContain("04/09/2026");
    expect(saida).toContain("20/10/2026");
    expect(saida).toContain("20/11/2026");
    expect(saida).toContain("R$ 2.400,00");
    expect(saida).toContain("R$ 2.385,00");
    // Entrada nao leva correcao nem juros: ela e paga antes de existir saldo devedor.
    expect(saida).not.toContain("Entrada (parcelada)");
  });

  it("entrada de uma parcela só não ganha número", () => {
    const saida = texto(tabelaGeralDePagamentos(CONDICOES));
    expect(saida).toContain("Entrada");
    expect(saida).not.toContain("Entrada 1");
  });

  it("traz uma linha por tipo de parcela, com o que o contrato precisa dizer", () => {
    const saida = texto(tabelaGeralDePagamentos(CONDICOES));

    // O cabeçalho que o Lucas pediu no bloco pronto: tipo, correção, juros, vencimento, quantidade,
    // valor e total.
    expect(saida).toContain("Parcela");
    expect(saida).toContain("Correção");
    expect(saida).toContain("Juros");
    expect(saida).toContain("1º vencimento");
    expect(saida).toContain("Qtde.");
    expect(saida).toContain("Valor");
    expect(saida).toContain("Total");

    // A entrada: uma parcela, na data dela, sem correção nem juros (é à vista).
    expect(saida).toContain("Entrada");
    expect(saida).toContain("18/09/2026");
    expect(saida).toContain("R$ 13.355,10");

    // As mensais: a quantidade do plano, a primeira parcela e o primeiro vencimento.
    expect(saida).toContain("Mensal");
    expect(saida).toContain("156");
    expect(saida).toContain("10/10/2026");
    expect(saida).toContain("R$ 770,49");
    expect(saida).toContain("IPCA anual");
    expect(saida).toContain("0,7207% a.m.");
    expect(saida).toContain("R$ 120.195,90");

    // O total geral fecha o quadro — e, sem comissão a abater, ele é o próprio valor negociado:
    // 13.355,10 de entrada + 120.195,90 de saldo = R$ 133.551,00.
    expect(saida).toContain("R$ 133.551,00");
  });

  it("⚠️ a coluna Valor é só o número, sem 'a partir de'", () => {
    // Pedido do Lucas em 20/09/2026, vendo o quadro impresso: *"outra coisa que precisa mudar é
    // tirar o texto a partir de"*. A mensal muda no reajuste (770,49 → 2.083,74 na 156ª) e mesmo
    // assim a célula sai limpa: quem conta o reajuste é a coluna Correção e a cláusula VII.
    const saida = texto(tabelaGeralDePagamentos(CONDICOES));
    expect(saida).not.toContain("a partir de");
    expect(saida).toContain("R$ 770,49");
  });

  it("sem parcela anual, a linha das anuais não existe", () => {
    expect(texto(tabelaGeralDePagamentos(CONDICOES))).not.toContain("Anual");
  });

  it("com parcelas anuais, elas entram no quadro", () => {
    const comAnuais = {
      ...CONDICOES,
      anuais: [
        { numero: 1, total: 2, valor: 5000, vencimento: "2027-09-10" },
        { numero: 2, total: 2, valor: 5000, vencimento: "2028-09-10" },
      ],
      totais: { ...CONDICOES.totais, anuais: 10000 },
    };
    const saida = texto(tabelaGeralDePagamentos(comAnuais));
    expect(saida).toContain("Anual");
    expect(saida).toContain("R$ 5.000,00");
    expect(saida).toContain("R$ 10.000,00");
    expect(saida).toContain("10/09/2027");
  });

  it("sem plano sem juros, a coluna diz 'sem juros' em vez de inventar taxa", () => {
    const semJuros = { ...CONDICOES, plano: { ...CONDICOES.plano, jurosTaxa: null } };
    expect(texto(tabelaGeralDePagamentos(semJuros))).toContain("sem juros");
  });

  // ⚠️ PROPOSTA IMPORTADA DO C2X NÃO TEM CRONOGRAMA. Nesse caso o quadro não existe, e quem chama
  // deixa a variável em branco para a conferência acusar — melhor do que uma tabela inventada.
  it("sem cronograma, não há quadro", () => {
    expect(tabelaGeralDePagamentos(null)).toBeNull();
    expect(tabelaGeralDePagamentos({})).toBeNull();
    expect(tabelaGeralDePagamentos({ mensais: [], entrada: [] })).toBeNull();
  });
});

// ── A COMISSÃO SAI DO QUADRO ──────────────────────────────────────────────────
//
// Lucas (22/09/2026): *"o fluxo da tabela deve trazer somente o valor do incorporador, ou seja, o
// valor do lote negociado menos o valor de comissão"*. Na venda da VITORIA a comissão é de 6% sobre
// os R$ 133.551,00 (2% da coordenadora + 4% da imobiliária) = R$ 8.013,06, em centavos 801306.
const COMISSAO = 801306;

describe("a comissão sai do fluxo da entrada", () => {
  it("deixa na entrada só o que é do loteador", () => {
    const quadro = tabelaGeralDePagamentos(CONDICOES, COMISSAO);
    // 13.355,10 de entrada menos 8.013,06 de comissão = 5.342,04.
    expect(texto(quadro)).toContain("R$ 5.342,04");
    expect(texto(quadro)).not.toContain("R$ 13.355,10");
  });

  it("as mensais NÃO são tocadas: a comissão sai do sinal", () => {
    expect(texto(tabelaGeralDePagamentos(CONDICOES, COMISSAO))).toContain("R$ 120.195,90");
  });

  it("⚠️ o total desce junto, e bate com o 6.1 PREÇO DO LOTE", () => {
    // 5.342,04 de entrada líquida + 120.195,90 de saldo = R$ 125.537,94, que é exatamente o
    // `preco_do_lote` que `dados-do-contrato` imprime no 6.1 (133.551,00 menos 8.013,06 de
    // corretagem). É a mesma coerência do contrato do Villa Paris, onde o rodapé do quadro
    // (R$ 222.270,00) é o 6.1 daquele contrato.
    const quadro = texto(tabelaGeralDePagamentos(CONDICOES, COMISSAO));
    expect(quadro).toContain("R$ 125.537,94");
    expect(quadro).not.toContain("R$ 217.772,10");
    expect(quadro).not.toContain("R$ 209.759,04");
  });

  it("divide a comissão entre as parcelas de entrada, sem perder centavo", () => {
    const tres = {
      ...CONDICOES,
      entrada: [
        { numero: 1, total: 3, valor: 5000, vencimento: "2026-09-18" },
        { numero: 2, total: 3, valor: 5000, vencimento: "2026-10-18" },
        { numero: 3, total: 3, valor: 3355.1, vencimento: "2026-11-18" },
      ],
    };
    const quadro = texto(tabelaGeralDePagamentos(tres, COMISSAO));
    // 13.355,10 - 8.013,06 = 5.342,04 repartidos na proporção 5000 / 5000 / 3355,10.
    expect(quadro).toContain("R$ 2.000,00");
    expect(quadro).toContain("R$ 1.342,04");
    expect(quadro).toContain("R$ 125.537,94");
  });

  it("sem comissão conhecida, o quadro fica como a proposta congelou", () => {
    const quadro = texto(tabelaGeralDePagamentos(CONDICOES, null));
    expect(quadro).toContain("R$ 13.355,10");
    expect(quadro).toContain("R$ 133.551,00");
  });

  it("comissão que engole a entrada inteira NÃO é abatida", () => {
    // Um quadro com entrada zerada esconde o defeito do cadastro atrás de um número plausível.
    const quadro = texto(tabelaGeralDePagamentos(CONDICOES, 1_400_000));
    expect(quadro).toContain("R$ 13.355,10");
  });
});
