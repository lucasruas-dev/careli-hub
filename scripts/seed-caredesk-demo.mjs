import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
  },
});

const now = new Date();
const seedTag = "caredesk-demo-2026-05-16";

const profileSeeds = [
  ["suporte", "duvida-geral", "Duvida geral", "Suporte", "medium", 60, 720, "Duvidas gerais de clientes."],
  ["suporte", "solicitacao-documento", "Solicitacao de documento", "Suporte", "medium", 60, 720, "Pedido de documentos e comprovantes."],
  ["suporte", "atualizacao-cadastral", "Atualizacao cadastral", "Suporte", "low", 120, 720, "Atualizacao de dados de contato."],
  ["atendimento", "retorno-cliente", "Retorno ao cliente", "Atendimento", "medium", 60, 480, "Retorno de atendimento iniciado pelo cliente."],
  ["financeiro", "duvida-boleto", "Duvida sobre boleto", "Financeiro", "high", 45, 480, "Duvidas sobre vencimento, boleto ou pagamento."],
  ["financeiro", "pagamento-identificado", "Pagamento identificado", "Financeiro", "medium", 60, 480, "Confirmacao de pagamento ou baixa."],
];

const scenarios = [
  ["suporte", "duvida-geral", "new", "medium", "Duvida sobre atendimento", "Cliente abriu uma duvida e aguarda primeira resposta."],
  ["suporte", "solicitacao-documento", "waiting_operator", "medium", "Solicitacao de documento", "Cliente pediu documento e ainda nao foi assumido."],
  ["suporte", "atualizacao-cadastral", "open", "low", "Atualizacao cadastral", "Atualizacao de telefone e dados de contato."],
  ["suporte", "duvida-geral", "waiting_customer", "medium", "Aguardando retorno do cliente", "Operador respondeu e aguarda confirmacao."],
  ["suporte", "solicitacao-documento", "pending", "medium", "Comprovante solicitado", "Documento em preparacao pelo time."],
  ["atendimento", "retorno-cliente", "new", "medium", "Cliente solicitou retorno", "Mensagem recebida fora da fila e aguardando triagem."],
  ["atendimento", "retorno-cliente", "open", "medium", "Atendimento em andamento", "Conversa ativa com operador."],
  ["atendimento", "retorno-cliente", "waiting_customer", "medium", "Aguardando cliente", "Retorno enviado e aguardando resposta."],
  ["financeiro", "duvida-boleto", "new", "high", "Duvida sobre boleto", "Cliente perguntou sobre boleto e vencimento."],
  ["financeiro", "pagamento-identificado", "open", "medium", "Pagamento informado", "Cliente informou pagamento para verificacao."],
  ["financeiro", "duvida-boleto", "waiting_operator", "high", "Segunda via de boleto", "Cliente pediu segunda via e aguarda operador."],
  ["cobranca", "primeiro-contato", "open", "high", "Contato ativo de cobranca", "Operador iniciou contato pelo CareDesk."],
  ["cobranca", "negociacao", "waiting_customer", "high", "Negociacao em andamento", "Cliente recebeu proposta e precisa responder."],
  ["cobranca", "enviar-boleto-c2x", "pending", "high", "Envio de boleto", "Boleto separado para envio pelo atendimento."],
  ["juridico", "duvida-contratual", "new", "critical", "Duvida contratual", "Cliente pediu esclarecimento sobre contrato."],
  ["suporte", "duvida-geral", "resolved", "medium", "Duvida resolvida", "Atendimento encerrado para calibrar relatorios."],
  ["suporte", "solicitacao-documento", "closed", "medium", "Documento enviado", "Ticket fechado com documento entregue."],
  ["atendimento", "retorno-cliente", "open", "medium", "Retorno por WhatsApp", "Cliente retornou conversa com nova pergunta."],
  ["financeiro", "duvida-boleto", "waiting_customer", "high", "Conferencia financeira", "Aguardando cliente confirmar dados."],
  ["suporte", "atualizacao-cadastral", "waiting_operator", "low", "Validar dados cadastrais", "Cliente enviou dados para conferencia."],
];

const data = await seedCareDeskDemo();
console.log(JSON.stringify(data, null, 2));

