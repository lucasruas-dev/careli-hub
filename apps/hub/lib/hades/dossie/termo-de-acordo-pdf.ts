// O TERMO DE ACORDO: o papel que o cliente recebe quando aceita parcelar o que está vencido.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ UMA PÁGINA, NO PAPEL DO EXTRATO, E SEM ASSINATURA (pedido do dono do produto, 16/09/2026)
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// Até 15/09/2026 esta peça transcrevia PALAVRA POR PALAVRA o "Instrumento particular de acordo para
// regularização de inadimplência" feito à mão: título duplicado, três seções só para identificar
// comprador, empreendimento e unidade, linguagem de cartório e duas folhas. Em 16/09/2026 o dono do
// produto olhou o PDF e pediu outra coisa: *"achei muito formal, tinha que caber tudo em uma pagina
// somente"*, *"nao precisa colocar quem assina"*, e mandou o print do EXTRATO como referência. Essa
// regra SUBSTITUI a do texto fixo. Por isso:
//
//   - o cabeçalho, os três cartões e as tabelas limpas são os do extrato (`lib/apolo/pdf-timbrado.ts`,
//     para onde os cartões e o cabeçalho com a unidade à direita subiram no mesmo dia);
//   - as duas cláusulas do modelo ("manutenção das parcelas mensais regulares" e "inadimplemento do
//     acordo") viraram três frases diretas, sem perder nenhum dos efeitos. ⚠️ EM 20/09/2026 ESSAS
//     TRÊS FRASES SAÍRAM e entrou, no lugar delas, o texto do jurídico que o Lucas mandou
//     (`TEXTO_LEGAL_DO_ACORDO`) — literal, porque agora este papel vai para a assinatura das três
//     partes na Clicksign;
//   - não há fecho "Belo Horizonte/MG, <data>" nem bloco de assinatura. Sem assinatura o fecho vira
//     linha solta, e a data de emissão vai no rodapé. ⚠️ `blocoDeAssinatura` CONTINUA em
//     `pdf-timbrado.ts`: a assinatura volta num segundo momento, e é lá que ela mora.
//
// ⚠️ ESTA LIB NÃO CALCULA O ACORDO. Ela desenha o que o acordo já decidiu. O valor atualizado chega
// pronto de quem monta o acordo (a tela de propostas do Hades, que grava em `guardian_compromissos`);
// a régua de atualização não foi confirmada, e inventar a conta aqui faria o papel afirmar uma
// memória de cálculo que ninguém conferiu. Ver `termo-de-acordo-dados.ts`.
//
// ⚠️ MAS O QUE ELA IMPRIME, ELA SOMA. O total em atraso é a soma das parcelas que o papel lista, e
// não um número recebido por fora: um documento cujo total não fecha com as próprias linhas não se
// sustenta na frente do cliente nem do advogado dele (é a lição do relatório de rescisão feito à
// mão, com R$ 481,94 de diferença entre as linhas e o total).
//
// ⚠️ A DATA EM QUE O DÉBITO FOI CONGELADO SAI DUAS VEZES: no cabeçalho e no cartão do valor. O acordo
// é sobre o débito de UMA data; sem ela impressa, duas vias do mesmo acordo impressas em dias
// diferentes não teriam como provar que falam do mesmo número.
//
// ⚠️ A SOBRA DE CENTAVO VAI PARA A ÚLTIMA PARCELA. No caso do modelo, 4 × R$ 591,08 = R$ 2.364,32
// contra R$ 2.364,33 acordados. A última, e não a primeira, porque é o que a tela que gera o acordo
// já faz (o papel imprime o mesmo valor do boleto) e porque a primeira costuma ser a combinada de
// viva voz.
//
// ⚠️ "DOCUMENTO DE IDENTIFICAÇÃO" NÃO ENTRA: 0% dos 2.282 clientes com contrato têm o documento
// preenchido no C2X. O CPF sai INTEIRO (e não mascarado, como no extrato): este é um instrumento
// que identifica a parte.
import {
  A4,
  abrirDocumento,
  cabecalhoComBlocoADireita,
  type Cartao,
  type Ctx,
  desenharCartoes,
  desenharRodapes,
  desenharTabelaLimpa,
  dinheiro,
  encurtar,
  escrever,
  escreverDireita,
  FOOT,
  garantirEspaco,
  INK,
  LINE,
  MARGIN,
  MUTE,
  paragrafo,
  quebrar,
  sanitizarNomeDeArquivo,
  SOFT_TEXT,
  TEXT,
  tituloDeSecao,
  USABLE,
} from "@/lib/apolo/pdf-timbrado";

// ────────────────────────────────────────────────────────────────────────────────────────────
// O QUE O DOCUMENTO RECEBE
// ────────────────────────────────────────────────────────────────────────────────────────────

/** Uma parcela do acordo: o que o cliente vai pagar, e quando. */
export type ParcelaDoAcordo = {
  valor: number;
  /** Já formatado como o cliente lê ("15/07/2026"). */
  vencimento: string;
};

/**
 * Uma parcela do contrato que está vencida e entrou no acordo.
 *
 * ⚠️ `numero` É TEXTO, e não número: o C2X nomeia a parcela como "19/144", mas também como "Ato",
 * "Sinal 2/3" e "Intercalada". Converter para inteiro perderia o caso que mais aparece em acordo.
 */
export type ParcelaEmAtraso = {
  numero: string;
  valor: number;
  /** Já formatado como o cliente lê ("15/05/2026"). */
  vencimento: string;
};

