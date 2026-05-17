-- HubOps structured engineering operations.
-- Keeps Engineering Operations markdown as append-only audit history while
-- creating queryable records for HubOps, ReleaseOps and future DataOps flows.

begin;

create sequence if not exists public.hub_engineering_operation_protocol_seq
  as bigint
  increment by 1
  minvalue 1
  start with 1;

create table if not exists public.hub_engineering_operation_records (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  content_hash text not null,
  protocol text not null default ('AT-' || lpad(nextval('public.hub_engineering_operation_protocol_seq')::text, 4, '0')),
  source_path text not null default 'docs/codex/engineering-operations.md',
  source_index integer not null default 0 check (source_index >= 0),
  line_start integer not null default 0 check (line_start >= 0),
  subject text not null,
  module text not null default 'nao informado',
  squad text not null default 'nao informado',
  status text not null default 'nao informado',
  record_type text not null default 'nao informado',
  change_category text not null default 'nao informado',
  screen text not null default 'nao informado',
  local_date_time text,
  local_occurred_at timestamptz,
  commit_sha text,
  deployment text,
  validation text,
  healthchecks text,
  affected_files text,
  reason text,
  how text,
  logic text,
  macro_summary text,
  risks text,
  next_squad text,
  raw_content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_engineering_operation_records_source_key unique (source_key),
  constraint hub_engineering_operation_records_protocol_key unique (protocol),
  constraint hub_engineering_operation_records_source_key_not_blank check (btrim(source_key) <> ''),
  constraint hub_engineering_operation_records_content_hash_not_blank check (btrim(content_hash) <> ''),
  constraint hub_engineering_operation_records_protocol_not_blank check (btrim(protocol) <> ''),
  constraint hub_engineering_operation_records_subject_not_blank check (btrim(subject) <> ''),
  constraint hub_engineering_operation_records_raw_content_not_blank check (btrim(raw_content) <> '')
);

comment on table public.hub_engineering_operation_records is
  'Registros estruturados derivados do Engineering Operations markdown para consulta operacional do HubOps.';

comment on column public.hub_engineering_operation_records.source_key is
  'Hash estavel de origem do registro no arquivo, usado para upsert idempotente.';

comment on column public.hub_engineering_operation_records.content_hash is
  'Hash do conteudo bruto do registro, usado para auditoria de alteracao documental.';

comment on column public.hub_engineering_operation_records.protocol is
  'Codigo curto e sequencial da atividade operacional, no padrao AT-0001.';

create table if not exists public.hub_engineering_operation_releases (
  id uuid primary key default gen_random_uuid(),
  operation_record_id uuid not null references public.hub_engineering_operation_records(id) on delete cascade,
  protocol text not null,
  commit_sha text,
  deployment text,
  environment text not null default 'nao informado',
  status text not null default 'nao informado',
  summary text,
  healthchecks text,
  released_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_engineering_operation_releases_record_key unique (operation_record_id),
  constraint hub_engineering_operation_releases_protocol_not_blank check (btrim(protocol) <> '')
);

comment on table public.hub_engineering_operation_releases is
  'Visao estruturada dos registros de release/deploy derivados do Engineering Operations.';

create table if not exists public.hub_engineering_operation_healthchecks (
  id uuid primary key default gen_random_uuid(),
  operation_record_id uuid not null references public.hub_engineering_operation_records(id) on delete cascade,
  protocol text not null,
  source text not null default 'engineering-operations',
  status text not null default 'registrado',
  summary text not null,
  checked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_engineering_operation_healthchecks_record_key unique (operation_record_id),
  constraint hub_engineering_operation_healthchecks_protocol_not_blank check (btrim(protocol) <> ''),
  constraint hub_engineering_operation_healthchecks_summary_not_blank check (btrim(summary) <> '')
);

comment on table public.hub_engineering_operation_healthchecks is
  'Resumo estruturado de validacoes e healthchecks registrados no diario operacional.';

create table if not exists public.hub_engineering_operation_handoffs (
  id uuid primary key default gen_random_uuid(),
  operation_record_id uuid not null references public.hub_engineering_operation_records(id) on delete cascade,
  protocol text not null,
  from_squad text not null default 'nao informado',
  to_squad text not null default 'nao informado',
  status text not null default 'nao informado',
  risks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_engineering_operation_handoffs_record_key unique (operation_record_id),
  constraint hub_engineering_operation_handoffs_protocol_not_blank check (btrim(protocol) <> '')
);

comment on table public.hub_engineering_operation_handoffs is
  'Handoffs estruturados entre squads, derivados dos campos do Engineering Operations.';

create table if not exists public.hub_engineering_operation_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_path text not null,
  status text not null,
  records_total integer not null default 0 check (records_total >= 0),
  records_upserted integer not null default 0 check (records_upserted >= 0),
  releases_upserted integer not null default 0 check (releases_upserted >= 0),
  healthchecks_upserted integer not null default 0 check (healthchecks_upserted >= 0),
  handoffs_upserted integer not null default 0 check (handoffs_upserted >= 0),
  executed_by_user_id uuid references public.hub_users(id) on delete set null,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint hub_engineering_operation_sync_runs_status_not_blank check (btrim(status) <> ''),
  constraint hub_engineering_operation_sync_runs_source_path_not_blank check (btrim(source_path) <> '')
);

