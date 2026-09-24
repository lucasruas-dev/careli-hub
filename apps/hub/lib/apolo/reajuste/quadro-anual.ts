import { periodicidadeDaTaxa } from "@/lib/apolo/periodicidade-da-taxa";
import { parcelaDoCicloSacoc } from "@/lib/apolo/planos-comerciais";
import { mesAnterior, type SerieMensal } from "@/lib/apolo/reajuste/serie-de-indice";

// O QUADRO ANUAL DA PARCELA — amortização, juros e correção, ciclo a ciclo, do contrato inteiro.
//
// Lucas (24/09/2026): *"pode trazer o quadro desde a primeira parcela, além disso aplicar os juros,
// e apontar o crescimento do juros e da correção. a ideia é tipo, jan-dez 2024 - parcela x - juros
// x - ipca x - valor parcela x"*. E sobre o escopo: *"não quero saber se recebemos ou não esses
// valores. quero montar um relatório que mostra essa evolução das parcelas calculando os juros e a
// correção"*.
//
// ⚠️ A REGRA NÃO É MINHA: É A QUE AJUSTOU A LAVRA DO OURO. Lucas: *"estuda o cálculo que fizemos
// para ajustar as parcelas do lavra do ouro, funcionou perfeitamente"*. Decodificada da planilha da
// Nívea e validada em 26/08/2026 (297 de 308 aplicados exatos; 15 de 15 personalizados). Ela tem
// três peças, e as três estão aqui:
//
//   1. TAXA DO ANO = ÍNDICE + JUROS DO CONTRATO, EM SOMA SIMPLES. Não são dois degraus separados:
//      correção e juros entram JUNTOS numa taxa só. (Eu tinha feito dois degraus multiplicados, e
//      errava a parcela de todo contrato SACOC.)
//   2. TAXA AO MÊS = (1 + taxa do ano)^(1/12) − 1, TRUNCADA em 7 casas, e a parcela TRUNCADA no
//      centavo. Truncar e não arredondar é medido: R$ 477,98 existe em 69 contratos e R$ 477,99 em
//      nenhum.
//   3. A CURVA SACOC DA CASA: a parcela do primeiro ano é só a amortização; os juros teóricos de
//      cada ano são cobrados, diluídos, no ano seguinte. Essa curva mora em
//      `parcelaDoCicloSacoc` (planos-comerciais.ts), a MESMA que o gerador de proposta usa — o
//      papel que o comprador assina e o relatório que ele recebe depois não podem ter duas curvas.
//
// ⚠️ O CÁLCULO NÃO DEPENDE DO CAMINHO: cada ciclo sai da amortização original com a taxa daquele
// aniversário. É assim que a planilha da Lavra faz, e foi assim que ela bateu.
//
// ⚠️ A DECOMPOSIÇÃO É A DIFERENÇA ENTRE DUAS CURVAS. A parcela do ciclo é a curva com
// (índice + juros); a parte de JUROS é a mesma curva só com os juros; a CORREÇÃO é o que sobra.
// Amortização + juros + correção fecha com a parcela a centavo, por construção.
//
// ⚠️ PRICE É OUTRA REGRA (Lucas, 24/09/2026: *"price sim, o juro já está embutido... somente da
// correção do índice"*): a parcela já traz os juros, e o aniversário aplica SÓ o índice, acumulado.
//
// ⚠️ O ANIVERSÁRIO É O DO CONTRATO, E O ÍNDICE É O DOS 12 MESES ATÉ ELE (Lucas, 24/09/2026: *"o
// índice a gente olha mês a mês, para aplicá-lo no aniversário. Sempre aniversário do contrato"*).
// A data é a do ato (`acquisition_requests.act_date`), e o ciclo NÃO é "12 parcelas a partir da
// primeira": no LOS0617 o contrato é de 02/08/2024 e a primeira parcela vence em 20/09/2024, então o
// primeiro ciclo tem 11 parcelas e o reajuste entra na de agosto/2025. Cada parcela cai no ciclo pela
// DATA de vencimento contra a data de aniversário.
//
// ⚠️ OS 4,26% DO LOTE DA LAVRA NÃO SÃO A REGRA. Foi o IPCA de 2025 fechado, usado para zerar o
// atraso de uma vez em agosto de 2026. A regra é o acumulado mês a mês até o aniversário — e por isso
// o LOS0617 sai aqui com R$ 484,00 no 1º reajuste (IPCA 5,13% até ago/2025), e não com os R$ 481,94
// que o lote lançou.
//
// ⚠️ ISTO É A CONTA DO CONTRATO, NÃO A DO CAIXA. O quadro não olha se a parcela foi paga nem se o
// reajuste foi lançado no C2X — e medimos que a agenda de reajuste do legado nunca rodou (0 de 360).

