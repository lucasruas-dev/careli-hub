// O QUADRO DE PAGAMENTO DO CONTRATO — a variável `[tabela_geral_pagamentos]`.
//
// Lucas (20/09/2026), gerando o contrato do Vale do Ouro: *"Falta a tabela de pagamentos"*, e depois
// de trocar o nome na minuta: *"mudamos a variavel e mesmo assim não veio a tabela"*.
//
// ⚠️ A VARIÁVEL EXISTIA NO CATÁLOGO E NINGUÉM A MONTAVA. O grupo "gerado" (`paragrafo_sinal`,
// `paragrafo_parcelamento`, `paragrafo_vencimento`, `tabela_pagamentos` e `tabela_geral_pagamentos`)
// estava declarado em `variaveis.ts` e escrito nos blocos prontos, mas `dados-do-contrato.ts` nunca
// produziu nenhum deles: o contrato saía com o colchete no papel e a geração travava, porque
// variável sem valor bloqueia o documento. Trocar `tabela_pagamentos` por `tabela_geral_pagamentos`
// não mudava nada — os dois estavam igualmente vazios.
//
// ⚠️ E O QUADRO É UMA TABELA DE VERDADE, não texto com espaços. O motor de variáveis só sabe virar
// TEXTO (`textoDaVariavel`), então este módulo devolve NÓS do documento e `preencherContrato` troca
// o parágrafo inteiro por eles. Texto alinhado com espaços vira uma coluna torta no PDF, e a tabela
// do contrato é peça que o cliente confere número a número.
//
// ⚠️ A FONTE É O CRONOGRAMA QUE A PROPOSTA CONGELOU (`hercules_propostas.condicoes`), e não uma
// conta nova. O que o contrato promete tem de ser exatamente o que o simulador mostrou e o PDF da
// proposta imprimiu. Proposta importada do C2X não tem cronograma: aí o quadro não existe, a
// variável fica em branco e a conferência da Têmis acusa — melhor do que uma tabela inventada.
import { INDICES, type IndiceCorrecao } from "@/lib/apolo/planos-comerciais";

import type { NoDoDocumento } from "./documento-html";

/** Uma parcela como o cronograma da proposta a guarda. */
type ParcelaGravada = {
  numero?: unknown;
  total?: unknown;
  valor?: unknown;
  vencimento?: unknown;
};

type CondicoesGravadas = {
  anuais?: unknown;
  entrada?: unknown;
  mensais?: unknown;
  plano?: {
    indiceCorrecao?: unknown;
    jurosPeriodicidade?: unknown;
    jurosTaxa?: unknown;
  } | null;
  totais?: {
    anuais?: unknown;
    entrada?: unknown;
    financiado?: unknown;
    geral?: unknown;
    mensais?: unknown;
  } | null;
};

type LinhaDoQuadro = {
  correcao: string;
  juros: string;
  quantidade: number;
  tipo: string;
  total: null | number;
  valor: string;
  vencimento: string;
};

const CABECALHO = ["Parcela", "Correção", "Juros", "1º vencimento", "Qtde.", "Valor", "Total"];

/**
 * O quadro geral de pagamentos, pronto para entrar no documento.
 *
 * Devolve `null` quando não há cronograma: sem parcela não há quadro.
 */
