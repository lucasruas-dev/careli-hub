import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

// Motor da Cobranca (Hades) — Acordos & Promessas + Regua de lembretes.
//
// Hades REGISTRA o compromisso (promessa/acordo) e organiza a regua; o C2X
// continua COBRANDO (gera boleto/Asaas). O elo com o pagamento real e o
// `payment_c2x_id` da parcela. Esta lib e a fonte estruturada; a timeline
// humana (`caredesk_ticket_events`, source_module=guardian) continua sendo a
// leitura do operador.
//
// Tabelas (migration 0036, ja em prod): guardian_compromissos,
// guardian_compromisso_parcelas, guardian_compromisso_lembretes.

// --- Enums do dominio (espelham os CHECKs da migration 0036) ---

export type GuardianCompromissoKind = "promessa" | "acordo";

export type GuardianCompromissoStatus =
  | "ativo"
  | "cumprido"
  | "quebrado"
  | "cancelado";

export type GuardianCompromissoStage =
  | "aguardando_pagamento"
  | "aguardando_emissao"
  | "emitido"
  | "enviado";

export type GuardianCompromissoPriority = "low" | "medium" | "high" | "critical";

export type GuardianParcelaStatus =
  | "pendente"
  | "emitida"
  | "enviada"
  | "paga"
  | "vencida"
  | "cancelada";

export type GuardianLembreteKind = "D-3" | "D-2" | "D-1" | "D0";

export type GuardianLembreteStatus =
  | "pendente"
  | "enviado"
  | "falhou"
  | "cancelado";

// Fase 2: workflow de aprovacao da proposta (em coluna real, migration 0037).
export type GuardianApprovalStatus =
  | "em_elaboracao"
  | "pendente"
  | "aprovado"
  | "reprovado";

// Thread de comentarios da Central do gestor (migration 0037).
export type GuardianCommentKind =
  | "comment"
  | "aprovacao"
  | "reprovacao"
  | "sistema";

// --- Linhas cruas das tabelas (snake_case do banco) ---

type CompromissoRow = {
  acquisition_request_c2x_id: number | string | null;
  approval_reason: string | null;
  approval_status: GuardianApprovalStatus;
  approved_at: string | null;
  approved_by_user_id: string | null;
  attendance_protocol: string | null;
  broken_at: string | null;
  channel: string;
  client_c2x_id: number | string;
  cobranca_protocol: string | null;
  created_at: string;
  created_by_user_id: string | null;
  first_due_date: string | null;
  fulfilled_at: string | null;
  id: string;
  submitted_at: string | null;
  installments_count: number | string;
  kind: GuardianCompromissoKind;
  metadata: Record<string, unknown> | null;
  notes: string | null;
  priority: GuardianCompromissoPriority | null;
  promised_date: string | null;
  protocol: string;
  risk_score: number | string | null;
  stage: GuardianCompromissoStage;
  status: GuardianCompromissoStatus;
  total_amount: number | string;
  updated_at: string;
  updated_by_user_id: string | null;
};

type ParcelaRow = {
  amount: number | string;
  boleto_url: string | null;
  compromisso_id: string;
  created_at: string;
  due_date: string;
  id: string;
  metadata: Record<string, unknown> | null;
  paid_at: string | null;
  payment_c2x_id: number | string | null;
  sequence: number | string;
  status: GuardianParcelaStatus;
  updated_at: string;
};

type LembreteRow = {
  channel: string;
  compromisso_id: string;
  created_at: string;
  failure_reason: string | null;
  id: string;
  kind: GuardianLembreteKind;
  message_id: string | null;
  meta_template: string | null;
  metadata: Record<string, unknown> | null;
  parcela_id: string | null;
  scheduled_for: string;
  sent_at: string | null;
  status: GuardianLembreteStatus;
};

type CommentRow = {
  author_user_id: string | null;
  body: string;
  compromisso_id: string;
  created_at: string;
  id: string;
  kind: GuardianCommentKind;
  metadata: Record<string, unknown> | null;
};

// Subconjunto tipado do schema usado pelo motor (mesmo padrao do
// manual-events/route.ts: define-se apenas o que esta lib toca).
export type GuardianMotorDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: {
      next_guardian_compromisso_protocol: {
        Args: { p_kind: string };
        Returns: string;
      };
    };
    Tables: {
      // Read-model do C2X (so leitura): resolve o empreendimento por cliente
      // quando a proposta nao tem o empreendimento denormalizado no metadata.
      c2x_guardian_attendance_queue: {
        Insert: never;
        Relationships: [];
        Row: {
          client_c2x_id: number | string | null;
          enterprise_name: string | null;
          is_current: boolean | null;
          overdue_amount: number | string | null;
          overdue_days: number | string | null;
          overdue_payments: number | string | null;
          risk_score: number | string | null;
          unit_label: string | null;
        };
        Update: never;
      };
      guardian_compromisso_comments: {
        Insert: {
          author_user_id?: string | null;
          body: string;
          compromisso_id: string;
          kind?: GuardianCommentKind;
          metadata?: Record<string, unknown>;
        };
        Relationships: [];
        Row: CommentRow;
        Update: {
          metadata?: Record<string, unknown>;
        };
      };
      // Read-only: resolve o nome do operador (criador da proposta) por id.
      hub_users: {
        Insert: never;
        Relationships: [];
        Row: {
          display_name: string | null;
          email: string | null;
          id: string;
        };
        Update: never;
      };
      guardian_compromisso_lembretes: {
        Insert: {
          channel?: string;
          compromisso_id: string;
          failure_reason?: string | null;
          kind: GuardianLembreteKind;
          message_id?: string | null;
          meta_template?: string | null;
          metadata?: Record<string, unknown>;
          parcela_id?: string | null;
          scheduled_for: string;
          status?: GuardianLembreteStatus;
        };
        Relationships: [];
        Row: LembreteRow;
        Update: {
          failure_reason?: string | null;
          message_id?: string | null;
          metadata?: Record<string, unknown>;
          sent_at?: string | null;
          status?: GuardianLembreteStatus;
        };
      };
      guardian_compromisso_parcelas: {
        Insert: {
          amount?: number;
          boleto_url?: string | null;
          compromisso_id: string;
          due_date: string;
          metadata?: Record<string, unknown>;
          payment_c2x_id?: number | null;
          sequence: number;
          status?: GuardianParcelaStatus;
        };
        Relationships: [];
        Row: ParcelaRow;
        Update: {
          amount?: number;
          boleto_url?: string | null;
          metadata?: Record<string, unknown>;
          paid_at?: string | null;
          payment_c2x_id?: number | null;
          status?: GuardianParcelaStatus;
        };
      };
      guardian_compromissos: {
        Insert: {
          acquisition_request_c2x_id?: number | null;
          approval_reason?: string | null;
          approval_status?: GuardianApprovalStatus;
          approved_at?: string | null;
          approved_by_user_id?: string | null;
          attendance_protocol?: string | null;
          channel?: string;
          client_c2x_id: number;
          cobranca_protocol?: string | null;
          created_by_user_id?: string | null;
          first_due_date?: string | null;
          installments_count?: number;
          kind: GuardianCompromissoKind;
          metadata?: Record<string, unknown>;
          notes?: string | null;
          priority?: GuardianCompromissoPriority | null;
          promised_date?: string | null;
          protocol: string;
          risk_score?: number | null;
          stage: GuardianCompromissoStage;
          status?: GuardianCompromissoStatus;
          submitted_at?: string | null;
          total_amount?: number;
          updated_by_user_id?: string | null;
        };
        Relationships: [];
        Row: CompromissoRow;
        Update: {
          acquisition_request_c2x_id?: number | null;
          approval_reason?: string | null;
          approval_status?: GuardianApprovalStatus;
          approved_at?: string | null;
          approved_by_user_id?: string | null;
          attendance_protocol?: string | null;
          broken_at?: string | null;
          channel?: string;
          cobranca_protocol?: string | null;
          first_due_date?: string | null;
          fulfilled_at?: string | null;
          installments_count?: number;
          metadata?: Record<string, unknown>;
          notes?: string | null;
          priority?: GuardianCompromissoPriority | null;
          promised_date?: string | null;
          risk_score?: number | null;
          stage?: GuardianCompromissoStage;
          status?: GuardianCompromissoStatus;
          submitted_at?: string | null;
          total_amount?: number;
          updated_by_user_id?: string | null;
        };
      };
    };
    Views: Record<string, never>;
  };
};

