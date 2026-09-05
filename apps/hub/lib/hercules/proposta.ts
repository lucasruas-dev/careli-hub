// A PROPOSTA — o segundo passo da venda, saindo da reserva que já existe.
//
// Lucas (04/09/2026): *"da reserva eu tenho dois caminhos, gerar proposta ou cancelar"*, *"o
// cliente é o da reserva e não se troca, se quiser trocar cancela a reserva e reserva de novo"*,
// *"dá para adicionar proponentes, cada um informa a % de participação"*, *"para virar proposta a
// CAD do titular tem que estar credenciada naquele empreendimento"*, *"com a data da primeira
// parcela da entrada as demais segue na data que ele escolheu e de acordo com o parcelamento"* e,
// sobre o rateio da entrada: *"lote de 100 mil, entrada 10% = 10 mil em 2x, 5 mil em 10/10 e 5 mil
// em 10/11"*.
//
// ⚠️ ESTE ARQUIVO NÃO TOCA BANCO NEM GATEWAY, igual ao irmão `reserva.ts`. É a régua e o texto: o
// que impede uma proposta de existir, e o que cada destinatário lê no WhatsApp. A rota faz as idas
// ao Supabase, o simulador (`simulacao.ts`) faz a conta e `proposta-pdf.ts` faz o papel.
//
// ⚠️ A CREDENCIAL DA CAD NÃO É CONFERIDA AQUI. "A CAD do titular credenciada neste
// empreendimento" é um fato do banco (esteira do Apolo + vínculo do empreendimento), e conferir
// isso a partir de um payload de tela seria conferir no lugar errado — quem decide é a rota, com o
// cadastro na mão, do mesmo jeito que a habilitação de corretor e imobiliária ficou fora de
// `conferirReserva`. O que esta camada garante é a FORMA do pedido.
//
// ⚠️ E O CLIENTE NÃO ENTRA AQUI PARA SER TROCADO. O titular vem da reserva; esta função confere
// que ele continua na lista, não que ele foi escolhido. Aceitar um titular novo transformaria
// "gerar proposta" numa segunda porta de entrada de cliente, sem a trava da reserva por unidade.

import { cpfValido } from "@/lib/apolo/documento";

import { entradaMinima } from "./composicoes";
import { type PlanoDaFaixa, pisoDaEntradaNoPrazo } from "./faixa-do-plano";
import { mascararCpf } from "./reserva";

/**
 * Quem compra, e com quanto.
 *
 * ⚠️ `participacao` É PERCENTUAL, NÃO FRAÇÃO — 60 é sessenta por cento. A tela pergunta em "%" e o
 * contrato escreve em "%"; guardar 0,6 aqui obrigaria cada leitor a lembrar da conversão, e o
 * primeiro que esquecesse geraria uma proposta com 0,6% de participação.
 */
export type CompradorDoPedido = {
  cpf: string;
  nome: string;
  participacao: number;
  /** O titular é o cliente da reserva. Exatamente um, e ele não se troca. */
  titular: boolean;
};

export type PedidoDeProposta = {
  /**
   * O reforço anual (balão), quando o plano tem — os mesmos dois números de `cronograma.ts`.
   *
   * ⚠️ AUSENTE É ZERO, e por isso são opcionais: a maioria das propostas não tem reforço, e
   * obrigar a tela a mandar `0` em dois campos só produziria pedido cheio de zero. Mas eles
   * entram na régua porque saem do bolso do comprador junto com a entrada: fora da conta do teto,
   * uma proposta com entrada + balões maiores do que o lote passaria inteira.
   */
  anuaisQuantidade?: null | number;
  anuaisValor?: null | number;
  compradores: CompradorDoPedido[];
  /** A % mínima de entrada DESTE empreendimento. Nulo/ausente = padrão da casa. */
  entradaMinimaPercentual?: null | number;
  /**
   * A TABELA do empreendimento — os planos, com prazo e percentual de entrada.
   *
   * ⚠️ SEM ELA A FAIXA NÃO É RÉGUA, É COR DE TEXTO. A regra do Lucas (*"se eu colocar 30 vezes eu
   * não posso ter uma entrada menor que 56k"*) nasceu pintando o campo de vermelho na tela — e o
   * botão gerava assim mesmo, porque aqui só existia o piso da casa (10%). Uma proposta de 30x com
   * 10% de entrada saía no PDF e no WhatsApp sem um único erro de validação. Quem avisa é a tela;
   * quem RECUSA tem que ser esta função, que é a única por onde o POST passa.
   *
   * Ausente = só o piso da casa, que é o comportamento de quem ainda não manda a tabela.
   */
  planosDaTabela?: null | PlanoDaFaixa[];
  /**
   * Os valores de CADA parcela da entrada, quando o coordenador montou à mão.
   *
   * ⚠️ AUSENTE = PARTES IGUAIS, o caminho de sempre. Presente, a SOMA dela é a entrada de verdade —
   * ver a régua assimétrica em `conferirEntradaMontada`: menor que o combinado é recusado, maior é
   * aceito e vira o novo valor.
   */
  entradaParcelas?: null | number[];
  /** O total da entrada, em reais. É ele que se divide em `entradaVezes` partes iguais. */
  entradaValor: number;
  entradaVezes: number;
  /** Quantas mensais depois da entrada. */
  parcelas: number;
  /** O dia da primeira parcela da ENTRADA — `2026-10-10` ou ISO completo. */
  primeiraParcelaEm: string;
  reservaId: string;
  unidadeId: string;
  /**
   * Até quando a proposta vale, em ISO.
   *
   * ⚠️ PREÇO TEM PRAZO. A tabela sobe, o lote é vendido para outro, o crédito vence — uma proposta
   * sem validade é uma promessa que o comercial não consegue cumprir seis meses depois, com o papel
   * na mão do cliente. O prazo é escolhido na tela, como na reserva.
   */
  validadeEm: string;
  valorNegociado: number;
  /** 10 ou 20 na tela; 1 a 28 na regra do servidor. */
  vencimentoDia: number;
};

