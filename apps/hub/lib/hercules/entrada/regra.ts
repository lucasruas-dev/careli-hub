// A ENTRADA DA VENDA NO C2X, COMO O CARD DO PRÉ-FATURAMENTO A MOSTRA: puro, sem banco.
//
// Lucas, 02/10/2026, sobre os cards de contrato no Pré-faturamento da Têmis: *"verifica se estamos
// conseguindo ler o financeiro desses contratos"*. Não estávamos: o bloco "A entrada" era um aviso de
// obra, e nada no Panteon tem a parcela por venda (o financeiro da venda nativa vive no C2X). Decisões
// dele no mesmo dia: (1) o Avulso pago aparece ao lado da entrada, e quem decide se ele conta é o
// time (*"Mostrar e eu decido"*); (2) só no hub, o portal não recebe; (3) só o passo 1: a tela mostra
// a entrada e se ela está paga, e o Faturado continua à mão.
//
// ⚠️ A REGRA VEIO DA F8 (`lib/hercules/faturamento/regra.ts`, branch local fix/assinatura-fonte-unica,
// sem push) COM DOIS DEFEITOS CORRIGIDOS, medidos em 02/10/2026 só com SELECT:
//   (a) TODA VENDA REDIGITADA NO C2X TEM UM ATO DE R$ 0,00 COM STATUS PAGO, e a entrada de verdade
//       está no Sinal. A F8 escolhia a primeira parcela pelo vencimento sem olhar o valor, e o Ato
//       zerado (que vence antes) dizia "entrada paga" no lugar do Sinal atrasado: o Antonio X.
//       (VOC1102) e a Stefany M. (VOR1401) sairiam pagos. Aqui parcela de valor zero NÃO EXISTE para
//       a entrada.
//   (b) A F8 NÃO LIA O AVULSO (tipo 4). O Jorge M. (REP D L163, pedido 5020) pagou em 28/09 duas
//       parcelas Avulso no valor exato do Ato (R$ 1.000) e do Sinal (R$ 8.390), que continuam
//       Atrasado no C2X. Decidir sozinho que o Avulso quita a entrada seria o sistema chutando; ele
//       vem À PARTE (`avulsosPagos`), e a tela o mostra ao lado.
//
// ⚠️ SEM DOCUMENTO DE NINGUÉM: esta folha recebe parcelas já lidas e devolve o que a tela desenha.

import { diaEmBrasilia } from "@/lib/assinatura/instante";

/** `parcel_types` do C2X: 1 Ato, 2 Sinal, 4 Avulso (o 3 é a mensal; `lib/apolo/extrato-cliente.ts`). */
export const ATO = 1;
export const SINAL = 2;
export const AVULSO = 4;
/** `payment_statuses`: 5 Pago, 6 Aguardando, 7 Atrasado. */
export const PAGO = 5;
export const ATRASADO = 7;
/** O recorte ativo da carteira (`lib/apolo/carteira.ts`): o resto (cancelada, estornada) não é entrada. */
const STATUS_ATIVOS: ReadonlySet<number> = new Set([5, 6, 7]);
/** Estágios do pedido no C2X que dizem "desfeito lá" (os mesmos da F8). */
export const ESTAGIOS_DESFEITOS_NO_C2X: ReadonlySet<number> = new Set([7, 8, 10, 11]);

/** Uma parcela de Ato, Sinal ou Avulso, como o C2X a devolve (datas como texto `AAAA-MM-DD`). */
export type ParcelaDoC2x = {
  apagada: boolean;
  id: number;
  /**
   * `payments.updated_at` (a última alteração da parcela), já em ISO com `-03:00`: o C2X grava
   * Brasília sem fuso, e quem lê converte por `instanteDeBrasilia`. Só serve ao "Pago" sem
   * `payment_date` (decisão do Lucas de 29/09/2026).
   */
  marcadoEm: null | string;
  /** `payment_date`: o dia do dinheiro (DATE, sem hora). */
  pagoEm: null | string;
  /** `current_signal_parcel` (0 quando não se aplica). */
  parcelaDoSinal: null | number;
  status: null | number;
  tipo: number;
  /** `total_signal_parcels`: o "3" de "Sinal 1/3". */
  totalDoSinal: null | number;
  /** `initial_value`, em reais. `null` = o C2X não deu valor (conta como zero: não é entrada). */
  valor: null | number;
  /** `due_date`. */
  vencimento: null | string;
};