export type GuardianMotorClient = SupabaseClient<GuardianMotorDatabase>;

// --- Tipos de dominio (camelCase, prontos pra UI/JSON) ---

export type GuardianCompromissoParcela = {
  amount: number;
  boletoUrl: string | null;
  dueDate: string;
  id: string;
  metadata: Record<string, unknown>;
  paidAt: string | null;
  paymentC2xId: number | null;
  sequence: number;
  status: GuardianParcelaStatus;
};

export type GuardianCompromissoLembrete = {
  channel: string;
  failureReason: string | null;
  id: string;
  kind: GuardianLembreteKind;
  messageId: string | null;
  metaTemplate: string | null;
  parcelaId: string | null;
  scheduledFor: string;
  sentAt: string | null;
  status: GuardianLembreteStatus;
};

export type GuardianCompromisso = {
  acquisitionRequestC2xId: number | null;
  approvalReason: string | null;
  approvalStatus: GuardianApprovalStatus;
  approvedAt: string | null;
  approvedByUserId: string | null;
  attendanceProtocol: string | null;
  brokenAt: string | null;
  channel: string;
  clientC2xId: number;
  cobrancaProtocol: string | null;
  createdAt: string;
  createdByUserId: string | null;
  firstDueDate: string | null;
  fulfilledAt: string | null;
  id: string;
  installmentsCount: number;
  kind: GuardianCompromissoKind;
  // Data da ultima mensagem na thread (para marcacao de novidade). Setado nas
  // listagens; null por padrao.
  lastCommentAt: string | null;
  metadata: Record<string, unknown>;
  notes: string | null;
  priority: GuardianCompromissoPriority | null;
  promisedDate: string | null;
  protocol: string;
  riskScore: number | null;
  stage: GuardianCompromissoStage;
  status: GuardianCompromissoStatus;
  submittedAt: string | null;
  totalAmount: number;
  updatedAt: string;
  updatedByUserId: string | null;
};

export type GuardianCompromissoComment = {
  authorName: string | null;
  authorUserId: string | null;
  body: string;
  createdAt: string;
  id: string;
  kind: GuardianCommentKind;
};

export type GuardianCompromissoDetail = GuardianCompromisso & {
  lembretes: GuardianCompromissoLembrete[];
  parcelas: GuardianCompromissoParcela[];
};

// --- Entradas das operacoes ---

export type CreateParcelaInput = {
  amount: number;
  boletoUrl?: string | null;
  dueDate: string; // YYYY-MM-DD
  metadata?: Record<string, unknown>;
  paymentC2xId?: number | null;
  sequence?: number;
};

export type CreateCompromissoInput = {
  acquisitionRequestC2xId?: number | null;
  attendanceProtocol?: string | null;
  channel?: string;
  clientC2xId: number;
  cobrancaProtocol?: string | null;
  firstDueDate?: string | null;
  kind: GuardianCompromissoKind;
  metadata?: Record<string, unknown>;
  notes?: string | null;
  parcelas: CreateParcelaInput[];
  priority?: GuardianCompromissoPriority | null;
  // Para promessa: data prometida. Se ausente, usa a 1a parcela.
  promisedDate?: string | null;
  riskScore?: number | null;
};

export type CreateCompromissoResult =
  | { compromisso: GuardianCompromissoDetail; ok: true }
  | { error: string; ok: false };

// Regua: D-3/D-2/D-1/D0 antes do vencimento (Lucas: manter os 4 pontos).
export const GUARDIAN_LEMBRETE_OFFSETS: {
  daysBefore: number;
  kind: GuardianLembreteKind;
}[] = [
  { daysBefore: 3, kind: "D-3" },
  { daysBefore: 2, kind: "D-2" },
  { daysBefore: 1, kind: "D-1" },
  { daysBefore: 0, kind: "D0" },
];

// --- Client tipado (mesmo service_role dos demais; auth validada na rota) ---