export type DadosDoTermoDeAcordo = {
  comprador: {
    cpf: string;
    endereco: string;
    estadoCivil: string;
    nacionalidade: string;
    nome: string;
    profissao: string;
  };
  /**
   * O débito, CONGELADO na data de apuração.
   *
   * ⚠️ `valorAtualizado` VEM PRONTO e é a única entrada que esta lib não confere: a régua de
   * atualização ainda não foi confirmada (ver o cabeçalho do arquivo).
   */
  debito: {
    /** A data de referência do congelamento: vai impressa no cabeçalho e no cartão do valor. */
    apuradoEm: string;
    parcelas: ParcelaEmAtraso[];
    /** O último vencimento do acordo ("data prevista para pagamento" do modelo). */
    previsaoDePagamento: string;
    valorAtualizado: number;
    /** "15/05/2026", ou "15/03/2026 a 15/05/2026" quando as parcelas vencem em datas diferentes. */
    vencimentoConsiderado: string;
  };
  emitidoEm: Date;
  empreendimento: string;
  /** As parcelas negociadas. A soma delas TEM de fechar com `debito.valorAtualizado`. */
  parcelasDoAcordo: ParcelaDoAcordo[];
  /** O código da venda no C2X ("VDO1301"). */
  pv: string;
  /** "Quadra 13 - Lote 01". */
  unidade: string;
};

// ────────────────────────────────────────────────────────────────────────────────────────────
// O TEXTO (é o que o teste cobra)
// ────────────────────────────────────────────────────────────────────────────────────────────

export const TITULO_DO_TERMO_DE_ACORDO = "Termo de Acordo";

/**
 * O título do bloco de fecho, como o Lucas escreveu no print.
 *
 * ⚠️ ELE NÃO É MAIS "IMPORTANTE". Até 19/09/2026 o bloco se chamava assim e trazia três frases
 * escritas por nós; o texto que o Lucas mandou em 20/09/2026 vem com o PRÓPRIO cabeçalho, e trocar
 * o cabeçalho dele pelo nosso seria reescrever o que ele pediu para entrar literal.
 */
export const TITULO_DO_ACEITE = "ACEITE E CONDIÇÕES DO ACORDO";

/**
 * O TEXTO LEGAL DO ACORDO — LITERAL, palavra por palavra, como o dono do produto mandou.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ AQUI NÃO SE EDITA REDAÇÃO. Lucas, 20/09/2026: *"o que esta hoje esta aprovado quero so incluir
 * o texto legal substituindo o texto de observacao"*.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Este papel vai para a assinatura do comprador, do incorporador e da Careli: o que ele diz é o que
 * as três partes assumem. Até 19/09/2026 o fecho era `REGRAS_DO_ACORDO`, três frases nossas, que
 * resumiam sem advogado os dois blocos do modelo feito à mão. O texto abaixo é o do JURÍDICO e
 * SUBSTITUI aquelas frases: ele cobre os mesmos efeitos (só as parcelas em atraso, as vincendas
 * continuam vencendo, o não pagamento cancela as condições e atualiza o débito) e acrescenta os dois
 * que faltavam: a tratativa extrajudicial pelo escritório de advocacia, com custos e honorários, e
 * a declaração de leitura e aceite.
 *
 * ⚠️ UM ITEM DO ARRAY É UM PARÁGRAFO, e a quebra entre eles é a do print. Juntar dois num só, ou
 * partir um em dois, mudaria a leitura de um texto que foi aprovado como está.
 *
 * ⚠️ NÃO LEVA TRAVESSÃO NEM TÓPICO. São seis parágrafos de prosa corrida, e é assim que eles são
 * desenhados (`paragrafo`, na largura cheia) — a bolinha de `topico`, que o bloco antigo usava,
 * transformaria um texto jurídico numa lista de obrigações e roubaria 12pt de recuo por linha.
 *
 * ⚠️ A ACENTUAÇÃO PASSA INTEIRA no WinAnsi das fontes padrão (Ç, Õ, à, ã, é, ê, ú estão todos na
 * faixa \xA0-\xFF que `limpar` preserva). Nenhum caractere deste texto é comido no desenho.
 */
export const TEXTO_LEGAL_DO_ACORDO: string[] = [
  "Ao assinar este termo, as partes declaram que estão de acordo com os valores, prazos e condições de pagamento aqui apresentados.",
  "Este acordo refere-se somente às parcelas em atraso indicadas neste documento. As demais parcelas do contrato continuam vencendo normalmente e deverão ser pagas nas datas previstas.",
  "Caso alguma parcela deste acordo não seja paga no vencimento, as condições negociadas poderão ser canceladas e o débito será atualizado conforme as regras do contrato.",
  "Nesse caso, a cobrança poderá seguir por tratativa extrajudicial, inclusive por meio do escritório de advocacia responsável, podendo haver custos, encargos e honorários relacionados à cobrança, quando aplicáveis conforme o contrato e a legislação.",
  "Se não houver regularização, poderão ser adotadas as medidas judiciais cabíveis.",
  "Ao assinar, o COMPRADOR declara que leu, compreendeu e aceita estas condições.",
];

/**
 * QUEM ASSINA, dito no papel. Uma frase, e ela não faz parte do texto do jurídico.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ ELA NASCEU EM 20/09/2026, COM A ASSINATURA. Até aquele dia o termo era um IMPRESSO, e o
 * próprio Lucas tinha dito *"não precisa colocar quem assina"*. No mesmo dia ele pediu o contrário
 * do contrário: *"vamos levar esse documento para ser assinado na click. quem vai, o comprador, o
 * incorporador e a nivea careli"*. O papel passou a ter TRÊS partes e continuava qualificando UMA,
 * enquanto a primeira frase do texto legal fala no plural: *"as partes declaram que estão de
 * acordo"*. Um instrumento que diz "as partes" e não diz quem são é exatamente o que a outra ponta
 * discute depois.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ E ELA NOMEIA OS PAPÉIS, NÃO AS PESSOAS, E ISSO É MEDIDO. Qualificar a vendedora exigiria razão
 * social, CNPJ e representante legal, que NENHUM dos dois caminhos do papel lê hoje: a montagem
 * (`lib/hades/acordo/termo-em-pdf.ts`) recebe o acordo e a ficha do C2X, e quem lê o quadro do
 * empreendimento é só o ENVIO. Ou o download passaria a abrir o Panteon também, ou os dois papéis
 * divergiriam, que é justamente o que `termo-em-pdf.ts` existe para impedir. Some-se o custo de
 * folha: o bloco do COMPRADOR ocupa cerca de 44pt, e repeti-lo para mais duas partes derrubaria a
 * folha única que as 35 formas de produção têm hoje.
 *
 * ⚠️ QUEM QUALIFICA AS OUTRAS DUAS É A PÁGINA DE ASSINATURAS DA CLICKSIGN, e a frase diz isso com
 * todas as letras em vez de deixar subentendido. Ela traz nome, e-mail, data, hora e o hash do
 * documento de cada signatário. ⚠️ SE O LUCAS QUISER A QUALIFICAÇÃO COMPLETA NO CORPO DO PAPEL, é
 * uma decisão dele, e ela precisa acontecer ANTES de `TERMO_DE_ACORDO_LIBERADO` virar `true`:
 * implica ler o Panteon também no download e medir de novo a folha única.
 */
