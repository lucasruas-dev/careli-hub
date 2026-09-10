// O TRABALHO DA TÊMIS — o que entra no board, em que estágio está, o que falta e para quando.
//
// Desenho fechado com o Lucas em 02/09/2026:
//
// 1. **Um fluxo só, para os quatro serviços.** *"o fluxo é o mesmo, muda é as atividades"*. Quatro
//    fluxos dariam dezesseis colunas para o que a coordenação olha uma vez por dia, e o volume não
//    se distribui igual: contrato novo é a regra, os outros três são exceção.
//
// 2. **Sem estágio de conferência.** *"os dados virão do apolo (que já tem a parte de validação,
//    conferência), a proposta vai vir do hercules, que também vai ter tudo validado"*.
//
//    ⚠️ ISSO TRANSFERE A RESPONSABILIDADE PARA O MOTOR, e não a elimina. O documento ainda pode
//    sair errado por defeito de geração, não de dado: um contrato já saiu com `[nome_cliente]`
//    impresso porque a tag do editor partiu o marcador no meio. Conferência humana nunca foi a rede
//    certa — ninguém relê 27 páginas procurando colchete. A rede é a confecção RECUSAR: variável
//    obrigatória vazia, marcador partido, bloco que não fechou.
//
// 3. **O que muda por serviço é o checklist**, e uma particularidade estrutural: quem assina.
//
// 4. **O card anda sozinho e cada atividade tem prazo.** *"queria que isso andasse sozinho, e trazer
//    prazos em cada atividade"*. Por isso a atividade PERTENCE A UM ESTÁGIO: sem essa amarração não
//    há como saber que o estágio acabou, e o board volta a depender de alguém arrastar card.

export type EstagioDoTrabalho =
  | "analise"
  | "assinatura"
  | "contrato"
  | "faturado"
  | "indeferido"
  | "prazo_legal";

export type TipoDeTrabalho =
  | "cancelamento"
  | "cancelamento_correcao"
  | "cessao"
  | "contrato"
  | "distrato";

/**
 * AS CINCO ETAPAS, do mockup aprovado em 09/09/2026
 * (`docs/mockups/temis-quadro-e-tela-de-trabalho.html`).
 *
 * ⚠️ "CONTRATO" AGORA É DUAS COISAS, e a semelhança vai enganar alguém: `tipo` tem o valor
 * `contrato` (o QUE se produz) e a etapa 2 se chama `contrato` (ONDE o trabalho está). Um
 * `tipo === "contrato"` e um `estagio === "contrato"` respondem perguntas diferentes. Foi o
 * vocabulário aprovado, e é o mesmo do funil do Hércules (`lib/hercules/fluxo-de-venda.ts`).
 *
 * ⚠️ `indeferido` NÃO ESTÁ NESTA LISTA porque não é etapa do caminho: é uma saída. Ele aparece
 * como coluna própria no quadro (ver `COLUNAS_DO_QUADRO`), e nenhum trabalho "avança" para ele.
 */
export const ESTAGIOS: {
  descricao: string;
  id: EstagioDoTrabalho;
  nome: string;
}[] = [
  { descricao: "Chegou do Hércules. Conferir e abrir o contrato.", id: "analise", nome: "Análise" },
  {
    descricao: "Gerado. Conferir quem assina antes de mandar.",
    id: "contrato",
    nome: "Contrato",
  },
  {
    descricao: "Na Clicksign, com o cliente.",
    id: "assinatura",
    nome: "Em assinatura",
  },
  {
    descricao: "7 dias de arrependimento e a entrada.",
    id: "prazo_legal",
    nome: "Prazo legal",
  },
  { descricao: "Prazo cumprido e entrada paga.", id: "faturado", nome: "Faturado" },
];

/**
 * O ROTULO DA ULTIMA ETAPA MUDA COM O TIPO.
 *
 * "Faturado" só faz sentido para contrato: cessão, distrato e cancelamento não faturam nada — eles
 * se assinam e se arquivam. O VALOR gravado é o mesmo (`faturado`), para o banco não precisar de
 * um estado por tipo; o que muda é a palavra na tela.
 */