export function tabelaGeralDePagamentos(
  condicoes: unknown,
  comissaoEmCentavos: null | number = null,
): NoDoDocumento | null {
  const dados = (condicoes ?? null) as CondicoesGravadas | null;
  if (!dados) return null;

  const entrada = parcelas(dados.entrada);
  const mensais = parcelas(dados.mensais);
  const anuais = parcelas(dados.anuais);
  if (entrada.length === 0 && mensais.length === 0 && anuais.length === 0) return null;

  const correcao = rotuloDoIndice(dados.plano?.indiceCorrecao);
  const juros = rotuloDosJuros(dados.plano?.jurosTaxa, dados.plano?.jurosPeriodicidade);
  const totais = dados.totais ?? {};

  // ⚠️ O QUADRO DESTE CONTRATO É O DO LOTEADOR, e a comissão sai dele.
  //
  // Lucas (22/09/2026): *"o fluxo da tabela deve trazer somente o valor do incorporador, ou seja, o
  // valor do lote negociado menos o valor de comissão, pois temos o contrato de corretagem que traz
  // o valor de comissão. os dois valores é o valor negociado do lote, mas eles são separados nos
  // contratos"*. Nívea, no mesmo dia: *"o fluxo do sinal deve ser da incorporadora"*.
  //
  // ⚠️ E SAI DA ENTRADA, NÃO DAS MENSAIS. É o que o próprio contrato promete em cláusula: a
  // corretagem "será paga em conformidade com o fluxo financeiro das parcelas de SINAL/ATO". As
  // mensais amortizam o preço do lote inteiras.
  //
  // ⚠️ PROPORCIONAL ENTRE AS PARCELAS DE ENTRADA, com o resto no último centavo. Jogar a comissão
  // toda na primeira parcela faria a Entrada 1 despencar (às vezes para baixo de zero) enquanto as
  // seguintes seguiriam cheias — o quadro passaria a descrever um fluxo que ninguém combinou.
  const abatimento = abaterDaEntrada(entrada, comissaoEmCentavos);

  // ⚠️ AS SÉRIES FINANCIADAS SAEM PELO NOMINAL, NÃO PELA PROJEÇÃO DO ÍNDICE.
  //
  // Nívea (22/09/2026), vendo o quadro com a projeção: *"não dá para ter a tabela com a projeção
  // dos juros"*. Lucas, no mesmo contrato: *"aplicando tabela price em que devia colocar sacoc"*.
  //
  // ⚠️ E O MOTIVO ESTÁ NO CONTRATO DO VILLA PARIS, que é o desenho que o jurídico já usa. Lido no
  // C2X em 22/09/2026 (venda 4834, RVPA01): a linha MENSAL diz 180 parcelas de R$ 1.195,00 e total
  // de R$ 215.100,00 — e 180 x 1.195,00 dá exatamente R$ 215.100,00. A correção e os juros não
  // entram nos valores: eles são DECLARADOS nas colunas ("IPCA ANUAL", "0,64%") e detalhados no
  // item VII. O quadro inteiro soma R$ 222.270,00, que é o próprio 6.1 PREÇO DO LOTE.
  //
  // ⚠️ O QUE O QUADRO FAZIA ATÉ AQUI NÃO FECHAVA COM NADA. A linha mensal do VOL anunciava 156
  // parcelas de R$ 770,49 e um total de R$ 204.417,00, que é a soma do cronograma COM o IPCA
  // projetado: quem multiplicasse achava R$ 120.196,44 e um buraco de R$ 84 mil. Pelo nominal, a
  // mesma venda fecha em 5.342,04 + 120.195,90 = R$ 125.537,94, que é o 6.1 impresso logo acima.
  //
  // ⚠️ E O NOMINAL VEM DE `totais.financiado`, não de `quantidade x valor`. A parcela impressa é
  // arredondada (120.195,90 / 156 = 770,4865 vira R$ 770,49), e multiplicar a parcela arredondada
  // devolveria R$ 120.196,44 — 54 centavos a mais do que o preço que o próprio contrato promete
  // duas linhas acima. Entre a coluna multiplicar na ponta do lápis e o documento não se
  // contradizer, a casa escolhe não se contradizer.
  const financiado = numero(totais.financiado);
  const nominais = nominalDasSeries([mensais, anuais], financiado);

  const linhas: LinhaDoQuadro[] = [];

  // ⚠️ A ENTRADA NÃO LEVA CORREÇÃO NEM JUROS, e isso não é omissão: ela é paga à vista ou em poucas
  // parcelas dentro do mesmo fluxo, antes de existir saldo devedor. Repetir o IPCA na linha dela
  // faria o contrato prometer correção sobre um valor que ninguém corrige.
  // ⚠️ A ENTRADA VAI UMA LINHA POR PARCELA, cada uma com o seu vencimento. É o desenho do quadro
  // que o jurídico já usa (Lucas, 22/09/2026, com o modelo na mão), onde as três parcelas de
  // abertura aparecem separadas porque têm datas e valores próprios. O nome é ENTRADA, e não
  // "sinal": *"nao gosto da palavra sinal, acho que 1 Entrada, ou algo do tipo"*.
  //
  // ⚠️ A ENTRADA NÃO LEVA CORREÇÃO NEM JUROS, e isso não é omissão: ela é paga à vista ou em poucas
  // parcelas dentro do mesmo fluxo, antes de existir saldo devedor. Repetir o IPCA na linha dela
  // faria o contrato prometer correção sobre um valor que ninguém corrige.
  entrada.forEach((parcela, i) => {
    const valor = abatimento === null ? numero(parcela.valor) : abatimento[i] ?? null;
    linhas.push({
      correcao: "—",
      juros: "—",
      quantidade: 1,
      tipo: entrada.length > 1 ? `Entrada ${i + 1}` : "Entrada",
      total: valor,
      valor: valor === null ? "—" : dinheiro(valor),
      vencimento: dataBr(parcela.vencimento),
    });
  });

  if (mensais.length > 0) {
    linhas.push({
      correcao,
      juros,
      quantidade: quantidadeDaSerie(mensais),
      tipo: "Mensal",
      total: nominais[0] ?? null,
      valor: valorDaSerie(mensais),
      vencimento: dataBr(mensais[0]?.vencimento),
    });
  }

  if (anuais.length > 0) {
    linhas.push({
      correcao,
      juros,
      quantidade: quantidadeDaSerie(anuais),
      tipo: "Anual",
      total: nominais[1] ?? null,
      valor: valorDaSerie(anuais),
      vencimento: dataBr(anuais[0]?.vencimento),
    });
  }

  // ⚠️ O TOTAL É SEMPRE A SOMA DAS LINHAS, e nunca `totais.geral`.
  //
  // `totais.geral` é o cronograma inteiro com o índice projetado (R$ 217.772,10 na venda da
  // VITORIA): ele não fecha nem com a entrada já líquida de corretagem, nem com as séries pelo
  // nominal. Um rodapé que não soma as linhas que estão logo acima dele é o defeito mais fácil de
  // achar com uma calculadora, e foi assim que o quadro voltou do jurídico em 22/09/2026.
  //
  // Somando as linhas, o rodapé vira o 6.1 PREÇO DO LOTE quando há comissão a abater
  // (R$ 125.537,94) e o próprio valor negociado quando não há (R$ 133.551,00). Nos dois casos ele
  // é um número que o contrato repete em outro lugar, que é o que se espera de um quadro-resumo.
  const totalGeral = linhas.reduce((soma, linha) => soma + (linha.total ?? 0), 0);

  return {
    children: [
      linhaDaTabela(CABECALHO, true),
      ...linhas.map((linha) =>
        linhaDaTabela([
          linha.tipo,
          linha.correcao,
          linha.juros,
          linha.vencimento,
          String(linha.quantidade),
          linha.valor,
          linha.total === null ? "—" : dinheiro(linha.total),
        ]),
      ),
      // A última linha fecha a conta: é o número que o comprador procura primeiro.
      {
        children: [
          celula("Total", { colSpan: CABECALHO.length - 1, negrito: true }),
          celula(dinheiro(totalGeral), { negrito: true }),
        ],
        type: "tr",
      },
    ],
    type: "table",
  };
}

