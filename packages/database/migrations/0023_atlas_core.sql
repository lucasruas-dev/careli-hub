-- Atlas Core Hub persistence.
-- Non-destructive import target for the existing careli-performance database.

begin;

create table if not exists public.atlas_migration_batches (
  id uuid primary key default gen_random_uuid(),
  source_project_ref text,
  source_schema text not null default 'public',
  status text not null default 'draft',
  started_at timestamptz,
  finished_at timestamptz,
  source_counts jsonb not null default '{}'::jsonb,
  imported_counts jsonb not null default '{}'::jsonb,
  notes text,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint atlas_migration_batches_status_check check (
    status in ('draft', 'running', 'completed', 'completed_with_warnings', 'failed')
  )
);

comment on table public.atlas_migration_batches is
  'Batches de migracao controlada do Atlas legado para o Hub.';

create table if not exists public.atlas_departments (
  id uuid primary key default gen_random_uuid(),
  legacy_id uuid not null unique,
  name text not null,
  migration_batch_id uuid references public.atlas_migration_batches(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint atlas_departments_name_not_blank check (btrim(name) <> '')
);

comment on table public.atlas_departments is
  'Departamentos importados da tabela setores do Atlas legado.';

create table if not exists public.atlas_roles (
  id uuid primary key default gen_random_uuid(),
  legacy_id uuid not null unique,
  name text not null,
  base_value numeric(12,2),
  migration_batch_id uuid references public.atlas_migration_batches(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint atlas_roles_name_not_blank check (btrim(name) <> '')
);

comment on table public.atlas_roles is
  'Cargos e valores base importados do Atlas legado.';

create table if not exists public.atlas_collaborators (
  id uuid primary key default gen_random_uuid(),
  legacy_id uuid not null unique,
  name text not null,
  email text,
  legacy_user_id uuid,
  department_id uuid references public.atlas_departments(id) on delete set null,
  department_legacy_id uuid,
  role_id uuid references public.atlas_roles(id) on delete set null,
  role_legacy_id uuid,
  hub_user_id uuid references public.hub_users(id) on delete set null,
  status public.hub_record_status not null default 'active',
  migration_batch_id uuid references public.atlas_migration_batches(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint atlas_collaborators_name_not_blank check (btrim(name) <> '')
);

comment on table public.atlas_collaborators is
  'Colaboradores importados do Atlas legado, preservando vinculos legados e preparando Hub Users.';

create table if not exists public.atlas_occurrence_profiles (
  id uuid primary key default gen_random_uuid(),
  legacy_id uuid not null unique,
  name text not null,
  migration_batch_id uuid references public.atlas_migration_batches(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint atlas_occurrence_profiles_name_not_blank check (btrim(name) <> '')
);

comment on table public.atlas_occurrence_profiles is
  'Perfis de ocorrencia importados do Atlas legado.';

create table if not exists public.atlas_occurrence_types (
  id uuid primary key default gen_random_uuid(),
  legacy_id uuid not null unique,
  name text not null,
  profile_id uuid references public.atlas_occurrence_profiles(id) on delete set null,
  profile_legacy_id uuid,
  migration_batch_id uuid references public.atlas_migration_batches(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint atlas_occurrence_types_name_not_blank check (btrim(name) <> '')
);

comment on table public.atlas_occurrence_types is
  'Tipos de ocorrencia e criterios operacionais importados do Atlas legado.';

create table if not exists public.atlas_occurrences (
  id uuid primary key default gen_random_uuid(),
  legacy_id uuid not null unique,
  legacy_code bigint,
  collaborator_id uuid references public.atlas_collaborators(id) on delete set null,
  collaborator_legacy_id uuid not null,
  occurrence_type_id uuid references public.atlas_occurrence_types(id) on delete set null,
  occurrence_type_legacy_id uuid not null,
  occurrence_date date not null,
  observation text,
  evidence_url text,
  evidence_name text,
  evidence_type text,
  source_created_at timestamptz,
  migration_batch_id uuid references public.atlas_migration_batches(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.atlas_occurrences is
  'Ocorrencias operacionais importadas do Atlas legado, com evidencias preservadas para acesso controlado.';

create table if not exists public.atlas_legacy_user_profiles (
  id uuid primary key default gen_random_uuid(),
  legacy_user_id uuid not null unique,
  collaborator_id uuid references public.atlas_collaborators(id) on delete set null,
  collaborator_legacy_id uuid,
  display_name text,
  legacy_role text,
  active boolean,
  hub_user_id uuid references public.hub_users(id) on delete set null,
  migration_batch_id uuid references public.atlas_migration_batches(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.atlas_legacy_user_profiles is
  'Perfis de usuarios do Atlas legado preservados para reconciliacao futura com Hub Users.';

create index if not exists atlas_departments_name_idx
  on public.atlas_departments (name);

create index if not exists atlas_roles_name_idx
  on public.atlas_roles (name);

create index if not exists atlas_collaborators_name_idx
  on public.atlas_collaborators (name);

create index if not exists atlas_collaborators_department_idx
  on public.atlas_collaborators (department_legacy_id);

create index if not exists atlas_occurrence_types_profile_idx
  on public.atlas_occurrence_types (profile_legacy_id);

create index if not exists atlas_occurrences_date_idx
  on public.atlas_occurrences (occurrence_date desc, source_created_at desc);

create index if not exists atlas_occurrences_collaborator_idx
  on public.atlas_occurrences (collaborator_legacy_id, occurrence_date desc);

create index if not exists atlas_occurrences_type_idx
  on public.atlas_occurrences (occurrence_type_legacy_id);

drop trigger if exists set_atlas_migration_batches_updated_at
  on public.atlas_migration_batches;
create trigger set_atlas_migration_batches_updated_at
before update on public.atlas_migration_batches
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_atlas_departments_updated_at
  on public.atlas_departments;
create trigger set_atlas_departments_updated_at
before update on public.atlas_departments
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_atlas_roles_updated_at
  on public.atlas_roles;
create trigger set_atlas_roles_updated_at
before update on public.atlas_roles
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_atlas_collaborators_updated_at
  on public.atlas_collaborators;
create trigger set_atlas_collaborators_updated_at
before update on public.atlas_collaborators
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_atlas_occurrence_profiles_updated_at
  on public.atlas_occurrence_profiles;
create trigger set_atlas_occurrence_profiles_updated_at
before update on public.atlas_occurrence_profiles
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_atlas_occurrence_types_updated_at
  on public.atlas_occurrence_types;
create trigger set_atlas_occurrence_types_updated_at
before update on public.atlas_occurrence_types
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_atlas_occurrences_updated_at
  on public.atlas_occurrences;
create trigger set_atlas_occurrences_updated_at
before update on public.atlas_occurrences
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_atlas_legacy_user_profiles_updated_at
  on public.atlas_legacy_user_profiles;
create trigger set_atlas_legacy_user_profiles_updated_at
before update on public.atlas_legacy_user_profiles
for each row execute function public.set_hub_updated_at();

alter table public.atlas_migration_batches enable row level security;
alter table public.atlas_departments enable row level security;
alter table public.atlas_roles enable row level security;
alter table public.atlas_collaborators enable row level security;
alter table public.atlas_occurrence_profiles enable row level security;
alter table public.atlas_occurrence_types enable row level security;
alter table public.atlas_occurrences enable row level security;
alter table public.atlas_legacy_user_profiles enable row level security;

grant select, insert, update, delete on
  public.atlas_migration_batches,
  public.atlas_departments,
  public.atlas_roles,
  public.atlas_collaborators,
  public.atlas_occurrence_profiles,
  public.atlas_occurrence_types,
  public.atlas_occurrences,
  public.atlas_legacy_user_profiles
to authenticated, service_role;

drop policy if exists "atlas authenticated read migration batches"
  on public.atlas_migration_batches;
create policy "atlas authenticated read migration batches"
  on public.atlas_migration_batches
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
    )
  );

drop policy if exists "atlas admin manage migration batches"
  on public.atlas_migration_batches;
create policy "atlas admin manage migration batches"
  on public.atlas_migration_batches
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role = 'admin'
    )
  );

drop policy if exists "atlas authenticated read departments"
  on public.atlas_departments;
create policy "atlas authenticated read departments"
  on public.atlas_departments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
    )
  );

drop policy if exists "atlas admin manage departments"
  on public.atlas_departments;
create policy "atlas admin manage departments"
  on public.atlas_departments
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role = 'admin'
    )
  );

drop policy if exists "atlas authenticated read roles"
  on public.atlas_roles;
create policy "atlas authenticated read roles"
  on public.atlas_roles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
    )
  );

