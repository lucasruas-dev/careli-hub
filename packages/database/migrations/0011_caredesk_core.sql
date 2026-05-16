-- CareDesk operational core.
-- The C2X read model remains the source for portfolio/customer facts; these tables
-- store the Hub-side operation: tickets, conversations, queues, automations and audit.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'caredesk_channel_kind') then
    create type public.caredesk_channel_kind as enum (
      'whatsapp',
      'email',
      'phone',
      'chat',
      'instagram',
      'facebook',
      'internal'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'caredesk_record_status') then
    create type public.caredesk_record_status as enum (
      'planned',
      'active',
      'paused',
      'archived'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'caredesk_ticket_status') then
    create type public.caredesk_ticket_status as enum (
      'new',
      'open',
      'waiting_customer',
      'waiting_operator',
      'pending',
      'resolved',
      'closed',
      'cancelled'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'caredesk_priority') then
    create type public.caredesk_priority as enum (
      'low',
      'medium',
      'high',
      'critical'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'caredesk_direction') then
    create type public.caredesk_direction as enum (
      'inbound',
      'outbound',
      'internal'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'caredesk_sender_type') then
    create type public.caredesk_sender_type as enum (
      'customer',
      'operator',
      'agent',
      'system'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'caredesk_delivery_status') then
    create type public.caredesk_delivery_status as enum (
      'draft',
      'queued',
      'sent',
      'delivered',
      'read',
      'failed'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'caredesk_broadcast_status') then
    create type public.caredesk_broadcast_status as enum (
      'draft',
      'scheduled',
      'running',
      'paused',
      'completed',
      'failed',
      'cancelled'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'caredesk_ai_action_status') then
    create type public.caredesk_ai_action_status as enum (
      'suggested',
      'approved',
      'rejected',
      'executed',
      'failed'
    );
  end if;
end $$;

create table if not exists public.caredesk_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.hub_workspaces(id) on delete set null,
  name text not null,
  slug text not null,
  kind public.caredesk_channel_kind not null,
  provider text not null default 'manual',
  external_account_id text,
  phone_number text,
  status public.caredesk_record_status not null default 'planned',
  config jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caredesk_channels_slug_key unique (slug),
  constraint caredesk_channels_name_not_blank check (btrim(name) <> ''),
  constraint caredesk_channels_slug_not_blank check (btrim(slug) <> ''),
  constraint caredesk_channels_provider_not_blank check (btrim(provider) <> '')
);

comment on table public.caredesk_channels is 'Canais conectados ao CareDesk, como WhatsApp Meta, email, telefone e chat interno.';

create table if not exists public.caredesk_queues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.hub_workspaces(id) on delete set null,
  name text not null,
  slug text not null,
  description text,
  color text not null default '#A07C3B',
  status public.caredesk_record_status not null default 'active',
  default_priority public.caredesk_priority not null default 'medium',
  sla_first_response_minutes integer not null default 60 check (sla_first_response_minutes > 0),
  sla_resolution_minutes integer not null default 480 check (sla_resolution_minutes > 0),
  routing_strategy text not null default 'manual',
  assignment_strategy text not null default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caredesk_queues_slug_key unique (slug),
  constraint caredesk_queues_name_not_blank check (btrim(name) <> ''),
  constraint caredesk_queues_slug_not_blank check (btrim(slug) <> ''),
  constraint caredesk_queues_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$')
);

comment on table public.caredesk_queues is 'Filas operacionais do CareDesk para atendimento, cobranca, suporte e comunicados.';

create table if not exists public.caredesk_queue_rules (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references public.caredesk_queues(id) on delete cascade,
  name text not null,
  priority_order integer not null default 100,
  rule_type text not null,
  conditions jsonb not null default '{}'::jsonb,
  actions jsonb not null default '{}'::jsonb,
  status public.caredesk_record_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caredesk_queue_rules_name_not_blank check (btrim(name) <> ''),
  constraint caredesk_queue_rules_type_not_blank check (btrim(rule_type) <> '')
);

comment on table public.caredesk_queue_rules is 'Regras de roteamento, prioridade, handoff e automacao das filas do CareDesk.';

