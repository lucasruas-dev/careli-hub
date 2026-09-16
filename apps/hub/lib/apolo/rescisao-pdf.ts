// A SIMULAÇÃO DE RESCISÃO — o papel que o cliente pede para decidir se segue com o contrato.
//
// Lucas (16/09/2026), sobre a versão de 15/09 (oito seções, texto fixo do modelo em Word): *"o de
// rescisão está muita escrita, poderia ser um pouco mais didático de fácil leitura"* e *"não
// precisa colocar quem assina"*. E mandou, sem texto, o print do EXTRATO que está em produção: essa
// é a referência visual, e é por isso que este papel tem o cabeçalho, a ficha, os três cartões e as
// tabelas limpas do extrato (`lib/apolo/pdf-timbrado.ts`).
//
// ⚠️ ESTA LIB NÃO CALCULA NADA, e isso é o contrato dela com o resto do módulo. Quem apura a
// rescisão é `calcularRescisao` (`lib/apolo/rescisao.ts`): multa, publicidade, corretagem, tributos,
// fruição, parcelas vencidas, total, saldo. Aqui só entram números prontos e a régua de dinheiro que
// o próprio `rescisao.ts` exporta. Se este arquivo somar dois valores, a conta passa a existir em
// dois lugares, e o dia em que uma mudar a outra fica calada.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// AS DECISÕES DO REDESENHO (16/09/2026)
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ 1. O TÍTULO É "SIMULAÇÃO DE RESCISÃO", E NÃO "TERMO". O documento não desfaz o contrato: é a
// conta que o cliente pede ANTES de decidir (ver o cabeçalho de `rescisao.ts`). "Termo de rescisão",
// sem assinatura nenhuma, se lê como o distrato já feito, e quem recebe pelo WhatsApp pode entender
// que perdeu o lote. O nome interno continua "termo" (rota, botão, funções), porque é o vocabulário
// do Financeiro; o que muda é o que o CLIENTE lê.
//
// ⚠️ 2. CADA NÚMERO APARECE UMA VEZ. O papel de 15/09 repetia total pago, parcelas vencidas e total
// de deduções nas seções 5, 6 e 7. Aqui os cartões dizem o resultado, a tabela diz como se chegou
// nele e a lista diz quais parcelas estão vencidas. A única repetição é o saldo, no cartão e na
// frase logo abaixo, e ela é de propósito: a frase carrega o valor POR EXTENSO.
//
// ⚠️ 3. O TOTAL É A SOMA DAS LINHAS. O papel feito à mão de 25/06/2026 imprimia cinco deduções que
// somavam R$ 16.101,52 e um total de R$ 16.583,46, e a diferença invertia o resultado. A linha de
// total da tabela é `conta.totalDeDeducoes`, que `calcularRescisao` soma das mesmas linhas impressas.
//
// ⚠️ 4. SEM ASSINATURA E SEM FECHO. Pedido do dono do produto. O "Belo Horizonte/MG, <data>" saiu
// junto: sem assinatura embaixo ele vira uma linha solta, e a data de emissão já está no cabeçalho,
// como no extrato. `blocoDeAssinatura` continua em `pdf-timbrado.ts`: a assinatura volta num
// segundo momento, e aí é chamá-la de novo.
//
// ⚠️ 5. NACIONALIDADE, ESTADO CIVIL, PROFISSÃO E ENDEREÇO FICAM DE FORA. O dono do produto pediu
// MENOS escrita, e o nome com o documento mascarado já identifica o titular, como no extrato. Os
// quatro campos nem são lidos hoje (ver `clienteDoContrato`), e o endereço seria dado pessoal a
// mais num papel que circula por WhatsApp. Se a assinatura voltar e o papel virar instrumento, a
// qualificação volta com ela.
//
// ⚠️ 6. OS AVISOS DA APURAÇÃO CONTINUAM IMPRESSOS, pequenos e em cinza. `conta.avisos` diz quando
// uma alíquota caiu na praxe por falta de cadastro, ou quando uma rubrica ficou de fora porque a base
// não foi informada. É o que conta ao jurídico que um número não foi conferido: pode encolher, não
// pode sumir. Sem aviso, o bloco não aparece.
//
// ⚠️ 7. A FRUIÇÃO NÃO É TRATADA AQUI. Ela já vem dentro de `conta.deducoes`, na posição do modelo
// (entre os tributos e as parcelas vencidas), e só quando houve posse. As linhas saem na ordem em
// que a conta as devolve, sem procurar por índice.

