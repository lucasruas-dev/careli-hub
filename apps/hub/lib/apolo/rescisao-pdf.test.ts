import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PDFDocument, PDFPage } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";

import { calcularRescisao, deducaoDe } from "./rescisao";
import {
  camposDaFicha,
  cartoesDaRescisao,
  casoDoSaldo,
  type DadosDaRescisao,
  fraseDoResultado,
  gruposDaListaDeVencidas,
  itensDoQueSignifica,
  linhaDaDeducao,
  linhasDasParcelasVencidas,
  localEscrito,
  montarTermoDeRescisaoPdf,
  nomeDoArquivoRescisao,
  type ParcelaVencidaDaRescisao,
  titularesEscritos,
  totalDasParcelasVencidas,
  unidadeEscrita,
} from "./rescisao-pdf";

// A SIMULAÇÃO DE RESCISÃO — o papel didático de 16/09/2026, no padrão do extrato.
//
// ⚠️ O QUE ESTE ARQUIVO TRAVA É O QUE O DONO DO PRODUTO PEDIU E O QUE NÃO PODE SUMIR. O pedido foi
// menos escrita, leitura num olhar e nenhuma assinatura; o inegociável é o que faz o papel valer:
// total pago, cada dedução com a base, total igual à soma das linhas, resultado nunca negativo e com
// o rótulo que diz quem deve a quem, o saldo por extenso, as parcelas vencidas identificadas, os
// avisos da apuração, o aviso de simulação, cliente e imóvel, e a data no cabeçalho.
//
// ⚠️ NENHUM DADO DE CLIENTE REAL. Os números do caso de referência são os do papel feito à mão em
// 25/06/2026 (LAVRA DO OURO, unidade LOS0610); nome e documento são inventados.

const CONTA_RESTITUIR = calcularRescisao({
  comissaoEmReais: 4705.22,
  parcelasVencidas: 963.88,
  totalPago: 16135.33,
  valorDeTabela: 72388,
});

const CONTA_RESIDUAL = calcularRescisao({
  comissaoEmReais: 7800,
  parcelasVencidas: 4820.44,
  totalPago: 9800,
  valorDeTabela: 120000,
});

/** Deduções zeradas por percentual, e a única linha é a parcela vencida: o pago cobre o devido. */
const CONTA_ZERADA = calcularRescisao({
  comissaoEmReais: 0,
  parcelasVencidas: 1000,
  percentuais: { multa: 0, publicidade: 0, tributos: 0 },
  totalPago: 1000,
  valorDeTabela: 50000,
});

const CASO: DadosDaRescisao = {
  cliente: { titulares: [{ documento: "***.111.222-**", nome: "FULANO EXEMPLO DE OLIVEIRA" }] },
  conta: CONTA_RESTITUIR,
  contrato: { dataDoAto: "2024-08-02", plano: "144x, IPCA anual", valorDeTabela: 72388 },
  emitidoEm: "2026-06-25",
  imovel: {
    area: 300,
    cidade: "Itaúna",
    codigo: "LOS0610",
    empreendimento: "LAVRA DO OURO",
    lote: "10",
    quadra: "06",
    uf: "MG",
  },
  pagamentos: { mesFinal: "2026-04-20", mesInicial: "2024-10-20", quantidade: 21 },
  parcelasVencidas: [
    { numero: "19/144", valor: 481.94, vencimento: "2026-05-15" },
    { numero: "20/144", valor: 481.94, vencimento: "2026-06-15" },
  ],
};

const CASO_RESIDUAL: DadosDaRescisao = { ...CASO, conta: CONTA_RESIDUAL };

/** `quantidade` parcelas vencidas de R$ 100,00, numeradas a partir de 1. */
function vencidas(quantidade: number): ParcelaVencidaDaRescisao[] {
  return Array.from({ length: quantidade }, (_, indice) => ({
    numero: `${indice + 1}/144`,
    valor: 100,
    vencimento: `2025-${String((indice % 12) + 1).padStart(2, "0")}-10`,
  }));
}

/** Monta o PDF e devolve o texto de cada `drawText`, na ordem em que foi escrito. */
async function textoDoPdf(dados: DadosDaRescisao): Promise<{ paginas: number; textos: string[] }> {
  const textos: string[] = [];
  const original = PDFPage.prototype.drawText;
  vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (
    this: PDFPage,
    texto: string,
    opcoes?: Parameters<PDFPage["drawText"]>[1],
  ) {
    textos.push(texto);
    return original.call(this, texto, opcoes);
  });

  const bytes = await montarTermoDeRescisaoPdf(dados);
  const paginas = (await PDFDocument.load(bytes)).getPageCount();
  return { paginas, textos };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("o desfecho da conta", () => {
  it("reconhece os três casos", () => {
    expect(casoDoSaldo(CONTA_RESTITUIR)).toBe("restituir");
    expect(casoDoSaldo(CONTA_RESIDUAL)).toBe("residual");
    expect(casoDoSaldo(CONTA_ZERADA)).toBe("zerado");
  });
});

