// A CONTA DA RESCISÃO — o que a Careli retém e o que sobra, quando o contrato é desfeito.
//
// Lucas (15/09/2026): *"o termo de rescisão é um relatório que dá início a um distrato por
// exemplo (...) é quando o cliente solicita para gente o termo de rescisão para avaliar se dar
// continuidade ou não"*.
//
// ⚠️ ESTE DOCUMENTO NÃO DESFAZ NADA. Ele é a SIMULAÇÃO que o cliente pede para decidir: quanto ele
// já pagou, quanto seria retido e se sobra algo. O distrato de verdade é outro ato, na Têmis, e
// este papel é o que o antecede — por isso ele sai do Financeiro, ao lado do extrato, e não da
// tela de contratos.
//
// ⚠️ A ARITMÉTICA FOI LIDA DO MODELO EM WORD, não inventada — e conferi linha a linha no caso real
// do PDF que o Lucas mandou (LAVRA DO OURO, Quadra 06 — Lote 10, emitido em 25/06/2026):
//
//     valor de tabela              R$ 72.388,00
//     comissão (6,50%)             R$  4.705,22
//     BASE = tabela - comissão     R$ 67.682,78   ← 72.388,00 - 4.705,22
//     multa penal (10% da base)    R$  6.768,28
//     publicidade (4% da base)     R$  2.707,31
//     corretagem (conforme contrato)R$ 4.705,22
//     tributos (5,93% do pago)     R$    956,83   ← sobre o TOTAL PAGO, não sobre a base
//     parcelas vencidas em aberto  R$    963,88
//                                  ────────────
//     soma das cinco linhas        R$ 16.101,52
//     total escrito no papel       R$ 16.583,46   ← ⚠️ NÃO É A SOMA. Diferença de R$ 481,94.
//
// ⚠️⚠️ O PAPEL DE HOJE ERRA A SOMA, E O ERRO INVERTE O RESULTADO. A diferença de R$ 481,94 é
// exatamente METADE das parcelas vencidas (963,88 ÷ 2) — cara de conta de planilha em que a última
// linha entrou uma vez e meia. Pelo total do papel o cliente DEVE R$ 448,13; pela soma das linhas
// que o próprio papel imprime, SOBRAM R$ 33,81 para ele.
//
// Esta função soma o que imprime. Um documento que mostra cinco deduções e um total que não é a
// soma delas não se sustenta na frente do cliente nem do advogado dele. Reportado ao Lucas em
// 15/09/2026, com os números.
//
// ⚠️ A BASE DA MULTA E DA PUBLICIDADE É O VALOR DE TABELA MENOS A COMISSÃO, e isso não é óbvio:
// a comissão já é deduzida em linha própria, então cobrá-la também dentro da base seria cobrá-la
// duas vezes. Foi por isso que conferi os R$ 67.682,78 antes de escrever a função.
//
// ⚠️ OS TRIBUTOS INCIDEM SOBRE O QUE O CLIENTE PAGOU, e não sobre o valor do imóvel — é imposto
// sobre o que a empresa recebeu. Usar a base aqui multiplicaria a retenção por quatro no exemplo.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// O QUE MUDOU QUANDO AS PREMISSAS PASSARAM A SER CADASTRADAS (15/09/2026)
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ A BASE DE CÁLCULO DIVERGE ENTRE AS MINUTAS, e ignorar isso tornaria a tela de premissas um
// enfeite. Li os 3.020 contratos com texto do C2X: a mesma cláusula penal incide ora sobre o
// "valor total do contrato", ora sobre o "valor do imóvel atualizado", ora sobre o "total pago".
// A base do papel de hoje (tabela menos comissão) não aparece em contrato nenhum. Por isso cada
// rubrica carrega a SUA base, e não há uma base única enterrada aqui dentro.
//
// ⚠️ TODA LINHA DIZ DE ONDE VEIO O NÚMERO. `origem: "padrao"` significa que ninguém cadastrou a
// premissa daquele empreendimento e a função usou a praxe. O papel imprime isso: um documento que
// afirma "10% conforme contrato" sem que exista cadastro é uma afirmação que o jurídico vai ter de
// defender, e ele precisa saber que ela não foi conferida.
//
// ⚠️ A LINHA É PROCURADA POR `rubrica`, NUNCA POR POSIÇÃO. A fruição só aparece quando houve posse,
// então o array muda de tamanho entre dois contratos do mesmo empreendimento. Quem ler
// `deducoes[4]` esperando "parcelas vencidas" vai ler fruição no dia em que a posse for cadastrada.
// Use `deducaoDe(conta, "parcelas_vencidas")`.
//
// ⚠️ FRUIÇÃO SEM POSSE NÃO EXISTE. `mesesDeFruicao` nulo ou zero omite a linha inteira, e isso é a
// regra, não a exceção: a minuta da Lavra do Ouro concede a posse *"após 2 (dois) anos a contar da
// assinatura E DESDE QUE ESTEJA(M) ELE(S) EM DIA"*. Quem está inadimplente — de quem se faz
// rescisão — não recebeu a posse. Ver `lib/apolo/posse.ts`.

