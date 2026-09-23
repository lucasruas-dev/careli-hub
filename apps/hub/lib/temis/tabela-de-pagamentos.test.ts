import { describe, expect, it } from "vitest";

import { somarBensEPermutas } from "@/lib/hercules/bens-e-permutas";

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

// ── O BEM E A PERMUTA ENTRAM NO QUADRO ────────────────────────────────────────
//
// Lucas (22/09/2026), sobre o carro e o lote recebidos na aquisição: *"Abate, como uma entrada"*,
// *"Vários"* e, sobre onde isso aparece, *"Já no contrato também"*.
//
// ⚠️ SEM ISTO O QUADRO NÃO FECHA COM A CLÁUSULA 6.1 LOGO ACIMA. `montarCronograma` desconta o bem do
// saldo (`financiado = negociado − entrada − bens − anuais`), e o rodapé do quadro é a SOMA DAS
// LINHAS. Num lote de R$ 200.000 com permuta de R$ 80.000 as linhas dão 20.000 + 100.000 =
// R$ 120.000 embaixo de um 6.1 que promete R$ 200.000: é o mesmo defeito que voltou do jurídico em
// 22/09/2026 com a venda do VOL, e a correção é a mesma — a linha que falta entra no quadro.
const CONDICOES_COM_PERMUTA = {
  anuais: [],
  entrada: [{ numero: 1, total: 1, valor: 20_000, vencimento: "2026-10-10" }],
  mensais: [{ numero: 1, total: 100, valor: 1_000, vencimento: "2026-11-10" }],
  plano: {
    indiceCorrecao: "IPCA_ANUAL",
    jurosPeriodicidade: "mensal",
    jurosTaxa: 0.7207,
    nome: "NORMAL",
    parcelas: 100,
    sistemaAmortizacao: "sacoc",
  },
  totais: {
    anuais: 0,
    bensEPermutas: 80_000,
    entrada: 20_000,
    financiado: 100_000,
    geral: 200_000,
    mensais: 100_000,
  },
};

const CARRO = {
  descricao: "Ford Ka 2019 placa ABC1D23",
  entraComo: "abatimento",
  tipo: "permuta",
  valor: 80_000,
} as const;

const LOTE_EM_ANAPOLIS = {
  descricao: "lote 12 da quadra 4 em Anápolis",
  entraComo: "entrada",
  tipo: "bem",
  valor: 15_000,
} as const;