describe("os três cartões", () => {
  it("total pago, total de deduções e o saldo, com os ícones da subtração", () => {
    const cartoes = cartoesDaRescisao(CASO);

    expect(cartoes.map((cartao) => [cartao.icone, cartao.rotulo, cartao.valor])).toEqual([
      ["moeda", "Total pago", "R$ 16.135,33"],
      ["menos", "Total de deduções", "R$ 16.101,52"],
      ["igual", "Saldo a restituir ao comprador", "R$ 33,81"],
    ]);
    expect(cartoes[0]?.apoio).toBe("21 pagamentos, de 10/2024 a 04/2026");
    expect(cartoes[1]?.apoio).toBe("5 deduções, detalhadas abaixo");
  });

  // ⚠️ O CARTÃO QUE O CLIENTE PROCURA. "Saldo residual" sozinho não diz de quem é a dívida; o rótulo
  // tem de dizer, porque o número nunca carrega sinal.
  it("no residual, o rótulo diz que quem paga é o comprador, e o número é positivo", () => {
    const resultado = cartoesDaRescisao(CASO_RESIDUAL)[2];

    expect(resultado?.rotulo).toBe("Saldo a pagar pelo comprador");
    expect(resultado?.valor).toBe("R$ 19.109,58");
    expect(resultado?.valor).not.toContain("-");
  });

  it("no empate, 'sem saldo' e R$ 0,00, em vez de uma cobrança de nada", () => {
    const resultado = cartoesDaRescisao({ ...CASO, conta: CONTA_ZERADA })[2];

    expect(resultado?.rotulo).toBe("Sem saldo");
    expect(resultado?.valor).toBe("R$ 0,00");
  });

  it("sem pagamento, o apoio diz isso; com um mês só, não inventa intervalo", () => {
    const semPagamento = { ...CASO, pagamentos: { mesFinal: null, mesInicial: null, quantidade: 0 } };
    expect(cartoesDaRescisao(semPagamento)[0]?.apoio).toBe("Nenhum pagamento registrado");

    const umMes = { ...CASO, pagamentos: { mesFinal: "2023-12-20", mesInicial: "2023-12-02", quantidade: 2 } };
    expect(cartoesDaRescisao(umMes)[0]?.apoio).toBe("2 pagamentos, em 12/2023");
  });
});

describe("a frase do resultado", () => {
  // ⚠️ O POR EXTENSO É INEGOCIÁVEL, e mora aqui: o cartão tem só o número.
  it("no restituir, diz o saldo por extenso e a quem ele vai", () => {
    expect(fraseDoResultado(CONTA_RESTITUIR)).toBe(
      "Numa rescisão, do total pago saem as deduções previstas no contrato, detalhadas abaixo. " +
        "Como o total pago passa das deduções, sobra um saldo de R$ 33,81 (trinta e três reais e " +
        "oitenta e um centavos) a restituir ao comprador.",
    );
  });

  it("no residual, diz que não há restituição e que o saldo é a pagar", () => {
    expect(fraseDoResultado(CONTA_RESIDUAL)).toBe(
      "Numa rescisão, do total pago saem as deduções previstas no contrato, detalhadas abaixo. " +
        "Como as deduções passam do total pago, não há valor a restituir e fica um saldo de " +
        "R$ 19.109,58 (dezenove mil cento e nove reais e cinquenta e oito centavos) a pagar pelo comprador.",
    );
  });

  it("no empate, não fala de valor nenhum", () => {
    expect(fraseDoResultado(CONTA_ZERADA)).toBe(
      "Numa rescisão, do total pago saem as deduções previstas no contrato, detalhadas abaixo. " +
        "Aqui o total pago cobre exatamente as deduções: não há saldo a restituir nem a pagar.",
    );
  });
});

