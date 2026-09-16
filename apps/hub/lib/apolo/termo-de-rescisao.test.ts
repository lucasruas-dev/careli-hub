import { describe, expect, it } from "vitest";

import {
  montarExtratoDoContrato,
  TIPO_ATO,
  TIPO_AVULSO,
  TIPO_MENSAL,
  type ExtratoClienteContrato,
  type ExtratoClienteParcelaBruta,
} from "./extrato-cliente";
import { deducaoDe } from "./rescisao";
import {
  clienteDoContrato,
  comissaoDoContratoDeCorretagem,
  montarDadosDaRescisao,
  motivoParaNaoEmitirTermo,
  parcelasVencidasDoExtrato,
  percentualDaComissaoSobreATabela,
  planoEscrito,
  type EntradaDoTermo,
} from "./termo-de-rescisao";

// O TERMO DE RESCISÃO, DO EXTRATO PARA O PAPEL — a montagem que escolhe a fonte de cada número.
//
// ⚠️ A CONTA NÃO É TESTADA AQUI, e de propósito: `rescisao.test.ts` tem o caso real conferido linha a
// linha. O que este arquivo trava é o que só ele decide — de onde sai o total pago, qual valor das
// vencidas entra, quando o termo NÃO sai e o que vira nulo. São exatamente as portas por onde as seis
// armadilhas do C2X que o extrato desarmou voltariam.
//
// ⚠️ NENHUM DADO DE CLIENTE REAL. Os nomes e documentos abaixo são inventados; os números do contrato
// de corretagem imitam a REDAÇÃO do texto real, não os valores de ninguém.

const HOJE = "2026-09-16";

function parcela(
  sobre: Partial<ExtratoClienteParcelaBruta> & { id: number },
): ExtratoClienteParcelaBruta {
  return {
    aExcluir: false,
    boletoUrl: null,
    competencia: null,
    descricao: null,
    faturaUrl: null,
    juros: 0,
    multa: 0,
    pagamento: null,
    parcelaAtual: null,
    parcelaTotal: null,
    sinalAtual: null,
    sinalTotal: null,
    statusId: 6,
    tipo: "Parcela",
    tipoId: TIPO_MENSAL,
    valorInicial: 0,
    valorPago: 0,
    vencimento: null,
    ...sobre,
  };
}

/** Uma mensal de 120, com vencimento no dia 10 a partir de jan/2025. */
function mensal(
  n: number,
  valor: number,
  sobre: Partial<ExtratoClienteParcelaBruta> = {},
): ExtratoClienteParcelaBruta {
  const mes = ((n - 1) % 12) + 1;
  const ano = 2025 + Math.floor((n - 1) / 12);
  const mm = String(mes).padStart(2, "0");

  return parcela({
    competencia: `${ano}-${mm}-01`,
    id: 1000 + n,
    parcelaAtual: n,
    parcelaTotal: 120,
    valorInicial: valor,
    vencimento: `${ano}-${mm}-10`,
    ...sobre,
  });
}

const BOLETO = { boletoUrl: "https://asaas.test/boleto" };

const CONTRATO: ExtratoClienteContrato = {
  area: 360,
  codigo: "TST0101",
  dataAssinatura: null,
  dataAto: "2024-12-10",
  empreendimentoCodigo: "TST",
  empreendimentoNome: "LOTEAMENTO DE TESTE",
  encerrado: false,
  estagio: 4,
  estagioNome: "Faturado",
  id: 900001,
  indiceCorrecao: "IPCA ANUAL",
  jurosContratuais: null,
  lote: "01",
  planoPadraoParcelas: 144,
  planoParcelas: 120,
  planoPersonalizado: false,
  precoTabela: 100000,
  quadra: "01",
  titulares: [
    { documentoMascarado: "***.111.222-**", nome: "FULANO DE TESTE", ordem: 1, percentual: null },
  ],
};

