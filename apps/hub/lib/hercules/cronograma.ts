// O FLUXO DE PAGAMENTO DATADO — das condições negociadas para as datas que o comprador lê.
//
// Lucas (04/09/2026), desenhando o "Gerar proposta" em cima do simulador que já existe: *"com a
// data da primeira parcela da entrada as demais segue na data que ele escolheu e de acordo com o
// parcelamento"*, e sobre a entrada: *"lote de 100 mil, entrada de 10%, 10 mil em 2x, é 5 mil dia
// 10/10 e 5 mil dia 10/11"* — partes iguais, sem desconto de valor presente.
//
// ⚠️ POR QUE ISTO NÃO ESTÁ EM `simulacao.ts`. Lá se responde "de quanto é a parcela"; aqui, "em que
// dia ela cai e quanto sai em cada uma". São perguntas diferentes: o simulador trabalha com
// valores presentes e não conhece calendário; o cronograma não recalcula dinheiro nenhum — ele
// reusa `planos-comerciais.ts` e `simulacao.ts` e distribui no tempo.
//
// ⚠️ A MATEMÁTICA NÃO SE REESCREVE AQUI. `parcelaPrice`, `parcelaSacoc`, `primeiraParcelaSac`,
// `parcelaNiveladaSacoc` e `taxaMensal` já foram medidas contra o C2X, contrato a contrato, e já
// têm teste. Uma segunda versão da conta de dinheiro é como a PA e o boleto passam a discordar —
// que é exatamente o problema que `planos-comerciais.ts` foi criado para acabar.
//
// ⚠️ A ENTRADA NÃO TEM VALOR PRESENTE, e é a diferença mais fácil de errar. O balão anual abate o
// saldo descontado (é dinheiro do futuro abatendo saldo de hoje, e a conta é a do simulador —
// `valorPresenteDosBaloes`); a entrada parcelada, não: 10 mil em 2x é 5 mil e 5 mil, porque é
// assim que o comercial vende e é assim que o boleto sai. Descontar a segunda metade encolheria a
// entrada sem que ninguém tivesse negociado isso.
//
// ⚠️ NADA DE `Date.now()`. Cronograma é função de contrato, não de relógio: a mesma proposta,
// reaberta em dezembro, tem que devolver exatamente as mesmas datas que devolveu em outubro.

import {
  type PlanoComercial,
  parcelaNiveladaSacoc,
  parcelaPrice,
  parcelaSacoc,
  primeiraParcelaSac,
  taxaMensal,
} from "@/lib/apolo/planos-comerciais";
import { valorPresenteDosBaloes } from "@/lib/hercules/simulacao";

/** Quantos meses tem um ciclo de reajuste. O aniversário do contrato é anual em toda a casa. */
const MESES_DO_CICLO = 12;

export type ParcelaDoCronograma = {
  /** 1-based, para o "1 de 2" do papel. */
  numero: number;
  /** Quantas parcelas a série tem. */
  total: number;
  valor: number;
  /** `YYYY-MM-DD`. Ver o aviso de fuso em `diaDaData`. */
  vencimento: string;
};

export type FaixaDoCronograma = {
  /** `YYYY-MM-DD` do vencimento da última parcela do ciclo. */
  ate: string;
  /** 1 = primeiro ano de contrato. */
  ciclo: number;
  /** `YYYY-MM-DD` do vencimento da primeira parcela do ciclo. */
  de: string;
  parcelaFinal: number;
  parcelaInicial: number;
  /**
   * ⚠️ A MARCA DO ÍNDICE, e não o índice aplicado. É `true` a partir do primeiro reajuste, e é o
   * que faz o documento imprimir "+ IPCA" ao lado do valor — ver `FaixaDeReajuste` em
   * `proposta-pdf.ts`. O valor da faixa NÃO contém correção monetária nenhuma.
   */
  temIpca: boolean;
  valor: number;
};

export type TotaisDoCronograma = {
  /** O que o comprador desembolsa nas anuais: valor de FACE, somado. Ver `financiado`. */
  anuais: number;
  entrada: number;
  /**
   * Negociado − entrada − VALOR PRESENTE das anuais. É o que a série mensal amortiza.
   *
   * ⚠️ NÃO É `negociado − entrada − anuais`: o balão que cai daqui a três anos não abate saldo de
   * hoje pelo valor de face. Ver o aviso no cálculo, em `montarCronograma`.
   */
  financiado: number;
  /** Tudo o que o comprador desembolsa, somando as três séries. */
  geral: number;
  mensais: number;
};