describe("a tabela 'Como chegamos a esse valor'", () => {
  it("cada linha tem a dedução, a base em palavras, o cálculo e o valor", () => {
    const linhas = CASO.conta.deducoes.map((linha) => linhaDaDeducao(linha, CASO));

    expect(linhas).toEqual([
      ["Multa penal (10%)", "Valor de tabela menos a comissão", "10% sobre R$ 67.682,78", "R$ 6.768,28"],
      ["Publicidade (4%)", "Valor de tabela menos a comissão", "4% sobre R$ 67.682,78", "R$ 2.707,31"],
      ["Corretagem (6,50%)", "Contrato de corretagem", "Conforme contrato", "R$ 4.705,22"],
      ["Tributos (5,93%)", "Total pago", "5,93% sobre R$ 16.135,33", "R$ 956,83"],
      ["Parcelas vencidas em aberto", "Extrato financeiro", "2 parcelas, listadas abaixo", "R$ 963,88"],
    ]);
  });

  // ⚠️ O PAPEL FEITO À MÃO DE 25/06/2026 IMPRIMIA CINCO DEDUÇÕES E UM TOTAL QUE NÃO ERA A SOMA DELAS,
  // e a diferença invertia o resultado. O total impresso é o da conta, e a conta é a soma das linhas.
  it("o total impresso é a soma das linhas impressas", () => {
    const emCentavos = CASO.conta.deducoes.reduce((soma, linha) => soma + Math.round(linha.valor * 100), 0);
    expect(CASO.conta.totalDeDeducoes).toBe(emCentavos / 100);
  });

  it("com a corretagem pelo percentual, a base também vem em palavras", () => {
    const semValorEmReais = calcularRescisao({ parcelasVencidas: 0, totalPago: 1000, valorDeTabela: 50000 });
    const corretagem = deducaoDe(semValorEmReais, "corretagem");

    expect(corretagem && linhaDaDeducao(corretagem, { ...CASO, conta: semValorEmReais })).toEqual([
      "Corretagem (6,50%)",
      "Valor de tabela",
      "6,50% sobre R$ 50.000,00",
      "R$ 3.250,00",
    ]);
  });

  it("sem parcela vencida, a linha diz que não há nenhuma em aberto", () => {
    const linha = deducaoDe(CASO.conta, "parcelas_vencidas");
    expect(linha && linhaDaDeducao(linha, { ...CASO, parcelasVencidas: [] })[2]).toBe("Nenhuma em aberto");
  });
});

