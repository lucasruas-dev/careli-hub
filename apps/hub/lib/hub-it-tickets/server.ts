import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { publishHubNotification } from "@/lib/notifications/publish";
import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

import {
  hubItTicketCategories,
  hubItTicketPriorityLabels,
  hubItTicketPriorities,
  hubItTicketRoadmapTypeLabels,
  hubItTicketRoadmapTypes,
  hubItTicketStatusLabels,
  hubItTicketStatuses,
  type HubItTicket,
  type HubItTicketAttachment,
  type HubItTicketAttachmentInput,
  type HubItTicketBacklogInput,
  type HubItTicketCategory,
  type HubItTicketDeliveryDecisionAction,
  type HubItTicketDeliveryDecisionStatus,
  type HubItTicketCreateInput,
  type HubItTicketEvent,
  type HubItTicketListScope,
  type HubItTicketPriority,
  type HubItTicketStatus,
  type HubItTicketUpdateInput,
} from "./types";

const ZEUS_VALIDATION_TIMEOUT_MESSAGE = "Ticket encerrado";

type HubItTicketUserRow = {
  avatar_url?: string | null;
  display_name: string;
  email: string;
  id: string;
  operational_profile?: string | null;
  role: "admin" | "leader" | "operator" | "viewer";
  status: "active" | "archived" | "disabled";
};

type AuthorizedHubItTicketUser = {
  avatarUrl?: string | null;
  email: string;
  id: string;
  name: string;
  operationalProfile?: string | null;
  role: HubItTicketUserRow["role"];
};

type HubItTicketRow = {
  actual_result: string | null;
  admin_response: string | null;
  assigned_to_user_id: string | null;
  assigned_to_avatar_url: string | null;
  assigned_to_email: string | null;
  assigned_to_name: string | null;
  category: HubItTicketCategory;
  created_at: string;
  expected_result: string | null;
  id: string;
  last_response_by_user_id: string | null;
  last_response_by_avatar_url: string | null;
  last_response_by_email: string | null;
  last_response_by_name: string | null;
  metadata: Record<string, unknown>;
  module: string;
  priority: HubItTicketPriority;
  protocol: string;
  requested_by_user_id: string;
  requester_avatar_url: string | null;
  requester_email: string | null;
  requester_name: string;
  resolution_summary: string | null;
  resolved_at: string | null;
  source_path: string | null;
  source_url: string | null;
  status: HubItTicketStatus;
  technical_summary: string;
  title: string;
  updated_at: string;
  user_description: string;
};

type HubItTicketInsert = Omit<
  HubItTicketRow,
  | "admin_response"
    | "assigned_to_user_id"
    | "assigned_to_avatar_url"
    | "assigned_to_email"
    | "assigned_to_name"
    | "created_at"
    | "id"
    | "last_response_by_user_id"
    | "last_response_by_avatar_url"
    | "last_response_by_email"
    | "last_response_by_name"
  | "resolution_summary"
  | "resolved_at"
  | "updated_at"
>;

type HubItTicketUpdate = Partial<
  Pick<
    HubItTicketRow,
    | "admin_response"
    | "assigned_to_avatar_url"
    | "assigned_to_email"
    | "assigned_to_name"
    | "assigned_to_user_id"
    | "last_response_by_avatar_url"
    | "last_response_by_email"
    | "last_response_by_name"
    | "last_response_by_user_id"
    | "metadata"
    | "resolution_summary"
    | "resolved_at"
    | "status"
  >
>;

type HubItTicketEventRow = {
  created_at: string;
  created_by_user_id: string | null;
  event_type: HubItTicketEvent["type"];
  id: string;
  message: string;
  metadata: Record<string, unknown>;
  technical_note: string | null;
  ticket_id: string;
  visible_to_requester: boolean;
};

type HubItTicketAttachmentRow = {
  captured_at: string;
  content_data_url: string | null;
  created_at: string;
  created_by_user_id: string | null;
  file_name: string;
  id: string;
  metadata: Record<string, unknown>;
  mime_type: string;
  size_bytes: number;
  ticket_id: string;
  type: HubItTicketAttachment["type"];
};

type HubNotificationSeverity = "danger" | "info" | "neutral" | "success" | "warning";

type HubNotificationRow = {
  action_href: string | null;
  created_at: string;
  id: string;
  module_id: string | null;
  read_at: string | null;
  recipient_user_id: string;
  severity: HubNotificationSeverity;
  title: string;
  workspace_id: string | null;
};

type HubNotificationInsert = {
  action_href?: string | null;
  module_id?: string | null;
  recipient_user_id: string;
  severity?: HubNotificationSeverity;
  title: string;
  workspace_id?: string | null;
};

type HubItTicketsDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: {
      hub_event_severity: HubNotificationSeverity;
      hub_it_ticket_category: HubItTicketCategory;
      hub_it_ticket_priority: HubItTicketPriority;
      hub_it_ticket_status: HubItTicketStatus;
    };
    Functions: Record<string, never>;
    Tables: {
      hub_it_ticket_attachments: {
        Insert: Omit<HubItTicketAttachmentRow, "created_at" | "id">;
        Relationships: [];
        Row: HubItTicketAttachmentRow;
        Update: never;
      };
      hub_it_ticket_events: {
        Insert: Omit<HubItTicketEventRow, "created_at" | "id">;
        Relationships: [];
        Row: HubItTicketEventRow;
        Update: never;
      };
      hub_it_tickets: {
        Insert: HubItTicketInsert;
        Relationships: [];
        Row: HubItTicketRow;
        Update: HubItTicketUpdate;
      };
      hub_notifications: {
        Insert: HubNotificationInsert;
        Relationships: [];
        Row: HubNotificationRow;
        Update: never;
      };
      hub_users: {
        Insert: never;
        Relationships: [];
        Row: HubItTicketUserRow;
        Update: never;
      };
    };
    Views: Record<string, never>;
  };
};

type HubItTicketsClient = ReturnType<typeof createClient<HubItTicketsDatabase>>;

type HubItTicketAuthResult =
  | {
      ok: true;
      user: AuthorizedHubItTicketUser;
    }
  | {
      ok: false;
      response: NextResponse<{ error: string }>;
    };

type HubItTicketsLocalStore = {
  tickets: HubItTicket[];
};

const maxTextLength = 5_000;
const maxAttachmentBytes = 6_000_000;
const staleValidationThresholdMs = 3 * 86_400_000;
const validationTicketStatuses = new Set<HubItTicketStatus>([
  "aguardando_cliente",
  "em_homologacao",
  "em_producao",
  "resolvido",
]);
const localStorePath = path.join(
  process.cwd(),
  ".next",
  "cache",
  "hub-it-tickets.json",
);

export async function authorizeHubItTicketRequest(
  request: NextRequest,
  options?: {
    adminOnly?: boolean;
  },
): Promise<HubItTicketAuthResult> {
  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sessao ausente para HelpDesk." },
        { status: 401 },
      ),
    };
  }

  const adminClient = createHubItTicketClient();

  if (!adminClient) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Supabase server-side nao configurado para HelpDesk." },
        { status: 503 },
      ),
    };
  }

  const { data: authData, error: authError } =
    await adminClient.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sessao invalida para HelpDesk." },
        { status: 401 },
      ),
    };
  }

  const { data, error } = await adminClient
    .from("hub_users")
    .select("id,email,display_name,avatar_url,role,status,operational_profile")
    .eq("id", authData.user.id)
    .maybeSingle<HubItTicketUserRow>();

  if (error || !data || data.status !== "active") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Usuario sem acesso ativo ao Hub." },
        { status: 403 },
      ),
    };
  }

  if (options?.adminOnly && !isHubItTicketAdmin(data)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Fila HelpDesk liberada somente para Zeus adm." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    user: {
      avatarUrl: data.avatar_url,
      email: data.email,
      id: data.id,
      name: data.display_name,
      operationalProfile: data.operational_profile,
      role: data.role,
    },
  };
}

