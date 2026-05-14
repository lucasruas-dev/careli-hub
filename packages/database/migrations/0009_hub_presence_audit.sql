alter type public.hub_presence_status add value if not exists 'lunch';
alter type public.hub_presence_status add value if not exists 'agenda';

create table if not exists public.hub_presence_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.hub_users(id) on delete cascade,
  workspace_id uuid references public.hub_workspaces(id) on delete cascade,
  module_id text references public.hub_modules(id) on delete set null,
  previous_status public.hub_presence_status,
  next_status public.hub_presence_status not null,
  reason text not null default 'status_change',
  source text not null default 'hub',
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint hub_presence_events_reason_not_blank check (btrim(reason) <> ''),
  constraint hub_presence_events_source_not_blank check (btrim(source) <> ''),
  constraint hub_presence_events_period_order check (
    ended_at is null or ended_at >= started_at
  )
);

comment on table public.hub_presence_events is 'Linha do tempo de presenca dos usuarios do Hub para auditoria e calculo de jornada.';
comment on column public.hub_presence_events.previous_status is 'Status anterior no momento da transicao.';
comment on column public.hub_presence_events.next_status is 'Status assumido a partir de started_at.';
comment on column public.hub_presence_events.reason is 'Motivo da transicao: login, logout, manual, idle, heartbeat ou agenda.';
comment on column public.hub_presence_events.source is 'Origem que solicitou a mudanca de presenca.';

create index if not exists hub_presence_events_user_started_at_idx
  on public.hub_presence_events (user_id, started_at desc);

create index if not exists hub_presence_events_context_started_at_idx
  on public.hub_presence_events (workspace_id, module_id, started_at desc);

create index if not exists hub_presence_events_open_idx
  on public.hub_presence_events (user_id, workspace_id, module_id)
  where ended_at is null;

alter table public.hub_presence_events replica identity full;
