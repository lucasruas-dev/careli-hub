import { lerReferencia } from "@/lib/apolo/boletos/emissao";

// O QUE O ASAAS DIZ SOBRE UMA COBRANÇA, VIRANDO LINHA NOSSA.
//
// Lucas (22/09/2026): *"vamos trazer essa informacoes de pago para dentro do panteon, nao faz
// sentido"* e *"esses status tem que ser registrados via webhook, temos que começar ter uma
// inteligência de gestão de notificação e atualização"*.
//
// ⚠️ A MESMA RÉGUA PARA OS DOIS CAMINHOS, e é por isso que ela mora aqui e não dentro da rota. O
// estado chega de duas portas — o webhook (o Asaas avisa) e a varredura por competência (nós
// perguntamos) — e as duas gravam na MESMA tabela. Régua duplicada em duas rotas é régua que vai
// divergir: a varredura marcaria como pago o que o webhook marcou como devolvido, e a última a
// rodar venceria.
//
// ⚠️ O QUE É "PAGO" ESTÁ ESCRITO POR EXTENSO, E NÃO É `valor_pago > 0`. O Asaas tem estado para
// dinheiro que entrou e voltou (`REFUNDED`), para dinheiro contestado (`CHARGEBACK_REQUESTED`) e
// para confirmação que ainda não virou saldo (`CONFIRMED`). Quem ler valor para decidir quitação
// marca como paga uma parcela devolvida — e no LSoft isso vira uma dívida que some.

/** Os status do Asaas em que o dinheiro do cliente ENTROU e continua nosso. */
const PAGOS = new Set([
  // Confirmado pela instituição, ainda não liberado na conta. Para o cliente, está pago.
  "CONFIRMED",
  // Dinheiro em conta.
  "RECEIVED",
  // Recebido em dinheiro, marcado à mão no painel do Asaas.
  "RECEIVED_IN_CASH",
]);

/**
 * Status em que o dinheiro SAIU depois de ter entrado, ou está em disputa.
 *
 * ⚠️ NÃO É O MESMO QUE "não pago": a parcela chegou a ser quitada, e quem conciliar precisa saber
 * disso. Estes nunca podem cair no balde de pago, e também não devem sumir da conciliação.
 */
const DESFEITOS = new Set([
  "CHARGEBACK_DISPUTE",
  "CHARGEBACK_REQUESTED",
  "REFUNDED",
  "REFUND_IN_PROGRESS",
  "REFUND_REQUESTED",
]);

export function estaPago(situacao: null | string | undefined): boolean {
  return PAGOS.has(String(situacao ?? "").trim().toUpperCase());
}

export function foiDesfeito(situacao: null | string | undefined): boolean {
  return DESFEITOS.has(String(situacao ?? "").trim().toUpperCase());
}

/** A cobrança como o Asaas a entrega, na listagem e no corpo do webhook. */
export type CobrancaDoAsaas = {
  billingType?: null | string;
  clientPaymentDate?: null | string;
  dueDate?: null | string;
  externalReference?: null | string;
  id?: null | string;
  paymentDate?: null | string;
  status?: null | string;
  value?: null | number | string;
};

/** A linha de `boletos_pagamentos`, pronta para o upsert. */
export type PagamentoParaGravar = {
  cobranca_id: string;
  competencia: string;
  conta: string;
  empreendimento: string;
  forma: null | string;
  pago_em: null | string;
  pago_em_informado: null | string;
  referencia: string;
  sequencia: number;
  situacao: string;
  unidade: string;
  valor_cobrado: number;
  valor_pago: null | number;
  vencimento: string;
  workspace_id: string;
};

const texto = (v: unknown): null | string => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

/** 'YYYY-MM-DD' ou nada. O Asaas manda data pura nesses campos; hora nunca entra. */
const dia = (v: unknown): null | string => {
  const s = texto(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

const numero = (v: unknown): null | number => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/**
 * Converte uma cobrança do Asaas na linha da tabela — ou devolve `null` quando ela não é nossa.
 *
 * ⚠️ SÓ COBRANÇA COM REFERÊNCIA `boleto:` ENTRA. As contas do Garden e do Vale do Sol têm cobranças
 * que não saíram desta tela (carnê antigo, cobrança avulsa feita no painel), e engoli-las aqui
 * encheria a conciliação de linhas sem parcela correspondente. A referência é o que prova a origem.
 *
 * ⚠️ E SEM `id` OU SEM VENCIMENTO NÃO GRAVA. Os dois são NOT NULL na tabela, e uma linha sem
 * identidade não pode ser atualizada na próxima rodada — viraria duplicata a cada sincronização.
 */
export function pagamentoDoAsaas(
  cobranca: CobrancaDoAsaas,
  contexto: { conta: string; workspace?: string },
): null | PagamentoParaGravar {
  const cobrancaId = texto(cobranca.id);
  const referencia = texto(cobranca.externalReference);
  const lida = lerReferencia(referencia);
  const vencimento = dia(cobranca.dueDate);
  const valor = numero(cobranca.value);

  if (!cobrancaId || !referencia || !lida || !vencimento || valor === null) return null;

  const situacao = String(cobranca.status ?? "").trim().toUpperCase() || "DESCONHECIDO";
  const pago = estaPago(situacao);

  return {
    cobranca_id: cobrancaId,
    competencia: lida.competencia,
    conta: contexto.conta,
    empreendimento: lida.empreendimento,
    forma: texto(cobranca.billingType),
    // ⚠️ A DATA SÓ EXISTE SE PAGOU. O Asaas mantém `paymentDate` preenchido depois de um estorno, e
    // gravá-la num status devolvido faria a conciliação ler "pago em 05/09" numa parcela em aberto.
    pago_em: pago ? dia(cobranca.paymentDate) : null,
    pago_em_informado: pago ? dia(cobranca.clientPaymentDate) : null,
    referencia,
    sequencia: lida.sequencia,
    situacao,
    unidade: lida.unidade,
    valor_cobrado: valor,
    valor_pago: pago ? (numero(cobranca.value) ?? null) : null,
    vencimento,
    workspace_id: contexto.workspace ?? "careli",
  };
}

/**
 * O que mudou entre o que estava guardado e o que chegou agora.
 *
 * ⚠️ EXISTE PARA A NOTIFICAÇÃO, e é o começo da "gestão de notificação" que o Lucas pediu: avisar
 * a cada webhook recebido seria ruído (o Asaas reenvia o mesmo evento quando não recebe 200), e
 * avisar só quando o estado MUDA é o que faz a mensagem valer alguma coisa.
 */
export function mudouDeEstado(
  antes: null | undefined | { situacao: string },
  agora: { situacao: string },
): boolean {
  if (!antes) return true;
  return antes.situacao !== agora.situacao;
}