create table if not exists public.caredesk_ticket_profiles (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid references public.caredesk_queues(id) on delete cascade,
  name text not null,
  slug text not null,
  category text not null,
  priority public.caredesk_priority not null default 'medium',
  sla_first_response_minutes integer not null default 60 check (sla_first_response_minutes > 0),
  sla_resolution_minutes integer not null default 480 check (sla_resolution_minutes > 0),
  description text,
  required_fields jsonb not null default '[]'::jsonb,
  automation_rules jsonb not null default '{}'::jsonb,
  status public.caredesk_record_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caredesk_ticket_profiles_queue_slug_key unique (queue_id, slug),
  constraint caredesk_ticket_profiles_name_not_blank check (btrim(name) <> ''),
  constraint caredesk_ticket_profiles_slug_not_blank check (btrim(slug) <> ''),
  constraint caredesk_ticket_profiles_category_not_blank check (btrim(category) <> '')
);

comment on table public.caredesk_ticket_profiles is 'Perfis de ticket usados para definir prioridade, SLA e exigencias operacionais.';

create table if not exists public.caredesk_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.hub_workspaces(id) on delete set null,
  c2x_user_id bigint references public.c2x_users(c2x_id) on delete set null,
  display_name text not null,
  legal_name text,
  trade_name text,
  document text,
  person_type text,
  email text,
  phone text,
  whatsapp_phone text,
  city text,
  state text,
  metadata jsonb not null default '{}'::jsonb,
  c2x_payload jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caredesk_contacts_display_name_not_blank check (btrim(display_name) <> '')
);

comment on table public.caredesk_contacts is 'Contatos atendidos pelo CareDesk, sincronizados ou enriquecidos a partir do C2X.';

create table if not exists public.caredesk_contact_entities (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.caredesk_contacts(id) on delete cascade,
  source_system text not null default 'c2x',
  source_entity_type text not null,
  source_entity_id text not null,
  label text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caredesk_contact_entities_source_key unique (contact_id, source_system, source_entity_type, source_entity_id),
  constraint caredesk_contact_entities_system_not_blank check (btrim(source_system) <> ''),
  constraint caredesk_contact_entities_type_not_blank check (btrim(source_entity_type) <> ''),
  constraint caredesk_contact_entities_id_not_blank check (btrim(source_entity_id) <> '')
);

comment on table public.caredesk_contact_entities is 'Vinculos do contato com unidades, contratos, parcelas ou outros objetos de origem.';

create table if not exists public.caredesk_tickets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.hub_workspaces(id) on delete set null,
  protocol text not null,
  contact_id uuid references public.caredesk_contacts(id) on delete set null,
  queue_id uuid references public.caredesk_queues(id) on delete set null,
  profile_id uuid references public.caredesk_ticket_profiles(id) on delete set null,
  channel_id uuid references public.caredesk_channels(id) on delete set null,
  status public.caredesk_ticket_status not null default 'new',
  priority public.caredesk_priority not null default 'medium',
  subject text,
  source_module text,
  source_entity_type text,
  source_entity_id text,
  source_context jsonb not null default '{}'::jsonb,
  assigned_to_user_id uuid references public.hub_users(id) on delete set null,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  opened_at timestamptz not null default now(),
  first_response_due_at timestamptz,
  resolution_due_at timestamptz,
  first_responded_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caredesk_tickets_protocol_key unique (protocol),
  constraint caredesk_tickets_protocol_not_blank check (btrim(protocol) <> '')
);

comment on table public.caredesk_tickets is 'Tickets operacionais do CareDesk, incluindo atendimentos vindos do Guardian e de outros modulos.';

create table if not exists public.caredesk_ticket_participants (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.caredesk_tickets(id) on delete cascade,
  participant_type text not null,
  user_id uuid references public.hub_users(id) on delete set null,
  contact_id uuid references public.caredesk_contacts(id) on delete set null,
  role text not null default 'viewer',
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caredesk_ticket_participants_type_not_blank check (btrim(participant_type) <> ''),
  constraint caredesk_ticket_participants_role_not_blank check (btrim(role) <> '')
);

comment on table public.caredesk_ticket_participants is 'Participantes humanos, clientes, agentes e sistemas vinculados a um ticket.';