/**
 * A entrada, parcela a parcela, já sem a comissão de corretagem.
 *
 * Devolve `null` quando não há o que abater — e é `null` também no caso anômalo em que a comissão
 * alcança a entrada inteira. Um quadro com entrada zerada (ou negativa) descreve um negócio que não
 * existe e esconde o defeito do cadastro atrás de um número plausível; melhor o quadro cheio, que
 * bate com a proposta e deixa a divergência visível para quem confere.
 */
function abaterDaEntrada(
  entrada: readonly ParcelaGravada[],
  comissaoEmCentavos: null | number,
): null | number[] {
  if (comissaoEmCentavos === null || comissaoEmCentavos <= 0 || entrada.length === 0) return null;

  const valores = entrada.map((parcela) => numero(parcela.valor));
  if (valores.some((v) => v === null)) return null;

  const centavos = valores.map((v) => Math.round((v as number) * 100));
  const totalEmCentavos = centavos.reduce((soma, c) => soma + c, 0);
  if (totalEmCentavos <= comissaoEmCentavos) return null;

  // Proporcional ao peso de cada parcela; o resto da divisão cai na última, que é a que fecha.
  const liquidos = centavos.map((c) =>
    c - Math.round((comissaoEmCentavos * c) / totalEmCentavos),
  );
  const alvo = totalEmCentavos - comissaoEmCentavos;
  const sobra = alvo - liquidos.reduce((soma, c) => soma + c, 0);
  const ultima = liquidos.length - 1;
  liquidos[ultima] = (liquidos[ultima] ?? 0) + sobra;

  return liquidos.map((c) => c / 100);
}

function linhaDaTabela(valores: readonly string[], cabecalho = false): NoDoDocumento {
  return {
    children: valores.map((valor) => celula(valor, { cabecalho, negrito: cabecalho })),
    type: "tr",
  };
}

function celula(
  texto: string,
  opcoes: { cabecalho?: boolean; colSpan?: number; negrito?: boolean } = {},
): NoDoDocumento {
  return {
    children: [{ children: [{ bold: opcoes.negrito || undefined, text: texto }], type: "p" }],
    ...(opcoes.colSpan && opcoes.colSpan > 1 ? { colSpan: opcoes.colSpan } : {}),
    type: opcoes.cabecalho ? "th" : "td",
  } as NoDoDocumento;
}

