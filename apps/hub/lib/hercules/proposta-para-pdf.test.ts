import { describe, expect, it } from "vitest";

import type { PlanoComercial } from "@/lib/apolo/planos-comerciais";

import { montarCronograma } from "./cronograma";
import { montarFolhaDaProposta, VALIDADE_DA_PROPOSTA_EM_DIAS } from "./proposta-para-pdf";

/** O plano mais comum da casa: SACOC, sem juros — 21 dos 24 empreendimentos são SACOC. */
const SACOC_SEM_JUROS: PlanoComercial = {
  entradaPercentual: 10,
  indiceCorrecao: "IPCA_ANUAL",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  jurosTaxa: null,
  nome: "NORMAL",
  parcelas: 120,
  sistemaAmortizacao: "sacoc",
  slot: "normal",
};

const SACOC_COM_JUROS: PlanoComercial = { ...SACOC_SEM_JUROS, jurosTaxa: 8 };

/** O caso que o Lucas ditou: lote de 100 mil, 10% de entrada em 2×, vencimento no dia 10. */
const CONDICOES = {
  anuaisQuantidade: 0,
  anuaisValor: 0,
  diaDeVencimento: 10,
  entradaValor: 10_000,
  entradaVezes: 2,
  parcelasMensais: 120,
  plano: SACOC_SEM_JUROS,
  primeiraParcelaDaEntrada: "2026-10-10",
  valorNegociado: 100_000,
};

const BASE = {
  atendimento: {
    coordenador: "Lucas Ruas",
    corretor: "Nívea Ferreira",
    imobiliaria: "Raiane Imobiliária",
    telefone: "(62) 98877-1234",
  },
  codigo: "000003",
  compradores: [
    { cpf: "52998224725", nome: "Maria Aparecida da Silva", participacao: 60 },
    { cpf: "14511477508", nome: "João Carlos da Silva", participacao: 40 },
  ],
  diaDeVencimento: 10,
  // 12h de propósito: a emissão é um INSTANTE, e o dia dela não pode depender do fuso da máquina.
  emitidaEmIso: "2026-09-04T12:00:00.000Z",
  empreendimento: "Garden",
  logoC2x: null,
  logoEmpreendimento: null,
  unidade: { area: 250, cidade: "Goiânia", nome: "Quadra 03 · Lote 07", uf: "GO" },
  valorNegociado: 100_000,
};

const folhaDoExemplo = () =>
  montarFolhaDaProposta({
    ...BASE,
    cronograma: montarCronograma(CONDICOES),
    plano: SACOC_SEM_JUROS,
  });

describe("montarFolhaDaProposta — o exemplo que o Lucas ditou", () => {
  it("a entrada vai datada, por extenso, e o total fecha com o negociado", () => {
    const folha = folhaDoExemplo();

    expect(folha.entrada).toEqual([
      { ordem: "1 de 2", valor: "R$ 5.000,00", vencimento: "10 de outubro de 2026" },
      { ordem: "2 de 2", valor: "R$ 5.000,00", vencimento: "10 de novembro de 2026" },
    ]);
    expect(folha.entradaTotal).toBe("R$ 10.000,00");
  });

  it("⚠️ a data por extenso NÃO desloca um dia (o defeito de fuso)", () => {
    // `new Date("2026-10-10")` é meia-noite UTC: formatado em Brasília, sai 09 de outubro. A folha
    // anunciaria uma data e o boleto sairia em outra.
    expect(folhaDoExemplo().entrada[0]?.vencimento).toBe("10 de outubro de 2026");
    expect(folhaDoExemplo().emitidaEm).toBe("04/09/2026");
  });

  it("os destaques trazem preço por m², % da entrada e a primeira mensal", () => {
    const destaques = folhaDoExemplo().destaques;

    expect(destaques.map((d) => d.rotulo)).toEqual([
      "Valor da unidade",
      "Entrada",
      "Financiado",
      "Parcela mensal",
    ]);
    expect(destaques[0]?.detalhe).toBe("R$ 400,00 por m²");
    expect(destaques[1]?.detalhe).toBe("10% · 2× de R$ 5.000,00");
    expect(destaques[3]).toEqual({
      detalhe: "1ª em 10/12/2026",
      rotulo: "Parcela mensal",
      valor: "R$ 750,00",
    });
  });

  it("a validade sai escrita, sete dias depois da emissão", () => {
    const folha = folhaDoExemplo();
    const sobreAProposta = folha.observacoes.find((o) => o.titulo === "Sobre esta proposta.");

    expect(VALIDADE_DA_PROPOSTA_EM_DIAS).toBe(7);
    expect(sobreAProposta?.texto).toContain("valem até 11/09/2026");
  });

  it("o subtítulo junta produto, área e cidade", () => {
    expect(folhaDoExemplo().subtitulo).toBe("Garden · 250,00 m² · Goiânia, GO");
  });

  it("a última parcela é a do fim do contrato, e não a da entrada", () => {
    const condicoes = folhaDoExemplo().condicoes;
    const rotulo = (nome: string) => condicoes.find((c) => c.rotulo === nome)?.valor;

    expect(rotulo("Primeira parcela")).toBe("10/10/2026");
    expect(rotulo("Última parcela")).toBe("10/11/2036");
    expect(rotulo("Vencimento")).toBe("todo dia 10");
    expect(rotulo("Parcelas mensais")).toBe("120");
  });
});

