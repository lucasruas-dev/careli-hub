import type { RowDataPacket } from "mysql2/promise";

import {
  createGuardianMotorClient,
  todayDateOnly,
  type GuardianCompromissoKind,
  type GuardianCompromissoStatus,
  type GuardianLembreteKind,
  type GuardianMotorClient,
  type GuardianParcelaStatus,
} from "@/lib/guardian/compromissos";
import { getHadesDbPool } from "@/lib/guardian/db";
import {
  getMetaWhatsAppOutboundConfig,
  MetaWhatsAppSendError,
  sendMetaWhatsAppTemplateMessage,
} from "@/lib/iris/meta-whatsapp";

// Regua de lembretes — cron DIARIO (1x/dia, sem polling novo: consciencia de
// custo). Pega os lembretes pendentes com scheduled_for <= hoje, confere no C2X
// legado se a parcela ja foi paga (se sim: marca paga + cancela o lembrete) e,
// caso contrario, dispara o template Meta aprovado pelo WhatsApp da Iris.
//
// Idempotente: so processa status='pendente' e move cada lembrete para enviado/
// falhou/cancelado, entao reexecucoes nao reenviam. A criacao ja e protegida
// pelo unique (compromisso, parcela, kind) NULLS NOT DISTINCT da migration 0036.

const MAX_LEMBRETES_PER_RUN = 500;
const DEFAULT_META_TEMPLATE = "cobranca_geral";
const DEFAULT_META_LANGUAGE = "pt_BR";
// Status do C2X legado: 5 = Liquidada (paga). Mesma semantica de attendance.ts.
const C2X_PAID_STATUS_ID = 5;

type LembreteRowFull = {
  channel: string;
  compromisso_id: string;
  id: string;
  kind: GuardianLembreteKind;
  meta_template: string | null;
  parcela_id: string | null;
  scheduled_for: string;
};

type CompromissoLite = {
  client_c2x_id: number | string;
  id: string;
  kind: GuardianCompromissoKind;
  metadata: Record<string, unknown> | null;
  promised_date: string | null;
  protocol: string;
  status: GuardianCompromissoStatus;
};

type ParcelaLite = {
  amount: number | string;
  compromisso_id: string;
  due_date: string;
  id: string;
  payment_c2x_id: number | string | null;
  status: GuardianParcelaStatus;
};

type C2xPaymentRow = RowDataPacket & {
  id: number;
  payment_date: Date | string | null;
  payment_status_id: number | null;
};

export type ReguaCronResult = {
  cancelled: number;
  error?: string;
  failed: number;
  ok: boolean;
  paid: number;
  processed: number;
  sent: number;
  skipped: number;
};

