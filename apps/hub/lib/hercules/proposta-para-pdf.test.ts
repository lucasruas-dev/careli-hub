import { describe, expect, it } from "vitest";

import type { PlanoComercial } from "@/lib/apolo/planos-comerciais";

import { montarCronograma } from "./cronograma";
import { montarFolhaDaProposta } from "./proposta-para-pdf";
import { vencimentoEmDias } from "./reserva";

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
  // A validade GRAVADA com a proposta: sete dias contados na geração, terminando no fim do dia 11
  // em Brasília. Ela chega pronta na folha — o papel não a recalcula.
  validadeEmIso: vencimentoEmDias("2026-09-04T12:00:00.000Z", 7),
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

  it("a validade sai escrita, e é a que foi gravada com a proposta", () => {
    const sobreAProposta = folhaDoExemplo().observacoes.find(
      (o) => o.titulo === "Sobre esta proposta.",
    );

    // A validade gravada termina em 11/09 às 23:59:59 de Brasília (02:59:59Z do dia 12): lida em
    // UTC, o papel anunciaria 12/09 — um dia a mais de preço garantido.
    expect(sobreAProposta?.texto).toContain("valem até 11/09/2026");
  });

  it("⚠️ reimpressa em dezembro, a folha repete a data PROMETIDA — não conta de novo", () => {
    // Era o defeito: a validade saía de "emissão + 7 dias", calculada na hora de imprimir. Uma
    // segunda via tirada em dezembro dizia valer até dezembro, e o papel do cliente deixava de bater
    // com o que o corretor combinou em setembro. A data é parte da promessa, e promessa não se
    // recalcula.
    const reimpressa = montarFolhaDaProposta({
      ...BASE,
      cronograma: montarCronograma(CONDICOES),
      emitidaEmIso: "2026-12-20T12:00:00.000Z",
      plano: SACOC_SEM_JUROS,
    });
    const sobreAProposta = reimpressa.observacoes.find((o) => o.titulo === "Sobre esta proposta.");

    expect(sobreAProposta?.texto).toContain("valem até 11/09/2026");
    expect(sobreAProposta?.texto).not.toContain("dezembro");
    expect(sobreAProposta?.texto).not.toContain("/12/2026");
  });

  it("⚠️ proposta SEM validade gravada não inventa data, e a ressalva continua de pé", () => {
    // As 4.857 importadas do C2X têm `validade_em` nula: o legado não guarda prazo de proposta.
    // Imprimir "valem até " com o espaço vazio seria pior do que não prometer prazo nenhum.
    const semPrazo = montarFolhaDaProposta({
      ...BASE,
      cronograma: montarCronograma(CONDICOES),
      plano: SACOC_SEM_JUROS,
      validadeEmIso: null,
    });
    const sobreAProposta = semPrazo.observacoes.find((o) => o.titulo === "Sobre esta proposta.");

    expect(sobreAProposta?.texto).not.toContain("valem até");
    expect(sobreAProposta?.texto).toContain("aprovação de crédito");
  });

  it("o subtítulo junta produto, área e cidade", () => {
    expect(folhaDoExemplo().subtitulo).toBe("Garden · 250,00 m² · Goiânia, GO");
    // O loteamento não ganha o tipo na folha: a folha antiga sai idêntica.
    expect(folhaDoExemplo()).not.toHaveProperty("tipoProduto");
  });

  it("⚠️ no prédio a área é privativa, e o tipo segue para a tarja dizer 'a unidade'", () => {
    const folha = montarFolhaDaProposta({
      ...BASE,
      cronograma: montarCronograma(CONDICOES),
      empreendimento: "Ed. Jade",
      plano: SACOC_SEM_JUROS,
      tipoProduto: "vertical",
      unidade: { area: 68.45, cidade: "Ipatinga", nome: "Torre A · Apto 304", uf: "MG" },
    });
    expect(folha.subtitulo).toBe("Ed. Jade · 68,45 m² privativos · Ipatinga, MG");
    expect(folha.tipoProduto).toBe("vertical");
    expect(folha.unidade).toBe("Torre A · Apto 304");
  });

  it("a última parcela é a do fim do contrato, e não a da entrada", () => {
    const condicoes = folhaDoExemplo().condicoes;
    const rotulo = (nome: string) => condicoes.find((c) => c.rotulo === nome)?.valor;

    // ⚠️ No quadro do financiamento a primeira é a MENSAL (a entrada de 2× vence em 10/10 e
    // 10/11). Antes daqui saía 10/10, a data da entrada, e o papel parecia dizer que o
    // financiamento começava junto com ela.
    expect(rotulo("Primeira parcela")).toBeUndefined();
    expect(rotulo("Primeira mensal")).toBe("10/12/2026");
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
      // ⚠️ PRECISA PEDIR A TABELA para a observação existir (13/09/2026): a seção do reajuste virou
      // opcional e nasce desmarcada, e a observação segue a tabela — ela diz "os valores da tabela
      // acima" e ficaria órfã sem ela.
      incluirReajuste: true,
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

  it("⚠️ sem pedir, a tabela de reajuste NÃO leva a observação junto", () => {
    // O padrão novo (Lucas, 13/09/2026): a caixa nasce desmarcada, então a PA sai SEM a seção.
    const folha = montarFolhaDaProposta({
      ...BASE,
      cronograma: montarCronograma({ ...CONDICOES, plano: SACOC_COM_JUROS }),
      plano: SACOC_COM_JUROS,
    });

    // ⚠️ OS DADOS CONTINUAM NA FOLHA: quem decide imprimir é o desenhista, não o montador. A tela
    // usa as mesmas faixas para o painel que já existe, e ele não depende desta escolha.
    expect(folha.reajustes).toHaveLength(10);
    expect(folha.incluirReajuste).toBe(false);
    // A observação, essa some — ela aponta para uma tabela que não vai ser impressa.
    expect(folha.observacoes.some((o) => o.titulo === "Sobre o reajuste.")).toBe(false);
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
    // ⚠️ A LEGENDA DIZ O QUE O NÚMERO É (18/09/2026): o "Financiado" é o saldo das mensais, e as
    // anuais já saíram dele. "120 mensais + 10 anuais" dizia o contrário, e quem somava o papel
    // (entrada + financiado + anuais) achava mais do que o valor da unidade.
    expect(comAnuais.destaques[2]?.detalhe).toBe("120 mensais, fora as 10 anuais");
    // E o papel fecha: entrada + anuais + financiado = valor negociado, ao centavo.
    expect(comAnuais.destaques[2]?.valor).toBe("R$ 70.000,00");

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

describe("⚠️ o plano que NÃO reajusta não pode prometer reajuste", () => {
  /** O PLANO INVESTIDOR como está cadastrado: 36 parcelas, sem juros e sem índice. */
  const INVESTIDOR: PlanoComercial = {
    ...SACOC_SEM_JUROS,
    indiceCorrecao: "SEM_CORRECAO",
    jurosTaxa: null,
    nome: "INVESTIDOR",
    parcelas: 36,
  };

  const folhaDoInvestidor = () =>
    montarFolhaDaProposta({
      ...BASE,
      cronograma: montarCronograma({
        ...CONDICOES,
        entradaValor: 60_000,
        parcelasMensais: 36,
        plano: INVESTIDOR,
        valorNegociado: 200_000,
      }),
      plano: INVESTIDOR,
      valorNegociado: 200_000,
    });

  it("declara que não há reajuste, para o PDF não imprimir a seção como se houvesse", () => {
    // Sem esta distinção a folha saía com o título "Reajuste da parcela" e a frase "os reajustes
    // seguintes seguem a mesma regra, sempre no aniversário" num contrato de parcela fixa —
    // prometendo ao comprador um aumento que ele não tem, no papel que circula por WhatsApp.
    expect(folhaDoInvestidor().temReajuste).toBe(false);
  });

  it("não abre a observação sobre reajuste", () => {
    const titulos = folhaDoInvestidor().observacoes.map((o) => o.titulo);
    expect(titulos).not.toContain("Sobre o reajuste.");
  });

  it("⚠️ faixa única não se chama '1º ano': ela cobre o contrato inteiro", () => {
    // "1º ano | 1 a 36" é um primeiro ano de três anos, e deixava o leitor procurando os anos
    // seguintes que a tabela não tem.
    const faixas = folhaDoInvestidor().reajustes;
    expect(faixas).toHaveLength(1);
    expect(faixas[0]?.periodo).toBe("Todo o contrato");
    expect(faixas[0]?.parcelas).toBe("1 a 36");
  });

  it("o plano COM degrau continua dizendo que reajusta, e numera os anos", () => {
    const folha = montarFolhaDaProposta({
      ...BASE,
      cronograma: montarCronograma({ ...CONDICOES, plano: SACOC_COM_JUROS }),
      plano: SACOC_COM_JUROS,
    });
    expect(folha.temReajuste).toBe(true);
    expect(folha.reajustes.length).toBeGreaterThan(1);
    expect(folha.reajustes[0]?.periodo).toBe("1º ano");
  });
});

// ── A TABELA E O DESCONTO DO PLANO NO PAPEL (18/09/2026) ─────────────────────
//
// Lucas: "tem que ser igual o mmendes". O Investidor Parcelado do Garden vende a 92% da tabela; a
// rota manda o preço de tabela só quando o plano tem desconto, e a folha diz de onde veio o valor.
describe("montarFolhaDaProposta com o desconto do plano", () => {
  const investidorParcelado: PlanoComercial = {
    ...SACOC_COM_JUROS,
    entradaPercentual: 8,
    jurosTaxa: 6,
    nome: "INVESTIDOR PARCELADO",
    parcelas: 84,
    slot: null,
  };
  const doGarden = () =>
    montarFolhaDaProposta({
      ...BASE,
      cronograma: montarCronograma({
        ...CONDICOES,
        anuaisQuantidade: 4,
        anuaisValor: 25_000,
        entradaValor: 32_016,
        entradaVezes: 1,
        parcelasMensais: 84,
        plano: investidorParcelado,
        valorNegociado: 400_200,
      }),
      plano: investidorParcelado,
      precoDeTabela: 435_000,
      valorNegociado: 400_200,
    });

  it("mostra a tabela, o desconto e as anuais", () => {
    const valor = (rotulo: string) => doGarden().condicoes.find((c) => c.rotulo === rotulo)?.valor;
    expect(valor("Valor de tabela")).toBe("R$ 435.000,00");
    expect(valor("Desconto")).toBe("8% · R$ 34.800,00");
    expect(valor("Parcelas anuais")).toBe("4 de R$ 25.000,00");
    expect(doGarden().destaques[0]?.valor).toBe("R$ 400.200,00");
    expect(JSON.stringify(doGarden().condicoes)).not.toContain("—");
  });

  it("⚠️ sem o preço de tabela (todo plano sem desconto), a folha sai como saía", () => {
    const antes = folhaDoExemplo().condicoes;
    expect(antes[0]?.rotulo).toBe("Parcelas mensais");
    expect(antes.some((c) => c.rotulo === "Valor de tabela" || c.rotulo === "Desconto")).toBe(false);

    // Tabela informada mas sem desconto (negociado igual ou acima): nada muda também.
    const semDesconto = montarFolhaDaProposta({
      ...BASE,
      cronograma: montarCronograma(CONDICOES),
      plano: SACOC_SEM_JUROS,
      precoDeTabela: 100_000,
    });
    expect(semDesconto.condicoes).toEqual(antes);
  });
});

// ── BENS E PERMUTAS (22/09/2026) ────────────────────────────────────────────
//
// Lucas, em resposta direta: a permuta *"Abate, como uma entrada"*; cabem *"Vários"* numa
// proposta; e contar para a entrada mínima de 10% *"pode ser um ou outro, pode apontar na entrada
// ou somente no valor negociado"* — por isso `entraComo` é campo de CADA item, e não uma regra
// fixa do empreendimento.
describe("montarFolhaDaProposta com bens e permutas", () => {
  const comPermuta = () =>
    montarFolhaDaProposta({
      ...BASE,
      bensEPermutas: [
        {
          descricao: "Ford Ka 2019 placa ABC1D23",
          entraComo: "entrada",
          tipo: "bem",
          valor: 30_000,
        },
        {
          descricao: "lote 12 da quadra 4 em Anápolis",
          entraComo: "abatimento",
          tipo: "permuta",
          valor: 50_000,
        },
      ],
      cronograma: montarCronograma(CONDICOES),
      plano: SACOC_SEM_JUROS,
    });

  it("cada item vira uma linha do papel, com tipo, como entra, valor e descrição", () => {
    expect(comPermuta().bensEPermutas).toEqual([
      {
        comoEntra: "Entrada",
        descricao: "Ford Ka 2019 placa ABC1D23",
        tipo: "Bem",
        valor: "R$ 30.000,00",
      },
      {
        comoEntra: "Abatimento",
        descricao: "lote 12 da quadra 4 em Anápolis",
        tipo: "Permuta",
        valor: "R$ 50.000,00",
      },
    ]);
  });

  it("⚠️ o total soma os DOIS, porque os dois abatem o que falta pagar", () => {
    // A diferença entre "entrada" e "abatimento" é se o item cumpre a entrada mínima — não se ele
    // abate. Somar só os de entrada esconderia R$ 50.000 que o comprador já entregou.
    expect(comPermuta().bensEPermutasTotal).toBe("R$ 80.000,00");
  });

  it("⚠️ sem bem nem permuta, a lista é vazia e o total não existe", () => {
    // O PDF só desenha a seção quando a lista tem item; um total "R$ 0,00" aqui viraria uma seção
    // zerada no papel da maioria das propostas.
    expect(folhaDoExemplo().bensEPermutas).toEqual([]);
    expect(folhaDoExemplo().bensEPermutasTotal).toBe("");
  });

  it("⚠️ linha do formulário ainda em branco NÃO vira 'R$ 0,00' no papel", () => {
    // A PRÉVIA é gerada do formulário VIVO (o botão que o Lucas pediu em 05/09), e uma linha
    // recém-adicionada tem o valor vazio: `Number("")` é NaN, e `reais(NaN)` escreve "R$ 0,00".
    // O papel sai no WhatsApp do cliente com um bem de zero real listado como recebido.
    // A mesma régua de `somarBensEPermutas` (`bens-e-permutas.ts`): só valor positivo é dinheiro.
    const folha = montarFolhaDaProposta({
      ...BASE,
      bensEPermutas: [
        { descricao: "Ford Ka 2019 placa ABC1D23", entraComo: "entrada", tipo: "bem", valor: 30_000 },
        { descricao: "", entraComo: "abatimento", tipo: "bem", valor: Number("") },
        { descricao: "moto sem valor combinado", entraComo: "abatimento", tipo: "bem", valor: 0 },
      ],
      cronograma: montarCronograma(CONDICOES),
      plano: SACOC_SEM_JUROS,
    });

    expect(folha.bensEPermutas).toHaveLength(1);
    expect(folha.bensEPermutas?.[0]?.descricao).toBe("Ford Ka 2019 placa ABC1D23");
    expect(folha.bensEPermutasTotal).toBe("R$ 30.000,00");
  });

  it("⚠️ se NENHUM item tem valor ainda, a seção inteira some do papel", () => {
    // Senão a prévia de um formulário pela metade sai com um quadro "Bens e permutas recebidos"
    // vazio, e o comprador lê que entregou alguma coisa que ninguém sabe o que é.
    const folha = montarFolhaDaProposta({
      ...BASE,
      bensEPermutas: [{ descricao: "", entraComo: "entrada", tipo: "bem", valor: Number("") }],
      cronograma: montarCronograma(CONDICOES),
      plano: SACOC_SEM_JUROS,
    });

    expect(folha.bensEPermutas).toEqual([]);
    expect(folha.bensEPermutasTotal).toBe("");
  });

  it("a ordem em que o operador cadastrou é a ordem do papel", () => {
    expect(comPermuta().bensEPermutas?.map((b) => b.tipo)).toEqual(["Bem", "Permuta"]);
  });
});