export const QUEM_ASSINA_O_TERMO =
  "Assinam este termo o COMPRADOR, a VENDEDORA do empreendimento e a CARELI, administradora da carteira.";

// ────────────────────────────────────────────────────────────────────────────────────────────
// AS FUNÇÕES PURAS QUE MONTAM AS FRASES E OS NÚMEROS
// ────────────────────────────────────────────────────────────────────────────────────────────

/** Dinheiro não carrega a sujeira do ponto flutuante: centavo antes de somar e de comparar. */
const centavos = (valor: number): number =>
  Math.round((Number.isFinite(valor) ? valor : 0) * 100) / 100;

const doisDigitos = (valor: number): string => String(valor).padStart(2, "0");

/** "1 parcela", "12 parcelas". */
export function quantasParcelas(quantidade: number): string {
  return `${quantidade} ${quantidade === 1 ? "parcela" : "parcelas"}`;
}

/** A soma do que o papel LISTA, nunca um total recebido por fora. */
export function totalNominalEmAtraso(parcelas: ParcelaEmAtraso[]): number {
  return centavos(parcelas.reduce((soma, parcela) => soma + centavos(parcela.valor), 0));
}

/**
 * Fecha as parcelas do acordo com o valor acordado, jogando a sobra de centavos na ÚLTIMA.
 *
 * ⚠️ DIVERGÊNCIA GRANDE NÃO É ARREDONDAMENTO, E POR ISSO ESTOURA. A sobra que o arredondamento
 * consegue produzir é de no máximo meio centavo por parcela; qualquer coisa acima de um centavo por
 * parcela é erro de quem montou o acordo, e absorver isso calado na última parcela esconderia o
 * erro dentro do documento que o cliente assina.
 */
export function fecharParcelasComTotal(
  parcelas: ParcelaDoAcordo[],
  total: number,
): { parcelas: ParcelaDoAcordo[]; sobra: number } {
  const alvo = centavos(total);
  const arredondadas = parcelas.map((parcela) => ({
    ...parcela,
    valor: centavos(parcela.valor),
  }));
  const soma = centavos(arredondadas.reduce((acc, parcela) => acc + parcela.valor, 0));
  const sobra = centavos(alvo - soma);

  if (!arredondadas.length || sobra === 0) return { parcelas: arredondadas, sobra };

  const tolerancia = centavos(arredondadas.length * 0.01);
  if (Math.abs(sobra) > tolerancia) {
    throw new Error(
      `A soma das parcelas do acordo (${dinheiro(soma)}) diverge do valor acordado `
      + `(${dinheiro(alvo)}) em ${dinheiro(sobra)}, muito além do arredondamento. `
      + "Confira o acordo antes de emitir o termo.",
    );
  }

  const ultimo = arredondadas.length - 1;
  return {
    parcelas: arredondadas.map((parcela, indice) =>
      indice === ultimo ? { ...parcela, valor: centavos(parcela.valor + sobra) } : parcela,
    ),
    sobra,
  };
}

/**
 * A frase logo abaixo dos cartões: de onde vem o valor do acordo, e por que ele não muda.
 *
 * ⚠️ É ESTA FRASE QUE IMPEDE DUAS VIAS DIFERENTES do mesmo acordo. Quem recebe o papel meses depois
 * precisa saber a que dia se referem os valores, e que reimprimir não os recalcula.
 */
export function fraseDoCongelamento(apuradoEm: string): string {
  return (
    `O valor do acordo é o débito das parcelas em atraso, negociado e atualizado até ${apuradoEm}. `
    + "Os valores ficam congelados nessa data e não mudam quando este termo é impresso de novo."
  );
}

/**
 * O cartão "Como vai pagar": a condição num número grande e o detalhe numa linha.
 *
 * ⚠️ QUANDO A ÚLTIMA PARCELA É DIFERENTE, O DETALHE DIZ ISSO. Escrever "4x R$ 591,08" com uma delas
 * em R$ 591,09 e calar seria repetir, no cartão, o erro que o arredondamento acabou de corrigir na
 * tabela. E o detalhe diz só até quando, e não "de ... a ...": a linha do cartão tem ~140pt, e no
 * primeiro PDF do caso pesado "a última de R$ 541,64, de 10/10/2026 a 10/09/2027" saiu cortada com
 * reticências justo na data.
 *
 * ⚠️ ENTRADA DIFERENTE NÃO VIRA "5x". A tela do Hades monta o acordo como entrada + N iguais; "5x R$
 * 341,08" com uma entrada de R$ 1.000,00 seria um número que nenhum boleto tem.
 */