/**
 * A série em DEGRAUS: uma linha por faixa de parcelas com o mesmo valor.
 *
 * ⚠️ O CONTRATO DIZIA SACOC E DESENHAVA PRICE. Nívea, 22/09/2026, sobre o contrato do VOL:
 * *"Está gerando tabela PRICE"*; Lucas: *"aplicando tabela price em que devia colocar sacoc"*. A
 * linha "Mensais" anunciava 156 parcelas de R$ 770,49 e, ao lado, um total de R$ 204.417,00 — mas
 * 156 x 770,49 dá R$ 120.196,44. Quem conferisse com a calculadora (e o Lucas conferiu) achava um
 * buraco de R$ 84 mil, porque a coluna mostrava só a PRIMEIRA parcela de uma série que sobe até
 * R$ 2.083,74 com o IPCA anual, e nada no quadro dizia isso.
 *
 * ⚠️ OS NÚMEROS SÃO OS DA PROPOSTA, e nenhum deles é recalculado aqui. Lucas, 22/09/2026: *"a parte
 * da tabela de pagamento, você precisa entender a proposta, ela é a base desses valores,
 * vencimentos"*. Cada degrau sai do cronograma congelado em `hercules_propostas.condicoes`: o valor
 * que se repete, quantas vezes ele se repete, o vencimento da primeira parcela do degrau e a soma
 * real do degrau.
 *
 * ⚠️ SÉRIE DE VALOR ÚNICO CONTINUA EM UMA LINHA SÓ — o plano sem correção cai exatamente no quadro
 * de antes. O degrau não é desenho novo: é o que a série sempre foi.
 *
 * ⚠️ DOIS CASOS VOLTAM À LINHA ÚNICA, de propósito:
 *   • cronograma CORTADO (menos parcelas gravadas do que o prazo contratado): as faixas não
 *     somariam o prazo, e um quadro que não fecha é pior do que um quadro resumido;
 *   • degraus demais (correção mensal daria 156 linhas): o quadro-resumo viraria a tabela inteira.
 */
function emDegraus(
  serie: readonly ParcelaGravada[],
  tipo: string,
  fixos: { correcao: string; juros: string; total: null | number },
): LinhaDoQuadro[] {
  const prazo = quantidadeDaSerie(serie);
  const umaLinha = (): LinhaDoQuadro[] => [
    {
      correcao: fixos.correcao,
      juros: fixos.juros,
      quantidade: prazo,
      tipo,
      total: fixos.total,
      valor: valorDaSerie(serie),
      vencimento: dataBr(serie[0]?.vencimento),
    },
  ];

  if (serie.length !== prazo) return umaLinha();

  const faixas: { primeira: ParcelaGravada; quantidade: number; soma: number; valor: number }[] = [];
  for (const parcela of serie) {
    const valor = numero(parcela.valor);
    if (valor === null) return umaLinha();
    const atual = faixas[faixas.length - 1];
    if (atual && Math.round(atual.valor * 100) === Math.round(valor * 100)) {
      atual.quantidade += 1;
      atual.soma += valor;
      continue;
    }
    faixas.push({ primeira: parcela, quantidade: 1, soma: valor, valor });
  }

  if (faixas.length <= 1 || faixas.length > TETO_DE_DEGRAUS) return umaLinha();

  let numeroDaParcela = 0;
  return faixas.map((faixa) => {
    const de = numeroDaParcela + 1;
    numeroDaParcela += faixa.quantidade;
    return {
      correcao: fixos.correcao,
      juros: fixos.juros,
      quantidade: faixa.quantidade,
      // O intervalo entra no rótulo porque é ele que liga o degrau à parcela do boleto.
      tipo: `${tipo} ${de} a ${numeroDaParcela}`,
      total: Math.round(faixa.soma * 100) / 100,
      valor: dinheiro(faixa.valor),
      vencimento: dataBr(faixa.primeira.vencimento),
    };
  });
}

/**
 * Quantos degraus cabem no quadro-resumo.
 *
 * ⚠️ DEZESSEIS É O PRAZO MAIS LONGO QUE A CASA VENDE, em anos: com correção ANUAL, que é o que
 * todos os planos usam hoje, o degrau é o ano. Passando disso, a correção não é anual e o quadro
 * deixa de ser resumo.
 */
const TETO_DE_DEGRAUS = 16;