/**
 * Um contrato com as armadilhas dentro:
 *   • o Ato pago;
 *   • as mensais 1 a 8 pagas, a 500,00 (reajuste cobrado no boleto; o contrato diz 480,00);
 *   • a 9 VENCIDA COM boleto (500,00) e a 10 VENCIDA SEM boleto (480,00, o valor cru — defasada);
 *   • a 11 VENCIDA com `paid_value` pré-preenchido pelo Asaas e SEM data de pagamento (fantasma);
 *   • um Avulso de acordo vencido (150,00), que é dívida real;
 *   • a 22 em diante a vencer.
 */
function parcelasDoCaso(): ExtratoClienteParcelaBruta[] {
  const lista: ExtratoClienteParcelaBruta[] = [
    parcela({
      id: 1,
      pagamento: "2024-12-10",
      parcelaTotal: 120,
      statusId: 5,
      tipo: "Ato",
      tipoId: TIPO_ATO,
      valorInicial: 3000,
      valorPago: 3000,
      vencimento: "2024-12-10",
    }),
  ];

  for (let n = 1; n <= 8; n += 1) {
    const base = mensal(n, 500, BOLETO);
    lista.push({ ...base, pagamento: base.vencimento, statusId: 5, valorPago: 500 });
  }

  lista.push(mensal(9, 500, { ...BOLETO, statusId: 7 }));
  lista.push(mensal(10, 480, { statusId: 7 }));
  // ⚠️ O FANTASMA: `paid_value` preenchido, sem `payment_date`, status 7. Não é pagamento.
  lista.push(mensal(11, 500, { ...BOLETO, statusId: 7, valorPago: 500 }));
  lista.push(
    parcela({
      descricao: "ACORDO - PARCELAS EM ATRASO",
      id: 5000,
      parcelaTotal: 1,
      statusId: 7,
      tipo: "Avulso",
      tipoId: TIPO_AVULSO,
      valorInicial: 150,
      vencimento: "2026-08-01",
    }),
  );

  // A vencer: da 22 à 30 (out/2026 em diante). A 12 à 21 já foram renegociadas no acordo acima e
  // não existem mais como linha — o que importa aqui é que as futuras estejam DEPOIS de hoje.
  for (let n = 22; n <= 30; n += 1) lista.push(mensal(n, 480));

  return lista;
}

function relatorioDoCaso(contrato: Partial<ExtratoClienteContrato> = {}) {
  return montarExtratoDoContrato({
    contrato: { ...CONTRATO, ...contrato },
    hoje: HOJE,
    parcelas: parcelasDoCaso(),
  });
}

function entrada(sobre: Partial<EntradaDoTermo> = {}): EntradaDoTermo {
  return {
    cidade: "Cidade de Teste",
    cliente: { documentoMascarado: "***.111.222-**", nome: "FULANO DE TESTE" },
    comissaoEmReais: null,
    dataDaPosse: null,
    emitidoEm: HOJE,
    premissas: {},
    relatorio: relatorioDoCaso(),
    uf: "MG",
    ...sobre,
  };
}

function montado(sobre: Partial<EntradaDoTermo> = {}) {
  const resultado = montarDadosDaRescisao(entrada(sobre));
  if (!resultado.ok) throw new Error(`esperava montar, veio: ${resultado.error}`);
  return resultado.dados;
}