/** O pedido do C2X que paga a entrada da venda, com o estágio e as parcelas lidas. */
export type PedidoDoC2x = {
  arId: number;
  estagio: null | number;
  parcelas: readonly ParcelaDoC2x[];
  /**
   * Quantas parcelas o pedido tem no C2X, de QUALQUER tipo (a mensal também), fora as marcadas para
   * apagar. `0` = o financeiro do pedido ainda não foi lançado; `null` = não se sabe.
   *
   * ⚠️ EXISTE PARA A TELA NÃO DIZER A MESMA FRASE PARA DUAS COISAS (revisão de 02/10/2026): o pedido
   * sem NENHUMA parcela e o pedido cuja entrada é toda de valor zero davam "não tem Ato nem Sinal com
   * valor". O primeiro pede para esperar (ou cobrar) o lançamento no C2X; o segundo, para olhar o
   * plano da venda.
   */
  totalDeParcelas: null | number;
};

/**
 * A situação de uma parcela na tela.
 *
 * ⚠️ `pago_sem_data` EXISTE PARA A TELA NÃO MENTIR NOS DOIS SENTIDOS: o C2X diz "Pago" e não há nem
 * `payment_date` nem `updated_at` legível. Pela regra de 29/09 ela não conta como paga (sem dia não há
 * pagamento), e escrever "em aberto" afirmaria o contrário do que o C2X diz.
 */
export type SituacaoDaParcela = "em_aberto" | "paga" | "pago_sem_data" | "vencida";

/** Uma parcela pronta para a tela: sem documento, sem nome, só o que o operador lê. */
export type ParcelaDaEntrada = {
  /** É a parcela que conta como a entrada (a primeira de Ato ou Sinal com valor). */
  contaComoEntrada: boolean;
  id: number;
  /** "Pago" sem `payment_date`: o dia veio da marcação (`updated_at`), decisão de 29/09. */
  pagaPelaMarcacao: boolean;
  /** O dia do pagamento (`AAAA-MM-DD`), quando paga. */
  pagoEm: null | string;
  /** "Ato", "Sinal 1/3", "Avulso". */
  rotulo: string;
  situacao: SituacaoDaParcela;
  tipo: "ato" | "avulso" | "sinal";
  /** Em reais. */
  valor: number;
  vencimento: null | string;
};

/** O que a leitura do pedido responde, já decidido. */
export type EntradaLida = {
  /** Os Avulso PAGOS do pedido, à parte: o time decide se contam como entrada (Lucas, 02/10/2026). */
  avulsosPagos: ParcelaDaEntrada[];
  /** A parcela que conta como entrada. `null` = o pedido não tem Ato nem Sinal com valor. */
  entrada: null | ParcelaDaEntrada;
  /** A entrada está paga (a parcela que conta, com o dia do pagamento). */
  paga: boolean;
  /** As parcelas de Ato e Sinal com valor, na ordem que responde "qual é a primeira". */
  parcelas: ParcelaDaEntrada[];
  /** O pedido está desfeito no C2X (estágio 7, 8, 10 ou 11): a tela avisa. */
  pedidoDesfeito: boolean;
  /** O pedido não tem NENHUMA parcela lançada no C2X (`totalDeParcelas === 0`): a tela diz isso. */
  semFinanceiro: boolean;
};

