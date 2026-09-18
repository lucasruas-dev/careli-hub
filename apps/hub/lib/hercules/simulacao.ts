// A MATEMÁTICA DA PROPOSTA PERSONALIZADA — entrada, prazo, balões anuais e parcela-alvo.
//
// Lucas (03/09/2026): *"o simulador de proposta eu quero o mesmo que temos na Cecilio, aquele ficou
// ótimo"*, e logo depois *"e a parte da personalizada"*. A vista oficial monta a proposta a partir
// do plano cadastrado; a personalizada é onde o coordenador NEGOCIA — mexe na entrada, no prazo, põe
// um balão anual, ou parte da parcela que o cliente aguenta e descobre a entrada que fecha a conta.
//
// ⚠️ POR QUE ISTO NÃO ESTÁ EM `planos-comerciais.ts`. Aquele módulo calcula a parcela DE UM PLANO —
// a entrada sai do percentual do plano e não há balão nenhum. Aqui a entrada é digitada e existem
// pagamentos anuais fora da série mensal, que mudam a fórmula: o valor presente dos balões sai do
// saldo antes de dividir. São duas perguntas diferentes sobre a mesma taxa.
//
// ⚠️ E A TAXA VEM DE LÁ (`taxaMensal`), sempre. É ela que sabe converter 8% ao ano em taxa mensal
// pela convenção do plano (equivalente ou proporcional) — e essa diferença, num financiamento de
// 120 parcelas, custa cerca de 1% por parcela.
//
// ⚠️ E O SISTEMA DE AMORTIZAÇÃO TAMBÉM VEM DE LÁ (04/09/2026). Até esta data a conta daqui era
// Price para todo mundo — `financiado / fatorDeAnuidade(...)` — e o `sistemaAmortizacao` do plano
// era simplesmente ignorado. O resultado era a MESMA MODAL anunciando DUAS PARCELAS: lote de
// R$ 200.000, entrada de R$ 20.000, 120 mensais no plano SACOC de 8% a.a., o cartão grande do
// simulador dizia R$ 2.157,44/mês enquanto o rodapé "O que vai sair", o PDF e o WhatsApp — que
// passam por `montarCronograma`, e esse sempre respeitou o sistema — diziam R$ 1.500,00. 44% de
// diferença, na mesma tela, no plano que 21 dos 24 empreendimentos usam.
//
// ⚠️ E A CONTA NÃO É REESCRITA AQUI: `parcelaPrice`, `parcelaSacoc`, `primeiraParcelaSac` e
// `parcelaNiveladaSacoc` foram medidas contra os pagamentos reais do C2X, contrato a contrato. Uma
// segunda versão da conta de dinheiro é como a tela e o boleto voltam a discordar.

import {
  parcelaNiveladaSacoc,
  parcelaPrice,
  parcelaSacoc,
  primeiraParcelaSac,
  type SistemaAmortizacao,
} from "@/lib/apolo/planos-comerciais";

/** Quantos meses tem um ciclo de reajuste. O aniversário do contrato é anual em toda a casa. */
const MESES_DO_CICLO = 12;

/**
 * A string do cadastro virando a união que a conta entende.
 *
 * ⚠️ O DESCONHECIDO CAI EM SACOC, e não em Price — é para onde a cascata de `calcularParcela`
 * (planos-comerciais.ts) e a de `montarCronograma` mandam qualquer coisa que não seja `price` nem
 * `sac`. Se aqui o default fosse Price, um empreendimento com o campo em branco (ou com uma grafia
 * nova, "SACOOC", "SAC-OC") faria a tela calcular Price e o PDF calcular SACOC: exatamente as duas
 * parcelas diferentes que esta correção veio acabar.
 *
 * ⚠️ E O CASO IMPORTA: no C2X o campo chega como texto (`PlanoDaVenda.sistemaAmortizacao` é
 * `string`, porque a rota serializa em JSON e JSON não carrega união).
 */
export function sistemaDoCadastro(valor: null | string | undefined): SistemaAmortizacao {
  const limpo = (valor ?? "").trim().toLowerCase();
  if (limpo === "price") return "price";
  if (limpo === "sac") return "sac";
  return "sacoc";
}

/** Valor presente de `n` balões anuais de `valor`, à taxa mensal `i`. */
export function valorPresenteDosBaloes(quantidade: number, valor: number, i: number): number {
  if (quantidade <= 0 || valor <= 0) return 0;
  if (i <= 0) return quantidade * valor;

  let soma = 0;
  // O k-ésimo balão cai no aniversário k, ou seja, 12k meses à frente.
  for (let k = 1; k <= quantidade; k += 1) soma += valor * (1 + i) ** (-12 * k);
  return soma;
}

