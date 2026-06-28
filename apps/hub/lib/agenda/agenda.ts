import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

// Modulo "Meu dia" (HUB): tarefas e retornos do operador. Compartilhado por todo
// o HUB (Iris atende a carteira; Hades trabalha a cobranca). As REUNIOES vem do
// Chronos (chronos_meetings) em leitura e sao mescladas na agenda do dia -- nao
// sao duplicadas aqui. Tabela: hub_agenda_items (migration 0038).

export type AgendaItemKind = "tarefa" | "retorno";

export type AgendaItemStatus =
  | "aberto"
  | "em_andamento"
  | "concluido"
  | "cancelado";

export type AgendaItemPriority = "baixa" | "media" | "alta" | "urgente";

export type AgendaItemChannel =
  | "whatsapp"
  | "ligacao"
  | "email"
  | "presencial"
  | "outro";

export type AgendaModule = "hades" | "iris" | "hub";

export const AGENDA_OPEN_STATUSES: AgendaItemStatus[] = ["aberto", "em_andamento"];

// --- Linha crua da tabela (snake_case) ---

type AgendaItemRow = {
  assigned_to_user_id: string | null;
  attendance_protocol: string | null;
  channel: string | null;
  client_c2x_id: number | string | null;
  client_name: string | null;
  completed_at: string | null;
  created_at: string;
  created_by_user_id: string | null;
  description: string | null;
  due_at: string | null;
  id: string;
  kind: AgendaItemKind;
  metadata: Record<string, unknown> | null;
  module: string;
  priority: AgendaItemPriority | null;
  remind_at: string | null;
  reminded_at: string | null;
  status: AgendaItemStatus;
  title: string;
  updated_at: string;
  updated_by_user_id: string | null;
};

type MeetingRow = {
  ends_at: string | null;
  host_name: string | null;
  host_user_id: string | null;
  id: string;
  protocol: string;
  room_id: string | null;
  starts_at: string | null;
  status: string;
  title: string;
};

type ParticipantRow = {
  meeting_id: string;
  user_id: string | null;
};

export type HubUserRole = "admin" | "leader" | "operator" | "viewer";

type HubUserRow = {
  display_name: string | null;
  email: string | null;
  id: string;
  role?: HubUserRole;
  status?: string;
};

// Subconjunto tipado do schema que esta lib toca (mesmo padrao do motor de
// cobranca): hub_agenda_items (RW) + hub_users/chronos_* (read-only).
export type AgendaDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      chronos_meetings: {
        Insert: never;
        Relationships: [];
        Row: MeetingRow;
        Update: never;
      };
      chronos_participants: {
        Insert: never;
        Relationships: [];
        Row: ParticipantRow;
        Update: never;
      };
      hub_agenda_items: {
        Insert: {
          assigned_to_user_id?: string | null;
          attendance_protocol?: string | null;
          channel?: string | null;
          client_c2x_id?: number | null;
          client_name?: string | null;
          created_by_user_id?: string | null;
          description?: string | null;
          due_at?: string | null;
          kind: AgendaItemKind;
          metadata?: Record<string, unknown>;
          module?: string;
          priority?: AgendaItemPriority | null;
          remind_at?: string | null;
          status?: AgendaItemStatus;
          title: string;
          updated_by_user_id?: string | null;
        };
        Relationships: [];
        Row: AgendaItemRow;
        Update: {
          assigned_to_user_id?: string | null;
          channel?: string | null;
          completed_at?: string | null;
          description?: string | null;
          due_at?: string | null;
          metadata?: Record<string, unknown>;
          priority?: AgendaItemPriority | null;
          remind_at?: string | null;
          reminded_at?: string | null;
          status?: AgendaItemStatus;
          title?: string;
          updated_by_user_id?: string | null;
        };
      };
      hub_users: {
        Insert: never;
        Relationships: [];
        Row: HubUserRow;
        Update: never;
      };
    };
    Views: Record<string, never>;
  };
};

export type AgendaClient = SupabaseClient<AgendaDatabase>;

// --- Tipos de dominio (camelCase, prontos pra UI/JSON) ---

export type AgendaItem = {
  assignedToUserId: string | null;
  attendanceProtocol: string | null;
  channel: AgendaItemChannel | null;
  clientC2xId: number | null;
  clientName: string | null;
  completedAt: string | null;
  createdAt: string;
  createdByUserId: string | null;
  description: string | null;
  dueAt: string | null;
  id: string;
  kind: AgendaItemKind;
  metadata: Record<string, unknown>;
  module: AgendaModule;
  ownerName: string | null;
  priority: AgendaItemPriority | null;
  remindAt: string | null;
  remindedAt: string | null;
  status: AgendaItemStatus;
  title: string;
  updatedAt: string;
};

