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

describe("tabelaGeralDePagamentos", () => {
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
    expect(saida).toContain("Mensais");
    expect(saida).toContain("156");
    expect(saida).toContain("10/10/2026");
    expect(saida).toContain("R$ 770,49");
    expect(saida).toContain("IPCA anual");
    expect(saida).toContain("0,7207% a.m.");
    expect(saida).toContain("R$ 204.417,00");

    // O total geral fecha o quadro.
    expect(saida).toContain("R$ 217.772,10");
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
    expect(texto(tabelaGeralDePagamentos(CONDICOES))).not.toContain("Anuais");
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
    expect(saida).toContain("Anuais");
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