export async function listHubItTickets({
  includeDetails = true,
  protocol,
  scope,
  user,
}: {
  includeDetails?: boolean;
  protocol?: string;
  scope: HubItTicketListScope;
  user: AuthorizedHubItTicketUser;
}) {
  const adminClient = createHubItTicketClient();
  const canSeeAll = scope === "all" && isAuthorizedHubItTicketAdmin(user);

  if (!adminClient) {
    return listLocalHubItTickets({ canSeeAll, protocol, userId: user.id });
  }

  try {
    let query = adminClient
      .from("hub_it_tickets")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(protocol ? 1 : 120);

    if (!canSeeAll) {
      query = query.eq("requested_by_user_id", user.id);
    }

    if (protocol) {
      query = query.eq("protocol", protocol);
    }

    const { data, error } = await query;

    if (error) {
      if (shouldUseLocalFallback(error)) {
        return listLocalHubItTickets({ canSeeAll, protocol, userId: user.id });
      }

      throw new Error(error.message);
    }

    const rows = await autoFinalizeStaleValidationRows(adminClient, data ?? []);

    if (!includeDetails) {
      return rows.map((row) => mapTicketRow(row, [], []));
    }

    return hydrateTicketRows(adminClient, rows);
  } catch (error) {
    if (shouldUseLocalFallback(error)) {
      return listLocalHubItTickets({ canSeeAll, protocol, userId: user.id });
    }

    throw error;
  }
}

export async function createHubItTicket({
  input,
  user,
}: {
  input: unknown;
  user: AuthorizedHubItTicketUser;
}) {
  const normalizedInput = normalizeCreateInput(input);
  const adminClient = createHubItTicketClient();
  const protocol = await generateHubItTicketProtocol(adminClient);

  if (!adminClient) {
    return createLocalHubItTicket({ input: normalizedInput, protocol, user });
  }

  try {
    const deliveryMetadata = buildInitialDeliveryMetadata(
      normalizedInput.requestedDeliveryDate,
    );
    const { data: ticket, error } = await adminClient
      .from("hub_it_tickets")
      .insert({
        actual_result: normalizedInput.actualResult ?? null,
        category: normalizedInput.category,
        expected_result: normalizedInput.expectedResult ?? null,
        metadata: {
          deliveryAgreement: deliveryMetadata,
          source: "hub-athena-ticket-ti",
          userAgent:
            typeof normalizedInput.sourceUrl === "string"
              ? "browser"
              : "unknown",
        },
        module: normalizedInput.module,
        priority: normalizedInput.priority,
        protocol,
        requested_by_user_id: user.id,
        requester_avatar_url: user.avatarUrl ?? null,
        requester_email: user.email,
        requester_name: user.name,
        source_path: normalizedInput.sourcePath ?? null,
        source_url: normalizedInput.sourceUrl ?? null,
        status: "novo",
        technical_summary: normalizedInput.technicalSummary,
        title: normalizedInput.title,
        user_description: normalizedInput.userDescription,
      })
      .select("*")
      .single();

    if (error) {
      if (shouldUseLocalFallback(error)) {
        return createLocalHubItTicket({ input: normalizedInput, protocol, user });
      }

      throw new Error(error.message);
    }

    await insertTicketEvent(adminClient, {
      createdByUserId: user.id,
      message: `Zeus: ticket aberto pelo usuario. Data solicitada: ${formatDateOnlyForMessage(normalizedInput.requestedDeliveryDate)}.`,
      metadata: {
        deliveryAgreement: deliveryMetadata,
        source: "hub-athena-ticket-ti",
      },
      technicalNote: normalizedInput.technicalSummary,
      ticketId: ticket.id,
      type: "created",
      visibleToRequester: true,
    });

    if (normalizedInput.attachments.length > 0) {
      await insertTicketAttachments(adminClient, {
        attachments: normalizedInput.attachments,
        ticketId: ticket.id,
        userId: user.id,
      });
      await insertTicketEvent(adminClient, {
        createdByUserId: user.id,
        message: `${normalizedInput.attachments.length} anexo(s) enviado(s) para analise tecnica.`,
        metadata: { source: "hub-athena-ticket-ti" },
        technicalNote: null,
        ticketId: ticket.id,
        type: "attachment_added",
        visibleToRequester: true,
      });
    }

    const [hydratedTicket] = await hydrateTicketRows(adminClient, [ticket]);

    return hydratedTicket;
  } catch (error) {
    if (shouldUseLocalFallback(error)) {
      return createLocalHubItTicket({ input: normalizedInput, protocol, user });
    }

    throw error;
  }
}

async function autoFinalizeStaleValidationRows(
  adminClient: HubItTicketsClient,
  rows: HubItTicketRow[],
) {
  const now = new Date();
  const nowIso = now.toISOString();
  const staleRows = rows.filter((row) => isStaleValidationRow(row, now));

  if (staleRows.length === 0) {
    return rows;
  }

  const updatedRowsById = new Map<string, HubItTicketRow>();

  for (const row of staleRows) {
    const { data: updatedRow, error } = await adminClient
      .from("hub_it_tickets")
      .update({
        resolved_at: nowIso,
        status: "fechado",
      })
      .eq("id", row.id)
      .in("status", Array.from(validationTicketStatuses))
      .select("*")
      .maybeSingle<HubItTicketRow>();

    if (error || !updatedRow) {
      continue;
    }

    updatedRowsById.set(row.id, updatedRow);
    await insertTicketEvent(adminClient, {
      createdByUserId: null,
      message: ZEUS_VALIDATION_TIMEOUT_MESSAGE,
      metadata: { source: "helpdesk-validation-timeout" },
      technicalNote: null,
      ticketId: row.id,
      type: "closed",
      visibleToRequester: true,
    });
  }

  if (updatedRowsById.size === 0) {
    return rows;
  }

  return rows.map((row) => updatedRowsById.get(row.id) ?? row);
}

function isStaleValidationRow(row: HubItTicketRow, now: Date) {
  if (!validationTicketStatuses.has(row.status)) {
    return false;
  }

  const updatedAt = new Date(row.updated_at);

  if (Number.isNaN(updatedAt.getTime())) {
    return false;
  }

  return now.getTime() - updatedAt.getTime() >= staleValidationThresholdMs;
}