/** As rubricas que o termo conhece. `parcelas_vencidas` não é cadastrável: sai do extrato. */
export type RubricaDaRescisao =
  | "clausula_penal"
  | "corretagem"
  | "fruicao"
  | "parcelas_vencidas"
  | "publicidade"
  | "tributos";

/** As rubricas que a tela de premissas cadastra (todas menos as parcelas vencidas). */
export type RubricaCadastravel = Exclude<RubricaDaRescisao, "parcelas_vencidas">;

/**
 * Sobre o que o percentual incide. Os nomes são os mesmos do CHECK da migration 0166 — se
 * divergirem, o banco aceita um valor que esta função não sabe calcular.
 */
export type BaseDeCalculo =
  | "total_pago"
  | "valor_de_tabela"
  | "valor_de_tabela_menos_comissao"
  | "valor_do_contrato"
  | "valor_do_contrato_atualizado"
  | "valor_efetivo";

/** Uma premissa cadastrada para o empreendimento, como a tela grava e a rota lê. */
export type PremissaDaRescisao = {
  base: BaseDeCalculo;
  /** O trecho do contrato que justifica a alíquota. Vai impresso no termo. */
  clausula?: null | string;
  /** Nulo quando a base é `valor_efetivo` (a corretagem em reais do contrato). */
  percentual: null | number;
  /** `mensal` só existe para fruição, e o banco trava isso no CHECK. */
  periodicidade: "mensal" | "unica";
};

/**
 * O atalho de sempre: só os percentuais, com a base da praxe.
 *
 * ⚠️ SÃO PARÂMETRO, E NÃO CONSTANTE, mesmo que hoje sejam quase sempre os mesmos. O contrato é quem
 * manda, e contratos mudam de safra: cravar 10% no código faria o documento de um contrato antigo
 * sair com o percentual de hoje, sem ninguém perceber. Os padrões abaixo são os praticados no
 * modelo em Word de 25/06/2026, mais a fruição de 0,75% ao mês que a praxe aplica sobre a
 * Lei 13.786/18.
 */
export type PercentuaisDaRescisao = {
  /** Comissão de corretagem, do contrato. */
  corretagem: number;
  /** Fruição, POR MÊS de ocupação. */
  fruicao: number;
  /** Multa penal sobre a base. */
  multa: number;
  /** Publicidade sobre a base. */
  publicidade: number;
  /** Tributos sobre o total pago. */
  tributos: number;
};

export const PERCENTUAIS_PADRAO: PercentuaisDaRescisao = {
  corretagem: 6.5,
  fruicao: 0.75,
  multa: 10,
  publicidade: 4,
  tributos: 5.93,
};

/**
 * A base da praxe de cada rubrica, usada quando não há premissa cadastrada.
 *
 * ⚠️ A CORRETAGEM CAI NO VALOR DE TABELA, E NÃO EM `valor_efetivo`, e a diferença é o que separa a
 * praxe do cadastro. Sem premissa, a regra é "use o valor em reais do contrato se ele veio; senão,
 * o percentual sobre a tabela" — é o que o papel de hoje faz. `valor_efetivo` CADASTRADO significa
 * outra coisa, mais dura: "só o valor em reais serve; se ele não veio, não deduza nada". Inventar
 * um percentual ali seria assinar como conferido um número que ninguém cadastrou.
 */