create table if not exists public.caredesk_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.caredesk_tickets(id) on delete cascade,
  channel_id uuid references public.caredesk_channels(id) on delete set null,
  direction public.caredesk_direction not null default 'internal',
  sender_type public.caredesk_sender_type not null default 'system',
  sender_user_id uuid references public.hub_users(id) on delete set null,
  sender_contact_id uuid references public.caredesk_contacts(id) on delete set null,
  body text,
  message_type text not null default 'text',
  external_message_id text,
  delivery_status public.caredesk_delivery_status not null default 'draft',
  provider_payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caredesk_messages_message_type_not_blank check (btrim(message_type) <> '')
);

comment on table public.caredesk_messages is 'Mensagens do atendimento multicanal, incluindo mensagens de cliente, operador, agente e sistema.';

create table if not exists public.caredesk_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.caredesk_messages(id) on delete cascade,
  file_name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  storage_bucket text,
  storage_path text,
  external_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint caredesk_message_attachments_file_not_blank check (btrim(file_name) <> '')
);

comment on table public.caredesk_message_attachments is 'Anexos enviados ou recebidos em conversas do CareDesk.';

create table if not exists public.caredesk_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.caredesk_tickets(id) on delete cascade,
  event_type text not null,
  title text not null,
  description text,
  previous_value text,
  next_value text,
  actor_type text not null default 'system',
  actor_user_id uuid references public.hub_users(id) on delete set null,
  actor_contact_id uuid references public.caredesk_contacts(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint caredesk_ticket_events_type_not_blank check (btrim(event_type) <> ''),
  constraint caredesk_ticket_events_title_not_blank check (btrim(title) <> ''),
  constraint caredesk_ticket_events_actor_type_not_blank check (btrim(actor_type) <> '')
);

comment on table public.caredesk_ticket_events is 'Linha do tempo operacional e auditoria dos tickets.';

create table if not exists public.caredesk_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.hub_workspaces(id) on delete set null,
  name text not null,
  slug text not null,
  category text not null,
  channel_kind public.caredesk_channel_kind not null default 'whatsapp',
  body text not null,
  variables jsonb not null default '[]'::jsonb,
  status public.caredesk_record_status not null default 'active',
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caredesk_templates_slug_key unique (slug),
  constraint caredesk_templates_name_not_blank check (btrim(name) <> ''),
  constraint caredesk_templates_slug_not_blank check (btrim(slug) <> ''),
  constraint caredesk_templates_category_not_blank check (btrim(category) <> ''),
  constraint caredesk_templates_body_not_blank check (btrim(body) <> '')
);

comment on table public.caredesk_templates is 'Modelos de atendimento e disparo em massa.';

create table if not exists public.caredesk_broadcasts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.hub_workspaces(id) on delete set null,
  name text not null,
  template_id uuid references public.caredesk_templates(id) on delete set null,
  channel_id uuid references public.caredesk_channels(id) on delete set null,
  queue_id uuid references public.caredesk_queues(id) on delete set null,
  status public.caredesk_broadcast_status not null default 'draft',
  audience jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caredesk_broadcasts_name_not_blank check (btrim(name) <> '')
);

comment on table public.caredesk_broadcasts is 'Campanhas e comunicados em massa do CareDesk.';

create table if not exists public.caredesk_broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.caredesk_broadcasts(id) on delete cascade,
  contact_id uuid references public.caredesk_contacts(id) on delete set null,
  ticket_id uuid references public.caredesk_tickets(id) on delete set null,
  message_id uuid references public.caredesk_messages(id) on delete set null,
  destination text not null,
  status public.caredesk_delivery_status not null default 'queued',
  external_message_id text,
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caredesk_broadcast_recipients_destination_not_blank check (btrim(destination) <> '')
);

comment on table public.caredesk_broadcast_recipients is 'Destinatarios e status de entrega dos disparos em massa.';

create table if not exists public.caredesk_ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.caredesk_tickets(id) on delete cascade,
  contact_id uuid references public.caredesk_contacts(id) on delete set null,
  assistant_name text not null default 'Caca',
  action_type text not null,
  prompt text,
  response text not null,
  action_payload jsonb not null default '{}'::jsonb,
  status public.caredesk_ai_action_status not null default 'suggested',
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  reviewed_by_user_id uuid references public.hub_users(id) on delete set null,
  executed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caredesk_ai_suggestions_assistant_not_blank check (btrim(assistant_name) <> ''),
  constraint caredesk_ai_suggestions_action_not_blank check (btrim(action_type) <> ''),
  constraint caredesk_ai_suggestions_response_not_blank check (btrim(response) <> '')
);