/**
 * Os dias que a tela oferece com um clique.
 *
 * ⚠️ SÃO ATALHOS, NÃO A REGRA — como os `PRAZOS_SUGERIDOS` da reserva. A cobrança da casa roda em
 * 10 e 20, mas quem valida é o servidor, e ele aceita a faixa inteira: uma venda antiga migrada ou
 * um acerto pontual com o cliente não pode ser recusado por não estar nesta lista.
 */
export const DIAS_DE_VENCIMENTO = [10, 20] as const;

/**
 * Por quantos dias a proposta vale — os atalhos que a tela oferece com um clique.
 *
 * Lucas (05/09/2026): *"vamos fazer igual a reserva, colocar os dias de prazo, 3 - 5 - 7 - 10"*.
 *
 * ⚠️ SÃO MAIORES QUE OS DA RESERVA, e a diferença é do negócio: a reserva segura o lote e por isso
 * é curta (1 a 7 dias); a proposta espera o cliente decidir, conversar com a família e o crédito
 * andar. Repetir a lista da reserva aqui daria um prazo apertado no passo mais lento da venda.
 */
export const PRAZOS_DA_PROPOSTA = [3, 5, 7, 10] as const;

/**
 * ⚠️ ESCOLHA MINHA, e não regra da casa — a mesma ressalva do prazo da reserva. Não existe validade
 * de proposta escrita em lugar nenhum do repositório: 7 dias é o que estava no mockup que o Lucas
 * aprovou, e vale até ele dizer o número.
 */
export const PRAZO_PADRAO_DA_PROPOSTA = 7;

/** Acima disso não é proposta com prazo, é preço congelado sem data. */
export const PRAZO_MAXIMO_DA_PROPOSTA = 30;

/**
 * O último dia do mês que existe em TODO mês.
 *
 * ⚠️ 29, 30 E 31 NÃO SÃO DIAS DE VENCIMENTO. Um contrato com vencimento em 31 tem sete meses por
 * ano sem esse dia, e fevereiro não tem nem o 29 na maioria dos anos: a régua de datas teria que
 * "empurrar para o último dia", e boleto emitido em data diferente da combinada é reclamação de
 * cliente e diferença de juros. Prende-se em 28, que existe sempre.
 */
export const VENCIMENTO_DIA_MAXIMO = 28;

export type ErroDaProposta = {
  campo:
    | "anuais"
    | "compradores"
    | "cpf"
    | "entrada"
    | "entradaVezes"
    | "parcelas"
    | "participacao"
    | "primeiraParcela"
    | "reserva"
    | "titular"
    | "unidade"
    | "validade"
    | "valor"
    | "vencimentoDia";
  mensagem: string;
};

/** `2026-10-10` — só a data, sem hora. É o que a tela manda no campo de data. */
const SO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * O dia existe mesmo no mês que ele diz?
 *
 * ⚠️ FORMA NÃO É EXISTÊNCIA. `2026-02-31` e `2026-04-31` passam no `SO_DATA` inteirinhos, e quem
 * só confere a forma aprova um dia que não existe: o cronograma empurra o vencimento calado para
 * o último dia do mês (28/02) e a mensagem de WhatsApp anuncia 31/02/2026. O cliente lê uma data,
 * o boleto sai em outra, e a conversa vira reclamação. Mês fora de 1 a 12 (`2026-13-45`) cai aqui
 * pelo mesmo motivo.
 *
 * ⚠️ O ÚLTIMO DIA SAI DO PRÓPRIO CALENDÁRIO — `Date.UTC(ano, mes, 0)` é o dia zero do mês
 * seguinte, isto é, o último do mês pedido. Escrever a tabela de 28/30/31 na mão obrigaria a
 * lembrar do ano bissexto, e 2028 tem 29 de fevereiro.
 */
