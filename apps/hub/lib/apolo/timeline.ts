// Timeline do Apolo = a FICHA CORRIDA da entidade: agrega eventos de TODOS os módulos do
// Panteon num lugar só (Iris, Hades, Chronos + pagamentos do C2X). O Apolo é o centro; cada
// módulo é resolvido pela IDENTIDADE da entidade (c2xId ∪ telefones ∪ e-mails) — não só pelo
// c2xId, pra cobrir entidade que só existe no Apolo. Ver [[project_apolo_timeline]].
import type { RowDataPacket } from "mysql2";

import type { createApoloAdminClient } from "@/lib/apolo/server";
import { getHadesDbPool } from "@/lib/guardian/db";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type ApoloTimelineSource =
  | "chronos"
  | "hades"
  | "iris"
  | "manual"
  | "pagamento"
  | "venda";

export type ApoloTimelineEntry = {
  amount: number | null;
  // Autor, quando o registro tem responsável (manual = operador; automáticos = null).
  author: string | null;
  date: string; // ISO
  // true quando a fonte só tem a DATA (sem hora real) — ex.: pagamento no C2X. A UI não mostra
  // hora nesses (a "hora" seria artefato de fuso).
  dateOnly: boolean;
  description: string;
  id: string;
  // true = adicionado manualmente (pode ser editado/removido pelo operador).
  manual: boolean;
  reference: string | null;
  source: ApoloTimelineSource;
  status: "attention" | "blocked" | "info" | "ok";
  title: string;
};

export type ApoloTimelineData = {
  counts: Record<ApoloTimelineSource, number>;
  entries: ApoloTimelineEntry[];
};

export type ApoloTimelineScope = {
  adminClient: AdminClient;
  c2xId: number | null;
  emails: string[];
  entityId: string | null;
  phones: string[];
};

// E-mail de COLABORADOR nao identifica cliente. Quando o operador digita o proprio e-mail (ou
// um e-mail de equipe) no cadastro, casar por ele traz a vida do colaborador pra ficha do
// cliente: um prospect recem-criado apareceu com 200 reunioes internas de avaliacao de
// desempenho e atendimentos de teste da Iris, so porque o e-mail era @careli.adm.br.
const DOMINIO_INTERNO = /@careli\.adm\.br\s*$/i;

function somenteEmailsDeCliente(emails: string[]): string[] {
  return emails.filter((email) => email.trim() && !DOMINIO_INTERNO.test(email));
}

function agoraIso(): string {
  return new Date().toISOString();
}

export async function loadApoloEntityTimeline(
  scope: ApoloTimelineScope,
): Promise<
  { data: ApoloTimelineData; ok: true } | { error: string; ok: false }
> {
  try {
    // A identidade que agrega o historico ignora e-mail interno (ver acima).
    const escopo: ApoloTimelineScope = {
      ...scope,
      emails: somenteEmailsDeCliente(scope.emails),
    };

    const [pagamentos, vendas, iris, hades, chronos, manuais] = await Promise.all([
      loadPagamentos(escopo.c2xId),
      loadVendas(escopo.c2xId),
      loadIris(escopo),
      loadHades(escopo.adminClient, escopo.c2xId),
      loadChronos(escopo.adminClient, escopo.emails),
      loadManual(escopo.adminClient, escopo.entityId),
    ]);

    // Historico = o que JA ACONTECEU. Evento futuro e agenda, nao ficha corrida: uma reuniao
    // recorrente do Chronos chega a gerar ocorrencias ate 2087 e afogaria a ficha.
    const jaAconteceu = (entry: ApoloTimelineEntry) =>
      !entry.date || entry.date <= agoraIso();

    const entries = [
      ...pagamentos,
      ...vendas,
      ...iris,
      ...hades,
      ...chronos,
      ...manuais,
    ]
      .filter(jaAconteceu)
      .sort((a, b) => b.date.localeCompare(a.date));

    const counts: Record<ApoloTimelineSource, number> = {
      chronos: chronos.filter(jaAconteceu).length,
      hades: hades.filter(jaAconteceu).length,
      iris: iris.filter(jaAconteceu).length,
      manual: manuais.filter(jaAconteceu).length,
      pagamento: pagamentos.filter(jaAconteceu).length,
      venda: vendas.filter(jaAconteceu).length,
    };

    return { data: { counts, entries }, ok: true };
  } catch (error) {
    console.error("[apolo][timeline] falha ao montar timeline", error);
    return { error: "Nao foi possivel montar a timeline.", ok: false };
  }
}