comment on table public.caredesk_ai_suggestions is 'Sugestoes, respostas e acoes propostas pela Caca com validacao humana.';

insert into public.hub_modules (
  id,
  name,
  description,
  category,
  status,
  base_path,
  icon_key,
  realtime_enabled,
  "order"
) values (
  'caredesk',
  'CareDesk',
  'Atendimento multicanal compartilhado para os modulos do Hub.',
  'operations',
  'active',
  '/caredesk',
  'caredesk',
  true,
  18
) on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  status = excluded.status,
  base_path = excluded.base_path,
  icon_key = excluded.icon_key,
  realtime_enabled = excluded.realtime_enabled,
  "order" = excluded."order",
  updated_at = now();

insert into public.hub_permissions (
  id,
  key,
  scope,
  module_id,
  description
) values
  ('caredesk-view', 'caredesk:view', 'module', 'caredesk', 'Acessar o CareDesk.'),
  ('caredesk-manage', 'caredesk:manage', 'module', 'caredesk', 'Gerenciar filas, tickets, templates e automacoes do CareDesk.')
on conflict (id) do update set
  key = excluded.key,
  scope = excluded.scope,
  module_id = excluded.module_id,
  description = excluded.description,
  updated_at = now();

insert into public.caredesk_channels (
  name,
  slug,
  kind,
  provider,
  status,
  metadata
) values
  ('WhatsApp Careli', 'whatsapp-careli', 'whatsapp', 'meta', 'planned', '{"default": true}'::jsonb),
  ('Interno Careli', 'interno-careli', 'internal', 'hub', 'active', '{"default": true}'::jsonb)
on conflict (slug) do update set
  name = excluded.name,
  kind = excluded.kind,
  provider = excluded.provider,
  status = excluded.status,
  metadata = public.caredesk_channels.metadata || excluded.metadata,
  updated_at = now();

insert into public.caredesk_queues (
  name,
  slug,
  description,
  color,
  default_priority,
  sla_first_response_minutes,
  sla_resolution_minutes,
  routing_strategy,
  assignment_strategy
) values
  ('Cobranca', 'cobranca', 'Fila operacional de cobranca.', '#A07C3B', 'high', 30, 480, 'rules', 'balanced'),
  ('Atendimento', 'atendimento', 'Fila geral de atendimento.', '#A07C3B', 'medium', 60, 480, 'rules', 'balanced'),
  ('Suporte', 'suporte', 'Fila de suporte ao cliente.', '#A07C3B', 'medium', 60, 720, 'rules', 'balanced'),
  ('Financeiro', 'financeiro', 'Fila financeira e boletos.', '#A07C3B', 'high', 45, 480, 'rules', 'balanced'),
  ('Juridico', 'juridico', 'Fila juridica e contratos.', '#A07C3B', 'critical', 60, 1440, 'rules', 'manual'),
  ('Comunicados', 'comunicados', 'Fila para comunicados e disparos.', '#A07C3B', 'low', 120, 1440, 'rules', 'manual')
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  color = excluded.color,
  default_priority = excluded.default_priority,
  sla_first_response_minutes = excluded.sla_first_response_minutes,
  sla_resolution_minutes = excluded.sla_resolution_minutes,
  routing_strategy = excluded.routing_strategy,
  assignment_strategy = excluded.assignment_strategy,
  updated_at = now();

with cobranca_queue as (
  select id from public.caredesk_queues where slug = 'cobranca'
)
insert into public.caredesk_ticket_profiles (
  queue_id,
  name,
  slug,
  category,
  priority,
  sla_first_response_minutes,
  sla_resolution_minutes,
  description,
  required_fields
)
select
  cobranca_queue.id,
  profile.name,
  profile.slug,
  profile.category,
  profile.priority::public.caredesk_priority,
  profile.sla_first_response_minutes,
  profile.sla_resolution_minutes,
  profile.description,
  profile.required_fields::jsonb