/** A frase do contrato de corretagem, na redação do C2X, em HTML com entidades. */
function contratoDeCorretagem(total: string, coordenadora: string, associados: string): string {
  return (
    `<p>O valor de <strong>R$ ${total}</strong> (QUATRO MIL SETECENTOS E CINCO REAIS) refere-se ` +
    `&agrave; intermedia&ccedil;&atilde;o imobili&aacute;ria, sendo que a quantia R$ ${coordenadora} ` +
    `(UM MIL REAIS) ser&aacute; destinada ao pagamento da COORDENADORA DE VENDAS e R$ ${associados} ` +
    `destinada aos ASSOCIADOS, valores devidos com a celebra&ccedil;&atilde;o do compromisso.</p>`
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("quando o termo NÃO sai, a frase diz por quê", () => {
  // ⚠️ BOTÃO APAGADO SEM MENSAGEM É DEFEITO. A tela lê esta mesma função, então cada recusa aqui é
  // uma frase que o operador vai ler — e ela tem de nomear a causa.
  it("contrato cancelado", () => {
    const motivo = motivoParaNaoEmitirTermo(relatorioDoCaso({ encerrado: true, estagio: 7 }));
    expect(motivo).toBe("O termo de rescisão só sai para contrato em curso, e este está cancelado.");
  });

  it("contrato em distrato", () => {
    const motivo = motivoParaNaoEmitirTermo(relatorioDoCaso({ encerrado: true, estagio: 10 }));
    expect(motivo).toContain("este está em distrato");
  });

  // ⚠️ O EXTRATO ZERA AS ABERTAS DE CONTRATO ENCERRADO. Sem a recusa, o papel sairia com "Parcelas
  // vencidas em aberto: R$ 0,00" de um contrato que tem atraso no C2X.
  it("e a recusa do encerrado protege a linha das vencidas, que o extrato esvaziou", () => {
    const relatorio = relatorioDoCaso({ encerrado: true, estagio: 11 });
    expect(relatorio.abertas).toHaveLength(0);
    expect(montarDadosDaRescisao(entrada({ relatorio })).ok).toBe(false);
  });

  it("unidade sem valor de tabela", () => {
    const motivo = motivoParaNaoEmitirTermo(relatorioDoCaso({ precoTabela: null }));
    expect(motivo).toBe(
      "A unidade TST0101 está sem valor de tabela no C2X, e sem ele a multa penal e a publicidade do termo sairiam zeradas.",
    );
  });

  // ⚠️ R$ 1,00 É O MARCADOR DE LOTE SEM PREÇO no C2X, e não um preço. Multa de R$ 0,10 é a mesma
  // mentira que a de R$ 0,00.
  it("e o preço de marcador (R$ 1,00) conta como sem valor", () => {
    expect(motivoParaNaoEmitirTermo(relatorioDoCaso({ precoTabela: 1 }))).toContain("sem valor de tabela");
    expect(motivoParaNaoEmitirTermo(relatorioDoCaso({ precoTabela: 0 }))).toContain("sem valor de tabela");
  });

  it("contrato em curso e com preço: sai, sem motivo", () => {
    expect(motivoParaNaoEmitirTermo(relatorioDoCaso())).toBeNull();
  });

  it("a montagem devolve a MESMA frase que a tela mostra", () => {
    const relatorio = relatorioDoCaso({ precoTabela: null });
    const resultado = montarDadosDaRescisao(entrada({ relatorio }));
    expect(resultado).toEqual({ error: motivoParaNaoEmitirTermo(relatorio), ok: false });
  });
});

describe("as armadilhas do extrato continuam desarmadas no termo", () => {
  // ⚠️ ARMADILHA 1: o `paid_value` da parcela 11 é o Asaas pré-preenchendo o boleto. Somá-lo
  // reduziria a dívida do cliente em R$ 500,00 no papel que ele assina.
  it("o total pago é o do extrato, sem o dinheiro fantasma", () => {
    const dados = montado();
    // Ato 3.000 + 8 mensais de 500.
    expect(dados.conta.totalPago).toBe(7000);
  });

  // ⚠️ ARMADILHA 5: a 10 venceu sem boleto e carrega o valor cru de 480,00. O extrato a traz à
  // mensalidade vigente (500,00), e o termo — que escreve "valor atualizado" — fica com esse.
  it("as vencidas entram por `valorAtual`: a defasada sem boleto sobe à vigente", () => {
    const { lista, total } = parcelasVencidasDoExtrato(relatorioDoCaso());
    // 9 (500) + 10 (480 → 500) + 11 (500) + Avulso de acordo (150).
    expect(total).toBe(1650);
    expect(lista.map((item) => item.numero)).toContain("10/120");
  });

  it("e por isso podem passar do 'em atraso (valores originais)' da tela", () => {
    const relatorio = relatorioDoCaso();
    expect(relatorio.totais.vencidasTotal).toBe(1630);
    expect(parcelasVencidasDoExtrato(relatorio).total).toBe(1650);
  });

  // ⚠️ ARMADILHA 3: o Avulso de acordo é dívida real.
  it("o avulso de acordo vencido entra na lista e no total", () => {
    const { lista } = parcelasVencidasDoExtrato(relatorioDoCaso());
    expect(lista).toHaveLength(4);
  });

  // ⚠️ ARMADILHA 4: nenhum juro de mora inventado. A linha da conta é a soma das parcelas, só.
  it("a linha das parcelas vencidas é a mesma soma, sem mora somada", () => {
    const dados = montado();
    expect(deducaoDe(dados.conta, "parcelas_vencidas")?.valor).toBe(1650);
  });

  it("a lista nomeia as parcelas pelo número do boleto, na ordem do vencimento", () => {
    const { lista } = parcelasVencidasDoExtrato(relatorioDoCaso());
    expect(lista.slice(0, 3)).toEqual([
      { numero: "9/120", valor: 500, vencimento: "2025-09-10" },
      // A defasada sem boleto aparece pelo valor que entrou na soma, e não pelo cru de 480,00.
      { numero: "10/120", valor: 500, vencimento: "2025-10-10" },
      { numero: "11/120", valor: 500, vencimento: "2025-11-10" },
    ]);
  });

  // ⚠️ A SIMULAÇÃO IMPRIME CADA PARCELA COM O VALOR E, EMBAIXO, O TOTAL DA CONTA. Se a lista e a soma
  // divergissem por um centavo, o papel mostraria linhas que não fecham com o próprio total.
  it("os valores da lista somam exatamente o total que entra na conta", () => {
    const { lista, total } = parcelasVencidasDoExtrato(relatorioDoCaso());
    const emCentavos = lista.reduce((soma, parcela) => soma + Math.round(parcela.valor * 100), 0);

    expect(emCentavos / 100).toBe(total);
    expect(deducaoDe(montado().conta, "parcelas_vencidas")?.valor).toBe(total);
  });
});

describe("a comissão em reais sai do contrato de corretagem", () => {
  it("lê o total da frase da intermediação, em HTML com entidades", () => {
    expect(comissaoDoContratoDeCorretagem(contratoDeCorretagem("4.705,22", "1.000,00", "3.705,22"))).toBe(
      4705.22,
    );
  });

  // ⚠️ A FRASE SE CONFERE SOZINHA: total e partes. Uma parte que não fecha é texto quebrado, e o
  // papel cai no percentual com aviso em vez de imprimir um número que o próprio contrato desmente.
  it("recusa quando as partes não somam o total", () => {
    expect(
      comissaoDoContratoDeCorretagem(contratoDeCorretagem("4.705,22", "1.000,00", "3.600,00")),
    ).toBeNull();
    // Dois centavos já é outro número.
    expect(
      comissaoDoContratoDeCorretagem(contratoDeCorretagem("4.705,22", "1.000,00", "3.705,20")),
    ).toBeNull();
  });

  // ⚠️ UM CENTAVO É O ARREDONDAMENTO DAS PARTES, medido em 134 contratos reais (o total escrito é
  // o valor; as partes, a prova). Recusar esses casos jogaria 134 termos no percentual de praxe.
  it("aceita um centavo de arredondamento entre as partes, e o valor é o TOTAL escrito", () => {
    expect(
      comissaoDoContratoDeCorretagem(contratoDeCorretagem("4.884,82", "1.052,11", "3.832,70")),
    ).toBe(4884.82);
  });

  it("soma em centavos inteiros, sem o resíduo do ponto flutuante", () => {
    // 873,12 + 3.180,67 em ponto flutuante é 4053.7900000000004.
    expect(comissaoDoContratoDeCorretagem(contratoDeCorretagem("4.053,79", "873,12", "3.180,67"))).toBe(
      4053.79,
    );
  });

  it("zero é valor: venda sem intermediação", () => {
    expect(comissaoDoContratoDeCorretagem(contratoDeCorretagem("0,00", "0,00", "0,00"))).toBe(0);
  });

  it("sem texto, ou sem a frase, devolve nulo — nunca zero", () => {
    expect(comissaoDoContratoDeCorretagem(null)).toBeNull();
    expect(comissaoDoContratoDeCorretagem("   ")).toBeNull();
    expect(comissaoDoContratoDeCorretagem("<p>Contrato sem a cláusula de intermediação.</p>")).toBeNull();
  });
});

describe("a corretagem no papel", () => {
  it("com o valor do contrato, a linha diz 'Conforme contrato' e o rótulo é o percentual daquele valor", () => {
    // 8.000 sobre 100.000 = 8%. Sem o rótulo derivado, o papel diria "6,50% ... totalizando
    // R$ 8.000,00" — e a seção 8 afirma que é percentual sobre o valor de tabela.
    const dados = montado({ comissaoEmReais: 8000 });
    const linha = deducaoDe(dados.conta, "corretagem");

    expect(linha?.valor).toBe(8000);
    expect(linha?.base).toBe("Conforme contrato");
    expect(linha?.descricao).toBe("Corretagem (8%)");
  });

  it("sem o valor do contrato, cai no percentual e a conta AVISA", () => {
    const dados = montado({ comissaoEmReais: null });

    expect(deducaoDe(dados.conta, "corretagem")?.base).toBe("6,50% sobre R$ 100.000,00");
    expect(dados.conta.avisos.some((aviso) => aviso.startsWith("Corretagem usou o percentual de praxe"))).toBe(
      true,
    );
  });

  it("corretagem de R$ 0,00 escrita no contrato fica no papel, mas NÃO calada", () => {
    // 15 contratos de corretagem dizem R$ 0,00 (16/09/2026). Sem o aviso, o papel afirmaria
    // "0% sobre o valor de tabela" com a mesma cara de um número apurado.
    const dados = montado({ comissaoEmReais: 0 });

    expect(deducaoDe(dados.conta, "corretagem")?.valor).toBe(0);
    expect(
      dados.conta.avisos.some((aviso) => aviso.startsWith("Corretagem saiu R$ 0,00")),
    ).toBe(true);
  });

  it("com comissão acima de zero, o aviso do zero não aparece", () => {
    const dados = montado({ comissaoEmReais: 8000 });

    expect(dados.conta.avisos.some((aviso) => aviso.startsWith("Corretagem saiu R$ 0,00"))).toBe(
      false,
    );
  });

  it("o percentual derivado tem duas casas", () => {
    expect(percentualDaComissaoSobreATabela(4705.22, 72388)).toBe(6.5);
    expect(percentualDaComissaoSobreATabela(4053.79, 62172)).toBe(6.52);
    expect(percentualDaComissaoSobreATabela(100, 0)).toBeNull();
  });
});

describe("o que não existe vira nulo, e o papel avisa", () => {
  // ⚠️ SEM PREMISSA, A PRAXE — E A PRAXE É ESCRITA NO PAPEL. É o termo de HOJE, com a migration 0166
  // pendente: ele tem de sair, e tem de dizer que as alíquotas não foram conferidas.
  it("sem premissas, as rubricas saem pela praxe com aviso", () => {
    const { conta } = montado({ comissaoEmReais: 8000 });
    expect(conta.avisos).toEqual([
      "Multa penal usou o percentual de praxe (10%): não há premissa cadastrada para este empreendimento.",
      "Publicidade usou o percentual de praxe (4%): não há premissa cadastrada para este empreendimento.",
      "Tributos usou o percentual de praxe (5,93%): não há premissa cadastrada para este empreendimento.",
    ]);
  });

  it("premissa cadastrada muda o número, e o aviso da rubrica some", () => {
    const { conta } = montado({
      premissas: {
        clausula_penal: { base: "valor_de_tabela", percentual: 12, periodicidade: "unica" },
      },
    });

    expect(deducaoDe(conta, "clausula_penal")?.valor).toBe(12000);
    expect(conta.avisos.some((aviso) => aviso.startsWith("Multa penal"))).toBe(false);
  });

  it("sem posse, não há fruição nem aviso — é o estado normal", () => {
    const { conta } = montado();
    expect(deducaoDe(conta, "fruicao")).toBeUndefined();
    expect(conta.avisos.some((aviso) => aviso.startsWith("Fruição"))).toBe(false);
  });

  // ⚠️ `valorDoContratoAtualizado` VAI NULO DE PROPÓSITO (ver `montarDadosDaRescisao`). Com posse, a
  // fruição da praxe pede essa base: a linha sai do papel e o AVISO entra. Nunca um R$ 0,00.
  it("com posse, a fruição sem base sai do papel COM aviso, e não como zero", () => {
    const { conta } = montado({ dataDaPosse: "2025-06-16" });
    expect(deducaoDe(conta, "fruicao")).toBeUndefined();
    expect(conta.avisos).toContain(
      "Fruição não entrou na conta: a premissa manda calcular sobre o valor do contrato atualizado, que não foi informado.",
    );
  });

  it("o valor do contrato é a soma das parcelas pelo valor de contrato", () => {
    const { conta } = montado({
      premissas: {
        publicidade: { base: "valor_do_contrato", percentual: 1, periodicidade: "unica" },
      },
    });
    // Pagas: 3.000 + 8 × 500 = 7.000. Abertas (initial_value): 500 + 480 + 500 + 150 + 9 × 480 = 5.950.
    expect(deducaoDe(conta, "publicidade")?.base).toBe("1% sobre R$ 12.950,00");
  });

  // ⚠️ VÍRGULA, E NÃO O " - " QUE O EXTRATO TIRA DO "·": no papel, hífen entre dados é travessão.
  it("o plano da ficha: parcelamento e índice, sem travessão", () => {
    expect(planoEscrito(144, "IPCA ANUAL")).toBe("144x, IPCA anual");
    expect(planoEscrito(120, "IGPM-ANUAL")).toBe("120x, IGP-M anual");
    expect(planoEscrito(60, "SEM CORREÇAO")).toBe("60x, sem correção");
    expect(planoEscrito(null, "SEM CORREÇAO")).toBe("Sem correção");
    expect(planoEscrito(144, "IGP-DI")).toBe("144x, IGP-DI");
    expect(planoEscrito(144, "  ")).toBe("144x");
    expect(planoEscrito(0, null)).toBeNull();
  });

  // ⚠️ DECISÃO DE 16/09/2026: a simulação não imprime nacionalidade, estado civil, profissão nem
  // endereço (menos escrita, e o documento mascarado já identifica). O tipo não os carrega, para
  // ninguém preenchê-los achando que saem no papel.
  it("o cliente é só a lista de titulares, sem qualificação", () => {
    expect(Object.keys(montado().cliente)).toEqual(["titulares"]);
  });

  it("uma venda com um pagamento só conta um pagamento, sem período inventado", () => {
    const relatorio = montarExtratoDoContrato({
      contrato: CONTRATO,
      hoje: HOJE,
      parcelas: [parcelasDoCaso()[0] as ExtratoClienteParcelaBruta],
    });
    const resultado = montarDadosDaRescisao(entrada({ relatorio }));
    expect(resultado.ok && resultado.dados.pagamentos).toEqual({
      mesFinal: "2024-12-10",
      mesInicial: "2024-12-10",
      quantidade: 1,
    });
  });
});

describe("os dados do contrato no papel", () => {
  it("imóvel, contrato e pagamentos saem do extrato e do cadastro", () => {
    const dados = montado();

    expect(dados.imovel).toEqual({
      area: 360,
      cidade: "Cidade de Teste",
      codigo: "TST0101",
      empreendimento: "LOTEAMENTO DE TESTE",
      lote: "01",
      quadra: "01",
      uf: "MG",
    });
    expect(dados.contrato).toEqual({
      dataDoAto: "2024-12-10",
      // O parcelamento do CONTRATO (payments.total_parcels), não o molde de 144.
      plano: "120x, IPCA anual",
      valorDeTabela: 100000,
    });
    // Ato + 8 mensais: as mesmas linhas que somam os R$ 7.000,00 do total pago. A parcela 11, com
    // `paid_value` do Asaas e sem data de pagamento, não conta.
    expect(dados.pagamentos).toEqual({ mesFinal: "2025-08-10", mesInicial: "2024-12-10", quantidade: 9 });
    expect(dados.emitidoEm).toBe(HOJE);
  });

  it("cidade em branco no cadastro é nula, e o município some da frase", () => {
    expect(montado({ cidade: "  ", uf: "MG" }).imovel.cidade).toBeNull();
  });
});

describe("os dados do cliente", () => {
  it("o documento sai mascarado, do jeito que o extrato já entrega", () => {
    const cliente = clienteDoContrato(relatorioDoCaso(), { documentoMascarado: null, nome: null });
    expect(cliente).toEqual({
      titulares: [{ documento: "***.111.222-**", nome: "FULANO DE TESTE" }],
    });
  });

  // ⚠️ A RESCISÃO É DO CONTRATO, e os promissários compradores são todos os titulares.
  it("com coadquirente, os dois titulares, cada um com o seu documento, na ordem do C2X", () => {
    const relatorio = relatorioDoCaso({
      titulares: [
        { documentoMascarado: "***.333.444-**", nome: "BELTRANA DE TESTE", ordem: 2, percentual: 50 },
        { documentoMascarado: "***.111.222-**", nome: "FULANO DE TESTE", ordem: 1, percentual: 50 },
      ],
    });

    expect(clienteDoContrato(relatorio, { documentoMascarado: null, nome: null }).titulares).toEqual([
      { documento: "***.111.222-**", nome: "FULANO DE TESTE" },
      { documento: "***.333.444-**", nome: "BELTRANA DE TESTE" },
    ]);
  });

  // ⚠️ SEM O RÓTULO "CPF", O CNPJ MASCARADO IDENTIFICA A EMPRESA SEM AFIRMAR NADA ERRADO. A versão de
  // 15/09 escondia o documento de titular PJ porque imprimia "CPF:" fixo.
  it("titular pessoa jurídica: o CNPJ sai mascarado, como no extrato", () => {
    const relatorio = relatorioDoCaso({
      titulares: [
        { documentoMascarado: "**.123.456/0001-**", nome: "EMPRESA DE TESTE LTDA", ordem: 1, percentual: null },
      ],
    });
    expect(clienteDoContrato(relatorio, { documentoMascarado: null, nome: null }).titulares).toEqual([
      { documento: "**.123.456/0001-**", nome: "EMPRESA DE TESTE LTDA" },
    ]);
  });

  it("contrato sem titular cai na ficha; sem nem isso, 'Cliente' e nenhum documento", () => {
    expect(
      clienteDoContrato(relatorioDoCaso({ titulares: [] }), {
        documentoMascarado: "***.555.666-**",
        nome: "CICRANO DE TESTE",
      }).titulares,
    ).toEqual([{ documento: "***.555.666-**", nome: "CICRANO DE TESTE" }]);

    expect(
      clienteDoContrato(relatorioDoCaso({ titulares: [] }), { documentoMascarado: " ", nome: null })
        .titulares,
    ).toEqual([{ documento: null, nome: "Cliente" }]);
  });
});