// ---- Pagamentos (C2X / MySQL) --------------------------------------------------------------

type PaymentRow = RowDataPacket & {
  current_parcel: number | null;
  current_signal: number | null;
  due_day: string | null;
  enterprise_code: string | null;
  enterprise_name: string | null;
  initial_value: string | number | null;
  paid_value: string | number | null;
  parcel_type: string | null;
  payment_day: string | null;
  payment_id: number;
  status_id: number | null;
  total_parcels: number | null;
  total_signal: number | null;
  updated_day: string | null;
  updated_iso: string | null;
};

async function loadPagamentos(c2xId: number | null): Promise<ApoloTimelineEntry[]> {
  if (!c2xId || c2xId <= 0) {
    return [];
  }

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) {
    return [];
  }

  const [rows] = await poolResult.pool.query<PaymentRow[]>(
    `select
       p.id as payment_id,
       date_format(p.payment_date, '%Y-%m-%d') as payment_day,
       date_format(p.due_date, '%Y-%m-%d') as due_day,
       date_format(p.updated_at, '%Y-%m-%d') as updated_day,
       date_format(p.updated_at, '%Y-%m-%dT%H:%i:%s-03:00') as updated_iso,
       p.payment_status_id as status_id,
       p.paid_value, p.initial_value,
       pt.name as parcel_type,
       p.current_signal_parcel as current_signal, p.total_signal_parcels as total_signal,
       p.current_total_parcel as current_parcel, p.total_parcels,
       e.name as enterprise_name, e.code as enterprise_code
     from payments p
     join acquisition_requests ar on ar.id = p.acquisition_request_id
     join enterprise_unities eu on eu.id = ar.enterprise_unity_id
     join enterprises e on e.id = eu.enterprise_id
     join parcel_types pt on pt.id = p.parcel_type_id
     where ar.client_id = ?
       and (p.payment_to_delete is null or p.payment_to_delete = 0)
       and (p.payment_status_id = 5
            or (p.due_date < curdate() and p.payment_status_id not in (1, 2, 5)))
     order by coalesce(p.payment_date, p.due_date) desc
     limit 300`,
    [c2xId],
  );

  return rows.map((row) => {
    const paid = row.status_id === 5;
    const parcela = parcelaLabel(row);
    const enterprise = text(row.enterprise_name) ?? text(row.enterprise_code) ?? "Empreendimento";
    const detail = [text(row.parcel_type), parcela].filter(Boolean).join(" ");

    const day = (paid ? row.payment_day : row.due_day) ?? row.due_day ?? row.payment_day;
    // Hora REAL do pagamento = updated_at, MAS só quando ele cai no mesmo dia do pagamento
    // (é a confirmação do webhook do Asaas). Fora disso o C2X só tem a data (meio-dia neutro).
    const hasRealTime = paid && row.updated_iso != null && row.updated_day === row.payment_day;

    return {
      amount: toNumber(paid ? row.paid_value : row.initial_value),
      author: null,
      date: hasRealTime
        ? (row.updated_iso as string)
        : day
          ? `${day}T12:00:00-03:00`
          : "",
      dateOnly: !hasRealTime,
      description: `${detail ? `${detail} · ` : ""}${enterprise}`,
      id: `pagamento:${row.payment_id}`,
      manual: false,
      reference: null,
      source: "pagamento",
      status: paid ? "ok" : "blocked",
      // Perspectiva da entidade: aqui ela é a COMPRADORA (ligada por client_id), então FOI ELA
      // quem pagou -> "realizado". (Recebido seria a visão de quem recebe o split.)
      title: paid ? "Pagamento realizado" : "Parcela vencida",
    };
  });
}

function parcelaLabel(row: PaymentRow): string {
  const type = (text(row.parcel_type) ?? "").toLowerCase();
  if (type === "sinal") {
    return `${row.current_signal ?? "-"}/${row.total_signal ?? "-"}`;
  }
  if (type === "parcela") {
    return `${row.current_parcel ?? "-"}/${row.total_parcels ?? "-"}`;
  }
  return "";
}

// ---- Vendas (C2X / MySQL) ------------------------------------------------------------------

// Venda é um GRUPO/funil — cada marco (Reservado, Proposta, Contrato gerado, Em assinatura,
// Faturado, Finalizado, Cancelado, Distrato) é um evento datado, vindo do histórico de
// estágios da proposta no C2X (acquisition_request_historics).
type VendaRow = RowDataPacket & {
  block: string | null;
  enterprise_code: string | null;
  enterprise_name: string | null;
  hist_id: number;
  lot: string | null;
  occurred_at: Date | string | null;
  stage_id: number | null;
  stage_name: string | null;
};