export async function updateHubItTicket({
  input,
  user,
}: {
  input: unknown;
  user: AuthorizedHubItTicketUser;
}) {
  const normalizedInput = normalizeUpdateInput(input);
  const adminClient = createHubItTicketClient();

  if (!adminClient) {
    return updateLocalHubItTicket({ input: normalizedInput, user });
  }

  try {
    const now = new Date().toISOString();
    const { data: currentTicket, error: currentTicketError } = await adminClient
      .from("hub_it_tickets")
      .select("*")
      .eq("protocol", normalizedInput.protocol)
      .single();

    if (currentTicketError) {
      if (shouldUseLocalFallback(currentTicketError)) {
        return updateLocalHubItTicket({ input: normalizedInput, user });
      }

      throw new Error(currentTicketError.message);
    }

    const userAction = normalizedInput.action;

    if (
      userAction === "customer_close" ||
      userAction === "customer_comment" ||
      userAction === "customer_review"
    ) {
      if (currentTicket.requested_by_user_id !== user.id) {
        throw new Error("Somente o solicitante pode encerrar ou devolver o ticket para revisao.");
      }

      const nextStatus =
        userAction === "customer_close"
          ? "fechado"
          : userAction === "customer_review"
            ? "em_revisao"
            : currentTicket.status;
      const { data: ticket, error } = await adminClient
        .from("hub_it_tickets")
        .update({
          last_response_by_avatar_url: user.avatarUrl ?? null,
          last_response_by_email: user.email,
          last_response_by_name: user.name,
          last_response_by_user_id: user.id,
          resolved_at:
            userAction === "customer_close"
              ? now
              : userAction === "customer_review"
                ? null
                : currentTicket.resolved_at,
          status: nextStatus,
        })
        .eq("protocol", normalizedInput.protocol)
        .select("*")
        .single();

      if (error) {
        if (shouldUseLocalFallback(error)) {
          return updateLocalHubItTicket({ input: normalizedInput, user });
        }

        throw new Error(error.message);
      }

      await insertTicketEvent(adminClient, {
        createdByUserId: user.id,
        message:
          userAction === "customer_close"
            ? "Solicitante confirmou a resolucao e encerrou o ticket."
            : normalizedInput.customerResponse ||
              (userAction === "customer_review"
                ? "Solicitante devolveu o ticket para revisao."
                : "Solicitante enviou uma mensagem para o operador."),
        metadata: { source: "hub-ticket-ti-user" },
        technicalNote: null,
        ticketId: ticket.id,
        type:
          userAction === "customer_close"
            ? "closed"
            : userAction === "customer_review"
              ? "review_requested"
              : "user_comment",
        visibleToRequester: true,
      });

      if (
        (userAction === "customer_review" ||
          userAction === "customer_comment") &&
        normalizedInput.attachments &&
        normalizedInput.attachments.length > 0
      ) {
        await insertTicketAttachments(adminClient, {
          attachments: normalizedInput.attachments,
          ticketId: ticket.id,
          userId: user.id,
        });
      }

      await insertHelpDeskNotification({
        actionHref: `/zeus?ticket=${encodeURIComponent(ticket.protocol)}`,
        actorUserId: user.id,
        protocol: ticket.protocol,
        recipientUserId: ticket.assigned_to_user_id,
        severity: userAction === "customer_close" ? "success" : "warning",
        title:
          userAction === "customer_close"
            ? `HelpDesk ${ticket.protocol} finalizado pelo solicitante`
            : userAction === "customer_review"
              ? `HelpDesk ${ticket.protocol} voltou para revisao`
              : `Nova mensagem no HelpDesk ${ticket.protocol}`,
      });

      const [hydratedTicket] = await hydrateTicketRows(adminClient, [ticket]);

      return hydratedTicket;
    }

    if (!isAuthorizedHubItTicketAdmin(user)) {
      throw new Error("Somente Zeus adm pode responder HelpDesk.");
    }

    const adminAttachments = normalizedInput.attachments ?? [];
    const nextStatus = resolveAdminTicketNextStatus({
      currentRoadmap: getRoadmapFromMetadata(currentTicket.metadata),
      currentStatus: currentTicket.status,
      input: normalizedInput,
    });
    const deliveryDecision = buildDeliveryDecisionMetadata({
      currentMetadata: currentTicket.metadata,
      input: normalizedInput,
      now,
      user,
    });
    const roadmapBacklog = buildRoadmapBacklogMetadata({
      currentMetadata: deliveryDecision.metadata,
      input: normalizedInput,
      nextStatus,
      now,
      user,
    });
    const updatePayload: HubItTicketUpdate = {
      admin_response: normalizedInput.adminResponse ?? null,
      assigned_to_avatar_url: user.avatarUrl ?? null,
      assigned_to_email: user.email,
      assigned_to_name: user.name,
      assigned_to_user_id: user.id,
      last_response_by_avatar_url: user.avatarUrl ?? null,
      last_response_by_email: user.email,
      last_response_by_name: user.name,
      last_response_by_user_id: user.id,
      resolution_summary: normalizedInput.resolutionSummary ?? null,
      resolved_at: nextStatus === "fechado" ? now : null,
      status: nextStatus,
    };

    if (deliveryDecision.changed || roadmapBacklog.changed) {
      updatePayload.metadata = roadmapBacklog.metadata;
    }

    const { data: ticket, error } = await adminClient
      .from("hub_it_tickets")
      .update(updatePayload)
      .eq("protocol", normalizedInput.protocol)
      .select("*")
      .single();

    if (error) {
      if (shouldUseLocalFallback(error)) {
        return updateLocalHubItTicket({ input: normalizedInput, user });
      }

      throw new Error(error.message);
    }

    const ticketEventMetadata = roadmapBacklog.metadata as Record<
      string,
      unknown
    >;

    await insertTicketEvent(adminClient, {
      createdByUserId: user.id,
      message:
        buildAdminTicketEventMessage({
          actorName: user.name,
          deliveryMessage: deliveryDecision.message,
          roadmapMessage: roadmapBacklog.message,
          attachmentsCount: adminAttachments.length,
          response: normalizedInput.adminResponse,
          status: nextStatus,
        }),
      metadata: {
        ...(deliveryDecision.changed
          ? { deliveryAgreement: ticketEventMetadata["deliveryAgreement"] }
          : {}),
        ...(roadmapBacklog.changed
          ? { roadmap: ticketEventMetadata["roadmap"] }
          : {}),
        ...(adminAttachments.length > 0
          ? { attachmentsCount: adminAttachments.length }
          : {}),
        source: "squadops-ticket-ti",
      },
      technicalNote: normalizedInput.resolutionSummary ?? null,
      ticketId: ticket.id,
      type:
        nextStatus === "fechado"
          ? "resolved"
          : (deliveryDecision.changed || roadmapBacklog.changed) &&
              !normalizedInput.adminResponse
            ? "status_changed"
            : "admin_reply",
      visibleToRequester: true,
    });

    if (adminAttachments.length > 0) {
      await insertTicketAttachments(adminClient, {
        attachments: adminAttachments,
        ticketId: ticket.id,
        userId: user.id,
      });
    }

    await insertHelpDeskNotification({
      actionHref: "/",
      actorUserId: user.id,
      protocol: ticket.protocol,
      recipientUserId: ticket.requested_by_user_id,
      severity: nextStatus === "aguardando_cliente" ? "success" : "info",
      title:
        nextStatus === "aguardando_cliente"
          ? `HelpDesk ${ticket.protocol} pronto para sua validacao`
          : `Nova devolutiva no HelpDesk ${ticket.protocol}`,
    });

    const [hydratedTicket] = await hydrateTicketRows(adminClient, [ticket]);

    return hydratedTicket;
  } catch (error) {
    if (shouldUseLocalFallback(error)) {
      return updateLocalHubItTicket({ input: normalizedInput, user });
    }

    throw error;
  }
}

