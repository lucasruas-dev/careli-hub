-- Careli Hub production schema setup for Supabase.
-- Execute manually in Supabase SQL Editor or through the Supabase CLI.
-- This migration prepares the Hub core, PulseX catalog entries, Supabase Auth
-- profile sync, future RLS policies, and future realtime subscriptions.

begin;

create extension if not exists pgcrypto;

do $$
begin
  create type hub_record_status as enum ('active', 'archived', 'disabled');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type hub_user_role as enum ('admin', 'leader', 'operator', 'viewer');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type hub_module_status as enum ('active', 'disabled', 'locked', 'planned');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type hub_module_category as enum (
    'core',
    'operations',
    'finance',
    'productivity',
    'relationship',
    'commercial',
    'procurement'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type hub_permission_scope as enum ('hub', 'module', 'workspace', 'system');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type hub_event_severity as enum ('neutral', 'info', 'success', 'warning', 'danger');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type hub_event_type as enum ('system', 'module', 'notification', 'presence', 'sync');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type hub_presence_status as enum ('online', 'away', 'busy', 'offline');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type hub_integration_status as enum ('connected', 'disabled', 'error', 'pending');
exception
  when duplicate_object then null;
end $$;

create or replace function public.set_hub_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.get_hub_role_from_auth_metadata(
  app_metadata jsonb,
  user_metadata jsonb
)
returns hub_user_role
language plpgsql
immutable
as $$
declare
  metadata_role text;
begin
  metadata_role := coalesce(app_metadata ->> 'role', user_metadata ->> 'role');

  if metadata_role in ('admin', 'leader', 'operator', 'viewer') then
    return metadata_role::hub_user_role;
  end if;

  return 'operator'::hub_user_role;
end;
$$;

create table if not exists public.hub_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  avatar_url text,
  role hub_user_role not null default 'operator',
  status hub_record_status not null default 'active',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_users_email_key unique (email),
  constraint hub_users_email_not_blank check (btrim(email) <> ''),
  constraint hub_users_display_name_not_blank check (btrim(display_name) <> '')
);

comment on table public.hub_users is 'Perfis operacionais do Careli Hub vinculados a auth.users.';
comment on column public.hub_users.id is 'Mesmo UUID de auth.users.id para compatibilidade com Supabase Auth e RLS.';
comment on column public.hub_users.status is 'Soft delete operacional por status; auth.users continua sendo a fonte de autenticacao.';

create table if not exists public.hub_workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  description text,
  owner_user_id uuid references public.hub_users(id) on delete set null,
  status hub_record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_workspaces_slug_key unique (slug),
  constraint hub_workspaces_slug_not_blank check (btrim(slug) <> ''),
  constraint hub_workspaces_name_not_blank check (btrim(name) <> '')
);

comment on table public.hub_workspaces is 'Workspaces operacionais do ecossistema.';
comment on column public.hub_workspaces.status is 'Soft delete operacional por status.';

create table if not exists public.hub_modules (
  id text primary key,
  name text not null,
  description text not null,
  category hub_module_category not null,
  status hub_module_status not null default 'planned',
  base_path text not null,
  icon_key text not null,
  realtime_enabled boolean not null default false,
  "order" integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_modules_base_path_key unique (base_path),
  constraint hub_modules_id_not_blank check (btrim(id) <> ''),
  constraint hub_modules_name_not_blank check (btrim(name) <> ''),
  constraint hub_modules_base_path_format check (base_path ~ '^/[a-z0-9-]+$')
);

comment on table public.hub_modules is 'Catalogo canonico de modulos registrados no Hub.';

create table if not exists public.hub_permissions (
  id text primary key,
  key text not null,
  scope hub_permission_scope not null,
  module_id text references public.hub_modules(id) on delete restrict,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_permissions_key_key unique (key),
  constraint hub_permissions_id_not_blank check (btrim(id) <> ''),
  constraint hub_permissions_key_not_blank check (btrim(key) <> ''),
  constraint hub_permissions_module_scope_check check (
    (scope = 'module' and module_id is not null)
    or (scope <> 'module')
  )
);

comment on table public.hub_permissions is 'Permissoes canonicas alinhadas ao @repo/shared.';

create table if not exists public.hub_user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.hub_users(id) on delete cascade,
  permission_id text not null references public.hub_permissions(id) on delete cascade,
  workspace_id uuid references public.hub_workspaces(id) on delete cascade,
  granted_by_user_id uuid references public.hub_users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.hub_user_permissions is 'Concessoes de permissoes por usuario e workspace opcional.';
comment on column public.hub_user_permissions.revoked_at is 'Soft delete/auditoria de revogacao.';

create table if not exists public.hub_activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.hub_workspaces(id) on delete cascade,
  module_id text references public.hub_modules(id) on delete set null,
  user_id uuid references public.hub_users(id) on delete set null,
  type hub_event_type not null,
  severity hub_event_severity not null default 'neutral',
  title text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint hub_activity_events_title_not_blank check (btrim(title) <> '')
);

comment on table public.hub_activity_events is 'Eventos operacionais e realtime do Hub.';

create table if not exists public.hub_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.hub_users(id) on delete cascade,
  workspace_id uuid references public.hub_workspaces(id) on delete cascade,
  module_id text references public.hub_modules(id) on delete set null,
  severity hub_event_severity not null default 'neutral',
  title text not null,
  action_href text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint hub_notifications_title_not_blank check (btrim(title) <> '')
);

comment on table public.hub_notifications is 'Notificacoes direcionadas a usuarios.';