import { dataBr } from "@/lib/apolo/extrato-cliente";
import {
  abrirDocumento,
  cabecalhoComBlocoADireita,
  campoEmDestaque,
  type CampoDaFicha,
  type Cartao,
  type Coluna,
  type Ctx,
  desenharCartoes,
  desenharRodapes,
  desenharTabelaLimpa,
  linhaDeCampos,
  paragrafo,
  quebrar,
  sanitizarNomeDeArquivo,
  SOFT_TEXT,
  tituloDeSecao,
  topico,
  USABLE,
} from "@/lib/apolo/pdf-timbrado";
import {
  type ContaDaRescisao,
  deducaoDe,
  dinheiroPorExtenso,
  type LinhaDaDeducao,
  reais,
} from "@/lib/apolo/rescisao";

const TITULO_DA_PECA = "Simulação de Rescisão";

export type TitularDaRescisao = {
  /** Mascarado, como o extrato entrega ("***.560.857-**"). Nulo quando o C2X não tem documento. */
  documento: null | string;
  nome: string;
};

export type ClienteDaRescisao = {
  /** Todos os titulares do CONTRATO, na ordem do C2X. Nunca vazio. */
  titulares: TitularDaRescisao[];
};

export type ContratoDaRescisao = {
  /** 'YYYY-MM-DD' do ato. */
  dataDoAto: null | string;
  /** "144x, IPCA anual": parcelamento do contrato e índice. Nulo quando não há nenhum dos dois. */
  plano: null | string;
  /** A base da multa e da publicidade na praxe. Vai na ficha para a tabela ser conferível. */
  valorDeTabela: number;
};

export type ImovelDaRescisao = {
  /** Área global em m². */
  area: null | number;
  cidade: null | string;
  /** O código da unidade no C2X ("LOS0610"). */
  codigo: string;
  empreendimento: string;
  lote: null | string;
  quadra: null | string;
  uf: null | string;
};

export type PagamentosDaRescisao = {
  /** 'YYYY-MM' ou 'YYYY-MM-DD' do último pagamento identificado. */
  mesFinal: null | string;
  /** 'YYYY-MM' ou 'YYYY-MM-DD' do primeiro pagamento identificado. */
  mesInicial: null | string;
  /** Quantos pagamentos compõem o total pago (as linhas de "Pagamentos realizados" do extrato). */
  quantidade: number;
};

export type ParcelaVencidaDaRescisao = {
  /** "19/144", a numeração como o cliente vê no boleto. */
  numero: string;
  /** O valor que entrou na soma da linha `parcelas_vencidas` da conta. */
  valor: number;
  /** 'YYYY-MM-DD' do vencimento. */
  vencimento: null | string;
};

export type DadosDaRescisao = {
  cliente: ClienteDaRescisao;
  /** A conta pronta de `calcularRescisao`. Esta lib não a refaz nem a corrige. */
  conta: ContaDaRescisao;
  contrato: ContratoDaRescisao;
  /** 'YYYY-MM-DD' da emissão. É a "Posição em" do cabeçalho. */
  emitidoEm: string;
  imovel: ImovelDaRescisao;
  pagamentos: PagamentosDaRescisao;
  /**
   * As parcelas vencidas, uma a uma, para NOMEAR e mostrar quanto é cada uma.
   *
   * ⚠️ O TOTAL DELAS NÃO É SOMADO AQUI. A linha de total da lista é `parcelas_vencidas` da conta, a
   * mesma que a tabela de deduções mostra. A montagem soma a mesma lista em centavos para chegar
   * nela (`parcelasVencidasDoExtrato`), e o teste de lá trava que as duas fecham; somar de novo aqui
   * seria um segundo total no mesmo papel.
   */
  parcelasVencidas: ParcelaVencidaDaRescisao[];
};

/** Os três desfechos possíveis da apuração. */
export type CasoDoSaldo = "residual" | "restituir" | "zerado";