async function seedCareDeskDemo() {
  const workspace = await requiredSingle(
    "workspace",
    client.from("hub_workspaces").select("id").eq("slug", "careli").maybeSingle(),
  );
  const customers = await loadUniqueCustomers();
  const c2xIds = customers
    .map((customer) => Number(customer.client_c2x_id))
    .filter(Number.isFinite);
  const validC2xIds = await loadValidC2xIds(c2xIds);

  const queues = await requiredRows(
    "queues",
    client
      .from("caredesk_queues")
      .select("id,slug,name,sla_first_response_minutes,sla_resolution_minutes,default_priority"),
  );
  const queueBySlug = new Map(queues.map((queue) => [queue.slug, queue]));
  const channel = await requiredSingle(
    "channel",
    client.from("caredesk_channels").select("id").eq("slug", "whatsapp-careli").maybeSingle(),
  );
  const operators = await requiredRows(
    "operators",
    client
      .from("hub_users")
      .select("id,display_name,role,status")
      .eq("status", "active")
      .in("role", ["admin", "leader", "operator"])
      .limit(8),
  );

  await ensureProfiles(queueBySlug);

  const profiles = await requiredRows(
    "profiles",
    client
      .from("caredesk_ticket_profiles")
      .select("id,slug,queue_id,priority,sla_first_response_minutes,sla_resolution_minutes"),
  );
  const profileBySlug = new Map(profiles.map((profile) => [profile.slug, profile]));

  await resetDemoRows();

  const contacts = await ensureContacts({
    customers,
    validC2xIds,
    workspaceId: workspace.id,
  });
  const contactByC2xId = new Map(
    contacts.map((contact) => [Number(contact.c2x_user_id), contact]),
  );

  const ticketsPayload = customers.map((customer, index) =>
    buildTicketPayload({
      channelId: channel?.id,
      contact: contactByC2xId.get(Number(customer.client_c2x_id)),
      customer,
      index,
      operators,
      profileBySlug,
      queueBySlug,
      workspaceId: workspace.id,
    }),
  );

  const tickets = await requiredRows(
    "tickets insert",
    client
      .from("caredesk_tickets")
      .insert(ticketsPayload)
      .select("id,protocol,contact_id,channel_id,status,assigned_to_user_id,metadata"),
  );

  const { eventsPayload, messagesPayload } = buildTicketActivity({
    customers,
    tickets,
    ticketsPayload,
  });

  await requiredRows("messages insert", client.from("caredesk_messages").insert(messagesPayload));
  await requiredRows("events insert", client.from("caredesk_ticket_events").insert(eventsPayload));

  const broadcasts = await createBroadcasts({
    channelId: channel?.id,
    contacts,
    queueBySlug,
    workspaceId: workspace.id,
  });

  await createAiSuggestions(tickets);

  return {
    aiSuggestions: Math.min(tickets.length, 8),
    broadcasts: broadcasts.broadcasts,
    contacts: contacts.length,
    events: eventsPayload.length,
    messages: messagesPayload.length,
    recipients: broadcasts.recipients,
    tickets: tickets.length,
  };
}

async function loadUniqueCustomers() {
  const rows = await requiredRows(
    "customers",
    client
      .from("c2x_guardian_attendance_queue")
      .select("client_c2x_id,client_name,document,phone,enterprise_name,unit_label,metadata")
      .not("client_name", "is", null)
      .not("client_c2x_id", "is", null)
      .not("phone", "is", null)
      .order("client_name", { ascending: true })
      .limit(80),
  );

  const byC2xId = new Map();
  for (const row of rows) {
    const id = Number(row.client_c2x_id);
    if (Number.isFinite(id) && !byC2xId.has(id)) {
      byC2xId.set(id, row);
    }
    if (byC2xId.size >= 20) {
      break;
    }
  }

  const customers = [...byC2xId.values()];
  if (customers.length < 20) {
    throw new Error(`Only ${customers.length} unique customers found.`);
  }

  return customers;
}

async function loadValidC2xIds(c2xIds) {
  const rows = await requiredRows(
    "c2x_users",
    client.from("c2x_users").select("c2x_id").in("c2x_id", c2xIds),
  );

  return new Set(rows.map((row) => Number(row.c2x_id)));
}

async function ensureProfiles(queueBySlug) {
  const rows = profileSeeds
    .map(([queueSlug, slug, name, category, priority, firstSla, resolutionSla, description]) => {
      const queue = queueBySlug.get(queueSlug);
      if (!queue) {
        return null;
      }

      return {
        category,
        description,
        metadata: { seedTag },
        name,
        priority,
        queue_id: queue.id,
        required_fields: ["contact_id", "queue_id"],
        sla_first_response_minutes: firstSla,
        sla_resolution_minutes: resolutionSla,
        slug,
        status: "active",
      };
    })
    .filter(Boolean);

  await requiredRows(
    "profile upsert",
    client.from("caredesk_ticket_profiles").upsert(rows, {
      onConflict: "queue_id,slug",
    }),
  );
}