export async function runGuardianReguaCron(
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<ReguaCronResult> {
  const result: ReguaCronResult = {
    cancelled: 0,
    failed: 0,
    ok: true,
    paid: 0,
    processed: 0,
    sent: 0,
    skipped: 0,
  };

  const client = createGuardianMotorClient();

  if (!client) {
    return {
      ...result,
      error: "Configure a chave server-side do Supabase para rodar a regua.",
      ok: false,
    };
  }

  const today = todayDateOnly(options.now);

  const { data: lembretes, error: lembretesError } = await client
    .from("guardian_compromisso_lembretes")
    .select("id,compromisso_id,parcela_id,kind,scheduled_for,channel,meta_template")
    .eq("status", "pendente")
    .lte("scheduled_for", today)
    .order("scheduled_for", { ascending: true })
    .limit(MAX_LEMBRETES_PER_RUN)
    .returns<LembreteRowFull[]>();

  if (lembretesError) {
    return { ...result, error: "Falha ao carregar a fila de lembretes.", ok: false };
  }

  if (!lembretes?.length) {
    return result;
  }

  const compromissoIds = unique(lembretes.map((row) => row.compromisso_id));
  const [compromissos, parcelas] = await Promise.all([
    loadCompromissos(client, compromissoIds),
    loadParcelas(client, compromissoIds),
  ]);

  const parcelasByCompromisso = groupBy(parcelas, (row) => row.compromisso_id);
  const parcelaById = new Map(parcelas.map((row) => [row.id, row]));
  const paidByPaymentId = await loadC2xPaidStatuses(
    parcelas
      .map((row) => toNullableNumber(row.payment_c2x_id))
      .filter((value): value is number => value !== null),
  );

  for (const lembrete of lembretes) {
    result.processed += 1;

    const compromisso = compromissos.get(lembrete.compromisso_id);

    if (!compromisso) {
      await cancelLembrete(client, lembrete.id, "compromisso inexistente");
      result.cancelled += 1;
      continue;
    }

    // Compromisso ja resolvido (cumprido/quebrado/cancelado): nao lembra mais.
    if (compromisso.status !== "ativo") {
      await cancelLembrete(client, lembrete.id, `compromisso ${compromisso.status}`);
      result.cancelled += 1;
      continue;
    }

    // Promessa: parcela unica do compromisso. Acordo: a parcela do lembrete.
    const parcela =
      compromisso.kind === "promessa"
        ? parcelasByCompromisso.get(compromisso.id)?.[0]
        : lembrete.parcela_id
          ? parcelaById.get(lembrete.parcela_id)
          : undefined;

    // Pagamento confirmado no C2X -> liquida e encerra a regua daquela parcela.
    if (parcela && isParcelaPaid(parcela, paidByPaymentId)) {
      if (!options.dryRun) {
        await markParcelaPaid(client, parcela);
        await cancelParcelaLembretes(client, compromisso, parcela);
        await maybeFulfillCompromisso(client, compromisso.id);
      }

      result.paid += 1;
      continue;
    }

    const phone = resolvePhone(compromisso);

    if (!phone) {
      if (!options.dryRun) {
        await failLembrete(client, lembrete.id, "cliente sem telefone");
      }

      result.failed += 1;
      continue;
    }

    if (options.dryRun) {
      result.sent += 1;
      continue;
    }

    try {
      const sendResult = await sendMetaWhatsAppTemplateMessage({
        bodyParameters: buildTemplateParams(compromisso, parcela),
        config: getMetaWhatsAppOutboundConfig(),
        language: metaLanguage(),
        name: lembrete.meta_template?.trim() || metaTemplateName(),
        to: phone,
      });

      await client
        .from("guardian_compromisso_lembretes")
        .update({
          message_id: sendResult.messageId,
          metadata: {
            sent_to: phone,
            template: lembrete.meta_template?.trim() || metaTemplateName(),
          },
          sent_at: new Date().toISOString(),
          status: "enviado",
        })
        .eq("id", lembrete.id);

      result.sent += 1;
    } catch (error) {
      const reason =
        error instanceof MetaWhatsAppSendError
          ? error.message
          : "falha ao enviar template";

      await failLembrete(client, lembrete.id, reason);
      result.failed += 1;
    }
  }

  return result;
}

// --- C2X legado: confirmacao de pagamento ---

async function loadC2xPaidStatuses(
  paymentIds: number[],
): Promise<Map<number, boolean>> {
  const map = new Map<number, boolean>();
  const ids = unique(paymentIds);

  if (ids.length === 0) {
    return map;
  }

  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    // Sem C2X configurado (preview/local): trata como nao-pago para nao
    // suprimir lembrete por engano.
    return map;
  }

  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await poolResult.pool.query<C2xPaymentRow[]>(
    `
      select p.id, p.payment_status_id, p.payment_date
      from payments p
      where p.id in (${placeholders})
    `,
    ids,
  );

  for (const row of rows) {
    const paid =
      Number(row.payment_status_id) === C2X_PAID_STATUS_ID ||
      row.payment_date !== null;

    map.set(Number(row.id), paid);
  }

  return map;
}

function isParcelaPaid(
  parcela: ParcelaLite,
  paidByPaymentId: Map<number, boolean>,
) {
  if (parcela.status === "paga") {
    return true;
  }

  const paymentId = toNullableNumber(parcela.payment_c2x_id);

  if (paymentId === null) {
    return false;
  }

  return paidByPaymentId.get(paymentId) === true;
}

// --- Mutacoes do motor ---

async function markParcelaPaid(
  client: GuardianMotorClient,
  parcela: ParcelaLite,
) {
  if (parcela.status === "paga") {
    return;
  }

  await client
    .from("guardian_compromisso_parcelas")
    .update({ paid_at: new Date().toISOString(), status: "paga" })
    .eq("id", parcela.id);
}

async function cancelParcelaLembretes(
  client: GuardianMotorClient,
  compromisso: CompromissoLite,
  parcela: ParcelaLite,
) {
  // Promessa usa parcela_id null; acordo usa o id da parcela.
  let query = client
    .from("guardian_compromisso_lembretes")
    .update({ status: "cancelado" })
    .eq("compromisso_id", compromisso.id)
    .eq("status", "pendente");

  query =
    compromisso.kind === "promessa"
      ? query.is("parcela_id", null)
      : query.eq("parcela_id", parcela.id);

  await query;
}