export function nomeDoEstagio(
  estagio: EstagioDoTrabalho,
  tipo: TipoDeTrabalho,
): string {
  if (estagio === "indeferido") return "Indeferido";
  if (estagio === "faturado" && tipo !== "contrato") return "Concluído";
  return ESTAGIOS.find((e) => e.id === estagio)?.nome ?? estagio;
}

/** O quadro mostra as etapas do caminho MAIS a coluna de indeferidos, sempre no fim. */
export const COLUNA_INDEFERIDO = "indeferido" as const;

/**
 * Cada tipo passa pelo estágio de assinatura?
 *
 * ⚠️ É AQUI QUE OS SERVIÇOS DEIXAM DE SER IGUAIS, e eu tinha suposto o contrário. Correção do Lucas
 * (02/09/2026): *"cancelamento por correção tem que ter assinatura, já o cancelamento por
 * desistência não"*. Corrigir um contrato muda o que o comprador assinou, então ele assina de novo;
 * a desistência é ato dele, e o que fazemos é registrar.
 *
 * ⚠️ O CARD PULA A COLUNA, EM VEZ DE ATRAVESSÁ-LA VAZIA. Um trabalho de desistência parado em "Em
 * assinatura" esperando ninguém faz quem olha o board contar como pendência o que já acabou.
 */
export const EXIGE_ASSINATURA: Record<TipoDeTrabalho, boolean> = {
  cancelamento: false,
  cancelamento_correcao: true,
  // ⚠️ TRÊS PARTES ASSINAM a cessão: cedente, cessionário e a Careli dando anuência.
  cessao: true,
  contrato: true,
  distrato: true,
};

/**
 * O caminho de cada tipo.
 *
 * ⚠️ SÓ O CONTRATO TEM AS CINCO. Lucas (10/09/2026), sobre cessão, distrato e cancelamento:
 * *"Caminho próprio, mais curto"*. Eles não têm prazo de arrependimento nem entrada a pagar — o
 * documento se assina e se arquiva. Fazê-los passar por "Prazo legal" criaria uma etapa que nunca
 * fecha, e um card parado ali para sempre é pior do que uma etapa a menos.
 *
 * ⚠️ E O CANCELAMENTO NÃO ASSINA (`EXIGE_ASSINATURA`), então pula também a etapa 3.
 */
export function estagiosDoTipo(tipo: TipoDeTrabalho): EstagioDoTrabalho[] {
  if (tipo === "contrato") {
    return ["analise", "contrato", "assinatura", "prazo_legal", "faturado"];
  }
  return EXIGE_ASSINATURA[tipo]
    ? ["analise", "contrato", "assinatura", "faturado"]
    : ["analise", "contrato", "faturado"];
}

export type Atividade = {
  /** Quantos dias úteis depois de o card ENTRAR no estágio. */
  prazoDias: number;
  /** ⚠️ Quem faz: nós ou alguém de fora. Muda o que "atrasado" significa. */
  quem: "cliente" | "nos";
  estagio: EstagioDoTrabalho;
  texto: string;
};

/**
 * O que cada serviço exige, por estágio, com prazo.
 *
 * ⚠️ O PRAZO CONTA DA ENTRADA NO ESTÁGIO, e não da criação do card. Contando da criação, um
 * trabalho que esperou três dias na entrada chega à confecção já vermelho — e o atraso aparece em
 * quem pegou o trabalho, não em quem o deixou parado.
 *
 * ⚠️ `quem: "cliente"` NÃO CONTA COMO ATRASO NOSSO. O comprador leva o tempo que leva para assinar,
 * e pintar isso de vermelho no board da equipe faz o vermelho perder sentido — em duas semanas
 * ninguém olha mais. Aparece como "aguardando há N dias", que é informação, não cobrança.
 *
 * ⚠️ AS ATIVIDADES VIVEM AQUI, e não no código da tela: mudar o que um distrato exige é editar esta
 * lista.
 */