describe("o bem e a permuta no quadro de pagamento", () => {
  it("⚠️ vira linha própria, dizendo O QUE É e QUANTO VALE", () => {
    const saida = texto(tabelaGeralDePagamentos(CONDICOES_COM_PERMUTA, null, [CARRO]));

    expect(saida).toContain("Permuta");
    // A descrição é o que liga a linha ao bem de verdade: sem ela o quadro anuncia R$ 80.000 de
    // coisa nenhuma, e quem confere não tem como saber que carro é esse.
    expect(saida).toContain("Ford Ka 2019 placa ABC1D23");
    expect(saida).toContain("R$ 80.000,00");
  });

  it("⚠️ o total volta a fechar com o preço do lote", () => {
    const saida = texto(tabelaGeralDePagamentos(CONDICOES_COM_PERMUTA, null, [CARRO]));

    // 20.000 de entrada + 80.000 de permuta + 100.000 de saldo = R$ 200.000,00, que é o 6.1.
    expect(saida).toContain("R$ 200.000,00");
    // O rodapé de antes, que deixava a permuta de fora e desmentia a cláusula da página.
    expect(saida).not.toContain("R$ 120.000,00");
  });

  // Lucas, 22/09/2026, perguntado quantos bens cabem numa proposta: *"Vários"*.
  it("traz uma linha por item, e o total soma todas", () => {
    const saida = texto(
      tabelaGeralDePagamentos(
        {
          ...CONDICOES_COM_PERMUTA,
          totais: {
            ...CONDICOES_COM_PERMUTA.totais,
            bensEPermutas: 95_000,
            financiado: 85_000,
            geral: 200_000,
          },
        },
        null,
        [CARRO, LOTE_EM_ANAPOLIS],
      ),
    );

    expect(saida).toContain("Ford Ka 2019 placa ABC1D23");
    expect(saida).toContain("lote 12 da quadra 4 em Anápolis");
    expect(saida).toContain("R$ 15.000,00");
    // 20.000 + 80.000 + 15.000 + 85.000 = R$ 200.000,00.
    expect(saida).toContain("R$ 200.000,00");
  });

  // ⚠️ O QUE O QUADRO SOMA É O QUE A RÉGUA SOMA. Duas contas da mesma lista é como a tela e o papel
  // passam a anunciar financiados diferentes para a mesma venda (a lição dos reforços anuais). Este
  // teste amarra o rodapé do quadro a `somarBensEPermutas`, que é quem o cronograma usa.
  it("⚠️ as linhas do bem somam exatamente o que somarBensEPermutas soma", () => {
    const bens = [CARRO, LOTE_EM_ANAPOLIS, { ...CARRO, descricao: "moto", valor: 0 }];
    const soLinhasDoBem = tabelaGeralDePagamentos(
      { entrada: [], mensais: [], anuais: [], totais: {} },
      null,
      bens,
    );

    expect(texto(soLinhasDoBem)).toContain("R$ 95.000,00");
    expect(somarBensEPermutas(bens)).toBe(95_000);
  });

  // ⚠️ A LISTA CHEGA DE UM FORMULÁRIO QUE ESTÁ SENDO PREENCHIDO. Uma linha recém-adicionada tem
  // `valor` vazio; imprimi-la poria "R$ NaN" no contrato e o rodapé inteiro viraria NaN.
  it("item sem valor não vira linha", () => {
    const saida = texto(
      tabelaGeralDePagamentos(CONDICOES_COM_PERMUTA, null, [
        { ...CARRO, descricao: "Fiat Uno sem valor", valor: Number.NaN },
      ]),
    );

    expect(saida).not.toContain("Fiat Uno sem valor");
    expect(saida).not.toContain("NaN");
  });

  it("item sem descrição sai só com o que ele é", () => {
    const saida = texto(
      tabelaGeralDePagamentos(CONDICOES_COM_PERMUTA, null, [{ ...CARRO, descricao: "   " }]),
    );

    expect(saida).toContain("Permuta");
    expect(saida).toContain("R$ 80.000,00");
  });

  // ⚠️ A IMENSA MAIORIA DAS VENDAS NÃO TEM BEM NENHUM, e o quadro delas tem de sair IDÊNTICO ao de
  // hoje: sem linha vazia, sem célula a mais, sem espaço sobrando. É a trava desta mudança.
  it("⚠️ sem bem, o quadro é o MESMO de antes — nó a nó", () => {
    const comoHoje = tabelaGeralDePagamentos(CONDICOES, COMISSAO);

    expect(tabelaGeralDePagamentos(CONDICOES, COMISSAO, null)).toEqual(comoHoje);
    expect(tabelaGeralDePagamentos(CONDICOES, COMISSAO, [])).toEqual(comoHoje);
    expect(tabelaGeralDePagamentos(CONDICOES, COMISSAO, undefined)).toEqual(comoHoje);
    // E a lista só com item sem dinheiro também não muda nada.
    expect(
      tabelaGeralDePagamentos(CONDICOES, COMISSAO, [{ ...CARRO, valor: 0 }]),
    ).toEqual(comoHoje);
  });

  // ⚠️ O BEM VAI JUNTO DA ENTRADA, ANTES DAS SÉRIES. Ele é entregue na aquisição (Lucas: *"Abate,
  // como uma entrada"*), e um quadro que o pusesse depois das 156 mensais faria o comprador ler a
  // permuta como se fosse o último pagamento do contrato, em 2039.
  it("⚠️ a linha do bem fica entre a entrada e as parcelas", () => {
    const saida = texto(tabelaGeralDePagamentos(CONDICOES_COM_PERMUTA, null, [CARRO]));

    expect(saida.indexOf("Entrada")).toBeLessThan(saida.indexOf("Permuta"));
    expect(saida.indexOf("Permuta")).toBeLessThan(saida.indexOf("Mensal"));
  });

  // ⚠️ O BEM NÃO TEM VENCIMENTO, E O QUADRO NÃO INVENTA UM. Ele é entregue no ato; escrever ali a
  // data da entrada faria o contrato prometer a transferência do carro numa data que ninguém
  // combinou, e é data de contrato que o cartório confere.
  it("a linha do bem não anuncia vencimento nenhum", () => {
    const quadro = tabelaGeralDePagamentos(CONDICOES_COM_PERMUTA, null, [CARRO]);
    const linha = (quadro?.children ?? []).find((no) =>
      JSON.stringify(no).includes("Ford Ka"),
    );

    expect(JSON.stringify(linha)).not.toContain("10/10/2026");
    expect(JSON.stringify(linha)).not.toContain("10/11/2026");
  });
});