export type Cronograma = {
  anuais: ParcelaDoCronograma[];
  entrada: ParcelaDoCronograma[];
  mensais: ParcelaDoCronograma[];
  reajustes: FaixaDoCronograma[];
  totais: TotaisDoCronograma;
};

export type CondicoesDoCronograma = {
  anuaisQuantidade: number;
  anuaisValor: number;
  /** 10 ou 20 na tela de hoje, mas a função recebe um número: ver o aviso em `somarMeses`. */
  diaDeVencimento: number;
  /**
   * Os valores de CADA parcela da entrada, quando o coordenador montou à mão.
   *
   * ⚠️ AUSENTE = PARTES IGUAIS, que é o caso da esmagadora maioria e o comportamento de sempre.
   * Presente, manda: Lucas (05/09/2026) pediu poder montar "10 mil na primeira, o resto dividido",
   * e a soma dessas parcelas é que vira o total da entrada — inclusive quando ela PASSA do valor
   * combinado (*"maior pode; ao ser maior, atualizar o valor de entrada"*). Quem confere a régua é
   * `conferirEntradaMontada`; aqui a lista chega já aprovada, e o cronograma só a agenda.
   */
  entradaParcelas?: null | number[];
  entradaValor: number;
  entradaVezes: number;
  parcelasMensais: number;
  plano: PlanoComercial;
  /** `YYYY-MM-DD` (o que o `<input type="date">` entrega) ou um ISO com hora. */
  primeiraParcelaDaEntrada: string;
  valorNegociado: number;
};

// ── CALENDÁRIO ──────────────────────────────────────────────────────────────

/** Um dia do calendário. `mes` é 1..12, como se fala, e não 0..11, como o `Date` guarda. */
type Dia = { ano: number; dia: number; mes: number };

const SO_A_DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `2026-10-10T00:00:00`, `2026-10-10 14:30:00.000` — data COM hora e SEM `Z` e SEM `±HH:MM`.
 * É exatamente o formato que uma coluna `timestamp` (sem `timezone`) do Postgres devolve.
 */
const DATA_COM_HORA_SEM_FUSO = /^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

const doisDigitos = (n: number): string => String(n).padStart(2, "0");

/** `{ ano: 2026, dia: 10, mes: 10 }` → `"2026-10-10"`. */
function escreverDia(d: Dia): string {
  return `${String(d.ano).padStart(4, "0")}-${doisDigitos(d.mes)}-${doisDigitos(d.dia)}`;
}

/** `"2026-10-10"` → `{ ano: 2026, dia: 10, mes: 10 }`, lendo os dígitos e nada mais. */
function diaDoTextoISO(soAData: string): Dia {
  return {
    ano: Number(soAData.slice(0, 4)),
    dia: Number(soAData.slice(8, 10)),
    mes: Number(soAData.slice(5, 7)),
  };
}

/**
 * O dia dos dígitos, recusando o que não existe no calendário.
 *
 * ⚠️ MÊS 13 E DIA 31 DE NOVEMBRO NÃO SÃO DATA. `diaDoTextoISO` lê os dígitos e nada mais, então sem
 * esta conferência `2026-13-10` viraria janeiro de 2027 e `2026-11-31` cairia em 30/11 pela régua
 * do último dia do mês — as duas caladas, e a série mensal inteira nasceria deslocada. Antes de o
 * caminho sem fuso existir, quem recusava essas strings era o `Date.parse`; a proteção não podia
 * sumir junto com a correção do fuso.
 */
function diaDoCalendarioValido(soAData: string): Dia {
  const dia = diaDoTextoISO(soAData);
  const ultimo = new Date(Date.UTC(dia.ano, dia.mes, 0)).getUTCDate();
  if (dia.mes < 1 || dia.mes > 12 || dia.dia < 1 || dia.dia > ultimo) {
    throw new Error("Data da primeira parcela da entrada inválida.");
  }
  return dia;
}