export type SistemaDeAmortizacao = "price" | "sacoc";

export type OrigemDoIndice =
  /** O primeiro ciclo: ainda não houve aniversário. */
  | "sem-reajuste"
  /** Os 12 meses do índice já saíram. É fato. */
  | "publicado"
  /** Pelo menos um dos 12 meses é estimado pelo cenário. É palpite. */
  | "estimado"
  /** O contrato não tem correção monetária. */
  | "sem-correcao"
  /** O contrato tem índice, mas a série não pôde ser lida. A correção NÃO entrou. */
  | "indisponivel";

export type LinhaDoQuadro = {
  ciclo: number;
  /** "AAAAMM" do primeiro e do último vencimento do ciclo. */
  de: string;
  ate: string;
  deParcela: number;
  ateParcela: number;
  /** A amortização: a parcela de origem, que não muda. */
  amortizacao: number;
  /** A parte da parcela que é JUROS do contrato. */
  juros: number;
  /** A parte da parcela que é CORREÇÃO do índice. */
  correcao: number;
  /** A parcela do ciclo: amortização + juros + correção. */
  parcela: number;
  /** O índice acumulado de 12 meses usado neste aniversário, em %. */
  indicePct: number;
  /** A taxa do ano aplicada: índice + juros, em soma simples. */
  taxaDoAnoPct: number;
  totalDoCiclo: number;
  origem: OrigemDoIndice;
};

export type QuadroAnual = {
  linhas: LinhaDoQuadro[];
  /** A taxa de juros do contrato, efetiva ao ano (0 na PRICE, porque lá ela já está na parcela). */
  jurosAnualPct: number;
  sistema: SistemaDeAmortizacao;
  /** Soma de todas as parcelas do contrato, no cenário. */
  totalDoContrato: number;
  /** `amortizacao × prazo + totalDeJuros + totalDeCorrecao = totalDoContrato`. */
  totalDeAmortizacao: number;
  totalDeJuros: number;
  totalDeCorrecao: number;
};