// ── A PERMUTA NA ENTRADA, SEM DINHEIRO NO ATO ────────────────────────────────
//
// ⚠️ O CASO QUE A PERMUTA ACABOU DE TORNAR COMUM. A régua nova da proposta aceita entrada em
// dinheiro ZERO quando o bem apontado na entrada cobre o piso de 10%
// (`centavos(entradaValor) + centavos(bensNaEntrada) >= centavos(piso)`, `proposta.ts`). Antes dela
// essa composição era impossível: sem parcela de entrada, a proposta não passava.
//
// ⚠️ E SEM PARCELA DE ENTRADA A COMISSÃO NÃO TINHA DE ONDE SAIR. `abaterDaEntrada` devolve `null`
// com `entrada.length === 0`, e o rodapé voltava a somar o negociado CHEIO: medido num lote de
// R$ 200.000 com comissão de R$ 12.000 e permuta de R$ 20.000 na entrada, o quadro fechava em
// R$ 200.000,00 embaixo de um `preco_do_lote` (6.1) de R$ 188.000,00 — na mesma página. É o mesmo
// defeito que voltou do jurídico com a venda do VOL em 22/09/2026.
const CONDICOES_SEM_DINHEIRO_NO_ATO = {
  anuais: [],
  entrada: [],
  mensais: [{ numero: 1, total: 180, valor: 1_000, vencimento: "2026-11-10" }],
  plano: {
    indiceCorrecao: "IPCA_ANUAL",
    jurosPeriodicidade: "mensal",
    jurosTaxa: 0.7207,
    nome: "NORMAL",
    parcelas: 180,
    sistemaAmortizacao: "sacoc",
  },
  totais: {
    anuais: 0,
    bensEPermutas: 20_000,
    entrada: 0,
    financiado: 180_000,
    geral: 200_000,
    mensais: 180_000,
  },
};

/** A permuta que faz as vezes da entrada: R$ 20.000 num lote de R$ 200.000, os 10% do piso. */
const CARRO_NA_ENTRADA = {
  descricao: "Ford Ka 2019 placa ABC1D23",
  entraComo: "entrada",
  tipo: "permuta",
  valor: 20_000,
} as const;

/** 6% de R$ 200.000 (2% da coordenadora + 4% da imobiliária) = R$ 12.000,00. */
const COMISSAO_DO_LOTE_DE_DUZENTOS = 1_200_000;