export function createGuardianMotorClient(): GuardianMotorClient | null {
  const { serviceRoleKey, url } = getServerSupabaseConfig();

  if (!url || !serviceRoleKey) {
    return null;
  }

  return createClient<GuardianMotorDatabase>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// --- Operacoes ---

export async function createGuardianCompromisso(
  client: GuardianMotorClient,
  input: CreateCompromissoInput,
  userId: string | null,
): Promise<CreateCompromissoResult> {
  const validation = validateCreateInput(input);

  if (!validation.ok) {
    return validation;
  }

  const { parcelas } = validation;
  const stage: GuardianCompromissoStage =
    input.kind === "promessa" ? "aguardando_pagamento" : "aguardando_emissao";
  const promisedDate =
    input.kind === "promessa"
      ? input.promisedDate ?? parcelas[0]?.dueDate ?? null
      : null;
  const firstDueDate =
    input.firstDueDate ??
    parcelas.reduce<string | null>(
      (earliest, parcela) =>
        earliest && earliest <= parcela.dueDate ? earliest : parcela.dueDate,
      null,
    );
  const totalAmount = round2(
    parcelas.reduce((sum, parcela) => sum + parcela.amount, 0),
  );

  // Protocolo sequencial PR-*/AC-* (RPC com grant a service_role).
  const { data: protocol, error: protocolError } = await client.rpc(
    "next_guardian_compromisso_protocol",
    { p_kind: input.kind },
  );

  if (protocolError || !protocol) {
    return {
      error: "Nao foi possivel gerar o protocolo do compromisso.",
      ok: false,
    };
  }

  const { data: compromissoRow, error: insertError } = await client
    .from("guardian_compromissos")
    .insert({
      acquisition_request_c2x_id: input.acquisitionRequestC2xId ?? null,
      // Toda proposta nasce ENVIADA pra aprovacao do Admin (Fase 2). Nao ha
      // fluxo de "salvar rascunho" na UI: criar = submeter.
      approval_status: "pendente",
      attendance_protocol: input.attendanceProtocol ?? null,
      channel: input.channel?.trim() || "manual",
      client_c2x_id: input.clientC2xId,
      cobranca_protocol: input.cobrancaProtocol ?? null,
      created_by_user_id: userId,
      first_due_date: firstDueDate,
      installments_count: parcelas.length,
      kind: input.kind,
      metadata: input.metadata ?? {},
      notes: input.notes ?? null,
      priority: input.priority ?? null,
      promised_date: promisedDate,
      protocol,
      risk_score: input.riskScore ?? null,
      stage,
      submitted_at: new Date().toISOString(),
      total_amount: totalAmount,
      updated_by_user_id: userId,
    })
    .select("*")
    .single<CompromissoRow>();

  if (insertError || !compromissoRow) {
    return {
      error: "Nao foi possivel registrar o compromisso.",
      ok: false,
    };
  }

  const { data: parcelaRows, error: parcelasError } = await client
    .from("guardian_compromisso_parcelas")
    .insert(
      parcelas.map((parcela, index) => ({
        amount: round2(parcela.amount),
        boleto_url: parcela.boletoUrl ?? null,
        compromisso_id: compromissoRow.id,
        due_date: parcela.dueDate,
        metadata: parcela.metadata ?? {},
        payment_c2x_id: parcela.paymentC2xId ?? null,
        sequence: parcela.sequence ?? index + 1,
        status: "pendente" as GuardianParcelaStatus,
      })),
    )
    .select("*")
    .returns<ParcelaRow[]>();

  if (parcelasError || !parcelaRows) {
    // Rollback manual (sem transacao no PostgREST): remove o compromisso.
    await client.from("guardian_compromissos").delete().eq("id", compromissoRow.id);

    return {
      error: "Nao foi possivel registrar as parcelas do compromisso.",
      ok: false,
    };
  }

  const lembreteInserts = buildLembreteInserts({
    compromissoId: compromissoRow.id,
    kind: input.kind,
    parcelas: parcelaRows,
    promisedDate,
    today: todayDateOnly(),
  });

  if (lembreteInserts.length > 0) {
    const { error: lembretesError } = await client
      .from("guardian_compromisso_lembretes")
      .insert(lembreteInserts);

    if (lembretesError) {
      await client
        .from("guardian_compromisso_parcelas")
        .delete()
        .eq("compromisso_id", compromissoRow.id);
      await client
        .from("guardian_compromissos")
        .delete()
        .eq("id", compromissoRow.id);

      return {
        error: "Nao foi possivel agendar a regua de lembretes.",
        ok: false,
      };
    }
  }

  const detail = await getGuardianCompromissoDetail(client, compromissoRow.id);

  if (!detail) {
    return {
      error: "Compromisso registrado, mas nao foi possivel recarrega-lo.",
      ok: false,
    };
  }

  return { compromisso: detail, ok: true };
}

// Atualiza uma proposta ainda nao executada (rascunho/pendente): mantem o
// protocolo e o kind, regrava os campos e SUBSTITUI parcelas + lembretes.
export async function replaceGuardianCompromissoDraft(
  client: GuardianMotorClient,
  compromissoId: string,
  input: CreateCompromissoInput,
  userId: string | null,
): Promise<CreateCompromissoResult> {
  const validation = validateCreateInput(input);

  if (!validation.ok) {
    return validation;
  }

  const { parcelas } = validation;
  const stage: GuardianCompromissoStage =
    input.kind === "promessa" ? "aguardando_pagamento" : "aguardando_emissao";
  const promisedDate =
    input.kind === "promessa"
      ? input.promisedDate ?? parcelas[0]?.dueDate ?? null
      : null;
  const firstDueDate =
    input.firstDueDate ??
    parcelas.reduce<string | null>(
      (earliest, parcela) =>
        earliest && earliest <= parcela.dueDate ? earliest : parcela.dueDate,
      null,
    );
  const totalAmount = round2(
    parcelas.reduce((sum, parcela) => sum + parcela.amount, 0),
  );

  const { error: updateError } = await client
    .from("guardian_compromissos")
    .update({
      acquisition_request_c2x_id: input.acquisitionRequestC2xId ?? null,
      // Editar uma proposta pendente RE-SUBMETE (volta pra fila de aprovacao
      // com novo carimbo de envio; limpa decisao anterior, se houver).
      approval_reason: null,
      approval_status: "pendente",
      approved_at: null,
      approved_by_user_id: null,
      attendance_protocol: input.attendanceProtocol ?? null,
      channel: input.channel?.trim() || "manual",
      cobranca_protocol: input.cobrancaProtocol ?? null,
      first_due_date: firstDueDate,
      installments_count: parcelas.length,
      metadata: input.metadata ?? {},
      notes: input.notes ?? null,
      priority: input.priority ?? null,
      promised_date: promisedDate,
      risk_score: input.riskScore ?? null,
      stage,
      submitted_at: new Date().toISOString(),
      total_amount: totalAmount,
      updated_by_user_id: userId,
    })
    .eq("id", compromissoId);

  if (updateError) {
    return { error: "Nao foi possivel atualizar a proposta.", ok: false };
  }

  // Substitui parcelas + lembretes (FK cascade nao roda no update; limpamos).
  await client
    .from("guardian_compromisso_lembretes")
    .delete()
    .eq("compromisso_id", compromissoId);
  await client
    .from("guardian_compromisso_parcelas")
    .delete()
    .eq("compromisso_id", compromissoId);

  const { data: parcelaRows, error: parcelasError } = await client
    .from("guardian_compromisso_parcelas")
    .insert(
      parcelas.map((parcela, index) => ({
        amount: round2(parcela.amount),
        boleto_url: parcela.boletoUrl ?? null,
        compromisso_id: compromissoId,
        due_date: parcela.dueDate,
        metadata: parcela.metadata ?? {},
        payment_c2x_id: parcela.paymentC2xId ?? null,
        sequence: parcela.sequence ?? index + 1,
        status: "pendente" as GuardianParcelaStatus,
      })),
    )
    .select("*")
    .returns<ParcelaRow[]>();

  if (parcelasError || !parcelaRows) {
    return {
      error: "Nao foi possivel atualizar as parcelas da proposta.",
      ok: false,
    };
  }

  const lembreteInserts = buildLembreteInserts({
    compromissoId,
    kind: input.kind,
    parcelas: parcelaRows,
    promisedDate,
    today: todayDateOnly(),
  });

  if (lembreteInserts.length > 0) {
    await client
      .from("guardian_compromisso_lembretes")
      .insert(lembreteInserts);
  }

  const detail = await getGuardianCompromissoDetail(client, compromissoId);

  if (!detail) {
    return {
      error: "Proposta atualizada, mas nao foi possivel recarrega-la.",
      ok: false,
    };
  }

  return { compromisso: detail, ok: true };
}

export async function listGuardianCompromissosByClient(
  client: GuardianMotorClient,
  clientC2xId: number,
): Promise<GuardianCompromissoDetail[]> {
  const { data: compromissoRows, error } = await client
    .from("guardian_compromissos")
    .select("*")
    .eq("client_c2x_id", clientC2xId)
    .order("created_at", { ascending: false })
    .returns<CompromissoRow[]>();

  if (error || !compromissoRows?.length) {
    return [];
  }

  const ids = compromissoRows.map((row) => row.id);
  const [parcelasByCompromisso, lembretesByCompromisso, lastCommentByCompromisso] =
    await Promise.all([
      loadParcelasByCompromisso(client, ids),
      loadLembretesByCompromisso(client, ids),
      loadLastCommentByCompromisso(client, ids),
    ]);

  return compromissoRows.map((row) => ({
    ...mapCompromisso(row),
    lastCommentAt: lastCommentByCompromisso.get(row.id) ?? null,
    lembretes: lembretesByCompromisso.get(row.id) ?? [],
    parcelas: parcelasByCompromisso.get(row.id) ?? [],
  }));
}

export async function getGuardianCompromissoDetail(
  client: GuardianMotorClient,
  compromissoId: string,
): Promise<GuardianCompromissoDetail | null> {
  const { data: row, error } = await client
    .from("guardian_compromissos")
    .select("*")
    .eq("id", compromissoId)
    .maybeSingle<CompromissoRow>();

  if (error || !row) {
    return null;
  }

  const [parcelasByCompromisso, lembretesByCompromisso] = await Promise.all([
    loadParcelasByCompromisso(client, [row.id]),
    loadLembretesByCompromisso(client, [row.id]),
  ]);

  return {
    ...mapCompromisso(row),
    lembretes: lembretesByCompromisso.get(row.id) ?? [],
    parcelas: parcelasByCompromisso.get(row.id) ?? [],
  };
}

export type UpdateCompromissoStageInput = {
  stage?: GuardianCompromissoStage;
  status?: GuardianCompromissoStatus;
};

export async function updateGuardianCompromisso(
  client: GuardianMotorClient,
  compromissoId: string,
  input: UpdateCompromissoStageInput,
  userId: string | null,
): Promise<GuardianCompromissoDetail | null> {
  const update: GuardianMotorDatabase["public"]["Tables"]["guardian_compromissos"]["Update"] =
    {
      updated_by_user_id: userId,
    };

  if (input.stage) {
    update.stage = input.stage;
  }

  if (input.status) {
    update.status = input.status;

    if (input.status === "cumprido") {
      update.fulfilled_at = new Date().toISOString();
    }

    if (input.status === "quebrado") {
      update.broken_at = new Date().toISOString();
    }
  }

  const { error } = await client
    .from("guardian_compromissos")
    .update(update)
    .eq("id", compromissoId);

  if (error) {
    return null;
  }

  // Status final cancela lembretes pendentes (evita disparo apos resolucao).
  if (input.status && input.status !== "ativo") {
    await client
      .from("guardian_compromisso_lembretes")
      .update({ status: "cancelado" })
      .eq("compromisso_id", compromissoId)
      .eq("status", "pendente");
  }

  return getGuardianCompromissoDetail(client, compromissoId);
}

// --- Aprovacao (Central do gestor) ---

// Lista TODAS as propostas (todos os clientes) por estado de aprovacao, mais
// recentes primeiro. Alimenta as abas da Central do gestor (Pendentes /
// Aprovadas / Reprovadas). Pendentes ordenam por envio; decididas por decisao.
export async function listGuardianCompromissosByApproval(
  client: GuardianMotorClient,
  approvalStatus: GuardianApprovalStatus,
): Promise<GuardianCompromissoDetail[]> {
  const orderColumn =
    approvalStatus === "pendente" ? "submitted_at" : "approved_at";

  const { data: compromissoRows, error } = await client
    .from("guardian_compromissos")
    .select("*")
    .eq("approval_status", approvalStatus)
    .order(orderColumn, { ascending: false })
    .returns<CompromissoRow[]>();

  if (error || !compromissoRows?.length) {
    return [];
  }

  return hydrateCompromissoRows(client, compromissoRows);
}

// Todas as propostas (qualquer estado de aprovacao), mais recentes primeiro.
// Alimenta a tabela/overview da Central de Propostas (o operador filtra as dele
// no front por created_by_user_id).
export async function listAllGuardianCompromissos(
  client: GuardianMotorClient,
): Promise<GuardianCompromissoDetail[]> {
  const { data: compromissoRows, error } = await client
    .from("guardian_compromissos")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5000)
    .returns<CompromissoRow[]>();

  if (error || !compromissoRows?.length) {
    return [];
  }

  return hydrateCompromissoRows(client, compromissoRows);
}