// Estágios que sinalizam ruptura (viram status "blocked" — a UI hoje não usa cor de status,
// mas mantemos pra referência e futuro).
const VENDA_STAGE_BLOCKED = new Set([7, 8, 10, 11]);

async function loadVendas(c2xId: number | null): Promise<ApoloTimelineEntry[]> {
  if (!c2xId || c2xId <= 0) {
    return [];
  }

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) {
    return [];
  }

  const [rows] = await poolResult.pool.query<VendaRow[]>(
    `select
       min(arh.id) as hist_id,
       date_format(min(arh.created_at), '%Y-%m-%dT%H:%i:%s-03:00') as occurred_at,
       arh.new_acquisition_request_stage_id as stage_id,
       s.name as stage_name,
       e.name as enterprise_name, e.code as enterprise_code,
       eu.block, eu.lot
     from acquisition_request_historics arh
     join acquisition_requests ar on ar.id = arh.acquisition_request_id
     join enterprise_unities eu on eu.id = ar.enterprise_unity_id
     join enterprises e on e.id = eu.enterprise_id
     join acquisition_request_stages s on s.id = arh.new_acquisition_request_stage_id
     where ar.client_id = ?
     group by ar.id, arh.new_acquisition_request_stage_id, date(arh.created_at),
              s.name, e.name, e.code, eu.block, eu.lot
     order by occurred_at desc
     limit 300`,
    [c2xId],
  );

  return rows.map((row) => {
    const enterprise = text(row.enterprise_name) ?? text(row.enterprise_code) ?? "Empreendimento";
    const unit = [row.block ? `Q${row.block}` : null, row.lot ? `L${String(row.lot).replace(/^L/i, "")}` : null]
      .filter(Boolean)
      .join("·");

    return {
      amount: null,
      author: null,
      date: iso(row.occurred_at),
      dateOnly: false,
      description: `${unit ? `${unit} · ` : ""}${enterprise}`,
      id: `venda:${row.hist_id}`,
      manual: false,
      reference: null,
      source: "venda",
      status: VENDA_STAGE_BLOCKED.has(Number(row.stage_id)) ? "blocked" : "info",
      title: text(row.stage_name) ?? "Venda",
    };
  });
}

// ---- Iris (caredesk / Supabase) ------------------------------------------------------------

async function loadIris(scope: ApoloTimelineScope): Promise<ApoloTimelineEntry[]> {
  const filters: string[] = [];
  if (scope.c2xId) {
    filters.push(`c2x_user_id.eq.${scope.c2xId}`);
  }
  if (scope.emails.length) {
    filters.push(`email.in.(${scope.emails.map(csvQuote).join(",")})`);
  }
  if (scope.phones.length) {
    const phones = scope.phones.map(csvQuote).join(",");
    filters.push(`phone.in.(${phones})`);
    filters.push(`whatsapp_phone.in.(${phones})`);
  }
  if (!filters.length) {
    return [];
  }

  const { data: contacts } = await scope.adminClient
    .from("caredesk_contacts")
    .select("id")
    .or(filters.join(","));

  const contactIds = (contacts ?? []).map((row) => row.id as string);
  if (!contactIds.length) {
    return [];
  }

  const { data: tickets } = await scope.adminClient
    .from("caredesk_tickets")
    .select("id, protocol, subject, status, opened_at, created_at, resolved_at")
    .in("contact_id", contactIds)
    .order("opened_at", { ascending: false })
    .limit(200);

  return (tickets ?? []).map((ticket) => {
    const status = String(ticket.status ?? "");
    const resolved = /resolv|fechad|closed|conclu/i.test(status);

    return {
      amount: null,
      author: null,
      date: iso((ticket.opened_at ?? ticket.created_at) as string | null),
      dateOnly: false,
      description: `Atendimento · ${text(ticket.subject as string) ?? statusLabel(status)}`,
      id: `iris:${ticket.id}`,
      manual: false,
      reference: text(ticket.protocol as string),
      source: "iris",
      status: resolved ? "ok" : "attention",
      title: "Atendimento na Iris",
    };
  });
}

// ---- Hades (guardian / Supabase) -----------------------------------------------------------

