import { inflateSync } from "node:zlib";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  cartoesDoTermoDeAcordo,
  type DadosDoTermoDeAcordo,
  escolherDisposicao,
  fecharParcelasComTotal,
  fraseDoCongelamento,
  montarTermoDeAcordoPdf,
  nomeDoArquivoDoTermoDeAcordo,
  type ParcelaDoAcordo,
  qualificacaoEmUmaLinha,
  quantasParcelas,
  REGRAS_DO_ACORDO,
  resumoDoPagamento,
  semTracoSeparador,
  TITULO_DO_TERMO_DE_ACORDO,
  totalNominalEmAtraso,
} from "./termo-de-acordo-pdf";

// ⚠️ O CASO DO MODELO. Os números vêm do papel assinado que o Lucas mandou em 15/09/2026 (VEREDAS
// DO OURO, PV VDO1301, Quadra 13 - Lote 01, emitido em 10/07/2026); nome, CPF e endereço TROCADOS
// por fictícios, porque este arquivo vai para o repositório. Com o centavo que faltava no papel de
// hoje resolvido.
const CASO_REAL: DadosDoTermoDeAcordo = {
  comprador: {
    cpf: "444.555.666-17",
    endereco: "Rua Doutor Exemplo de Campos, nº 115, Vila Modelo, São Paulo/SP, CEP 01000-000",
    estadoCivil: "Solteiro(a)",
    nacionalidade: "Brasileira",
    nome: "BELTRANO EXEMPLO FERREIRA SILVA",
    profissao: "Analista Jurídico",
  },
  debito: {
    apuradoEm: "10/07/2026",
    parcelas: [{ numero: "01/180", valor: 2186.99, vencimento: "15/05/2026" }],
    previsaoDePagamento: "15/10/2026",
    valorAtualizado: 2364.33,
    vencimentoConsiderado: "15/05/2026",
  },
  emitidoEm: new Date(2026, 6, 10),
  empreendimento: "Veredas do Ouro",
  parcelasDoAcordo: [
    { valor: 591.08, vencimento: "15/07/2026" },
    { valor: 591.08, vencimento: "15/08/2026" },
    { valor: 591.08, vencimento: "15/09/2026" },
    { valor: 591.08, vencimento: "15/10/2026" },
  ],
  pv: "VDO1301",
  unidade: "Quadra 13 - Lote 01",
};

// ⚠️ O CASO PESADO (fictício): seis parcelas em atraso de tipos diferentes, doze parcelas de acordo,
// nome, qualificação e endereço compridos e um empreendimento de nome longo. É o que mais ocupa
// folha sem sair do que a tela do Hades monta, e é ele que prova a página única, não o caso leve.
const CASO_PESADO: DadosDoTermoDeAcordo = {
  comprador: {
    cpf: "987.654.321-00",
    endereco:
      "Rua Exemplo Bernardes de Albuquerque Filho - nº 253, apto 1204, bloco B - Morada Modelo - Itaúna/MG - CEP 35.680-448",
    estadoCivil: "Casado(a) sob o regime de comunhão parcial de bens",
    nacionalidade: "Brasileira",
    nome: "MARIA DA CONCEIÇÃO EXEMPLO DE OLIVEIRA GONÇALVES",
    profissao: "Técnica em Edificações e Operadora de Máquina Pesada",
  },
  debito: {
    apuradoEm: "15/09/2026",
    parcelas: [
      { numero: "Ato", valor: 1200, vencimento: "10/03/2026" },
      { numero: "Sinal 2/3", valor: 980.5, vencimento: "10/04/2026" },
      { numero: "19/144", valor: 963.88, vencimento: "10/05/2026" },
      { numero: "20/144", valor: 963.88, vencimento: "10/06/2026" },
      { numero: "21/144", valor: 963.88, vencimento: "10/07/2026" },
      { numero: "22/144", valor: 963.88, vencimento: "10/08/2026" },
    ],
    previsaoDePagamento: "10/09/2027",
    valorAtualizado: 6500.01,
    vencimentoConsiderado: "10/03/2026 a 10/08/2026",
  },
  emitidoEm: new Date(2026, 8, 15),
  empreendimento: "CONDOMINIO RECANTO DO PARAISO DAS AGUAS",
  parcelasDoAcordo: Array.from({ length: 12 }, (_, indice) => ({
    valor: 541.67,
    vencimento: `10/${String(((indice + 9) % 12) + 1).padStart(2, "0")}/${indice < 3 ? 2026 : 2027}`,
  })),
  pv: "RPA0610",
  unidade: "Quadra 06 - Lote 10",
};