/**
 * O plano tem anuais CADASTRADAS (a quantidade e o valor da 0138, os dois positivos)?
 *
 * ⚠️ É O CRITÉRIO ÚNICO DO VALOR CHEIO (Lucas, 18/09/2026, perguntado se as anuais pelo valor cheio
 * valiam só no Garden ou em todos: *"So no Garden"*). Hoje só os três planos do Garden têm anual
 * cadastrada (SELECT em `temis_planos`, 18/09/2026), e é o cadastro, e não o nome do empreendimento,
 * que decide: o dia em que outro empreendimento cadastrar a tabela dele com anuais, a conta dele passa
 * a ser a mesma, sem código novo. As três contas (`montarProposta`, `entradaParaAParcela` e
 * `montarCronograma`) perguntam aqui, e não cada uma do seu jeito.
 *
 * ⚠️ MEIA CONFIGURAÇÃO NÃO É ANUAL: quantidade ou valor nulo, zero, negativo ou que não é número é
 * "sem anual cadastrada", a mesma régua de `anuaisDoPlano` e de `comoPlano`.
 */
export function temAnuaisCadastradas(
  // O índice é o que deixa passar QUALQUER plano (o do C2X não tem os dois campos, e é "sem anual"):
  // sem ele o TypeScript recusa o objeto que não tem nenhuma das duas chaves.
  plano: null | undefined | { [campo: string]: unknown; anuaisQuantidade?: unknown; anuaisValor?: unknown },
): boolean {
  if (!plano) return false;
  const quantidade = Math.trunc(Number(plano.anuaisQuantidade ?? 0));
  const valor = Number(plano.anuaisValor ?? 0);
  return Number.isFinite(quantidade) && Number.isFinite(valor) && quantidade > 0 && valor > 0;
}

/**
 * Quanto as anuais abatem do saldo que a série mensal vai amortizar.
 *
 * ⚠️ VALOR CHEIO (DE FACE) SÓ NO PLANO SACOC QUE TEM ANUAIS CADASTRADAS, que hoje são os três do
 * Garden. Lucas, com a Mesa do Garden aberta: *"tem que ser igual o mmendes"*; e, perguntado se isso
 * valia só no Garden ou em todos (18/09/2026): *"So no Garden"*. No mapa da MMendes (`garden.html`,
 * `condicoes`) as anuais do plano abatem o saldo pelo valor de face, e é assim que a parcela do
 * Garden bate com a dela (eram R$ 328,18/mês a mais no NORMAL de 60x e R$ 159,19 no INVESTIDOR
 * PARCELADO de 84x, quando abatiam a valor presente). Com o valor de face a folha do Garden fecha:
 * entrada + anuais + saldo das mensais = valor negociado, ao centavo.
 *
 * ⚠️ NO RESTO, VALOR PRESENTE, COMO SEMPRE FOI (a conta da origin/main). O reforço lançado à mão num
 * plano sem anual cadastrada, em qualquer sistema, e toda anual na Price e no SAC abatem o saldo
 * pelo que valem hoje. A primeira versão desta função abatia pelo valor de face em TODO SACOC com
 * juros, e mudou a parcela de outros empreendimentos sem ninguém pedir (medido na revisão de
 * 18/09/2026: 28 de 30 contas com reforço em SACOC com juros mudaram; o NORMAL-SACOC do 19 com 5 ×
 * R$ 30.000 foi de R$ 392,62 para R$ 248,55; a busca por parcela mudou a recomendação em 20 de 50
 * casos).
 *
 * ⚠️ É A FUNÇÃO ÚNICA DESTA PERGUNTA: `montarProposta`, `entradaParaAParcela` e `montarCronograma`
 * passam todos por aqui, com `anuaisCadastradasNoPlano` vindo de `temAnuaisCadastradas`. Mudar um
 * lado só faz a tela e o PDF voltarem a discordar.
 */
export function anuaisQueAbatemOSaldo(entrada: {
  /** `temAnuaisCadastradas(plano)`. Falso (ou ausente) é a conta de sempre, a valor presente. */
  anuaisCadastradasNoPlano?: boolean;
  quantidade: number;
  sistemaAmortizacao: SistemaAmortizacao;
  taxaAoMes: number;
  valor: number;
}): number {
  const { anuaisCadastradasNoPlano = false, quantidade, sistemaAmortizacao, taxaAoMes, valor } =
    entrada;
  const peloValorCheio = anuaisCadastradasNoPlano && sistemaAmortizacao === "sacoc";
  return valorPresenteDosBaloes(quantidade, valor, peloValorCheio ? 0 : taxaAoMes);
}

