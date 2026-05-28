-- Chronos Google Calendar mirror.
-- OAuth state, server-only token storage, idempotent event links and sync audit.

begin;

create table if not exists public.chronos_google_calendar_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  code_verifier text not null,
  requested_by_user_id uuid references public.hub_users(id) on delete set null,
  redirect_after text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint chronos_google_calendar_oauth_states_state_hash_not_blank
    check (btrim(state_hash) <> ''),
  constraint chronos_google_calendar_oauth_states_code_verifier_not_blank
    check (btrim(code_verifier) <> '')
);

comment on table public.chronos_google_calendar_oauth_states is
  'State OAuth temporario para conectar o Chronos ao Google Agenda sem expor secrets.';

create table if not exists public.chronos_google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  calendar_id text not null default 'primary',
  refresh_token text not null,
  token_type text,
  scope text[] not null default '{}'::text[],
  status text not null default 'active'
    check (status in ('active', 'revoked', 'error')),
  is_default boolean not null default true,
  sync_token text,
  sync_token_status text not null default 'missing'
    check (sync_token_status in ('active', 'expired', 'missing')),
  last_synced_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chronos_google_calendar_connections_calendar_not_blank
    check (btrim(calendar_id) <> ''),
  constraint chronos_google_calendar_connections_refresh_token_not_blank
    check (btrim(refresh_token) <> '')
);

comment on table public.chronos_google_calendar_connections is
  'Conexao server-only do Chronos com Google Agenda. O refresh token nunca deve sair do servidor.';

create unique index if not exists chronos_google_calendar_connections_default_idx
  on public.chronos_google_calendar_connections (calendar_id)
  where status = 'active' and is_default;

create table if not exists public.chronos_google_calendar_event_links (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.chronos_meetings(id) on delete cascade,
  connection_id uuid references public.chronos_google_calendar_connections(id) on delete set null,
  calendar_id text not null,
  google_event_id text not null,
  google_ical_uid text,
  google_etag text,
  google_html_link text,
  origin text not null default 'chronos'
    check (origin in ('chronos', 'google')),
  sync_status text not null default 'pending'
    check (sync_status in ('pending', 'synced', 'conflict', 'deleted', 'error')),
  last_synced_at timestamptz,
  last_google_updated_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chronos_google_calendar_event_links_calendar_not_blank
    check (btrim(calendar_id) <> ''),
  constraint chronos_google_calendar_event_links_event_not_blank
    check (btrim(google_event_id) <> ''),
  constraint chronos_google_calendar_event_links_meeting_calendar_key
    unique (meeting_id, calendar_id),
  constraint chronos_google_calendar_event_links_event_key
    unique (calendar_id, google_event_id)
);

comment on table public.chronos_google_calendar_event_links is
  'Vinculo idempotente entre reuniao Chronos e evento Google Agenda.';

create table if not exists public.chronos_google_calendar_sync_runs (
  id uuid primary key default gen_random_uuid(),
  direction text not null
    check (direction in ('push', 'pull', 'both')),
  status text not null
    check (status in ('running', 'success', 'failed')),
  started_by_user_id uuid references public.hub_users(id) on delete set null,
  processed_events integer not null default 0 check (processed_events >= 0),
  synced_events integer not null default 0 check (synced_events >= 0),
  skipped_events integer not null default 0 check (skipped_events >= 0),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table public.chronos_google_calendar_sync_runs is
  'Auditoria agregada de execucoes do espelho Chronos Google Agenda.';

create index if not exists chronos_google_calendar_oauth_states_expiry_idx
  on public.chronos_google_calendar_oauth_states (expires_at)
  where consumed_at is null;

create index if not exists chronos_google_calendar_event_links_meeting_idx
  on public.chronos_google_calendar_event_links (meeting_id, sync_status);

create index if not exists chronos_google_calendar_sync_runs_created_idx
  on public.chronos_google_calendar_sync_runs (created_at desc);

drop trigger if exists set_chronos_google_calendar_connections_updated_at
  on public.chronos_google_calendar_connections;
create trigger set_chronos_google_calendar_connections_updated_at
before update on public.chronos_google_calendar_connections
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_chronos_google_calendar_event_links_updated_at
  on public.chronos_google_calendar_event_links;
create trigger set_chronos_google_calendar_event_links_updated_at
before update on public.chronos_google_calendar_event_links
for each row execute function public.set_hub_updated_at();

alter table public.chronos_google_calendar_oauth_states enable row level security;
alter table public.chronos_google_calendar_connections enable row level security;
alter table public.chronos_google_calendar_event_links enable row level security;
alter table public.chronos_google_calendar_sync_runs enable row level security;

revoke all on
  public.chronos_google_calendar_oauth_states,
  public.chronos_google_calendar_connections,
  public.chronos_google_calendar_event_links,
  public.chronos_google_calendar_sync_runs
from anon, authenticated;

grant select, insert, update, delete on
  public.chronos_google_calendar_oauth_states,
  public.chronos_google_calendar_connections,
  public.chronos_google_calendar_event_links,
  public.chronos_google_calendar_sync_runs
to service_role;

alter table public.chronos_google_calendar_connections replica identity full;
alter table public.chronos_google_calendar_event_links replica identity full;
alter table public.chronos_google_calendar_sync_runs replica identity full;

commit;