/** "AAAAMM" + n meses. */
export function somarMeses(aaaamm: string, meses: number): string {
  const total = Number(aaaamm.slice(0, 4)) * 12 + (Number(aaaamm.slice(4, 6)) - 1) + meses;
  return `${Math.floor(total / 12)}${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * Uma data 'YYYY-MM-DD' andada `meses` meses, como chave comparável (AAAAMMDD).
 *
 * O dia fica o original: a comparação só importa quando parcela e aniversário caem no MESMO mês, e
 * aí é o dia que decide se a parcela já pega o reajuste.
 */
function chaveDaData(data: string, meses: number): number {
  const ano = Number(data.slice(0, 4));
  const mes = Number(data.slice(5, 7));
  const dia = Number(data.slice(8, 10)) || 1;
  const total = ano * 12 + (mes - 1) + meses;
  return Math.floor(total / 12) * 10000 + ((total % 12) + 1) * 100 + dia;
}

/** "AAAAMM" de uma chave AAAAMMDD. */
function mesDaChave(chave: number): string {
  return String(Math.floor(chave / 100));
}

/**
 * Trunca no centavo, como a planilha da Lavra. ⚠️ O `|| 0` mata o zero negativo, que o
 * `toLocaleString` imprime como "-R$ 0,00".
 */
function truncarCentavos(valor: number): number {
  // O `+ 1e-9` absorve o ruído de ponto flutuante: 477.98 guardado como 477.97999999 truncaria para
  // 477.97, que é exatamente o centavo que a planilha NÃO produz.
  return Math.floor(valor * 100 + 1e-9) / 100 || 0;
}

function centavos(valor: number): number {
  return Math.round(valor * 100) / 100 || 0;
}

/**
 * A taxa do contrato, convertida para efetiva ao ANO.
 *
 * ⚠️ O C2X NÃO DIZ A UNIDADE: 8.0000 é ao ano (Lavra do Ouro) e 0.6434 é ao mês (Villa Paris), a
 * mesma taxa econômica gravada de dois jeitos. A régua é a da casa (`periodicidadeDaTaxa`, corte em
 * 2), a mesma que o extrato e o cadastro de planos usam — e o mensal vira anual por composição.
 */
export function jurosAnualDoContrato(taxaCrua: null | number | undefined): number {
  const taxa = Number(taxaCrua ?? 0);
  if (!Number.isFinite(taxa) || taxa <= 0) return 0;
  return periodicidadeDaTaxa(taxa) === "anual" ? taxa : ((1 + taxa / 100) ** 12 - 1) * 100;
}

/**
 * A taxa AO MÊS de um aniversário, pela regra da Lavra: (índice + juros) em soma simples, mensalizada
 * composta e TRUNCADA em 7 casas.
 */
export function taxaMensalDoAniversario(jurosAnualPct: number, indicePct: number): number {
  const anual = (jurosAnualPct + indicePct) / 100;
  if (anual <= -1) return 0;
  const mensal = (1 + anual) ** (1 / 12) - 1;
  return Math.floor(mensal * 1e7) / 1e7;
}

/**
 * O sistema do contrato, deduzido da própria parcela.
 *
 * O C2X não guarda o sistema de amortização. Mas as duas regras deixam assinatura: na SACOC a
 * parcela é o financiado dividido pelo prazo; na PRICE ela já tem juro, e é bem maior. Medido em
 * 24/09/2026, 797 de 850 contratos batem com a SACOC e 1 com a PRICE. Na dúvida (sem preço, sem
 * entrada, ou nenhum dos dois encaixa), vale a SACOC, que é a regra da carteira.
 */
export function sistemaDoContrato(input: {
  financiado: null | number;
  jurosAnualPct: number;
  parcela: number;
  prazo: number;
}): SistemaDeAmortizacao {
  const { financiado, jurosAnualPct, parcela, prazo } = input;
  if (!financiado || !(financiado > 0) || !(prazo > 0) || !(parcela > 0) || jurosAnualPct <= 0) {
    return "sacoc";
  }
  const i = (1 + jurosAnualPct / 100) ** (1 / 12) - 1;
  const price = (financiado * i) / (1 - (1 + i) ** -prazo);
  const nominal = financiado / prazo;
  const erroPrice = Math.abs(price - parcela) / parcela;
  const erroNominal = Math.abs(nominal - parcela) / parcela;
  return erroPrice < 0.02 && erroPrice < erroNominal ? "price" : "sacoc";
}

/**
 * O índice acumulado dos 12 meses que terminam em `ate`, mês a mês: o que já saiu vem da série, o
 * que ainda não saiu vem do mês típico do cenário.
 */
function indiceDoAniversario(
  serie: SerieMensal,
  ate: string,
  mesTipicoPct: number,
): { estimado: boolean; pct: number } {
  let fator = 1;
  let estimado = false;
  let cursor = ate;
  for (let i = 0; i < 12; i += 1) {
    const publicado = serie.get(cursor);
    if (publicado == null) {
      estimado = true;
      fator *= 1 + mesTipicoPct / 100;
    } else {
      fator *= 1 + publicado / 100;
    }
    cursor = mesAnterior(cursor);
  }
  return { estimado, pct: (fator - 1) * 100 };
}

/**
 * Monta o quadro do contrato inteiro, da primeira à última parcela, num cenário.
 *
 * ⚠️ O ÍNDICE DE CADA ANIVERSÁRIO é o acumulado dos 12 meses que terminam NO MÊS do aniversário
 * do contrato, mês a mês, como a Lavra fez. Quando um desses meses ainda não foi publicado, entra
 * o mês típico do cenário, e a linha sai marcada como estimada.
 *
 * @param correcao Quando o contrato não tem correção (`"sem-correcao"`) ou a série não pôde ser
 *   lida (`"indisponivel"`). Nos dois casos o índice fica em zero e a linha diz por quê — a tela e o
 *   papel NÃO podem apresentar zero como se fosse índice.
 */
export function montarQuadroAnual(input: {
  correcao?: "indisponivel" | "sem-correcao";
  jurosAnualPct: number;
  /** % ao mês do cenário, para os meses que ainda não foram publicados. */
  mesTipicoPct: number;
  /**
   * 'YYYY-MM-DD' do CONTRATO (o ato): é daqui que contam os aniversários. Sem ela, a conta cai no
   * primeiro vencimento — que é o que se fazia antes e erra o ciclo em um mês na Lavra.
   */
  dataDoContrato: null | string;
  /** A parcela de origem: na SACOC é a amortização; na PRICE, a parcela com juros. */
  parcelaBase: number;
  prazo: number;
  /** 'YYYY-MM-DD' do vencimento da primeira mensal. */
  primeiroVencimento: string;
  serie: null | SerieMensal;
  sistema: SistemaDeAmortizacao;
}): QuadroAnual {
  const { jurosAnualPct, mesTipicoPct, parcelaBase, prazo, primeiroVencimento, serie, sistema } =
    input;

  const amortizacao = centavos(parcelaBase);
  // A curva SACOC recebe o FINANCIADO; montá-lo a partir da amortização garante que a primeira
  // parcela da curva é exatamente a parcela que o contrato emite.
  const financiado = amortizacao * prazo;
  const jurosDoContrato = sistema === "price" ? 0 : jurosAnualPct;

  const linhas: LinhaDoQuadro[] = [];
  let totalDoContrato = 0;
  let totalDeJuros = 0;
  let totalDeCorrecao = 0;
  // Na PRICE a correção se ACUMULA de aniversário em aniversário (não há curva para refazer).
  let fatorPrice = 1;

  // ── Em que ciclo cai cada parcela: pela DATA de vencimento contra a data de aniversário ──────
  const aniversario = input.dataDoContrato ?? primeiroVencimento;
  const cicloDaParcela: number[] = [];
  let cicloAtual = 1;
  for (let n = 1; n <= prazo; n += 1) {
    const vence = chaveDaData(primeiroVencimento, n - 1);
    while (vence >= chaveDaData(aniversario, 12 * cicloAtual)) cicloAtual += 1;
    cicloDaParcela.push(cicloAtual);
  }

  const ciclos = cicloDaParcela.at(-1) ?? 0;
  for (let ciclo = 1; ciclo <= ciclos; ciclo += 1) {
    const doCiclo = cicloDaParcela
      .map((c, indice) => (c === ciclo ? indice + 1 : 0))
      .filter((n) => n > 0);
    // Um ciclo sem parcela nenhuma acontece quando o contrato pula um aniversário inteiro sem
    // vencimento (carência longa). Não vira linha: não há o que pagar nele.
    if (doCiclo.length === 0) continue;

    const deParcela = doCiclo[0] ?? 1;
    const ateParcela = doCiclo.at(-1) ?? deParcela;
    const quantas = doCiclo.length;
    const de = mesDaChave(chaveDaData(primeiroVencimento, deParcela - 1));
    const ate = mesDaChave(chaveDaData(primeiroVencimento, ateParcela - 1));

    let origem: OrigemDoIndice = "sem-reajuste";
    let indicePct = 0;
    if (ciclo > 1) {
      if (input.correcao) {
        origem = input.correcao;
      } else if (serie) {
        // Os 12 meses que terminam NO MÊS do aniversário que abriu este ciclo.
        const mesDoAniversario = mesDaChave(chaveDaData(aniversario, 12 * (ciclo - 1)));
        const indice = indiceDoAniversario(serie, mesDoAniversario, mesTipicoPct);
        indicePct = indice.pct;
        origem = indice.estimado ? "estimado" : "publicado";
      } else {
        origem = "indisponivel";
      }
    }

    let parcela: number;
    let soJuros: number;

    if (sistema === "price") {
      // O juro já mora na parcela: só a correção, acumulada.
      if (ciclo > 1) fatorPrice *= 1 + indicePct / 100;
      soJuros = amortizacao;
      parcela = truncarCentavos(amortizacao * fatorPrice);
    } else {
      // A MESMA curva duas vezes: com (índice + juros) e só com os juros. A diferença é a correção.
      const mComTudo = taxaMensalDoAniversario(jurosDoContrato, indicePct);
      const mSoJuros = taxaMensalDoAniversario(jurosDoContrato, 0);
      parcela = truncarCentavos(parcelaDoCicloSacoc(financiado, mComTudo, prazo, ciclo));
      soJuros = truncarCentavos(parcelaDoCicloSacoc(financiado, mSoJuros, prazo, ciclo));
    }

    const juros = centavos(soJuros - amortizacao);
    const correcao = centavos(parcela - soJuros);
    const totalDoCiclo = centavos(parcela * quantas);

    totalDoContrato += totalDoCiclo;
    totalDeJuros += juros * quantas;
    totalDeCorrecao += correcao * quantas;

    linhas.push({
      amortizacao,
      ate,
      ateParcela,
      ciclo,
      correcao,
      de,
      deParcela,
      indicePct,
      juros,
      origem,
      parcela,
      taxaDoAnoPct: ciclo > 1 ? jurosDoContrato + indicePct : 0,
      totalDoCiclo,
    });
  }

  return {
    jurosAnualPct: jurosDoContrato,
    linhas,
    sistema,
    totalDeAmortizacao: centavos(amortizacao * prazo),
    totalDeCorrecao: centavos(totalDeCorrecao),
    totalDeJuros: centavos(totalDeJuros),
    totalDoContrato: centavos(totalDoContrato),
  };
}