/** Fator de anuidade: quanto vale hoje uma série de `parcelas` pagamentos de 1, à taxa `i`. */
export function fatorDeAnuidade(parcelas: number, i: number): number {
  if (parcelas <= 0) return 0;
  if (i <= 0) return parcelas;
  return (1 - (1 + i) ** -parcelas) / i;
}

/**
 * A PARCELA ANUNCIADA de um saldo financiado, no sistema do plano.
 *
 * ⚠️ A CASCATA É A DE `calcularParcela`, copiada de propósito: `price` → Price, `sac` → a primeira
 * (a maior) do SAC, e todo o resto → a amortização pura do SACOC. Não chamamos `calcularParcela`
 * direto porque ela responde outra pergunta: lá o sinal SAI do percentual do plano e não existe
 * balão nenhum; aqui a entrada foi digitada na mesa e os reforços anuais já abateram o saldo. O que
 * se reusa é a matemática — `parcelaPrice`, `primeiraParcelaSac`, `parcelaSacoc` —, que é o que foi
 * medido contra o C2X.
 *
 * ⚠️ NO SACOC ELA É A PARCELA DO PRIMEIRO CICLO, não a do contrato inteiro: o boleto do primeiro
 * ano cobra só amortização e a parcela sobe de degrau no aniversário (ver `parcelaSacoc` e o aviso
 * de `parcelaNiveladaSacoc`). É o número que o C2X emite no primeiro ano, e é por isso que é o que
 * a tela anuncia — o mesmo que `montarCronograma` põe na primeira linha do PDF.
 */
export function parcelaDoFinanciado(entrada: {
  financiado: number;
  parcelas: number;
  sistemaAmortizacao: SistemaAmortizacao;
  taxaAoMes: number;
}): number {
  const { financiado, parcelas, sistemaAmortizacao, taxaAoMes } = entrada;
  if (parcelas <= 0) return 0;
  if (sistemaAmortizacao === "price") return parcelaPrice(financiado, taxaAoMes, parcelas);
  if (sistemaAmortizacao === "sac") return primeiraParcelaSac(financiado, taxaAoMes, parcelas);
  return parcelaSacoc(financiado, parcelas);
}

/**
 * O CAMINHO INVERSO, em forma de fator: `financiado = parcela × fator`.
 *
 * ⚠️ CADA SISTEMA TEM A SUA INVERSÃO, e é por isso que isto não é uma função só com a fórmula da
 * Price:
 *
 *   • Price — a parcela é `financiado ÷ anuidade(n, i)`, então o saldo é `parcela × anuidade`. É o
 *     valor presente da série, e é a única das três em que os juros entram na volta.
 *   • SACOC — a parcela EMITIDA é a amortização pura (`financiado ÷ n`), então o saldo sai direto:
 *     `parcela × n`. Nenhum desconto de juros aqui: quem paga 1.500 por 120 meses amortiza
 *     180.000, e os juros do contrato aparecem depois, no degrau do aniversário. Inverter o SACOC
 *     pela anuidade da Price devolveria um saldo ~30% menor e, com ele, uma ENTRADA inflada em
 *     dezenas de milhares de reais para a mesma parcela.
 *   • SAC — a primeira parcela é `financiado × (1/n + i)`, logo `financiado = parcela ÷ (1/n + i)`,
 *     que é `parcela × n ÷ (1 + n·i)`.
 *
 * ⚠️ E A IDENTIDADE COM A IDA É OBRIGATÓRIA: `parcelaDoFinanciado(parcela × fator) === parcela`,
 * nos três. É o que o teste de ida-e-volta trava — se alguém mexer num lado só, a tela volta a
 * oferecer uma entrada que não produz a parcela prometida.
 */
export function fatorDoFinanciado(entrada: {
  parcelas: number;
  sistemaAmortizacao: SistemaAmortizacao;
  taxaAoMes: number;
}): number {
  const { parcelas, sistemaAmortizacao, taxaAoMes } = entrada;
  if (parcelas <= 0) return 0;
  if (sistemaAmortizacao === "price") return fatorDeAnuidade(parcelas, taxaAoMes);
  if (sistemaAmortizacao === "sac") {
    return taxaAoMes > 0 ? parcelas / (1 + parcelas * taxaAoMes) : parcelas;
  }
  return parcelas;
}