/**
 * O texto que o PDF desenha, lido de volta dos fluxos de conteúdo.
 *
 * ⚠️ O pdf-lib comprime o conteúdo da página (FlateDecode) e escreve cada linha como uma string
 * hexadecimal em WinAnsi (`<...> Tj`). Procurar a frase direto nos bytes do arquivo nunca acharia
 * nada, e o teste de "não tem assinatura" passaria sempre, sem provar coisa alguma.
 */
function textoDoPdf(bytes: Uint8Array): string {
  const arquivo = Buffer.from(bytes);
  const trechos: string[] = [];
  let inicio = arquivo.indexOf("stream");

  while (inicio !== -1) {
    const comeco = arquivo.indexOf("\n", inicio) + 1;
    const fim = arquivo.indexOf("endstream", comeco);
    if (fim === -1) break;
    try {
      const conteudo = inflateSync(arquivo.subarray(comeco, fim)).toString("latin1");
      for (const [, hexadecimal] of conteudo.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
        trechos.push(Buffer.from(hexadecimal ?? "", "hex").toString("latin1"));
      }
    } catch {
      // fluxo que não é conteúdo de página comprimido (fonte, imagem): não tem texto a ler
    }
    inicio = arquivo.indexOf("stream", fim + "endstream".length);
  }

  return trechos.join("\n");
}

describe("o arredondamento das parcelas do acordo", () => {
  // ⚠️ O CENTAVO PERDIDO DO CASO REAL. 4 × R$ 591,08 = R$ 2.364,32 contra um débito atualizado de
  // R$ 2.364,33. Um acordo cuja soma das parcelas não bate com o valor acordado é um papel que o
  // cliente contesta, e o contestador tem razão.
  it("joga a sobra de um centavo na ÚLTIMA parcela", () => {
    const { parcelas, sobra } = fecharParcelasComTotal(CASO_REAL.parcelasDoAcordo, 2364.33);

    expect(sobra).toBe(0.01);
    expect(parcelas.map((parcela) => parcela.valor)).toEqual([591.08, 591.08, 591.08, 591.09]);
  });

  it("e a soma das parcelas impressas fecha com o valor acordado", () => {
    const { parcelas } = fecharParcelasComTotal(CASO_REAL.parcelasDoAcordo, 2364.33);
    const soma = Math.round(parcelas.reduce((acc, p) => acc + p.valor, 0) * 100) / 100;

    expect(soma).toBe(2364.33);
  });

  // A sobra também pode ser NEGATIVA (o rateio arredondou para cima em todas), e aí a última
  // parcela encolhe. O caso aparece com 3 parcelas de um total que termina em 1 centavo.
  it("desconta da última quando a divisão passou do total", () => {
    const tres: ParcelaDoAcordo[] = [
      { valor: 33.34, vencimento: "10/01/2027" },
      { valor: 33.34, vencimento: "10/02/2027" },
      { valor: 33.34, vencimento: "10/03/2027" },
    ];
    const { parcelas, sobra } = fecharParcelasComTotal(tres, 100);

    expect(sobra).toBe(-0.02);
    expect(parcelas.map((parcela) => parcela.valor)).toEqual([33.34, 33.34, 33.32]);
  });

  it("não mexe em nada quando a soma já fecha", () => {
    const certas: ParcelaDoAcordo[] = [
      { valor: 500, vencimento: "10/01/2027" },
      { valor: 500, vencimento: "10/02/2027" },
    ];
    const { parcelas, sobra } = fecharParcelasComTotal(certas, 1000);

    expect(sobra).toBe(0);
    expect(parcelas.map((parcela) => parcela.valor)).toEqual([500, 500]);
  });

  // ⚠️ DIVERGÊNCIA GRANDE NÃO É ARREDONDAMENTO. Absorver R$ 50,00 calado na última parcela
  // esconderia um erro de negociação dentro do documento que o cliente assina.
  it("estoura quando a divergência é maior que o arredondamento", () => {
    const erradas: ParcelaDoAcordo[] = [
      { valor: 500, vencimento: "10/01/2027" },
      { valor: 500, vencimento: "10/02/2027" },
    ];

    expect(() => fecharParcelasComTotal(erradas, 1050)).toThrow(/diverge do valor acordado/);
  });

  it("aguenta o acordo sem parcelas sem quebrar a emissão", () => {
    expect(fecharParcelasComTotal([], 100)).toEqual({ parcelas: [], sobra: 100 });
  });
});

