-- Iris: fila de monitoramento de grupos de WhatsApp (CACÁ observadora).
-- Gateway = Evolution API (instância caca-observadora) num número dedicado, read-only.
-- Modelo: 1 grupo = 1 conversa contínua (ticket que não fecha) na fila "Grupos".
-- Canal reaproveita kind 'whatsapp' com provider 'evolution' (config marca "grupo").

begin;

-- Canal "WhatsApp - Grupo" (Evolution / Baileys, somente leitura).
insert into public.caredesk_channels (name, slug, kind, provider, status, config, metadata)
values (
  'WhatsApp - Grupo',
  'whatsapp-grupo',
  'whatsapp',
  'evolution',
  'active',
  jsonb_build_object(
    'mode', 'group-monitor',
    'readOnly', true,
    'evolutionInstance', 'caca-observadora'
  ),
  jsonb_build_object(
    'description', 'Monitoramento passivo de grupos de WhatsApp pela CACÁ (Evolution API).'
  )
)
on conflict (slug) do nothing;

-- Fila "Grupos": SLA de primeira resposta mais folgado que o atendimento 1:1.
insert into public.caredesk_queues (
  name, slug, description, color, status, default_priority,
  sla_first_response_minutes, sla_resolution_minutes,
  routing_strategy, assignment_strategy
)
values (
  'Grupos',
  'grupos-whatsapp',
  'Grupos de WhatsApp monitorados pela CACÁ — cada grupo é uma conversa contínua.',
  '#2E7D6B',
  'active',
  'medium',
  120,
  1440,
  'manual',
  'manual'
)
on conflict (slug) do nothing;

-- Registro dos grupos monitorados: mapeia JID do grupo -> conversa (ticket)
-- e guarda estado próprio do grupo (nome, nº de participantes, última atividade,
-- e o liga/desliga do monitoramento por grupo).
create table if not exists public.caredesk_whatsapp_groups (
  id uuid primary key default gen_random_uuid(),
  group_jid text not null,
  subject text,
  participants_count integer check (participants_count is null or participants_count >= 0),
  evolution_instance text not null default 'caca-observadora',
  channel_id uuid references public.caredesk_channels(id) on delete set null,
  ticket_id uuid references public.caredesk_tickets(id) on delete set null,
  contact_id uuid references public.caredesk_contacts(id) on delete set null,
  monitored boolean not null default true,
  last_message_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caredesk_whatsapp_groups_jid_key unique (group_jid),
  constraint caredesk_whatsapp_groups_jid_not_blank check (btrim(group_jid) <> '')
);

comment on table public.caredesk_whatsapp_groups is
  'Grupos de WhatsApp monitorados pela CACÁ via Evolution API. 1 grupo = 1 conversa (ticket) na fila Grupos.';

create index if not exists caredesk_whatsapp_groups_ticket_idx
  on public.caredesk_whatsapp_groups (ticket_id);
create index if not exists caredesk_whatsapp_groups_monitored_idx
  on public.caredesk_whatsapp_groups (monitored) where monitored;

-- RLS: negar por padrão. Escrita/leitura server-side usam service-role (bypass).
-- A UI da Iris lê os grupos pela conversa (tickets), que já tem políticas próprias.
alter table public.caredesk_whatsapp_groups enable row level security;

commit;