export type AgendaMeeting = {
  endsAt: string | null;
  hostName: string | null;
  id: string;
  protocol: string;
  startsAt: string | null;
  status: string;
  title: string;
};

// --- Entradas das operacoes ---

export type CreateAgendaItemInput = {
  assignedToUserId?: string | null;
  attendanceProtocol?: string | null;
  channel?: AgendaItemChannel | null;
  clientC2xId?: number | null;
  clientName?: string | null;
  description?: string | null;
  dueAt?: string | null;
  kind: AgendaItemKind;
  metadata?: Record<string, unknown>;
  module?: AgendaModule;
  priority?: AgendaItemPriority | null;
  remindAt?: string | null;
  title: string;
};

export type UpdateAgendaItemInput = {
  assignedToUserId?: string | null;
  channel?: AgendaItemChannel | null;
  description?: string | null;
  dueAt?: string | null;
  priority?: AgendaItemPriority | null;
  remindAt?: string | null;
  status?: AgendaItemStatus;
  title?: string;
};

// --- Cliente tipado (service_role; a sessao e validada na rota) ---

export function createAgendaClient(): AgendaClient | null {
  const { serviceRoleKey, url } = getServerSupabaseConfig();

  if (!url || !serviceRoleKey) {
    return null;
  }

  return createClient<AgendaDatabase>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// --- Operacoes ---

export async function createAgendaItem(
  client: AgendaClient,
  input: CreateAgendaItemInput,
  userId: string | null,
): Promise<AgendaItem | null> {
  const title = input.title.trim();

  if (!title) {
    return null;
  }

  // Dono default = criador (o "Meu dia" de quem registrou), salvo override.
  const assignedTo =
    input.assignedToUserId === undefined
      ? userId
      : input.assignedToUserId;

  const { data, error } = await client
    .from("hub_agenda_items")
    .insert({
      assigned_to_user_id: assignedTo,
      attendance_protocol: cleanText(input.attendanceProtocol),
      channel: input.channel ?? null,
      client_c2x_id: input.clientC2xId ?? null,
      client_name: cleanText(input.clientName),
      created_by_user_id: userId,
      description: cleanText(input.description),
      due_at: input.dueAt ?? null,
      kind: input.kind,
      metadata: input.metadata ?? {},
      module: input.module ?? "hub",
      priority: input.priority ?? null,
      remind_at: input.remindAt ?? null,
      status: "aberto",
      title,
      updated_by_user_id: userId,
    })
    .select("*")
    .single<AgendaItemRow>();

  if (error || !data) {
    return null;
  }

  return mapAgendaItem(data);
}

// Itens do "Meu dia" de um dono. Por padrao traz os abertos/em andamento; passe
// includeDone para a coluna de concluidos. Ordena por prazo (nulos por ultimo).
export async function listAgendaItemsForUser(
  client: AgendaClient,
  userId: string,
  options: { includeDone?: boolean } = {},
): Promise<AgendaItem[]> {
  let query = client
    .from("hub_agenda_items")
    .select("*")
    .eq("assigned_to_user_id", userId);

  if (!options.includeDone) {
    query = query.in("status", AGENDA_OPEN_STATUSES);
  }

  const { data, error } = await query
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(500)
    .returns<AgendaItemRow[]>();

  if (error || !data?.length) {
    return [];
  }

  return hydrateOwnerNames(client, data.map(mapAgendaItem));
}

// Itens vinculados a um atendimento (link de entrada no board/atendimento).
export async function listAgendaItemsByProtocol(
  client: AgendaClient,
  attendanceProtocol: string,
): Promise<AgendaItem[]> {
  const protocol = attendanceProtocol.trim();

  if (!protocol) {
    return [];
  }

  const { data, error } = await client
    .from("hub_agenda_items")
    .select("*")
    .eq("attendance_protocol", protocol)
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<AgendaItemRow[]>();

  if (error || !data?.length) {
    return [];
  }

  return hydrateOwnerNames(client, data.map(mapAgendaItem));
}

export async function updateAgendaItem(
  client: AgendaClient,
  itemId: string,
  input: UpdateAgendaItemInput,
  userId: string | null,
): Promise<AgendaItem | null> {
  const update: AgendaDatabase["public"]["Tables"]["hub_agenda_items"]["Update"] =
    { updated_by_user_id: userId };

  if (input.title !== undefined) {
    update.title = input.title.trim();
  }
  if (input.description !== undefined) {
    update.description = cleanText(input.description);
  }
  if (input.priority !== undefined) {
    update.priority = input.priority;
  }
  if (input.channel !== undefined) {
    update.channel = input.channel;
  }
  if (input.dueAt !== undefined) {
    update.due_at = input.dueAt;
  }
  if (input.remindAt !== undefined) {
    update.remind_at = input.remindAt;
  }
  if (input.assignedToUserId !== undefined) {
    update.assigned_to_user_id = input.assignedToUserId;
  }
  if (input.status !== undefined) {
    update.status = input.status;
    // Concluir/cancelar carimba o fim; reabrir limpa.
    update.completed_at =
      input.status === "concluido" ? new Date().toISOString() : null;
  }

  const { data, error } = await client
    .from("hub_agenda_items")
    .update(update)
    .eq("id", itemId)
    .select("*")
    .single<AgendaItemRow>();

  if (error || !data) {
    return null;
  }

  return mapAgendaItem(data);
}

export async function deleteAgendaItem(
  client: AgendaClient,
  itemId: string,
): Promise<boolean> {
  const { error } = await client
    .from("hub_agenda_items")
    .delete()
    .eq("id", itemId);

  return !error;
}

// Reunioes do Chronos do usuario numa janela (read-only). Pega as que ele
// organiza (host) ou participa, com inicio dentro do intervalo, ainda vivas.
export async function listUserMeetings(
  client: AgendaClient,
  userId: string,
  fromIso: string,
  toIso: string,
): Promise<AgendaMeeting[]> {
  const { data: participantRows } = await client
    .from("chronos_participants")
    .select("meeting_id,user_id")
    .eq("user_id", userId)
    .limit(500)
    .returns<ParticipantRow[]>();

  const participantMeetingIds = uniqueStrings(
    (participantRows ?? [])
      .map((row) => row.meeting_id)
      .filter((id): id is string => Boolean(id)),
  );

  const orFilters = [`host_user_id.eq.${userId}`];
  if (participantMeetingIds.length > 0) {
    orFilters.push(`id.in.(${participantMeetingIds.join(",")})`);
  }

  const { data, error } = await client
    .from("chronos_meetings")
    .select("id,protocol,title,starts_at,ends_at,status,host_name,host_user_id")
    .or(orFilters.join(","))
    .gte("starts_at", fromIso)
    .lte("starts_at", toIso)
    .not("status", "in", "(cancelled,closed)")
    .order("starts_at", { ascending: true })
    .limit(200)
    .returns<MeetingRow[]>();

  if (error || !data?.length) {
    return [];
  }

  return data.map((row) => ({
    endsAt: row.ends_at,
    hostName: row.host_name,
    id: row.id,
    protocol: row.protocol,
    startsAt: row.starts_at,
    status: row.status,
    title: row.title,
  }));
}

// --- Helpers ---

async function hydrateOwnerNames(
  client: AgendaClient,
  items: AgendaItem[],
): Promise<AgendaItem[]> {
  const ownerIds = uniqueStrings(
    items
      .map((item) => item.assignedToUserId)
      .filter((id): id is string => Boolean(id)),
  );

  if (ownerIds.length === 0) {
    return items;
  }

  const { data } = await client
    .from("hub_users")
    .select("id,display_name,email")
    .in("id", ownerIds)
    .returns<HubUserRow[]>();

  const nameById = new Map<string, string>();
  for (const user of data ?? []) {
    const name = user.display_name?.trim() || user.email?.trim();
    if (name) {
      nameById.set(user.id, name);
    }
  }

  return items.map((item) => ({
    ...item,
    ownerName: item.assignedToUserId
      ? nameById.get(item.assignedToUserId) ?? null
      : null,
  }));
}

function mapAgendaItem(row: AgendaItemRow): AgendaItem {
  return {
    assignedToUserId: row.assigned_to_user_id,
    attendanceProtocol: row.attendance_protocol,
    channel: isChannel(row.channel) ? row.channel : null,
    clientC2xId: toNullableNumber(row.client_c2x_id),
    clientName: row.client_name,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id,
    description: row.description,
    dueAt: row.due_at,
    id: row.id,
    kind: row.kind,
    metadata: row.metadata ?? {},
    module: isModule(row.module) ? row.module : "hub",
    ownerName: null,
    priority: row.priority,
    remindAt: row.remind_at,
    remindedAt: row.reminded_at,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

function isChannel(value: string | null): value is AgendaItemChannel {
  return (
    value === "whatsapp" ||
    value === "ligacao" ||
    value === "email" ||
    value === "presencial" ||
    value === "outro"
  );
}

function isModule(value: string): value is AgendaModule {
  return value === "hades" || value === "iris" || value === "hub";
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function toNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