async function loadHades(
  adminClient: AdminClient,
  c2xId: number | null,
): Promise<ApoloTimelineEntry[]> {
  if (!c2xId) {
    return [];
  }

  const { data } = await adminClient
    .from("guardian_compromissos")
    .select("id, protocol, kind, status, total_amount, promised_date, created_at, fulfilled_at, broken_at")
    .eq("client_c2x_id", c2xId)
    .order("created_at", { ascending: false })
    .limit(200);

  return (data ?? []).map((item) => {
    const status = String(item.status ?? "");
    const broken = Boolean(item.broken_at) || /quebrad|cancelad/i.test(status);
    const fulfilled = Boolean(item.fulfilled_at) || /cumprid|fulfill|quitad/i.test(status);

    return {
      amount: toNumber(item.total_amount as number),
      author: null,
      date: iso((item.created_at ?? item.promised_date) as string | null),
      dateOnly: false,
      description: `Negociação · ${text(item.kind as string) ?? "acordo"} · ${statusLabel(status)}`,
      id: `hades:${item.id}`,
      manual: false,
      reference: text(item.protocol as string),
      source: "hades",
      status: broken ? "blocked" : fulfilled ? "ok" : "attention",
      title: "Negociação no Hades",
    };
  });
}

// ---- Chronos (Supabase) --------------------------------------------------------------------

async function loadChronos(
  adminClient: AdminClient,
  emails: string[],
): Promise<ApoloTimelineEntry[]> {
  if (!emails.length) {
    return [];
  }

  const { data: parts } = await adminClient
    .from("chronos_participants")
    .select("meeting_id")
    .in("email", emails)
    .limit(500);

  const meetingIds = Array.from(
    new Set((parts ?? []).map((row) => row.meeting_id as string).filter(Boolean)),
  );
  if (!meetingIds.length) {
    return [];
  }

  const { data: meetings } = await adminClient
    .from("chronos_meetings")
    .select("id, protocol, title, meeting_type, status, starts_at")
    .in("id", meetingIds)
    .order("starts_at", { ascending: false })
    .limit(200);

  return (meetings ?? []).map((meeting) => ({
    amount: null,
    author: null,
    date: iso(meeting.starts_at as string | null),
    dateOnly: false,
    description: `Reunião · ${text(meeting.meeting_type as string) ?? "encontro"} · ${statusLabel(String(meeting.status ?? ""))}`,
    id: `chronos:${meeting.id}`,
    manual: false,
    reference: text(meeting.protocol as string),
    source: "chronos",
    status: /cancelad/i.test(String(meeting.status ?? "")) ? "blocked" : "info",
    title: text(meeting.title as string) ?? "Reunião",
  }));
}

// ---- Manuais (apolo_timeline_events / Supabase) --------------------------------------------

// Eventos que o operador registra na mão (ação que o hub não capturou). Ficam em
// apolo_timeline_events com metadata.source = "manual" (só esses; ignora eventuais eventos de
// sync). Ver [[project_apolo_timeline]].
async function loadManual(
  adminClient: AdminClient,
  entityId: string | null,
): Promise<ApoloTimelineEntry[]> {
  if (!entityId) {
    return [];
  }

  const { data } = await adminClient
    .from("apolo_timeline_events")
    .select("id, event_type, title, description, occurred_at, metadata")
    .eq("entity_id", entityId)
    .eq("metadata->>source", "manual")
    .order("occurred_at", { ascending: false })
    .limit(200);

  return (data ?? []).map((row) => {
    const meta = (row.metadata ?? {}) as { author?: string | null; category?: string | null };

    return {
      amount: null,
      author: text(meta.author) ?? "Operador",
      date: iso(row.occurred_at as string | null),
      dateOnly: false,
      description:
        text(row.description as string) ?? text(meta.category) ?? "Registro manual",
      id: `manual:${row.id}`,
      manual: true,
      reference: text(meta.category) ?? text(row.event_type as string),
      source: "manual",
      status: "info",
      title: text(row.title as string) ?? "Registro manual",
    };
  });
}

// ---- helpers -------------------------------------------------------------------------------

function csvQuote(value: string): string {
  return `"${value.replace(/"/g, "")}"`;
}

function statusLabel(status: string): string {
  const clean = status.replace(/_/g, " ").trim();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : "—";
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

function iso(value: Date | string | null): string {
  if (!value) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const str = String(value);
  // Datas MySQL "YYYY-MM-DD HH:MM:SS" -> ISO; datas ISO ficam como estão.
  return str.includes("T") ? str : str.replace(" ", "T");
}