from cobranca_queue
cross join (
  values
    ('Primeiro contato', 'primeiro-contato', 'Contato', 'medium', 60, 480, 'Primeira abordagem de cobranca.', '["contact_id","queue_id","priority"]'),
    ('Cobranca', 'cobranca', 'Cobranca', 'high', 30, 480, 'Cobranca ativa de saldo em atraso.', '["contact_id","queue_id","priority"]'),
    ('Lembrete de pagamento', 'lembrete-pagamento', 'Cobranca', 'medium', 120, 720, 'Lembrete de vencimento ou boleto.', '["contact_id"]'),
    ('Enviar boleto C2X', 'enviar-boleto-c2x', 'Financeiro', 'high', 30, 240, 'Envio assistido de boleto ou link de fatura.', '["contact_id","source_entity_id"]'),
    ('Negociacao', 'negociacao', 'Cobranca', 'high', 30, 360, 'Simulacao e conducao de proposta para regularizacao.', '["contact_id","source_entity_id","priority"]'),
    ('Promessa de pagamento', 'promessa-pagamento', 'Compromisso', 'high', 30, 720, 'Registro e acompanhamento de promessa de pagamento.', '["contact_id","due_at"]'),
    ('Formalizacao de acordo', 'formalizacao-acordo', 'Acordo', 'high', 30, 480, 'Formalizacao de acordo ou reativacao.', '["contact_id","source_entity_id"]'),
    ('Quebra de promessa', 'quebra-promessa', 'Risco', 'critical', 20, 240, 'Retomada operacional apos promessa quebrada.', '["contact_id","priority"]'),
    ('Duvida contratual', 'duvida-contratual', 'Juridico', 'high', 60, 1440, 'Atendimento baseado em contrato e documentos.', '["contact_id","source_entity_id"]')
) as profile(name, slug, category, priority, sla_first_response_minutes, sla_resolution_minutes, description, required_fields)
on conflict (queue_id, slug) do update set
  name = excluded.name,
  category = excluded.category,
  priority = excluded.priority,
  sla_first_response_minutes = excluded.sla_first_response_minutes,
  sla_resolution_minutes = excluded.sla_resolution_minutes,
  description = excluded.description,
  required_fields = excluded.required_fields,
  updated_at = now();

insert into public.caredesk_templates (
  name,
  slug,
  category,
  channel_kind,
  body,
  variables,
  metadata
) values
  (
    'Boleto em aberto',
    'boleto-em-aberto',
    'Financeiro',
    'whatsapp',
    'Ola, {{cliente_nome}}. Aqui e da equipe Careli. Identificamos boleto em aberto da unidade {{unidade}}. Segue o link da fatura: {{link_boleto}}',
    '["cliente_nome","unidade","link_boleto"]'::jsonb,
    '{"source": "seed"}'::jsonb
  ),
  (
    'Comunicado geral',
    'comunicado-geral',
    'Comunicados',
    'whatsapp',
    'Ola, {{cliente_nome}}. Aqui e da equipe Careli. Temos um comunicado importante: {{mensagem}}',
    '["cliente_nome","mensagem"]'::jsonb,
    '{"source": "seed"}'::jsonb
  ),
  (
    'Retorno de atendimento',
    'retorno-atendimento',
    'Atendimento',
    'whatsapp',
    'Ola, {{cliente_nome}}. Aqui e da equipe Careli. Estou retornando sobre o seu atendimento {{protocolo}}.',
    '["cliente_nome","protocolo"]'::jsonb,
    '{"source": "seed"}'::jsonb
  )
on conflict (slug) do update set
  name = excluded.name,
  category = excluded.category,
  channel_kind = excluded.channel_kind,
  body = excluded.body,
  variables = excluded.variables,
  metadata = public.caredesk_templates.metadata || excluded.metadata,
  updated_at = now();

create unique index if not exists caredesk_contacts_c2x_user_key
  on public.caredesk_contacts (workspace_id, c2x_user_id)
  where c2x_user_id is not null;

create index if not exists caredesk_contacts_document_idx
  on public.caredesk_contacts (document);

create index if not exists caredesk_contacts_phone_idx
  on public.caredesk_contacts (whatsapp_phone, phone);

create index if not exists caredesk_contact_entities_source_idx
  on public.caredesk_contact_entities (source_system, source_entity_type, source_entity_id);

create index if not exists caredesk_ticket_profiles_queue_idx
  on public.caredesk_ticket_profiles (queue_id, status);

create index if not exists caredesk_queue_rules_queue_order_idx
  on public.caredesk_queue_rules (queue_id, status, priority_order);

create index if not exists caredesk_tickets_queue_status_priority_idx
  on public.caredesk_tickets (queue_id, status, priority, opened_at desc);