describe("a lista das parcelas vencidas", () => {
  it("é uma coluna até 6, duas até 24 e três acima disso", () => {
    expect([1, 6, 7, 24, 25, 33].map(gruposDaListaDeVencidas)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it("numa coluna, cada parcela com número, vencimento e valor", () => {
    expect(linhasDasParcelasVencidas(CASO)).toEqual([
      ["19/144", "15/05/2026", "R$ 481,94"],
      ["20/144", "15/06/2026", "R$ 481,94"],
    ]);
  });

  // ⚠️ LIDA DE CIMA PARA BAIXO E DEPOIS A COLUNA SEGUINTE, e nenhuma parcela some na divisão.
  it("em grupos, distribui de cima para baixo e não perde nenhuma parcela", () => {
    const linhas = linhasDasParcelasVencidas({ ...CASO, parcelasVencidas: vencidas(7) });

    expect(linhas).toHaveLength(4);
    expect(linhas[0]).toEqual(["1/144", "10/01/2025", "R$ 100,00", "", "5/144", "10/05/2025", "R$ 100,00"]);
    expect(linhas[3]).toEqual(["4/144", "10/04/2025", "R$ 100,00", "", "", "", ""]);

    const trinta = linhasDasParcelasVencidas({ ...CASO, parcelasVencidas: vencidas(33) });
    const numeros = trinta.flat().filter((celula) => /^\d+\/144$/.test(celula));
    expect(trinta).toHaveLength(11);
    expect(new Set(numeros).size).toBe(33);
  });

  it("o total da lista é a linha da conta, a mesma da tabela de deduções", () => {
    expect(totalDasParcelasVencidas(CASO.conta)).toBe(963.88);
    expect(deducaoDe(CASO.conta, "parcelas_vencidas")?.valor).toBe(963.88);
  });
});

describe("'O que isso significa'", () => {
  it("no residual: corretagem, encargos das vencidas, cobrança e o aviso de simulação", () => {
    expect(itensDoQueSignifica(CASO_RESIDUAL)).toEqual([
      "A comissão de corretagem pagou a intermediação da venda e não é restituída na rescisão.",
      "Até serem pagas, as parcelas vencidas continuam sujeitas à correção, aos juros e à multa do contrato.",
      "O saldo a pagar também segue sujeito aos encargos do contrato e pode ser cobrado de forma administrativa ou judicial.",
      "Esta é uma simulação: ela não desfaz o contrato, vale para a data da posição e depende da conferência com o contrato assinado.",
    ]);
  });

  // ⚠️ MANDAR COBRAR QUEM TEM SALDO A RECEBER é o pior erro que este papel pode cometer.
  it("quando sobra para o comprador, não fala em cobrança", () => {
    const itens = itensDoQueSignifica(CASO);
    expect(itens.join(" ")).not.toContain("cobrado");
    expect(itens).toContain("A restituição do saldo segue a forma e os prazos previstos no contrato.");
  });

  it("sem corretagem e sem vencida, os tópicos delas não aparecem; o aviso de simulação, sempre", () => {
    const itens = itensDoQueSignifica({ ...CASO, conta: CONTA_ZERADA, parcelasVencidas: [] });
    expect(itens).toEqual([
      "Esta é uma simulação: ela não desfaz o contrato, vale para a data da posição e depende da conferência com o contrato assinado.",
    ]);
  });

  it("nunca passa de quatro tópicos", () => {
    for (const dados of [CASO, CASO_RESIDUAL, { ...CASO, conta: CONTA_ZERADA }]) {
      expect(itensDoQueSignifica(dados).length).toBeLessThanOrEqual(4);
    }
  });
});

describe("a identificação do cliente e do imóvel", () => {
  it("titulares no padrão do extrato, com o documento entre parênteses", () => {
    expect(titularesEscritos(CASO.cliente)).toBe("FULANO EXEMPLO DE OLIVEIRA (***.111.222-**)");
    expect(
      titularesEscritos({
        titulares: [
          { documento: "***.111.222-**", nome: "FULANO DE TESTE" },
          { documento: "**.123.456/0001-**", nome: "EMPRESA DE TESTE LTDA" },
          { documento: null, nome: "SEM DOCUMENTO" },
        ],
      }),
    ).toBe("FULANO DE TESTE (***.111.222-**)  |  EMPRESA DE TESTE LTDA (**.123.456/0001-**)  |  SEM DOCUMENTO");
  });

  it("a unidade e o local como o cabeçalho do extrato escreve", () => {
    expect(unidadeEscrita(CASO.imovel)).toBe("Quadra 06, Lote 10 (LOS0610)");
    expect(localEscrito(CASO.imovel)).toBe("Área 300,00 m², Itaúna/MG");
    expect(localEscrito({ ...CASO.imovel, area: null, cidade: null })).toBeNull();
    expect(unidadeEscrita({ ...CASO.imovel, lote: null, quadra: null })).toBe("LOS0610");
  });

  it("a ficha segue a grade do extrato, com o valor de tabela no lugar da situação", () => {
    expect(camposDaFicha(CASO).map((campo) => [campo.rotulo, campo.valor])).toEqual([
      ["Contrato / unidade", "LOS0610"],
      ["Data do ato", "02/08/2024"],
      ["Plano", "144x, IPCA anual"],
      ["Valor de tabela", "R$ 72.388,00"],
    ]);
    expect(camposDaFicha(CASO).reduce((soma, campo) => soma + campo.peso, 0)).toBeCloseTo(1, 9);
  });
});

describe("o nome do arquivo", () => {
  it("leva o título, os titulares, a unidade e a data, sem acento", () => {
    expect(nomeDoArquivoRescisao(CASO)).toBe(
      "Simulacao de Rescisao - FULANO EXEMPLO DE OLIVEIRA - LOS0610 - 25-06-2026.pdf",
    );
  });
});

// ⚠️ O QUE SÓ O PDF MOSTRA. Os testes abaixo leem o texto que o documento de fato escreveu na folha
// (cada `drawText`), e não o que as funções devolvem: é ali que uma assinatura esquecida ou um aviso
// que não foi chamado apareceriam.
describe("o PDF sai de verdade", () => {
  it("uma página, com título, posição, cliente, imóvel, extenso, parcelas e avisos", async () => {
    const { paginas, textos } = await textoDoPdf(CASO);
    const tudo = textos.join(" | ");

    expect(paginas).toBe(1);
    expect(textos).toContain("Simulação de Rescisão");
    expect(textos).toContain("Posição em 25/06/2026");
    expect(textos).toContain("LAVRA DO OURO");
    expect(textos).toContain("Quadra 06, Lote 10 (LOS0610)");
    expect(tudo).toContain("FULANO EXEMPLO DE OLIVEIRA (***.111.222-**)");
    expect(tudo).toContain("trinta e três reais e oitenta e um centavos");
    expect(textos).toContain("19/144");
    expect(textos).toContain("20/144");
    expect(textos).toContain("Total de deduções");
    expect(tudo).toContain("não há premissa cadastrada");
    expect(tudo).toContain("Esta é uma simulação");
  });

  // ⚠️ PEDIDO DO DONO DO PRODUTO EM 16/09/2026: "não precisa colocar quem assina". O fecho com cidade
  // e data saiu junto. `blocoDeAssinatura` continua em `pdf-timbrado.ts` para quando voltar.
  it("não tem assinatura, cargo, saudação nem fecho com cidade", async () => {
    const { textos } = await textoDoPdf(CASO_RESIDUAL);
    const tudo = textos.join(" | ");

    for (const proibido of ["Atenciosamente", "Nívea", "Diretora", "Belo Horizonte", "de junho de 2026"]) {
      expect(tudo).not.toContain(proibido);
    }

    const codigo = readFileSync(join(__dirname, "rescisao-pdf.ts"), "utf8")
      .split("\n")
      .filter((linha) => !/^\s*(\/\/|\/\*|\*)/.test(linha))
      .join("\n");
    expect(codigo).not.toContain("blocoDeAssinatura");
  });

  // ⚠️ REGRA DA CASA: SEM TRAVESSÃO EM TEXTO VISÍVEL. `limpar` troca o travessão por hífen, então um
  // " - " no PDF é um travessão que alguém escreveu e o WinAnsi disfarçou.
  it("nenhum texto da folha usa travessão, nem disfarçado de hífen", async () => {
    const { textos } = await textoDoPdf(CASO_RESIDUAL);

    for (const texto of textos) {
      expect(texto).not.toMatch(/[–—]| - /);
    }
  });

  // ⚠️ ACENTO PASSA, TRAVESSÃO E EMOJI NÃO: o WinAnsi estoura em runtime, no meio da emissão.
  it("todo texto escrito cabe no WinAnsi", async () => {
    const { textos } = await textoDoPdf(CASO);
    // eslint-disable-next-line no-control-regex
    expect(textos.join(" ")).not.toMatch(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/);
  });

  // ⚠️ O CASO PESADO QUE EXISTE NO C2X: 33 parcelas vencidas (LOU0123 em 16/09/2026), com os três
  // avisos da praxe. Em três grupos lado a lado ele cabe numa folha.
  it("33 parcelas vencidas e três avisos ainda cabem numa página", async () => {
    const lista = vencidas(33);
    const conta = calcularRescisao({
      comissaoEmReais: 3992.95,
      parcelasVencidas: lista.reduce((soma, parcela) => soma + parcela.valor, 0),
      // Como a montagem faz com a comissão lida do contrato: o percentual derivado vai no atalho.
      percentuais: { corretagem: 6.5 },
      totalPago: 3071.5,
      valorDeTabela: 61430,
    });

    const { paginas, textos } = await textoDoPdf({ ...CASO, conta, parcelasVencidas: lista });
    expect(conta.avisos).toHaveLength(3);
    expect(paginas).toBe(1);
    expect(textos).toContain("33/144");
  });

  it("emite sem avisos, e aí o bloco das observações não existe", async () => {
    const tudoCadastrado = calcularRescisao({
      comissaoEmReais: 4705.22,
      parcelasVencidas: 963.88,
      percentuais: { corretagem: 6.5, multa: 10, publicidade: 4, tributos: 5.93 },
      totalPago: 16135.33,
      valorDeTabela: 72388,
    });
    expect(tudoCadastrado.avisos).toEqual([]);

    const { paginas, textos } = await textoDoPdf({ ...CASO, conta: tudoCadastrado });
    expect(paginas).toBe(1);
    expect(textos).not.toContain("OBSERVAÇÕES DA APURAÇÃO");
  });

  // ⚠️ FRUIÇÃO SÓ COM POSSE, e quando ela existe a tabela ganha uma linha no meio, com um cálculo
  // longo que QUEBRA na célula em vez de sair cortado.
  it("emite com a linha de fruição, e o cálculo dela sai inteiro", async () => {
    const comPosse = calcularRescisao({
      comissaoEmReais: 7800,
      mesesDeFruicao: 21.5,
      parcelasVencidas: 4820.44,
      totalPago: 9800,
      valorDeTabela: 120000,
      valorDoContratoAtualizado: 138500,
    });

    const { textos } = await textoDoPdf({ ...CASO, conta: comPosse });
    const tudo = textos.join(" ");
    expect(tudo).toContain("Fruição (0,75% ao mês)");
    expect(tudo).toContain("Valor do contrato atualizado");
    expect(tudo).toContain("21,5 meses");
    expect(tudo).not.toContain("...");
  });
});