create table if not exists public.hub_presence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.hub_users(id) on delete cascade,
  workspace_id uuid references public.hub_workspaces(id) on delete cascade,
  module_id text references public.hub_modules(id) on delete set null,
  status hub_presence_status not null default 'offline',
  last_seen_at timestamptz not null default now()
);

comment on table public.hub_presence is 'Presenca realtime por usuario e contexto opcional.';

create table if not exists public.hub_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.hub_workspaces(id) on delete cascade,
  module_id text references public.hub_modules(id) on delete set null,
  created_by_user_id uuid not null references public.hub_users(id) on delete restrict,
  name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  storage_path text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_files_storage_path_key unique (storage_path),
  constraint hub_files_name_not_blank check (btrim(name) <> ''),
  constraint hub_files_storage_path_not_blank check (btrim(storage_path) <> '')
);

comment on table public.hub_files is 'Arquivos associados a workspaces e modulos.';

create table if not exists public.hub_integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.hub_workspaces(id) on delete cascade,
  module_id text references public.hub_modules(id) on delete set null,
  provider text not null,
  name text not null,
  status hub_integration_status not null default 'pending',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_integrations_provider_not_blank check (btrim(provider) <> ''),
  constraint hub_integrations_name_not_blank check (btrim(name) <> '')
);

comment on table public.hub_integrations is 'Integracoes externas ou internas por contexto operacional.';
comment on column public.hub_integrations.status is 'Soft delete operacional via disabled quando aplicavel.';

create unique index if not exists hub_user_permissions_scope_key
  on public.hub_user_permissions (user_id, permission_id, coalesce(workspace_id::text, 'global'))
  where revoked_at is null;

create unique index if not exists hub_presence_context_key
  on public.hub_presence (
    user_id,
    coalesce(workspace_id::text, 'global'),
    coalesce(module_id, 'global')
  );

create unique index if not exists hub_integrations_context_provider_key
  on public.hub_integrations (
    coalesce(workspace_id::text, 'global'),
    provider,
    coalesce(module_id, 'global')
  );

create index if not exists hub_users_status_role_idx
  on public.hub_users (status, role);

create index if not exists hub_modules_status_order_idx
  on public.hub_modules (status, "order");

create index if not exists hub_permissions_module_scope_idx
  on public.hub_permissions (module_id, scope);

create index if not exists hub_user_permissions_user_workspace_idx
  on public.hub_user_permissions (user_id, workspace_id)
  where revoked_at is null;

create index if not exists hub_activity_events_context_created_at_idx
  on public.hub_activity_events (workspace_id, module_id, created_at desc);

create index if not exists hub_activity_events_user_created_at_idx
  on public.hub_activity_events (user_id, created_at desc);

create index if not exists hub_notifications_recipient_read_created_at_idx
  on public.hub_notifications (recipient_user_id, read_at, created_at desc);

create index if not exists hub_presence_context_status_idx
  on public.hub_presence (workspace_id, module_id, status);

create index if not exists hub_files_context_created_at_idx
  on public.hub_files (workspace_id, module_id, created_at desc);

create index if not exists hub_integrations_context_status_idx
  on public.hub_integrations (workspace_id, module_id, status);

drop trigger if exists set_hub_users_updated_at on public.hub_users;
create trigger set_hub_users_updated_at
before update on public.hub_users
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_hub_workspaces_updated_at on public.hub_workspaces;
create trigger set_hub_workspaces_updated_at
before update on public.hub_workspaces
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_hub_modules_updated_at on public.hub_modules;
create trigger set_hub_modules_updated_at
before update on public.hub_modules
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_hub_permissions_updated_at on public.hub_permissions;
create trigger set_hub_permissions_updated_at
before update on public.hub_permissions
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_hub_files_updated_at on public.hub_files;
create trigger set_hub_files_updated_at
before update on public.hub_files
for each row execute function public.set_hub_updated_at();

drop trigger if exists set_hub_integrations_updated_at on public.hub_integrations;
create trigger set_hub_integrations_updated_at
before update on public.hub_integrations
for each row execute function public.set_hub_updated_at();

create or replace function public.sync_hub_user_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.hub_users (
    id,
    email,
    display_name,
    avatar_url,
    role,
    last_seen_at
  ) values (
    new.id,
    lower(coalesce(nullif(new.email, ''), new.id::text || '@auth.local')),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'fullName', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Careli User'
    ),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    public.get_hub_role_from_auth_metadata(new.raw_app_meta_data, new.raw_user_meta_data),
    now()
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    role = excluded.role,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists sync_hub_user_from_auth_insert on auth.users;
create trigger sync_hub_user_from_auth_insert
after insert on auth.users
for each row execute function public.sync_hub_user_from_auth();

drop trigger if exists sync_hub_user_from_auth_update on auth.users;
create trigger sync_hub_user_from_auth_update
after update of email, raw_app_meta_data, raw_user_meta_data on auth.users
for each row execute function public.sync_hub_user_from_auth();

alter table public.hub_activity_events replica identity full;
alter table public.hub_notifications replica identity full;
alter table public.hub_presence replica identity full;
alter table public.hub_modules replica identity full;

comment on table public.hub_activity_events is 'Eventos operacionais preparados para publicacao realtime futura.';
comment on table public.hub_notifications is 'Notificacoes preparadas para publicacao realtime futura.';
comment on table public.hub_presence is 'Presenca preparada para publicacao realtime futura.';

-- RLS is intentionally not enabled in this first setup. Policies should be
-- introduced in a follow-up migration after service/server reads and workspace
-- scoping are validated against the deployed Hub.

commit;