/**
 * A SOMA DE TODAS AS MENSAIS do contrato — o que a série mensal custa do começo ao fim.
 *
 * ⚠️ NÃO É `parcela × n` FORA DA PRICE, e é o que o cartão "Total" da tela mostra. Na Price todas
 * as parcelas são iguais e a multiplicação basta. No SACOC a parcela SOBE no aniversário: no lote
 * de R$ 200.000 com R$ 20.000 de entrada, 120 meses a 8% a.a., a série custa ~R$ 252.400 e não os
 * R$ 180.000 de `1.500 × 120` — anunciar o produto da parcela pelo prazo tiraria R$ 72 mil do total
 * e faria a tela dizer "+0% sobre a tabela" num contrato que custa 36% a mais que o preço de lista.
 *
 * ⚠️ A CURVA DO SACOC É A DE `parcelaNiveladaSacoc`, a mesma que `montarCronograma` usa, e o
 * DEFASAMENTO DE UM CICLO faz parte dela: no primeiro ano o boleto cobra só amortização, e os juros
 * teóricos daquele ano passam a ser cobrados diluídos do 13º mês em diante — por isso a janela do
 * ciclo `c` é a do ciclo `c−1`, e os juros do último ano nunca chegam a ser cobrados. Este laço
 * espelha `montarCronograma`; ele não vive lá porque `cronograma.ts` já importa este módulo (o
 * contrário criaria import circular), e as duas versões ficam presas uma à outra pelo teste cruzado
 * de `simulacao.test.ts`: se alguém mexer na curva de um lado, o teste quebra do outro.
 */
export function somaDasMensais(entrada: {
  financiado: number;
  parcelas: number;
  sistemaAmortizacao: SistemaAmortizacao;
  taxaAoMes: number;
}): number {
  const { financiado, parcelas, sistemaAmortizacao, taxaAoMes } = entrada;
  if (parcelas <= 0 || financiado <= 0) return 0;

  if (sistemaAmortizacao === "price") {
    return parcelaPrice(financiado, taxaAoMes, parcelas) * parcelas;
  }

  const amortizacao = parcelaSacoc(financiado, parcelas);
  if (taxaAoMes <= 0) return amortizacao * parcelas;

  // O SAC decresce mês a mês: amortização fixa mais juros sobre o saldo que ainda resta.
  if (sistemaAmortizacao === "sac") {
    let soma = 0;
    for (let k = 1; k <= parcelas; k += 1) {
      soma += amortizacao + (financiado - amortizacao * (k - 1)) * taxaAoMes;
    }
    return soma;
  }

  /** Os juros teóricos acumulados do mês 1 até `meses`, extraídos da média que a nivelada devolve. */
  const jurosAcumulados = (meses: number): number => {
    const ate = Math.min(meses, parcelas);
    if (ate <= 0) return 0;
    return (parcelaNiveladaSacoc(financiado, taxaAoMes, parcelas, ate) - amortizacao) * ate;
  };

  let soma = 0;
  const ciclos = Math.ceil(parcelas / MESES_DO_CICLO);
  for (let c = 1; c <= ciclos; c += 1) {
    // Quantos boletos este ciclo tem — o último pode ser parcial (um plano de 130 meses fecha com
    // dez boletos no 11º ciclo).
    const meses = Math.min(c * MESES_DO_CICLO, parcelas) - (c - 1) * MESES_DO_CICLO;
    // A janela cobrada é a do ciclo ANTERIOR — e o `max(0, …)` é o que faz o ciclo 1 não pegar
    // emprestada a janela de um ciclo zero que não existe.
    const fim = Math.min(Math.max(0, (c - 1) * MESES_DO_CICLO), parcelas);
    const inicio = Math.min(Math.max(0, (c - 2) * MESES_DO_CICLO), parcelas);
    const doCiclo =
      fim - inicio <= 0
        ? amortizacao
        : amortizacao + (jurosAcumulados(fim) - jurosAcumulados(inicio)) / (fim - inicio);
    soma += meses * doCiclo;
  }
  return soma;
}

export type PropostaMontada = {
  /**
   * O que sobra para a série mensal, depois da entrada e dos balões (`anuaisQueAbatemOSaldo`: valor
   * de face no SACOC com anuais cadastradas no plano, valor presente no resto).
   */
  financiado: number;
  /** A do PRIMEIRO ciclo, no SACOC: é a que o C2X emite no primeiro ano e a que a tela anuncia. */
  parcela: number;
  /** Soma de tudo o que o cliente desembolsa: entrada + série mensal inteira + balões. */
  total: number;
};

