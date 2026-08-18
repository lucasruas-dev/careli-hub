import type { ApoloUnitInstallment } from "@/lib/apolo/carteira";

// A ALLOWLIST DAS PARCELAS DO PORTAL — o que /api/incorporador/parcelas deixa atravessar.
//
// Pedido do Lucas (18/08/2026): *"temos que trazer o contrato e nas parcelas dentro de carteira o
// link do boleto do asaas"*. Até essa data o link de boleto era OMITIDO de propósito (a decisão
// estava em aberto); esta é a ordem que o libera, e é a segunda metade do pedido — a primeira é a
// coluna Contrato.
//
// QUAL LINK VAI, medido no C2X em 18/08/2026 (106.996 payments, 3.013 com Asaas):
//   • `payment_asaas_url`          → https://www.asaas.com/i/<id>      (a FATURA: boleto + PIX +
//     cartão numa página; depois de paga vira o comprovante);
//   • `payment_asaas_invoice_url`  → https://www.asaas.com/b/pdf/<id>  (só o PDF do boleto).
//   Os dois andam SEMPRE juntos (3.013 preenchidos ambos, 0 só um). O C2X e o Hub interno
//   (empreendimentos-view, InstallmentsCard do Hades, Iris/CACÁ) mostram a FATURA como
//   "Fatura/Boleto" — é ela que continua útil depois do pagamento. Então `boletoUrl` = a fatura,
//   com o PDF cru só de fallback, e o outro campo NÃO viaja: um link por parcela basta.
//
// ⚠️ Continua sendo allowlist CAMPO A CAMPO: repassar o objeto inteiro é proibido aqui — o dia em
// que `loadApoloUnitInstallments` ganhar um campo novo (id Asaas, telefone, o que for), ele NÃO
// pode nascer vazando no portal.

export type ParcelaDoPortal = {
  amount: number;
  /** O link de Fatura/Boleto do Asaas (ordem do Lucas, 18/08/2026). `null` = parcela sem boleto. */
  boletoUrl: null | string;
  competence: null | string;
  dueDate: null | string;
  id: string;
  number: string;
  overdueDays: number;
  paidAmount: number;
  paidAt: null | string;
  status: ApoloUnitInstallment["status"];
  type: null | string;
};

/** Mapeia UMA parcela interna para o payload do portal. Só o que está no tipo sai daqui. */
export function parcelaParaOPortal(parcela: ApoloUnitInstallment): ParcelaDoPortal {
  return {
    amount: parcela.amount,
    // A fatura primeiro (é o que o C2X mostra como "Fatura/Boleto"); o PDF cru só se ela faltar.
    // Nos dados reais os dois vêm juntos, mas o fallback evita sumir com um boleto antigo.
    boletoUrl: parcela.paymentUrl ?? parcela.invoiceUrl,
    competence: parcela.competence,
    dueDate: parcela.dueDate,
    id: parcela.id,
    number: parcela.number,
    overdueDays: parcela.overdueDays,
    paidAmount: parcela.paidAmount,
    paidAt: parcela.paidAt,
    status: parcela.status,
    type: parcela.type,
  };
}