/**
 * A data informada, como DIA do calendário.
 *
 * ⚠️ VENCIMENTO É DIA, NÃO INSTANTE — e é aqui que 10/10 vira 09/10 se ninguém tomar cuidado.
 * `Date.parse("2026-10-10")` devolve meia-noite em UTC; qualquer conta que depois desloque para o
 * fuso da operação (−03:00, fixo, o Brasil não tem mais horário de verão) cai em 09/10 21h e o
 * boleto sai um dia antes. `vencimentoEmDias`, em `reserva.ts`, resolve isso fixando o offset
 * porque ELA precisa devolver um instante para uma coluna timestamp. Aqui não precisamos de
 * instante nenhum: a partir desta função tudo é aritmética de ano/mês/dia com inteiros, e a
 * pergunta "que horas são" nunca chega a ser feita.
 *
 * ⚠️ POR ISSO O `YYYY-MM-DD` PURO É TRATADO ANTES: ele já é o dia, e passá-lo pelo `Date` seria
 * criar o problema que esta função existe para evitar. Só quando a string carrega hora — porque
 * veio de uma coluna timestamp — é que o instante é convertido para o dia de Brasília.
 *
 * ⚠️ E STRING COM HORA SEM FUSO NÃO PODE ENCOSTAR NO `Date.parse`. `"2026-10-10T00:00:00"` não diz
 * em que fuso está, e o `Date` resolve isso com o fuso DO PROCESSO: no notebook do Lucas
 * (America/Sao_Paulo) o instante é 03:00Z e o dia sai 10/10; na Vercel (UTC) o instante é 00:00Z,
 * a subtração de três horas leva para 09/10 21h e a série mensal INTEIRA anda um dia — o mesmo
 * contrato gerando vencimentos diferentes conforme a máquina que imprimiu. Por isso a string sem
 * fuso é interpretada explicitamente em −03:00, o fuso fixo da operação; e como perguntar "que dia
 * é este instante em Brasília" devolve de volta a própria data escrita, basta ficar com ela e
 * nunca construir instante nenhum.
 */
function diaDaData(valor: string): Dia {
  const bruto = String(valor ?? "").trim();

  if (SO_A_DATA.test(bruto)) return diaDoCalendarioValido(bruto);

  // ⚠️ A HORA TAMBÉM É CONFERIDA, mesmo sendo descartada. A regex casa o dia e ignora o resto, e
  // uma versão anterior devolvia os dígitos sem olhar: `2026-13-10 10:00` passava e virava
  // janeiro de 2027, `2026-10-10T99:99` passava calado. Antes deste caminho existir, o `Date.parse`
  // recusava as duas — a proteção não pode sumir junto com a correção de fuso.
  const semFuso = DATA_COM_HORA_SEM_FUSO.exec(bruto);
  if (semFuso?.[1]) {
    const hora = Number(bruto.slice(11, 13));
    const minuto = Number(bruto.slice(14, 16));
    if (hora > 23 || minuto > 59) {
      throw new Error("Data da primeira parcela da entrada inválida.");
    }
    return diaDoCalendarioValido(semFuso[1]);
  }

  const instante = Date.parse(bruto);
  if (!Number.isFinite(instante)) {
    throw new Error("Data da primeira parcela da entrada inválida.");
  }
  const emBrasilia = new Date(instante - 3 * 3_600_000);
  return {
    ano: emBrasilia.getUTCFullYear(),
    dia: emBrasilia.getUTCDate(),
    mes: emBrasilia.getUTCMonth() + 1,
  };
}

/** Quantos dias tem o mês. Conta em UTC de propósito: o fuso da máquina não entra na conta. */
function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * `meses` meses depois de `base`, caindo sempre no `diaDesejado`.
 *
 * ⚠️ DIA 31 EM MÊS DE 30 CAI NO ÚLTIMO DIA DO MÊS. A tela oferece só 10 e 20 hoje, mas o parâmetro
 * é um número: gerar "31/11" produz uma data que não existe, e um `Date` a rolaria calada para
 * 01/12 — vencimento no mês errado, dentro de um contrato assinado.
 *
 * ⚠️ E O DIA DESEJADO VEM SEMPRE DA ORIGEM, nunca da parcela anterior. Somar "mais um mês" em cima
 * do resultado anterior apodrece a série inteira depois do primeiro mês curto: 31/10 → 30/11 →
 * 30/12 → 30/01, e o contrato perde o dia 31 para sempre. Recalculando a partir da base, fevereiro
 * encolhe só fevereiro.
 */