async function resetDemoRows() {
  await requiredRows(
    "delete demo broadcasts",
    client.from("caredesk_broadcasts").delete().like("name", "Demo CareDesk%"),
  );
  await requiredRows(
    "delete demo tickets",
    client.from("caredesk_tickets").delete().like("protocol", "CARE-DEMO-%"),
  );
}

async function ensureContacts({ customers, validC2xIds, workspaceId }) {
  const c2xIds = customers
    .map((customer) => Number(customer.client_c2x_id))
    .filter(Number.isFinite);

  const existingContacts = await requiredRows(
    "existing contacts",
    client
      .from("caredesk_contacts")
      .select("id,c2x_user_id,display_name,phone,whatsapp_phone")
      .eq("workspace_id", workspaceId)
      .in("c2x_user_id", c2xIds),
  );
  const existingByC2xId = new Map(
    existingContacts.map((contact) => [Number(contact.c2x_user_id), contact]),
  );

  const contactsPayload = customers.map((customer) =>
    buildContactPayload({ customer, validC2xIds, workspaceId }),
  );
  const missingContacts = contactsPayload.filter(
    (contact) =>
      contact.c2x_user_id && !existingByC2xId.has(Number(contact.c2x_user_id)),
  );
  const existingPayloads = contactsPayload.filter(
    (contact) =>
      contact.c2x_user_id && existingByC2xId.has(Number(contact.c2x_user_id)),
  );

  if (missingContacts.length) {
    await requiredRows(
      "contacts insert",
      client.from("caredesk_contacts").insert(missingContacts),
    );
  }

  for (const contact of existingPayloads) {
    await requiredRows(
      "contact update",
      client
        .from("caredesk_contacts")
        .update({
          c2x_payload: contact.c2x_payload,
          display_name: contact.display_name,
          document: contact.document,
          last_synced_at: contact.last_synced_at,
          metadata: contact.metadata,
          phone: contact.phone,
          whatsapp_phone: contact.whatsapp_phone,
        })
        .eq("workspace_id", workspaceId)
        .eq("c2x_user_id", contact.c2x_user_id),
    );
  }

  return requiredRows(
    "contacts reload",
    client
      .from("caredesk_contacts")
      .select("id,c2x_user_id,display_name,phone,whatsapp_phone")
      .eq("workspace_id", workspaceId)
      .in("c2x_user_id", c2xIds),
  );
}

function buildContactPayload({ customer, validC2xIds, workspaceId }) {
  const c2xId = Number(customer.client_c2x_id);
  const metadata = isRecord(customer.metadata) ? customer.metadata : {};
  const phone = clean(customer.phone);

  return {
    c2x_payload: customer,
    c2x_user_id: validC2xIds.has(c2xId) ? c2xId : null,
    city: null,
    display_name: clean(customer.client_name) ?? `Cliente ${c2xId}`,
    document: clean(customer.document),
    last_synced_at: now.toISOString(),
    metadata: {
      enterpriseName: clean(customer.enterprise_name),
      relationship: metadata.relationship ?? null,
      seedTag,
      unitLabel: clean(customer.unit_label),
    },
    person_type: metadata.segment ?? "Cliente",
    phone,
    state: null,
    whatsapp_phone: phone,
    workspace_id: workspaceId,
  };
}

