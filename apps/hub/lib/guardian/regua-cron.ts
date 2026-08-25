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
  /** pendente | aprovado | reprovado. É a trava: proposta não aprovada NÃO manda mensagem. */
  approval_status: null | string;
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

  // ⚠️ A CONCILIACAO SAI DE DENTRO DO LACO DE LEMBRETES. Ela vivia la dentro, entao quando os 7
  // lembretes morreram em "falhou" (por causa do telefone) o cron passou a retornar aqui e a baixa
  // de pagamento parou junto — sem ninguem perceber. Medido em 25/08/2026: 2 parcelas ja
  // LIQUIDADAS no C2X seguiam "pendente" ha 48 dias, as promessas ficavam "ativo" para sempre e o
  // indicador de recuperacao era zero por construcao.
  //
  // Dar baixa em parcela paga nao depende de lembrete nenhum: e leitura do C2X contra o que esta
  // aberto. Roda antes, sempre.
  result.paid += await conciliarPagamentos(client, options);

  if (!lembretes?.length) {
    return result;
  }

  const compromissoIds = unique(lembretes.map((row) => row.compromisso_id));
  const [compromissos, parcelas] = await Promise.all([
    loadCompromissos(client, compromissoIds),
    loadParcelas(client, compromissoIds),
  ]);

  const telefonePorCliente = await loadTelefonesDaFila(
    client,
    unique([...compromissos.values()].map((c) => String(c.client_c2x_id))),
  );

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

    // ⚠️ TRAVA DE APROVACAO — E ELA QUE PRECISA VIR ANTES DO CONSERTO DO TELEFONE.
    // Ate 25/08/2026 a regua nunca entregou uma mensagem (7 de 7 lembretes morreram em "cliente
    // sem telefone"), e essa falha vinha mascarando outra coisa: o laco NAO conferia se a proposta
    // foi aprovada. Consertar so o telefone ligaria disparo de WhatsApp de proposta que ninguem
    // aprovou — o que e pior do que nao disparar nada.
    //
    // Aqui a decisao pendente PULA o lembrete (nao cancela): quando alguem aprovar, ele dispara na
    // proxima rodada. Reprovada, ai sim cancela: nao ha o que esperar.
    const aprovacao = String(compromisso.approval_status ?? "").trim().toLowerCase();
    if (aprovacao === "reprovado") {
      await cancelLembrete(client, lembrete.id, "proposta reprovada");
      result.cancelled += 1;
      continue;
    }
    if (aprovacao && aprovacao !== "aprovado") {
      result.skipped += 1;
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

    const phone = resolvePhone(compromisso, telefonePorCliente);

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

/**
 * Baixa as parcelas de compromisso que o C2X ja registra como pagas.
 *
 * Independe da regua: percorre o que esta EM ABERTO nos compromissos ativos, pergunta ao C2X quais
 * foram liquidadas e fecha o ciclo (parcela paga -> lembretes cancelados -> compromisso cumprido
 * quando todas fecham). Devolve quantas baixou.
 */
async function conciliarPagamentos(
  client: GuardianMotorClient,
  options: { dryRun?: boolean },
): Promise<number> {
  const { data: emAberto } = await client
    .from("guardian_compromisso_parcelas")
    .select("id,compromisso_id,amount,due_date,payment_c2x_id,sequence,status")
    .in("status", ["pendente", "emitida", "enviada"])
    .not("payment_c2x_id", "is", null)
    .limit(500)
    .returns<ParcelaLite[]>();

  if (!emAberto?.length) return 0;

  const compromissos = await loadCompromissos(
    client,
    unique(emAberto.map((linha) => linha.compromisso_id)),
  );

  const pagas = await loadC2xPaidStatuses(
    emAberto
      .map((linha) => toNullableNumber(linha.payment_c2x_id))
      .filter((valor): valor is number => valor !== null),
  );

  let baixadas = 0;
  for (const parcela of emAberto) {
    const compromisso = compromissos.get(parcela.compromisso_id);
    // Compromisso morto nao precisa de baixa: quem encerrou ja resolveu o ciclo.
    if (!compromisso || compromisso.status !== "ativo") continue;
    if (!isParcelaPaid(parcela, pagas)) continue;

    if (!options.dryRun) {
      await markParcelaPaid(client, parcela);
      await cancelParcelaLembretes(client, compromisso, parcela);
      await maybeFulfillCompromisso(client, compromisso.id);
    }
    baixadas += 1;
  }

  return baixadas;
}

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
    .select("id,client_c2x_id,kind,status,protocol,promised_date,metadata,approval_status")
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

// ⚠️ O TELEFONE QUASE NUNCA ESTA NO METADATA — e por isso a regua nunca entregou nada: 7 de 7
// lembretes morreram em "cliente sem telefone", falha TERMINAL (o cron so rele status 'pendente'),
// invisivel na tela do Hades, que seguia dizendo ao operador "aguardar a data prometida".
//
// A tela que cria o compromisso nao grava telefone nenhum no metadata; o numero vive no read-model
// da fila (`c2x_guardian_attendance_queue.phone`), que o sync alimenta a cada 15 min. Medido em
// 25/08/2026 nos 3 compromissos existentes: metadata sem telefone em 3 de 3, fila COM telefone em
// 3 de 3.
//
// A ordem de busca respeita quem sabe mais: o que foi digitado no compromisso ganha do que veio do
// cadastro, porque pode ser um numero que o cliente deu na conversa.
function resolvePhone(
  compromisso: CompromissoLite,
  telefonePorCliente?: Map<string, string>,
): string | null {
  const metadata = compromisso.metadata ?? {};
  const candidate =
    stringFromRecord(metadata, "phone") ??
    stringFromRecord(metadata, "client_phone") ??
    stringFromRecord(metadata, "telefone");

  const doMetadata = normalizePhone(candidate);
  if (doMetadata) return doMetadata;

  const daFila = telefonePorCliente?.get(String(compromisso.client_c2x_id));
  return normalizePhone(daFila ?? null);
}

/** Telefone da fila de cobranca, por cliente do C2X. Uma consulta por rodada, nao por lembrete. */
async function loadTelefonesDaFila(
  client: GuardianMotorClient,
  clientesC2x: string[],
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (clientesC2x.length === 0) return mapa;

  // Lotes de 100: `.in()` grande estoura a URL do PostgREST.
  for (let i = 0; i < clientesC2x.length; i += 100) {
    const { data } = await client
      .from("c2x_guardian_attendance_queue")
      .select("client_c2x_id,phone")
      .eq("is_current", true)
      .in("client_c2x_id", clientesC2x.slice(i, i + 100));

    // ⚠️ `as unknown as` de propósito: a coluna `phone` EXISTE em
    // c2x_guardian_attendance_queue (text, conferido no banco em 25/08/2026 e escrita por
    // read-model-sync.ts:321), mas os tipos gerados do Supabase estão defasados e não a conhecem.
    // O cast direto é recusado pelo TS por isso, não por o dado não existir.
    for (const linha of (data ?? []) as unknown as {
      client_c2x_id: number | string;
      phone: null | string;
    }[]) {
      const telefone = String(linha.phone ?? "").trim();
      if (telefone) mapa.set(String(linha.client_c2x_id), telefone);
    }
  }

  return mapa;
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
