import type { RowDataPacket } from "mysql2/promise";

import { getGuardianDbPool } from "@/lib/guardian/db";

type PaymentRow = RowDataPacket & {
  asaas_payment_id: string | null;
  invoice_url: string | null;
  payment_url: string | null;
};

type AsaasViewingResponse = {
  boletoViewedDate?: string | null;
  bankSlipViewed?: boolean;
  invoiceViewedDate?: string | null;
  invoiceViewed?: boolean;
  lastBankSlipViewedDate?: string | null;
  lastInvoiceViewedDate?: string | null;
};

export type PaymentViewingInfo = {
  available: boolean;
  hasBoleto: boolean;
  lastViewedAt?: string;
  source?: "boleto" | "fatura";
  viewed: boolean;
};

export type BoletoResendMode = "asaas" | "link";

export type BoletoResendAction = {
  asaasPaymentId?: string;
  boletoUrl?: string;
  deliveryMode: BoletoResendMode;
  faturaUrl?: string;
  message: string;
  paymentId: string;
  providerAction: "asaas-notification-unavailable" | "link-ready";
};

export async function loadPaymentViewingInfo(
  paymentId: string,
): Promise<PaymentViewingInfo> {
  const payment = await loadPaymentAsaasReference(paymentId);

  if (!payment) {
    return {
      available: false,
      hasBoleto: false,
      viewed: false,
    };
  }

  const hasBoleto = Boolean(payment.payment_url || payment.invoice_url);

  if (!hasBoleto || !payment.asaas_payment_id) {
    return {
      available: Boolean(payment.asaas_payment_id),
      hasBoleto,
      viewed: false,
    };
  }

  const apiKey = process.env.ASAAS_API_KEY?.trim();

  if (!apiKey) {
    return {
      available: false,
      hasBoleto,
      viewed: false,
    };
  }

  const response = await fetch(
    `${asaasBaseUrl()}/v3/payments/${encodeURIComponent(payment.asaas_payment_id)}/viewingInfo`,
    {
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Careli Guardian",
        access_token: apiKey,
      },
      method: "GET",
    },
  );

  if (!response.ok) {
    return {
      available: false,
      hasBoleto,
      viewed: false,
    };
  }

  const data = (await response.json().catch(() => null)) as
    | AsaasViewingResponse
    | null;
  const invoiceDate = normalizeAsaasDate(
    data?.invoiceViewedDate ?? data?.lastInvoiceViewedDate,
  );
  const bankSlipDate = normalizeAsaasDate(
    data?.boletoViewedDate ?? data?.lastBankSlipViewedDate,
  );
  const lastViewedAt = newestDate(invoiceDate, bankSlipDate);

  return {
    available: true,
    hasBoleto,
    lastViewedAt: lastViewedAt?.value,
    source:
      lastViewedAt?.source ??
      (data?.invoiceViewed || data?.invoiceViewedDate
        ? "fatura"
        : data?.bankSlipViewed || data?.boletoViewedDate
          ? "boleto"
          : undefined),
    viewed: Boolean(
      data?.invoiceViewed ||
        data?.bankSlipViewed ||
        data?.invoiceViewedDate ||
        data?.boletoViewedDate ||
        lastViewedAt,
    ),
  };
}

export async function prepareBoletoResendAction(
  paymentId: string,
  mode: BoletoResendMode = "link",
): Promise<BoletoResendAction> {
  const payment = await loadPaymentAsaasReference(paymentId);

  if (!payment) {
    throw new Error("Parcela nao encontrada no C2X.");
  }

  const boletoUrl = firstFilled(payment.payment_url);

  if (!boletoUrl) {
    throw new Error("Esta parcela nao possui link de boleto no C2X.");
  }

  if (mode === "asaas") {
    return {
      asaasPaymentId: firstFilled(payment.asaas_payment_id),
      boletoUrl,
      deliveryMode: mode,
      message:
        "O link do boleto esta pronto, mas o disparo manual pelo Asaas ainda precisa de endpoint oficial confirmado. Use o link pelo CareDesk enquanto a integracao nativa nao estiver liberada.",
      paymentId,
      providerAction: "asaas-notification-unavailable",
    };
  }

  return {
    asaasPaymentId: firstFilled(payment.asaas_payment_id),
    boletoUrl,
    deliveryMode: mode,
    message:
      "Link do boleto pronto para reenvio pelo CareDesk. Confirme os dados do cliente antes do disparo.",
    paymentId,
    providerAction: "link-ready",
  };
}

async function loadPaymentAsaasReference(
  paymentId: string,
): Promise<PaymentRow | null> {
  const poolResult = getGuardianDbPool();

  if (!poolResult.ok) {
    return null;
  }

  const [rows] = await poolResult.pool.query<PaymentRow[]>(
    `
      select
        p.payment_asaas_id as asaas_payment_id,
        p.payment_asaas_invoice_url as invoice_url,
        p.payment_asaas_url as payment_url
      from payments p
      where p.id = ?
      limit 1
    `,
    [paymentId],
  );

  return rows[0] ?? null;
}

function asaasBaseUrl() {
  return process.env.ASAAS_API_BASE_URL?.trim() || "https://api.asaas.com";
}

function firstFilled(...values: Array<string | null | undefined>) {
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find(Boolean);
}

function normalizeAsaasDate(value?: string | null) {
  if (!value) {
    return undefined;
  }

  return value.replace(" ", "T");
}

function newestDate(
  invoiceDate?: string,
  bankSlipDate?: string,
): { source: "boleto" | "fatura"; value: string } | undefined {
  const dates = [
    invoiceDate ? { source: "fatura" as const, value: invoiceDate } : null,
    bankSlipDate ? { source: "boleto" as const, value: bankSlipDate } : null,
  ].filter(Boolean) as Array<{ source: "boleto" | "fatura"; value: string }>;

  return dates.sort(
    (first, second) =>
      new Date(second.value).getTime() - new Date(first.value).getTime(),
  )[0];
}