function createHubItTicketClient() {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient<HubItTicketsDatabase>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function hydrateTicketRows(
  adminClient: HubItTicketsClient,
  rows: HubItTicketRow[],
) {
  if (rows.length === 0) {
    return [];
  }

  const ticketIds = rows.map((row) => row.id);
  const [{ data: events }, { data: attachments }] = await Promise.all([
    adminClient
      .from("hub_it_ticket_events")
      .select("*")
      .in("ticket_id", ticketIds)
      .order("created_at", { ascending: false }),
    adminClient
      .from("hub_it_ticket_attachments")
      .select("*")
      .in("ticket_id", ticketIds)
      .order("created_at", { ascending: false }),
  ]);

  const eventRows = events ?? [];
  const actorIds = [
    ...new Set(
      eventRows
        .map((event) => event.created_by_user_id)
        .filter((userId): userId is string => Boolean(userId)),
    ),
  ];
  const eventActorsById = await loadHubItTicketEventActors(
    adminClient,
    actorIds,
  );
  const eventsByTicketId = groupByTicketId(eventRows);
  const attachmentsByTicketId = groupByTicketId(attachments ?? []);

  return rows.map((row) =>
    mapTicketRow(
      row,
      eventsByTicketId
        .get(row.id)
        ?.map((event) => mapEventRow(event, eventActorsById)) ?? [],
      attachmentsByTicketId.get(row.id)?.map(mapAttachmentRow) ?? [],
    ),
  );
}

async function loadHubItTicketEventActors(
  adminClient: HubItTicketsClient,
  userIds: string[],
) {
  if (userIds.length === 0) {
    return new Map<string, HubItTicket["requester"]>();
  }

  const { data } = await adminClient
    .from("hub_users")
    .select("id,display_name,email,avatar_url")
    .in("id", userIds);

  return new Map(
    (data ?? []).map((user) => [
      user.id,
      {
        avatarUrl: user.avatar_url,
        email: user.email,
        id: user.id,
        name: user.display_name,
      } satisfies HubItTicket["requester"],
    ]),
  );
}

async function insertTicketEvent(
  adminClient: HubItTicketsClient,
  input: {
    createdByUserId: string | null;
    message: string;
    metadata: Record<string, unknown>;
    technicalNote: string | null;
    ticketId: string;
    type: HubItTicketEvent["type"];
    visibleToRequester: boolean;
  },
) {
  const { error } = await adminClient.from("hub_it_ticket_events").insert({
    created_by_user_id: input.createdByUserId,
    event_type: input.type,
    message: input.message,
    metadata: input.metadata,
    technical_note: input.technicalNote,
    ticket_id: input.ticketId,
    visible_to_requester: input.visibleToRequester,
  });

  if (error) {
    throw new Error(error.message);
  }
}

async function insertHelpDeskNotification(input: {
  actionHref: string;
  actorUserId: string;
  protocol: string;
  recipientUserId?: string | null;
  severity: HubNotificationSeverity;
  title: string;
}) {
  if (!input.recipientUserId || input.recipientUserId === input.actorUserId) {
    return;
  }

  // Central unica do Panteon: grava a linha em hub_notifications (a central assina por
  // realtime) E dispara o Web Push do SO. Best-effort: o ticket e a fonte da verdade.
  await publishHubNotification({
    actionHref: input.actionHref,
    body: `Chamado ${input.protocol}`,
    context: { protocol: input.protocol },
    kind: "atendimento",
    moduleId: "zeus",
    push: { url: input.actionHref },
    recipientUserIds: [input.recipientUserId],
    severity: input.severity,
    title: input.title,
  });
}

async function insertTicketAttachments(
  adminClient: HubItTicketsClient,
  input: {
    attachments: HubItTicketAttachmentInput[];
    ticketId: string;
    userId: string;
  },
) {
  const { error } = await adminClient.from("hub_it_ticket_attachments").insert(
    input.attachments.map((attachment) => ({
      captured_at: attachment.capturedAt,
      content_data_url: attachment.dataUrl ?? null,
      created_by_user_id: input.userId,
      file_name: attachment.fileName,
      metadata: { source: "hub-athena-ticket-ti" },
      mime_type: attachment.mimeType,
      size_bytes: attachment.sizeBytes,
      ticket_id: input.ticketId,
      type: attachment.type,
    })),
  );

  if (error) {
    throw new Error(error.message);
  }
}

function normalizeCreateInput(input: unknown): HubItTicketCreateInput & {
  attachments: HubItTicketAttachmentInput[];
} {
  if (!input || typeof input !== "object") {
    throw new Error("Informe os dados do HelpDesk.");
  }

  const payload = input as Partial<HubItTicketCreateInput>;
  const userDescription = sanitizeRequiredText(
    payload.userDescription,
    "Descreva o erro, melhoria ou sugestao.",
    3,
  );
  const title = sanitizeRequiredText(payload.title, "Informe um titulo tecnico.", 4);
  const technicalSummary = sanitizeRequiredText(
    payload.technicalSummary,
    "A leitura tecnica do Zeus e obrigatoria.",
    10,
  );
  const moduleName = sanitizeRequiredText(payload.module, "Informe o modulo.", 2);
  const category = isTicketCategory(payload.category)
    ? payload.category
    : "outro";
  const priority = isTicketPriority(payload.priority)
    ? payload.priority
    : "media";
  const requestedDeliveryDate = normalizeDateOnly(
    payload.requestedDeliveryDate,
    "Informe a data de entrega desejada para o HelpDesk.",
  );

  return {
    actualResult: sanitizeOptionalText(payload.actualResult),
    attachments: normalizeAttachments(payload.attachments),
    category,
    expectedResult: sanitizeOptionalText(payload.expectedResult),
    module: moduleName,
    priority,
    requestedDeliveryDate,
    sourcePath: sanitizeOptionalText(payload.sourcePath, 300),
    sourceUrl: sanitizeOptionalText(payload.sourceUrl, 500),
    technicalSummary,
    title,
    userDescription,
  };
}

function normalizeUpdateInput(input: unknown): HubItTicketUpdateInput {
  if (!input || typeof input !== "object") {
    throw new Error("Informe os dados de atualizacao do HelpDesk.");
  }

  const payload = input as Partial<HubItTicketUpdateInput>;
  const protocol = sanitizeRequiredText(payload.protocol, "Informe o protocolo.", 6);
  const action = isTicketUpdateAction(payload.action)
    ? payload.action
    : undefined;
  const adminResponse = sanitizeOptionalText(payload.adminResponse);
  const customerResponse = sanitizeOptionalText(payload.customerResponse);
  const resolutionSummary = sanitizeOptionalText(payload.resolutionSummary);
  const status = isTicketStatus(payload.status) ? payload.status : undefined;
  const deliveryDecision = isDeliveryDecision(payload.deliveryDecision)
    ? payload.deliveryDecision
    : undefined;
  const approvedDeliveryDate =
    deliveryDecision === "reject_with_new_date"
      ? normalizeDateOnly(
          payload.approvedDeliveryDate,
          "Informe a nova data proposta.",
        )
      : normalizeOptionalDateOnly(payload.approvedDeliveryDate);
  const deliveryDecisionNote = sanitizeOptionalText(
    payload.deliveryDecisionNote,
    800,
  );
  const backlog = normalizeBacklogInput(payload.backlog);

  return {
    action,
    adminResponse,
    approvedDeliveryDate,
    attachments: normalizeAttachments(payload.attachments),
    backlog,
    customerResponse,
    deliveryDecision,
    deliveryDecisionNote,
    protocol,
    resolutionSummary,
    status,
  };
}

function normalizeBacklogInput(
  value: unknown,
): HubItTicketBacklogInput | undefined {
  if (value === undefined) {
    return undefined;
  }

  const payload = recordFromUnknown(value);

  if (!payload) {
    throw new Error("Informe os dados de Backlog.");
  }

  if (!isRoadmapType(payload.type)) {
    throw new Error("Informe se o Backlog e melhoria, bug, divida tecnica ou automacao/integracao.");
  }

  if (!isTicketPriority(payload.priority)) {
    throw new Error("Informe a prioridade do Backlog.");
  }

  return {
    module: sanitizeRequiredText(
      payload.module,
      "Informe o modulo do Backlog.",
      2,
    ),
    note: sanitizeOptionalText(payload.note, 1_200),
    priority: payload.priority,
    screen: sanitizeRequiredText(
      payload.screen,
      "Informe a tela ou fluxo do Backlog.",
      2,
    ),
    type: payload.type,
  };
}

function normalizeAttachments(
  attachments: HubItTicketCreateInput["attachments"],
) {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments.flatMap((attachment) => {
    const fileName = sanitizeOptionalText(attachment.fileName, 120);
    const mimeType = sanitizeOptionalText(attachment.mimeType, 120);
    const dataUrl = sanitizeOptionalText(attachment.dataUrl, 8_500_000);
    const sizeBytes = Number.isFinite(attachment.sizeBytes)
      ? Math.max(0, Math.trunc(attachment.sizeBytes))
      : 0;
    const type = attachment.type;

    if (!fileName || !mimeType || !isAttachmentType(type)) {
      return [];
    }

    if (sizeBytes > maxAttachmentBytes) {
      return [];
    }

    if (dataUrl && !dataUrl.startsWith("data:")) {
      return [];
    }

    return [
      {
        capturedAt: attachment.capturedAt || new Date().toISOString(),
        dataUrl,
        fileName,
        mimeType,
        sizeBytes,
        type,
      } satisfies HubItTicketAttachmentInput,
    ];
  });
}

function mapTicketRow(
  row: HubItTicketRow,
  events: HubItTicketEvent[],
  attachments: HubItTicketAttachment[],
): HubItTicket {
  const deliveryAgreement = getDeliveryAgreementFromMetadata(row.metadata);
  const roadmap = getRoadmapFromMetadata(row.metadata);

  return {
    actualResult: row.actual_result,
    adminResponse: row.admin_response,
    approvedDeliveryDate: deliveryAgreement.approvedDate,
    assignedTo: row.assigned_to_user_id
      ? {
          avatarUrl: row.assigned_to_avatar_url,
          email: row.assigned_to_email,
          id: row.assigned_to_user_id,
          name: row.assigned_to_name ?? "Operador",
        }
      : null,
    assignedToUserId: row.assigned_to_user_id,
    attachments,
    category: row.category,
    createdAt: row.created_at,
    deliveryDecisionAt: deliveryAgreement.decidedAt,
    deliveryDecisionBy: deliveryAgreement.decidedBy,
    deliveryDecisionNote: deliveryAgreement.note,
    deliveryDecisionStatus: deliveryAgreement.status,
    events,
    expectedResult: row.expected_result,
    id: row.id,
    lastResponseBy: row.last_response_by_user_id
      ? {
          avatarUrl: row.last_response_by_avatar_url,
          email: row.last_response_by_email,
          id: row.last_response_by_user_id,
          name: row.last_response_by_name ?? "Usuario",
        }
      : null,
    module: row.module,
    priority: row.priority,
    protocol: row.protocol,
    requester: {
      avatarUrl: row.requester_avatar_url,
      email: row.requester_email,
      id: row.requested_by_user_id,
      name: row.requester_name,
    },
    requestedDeliveryDate: deliveryAgreement.requestedDate,
    resolutionSummary: row.resolution_summary,
    resolvedAt: row.resolved_at,
    roadmap,
    sourcePath: row.source_path,
    sourceUrl: row.source_url,
    status: row.status,
    technicalSummary: row.technical_summary,
    title: row.title,
    updatedAt: row.updated_at,
    userDescription: row.user_description,
  };
}

function mapEventRow(
  row: HubItTicketEventRow,
  actorsById: ReadonlyMap<string, HubItTicket["requester"]>,
): HubItTicketEvent {
  return {
    actor: row.created_by_user_id
      ? (actorsById.get(row.created_by_user_id) ?? null)
      : null,
    createdAt: row.created_at,
    id: row.id,
    message: row.message,
    type: row.event_type,
    visibleToRequester: row.visible_to_requester,
  };
}

function mapAttachmentRow(
  row: HubItTicketAttachmentRow,
): HubItTicketAttachment {
  return {
    capturedAt: row.captured_at,
    dataUrl: row.content_data_url,
    fileName: row.file_name,
    id: row.id,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    type: row.type,
  };
}

type DeliveryAgreementMetadata = {
  approvedDate?: string | null;
  decidedAt?: string | null;
  decidedBy?: HubItTicket["deliveryDecisionBy"];
  note?: string | null;
  requestedDate?: string | null;
  status: HubItTicketDeliveryDecisionStatus;
};

function buildInitialDeliveryMetadata(requestedDate: string) {
  return {
    approvedDate: null,
    decidedAt: null,
    decidedBy: null,
    note: null,
    requestedDate,
    status: "pendente" satisfies HubItTicketDeliveryDecisionStatus,
  };
}

function getDeliveryAgreementFromMetadata(
  metadata: Record<string, unknown>,
): DeliveryAgreementMetadata {
  const agreement = recordFromUnknown(metadata.deliveryAgreement) ?? {};
  const requestedDate = readDateOnly(agreement.requestedDate);
  const approvedDate = readDateOnly(agreement.approvedDate);
  const status = isDeliveryDecisionStatus(agreement.status)
    ? agreement.status
    : approvedDate
      ? "aprovada"
      : "pendente";
  const decidedByRecord = recordFromUnknown(agreement.decidedBy);

  return {
    approvedDate,
    decidedAt: sanitizeOptionalText(agreement.decidedAt, 80) ?? null,
    decidedBy: decidedByRecord
      ? {
          avatarUrl: sanitizeOptionalText(decidedByRecord.avatarUrl, 500) ?? null,
          email: sanitizeOptionalText(decidedByRecord.email, 240) ?? null,
          id: sanitizeOptionalText(decidedByRecord.id, 120) ?? "zeus",
          name: sanitizeOptionalText(decidedByRecord.name, 160) ?? "Operador",
        }
      : null,
    note: sanitizeOptionalText(agreement.note, 800) ?? null,
    requestedDate,
    status,
  };
}

function getRoadmapFromMetadata(
  metadata: Record<string, unknown>,
): HubItTicket["roadmap"] {
  const roadmap = recordFromUnknown(metadata.roadmap) ?? {};

  if (roadmap.active !== true) {
    return null;
  }

  const type = isRoadmapType(roadmap.type) ? roadmap.type : "melhoria";
  const moduleName = sanitizeOptionalText(roadmap.module, 120);
  const screen = sanitizeOptionalText(roadmap.screen, 180);

  if (!moduleName || !screen) {
    return null;
  }

  return {
    active: true,
    createdAt: sanitizeOptionalText(roadmap.createdAt, 80) ?? null,
    createdBy: readMetadataUserRef(roadmap.createdBy),
    module: moduleName,
    note: sanitizeOptionalText(roadmap.note, 1_200) ?? null,
    priority: isTicketPriority(roadmap.priority) ? roadmap.priority : "media",
    screen,
    type,
    updatedAt: sanitizeOptionalText(roadmap.updatedAt, 80) ?? null,
    updatedBy: readMetadataUserRef(roadmap.updatedBy),
  };
}

function buildRoadmapBacklogMetadata({
  currentMetadata,
  input,
  nextStatus,
  now,
  user,
}: {
  currentMetadata: Record<string, unknown>;
  input: HubItTicketUpdateInput;
  nextStatus: HubItTicketStatus;
  now: string;
  user: AuthorizedHubItTicketUser;
}) {
  const currentRoadmap = getRoadmapFromMetadata(currentMetadata);

  if (input.backlog) {
    const actor = buildDeliveryActor(user);
    const nextRoadmap = {
      active: true,
      createdAt: currentRoadmap?.createdAt ?? now,
      createdBy: currentRoadmap?.createdBy ?? actor,
      module: input.backlog.module,
      note: input.backlog.note ?? null,
      priority: input.backlog.priority,
      screen: input.backlog.screen,
      type: input.backlog.type,
      updatedAt: now,
      updatedBy: actor,
      history: [
        {
          action: "moved_to_backlog",
          createdAt: now,
          createdBy: actor,
          module: input.backlog.module,
          note: input.backlog.note ?? null,
          priority: input.backlog.priority,
          screen: input.backlog.screen,
          type: input.backlog.type,
        },
        ...arrayFromUnknown(recordFromUnknown(currentMetadata.roadmap)?.history)
          .slice(0, 24),
      ],
    };

    return {
      changed: true,
      message: `${actor.name} moveu este ticket para Backlog como ${hubItTicketRoadmapTypeLabels[input.backlog.type]} (${hubItTicketPriorityLabels[input.backlog.priority]}) em ${input.backlog.module} / ${input.backlog.screen}.`,
      metadata: {
        ...currentMetadata,
        roadmap: nextRoadmap,
      },
    };
  }

  if (currentRoadmap?.active && nextStatus !== "em_analise") {
    const actor = buildDeliveryActor(user);
    const previousRoadmap = recordFromUnknown(currentMetadata.roadmap) ?? {};

    return {
      changed: true,
      message: undefined,
      metadata: {
        ...currentMetadata,
        roadmap: {
          ...previousRoadmap,
          active: false,
          archivedAt: now,
          archivedBy: actor,
          history: [
            {
              action: "removed_from_backlog",
              createdAt: now,
              createdBy: actor,
              nextStatus,
            },
            ...arrayFromUnknown(previousRoadmap.history).slice(0, 24),
          ],
        },
      },
    };
  }

  return {
    changed: false,
    message: undefined,
    metadata: currentMetadata,
  };
}

function readMetadataUserRef(value: unknown): HubItTicket["requester"] | null {
  const record = recordFromUnknown(value);

  if (!record) {
    return null;
  }

  const id = sanitizeOptionalText(record.id, 120);
  const name = sanitizeOptionalText(record.name, 160);

  if (!id || !name) {
    return null;
  }

  return {
    avatarUrl: sanitizeOptionalText(record.avatarUrl, 500) ?? null,
    email: sanitizeOptionalText(record.email, 240) ?? null,
    id,
    name,
  };
}

function buildDeliveryDecisionMetadata({
  currentMetadata,
  input,
  now,
  user,
}: {
  currentMetadata: Record<string, unknown>;
  input: HubItTicketUpdateInput;
  now: string;
  user: AuthorizedHubItTicketUser;
}) {
  if (!input.deliveryDecision) {
    return {
      changed: false,
      message: undefined,
      metadata: currentMetadata,
    };
  }

  const currentAgreement = getDeliveryAgreementFromMetadata(currentMetadata);
  const nextDecision = resolveDeliveryDecision({
    action: input.deliveryDecision,
    approvedDeliveryDate: input.approvedDeliveryDate,
    actorName: user.name,
    note: input.deliveryDecisionNote,
    requestedDate: currentAgreement.requestedDate,
  });
  const actor = buildDeliveryActor(user);
  const nextAgreement = {
    ...(recordFromUnknown(currentMetadata.deliveryAgreement) ?? {}),
    approvedDate: nextDecision.approvedDate,
    decidedAt: now,
    decidedBy: actor,
    note: nextDecision.note,
    requestedDate: currentAgreement.requestedDate,
    status: nextDecision.status,
    history: [
      {
        action: input.deliveryDecision,
        approvedDate: nextDecision.approvedDate,
        decidedAt: now,
        decidedBy: actor,
        note: nextDecision.note,
        status: nextDecision.status,
      },
      ...arrayFromUnknown(
        recordFromUnknown(currentMetadata.deliveryAgreement)?.history,
      ).slice(0, 24),
    ],
  };

  return {
    changed: true,
    message: nextDecision.message,
    metadata: {
      ...currentMetadata,
      deliveryAgreement: nextAgreement,
    },
  };
}

function buildLocalDeliveryDecision({
  currentTicket,
  input,
  now,
  user,
}: {
  currentTicket: HubItTicket;
  input: HubItTicketUpdateInput;
  now: string;
  user: AuthorizedHubItTicketUser;
}) {
  if (!input.deliveryDecision) {
    return {
      changed: false,
      message: undefined,
    };
  }

  const nextDecision = resolveDeliveryDecision({
    action: input.deliveryDecision,
    approvedDeliveryDate: input.approvedDeliveryDate,
    actorName: user.name,
    note: input.deliveryDecisionNote,
    requestedDate: currentTicket.requestedDeliveryDate,
  });

  return {
    approvedDate: nextDecision.approvedDate,
    changed: true,
    decidedAt: now,
    decidedBy: buildDeliveryActor(user),
    message: nextDecision.message,
    note: nextDecision.note,
    status: nextDecision.status as HubItTicketDeliveryDecisionStatus,
  };
}

function buildLocalRoadmapBacklog({
  currentTicket,
  input,
  nextStatus,
  now,
  user,
}: {
  currentTicket: HubItTicket;
  input: HubItTicketUpdateInput;
  nextStatus: HubItTicketStatus;
  now: string;
  user: AuthorizedHubItTicketUser;
}) {
  if (input.backlog) {
    const actor = buildDeliveryActor(user);
    const roadmap = {
      active: true,
      createdAt: currentTicket.roadmap?.createdAt ?? now,
      createdBy: currentTicket.roadmap?.createdBy ?? actor,
      module: input.backlog.module,
      note: input.backlog.note ?? null,
      priority: input.backlog.priority,
      screen: input.backlog.screen,
      type: input.backlog.type,
      updatedAt: now,
      updatedBy: actor,
    } satisfies NonNullable<HubItTicket["roadmap"]>;

    return {
      changed: true,
      message: `${actor.name} moveu este ticket para Backlog como ${hubItTicketRoadmapTypeLabels[input.backlog.type]} (${hubItTicketPriorityLabels[input.backlog.priority]}) em ${input.backlog.module} / ${input.backlog.screen}.`,
      roadmap,
    };
  }

  if (currentTicket.roadmap?.active && nextStatus !== "em_analise") {
    return {
      changed: true,
      message: undefined,
      roadmap: {
        ...currentTicket.roadmap,
        active: false,
        updatedAt: now,
        updatedBy: buildDeliveryActor(user),
      } satisfies NonNullable<HubItTicket["roadmap"]>,
    };
  }

  return {
    changed: false,
    message: undefined,
    roadmap: currentTicket.roadmap ?? null,
  };
}

function resolveDeliveryDecision({
  action,
  approvedDeliveryDate,
  actorName,
  note,
  requestedDate,
}: {
  action: HubItTicketDeliveryDecisionAction;
  actorName: string;
  approvedDeliveryDate?: string;
  note?: string;
  requestedDate?: string | null;
}) {
  if (action === "approve_requested") {
    if (!requestedDate) {
      throw new Error("HelpDesk sem data solicitada para aprovar.");
    }

    return {
      approvedDate: requestedDate,
      message: `${actorName} aprovou a data solicitada para ${formatDateOnlyForMessage(requestedDate)}.`,
      note: note ?? null,
      status: "aprovada" satisfies HubItTicketDeliveryDecisionStatus,
    };
  }

  const nextDate = normalizeDateOnly(
    approvedDeliveryDate,
    "Informe a nova data proposta.",
  );

  return {
    approvedDate: nextDate,
    message: `${actorName} reprogramou a data para ${formatDateOnlyForMessage(nextDate)}.`,
    note: note ?? null,
    status: "reprogramada" satisfies HubItTicketDeliveryDecisionStatus,
  };
}

function buildDeliveryActor(user: AuthorizedHubItTicketUser) {
  return {
    avatarUrl: user.avatarUrl ?? null,
    email: user.email,
    id: user.id,
    name: user.name,
  };
}

function resolveAdminTicketNextStatus({
  currentRoadmap,
  currentStatus,
  input,
}: {
  currentRoadmap: HubItTicket["roadmap"];
  currentStatus: HubItTicketStatus;
  input: HubItTicketUpdateInput;
}) {
  if (input.backlog) {
    return "em_analise";
  }

  if (input.status) {
    return input.status;
  }

  if (currentRoadmap?.active && currentStatus === "em_analise") {
    return "em_analise";
  }

  if (input.adminResponse && currentStatus === "novo") {
    return "em_tratativa";
  }

  return currentStatus;
}

function buildAdminTicketEventMessage({
  actorName,
  attachmentsCount = 0,
  deliveryMessage,
  roadmapMessage,
  response,
  status,
}: {
  actorName: string;
  attachmentsCount?: number;
  deliveryMessage?: string;
  roadmapMessage?: string;
  response?: string;
  status: HubItTicketStatus;
}) {
  const attachmentMessage =
    attachmentsCount > 0
      ? `${attachmentsCount} anexo(s) enviado(s) por ${actorName}.`
      : null;
  const messageParts = [
    response,
    roadmapMessage,
    deliveryMessage,
    attachmentMessage,
  ].filter((messagePart): messagePart is string => Boolean(messagePart));

  return messageParts.length > 0
    ? messageParts.join("\n\n")
    : `Fluxo atualizado para ${hubItTicketStatusLabels[status]}.`;
}

function groupByTicketId<TItem extends { ticket_id: string }>(items: TItem[]) {
  const grouped = new Map<string, TItem[]>();

  for (const item of items) {
    const list = grouped.get(item.ticket_id) ?? [];
    list.push(item);
    grouped.set(item.ticket_id, list);
  }

  return grouped;
}

async function listLocalHubItTickets({
  canSeeAll,
  protocol,
  userId,
}: {
  canSeeAll: boolean;
  protocol?: string;
  userId: string;
}) {
  const store = await readLocalStore();
  const now = new Date();
  let changed = false;
  const tickets: HubItTicket[] = store.tickets.map((ticket) => {
    if (!isStaleValidationTicket(ticket, now)) {
      return ticket;
    }

    changed = true;
    const nowIso = now.toISOString();

    return {
      ...ticket,
      events: [
        {
          actor: null,
          createdAt: nowIso,
          id: `local-event-${randomBytes(6).toString("hex")}`,
          message: ZEUS_VALIDATION_TIMEOUT_MESSAGE,
          type: "closed" as const,
          visibleToRequester: true,
        },
        ...ticket.events,
      ],
      resolvedAt: nowIso,
      status: "fechado" as const,
      updatedAt: nowIso,
    };
  });

  if (changed) {
    await writeLocalStore({ tickets });
  }

  return tickets
    .filter((ticket) => canSeeAll || ticket.requester.id === userId)
    .filter((ticket) => !protocol || ticket.protocol === protocol)
    .sort((firstTicket, secondTicket) =>
      secondTicket.updatedAt.localeCompare(firstTicket.updatedAt),
    );
}

function isStaleValidationTicket(ticket: HubItTicket, now: Date) {
  if (!validationTicketStatuses.has(ticket.status)) {
    return false;
  }

  const updatedAt = new Date(ticket.updatedAt);

  if (Number.isNaN(updatedAt.getTime())) {
    return false;
  }

  return now.getTime() - updatedAt.getTime() >= staleValidationThresholdMs;
}

async function createLocalHubItTicket({
  input,
  protocol,
  user,
}: {
  input: HubItTicketCreateInput & {
    attachments: HubItTicketAttachmentInput[];
  };
  protocol: string;
  user: AuthorizedHubItTicketUser;
}) {
  const store = await readLocalStore();
  const now = new Date().toISOString();
  const deliveryAgreement = buildInitialDeliveryMetadata(
    input.requestedDeliveryDate,
  );
  const actor = {
    avatarUrl: user.avatarUrl,
    email: user.email,
    id: user.id,
    name: user.name,
  };
  const ticket: HubItTicket = {
    actualResult: input.actualResult,
    adminResponse: null,
    approvedDeliveryDate: null,
    assignedTo: null,
    assignedToUserId: null,
    attachments: input.attachments.map((attachment) => ({
      ...attachment,
      id: `local-att-${randomBytes(6).toString("hex")}`,
    })),
    category: input.category,
    createdAt: now,
    deliveryDecisionAt: null,
    deliveryDecisionBy: null,
    deliveryDecisionNote: null,
    deliveryDecisionStatus: "pendente",
    events: [
      {
        actor,
        createdAt: now,
        id: `local-event-${randomBytes(6).toString("hex")}`,
        message: `Zeus: ticket aberto pelo usuario. Data solicitada: ${formatDateOnlyForMessage(input.requestedDeliveryDate)}.`,
        type: "created",
        visibleToRequester: true,
      },
    ],
    expectedResult: input.expectedResult,
    id: `local-ticket-${randomBytes(8).toString("hex")}`,
    lastResponseBy: actor,
    module: input.module,
    priority: input.priority,
    protocol,
    requestedDeliveryDate: deliveryAgreement.requestedDate,
    requester: actor,
    resolutionSummary: null,
    resolvedAt: null,
    sourcePath: input.sourcePath,
    sourceUrl: input.sourceUrl,
    status: "novo",
    technicalSummary: input.technicalSummary,
    title: input.title,
    updatedAt: now,
    userDescription: input.userDescription,
  };

  store.tickets.unshift(ticket);
  await writeLocalStore(store);

  return ticket;
}

async function updateLocalHubItTicket({
  input,
  user,
}: {
  input: HubItTicketUpdateInput;
  user: AuthorizedHubItTicketUser;
}) {
  const store = await readLocalStore();
  const ticketIndex = store.tickets.findIndex(
    (ticket) => ticket.protocol === input.protocol,
  );

  if (ticketIndex < 0) {
    throw new Error("HelpDesk nao encontrado.");
  }

  const now = new Date().toISOString();
  const currentTicket = store.tickets[ticketIndex]!;
  const userAction = input.action;
  const actor = {
    avatarUrl: user.avatarUrl,
    email: user.email,
    id: user.id,
    name: user.name,
  };

  if (
    userAction === "customer_close" ||
    userAction === "customer_comment" ||
    userAction === "customer_review"
  ) {
    if (currentTicket.requester.id !== user.id) {
      throw new Error("Somente o solicitante pode encerrar ou devolver o ticket para revisao.");
    }

    const nextStatus =
      userAction === "customer_close"
        ? "fechado"
        : userAction === "customer_review"
          ? "em_revisao"
          : currentTicket.status;
    const reviewAttachments =
      userAction === "customer_review" || userAction === "customer_comment"
        ? (input.attachments ?? []).map((attachment) => ({
            ...attachment,
            id: `local-att-${randomBytes(6).toString("hex")}`,
          }))
        : [];
    const nextTicket: HubItTicket = {
      ...currentTicket,
      attachments: [...reviewAttachments, ...currentTicket.attachments],
      events: [
        {
          actor,
          createdAt: now,
          id: `local-event-${randomBytes(6).toString("hex")}`,
          message:
            userAction === "customer_close"
              ? "Solicitante confirmou a resolucao e encerrou o ticket."
              : input.customerResponse ||
                (userAction === "customer_review"
                  ? "Solicitante devolveu o ticket para revisao."
                  : "Solicitante enviou uma mensagem para o operador."),
          type:
            userAction === "customer_close"
              ? "closed"
              : userAction === "customer_review"
                ? "review_requested"
                : "user_comment",
          visibleToRequester: true,
        },
        ...currentTicket.events,
      ],
      lastResponseBy: actor,
      resolvedAt:
        userAction === "customer_close"
          ? now
          : userAction === "customer_review"
            ? null
            : currentTicket.resolvedAt,
      status: nextStatus,
      updatedAt: now,
    };

    store.tickets[ticketIndex] = nextTicket;
    await writeLocalStore(store);

    return nextTicket;
  }

  if (!isAuthorizedHubItTicketAdmin(user)) {
    throw new Error("Somente Zeus adm pode responder HelpDesk.");
  }

  const adminAttachments = (input.attachments ?? []).map((attachment) => ({
    ...attachment,
    id: `local-att-${randomBytes(6).toString("hex")}`,
  }));
  const nextStatus = resolveAdminTicketNextStatus({
    currentRoadmap: currentTicket.roadmap ?? null,
    currentStatus: currentTicket.status,
    input,
  });
  const isResolved = nextStatus === "fechado";
  const deliveryDecision = buildLocalDeliveryDecision({
    currentTicket,
    input,
    now,
    user,
  });
  const roadmapBacklog = buildLocalRoadmapBacklog({
    currentTicket,
    input,
    nextStatus,
    now,
    user,
  });
  const nextTicket: HubItTicket = {
    ...currentTicket,
    adminResponse: input.adminResponse,
    approvedDeliveryDate:
      deliveryDecision.approvedDate ?? currentTicket.approvedDeliveryDate,
    assignedTo: actor,
    assignedToUserId: user.id,
    deliveryDecisionAt:
      deliveryDecision.decidedAt ?? currentTicket.deliveryDecisionAt,
    deliveryDecisionBy:
      deliveryDecision.decidedBy ?? currentTicket.deliveryDecisionBy,
    deliveryDecisionNote:
      deliveryDecision.note ?? currentTicket.deliveryDecisionNote,
    deliveryDecisionStatus:
      deliveryDecision.status ?? currentTicket.deliveryDecisionStatus,
    events: [
      {
        actor,
        createdAt: now,
        id: `local-event-${randomBytes(6).toString("hex")}`,
        message: buildAdminTicketEventMessage({
          actorName: user.name,
          attachmentsCount: adminAttachments.length,
          deliveryMessage: deliveryDecision.message,
          roadmapMessage: roadmapBacklog.message,
          response: input.adminResponse,
          status: nextStatus,
        }),
        type:
          isResolved
            ? "resolved"
            : (deliveryDecision.changed || roadmapBacklog.changed) &&
                !input.adminResponse
              ? "status_changed"
              : "admin_reply",
        visibleToRequester: true,
      },
      ...currentTicket.events,
    ],
    attachments: [...adminAttachments, ...currentTicket.attachments],
    lastResponseBy: actor,
    resolutionSummary: input.resolutionSummary,
    resolvedAt: isResolved ? now : null,
    roadmap: roadmapBacklog.roadmap,
    status: nextStatus,
    updatedAt: now,
  };

  store.tickets[ticketIndex] = nextTicket;
  await writeLocalStore(store);

  return nextTicket;
}

async function readLocalStore(): Promise<HubItTicketsLocalStore> {
  try {
    const content = await readFile(localStorePath, "utf-8");
    const parsed = JSON.parse(content) as Partial<HubItTicketsLocalStore>;

    return {
      tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
    };
  } catch {
    return {
      tickets: [],
    };
  }
}

async function writeLocalStore(store: HubItTicketsLocalStore) {
  await mkdir(path.dirname(localStorePath), { recursive: true });
  await writeFile(localStorePath, JSON.stringify(store, null, 2), "utf-8");
}

async function generateHubItTicketProtocol(adminClient: HubItTicketsClient | null) {
  const highestRemoteNumber = adminClient
    ? await getHighestRemoteTicketProtocolNumber(adminClient)
    : 0;
  const highestLocalNumber = adminClient
    ? 0
    : await getHighestLocalTicketProtocolNumber();
  const nextNumber = Math.max(highestRemoteNumber, highestLocalNumber) + 1;

  return `TI-${String(nextNumber).padStart(6, "0")}`;
}

async function getHighestRemoteTicketProtocolNumber(
  adminClient: HubItTicketsClient,
) {
  try {
    const { data, error } = await adminClient
      .from("hub_it_tickets")
      .select("protocol")
      .like("protocol", "TI-%")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      return 0;
    }

    return getHighestTicketProtocolNumber(
      (data ?? []).map((ticket) => ticket.protocol),
    );
  } catch {
    return 0;
  }
}