/**
 * O valor da série: a PRIMEIRA parcela, sem nenhuma ressalva escrita junto.
 *
 * ⚠️ O "A PARTIR DE" SAIU A PEDIDO DO LUCAS (20/09/2026): *"outra coisa que precisa mudar é tirar o
 * texto a partir de"*. A coluna passa a ser só número. A ressalva que ele carregava continua no
 * quadro, na coluna Correção ("IPCA anual"), e na cláusula VII do contrato, que é onde o reajuste é
 * contratado: a mensal do plano com correção anual sai de R$ 770,49 e chega a R$ 2.083,74 na 156ª.
 */
/**
 * O total NOMINAL de cada série financiada, na ordem em que elas entram.
 *
 * O próprio de cada série é `quantidade x valor da primeira parcela` — a conta que qualquer um
 * refaz na ponta do lápis olhando a linha.
 *
 * ⚠️ COM UMA SÉRIE SÓ, QUEM MANDA É `financiado`. Ele é o saldo que a proposta congelou depois da
 * entrada (na venda da VITORIA, 133.551,00 menos 13.355,10 = R$ 120.195,90) e é o número que fecha
 * com o preço do lote impresso no 6.1. A parcela sai arredondada (120.195,90 / 156 = 770,4865 vira
 * R$ 770,49), e multiplicar a parcela arredondada devolveria R$ 120.196,44: 54 centavos a mais do
 * que o preço que o contrato promete duas linhas acima. Entre a coluna multiplicar exato e o
 * documento não se contradizer, a casa escolhe não se contradizer.
 *
 * ⚠️ COM DUAS SÉRIES, CADA UMA VALE O SEU PRÓPRIO. `financiado` cobre as duas juntas, e reparti-lo
 * proporcionalmente devolveria centavos que não são de ninguém (R$ 9.999,96 onde a proposta diz
 * duas anuais de R$ 5.000,00). O nominal próprio erra por centavos no rodapé e acerta em cada
 * linha, que é onde o comprador confere.
 */
function nominalDasSeries(
  series: readonly (readonly ParcelaGravada[])[],
  financiado: null | number,
): (null | number)[] {
  const proprios = series.map((serie) => {
    if (serie.length === 0) return null;
    const valor = numero(serie[0]?.valor);
    return valor === null ? somaDe(serie) : quantidadeDaSerie(serie) * valor;
  });

  const vivas = proprios.filter((v) => v !== null);
  if (financiado === null || vivas.length !== 1) return proprios;

  return proprios.map((v) => (v === null ? null : financiado));
}

function valorDaSerie(serie: readonly ParcelaGravada[]): string {
  const primeira = numero(serie[0]?.valor);
  return primeira === null ? "—" : dinheiro(primeira);
}

/**
 * Quantas parcelas a série tem.
 *
 * ⚠️ O NÚMERO SAI DO CAMPO `total` DA PARCELA, que é o prazo contratado, e só cai no tamanho da
 * lista quando ele falta. São dois números diferentes: o cronograma gravado pode ter sido cortado
 * (proposta antiga, gravação parcial), e o contrato tem de dizer 156 parcelas mesmo assim.
 */
function quantidadeDaSerie(serie: readonly ParcelaGravada[]): number {
  return numero(serie[0]?.total) ?? serie.length;
}

function parcelas(valor: unknown): ParcelaGravada[] {
  return Array.isArray(valor) ? (valor.filter(Boolean) as ParcelaGravada[]) : [];
}

function somaDe(serie: readonly ParcelaGravada[]): null | number {
  let soma = 0;
  for (const parcela of serie) {
    const valor = numero(parcela.valor);
    if (valor === null) return null;
    soma += valor;
  }
  return soma;
}

function rotuloDoIndice(indice: unknown): string {
  const chave = String(indice ?? "").trim();
  if (!chave || chave === "SEM_CORRECAO") return "sem correção";
  return INDICES[chave as IndiceCorrecao] ?? chave;
}

/** Mesma escrita de `textoDaTaxa` (planos-comerciais): "0,7207% a.m.", sem zero à direita. */
function rotuloDosJuros(taxa: unknown, periodicidade: unknown): string {
  const valor = numero(taxa);
  if (valor === null || valor <= 0) return "sem juros";
  const escrito = String(Number(valor.toFixed(4))).replace(".", ",");
  return `${escrito}% ${String(periodicidade ?? "mensal") === "anual" ? "a.a." : "a.m."}`;
}

function numero(valor: unknown): null | number {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

function dinheiro(valor: number): string {
  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(valor);
}

/** `AAAA-MM-DD` vira `DD/MM/AAAA`. Sem `new Date()`: fuso não pode mover vencimento de contrato. */
function dataBr(valor: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor ?? ""));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
}