function diaExisteNoMes(texto: string): boolean {
  const ano = Number(texto.slice(0, 4));
  const mes = Number(texto.slice(5, 7));
  const dia = Number(texto.slice(8, 10));
  if (mes < 1 || mes > 12 || dia < 1) return false;
  return dia <= new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * O dia do calendário de uma data, como a pessoa a leu na tela.
 *
 * ⚠️ DATA SEM HORA NÃO PASSA POR FUSO. `2026-10-10` é meia-noite UTC para o `Date`, e converter
 * isso para Brasília devolve o dia 09 — o mesmo defeito que mordeu a casa na leitura de planilha
 * (data em UTC deslocando o mês). Quando o texto já é um dia, ele É a resposta; só o ISO com hora precisa do
 * −03:00.
 *
 * ⚠️ DEVOLVE NULO PARA O QUE NÃO É DATA — e "não é data" inclui o dia que não existe no mês, por
 * `diaExisteNoMes`. Quem chama trata nulo como "informe a data", que é o caminho certo para
 * `2026-02-31`.
 */
export function diaDoCalendario(valor: null | string | undefined): null | string {
  const texto = String(valor ?? "").trim();
  if (!texto) return null;
  if (SO_DATA.test(texto)) return diaExisteNoMes(texto) ? texto : null;

  // ⚠️ O DIA TAMBÉM É CONFERIDO NO ISO COM HORA, e não só no formato curto. O `Date.parse` do V8
  // NÃO recusa dia fora do mês nesse formato: ele ROLA a data. `2026-11-31T12:00:00Z` vira
  // 01/12/2026 sem erro nenhum, e a mensagem de WhatsApp anunciaria uma data que o boleto não vai
  // ter. Uma versão anterior conferia só o formato curto e deixava exatamente esse buraco.
  const parteDoDia = texto.slice(0, 10);
  if (!SO_DATA.test(parteDoDia) || !diaExisteNoMes(parteDoDia)) return null;

  const instante = Date.parse(texto);
  if (!Number.isFinite(instante)) return null;
  // −03:00 é o fuso da operação inteira (Careli, Goiás), fixo desde o fim do horário de verão.
  return new Date(instante - 3 * 3_600_000).toISOString().slice(0, 10);
}

/** `10/10/2026` — o dia como se escreve no WhatsApp. */
export function dataEscrita(valor: null | string | undefined): string {
  const dia = diaDoCalendario(valor);
  if (!dia) return "";
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
}

/** Centavos inteiros. É nesta moeda que dinheiro se compara sem susto de ponto flutuante. */
function centavos(valor: number): number {
  return Math.round(valor * 100);
}

/**
 * O que impede esta proposta de existir.
 *
 * ⚠️ DEVOLVE TODOS OS ERROS, não o primeiro — a mesma razão de `conferirReserva`: um formulário
 * que reclama de um campo por vez faz a pessoa clicar em "Gerar proposta" cinco vezes para
 * descobrir cinco problemas. E aqui o formulário é maior, com uma linha por comprador.
 */
export function conferirProposta(
  pedido: PedidoDeProposta,
  agoraIso: string,
): ErroDaProposta[] {
  const erros: ErroDaProposta[] = [];

  if (!pedido.unidadeId) {
    erros.push({ campo: "unidade", mensagem: "Escolha a unidade." });
  }

  // A proposta nasce DE uma reserva; sem ela não há cliente definido nem unidade travada.
  if (!pedido.reservaId) {
    erros.push({ campo: "reserva", mensagem: "A proposta sai de uma reserva." });
  }

  const compradores = Array.isArray(pedido.compradores) ? pedido.compradores : [];

  if (compradores.length === 0) {
    erros.push({ campo: "compradores", mensagem: "Informe pelo menos um comprador." });
  } else {
    const titulares = compradores.filter((c) => c.titular);
    if (titulares.length === 0) {
      erros.push({
        campo: "titular",
        mensagem: "O titular da reserva tem que estar entre os compradores.",
      });
    } else if (titulares.length > 1) {
      // ⚠️ DOIS TITULARES É PIOR DO QUE NENHUM: a rota escolheria um deles em silêncio, e a
      // proposta sairia no nome de quem o sistema achou primeiro, não de quem reservou.
      erros.push({ campo: "titular", mensagem: "Só o cliente da reserva é titular." });
    }

    for (const comprador of compradores) {
      const nome = String(comprador.nome ?? "").trim();
      if (!cpfValido(comprador.cpf)) {
        erros.push({
          campo: "cpf",
          mensagem: nome ? `CPF inválido em ${nome}.` : "CPF inválido em um dos compradores.",
        });
      }
      if (!(comprador.participacao > 0)) {
        erros.push({
          campo: "participacao",
          mensagem: nome
            ? `${nome} está sem participação.`
            : "Cada comprador precisa de uma participação.",
        });
      }
    }

    // ⚠️ A SOMA DAS PARTICIPAÇÕES TEM QUE FECHAR 100%. Uma proposta que soma 90% vira minuta, e a
    // minuta vira contrato: os 10% restantes seriam um pedaço do imóvel sem dono nenhum escrito no
    // papel, descoberto no cartório ou na primeira discussão de partilha. O ajuste custa aditivo.
    //
    // ⚠️ SOMA-SE EM CENTÉSIMOS INTEIROS, e não os números como vieram: 33,33 + 33,33 + 33,34 dá
    // 100.00000000000001 em ponto flutuante, e a comparação ingênua recusaria a divisão mais comum
    // que existe entre três compradores.
    const soma = compradores.reduce(
      (total, c) => total + Math.round(Number(c.participacao ?? 0) * 100),
      0,
    );
    if (soma !== 100 * 100) {
      erros.push({
        campo: "participacao",
        mensagem: `A soma das participações tem que fechar 100% (está em ${(soma / 100)
          .toFixed(2)
          .replace(".", ",")}%).`,
      });
    }
  }

  // ⚠️ NaN NÃO É "ABAIXO DO MÍNIMO", É AUSENTE — e é preciso dizer isso ANTES de comparar. Campo
  // vazio ou meio digitado ("R$ ") chega aqui como NaN, e toda comparação com NaN é falsa:
  // `centavos(NaN) < centavos(piso)` dá false, a única régua de dinheiro do módulo passa em
  // silêncio e a proposta sai com entrada zero, financiando o lote inteiro. Repare que
  // `valorNegociado` logo abaixo já se protege sozinho, porque `!(x > 0)` é VERDADEIRO para NaN.
  const entradaEhNumero = Number.isFinite(pedido.entradaValor);
  if (!entradaEhNumero) {
    erros.push({ campo: "entrada", mensagem: "Informe o valor da entrada." });
  }

  // O reforço anual é opcional, mas quando vem tem que ser número: ausente é zero, NaN é erro.
  const anuaisQuantidade = pedido.anuaisQuantidade ?? 0;
  const anuaisValor = pedido.anuaisValor ?? 0;
  const anuaisQuantidadeOk = Number.isInteger(anuaisQuantidade) && anuaisQuantidade >= 0;
  const anuaisValorOk = Number.isFinite(anuaisValor) && anuaisValor >= 0;
  if (!anuaisQuantidadeOk) {
    erros.push({ campo: "anuais", mensagem: "Informe quantos reforços anuais (0 se não houver)." });
  }
  if (!anuaisValorOk) {
    erros.push({ campo: "anuais", mensagem: "Informe o valor de cada reforço anual." });
  }

  // ⚠️ A ENTRADA MONTADA NÃO PODE SOMAR MENOS QUE A COMBINADA. Ela chega da tela já conferida,
  // mas a régua do servidor não pode confiar nisso: um corpo montado à mão passaria uma entrada de
  // R$ 1.000 em quatro parcelas dizendo que o combinado eram R$ 28.000, e a proposta sairia com o
  // financiado errado e a parcela subestimada no papel do cliente. Maior continua valendo — quem
  // sobe a entrada para a soma é `montarCronograma`, que agenda a lista como ela veio.
  if (pedido.entradaParcelas && pedido.entradaParcelas.length > 0) {
    const soma = pedido.entradaParcelas.reduce(
      (total, v) => total + (Number.isFinite(v) ? Math.round(v * 100) : 0),
      0,
    );
    if (entradaEhNumero && soma < Math.round(pedido.entradaValor * 100)) {
      erros.push({
        campo: "entrada",
        mensagem: "As parcelas da entrada somam menos que o valor da entrada.",
      });
    }
    if (pedido.entradaParcelas.some((v) => !Number.isFinite(v) || v <= 0)) {
      erros.push({ campo: "entrada", mensagem: "Toda parcela da entrada precisa de um valor." });
    }
  }

  // ⚠️ REFORÇO ANUAL CAI NO ANIVERSÁRIO, ENTÃO SÓ CABEM OS ANIVERSÁRIOS QUE O PRAZO TEM. Sem esta
  // régua, quem escolhia 6 reforços num plano de 120 meses e depois reduzia o prazo para 60 saía
  // com dois balões vencendo DEPOIS da última mensal: o PDF imprimia "última parcela" em novembro
  // de 2032 num contrato de 60 meses, e como os 6 reforços são abatidos a valor presente a mensal
  // impressa caía para R$ 2.188,56 onde os 4 que realmente cabem dariam R$ 2.843,94 — 23% a menos,
  // no papel que vai por WhatsApp para o cliente. A varredura automática (`composicoesQueFecham`)
  // já respeitava o prazo; o caminho manual e esta rota não respeitavam.
  const aniversariosDoPrazo = Math.floor((pedido.parcelas ?? 0) / 12);
  if (anuaisQuantidadeOk && anuaisQuantidade > aniversariosDoPrazo) {
    erros.push({
      campo: "anuais",
      mensagem:
        aniversariosDoPrazo > 0
          ? `Em ${pedido.parcelas} parcelas cabem no máximo ${aniversariosDoPrazo} reforços anuais.`
          : "Um contrato de menos de 12 parcelas não comporta reforço anual.",
    });
  }

  if (!(pedido.valorNegociado > 0)) {
    erros.push({ campo: "valor", mensagem: "Informe o valor negociado." });
  } else if (entradaEhNumero) {
    // ⚠️ O PISO SAI DE `entradaMinima`, NÃO DE UMA CONTA NOVA AQUI. Ela é quem sabe que a % vem do
    // empreendimento (o Garden vende a 8%) e que nulo cai no padrão da casa, mas zero é zero.
    //
    // ⚠️ E A FAIXA DO PRAZO APERTA POR CIMA DELE. `pisoDaEntradaNoPrazo` devolve o maior entre o
    // piso da casa e o do plano que comporta o parcelamento pedido — é a regra que o Lucas ditou, e
    // é AQUI que ela vira recusa. Sem a tabela (`planosDaTabela` ausente) sobra o piso da casa, que
    // é o comportamento de sempre.
    const doPrazo = pisoDaEntradaNoPrazo({
      parcelas: pedido.parcelas,
      pisoDaCasaEmReais: entradaMinima(pedido.valorNegociado, pedido.entradaMinimaPercentual),
      planos: pedido.planosDaTabela ?? [],
      valorNegociado: pedido.valorNegociado,
    });
    const piso = doPrazo.emReais;

    // ⚠️ A COMPARAÇÃO É EM CENTAVOS INTEIROS. 10% de R$ 178.100 dá 17810.000000000002 em ponto
    // flutuante, e a tela chegou a dizer "abaixo do mínimo" para uma entrada de exatamente
    // R$ 17.810 — o valor do próprio mínimo. O mínimo é "10% em diante": o próprio 10% vale.
    if (centavos(pedido.entradaValor) < centavos(piso)) {
      erros.push({
        campo: "entrada",
        // ⚠️ A FRASE DIZ DE ONDE VEM A EXIGÊNCIA. "A entrada mínima é R$ 56.000" num empreendimento
        // que vende a 10% parece erro do sistema; "em 30 parcelas (faixa do PLANO INVESTIDOR)"
        // explica a escada e diz o que fazer — alongar o prazo ou aumentar a entrada.
        // ⚠️ `reais()` E NÃO `toFixed`: o `toFixed(2).replace(".", ",")` escrevia "R$ 56000,00" —
        // sem separador de milhar, fora do padrão de todo o resto da tela, do PDF e do WhatsApp.
        // Numa frase que recusa a venda, o número é o que a pessoa lê primeiro.
        mensagem: doPrazo.faixa
          ? `Em ${pedido.parcelas} parcelas a entrada mínima é ${reais(piso)} (faixa do ${
              doPrazo.faixa.nome
            }, ${doPrazo.faixa.entradaPercentual}%).`
          : `A entrada mínima deste empreendimento é ${reais(piso)}.`,
      });
    }

    // ⚠️ A ENTRADA TEM TETO: ela sozinha não passa do valor negociado. Sem isso, R$ 178.100
    // digitados sem a vírgula viram entrada de R$ 1.781.000 num lote de R$ 178.100, a proposta
    // atravessa a régua inteira e sai por WhatsApp para três pessoas com "120x de R$ 0,00" —
    // porque o que sobra para financiar é negativo. Um piso sozinho só protege de quem paga pouco.
    //
    // ⚠️ E O TETO É SÓ DA ENTRADA — SOMAR OS REFORÇOS AQUI RECUSA VENDA BOA. Uma versão anterior
    // somava entrada + reforços nominais e comparava com o preço à vista; medido contra o próprio
    // simulador, isso reprovava SETE composições que a tela recomenda, porque reforço que cai no
    // mês 72 não é dinheiro de hoje. Quem sabe se a composição fecha é o cronograma, que desconta
    // os reforços a valor presente (`valorPresenteDosBaloes`) e quebra quando o saldo fica
    // negativo. Aqui a régua é a do dinheiro do ATO.
    //
    // ⚠️ IGUAL AO VALOR PASSA: é a venda à vista, e recusá-la seria proibir o cliente de quitar
    // na assinatura. O que não pode é pagar MAIS do que o lote custa.
    if (centavos(pedido.entradaValor) > centavos(pedido.valorNegociado)) {
      erros.push({
        campo: "entrada",
        mensagem: `A entrada não pode passar do valor negociado (${reais(pedido.valorNegociado)}).`,
      });
    }
  }

  // ⚠️ `Number.isInteger` PRIMEIRO, E NÃO SÓ A FAIXA — aqui e nos dois blocos abaixo. Ele é
  // falso para NaN, e é isso que barra o campo vazio; trocá-lo por `pedido.entradaVezes < 1`
  // deixaria a quantidade indefinida passar, do mesmo jeito que a entrada passava.
  if (!Number.isInteger(pedido.entradaVezes) || pedido.entradaVezes < 1) {
    // Entrada à vista é 1x. Zero vezes seria uma entrada que ninguém paga nunca.
    erros.push({ campo: "entradaVezes", mensagem: "A entrada é paga em pelo menos 1 vez." });
  }

  if (!Number.isInteger(pedido.parcelas) || pedido.parcelas < 1) {
    erros.push({ campo: "parcelas", mensagem: "Informe o número de parcelas mensais." });
  }

  if (
    !Number.isInteger(pedido.vencimentoDia) ||
    pedido.vencimentoDia < 1 ||
    pedido.vencimentoDia > VENCIMENTO_DIA_MAXIMO
  ) {
    erros.push({
      campo: "vencimentoDia",
      mensagem: `Escolha um dia de vencimento entre 1 e ${VENCIMENTO_DIA_MAXIMO}.`,
    });
  }

  const primeira = diaDoCalendario(pedido.primeiraParcelaEm);
  const hoje = diaDoCalendario(agoraIso);
  if (!primeira) {
    erros.push({
      campo: "primeiraParcela",
      mensagem: "Informe a data da primeira parcela da entrada.",
    });
  } else if (hoje && primeira < hoje) {
    // ⚠️ COMPARA-SE DIA CONTRA DIA, não instante contra instante. Uma proposta gerada às 14h com a
    // primeira parcela HOJE tem `Date.parse` menor do que agora, e a comparação por instante
    // recusaria a data mais natural do mundo: a de hoje. O que não pode é cobrar no passado.
    erros.push({
      campo: "primeiraParcela",
      mensagem: "A primeira parcela da entrada não pode ser no passado.",
    });
  }

  // ── ATÉ QUANDO A PROPOSTA VALE ──────────────────────────────────────────
  //
  // ⚠️ AQUI A COMPARAÇÃO É POR INSTANTE, e não por dia como na primeira parcela — são perguntas
  // diferentes. A parcela é uma data de cobrança, e cobrar "hoje" é legítimo; a validade é um
  // limite que já passou ou não passou, e uma proposta que vence hoje às 8h não vale às 14h.
  // `vencimentoEmDias` (o mesmo da reserva) coloca o fim no último segundo do dia, então o prazo de
  // 3 dias vale até o fim do terceiro — que é o que a pessoa entende por "vale até quinta".
  const validade = Date.parse(pedido.validadeEm ?? "");
  const agora = Date.parse(agoraIso);
  if (!Number.isFinite(validade)) {
    erros.push({ campo: "validade", mensagem: "Informe até quando a proposta vale." });
  } else if (Number.isFinite(agora) && validade <= agora) {
    erros.push({ campo: "validade", mensagem: "A validade da proposta tem que ser no futuro." });
  } else if (
    Number.isFinite(agora) &&
    validade - agora > PRAZO_MAXIMO_DA_PROPOSTA * 86_400_000
  ) {
    erros.push({
      campo: "validade",
      mensagem: `A proposta vale no máximo por ${PRAZO_MAXIMO_DA_PROPOSTA} dias.`,
    });
  }

  return erros;
}

/** Formato do aviso: o mesmo de `reserva.ts` de propósito, porque quem dispara os dois é a mesma rota. */
export type AvisoDaProposta = {
  papel: "coordenador" | "corretor" | "imobiliaria";
  texto: string;
};

export type DadosDoAvisoDaProposta = {
  /**
   * O valor da PRIMEIRA parcela da entrada, quando ela difere das demais.
   *
   * ⚠️ SÓ IMPORTA NA ENTRADA MONTADA À MÃO. Na divisão igual ele é redundante — a própria frase já
   * diz o total e o número de vezes. Ausente = a mensagem não menciona.
   */
  entradaPrimeira?: null | number;
  cliente: string;
  /** `000123` — o COD da venda, o MESMO desde a reserva. */
  codigo: string;
  /** Quantos compradores no total, contando o titular. */
  compradores: number;
  corretor: null | string;
  cpf: string;
  empreendimento: string;
  entradaTotal: number;
  entradaVezes: number;
  imobiliaria: string;
  /** O valor de uma mensal. No plano que reajusta, é a do PRIMEIRO ciclo. */
  parcela: number;
  /**
   * A parcela é fixa pelo contrato inteiro, ou muda no aniversário?
   *
   * ⚠️ SEM ISSO A MENSAGEM MENTE. O PDF mostra as faixas de reajuste (`cronograma.ts`), mas quem
   * circula é o WhatsApp, e ele dizia "120x de R$ 1.480,50" também no SACOC — o plano de 21 dos
   * 24 empreendimentos, onde a parcela sobe de degrau no 13º mês. O corretor repassa o número ao
   * cliente e no ano seguinte o boleto vem maior do que o combinado.
   *
   * ⚠️ AUSENTE VALE COMO "REAJUSTA", e o padrão é de propósito o mais conservador: quem esquecer
   * de passar a marca faz a mensagem prometer de menos, não de mais. O contrário — assumir
   * parcela fixa — transformaria um esquecimento de quem chama em promessa quebrada com o
   * cliente, que é exatamente o defeito que esta marca existe para fechar.
   */
  parcelaFixa?: boolean;
  parcelas: number;
  primeiraParcelaEm: string;
  /** "Quadra 12 · Lote 06", como a tela escreve. */
  unidade: string;
  /**
   * Até quando a proposta vale — o mesmo ISO que foi gravado, não um prazo recontado aqui.
   *
   * ⚠️ AUSENTE OU ILEGÍVEL TIRA A LINHA, em vez de escrever meia frase. Quem esquecer de passar a
   * data manda uma mensagem sem prazo (que é o que as propostas importadas do C2X têm), e não uma
   * mensagem prometendo "vale até " sem o dia — o corretor repassa o texto ao cliente como veio.
   */
  validadeEm?: null | string;
  valorNegociado: number;
  vencimentoDia: number;
};

const MOEDA = new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" });

/**
 * "R$ 178.100,00".
 *
 * ⚠️ O ESPAÇO DO `Intl` É NÃO QUEBRÁVEL (U+00A0) e é invisível em qualquer lugar onde se leia o
 * texto: no log, no teste e no diff ele parece um espaço comum, mas `includes("R$ 178.100,00")`
 * falha sem dizer por quê. Trocado aqui, uma vez, em vez de virar mistério em cada leitor.
 */
function reais(valor: number): string {
  return MOEDA.format(Number.isFinite(valor) ? valor : 0).replace(/\u00a0/g, " ");
}

/**
 * As mensagens da proposta, uma por destinatário.
 *
 * ⚠️ TRÊS TEXTOS, E NÃO UM COPIADO TRÊS VEZES — a mesma razão dos avisos de reserva. O corretor
 * quer saber que a proposta do cliente DELE saiu e com quais condições; a imobiliária quer saber
 * qual corretor e qual unidade; o coordenador quer o quadro (unidade, cliente, valor, entrada,
 * parcela, prazo), que é o que ele confere antes de a minuta andar.
 *
 * ⚠️ NEGRITO DE WHATSAPP É *UM ASTERISCO*. Dois é Markdown, e chega literal na conversa.
 *
 * ⚠️ CPF VAI MASCARADO, por `mascararCpf` — a mesma função da reserva, e não uma segunda regra de
 * máscara. Ele está na mensagem para o corretor reconhecer o cliente dele, não para circular por
 * grupo de WhatsApp, e mensagem enviada não volta.
 *
 * ⚠️ A PARCELA SÓ É ANUNCIADA COMO ÚNICA QUANDO ELA É — ver `parcelaFixa`. O PDF traz as faixas
 * de reajuste; a mensagem, que é o que circula, precisa dizer "a partir de" nos planos que sobem
 * de degrau, senão o corretor repassa um número que o boleto do ano seguinte desmente.
 *
 * ⚠️ O COD VAI NAS TRÊS. É por ele que se acha a venda depois: quem recebeu a reserva no WhatsApp
 * anotou aquele número, e a proposta é a mesma venda. Mensagem sem COD obriga a abrir a tela para
 * descobrir de qual venda se fala.
 *
 * ⚠️ E A VALIDADE VAI NAS TRÊS TAMBÉM, pelo mesmo motivo que ela vai no PDF: preço tem prazo. A
 * data que aparece aqui é a que foi GRAVADA com a proposta — quem chama passa `validadeEm`, e esta
 * função não conta dias nenhum. Recontar o prazo na hora de escrever a mensagem faria o texto e o
 * documento discordarem sobre a mesma promessa.
 */
export function avisosDaProposta(dados: DadosDoAvisoDaProposta): AvisoDaProposta[] {
  const lote = `*${dados.unidade}* (${dados.empreendimento})`;
  const cliente = `*${dados.cliente}* (CPF ${mascararCpf(dados.cpf)})`;
  const cod = dados.codigo ? `COD *${dados.codigo}*.` : "";
  const desde = dataEscrita(dados.primeiraParcelaEm);

  // "R$ 17.810,00 em 2x, a primeira em 10/10/2026" — a entrada dividida em partes iguais, que é
  // como o Lucas a explicou na mesa. O desconto de valor presente não entra: entrada não se
  // desconta.
  //
  // ⚠️ COM ENTRADA MONTADA À MÃO, "EM 4x" PROMETE PARCELAS IGUAIS QUE NÃO EXISTEM. Quem monta
  // 10.000 + 6.000 + 6.000 + 6.000 recebia "R$ 28.000,00 em 4x" — e o corretor, lendo isso no
  // celular, divide por quatro e diz ao cliente que a primeira é R$ 7.000. O valor da primeira é o
  // que ele precisa saber para conversar, e é a única linha da mensagem em que ele repara antes de
  // responder. Só entra quando as parcelas de fato diferem: escrever "a 1ª de R$ 7.000" numa
  // divisão igual é ruído.
  const primeiraDiferente =
    dados.entradaPrimeira !== null &&
    dados.entradaPrimeira !== undefined &&
    dados.entradaVezes > 1 &&
    Math.round(dados.entradaPrimeira * 100) !==
      Math.round((dados.entradaTotal / dados.entradaVezes) * 100);
  const entrada = `*${reais(dados.entradaTotal)}* em *${dados.entradaVezes}x*${
    primeiraDiferente ? `, a 1ª de *${reais(dados.entradaPrimeira as number)}*` : ""
  }${desde ? `, a primeira em *${desde}*` : ""}`;
  // ⚠️ "120x DE" É PROMESSA DE PARCELA ÚNICA, e no SACOC ela não se cumpre: a parcela muda no 13º
  // mês. Quem reajusta ganha "a partir de" e a lembrança do reajuste anual — uma frase, não um
  // parágrafo, porque isto é WhatsApp e ninguém lê o segundo parágrafo antes de responder.
  const mensais = dados.parcelaFixa
    ? `*${dados.parcelas}x de ${reais(dados.parcela)}*`
    : `*${dados.parcelas}x a partir de ${reais(dados.parcela)}* (com reajuste anual)`;
  const vencimento = `todo dia *${dados.vencimentoDia}*`;
  // ⚠️ O PRAZO VAI NAS TRÊS, e curto: é WhatsApp. A mensagem é o que circula — o PDF fica no anexo
  // que nem sempre se abre no celular —, e uma condição sem data de validade é lida como preço
  // parado no tempo. É a mesma frase da reserva ("A reserva vale até *DD/MM*"), no mesmo formato de
  // data do resto da mensagem, para o corretor não ter que traduzir dois formatos na mesma conversa.
  const ate = dataEscrita(dados.validadeEm);
  const vale = ate ? `Proposta válida até *${ate}*.` : null;
  const anexo = "O PDF da proposta vai em anexo.";
  const outros = dados.compradores > 1 ? `Compradores: *${dados.compradores}*` : null;

  // ⚠️ NULO É "NÃO HÁ O QUE DIZER"; "" É LINHA EM BRANCO DE PROPÓSITO. A distinção existe porque
  // sem ela o coordenador recebia um buraco no meio da lista quando o comprador era único: o
  // filtro só derruba vazio REPETIDO, e o vazio de um campo ausente fica cercado de conteúdo dos
  // dois lados, então sobrevive. Some o ausente primeiro, depois colapse os separadores.
  const juntar = (linhas: (null | string)[]) =>
    linhas
      .filter((l): l is string => l !== null)
      .filter((l, i, todas) => l !== "" || (i > 0 && todas[i - 1] !== ""))
      .join("\n");

  return [
    {
      papel: "corretor",
      texto: juntar([
        `Olá, ${dados.corretor ?? "tudo bem"}!`,
        "",
        `A proposta da unidade ${lote} para ${cliente} foi *gerada*. ${cod}`.trim(),
        "",
        `Valor negociado: *${reais(dados.valorNegociado)}*`,
        `Entrada: ${entrada}`,
        `Parcelas: ${mensais}, ${vencimento}`,
        vale,
        "",
        `${anexo} Confira com o cliente antes de seguir para a minuta.`,
      ]),
    },
    {
      papel: "imobiliaria",
      texto: juntar([
        `Olá, ${dados.imobiliaria}!`,
        "",
        `Saiu a proposta da unidade ${lote} para ${cliente}. ${cod}`.trim(),
        dados.corretor
          ? `Corretor responsável: *${dados.corretor}*.`
          : "Proposta no nome da imobiliária.",
        "",
        `Entrada ${entrada}`,
        `Parcelas ${mensais}, ${vencimento}`,
        vale,
        "",
        anexo,
      ]),
    },
    {
      papel: "coordenador",
      texto: juntar([
        `Proposta gerada em ${dados.empreendimento}.`,
        "",
        `Unidade: ${lote}`,
        `Cliente: ${cliente}`,
        outros,
        `Imobiliária: *${dados.imobiliaria}*`,
        dados.corretor ? `Corretor: *${dados.corretor}*` : "Corretor: não informado",
        `Valor negociado: *${reais(dados.valorNegociado)}*`,
        `Entrada: ${entrada}`,
        `Parcelas: ${mensais}`,
        `Vencimento: ${vencimento}`,
        // O quadro do coordenador é uma lista de rótulos; a mesma data entra aqui como campo, e não
        // como frase, para ele conferir de cima a baixo sem ler um parágrafo no meio da lista.
        ate ? `Válida até: *${ate}*` : null,
        dados.codigo ? `COD: *${dados.codigo}*` : null,
        "",
        anexo,
      ]),
    },
  ];
}

// ── O CANCELAMENTO DA PROPOSTA ──────────────────────────────────────────────
//
// Lucas (04/09/2026), sobre a reserva: *"da reserva eu tenho dois caminhos, gerar proposta ou
// cancelar"*. A proposta herda a mesma regra, e por um motivo que só aparece depois do clique: sem
// a volta, cada "Gerar proposta" tirava um lote do estoque PARA SEMPRE. Cliente desiste, crédito
// reprova, o coordenador errou o plano — a rotina do comercial — e a unidade ficava em `proposta`,
// invendável pela tela e pela API, com o preço já circulando por WhatsApp na mão de três pessoas.
// O único jeito de soltar era UPDATE na mão no banco.

/**
 * ⚠️ NÃO SÃO OS MESMOS MOTIVOS DA RESERVA, e a diferença é o que aconteceu no meio. Quem cancela
 * proposta já mandou condições ao cliente: ele pode ter recusado o preço, pedido outro plano ou
 * sumido depois de ler o PDF. "Reserva feita por engano" também não cabe — o engano aqui é da
 * proposta, que já saiu no papel.
 */
export const MOTIVOS_DE_CANCELAMENTO_DA_PROPOSTA = [
  "Cliente desistiu",
  "Condições não aceitas",
  "Cliente pediu outro plano",
  "Trocou de unidade",
  "Crédito não aprovado",
  "Proposta feita por engano",
  "Prazo da proposta esgotado",
  "Outro",
] as const;

export type PedidoDeCancelamentoDaProposta = {
  /** O texto livre. Obrigatório só quando o motivo é "Outro". */
  detalhe?: null | string;
  motivo: string;
  /**
   * A proposta que a TELA está vendo. Opcional, e é uma trava contra tela velha.
   *
   * ⚠️ ENDEREÇAR SÓ PELA UNIDADE CANCELA A PROPOSTA DE OUTRO CLIENTE. A aba fica aberta a manhã
   * toda: às 9h o coordenador A vê o lote 12 em proposta, do João; às 9h20 o coordenador B cancela
   * essa proposta, reserva o mesmo lote para a Maria e gera a proposta dela; às 9h40 A, que não
   * recarregou, clica em "Cancelar proposta" — e a busca por unidade acha a proposta da MARIA, viva
   * e legítima. Ela cai, a reserva dela cai junto, e os três recebem "a proposta de Maria foi
   * cancelada. Motivo: Cliente desistiu". A modal só mostra o nome da unidade, então A nunca
   * percebe. Com o id, o servidor recusa e manda recarregar.
   */
  propostaId?: null | string;
  unidadeId: string;
};

export type ErroDoCancelamentoDaProposta = {
  campo: "detalhe" | "motivo" | "unidade";
  mensagem: string;
};

/** O que impede este cancelamento de acontecer. */
export function conferirCancelamentoDaProposta(
  pedido: PedidoDeCancelamentoDaProposta,
): ErroDoCancelamentoDaProposta[] {
  const erros: ErroDoCancelamentoDaProposta[] = [];

  if (!String(pedido.unidadeId ?? "").trim()) {
    erros.push({ campo: "unidade", mensagem: "Escolha a unidade." });
  }

  const motivo = String(pedido.motivo ?? "").trim();
  if (!motivo) {
    erros.push({ campo: "motivo", mensagem: "Diga por que a proposta está sendo cancelada." });
  } else if (!(MOTIVOS_DE_CANCELAMENTO_DA_PROPOSTA as readonly string[]).includes(motivo)) {
    erros.push({ campo: "motivo", mensagem: "Escolha um motivo da lista." });
  }

  // ⚠️ "OUTRO" SEM DETALHE É UM CANCELAMENTO SEM MOTIVO. A proposta cancelada continua no
  // histórico da unidade respondendo "por que este lote soltou" — e "Outro", sozinho, não responde.
  if (motivo === "Outro" && !String(pedido.detalhe ?? "").trim()) {
    erros.push({ campo: "detalhe", mensagem: "Escreva o motivo." });
  }

  return erros;
}

export type DadosDoCancelamentoDaProposta = {
  cliente: string;
  codigo: null | string;
  corretor: null | string;
  empreendimento: string;
  imobiliaria: string;
  motivo: string;
  unidade: string;
};

/**
 * As três mensagens do cancelamento.
 *
 * ⚠️ ELAS DIZEM QUE O PDF NÃO VALE MAIS, e isso é o ponto. O documento já está no celular das três
 * pessoas e não some de lá; a mensagem é a única coisa que o desfaz. Sem essa frase, o corretor
 * segue com um papel de preço na mão e o cliente assina uma condição que a casa não sustenta mais.
 */
export function avisosDeCancelamentoDaProposta(
  dados: DadosDoCancelamentoDaProposta,
): AvisoDaProposta[] {
  const lote = `*${dados.unidade}* (${dados.empreendimento})`;
  const cod = dados.codigo ? ` COD *${dados.codigo}*.` : "";
  const juntar = (linhas: string[]) =>
    linhas.filter((l, i, todas) => l !== "" || (i > 0 && todas[i - 1] !== "")).join("\n");

  return [
    {
      papel: "corretor",
      texto: juntar([
        `Olá, ${dados.corretor ?? "tudo bem"}!`,
        "",
        `A proposta da unidade ${lote}, de *${dados.cliente}*, foi *cancelada*.`,
        `Motivo: ${dados.motivo}.${cod}`,
        "",
        "O PDF que foi enviado não vale mais. A unidade já voltou para a disponibilidade e pode ser reservada de novo.",
      ]),
    },
    {
      papel: "imobiliaria",
      texto: juntar([
        `Olá, ${dados.imobiliaria}!`,
        "",
        `A proposta da unidade ${lote}, de *${dados.cliente}*, foi *cancelada*.`,
        `Motivo: ${dados.motivo}.${cod}`,
        dados.corretor ? `Corretor: *${dados.corretor}*.` : "",
        "",
        "O PDF que foi enviado não vale mais. A unidade voltou para a disponibilidade.",
      ]),
    },
    {
      papel: "coordenador",
      texto: juntar([
        `Proposta cancelada em ${dados.empreendimento}.`,
        "",
        `Unidade: ${lote}`,
        `Cliente: *${dados.cliente}*`,
        `Imobiliária: *${dados.imobiliaria}*`,
        dados.corretor ? `Corretor: *${dados.corretor}*` : "Corretor: não informado",
        `Motivo: *${dados.motivo}*`,
        dados.codigo ? `COD: *${dados.codigo}*` : "",
        "",
        "A unidade voltou para a disponibilidade.",
      ]),
    },
  ];
}