export const BASES_PADRAO: Record<RubricaCadastravel, BaseDeCalculo> = {
  clausula_penal: "valor_de_tabela_menos_comissao",
  corretagem: "valor_de_tabela",
  fruicao: "valor_do_contrato_atualizado",
  publicidade: "valor_de_tabela_menos_comissao",
  tributos: "total_pago",
};

export type EntradaDaRescisao = {
  /**
   * O valor da comissão em reais, quando o contrato o registra.
   *
   * ⚠️ QUANDO EXISTE, ELE MANDA — e o percentual vira só o rótulo. A comissão é um valor pago ao
   * corretor lá atrás, não uma conta a refazer hoje: recalculá-la pelo percentual daria um número
   * diferente do que saiu do caixa se a tabela do lote mudou desde então.
   *
   * ⚠️ ZERO É VALOR VÁLIDO e zera a comissão. "Não informado" é `null` ou ausente.
   */
  comissaoEmReais?: null | number;
  /**
   * Meses de ocupação, com fração (pro rata die). Nulo ou zero = não houve posse = sem fruição.
   * Quem calcula é `mesesDeFruicao` em `lib/apolo/posse.ts`.
   */
  mesesDeFruicao?: null | number;
  /** Soma das parcelas vencidas e não pagas. */
  parcelasVencidas: number;
  /** Atalho: só os percentuais, mantendo as bases da praxe. Perde para `premissas`. */
  percentuais?: Partial<PercentuaisDaRescisao>;
  /**
   * As premissas cadastradas do empreendimento, por rubrica.
   *
   * ⚠️ RUBRICA SEM PREMISSA É CHAVE AUSENTE, NUNCA CHAVE COM `undefined`. A distinção importa:
   * a função trata ausência como "usar a praxe e avisar", e um `undefined` explícito vindo de um
   * loader descuidado produziria o mesmo efeito por acidente, sem que ninguém tivesse decidido.
   */
  premissas?: Partial<Record<RubricaCadastravel, PremissaDaRescisao>>;
  /** O que o cliente já pagou, somando tudo. */
  totalPago: number;
  /** Preço de tabela da unidade. */
  valorDeTabela: number;
  /** Valor negociado no contrato, quando conhecido. Só faz falta se alguma premissa o pedir. */
  valorDoContrato?: null | number;
  /** Valor do contrato corrigido até hoje. Só faz falta se alguma premissa o pedir. */
  valorDoContratoAtualizado?: null | number;
};

export type LinhaDaDeducao = {
  /** Como a base é explicada no papel: "10,00% sobre R$ 67.682,78" ou "Conforme contrato". */
  base: string;
  /** O trecho do contrato que justifica a alíquota, quando cadastrado. */
  clausula: null | string;
  descricao: string;
  /**
   * Sobre o que o percentual incidiu, em palavras ("valor de tabela menos a comissão"). Nulo quando a
   * linha não é um percentual: a corretagem em reais do contrato e as parcelas vencidas.
   *
   * ⚠️ EXISTE PARA O PAPEL SER DIDÁTICO SEM REFAZER A CONTA. `base` diz "10% sobre R$ 67.682,78", e
   * quem lê não sabe o que são os R$ 67.682,78. O nome da base só existe aqui dentro (a premissa
   * cadastrada pode trocá-la, rubrica por rubrica), então é daqui que ele tem de sair: um PDF que
   * tentasse adivinhá-lo comparando valores seria uma segunda régua da mesma verdade.
   */
  incideSobre: null | string;
  /** `padrao` = ninguém cadastrou a premissa e a função usou a praxe. Vai impresso. */
  origem: "cadastrada" | "padrao";
  rubrica: RubricaDaRescisao;
  valor: number;
};

export type ContaDaRescisao = {
  /**
   * O que quem assina precisa saber antes de entregar o papel: rubrica que caiu na praxe, premissa
   * que pediu um valor que não veio. Vazio significa que tudo saiu de cadastro.
   */
  avisos: string[];
  /** O valor de tabela menos a comissão — a base da praxe da multa e da publicidade. */
  base: number;
  comissao: number;
  deducoes: LinhaDaDeducao[];
  /**
   * Quanto sobra PARA O CLIENTE. Zero quando as deduções passam do que ele pagou.
   *
   * ⚠️ NUNCA NEGATIVO: um "saldo a restituir de -R$ 448,13" seria lido como devolução. Quando as
   * deduções superam o pago, o que existe é `saldoResidual` — dívida, não crédito.
   */
  saldoARestituir: number;
  /** Quanto o cliente ainda DEVE. Zero quando o pago cobre as deduções. */
  saldoResidual: number;
  totalDeDeducoes: number;
  totalPago: number;
};