// Hidrata linhas de compromisso em detalhes: carrega parcelas e, quando a
// proposta nao tem o contrato denormalizado no metadata (propostas antigas),
// injeta empreendimento/unidade/atraso/risco do read-model do C2X — para a
// Central mostrar Contrato + Em atraso + filtros mesmo no dado legado.
async function hydrateCompromissoRows(
  client: GuardianMotorClient,
  compromissoRows: CompromissoRow[],
): Promise<GuardianCompromissoDetail[]> {
  const ids = compromissoRows.map((row) => row.id);
  const [parcelasByCompromisso, contractByClient, lastCommentByCompromisso] =
    await Promise.all([
      loadParcelasByCompromisso(client, ids),
      loadContractByClient(
        client,
        compromissoRows.map((row) => toNumber(row.client_c2x_id)),
      ),
      loadLastCommentByCompromisso(client, ids),
    ]);

  return compromissoRows.map((row) => {
    const mapped = mapCompromisso(row);
    const snapshot = contractByClient.get(mapped.clientC2xId);
    const hasContract =
      mapped.metadata.contract && typeof mapped.metadata.contract === "object";
    const metadata =
      !hasContract && snapshot
        ? {
            ...mapped.metadata,
            contract: {
              atrasoDias: snapshot.atrasoDias,
              empreendimento: snapshot.empreendimento,
              matriculas: snapshot.unitLabel ? [snapshot.unitLabel] : [],
              parcelasVencidas: snapshot.parcelasVencidas,
              saldoDevedor:
                snapshot.saldoDevedor != null
                  ? snapshot.saldoDevedor.toLocaleString("pt-BR", {
                      currency: "BRL",
                      style: "currency",
                    })
                  : null,
              scoreRisco: snapshot.riskScore,
            },
            empreendimento: snapshot.empreendimento,
          }
        : mapped.metadata;

    return {
      ...mapped,
      lastCommentAt: lastCommentByCompromisso.get(row.id) ?? null,
      metadata,
      lembretes: [],
      parcelas: parcelasByCompromisso.get(row.id) ?? [],
    };
  });
}