describe("o cartão de como vai pagar", () => {
  it("parcelas iguais: a quantidade e o valor, com o período", () => {
    expect(resumoDoPagamento(CASO_REAL.parcelasDoAcordo)).toEqual({
      apoio: "de 15/07/2026 a 15/10/2026",
      valor: "4x R$ 591,08",
    });
  });

  // ⚠️ DEPOIS DE FECHAR O CENTAVO O DETALHE MUDA, e tem de mudar: "4x R$ 591,08" calado, com uma
  // delas em R$ 591,09, repetiria no cartão o erro que a tabela acabou de corrigir.
  it("avisa quando a última parcela absorveu a sobra", () => {
    const { parcelas } = fecharParcelasComTotal(CASO_REAL.parcelasDoAcordo, 2364.33);

    expect(resumoDoPagamento(parcelas)).toEqual({
      apoio: "a última de R$ 591,09, até 15/10/2026",
      valor: "4x R$ 591,08",
    });
  });

  it("parcela única é o valor, com a data", () => {
    expect(resumoDoPagamento([{ valor: 2364.33, vencimento: "15/10/2026" }])).toEqual({
      apoio: "Parcela única, em 15/10/2026",
      valor: "R$ 2.364,33",
    });
  });

  // ⚠️ "5x R$ 341,08" com uma entrada de R$ 1.000,00 seria um número que nenhum boleto tem.
  it("entrada diferente não vira mais uma parcela igual", () => {
    expect(
      resumoDoPagamento([
        { valor: 1000, vencimento: "15/07/2026" },
        { valor: 341.08, vencimento: "15/08/2026" },
        { valor: 341.08, vencimento: "15/09/2026" },
        { valor: 341.09, vencimento: "15/10/2026" },
      ]),
    ).toEqual({ apoio: "entrada de R$ 1.000,00 + 3x R$ 341,08", valor: "4 parcelas" });
  });

  it("valores livres: a quantidade e o período, e a tabela diz o resto", () => {
    expect(
      resumoDoPagamento([
        { valor: 1000, vencimento: "15/07/2026" },
        { valor: 700, vencimento: "15/08/2026" },
        { valor: 664.33, vencimento: "15/09/2026" },
        { valor: 500, vencimento: "15/10/2026" },
      ]),
    ).toEqual({ apoio: "de 15/07/2026 a 15/10/2026", valor: "4 parcelas" });
  });

  it("não quebra com a lista vazia", () => {
    expect(resumoDoPagamento([])).toEqual({ apoio: "Sem parcelas definidas", valor: "-" });
  });
});