// ────────────────────────────────────────────────────────────────────────────────────────────
// OS TEXTOS: funções puras, porque o texto é o que o teste tem de travar
// ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Qual dos três desfechos a conta produziu.
 *
 * ⚠️ O EMPATE EXATO EXISTE e não é curiosidade de teste: `calcularRescisao` devolve os dois saldos
 * zerados quando o pago cobre as deduções na casa do centavo. Sem este terceiro caso o cartão diria
 * "saldo a pagar R$ 0,00", que é uma cobrança de nada.
 */
export function casoDoSaldo(conta: ContaDaRescisao): CasoDoSaldo {
  if (conta.saldoResidual > 0) return "residual";
  if (conta.saldoARestituir > 0) return "restituir";
  return "zerado";
}

/** O valor que o desfecho põe em jogo: a dívida, a devolução, ou zero. Nunca negativo. */
function valorDoSaldo(conta: ContaDaRescisao): number {
  return casoDoSaldo(conta) === "residual" ? conta.saldoResidual : conta.saldoARestituir;
}

/** O total das parcelas vencidas: a linha da conta, a mesma da tabela de deduções. */
export function totalDasParcelasVencidas(conta: ContaDaRescisao): number {
  return deducaoDe(conta, "parcelas_vencidas")?.valor ?? 0;
}

