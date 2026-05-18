-- SquadOps release protocols.
-- Connects operational activity protocols (AT-*), commits, homologation,
-- production deploys and healthchecks through a DP-* release protocol.

begin;

create sequence if not exists public.hub_release_protocol_seq
  as bigint
  increment by 1
  minvalue 1
  start with 1;

create or replace function public.next_hub_release_protocol()
returns text
language sql
set search_path = public
as $$
  select 'DP-' || lpad(nextval('public.hub_release_protocol_seq')::text, 4, '0')
$$;

revoke all on function public.next_hub_release_protocol() from public;
grant execute on function public.next_hub_release_protocol()
to authenticated, service_role;
grant usage, select on sequence public.hub_release_protocol_seq
to authenticated, service_role;

create table if not exists public.hub_release_protocols (
  id uuid primary key default gen_random_uuid(),
  protocol text not null default public.next_hub_release_protocol(),
  title text not null,
  summary text,
  environment text not null default 'homologacao',
  status text not null default 'planejado',
  commit_sha text,
  commit_message text,
  git_branch text,
  vercel_deployment_id text,
  vercel_url text,
  vercel_alias text,
  build_status text,
  healthcheck_summary text,
  release_notes text,
  planned_at timestamptz not null default now(),
  homologated_at timestamptz,
  deployed_at timestamptz,
  finished_at timestamptz,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  homologated_by_user_id uuid references public.hub_users(id) on delete set null,
  deployed_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_release_protocols_protocol_key unique (protocol),
  constraint hub_release_protocols_protocol_not_blank check (btrim(protocol) <> ''),
  constraint hub_release_protocols_title_not_blank check (btrim(title) <> ''),
  constraint hub_release_protocols_environment_check check (
    environment in ('desenvolvimento', 'qa', 'homologacao', 'producao')
  ),
  constraint hub_release_protocols_status_check check (
    status in (
      'planejado',
      'aguardando_homologacao',
      'em_homologacao',
      'homologado',
      'aguardando_producao',
      'em_producao',
      'bloqueado',
      'rollback',
      'finalizado'
    )
  )
);

comment on table public.hub_release_protocols is
  'Protocolos macro de release/deploy do SquadOps no padrao DP-0001, cruzando AT-*, commit, homologacao, producao e healthchecks.';

comment on column public.hub_release_protocols.protocol is
  'Codigo curto e sequencial do deploy/release, no padrao DP-0001.';

comment on column public.hub_release_protocols.environment is
  'Ambiente atual do protocolo de release: desenvolvimento, qa, homologacao ou producao.';

comment on column public.hub_release_protocols.status is
  'Status operacional do release protocol, incluindo homologacao, producao, bloqueio e rollback.';

create table if not exists public.hub_release_protocol_items (
  id uuid primary key default gen_random_uuid(),
  release_protocol_id uuid not null references public.hub_release_protocols(id) on delete cascade,
  operation_record_id uuid references public.hub_engineering_operation_records(id) on delete set null,
  protocol text not null,
  module text not null default 'nao informado',
  screen text not null default 'nao informado',
  change_type text not null default 'nao informado',
  status_before text,
  status_after text,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_release_protocol_items_unique_protocol unique (release_protocol_id, protocol),
  constraint hub_release_protocol_items_protocol_not_blank check (btrim(protocol) <> '')
);

comment on table public.hub_release_protocol_items is
  'Itens AT-*/AL-* incluidos em um protocolo DP-* para rastrear o que entrou em homologacao ou producao.';

create table if not exists public.hub_release_environment_events (
  id uuid primary key default gen_random_uuid(),
  release_protocol_id uuid not null references public.hub_release_protocols(id) on delete cascade,
  environment text not null,
  event_type text not null,
  status text not null,
  summary text not null,
  occurred_at timestamptz not null default now(),
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint hub_release_environment_events_environment_check check (
    environment in ('desenvolvimento', 'qa', 'homologacao', 'producao')
  ),
  constraint hub_release_environment_events_type_not_blank check (btrim(event_type) <> ''),
  constraint hub_release_environment_events_status_not_blank check (btrim(status) <> ''),
  constraint hub_release_environment_events_summary_not_blank check (btrim(summary) <> '')
);

comment on table public.hub_release_environment_events is
  'Linha do tempo por ambiente de cada DP-*, incluindo homologacao, producao, healthcheck, bloqueio e rollback.';

create index if not exists hub_release_protocols_status_environment_idx
  on public.hub_release_protocols (status, environment, updated_at desc);

create index if not exists hub_release_protocols_commit_idx
  on public.hub_release_protocols (commit_sha)
  where commit_sha is not null;

create index if not exists hub_release_protocols_deployment_idx
  on public.hub_release_protocols (vercel_deployment_id)
  where vercel_deployment_id is not null;

create index if not exists hub_release_protocol_items_protocol_idx
  on public.hub_release_protocol_items (protocol);

create index if not exists hub_release_protocol_items_release_idx
  on public.hub_release_protocol_items (release_protocol_id, created_at);

create index if not exists hub_release_environment_events_release_idx
  on public.hub_release_environment_events (release_protocol_id, occurred_at desc);

drop trigger if exists set_hub_release_protocols_updated_at
  on public.hub_release_protocols;
create trigger set_hub_release_protocols_updated_at
before update on public.hub_release_protocols
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_hub_release_protocol_items_updated_at
  on public.hub_release_protocol_items;
create trigger set_hub_release_protocol_items_updated_at
before update on public.hub_release_protocol_items
for each row execute function public.set_hub_updated_at();

alter table public.hub_release_protocols enable row level security;
alter table public.hub_release_protocol_items enable row level security;
alter table public.hub_release_environment_events enable row level security;

grant select, insert, update, delete on
  public.hub_release_protocols,
  public.hub_release_protocol_items,
  public.hub_release_environment_events
to authenticated, service_role;

drop policy if exists "hub release protocols admin manage"
  on public.hub_release_protocols;
create policy "hub release protocols admin manage"
  on public.hub_release_protocols
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role = 'admin'
          or user_profile.operational_profile = 'adm'
        )
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role = 'admin'
          or user_profile.operational_profile = 'adm'
        )
    )
  );

drop policy if exists "hub release protocol items admin manage"
  on public.hub_release_protocol_items;
create policy "hub release protocol items admin manage"
  on public.hub_release_protocol_items
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role = 'admin'
          or user_profile.operational_profile = 'adm'
        )
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role = 'admin'
          or user_profile.operational_profile = 'adm'
        )
    )
  );

drop policy if exists "hub release environment events admin manage"
  on public.hub_release_environment_events;
create policy "hub release environment events admin manage"
  on public.hub_release_environment_events
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role = 'admin'
          or user_profile.operational_profile = 'adm'
        )
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and (
          user_profile.role = 'admin'
          or user_profile.operational_profile = 'adm'
        )
    )
  );

alter table public.hub_release_protocols replica identity full;
alter table public.hub_release_protocol_items replica identity full;
alter table public.hub_release_environment_events replica identity full;

commit;