describe("os três cartões do caso real", () => {
  const { parcelas } = fecharParcelasComTotal(CASO_REAL.parcelasDoAcordo, 2364.33);
  const [emAtraso, valorDoAcordo, comoVaiPagar] = cartoesDoTermoDeAcordo(CASO_REAL, parcelas);

  // ⚠️ O TOTAL É A SOMA DO QUE O PAPEL LISTA, e o rótulo diz que é o valor original: quem vê os dois
  // números lado a lado precisa saber, sem ler mais nada, qual é o que vai pagar.
  it("em atraso: o nominal somado das linhas, dito como valor original", () => {
    expect(emAtraso).toEqual({
      apoio: "1 parcela, vencida em 15/05/2026",
      icone: "alerta",
      rotulo: "Em atraso (valores originais)",
      valor: "R$ 2.186,99",
    });
  });

  // ⚠️ SEM A DATA DE CONGELAMENTO, duas vias do mesmo acordo impressas em dias diferentes não têm
  // como provar que falam do mesmo número.
  it("valor do acordo: o atualizado, com a data em que foi congelado", () => {
    expect(valorDoAcordo).toEqual({
      apoio: "congelado em 10/07/2026",
      icone: "saldo",
      rotulo: "Valor do acordo",
      valor: "R$ 2.364,33",
    });
  });

  it("como vai pagar: a condição fechada no centavo", () => {
    expect(comoVaiPagar?.valor).toBe("4x R$ 591,08");
    expect(comoVaiPagar?.apoio).toBe("a última de R$ 591,09, até 15/10/2026");
  });

  it("várias parcelas em datas diferentes dizem o intervalo", () => {
    const [cartao] = cartoesDoTermoDeAcordo(CASO_PESADO, CASO_PESADO.parcelasDoAcordo);
    expect(cartao?.apoio).toBe("6 parcelas, de 10/03/2026 a 10/08/2026");
    expect(cartao?.valor).toBe("R$ 6.036,02");
  });

  it("o total nominal é a soma das parcelas listadas", () => {
    expect(totalNominalEmAtraso(CASO_REAL.debito.parcelas)).toBe(2186.99);
    expect(
      totalNominalEmAtraso([
        { numero: "01/180", valor: 2186.99, vencimento: "15/05/2026" },
        { numero: "02/180", valor: 591.085, vencimento: "15/06/2026" },
      ]),
    ).toBe(2778.08);
  });

  it("concorda a quantidade", () => {
    expect(quantasParcelas(1)).toBe("1 parcela");
    expect(quantasParcelas(12)).toBe("12 parcelas");
  });
});

describe("o texto do termo", () => {
  it("imprime a data em que o débito foi congelado, e que ele não muda na reimpressão", () => {
    const frase = fraseDoCongelamento("10/07/2026");
    expect(frase).toContain("atualizado até 10/07/2026");
    expect(frase).toContain("não mudam quando este termo é impresso de novo");
  });

  // ⚠️ A REDAÇÃO MUDOU A PEDIDO DO DONO DO PRODUTO ("muito formal"); O QUE O CLIENTE ASSUME, NÃO.
  // Cada efeito dos dois blocos do modelo está travado aqui por uma expressão que o diz.
  it("as três regras mantêm todos os efeitos do modelo", () => {
    expect(REGRAS_DO_ACORDO).toHaveLength(3);
    const [cobertura, mensais, inadimplemento] = REGRAS_DO_ACORDO;

    // Manutenção das parcelas mensais regulares.
    expect(cobertura).toContain("cobre só as parcelas em atraso listadas");
    expect(cobertura).toContain("continuam vencendo normalmente e devem ser pagas em dia");
    expect(mensais).toContain("valem as penalidades previstas no contrato");
    expect(mensais).toContain("mesmo que o acordo esteja sendo pago em dia");

    // Inadimplemento do acordo: os cinco efeitos.
    expect(inadimplemento).toContain("o acordo é desfeito");
    expect(inadimplemento).toContain("as condições negociadas deixam de valer");
    expect(inadimplemento).toContain("o débito volta ao valor integral do contrato");
    expect(inadimplemento).toContain("com os encargos previstos nele");
    expect(inadimplemento).toContain("o saldo devedor vence de uma vez");
    expect(inadimplemento).toContain("via administrativa ou judicial");
  });

  it("título único, sem o nome de cartório", () => {
    expect(TITULO_DO_TERMO_DE_ACORDO).toBe("Termo de Acordo");
  });

  // ⚠️ REGRA DA CASA: texto visível não leva travessão, nem o hífen cercado de espaços que faz as
  // vezes dele. A ficha do Hades escreve endereço e unidade assim, e o papel troca por vírgula.
  it("troca o traço separador por vírgula e deixa o hífen colado", () => {
    expect(semTracoSeparador("Rua Inventada - 10 - Centro - Itaúna/MG - CEP 35.680-000")).toBe(
      "Rua Inventada, 10, Centro, Itaúna/MG, CEP 35.680-000",
    );
    expect(semTracoSeparador("Quadra 13 – Lote 01")).toBe("Quadra 13, Lote 01");
  });

  it("a qualificação cabe numa linha e pula o que veio vazio", () => {
    expect(qualificacaoEmUmaLinha(CASO_REAL.comprador)).toBe(
      "Brasileira, Solteiro(a), Analista Jurídico",
    );
    expect(
      qualificacaoEmUmaLinha({ ...CASO_REAL.comprador, estadoCivil: "-", profissao: "" }),
    ).toBe("Brasileira");
  });
});