export const ATIVIDADES: Record<TipoDeTrabalho, Atividade[]> = {
  // ⚠️ NASCE LIGADO A UM CONTRATO QUE JÁ EXISTE, e a primeira atividade é dizer qual: sem isso
  // ninguém sabe o que está sendo corrigido.
  cancelamento_correcao: [
    { estagio: "analise", prazoDias: 1, quem: "nos", texto: "Identificar o contrato original e o que está errado" },
    { estagio: "contrato", prazoDias: 1, quem: "nos", texto: "Gerar o documento de correção" },
    { estagio: "contrato", prazoDias: 1, quem: "nos", texto: "Definir signatários e a ordem de assinatura" },
    { estagio: "assinatura", prazoDias: 1, quem: "nos", texto: "Despachar para assinatura" },
    { estagio: "assinatura", prazoDias: 5, quem: "cliente", texto: "Colher as assinaturas" },
    { estagio: "faturado", prazoDias: 1, quem: "nos", texto: "Atualizar o cadastro do cliente e a unidade" },
  ],
  // ⚠️ SEM ASSINATURA E SEM APURAÇÃO: sem pagamento e sem assinatura o contrato não chegou a se
  // formar — não há o que distratar nem o que devolver. Quem decide isso é `cancelamento.ts`, pelos
  // fatos, e não quem abre a solicitação.
  cancelamento: [
    { estagio: "analise", prazoDias: 1, quem: "nos", texto: "Registrar o motivo do cancelamento" },
    { estagio: "contrato", prazoDias: 1, quem: "nos", texto: "Gerar o termo de cancelamento" },
    { estagio: "faturado", prazoDias: 1, quem: "nos", texto: "Liberar a unidade para venda" },
  ],
  // ⚠️ A CESSÃO CANCELA O CONTRATO ANTIGO E CRIA UM NOVO, nas mesmas condições. Decisão do Lucas
  // (02/09/2026): *"ae cancela o contrato antigo e nasce um novo nas mesmas condições"*. Não é
  // troca de titular numa linha: são dois contratos, e por isso as duas últimas atividades são
  // separadas — encerrar um e abrir o outro acontecem em momentos diferentes, e o intervalo entre
  // eles é onde a unidade fica sem dono.
  //
  // ⚠️ "NAS MESMAS CONDIÇÕES" É REGRA, NÃO CORTESIA: o cessionário assume o plano, o saldo e o
  // vencimento do cedente. Gerar o contrato novo pela tabela de hoje mudaria o preço de quem só
  // entrou no lugar de outro.
  //
  // ⚠️ O PAGAMENTO DA TAXA SÃO DUAS ATIVIDADES, e não uma: quem paga é o cliente e quem confere é a
  // casa. Uma só ("cobrar a taxa") esconderia o intervalo em que o dinheiro ainda não entrou — que
  // é justamente onde a cessão fica parada.
  //
  // ⚠️ AS DUAS TRAVAS DE ENTRADA (unidade em dia, cessionário com cadastro no Apolo) NÃO ESTÃO AQUI
  // de propósito: elas impedem a solicitação de nascer, e vivem em `cessao.ts`. Como atividade, o
  // card atravessaria metade do board para morrer, com o cedente já avisado de que a cessão andava.
  cessao: [
    { estagio: "analise", prazoDias: 1, quem: "nos", texto: "Conferir o cessionário e o cadastro dele no Apolo" },
    { estagio: "contrato", prazoDias: 1, quem: "nos", texto: "Emitir a cobrança da taxa de cessão" },
    { estagio: "contrato", prazoDias: 5, quem: "cliente", texto: "Receber o pagamento da taxa" },
    { estagio: "contrato", prazoDias: 1, quem: "nos", texto: "Validar o pagamento da taxa" },
    { estagio: "contrato", prazoDias: 1, quem: "nos", texto: "Gerar o termo de cessão" },
    { estagio: "contrato", prazoDias: 1, quem: "nos", texto: "Definir signatários: cedente, cessionário e a Careli" },
    { estagio: "assinatura", prazoDias: 1, quem: "nos", texto: "Despachar para assinatura" },
    { estagio: "assinatura", prazoDias: 7, quem: "cliente", texto: "Colher as assinaturas" },
    { estagio: "faturado", prazoDias: 1, quem: "nos", texto: "Encerrar o contrato do cedente" },
    { estagio: "faturado", prazoDias: 1, quem: "nos", texto: "Abrir o contrato do cessionário nas mesmas condições" },
  ],
  // ⚠️ AS DUAS ÚLTIMAS ETAPAS SÃO NOVAS (10/09/2026) e não têm nada a ver com produzir documento:
  // são as condições que separam "assinado" de "vendido". Lucas (09/09): *"depois de assinatura
  // vai ter algumas condições para finalizado"*.
  //
  // ⚠️ E OS 7 DIAS SÃO CORRIDOS, NÃO ÚTEIS. `prazoDias` conta dias úteis em todo o resto deste
  // arquivo (`diasUteis`), porque mede TRABALHO NOSSO. O arrependimento é prazo do comprador e
  // corre no calendário — sábado e domingo contam. Por isso quem manda na etapa 4 não é este
  // `prazoDias`, e sim `arrependimento_inicio` mais sete dias corridos; o número aqui serve só
  // para a cor do card não gritar antes da hora.
  contrato: [
    { estagio: "analise", prazoDias: 1, quem: "nos", texto: "Conferir a proposta e o plano vindos do Hércules" },
    { estagio: "contrato", prazoDias: 1, quem: "nos", texto: "Gerar o contrato pela minuta do empreendimento" },
    { estagio: "contrato", prazoDias: 1, quem: "nos", texto: "Definir signatários e a ordem de assinatura" },
    { estagio: "assinatura", prazoDias: 1, quem: "nos", texto: "Despachar para assinatura" },
    { estagio: "assinatura", prazoDias: 7, quem: "cliente", texto: "Colher as assinaturas" },
    { estagio: "prazo_legal", prazoDias: 5, quem: "cliente", texto: "Cumprir os 7 dias de arrependimento" },
    { estagio: "prazo_legal", prazoDias: 5, quem: "cliente", texto: "Pagar a entrada" },
    { estagio: "faturado", prazoDias: 1, quem: "nos", texto: "Faturar a venda e arquivar o contrato" },
  ],
  distrato: [
    { estagio: "analise", prazoDias: 1, quem: "nos", texto: "Registrar o motivo do distrato" },
    { estagio: "contrato", prazoDias: 3, quem: "nos", texto: "Apurar valores: pago, retenção e o que se devolve" },
    { estagio: "contrato", prazoDias: 1, quem: "nos", texto: "Gerar o termo de distrato" },
    { estagio: "contrato", prazoDias: 1, quem: "nos", texto: "Definir signatários" },
    { estagio: "assinatura", prazoDias: 1, quem: "nos", texto: "Despachar para assinatura" },
    { estagio: "assinatura", prazoDias: 7, quem: "cliente", texto: "Colher as assinaturas" },
    { estagio: "faturado", prazoDias: 1, quem: "nos", texto: "Liberar a unidade para venda" },
  ],
};