comment on table public.hub_engineering_operation_sync_runs is
  'Historico de sincronizacoes do Engineering Operations markdown para tabelas estruturadas.';

create index if not exists hub_engineering_operation_records_status_idx
  on public.hub_engineering_operation_records (status, local_occurred_at desc nulls last);

create index if not exists hub_engineering_operation_records_module_idx
  on public.hub_engineering_operation_records (module, local_occurred_at desc nulls last);

create index if not exists hub_engineering_operation_records_release_idx
  on public.hub_engineering_operation_records (record_type, status, local_occurred_at desc nulls last);

create index if not exists hub_engineering_operation_records_content_hash_idx
  on public.hub_engineering_operation_records (content_hash);

create index if not exists hub_engineering_operation_releases_status_idx
  on public.hub_engineering_operation_releases (status, released_at desc nulls last);

create index if not exists hub_engineering_operation_sync_runs_created_idx
  on public.hub_engineering_operation_sync_runs (created_at desc);

drop trigger if exists set_hub_engineering_operation_records_updated_at
  on public.hub_engineering_operation_records;
create trigger set_hub_engineering_operation_records_updated_at
before update on public.hub_engineering_operation_records
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_hub_engineering_operation_releases_updated_at
  on public.hub_engineering_operation_releases;
create trigger set_hub_engineering_operation_releases_updated_at
before update on public.hub_engineering_operation_releases
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_hub_engineering_operation_healthchecks_updated_at
  on public.hub_engineering_operation_healthchecks;
create trigger set_hub_engineering_operation_healthchecks_updated_at
before update on public.hub_engineering_operation_healthchecks
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_hub_engineering_operation_handoffs_updated_at
  on public.hub_engineering_operation_handoffs;
create trigger set_hub_engineering_operation_handoffs_updated_at
before update on public.hub_engineering_operation_handoffs
for each row execute function public.set_hub_updated_at();

alter table public.hub_engineering_operation_records enable row level security;
alter table public.hub_engineering_operation_releases enable row level security;
alter table public.hub_engineering_operation_healthchecks enable row level security;
alter table public.hub_engineering_operation_handoffs enable row level security;
alter table public.hub_engineering_operation_sync_runs enable row level security;

grant select, insert, update on
  public.hub_engineering_operation_records,
  public.hub_engineering_operation_releases,
  public.hub_engineering_operation_healthchecks,
  public.hub_engineering_operation_handoffs,
  public.hub_engineering_operation_sync_runs
to authenticated, service_role;

grant usage, select on sequence public.hub_engineering_operation_protocol_seq
to authenticated, service_role;

drop policy if exists "hub engineering operation records admin read"
  on public.hub_engineering_operation_records;
create policy "hub engineering operation records admin read"
  on public.hub_engineering_operation_records
  for select
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
  );

drop policy if exists "hub engineering operation records admin manage"
  on public.hub_engineering_operation_records;
create policy "hub engineering operation records admin manage"
  on public.hub_engineering_operation_records
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

drop policy if exists "hub engineering operation releases admin read"
  on public.hub_engineering_operation_releases;
create policy "hub engineering operation releases admin read"
  on public.hub_engineering_operation_releases
  for select
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
  );

drop policy if exists "hub engineering operation releases admin manage"
  on public.hub_engineering_operation_releases;
create policy "hub engineering operation releases admin manage"
  on public.hub_engineering_operation_releases
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

drop policy if exists "hub engineering operation healthchecks admin read"
  on public.hub_engineering_operation_healthchecks;
create policy "hub engineering operation healthchecks admin read"
  on public.hub_engineering_operation_healthchecks
  for select
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
  );

drop policy if exists "hub engineering operation healthchecks admin manage"
  on public.hub_engineering_operation_healthchecks;
create policy "hub engineering operation healthchecks admin manage"
  on public.hub_engineering_operation_healthchecks
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

drop policy if exists "hub engineering operation handoffs admin read"
  on public.hub_engineering_operation_handoffs;
create policy "hub engineering operation handoffs admin read"
  on public.hub_engineering_operation_handoffs
  for select
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
  );

drop policy if exists "hub engineering operation handoffs admin manage"
  on public.hub_engineering_operation_handoffs;
create policy "hub engineering operation handoffs admin manage"
  on public.hub_engineering_operation_handoffs
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

drop policy if exists "hub engineering operation sync runs admin read"
  on public.hub_engineering_operation_sync_runs;
create policy "hub engineering operation sync runs admin read"
  on public.hub_engineering_operation_sync_runs
  for select
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
  );

drop policy if exists "hub engineering operation sync runs admin manage"
  on public.hub_engineering_operation_sync_runs;
create policy "hub engineering operation sync runs admin manage"
  on public.hub_engineering_operation_sync_runs
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

alter table public.hub_engineering_operation_records replica identity full;
alter table public.hub_engineering_operation_releases replica identity full;
alter table public.hub_engineering_operation_healthchecks replica identity full;
alter table public.hub_engineering_operation_handoffs replica identity full;
alter table public.hub_engineering_operation_sync_runs replica identity full;

commit;