/**
 * A parcela de uma proposta montada à mão.
 *
 * ⚠️ O BALÃO SAI DO SALDO POR `anuaisQueAbatemOSaldo`. Pelo valor presente, como sempre: somar
 * R$ 20.000 de um balão que cai daqui a três anos como se fosse dinheiro de hoje reduziria a parcela
 * além do que a conta permite. Pelo valor de face só no plano SACOC com anuais cadastradas, que é o
 * Garden (Lucas, 18/09/2026: *"So no Garden"*).
 *
 * ⚠️ E O TOTAL SOMA A SÉRIE INTEIRA (`somaDasMensais`), não `parcela × parcelas`: no SACOC a
 * parcela do primeiro ano não é a do contrato inteiro.
 */
export function montarProposta(entrada: {
  /** `temAnuaisCadastradas(plano)`. Ausente = falso, a conta de sempre. */
  anuaisCadastradasNoPlano?: boolean;
  baloesQuantidade: number;
  baloesValor: number;
  entrada: number;
  parcelas: number;
  sistemaAmortizacao: SistemaAmortizacao;
  taxaAoMes: number;
  valor: number;
}): PropostaMontada {
  const { baloesQuantidade, baloesValor, parcelas, sistemaAmortizacao, taxaAoMes, valor } = entrada;
  const desembolsoInicial = Math.max(0, entrada.entrada);

  const baloesNoSaldo = anuaisQueAbatemOSaldo({
    anuaisCadastradasNoPlano: entrada.anuaisCadastradasNoPlano,
    quantidade: baloesQuantidade,
    sistemaAmortizacao,
    taxaAoMes,
    valor: baloesValor,
  });
  const financiado = Math.max(0, valor - desembolsoInicial - baloesNoSaldo);
  const parcela = parcelaDoFinanciado({ financiado, parcelas, sistemaAmortizacao, taxaAoMes });

  return {
    financiado,
    parcela,
    total:
      desembolsoInicial +
      somaDasMensais({ financiado, parcelas, sistemaAmortizacao, taxaAoMes }) +
      Math.max(0, baloesQuantidade) * Math.max(0, baloesValor),
  };
}

/**
 * O caminho inverso: o cliente diz quanto pode pagar por mês, e a conta devolve a entrada.
 *
 * ⚠️ É A PERGUNTA QUE MAIS APARECE NA MESA. "Consigo pagar 1.500" é como o comprador fala; sair
 * disso para a entrada, na mão, é tentativa e erro. Entrada negativa significa que a parcela pedida
 * já paga o lote inteiro antes do prazo — devolvemos zero e quem chama avisa que sobra.
 *
 * ⚠️ E A INVERSÃO É A DO SISTEMA DO PLANO (`fatorDoFinanciado`), não a da Price. No SACOC o saldo
 * sai direto de `parcela × n`, porque a parcela emitida é a amortização pura; inverter pela
 * anuidade da Price devolvia um saldo menor e, com ele, uma entrada MAIOR do que a necessária —
 * dinheiro de agora que o cliente não precisava pôr, no plano de 21 dos 24 empreendimentos.
 *
 * ⚠️ OS BALÕES SAEM ANTES, igual na ida e pela MESMA função (`anuaisQueAbatemOSaldo`), com o
 * MESMO critério (`anuaisCadastradasNoPlano`): valor de face no SACOC com anuais cadastradas (o
 * Garden), valor presente no resto. Inverter com uma regra e ir com outra faria a entrada sugerida
 * não produzir a parcela pedida.
 */
export function entradaParaAParcela(entrada: {
  /** `temAnuaisCadastradas(plano)`. Ausente = falso, a conta de sempre. */
  anuaisCadastradasNoPlano?: boolean;
  baloesQuantidade: number;
  baloesValor: number;
  parcela: number;
  parcelas: number;
  sistemaAmortizacao: SistemaAmortizacao;
  taxaAoMes: number;
  valor: number;
}): { entrada: number; sobra: number } {
  const { baloesQuantidade, baloesValor, parcela, parcelas, sistemaAmortizacao, taxaAoMes, valor } =
    entrada;

  const baloesNoSaldo = anuaisQueAbatemOSaldo({
    anuaisCadastradasNoPlano: entrada.anuaisCadastradasNoPlano,
    quantidade: baloesQuantidade,
    sistemaAmortizacao,
    taxaAoMes,
    valor: baloesValor,
  });
  const financiadoQueAParcelaPaga =
    parcela * fatorDoFinanciado({ parcelas, sistemaAmortizacao, taxaAoMes });
  const bruta = valor - baloesNoSaldo - financiadoQueAParcelaPaga;

  return bruta >= 0 ? { entrada: bruta, sobra: 0 } : { entrada: 0, sobra: -bruta };
}