function somarMeses(base: Dia, meses: number, diaDesejado: number): Dia {
  const total = base.ano * 12 + (base.mes - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = total - ano * 12 + 1;
  return { ano, dia: Math.min(diaDesejado, ultimoDiaDoMes(ano, mes)), mes };
}

// ── DINHEIRO ────────────────────────────────────────────────────────────────

const emReais = (valor: number): number => Math.round(valor * 100) / 100;

/**
 * Divide `total` em `partes` iguais SEM PERDER O RESTO.
 *
 * ⚠️ O CENTAVO DA DIVISÃO NÃO PODE SUMIR. R$ 10.000,00 em 3× dá R$ 3.333,33, e três delas somam
 * R$ 9.999,99: um centavo a menos de entrada do que foi negociado, num documento que o comprador
 * assina e que o financeiro depois concilia contra o recebido.
 *
 * ⚠️ O RESTO VAI NA PRIMEIRA, e é escolha, não acaso. Duas razões: a primeira é a que o cliente
 * paga na mesa, olhando o valor, então é a que ele confere; e jogando a sobra ali, TODAS as demais
 * ficam idênticas — que é como o corretor anuncia ("e mais 2× de R$ 3.333,33"). Na última, a
 * parcela diferente seria a que vence daqui a meses, sem ninguém por perto para explicar.
 */
export function repartirEmPartesIguais(total: number, partes: number): number[] {
  if (partes <= 0 || total <= 0) return [];
  const centavos = Math.round(total * 100);
  const base = Math.floor(centavos / partes);
  const resto = centavos - base * partes;
  return Array.from({ length: partes }, (_, i) => (i === 0 ? base + resto : base) / 100);
}

const somar = (parcelas: ParcelaDoCronograma[]): number =>
  emReais(parcelas.reduce((acc, p) => acc + p.valor, 0));

// ── O CRONOGRAMA ────────────────────────────────────────────────────────────

/**
 * As condições da proposta viram fluxo de pagamento datado.
 *
 * A ordem das datas, como o Lucas ditou: a primeira da entrada é a data informada; as demais da
 * entrada caem no mesmo dia dos meses seguintes; a primeira mensal cai no mês seguinte à ÚLTIMA da
 * entrada; as anuais começam doze meses depois da primeira mensal e seguem uma por ano.
 *
 * ⚠️ A ENTRADA MANTÉM O DIA DA DATA INFORMADA; A SÉRIE MENSAL SEGUE O `diaDeVencimento`. Na tela os
 * dois coincidem (a data já vem preenchida no dia escolhido), e é por isso que o exemplo dele não
 * separa os dois. Quando divergirem, quem manda em cada série é quem foi decidido para ela: a data
 * da entrada foi DIGITADA por alguém olhando para ela, e mudá-la por baixo seria desobedecer ao
 * único campo de data do formulário; a série mensal é a que vira boleto todo mês, e o dia de
 * vencimento existe justamente para governá-la.
 */
export function montarCronograma(condicoes: CondicoesDoCronograma): Cronograma {
  const { anuaisValor, entradaValor, plano, valorNegociado } = condicoes;

  const diaDeVencimento = Math.min(31, Math.max(1, Math.trunc(condicoes.diaDeVencimento || 1)));
  const origem = diaDaData(condicoes.primeiraParcelaDaEntrada);
  const mensais = Math.max(0, Math.trunc(condicoes.parcelasMensais));
  const quantasAnuais = anuaisValor > 0 ? Math.max(0, Math.trunc(condicoes.anuaisQuantidade)) : 0;

  // ── Entrada ──
  const vezes = entradaValor > 0 ? Math.max(0, Math.trunc(condicoes.entradaVezes)) : 0;
  // ⚠️ A LISTA MONTADA À MÃO VENCE A DIVISÃO IGUAL — e só ela, quando vier com valores de verdade.
  // Uma lista vazia ou com zeros (a tela ainda preenchendo) cairia num cronograma de entrada zero,
  // com o financiado inteiro na série mensal: por isso ela precisa somar mais que zero para valer.
  const montada = (condicoes.entradaParcelas ?? []).filter((v) => Number.isFinite(v) && v > 0);
  const valoresDaEntrada =
    montada.length > 0 ? montada : repartirEmPartesIguais(entradaValor, vezes);
  const listaDaEntrada: ParcelaDoCronograma[] = valoresDaEntrada.map((valor, i) => ({
    numero: i + 1,
    total: valoresDaEntrada.length,
    valor,
    vencimento: escreverDia(somarMeses(origem, i, origem.dia)),
  }));
  const totalDaEntrada = somar(listaDaEntrada);

  // ⚠️ SEM ENTRADA, A PRIMEIRA MENSAL É A PRÓPRIA DATA INFORMADA. "Mês seguinte à última da
  // entrada" não define nada quando não existe entrada — e adiar um mês de graça daria ao
  // comprador um mês de carência que ninguém negociou.
  //
  // ⚠️ CONTA AS PARCELAS QUE EXISTEM, E NÃO `entradaVezes`. Os dois coincidem na divisão igual, mas
  // não na montagem à mão: uma lista com valores zerados (a tela em preenchimento, ou alguém que
  // fixou uma parcela e zerou as outras) perde essas linhas no filtro acima e fica com menos
  // parcelas do que `entradaVezes` diz. Contando pelo número declarado, as mensais começavam meses
  // depois do fim da entrada REAL — meses de carência que ninguém negociou, no papel que vai para o
  // cliente. O que manda é a série que foi agendada.
  const primeiraMensal = somarMeses(origem, listaDaEntrada.length, diaDeVencimento);

  // ── Anuais ──
  //
  // ⚠️ A SÉRIE AGENDA O VALOR DE FACE — é o que o boleto do aniversário cobra. O desconto a valor
  // presente entra só no abatimento do saldo, mais abaixo, e as duas coisas não se misturam.
  const listaDasAnuais: ParcelaDoCronograma[] = Array.from(
    { length: quantasAnuais },
    (_, k) => ({
      numero: k + 1,
      total: quantasAnuais,
      valor: emReais(anuaisValor),
      vencimento: escreverDia(somarMeses(primeiraMensal, MESES_DO_CICLO * (k + 1), diaDeVencimento)),
    }),
  );
  const totalDasAnuais = somar(listaDasAnuais);

  // ── O saldo financiado e a parcela ──
  const i = taxaMensal(plano);

  // ⚠️ A ANUAL ABATE O SALDO PELO VALOR PRESENTE, E NÃO PELO TOTAL DE FACE. São duas perguntas
  // diferentes sobre o mesmo balão: quanto o comprador desembolsa no aniversário (face, e é isso
  // que a série acima agenda) e quanto ele vale HOJE para derrubar o saldo que a série mensal
  // amortiza. Abater três balões de 2027, 2028 e 2029 como se fossem dinheiro de hoje derruba a
  // parcela abaixo do que o contrato consegue cumprir — é o aviso de `montarProposta`, em
  // `simulacao.ts`, e é por isso que a conta é REUSADA daqui e não reescrita: o coordenador acabou
  // de ver a parcela no simulador, e o PDF que ele gera em seguida não pode discordar dela.
  const valorPresenteDasAnuais = valorPresenteDosBaloes(quantasAnuais, anuaisValor, i);

  // ⚠️ COMPOSIÇÃO QUE NÃO FECHA QUEBRA AQUI, DE PROPÓSITO. Antes um `Math.max(0, …)` zerava o
  // saldo em silêncio e o documento saía com a série mensal inteira em R$ 0,00 mais balões
  // vencendo depois do fim do contrato: 36 boletos de zero e R$ 130.000 de total geral num lote de
  // R$ 100.000, sem uma linha dizendo que algo estava errado. Escolhemos o erro em vez de uma
  // marca no retorno porque marca se ignora — enquanto ninguém lembrar de lê-la o PDF continua
  // saindo, e o comprador assina o documento zerado. É o mesmo motivo pelo qual a função já quebra
  // por data ilegível: não existe cronograma para estas condições, e devolver um plausível é pior
  // do que não devolver nenhum. Zero exato NÃO quebra: entrada de 100% sem série mensal é venda à
  // vista, e é legítima.
  const financiado = emReais(valorNegociado - totalDaEntrada - valorPresenteDasAnuais);
  if (financiado < 0) {
    throw new Error(
      "A composição não fecha: a entrada e as parcelas anuais valem mais do que o valor negociado.",
    );
  }

  const amortizacao = parcelaSacoc(financiado, mensais);

  /** Os juros teóricos acumulados do mês 1 até `meses`, extraídos da média que a nivelada devolve. */
  const jurosAcumulados = (meses: number): number => {
    const ate = Math.min(meses, mensais);
    if (ate <= 0 || i <= 0) return 0;
    return (parcelaNiveladaSacoc(financiado, i, mensais, ate) - amortizacao) * ate;
  };

  /**
   * ⚠️ O PRIMEIRO CICLO É A AMORTIZAÇÃO PURA, E A NIVELADA DE UM CICLO SÓ APARECE NO SEGUINTE.
   * É o modelo SACOC da casa, decodificado na Lavra do Ouro e validado em 9 de 9 empreendimentos
   * com parcelas emitidas — ver `parcelaSacoc` e o aviso de `parcelaNiveladaSacoc`, em
   * `planos-comerciais.ts`: no primeiro ano o boleto cobra SÓ amortização; os juros teóricos
   * daquele ano ficam acumulados e passam a ser cobrados, diluídos, do 13º mês em diante. Ou seja,
   * a tabela anda um ciclo para trás. Imprimir a nivelada já no ciclo 1 anuncia uma parcela maior
   * do que o primeiro boleto — e a folha tem que anunciar o que o C2X vai emitir.
   *
   * ⚠️ O DEGRAU SAI DA DIFERENÇA ENTRE DUAS NIVELADAS, e não de uma fórmula nova.
   * `parcelaNiveladaSacoc(…, m)` devolve a média dos juros dos meses 1..m; a janela do ciclo 2 é
   * (acumulado até 24 − acumulado até 12) ÷ 12. Reescrever o somatório aqui criaria uma segunda
   * curva de juros do SACOC, e as duas divergiriam no dia em que alguém corrigisse só uma.
   */
  const valorDoCiclo = (ciclo: number): number => {
    // A janela cobrada é a do ciclo ANTERIOR — e o `max(0, …)` é o que faz o ciclo 1 não pegar
    // emprestada a janela de um ciclo zero que não existe.
    const fim = Math.min(Math.max(0, (ciclo - 1) * MESES_DO_CICLO), mensais);
    const inicio = Math.min(Math.max(0, (ciclo - 2) * MESES_DO_CICLO), mensais);
    if (fim - inicio <= 0) return amortizacao;
    return amortizacao + (jurosAcumulados(fim) - jurosAcumulados(inicio)) / (fim - inicio);
  };

  const valorDaMensal = (k: number): number => {
    if (mensais <= 0) return 0;
    if (plano.sistemaAmortizacao === "price") return parcelaPrice(financiado, i, mensais);
    // O SAC decresce mês a mês: amortização fixa mais juros sobre o saldo. No mês 1 isto é
    // exatamente `primeiraParcelaSac(financiado, i, mensais)` — a maior de todas.
    if (plano.sistemaAmortizacao === "sac") {
      return k <= 1
        ? primeiraParcelaSac(financiado, i, mensais)
        : amortizacao + (financiado - amortizacao * (k - 1)) * i;
    }
    if (i <= 0) return amortizacao;
    return valorDoCiclo(Math.ceil(k / MESES_DO_CICLO));
  };

  // ⚠️ A MENSAL NÃO REPARTE O RESTO como a entrada faz, e a diferença é proposital: a parcela
  // mensal é a que o C2X emite, e ele emite todas iguais. Ajustar a última em um centavo para
  // fechar o total anunciaria no papel um boleto que o sistema nunca vai gerar — e o papel tem que
  // anunciar o que vai ser emitido.
  // ⚠️ SEM SALDO NÃO HÁ SÉRIE MENSAL. Quando a entrada cobre o lote inteiro (venda à vista, plano
  // de 100%), o financiado é zero e a série sairia com o prazo declarado e valor R$ 0,00 em cada
  // linha: o PDF imprimia "Parcela 1 de 1 · R$ 0,00" e a mensagem de WhatsApp anunciava "1x a
  // partir de R$ 0,00 (com reajuste anual)". Um boleto de zero real não existe, e prometer um no
  // papel do comprador é pior do que não ter seção nenhuma.
  const quantasMensais = financiado > 0 ? mensais : 0;
  const listaDasMensais: ParcelaDoCronograma[] = Array.from({ length: quantasMensais }, (_, k) => ({
    numero: k + 1,
    total: quantasMensais,
    valor: emReais(valorDaMensal(k + 1)),
    vencimento: escreverDia(somarMeses(primeiraMensal, k, diaDeVencimento)),
  }));

  return {
    anuais: listaDasAnuais,
    entrada: listaDaEntrada,
    mensais: listaDasMensais,
    reajustes: faixasDeReajuste(listaDasMensais, plano, valorDoCiclo, i),
    totais: {
      anuais: totalDasAnuais,
      entrada: totalDaEntrada,
      financiado,
      geral: emReais(totalDaEntrada + totalDasAnuais + somar(listaDasMensais)),
      mensais: somar(listaDasMensais),
    },
  };
}

/**
 * As faixas de reajuste — uma por ano de contrato, com a parcela daquele ciclo.
 *
 * ⚠️ SÓ OS JUROS ENTRAM NA PROJEÇÃO. O degrau do SACOC é contratual: está na taxa assinada e pode
 * ser calculado hoje para o contrato inteiro. O IPCA é FUTURO — projetá-lo seria escrever num
 * documento que o comprador assina um número que a casa não tem como sustentar, e que estaria
 * errado no primeiro aniversário. Por isso a faixa carrega `temIpca` e o documento imprime
 * "+ IPCA" ao lado do valor: o comprador vê a parcela do ciclo e vê que ela ainda vai corrigir.
 *
 * ⚠️ PRICE (OU QUALQUER PLANO SEM JUROS) DEVOLVE UMA FAIXA SÓ, SEM A MARCA. A parcela não muda por
 * degrau nenhum, e cinco linhas repetindo o mesmo valor fariam o comprador procurar a diferença
 * entre elas. Uma linha dizendo "1 a 120, R$ X" é a informação inteira.
 *
 * ⚠️ SAC TAMBÉM CAI NA FAIXA ÚNICA, MAS POR OUTRO MOTIVO — e isto é uma limitação conhecida, não
 * um acerto: no SAC a parcela cai TODO mês, e faixa anual não descreve isso. Nenhum
 * empreendimento usa SAC hoje (o C2X só tem PRICE e SACOOC em `enterprise_tables`); quando alguém
 * cadastrar, a tabela de reajuste precisa virar outra representação, e não ganhar mais uma linha.
 */
function faixasDeReajuste(
  mensais: ParcelaDoCronograma[],
  plano: PlanoComercial,
  valorDoCiclo: (ciclo: number) => number,
  taxaAoMes: number,
): FaixaDoCronograma[] {
  const primeira = mensais[0];
  const ultima = mensais[mensais.length - 1];
  if (!primeira || !ultima) return [];

  const temDegrau = plano.sistemaAmortizacao === "sacoc" && taxaAoMes > 0;
  if (!temDegrau) {
    return [
      {
        ate: ultima.vencimento,
        ciclo: 1,
        de: primeira.vencimento,
        parcelaFinal: ultima.numero,
        parcelaInicial: primeira.numero,
        temIpca: false,
        valor: primeira.valor,
      },
    ];
  }

  const ciclos = Math.ceil(mensais.length / MESES_DO_CICLO);
  return Array.from({ length: ciclos }, (_, indice) => {
    const ciclo = indice + 1;
    const inicio = indice * MESES_DO_CICLO;
    const fim = Math.min(ciclo * MESES_DO_CICLO, mensais.length) - 1;
    const daPrimeira = mensais[inicio] ?? primeira;
    const daUltima = mensais[fim] ?? ultima;

    return {
      ate: daUltima.vencimento,
      ciclo,
      de: daPrimeira.vencimento,
      parcelaFinal: daUltima.numero,
      parcelaInicial: daPrimeira.numero,
      // ⚠️ O PRIMEIRO CICLO NÃO TEM CORREÇÃO: ele começa hoje, com o valor negociado hoje. E plano
      // sem índice nunca ganha a marca — imprimir "+ IPCA" num contrato SEM_CORRECAO prometeria um
      // reajuste que o contrato não tem.
      temIpca: ciclo > 1 && plano.indiceCorrecao !== "SEM_CORRECAO",
      valor: emReais(valorDoCiclo(ciclo)),
    };
  });
}