/** Arredonda para centavos — dinheiro não carrega a sujeira do ponto flutuante. */
const centavos = (v: number): number => Math.round((Number(v) || 0) * 100) / 100;

/**
 * "R$ 67.682,78" — a régua de dinheiro DESTE documento.
 *
 * ⚠️ EXPORTADA PARA O PDF, e não copiada para lá. As frases do termo ("perfaz o valor de
 * R$ 16.101,52") precisam escrever o dinheiro exatamente como a coluna da tabela escreve, e a
 * troca do espaço não-quebrável abaixo é sutil demais para sobreviver a uma segunda cópia.
 */
export const reais = (v: number): string =>
  new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    minimumFractionDigits: 2,
    style: "currency",
  })
    .format(v)
    // ⚠️ O `Intl` SEPARA "R$" DO NÚMERO COM ESPAÇO NÃO-QUEBRÁVEL (U+00A0), e este texto vai para
    // um PDF em WinAnsi e para comparações de teste. Espaço normal evita as duas surpresas.
    //
    // ⚠️ O ESCAPE `\u00A0` É OBRIGATÓRIO, e não preciosismo. Com o caractere literal no lugar dele,
    // qualquer edição que normalize espaços transforma o `replace` num no-op invisível: o código
    // continua parecendo certo, o teste falha dizendo que "R$ 67.682,78" não é igual a
    // "R$ 67.682,78", e ninguém enxerga a diferença. Aconteceu aqui em 15/09/2026.
    .replace(/\u00A0/g, " ");

/** "6,50%" — vírgula decimal, como o comercial escreve. */
export function percentual(v: number): string {
  // ⚠️ INTEIRO SAI SEM CASA DECIMAL, e isso não é gosto: é o papel assinado. O modelo de 25/06/2026
  // escreve "Multa penal (10%)" e "4% sobre R$ 67.682,78", mas "Corretagem (6,50%)", "Tributos
  // (5,93%)" e "0,75% ao mês". Ou seja: duas casas quando há decimal, nenhuma quando não há. Com
  // `minimumFractionDigits: 2` fixo, o documento gerado dizia "10,00%" onde o jurídico escreve
  // "10%" — divergência pequena na tela e barulhenta num papel que alguém vai comparar com o
  // anterior.
  return `${new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
  }).format(v)}%`;
}

/** "21,5" — o número de meses como o papel escreve, sem casa decimal inútil. */
function meses(v: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(v);
}

/**
 * Escolhe entre o informado e o padrão.
 *
 * ⚠️ O SPREAD INGÊNUO TEM UM BURACO que esta função fecha: chave presente com valor `undefined`
 * SOBRESCREVE o padrão, e `(base * undefined) / 100` é `NaN` impresso no papel. Aqui só número
 * finito ganha do padrão.
 */
function escolher(padrao: number, informado: null | number | undefined): number {
  return typeof informado === "number" && Number.isFinite(informado) ? informado : padrao;
}

/** Como o papel chama cada rubrica. */
const ROTULO: Record<RubricaDaRescisao, string> = {
  clausula_penal: "Multa penal",
  corretagem: "Corretagem",
  fruicao: "Fruição",
  parcelas_vencidas: "Parcelas vencidas em aberto",
  publicidade: "Publicidade",
  tributos: "Tributos",
};

/** Como o papel explica cada base. */
const ROTULO_DA_BASE: Record<BaseDeCalculo, string> = {
  total_pago: "total pago",
  valor_de_tabela: "valor de tabela",
  valor_de_tabela_menos_comissao: "valor de tabela menos a comissão",
  valor_do_contrato: "valor do contrato",
  valor_do_contrato_atualizado: "valor do contrato atualizado",
  valor_efetivo: "valor do contrato",
};

