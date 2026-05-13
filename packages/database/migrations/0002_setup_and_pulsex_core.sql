-- Careli Hub central setup and PulseX operational core.
-- Execute after 0001_create_hub_core_schema.sql.

begin;

do $$
begin
  create type hub_department_module_status as enum ('enabled', 'disabled', 'planned');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type pulsex_channel_kind as enum ('department', 'sector', 'direct', 'system');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.hub_departments (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  description text,
  status hub_record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_departments_slug_key unique (slug),
  constraint hub_departments_slug_not_blank check (btrim(slug) <> ''),
  constraint hub_departments_name_not_blank check (btrim(name) <> '')
);

create table if not exists public.hub_sectors (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.hub_departments(id) on delete restrict,
  slug text not null,
  name text not null,
  description text,
  status hub_record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_sectors_slug_key unique (slug),
  constraint hub_sectors_id_department_key unique (id, department_id),
  constraint hub_sectors_slug_not_blank check (btrim(slug) <> ''),
  constraint hub_sectors_name_not_blank check (btrim(name) <> '')
);

create table if not exists public.hub_user_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.hub_users(id) on delete cascade,
  department_id uuid not null references public.hub_departments(id) on delete restrict,
  sector_id uuid references public.hub_sectors(id) on delete set null,
  title text,
  is_primary boolean not null default true,
  status hub_record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_user_assignments_sector_department_fk foreign key (
    sector_id,
    department_id
  ) references public.hub_sectors (id, department_id)
);

create table if not exists public.hub_department_modules (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.hub_departments(id) on delete cascade,
  module_id text not null references public.hub_modules(id) on delete cascade,
  status hub_department_module_status not null default 'enabled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_department_modules_key unique (department_id, module_id)
);

create table if not exists public.pulsex_channels (
  id text primary key,
  name text not null,
  description text,
  kind pulsex_channel_kind not null default 'sector',
  department_id uuid references public.hub_departments(id) on delete set null,
  sector_id uuid references public.hub_sectors(id) on delete set null,
  created_by_user_id uuid references public.hub_users(id) on delete set null,
  status hub_record_status not null default 'active',
  "order" integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pulsex_channels_name_not_blank check (btrim(name) <> ''),
  constraint pulsex_channels_id_not_blank check (btrim(id) <> '')
);

create table if not exists public.pulsex_channel_members (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null references public.pulsex_channels(id) on delete cascade,
  user_id uuid not null references public.hub_users(id) on delete cascade,
  role text not null default 'member',
  last_read_at timestamptz,
  status hub_record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pulsex_channel_members_key unique (channel_id, user_id),
  constraint pulsex_channel_members_role_not_blank check (btrim(role) <> '')
);

create table if not exists public.pulsex_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null references public.pulsex_channels(id) on delete cascade,
  author_user_id uuid references public.hub_users(id) on delete set null,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pulsex_messages_body_not_blank check (btrim(body) <> '')
);

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
  'setup',
  'Setup',
  'Configuracao central de usuarios, estrutura e modulos do Hub.',
  'core',
  'active',
  '/setup',
  'setup',
  false,
  15
)
on conflict (id) do update set
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
  ('setup-view', 'setup:view', 'module', 'setup', 'Visualizar Setup Central.'),
  ('setup-manage', 'setup:manage', 'module', 'setup', 'Gerenciar Setup Central.')
on conflict (id) do update set
  key = excluded.key,
  scope = excluded.scope,
  module_id = excluded.module_id,
  description = excluded.description,
  updated_at = now();

create unique index if not exists hub_user_assignments_primary_key
  on public.hub_user_assignments (user_id)
  where is_primary and status = 'active';

create index if not exists hub_sectors_department_status_idx
  on public.hub_sectors (department_id, status);

create index if not exists hub_department_modules_module_status_idx
  on public.hub_department_modules (module_id, status);

create index if not exists pulsex_channels_context_status_idx
  on public.pulsex_channels (department_id, sector_id, status, "order");

create index if not exists pulsex_messages_channel_created_at_idx
  on public.pulsex_messages (channel_id, created_at desc);

drop trigger if exists set_hub_departments_updated_at on public.hub_departments;
create trigger set_hub_departments_updated_at
before update on public.hub_departments
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_hub_sectors_updated_at on public.hub_sectors;
create trigger set_hub_sectors_updated_at
before update on public.hub_sectors
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_hub_user_assignments_updated_at on public.hub_user_assignments;
create trigger set_hub_user_assignments_updated_at
before update on public.hub_user_assignments
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_hub_department_modules_updated_at on public.hub_department_modules;
create trigger set_hub_department_modules_updated_at
before update on public.hub_department_modules
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_pulsex_channels_updated_at on public.pulsex_channels;
create trigger set_pulsex_channels_updated_at
before update on public.pulsex_channels
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_pulsex_channel_members_updated_at on public.pulsex_channel_members;
create trigger set_pulsex_channel_members_updated_at
before update on public.pulsex_channel_members
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_pulsex_messages_updated_at on public.pulsex_messages;
create trigger set_pulsex_messages_updated_at
before update on public.pulsex_messages
for each row execute function public.set_hub_updated_at();

alter table public.pulsex_channels replica identity full;
alter table public.pulsex_channel_members replica identity full;
alter table public.pulsex_messages replica identity full;

grant select on
  public.hub_departments,
  public.hub_sectors,
  public.hub_user_assignments,
  public.hub_department_modules,
  public.pulsex_channels,
  public.pulsex_channel_members,
  public.pulsex_messages
to authenticated;

grant insert, update on
  public.hub_departments,
  public.hub_sectors,
  public.pulsex_messages
to authenticated;

-- RLS remains disabled for this operational setup pass. The grants above keep
-- the anon key scoped to authenticated sessions while the access model is
-- validated in production.

commit;