create index if not exists caredesk_tickets_assigned_status_idx
  on public.caredesk_tickets (assigned_to_user_id, status, opened_at desc);

create index if not exists caredesk_tickets_contact_idx
  on public.caredesk_tickets (contact_id, opened_at desc);

create index if not exists caredesk_tickets_source_idx
  on public.caredesk_tickets (source_module, source_entity_type, source_entity_id);

create index if not exists caredesk_messages_ticket_created_idx
  on public.caredesk_messages (ticket_id, created_at);

create unique index if not exists caredesk_messages_external_key
  on public.caredesk_messages (external_message_id)
  where external_message_id is not null;

create index if not exists caredesk_ticket_events_ticket_created_idx
  on public.caredesk_ticket_events (ticket_id, created_at desc);

create index if not exists caredesk_broadcasts_status_scheduled_idx
  on public.caredesk_broadcasts (status, scheduled_at);

create index if not exists caredesk_broadcast_recipients_broadcast_status_idx
  on public.caredesk_broadcast_recipients (broadcast_id, status);

create index if not exists caredesk_ai_suggestions_ticket_created_idx
  on public.caredesk_ai_suggestions (ticket_id, created_at desc);

drop trigger if exists set_caredesk_channels_updated_at on public.caredesk_channels;
create trigger set_caredesk_channels_updated_at
before update on public.caredesk_channels
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_caredesk_queues_updated_at on public.caredesk_queues;
create trigger set_caredesk_queues_updated_at
before update on public.caredesk_queues
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_caredesk_queue_rules_updated_at on public.caredesk_queue_rules;
create trigger set_caredesk_queue_rules_updated_at
before update on public.caredesk_queue_rules
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_caredesk_ticket_profiles_updated_at on public.caredesk_ticket_profiles;
create trigger set_caredesk_ticket_profiles_updated_at
before update on public.caredesk_ticket_profiles
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_caredesk_contacts_updated_at on public.caredesk_contacts;
create trigger set_caredesk_contacts_updated_at
before update on public.caredesk_contacts
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_caredesk_contact_entities_updated_at on public.caredesk_contact_entities;
create trigger set_caredesk_contact_entities_updated_at
before update on public.caredesk_contact_entities
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_caredesk_tickets_updated_at on public.caredesk_tickets;
create trigger set_caredesk_tickets_updated_at
before update on public.caredesk_tickets
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_caredesk_ticket_participants_updated_at on public.caredesk_ticket_participants;
create trigger set_caredesk_ticket_participants_updated_at
before update on public.caredesk_ticket_participants
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_caredesk_messages_updated_at on public.caredesk_messages;
create trigger set_caredesk_messages_updated_at
before update on public.caredesk_messages
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_caredesk_templates_updated_at on public.caredesk_templates;
create trigger set_caredesk_templates_updated_at
before update on public.caredesk_templates
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_caredesk_broadcasts_updated_at on public.caredesk_broadcasts;
create trigger set_caredesk_broadcasts_updated_at
before update on public.caredesk_broadcasts
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_caredesk_broadcast_recipients_updated_at on public.caredesk_broadcast_recipients;
create trigger set_caredesk_broadcast_recipients_updated_at
before update on public.caredesk_broadcast_recipients
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_caredesk_ai_suggestions_updated_at on public.caredesk_ai_suggestions;
create trigger set_caredesk_ai_suggestions_updated_at
before update on public.caredesk_ai_suggestions
for each row execute function public.set_hub_updated_at();

alter table public.caredesk_channels enable row level security;
alter table public.caredesk_queues enable row level security;
alter table public.caredesk_queue_rules enable row level security;
alter table public.caredesk_ticket_profiles enable row level security;
alter table public.caredesk_contacts enable row level security;
alter table public.caredesk_contact_entities enable row level security;
alter table public.caredesk_tickets enable row level security;
alter table public.caredesk_ticket_participants enable row level security;
alter table public.caredesk_messages enable row level security;
alter table public.caredesk_message_attachments enable row level security;
alter table public.caredesk_ticket_events enable row level security;
alter table public.caredesk_templates enable row level security;
alter table public.caredesk_broadcasts enable row level security;
alter table public.caredesk_broadcast_recipients enable row level security;
alter table public.caredesk_ai_suggestions enable row level security;