function buildTicketPayload({
  channelId,
  contact,
  customer,
  index,
  operators,
  profileBySlug,
  queueBySlug,
  workspaceId,
}) {
  const [queueSlug, profileSlug, status, priority, subject, summary] =
    scenarios[index % scenarios.length];
  const queue = queueBySlug.get(queueSlug) ?? queueBySlug.get("atendimento");
  const profile = profileBySlug.get(profileSlug) ?? null;
  const openedHoursAgo = 2 + index * 3;
  const operator = operators[index % Math.max(operators.length, 1)] ?? null;
  const firstSla = Number(
    profile?.sla_first_response_minutes ?? queue?.sla_first_response_minutes ?? 60,
  );
  const resolutionSla = Number(
    profile?.sla_resolution_minutes ?? queue?.sla_resolution_minutes ?? 480,
  );
  const openedAt = isoHoursAgo(openedHoursAgo);
  const hasResponded = ["open", "waiting_customer", "pending", "resolved", "closed"].includes(
    status,
  );
  const closed = ["resolved", "closed"].includes(status);

  return {
    assigned_to_user_id: status === "waiting_operator" ? null : operator?.id ?? null,
    channel_id: channelId ?? null,
    closed_at: status === "closed" ? isoHoursAgo(1) : null,
    contact_id: contact?.id ?? null,
    created_by_user_id: operator?.id ?? null,
    first_responded_at: hasResponded ? isoHoursAgo(Math.max(openedHoursAgo - 1, 1)) : null,
    first_response_due_at: addMinutes(openedAt, firstSla),
    metadata: {
      demoScenario: summary,
      operatorName: operator?.display_name ?? null,
      seedTag,
    },
    opened_at: openedAt,
    priority,
    profile_id: profile?.id ?? null,
    protocol: `CARE-DEMO-${String(index + 1).padStart(4, "0")}`,
    queue_id: queue?.id ?? null,
    resolution_due_at: addMinutes(openedAt, resolutionSla),
    resolved_at: closed ? isoHoursAgo(1) : null,
    source_context: {
      enterpriseName: clean(customer.enterprise_name),
      queueSlug,
      seedTag,
      summary,
      unitLabel: clean(customer.unit_label),
    },
    source_entity_id: String(customer.client_c2x_id),
    source_entity_type: "demo-seed",
    source_module: queueSlug === "suporte" ? "support" : "manual",
    status,
    subject,
    workspace_id: workspaceId,
  };
}

function buildTicketActivity({ customers, tickets, ticketsPayload }) {
  const messagesPayload = [];
  const eventsPayload = [];

  tickets.forEach((ticket, index) => {
    const customer = customers[index];
    const name = clean(customer.client_name) ?? "cliente";
    const scenario = scenarios[index % scenarios.length];
    const status = scenario[2];
    const openedAt = ticketsPayload[index].opened_at;
    const baseTime = new Date(openedAt).getTime();

    messagesPayload.push({
      body: inboundBody(scenario[0], name),
      channel_id: ticket.channel_id,
      created_at: new Date(baseTime + 5 * 60000).toISOString(),
      delivery_status: "read",
      direction: "inbound",
      message_type: "text",
      provider_payload: { seedTag },
      sender_contact_id: ticket.contact_id,
      sender_type: "customer",
      sent_at: new Date(baseTime + 5 * 60000).toISOString(),
      ticket_id: ticket.id,
    });

    if (["open", "waiting_customer", "pending", "resolved", "closed"].includes(status)) {
      messagesPayload.push({
        body: outboundBody(scenario[0], name),
        channel_id: ticket.channel_id,
        created_at: new Date(baseTime + 45 * 60000).toISOString(),
        delivery_status: status === "pending" ? "sent" : "delivered",
        direction: "outbound",
        message_type: "text",
        provider_payload: { seedTag },
        sender_type: "operator",
        sender_user_id: ticket.assigned_to_user_id,
        sent_at: new Date(baseTime + 45 * 60000).toISOString(),
        ticket_id: ticket.id,
      });
    }

    if (status === "waiting_customer") {
      messagesPayload.push({
        body: "Fico no aguardo da sua confirmacao para seguirmos por aqui.",
        channel_id: ticket.channel_id,
        created_at: new Date(baseTime + 70 * 60000).toISOString(),
        delivery_status: "delivered",
        direction: "outbound",
        message_type: "text",
        provider_payload: { seedTag },
        sender_type: "operator",
        sender_user_id: ticket.assigned_to_user_id,
        sent_at: new Date(baseTime + 70 * 60000).toISOString(),
        ticket_id: ticket.id,
      });
    }

    eventsPayload.push({
      actor_type: "system",
      created_at: openedAt,
      description: scenario[5],
      event_type: "ticket_created",
      metadata: { protocol: ticket.protocol, seedTag },
      ticket_id: ticket.id,
      title: "Ticket criado no CareDesk",
    });
  });

  return { eventsPayload, messagesPayload };
}