export const NOME_DO_TIPO: Record<TipoDeTrabalho, string> = {
  cancelamento: "Cancelamento",
  cancelamento_correcao: "Cancelamento por correção",
  cessao: "Cessão",
  contrato: "Contrato",
  distrato: "Distrato",
};

export type Trabalho = {
  atividadesFeitas: string[];
  clienteCpf: null | string;
  clienteNome: string;
  criadoEm: string;
  empreendimentoCodigo: string;
  empreendimentoNome: string;
  estagio: EstagioDoTrabalho;
  /** Quando o card entrou no estágio atual — é daqui que os prazos contam. */
  estagioDesde: string;
  id: string;
  observacao: null | string;
  tipo: TipoDeTrabalho;
  /** ⚠️ Só no cancelamento por correção: o contrato que está sendo corrigido. */
  trabalhoOrigemId: null | string;
  unidade: string;
};

export function atividadesDoEstagio(
  tipo: TipoDeTrabalho,
  estagio: EstagioDoTrabalho,
): Atividade[] {
  return (ATIVIDADES[tipo] ?? []).filter((a) => a.estagio === estagio);
}

/**
 * O card pode andar sozinho? Anda quando TODAS as atividades do estágio atual estão marcadas.
 *
 * ⚠️ ESTÁGIO SEM ATIVIDADE NENHUMA NÃO ANDA SOZINHO, e isso é deliberado. Um estágio vazio
 * avançaria no mesmo instante em que o card chega, e o trabalho atravessaria o board sem parar em
 * lugar nenhum — o board mostraria tudo em "Finalizado" e nada do que está acontecendo.
 */
