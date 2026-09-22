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
  totais?: { anuais?: unknown; entrada?: unknown; geral?: unknown; mensais?: unknown } | null;
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
      total: numero(totais.mensais) ?? somaDe(mensais),
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
      total: numero(totais.anuais) ?? somaDe(anuais),
      valor: valorDaSerie(anuais),
      vencimento: dataBr(anuais[0]?.vencimento),
    });
  }

  // ⚠️ O TOTAL SEGUE AS LINHAS QUANDO A COMISSÃO SAIU. `totais.geral` é o negociado cheio, e
  // repeti-lo embaixo de uma entrada já líquida faria a coluna não fechar com a soma da própria
  // tabela — exatamente a contradição que o contrato do VOL trouxe de volta do jurídico.
  const somaDasLinhas = linhas.reduce((soma, linha) => soma + (linha.total ?? 0), 0);
  const totalGeral = abatimento === null ? numero(totais.geral) ?? somaDasLinhas : somaDasLinhas;

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