describe("⚠️ o que a folha promete tem que ser o que o contrato cumpre", () => {
  it("plano SEM juros e SEM correção não ganha a observação de reajuste", () => {
    const plano: PlanoComercial = { ...SACOC_SEM_JUROS, indiceCorrecao: "SEM_CORRECAO" };
    const folha = montarFolhaDaProposta({
      ...BASE,
      cronograma: montarCronograma({ ...CONDICOES, plano }),
      plano,
    });

    // Prometer reajuste anual num contrato que não tem seria assustar o comprador com um aumento
    // que ele nunca vai receber.
    expect(folha.observacoes.map((o) => o.titulo)).toEqual(["Sobre esta proposta."]);
    expect(folha.condicoes.find((c) => c.rotulo === "Correção")?.valor).toBe("sem correção");
    expect(folha.condicoes.find((c) => c.rotulo === "Juros")?.valor).toBe("sem juros");
  });

  it("SACOC com juros abre uma faixa por ano, e só a partir da segunda tem IPCA", () => {
    const folha = montarFolhaDaProposta({
      ...BASE,
      cronograma: montarCronograma({ ...CONDICOES, plano: SACOC_COM_JUROS }),
      plano: SACOC_COM_JUROS,
    });

    expect(folha.reajustes).toHaveLength(10);
    expect(folha.reajustes[0]?.periodo).toBe("1º ano");
    expect(folha.reajustes[0]?.parcelas).toBe("1 a 12");
    // ⚠️ O primeiro ciclo começa hoje, com o valor de hoje: marcar "+ IPCA" nele seria corrigir
    // duas vezes o mesmo ano.
    expect(folha.reajustes[0]?.temIpca).toBe(false);
    expect(folha.reajustes[1]?.temIpca).toBe(true);
    expect(folha.observacoes[0]?.texto).toContain("8% a.a.");
    expect(folha.observacoes[0]?.texto).toContain("IPCA anual");
  });

  it("⚠️ entrada com resto de divisão diz qual parcela é a diferente", () => {
    const folha = montarFolhaDaProposta({
      ...BASE,
      cronograma: montarCronograma({ ...CONDICOES, entradaVezes: 3 }),
      plano: SACOC_SEM_JUROS,
    });

    // 3.333,33 × 3 daria 9.999,99: o resto vai na primeira, e a folha não pode anunciar o valor
    // errado como se as três fossem iguais.
    expect(folha.destaques[1]?.detalhe).toBe("10% · 3×, a 1ª de R$ 3.333,34");
    expect(folha.entradaTotal).toBe("R$ 10.000,00");
  });

  it("com parcelas anuais, a seção e a condição aparecem; sem elas, somem", () => {
    const comAnuais = montarFolhaDaProposta({
      ...BASE,
      cronograma: montarCronograma({
        ...CONDICOES,
        anuaisQuantidade: 10,
        anuaisValor: 2_000,
      }),
      plano: SACOC_SEM_JUROS,
    });

    expect(comAnuais.anuais).toHaveLength(10);
    expect(comAnuais.anuaisTotal).toBe("R$ 20.000,00");
    expect(comAnuais.condicoes.find((c) => c.rotulo === "Parcelas anuais")?.valor).toBe(
      "10 de R$ 2.000,00",
    );
    expect(comAnuais.destaques[2]?.detalhe).toBe("120 mensais + 10 anuais");

    const semAnuais = folhaDoExemplo();
    expect(semAnuais.anuais).toEqual([]);
    expect(semAnuais.anuaisTotal).toBe("");
    expect(semAnuais.condicoes.some((c) => c.rotulo === "Parcelas anuais")).toBe(false);
  });

  it("venda à vista (sem série mensal) não imprime um card de parcela zerada", () => {
    const folha = montarFolhaDaProposta({
      ...BASE,
      cronograma: montarCronograma({
        ...CONDICOES,
        entradaValor: 100_000,
        entradaVezes: 1,
        parcelasMensais: 0,
      }),
      plano: SACOC_SEM_JUROS,
    });

    expect(folha.destaques.some((d) => d.rotulo === "Parcela mensal")).toBe(false);
    expect(folha.destaques[1]?.detalhe).toBe("100% · à vista, R$ 100.000,00");
    expect(folha.condicoes.find((c) => c.rotulo === "Primeira parcela")?.valor).toBe("10/10/2026");
  });

  it("a participação de cada comprador vai em % e o CPF sai formatado", () => {
    expect(folhaDoExemplo().compradores).toEqual([
      { documento: "529.982.247-25", nome: "Maria Aparecida da Silva", participacao: "60%" },
      { documento: "145.114.775-08", nome: "João Carlos da Silva", participacao: "40%" },
    ]);
  });

  it("participação quebrada não vira dízima no papel", () => {
    const folha = montarFolhaDaProposta({
      ...BASE,
      compradores: [
        { cpf: "52998224725", nome: "A", participacao: 33.33 },
        { cpf: "14511477508", nome: "B", participacao: 66.67 },
      ],
      cronograma: montarCronograma(CONDICOES),
      plano: SACOC_SEM_JUROS,
    });

    expect(folha.compradores.map((c) => c.participacao)).toEqual(["33,33%", "66,67%"]);
  });

  it("unidade sem área não inventa preço por m² nem entra no subtítulo", () => {
    const folha = montarFolhaDaProposta({
      ...BASE,
      cronograma: montarCronograma(CONDICOES),
      plano: SACOC_SEM_JUROS,
      unidade: { ...BASE.unidade, area: null },
    });

    expect(folha.destaques[0]?.detalhe).toBe("");
    expect(folha.subtitulo).toBe("Garden · Goiânia, GO");
  });
});