export function podeAvancar(trabalho: Pick<Trabalho, "atividadesFeitas" | "estagio" | "tipo">): boolean {
  const doEstagio = atividadesDoEstagio(trabalho.tipo, trabalho.estagio);
  if (doEstagio.length === 0) return false;
  const feitas = new Set(trabalho.atividadesFeitas);
  return doEstagio.every((a) => feitas.has(a.texto));
}

/** O estágio seguinte, respeitando o que o tipo pula. `null` quando já acabou. */
export function proximoEstagio(
  tipo: TipoDeTrabalho,
  atual: EstagioDoTrabalho,
): EstagioDoTrabalho | null {
  const caminho = estagiosDoTipo(tipo);
  const i = caminho.indexOf(atual);
  if (i < 0 || i === caminho.length - 1) return null;
  return caminho[i + 1] ?? null;
}

/**
 * Dias ÚTEIS entre duas datas. Sábado e domingo não contam.
 *
 * ⚠️ PRAZO EM DIA CORRIDO ACUSA ATRASO NA SEGUNDA-FEIRA de todo trabalho que entrou na sexta. O
 * board vira uma parede vermelha às segundas, e o vermelho deixa de significar alguma coisa.
 */
export function diasUteis(de: Date, ate: Date): number {
  if (ate <= de) return 0;
  let dias = 0;
  const cursor = new Date(Date.UTC(de.getUTCFullYear(), de.getUTCMonth(), de.getUTCDate()));
  const fim = new Date(Date.UTC(ate.getUTCFullYear(), ate.getUTCMonth(), ate.getUTCDate()));
  while (cursor < fim) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dia = cursor.getUTCDay();
    if (dia !== 0 && dia !== 6) dias += 1;
  }
  return dias;
}

export type SituacaoDoPrazo = {
  /** Dias úteis desde a entrada no estágio. */
  decorridos: number;
  /** O prazo da atividade mais apertada que ainda falta. `null` quando não há o que fazer. */
  prazo: null | number;
  /** `true` só quando o atraso é NOSSO — espera de cliente não é atraso. */
  atrasado: boolean;
  /** `true` quando falta um dia ou menos. */
  vencendo: boolean;
};

/**
 * Como está o prazo do card, olhando o que falta no estágio atual.
 *
 * ⚠️ VALE A ATIVIDADE MAIS APERTADA QUE AINDA FALTA, e não a soma. As atividades de um estágio
 * acontecem em paralelo na prática (quem gera o contrato já vai definindo signatário), e somar
 * prazos daria folga que não existe.
 */
export function situacaoDoPrazo(
  trabalho: Pick<Trabalho, "atividadesFeitas" | "estagio" | "estagioDesde" | "tipo">,
  agora: Date = new Date(),
): SituacaoDoPrazo {
  const feitas = new Set(trabalho.atividadesFeitas);
  const faltando = atividadesDoEstagio(trabalho.tipo, trabalho.estagio).filter(
    (a) => !feitas.has(a.texto),
  );
  const decorridos = diasUteis(new Date(trabalho.estagioDesde), agora);

  if (faltando.length === 0) return { atrasado: false, decorridos, prazo: null, vencendo: false };

  const nossas = faltando.filter((a) => a.quem === "nos");
  const prazo = Math.min(...faltando.map((a) => a.prazoDias));
  // ⚠️ SÓ O QUE É NOSSO PINTA DE VERMELHO. O comprador leva o tempo que leva para assinar, e
  // cobrar a equipe por isso faz o vermelho perder sentido.
  const prazoNosso = nossas.length > 0 ? Math.min(...nossas.map((a) => a.prazoDias)) : null;

  return {
    atrasado: prazoNosso !== null && decorridos > prazoNosso,
    decorridos,
    prazo,
    vencendo: prazoNosso !== null && decorridos === prazoNosso,
  };
}

/** Quantas atividades do estágio atual já foram marcadas — o que o card mostra sem abrir. */
export function progresso(trabalho: Pick<Trabalho, "atividadesFeitas" | "estagio" | "tipo">): {
  feitas: number;
  total: number;
} {
  const doEstagio = atividadesDoEstagio(trabalho.tipo, trabalho.estagio);
  const feitas = new Set(trabalho.atividadesFeitas);
  return { feitas: doEstagio.filter((a) => feitas.has(a.texto)).length, total: doEstagio.length };
}