describe("sem parcela de entrada, a comissão ainda sai do quadro", () => {
  it("⚠️ o rodapé fecha com o 6.1 PREÇO DO LOTE, e não com o negociado cheio", () => {
    const saida = texto(
      tabelaGeralDePagamentos(CONDICOES_SEM_DINHEIRO_NO_ATO, COMISSAO_DO_LOTE_DE_DUZENTOS, [
        CARRO_NA_ENTRADA,
      ]),
    );

    // 20.000 de permuta + 180.000 de saldo - 12.000 de corretagem = R$ 188.000,00, que é o
    // `preco_do_lote` que `dados-do-contrato` imprime no 6.1 (200.000,00 menos 12.000,00).
    expect(saida).toContain("R$ 188.000,00");
    // O rodapé de antes, que desmentia a cláusula da mesma página.
    expect(saida).not.toContain("R$ 200.000,00");
  });

  // ⚠️ A PERMUTA MANTÉM O VALOR CHEIO. Abater a corretagem DENTRO da linha do bem faria o contrato
  // anunciar um Ford Ka de R$ 8.000 ao lado de uma cláusula que diz R$ 20.000 (`valor_bens_e_permutas`,
  // a mesma página) — trocaria uma contradição por outra, e esta cairia sobre a descrição de um bem
  // que o cartório confere.
  it("⚠️ o bem continua valendo o que vale, e a comissão vira linha própria", () => {
    const saida = texto(
      tabelaGeralDePagamentos(CONDICOES_SEM_DINHEIRO_NO_ATO, COMISSAO_DO_LOTE_DE_DUZENTOS, [
        CARRO_NA_ENTRADA,
      ]),
    );

    expect(saida).toContain("Ford Ka 2019 placa ABC1D23");
    expect(saida).toContain("R$ 20.000,00");
    expect(saida).toContain("Comissão de corretagem");
    expect(saida).toContain("-R$ 12.000,00");
    // E as mensais seguem intocadas: elas amortizam o preço do lote inteiras.
    expect(saida).toContain("R$ 180.000,00");
  });

  // ⚠️ A LINHA FICA JUNTO DO ATO, e não no fim do quadro. A corretagem é paga "em conformidade com o
  // fluxo financeiro das parcelas de SINAL/ATO" (item 7.1 do contrato de corretagem), que é
  // exatamente o que a entrada em dinheiro faz de forma invisível quando ela existe.
  it("a linha da comissão fica depois do bem e antes das mensais", () => {
    const saida = texto(
      tabelaGeralDePagamentos(CONDICOES_SEM_DINHEIRO_NO_ATO, COMISSAO_DO_LOTE_DE_DUZENTOS, [
        CARRO_NA_ENTRADA,
      ]),
    );

    expect(saida.indexOf("Permuta")).toBeLessThan(saida.indexOf("Comissão de corretagem"));
    expect(saida.indexOf("Comissão de corretagem")).toBeLessThan(saida.indexOf("Mensal"));
  });

  // ⚠️ COM ENTRADA EM DINHEIRO NADA MUDA: a comissão continua saindo por dentro das parcelas do ato,
  // sem linha nova. É a trava da correção — o quadro de toda venda de hoje sai nó a nó como saía.
  it("⚠️ com entrada em dinheiro, o quadro é o MESMO de antes — nó a nó", () => {
    const comoHoje = tabelaGeralDePagamentos(CONDICOES, COMISSAO);

    expect(texto(comoHoje)).not.toContain("Comissão de corretagem");
    expect(texto(comoHoje)).toContain("R$ 125.537,94");
    expect(tabelaGeralDePagamentos(CONDICOES, COMISSAO, [])).toEqual(comoHoje);
  });

  it("sem comissão conhecida, o quadro sem entrada fica como a proposta congelou", () => {
    const saida = texto(
      tabelaGeralDePagamentos(CONDICOES_SEM_DINHEIRO_NO_ATO, null, [CARRO_NA_ENTRADA]),
    );

    expect(saida).not.toContain("Comissão de corretagem");
    expect(saida).toContain("R$ 200.000,00");
  });

  // ⚠️ MESMA REGRA DA ENTRADA ENGOLIDA: comissão maior do que o quadro inteiro é defeito de
  // cadastro, e um rodapé negativo o esconderia atrás de um número plausível.
  it("comissão maior do que o quadro inteiro NÃO é abatida", () => {
    const saida = texto(
      tabelaGeralDePagamentos(CONDICOES_SEM_DINHEIRO_NO_ATO, 30_000_000, [CARRO_NA_ENTRADA]),
    );

    expect(saida).not.toContain("Comissão de corretagem");
    expect(saida).toContain("R$ 200.000,00");
  });
});

// ── A RÉGUA DO "VALE DINHEIRO" É UMA SÓ ──────────────────────────────────────
//
// ⚠️ MEDIDO EM 22/09/2026: a lista `[{ valor: "80000" }]` fazia o quadro imprimir
// `Total R$ 2.000.080.000.100.000,00` — o `reduce` do rodapé CONCATENAVA a string, porque a linha
// recebia `total: bem.valor` cru — enquanto `somarBensEPermutas` da mesma lista devolvia 0, e é ela
// que escreve `valor_bens_e_permutas`. Mesmo item, três números diferentes no mesmo papel.
//
// ⚠️ A CAUSA ERAM DUAS RÉGUAS: o filtro do quadro COAGIA (`Number(bem.valor) > 0`) e o de
// `bens-e-permutas.ts` exige número de verdade (`Number.isFinite(bem.valor)`). Hoje o alcance é
// baixo (a rota normaliza com `Number` antes de gravar), mas régua que diverge só espera o dia.
describe("o quadro e a régua do dinheiro contam a MESMA lista", () => {
  it("⚠️ valor em texto não vira linha, e o rodapé não concatena string", () => {
    const comTexto = [{ ...CARRO, valor: "80000" as unknown as number }];
    const saida = texto(tabelaGeralDePagamentos(CONDICOES_COM_PERMUTA, null, comTexto));

    expect(somarBensEPermutas(comTexto)).toBe(0);
    expect(saida).not.toContain("2.000.080.000.100.000");
    expect(saida).not.toContain("Ford Ka 2019 placa ABC1D23");
    // 20.000 de entrada + 100.000 de saldo: o que a régua soma é o que o quadro soma.
    expect(saida).toContain("R$ 120.000,00");
  });

  it("valor em texto também não conta para a régua da entrada mínima", () => {
    const comTexto = [{ ...CARRO, valor: "80000" as unknown as number }];
    const quadro = tabelaGeralDePagamentos(CONDICOES_COM_PERMUTA, null, comTexto);
    const semBem = tabelaGeralDePagamentos(CONDICOES_COM_PERMUTA, null, []);

    expect(quadro).toEqual(semBem);
  });
});