export function resumoDoPagamento(parcelas: ParcelaDoAcordo[]): { apoio: string; valor: string } {
  const valores = parcelas.map((parcela) => centavos(parcela.valor));
  const primeiro = valores[0];
  const ultimo = valores[valores.length - 1];
  const primeiraData = parcelas[0]?.vencimento ?? "-";
  const ultimaData = parcelas[parcelas.length - 1]?.vencimento ?? "-";

  if (primeiro === undefined || ultimo === undefined) {
    return { apoio: "Sem parcelas definidas", valor: "-" };
  }
  if (valores.length === 1) {
    return { apoio: `Parcela única, em ${primeiraData}`, valor: dinheiro(primeiro) };
  }

  const periodo = `de ${primeiraData} a ${ultimaData}`;
  const quantidade = valores.length;
  const miolo = valores.slice(1, -1);

  if (valores.every((valor) => valor === primeiro)) {
    return { apoio: periodo, valor: `${quantidade}x ${dinheiro(primeiro)}` };
  }
  if (miolo.every((valor) => valor === primeiro)) {
    return {
      apoio: `a última de ${dinheiro(ultimo)}, até ${ultimaData}`,
      valor: `${quantidade}x ${dinheiro(primeiro)}`,
    };
  }

  const resto = valores.slice(1);
  const segundo = resto[0] ?? 0;
  if (resto.slice(0, -1).every((valor) => valor === segundo)) {
    return {
      apoio: `entrada de ${dinheiro(primeiro)} + ${resto.length}x ${dinheiro(segundo)}`,
      valor: quantasParcelas(quantidade),
    };
  }
  return { apoio: periodo, valor: quantasParcelas(quantidade) };
}

/**
 * Os três cartões do topo: quanto está em atraso, quanto ficou o acordo, e como vai ser pago.
 *
 * ⚠️ O PRIMEIRO CARTÃO É O NOMINAL (a soma das linhas da tabela) e diz isso no rótulo, com as
 * mesmas palavras do extrato ("valores originais"): quem vê R$ 941,62 ao lado de R$ 969,87 precisa
 * saber, sem ler mais nada, qual dos dois é o que vai pagar.
 */
export function cartoesDoTermoDeAcordo(
  dados: DadosDoTermoDeAcordo,
  parcelasDoAcordo: ParcelaDoAcordo[],
): Cartao[] {
  const emAtraso = dados.debito.parcelas.length;
  const vencimento = dados.debito.vencimentoConsiderado;
  const quando = vencimento.includes(" a ")
    ? `de ${vencimento}`
    : `${emAtraso === 1 ? "vencida" : "vencidas"} em ${vencimento}`;
  const pagamento = resumoDoPagamento(parcelasDoAcordo);

  return [
    {
      apoio: `${quantasParcelas(emAtraso)}, ${quando}`,
      icone: "alerta",
      rotulo: "Em atraso (valores originais)",
      valor: dinheiro(totalNominalEmAtraso(dados.debito.parcelas)),
    },
    {
      apoio: `congelado em ${dados.debito.apuradoEm}`,
      icone: "saldo",
      rotulo: "Valor do acordo",
      valor: dinheiro(dados.debito.valorAtualizado),
    },
    {
      apoio: pagamento.apoio,
      icone: "relogio",
      rotulo: "Como vai pagar",
      valor: pagamento.valor,
    },
  ];
}

/**
 * "Rua X - 10 - Centro" vira "Rua X, 10, Centro".
 *
 * ⚠️ O HÍFEN CERCADO DE ESPAÇOS É TRAVESSÃO DISFARÇADO, e texto visível da casa não leva travessão.
 * A ficha do Hades escreve endereço e unidade assim, e o termo imprime o que a ficha mostra: a troca
 * é só de pontuação, no papel. O hífen colado ("35.680-448", "Q-12") fica.
 */
export function semTracoSeparador(texto: string): string {
  return texto.replace(/\s+[-–—]\s+/g, ", ");
}

/** "Brasileira, Solteiro(a), Analista Jurídico", sem os campos vazios. */
export function qualificacaoEmUmaLinha(comprador: DadosDoTermoDeAcordo["comprador"]): string {
  return [comprador.nacionalidade, comprador.estadoCivil, comprador.profissao]
    .map((parte) => (parte ?? "").trim())
    .filter((parte) => parte && parte !== "-")
    .join(", ");
}