/**
 * O PRAZO DE EMISSÃO — o que a casa promete ao comercial, em HORAS ÚTEIS.
 *
 * Lucas (06/09/2026), sobre o card no board do comercial: *"pode continuar trazer o prazo, emissão
 * de contrato 24 horas úteis"*.
 *
 * ⚠️ É OUTRA MEDIDA, E NÃO A SOMA DAS ATIVIDADES. `situacaoDoPrazo` responde "o que está na minha
 * mão HOJE está atrasado?" — pergunta de quem executa, por estágio. Esta responde "quando o
 * contrato fica pronto?", que é a única pergunta do comercial, e ela é de ponta a ponta: da hora em
 * que o pedido chegou até o documento sair para assinatura. Somar os prazos por atividade daria
 * outro número (três dias, no contrato) e prometeria ao comercial algo que ninguém combinou.
 *
 * ⚠️ 24 HORAS ÚTEIS É UM DIA ÚTIL, e não três turnos de oito horas. É como a casa fala e como o
 * cliente entende: pedido de hoje, contrato amanhã — sexta vira segunda. A conta é `diasUteis`, a
 * mesma do resto do módulo, e por isso a constante é expressa em horas mas dividida por 24: é o
 * número da promessa que fica escrito aqui, não a unidade interna.
 *
 * ⚠️ O CANCELAMENTO E O DISTRATO NÃO TÊM ESTA PROMESSA. Neles o prazo depende de apuração de
 * valores e de decisão do jurídico; carimbar 24 horas no card seria prometer, para quem lê, uma
 * data que ninguém pode cumprir.
 */
export const HORAS_UTEIS_DE_EMISSAO: Partial<Record<TipoDeTrabalho, number>> = {
  contrato: 24,
};

/** As etapas em que a emissão ainda está acontecendo — depois delas o documento já saiu. */
const EMITINDO: EstagioDoTrabalho[] = ["analise", "contrato"];

export type PrazoDeEmissao = {
  /** Quando o documento tem de estar pronto. */
  em: Date;
  /** O que escrever no card: "24h úteis". */
  escrito: string;
  /** Já passou da hora e o documento não saiu. */
  estourou: boolean;
};

/**
 * Até quando este trabalho tem de virar documento.
 *
 * `null` quando o tipo não tem promessa (cancelamento, distrato, cessão) ou quando a emissão já
 * aconteceu — passado o despacho para assinatura, o prazo que corre é o do cliente assinar, e esse
 * não é nosso.
 */
export function prazoDeEmissao(
  trabalho: Pick<Trabalho, "criadoEm" | "estagio" | "tipo">,
  agora: Date = new Date(),
): null | PrazoDeEmissao {
  const horas = HORAS_UTEIS_DE_EMISSAO[trabalho.tipo];
  if (!horas || !EMITINDO.includes(trabalho.estagio)) return null;

  const inicio = new Date(trabalho.criadoEm);
  if (Number.isNaN(inicio.getTime())) return null;

  const em = somarDiasUteis(inicio, Math.max(1, Math.round(horas / 24)));
  return {
    em,
    escrito: horas === 24 ? "24h úteis" : `${horas}h úteis`,
    estourou: agora > em,
  };
}

/**
 * A data N dias ÚTEIS depois, mantendo a hora.
 *
 * ⚠️ SÁBADO E DOMINGO NÃO CONTAM, pela mesma razão de `diasUteis`: pedido de sexta com prazo de um
 * dia útil vence na segunda, e não no sábado — cobrar por um dia em que ninguém trabalha faz o
 * board mentir sobre atraso.
 */
function somarDiasUteis(de: Date, dias: number): Date {
  const fim = new Date(de.getTime());
  let restantes = dias;
  while (restantes > 0) {
    fim.setUTCDate(fim.getUTCDate() + 1);
    const dia = fim.getUTCDay();
    if (dia !== 0 && dia !== 6) restantes -= 1;
  }
  return fim;
}