describe("a disposição das tabelas na folha", () => {
  const linhas = (quantidade: number) => ({ linhas: Array.from({ length: quantidade }) });

  it("lado a lado enquanto a tabela mais longa couber", () => {
    expect(escolherDisposicao(linhas(6), linhas(12), 400)).toEqual({
      grupos: 1,
      ladoALado: true,
      passo: 11.5,
    });
  });

  it("empilha em três grupos quando lado a lado não cabe", () => {
    expect(escolherDisposicao(linhas(20), linhas(37), 400)).toEqual({
      grupos: 3,
      ladoALado: false,
      passo: 11.5,
    });
  });

  it("e só depois aperta a linha", () => {
    expect(escolherDisposicao(linhas(33), linhas(37), 400)).toEqual({
      grupos: 3,
      ladoALado: false,
      passo: 10,
    });
  });

  it("e, no limite, aperta a linha para 9pt antes de desistir da folha única", () => {
    expect(escolherDisposicao(linhas(42), linhas(37), 400)).toEqual({
      grupos: 3,
      ladoALado: false,
      passo: 9,
    });
  });

  it("devolve null quando nem a forma mais densa cabe", () => {
    expect(escolherDisposicao(linhas(200), linhas(37), 400)).toBeNull();
  });
});

describe("o nome do arquivo", () => {
  it("leva cliente, PV e data da emissão", () => {
    expect(nomeDoArquivoDoTermoDeAcordo(CASO_REAL)).toBe(
      "Termo de Acordo - BELTRANO EXEMPLO FERREIRA SILVA - VDO1301 - 10-07-2026.pdf",
    );
  });
});