/** "A" · "A e B" · "A, B e C". */
function listar(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

/** "1.000,00", área como o extrato escreve. */
function area(valor: number): string {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(valor);
}

/** "08/2024" a partir de 'YYYY-MM' ou 'YYYY-MM-DD'. Nulo quando não é data. */
function mesEAno(competencia: null | string): null | string {
  const partes = competencia ? /^(\d{4})-(\d{2})/.exec(competencia) : null;
  return partes ? `${partes[2]}/${partes[1]}` : null;
}

/** Singular ou plural, com o número na frente: "1 parcela", "4 parcelas". */
function contar(quantidade: number, singular: string, plural: string): string {
  return `${quantidade} ${quantidade === 1 ? singular : plural}`;
}

/**
 * Os titulares como a ficha do extrato escreve: "NOME (***.560.857-**)", separados por barra.
 *
 * ⚠️ O DOCUMENTO VAI ENTRE PARÊNTESES, SEM O RÓTULO "CPF". É o padrão do extrato, e resolve de
 * quebra o titular pessoa jurídica: com o rótulo fixo "CPF", um CNPJ saía como documento errado com
 * cara de certo (e a versão de 15/09 escondia a linha inteira).
 */
export function titularesEscritos(cliente: ClienteDaRescisao): string {
  return (
    cliente.titulares
      .map((titular) => (titular.documento ? `${titular.nome} (${titular.documento})` : titular.nome))
      .join("  |  ") || "-"
  );
}

/** "Quadra 06, Lote 10 (LOS0610)", como o cabeçalho do extrato. */
export function unidadeEscrita(imovel: ImovelDaRescisao): string {
  const partes: string[] = [];
  if (imovel.quadra) partes.push(`Quadra ${imovel.quadra}`);
  if (imovel.lote) partes.push(`Lote ${imovel.lote}`);
  return partes.length ? `${partes.join(", ")} (${imovel.codigo})` : imovel.codigo;
}

/**
 * "Área 300,00 m², Mateus Leme/MG": a linha cinza do cabeçalho.
 *
 * ⚠️ O MUNICÍPIO ENTRA AQUI, E NÃO NUMA FRASE. A versão de 15/09 tinha uma seção inteira ("Lote de
 * terreno nº 10, da Quadra 06, com área global de...") para dizer o que o cabeçalho do extrato diz
 * em duas linhas. Sem área e sem município, a linha não existe.
 */
export function localEscrito(imovel: ImovelDaRescisao): null | string {
  const partes: string[] = [];
  if (imovel.area) partes.push(`Área ${area(imovel.area)} m²`);
  if (imovel.cidade) partes.push(`${imovel.cidade}${imovel.uf ? `/${imovel.uf}` : ""}`);
  return partes.length ? partes.join(", ") : null;
}

/**
 * A linha da ficha, na mesma grade de colunas do extrato.
 *
 * ⚠️ "VALOR DE TABELA" NO LUGAR DE "SITUAÇÃO". Nesta simulação a situação é sempre "Contrato ativo"
 * (a montagem recusa contrato encerrado), então a coluna não diria nada. O valor de tabela diz: é a
 * base da multa e da publicidade na praxe, e sem ele na folha a tabela de deduções não se confere.
 */
export function camposDaFicha(dados: DadosDaRescisao): CampoDaFicha[] {
  return [
    { peso: 0.2, rotulo: "Contrato / unidade", valor: dados.imovel.codigo },
    { peso: 0.15, rotulo: "Data do ato", valor: dataBr(dados.contrato.dataDoAto) },
    { peso: 0.42, rotulo: "Plano", valor: dados.contrato.plano ?? "-" },
    { peso: 0.23, rotulo: "Valor de tabela", valor: reais(dados.contrato.valorDeTabela) },
  ];
}

/**
 * Os três cartões: total pago, MENOS as deduções, IGUAL ao saldo.
 *
 * ⚠️ O TERCEIRO CARTÃO É O QUE O CLIENTE PROCURA, e o rótulo diz quem deve a quem sem depender do
 * sinal do número. "Saldo residual" sozinho não diz se o residual é do cliente ou da vendedora; o
 * número nunca é negativo (`calcularRescisao` já separa `saldoResidual` de `saldoARestituir`), então
 * a direção TEM de estar escrita no rótulo.
 */
export function cartoesDaRescisao(dados: DadosDaRescisao): Cartao[] {
  const { conta, pagamentos } = dados;
  const inicio = mesEAno(pagamentos.mesInicial);
  const fim = mesEAno(pagamentos.mesFinal);
  const periodo = inicio && fim ? (inicio === fim ? `, em ${inicio}` : `, de ${inicio} a ${fim}`) : "";

  const pago: Cartao = {
    apoio:
      pagamentos.quantidade > 0
        ? `${contar(pagamentos.quantidade, "pagamento", "pagamentos")}${periodo}`
        : "Nenhum pagamento registrado",
    icone: "moeda",
    rotulo: "Total pago",
    valor: reais(conta.totalPago),
  };

  const deducoes: Cartao = {
    apoio: `${contar(conta.deducoes.length, "dedução, detalhada", "deduções, detalhadas")} abaixo`,
    icone: "menos",
    rotulo: "Total de deduções",
    valor: reais(conta.totalDeDeducoes),
  };

  const caso = casoDoSaldo(conta);
  const resultado: Cartao =
    caso === "residual"
      ? {
          apoio: "Deduções menos o total pago",
          icone: "igual",
          rotulo: "Saldo a pagar pelo comprador",
          valor: reais(valorDoSaldo(conta)),
        }
      : caso === "restituir"
        ? {
            apoio: "Total pago menos as deduções",
            icone: "igual",
            rotulo: "Saldo a restituir ao comprador",
            valor: reais(valorDoSaldo(conta)),
          }
        : {
            apoio: "O total pago cobre as deduções",
            icone: "igual",
            rotulo: "Sem saldo",
            valor: reais(0),
          };

  return [pago, deducoes, resultado];
}

/**
 * A frase logo abaixo dos cartões: o resultado em linguagem simples, com o saldo POR EXTENSO.
 *
 * ⚠️ O POR EXTENSO SAI DE `dinheiroPorExtenso` (a régua da Têmis, que escreve "um mil reais" pela
 * mesma razão do cheque). Em minúsculas, porque aqui ele é leitura, não cláusula.
 */
export function fraseDoResultado(conta: ContaDaRescisao): string {
  const abertura =
    "Numa rescisão, do total pago saem as deduções previstas no contrato, detalhadas abaixo.";
  const caso = casoDoSaldo(conta);
  const valor = valorDoSaldo(conta);
  const escrito = `${reais(valor)} (${dinheiroPorExtenso(valor)})`;

  if (caso === "residual") {
    return `${abertura} Como as deduções passam do total pago, não há valor a restituir e fica um saldo de ${escrito} a pagar pelo comprador.`;
  }
  if (caso === "restituir") {
    return `${abertura} Como o total pago passa das deduções, sobra um saldo de ${escrito} a restituir ao comprador.`;
  }
  return `${abertura} Aqui o total pago cobre exatamente as deduções: não há saldo a restituir nem a pagar.`;
}

/** Primeira letra maiúscula: "valor de tabela" vira "Valor de tabela" na célula. */
function comMaiuscula(texto: string): string {
  return texto ? `${texto.charAt(0).toUpperCase()}${texto.slice(1)}` : texto;
}

/**
 * Uma linha da tabela "Como chegamos a esse valor": dedução, base, cálculo e valor.
 *
 * ⚠️ A BASE TEM COLUNA PRÓPRIA, E É O QUE TORNA A TABELA DIDÁTICA. "10% sobre R$ 67.682,78" não
 * diz o que são os R$ 67.682,78; "Valor de tabela menos a comissão" diz. O nome vem da conta
 * (`incideSobre`), porque a premissa cadastrada pode mudar a base de cada rubrica.
 *
 * ⚠️ AS DUAS LINHAS QUE NÃO SÃO PERCENTUAL dizem de onde vêm: a corretagem em reais sai do contrato
 * de corretagem, e as parcelas vencidas saem do extrato e estão listadas logo abaixo.
 */
export function linhaDaDeducao(linha: LinhaDaDeducao, dados: DadosDaRescisao): string[] {
  const valor = reais(linha.valor);

  if (linha.rubrica === "parcelas_vencidas") {
    const quantidade = dados.parcelasVencidas.length;
    return [
      linha.descricao,
      "Extrato financeiro",
      quantidade ? `${contar(quantidade, "parcela, listada", "parcelas, listadas")} abaixo` : "Nenhuma em aberto",
      valor,
    ];
  }

  if (linha.incideSobre) {
    return [linha.descricao, comMaiuscula(linha.incideSobre), linha.base, valor];
  }

  return [
    linha.descricao,
    linha.rubrica === "corretagem" ? "Contrato de corretagem" : "-",
    linha.base,
    valor,
  ];
}

/**
 * Em quantos grupos lado a lado a lista de parcelas vencidas é impressa.
 *
 * ⚠️ A LISTA LONGA SE ESPALHA PARA OS LADOS, E NÃO PARA A SEGUNDA FOLHA. Há contrato com 33 parcelas
 * vencidas no C2X (LOU0123, contrato 81, em 16/09/2026): numa coluna só são 33 linhas, e os avisos
 * da apuração caem sozinhos numa segunda página. Até 6 cabe numa coluna, até 24 em duas (doze
 * linhas), acima disso em três. Lida de cima para baixo e depois a coluna seguinte.
 */
export const LIMITE_DE_UMA_COLUNA = 6;
export const LIMITE_DE_DUAS_COLUNAS = 24;

export function gruposDaListaDeVencidas(quantidade: number): 1 | 2 | 3 {
  if (quantidade <= LIMITE_DE_UMA_COLUNA) return 1;
  return quantidade <= LIMITE_DE_DUAS_COLUNAS ? 2 : 3;
}

/** As parcelas vencidas em linhas de tabela, já distribuídas nos grupos lado a lado. */
export function linhasDasParcelasVencidas(dados: DadosDaRescisao): string[][] {
  const celulas = dados.parcelasVencidas.map((parcela) => [
    parcela.numero,
    dataBr(parcela.vencimento),
    reais(parcela.valor),
  ]);
  const grupos = gruposDaListaDeVencidas(celulas.length);
  if (grupos === 1) return celulas;

  const porGrupo = Math.ceil(celulas.length / grupos);
  return Array.from({ length: porGrupo }, (_, linha) =>
    Array.from({ length: grupos }, (_, grupo) => [
      ...(grupo > 0 ? [""] : []),
      ...(celulas[grupo * porGrupo + linha] ?? ["", "", ""]),
    ]).flat(),
  );
}

/**
 * As colunas da lista de vencidas.
 *
 * ⚠️ NUM GRUPO SÓ, A GRADE É A DA TABELA DE DEDUÇÕES: o vencimento começa onde começa a base, e o
 * valor fecha na mesma borda. Com mais grupos, uma coluna vazia separa um do outro, porque o valor
 * alinhado à direita encostaria no número da parcela do grupo seguinte.
 */
function colunasDasParcelasVencidas(grupos: 1 | 2 | 3): Coluna[] {
  const grupo = ([parcela, vencimento, valor]: [number, number, number]): Coluna[] => [
    { label: "Parcela", peso: parcela },
    { label: "Vencimento", peso: vencimento },
    { align: "right", label: "Valor", peso: valor },
  ];
  if (grupos === 1) return grupo([0.25, 0.57, 0.18]);

  const pesos: [number, number, number] = grupos === 2 ? [0.15, 0.15, 0.15] : [0.09, 0.12, 0.1];
  const respiro = grupos === 2 ? 0.1 : 0.035;
  return Array.from({ length: grupos }, (_, indice) => [
    ...(indice > 0 ? [{ label: "", peso: respiro }] : []),
    ...grupo(pesos),
  ]).flat();
}

/**
 * "O que isso significa": no máximo quatro tópicos curtos, e só os que valem para este contrato.
 *
 * ⚠️ CADA TÓPICO SEGUE O CASO. Falar de corretagem não restituída quando ela não foi deduzida, ou
 * de encargo sobre parcela vencida em contrato em dia, é texto de modelo, e mandar cobrar quem tem
 * saldo a receber é o pior erro que este papel pode cometer.
 *
 * ⚠️ O ÚLTIMO É SEMPRE O AVISO DE SIMULAÇÃO. Ele está no rodapé também, mas rodapé ninguém lê: é
 * a frase que impede o cliente de tratar o papel como distrato.
 */
export function itensDoQueSignifica(dados: DadosDaRescisao): string[] {
  const { conta } = dados;
  const itens: string[] = [];

  if ((deducaoDe(conta, "corretagem")?.valor ?? 0) > 0) {
    itens.push("A comissão de corretagem pagou a intermediação da venda e não é restituída na rescisão.");
  }

  if (dados.parcelasVencidas.length) {
    itens.push("Até serem pagas, as parcelas vencidas continuam sujeitas à correção, aos juros e à multa do contrato.");
  }

  const caso = casoDoSaldo(conta);
  if (caso === "residual") {
    itens.push(
      "O saldo a pagar também segue sujeito aos encargos do contrato e pode ser cobrado de forma administrativa ou judicial.",
    );
  } else if (caso === "restituir") {
    itens.push("A restituição do saldo segue a forma e os prazos previstos no contrato.");
  }

  itens.push(
    "Esta é uma simulação: ela não desfaz o contrato, vale para a data da posição e depende da conferência com o contrato assinado.",
  );

  return itens;
}

/** Nome do arquivo: "Simulacao de Rescisao - <titulares> - <unidade> - dd-mm-aaaa.pdf". */
export function nomeDoArquivoRescisao(dados: DadosDaRescisao): string {
  const nomes = listar(dados.cliente.titulares.map((titular) => titular.nome.trim())) || "Cliente";
  const dia = dataBr(dados.emitidoEm).replace(/\//g, "-");

  return sanitizarNomeDeArquivo(
    `${TITULO_DA_PECA} - ${nomes} - ${dados.imovel.codigo} - ${dia}.pdf`,
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// O DOCUMENTO
// ────────────────────────────────────────────────────────────────────────────────────────────

/** Título de seção que desce junto com o cabeçalho e a primeira linha da tabela dele. */
function secao(ctx: Ctx, titulo: string): void {
  tituloDeSecao(ctx, titulo, 30);
}

/**
 * Título de uma lista de tópicos, que desce junto com o PRIMEIRO tópico, e só com ele.
 *
 * ⚠️ A RESERVA É A ALTURA REAL DO TÓPICO, e não os 30pt de uma tabela. Com 30pt fixos os avisos da
 * apuração, que cabiam no pé da folha, abriam uma segunda página sozinhos (visto no contrato com 33
 * vencidas). Menos que a altura real, e o título ficaria órfão no pé da página.
 */
function secaoDeTopicos(ctx: Ctx, titulo: string, primeiro: string, tamanho: number): void {
  const linhas = quebrar(primeiro, ctx.font, tamanho, USABLE - 12).length;
  tituloDeSecao(ctx, titulo, linhas * (tamanho + 2.6) + 4);
}

export async function montarTermoDeRescisaoPdf(dados: DadosDaRescisao): Promise<Uint8Array> {
  const { cliente, conta, imovel } = dados;
  const ctx = await abrirDocumento(`${TITULO_DA_PECA} ${imovel.codigo}`);

  const local = localEscrito(imovel);
  await cabecalhoComBlocoADireita(ctx, {
    destaque: imovel.empreendimento,
    linhas: [unidadeEscrita(imovel), ...(local ? [local] : [])],
    subtitulo: `Posição em ${dataBr(dados.emitidoEm)}`,
    titulo: TITULO_DA_PECA,
  });

  campoEmDestaque(ctx, cliente.titulares.length > 1 ? "Titulares" : "Titular", titularesEscritos(cliente));
  linhaDeCampos(ctx, camposDaFicha(dados));

  desenharCartoes(ctx, cartoesDaRescisao(dados));

  ctx.y -= 6;
  paragrafo(ctx, fraseDoResultado(conta));

  secao(ctx, "Como chegamos a esse valor");
  desenharTabelaLimpa(ctx, {
    colunas: [
      { label: "Dedução", peso: 0.25 },
      { label: "Base", peso: 0.28 },
      { label: "Cálculo", peso: 0.29 },
      { align: "right", label: "Valor", peso: 0.18 },
    ],
    // ⚠️ AS LINHAS SAEM NA ORDEM DA CONTA, inclusive a fruição, que só existe quando houve posse.
    linhas: conta.deducoes.map((linha) => linhaDaDeducao(linha, dados)),
    // A fruição escreve percentual, base e meses: quebrar é melhor do que imprimir reticências
    // numa frase que o jurídico confere.
    quebrarCelulas: true,
    total: ["Total de deduções", "", "", reais(conta.totalDeDeducoes)],
    vazio: "Nenhuma dedução apurada.",
  });

  const quantasVencidas = dados.parcelasVencidas.length;
  if (quantasVencidas) {
    const totalDasVencidas = reais(totalDasParcelasVencidas(conta));
    const colunas = colunasDasParcelasVencidas(gruposDaListaDeVencidas(quantasVencidas));

    secao(ctx, `Parcelas vencidas em aberto (${quantasVencidas})`);
    desenharTabelaLimpa(ctx, {
      colunas,
      linhas: linhasDasParcelasVencidas(dados),
      // Com uma parcela só, a linha de total repetiria a própria linha.
      ...(quantasVencidas > 1
        ? { total: colunas.map((_, indice) => (indice === 0 ? "Total" : indice === colunas.length - 1 ? totalDasVencidas : "")) }
        : {}),
      vazio: "Nenhuma parcela vencida.",
    });
    paragrafo(ctx, "Valores sem juros e multa, que são apurados no dia do pagamento.", {
      size: 7,
    });
  }

  const significados = itensDoQueSignifica(dados);
  secaoDeTopicos(ctx, "O que isso significa", significados[0] ?? "", 7.8);
  for (const texto of significados) topico(ctx, texto);

  // ⚠️ PEQUENO E CINZA, MAS IMPRESSO. É exceção, não seção: só existe quando a conta avisou.
  if (conta.avisos.length) {
    secaoDeTopicos(ctx, "Observações da apuração", conta.avisos[0] ?? "", 7);
    for (const aviso of conta.avisos) topico(ctx, aviso, { color: SOFT_TEXT, size: 7 });
  }

  // ⚠️ A CLÁUSULA CADASTRADA É O QUE SUSTENTA A ALÍQUOTA. Quando a premissa do empreendimento traz o
  // trecho do contrato, ele sai impresso: é o que transforma "Multa penal (10%)" numa afirmação
  // conferível. Bloco próprio, com sua própria condição.
  const clausulas = conta.deducoes
    .filter((linha) => linha.clausula)
    .map((linha) => `${linha.descricao}: ${linha.clausula}`);
  if (clausulas.length) {
    secaoDeTopicos(ctx, "Fundamento contratual", clausulas[0] ?? "", 7);
    for (const texto of clausulas) topico(ctx, texto, { color: SOFT_TEXT, size: 7 });
  }

  desenharRodapes(
    ctx.doc,
    ctx.font,
    `Simulação emitida pela Careli em ${dataBr(dados.emitidoEm)}, para fins de decisão e sujeita à conferência com o contrato.`,
  );

  return ctx.doc.save();
}