/**
 * O que o card recebe no campo `entrada` (só no hub, só no card de contrato em `prazo_legal`).
 *
 * ⚠️ O `motivo` VAI JUNTO PARA A TELA ESCOLHER A FRASE CERTA, e nenhum deles carrega dado de pessoa.
 * O número do pedido do C2X (`pedido`) não é dado pessoal: é o que o time procura lá.
 *
 * ⚠️ `fora_do_c2x` NÃO É FALHA NEM "SEM PEDIDO" (revisão de 02/10/2026): é a venda de um empreendimento
 * cujo financeiro mora no LSoft (o Garden, `EMPREENDIMENTOS_DO_LSOFT_NO_FINANCEIRO`). O C2X nem é
 * aberto, e a tela não manda ninguém digitar a venda lá.
 */
export type EntradaDoCard =
  | (EntradaLida & {
      pedido: number;
      /** Como a venda foi casada com o pedido (`elo.ts`). */
      regra: "envio_d4sign" | "origem_c2x_id" | "terreno_mesmo_comprador";
      situacao: "lida";
    })
  | {
      motivo: "dois_pedidos" | "sem_documento_no_panteon";
      situacao: "ambiguo";
    }
  | {
      /** O único candidato do comprador nasceu no C2X ANTES desta venda (o de uma proposta cancelada?). */
      motivo: "pedido_anterior_a_venda";
      pedido: number;
      situacao: "ambiguo";
    }
  | {
      motivo:
        | "carga_sem_pedido"
        | "pedido_de_outro_comprador"
        | "pedido_de_venda_desfeita"
        | "pedido_nao_achado_no_c2x"
        | "sem_pedido_no_c2x";
      situacao: "sem_pedido_no_c2x";
    }
  | {
      /** Nenhum pedido vivo do comprador, e um cancelado ou distratado dele nasceu depois da venda. */
      motivo: "pedido_desfeito_no_c2x";
      pedido: number;
      situacao: "sem_pedido_no_c2x";
    }
  | {
      motivo: "financeiro_no_lsoft";
      situacao: "fora_do_c2x";
    }
  | {
      motivo: "c2x" | "c2x_sem_configuracao" | "inesperada" | "panteon" | "tempo";
      situacao: "falhou";
    };

const DIA_VALIDO = /^\d{4}-\d{2}-\d{2}$/;
const diaValido = (dia: null | string | undefined): dia is string =>
  typeof dia === "string" && DIA_VALIDO.test(dia) && !Number.isNaN(Date.parse(`${dia}T12:00:00-03:00`));

/**
 * O dia (Brasília) em que a parcela foi marcada no C2X, ou `null`. ⚠️ PELA RÉGUA DA CASA
 * (`diaEmBrasilia`), a mesma da F8: 23:30 de 28/09 em Brasília é 02:30Z do dia 29, e um `slice`
 * sobre o UTC daria o dia seguinte.
 */
function diaDaMarcacao(marcadoEm: null | string): null | string {
  const dia = diaEmBrasilia(marcadoEm);
  return diaValido(dia) ? dia : null;
}

/** Valor que conta: maior que zero. `null` e texto ilegível contam como zero (não são entrada). */
const temValor = (p: ParcelaDoC2x) => typeof p.valor === "number" && Number.isFinite(p.valor) && p.valor > 0;

function rotuloDaParcela(p: ParcelaDoC2x): string {
  if (p.tipo === ATO) return "Ato";
  if (p.tipo === AVULSO) return "Avulso";
  const n = p.parcelaDoSinal ?? 0;
  const total = p.totalDoSinal ?? 0;
  return n > 0 && total > 0 ? `Sinal ${n}/${total}` : "Sinal";
}

const tipoNaTela = (tipo: number): ParcelaDaEntrada["tipo"] =>
  tipo === ATO ? "ato" : tipo === AVULSO ? "avulso" : "sinal";

/**
 * A parcela para a tela. `hoje` é o dia de Brasília (`AAAA-MM-DD`): é por ele que "em aberto" vira
 * "vencida".
 *
 * Paga = status 5 E um dia: a `payment_date` ou, sem ela, o dia em que a parcela foi marcada.
 * ⚠️ DECISÃO DO LUCAS, 29/09/2026: *"Ato Pago sem data: usa a data em que foi marcado"*. O
 * `updated_at` muda com qualquer outra edição da parcela, então o dia pode sair DEPOIS da baixa,
 * nunca antes. Status 7 com `paid_value` pré-preenchido pelo Asaas e sem data NÃO é pago (o caso do
 * REP D L163: R$ 1.000 "pago" no campo e Atrasado no status).
 */