// Atalho da fila principal: so as pendentes.
export async function listPendingGuardianCompromissos(
  client: GuardianMotorClient,
): Promise<GuardianCompromissoDetail[]> {
  return listGuardianCompromissosByApproval(client, "pendente");
}

export type GuardianClientStage = {
  clientC2xId: number;
  nextAction: string;
  operator: string | null;
  stage: string;
};

type StageRow = {
  approval_status: GuardianApprovalStatus;
  client_c2x_id: number | string;
  created_at: string;
  created_by_user_id: string | null;
  kind: GuardianCompromissoKind;
  metadata: Record<string, unknown> | null;
  status: GuardianCompromissoStatus;
};

// Deriva a etapa do workflow (Auto - Hades) por cliente a partir dos seus
// compromissos no motor. Em LOTE, para a fila e o detalhe lerem a MESMA etapa
// (consistencia). Mesma regra do detalhe: proposta pendente -> Negociacao;
// acordo/promessa aprovado -> Acordo/Promessa; tudo quebrado -> Quebra.
export async function listGuardianCompromissoStages(
  client: GuardianMotorClient,
): Promise<GuardianClientStage[]> {
  const { data, error } = await client
    .from("guardian_compromissos")
    .select(
      "client_c2x_id,kind,status,approval_status,created_at,created_by_user_id,metadata",
    )
    .order("created_at", { ascending: false })
    .limit(20000)
    .returns<StageRow[]>();

  if (error || !data?.length) {
    return [];
  }

  // Resolve o nome do criador (fallback do operador quando a proposta nao tem o
  // submitted_by_name denormalizado — ex.: propostas antigas).
  const creatorIds = [
    ...new Set(
      data
        .map((row) => row.created_by_user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const nameByUserId = new Map<string, string>();
  if (creatorIds.length > 0) {
    const { data: users } = await client
      .from("hub_users")
      .select("id,display_name,email")
      .in("id", creatorIds)
      .returns<{ display_name: string | null; email: string | null; id: string }[]>();
    for (const user of users ?? []) {
      const name = user.display_name?.trim() || user.email?.trim();
      if (name) {
        nameByUserId.set(user.id, name);
      }
    }
  }

  const byClient = new Map<number, StageRow[]>();
  for (const row of data) {
    const id = toNumber(row.client_c2x_id);
    if (id <= 0) {
      continue;
    }
    const list = byClient.get(id) ?? [];
    list.push(row);
    byClient.set(id, list);
  }

  const stages: GuardianClientStage[] = [];
  for (const [clientC2xId, rows] of byClient) {
    const derived = deriveStageFromRows(rows);
    if (derived) {
      // operador = quem enviou a proposta mais recente (rows ordenadas desc);
      // cai pro nome do criador resolvido em hub_users.
      const recent = rows[0];
      const submitted = (recent?.metadata ?? {}).submitted_by_name;
      const operator =
        (typeof submitted === "string" && submitted.trim()
          ? submitted.trim()
          : null) ??
        (recent?.created_by_user_id
          ? nameByUserId.get(recent.created_by_user_id) ?? null
          : null);
      stages.push({ clientC2xId, operator, ...derived });
    }
  }

  return stages;
}

function deriveStageFromRows(
  rows: StageRow[],
): { nextAction: string; stage: string } | null {
  const active = rows.filter((row) => row.status === "ativo");
  const hasApprovedAcordo = active.some(
    (row) => row.kind === "acordo" && row.approval_status === "aprovado",
  );
  const hasApprovedPromessa = active.some(
    (row) => row.kind === "promessa" && row.approval_status === "aprovado",
  );
  const hasPending = active.some((row) => row.approval_status === "pendente");
  const hasBroken = rows.some((row) => row.status === "quebrado");

  if (hasApprovedAcordo) {
    return {
      nextAction: "Acompanhar o pagamento das parcelas do acordo.",
      stage: "Acordo",
    };
  }
  if (hasApprovedPromessa) {
    return {
      nextAction: "Aguardar a data prometida (régua de lembretes).",
      stage: "Promessa de pagamento",
    };
  }
  if (hasPending) {
    return {
      nextAction: "Proposta registrada aguardando aprovação do gestor.",
      stage: "Negociação",
    };
  }
  if (hasBroken) {
    return {
      nextAction: "Acordo quebrado — reabrir negociação.",
      stage: "Quebra",
    };
  }

  return null;
}

export type CompromissoDecision = "aprovado" | "reprovado" | "devolvido";

export type DecideCompromissoInput = {
  decision: CompromissoDecision;
  reason?: string | null;
};

// Decide (Admin) uma proposta pendente: aprova, reprova ou DEVOLVE pro operador
// ajustar. So altera o estado de aprovacao; a execucao pos-aprovacao (regua/
// emissao) e tratada a parte. Reprovar/devolver cancelam os lembretes pendentes
// (nada dispara). Devolver volta a proposta para 'em_elaboracao' (editavel pelo
// operador, que reenvia) — mantemos approved_by/reason/at como trilha de quem
// devolveu e por que.
export async function decideGuardianCompromisso(
  client: GuardianMotorClient,
  compromissoId: string,
  input: DecideCompromissoInput,
  adminUserId: string | null,
): Promise<GuardianCompromissoDetail | null> {
  const reason = input.reason?.trim() || null;
  // Devolver = volta pra elaboracao (operador edita e reenvia).
  const nextStatus: GuardianApprovalStatus =
    input.decision === "devolvido" ? "em_elaboracao" : input.decision;

  const { error } = await client
    .from("guardian_compromissos")
    .update({
      approval_reason: reason,
      approval_status: nextStatus,
      approved_at: new Date().toISOString(),
      approved_by_user_id: adminUserId,
      updated_by_user_id: adminUserId,
    })
    .eq("id", compromissoId)
    .eq("approval_status", "pendente");

  if (error) {
    return null;
  }

  if (input.decision !== "aprovado") {
    await client
      .from("guardian_compromisso_lembretes")
      .update({ status: "cancelado" })
      .eq("compromisso_id", compromissoId)
      .eq("status", "pendente");
  }

  return getGuardianCompromissoDetail(client, compromissoId);
}

// Exclui uma proposta (e, por FK on delete cascade, suas parcelas, lembretes e
// comentarios). Usado pela Central e pela aba Propostas do cliente.
export async function deleteGuardianCompromisso(
  client: GuardianMotorClient,
  compromissoId: string,
): Promise<boolean> {
  const { error } = await client
    .from("guardian_compromissos")
    .delete()
    .eq("id", compromissoId);

  return !error;
}

// --- Resumo financeiro (cockpit do gestor: Visao geral) ---

export type GuardianEmpreendimentoSummary = {
  acordo: number; // acordos em negociacao
  empreendimento: string;
  promessa: number; // promessas em negociacao
  quebrado: number;
  recuperado: number;
};

export type GuardianMoneyCount = { count: number; value: number };

export type GuardianFinancialSummary = {
  aReceber: GuardianMoneyCount;
  emNegociacao: GuardianMoneyCount;
  fulfillmentRate: number; // 0..100 (recuperado / (recuperado + quebrado), all-time)
  pendentes: GuardianMoneyCount;
  porEmpreendimento: GuardianEmpreendimentoSummary[];
  previsao: { d7: number; d15: number; d30: number; total: number };
  quebrado30d: GuardianMoneyCount;
  recuperado30d: GuardianMoneyCount;
};

type SummaryCompromissoRow = {
  approval_status: GuardianApprovalStatus;
  broken_at: string | null;
  client_c2x_id: number | string;
  id: string;
  kind: GuardianCompromissoKind;
  metadata: Record<string, unknown> | null;
  status: GuardianCompromissoStatus;
  total_amount: number | string;
};

type SummaryParcelaRow = {
  amount: number | string;
  compromisso_id: string;
  due_date: string;
  paid_at: string | null;
  status: GuardianParcelaStatus;
};

// Saude financeira da recuperacao. Agrega em JS sobre compromissos + parcelas
// (volume atual e pequeno; um RPC de agregacao pode substituir no futuro). On-
// demand, sem polling.
export async function getGuardianCompromissosFinancialSummary(
  client: GuardianMotorClient,
): Promise<GuardianFinancialSummary> {
  const empty: GuardianFinancialSummary = {
    aReceber: { count: 0, value: 0 },
    emNegociacao: { count: 0, value: 0 },
    fulfillmentRate: 0,
    pendentes: { count: 0, value: 0 },
    porEmpreendimento: [],
    previsao: { d15: 0, d30: 0, d7: 0, total: 0 },
    quebrado30d: { count: 0, value: 0 },
    recuperado30d: { count: 0, value: 0 },
  };

  const [{ data: compromissoRows }, { data: parcelaRows }] = await Promise.all([
    client
      .from("guardian_compromissos")
      .select(
        "id,client_c2x_id,kind,total_amount,approval_status,status,broken_at,metadata",
      )
      .limit(5000)
      .returns<SummaryCompromissoRow[]>(),
    client
      .from("guardian_compromisso_parcelas")
      .select("compromisso_id,amount,status,due_date,paid_at")
      .limit(20000)
      .returns<SummaryParcelaRow[]>(),
  ]);

  if (!compromissoRows?.length) {
    return empty;
  }

  // Resolve o contrato por cliente no read-model do C2X (fallback quando o
  // metadata da proposta nao traz — ex.: propostas criadas antes da denormalizacao).
  const contractByClient = await loadContractByClient(
    client,
    compromissoRows.map((row) => toNumber(row.client_c2x_id)),
  );

  const empreendimentoById = new Map<string, string>();
  const activeIds = new Set<string>(); // aprovado + ativo (parcelas vigentes)
  const since30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const today = todayDateOnly();

  let pendentesCount = 0;
  let pendentesValue = 0;
  let emNegCount = 0;
  let emNegValue = 0;
  let quebrado30dValue = 0;
  let quebrado30dCount = 0;
  let quebradoAll = 0;

  const byEmpreendimento = new Map<string, GuardianEmpreendimentoSummary>();
  const bucket = (name: string) => {
    let entry = byEmpreendimento.get(name);
    if (!entry) {
      entry = {
        acordo: 0,
        empreendimento: name,
        promessa: 0,
        quebrado: 0,
        recuperado: 0,
      };
      byEmpreendimento.set(name, entry);
    }
    return entry;
  };

  for (const row of compromissoRows) {
    const metaEmpreendimento = compromissoEmpreendimento(row.metadata);
    const empreendimento =
      metaEmpreendimento !== "Sem empreendimento"
        ? metaEmpreendimento
        : contractByClient.get(toNumber(row.client_c2x_id))?.empreendimento ??
          "Sem empreendimento";
    empreendimentoById.set(row.id, empreendimento);
    const value = toNumber(row.total_amount);
    const isActive = row.status === "ativo";
    const isNegotiating =
      isActive &&
      (row.approval_status === "pendente" || row.approval_status === "aprovado");

    if (row.approval_status === "pendente") {
      pendentesCount += 1;
      pendentesValue += value;
    }

    if (isNegotiating) {
      emNegCount += 1;
      emNegValue += value;
      if (row.kind === "promessa") {
        bucket(empreendimento).promessa += value;
      } else {
        bucket(empreendimento).acordo += value;
      }
    }

    if (row.approval_status === "aprovado" && isActive) {
      activeIds.add(row.id);
    }

    if (row.status === "quebrado") {
      quebradoAll += value;
      bucket(empreendimento).quebrado += value;
      if (row.broken_at && Date.parse(row.broken_at) >= since30d) {
        quebrado30dValue += value;
        quebrado30dCount += 1;
      }
    }
  }

  let aReceber = 0;
  let aReceberCount = 0;
  let recuperado30d = 0;
  let recuperado30dCount = 0;
  let recuperadoAll = 0;
  let prev7 = 0;
  let prev15 = 0;
  let prev30 = 0;

  for (const parcela of parcelaRows ?? []) {
    const amount = toNumber(parcela.amount);
    const empreendimento =
      empreendimentoById.get(parcela.compromisso_id) ?? "Sem empreendimento";

    if (parcela.status === "paga") {
      recuperadoAll += amount;
      bucket(empreendimento).recuperado += amount;
      if (parcela.paid_at && Date.parse(parcela.paid_at) >= since30d) {
        recuperado30d += amount;
        recuperado30dCount += 1;
      }
      continue;
    }

    const open =
      parcela.status === "pendente" ||
      parcela.status === "emitida" ||
      parcela.status === "enviada";

    if (open && activeIds.has(parcela.compromisso_id)) {
      aReceber += amount;
      aReceberCount += 1;

      if (isValidDateOnly(parcela.due_date) && parcela.due_date >= today) {
        const days = dayDiffDateOnly(today, parcela.due_date);
        if (days <= 7) {
          prev7 += amount;
        } else if (days <= 15) {
          prev15 += amount;
        } else if (days <= 30) {
          prev30 += amount;
        }
      }
    }
  }

  const denom = recuperadoAll + quebradoAll;

  return {
    aReceber: { count: aReceberCount, value: round2(aReceber) },
    emNegociacao: { count: emNegCount, value: round2(emNegValue) },
    fulfillmentRate: denom > 0 ? Math.round((recuperadoAll / denom) * 100) : 0,
    pendentes: { count: pendentesCount, value: round2(pendentesValue) },
    porEmpreendimento: [...byEmpreendimento.values()]
      .filter(
        (e) =>
          e.acordo > 0 || e.promessa > 0 || e.quebrado > 0 || e.recuperado > 0,
      )
      .sort(
        (a, b) =>
          b.acordo + b.promessa + b.quebrado -
          (a.acordo + a.promessa + a.quebrado),
      )
      .slice(0, 6)
      .map((e) => ({
        acordo: round2(e.acordo),
        empreendimento: e.empreendimento,
        promessa: round2(e.promessa),
        quebrado: round2(e.quebrado),
        recuperado: round2(e.recuperado),
      })),
    previsao: {
      d15: round2(prev15),
      d30: round2(prev30),
      d7: round2(prev7),
      total: round2(prev7 + prev15 + prev30),
    },
    quebrado30d: { count: quebrado30dCount, value: round2(quebrado30dValue) },
    recuperado30d: { count: recuperado30dCount, value: round2(recuperado30d) },
  };
}

export type C2xContractSnapshot = {
  atrasoDias: number | null;
  empreendimento: string;
  parcelasVencidas: number | null;
  riskScore: number | null;
  saldoDevedor: number | null;
  unitLabel: string | null;
};

// Resolve o contrato/atraso por cliente no read-model do C2X (is_current). Usado
// como fallback quando a proposta nao tem o bloco denormalizado no metadata
// (ex.: propostas criadas antes da denormalizacao). Cobre empreendimento,
// unidade, parcelas vencidas, saldo, dias de atraso e score de risco.
async function loadContractByClient(
  client: GuardianMotorClient,
  clientC2xIds: number[],
): Promise<Map<number, C2xContractSnapshot>> {
  const map = new Map<number, C2xContractSnapshot>();
  const ids = [...new Set(clientC2xIds.filter((id) => id > 0))];

  if (ids.length === 0) {
    return map;
  }

  const { data } = await client
    .from("c2x_guardian_attendance_queue")
    .select(
      "client_c2x_id,enterprise_name,unit_label,overdue_days,overdue_payments,overdue_amount,risk_score,is_current",
    )
    .in("client_c2x_id", ids)
    .eq("is_current", true)
    .returns<
      {
        client_c2x_id: number | string | null;
        enterprise_name: string | null;
        overdue_amount: number | string | null;
        overdue_days: number | string | null;
        overdue_payments: number | string | null;
        risk_score: number | string | null;
        unit_label: string | null;
      }[]
    >();

  for (const row of data ?? []) {
    const id = toNumber(row.client_c2x_id);
    if (id <= 0 || map.has(id)) {
      continue;
    }
    map.set(id, {
      atrasoDias: toNullableNumber(row.overdue_days),
      empreendimento: row.enterprise_name?.trim() || "Sem empreendimento",
      parcelasVencidas: toNullableNumber(row.overdue_payments),
      riskScore: toNullableNumber(row.risk_score),
      saldoDevedor: toNullableNumber(row.overdue_amount),
      unitLabel: row.unit_label?.trim() || null,
    });
  }

  return map;
}

function compromissoEmpreendimento(
  metadata: Record<string, unknown> | null,
): string {
  if (!metadata) {
    return "Sem empreendimento";
  }
  const direct = metadata.empreendimento;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  const contract = metadata.contract;
  if (contract && typeof contract === "object") {
    const value = (contract as Record<string, unknown>).empreendimento;
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "Sem empreendimento";
}

function dayDiffDateOnly(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
}

// --- Comentarios (thread auditavel da Central) ---

export async function listGuardianCompromissoComments(
  client: GuardianMotorClient,
  compromissoId: string,
): Promise<GuardianCompromissoComment[]> {
  const { data, error } = await client
    .from("guardian_compromisso_comments")
    .select("*")
    .eq("compromisso_id", compromissoId)
    .order("created_at", { ascending: true })
    .returns<CommentRow[]>();

  if (error || !data) {
    return [];
  }

  return data.map(mapComment);
}

export type AddCommentInput = {
  authorName?: string | null;
  body: string;
  compromissoId: string;
  kind?: GuardianCommentKind;
};

export async function addGuardianCompromissoComment(
  client: GuardianMotorClient,
  input: AddCommentInput,
  authorUserId: string | null,
): Promise<GuardianCompromissoComment | null> {
  const body = input.body.trim();

  if (!body) {
    return null;
  }

  // Denormaliza o nome do autor no metadata: a thread fica legivel sem join em
  // hub_users (o motor e tipado so pra suas tabelas).
  const { data, error } = await client
    .from("guardian_compromisso_comments")
    .insert({
      author_user_id: authorUserId,
      body,
      compromisso_id: input.compromissoId,
      kind: input.kind ?? "comment",
      metadata: input.authorName ? { author_name: input.authorName } : {},
    })
    .select("*")
    .single<CommentRow>();

  if (error || !data) {
    return null;
  }

  return mapComment(data);
}

function mapComment(row: CommentRow): GuardianCompromissoComment {
  const metadata = row.metadata ?? {};
  const authorName =
    typeof metadata.author_name === "string" ? metadata.author_name : null;

  return {
    authorName,
    authorUserId: row.author_user_id,
    body: row.body,
    createdAt: row.created_at,
    id: row.id,
    kind: row.kind,
  };
}

// --- Helpers internos ---

function validateCreateInput(
  input: CreateCompromissoInput,
):
  | { error: string; ok: false }
  | { ok: true; parcelas: CreateParcelaInput[] } {
  if (input.kind !== "promessa" && input.kind !== "acordo") {
    return { error: "Tipo de compromisso invalido.", ok: false };
  }

  if (!Number.isFinite(input.clientC2xId) || input.clientC2xId <= 0) {
    return { error: "Cliente do C2X invalido.", ok: false };
  }

  const parcelas = (input.parcelas ?? []).filter((parcela) =>
    isValidDateOnly(parcela.dueDate),
  );

  if (parcelas.length === 0) {
    return {
      error: "Informe ao menos uma parcela com data de vencimento valida.",
      ok: false,
    };
  }

  if (input.kind === "promessa" && parcelas.length !== 1) {
    return {
      error: "Promessa de pagamento aceita apenas uma parcela.",
      ok: false,
    };
  }

  return { ok: true, parcelas };
}

function buildLembreteInserts({
  compromissoId,
  kind,
  parcelas,
  promisedDate,
  today,
}: {
  compromissoId: string;
  kind: GuardianCompromissoKind;
  parcelas: ParcelaRow[];
  promisedDate: string | null;
  today: string;
}): GuardianMotorDatabase["public"]["Tables"]["guardian_compromisso_lembretes"]["Insert"][] {
  // Promessa: regua unica na data prometida (parcela_id null — chave de
  // idempotencia da promessa). Acordo: regua por parcela (parcela_id setado).
  const targets =
    kind === "promessa"
      ? [{ dueDate: promisedDate, parcelaId: null }]
      : parcelas.map((parcela) => ({
          dueDate: parcela.due_date,
          parcelaId: parcela.id,
        }));

  const inserts: GuardianMotorDatabase["public"]["Tables"]["guardian_compromisso_lembretes"]["Insert"][] =
    [];

  for (const target of targets) {
    if (!target.dueDate || !isValidDateOnly(target.dueDate)) {
      continue;
    }

    for (const offset of GUARDIAN_LEMBRETE_OFFSETS) {
      const scheduledFor = addDaysToDateOnly(target.dueDate, -offset.daysBefore);

      // Nao reagendamos janelas ja vencidas no momento do registro: evita o
      // cron disparar varios lembretes "atrasados" de uma vez.
      if (scheduledFor < today) {
        continue;
      }

      inserts.push({
        channel: "whatsapp",
        compromisso_id: compromissoId,
        kind: offset.kind,
        parcela_id: target.parcelaId,
        scheduled_for: scheduledFor,
        status: "pendente",
      });
    }
  }

  return inserts;
}

async function loadParcelasByCompromisso(
  client: GuardianMotorClient,
  compromissoIds: string[],
): Promise<Map<string, GuardianCompromissoParcela[]>> {
  const map = new Map<string, GuardianCompromissoParcela[]>();

  if (compromissoIds.length === 0) {
    return map;
  }

  const { data, error } = await client
    .from("guardian_compromisso_parcelas")
    .select("*")
    .in("compromisso_id", compromissoIds)
    .order("sequence", { ascending: true })
    .returns<ParcelaRow[]>();

  if (error || !data) {
    return map;
  }

  for (const row of data) {
    const list = map.get(row.compromisso_id) ?? [];

    list.push(mapParcela(row));
    map.set(row.compromisso_id, list);
  }

  return map;
}

async function loadLembretesByCompromisso(
  client: GuardianMotorClient,
  compromissoIds: string[],
): Promise<Map<string, GuardianCompromissoLembrete[]>> {
  const map = new Map<string, GuardianCompromissoLembrete[]>();

  if (compromissoIds.length === 0) {
    return map;
  }

  const { data, error } = await client
    .from("guardian_compromisso_lembretes")
    .select("*")
    .in("compromisso_id", compromissoIds)
    .order("scheduled_for", { ascending: true })
    .returns<LembreteRow[]>();

  if (error || !data) {
    return map;
  }

  for (const row of data) {
    const list = map.get(row.compromisso_id) ?? [];

    list.push(mapLembrete(row));
    map.set(row.compromisso_id, list);
  }

  return map;
}

// Data da ultima mensagem por compromisso (marcacao de novidade).
async function loadLastCommentByCompromisso(
  client: GuardianMotorClient,
  compromissoIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  if (compromissoIds.length === 0) {
    return map;
  }

  const { data } = await client
    .from("guardian_compromisso_comments")
    .select("compromisso_id,created_at")
    .in("compromisso_id", compromissoIds)
    .order("created_at", { ascending: false })
    .returns<{ compromisso_id: string; created_at: string }[]>();

  for (const row of data ?? []) {
    if (!map.has(row.compromisso_id)) {
      map.set(row.compromisso_id, row.created_at);
    }
  }

  return map;
}

function mapCompromisso(row: CompromissoRow): GuardianCompromisso {
  return {
    acquisitionRequestC2xId: toNullableNumber(row.acquisition_request_c2x_id),
    approvalReason: row.approval_reason,
    approvalStatus: row.approval_status ?? "em_elaboracao",
    approvedAt: row.approved_at,
    approvedByUserId: row.approved_by_user_id,
    attendanceProtocol: row.attendance_protocol,
    brokenAt: row.broken_at,
    channel: row.channel,
    clientC2xId: toNumber(row.client_c2x_id),
    cobrancaProtocol: row.cobranca_protocol,
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id,
    firstDueDate: row.first_due_date,
    fulfilledAt: row.fulfilled_at,
    id: row.id,
    installmentsCount: toNumber(row.installments_count),
    kind: row.kind,
    lastCommentAt: null,
    metadata: row.metadata ?? {},
    notes: row.notes,
    priority: row.priority,
    promisedDate: row.promised_date,
    protocol: row.protocol,
    riskScore: toNullableNumber(row.risk_score),
    stage: row.stage,
    status: row.status,
    submittedAt: row.submitted_at,
    totalAmount: toNumber(row.total_amount),
    updatedAt: row.updated_at,
    updatedByUserId: row.updated_by_user_id,
  };
}

function mapParcela(row: ParcelaRow): GuardianCompromissoParcela {
  return {
    amount: toNumber(row.amount),
    boletoUrl: row.boleto_url,
    dueDate: row.due_date,
    id: row.id,
    metadata: row.metadata ?? {},
    paidAt: row.paid_at,
    paymentC2xId: toNullableNumber(row.payment_c2x_id),
    sequence: toNumber(row.sequence),
    status: row.status,
  };
}

function mapLembrete(row: LembreteRow): GuardianCompromissoLembrete {
  return {
    channel: row.channel,
    failureReason: row.failure_reason,
    id: row.id,
    kind: row.kind,
    messageId: row.message_id,
    metaTemplate: row.meta_template,
    parcelaId: row.parcela_id,
    scheduledFor: row.scheduled_for,
    sentAt: row.sent_at,
    status: row.status,
  };
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

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// --- Datas (date-only YYYY-MM-DD em UTC, sem drift de fuso) ---

export function isValidDateOnly(value: string | null | undefined): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(date.getTime());
}

export function addDaysToDateOnly(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

export function todayDateOnly(now: Date = new Date()) {
  return now.toISOString().slice(0, 10);
}