async function getHighestLocalTicketProtocolNumber() {
  const store = await readLocalStore();

  return getHighestTicketProtocolNumber(
    store.tickets.map((ticket) => ticket.protocol),
  );
}

function getHighestTicketProtocolNumber(protocols: string[]) {
  return protocols.reduce((highestNumber, protocol) => {
    const match = protocol.match(/^TI-(\d{6})$/);
    const protocolNumber = match?.[1] ? Number(match[1]) : 0;

    return Number.isFinite(protocolNumber)
      ? Math.max(highestNumber, protocolNumber)
      : highestNumber;
  }, 0);
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isTicketCategory(value: unknown): value is HubItTicketCategory {
  return hubItTicketCategories.includes(value as HubItTicketCategory);
}

function isTicketPriority(value: unknown): value is HubItTicketPriority {
  return hubItTicketPriorities.includes(value as HubItTicketPriority);
}

function isTicketStatus(value: unknown): value is HubItTicketStatus {
  return hubItTicketStatuses.includes(value as HubItTicketStatus);
}

function isRoadmapType(
  value: unknown,
): value is HubItTicketBacklogInput["type"] {
  return hubItTicketRoadmapTypes.includes(
    value as HubItTicketBacklogInput["type"],
  );
}

function isTicketUpdateAction(
  value: unknown,
): value is NonNullable<HubItTicketUpdateInput["action"]> {
  return (
    value === "admin_reply" ||
    value === "customer_close" ||
    value === "customer_comment" ||
    value === "customer_review"
  );
}

function isDeliveryDecision(
  value: unknown,
): value is HubItTicketDeliveryDecisionAction {
  return value === "approve_requested" || value === "reject_with_new_date";
}

function isDeliveryDecisionStatus(
  value: unknown,
): value is HubItTicketDeliveryDecisionStatus {
  return (
    value === "pendente" ||
    value === "aprovada" ||
    value === "reprogramada"
  );
}

function isAttachmentType(
  value: unknown,
): value is HubItTicketAttachment["type"] {
  return (
    value === "audio" ||
    value === "image" ||
    value === "video" ||
    value === "file"
  );
}

function isHubItTicketAdmin(user: HubItTicketUserRow) {
  return user.role === "admin" || user.operational_profile === "adm";
}

function isAuthorizedHubItTicketAdmin(user: AuthorizedHubItTicketUser) {
  return user.role === "admin" || user.operationalProfile === "adm";
}

function sanitizeRequiredText(
  value: unknown,
  errorMessage: string,
  minLength: number,
) {
  const text = sanitizeOptionalText(value);

  if (!text || text.length < minLength) {
    throw new Error(errorMessage);
  }

  return text;
}

function sanitizeOptionalText(value: unknown, maxLength = maxTextLength) {
  if (typeof value !== "string") {
    return undefined;
  }

  const text = value.trim().slice(0, maxLength);

  return text || undefined;
}

function normalizeDateOnly(value: unknown, errorMessage: string) {
  const date = readDateOnly(value);

  if (!date) {
    throw new Error(errorMessage);
  }

  return date;
}

function normalizeOptionalDateOnly(value: unknown) {
  return readDateOnly(value) ?? undefined;
}

function readDateOnly(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedValue)) {
    return null;
  }

  const [year = 0, month = 0, day = 0] = trimmedValue
    .split("-")
    .map((part) => Number(part));
  const date = new Date(year, month - 1, day);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return trimmedValue;
}

function formatDateOnlyForMessage(value: string) {
  const [year, month, day] = value.split("-");

  return `${day}/${month}/${year}`;
}

export function isHubItTicketsSchemaMissingError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message)
        : String(error ?? "");

  return (
    message.includes("hub_it_tickets") ||
    message.includes("hub_it_ticket_events") ||
    message.includes("hub_it_ticket_attachments") ||
    message.includes("hub_it_ticket_operation_links") ||
    message.includes("hub_it_ticket_status") ||
    message.includes("invalid input value for enum") ||
    message.includes("Could not find the table") ||
    message.includes("relation") ||
    message.includes("does not exist")
  );
}

function shouldUseLocalFallback(error: unknown) {
  return isLocalDevelopmentRuntime() && isHubItTicketsSchemaMissingError(error);
}

function isLocalDevelopmentRuntime() {
  return process.env.NODE_ENV !== "production";
}