function paraATela(p: ParcelaDoC2x, hoje: string, contaComoEntrada: boolean): ParcelaDaEntrada {
  const base = {
    contaComoEntrada,
    id: p.id,
    rotulo: rotuloDaParcela(p),
    tipo: tipoNaTela(p.tipo),
    valor: Math.round((p.valor ?? 0) * 100) / 100,
    vencimento: diaValido(p.vencimento) ? p.vencimento : null,
  };
  if (p.status === PAGO) {
    if (diaValido(p.pagoEm)) return { ...base, pagaPelaMarcacao: false, pagoEm: p.pagoEm, situacao: "paga" };
    const marcado = diaDaMarcacao(p.marcadoEm);
    if (marcado) return { ...base, pagaPelaMarcacao: true, pagoEm: marcado, situacao: "paga" };
    return { ...base, pagaPelaMarcacao: false, pagoEm: null, situacao: "pago_sem_data" };
  }
  // ⚠️ "VENCIDA" PELO CALENDÁRIO, E O ATRASADO DO C2X TAMBÉM VALE: a rotina que marca o 7 lá roda
  // uma vez por dia, e a parcela que venceu ontem pode ainda estar "Aguardando".
  const vencida = (base.vencimento !== null && base.vencimento < hoje) || p.status === ATRASADO;
  return { ...base, pagaPelaMarcacao: false, pagoEm: null, situacao: vencida ? "vencida" : "em_aberto" };
}

/** Viva no C2X: não apagada e no recorte ativo (5, 6, 7). */
const viva = (p: ParcelaDoC2x) => !p.apagada && p.status !== null && STATUS_ATIVOS.has(p.status);

/**
 * A ENTRADA DO PEDIDO.
 *
 * As parcelas da entrada são Ato e Sinal vivos COM VALOR, por vencimento, Ato antes de Sinal no
 * empate, depois o número do sinal e o id. A que conta é a primeira: "à vista integral" é a única,
 * "parcelado" é a primeira pelo vencimento (Lucas, `docs/operations/temis-redesenho-decisoes.md`:
 * *"se for à vista integral, se for parcelado a primeira parcela (data de vencimento)"*).
 *
 * Os Avulso vêm só os PAGOS e com valor, à parte, pelo dia do pagamento.
 */
export function situacaoDaEntrada(pedido: PedidoDoC2x, hoje: string): EntradaLida {
  const vencimento = (p: ParcelaDoC2x) => (diaValido(p.vencimento) ? p.vencimento : "9999-12-31");
  const daEntrada = pedido.parcelas
    .filter((p) => (p.tipo === ATO || p.tipo === SINAL) && viva(p) && temValor(p))
    .sort(
      (a, b) =>
        vencimento(a).localeCompare(vencimento(b)) ||
        a.tipo - b.tipo ||
        (a.parcelaDoSinal ?? 0) - (b.parcelaDoSinal ?? 0) ||
        a.id - b.id,
    );
  const parcelas = daEntrada.map((p, i) => paraATela(p, hoje, i === 0));
  const entrada = parcelas[0] ?? null;

  const avulsosPagos = pedido.parcelas
    .filter((p) => p.tipo === AVULSO && !p.apagada && p.status === PAGO && temValor(p))
    .map((p) => paraATela(p, hoje, false))
    .sort((a, b) => String(a.pagoEm ?? "9999-12-31").localeCompare(String(b.pagoEm ?? "9999-12-31")) || a.id - b.id);

  return {
    avulsosPagos,
    entrada,
    paga: entrada?.situacao === "paga",
    parcelas,
    pedidoDesfeito: pedido.estagio !== null && ESTAGIOS_DESFEITOS_NO_C2X.has(pedido.estagio),
    semFinanceiro: pedido.totalDeParcelas === 0,
  };
}