async function maybeFulfillCompromisso(
  client: GuardianMotorClient,
  compromissoId: string,
) {
  const { data: parcelas } = await client
    .from("guardian_compromisso_parcelas")
    .select("status")
    .eq("compromisso_id", compromissoId)
    .returns<{ status: GuardianParcelaStatus }[]>();

  if (!parcelas?.length) {
    return;
  }

  const allSettled = parcelas.every(
    (parcela) => parcela.status === "paga" || parcela.status === "cancelada",
  );
  const anyPaid = parcelas.some((parcela) => parcela.status === "paga");

  if (!allSettled || !anyPaid) {
    return;
  }

  await client
    .from("guardian_compromissos")
    .update({ fulfilled_at: new Date().toISOString(), status: "cumprido" })
    .eq("id", compromissoId);

  await client
    .from("guardian_compromisso_lembretes")
    .update({ status: "cancelado" })
    .eq("compromisso_id", compromissoId)
    .eq("status", "pendente");
}

async function cancelLembrete(
  client: GuardianMotorClient,
  lembreteId: string,
  reason: string,
) {
  await client
    .from("guardian_compromisso_lembretes")
    .update({ failure_reason: reason, status: "cancelado" })
    .eq("id", lembreteId);
}

async function failLembrete(
  client: GuardianMotorClient,
  lembreteId: string,
  reason: string,
) {
  await client
    .from("guardian_compromisso_lembretes")
    .update({ failure_reason: reason.slice(0, 280), status: "falhou" })
    .eq("id", lembreteId);
}

// --- Loaders ---

async function loadCompromissos(
  client: GuardianMotorClient,
  ids: string[],
): Promise<Map<string, CompromissoLite>> {
  const map = new Map<string, CompromissoLite>();

  if (ids.length === 0) {
    return map;
  }

  const { data } = await client
    .from("guardian_compromissos")
    .select("id,client_c2x_id,kind,status,protocol,promised_date,metadata")
    .in("id", ids)
    .returns<CompromissoLite[]>();

  for (const row of data ?? []) {
    map.set(row.id, row);
  }

  return map;
}

async function loadParcelas(
  client: GuardianMotorClient,
  compromissoIds: string[],
): Promise<ParcelaLite[]> {
  if (compromissoIds.length === 0) {
    return [];
  }

  const { data } = await client
    .from("guardian_compromisso_parcelas")
    .select("id,compromisso_id,due_date,amount,status,payment_c2x_id")
    .in("compromisso_id", compromissoIds)
    .order("sequence", { ascending: true })
    .returns<ParcelaLite[]>();

  return data ?? [];
}

// --- Template / telefone ---

function resolvePhone(compromisso: CompromissoLite): string | null {
  const metadata = compromisso.metadata ?? {};
  const candidate =
    stringFromRecord(metadata, "phone") ??
    stringFromRecord(metadata, "client_phone") ??
    stringFromRecord(metadata, "telefone");

  return normalizePhone(candidate);
}

function buildTemplateParams(
  compromisso: CompromissoLite,
  parcela: ParcelaLite | undefined,
): string[] {
  // {{1}} nome, {{2}} valor, {{3}} vencimento. Deve casar com o template Meta
  // aprovado (ver GUARDIAN_REGUA_META_TEMPLATE). Ajustar se o template diferir.
  const name =
    stringFromRecord(compromisso.metadata ?? {}, "client_name") ?? "Cliente";
  const amount = parcela ? toNumber(parcela.amount) : 0;
  const dueDate = parcela?.due_date ?? compromisso.promised_date ?? "";

  return [firstName(name), formatBrl(amount), formatBrDate(dueDate)];
}

function metaTemplateName() {
  return process.env.GUARDIAN_REGUA_META_TEMPLATE?.trim() || DEFAULT_META_TEMPLATE;
}

function metaLanguage() {
  return process.env.GUARDIAN_REGUA_META_LANGUAGE?.trim() || DEFAULT_META_LANGUAGE;
}

// --- Util ---

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] ?? value;
}

function formatBrl(value: number) {
  return value.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

function formatBrDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const [year, month, day] = value.split("-");

  return `${day}/${month}/${year}`;
}

function normalizePhone(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, "");

  return digits.length >= 10 ? digits : null;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function groupBy<T, K>(values: T[], keyFn: (value: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();

  for (const value of values) {
    const key = keyFn(value);
    const list = map.get(key) ?? [];

    list.push(value);
    map.set(key, list);
  }

  return map;
}

function stringFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toNumber(value: number | string | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}