/** "Termo de Acordo - FULANO - VDO1301 - 10-07-2026.pdf". */
export function nomeDoArquivoDoTermoDeAcordo(dados: DadosDoTermoDeAcordo): string {
  const data = [
    doisDigitos(dados.emitidoEm.getDate()),
    doisDigitos(dados.emitidoEm.getMonth() + 1),
    dados.emitidoEm.getFullYear(),
  ].join("-");

  return sanitizarNomeDeArquivo(
    `Termo de Acordo - ${dados.comprador.nome} - ${dados.pv} - ${data}.pdf`,
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// O DESENHO
// ────────────────────────────────────────────────────────────────────────────────────────────

/** Onde o texto não pode passar: a linha do rodapé, com a mesma folga de `garantirEspaco`. */
const CHAO = FOOT + 16;
/** A coluna da unidade na ficha começa onde começa o terceiro cartão: o olho lê as duas alinhadas. */
const INICIO_DA_UNIDADE = MARGIN + ((USABLE - 20) / 3 + 10) * 2;

/** Rótulo pequeno em caixa alta cinza, como os da ficha do extrato. */
function rotulo(ctx: Ctx, texto: string, x: number, y: number): void {
  escrever(ctx, texto.toUpperCase(), { color: MUTE, font: ctx.bold, size: 5.8, x, y });
}

/** Escreve as linhas quebradas a partir de `y` e devolve a linha de base seguinte. */
function linhasEmColuna(
  ctx: Ctx,
  texto: string,
  { bold = false, color = TEXT, largura, passo, size, x, y }: {
    bold?: boolean;
    color?: typeof TEXT;
    largura: number;
    passo: number;
    size: number;
    x: number;
    y: number;
  },
): number {
  const font = bold ? ctx.bold : ctx.font;
  let linhaDeBase = y;
  for (const linha of quebrar(texto || "-", font, size, largura)) {
    escrever(ctx, linha, { color, font, size, x, y: linhaDeBase });
    linhaDeBase -= passo;
  }
  return linhaDeBase;
}

/**
 * A ficha: o comprador à esquerda, a unidade à direita.
 *
 * ⚠️ A QUALIFICAÇÃO FICA, EM UMA LINHA PEQUENA, E NÃO EM TRÊS CAMPOS. Nacionalidade, estado civil e
 * profissão identificam a parte num instrumento, e cabem numa linha só de 7,6pt; em pares
 * rótulo/valor lado a lado, como no extrato, "Casado(a) sob o regime de comunhão parcial de bens"
 * sairia cortado com reticências, e qualificação cortada é pior que qualificação nenhuma.
 */
function desenharFicha(ctx: Ctx, dados: DadosDoTermoDeAcordo): void {
  const topo = ctx.y;
  const larguraDoComprador = INICIO_DA_UNIDADE - MARGIN - 14;
  const larguraDaUnidade = A4.w - MARGIN - INICIO_DA_UNIDADE;

  rotulo(ctx, "Comprador", MARGIN, topo);
  let esquerda = linhasEmColuna(ctx, dados.comprador.nome, {
    bold: true,
    color: INK,
    largura: larguraDoComprador,
    passo: 11.5,
    size: 9.5,
    x: MARGIN,
    y: topo - 11,
  });
  esquerda = linhasEmColuna(ctx, `CPF ${dados.comprador.cpf || "-"}`, {
    bold: true,
    largura: larguraDoComprador,
    passo: 10.6,
    size: 8,
    x: MARGIN,
    y: esquerda,
  });
  const qualificacao = qualificacaoEmUmaLinha(dados.comprador);
  if (qualificacao) {
    esquerda = linhasEmColuna(ctx, qualificacao, {
      color: SOFT_TEXT,
      largura: larguraDoComprador,
      passo: 10,
      size: 7.6,
      x: MARGIN,
      y: esquerda,
    });
  }
  // Endereço que a ficha do Hades não tem chega como "-": um hífen sozinho numa linha não é dado.
  const endereco = semTracoSeparador(dados.comprador.endereco ?? "").trim();
  if (endereco && endereco !== "-") {
    esquerda = linhasEmColuna(ctx, endereco, {
      color: SOFT_TEXT,
      largura: larguraDoComprador,
      passo: 10,
      size: 7.6,
      x: MARGIN,
      y: esquerda,
    });
  }

  // Sem quadra e lote, a unidade é o próprio código da venda: o PV sobe para o destaque e não se
  // repete na linha de baixo.
  const unidade = semTracoSeparador(dados.unidade);
  const soOCodigo = unidade === dados.pv;
  rotulo(ctx, "Unidade do acordo", INICIO_DA_UNIDADE, topo);
  let direita = linhasEmColuna(ctx, soOCodigo ? `PV ${dados.pv}` : unidade, {
    bold: true,
    color: INK,
    largura: larguraDaUnidade,
    passo: 11.5,
    size: 9.5,
    x: INICIO_DA_UNIDADE,
    y: topo - 11,
  });
  direita = linhasEmColuna(ctx, dados.empreendimento, {
    largura: larguraDaUnidade,
    passo: 10.6,
    size: 8,
    x: INICIO_DA_UNIDADE,
    y: direita,
  });
  if (!soOCodigo) {
    direita = linhasEmColuna(ctx, `PV ${dados.pv}`, {
      largura: larguraDaUnidade,
      passo: 10.6,
      size: 8,
      x: INICIO_DA_UNIDADE,
      y: direita,
    });
  }

  // A linha de base seguinte já desceu um passo; a ficha termina embaixo da coluna mais alta.
  ctx.y = Math.min(esquerda, direita) - 6;
}

// ── As tabelas ─────────────────────────────────────────────────────────────────────────────

type ColunaDaGrade = { align?: "right"; label: string; peso: number };

type TabelaDoTermo = {
  colunas: ColunaDaGrade[];
  linhas: string[][];
  titulo: string;
  total: [string, string];
  vazio: string;
};

/** Título + régua + cabeçalho + régua (42) e régua do total + total (21). */
const MOLDURA_DA_TABELA = 63;
const ESPACO_ENTRE_GRUPOS = 16;
const ESPACO_ENTRE_BLOCOS = 6;

/** Quantas linhas a tabela ocupa quando as parcelas são divididas em `grupos` colunas. */
const linhasNaGrade = (tabela: TabelaDoTermo, grupos: number): number =>
  Math.max(1, Math.ceil(tabela.linhas.length / grupos));

const alturaDaTabela = (tabela: TabelaDoTermo, grupos: number, passo: number): number =>
  MOLDURA_DA_TABELA + linhasNaGrade(tabela, grupos) * passo;

/**
 * Uma tabela limpa do extrato (cabeçalho cinza pequeno, régua fina, valor à direita, total em
 * negrito), desenhada num retângulo da folha e sem quebra de página.
 *
 * ⚠️ NÃO É A `desenharTabela` DO PAPEL TIMBRADO, e por dois motivos: aquela ocupa a largura inteira
 * da folha (e aqui as duas tabelas vão lado a lado) e quebra página sozinha (e aqui quem decide o
 * espaço é `escolherDisposicao`, ANTES de desenhar, para o termo caber em uma folha).
 *
 * ⚠️ COM MAIS DE UM GRUPO AS PARCELAS DESCEM COLUNA POR COLUNA ("1, 2, 3 | 4, 5, 6"), com o
 * cabeçalho repetido em cada grupo. É como se lê uma lista de vencimentos; ler linha por linha
 * atravessaria os grupos e embaralharia a ordem.
 */
function desenharTabelaDoTermo(
  ctx: Ctx,
  tabela: TabelaDoTermo,
  { grupos, largura, passo, x, y }: { grupos: number; largura: number; passo: number; x: number; y: number },
): number {
  const larguraDoGrupo = (largura - ESPACO_ENTRE_GRUPOS * (grupos - 1)) / grupos;
  const porGrupo = linhasNaGrade(tabela, grupos);
  const linhaFina = (altura: number, cor = LINE, espessura = 0.7) =>
    ctx.page.drawLine({
      color: cor,
      end: { x: x + largura, y: altura },
      start: { x, y: altura },
      thickness: espessura,
    });

  let base = y - 10;
  escrever(ctx, tabela.titulo.toUpperCase(), { color: INK, font: ctx.bold, size: 8.5, x, y: base });
  base -= 5;
  linhaFina(base, INK, 0.9);
  base -= 12;

  for (let grupo = 0; grupo < grupos; grupo += 1) {
    const inicio = x + grupo * (larguraDoGrupo + ESPACO_ENTRE_GRUPOS);
    let coluna = inicio;
    for (const definicao of tabela.colunas) {
      const larguraDaColuna = definicao.peso * larguraDoGrupo;
      if (definicao.align === "right") {
        escreverDireita(ctx, definicao.label.toUpperCase(), {
          color: MUTE,
          direita: coluna + larguraDaColuna,
          font: ctx.bold,
          size: 5.8,
          y: base,
        });
      } else {
        escrever(ctx, definicao.label.toUpperCase(), { color: MUTE, font: ctx.bold, size: 5.8, x: coluna, y: base });
      }
      coluna += larguraDaColuna;
    }
  }
  base -= 5;
  linhaFina(base);
  base -= 10;

  if (!tabela.linhas.length) {
    escrever(ctx, tabela.vazio, { color: MUTE, size: 7.6, x, y: base });
  }
  tabela.linhas.forEach((linha, indice) => {
    const grupo = Math.floor(indice / porGrupo);
    const linhaDeBase = base - (indice % porGrupo) * passo;
    let coluna = x + grupo * (larguraDoGrupo + ESPACO_ENTRE_GRUPOS);
    tabela.colunas.forEach((definicao, posicao) => {
      const larguraDaColuna = definicao.peso * larguraDoGrupo;
      const texto = encurtar(linha[posicao] ?? "", ctx.font, 7.6, larguraDaColuna - 6);
      if (definicao.align === "right") {
        escreverDireita(ctx, texto, { color: TEXT, direita: coluna + larguraDaColuna, size: 7.6, y: linhaDeBase });
      } else {
        escrever(ctx, texto, { color: TEXT, size: 7.6, x: coluna, y: linhaDeBase });
      }
      coluna += larguraDaColuna;
    });
  });
  base -= linhasNaGrade(tabela, grupos) * passo;

  base += 2;
  linhaFina(base);
  base -= 11;
  escrever(ctx, tabela.total[0], { color: INK, font: ctx.bold, size: 8, x, y: base });
  escreverDireita(ctx, tabela.total[1], { color: INK, direita: x + largura, font: ctx.bold, size: 8, y: base });
  return base - 12;
}

/** Lado a lado (uma parcela por linha) ou empilhadas, com as parcelas em `grupos` colunas. */
export type Disposicao = { grupos: number; ladoALado: boolean; passo: number };

/**
 * Como as duas tabelas cabem no espaço que sobra da folha.
 *
 * ⚠️ A ORDEM É A DA LEITURA, NÃO A DA DENSIDADE. Lado a lado, uma parcela por linha, é o que se lê
 * melhor, e vale enquanto a tabela mais longa couber; só quando não cabe as tabelas empilham e as
 * parcelas se dividem em três grupos, e só depois a linha aperta. `null` quer dizer que nem a forma
 * mais densa cabe numa folha: aí o termo sai em mais de uma (ver `montarTermoDeAcordoPdf`), porque
 * papel com parcela a menos é pior que papel com duas folhas.
 *
 * ⚠️ O LIMITE MEDIDO (20/09/2026, PDF gerado e páginas contadas, já com o passo de 9pt): com as 37
 * parcelas que a tela do Hades permite (entrada + 36), cabem numa folha até 24 parcelas em atraso
 * com a ficha mais comprida (nome em duas linhas, qualificação e endereço longos) e até 36 com a
 * ficha curta. Com 12 no acordo, 51 e 63; com 8 no acordo, 54 e 66.
 *
 * ⚠️ ESSE TETO CAIU, E O PREÇO FOI ESCOLHIDO. Até 19/09/2026 ele era 42 e 51 (com 37 no acordo),
 * porque o bloco de fecho eram três frases nossas em 91pt de altura. Em 20/09/2026 o Lucas mandou o
 * TEXTO LEGAL do jurídico para entrar literal (*"quero so incluir o texto legal substituindo o texto
 * de observacao"*): seis parágrafos, 9 linhas, ~139pt — 48pt a mais, que é o mesmo que 16 linhas de
 * parcela em três grupos. Baixar a fonte não devolve nada: entre 8pt e 6,8pt o texto legal ocupa as
 * MESMAS 9 linhas (medido). Um quarto grupo de colunas também não serve — ele cortaria
 * "R$ 1.234,56", que é o número que o cliente confere.
 *
 * ⚠️ E O QUE ACONTECE ACIMA DO TETO NÃO É PERDER PARCELA: o termo sai em duas folhas, com o aceite
 * inteiro na última (ver o fim de `montarTermoDeAcordoPdf`). Nos 40 acordos que existem hoje em
 * produção isso não acontece: o mais pesado aprovado tem 25 em atraso e 8 no acordo, e o maior
 * reprovado, 48 em atraso e 4 no acordo — os dois em UMA folha.
 */
export function escolherDisposicao(
  atraso: { linhas: unknown[] },
  acordo: { linhas: unknown[] },
  disponivel: number,
): Disposicao | null {
  const emGrade = (tabela: { linhas: unknown[] }, grupos: number, passo: number) =>
    MOLDURA_DA_TABELA + Math.max(1, Math.ceil(tabela.linhas.length / grupos)) * passo;

  const opcoes: Disposicao[] = [
    { grupos: 1, ladoALado: true, passo: 11.5 },
    { grupos: 3, ladoALado: false, passo: 11.5 },
    { grupos: 3, ladoALado: false, passo: 10 },
    // ⚠️ O ÚLTIMO APERTO EXISTE PORQUE O LIMITE DE 33 JÁ É A REALIDADE (revisão de 16/09/2026). A
    // venda com mais parcelas vencidas no C2X tinha EXATAMENTE 33 nesse dia, e ganha uma por mês:
    // com a ficha longa e as 37 parcelas da tela, o termo dela iria para duas folhas no mês seguinte.
    // Em 9pt de passo a fonte de 7,6pt ainda respira, e nenhum valor é cortado (mais grupos cortariam
    // "R$ 1.234,56"). Com isso o limite medido da ficha longa com 37 no acordo sobe de 33 para 42.
    { grupos: 3, ladoALado: false, passo: 9 },
  ];

  return (
    opcoes.find((opcao) => {
      const altura = opcao.ladoALado
        ? Math.max(emGrade(atraso, 1, opcao.passo), emGrade(acordo, 1, opcao.passo))
        : emGrade(atraso, opcao.grupos, opcao.passo)
          + ESPACO_ENTRE_BLOCOS
          + emGrade(acordo, opcao.grupos, opcao.passo);
      return altura <= disponivel;
    }) ?? null
  );
}

/**
 * O corpo do texto legal.
 *
 * ⚠️ 7,8pt É O CORPO PADRÃO DE `paragrafo`, e não um número escolhido aqui. O bloco antigo eram três
 * frases em 8pt dentro de `topico`; este é prosa corrida, e a peça da casa que escreve prosa corrida
 * na largura cheia já tem o seu tamanho. Medido em 20/09/2026 (PDF gerado, linhas contadas): entre
 * 8pt e 6,8pt o texto ocupa as MESMAS 9 linhas, então baixar a fonte não compra folha nenhuma —
 * compra só texto mais difícil de ler num papel que o cliente assina.
 */
const CORPO_DO_ACEITE = 7.8;

/** O respiro entre um parágrafo e o seguinte: é ele que faz os seis se lerem como seis. */
const RESPIRO_ENTRE_PARAGRAFOS = 3;

/**
 * Quanto o bloco do aceite RESERVA: o título de seção e os seis parágrafos do texto legal.
 *
 * ⚠️ É O QUE `tituloDeSecao` E `paragrafo` PEDEM A `garantirEspaco`, E NÃO O QUE ELES GASTAM. O
 * título pede 30pt e gasta 27; `paragrafo` pede e gasta a mesma altura por linha, então aqui a
 * conta fecha nas duas pontas — diferente do `topico` de antes, que pedia 4pt a mais que as linhas
 * e gastava 2. Se uma das duas peças mudar de medida, a conta daqui erra, e o teste de página única
 * é o que acusa.
 *
 * ⚠️ E A LARGURA É A CHEIA (`USABLE`), sem os 12pt de recuo do tópico: o texto legal é prosa, não
 * lista, e medir com a largura errada reservaria altura para linhas que não existem.
 */
function alturaDoAceite(ctx: Ctx): number {
  // ⚠️ A FRASE DE QUEM ASSINA ENTRA NA CONTA como um sétimo parágrafo. Reservar só os seis do
  // jurídico faria o bloco pedir menos espaço do que gasta, e quem paga é a última linha, que
  // desceria em cima do rodapé sem ninguém perceber.
  const paragrafos = [...TEXTO_LEGAL_DO_ACORDO, QUEM_ASSINA_O_TERMO];
  const linhas = paragrafos.map(
    (paragrafoDoTexto) => quebrar(paragrafoDoTexto, ctx.font, CORPO_DO_ACEITE, USABLE).length,
  );
  const corpo = linhas.reduce(
    (total, quantidade) => total + quantidade * (CORPO_DO_ACEITE + 2.6),
    0,
  );
  return 30 + corpo + (paragrafos.length - 1) * RESPIRO_ENTRE_PARAGRAFOS + 2;
}

/**
 * O termo de acordo em PDF.
 *
 * ⚠️ A ORDEM CONTA UMA HISTÓRIA EM UM OLHAR: quem e qual unidade (cabeçalho e ficha), quanto e como
 * (os três cartões), o detalhe que prova o número (as duas tabelas, com o total de cada uma fechando
 * com o cartão) e o que o cliente assume (as regras).
 *
 * ⚠️ UMA PÁGINA É MEDIDA, NÃO ESPERADA. Antes de desenhar as tabelas o espaço que sobra é medido
 * (descontadas as regras, que não podem ir para a folha 2 sozinhas) e a disposição é escolhida para
 * caber. O teste trava uma página no caso leve e no pesado.
 */
export async function montarTermoDeAcordoPdf(
  dados: DadosDoTermoDeAcordo,
): Promise<Uint8Array> {
  const ctx = await abrirDocumento(`${TITULO_DO_TERMO_DE_ACORDO} ${dados.pv}`);
  const { parcelas: parcelasDoAcordo } = fecharParcelasComTotal(
    dados.parcelasDoAcordo,
    dados.debito.valorAtualizado,
  );

  const unidade = semTracoSeparador(dados.unidade);
  await cabecalhoComBlocoADireita(ctx, {
    destaque: dados.empreendimento,
    linhas: [unidade === dados.pv ? dados.pv : `${unidade} (${dados.pv})`],
    subtitulo: `Débito apurado em ${dados.debito.apuradoEm}`,
    titulo: TITULO_DO_TERMO_DE_ACORDO,
  });

  desenharFicha(ctx, dados);
  desenharCartoes(ctx, cartoesDoTermoDeAcordo(dados, parcelasDoAcordo));
  // O respiro do extrato entre os cartões e a nota: sem ele a frase encosta na borda do cartão.
  ctx.y -= 6;
  paragrafo(ctx, fraseDoCongelamento(dados.debito.apuradoEm));
  ctx.y -= 2;

  const atraso: TabelaDoTermo = {
    colunas: [
      { label: "Parcela", peso: 0.34 },
      { label: "Vencimento", peso: 0.3 },
      { align: "right", label: "Valor original", peso: 0.36 },
    ],
    linhas: dados.debito.parcelas.map((parcela) => [
      parcela.numero,
      parcela.vencimento,
      dinheiro(parcela.valor),
    ]),
    titulo: `Parcelas em atraso (${dados.debito.parcelas.length})`,
    total: ["Total em atraso", dinheiro(totalNominalEmAtraso(dados.debito.parcelas))],
    vazio: "Nenhuma parcela em atraso.",
  };
  const acordo: TabelaDoTermo = {
    colunas: [
      { label: "Parcela", peso: 0.24 },
      { label: "Vencimento", peso: 0.36 },
      { align: "right", label: "Valor", peso: 0.4 },
    ],
    linhas: parcelasDoAcordo.map((parcela, indice) => [
      `${indice + 1}/${parcelasDoAcordo.length}`,
      parcela.vencimento,
      dinheiro(parcela.valor),
    ]),
    titulo: `Parcelas do acordo (${parcelasDoAcordo.length})`,
    total: ["Total do acordo", dinheiro(dados.debito.valorAtualizado)],
    vazio: "Sem parcelas definidas para este acordo.",
  };

  const alturaDoFim = alturaDoAceite(ctx) + 4;
  const disposicao = escolherDisposicao(atraso, acordo, ctx.y - CHAO - alturaDoFim);

  if (disposicao?.ladoALado) {
    const metade = (USABLE - 20) / 2;
    const topo = ctx.y;
    const fimDoAtraso = desenharTabelaDoTermo(ctx, atraso, { grupos: 1, largura: metade, passo: disposicao.passo, x: MARGIN, y: topo });
    const fimDoAcordo = desenharTabelaDoTermo(ctx, acordo, { grupos: 1, largura: metade, passo: disposicao.passo, x: MARGIN + metade + 20, y: topo });
    ctx.y = Math.min(fimDoAtraso, fimDoAcordo);
  } else if (disposicao) {
    ctx.y = desenharTabelaDoTermo(ctx, atraso, { grupos: disposicao.grupos, largura: USABLE, passo: disposicao.passo, x: MARGIN, y: ctx.y });
    ctx.y -= ESPACO_ENTRE_BLOCOS;
    ctx.y = desenharTabelaDoTermo(ctx, acordo, { grupos: disposicao.grupos, largura: USABLE, passo: disposicao.passo, x: MARGIN, y: ctx.y });
  } else {
    // ⚠️ ACIMA DO LIMITE O TERMO SAI EM MAIS DE UMA FOLHA, E NÃO SEM PARCELA. Cada tabela desce
    // inteira para a folha seguinte quando não cabe na atual; a que não cabe nem numa folha inteira
    // (centenas de parcelas) usa a tabela limpa do papel timbrado, que quebra página e repete o
    // cabeçalho.
    const folhaInteira = A4.h - MARGIN - CHAO;
    for (const tabela of [atraso, acordo]) {
      const altura = alturaDaTabela(tabela, 3, 11.5);
      if (altura <= folhaInteira) {
        garantirEspaco(ctx, altura);
        ctx.y = desenharTabelaDoTermo(ctx, tabela, { grupos: 3, largura: USABLE, passo: 11.5, x: MARGIN, y: ctx.y });
        ctx.y -= ESPACO_ENTRE_BLOCOS;
      } else {
        tituloDeSecao(ctx, tabela.titulo);
        desenharTabelaLimpa(ctx, {
          colunas: tabela.colunas,
          linhas: tabela.linhas,
          total: [tabela.total[0], "", tabela.total[1]],
          vazio: tabela.vazio,
        });
      }
    }
  }

  // O aceite desce inteiro: título e os seis parágrafos na mesma folha. Um texto legal partido ao
  // meio, com o cabeçalho numa folha e a cláusula do inadimplemento na outra, é o tipo de papel que
  // o advogado do cliente usa contra quem o emitiu.
  ctx.y -= 4;
  tituloDeSecao(ctx, TITULO_DO_ACEITE, alturaDoFim - 4 - 30);
  for (const [indice, paragrafoDoTexto] of [
    ...TEXTO_LEGAL_DO_ACORDO,
    QUEM_ASSINA_O_TERMO,
  ].entries()) {
    if (indice > 0) ctx.y -= RESPIRO_ENTRE_PARAGRAFOS;
    // ⚠️ A FRASE DE QUEM ASSINA SAI EM CINZA, um degrau abaixo do texto do jurídico: ela é NOSSA,
    // explica o instrumento, e não é cláusula. Misturá-la no mesmo tom faria o leitor contar sete
    // parágrafos de texto legal onde o jurídico escreveu seis.
    paragrafo(ctx, paragrafoDoTexto, {
      color: indice === TEXTO_LEGAL_DO_ACORDO.length ? SOFT_TEXT : TEXT,
      size: CORPO_DO_ACEITE,
    });
  }

  desenharRodapes(
    ctx.doc,
    ctx.font,
    `Termo de acordo da unidade ${dados.pv}, emitido pela Careli em ${dataCurta(dados.emitidoEm)}. `
    + `Débito apurado em ${dados.debito.apuradoEm}.`,
  );

  return ctx.doc.save();
}

/** "16/09/2026", lido do `Date` como o dia em que ele foi montado (ver `hojeEmBrasilia`). */
function dataCurta(data: Date): string {
  return `${doisDigitos(data.getDate())}/${doisDigitos(data.getMonth() + 1)}/${data.getFullYear()}`;
}