async function createBroadcasts({ channelId, contacts, queueBySlug, workspaceId }) {
  const demoBroadcasts = [
    {
      name: "Demo CareDesk - Comunicado geral",
      queueSlug: "comunicados",
      scheduledAt: isoHoursFrom(24),
      status: "draft",
    },
    {
      name: "Demo CareDesk - Atualizacao cadastral",
      queueSlug: "suporte",
      scheduledAt: isoHoursFrom(6),
      status: "scheduled",
    },
    {
      name: "Demo CareDesk - Lembrete financeiro",
      queueSlug: "financeiro",
      scheduledAt: null,
      status: "paused",
    },
  ].map((item) => ({
    audience: { description: "Base de demonstracao CareDesk", seedTag },
    channel_id: channelId ?? null,
    metadata: { seedTag },
    name: item.name,
    queue_id: queueBySlug.get(item.queueSlug)?.id ?? null,
    scheduled_at: item.scheduledAt,
    status: item.status,
    workspace_id: workspaceId,
  }));

  const broadcasts = await requiredRows(
    "broadcasts insert",
    client.from("caredesk_broadcasts").insert(demoBroadcasts).select("id,name"),
  );
  const recipientRows = broadcasts
    .flatMap((broadcast, broadcastIndex) =>
      contacts.slice(broadcastIndex * 5, broadcastIndex * 5 + 5).map((contact) => ({
        broadcast_id: broadcast.id,
        contact_id: contact.id,
        destination: contact.whatsapp_phone ?? contact.phone ?? "sem-destino",
        metadata: { seedTag },
        status: broadcastIndex === 0 ? "queued" : broadcastIndex === 1 ? "sent" : "draft",
      })),
    )
    .filter((row) => row.destination !== "sem-destino");

  if (recipientRows.length) {
    await requiredRows(
      "broadcast recipients insert",
      client.from("caredesk_broadcast_recipients").insert(recipientRows),
    );
  }

  return {
    broadcasts: broadcasts.length,
    recipients: recipientRows.length,
  };
}

async function createAiSuggestions(tickets) {
  const aiRows = tickets.slice(0, 8).map((ticket, index) => ({
    action_payload: { seedTag },
    action_type: index % 2 === 0 ? "suggest_reply" : "summarize_ticket",
    assistant_name: "Caca",
    contact_id: ticket.contact_id,
    metadata: { seedTag },
    prompt: "Sugerir proxima resposta operacional.",
    response: "Sugerir resposta curta, humana e objetiva para destravar o atendimento.",
    status: "suggested",
    ticket_id: ticket.id,
  }));

  await requiredRows(
    "ai suggestions insert",
    client.from("caredesk_ai_suggestions").insert(aiRows),
  );
}

function inboundBody(queueSlug, name) {
  const firstName = String(name).split(" ")[0] || "Ola";
  if (queueSlug === "suporte") {
    return `Ola, sou ${firstName}. Preciso de ajuda com uma solicitacao do meu atendimento.`;
  }
  if (queueSlug === "financeiro") {
    return `Ola, sou ${firstName}. Tenho uma duvida sobre meu boleto e pagamento.`;
  }
  if (queueSlug === "juridico") {
    return `Ola, sou ${firstName}. Gostaria de entender melhor uma clausula do contrato.`;
  }
  return `Ola, sou ${firstName}. Podemos falar sobre meu atendimento?`;
}

function outboundBody(queueSlug, name) {
  const firstName = String(name).split(" ")[0] || "tudo bem";
  if (queueSlug === "suporte") {
    return `${firstName}, obrigado pelo contato. Vou te ajudar por aqui e registrar o andamento no CareDesk.`;
  }
  if (queueSlug === "financeiro") {
    return `${firstName}, vou conferir as informacoes e te retorno com a orientacao correta por este atendimento.`;
  }
  if (queueSlug === "juridico") {
    return `${firstName}, vou direcionar sua duvida para analise e manter o retorno neste ticket.`;
  }
  return `${firstName}, vou seguir com seu atendimento por aqui e registrar a proxima etapa.`;
}

async function requiredRows(label, promise) {
  const result = await promise;
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result.data ?? [];
}

async function requiredSingle(label, promise) {
  const result = await promise;
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  if (!result.data) {
    throw new Error(`${label}: no row found.`);
  }
  return result.data;
}

function addMinutes(value, minutes) {
  return new Date(new Date(value).getTime() + Number(minutes) * 60000).toISOString();
}

function isoHoursAgo(hours) {
  return new Date(now.getTime() - Number(hours) * 60 * 60 * 1000).toISOString();
}

function isoHoursFrom(hours) {
  return new Date(now.getTime() + Number(hours) * 60 * 60 * 1000).toISOString();
}

function clean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