grant select on
  public.caredesk_channels,
  public.caredesk_queues,
  public.caredesk_queue_rules,
  public.caredesk_ticket_profiles,
  public.caredesk_contacts,
  public.caredesk_contact_entities,
  public.caredesk_tickets,
  public.caredesk_ticket_participants,
  public.caredesk_messages,
  public.caredesk_message_attachments,
  public.caredesk_ticket_events,
  public.caredesk_templates,
  public.caredesk_broadcasts,
  public.caredesk_broadcast_recipients,
  public.caredesk_ai_suggestions
to authenticated;

grant insert, update on
  public.caredesk_channels,
  public.caredesk_queues,
  public.caredesk_queue_rules,
  public.caredesk_ticket_profiles,
  public.caredesk_contacts,
  public.caredesk_contact_entities,
  public.caredesk_tickets,
  public.caredesk_ticket_participants,
  public.caredesk_messages,
  public.caredesk_message_attachments,
  public.caredesk_ticket_events,
  public.caredesk_templates,
  public.caredesk_broadcasts,
  public.caredesk_broadcast_recipients,
  public.caredesk_ai_suggestions
to authenticated;

do $$
declare
  caredesk_table text;
begin
  foreach caredesk_table in array array[
    'caredesk_channels',
    'caredesk_queues',
    'caredesk_queue_rules',
    'caredesk_ticket_profiles',
    'caredesk_contacts',
    'caredesk_contact_entities',
    'caredesk_tickets',
    'caredesk_ticket_participants',
    'caredesk_messages',
    'caredesk_message_attachments',
    'caredesk_ticket_events',
    'caredesk_templates',
    'caredesk_broadcasts',
    'caredesk_broadcast_recipients',
    'caredesk_ai_suggestions'
  ] loop
    execute format('drop policy if exists "caredesk authenticated read" on public.%I', caredesk_table);
    execute format(
      'create policy "caredesk authenticated read" on public.%I for select to authenticated using (true)',
      caredesk_table
    );
  end loop;
end $$;

do $$
declare
  caredesk_table text;
begin
  foreach caredesk_table in array array[
    'caredesk_channels',
    'caredesk_queues',
    'caredesk_queue_rules',
    'caredesk_ticket_profiles',
    'caredesk_templates'
  ] loop
    execute format('drop policy if exists "caredesk authenticated setup manage" on public.%I', caredesk_table);
    execute format($policy$
      create policy "caredesk authenticated setup manage"
        on public.%I
        for all
        to authenticated
        using (
          exists (
            select 1
            from public.hub_users user_profile
            where user_profile.id = auth.uid()
              and user_profile.status = 'active'
              and user_profile.role in ('admin', 'leader')
          )
        )
        with check (
          exists (
            select 1
            from public.hub_users user_profile
            where user_profile.id = auth.uid()
              and user_profile.status = 'active'
              and user_profile.role in ('admin', 'leader')
          )
        )
    $policy$, caredesk_table);
  end loop;
end $$;

do $$
declare
  caredesk_table text;
begin
  foreach caredesk_table in array array[
    'caredesk_contacts',
    'caredesk_contact_entities',
    'caredesk_tickets',
    'caredesk_ticket_participants',
    'caredesk_messages',
    'caredesk_message_attachments',
    'caredesk_ticket_events',
    'caredesk_broadcasts',
    'caredesk_broadcast_recipients',
    'caredesk_ai_suggestions'
  ] loop
    execute format('drop policy if exists "caredesk authenticated operation manage" on public.%I', caredesk_table);
    execute format($policy$
      create policy "caredesk authenticated operation manage"
        on public.%I
        for all
        to authenticated
        using (
          exists (
            select 1
            from public.hub_users user_profile
            where user_profile.id = auth.uid()
              and user_profile.status = 'active'
              and user_profile.role in ('admin', 'leader', 'operator')
          )
        )
        with check (
          exists (
            select 1
            from public.hub_users user_profile
            where user_profile.id = auth.uid()
              and user_profile.status = 'active'
              and user_profile.role in ('admin', 'leader', 'operator')
          )
        )
    $policy$, caredesk_table);
  end loop;
end $$;

alter table public.caredesk_tickets replica identity full;
alter table public.caredesk_messages replica identity full;
alter table public.caredesk_ticket_events replica identity full;
alter table public.caredesk_broadcasts replica identity full;
alter table public.caredesk_broadcast_recipients replica identity full;

commit;