drop policy if exists "atlas admin manage roles"
  on public.atlas_roles;
create policy "atlas admin manage roles"
  on public.atlas_roles
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role = 'admin'
    )
  );

drop policy if exists "atlas authenticated read collaborators"
  on public.atlas_collaborators;
create policy "atlas authenticated read collaborators"
  on public.atlas_collaborators
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
    )
  );

drop policy if exists "atlas admin manage collaborators"
  on public.atlas_collaborators;
create policy "atlas admin manage collaborators"
  on public.atlas_collaborators
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role = 'admin'
    )
  );

drop policy if exists "atlas authenticated read occurrence profiles"
  on public.atlas_occurrence_profiles;
create policy "atlas authenticated read occurrence profiles"
  on public.atlas_occurrence_profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
    )
  );

drop policy if exists "atlas admin manage occurrence profiles"
  on public.atlas_occurrence_profiles;
create policy "atlas admin manage occurrence profiles"
  on public.atlas_occurrence_profiles
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role = 'admin'
    )
  );

drop policy if exists "atlas authenticated read occurrence types"
  on public.atlas_occurrence_types;
create policy "atlas authenticated read occurrence types"
  on public.atlas_occurrence_types
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
    )
  );

drop policy if exists "atlas admin manage occurrence types"
  on public.atlas_occurrence_types;
create policy "atlas admin manage occurrence types"
  on public.atlas_occurrence_types
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role = 'admin'
    )
  );

drop policy if exists "atlas authenticated read occurrences"
  on public.atlas_occurrences;
create policy "atlas authenticated read occurrences"
  on public.atlas_occurrences
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
    )
  );

drop policy if exists "atlas admin manage occurrences"
  on public.atlas_occurrences;
create policy "atlas admin manage occurrences"
  on public.atlas_occurrences
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role = 'admin'
    )
  );

drop policy if exists "atlas authenticated read legacy user profiles"
  on public.atlas_legacy_user_profiles;
create policy "atlas authenticated read legacy user profiles"
  on public.atlas_legacy_user_profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
    )
  );

drop policy if exists "atlas admin manage legacy user profiles"
  on public.atlas_legacy_user_profiles;
create policy "atlas admin manage legacy user profiles"
  on public.atlas_legacy_user_profiles
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.hub_users user_profile
      where user_profile.id = auth.uid()
        and user_profile.status = 'active'
        and user_profile.role = 'admin'
    )
  );

alter table public.atlas_departments replica identity full;
alter table public.atlas_roles replica identity full;
alter table public.atlas_collaborators replica identity full;
alter table public.atlas_occurrence_profiles replica identity full;
alter table public.atlas_occurrence_types replica identity full;
alter table public.atlas_occurrences replica identity full;
alter table public.atlas_legacy_user_profiles replica identity full;

commit;