describe("a emissão do PDF", () => {
  // ⚠️ UMA PÁGINA É O PEDIDO DO DONO DO PRODUTO (*"tinha que caber tudo em uma pagina somente"*), e
  // vale para o caso pesado, não só para o leve. A contagem é do PDF lido de volta, não de uma conta
  // de altura: se a régua de alguma peça do papel timbrado mudar, é aqui que aparece.
  it.each([
    ["leve", CASO_REAL],
    ["pesado", CASO_PESADO],
  ])("o caso %s cabe em UMA página", async (_rotulo, dados) => {
    const bytes = await montarTermoDeAcordoPdf(dados);
    const documento = await PDFDocument.load(bytes);

    expect(documento.getPageCount()).toBe(1);
  });

  // ⚠️ O PIOR CASO QUE JÁ EXISTE NO C2X, COM FOLGA: em 16/09/2026 a venda com mais vencidas tinha 33,
  // e ganha uma por mês. Ficha longa, 42 em atraso e as 37 parcelas que a tela permite: uma folha.
  it("a ficha longa com 42 em atraso e 37 no acordo ainda cabe em UMA página", async () => {
    const emAtraso = Array.from({ length: 42 }, (_, indice) => ({
      numero: `${indice + 1}/144`,
      valor: 1234.56,
      vencimento: "10/03/2026",
    }));
    const bytes = await montarTermoDeAcordoPdf({
      ...CASO_PESADO,
      comprador: {
        ...CASO_PESADO.comprador,
        nome: `${CASO_PESADO.comprador.nome} BITTENCOURT DOS SANTOS FILHA`,
      },
      debito: { ...CASO_PESADO.debito, parcelas: emAtraso, valorAtualizado: 13444.12 },
      parcelasDoAcordo: Array.from({ length: 37 }, (_, indice) => ({
        valor: indice === 0 ? 1000 : 345.67,
        vencimento: "10/10/2026",
      })),
    });

    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    const texto = textoDoPdf(bytes);
    expect(texto).toContain("42/144");
    expect(texto).toContain("37/37");
  });

  // ⚠️ "NÃO PRECISA COLOCAR QUEM ASSINA" (dono do produto, 16/09/2026): nem nome, nem cargo, nem o
  // fecho com cidade e data. `blocoDeAssinatura` continua no papel timbrado para quando voltar.
  it("sai sem bloco de assinatura e sem o fecho com cidade", async () => {
    const texto = textoDoPdf(await montarTermoDeAcordoPdf(CASO_PESADO));

    // A leitura funciona: o que tem de estar, está.
    expect(texto).toContain("Termo de Acordo");
    expect(texto).toContain("Débito apurado em 15/09/2026");
    expect(texto).toContain("CPF 987.654.321-00");
    expect(texto).toContain("Quadra 06, Lote 10 (RPA0610)");
    expect(texto).toContain("R$ 6.500,01");
    expect(texto).toContain("congelado em 15/09/2026");
    expect(texto).toContain("Total do acordo");

    // E o que saiu, saiu.
    expect(texto).not.toMatch(/Belo Horizonte|Atenciosamente|Diretora|Nívea/);
    expect(texto).not.toMatch(/INSTRUMENTO PARTICULAR/i);
  });

  it("nenhum texto visível leva travessão nem traço separador", async () => {
    const texto = textoDoPdf(await montarTermoDeAcordoPdf(CASO_PESADO));

    expect(texto).not.toMatch(/[–—]| - /);
  });

  // ⚠️ AS PARCELAS DO ACORDO IMPRESSAS FECHAM COM O VALOR DO ACORDO: 11 × R$ 541,67 + a última.
  it("a última parcela impressa é a que fecha o centavo", async () => {
    const texto = textoDoPdf(await montarTermoDeAcordoPdf(CASO_PESADO));

    expect(texto).toContain("12/12");
    expect(texto).toContain("R$ 541,64");
    expect(texto).toContain("a última de R$ 541,64, até 10/09/2027");
  });

  // ⚠️ O ACENTO É O QUE DERRUBA GERAÇÃO DE PDF NESTA CASA (StandardFonts é WinAnsi). O nome com
  // "ç", o endereço com "º" e a profissão com "í" passam pelo `limpar` da régua.
  it("não estoura com acento, cedilha e ordinal", async () => {
    const bytes = await montarTermoDeAcordoPdf({
      ...CASO_REAL,
      comprador: {
        ...CASO_REAL.comprador,
        nome: "MARIA DA CONCEIÇÃO ANDRÉ",
        profissao: "Técnica em Edificações",
      },
    });

    expect(bytes.byteLength).toBeGreaterThan(5000);
  });

  // ⚠️ ACIMA DO LIMITE O TERMO SAI EM MAIS DE UMA FOLHA, E NÃO SEM PARCELA. Nenhuma parcela em atraso
  // pode sumir do papel que diz quais parcelas o acordo cobre.
  it("com parcelas demais, transborda para a segunda folha sem perder nenhuma", async () => {
    const muitas = Array.from({ length: 90 }, (_, indice) => ({
      numero: `${indice + 1}/144`,
      valor: 100,
      vencimento: "10/03/2026",
    }));
    const bytes = await montarTermoDeAcordoPdf({
      ...CASO_PESADO,
      debito: { ...CASO_PESADO.debito, parcelas: muitas },
    });

    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
    const texto = textoDoPdf(bytes);
    expect(texto).toContain("90/144");
    expect(texto).toContain("R$ 9.000,00");
  });
});