/**
 * A conta inteira da rescisão.
 *
 * ⚠️ A ORDEM DAS LINHAS É A DO PAPEL DE HOJE, e ela não é aleatória: multa, publicidade e
 * corretagem são retenções sobre o negócio; tributos, sobre o que entrou; fruição, sobre o tempo de
 * ocupação; parcelas vencidas são dívida corrente. Quem lê de cima para baixo vê primeiro o que é
 * do contrato e por último o que é do atraso.
 */
export function calcularRescisao(entrada: EntradaDaRescisao): ContaDaRescisao {
  const premissas = entrada.premissas ?? {};
  const atalho = entrada.percentuais ?? {};
  const avisos: string[] = [];

  const valorDeTabela = centavos(entrada.valorDeTabela);
  const totalPago = centavos(entrada.totalPago);
  const parcelasVencidas = centavos(entrada.parcelasVencidas);

  /**
   * As bases que NÃO dependem da comissão.
   *
   * ⚠️ ELA EXISTE PARA QUEBRAR UM CICLO, e não por organização: a base da multa e da publicidade é
   * `valorDeTabela - comissao`, então a comissão precisa ser resolvida ANTES. A corretagem, por sua
   * vez, tem base própria cadastrável — e se alguém cadastrasse `valor_de_tabela_menos_comissao`
   * para ela, a comissão dependeria de si mesma. Aqui essa base devolve `null`, e a rubrica sai do
   * papel com aviso em vez de entrar com um número circular.
   */
  const valorSimples = (qual: BaseDeCalculo): null | number => {
    switch (qual) {
      case "total_pago":
        return totalPago;
      case "valor_de_tabela":
        return valorDeTabela;
      // ⚠️ ZERO AQUI É AUSÊNCIA, NÃO FATO, e a distinção vale dinheiro. "Valor do contrato" não é
      // coluna no C2X: é a SOMA DAS PARCELAS, e medi 1.017 contratos em que ela existe — a razão
      // média para o valor de tabela é 0,873, mas o mínimo é 0,000. O LOS0618 tem contrato assinado
      // e soma de parcelas zerada. Tratar esse zero como base válida faria a cláusula penal sair
      // R$ 0,00 num papel que o cliente assina, calado. Fora da conta, com aviso.
      //
      // O mesmo não vale para `total_pago` e `valor_de_tabela`: ali zero é um fato conhecido (o
      // cliente não pagou nada; o lote não tem preço) e a dedução zerada é a resposta correta.
      case "valor_do_contrato":
        return Number(entrada.valorDoContrato) > 0
          ? centavos(Number(entrada.valorDoContrato))
          : null;
      case "valor_do_contrato_atualizado":
        return Number(entrada.valorDoContratoAtualizado) > 0
          ? centavos(Number(entrada.valorDoContratoAtualizado))
          : null;
      // ⚠️ `valor_efetivo` NÃO É PERCENTUAL SOBRE COISA NENHUMA: é o valor em reais do contrato.
      // Quem o cadastra e não informa o valor fica sem a linha, com aviso — ver a corretagem.
      // (O comentário fica ANTES dos dois rótulos, e não entre eles: `no-fallthrough` trata um
      // `case` que só contém comentário como queda proposital não declarada, e o lint da casa roda
      // com `--max-warnings 0`.)
      case "valor_de_tabela_menos_comissao":
      case "valor_efetivo":
        return null;
    }
  };

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // A CORRETAGEM, QUE PRECISA SAIR ANTES DE TUDO PORQUE A BASE DAS OUTRAS DEPENDE DELA
  // ────────────────────────────────────────────────────────────────────────────────────────────
  const premissaDaCorretagem = premissas.corretagem;
  const corretagemCadastrada = premissaDaCorretagem != null || atalho.corretagem != null;
  const baseDaCorretagem = premissaDaCorretagem?.base ?? BASES_PADRAO.corretagem;
  const percentualDaCorretagem = escolher(
    PERCENTUAIS_PADRAO.corretagem,
    premissaDaCorretagem?.percentual ?? atalho.corretagem,
  );

  const temComissaoEmReais =
    entrada.comissaoEmReais != null && Number.isFinite(entrada.comissaoEmReais);

  let comissao = 0;
  let baseEscritaDaCorretagem = "";
  let corretagemIncideSobre: null | string = null;
  let corretagemEntraNaConta = true;

  if (temComissaoEmReais) {
    // ⚠️ O VALOR EM REAIS SEMPRE MANDA, qualquer que seja a base cadastrada. A comissão saiu do
    // caixa lá atrás; refazer a conta pelo percentual daria um número que ninguém pagou se a tabela
    // do lote mudou desde a venda.
    comissao = centavos(Number(entrada.comissaoEmReais));
    baseEscritaDaCorretagem = "Conforme contrato";
  } else {
    const valorBase = valorSimples(baseDaCorretagem);
    if (valorBase === null) {
      // ⚠️ AQUI ESTÁ O CADASTRO `valor_efetivo` SEM O VALOR. Calcular a praxe e carimbar a linha
      // como "cadastrada" seria a pior saída possível: o papel afirmaria, com percentual e tudo,
      // um número que o cadastro justamente mandou NÃO calcular.
      corretagemEntraNaConta = false;
      avisos.push(
        `${ROTULO.corretagem} não entrou na conta: a premissa manda usar o ${ROTULO_DA_BASE[baseDaCorretagem]}, que não foi informado.`,
      );
      // ⚠️ E A AUSÊNCIA CONTAMINA AS OUTRAS DUAS. Sem comissão, `valorDeTabela - comissao` é a
      // tabela inteira, e multa e publicidade saem MAIORES do que sairiam. Quem assina precisa
      // saber disso antes de entregar o papel.
      avisos.push(
        `Sem a corretagem, a base da multa penal e da publicidade passa a ser o valor de tabela cheio.`,
      );
    } else {
      comissao = centavos((valorBase * percentualDaCorretagem) / 100);
      baseEscritaDaCorretagem = `${percentual(percentualDaCorretagem)} sobre ${reais(valorBase)}`;
      corretagemIncideSobre = ROTULO_DA_BASE[baseDaCorretagem];
    }
  }

  const base = centavos(valorDeTabela - comissao);

  /**
   * Quanto vale cada base, agora que a comissão existe. `null` = o número não foi informado, e a
   * rubrica que o pediu sai do papel com aviso — deduzir sobre um valor que não existe seria
   * inventar a dedução.
   */
  const valorDaBase = (qual: BaseDeCalculo): null | number =>
    qual === "valor_de_tabela_menos_comissao" ? base : valorSimples(qual);

  const deducoes: LinhaDaDeducao[] = [];

  /** Monta uma linha percentual, ou empurra o aviso quando não dá para calcular. */
  const linhaPercentual = (
    rubrica: Exclude<RubricaCadastravel, "corretagem">,
    padraoDoPercentual: number,
    doAtalho: number | undefined,
    vezes = 1,
  ): void => {
    const premissa = premissas[rubrica];
    const cadastrada = premissa != null || doAtalho != null;
    const pct = escolher(padraoDoPercentual, premissa?.percentual ?? doAtalho);
    const qualBase = premissa?.base ?? BASES_PADRAO[rubrica];
    const valorBase = valorDaBase(qualBase);

    if (valorBase === null) {
      avisos.push(
        `${ROTULO[rubrica]} não entrou na conta: a premissa manda calcular sobre o ${ROTULO_DA_BASE[qualBase]}, que não foi informado.`,
      );
      return;
    }

    if (!cadastrada) {
      avisos.push(
        `${ROTULO[rubrica]} usou o percentual de praxe (${percentual(pct)}): não há premissa cadastrada para este empreendimento.`,
      );
    }

    deducoes.push({
      base:
        vezes === 1
          ? `${percentual(pct)} sobre ${reais(valorBase)}`
          : `${percentual(pct)} ao mês sobre ${reais(valorBase)}, por ${meses(vezes)} meses`,
      clausula: premissa?.clausula ?? null,
      descricao:
        vezes === 1
          ? `${ROTULO[rubrica]} (${percentual(pct)})`
          : `${ROTULO[rubrica]} (${percentual(pct)} ao mês)`,
      incideSobre: ROTULO_DA_BASE[qualBase],
      origem: cadastrada ? "cadastrada" : "padrao",
      rubrica,
      valor: centavos((valorBase * pct * vezes) / 100),
    });
  };

  linhaPercentual("clausula_penal", PERCENTUAIS_PADRAO.multa, atalho.multa);
  linhaPercentual("publicidade", PERCENTUAIS_PADRAO.publicidade, atalho.publicidade);

  // ⚠️ A CORRETAGEM NÃO PASSA POR `linhaPercentual` porque ela é a única rubrica cujo valor pode vir
  // pronto em reais (`comissaoEmReais`), e porque a base dela tem de ser resolvida antes de todas
  // as outras. A conta está lá em cima; aqui só entra a linha.
  if (corretagemEntraNaConta) {
    if (!corretagemCadastrada) {
      avisos.push(
        `${ROTULO.corretagem} usou o percentual de praxe (${percentual(percentualDaCorretagem)}): não há premissa cadastrada para este empreendimento.`,
      );
    }
    deducoes.push({
      base: baseEscritaDaCorretagem,
      clausula: premissaDaCorretagem?.clausula ?? null,
      descricao: `${ROTULO.corretagem} (${percentual(percentualDaCorretagem)})`,
      incideSobre: corretagemIncideSobre,
      origem: corretagemCadastrada ? "cadastrada" : "padrao",
      rubrica: "corretagem",
      valor: comissao,
    });
  }

  linhaPercentual("tributos", PERCENTUAIS_PADRAO.tributos, atalho.tributos);

  // ⚠️ FRUIÇÃO SÓ COM POSSE. Sem meses, a linha inteira some — e não há aviso, porque a ausência de
  // posse é o estado normal de quem está inadimplente, não uma pendência de cadastro.
  const mesesDeFruicao = Number(entrada.mesesDeFruicao);
  if (Number.isFinite(mesesDeFruicao) && mesesDeFruicao > 0) {
    // ⚠️ A PERIODICIDADE CADASTRADA MANDA, e ignorá-la multiplicaria a rubrica mais pesada do termo
    // pelo número de meses de ocupação. O CHECK da migration 0166 proíbe "mensal" fora da fruição,
    // mas PERMITE fruição "única" — e o operador pode escolher isso na tela. Sem premissa, o padrão
    // é mensal, que é a praxe do setor (0,75% ao mês, pro rata die).
    const vezes =
      premissas.fruicao == null || premissas.fruicao.periodicidade === "mensal"
        ? mesesDeFruicao
        : 1;
    linhaPercentual("fruicao", PERCENTUAIS_PADRAO.fruicao, atalho.fruicao, vezes);
  }

  deducoes.push({
    base: "Conforme extrato financeiro",
    clausula: null,
    descricao: ROTULO.parcelas_vencidas,
    incideSobre: null,
    origem: "cadastrada",
    rubrica: "parcelas_vencidas",
    valor: parcelasVencidas,
  });

  const totalDeDeducoes = centavos(deducoes.reduce((soma, linha) => soma + linha.valor, 0));

  const diferenca = centavos(totalPago - totalDeDeducoes);

  return {
    avisos,
    base,
    comissao,
    deducoes,
    saldoARestituir: diferenca > 0 ? diferenca : 0,
    saldoResidual: diferenca < 0 ? centavos(-diferenca) : 0,
    totalDeDeducoes,
    totalPago,
  };
}

/**
 * Acha a linha pela rubrica.
 *
 * ⚠️ INDEXAR POR POSIÇÃO QUEBRA no dia em que a fruição aparece: ela entra entre os tributos e as
 * parcelas vencidas, e só nos contratos com posse cadastrada. Dois clientes do mesmo empreendimento
 * saem com arrays de tamanhos diferentes.
 */
export function deducaoDe(
  conta: ContaDaRescisao,
  rubrica: RubricaDaRescisao,
): LinhaDaDeducao | undefined {
  return conta.deducoes.find((linha) => linha.rubrica === rubrica);
}

// ⚠️ O POR EXTENSO NÃO MORA AQUI, E EU CHEGUEI A ESCREVÊ-LO ANTES DE PROCURAR. `lib/temis/
// por-extenso.ts` já resolve o problema desde 01/09/2026, com teste, e resolve MELHOR: escreve
// "um mil reais" onde a minha escrevia "mil reais" — convenção de documento financeiro que o Lucas
// fixou pela mesma razão do cheque, a palavra na frente não deixa espaço para acrescentar dígito.
//
// Reexportado daqui por conveniência de quem monta o documento, sem criar segunda implementação.
export { dinheiroPorExtenso } from "@/lib/temis/por-extenso";
